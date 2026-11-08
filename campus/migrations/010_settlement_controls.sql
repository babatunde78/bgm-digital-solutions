begin;
create table campus.settlement_profiles(
 institution_id uuid not null,id uuid not null,bank_source_id uuid not null,basis text not null,policy_id uuid not null,effective_from date not null,
 settings jsonb not null,bank_account_id uuid not null,clearing_account_id uuid not null,fee_account_id uuid not null,variance_account_id uuid not null,limit_minor numeric(18,0) not null check(limit_minor>=0),
 prepared_by uuid not null references auth.users(id),approved_by uuid references auth.users(id),version integer,
 primary key(institution_id,id),unique(institution_id,bank_source_id,basis,version),foreign key(institution_id,bank_source_id) references campus.bank_sources,
 foreign key(institution_id,policy_id,basis) references campus.policies,foreign key(institution_id,bank_account_id) references campus.accounts,foreign key(institution_id,clearing_account_id) references campus.accounts,
 foreign key(institution_id,fee_account_id) references campus.accounts,foreign key(institution_id,variance_account_id) references campus.accounts
);
create table campus.reconciliation_tolerances(
 institution_id uuid not null,id uuid not null,bank_line_id uuid not null,side text not null check(side in('bank','source')),event_id uuid,amount_minor numeric(18,0) not null check(amount_minor>0),
 cash_profile_id uuid not null,accrual_profile_id uuid not null,reason text not null,status text not null default 'draft' check(status in('draft','submitted','reviewed','approved','cancelled','void_submitted','void_reviewed','voided')),version integer not null default 1,
 prepared_by uuid not null references auth.users(id),reviewed_by uuid references auth.users(id),approved_by uuid references auth.users(id),approval_note text,
 void_prepared_by uuid references auth.users(id),void_reviewed_by uuid references auth.users(id),void_approved_by uuid references auth.users(id),void_reason text,
 primary key(institution_id,id),foreign key(institution_id,bank_line_id) references campus.bank_lines,foreign key(institution_id,event_id) references campus.revenue_events,
 foreign key(institution_id,cash_profile_id) references campus.settlement_profiles,foreign key(institution_id,accrual_profile_id) references campus.settlement_profiles,
 check((side='bank' and event_id is null)or(side='source' and event_id is not null))
);
create table campus.treasury_settlements(
 institution_id uuid not null,id uuid not null,bank_line_id uuid not null,period_id uuid not null,posting_date date not null,cash_profile_id uuid not null,accrual_profile_id uuid not null,
 snapshot jsonb not null,reversal_of uuid,reason text,status text not null default 'draft' check(status in('draft','submitted','reviewed','approved','posted','cancelled')),version integer not null default 1,
 prepared_by uuid not null references auth.users(id),reviewed_by uuid references auth.users(id),approved_by uuid references auth.users(id),
 primary key(institution_id,id),foreign key(institution_id,bank_line_id) references campus.bank_lines,foreign key(institution_id,period_id) references campus.periods,
 foreign key(institution_id,cash_profile_id) references campus.settlement_profiles,foreign key(institution_id,accrual_profile_id) references campus.settlement_profiles,
 foreign key(institution_id,reversal_of) references campus.treasury_settlements,
 check((reversal_of is null and reason is null)or(reversal_of is not null and reason is not null and reversal_of<>id and length(trim(reason)) between 1 and 500))
);
create unique index one_active_settlement_reversal on campus.treasury_settlements(institution_id,reversal_of) where reversal_of is not null and status<>'cancelled';
create table campus.treasury_settlement_claims(institution_id uuid not null,bank_line_id uuid not null,settlement_id uuid not null,
 primary key(institution_id,bank_line_id),foreign key(institution_id,bank_line_id) references campus.bank_lines,foreign key(institution_id,settlement_id) references campus.treasury_settlements);
create table campus.treasury_consumptions(institution_id uuid not null,settlement_id uuid not null,event_id uuid not null,basis text not null,account_id uuid not null,amount_minor numeric(18,0) not null check(amount_minor>0),
 primary key(institution_id,settlement_id,event_id,basis),foreign key(institution_id,settlement_id) references campus.treasury_settlements,foreign key(institution_id,event_id) references campus.revenue_events,foreign key(institution_id,account_id) references campus.accounts);
