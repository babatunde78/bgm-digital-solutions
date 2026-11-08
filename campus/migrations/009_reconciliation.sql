begin;
create table campus.reconciliations (
  institution_id uuid not null references campus.institutions,id uuid not null,description text not null,
  status text not null default 'draft' check(status in ('draft','submitted','reviewed','approved','cancelled','void_submitted','void_reviewed','voided')),
  version integer not null default 1,prepared_by uuid not null references auth.users(id),reviewed_by uuid references auth.users(id),approved_by uuid references auth.users(id),approval_note text,
  void_prepared_by uuid references auth.users(id),void_reviewed_by uuid references auth.users(id),void_approved_by uuid references auth.users(id),void_reason text,
  primary key(institution_id,id)
);
create table campus.reconciliation_pairs (
  institution_id uuid not null,reconciliation_id uuid not null,bank_line_id uuid not null,event_id uuid not null,amount_minor numeric(18,0) not null check(amount_minor>0),
  primary key(institution_id,reconciliation_id,bank_line_id,event_id),foreign key(institution_id,reconciliation_id) references campus.reconciliations,
  foreign key(institution_id,bank_line_id) references campus.bank_lines,foreign key(institution_id,event_id) references campus.revenue_events
);
alter table campus.reconciliations enable row level security;
alter table campus.reconciliation_pairs enable row level security;
create policy reconciliation_read on campus.reconciliations for select to authenticated using(campus.member_role(institution_id) in ('bursar','cashier','student_accounts','reviewer','auditor'));
create policy reconciliation_pair_read on campus.reconciliation_pairs for select to authenticated using(campus.member_role(institution_id) in ('bursar','cashier','student_accounts','reviewer','auditor'));
revoke all on campus.reconciliations,campus.reconciliation_pairs from public,authenticated;
grant select on campus.reconciliations,campus.reconciliation_pairs to authenticated;
create view campus.reconcilable_sources with(security_invoker=true) as
  select e.institution_id,e.id,e.kind,e.document_date,e.amount_minor,r.reference,'credit'::text as direction from campus.revenue_events e join campus.student_receipts r on r.institution_id=e.institution_id and r.id=e.id
    where e.status='posted' and not exists(select 1 from campus.student_receipt_reversals c join campus.revenue_events v on v.institution_id=c.institution_id and v.id=c.id where c.institution_id=e.institution_id and c.original_id=e.id and v.kind='receipt_reversal' and v.status in ('approved','posted'))
  union all
  select e.institution_id,e.id,e.kind,e.document_date,e.amount_minor,r.reference,'debit'::text from campus.revenue_events e join campus.correction_links c on c.institution_id=e.institution_id and c.id=e.id
    join campus.student_receipts r on r.institution_id=c.institution_id and r.id=c.original_id where e.status='posted' and e.kind in ('refund','chargeback');
grant select on campus.reconcilable_sources to authenticated;
create function campus.matched_amount(tenant uuid,bank_line uuid,event uuid,excluded uuid) returns numeric language sql stable security definer set search_path='' as $$
  select coalesce(sum(p.amount_minor),0) from campus.reconciliation_pairs p join campus.reconciliations r on r.institution_id=p.institution_id and r.id=p.reconciliation_id
    where p.institution_id=tenant and r.status in ('approved','void_submitted','void_reviewed') and (bank_line is null or p.bank_line_id=bank_line) and (event is null or p.event_id=event) and (excluded is null or r.id<>excluded)
