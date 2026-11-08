begin;
create table campus.students (
  institution_id uuid not null references campus.institutions,
  id uuid not null,
  reference text not null check(length(reference) between 1 and 80),
  name text not null check(length(trim(name)) between 1 and 200),
  primary key(institution_id,id), unique(institution_id,reference)
);
create table campus.revenue_events (
  institution_id uuid not null references campus.institutions,
  id uuid not null,
  kind text not null check(kind in ('invoice','receipt','allocation')),
  period_id uuid not null,
  document_date date not null,
  amount_minor numeric(18,0) not null check(amount_minor>0),
  status text not null default 'draft' check(status in ('draft','submitted','reviewed','approved','posted','cancelled')),
  version integer not null default 1,
  prepared_by uuid not null references auth.users(id),
  reviewed_by uuid references auth.users(id), approved_by uuid references auth.users(id),
  posting_plan jsonb,
  primary key(institution_id,id), foreign key(institution_id,period_id) references campus.periods
);
create table campus.student_invoices (
  institution_id uuid not null, id uuid not null, student_id uuid not null, academic_session text not null,
  primary key(institution_id,id), foreign key(institution_id,id) references campus.revenue_events,
  foreign key(institution_id,student_id) references campus.students
);
create table campus.student_invoice_lines (
  institution_id uuid not null, id uuid not null, invoice_id uuid not null, account_id uuid not null,
  description text not null, amount_minor numeric(18,0) not null check(amount_minor>0), due_date date not null,
  primary key(institution_id,id), foreign key(institution_id,invoice_id) references campus.student_invoices,
  foreign key(institution_id,account_id) references campus.accounts
);
create table campus.student_receipts (
  institution_id uuid not null, id uuid not null, student_id uuid, reference text not null check(length(reference) between 1 and 80),
  primary key(institution_id,id), unique(institution_id,reference), foreign key(institution_id,id) references campus.revenue_events,
  foreign key(institution_id,student_id) references campus.students
);
create table campus.student_allocations (
  institution_id uuid not null, id uuid not null, receipt_id uuid not null, invoice_line_id uuid not null,
  primary key(institution_id,id), foreign key(institution_id,id) references campus.revenue_events,
  foreign key(institution_id,receipt_id) references campus.student_receipts,
  foreign key(institution_id,invoice_line_id) references campus.student_invoice_lines
);
create table campus.revenue_audit (
  id bigint generated always as identity primary key, institution_id uuid not null, event_id uuid not null,
  actor_id uuid not null references auth.users(id), action text not null, version integer not null,
  occurred_at timestamptz not null default clock_timestamp(),
  foreign key(institution_id,event_id) references campus.revenue_events
);
create table campus.revenue_posting_authority (
  institution_id uuid not null, event_id uuid not null, transaction_id bigint not null,
  primary key(institution_id,event_id,transaction_id), foreign key(institution_id,event_id) references campus.revenue_events
);
alter table campus.revenue_posting_authority enable row level security;
revoke all on campus.revenue_posting_authority from public,authenticated;
alter table campus.students enable row level security;
alter table campus.revenue_events enable row level security;
alter table campus.student_invoices enable row level security;
alter table campus.student_invoice_lines enable row level security;
alter table campus.student_receipts enable row level security;
alter table campus.student_allocations enable row level security;
alter table campus.revenue_audit enable row level security;
create policy student_read on campus.students for select to authenticated using(campus.member_role(institution_id) in ('bursar','cashier','student_accounts','reviewer','auditor'));
create policy event_read on campus.revenue_events for select to authenticated using(campus.member_role(institution_id) in ('bursar','cashier','student_accounts','reviewer','auditor'));
create policy invoice_read on campus.student_invoices for select to authenticated using(campus.member_role(institution_id) in ('bursar','cashier','student_accounts','reviewer','auditor'));
create policy invoice_line_read on campus.student_invoice_lines for select to authenticated using(campus.member_role(institution_id) in ('bursar','cashier','student_accounts','reviewer','auditor'));
create policy receipt_read on campus.student_receipts for select to authenticated using(campus.member_role(institution_id) in ('bursar','cashier','student_accounts','reviewer','auditor'));
create policy allocation_read on campus.student_allocations for select to authenticated using(campus.member_role(institution_id) in ('bursar','cashier','student_accounts','reviewer','auditor'));
create policy revenue_audit_read on campus.revenue_audit for select to authenticated using(campus.member_role(institution_id) in ('bursar','reviewer','auditor'));
revoke all on campus.students,campus.revenue_events,campus.student_invoices,campus.student_invoice_lines,campus.student_receipts,campus.student_allocations,campus.revenue_audit from public,authenticated;
grant select on campus.students,campus.revenue_events,campus.student_invoices,campus.student_invoice_lines,campus.student_receipts,campus.student_allocations,campus.revenue_audit to authenticated;

