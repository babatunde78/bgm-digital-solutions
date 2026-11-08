begin;
create table campus.academic_items (
  institution_id uuid not null references campus.institutions,id uuid not null,kind text not null check(kind in ('session','programme','level')),
  name text not null check(length(trim(name)) between 1 and 100),primary key(institution_id,id),unique(institution_id,kind,name)
);
create table campus.student_enrolments (
  institution_id uuid not null,student_id uuid not null,session_id uuid not null,programme_id uuid not null,level_id uuid not null,
  primary key(institution_id,student_id,session_id),foreign key(institution_id,student_id) references campus.students,
  foreign key(institution_id,session_id) references campus.academic_items,foreign key(institution_id,programme_id) references campus.academic_items,foreign key(institution_id,level_id) references campus.academic_items
);
create table campus.fee_schedules (
  institution_id uuid not null,id uuid not null,session_id uuid not null,programme_id uuid not null,level_id uuid not null,
  billing_code text not null,effective_from date not null,prepared_by uuid not null references auth.users(id),approved_by uuid references auth.users(id),version integer,
  primary key(institution_id,id),unique(institution_id,session_id,programme_id,level_id,billing_code,version),
  foreign key(institution_id,session_id) references campus.academic_items,foreign key(institution_id,programme_id) references campus.academic_items,foreign key(institution_id,level_id) references campus.academic_items
);
create table campus.fee_schedule_lines (
  institution_id uuid not null,fee_id uuid not null,fee_key text not null,account_id uuid not null,description text not null,
  amount_minor numeric(18,0) not null check(amount_minor>0),due_date date not null,primary key(institution_id,fee_id,fee_key),
  foreign key(institution_id,fee_id) references campus.fee_schedules,foreign key(institution_id,account_id) references campus.accounts
);
create table campus.billing_batches (
  institution_id uuid not null,id uuid not null,period_id uuid not null,request jsonb not null,preview jsonb not null,
  prepared_by uuid not null references auth.users(id),reviewed_by uuid references auth.users(id),approved_by uuid references auth.users(id),
  status text not null default 'draft' check(status in ('draft','submitted','reviewed','approved','generated','cancelled')),version integer not null default 1,
  primary key(institution_id,id),foreign key(institution_id,period_id) references campus.periods
);
create table campus.billing_batch_invoices (
  institution_id uuid not null,batch_id uuid not null,student_id uuid not null,invoice_id uuid not null,
  primary key(institution_id,batch_id,student_id),unique(institution_id,invoice_id),
  foreign key(institution_id,batch_id) references campus.billing_batches,foreign key(institution_id,student_id) references campus.students,foreign key(institution_id,invoice_id) references campus.student_invoices
);
create table campus.billing_charges (
  institution_id uuid not null,student_id uuid not null,session_id uuid not null,fee_key text not null,invoice_line_id uuid not null,batch_id uuid not null,
  primary key(institution_id,student_id,session_id,fee_key),foreign key(institution_id,student_id) references campus.students,
  foreign key(institution_id,session_id) references campus.academic_items,foreign key(institution_id,invoice_line_id) references campus.student_invoice_lines,foreign key(institution_id,batch_id) references campus.billing_batches
);
create table campus.billing_audit (
  id bigint generated always as identity primary key,institution_id uuid not null,batch_id uuid not null,actor_id uuid not null references auth.users(id),
  action text not null,version integer not null,occurred_at timestamptz not null default clock_timestamp(),foreign key(institution_id,batch_id) references campus.billing_batches
);
alter table campus.academic_items enable row level security;
alter table campus.student_enrolments enable row level security;
alter table campus.fee_schedules enable row level security;
alter table campus.fee_schedule_lines enable row level security;
alter table campus.billing_batches enable row level security;
alter table campus.billing_batch_invoices enable row level security;
alter table campus.billing_charges enable row level security;
alter table campus.billing_audit enable row level security;
create policy academic_read on campus.academic_items for select to authenticated using(campus.member_role(institution_id) is not null);
create policy fee_read on campus.fee_schedules for select to authenticated using(campus.member_role(institution_id) is not null);
create policy fee_line_read on campus.fee_schedule_lines for select to authenticated using(campus.member_role(institution_id) is not null);
create policy enrolment_read on campus.student_enrolments for select to authenticated using(campus.member_role(institution_id) in ('bursar','student_accounts','cashier','reviewer','auditor'));
create policy batch_read on campus.billing_batches for select to authenticated using(campus.member_role(institution_id) in ('bursar','student_accounts','cashier','reviewer','auditor'));
create policy batch_invoice_read on campus.billing_batch_invoices for select to authenticated using(campus.member_role(institution_id) in ('bursar','student_accounts','cashier','reviewer','auditor'));
create policy charge_read on campus.billing_charges for select to authenticated using(campus.member_role(institution_id) in ('bursar','student_accounts','cashier','reviewer','auditor'));
create policy billing_audit_read on campus.billing_audit for select to authenticated using(campus.member_role(institution_id) in ('bursar','student_accounts','reviewer','auditor'));
revoke all on campus.academic_items,campus.student_enrolments,campus.fee_schedules,campus.fee_schedule_lines,campus.billing_batches,campus.billing_batch_invoices,campus.billing_charges,campus.billing_audit from public,authenticated;
grant select on campus.academic_items,campus.student_enrolments,campus.fee_schedules,campus.fee_schedule_lines,campus.billing_batches,campus.billing_batch_invoices,campus.billing_charges,campus.billing_audit to authenticated;

