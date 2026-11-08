begin;
alter table campus.accounts add column code text;
alter table campus.accounts add column account_type text check(account_type in ('asset','liability','equity','income','expense'));
alter table campus.accounts add unique(institution_id,code);
alter table campus.periods add column version integer not null default 1;
create table campus.policy_proposals (
  institution_id uuid not null references campus.institutions,
  id uuid not null,
  basis text not null check(basis in ('cash','accrual')),
  effective_from date not null,
  narrative text not null check(length(trim(narrative)) between 1 and 4000),
  mappings jsonb not null,
  prepared_by uuid not null references auth.users(id),
  approved_by uuid references auth.users(id),
  approved_at timestamptz,
  primary key(institution_id,id)
);
create table campus.policy_mappings (
  institution_id uuid not null,
  policy_id uuid not null,
  basis text not null,
  mapping_key text not null,
  account_id uuid not null,
  primary key(institution_id,policy_id,mapping_key),
  foreign key(institution_id,policy_id,basis) references campus.policies,
  foreign key(institution_id,account_id) references campus.accounts
);
alter table campus.policy_proposals enable row level security;
alter table campus.policy_mappings enable row level security;
create policy proposal_read on campus.policy_proposals for select to authenticated using(campus.member_role(institution_id) is not null);
create policy mapping_read on campus.policy_mappings for select to authenticated using(campus.member_role(institution_id) is not null);
revoke all on campus.policy_proposals,campus.policy_mappings from public,authenticated;
grant select on campus.policy_proposals,campus.policy_mappings to authenticated;

create function campus.create_account(tenant uuid, account uuid, account_code text, account_name text, kind text)
returns integer language plpgsql security definer set search_path='' as $$
begin
  if campus.member_role(tenant) is distinct from 'institution_administrator' then raise exception 'permission denied' using errcode='42501'; end if;
  if account_code is null or account_code !~ '^[A-Za-z0-9._-]{1,32}$' or account_name is null or length(trim(account_name)) not between 1 and 200 or
    kind is null or kind not in ('asset','liability','equity','income','expense') then raise exception 'invalid account'; end if;
  insert into campus.accounts(institution_id,id,name,code,account_type) values(tenant,account,trim(account_name),account_code,kind);
  insert into campus.administration_events(institution_id,actor_id,subject_id,action) values(tenant,auth.uid(),account,'account_created');
  return 1;
end $$;
create function campus.create_period(tenant uuid, period uuid, starts date, ends date)
returns integer language plpgsql security definer set search_path='' as $$
begin
  perform 1 from campus.institutions where id=tenant for update;
  if campus.member_role(tenant) is distinct from 'institution_administrator' then raise exception 'permission denied' using errcode='42501'; end if;
  if starts is null or ends is null or ends<starts then raise exception 'invalid period'; end if;
  if exists(select 1 from campus.periods where institution_id=tenant and starts<=ends_on and ends>=starts_on) then raise exception 'overlapping period'; end if;
  insert into campus.periods(institution_id,id,starts_on,ends_on) values(tenant,period,starts,ends);
  insert into campus.administration_events(institution_id,actor_id,subject_id,action) values(tenant,auth.uid(),period,'period_created');
  return 1;
end $$;
create function campus.propose_policy(tenant uuid, proposal uuid, accounting_basis text, effective date, description text, mappings jsonb)
returns integer language plpgsql security definer set search_path='' as $$
declare entry jsonb;
begin
  if campus.member_role(tenant) is distinct from 'institution_administrator' then raise exception 'permission denied' using errcode='42501'; end if;
  if accounting_basis is null or accounting_basis not in ('cash','accrual') or effective is null or description is null or length(trim(description)) not between 1 and 4000 then
    raise exception 'invalid policy';
  end if;
  if jsonb_typeof(mappings) is distinct from 'array' then raise exception 'invalid mappings'; end if;
  if jsonb_array_length(mappings) not between 1 and 1000 then raise exception 'invalid mappings'; end if;
  for entry in select value from jsonb_array_elements(mappings) loop
    if jsonb_typeof(entry) is distinct from 'object' then raise exception 'invalid mapping'; end if;
    if (select count(*) from jsonb_object_keys(entry))<>2 or not(entry ?& array['key','account_id']) or
      jsonb_typeof(entry->'key') is distinct from 'string' or (entry->>'key') !~ '^[a-z][a-z0-9_]{0,63}$' then raise exception 'invalid mapping'; end if;
    if not exists(select 1 from campus.accounts where institution_id=tenant and id=(entry->>'account_id')::uuid and code is not null and account_type is not null) then
      raise exception 'mapped account unavailable';
    end if;
  end loop;
  if (select count(distinct value->>'key') from jsonb_array_elements(mappings))<>jsonb_array_length(mappings) then raise exception 'duplicate mapping key'; end if;
  insert into campus.policy_proposals values(tenant,proposal,accounting_basis,effective,trim(description),mappings,auth.uid(),null,null);
  insert into campus.administration_events(institution_id,actor_id,subject_id,action) values(tenant,auth.uid(),proposal,'policy_proposed');
  return 1;