$$;
create function campus.check_reconciliation(tenant uuid,reconciliation uuid) returns void language plpgsql security definer set search_path='' as $$
declare pair campus.reconciliation_pairs;line campus.bank_lines;source record;total numeric;
begin
  perform 1 from campus.bank_lines where institution_id=tenant and id in(select bank_line_id from campus.reconciliation_pairs where institution_id=tenant and reconciliation_id=reconciliation) order by id for update;
  perform 1 from campus.revenue_events where institution_id=tenant and id in(select event_id from campus.reconciliation_pairs where institution_id=tenant and reconciliation_id=reconciliation) order by id for update;
  for pair in select * from campus.reconciliation_pairs where institution_id=tenant and reconciliation_id=reconciliation loop
    select * into line from campus.bank_lines where institution_id=tenant and id=pair.bank_line_id;
    select * into source from campus.reconcilable_sources where institution_id=tenant and id=pair.event_id;
    if not found then raise exception 'posted reconcilable source required';end if;
    if source.direction<>line.direction or source.document_date>line.bank_date then raise exception 'source direction or date mismatch';end if;
  end loop;
  for line in select * from campus.bank_lines where institution_id=tenant and id in(select bank_line_id from campus.reconciliation_pairs where institution_id=tenant and reconciliation_id=reconciliation) loop
    select sum(amount_minor) into total from campus.reconciliation_pairs where institution_id=tenant and reconciliation_id=reconciliation and bank_line_id=line.id;
    if total+campus.matched_amount(tenant,line.id,null,reconciliation)>line.gross_minor then raise exception 'reconciliation exceeds available amount';end if;
  end loop;
  for source in select e.id,e.amount_minor from campus.revenue_events e where e.institution_id=tenant and e.id in(select event_id from campus.reconciliation_pairs where institution_id=tenant and reconciliation_id=reconciliation) loop
    select sum(amount_minor) into total from campus.reconciliation_pairs where institution_id=tenant and reconciliation_id=reconciliation and event_id=source.id;
    if total+campus.matched_amount(tenant,null,source.id,reconciliation)>source.amount_minor then raise exception 'reconciliation exceeds available amount';end if;
  end loop;
end $$;
create function campus.propose_reconciliation(tenant uuid,reconciliation uuid,description text,pairs jsonb) returns integer language plpgsql security definer set search_path='' as $$
declare pair jsonb;
begin
  if coalesce(campus.member_role(tenant),'') not in ('bursar','cashier','student_accounts') then raise exception 'permission denied' using errcode='42501';end if;
  if description is null or length(trim(description)) not between 1 and 500 or jsonb_typeof(pairs) is distinct from 'array' then raise exception 'invalid reconciliation';end if;
  if jsonb_array_length(pairs) not between 1 and 100 then raise exception 'one to 100 matching allocations required';end if;
  insert into campus.reconciliations(institution_id,id,description,prepared_by) values(tenant,reconciliation,trim(description),auth.uid());
  for pair in select value from jsonb_array_elements(pairs) loop
    if jsonb_typeof(pair) is distinct from 'object' then raise exception 'invalid matching allocation';end if;
    if (select count(*) from jsonb_object_keys(pair))<>3 or not(pair ?& array['bank_line_id','event_id','amount_minor']) or jsonb_typeof(pair->'amount_minor') is distinct from 'string' or (pair->>'amount_minor') !~ '^[1-9][0-9]{0,17}$' then raise exception 'invalid matching allocation';end if;
    insert into campus.reconciliation_pairs values(tenant,reconciliation,(pair->>'bank_line_id')::uuid,(pair->>'event_id')::uuid,(pair->>'amount_minor')::numeric);
  end loop;
  perform campus.check_reconciliation(tenant,reconciliation);
  insert into campus.treasury_audit(institution_id,subject_id,actor_id,action,version) values(tenant,reconciliation,auth.uid(),'matching_proposed',1);return 1;
