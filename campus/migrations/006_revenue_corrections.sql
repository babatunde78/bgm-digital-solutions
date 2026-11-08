begin;
alter table campus.revenue_events drop constraint revenue_events_kind_check;
alter table campus.revenue_events add check(kind in ('invoice','receipt','allocation','credit','refund','allocation_release','chargeback','invoice_reversal','receipt_reversal'));
alter table campus.revenue_rules drop constraint revenue_rules_event_kind_check;
alter table campus.revenue_rules add check(event_kind in ('invoice','receipt','allocation','credit','refund','allocation_release','chargeback'));

create table campus.student_credits (
  institution_id uuid not null,id uuid not null,original_id uuid not null,reason text not null,
  primary key(institution_id,id),foreign key(institution_id,id) references campus.revenue_events,
  foreign key(institution_id,original_id) references campus.student_invoice_lines
);
create table campus.student_refunds (
  institution_id uuid not null,id uuid not null,original_id uuid not null,reason text not null,
  primary key(institution_id,id),foreign key(institution_id,id) references campus.revenue_events,
  foreign key(institution_id,original_id) references campus.student_receipts
);
create table campus.student_allocation_releases (
  institution_id uuid not null,id uuid not null,original_id uuid not null,reason text not null,
  primary key(institution_id,id),foreign key(institution_id,id) references campus.revenue_events,
  foreign key(institution_id,original_id) references campus.student_allocations
);
create table campus.student_receipt_reversals (
  institution_id uuid not null,id uuid not null,original_id uuid not null,reason text not null,
  primary key(institution_id,id),foreign key(institution_id,id) references campus.revenue_events,
  foreign key(institution_id,original_id) references campus.student_receipts
);
create table campus.student_invoice_reversals (
  institution_id uuid not null,id uuid not null,original_id uuid not null,reason text not null,
  primary key(institution_id,id),foreign key(institution_id,id) references campus.revenue_events,
  foreign key(institution_id,original_id) references campus.student_invoices
);
alter table campus.student_credits enable row level security;
alter table campus.student_refunds enable row level security;
alter table campus.student_allocation_releases enable row level security;
alter table campus.student_receipt_reversals enable row level security;
alter table campus.student_invoice_reversals enable row level security;
create policy credit_read on campus.student_credits for select to authenticated using(campus.member_role(institution_id) in ('bursar','cashier','student_accounts','reviewer','auditor'));
create policy refund_read on campus.student_refunds for select to authenticated using(campus.member_role(institution_id) in ('bursar','cashier','student_accounts','reviewer','auditor'));
create policy release_read on campus.student_allocation_releases for select to authenticated using(campus.member_role(institution_id) in ('bursar','cashier','student_accounts','reviewer','auditor'));
create policy receipt_reversal_read on campus.student_receipt_reversals for select to authenticated using(campus.member_role(institution_id) in ('bursar','cashier','student_accounts','reviewer','auditor'));
create policy invoice_reversal_read on campus.student_invoice_reversals for select to authenticated using(campus.member_role(institution_id) in ('bursar','cashier','student_accounts','reviewer','auditor'));
revoke all on campus.student_credits,campus.student_refunds,campus.student_allocation_releases,campus.student_receipt_reversals,campus.student_invoice_reversals from public,authenticated;
grant select on campus.student_credits,campus.student_refunds,campus.student_allocation_releases,campus.student_receipt_reversals,campus.student_invoice_reversals to authenticated;
create view campus.correction_links with(security_invoker=true) as
  select * from campus.student_credits union all select * from campus.student_refunds union all
  select * from campus.student_allocation_releases union all select * from campus.student_receipt_reversals union all select * from campus.student_invoice_reversals;
grant select on campus.correction_links to authenticated;
create function campus.correction_preparer_allowed(tenant uuid,kind text) returns boolean
language sql stable security definer set search_path='' as $$
  select coalesce(case when kind in ('credit','invoice_reversal') then campus.member_role(tenant) in ('bursar','student_accounts')
    when kind in ('refund','receipt_reversal','chargeback') then campus.member_role(tenant) in ('bursar','cashier')
    when kind='allocation_release' then campus.member_role(tenant) in ('bursar','cashier','student_accounts') else false end,false)
$$;