create table campus.treasury_posting_authority(institution_id uuid not null,settlement_id uuid not null,transaction_id bigint not null,
 primary key(institution_id,settlement_id,transaction_id),foreign key(institution_id,settlement_id) references campus.treasury_settlements);
alter table campus.settlement_profiles enable row level security;
alter table campus.reconciliation_tolerances enable row level security;
alter table campus.treasury_settlements enable row level security;
alter table campus.treasury_settlement_claims enable row level security;
alter table campus.treasury_consumptions enable row level security;
alter table campus.treasury_posting_authority enable row level security;
create policy profile_read on campus.settlement_profiles for select to authenticated using(campus.member_role(institution_id) is not null);
create policy tolerance_read on campus.reconciliation_tolerances for select to authenticated using(campus.member_role(institution_id) in('bursar','cashier','student_accounts','reviewer','auditor'));
create policy settlement_read on campus.treasury_settlements for select to authenticated using(campus.member_role(institution_id) in('bursar','cashier','student_accounts','reviewer','auditor'));
create policy consumption_read on campus.treasury_consumptions for select to authenticated using(campus.member_role(institution_id) in('bursar','reviewer','auditor'));
revoke all on campus.settlement_profiles,campus.reconciliation_tolerances,campus.treasury_settlements,campus.treasury_settlement_claims,campus.treasury_consumptions,campus.treasury_posting_authority from public,authenticated;
grant select on campus.settlement_profiles,campus.reconciliation_tolerances,campus.treasury_settlements,campus.treasury_consumptions to authenticated;

create function campus.propose_settlement_profile(tenant uuid,profile uuid,bank uuid,accounting_basis text,policy uuid,effective date,settings jsonb) returns integer
language plpgsql security definer set search_path='' as $$
declare bank_account uuid;clearing_account uuid;fee_account uuid;variance_account uuid;
begin
 if campus.member_role(tenant) is distinct from 'institution_administrator' then raise exception 'permission denied' using errcode='42501';end if;
 if not exists(select 1 from campus.policies where institution_id=tenant and id=policy and basis=accounting_basis and effective_from<=effective) then raise exception 'approved effective policy required';end if;
 if jsonb_typeof(settings) is distinct from 'object' then raise exception 'invalid settlement settings';end if;
 if(select count(*) from jsonb_object_keys(settings))<>5 or not(settings ?& array['bank_key','clearing_key','fee_key','variance_key','limit_minor']) or
  exists(select 1 from jsonb_each(settings) where jsonb_typeof(value) is distinct from 'string') or coalesce(settings->>'limit_minor','') !~ '^(0|[1-9][0-9]{0,17})$' then raise exception 'explicit mappings and integer limit required';end if;
 select account_id into bank_account from campus.policy_mappings where institution_id=tenant and policy_id=policy and basis=accounting_basis and mapping_key=settings->>'bank_key';
 select account_id into clearing_account from campus.policy_mappings where institution_id=tenant and policy_id=policy and basis=accounting_basis and mapping_key=settings->>'clearing_key';
 select account_id into fee_account from campus.policy_mappings where institution_id=tenant and policy_id=policy and basis=accounting_basis and mapping_key=settings->>'fee_key';
 select account_id into variance_account from campus.policy_mappings where institution_id=tenant and policy_id=policy and basis=accounting_basis and mapping_key=settings->>'variance_key';
 if not exists(select 1 from campus.bank_sources where institution_id=tenant and id=bank and account_id=bank_account) or
  not exists(select 1 from campus.accounts where institution_id=tenant and id=clearing_account and account_type='asset' and id<>bank_account) or
  not exists(select 1 from campus.accounts where institution_id=tenant and id=fee_account and account_type in('asset','expense') and id not in(bank_account,clearing_account)) or
  not exists(select 1 from campus.accounts where institution_id=tenant and id=variance_account and account_type in('asset','liability','expense') and id not in(bank_account,clearing_account)) then raise exception 'eligible bank, clearing, fee and variance mappings required';end if;
 insert into campus.settlement_profiles values(tenant,profile,bank,accounting_basis,policy,effective,settings,bank_account,clearing_account,fee_account,variance_account,(settings->>'limit_minor')::numeric,auth.uid(),null,null);
 insert into campus.administration_events(institution_id,actor_id,subject_id,action)values(tenant,auth.uid(),profile,'settlement_profile_proposed');return 1;