end $$;
create function campus.transition_reconciliation(tenant uuid,reconciliation uuid,expected_version integer,target text,note text) returns integer language plpgsql security definer set search_path='' as $$
declare source campus.reconciliations;caller text;
begin
  caller:=campus.member_role(tenant);
  if coalesce(caller,'') not in ('bursar','cashier','student_accounts','reviewer') then raise exception 'permission denied' using errcode='42501';end if;
  select * into source from campus.reconciliations where institution_id=tenant and id=reconciliation for update;
  if not found then raise exception 'reconciliation unavailable';end if;
  if expected_version is null or source.version<>expected_version then raise exception 'version conflict' using errcode='40001';end if;
  if note is null or length(note)>500 then raise exception 'invalid review note';end if;
  if target='cancelled' then
    if source.status not in ('draft','submitted','reviewed') or (caller<>'bursar' and (source.status<>'draft' or source.prepared_by<>auth.uid())) then raise exception 'permission denied' using errcode='42501';end if;
  else
    if not((source.status='draft' and target='submitted') or(source.status='submitted' and target='reviewed') or(source.status='reviewed' and target='approved') or
      (source.status='approved' and target='void_submitted') or(source.status='void_submitted' and target='void_reviewed') or(source.status='void_reviewed' and target='voided')) then raise exception 'invalid reconciliation transition';end if;
    if target='submitted' and (source.prepared_by<>auth.uid() or caller not in ('bursar','cashier','student_accounts')) then raise exception 'permission denied' using errcode='42501';end if;
    if target='reviewed' and (caller not in ('reviewer','bursar') or source.prepared_by=auth.uid()) then raise exception 'independent reviewer required' using errcode='42501';end if;
    if target='approved' and (caller<>'bursar' or source.prepared_by=auth.uid()) then raise exception 'independent approver required' using errcode='42501';end if;
    if target='void_submitted' and caller<>'bursar' then raise exception 'permission denied' using errcode='42501';end if;
    if target='void_reviewed' and (caller not in ('reviewer','bursar') or source.void_prepared_by=auth.uid()) then raise exception 'independent reviewer required' using errcode='42501';end if;
    if target='voided' and (caller<>'bursar' or source.void_prepared_by=auth.uid()) then raise exception 'independent approver required' using errcode='42501';end if;
    if target in ('approved','void_submitted') and length(trim(note))=0 then raise exception 'explicit verification or void reason required';end if;
    if target='approved' then perform campus.check_reconciliation(tenant,reconciliation);end if;
  end if;
  update campus.reconciliations set status=target,version=version+1,reviewed_by=case when target='reviewed' then auth.uid() else reviewed_by end,
    approved_by=case when target='approved' then auth.uid() else approved_by end,approval_note=case when target='approved' then trim(note) else approval_note end,
    void_prepared_by=case when target='void_submitted' then auth.uid() else void_prepared_by end,void_reviewed_by=case when target='void_reviewed' then auth.uid() else void_reviewed_by end,
    void_approved_by=case when target='voided' then auth.uid() else void_approved_by end,void_reason=case when target='void_submitted' then trim(note) else void_reason end where institution_id=tenant and id=reconciliation;
  insert into campus.treasury_audit(institution_id,subject_id,actor_id,action,version) values(tenant,reconciliation,auth.uid(),target,expected_version+1);return expected_version+1;
end $$;
create function campus.reconciliation_candidates(tenant uuid,bank_line uuid) returns jsonb language plpgsql stable security definer set search_path='' as $$
declare line campus.bank_lines;remaining numeric;
begin
  if coalesce(campus.member_role(tenant),'') not in ('bursar','cashier','student_accounts','reviewer','auditor') then raise exception 'permission denied' using errcode='42501';end if;
  select * into line from campus.bank_lines where institution_id=tenant and id=bank_line;
  if not found then raise exception 'bank line unavailable';end if;
  remaining:=line.gross_minor-campus.matched_amount(tenant,bank_line,null,null);
  return(select coalesce(jsonb_agg(to_jsonb(c)),'[]'::jsonb) from(select id,kind,document_date,reference,(amount_minor-campus.matched_amount(tenant,null,id,null))::text as available_minor,
    case when reference<>'' and reference=line.reference and amount_minor-campus.matched_amount(tenant,null,id,null)=remaining then 'exact_reference_and_amount'
      when amount_minor-campus.matched_amount(tenant,null,id,null)=remaining then 'amount_only_review' else 'partial_review' end as suggestion
    from campus.reconcilable_sources where institution_id=tenant and direction=line.direction and document_date<=line.bank_date and amount_minor-campus.matched_amount(tenant,null,id,null)>0 and remaining>0 order by document_date,id limit 100)c);
end $$;
create function campus.guard_matched_receipt_reversal() returns trigger language plpgsql security definer set search_path='' as $$
declare original uuid;
begin
  if new.kind='receipt_reversal' and new.status in ('approved','posted') then
    select original_id into original from campus.student_receipt_reversals where institution_id=new.institution_id and id=new.id;
    perform 1 from campus.revenue_events where institution_id=new.institution_id and id=original for update;
    if campus.matched_amount(new.institution_id,null,original,null)>0 then raise exception 'matched bank receipt requires refund or chargeback, not bookkeeping reversal';end if;
  end if;return new;
end $$;
create trigger matched_receipt_reversal before update of status on campus.revenue_events for each row execute function campus.guard_matched_receipt_reversal();