create function campus.correction_sum(tenant uuid,kinds text[],original uuid,states text[],excluded uuid) returns numeric
language sql stable security definer set search_path='' as $$
  select coalesce(sum(e.amount_minor),0) from campus.correction_links c join campus.revenue_events e on e.institution_id=c.institution_id and e.id=c.id
  where c.institution_id=tenant and c.original_id=original and e.kind=any(kinds) and e.status=any(states) and (excluded is null or e.id<>excluded)
$$;
create function campus.net_allocation(tenant uuid,receipt uuid,invoice_line uuid,invoice uuid,states text[],excluded uuid,as_of date) returns numeric
language sql stable security definer set search_path='' as $$
  select coalesce(sum(e.amount_minor-(select coalesce(sum(r.amount_minor),0) from campus.student_allocation_releases c join campus.revenue_events r on r.institution_id=c.institution_id and r.id=c.id
    where c.institution_id=tenant and c.original_id=e.id and r.status='posted' and r.document_date<=as_of)),0)
  from campus.student_allocations a join campus.revenue_events e on e.institution_id=a.institution_id and e.id=a.id
  join campus.student_invoice_lines l on l.institution_id=a.institution_id and l.id=a.invoice_line_id
  where a.institution_id=tenant and e.status=any(states) and (excluded is null or e.id<>excluded) and
    (receipt is null or a.receipt_id=receipt) and (invoice_line is null or a.invoice_line_id=invoice_line) and (invoice is null or l.invoice_id=invoice)
$$;

create or replace function campus.check_allocation(tenant uuid, receipt uuid, invoice_line uuid, allocation_date date, amount numeric, excluded uuid) returns void
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
  receipt_used:=campus.net_allocation(tenant,receipt,null,null,array['approved','posted'],excluded,allocation_date)+campus.correction_sum(tenant,array['refund','receipt_reversal','chargeback'],receipt,array['approved','posted'],null);
  line_used:=campus.net_allocation(tenant,null,invoice_line,null,array['approved','posted'],excluded,allocation_date)+campus.correction_sum(tenant,array['credit'],invoice_line,array['approved','posted'],null);
  if campus.correction_sum(tenant,array['invoice_reversal'],bill.id,array['approved','posted'],null)>0 then line_used:=line_amount; end if;
  if amount<=0 or receipt_used+amount>payment.amount_minor or line_used+amount>line_amount then raise exception 'allocation exceeds available balance'; end if;
end $$;

create function campus.check_correction(tenant uuid,kind text,original uuid,correction_date date,amount numeric,excluded uuid) returns void
language plpgsql security definer set search_path='' as $$
declare source campus.revenue_events; available numeric; allocation campus.student_allocations; invoice_line campus.student_invoice_lines;
begin
  if kind='allocation_release' then
    select * into allocation from campus.student_allocations where institution_id=tenant and id=original;
    if not found then raise exception 'allocation unavailable'; end if;
    perform 1 from campus.revenue_events where institution_id=tenant and id=allocation.receipt_id for update;
    perform 1 from campus.revenue_events where institution_id=tenant and id=(select invoice_id from campus.student_invoice_lines where institution_id=tenant and id=allocation.invoice_line_id) for update;
    select * into source from campus.revenue_events where institution_id=tenant and id=original for update;
    available:=source.amount_minor-campus.correction_sum(tenant,array['allocation_release'],original,array['approved','posted'],excluded);
  elsif kind='credit' then
    select * into invoice_line from campus.student_invoice_lines where institution_id=tenant and id=original;
    if not found then raise exception 'invoice line unavailable'; end if;
    select * into source from campus.revenue_events where institution_id=tenant and id=invoice_line.invoice_id for update;
    available:=invoice_line.amount_minor-campus.net_allocation(tenant,null,original,null,array['approved','posted'],null,correction_date)-campus.correction_sum(tenant,array['credit'],original,array['approved','posted'],excluded);
    if campus.correction_sum(tenant,array['invoice_reversal'],source.id,array['approved','posted'],null)>0 then available:=0; end if;
  elsif kind='invoice_reversal' then
    select e.* into source from campus.revenue_events e join campus.student_invoices i on i.institution_id=e.institution_id and i.id=e.id where e.institution_id=tenant and e.id=original for update of e;
    if not found then raise exception 'invoice unavailable'; end if;
    if amount<>source.amount_minor then raise exception 'full reversal must match original amount'; end if;
    select source.amount_minor-coalesce(sum(campus.correction_sum(tenant,array['credit'],id,array['approved','posted'],null)),0) into available from campus.student_invoice_lines where institution_id=tenant and invoice_id=original;
    available:=available-campus.net_allocation(tenant,null,null,original,array['approved','posted'],null,correction_date)-campus.correction_sum(tenant,array['invoice_reversal'],original,array['approved','posted'],excluded);
  elsif kind in ('refund','receipt_reversal','chargeback') then
    select e.* into source from campus.revenue_events e join campus.student_receipts r on r.institution_id=e.institution_id and r.id=e.id where e.institution_id=tenant and e.id=original for update of e;
    if not found then raise exception 'receipt unavailable'; end if;
    if kind='receipt_reversal' and amount<>source.amount_minor then raise exception 'full reversal must match original amount'; end if;
    available:=source.amount_minor-campus.net_allocation(tenant,original,null,null,array['approved','posted'],null,correction_date)-campus.correction_sum(tenant,array['refund','receipt_reversal','chargeback'],original,array['approved','posted'],excluded);
  else raise exception 'unsupported correction kind'; end if;
  if source.status<>'posted' or correction_date is null or correction_date<source.document_date then raise exception 'posted dated source required'; end if;
  if amount is null or amount<=0 or amount>available then raise exception 'correction exceeds available balance'; end if;