end $$;
create function campus.approve_settlement_profile(tenant uuid,profile uuid) returns integer language plpgsql security definer set search_path='' as $$
declare source campus.settlement_profiles;next_version integer;
begin
 perform 1 from campus.institutions where id=tenant for update;
 if campus.member_role(tenant) is distinct from 'bursar' then raise exception 'permission denied' using errcode='42501';end if;
 select * into source from campus.settlement_profiles where institution_id=tenant and id=profile for update;
 if not found then raise exception 'profile unavailable';end if;
 if source.prepared_by=auth.uid() then raise exception 'independent approver required' using errcode='42501';end if;
 if source.approved_by is not null then raise exception 'profile already approved' using errcode='23505';end if;
 if exists(select 1 from campus.settlement_profiles where institution_id=tenant and bank_source_id=source.bank_source_id and basis=source.basis and approved_by is not null and effective_from>=source.effective_from) then raise exception 'effective date must follow approved profiles';end if;
 select coalesce(max(version),0)+1 into next_version from campus.settlement_profiles where institution_id=tenant and bank_source_id=source.bank_source_id and basis=source.basis;
 update campus.settlement_profiles set approved_by=auth.uid(),version=next_version where institution_id=tenant and id=profile;
 insert into campus.administration_events(institution_id,actor_id,subject_id,action)values(tenant,auth.uid(),profile,'settlement_profile_approved');return next_version;
end $$;
create function campus.check_tolerance(tenant uuid,tolerance uuid) returns void language plpgsql security definer set search_path='' as $$
declare source campus.reconciliation_tolerances;line campus.bank_lines;cash campus.settlement_profiles;accrual campus.settlement_profiles;used numeric;matched numeric;available numeric;
begin
 select * into source from campus.reconciliation_tolerances where institution_id=tenant and id=tolerance;
 select * into line from campus.bank_lines where institution_id=tenant and id=source.bank_line_id for update;
 select * into cash from campus.settlement_profiles where institution_id=tenant and id=source.cash_profile_id and basis='cash' and bank_source_id=line.bank_source_id and approved_by is not null and effective_from<=line.bank_date;
 if not found then raise exception 'approved effective cash profile required';end if;
 select * into accrual from campus.settlement_profiles where institution_id=tenant and id=source.accrual_profile_id and basis='accrual' and bank_source_id=line.bank_source_id and approved_by is not null and effective_from<=line.bank_date;
 if not found then raise exception 'approved effective accrual profile required';end if;
 if exists(select 1 from campus.treasury_settlement_claims where institution_id=tenant and bank_line_id=line.id) then raise exception 'settlement must be cancelled or reversed';end if;
 if not exists(select 1 from campus.reconciliation_pairs p join campus.reconciliations r on r.institution_id=p.institution_id and r.id=p.reconciliation_id where p.institution_id=tenant and p.bank_line_id=line.id and r.status='approved') or
  exists(select 1 from campus.reconciliation_pairs p join campus.reconciliations r on r.institution_id=p.institution_id and r.id=p.reconciliation_id where p.institution_id=tenant and p.bank_line_id=line.id and r.status in('void_submitted','void_reviewed')) then raise exception 'reviewed matching required before tolerance';end if;
 select coalesce(sum(amount_minor),0) into used from campus.reconciliation_tolerances where institution_id=tenant and bank_line_id=line.id and status in('approved','void_submitted','void_reviewed') and id<>tolerance;
 if used+source.amount_minor>cash.limit_minor or used+source.amount_minor>accrual.limit_minor then raise exception 'approved tolerance limit exceeded';end if;
 if source.side='bank' then
  select coalesce(sum(p.amount_minor),0) into matched from campus.reconciliation_pairs p join campus.reconciliations r on r.institution_id=p.institution_id and r.id=p.reconciliation_id where p.institution_id=tenant and p.bank_line_id=line.id and r.status in('approved','void_submitted','void_reviewed');
  select line.gross_minor-matched-coalesce(sum(amount_minor),0) into available from campus.reconciliation_tolerances where institution_id=tenant and bank_line_id=line.id and side='bank' and status in('approved','void_submitted','void_reviewed') and id<>tolerance;
 else
  perform 1 from campus.revenue_events where institution_id=tenant and id=source.event_id for update;
  if not exists(select 1 from campus.reconciliation_pairs p join campus.reconciliations r on r.institution_id=p.institution_id and r.id=p.reconciliation_id where p.institution_id=tenant and p.bank_line_id=line.id and p.event_id=source.event_id and r.status='approved') then raise exception 'source must be matched to this bank line';end if;
  select coalesce(sum(p.amount_minor),0) into matched from campus.reconciliation_pairs p join campus.reconciliations r on r.institution_id=p.institution_id and r.id=p.reconciliation_id where p.institution_id=tenant and p.event_id=source.event_id and r.status in('approved','void_submitted','void_reviewed');
  select e.amount_minor-matched-(select coalesce(sum(amount_minor),0) from campus.reconciliation_tolerances where institution_id=tenant and event_id=source.event_id and side='source' and status in('approved','void_submitted','void_reviewed') and id<>tolerance) into available from campus.revenue_events e where e.institution_id=tenant and e.id=source.event_id;
 end if;
 if source.amount_minor>available then raise exception 'tolerance exceeds available difference';end if;
