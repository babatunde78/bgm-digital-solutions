begin;
create table campus.budget_funds(
 institution_id uuid not null references campus.institutions,id uuid not null,name text not null check(length(trim(name)) between 1 and 200),restricted boolean not null,
 primary key(institution_id,id)
);
create table campus.budget_lines(
 institution_id uuid not null,id uuid not null,account_id uuid not null,period_id uuid not null,fund_id uuid not null,basis text not null check(basis in('cash','accrual')),
 primary key(institution_id,id),unique(institution_id,account_id,period_id,fund_id),
 foreign key(institution_id,account_id) references campus.accounts,foreign key(institution_id,period_id) references campus.periods,foreign key(institution_id,fund_id) references campus.budget_funds
);
create table campus.budget_events(
 institution_id uuid not null,id uuid not null,budget_id uuid not null,kind text not null check(kind in('budget','revision','commitment','actual','actual_release','commitment_release')),
 document_date date not null,amount_minor numeric(18,0) not null check(amount_minor>0),details jsonb not null,
 original_id uuid,journal_id uuid,line_no integer,commitment_id uuid,
 status text not null default 'draft' check(status in('draft','submitted','reviewed','approved','posted','cancelled')),version integer not null default 1,
 prepared_by uuid not null references auth.users(id),reviewed_by uuid references auth.users(id),approved_by uuid references auth.users(id),
 primary key(institution_id,id),foreign key(institution_id,budget_id) references campus.budget_lines,
 foreign key(institution_id,original_id) references campus.budget_events,foreign key(institution_id,commitment_id) references campus.budget_events,
 foreign key(institution_id,journal_id,line_no) references campus.journal_lines,
 check((kind='actual' and journal_id is not null and line_no is not null and original_id is null)or(kind in('actual_release','commitment_release') and original_id is not null and journal_id is null and line_no is null and commitment_id is null)or(kind in('budget','commitment','revision') and original_id is null and journal_id is null and line_no is null and commitment_id is null))
);
create index budget_event_line on campus.budget_events(institution_id,budget_id,status);
create index budget_event_journal on campus.budget_events(institution_id,journal_id,line_no);
create index budget_event_original on campus.budget_events(institution_id,original_id);
alter table campus.budget_funds enable row level security;
alter table campus.budget_lines enable row level security;
alter table campus.budget_events enable row level security;
create policy budget_fund_read on campus.budget_funds for select to authenticated using(campus.member_role(institution_id) is not null);
create policy budget_line_read on campus.budget_lines for select to authenticated using(campus.member_role(institution_id) in('bursar','budget_officer','payables_officer','reviewer','auditor'));
create policy budget_event_read on campus.budget_events for select to authenticated using(campus.member_role(institution_id) in('bursar','budget_officer','payables_officer','reviewer','auditor'));
revoke all on campus.budget_funds,campus.budget_lines,campus.budget_events from public,authenticated;
grant select on campus.budget_funds,campus.budget_lines,campus.budget_events to authenticated;

create function campus.create_budget_fund(tenant uuid,fund uuid,fund_name text,is_restricted boolean) returns integer language plpgsql security definer set search_path='' as $$
begin
 if campus.member_role(tenant) is distinct from 'institution_administrator' then raise exception 'permission denied' using errcode='42501';end if;
 insert into campus.budget_funds values(tenant,fund,fund_name,is_restricted);
 insert into campus.administration_events(institution_id,actor_id,subject_id,action)values(tenant,auth.uid(),fund,'budget_fund_created');return 1;
end $$;
create function campus.create_budget_line(tenant uuid,budget uuid,account uuid,period uuid,fund uuid,accounting_basis text) returns integer language plpgsql security definer set search_path='' as $$
begin
 if coalesce(campus.member_role(tenant),'') not in('bursar','budget_officer') then raise exception 'permission denied' using errcode='42501';end if;
 perform 1 from campus.periods where institution_id=tenant and id=period and not locked for update;
 if not found then raise exception 'open revenue period required';end if;
 if not exists(select 1 from campus.accounts where institution_id=tenant and id=account and account_type='expense') then raise exception 'expense account required for this budget release';end if;
 insert into campus.budget_lines values(tenant,budget,account,period,fund,accounting_basis);
 insert into campus.administration_events(institution_id,actor_id,subject_id,action)values(tenant,auth.uid(),budget,'budget_line_created');return 1;
end $$;

