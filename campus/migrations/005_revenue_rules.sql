begin;
create table campus.revenue_rules (
  institution_id uuid not null references campus.institutions,id uuid not null,
  basis text not null check(basis in ('cash','accrual')), policy_id uuid not null,
  event_kind text not null check(event_kind in ('invoice','receipt','allocation')),
  effective_from date not null, mode text not null check(mode in ('journal','nonrecognition')),
  debit_key text,credit_key text,explanation text not null,
  prepared_by uuid not null references auth.users(id),approved_by uuid references auth.users(id),approved_at timestamptz,version integer,
  primary key(institution_id,id),unique(institution_id,basis,event_kind,version),
  foreign key(institution_id,policy_id,basis) references campus.policies,
  check((mode='journal' and debit_key is not null and credit_key is not null and debit_key<>credit_key and explanation='') or
    (mode='nonrecognition' and debit_key is null and credit_key is null and length(trim(explanation)) between 1 and 500))
);
create table campus.revenue_rule_usage (
  institution_id uuid not null,event_id uuid not null,basis text not null,rule_id uuid not null,
  primary key(institution_id,event_id,basis),foreign key(institution_id,event_id) references campus.revenue_events,
  foreign key(institution_id,rule_id) references campus.revenue_rules
);
alter table campus.revenue_rules enable row level security;
alter table campus.revenue_rule_usage enable row level security;
create policy rule_read on campus.revenue_rules for select to authenticated using(campus.member_role(institution_id) is not null);
create policy usage_read on campus.revenue_rule_usage for select to authenticated using(campus.member_role(institution_id) in ('bursar','cashier','student_accounts','reviewer','auditor'));
revoke all on campus.revenue_rules,campus.revenue_rule_usage from public,authenticated;
grant select on campus.revenue_rules,campus.revenue_rule_usage to authenticated;
create function campus.propose_revenue_rule(tenant uuid,rule uuid,accounting_basis text,policy uuid,kind text,effective date,
  treatment text,debit_mapping text,credit_mapping text,reason text) returns integer
language plpgsql security definer set search_path='' as $$
begin
  if campus.member_role(tenant) is distinct from 'institution_administrator' then raise exception 'permission denied' using errcode='42501'; end if;
  if effective is null or not exists(select 1 from campus.policies where institution_id=tenant and id=policy and basis=accounting_basis and effective_from<=effective) then raise exception 'approved effective policy required'; end if;
  if treatment='journal' and (not exists(select 1 from campus.policy_mappings where institution_id=tenant and policy_id=policy and mapping_key=debit_mapping) or
    not exists(select 1 from campus.policy_mappings where institution_id=tenant and policy_id=policy and mapping_key=credit_mapping)) then raise exception 'mapped rule accounts required'; end if;
  if treatment='journal' and (select account_id from campus.policy_mappings where institution_id=tenant and policy_id=policy and mapping_key=debit_mapping)=
    (select account_id from campus.policy_mappings where institution_id=tenant and policy_id=policy and mapping_key=credit_mapping) then raise exception 'distinct rule accounts required'; end if;
  insert into campus.revenue_rules values(tenant,rule,accounting_basis,policy,kind,effective,treatment,debit_mapping,credit_mapping,reason,auth.uid(),null,null,null);
  insert into campus.administration_events(institution_id,actor_id,subject_id,action) values(tenant,auth.uid(),rule,'revenue_rule_proposed');
  return 1;
end $$;
create function campus.approve_revenue_rule(tenant uuid,rule uuid) returns integer language plpgsql security definer set search_path='' as $$
declare draft campus.revenue_rules; next_version integer;
begin
  perform 1 from campus.institutions where id=tenant for update;
  if campus.member_role(tenant) is distinct from 'bursar' then raise exception 'permission denied' using errcode='42501'; end if;
  select * into draft from campus.revenue_rules where institution_id=tenant and id=rule for update;
  if not found then raise exception 'rule unavailable'; end if;
  if draft.prepared_by=auth.uid() then raise exception 'independent approver required' using errcode='42501'; end if;
  if draft.approved_by is not null then raise exception 'rule already approved' using errcode='23505'; end if;
  if exists(select 1 from campus.revenue_rules where institution_id=tenant and basis=draft.basis and event_kind=draft.event_kind and approved_by is not null and effective_from>=draft.effective_from) then raise exception 'effective date must follow approved rules'; end if;
  select coalesce(max(version),0)+1 into next_version from campus.revenue_rules where institution_id=tenant and basis=draft.basis and event_kind=draft.event_kind;
  update campus.revenue_rules set approved_by=auth.uid(),approved_at=clock_timestamp(),version=next_version where institution_id=tenant and id=rule;
  insert into campus.administration_events(institution_id,actor_id,subject_id,action) values(tenant,auth.uid(),rule,'revenue_rule_approved');
  return next_version;