end $$;
create function campus.propose_tolerance(tenant uuid,tolerance uuid,bank_line uuid,which_side text,event uuid,amount text,cash_profile uuid,accrual_profile uuid,reason text) returns integer language plpgsql security definer set search_path='' as $$
begin
 if coalesce(campus.member_role(tenant),'') not in('bursar','student_accounts') then raise exception 'permission denied' using errcode='42501';end if;
 if amount is null or amount !~ '^[1-9][0-9]{0,17}$' or reason is null or length(trim(reason)) not between 1 and 500 then raise exception 'explicit positive difference and reason required';end if;
 insert into campus.reconciliation_tolerances(institution_id,id,bank_line_id,side,event_id,amount_minor,cash_profile_id,accrual_profile_id,reason,prepared_by)values(tenant,tolerance,bank_line,which_side,event,amount::numeric,cash_profile,accrual_profile,trim(reason),auth.uid());
 perform campus.check_tolerance(tenant,tolerance);
 insert into campus.treasury_audit(institution_id,subject_id,actor_id,action,version)values(tenant,tolerance,auth.uid(),'tolerance_proposed',1);return 1;
end $$;
create function campus.transition_tolerance(tenant uuid,tolerance uuid,expected_version integer,target text,note text) returns integer language plpgsql security definer set search_path='' as $$
declare source campus.reconciliation_tolerances;caller text;
begin
 caller:=campus.member_role(tenant);if coalesce(caller,'') not in('bursar','student_accounts','reviewer') then raise exception 'permission denied' using errcode='42501';end if;
 select * into source from campus.reconciliation_tolerances where institution_id=tenant and id=tolerance for update;
 if not found then raise exception 'tolerance unavailable';end if;
 if expected_version is null or source.version<>expected_version then raise exception 'version conflict' using errcode='40001';end if;
 if note is null or length(note)>500 then raise exception 'invalid review note';end if;
 if target='cancelled' then
  if source.status not in('draft','submitted','reviewed') or(caller<>'bursar' and(source.prepared_by<>auth.uid() or source.status<>'draft')) then raise exception 'permission denied' using errcode='42501';end if;
 else
  if not((source.status='draft' and target='submitted')or(source.status='submitted' and target='reviewed')or(source.status='reviewed' and target='approved')or(source.status='approved' and target='void_submitted')or(source.status='void_submitted' and target='void_reviewed')or(source.status='void_reviewed' and target='voided')) then raise exception 'invalid tolerance transition';end if;
  if target='submitted' and(source.prepared_by<>auth.uid() or caller not in('bursar','student_accounts')) then raise exception 'permission denied' using errcode='42501';end if;
  if target='reviewed' and(caller not in('reviewer','bursar') or source.prepared_by=auth.uid()) then raise exception 'independent reviewer required' using errcode='42501';end if;
  if target='approved' and(caller<>'bursar' or source.prepared_by=auth.uid()) then raise exception 'independent approver required' using errcode='42501';end if;
  if target='void_submitted' and caller<>'bursar' then raise exception 'permission denied' using errcode='42501';end if;
  if target='void_reviewed' and(caller not in('reviewer','bursar') or source.void_prepared_by=auth.uid()) then raise exception 'independent reviewer required' using errcode='42501';end if;
  if target='voided' and(caller<>'bursar' or source.void_prepared_by=auth.uid()) then raise exception 'independent approver required' using errcode='42501';end if;
  if target in('approved','void_submitted') and length(trim(note))=0 then raise exception 'explicit approval note or void reason required';end if;
  if target='approved' then perform campus.check_tolerance(tenant,tolerance);end if;
  if target in('void_submitted','voided') then
   perform 1 from campus.bank_lines where institution_id=tenant and id=source.bank_line_id for update;
   if exists(select 1 from campus.treasury_settlement_claims where institution_id=tenant and bank_line_id=source.bank_line_id) then raise exception 'settlement must be cancelled or reversed';end if;
  end if;
 end if;
 update campus.reconciliation_tolerances set status=target,version=version+1,reviewed_by=case when target='reviewed' then auth.uid() else reviewed_by end,approved_by=case when target='approved' then auth.uid() else approved_by end,
 approval_note=case when target='approved' then trim(note) else approval_note end,void_prepared_by=case when target='void_submitted' then auth.uid() else void_prepared_by end,void_reviewed_by=case when target='void_reviewed' then auth.uid() else void_reviewed_by end,
 void_approved_by=case when target='voided' then auth.uid() else void_approved_by end,void_reason=case when target='void_submitted' then trim(note) else void_reason end where institution_id=tenant and id=tolerance;
 insert into campus.treasury_audit(institution_id,subject_id,actor_id,action,version)values(tenant,tolerance,auth.uid(),target,expected_version+1);return expected_version+1;