create function campus.budget_net(tenant uuid,event uuid,as_of date,excluded uuid default null) returns numeric language sql stable security definer set search_path='' as $$
 select e.amount_minor-coalesce((select sum(r.amount_minor) from campus.budget_events r where r.institution_id=tenant and r.original_id=e.id and r.kind in('actual_release','commitment_release') and r.status='posted' and r.document_date<=as_of and r.id is distinct from excluded),0)
 from campus.budget_events e where e.institution_id=tenant and e.id=event
$$;
create function campus.budget_position(tenant uuid,budget uuid,as_of date,excluded uuid default null) returns jsonb language sql stable security definer set search_path='' as $$
 with e as(select * from campus.budget_events where institution_id=tenant and budget_id=budget and id is distinct from excluded),
 amounts as(select
 coalesce(sum(case when kind='budget' or details->>'direction'='increase' then amount_minor else -amount_minor end)filter(where kind in('budget','revision') and status='posted' and document_date<=as_of),0) authorised,
 coalesce(sum(campus.budget_net(tenant,id,as_of,excluded))filter(where kind='actual' and status in('approved','posted')),0) actual,
 coalesce(sum(campus.budget_net(tenant,id,as_of,excluded))filter(where kind='actual' and status='posted' and document_date<=as_of),0) posted,
 coalesce(sum(campus.budget_net(tenant,id,as_of,excluded))filter(where kind='commitment' and status in('approved','posted')),0)-
 coalesce(sum(campus.budget_net(tenant,id,as_of,excluded))filter(where kind='actual' and status in('approved','posted') and commitment_id is not null),0) commitment from e)
 select jsonb_build_object('authorised_minor',authorised::text,'posted_actual_minor',posted::text,'reserved_actual_minor',(actual-posted)::text,'open_commitment_minor',commitment::text,'available_minor',(authorised-actual-commitment)::text) from amounts
$$;
create function campus.budget_unattributed(tenant uuid,period uuid,accounting_basis text,as_of date) returns jsonb language sql stable security definer set search_path='' as $$
 select coalesce(jsonb_agg(jsonb_build_object('journal_id',s.journal_id,'line_no',s.line_no,'account_id',s.account_id,'unattributed_minor',s.remaining::text) order by s.journal_id,s.line_no),'[]'::jsonb) from(
 select l.journal_id,l.line_no,l.account_id,l.debit_minor-coalesce((select sum(campus.budget_net(tenant,e.id,as_of)) from campus.budget_events e where e.institution_id=tenant and e.journal_id=l.journal_id and e.line_no=l.line_no and e.kind='actual' and e.status in('approved','posted') and e.document_date<=as_of),0) remaining
 from campus.journal_lines l join campus.journals j on j.institution_id=l.institution_id and j.id=l.journal_id
 where l.institution_id=tenant and j.period_id=period and j.basis=accounting_basis and j.status='posted' and j.posted_on<=as_of and l.debit_minor>0 and j.reversal_of is null
 and exists(select 1 from campus.budget_lines b where b.institution_id=tenant and b.period_id=period and b.basis=accounting_basis and b.account_id=l.account_id)
 and not exists(select 1 from campus.journals r where r.institution_id=tenant and r.reversal_of=j.id and r.status='posted' and r.posted_on<=as_of)
 )s where s.remaining>0