create function campus.create_academic_item(tenant uuid,item uuid,item_kind text,item_name text) returns integer language plpgsql security definer set search_path='' as $$
begin
  if campus.member_role(tenant) is distinct from 'institution_administrator' then raise exception 'permission denied' using errcode='42501';end if;
  insert into campus.academic_items values(tenant,item,item_kind,item_name);
  insert into campus.administration_events(institution_id,actor_id,subject_id,action) values(tenant,auth.uid(),item,'academic_item_created');return 1;
end $$;
create function campus.enrol_student(tenant uuid,student uuid,session uuid,programme uuid,level uuid) returns integer language plpgsql security definer set search_path='' as $$
begin
  if coalesce(campus.member_role(tenant),'') not in ('bursar','student_accounts') then raise exception 'permission denied' using errcode='42501';end if;
  if not exists(select 1 from campus.academic_items where institution_id=tenant and id=session and kind='session') or
    not exists(select 1 from campus.academic_items where institution_id=tenant and id=programme and kind='programme') or
    not exists(select 1 from campus.academic_items where institution_id=tenant and id=level and kind='level') then raise exception 'matching academic structures required';end if;
  insert into campus.student_enrolments values(tenant,student,session,programme,level);
  insert into campus.administration_events(institution_id,actor_id,subject_id,action) values(tenant,auth.uid(),student,'student_enrolled');return 1;