end $$;

create function campus.draft_correction(tenant uuid,correction uuid,kind text,original uuid,period uuid,correction_date date,amount text,reason text) returns integer
language plpgsql security definer set search_path='' as $$
declare caller text;
begin
  caller:=campus.member_role(tenant);
  if coalesce(caller,'') not in ('bursar','cashier','student_accounts') or
    (kind in ('credit','invoice_reversal') and caller not in ('bursar','student_accounts')) or
    (kind in ('refund','receipt_reversal','chargeback') and caller not in ('bursar','cashier')) then raise exception 'permission denied' using errcode='42501'; end if;
  perform campus.check_revenue_period(tenant,period,correction_date);
  if amount is null or amount !~ '^[1-9][0-9]{0,17}$' or reason is null or length(trim(reason)) not between 1 and 500 then raise exception 'valid correction amount and reason required'; end if;
  perform campus.check_correction(tenant,kind,original,correction_date,amount::numeric,null);
  insert into campus.revenue_events(institution_id,id,kind,period_id,document_date,amount_minor,prepared_by) values(tenant,correction,kind,period,correction_date,amount::numeric,auth.uid());
  if kind='credit' then insert into campus.student_credits values(tenant,correction,original,trim(reason));
  elsif kind='refund' then insert into campus.student_refunds values(tenant,correction,original,trim(reason));
  elsif kind='allocation_release' then insert into campus.student_allocation_releases values(tenant,correction,original,trim(reason));
  elsif kind='invoice_reversal' then insert into campus.student_invoice_reversals values(tenant,correction,original,trim(reason));
  else insert into campus.student_receipt_reversals values(tenant,correction,original,trim(reason)); end if;
  insert into campus.revenue_audit(institution_id,event_id,actor_id,action,version) values(tenant,correction,auth.uid(),'correction_created',1);
  return 1;
end $$;

alter function campus.submit_revenue(uuid,uuid,integer,jsonb) rename to submit_revenue_base;
revoke all on function campus.submit_revenue_base(uuid,uuid,integer,jsonb) from public,authenticated;
create function campus.submit_revenue(tenant uuid,event uuid,expected_version integer,plans jsonb) returns integer
language plpgsql security definer set search_path='' as $$
declare source_kind text;
begin
  if campus.member_role(tenant) is null then raise exception 'permission denied' using errcode='42501'; end if;
  select kind into source_kind from campus.revenue_events where institution_id=tenant and id=event;
  if source_kind not in ('invoice','receipt','allocation') and not campus.correction_preparer_allowed(tenant,source_kind) then raise exception 'permission denied' using errcode='42501'; end if;
  if exists(select 1 from campus.revenue_events where institution_id=tenant and id=event and kind in ('invoice_reversal','receipt_reversal')) then raise exception 'controlled reversal submission required'; end if;
  return campus.submit_revenue_base(tenant,event,expected_version,plans);