$$;
create function campus.check_budget_event(tenant uuid,event uuid) returns void language plpgsql security definer set search_path='' as $$
declare e campus.budget_events;b campus.budget_lines;o campus.budget_events;j campus.journals;debit numeric;used numeric;remaining numeric;position jsonb;
begin
 select * into e from campus.budget_events where institution_id=tenant and id=event;
 select * into b from campus.budget_lines where institution_id=tenant and id=e.budget_id for update;
 position:=campus.budget_position(tenant,b.id,e.document_date,e.id);
 if e.kind='budget' then
  if exists(select 1 from campus.budget_events where institution_id=tenant and budget_id=b.id and kind='budget' and status in('approved','posted') and id<>e.id) then raise exception 'budget already authorised';end if;
 elsif e.kind='revision' then
  if e.details->>'direction' not in('increase','decrease') then raise exception 'revision direction required';end if;
  if e.details->>'direction'='decrease' and e.amount_minor>(position->>'available_minor')::numeric then raise exception 'revision would exceed available budget';end if;
 elsif e.kind='commitment' then
  if exists(select 1 from jsonb_array_elements(campus.budget_unattributed(tenant,b.period_id,b.basis,e.document_date)) x where (x->>'account_id')::uuid=b.account_id) then raise exception 'unattributed expenditure requires review';end if;
  if e.amount_minor>(position->>'available_minor')::numeric then raise exception 'budget availability exceeded';end if;
 elsif e.kind='actual' then
  select * into j from campus.journals where institution_id=tenant and id=e.journal_id for update;
  select debit_minor into debit from campus.journal_lines where institution_id=tenant and journal_id=e.journal_id and line_no=e.line_no and account_id=b.account_id;
  if j.status is distinct from 'posted' or j.period_id<>b.period_id or j.basis<>b.basis or j.posted_on>e.document_date or j.reversal_of is not null or coalesce(debit,0)<=0 or exists(select 1 from campus.journals where institution_id=tenant and reversal_of=j.id) then raise exception 'eligible posted expense debit required';end if;
  select coalesce(sum(campus.budget_net(tenant,id,e.document_date)),0) into used from campus.budget_events where institution_id=tenant and journal_id=e.journal_id and line_no=e.line_no and kind='actual' and status in('approved','posted') and id<>e.id;
  if used+e.amount_minor>debit then raise exception 'journal debit already attributed';end if;
  if e.commitment_id is not null then
   select * into o from campus.budget_events where institution_id=tenant and id=e.commitment_id and budget_id=b.id and kind='commitment' and status='posted' and document_date<=e.document_date;
   if not found then raise exception 'posted commitment required';end if;
   select coalesce(sum(amount_minor),0) into used from campus.budget_events where institution_id=tenant and original_id=o.id and status in('approved','posted');
   select o.amount_minor-used-coalesce(sum(campus.budget_net(tenant,id,e.document_date)),0) into remaining from campus.budget_events where institution_id=tenant and commitment_id=o.id and kind='actual' and status in('approved','posted') and id<>e.id;
   if e.amount_minor>remaining then raise exception 'commitment availability exceeded';end if;
  elsif e.amount_minor>(position->>'available_minor')::numeric then raise exception 'budget availability exceeded';end if;
 else
  select * into o from campus.budget_events where institution_id=tenant and id=e.original_id and budget_id=b.id and status='posted' and document_date<=e.document_date and kind=case e.kind when 'actual_release' then 'actual' else 'commitment' end;
  if not found then raise exception 'eligible posted original required';end if;
  select coalesce(sum(amount_minor),0) into used from campus.budget_events where institution_id=tenant and original_id=o.id and status in('approved','posted') and id<>e.id;
  remaining:=o.amount_minor-used;
  if e.kind='commitment_release' then
   select remaining-coalesce(sum(campus.budget_net(tenant,id,e.document_date)),0) into remaining from campus.budget_events where institution_id=tenant and commitment_id=o.id and kind='actual' and status in('approved','posted');
  end if;
  if e.amount_minor>remaining then raise exception 'release availability exceeded';end if;
 end if;
end $$;
create function campus.draft_budget_event(tenant uuid,event uuid,budget uuid,event_kind text,event_date date,amount text,event_details jsonb) returns integer language plpgsql security definer set search_path='' as $$
declare b campus.budget_lines;role_name text;
begin
 role_name:=coalesce(campus.member_role(tenant),'');
 if role_name<>'bursar' and not(role_name='budget_officer' and event_kind in('budget','revision','commitment','commitment_release')) and not(role_name='payables_officer' and event_kind in('actual','actual_release')) then raise exception 'permission denied' using errcode='42501';end if;
 select * into b from campus.budget_lines where institution_id=tenant and id=budget;
 if not found then raise exception 'budget unavailable';end if;
 perform campus.check_revenue_period(tenant,b.period_id,event_date);
 if amount is null or amount !~ '^[1-9][0-9]{0,17}$' or jsonb_typeof(event_details) is distinct from 'object' then raise exception 'positive integer amount and details required';end if;
 if event_kind in('actual_release','commitment_release') then
  if(select count(*) from jsonb_object_keys(event_details))<>2 or not(event_details ?& array['original_id','reason']) or jsonb_typeof(event_details->'reason') is distinct from 'string' or length(trim(event_details->>'reason')) not between 1 and 500 then raise exception 'original and release reason required';end if;
 elsif event_kind='actual' then
  if(select count(*) from jsonb_object_keys(event_details))<>4 or not(event_details ?& array['journal_id','line_no','commitment_id','description']) or jsonb_typeof(event_details->'line_no') is distinct from 'number' or (event_details->>'line_no') !~ '^[1-9][0-9]{0,8}$' then raise exception 'journal line and commitment selection required';end if;
 elsif event_kind='revision' then
  if(select count(*) from jsonb_object_keys(event_details))<>2 or not(event_details ?& array['description','direction']) or event_details->>'direction' not in('increase','decrease') then raise exception 'revision direction and description required';end if;
 elsif event_kind in('budget','commitment') then
  if(select count(*) from jsonb_object_keys(event_details))<>1 or not(event_details ? 'description') then raise exception 'description required';end if;
 else raise exception 'unsupported budget event';end if;
 if event_kind in('budget','revision','commitment','actual') and(jsonb_typeof(event_details->'description') is distinct from 'string' or length(trim(event_details->>'description')) not between 1 and 500) then raise exception 'description required';end if;
 insert into campus.budget_events(institution_id,id,budget_id,kind,document_date,amount_minor,details,original_id,journal_id,line_no,commitment_id,prepared_by)
 values(tenant,event,budget,event_kind,event_date,amount::numeric,event_details,(event_details->>'original_id')::uuid,(event_details->>'journal_id')::uuid,(event_details->>'line_no')::integer,(event_details->>'commitment_id')::uuid,auth.uid());
 perform campus.check_budget_event(tenant,event);
 insert into campus.administration_events(institution_id,actor_id,subject_id,action)values(tenant,auth.uid(),event,'budget_'||event_kind||'_drafted');return 1;