end $$;
create function campus.propose_fees(tenant uuid,fee uuid,session uuid,programme uuid,level uuid,code text,effective date,entries jsonb) returns integer
language plpgsql security definer set search_path='' as $$
declare entry jsonb;total numeric:=0;
begin
  if campus.member_role(tenant) is distinct from 'institution_administrator' then raise exception 'permission denied' using errcode='42501';end if;
  if not exists(select 1 from campus.academic_items where institution_id=tenant and id=session and kind='session') or
    not exists(select 1 from campus.academic_items where institution_id=tenant and id=programme and kind='programme') or
    not exists(select 1 from campus.academic_items where institution_id=tenant and id=level and kind='level') then raise exception 'matching academic structures required';end if;
  if code is null or code !~ '^[a-z][a-z0-9_]{0,63}$' or effective is null or jsonb_typeof(entries) is distinct from 'array' then raise exception 'invalid fee schedule';end if;
  if jsonb_array_length(entries) not between 1 and 1000 then raise exception 'invalid fee lines';end if;
  insert into campus.fee_schedules values(tenant,fee,session,programme,level,code,effective,auth.uid(),null,null);
  for entry in select value from jsonb_array_elements(entries) loop
    if jsonb_typeof(entry) is distinct from 'object' then raise exception 'invalid fee line';end if;
    if (select count(*) from jsonb_object_keys(entry))<>5 or not(entry ?& array['fee_key','account_id','description','amount_minor','due_date']) or
      jsonb_typeof(entry->'fee_key') is distinct from 'string' or (entry->>'fee_key') !~ '^[a-z][a-z0-9_]{0,63}$' or
      jsonb_typeof(entry->'description') is distinct from 'string' or length(trim(entry->>'description')) not between 1 and 200 or
      jsonb_typeof(entry->'amount_minor') is distinct from 'string' or (entry->>'amount_minor') !~ '^[1-9][0-9]{0,17}$' or
      (entry->>'due_date') is null or (entry->>'due_date') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' or (entry->>'due_date')::date<effective then raise exception 'invalid fee line';end if;
    if not exists(select 1 from campus.accounts a where a.institution_id=tenant and a.id=(entry->>'account_id')::uuid and a.code is not null and a.account_type is not null) then raise exception 'configured fee account required';end if;
    total:=total+(entry->>'amount_minor')::numeric;
    insert into campus.fee_schedule_lines values(tenant,fee,entry->>'fee_key',(entry->>'account_id')::uuid,entry->>'description',(entry->>'amount_minor')::numeric,(entry->>'due_date')::date);
  end loop;
  if total>999999999999999999 then raise exception 'fee total exceeds invoice range';end if;
  insert into campus.administration_events(institution_id,actor_id,subject_id,action) values(tenant,auth.uid(),fee,'fees_proposed');return 1;
end $$;
create function campus.approve_fees(tenant uuid,fee uuid) returns integer language plpgsql security definer set search_path='' as $$
declare draft campus.fee_schedules;next_version integer;
begin
  perform 1 from campus.institutions where id=tenant for update;
  if campus.member_role(tenant) is distinct from 'bursar' then raise exception 'permission denied' using errcode='42501';end if;
  select * into draft from campus.fee_schedules where institution_id=tenant and id=fee for update;
  if not found then raise exception 'fee schedule unavailable';end if;
  if draft.prepared_by=auth.uid() then raise exception 'independent approver required' using errcode='42501';end if;
  if draft.approved_by is not null then raise exception 'fees already approved' using errcode='23505';end if;
  if exists(select 1 from campus.fee_schedules where institution_id=tenant and session_id=draft.session_id and programme_id=draft.programme_id and level_id=draft.level_id and billing_code=draft.billing_code and approved_by is not null and effective_from>=draft.effective_from) then raise exception 'effective date must follow approved fee versions';end if;
  select coalesce(max(version),0)+1 into next_version from campus.fee_schedules where institution_id=tenant and session_id=draft.session_id and programme_id=draft.programme_id and level_id=draft.level_id and billing_code=draft.billing_code;
  update campus.fee_schedules set approved_by=auth.uid(),version=next_version where institution_id=tenant and id=fee;
  insert into campus.administration_events(institution_id,actor_id,subject_id,action) values(tenant,auth.uid(),fee,'fees_approved');return next_version;
end $$;