end $$;
create function campus.submit_source_reversal(tenant uuid,event uuid,expected_version integer) returns integer
language plpgsql security definer set search_path='' as $$
declare source campus.revenue_events; original campus.revenue_events; plans jsonb;
begin
  if coalesce(campus.member_role(tenant),'') not in ('bursar','cashier','student_accounts') then raise exception 'permission denied' using errcode='42501'; end if;
  select * into source from campus.revenue_events where institution_id=tenant and id=event for update;
  if not found or source.prepared_by<>auth.uid() then raise exception 'permission denied' using errcode='42501'; end if;
  if source.kind not in ('invoice_reversal','receipt_reversal') then raise exception 'full source reversal required'; end if;
  if not campus.correction_preparer_allowed(tenant,source.kind) then raise exception 'permission denied' using errcode='42501'; end if;
  select e.* into original from campus.correction_links c join campus.revenue_events e on e.institution_id=c.institution_id and e.id=c.original_id where c.institution_id=tenant and c.id=event;
  select jsonb_agg(jsonb_build_object('basis',p.value->>'basis','policy_id',p.value->>'policy_id','nonrecognition_reason',p.value->>'nonrecognition_reason',
    'lines',coalesce((select jsonb_agg(jsonb_build_object('account_id',l.value->>'account_id','debit_minor',l.value->>'credit_minor','credit_minor',l.value->>'debit_minor') order by l.ordinality) from jsonb_array_elements(p.value->'lines') with ordinality l),'[]'::jsonb)) order by p.ordinality)
    into plans from jsonb_array_elements(original.posting_plan) with ordinality p;
  return campus.submit_revenue_base(tenant,event,expected_version,plans);
end $$;

create or replace function campus.guard_source_journal() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.reversal_of is not null and exists(select 1 from campus.journals j join campus.revenue_events e on e.institution_id=j.institution_id and e.id=j.source_id where j.institution_id=new.institution_id and j.id=new.reversal_of) and not exists(
    select 1 from campus.journals j join campus.correction_links c on c.institution_id=j.institution_id and c.original_id=j.source_id
    join campus.revenue_events e on e.institution_id=c.institution_id and e.id=c.id where j.institution_id=new.institution_id and j.id=new.reversal_of and c.id=new.source_id and j.basis=new.basis and e.kind in ('invoice_reversal','receipt_reversal')) then
    raise exception 'source-linked journal requires source correction';
  end if;
  if exists(select 1 from campus.revenue_events where institution_id=new.institution_id and id=new.source_id) and
    not exists(select 1 from campus.revenue_posting_authority where institution_id=new.institution_id and event_id=new.source_id and transaction_id=txid_current()) then raise exception 'source journal requires controlled posting' using errcode='42501'; end if;
  return new;
end $$;
alter function campus.transition_revenue(uuid,uuid,integer,text) rename to transition_revenue_base;
revoke all on function campus.transition_revenue_base(uuid,uuid,integer,text) from public,authenticated;
create function campus.transition_revenue(tenant uuid,event uuid,expected_version integer,target text) returns integer
language plpgsql security definer set search_path='' as $$
declare source campus.revenue_events; original uuid; result integer; journal campus.journals;
begin
  if coalesce(campus.member_role(tenant),'') not in ('bursar','cashier','student_accounts','reviewer') then raise exception 'permission denied' using errcode='42501'; end if;
  select * into source from campus.revenue_events where institution_id=tenant and id=event for update;
  if not found then raise exception 'source unavailable'; end if;
  if expected_version is null or source.version<>expected_version then raise exception 'version conflict' using errcode='40001'; end if;
  if target in ('approved','posted') and source.kind not in ('invoice','receipt','allocation') then
    perform campus.check_revenue_period(tenant,source.period_id,source.document_date);
    select original_id into original from campus.correction_links where institution_id=tenant and id=event;
    perform campus.check_correction(tenant,source.kind,original,source.document_date,source.amount_minor,event);
  end if;
  result:=campus.transition_revenue_base(tenant,event,expected_version,target);
  if target='posted' and source.kind in ('invoice_reversal','receipt_reversal') then
    insert into campus.revenue_posting_authority values(tenant,event,txid_current());
    for journal in select * from campus.journals where institution_id=tenant and source_id=event loop
      update campus.journals set reversal_of=(select id from campus.journals where institution_id=tenant and source_id=original and basis=journal.basis),
        reversal_reason=(select reason from campus.correction_links where institution_id=tenant and id=event),version=version+1 where institution_id=tenant and id=journal.id;
      insert into campus.audit_events(institution_id,actor_id,journal_id,action,version) values(tenant,auth.uid(),journal.id,'source_reversal_linked',journal.version+1);
    end loop;
    delete from campus.revenue_posting_authority where institution_id=tenant and event_id=event and transaction_id=txid_current();
  end if;
  return result;