end $$;
create function campus.transition_budget_event(tenant uuid,event uuid,expected_version integer,target text) returns integer language plpgsql security definer set search_path='' as $$
declare e campus.budget_events;b campus.budget_lines;role_name text;
begin
 role_name:=coalesce(campus.member_role(tenant),'');
 if role_name not in('bursar','budget_officer','payables_officer','reviewer') then raise exception 'permission denied' using errcode='42501';end if;
 select b1.* into b from campus.budget_lines b1 join campus.budget_events e1 on e1.institution_id=b1.institution_id and e1.budget_id=b1.id where e1.institution_id=tenant and e1.id=event;
 if not found then raise exception 'budget event unavailable';end if;
 perform 1 from campus.periods where institution_id=tenant and id=b.period_id for update;
 select * into e from campus.budget_events where institution_id=tenant and id=event for update;
 if expected_version is null or e.version<>expected_version then raise exception 'version conflict' using errcode='40001';end if;
 perform campus.check_revenue_period(tenant,b.period_id,e.document_date);
 if target='cancelled' and e.status in('draft','submitted','reviewed','approved') then
  if e.prepared_by<>auth.uid() and role_name<>'bursar' then raise exception 'permission denied' using errcode='42501';end if;
 elsif target='submitted' and e.status='draft' then
  if e.prepared_by<>auth.uid() then raise exception 'preparer submission required' using errcode='42501';end if;
 elsif target='reviewed' and e.status='submitted' then
  if role_name not in('bursar','reviewer') or e.prepared_by=auth.uid() then raise exception 'independent reviewer required' using errcode='42501';end if;
 elsif target='approved' and e.status='reviewed' then
  if role_name<>'bursar' or e.prepared_by=auth.uid() then raise exception 'independent approver required' using errcode='42501';end if;
 elsif target='posted' and e.status='approved' then
  if role_name<>'bursar' or e.prepared_by=auth.uid() then raise exception 'independent approver required' using errcode='42501';end if;
 else raise exception 'invalid budget transition';end if;
 if target<>'cancelled' then perform campus.check_budget_event(tenant,event);end if;
 update campus.budget_events set status=target,version=version+1,reviewed_by=case when target='reviewed' then auth.uid() else reviewed_by end,approved_by=case when target='approved' then auth.uid() else approved_by end where institution_id=tenant and id=event;
 insert into campus.administration_events(institution_id,actor_id,subject_id,action)values(tenant,auth.uid(),event,'budget_'||target);return expected_version+1;