create function campus.preview_billing(tenant uuid,fee uuid,period uuid,invoice_date date,students uuid[]) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare schedule campus.fee_schedules;student uuid;reference text;errors text[];rows jsonb:='[]'::jsonb;lines jsonb;total numeric;line_count integer;
begin
  if coalesce(campus.member_role(tenant),'') not in ('bursar','student_accounts','cashier','reviewer','auditor') then raise exception 'permission denied' using errcode='42501';end if;
  if students is null or cardinality(students) not between 1 and 100 or array_position(students,null) is not null or (select count(distinct id) from unnest(students) id)<>cardinality(students) then raise exception 'one to 100 distinct students required';end if;
  select * into schedule from campus.fee_schedules where institution_id=tenant and id=fee and approved_by is not null and effective_from<=invoice_date;
  if not found then raise exception 'approved effective fee schedule required';end if;
  if not exists(select 1 from campus.periods where institution_id=tenant and id=period and not locked and invoice_date between starts_on and ends_on) then raise exception 'open billing period required';end if;
  select jsonb_agg(jsonb_build_object('fee_key',fee_key,'account_id',account_id,'description',description,'amount_minor',amount_minor::text,'due_date',due_date) order by fee_key),sum(amount_minor),count(*)::int into lines,total,line_count from campus.fee_schedule_lines where institution_id=tenant and fee_id=fee;
  for student in select id from unnest(students) id order by id loop
    errors:=array[]::text[];
    select s.reference into reference from campus.students s where s.institution_id=tenant and s.id=student;
    if not found then errors:=array_append(errors,'student_unavailable');end if;
    if not exists(select 1 from campus.student_enrolments where institution_id=tenant and student_id=student and session_id=schedule.session_id and programme_id=schedule.programme_id and level_id=schedule.level_id) then errors:=array_append(errors,'matching_enrolment_required');end if;
    if exists(select 1 from campus.fee_schedule_lines where institution_id=tenant and fee_id=fee and due_date<invoice_date) then errors:=array_append(errors,'due_date_before_invoice');end if;
    if exists(select 1 from campus.billing_charges c join campus.fee_schedule_lines f on f.institution_id=c.institution_id and f.fee_key=c.fee_key where c.institution_id=tenant and c.student_id=student and c.session_id=schedule.session_id and f.fee_id=fee) then errors:=array_append(errors,'already_billed');end if;
    rows:=rows||jsonb_build_array(jsonb_build_object('student_id',student,'reference',reference,'errors',errors,'total_minor',total::text));
  end loop;
  return jsonb_build_object('fee_id',fee,'fee_version',schedule.version,'academic_session',(select name from campus.academic_items where institution_id=tenant and id=schedule.session_id),
    'period_id',period,'invoice_date',invoice_date,'rows',rows,'lines',lines,'totals',jsonb_build_object('student_count',cardinality(students),'line_count',line_count*cardinality(students),'total_minor',(total*cardinality(students))::text));
end $$;
create function campus.prepare_billing_batch(tenant uuid,batch uuid,fee uuid,period uuid,invoice_date date,students uuid[]) returns integer
language plpgsql security definer set search_path='' as $$
declare request jsonb;preview jsonb;existing campus.billing_batches;
begin
  if coalesce(campus.member_role(tenant),'') not in ('bursar','student_accounts') then raise exception 'permission denied' using errcode='42501';end if;
  if students is null or cardinality(students) not between 1 and 100 or array_position(students,null) is not null or (select count(distinct id) from unnest(students) id)<>cardinality(students) then raise exception 'one to 100 distinct students required';end if;
  request:=jsonb_build_object('fee_id',fee,'period_id',period,'invoice_date',invoice_date,'students',(select jsonb_agg(id order by id) from unnest(students) id));
  select * into existing from campus.billing_batches where institution_id=tenant and id=batch for update;
  if found then
    if existing.request<>request then raise exception 'batch ID already used with different inputs' using errcode='23505';end if;
    return existing.version;
  end if;
  perform campus.check_revenue_period(tenant,period,invoice_date);
  preview:=campus.preview_billing(tenant,fee,period,invoice_date,students);
  if exists(select 1 from jsonb_array_elements(preview->'rows') where jsonb_array_length(value->'errors')>0) then raise exception 'billing preview contains errors';end if;
  insert into campus.billing_batches(institution_id,id,period_id,request,preview,prepared_by) values(tenant,batch,period,request,preview,auth.uid());
  insert into campus.billing_audit(institution_id,batch_id,actor_id,action,version) values(tenant,batch,auth.uid(),'prepared',1);return 1;
end $$;

