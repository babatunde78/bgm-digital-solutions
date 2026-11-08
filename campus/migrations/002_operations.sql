begin;
alter table campus.institutions add column currency text not null default 'NGN' check (currency ~ '^[A-Z]{3}$');
alter table campus.memberships add foreign key (user_id) references auth.users(id);
create table campus.platform_administrators (user_id uuid primary key references auth.users(id));
create table campus.administration_events (
  id bigint generated always as identity primary key,
  institution_id uuid not null references campus.institutions,
  actor_id uuid not null references auth.users(id),
  subject_id uuid not null,
  action text not null,
  assigned_role text,
  enabled boolean,
  occurred_at timestamptz not null default clock_timestamp()
);
alter table campus.platform_administrators enable row level security;
alter table campus.administration_events enable row level security;
revoke all on campus.platform_administrators,campus.administration_events from public,authenticated;
grant select on campus.administration_events to authenticated;
create policy administration_read on campus.administration_events for select to authenticated
  using (campus.member_role(institution_id) in ('institution_administrator','auditor'));

alter table campus.journals add column reversal_of uuid;
alter table campus.journals add column reversal_reason text;
alter table campus.journals add foreign key (institution_id,reversal_of) references campus.journals(institution_id,id);
alter table campus.journals add unique (institution_id,reversal_of);
alter table campus.journals add check ((reversal_of is null and reversal_reason is null) or
  (reversal_of is not null and reversal_reason is not null and length(trim(reversal_reason)) between 1 and 500 and reversal_of<>id));

create function campus.provision_institution(tenant uuid, legal_name text, currency_code text, administrator uuid)
returns integer language plpgsql security definer set search_path='' as $$
begin
  if not exists (select 1 from campus.platform_administrators where user_id=auth.uid()) then
    raise exception 'permission denied' using errcode='42501';
  end if;
  if legal_name is null or length(trim(legal_name)) not between 1 and 200 or currency_code is null or currency_code !~ '^[A-Z]{3}$' then
    raise exception 'invalid institution configuration';
  end if;
  insert into campus.institutions(id,name,currency) values (tenant,trim(legal_name),currency_code);
  insert into campus.memberships values (tenant,administrator,'institution_administrator',true);
  insert into campus.administration_events (institution_id,actor_id,subject_id,action)
    values (tenant,auth.uid(),administrator,'institution_provisioned');
  return 1;
end $$;

create function campus.set_member(tenant uuid, member uuid, member_role text, enabled boolean)
returns integer language plpgsql security definer set search_path='' as $$
begin
  perform 1 from campus.institutions where id=tenant for update;
  if campus.member_role(tenant) is distinct from 'institution_administrator' then
    raise exception 'permission denied' using errcode='42501';
  end if;
  if exists (select 1 from campus.memberships where institution_id=tenant and user_id=member and role='institution_administrator') then
    raise exception 'administrator membership is fixed';
  end if;
  if member_role is null or member_role not in ('bursar','cashier','student_accounts','budget_officer','payables_officer','reviewer','auditor') or enabled is null then
    raise exception 'invalid membership';
  end if;
  insert into campus.memberships values (tenant,member,member_role,enabled)
    on conflict (institution_id,user_id) do update set role=excluded.role,active=excluded.active;
  insert into campus.administration_events (institution_id,actor_id,subject_id,action,assigned_role,enabled)
    values (tenant,auth.uid(),member,case when enabled then 'membership_assigned' else 'membership_disabled' end,member_role,enabled);
  return 1;
end $$;

create function campus.my_context() returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('platform_administrator',exists(select 1 from campus.platform_administrators where user_id=auth.uid()),
    'institutions',coalesce((select jsonb_agg(jsonb_build_object('id',i.id,'name',i.name,'currency',i.currency,'role',m.role) order by i.name,i.id)
      from campus.institutions i join campus.memberships m on m.institution_id=i.id
      where m.user_id=auth.uid() and m.active),'[]'::jsonb))
$$;

create function campus.journal_schedule(tenant uuid, accounting_basis text) returns jsonb
language plpgsql stable security invoker set search_path='' as $$
declare result jsonb;
begin
  if accounting_basis is null or accounting_basis not in ('cash','accrual') then raise exception 'one accounting basis required'; end if;
  if campus.member_role(tenant) is null then raise exception 'permission denied' using errcode='42501'; end if;
  select coalesce(jsonb_agg(to_jsonb(schedule)),'[]'::jsonb) into result from (
    select id,basis,posted_on,status,version,reversal_of from campus.journals
    where institution_id=tenant and basis=accounting_basis order by posted_on desc,id limit 100
  ) schedule;
  return result;
end $$;

create function campus.reverse_journal(tenant uuid, original uuid, expected_version integer, reversal uuid,
  reversal_period uuid, reversal_date date, reason text) returns integer
language plpgsql security definer set search_path='' as $$
declare original_journal campus.journals; entries jsonb;
begin
  if coalesce(campus.member_role(tenant),'') not in ('bursar','cashier','student_accounts','budget_officer','payables_officer') then
    raise exception 'permission denied' using errcode='42501';
  end if;
  select * into original_journal from campus.journals where institution_id=tenant and id=original for update;
  if not found or original_journal.status<>'posted' then raise exception 'posted original required'; end if;
  if expected_version is null or original_journal.version<>expected_version then raise exception 'version conflict' using errcode='40001'; end if;
  if exists(select 1 from campus.journals where institution_id=tenant and reversal_of=original) then raise exception 'original already has a reversal' using errcode='23505'; end if;
  if reason is null or length(trim(reason)) not between 1 and 500 or reversal_date is null or reversal_date<original_journal.posted_on then
    raise exception 'valid reversal date and reason required';
  end if;
  perform 1 from campus.periods where institution_id=tenant and id=reversal_period and not locked and reversal_date between starts_on and ends_on for update;
  if not found then raise exception 'open reversal period required'; end if;
  select jsonb_agg(jsonb_build_object('account_id',account_id,'debit_minor',credit_minor::text,'credit_minor',debit_minor::text) order by line_no)
    into entries from campus.journal_lines where institution_id=tenant and journal_id=original;
  perform campus.create_journal(tenant,reversal,original_journal.basis,original_journal.policy_id,reversal_period,reversal,reversal_date,entries);
  update campus.journals set reversal_of=original,reversal_reason=trim(reason) where institution_id=tenant and id=reversal;
  insert into campus.audit_events(institution_id,actor_id,journal_id,action,version) values(tenant,auth.uid(),reversal,'reversal_linked',1);
  return 1;
end $$;
revoke all on function campus.provision_institution(uuid,text,text,uuid),campus.set_member(uuid,uuid,text,boolean),campus.my_context(),campus.journal_schedule(uuid,text),campus.reverse_journal(uuid,uuid,integer,uuid,uuid,date,text) from public;
grant execute on function campus.provision_institution(uuid,text,text,uuid),campus.set_member(uuid,uuid,text,boolean),campus.my_context(),campus.journal_schedule(uuid,text),campus.reverse_journal(uuid,uuid,integer,uuid,uuid,date,text) to authenticated;
commit;