end $$;
create function campus.budget_schedule(tenant uuid,period uuid,accounting_basis text,as_of date) returns jsonb language plpgsql stable security definer set search_path='' as $$
begin
 if coalesce(campus.member_role(tenant),'') not in('bursar','budget_officer','payables_officer','reviewer','auditor') then raise exception 'permission denied' using errcode='42501';end if;
 if accounting_basis is null or accounting_basis not in('cash','accrual') or not exists(select 1 from campus.periods where institution_id=tenant and id=period and as_of between starts_on and ends_on) then raise exception 'explicit period, basis and in-period date required';end if;
 return jsonb_build_object('period_id',period,'basis',accounting_basis,'as_of',as_of,'refreshed_at',clock_timestamp(),
 'lines',(select coalesce(jsonb_agg(to_jsonb(s) order by s.id),'[]'::jsonb) from(select b.*,f.name fund_name,f.restricted,campus.budget_position(tenant,b.id,as_of) position from campus.budget_lines b join campus.budget_funds f on f.institution_id=b.institution_id and f.id=b.fund_id where b.institution_id=tenant and b.period_id=period and b.basis=accounting_basis)s),
 'events',(select coalesce(jsonb_agg(to_jsonb(s) order by s.document_date,s.id),'[]'::jsonb) from(select e.institution_id,e.id,e.budget_id,e.kind,e.document_date,e.amount_minor::text,e.details,e.original_id,e.journal_id,e.line_no,e.commitment_id,e.status,e.version,e.prepared_by,e.reviewed_by,e.approved_by from campus.budget_events e join campus.budget_lines b on b.institution_id=e.institution_id and b.id=e.budget_id where e.institution_id=tenant and b.period_id=period and b.basis=accounting_basis)s),
 'unattributed_lines',campus.budget_unattributed(tenant,period,accounting_basis,as_of));
end $$;
create function campus.budget_fund_schedule(tenant uuid)returns jsonb language plpgsql stable security invoker set search_path='' as $$
begin
 if campus.member_role(tenant) is null then raise exception 'permission denied' using errcode='42501';end if;
 return(select coalesce(jsonb_agg(to_jsonb(f) order by f.name,f.id),'[]'::jsonb)from campus.budget_funds f where institution_id=tenant);
end $$;
create function campus.guard_budget_reversal() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.reversal_of is not null then
  perform 1 from campus.journals where institution_id=new.institution_id and id=new.reversal_of for update;
  if exists(select 1 from campus.budget_events e where e.institution_id=new.institution_id and e.journal_id=new.reversal_of and e.kind='actual' and e.status in('approved','posted') and campus.budget_net(new.institution_id,e.id,new.posted_on)>0) then raise exception 'release budget actuals before journal reversal';end if;
 end if;return new;
end $$;
create trigger budget_journal_reversal before insert or update of reversal_of on campus.journals for each row execute function campus.guard_budget_reversal();
create function campus.guard_budget_close() returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.locked and not old.locked then
  if exists(select 1 from campus.budget_events e join campus.budget_lines b on b.institution_id=e.institution_id and b.id=e.budget_id where e.institution_id=new.institution_id and b.period_id=new.id and e.status not in('posted','cancelled')) then raise exception 'unfinished budget events remain';end if;
  if exists(select 1 from campus.budget_lines b where b.institution_id=new.institution_id and b.period_id=new.id and (campus.budget_position(new.institution_id,b.id,new.ends_on)->>'open_commitment_minor')::numeric<>0) then raise exception 'open commitments require retirement before close';end if;
  if campus.budget_unattributed(new.institution_id,new.id,'cash',new.ends_on)<>'[]'::jsonb or campus.budget_unattributed(new.institution_id,new.id,'accrual',new.ends_on)<>'[]'::jsonb then raise exception 'unattributed expenditure requires review';end if;
 end if;return new;
end $$;
create trigger budget_period_close before update of locked on campus.periods for each row execute function campus.guard_budget_close();
revoke all on function campus.budget_net(uuid,uuid,date,uuid),campus.budget_position(uuid,uuid,date,uuid),campus.budget_unattributed(uuid,uuid,text,date),campus.check_budget_event(uuid,uuid),campus.guard_budget_reversal(),campus.guard_budget_close() from public,authenticated;
revoke all on function campus.create_budget_fund(uuid,uuid,text,boolean),campus.create_budget_line(uuid,uuid,uuid,uuid,uuid,text),campus.draft_budget_event(uuid,uuid,uuid,text,date,text,jsonb),campus.transition_budget_event(uuid,uuid,integer,text),campus.budget_schedule(uuid,uuid,text,date),campus.budget_fund_schedule(uuid) from public;
grant execute on function campus.create_budget_fund(uuid,uuid,text,boolean),campus.create_budget_line(uuid,uuid,uuid,uuid,uuid,text),campus.draft_budget_event(uuid,uuid,uuid,text,date,text,jsonb),campus.transition_budget_event(uuid,uuid,integer,text),campus.budget_schedule(uuid,uuid,text,date),campus.budget_fund_schedule(uuid) to authenticated;
commit;