create function campus.transition_billing_batch(tenant uuid,batch uuid,expected_version integer,target text) returns integer
language plpgsql security definer set search_path='' as $$
declare source campus.billing_batches;caller text;schedule campus.fee_schedules;preview jsonb;student jsonb;invoice uuid;entries jsonb;students uuid[];
begin
  caller:=campus.member_role(tenant);
  if coalesce(caller,'') not in ('bursar','student_accounts','reviewer') then raise exception 'permission denied' using errcode='42501';end if;
  select * into source from campus.billing_batches where institution_id=tenant and id=batch for update;
  if not found then raise exception 'batch unavailable';end if;
  if source.status='generated' and target='generated' and expected_version in (source.version-1,source.version) and caller='bursar' then return source.version;end if;
  if expected_version is null or source.version<>expected_version then raise exception 'version conflict' using errcode='40001';end if;
  if target='cancelled' then
    if source.status in ('generated','cancelled') then raise exception 'generated batch cannot be cancelled';end if;
    if caller<>'bursar' and (source.prepared_by<>auth.uid() or source.status<>'draft') then raise exception 'permission denied' using errcode='42501';end if;
  else
    perform campus.check_revenue_period(tenant,source.period_id,(source.request->>'invoice_date')::date);
    if not((source.status='draft' and target='submitted') or(source.status='submitted' and target='reviewed') or(source.status='reviewed' and target='approved') or(source.status='approved' and target='generated')) then raise exception 'invalid batch transition';end if;
    if target='submitted' and (source.prepared_by<>auth.uid() or caller not in ('bursar','student_accounts')) then raise exception 'permission denied' using errcode='42501';end if;
    if target='reviewed' and (caller not in ('reviewer','bursar') or source.prepared_by=auth.uid()) then raise exception 'independent reviewer required' using errcode='42501';end if;
    if target='approved' and (caller<>'bursar' or source.prepared_by=auth.uid()) then raise exception 'independent approver required' using errcode='42501';end if;
    if target='generated' and caller<>'bursar' then raise exception 'permission denied' using errcode='42501';end if;
    if target='generated' then
      if not exists(select 1 from campus.memberships where institution_id=tenant and user_id=source.prepared_by and active and role in ('bursar','student_accounts')) then raise exception 'batch preparer no longer authorised';end if;
      select * into schedule from campus.fee_schedules where institution_id=tenant and id=(source.request->>'fee_id')::uuid;
      perform 1 from campus.academic_items where institution_id=tenant and id=schedule.session_id for update;
      select array_agg(value::uuid) into students from jsonb_array_elements_text(source.request->'students');
      preview:=campus.preview_billing(tenant,schedule.id,source.period_id,(source.request->>'invoice_date')::date,students);
      if preview<>source.preview or exists(select 1 from jsonb_array_elements(preview->'rows') where jsonb_array_length(value->'errors')>0) then raise exception 'billing preview changed; prepare a new batch';end if;
      for student in select value from jsonb_array_elements(preview->'rows') loop
        invoice:=gen_random_uuid();
        select jsonb_agg(jsonb_build_object('id',gen_random_uuid(),'account_id',value->>'account_id','description',value->>'description','amount_minor',value->>'amount_minor','due_date',value->>'due_date') order by ordinality) into entries from jsonb_array_elements(preview->'lines') with ordinality;
        perform campus.draft_invoice(tenant,invoice,(student->>'student_id')::uuid,source.period_id,(source.request->>'invoice_date')::date,preview->>'academic_session',entries);
        update campus.revenue_events set prepared_by=source.prepared_by where institution_id=tenant and id=invoice;
        insert into campus.billing_batch_invoices values(tenant,batch,(student->>'student_id')::uuid,invoice);
        insert into campus.billing_charges select tenant,(student->>'student_id')::uuid,schedule.session_id,b.value->>'fee_key',(a.value->>'id')::uuid,batch from jsonb_array_elements(entries) with ordinality a join jsonb_array_elements(preview->'lines') with ordinality b using(ordinality);
        insert into campus.revenue_audit(institution_id,event_id,actor_id,action,version) values(tenant,invoice,auth.uid(),'batch_generated',1);
      end loop;
    end if;
  end if;
  update campus.billing_batches set status=target,version=version+1,reviewed_by=case when target='reviewed' then auth.uid() else reviewed_by end,approved_by=case when target='approved' then auth.uid() else approved_by end where institution_id=tenant and id=batch;
  insert into campus.billing_audit(institution_id,batch_id,actor_id,action,version) values(tenant,batch,auth.uid(),target,expected_version+1);return expected_version+1;