create function campus.check_revenue_period(tenant uuid, period uuid, document_date date) returns void
language plpgsql security definer set search_path='' as $$
begin
  perform 1 from campus.periods where institution_id=tenant and id=period and not locked and document_date between starts_on and ends_on for update;
  if not found then raise exception 'open revenue period required'; end if;
end $$;
create function campus.create_student(tenant uuid, student uuid, student_reference text, student_name text) returns integer
language plpgsql security definer set search_path='' as $$
begin
  if coalesce(campus.member_role(tenant),'') not in ('bursar','student_accounts') then raise exception 'permission denied' using errcode='42501'; end if;
  insert into campus.students values(tenant,student,student_reference,student_name);
  insert into campus.administration_events(institution_id,actor_id,subject_id,action) values(tenant,auth.uid(),student,'student_created');
  return 1;
end $$;
create function campus.draft_invoice(tenant uuid, invoice uuid, student uuid, period uuid, invoice_date date, session_name text, entries jsonb) returns integer
language plpgsql security definer set search_path='' as $$
declare entry jsonb; total numeric:=0;
begin
  if coalesce(campus.member_role(tenant),'') not in ('bursar','student_accounts') then raise exception 'permission denied' using errcode='42501'; end if;
  perform campus.check_revenue_period(tenant,period,invoice_date);
  if session_name is null or length(trim(session_name)) not between 1 and 80 or jsonb_typeof(entries) is distinct from 'array' then raise exception 'invalid invoice'; end if;
  if jsonb_array_length(entries) not between 1 and 1000 then raise exception 'invalid invoice lines'; end if;
  for entry in select value from jsonb_array_elements(entries) loop
    if jsonb_typeof(entry) is distinct from 'object' then raise exception 'invalid invoice line'; end if;
    if (select count(*) from jsonb_object_keys(entry))<>5 or not(entry ?& array['id','account_id','description','amount_minor','due_date']) or
      jsonb_typeof(entry->'amount_minor') is distinct from 'string' or (entry->>'amount_minor') !~ '^[1-9][0-9]{0,17}$' or
      jsonb_typeof(entry->'description') is distinct from 'string' or length(trim(entry->>'description')) not between 1 and 200 or
      (entry->>'due_date') is null or (entry->>'due_date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or (entry->>'due_date')::date<invoice_date then raise exception 'invalid invoice line'; end if;
    total:=total+(entry->>'amount_minor')::numeric;
  end loop;
  insert into campus.revenue_events(institution_id,id,kind,period_id,document_date,amount_minor,prepared_by) values(tenant,invoice,'invoice',period,invoice_date,total,auth.uid());
  insert into campus.student_invoices values(tenant,invoice,student,session_name);
  insert into campus.student_invoice_lines select tenant,(value->>'id')::uuid,invoice,(value->>'account_id')::uuid,value->>'description',(value->>'amount_minor')::numeric,(value->>'due_date')::date from jsonb_array_elements(entries);
  insert into campus.revenue_audit(institution_id,event_id,actor_id,action,version) values(tenant,invoice,auth.uid(),'created',1);
  return 1;
end $$;
create function campus.draft_receipt(tenant uuid, receipt uuid, student uuid, period uuid, receipt_date date, payment_reference text, amount text) returns integer
language plpgsql security definer set search_path='' as $$
begin
  if coalesce(campus.member_role(tenant),'') not in ('bursar','cashier') then raise exception 'permission denied' using errcode='42501'; end if;
  perform campus.check_revenue_period(tenant,period,receipt_date);
  if amount is null or amount !~ '^[1-9][0-9]{0,17}$' then raise exception 'invalid receipt amount'; end if;
  insert into campus.revenue_events(institution_id,id,kind,period_id,document_date,amount_minor,prepared_by) values(tenant,receipt,'receipt',period,receipt_date,amount::numeric,auth.uid());
  insert into campus.student_receipts values(tenant,receipt,student,payment_reference);
  insert into campus.revenue_audit(institution_id,event_id,actor_id,action,version) values(tenant,receipt,auth.uid(),'created',1);
  return 1;
end $$;
create function campus.check_allocation(tenant uuid, receipt uuid, invoice_line uuid, allocation_date date, amount numeric, excluded uuid) returns void
language plpgsql security definer set search_path='' as $$
declare payment campus.revenue_events; bill campus.revenue_events; receipt_student uuid; invoice_student uuid; line_amount numeric; receipt_used numeric; line_used numeric;
begin
  select e.* into payment from campus.revenue_events e join campus.student_receipts r on r.institution_id=e.institution_id and r.id=e.id where e.institution_id=tenant and e.id=receipt for update of e;
  if not found then raise exception 'receipt unavailable'; end if;
  select e.* into bill from campus.revenue_events e join campus.student_invoice_lines l on l.institution_id=e.institution_id and l.invoice_id=e.id where l.institution_id=tenant and l.id=invoice_line for update of e;
  if not found then raise exception 'invoice line unavailable'; end if;
  if payment.status<>'posted' or bill.status<>'posted' or allocation_date<payment.document_date or allocation_date<bill.document_date then raise exception 'posted dated sources required'; end if;
  select student_id into receipt_student from campus.student_receipts where institution_id=tenant and id=receipt;
  select i.student_id,l.amount_minor into invoice_student,line_amount from campus.student_invoice_lines l join campus.student_invoices i on i.institution_id=l.institution_id and i.id=l.invoice_id where l.institution_id=tenant and l.id=invoice_line;
  if receipt_student is not null and receipt_student<>invoice_student then raise exception 'student mismatch'; end if;
  select coalesce(sum(e.amount_minor) filter(where a.receipt_id=receipt),0),coalesce(sum(e.amount_minor) filter(where a.invoice_line_id=invoice_line),0) into receipt_used,line_used
    from campus.student_allocations a join campus.revenue_events e on e.institution_id=a.institution_id and e.id=a.id where a.institution_id=tenant and e.status in ('approved','posted') and (excluded is null or e.id<>excluded);
  if amount<=0 or receipt_used+amount>payment.amount_minor or line_used+amount>line_amount then raise exception 'allocation exceeds available balance'; end if;
end $$;
create function campus.draft_allocation(tenant uuid, allocation uuid, receipt uuid, invoice_line uuid, period uuid, allocation_date date, amount text) returns integer
language plpgsql security definer set search_path='' as $$
begin
  if coalesce(campus.member_role(tenant),'') not in ('bursar','cashier','student_accounts') then raise exception 'permission denied' using errcode='42501'; end if;
  perform campus.check_revenue_period(tenant,period,allocation_date);
  if amount is null or amount !~ '^[1-9][0-9]{0,17}$' then raise exception 'invalid allocation amount'; end if;
  perform campus.check_allocation(tenant,receipt,invoice_line,allocation_date,amount::numeric,null);
  insert into campus.revenue_events(institution_id,id,kind,period_id,document_date,amount_minor,prepared_by) values(tenant,allocation,'allocation',period,allocation_date,amount::numeric,auth.uid());
  insert into campus.student_allocations values(tenant,allocation,receipt,invoice_line);
  insert into campus.revenue_audit(institution_id,event_id,actor_id,action,version) values(tenant,allocation,auth.uid(),'created',1);
  return 1;
end $$;

create function campus.submit_revenue(tenant uuid, event uuid, expected_version integer, plans jsonb) returns integer
language plpgsql security definer set search_path='' as $$
declare source campus.revenue_events; plan jsonb; entry jsonb; debits numeric; credits numeric;
begin
  if coalesce(campus.member_role(tenant),'') not in ('bursar','cashier','student_accounts') then raise exception 'permission denied' using errcode='42501'; end if;
  select * into source from campus.revenue_events where institution_id=tenant and id=event for update;
  if not found or source.prepared_by<>auth.uid() then raise exception 'permission denied' using errcode='42501'; end if;
  if (source.kind='invoice' and campus.member_role(tenant) not in ('bursar','student_accounts')) or
    (source.kind='receipt' and campus.member_role(tenant) not in ('bursar','cashier')) then raise exception 'permission denied' using errcode='42501'; end if;
  if expected_version is null or source.version<>expected_version then raise exception 'version conflict' using errcode='40001'; end if;
  if source.status<>'draft' then raise exception 'draft required'; end if;
  perform campus.check_revenue_period(tenant,source.period_id,source.document_date);
  if jsonb_typeof(plans) is distinct from 'array' then raise exception 'two explicit accounting plans required'; end if;
  if jsonb_array_length(plans)<>2 or (select count(distinct value->>'basis') from jsonb_array_elements(plans) where value->>'basis' in ('cash','accrual'))<>2 then raise exception 'two explicit accounting plans required'; end if;
  for plan in select value from jsonb_array_elements(plans) loop
    if jsonb_typeof(plan) is distinct from 'object' then raise exception 'invalid accounting plan'; end if;
    if (select count(*) from jsonb_object_keys(plan))<>4 or not(plan ?& array['basis','policy_id','lines','nonrecognition_reason']) or jsonb_typeof(plan->'lines') is distinct from 'array' or jsonb_typeof(plan->'nonrecognition_reason') is distinct from 'string' then raise exception 'invalid accounting plan'; end if;
    if not exists(select 1 from campus.policies where institution_id=tenant and id=(plan->>'policy_id')::uuid and basis=plan->>'basis' and effective_from<=source.document_date) then raise exception 'approved effective policy required'; end if;
    if not exists(select 1 from campus.policy_mappings where institution_id=tenant and policy_id=(plan->>'policy_id')::uuid and basis=plan->>'basis') then raise exception 'mapped policy required'; end if;
    if jsonb_array_length(plan->'lines')=0 then
      if length(trim(plan->>'nonrecognition_reason')) not between 1 and 500 then raise exception 'non-recognition explanation required'; end if;
    else
      if jsonb_array_length(plan->'lines') not between 2 and 1000 or plan->>'nonrecognition_reason'<>'' then raise exception 'invalid journal plan'; end if;
      debits:=0; credits:=0;
      for entry in select value from jsonb_array_elements(plan->'lines') loop
        if jsonb_typeof(entry) is distinct from 'object' then raise exception 'invalid planned line'; end if;
        if (select count(*) from jsonb_object_keys(entry))<>3 or not(entry ?& array['account_id','debit_minor','credit_minor']) or
          jsonb_typeof(entry->'debit_minor') is distinct from 'string' or jsonb_typeof(entry->'credit_minor') is distinct from 'string' or
          (entry->>'debit_minor') !~ '^(0|[1-9][0-9]{0,17})$' or (entry->>'credit_minor') !~ '^(0|[1-9][0-9]{0,17})$' then raise exception 'invalid planned line'; end if;
        if not exists(select 1 from campus.policy_mappings where institution_id=tenant and policy_id=(plan->>'policy_id')::uuid and basis=plan->>'basis' and account_id=(entry->>'account_id')::uuid) then raise exception 'unmapped planned account'; end if;
        if not (((entry->>'debit_minor')::numeric>0 and (entry->>'credit_minor')::numeric=0) or ((entry->>'credit_minor')::numeric>0 and (entry->>'debit_minor')::numeric=0)) then raise exception 'invalid planned line'; end if;
        debits:=debits+(entry->>'debit_minor')::numeric; credits:=credits+(entry->>'credit_minor')::numeric;
      end loop;
      if debits<>source.amount_minor or credits<>source.amount_minor then raise exception 'planned journal must balance to source amount'; end if;
    end if;
  end loop;
  update campus.revenue_events set posting_plan=plans,status='submitted',version=version+1 where institution_id=tenant and id=event;
  insert into campus.revenue_audit(institution_id,event_id,actor_id,action,version) values(tenant,event,auth.uid(),'submitted',expected_version+1);
  return expected_version+1;
end $$;

create function campus.transition_revenue(tenant uuid, event uuid, expected_version integer, target text) returns integer
language plpgsql security definer set search_path='' as $$
declare source campus.revenue_events; caller text; plan jsonb; allocation campus.student_allocations; journal uuid;
begin
  caller:=campus.member_role(tenant);
  if coalesce(caller,'') not in ('bursar','cashier','student_accounts','reviewer') then raise exception 'permission denied' using errcode='42501'; end if;
  select * into source from campus.revenue_events where institution_id=tenant and id=event for update;
  if not found then raise exception 'source unavailable'; end if;
  if expected_version is null or source.version<>expected_version then raise exception 'version conflict' using errcode='40001'; end if;
  if target='cancelled' then
    if source.status='posted' or source.status='cancelled' then raise exception 'posted corrections require reversal'; end if;
    if caller<>'bursar' and (source.prepared_by<>auth.uid() or source.status<>'draft') then raise exception 'permission denied' using errcode='42501'; end if;
  else
    perform campus.check_revenue_period(tenant,source.period_id,source.document_date);
    if not ((source.status='submitted' and target='reviewed') or (source.status='reviewed' and target='approved') or (source.status='approved' and target='posted')) then raise exception 'invalid transition'; end if;
    if target='reviewed' and (caller not in ('reviewer','bursar') or auth.uid()=source.prepared_by) then raise exception 'independent reviewer required' using errcode='42501'; end if;
    if target='approved' and (caller<>'bursar' or auth.uid()=source.prepared_by) then raise exception 'independent approver required' using errcode='42501'; end if;
    if target='posted' and caller<>'bursar' then raise exception 'permission denied' using errcode='42501'; end if;
    if source.kind='allocation' and target in ('approved','posted') then
      select * into allocation from campus.student_allocations where institution_id=tenant and id=event;
      perform campus.check_allocation(tenant,allocation.receipt_id,allocation.invoice_line_id,source.document_date,source.amount_minor,event);
    end if;
    if target='posted' then
      insert into campus.revenue_posting_authority values(tenant,event,txid_current());
      for plan in select value from jsonb_array_elements(source.posting_plan) loop
        if jsonb_array_length(plan->'lines')>0 then
          journal:=gen_random_uuid();
          perform campus.create_journal(tenant,journal,plan->>'basis',(plan->>'policy_id')::uuid,source.period_id,event,source.document_date,plan->'lines');
          update campus.journals set status='posted',version=2,prepared_by=source.prepared_by,reviewed_by=source.reviewed_by,approved_by=source.approved_by where institution_id=tenant and id=journal;
          insert into campus.audit_events(institution_id,actor_id,journal_id,action,version) values(tenant,auth.uid(),journal,'approved_source_posted',2);
        end if;
      end loop;
      delete from campus.revenue_posting_authority where institution_id=tenant and event_id=event and transaction_id=txid_current();
    end if;
  end if;
  update campus.revenue_events set status=target,version=version+1,
    reviewed_by=case when target='reviewed' then auth.uid() else reviewed_by end,approved_by=case when target='approved' then auth.uid() else approved_by end where institution_id=tenant and id=event;
  insert into campus.revenue_audit(institution_id,event_id,actor_id,action,version) values(tenant,event,auth.uid(),target,expected_version+1);
  return expected_version+1;
end $$;

create function campus.revenue_schedule(tenant uuid) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare billed numeric; receipts numeric; allocated numeric;
begin
  if coalesce(campus.member_role(tenant),'') not in ('bursar','cashier','student_accounts','reviewer','auditor') then raise exception 'permission denied' using errcode='42501'; end if;
  select coalesce(sum(amount_minor) filter(where kind='invoice'),0),coalesce(sum(amount_minor) filter(where kind='receipt'),0),coalesce(sum(amount_minor) filter(where kind='allocation'),0) into billed,receipts,allocated from campus.revenue_events where institution_id=tenant and status='posted';
  return jsonb_build_object('totals',jsonb_build_object('billed_minor',billed::text,'receipts_minor',receipts::text,'allocated_minor',allocated::text,'receivable_minor',(billed-allocated)::text,'unapplied_minor',(receipts-allocated)::text),
    'events',(select coalesce(jsonb_agg(to_jsonb(e)),'[]'::jsonb) from(select id,kind,document_date,amount_minor::text,status,version,prepared_by,reviewed_by,approved_by,posting_plan,
      case kind when 'invoice' then(select jsonb_build_object('student_id',i.student_id,'academic_session',i.academic_session,'lines',(select jsonb_agg(jsonb_build_object('id',l.id,'account_id',l.account_id,'description',l.description,'amount_minor',l.amount_minor::text,'due_date',l.due_date) order by l.id) from campus.student_invoice_lines l where l.institution_id=i.institution_id and l.invoice_id=i.id)) from campus.student_invoices i where i.institution_id=tenant and i.id=r.id)
        when 'receipt' then(select jsonb_build_object('student_id',student_id,'reference',reference) from campus.student_receipts where institution_id=tenant and id=r.id)
        else(select jsonb_build_object('receipt_id',receipt_id,'invoice_line_id',invoice_line_id) from campus.student_allocations where institution_id=tenant and id=r.id) end as details
      from campus.revenue_events r where institution_id=tenant order by document_date desc,id limit 100)e),
    'students',(select coalesce(jsonb_agg(to_jsonb(s)),'[]'::jsonb) from(select id,reference,name from campus.students where institution_id=tenant order by reference limit 100)s));
end $$;
create function campus.guard_revenue_period_close() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.locked and not old.locked and exists(select 1 from campus.revenue_events where institution_id=new.institution_id and period_id=new.id and status not in ('posted','cancelled')) then raise exception 'unposted revenue sources remain'; end if;
  return new;
end $$;
create trigger revenue_period_close before update of locked on campus.periods for each row execute function campus.guard_revenue_period_close();
create function campus.guard_source_journal() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.reversal_of is not null and exists(select 1 from campus.journals j join campus.revenue_events e on e.institution_id=j.institution_id and e.id=j.source_id where j.institution_id=new.institution_id and j.id=new.reversal_of) then
    raise exception 'source-linked journal requires source correction';
  end if;
  if exists(select 1 from campus.revenue_events where institution_id=new.institution_id and id=new.source_id) and
    not exists(select 1 from campus.revenue_posting_authority where institution_id=new.institution_id and event_id=new.source_id and transaction_id=txid_current()) then
    raise exception 'source journal requires controlled posting' using errcode='42501';
  end if;
  return new;
end $$;
create trigger controlled_source_journal before insert or update of status,reversal_of on campus.journals for each row execute function campus.guard_source_journal();
revoke all on function campus.guard_source_journal() from public,authenticated;
revoke all on function campus.check_revenue_period(uuid,uuid,date),campus.check_allocation(uuid,uuid,uuid,date,numeric,uuid),campus.guard_revenue_period_close() from public,authenticated;
revoke all on function campus.create_student(uuid,uuid,text,text),campus.draft_invoice(uuid,uuid,uuid,uuid,date,text,jsonb),campus.draft_receipt(uuid,uuid,uuid,uuid,date,text,text),campus.draft_allocation(uuid,uuid,uuid,uuid,uuid,date,text),campus.submit_revenue(uuid,uuid,integer,jsonb),campus.transition_revenue(uuid,uuid,integer,text),campus.revenue_schedule(uuid) from public;
grant execute on function campus.create_student(uuid,uuid,text,text),campus.draft_invoice(uuid,uuid,uuid,uuid,date,text,jsonb),campus.draft_receipt(uuid,uuid,uuid,uuid,date,text,text),campus.draft_allocation(uuid,uuid,uuid,uuid,uuid,date,text),campus.submit_revenue(uuid,uuid,integer,jsonb),campus.transition_revenue(uuid,uuid,integer,text),campus.revenue_schedule(uuid) to authenticated;
commit;