end $$;
create function campus.submit_revenue_rules(tenant uuid,event uuid,expected_version integer,cash_rule uuid,accrual_rule uuid) returns integer
language plpgsql security definer set search_path='' as $$
declare source campus.revenue_events; rule campus.revenue_rules; selected uuid; plans jsonb:='[]'::jsonb; entries jsonb; result integer;
begin
  if coalesce(campus.member_role(tenant),'') not in ('bursar','cashier','student_accounts') then raise exception 'permission denied' using errcode='42501'; end if;
  select * into source from campus.revenue_events where institution_id=tenant and id=event for update;
  if not found or source.prepared_by<>auth.uid() then raise exception 'permission denied' using errcode='42501'; end if;
  foreach selected in array array[cash_rule,accrual_rule] loop
    select * into rule from campus.revenue_rules where institution_id=tenant and id=selected and approved_by is not null and event_kind=source.kind and effective_from<=source.document_date;
    if not found then raise exception 'approved matching rule required'; end if;
    if (selected=cash_rule and rule.basis<>'cash') or (selected=accrual_rule and rule.basis<>'accrual') then raise exception 'one rule per accounting basis required'; end if;
    if rule.mode='journal' then
      select jsonb_build_array(jsonb_build_object('account_id',d.account_id,'debit_minor',source.amount_minor::text,'credit_minor','0'),
        jsonb_build_object('account_id',c.account_id,'debit_minor','0','credit_minor',source.amount_minor::text)) into entries
        from campus.policy_mappings d cross join campus.policy_mappings c where d.institution_id=tenant and d.policy_id=rule.policy_id and d.mapping_key=rule.debit_key and c.institution_id=tenant and c.policy_id=rule.policy_id and c.mapping_key=rule.credit_key;
    else entries:='[]'::jsonb; end if;
    plans:=plans||jsonb_build_array(jsonb_build_object('basis',rule.basis,'policy_id',rule.policy_id,'lines',entries,'nonrecognition_reason',rule.explanation));
  end loop;
  result:=campus.submit_revenue(tenant,event,expected_version,plans);
  insert into campus.revenue_rule_usage values(tenant,event,'cash',cash_rule),(tenant,event,'accrual',accrual_rule);
  insert into campus.revenue_audit(institution_id,event_id,actor_id,action,version) values(tenant,event,auth.uid(),'approved_rules_applied',result);
  return result;
end $$;
create function campus.revenue_rule_schedule(tenant uuid) returns jsonb language plpgsql stable security invoker set search_path='' as $$
begin
  if campus.member_role(tenant) is null then raise exception 'permission denied' using errcode='42501'; end if;
  return (select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from(select id,basis,policy_id,event_kind,effective_from,mode,debit_key,credit_key,explanation,prepared_by,approved_by,version from campus.revenue_rules where institution_id=tenant order by effective_from desc,id limit 100)r);
end $$;
revoke all on function campus.propose_revenue_rule(uuid,uuid,text,uuid,text,date,text,text,text,text),campus.approve_revenue_rule(uuid,uuid),campus.submit_revenue_rules(uuid,uuid,integer,uuid,uuid),campus.revenue_rule_schedule(uuid) from public;
grant execute on function campus.propose_revenue_rule(uuid,uuid,text,uuid,text,date,text,text,text,text),campus.approve_revenue_rule(uuid,uuid),campus.submit_revenue_rules(uuid,uuid,integer,uuid,uuid),campus.revenue_rule_schedule(uuid) to authenticated;
commit;
