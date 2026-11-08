begin;
create schema campus;
revoke all on schema campus from public;
grant usage on schema campus to authenticated;

create table campus.institutions (
  id uuid primary key,
  name text not null check (length(name) between 1 and 200)
);
create table campus.memberships (
  institution_id uuid references campus.institutions,
  user_id uuid not null,
  role text not null check (role in ('institution_administrator','bursar','cashier','student_accounts','budget_officer','payables_officer','reviewer','auditor')),
  active boolean not null default true,
  primary key (institution_id,user_id)
);
create table campus.accounts (
  institution_id uuid references campus.institutions,
  id uuid not null,
  name text not null,
  primary key (institution_id,id)
);
create table campus.periods (
  institution_id uuid references campus.institutions,
  id uuid not null,
  starts_on date not null,
  ends_on date not null check (ends_on >= starts_on),
  locked boolean not null default false,
  primary key (institution_id,id)
);
create table campus.policies (
  institution_id uuid references campus.institutions,
  id uuid not null,
  basis text not null check (basis in ('cash','accrual')),
  version integer not null check (version > 0),
  effective_from date not null,
  prepared_by uuid not null,
  approved_by uuid not null check (approved_by <> prepared_by),
  primary key (institution_id,id,basis),
  unique (institution_id,basis,version)
);
create table campus.journals (
  institution_id uuid references campus.institutions,
  id uuid not null,
  basis text not null,
  policy_id uuid not null,
  period_id uuid not null,
  source_id uuid not null,
  posted_on date not null,
  status text not null default 'draft' check (status in ('draft','submitted','reviewed','approved','posted')),
  version integer not null default 1,
  prepared_by uuid not null,
  reviewed_by uuid,
  approved_by uuid,
  primary key (institution_id,id),
  unique (institution_id,basis,source_id),
  foreign key (institution_id,policy_id,basis) references campus.policies,
  foreign key (institution_id,period_id) references campus.periods
);
create table campus.journal_lines (
  institution_id uuid not null,
  journal_id uuid not null,
  line_no integer not null,
  account_id uuid not null,
  debit_minor numeric(20,0) not null check (debit_minor >= 0),
  credit_minor numeric(20,0) not null check (credit_minor >= 0),
  check ((debit_minor > 0 and credit_minor = 0) or (credit_minor > 0 and debit_minor = 0)),
  primary key (institution_id,journal_id,line_no),
  foreign key (institution_id,journal_id) references campus.journals,
  foreign key (institution_id,account_id) references campus.accounts
);
create table campus.audit_events (
  id bigint generated always as identity primary key,
  institution_id uuid references campus.institutions,
  actor_id uuid not null,
  journal_id uuid not null,
  action text not null,
  version integer not null,
  occurred_at timestamptz not null default clock_timestamp(),
  foreign key (institution_id,journal_id) references campus.journals
);

create function campus.member_role(tenant uuid) returns text
language sql stable security definer set search_path = '' as $$
  select role from campus.memberships where institution_id=tenant and user_id=auth.uid() and active
$$;
revoke all on function campus.member_role(uuid) from public;
grant execute on function campus.member_role(uuid) to authenticated;

alter table campus.institutions enable row level security;
alter table campus.memberships enable row level security;
alter table campus.accounts enable row level security;
alter table campus.periods enable row level security;
alter table campus.policies enable row level security;
alter table campus.journals enable row level security;
alter table campus.journal_lines enable row level security;
alter table campus.audit_events enable row level security;
create policy institution_read on campus.institutions for select to authenticated using (campus.member_role(id) is not null);
create policy membership_read on campus.memberships for select to authenticated using (user_id=auth.uid() and active);
create policy account_read on campus.accounts for select to authenticated using (campus.member_role(institution_id) is not null);
create policy period_read on campus.periods for select to authenticated using (campus.member_role(institution_id) is not null);
create policy policy_read on campus.policies for select to authenticated using (campus.member_role(institution_id) is not null);
create policy journal_read on campus.journals for select to authenticated using (
  campus.member_role(institution_id) in ('bursar','reviewer','auditor') or
  (prepared_by=auth.uid() and campus.member_role(institution_id) is not null));
create policy line_read on campus.journal_lines for select to authenticated using (
  exists (select 1 from campus.journals j where j.institution_id=journal_lines.institution_id and j.id=journal_lines.journal_id));
create policy audit_read on campus.audit_events for select to authenticated using (campus.member_role(institution_id) in ('bursar','reviewer','auditor'));
revoke all on all tables in schema campus from public,authenticated;
grant select on all tables in schema campus to authenticated;

create function campus.create_journal(tenant uuid, journal uuid, accounting_basis text, policy uuid,
  period uuid, source uuid, document_date date, entries jsonb) returns integer