create function campus.treasury_schedule(tenant uuid) returns jsonb language plpgsql stable security invoker set search_path='' as $$
declare credit_gross numeric;credit_fees numeric;credit_net numeric;debit_gross numeric;debit_fees numeric;debit_net numeric;matched numeric;financial_access boolean;
begin
  if campus.member_role(tenant) is null then raise exception 'permission denied' using errcode='42501';end if;
  financial_access:=campus.member_role(tenant) in ('bursar','cashier','student_accounts','reviewer','auditor');
  select coalesce(sum(gross_minor) filter(where direction='credit'),0),coalesce(sum(fee_minor) filter(where direction='credit'),0),coalesce(sum(net_minor) filter(where direction='credit'),0),
    coalesce(sum(gross_minor) filter(where direction='debit'),0),coalesce(sum(fee_minor) filter(where direction='debit'),0),coalesce(sum(net_minor) filter(where direction='debit'),0) into credit_gross,credit_fees,credit_net,debit_gross,debit_fees,debit_net from campus.bank_lines where institution_id=tenant;
  select coalesce(sum(p.amount_minor),0) into matched from campus.reconciliation_pairs p join campus.reconciliations r on r.institution_id=p.institution_id and r.id=p.reconciliation_id where p.institution_id=tenant and r.status in ('approved','void_submitted','void_reviewed');
  return jsonb_build_object('financial_access',financial_access,'totals',case when financial_access then jsonb_build_object('credit_gross_minor',credit_gross::text,'credit_fee_minor',credit_fees::text,'credit_net_minor',credit_net::text,'debit_gross_minor',debit_gross::text,'debit_fee_minor',debit_fees::text,'debit_net_minor',debit_net::text,'matched_gross_minor',matched::text,'unmatched_gross_minor',(credit_gross+debit_gross-matched)::text) else null end,
    'sources',(select coalesce(jsonb_agg(to_jsonb(s)),'[]'::jsonb) from(select id,name,account_id,currency from campus.bank_sources where institution_id=tenant order by name,id limit 100)s),
    'imports',(select coalesce(jsonb_agg(to_jsonb(b)),'[]'::jsonb) from(select id,bank_source_id,status,version,row_count,error_count,total_gross_minor::text,total_fee_minor::text,total_net_minor::text,prepared_by,verified_by,verification_note,
      (select jsonb_agg(jsonb_build_object('id',id,'row_number',row_number,'raw',raw,'normalised',normalised) order by row_number) from campus.bank_import_rows where institution_id=tenant and batch_id=i.id) as rows from campus.bank_imports i where institution_id=tenant order by id limit 100)b),
    'lines',(select coalesce(jsonb_agg(to_jsonb(l)),'[]'::jsonb) from(select id,batch_id,bank_source_id,transaction_id,bank_date,reference,direction,currency,gross_minor::text,fee_minor::text,net_minor::text from campus.bank_lines where institution_id=tenant order by bank_date,id limit 100)l),
    'reconciliations',(select coalesce(jsonb_agg(to_jsonb(r)),'[]'::jsonb) from(select id,description,status,version,prepared_by,reviewed_by,approved_by,approval_note,void_prepared_by,void_reviewed_by,void_approved_by,void_reason,
      (select jsonb_agg(jsonb_build_object('bank_line_id',bank_line_id,'event_id',event_id,'amount_minor',amount_minor::text) order by bank_line_id,event_id) from campus.reconciliation_pairs where institution_id=tenant and reconciliation_id=g.id) as pairs from campus.reconciliations g where institution_id=tenant order by id limit 100)r));
end $$;
revoke all on function campus.matched_amount(uuid,uuid,uuid,uuid),campus.check_reconciliation(uuid,uuid),campus.guard_matched_receipt_reversal() from public,authenticated;
revoke all on function campus.propose_reconciliation(uuid,uuid,text,jsonb),campus.transition_reconciliation(uuid,uuid,integer,text,text),campus.reconciliation_candidates(uuid,uuid),campus.treasury_schedule(uuid) from public;
grant execute on function campus.propose_reconciliation(uuid,uuid,text,jsonb),campus.transition_reconciliation(uuid,uuid,integer,text,text),campus.reconciliation_candidates(uuid,uuid),campus.treasury_schedule(uuid) to authenticated;
commit;