end $$;

create or replace function campus.revenue_schedule(tenant uuid) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare billed numeric; receipts numeric; allocated numeric; credits numeric; invoice_reversed numeric; refunded numeric; receipt_reversed numeric; released numeric;
begin
  if coalesce(campus.member_role(tenant),'') not in ('bursar','cashier','student_accounts','reviewer','auditor') then raise exception 'permission denied' using errcode='42501'; end if;
  select coalesce(sum(amount_minor) filter(where kind='invoice'),0),coalesce(sum(amount_minor) filter(where kind='receipt'),0),coalesce(sum(amount_minor) filter(where kind='allocation'),0),
    coalesce(sum(amount_minor) filter(where kind='credit'),0),coalesce(sum(amount_minor) filter(where kind='invoice_reversal'),0),coalesce(sum(amount_minor) filter(where kind='refund'),0),
    coalesce(sum(amount_minor) filter(where kind in ('receipt_reversal','chargeback')),0),coalesce(sum(amount_minor) filter(where kind='allocation_release'),0)
    into billed,receipts,allocated,credits,invoice_reversed,refunded,receipt_reversed,released from campus.revenue_events where institution_id=tenant and status='posted';
  return jsonb_build_object('schema_version',2,'totals',jsonb_build_object('billed_minor',billed::text,'credits_minor',credits::text,'invoice_reversed_minor',invoice_reversed::text,'net_billed_minor',(billed-credits-invoice_reversed)::text,
    'receipts_minor',receipts::text,'refunded_minor',refunded::text,'receipt_reversed_minor',receipt_reversed::text,'net_receipts_minor',(receipts-refunded-receipt_reversed)::text,
    'allocated_minor',allocated::text,'released_minor',released::text,'net_allocated_minor',(allocated-released)::text,'receivable_minor',(billed-credits-invoice_reversed-allocated+released)::text,'unapplied_minor',(receipts-refunded-receipt_reversed-allocated+released)::text),
    'events',(select coalesce(jsonb_agg(to_jsonb(e)),'[]'::jsonb) from(select id,kind,document_date,amount_minor::text,status,version,prepared_by,reviewed_by,approved_by,posting_plan,
      case kind when 'invoice' then(select jsonb_build_object('student_id',i.student_id,'academic_session',i.academic_session,'lines',(select jsonb_agg(jsonb_build_object('id',l.id,'account_id',l.account_id,'description',l.description,'amount_minor',l.amount_minor::text,'due_date',l.due_date) order by l.id) from campus.student_invoice_lines l where l.institution_id=i.institution_id and l.invoice_id=i.id)) from campus.student_invoices i where i.institution_id=tenant and i.id=r.id)
      when 'receipt' then(select jsonb_build_object('student_id',student_id,'reference',reference) from campus.student_receipts where institution_id=tenant and id=r.id)
      when 'allocation' then(select jsonb_build_object('receipt_id',receipt_id,'invoice_line_id',invoice_line_id) from campus.student_allocations where institution_id=tenant and id=r.id)
      else(select jsonb_build_object('original_id',original_id,'reason',reason) from campus.correction_links where institution_id=tenant and id=r.id) end as details
      from campus.revenue_events r where institution_id=tenant order by document_date desc,id limit 100)e),
    'students',(select coalesce(jsonb_agg(to_jsonb(s)),'[]'::jsonb) from(select id,reference,name from campus.students where institution_id=tenant order by reference limit 100)s));
end $$;
revoke all on function campus.correction_preparer_allowed(uuid,text),campus.correction_sum(uuid,text[],uuid,text[],uuid),campus.net_allocation(uuid,uuid,uuid,uuid,text[],uuid,date),campus.check_correction(uuid,text,uuid,date,numeric,uuid) from public,authenticated;
revoke all on function campus.draft_correction(uuid,uuid,text,uuid,uuid,date,text,text),campus.submit_revenue(uuid,uuid,integer,jsonb),campus.submit_source_reversal(uuid,uuid,integer),campus.transition_revenue(uuid,uuid,integer,text) from public;
grant execute on function campus.draft_correction(uuid,uuid,text,uuid,uuid,date,text,text),campus.submit_revenue(uuid,uuid,integer,jsonb),campus.submit_source_reversal(uuid,uuid,integer),campus.transition_revenue(uuid,uuid,integer,text) to authenticated;
commit;