language plpgsql security definer set search_path = '' as $$
declare entry jsonb; position integer := 0;
begin
  if coalesce(campus.member_role(tenant),'') not in ('bursar','cashier','student_accounts','budget_officer','payables_officer') then
    raise exception 'permission denied' using errcode='42501';
  end if;
  if jsonb_typeof(entries) is distinct from 'array' or jsonb_array_length(entries) not between 2 and 1000 then
    raise exception 'unbalanced or invalid journal';
  end if;
  if not exists (select 1 from campus.policies where institution_id=tenant and id=policy and basis=accounting_basis and effective_from<=document_date) then
    raise exception 'approved effective policy required';
  end if;
  if not exists (select 1 from campus.periods where institution_id=tenant and id=period and document_date between starts_on and ends_on) then
    raise exception 'invalid period';
  end if;
  insert into campus.journals (institution_id,id,basis,policy_id,period_id,source_id,posted_on,prepared_by)
    values (tenant,journal,accounting_basis,policy,period,source,document_date,auth.uid());
  for entry in select value from jsonb_array_elements(entries) loop
    if jsonb_typeof(entry) is distinct from 'object' or
      (select count(*) from jsonb_object_keys(entry)) <> 3 or
      not (entry ?& array['account_id','debit_minor','credit_minor']) or
      jsonb_typeof(entry->'debit_minor') is distinct from 'string' or
      jsonb_typeof(entry->'credit_minor') is distinct from 'string' or
      (entry->>'debit_minor') !~ '^(0|[1-9][0-9]{0,17})$' or
      (entry->>'credit_minor') !~ '^(0|[1-9][0-9]{0,17})$' then
      raise exception 'invalid journal line';
    end if;
    position := position+1;
    insert into campus.journal_lines values (tenant,journal,position,(entry->>'account_id')::uuid,
      (entry->>'debit_minor')::numeric,(entry->>'credit_minor')::numeric);
  end loop;
  if (select sum(debit_minor-credit_minor) from campus.journal_lines where institution_id=tenant and journal_id=journal) <> 0 then
    raise exception 'unbalanced journal';
  end if;
  insert into campus.audit_events (institution_id,actor_id,journal_id,action,version) values (tenant,auth.uid(),journal,'created',1);
  return 1;
end $$;

create function campus.transition_journal(tenant uuid, journal uuid, expected_version integer, target text) returns integer
language plpgsql security definer set search_path = '' as $$
declare current_journal campus.journals; caller_role text; locked_period boolean;
begin
  caller_role := campus.member_role(tenant);
  if caller_role is null then raise exception 'permission denied' using errcode='42501'; end if;
  select * into current_journal from campus.journals where institution_id=tenant and id=journal for update;
  if not found then raise exception 'journal unavailable'; end if;
  if current_journal.version <> expected_version or expected_version is null then
    raise exception 'version conflict' using errcode='40001';
  end if;
  if not ((current_journal.status='draft' and target='submitted') or
    (current_journal.status='submitted' and target='reviewed') or
    (current_journal.status='reviewed' and target='approved') or
    (current_journal.status='approved' and target='posted')) then raise exception 'invalid transition'; end if;
  if (target='submitted' and (auth.uid()<>current_journal.prepared_by or caller_role not in ('bursar','cashier','student_accounts','budget_officer','payables_officer'))) or
    (target='reviewed' and (caller_role not in ('reviewer','bursar') or auth.uid()=current_journal.prepared_by)) or
    (target='approved' and (caller_role<>'bursar' or auth.uid()=current_journal.prepared_by)) or
    (target='posted' and caller_role<>'bursar') then raise exception 'permission denied' using errcode='42501'; end if;
  if target='posted' then
    select locked into locked_period from campus.periods where institution_id=tenant and id=current_journal.period_id for update;
    if locked_period then raise exception 'period locked'; end if;
    if (select count(*)<2 or sum(debit_minor-credit_minor)<>0 from campus.journal_lines where institution_id=tenant and journal_id=journal) then
      raise exception 'unbalanced journal';
    end if;
  end if;
  update campus.journals set status=target, version=version+1,
    reviewed_by=case when target='reviewed' then auth.uid() else reviewed_by end,
    approved_by=case when target='approved' then auth.uid() else approved_by end
    where institution_id=tenant and id=journal;
  insert into campus.audit_events (institution_id,actor_id,journal_id,action,version)
    values (tenant,auth.uid(),journal,target,expected_version+1);
  return expected_version+1;
end $$;
revoke all on function campus.create_journal(uuid,uuid,text,uuid,uuid,uuid,date,jsonb) from public;
revoke all on function campus.transition_journal(uuid,uuid,integer,text) from public;
grant execute on function campus.create_journal(uuid,uuid,text,uuid,uuid,uuid,date,jsonb) to authenticated;
grant execute on function campus.transition_journal(uuid,uuid,integer,text) to authenticated;
commit;