end $$;
create function campus.approve_policy(tenant uuid, proposal uuid) returns integer
language plpgsql security definer set search_path='' as $$
declare draft campus.policy_proposals; next_version integer;
begin
  perform 1 from campus.institutions where id=tenant for update;
  if campus.member_role(tenant) is distinct from 'bursar' then raise exception 'permission denied' using errcode='42501'; end if;
  select * into draft from campus.policy_proposals where institution_id=tenant and id=proposal for update;
  if not found then raise exception 'policy unavailable'; end if;
  if draft.prepared_by=auth.uid() then raise exception 'independent approver required' using errcode='42501'; end if;
  if draft.approved_by is not null then raise exception 'already approved' using errcode='23505'; end if;
  if exists(select 1 from campus.policies where institution_id=tenant and basis=draft.basis and effective_from>=draft.effective_from) then
    raise exception 'effective date must follow approved versions';
  end if;
  select coalesce(max(version),0)+1 into next_version from campus.policies where institution_id=tenant and basis=draft.basis;
  insert into campus.policies values(tenant,proposal,draft.basis,next_version,draft.effective_from,draft.prepared_by,auth.uid());
  insert into campus.policy_mappings select tenant,proposal,draft.basis,value->>'key',(value->>'account_id')::uuid from jsonb_array_elements(draft.mappings);
  update campus.policy_proposals set approved_by=auth.uid(),approved_at=clock_timestamp() where institution_id=tenant and id=proposal;
  insert into campus.administration_events(institution_id,actor_id,subject_id,action) values(tenant,auth.uid(),proposal,'policy_approved');
  return next_version;
end $$;
create function campus.lock_period(tenant uuid, period uuid, expected_version integer) returns integer
language plpgsql security definer set search_path='' as $$
declare current_period campus.periods;
begin
  if campus.member_role(tenant) is distinct from 'bursar' then raise exception 'permission denied' using errcode='42501'; end if;
  select * into current_period from campus.periods where institution_id=tenant and id=period for update;
  if not found then raise exception 'period unavailable'; end if;
  if expected_version is null or current_period.version<>expected_version then raise exception 'version conflict' using errcode='40001'; end if;
  if current_period.locked then raise exception 'period already locked'; end if;
  if exists(select 1 from campus.journals where institution_id=tenant and period_id=period and status<>'posted') then raise exception 'unposted journals remain'; end if;
  update campus.periods set locked=true,version=version+1 where institution_id=tenant and id=period;
  insert into campus.administration_events(institution_id,actor_id,subject_id,action) values(tenant,auth.uid(),period,'period_locked');
  return expected_version+1;
end $$;

create function campus.configuration(tenant uuid) returns jsonb language plpgsql stable security invoker set search_path='' as $$
begin
  if campus.member_role(tenant) is null then raise exception 'permission denied' using errcode='42501'; end if;
  return jsonb_build_object(
    'accounts',(select coalesce(jsonb_agg(to_jsonb(a) order by a.code,a.id),'[]'::jsonb) from
      (select id,name,code,account_type from campus.accounts where institution_id=tenant) a),
    'periods',(select coalesce(jsonb_agg(to_jsonb(p) order by p.starts_on,p.id),'[]'::jsonb) from
      (select id,starts_on,ends_on,locked,version from campus.periods where institution_id=tenant) p),
    'policies',(select coalesce(jsonb_agg(to_jsonb(p) order by p.effective_from,p.id),'[]'::jsonb) from
      (select d.id,d.basis,d.effective_from,d.narrative,d.mappings,d.prepared_by,d.approved_by,p.version from campus.policy_proposals d
        left join campus.policies p on p.institution_id=d.institution_id and p.id=d.id and p.basis=d.basis where d.institution_id=tenant) p));
end $$;

create function campus.enforce_journal_configuration() returns trigger language plpgsql security definer set search_path='' as $$
begin
  perform 1 from campus.periods where institution_id=new.institution_id and id=new.period_id and not locked for update;
  if not found then raise exception 'open journal period required'; end if;
  if not exists(select 1 from campus.policy_mappings where institution_id=new.institution_id and policy_id=new.policy_id and basis=new.basis) then
    raise exception 'approved mapped policy required';
  end if;
  return new;
end $$;
create trigger journal_configuration before insert on campus.journals for each row execute function campus.enforce_journal_configuration();
create function campus.enforce_line_mapping() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if not exists(select 1 from campus.journals j join campus.policy_mappings m on m.institution_id=j.institution_id and m.policy_id=j.policy_id and m.basis=j.basis
    where j.institution_id=new.institution_id and j.id=new.journal_id and m.account_id=new.account_id) then raise exception 'unmapped journal account'; end if;
  return new;
end $$;
create trigger journal_line_mapping before insert on campus.journal_lines for each row execute function campus.enforce_line_mapping();
revoke all on function campus.enforce_journal_configuration(),campus.enforce_line_mapping() from public;
revoke all on function campus.create_account(uuid,uuid,text,text,text),campus.create_period(uuid,uuid,date,date),campus.propose_policy(uuid,uuid,text,date,text,jsonb),campus.approve_policy(uuid,uuid),campus.lock_period(uuid,uuid,integer) from public;
revoke all on function campus.configuration(uuid) from public;
grant execute on function campus.configuration(uuid),campus.create_account(uuid,uuid,text,text,text),campus.create_period(uuid,uuid,date,date),campus.propose_policy(uuid,uuid,text,date,text,jsonb),campus.approve_policy(uuid,uuid),campus.lock_period(uuid,uuid,integer) to authenticated;
commit;