end $$;
create function campus.billing_schedule(tenant uuid) returns jsonb language plpgsql stable security invoker set search_path='' as $$
begin
  if campus.member_role(tenant) is null then raise exception 'permission denied' using errcode='42501';end if;
  return jsonb_build_object(
    'items',(select coalesce(jsonb_agg(to_jsonb(i)),'[]'::jsonb) from(select id,kind,name from campus.academic_items where institution_id=tenant order by kind,name,id limit 100)i),
    'enrolments',(select coalesce(jsonb_agg(to_jsonb(e)),'[]'::jsonb) from(select student_id,session_id,programme_id,level_id from campus.student_enrolments where institution_id=tenant order by session_id,student_id limit 100)e),
    'fees',(select coalesce(jsonb_agg(to_jsonb(f)),'[]'::jsonb) from(select id,session_id,programme_id,level_id,billing_code,effective_from,prepared_by,approved_by,version,
      (select jsonb_agg(jsonb_build_object('fee_key',fee_key,'account_id',account_id,'description',description,'amount_minor',amount_minor::text,'due_date',due_date) order by fee_key) from campus.fee_schedule_lines where institution_id=tenant and fee_id=s.id) as lines
      from campus.fee_schedules s where institution_id=tenant order by effective_from desc,id limit 100)f),
    'batches',(select coalesce(jsonb_agg(to_jsonb(b)),'[]'::jsonb) from(select id,status,version,prepared_by,reviewed_by,approved_by,request,preview,
      (select coalesce(jsonb_agg(jsonb_build_object('student_id',student_id,'invoice_id',invoice_id) order by student_id),'[]'::jsonb) from campus.billing_batch_invoices where institution_id=tenant and batch_id=s.id) as invoices
      from campus.billing_batches s where institution_id=tenant order by id limit 100)b));
end $$;
revoke all on function campus.billing_schedule(uuid) from public;
grant execute on function campus.billing_schedule(uuid) to authenticated;
create function campus.guard_billing_period_close() returns trigger language plpgsql security definer set search_path='' as $$
begin
  if new.locked and not old.locked and exists(select 1 from campus.billing_batches where institution_id=new.institution_id and period_id=new.id and status not in ('generated','cancelled')) then raise exception 'unresolved billing batches remain';end if;return new;
end $$;
create trigger billing_period_close before update of locked on campus.periods for each row execute function campus.guard_billing_period_close();
revoke all on function campus.guard_billing_period_close() from public,authenticated;
revoke all on function campus.create_academic_item(uuid,uuid,text,text),campus.enrol_student(uuid,uuid,uuid,uuid,uuid),campus.propose_fees(uuid,uuid,uuid,uuid,uuid,text,date,jsonb),campus.approve_fees(uuid,uuid),campus.preview_billing(uuid,uuid,uuid,date,uuid[]),campus.prepare_billing_batch(uuid,uuid,uuid,uuid,date,uuid[]),campus.transition_billing_batch(uuid,uuid,integer,text) from public;
grant execute on function campus.create_academic_item(uuid,uuid,text,text),campus.enrol_student(uuid,uuid,uuid,uuid,uuid),campus.propose_fees(uuid,uuid,uuid,uuid,uuid,text,date,jsonb),campus.approve_fees(uuid,uuid),campus.preview_billing(uuid,uuid,uuid,date,uuid[]),campus.prepare_billing_batch(uuid,uuid,uuid,uuid,date,uuid[]),campus.transition_billing_batch(uuid,uuid,integer,text) to authenticated;
commit;