end $$;
create or replace function campus.matched_amount(tenant uuid,bank_line uuid,event uuid,excluded uuid) returns numeric language sql stable security definer set search_path='' as $$
 select(select coalesce(sum(p.amount_minor),0)from campus.reconciliation_pairs p join campus.reconciliations r on r.institution_id=p.institution_id and r.id=p.reconciliation_id where p.institution_id=tenant and r.status in('approved','void_submitted','void_reviewed')and(bank_line is null or p.bank_line_id=bank_line)and(event is null or p.event_id=event)and(excluded is null or r.id<>excluded))+
 (select coalesce(sum(amount_minor),0)from campus.reconciliation_tolerances where institution_id=tenant and status in('approved','void_submitted','void_reviewed')and((bank_line is not null and event is null and bank_line_id=bank_line and side='bank')or(event is not null and event_id=event and side='source' and(bank_line is null or bank_line_id=bank_line))))
$$;
create function campus.freeze_settlement_matching() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.status='void_submitted' then
  perform 1 from campus.bank_lines where institution_id=new.institution_id and id in(select bank_line_id from campus.reconciliation_pairs where institution_id=new.institution_id and reconciliation_id=new.id)order by id for update;
  if exists(select 1 from campus.treasury_settlement_claims c join campus.reconciliation_pairs p on p.institution_id=c.institution_id and p.bank_line_id=c.bank_line_id where p.institution_id=new.institution_id and p.reconciliation_id=new.id)then raise exception 'settlement must be cancelled or reversed';end if;
  if exists(select 1 from campus.reconciliation_tolerances t join campus.reconciliation_pairs p on p.institution_id=t.institution_id and p.bank_line_id=t.bank_line_id where p.institution_id=new.institution_id and p.reconciliation_id=new.id and t.status in('approved','void_submitted','void_reviewed'))then raise exception 'void approved tolerances before matching';end if;
 end if;return new;
end $$;
create trigger freeze_settlement_matching before update of status on campus.reconciliations for each row execute function campus.freeze_settlement_matching();
revoke all on function campus.check_tolerance(uuid,uuid),campus.freeze_settlement_matching()from public,authenticated;
revoke all on function campus.propose_settlement_profile(uuid,uuid,uuid,text,uuid,date,jsonb),campus.approve_settlement_profile(uuid,uuid),campus.propose_tolerance(uuid,uuid,uuid,text,uuid,text,uuid,uuid,text),campus.transition_tolerance(uuid,uuid,integer,text,text)from public;
grant execute on function campus.propose_settlement_profile(uuid,uuid,uuid,text,uuid,date,jsonb),campus.approve_settlement_profile(uuid,uuid),campus.propose_tolerance(uuid,uuid,uuid,text,uuid,text,uuid,uuid,text),campus.transition_tolerance(uuid,uuid,integer,text,text)to authenticated;
commit;
