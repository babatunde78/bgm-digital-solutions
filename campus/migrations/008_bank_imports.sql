begin;
create table campus.bank_sources (
  institution_id uuid not null references campus.institutions,id uuid not null,name text not null check(length(trim(name)) between 1 and 100),
  account_id uuid not null,currency text not null,primary key(institution_id,id),foreign key(institution_id,account_id) references campus.accounts
);
create table campus.bank_imports (
  institution_id uuid not null,id uuid not null,bank_source_id uuid not null,content_hash text not null,column_map jsonb not null,
  status text not null check(status in ('staged','invalid','accepted')),version integer not null default 1,
  row_count integer not null,error_count integer not null,total_gross_minor numeric(22,0),total_fee_minor numeric(22,0),total_net_minor numeric(22,0),
  prepared_by uuid not null references auth.users(id),verified_by uuid references auth.users(id),verification_note text,verified_at timestamptz,
  primary key(institution_id,id),unique(institution_id,bank_source_id,content_hash),foreign key(institution_id,bank_source_id) references campus.bank_sources
);
create table campus.bank_import_rows (
  institution_id uuid not null,id uuid not null,batch_id uuid not null,row_number integer not null,raw jsonb not null,normalised jsonb not null,
  primary key(institution_id,id),unique(institution_id,batch_id,row_number),foreign key(institution_id,batch_id) references campus.bank_imports
);
create table campus.bank_lines (
  institution_id uuid not null,id uuid not null,batch_id uuid not null,bank_source_id uuid not null,transaction_id text not null,
  bank_date date not null,reference text not null,direction text not null check(direction in ('credit','debit')),currency text not null,
  gross_minor numeric(18,0) not null check(gross_minor>0),fee_minor numeric(18,0) not null check(fee_minor>=0),net_minor numeric(18,0) not null check(net_minor>=0),
  primary key(institution_id,id),unique(institution_id,bank_source_id,transaction_id),foreign key(institution_id,id) references campus.bank_import_rows,
  foreign key(institution_id,batch_id) references campus.bank_imports,foreign key(institution_id,bank_source_id) references campus.bank_sources,
  check((direction='credit' and gross_minor-fee_minor=net_minor) or(direction='debit' and gross_minor+fee_minor=net_minor))
);
create table campus.treasury_audit (
  id bigint generated always as identity primary key,institution_id uuid not null references campus.institutions,subject_id uuid not null,
  actor_id uuid not null references auth.users(id),action text not null,version integer not null,occurred_at timestamptz not null default clock_timestamp()
);
alter table campus.bank_sources enable row level security;
alter table campus.bank_imports enable row level security;
alter table campus.bank_import_rows enable row level security;
alter table campus.bank_lines enable row level security;
alter table campus.treasury_audit enable row level security;
create policy bank_source_read on campus.bank_sources for select to authenticated using(campus.member_role(institution_id) is not null);
create policy bank_import_read on campus.bank_imports for select to authenticated using(campus.member_role(institution_id) in ('bursar','cashier','student_accounts','reviewer','auditor'));
create policy bank_import_row_read on campus.bank_import_rows for select to authenticated using(campus.member_role(institution_id) in ('bursar','cashier','student_accounts','reviewer','auditor'));
create policy bank_line_read on campus.bank_lines for select to authenticated using(campus.member_role(institution_id) in ('bursar','cashier','student_accounts','reviewer','auditor'));
create policy treasury_audit_read on campus.treasury_audit for select to authenticated using(campus.member_role(institution_id) in ('bursar','reviewer','auditor'));
revoke all on campus.bank_sources,campus.bank_imports,campus.bank_import_rows,campus.bank_lines,campus.treasury_audit from public,authenticated;
grant select on campus.bank_sources,campus.bank_imports,campus.bank_import_rows,campus.bank_lines,campus.treasury_audit to authenticated;

create function campus.create_bank_source(tenant uuid,bank uuid,source_name text,ledger_account uuid) returns integer
language plpgsql security definer set search_path='' as $$
begin
  if campus.member_role(tenant) is distinct from 'institution_administrator' then raise exception 'permission denied' using errcode='42501';end if;
  if not exists(select 1 from campus.accounts where institution_id=tenant and id=ledger_account and account_type='asset' and code is not null) then raise exception 'configured asset account required';end if;
  insert into campus.bank_sources select tenant,bank,source_name,ledger_account,currency from campus.institutions where id=tenant;
  insert into campus.administration_events(institution_id,actor_id,subject_id,action) values(tenant,auth.uid(),bank,'bank_source_created');return 1;
end $$;
create function campus.validate_bank_row(tenant uuid,bank uuid,raw jsonb,mapping jsonb) returns jsonb
language plpgsql stable security definer set search_path='' as $$
declare errors text[]:=array[]::text[];field text;value jsonb;row jsonb:='{}'::jsonb;parsed_date date;source_currency text;
begin
  if jsonb_typeof(raw) is distinct from 'object' then errors:=array_append(errors,'row_object_required');
  else
    if (select count(*) from jsonb_object_keys(raw))>20 then errors:=array_append(errors,'too_many_columns');end if;
    for value in select v from jsonb_each(raw) as entries(k,v) loop
      if jsonb_typeof(value) is distinct from 'string' then errors:=array_append(errors,'text_cells_required');
      elsif length(value#>>'{}')>500 or (value#>>'{}') ~ '[[:cntrl:]]|^[[:space:]]*[=+@-]' then errors:=array_append(errors,'unsafe_text');end if;
    end loop;
  end if;
  foreach field in array array['transaction_id','date','reference','direction','currency','gross_minor','fee_minor','net_minor'] loop
    if jsonb_typeof(raw->(mapping->>field)) is distinct from 'string' then errors:=array_append(errors,field||':text_required');end if;
    row:=row||jsonb_build_object(field,raw->>(mapping->>field));
  end loop;
  if coalesce(length(trim(row->>'transaction_id')),0) not between 1 and 80 then errors:=array_append(errors,'invalid_transaction_id');end if;
  if coalesce(length(row->>'reference'),201)>200 then errors:=array_append(errors,'invalid_reference');end if;
  if coalesce(row->>'date','') !~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$' then errors:=array_append(errors,'invalid_date');
  else begin parsed_date:=(row->>'date')::date;exception when invalid_datetime_format or datetime_field_overflow then errors:=array_append(errors,'invalid_date');end;end if;
  if coalesce(row->>'direction','') not in ('credit','debit') then errors:=array_append(errors,'invalid_direction');end if;
  select currency into source_currency from campus.bank_sources where institution_id=tenant and id=bank;
  if (row->>'currency') is distinct from source_currency then errors:=array_append(errors,'currency_mismatch');end if;
  if coalesce(row->>'gross_minor','') !~ '^[1-9][0-9]{0,17}$' then errors:=array_append(errors,'invalid_gross');end if;
  if coalesce(row->>'fee_minor','') !~ '^(0|[1-9][0-9]{0,17})$' then errors:=array_append(errors,'invalid_fee');end if;
  if coalesce(row->>'net_minor','') !~ '^(0|[1-9][0-9]{0,17})$' then errors:=array_append(errors,'invalid_net');end if;
  if coalesce(row->>'gross_minor','') ~ '^[1-9][0-9]{0,17}$' and coalesce(row->>'fee_minor','') ~ '^(0|[1-9][0-9]{0,17})$' and coalesce(row->>'net_minor','') ~ '^(0|[1-9][0-9]{0,17})$' then
    if ((row->>'direction')='credit' and (row->>'gross_minor')::numeric-(row->>'fee_minor')::numeric<>(row->>'net_minor')::numeric) or
      ((row->>'direction')='debit' and (row->>'gross_minor')::numeric+(row->>'fee_minor')::numeric<>(row->>'net_minor')::numeric) then errors:=array_append(errors,'control_total_mismatch');end if;
  end if;
  if exists(select 1 from campus.bank_lines where institution_id=tenant and bank_source_id=bank and transaction_id=row->>'transaction_id') then errors:=array_append(errors,'duplicate_bank_transaction');end if;
  return row||jsonb_build_object('errors',errors);
end $$;
create function campus.bank_import_summary(tenant uuid,batch uuid) returns jsonb language sql stable security definer set search_path='' as $$
  select jsonb_build_object('batch_id',id,'status',status,'version',version,'row_count',row_count,'error_count',error_count,
    'total_gross_minor',total_gross_minor::text,'total_fee_minor',total_fee_minor::text,'total_net_minor',total_net_minor::text)
    from campus.bank_imports where institution_id=tenant and id=batch
$$;
create function campus.stage_bank_import(tenant uuid,batch uuid,bank uuid,rows jsonb,mapping jsonb) returns jsonb
language plpgsql security definer set search_path='' as $$
declare fingerprint text;existing campus.bank_imports;raw jsonb;normalised jsonb;row_index integer:=0;bad_rows integer:=0;gross numeric:=0;fees numeric:=0;net numeric:=0;
begin
  if coalesce(campus.member_role(tenant),'') not in ('bursar','cashier','student_accounts') then raise exception 'permission denied' using errcode='42501';end if;
  perform 1 from campus.bank_sources where institution_id=tenant and id=bank for update;
  if not found then raise exception 'bank source unavailable';end if;
  if jsonb_typeof(rows) is distinct from 'array' or jsonb_typeof(mapping) is distinct from 'object' then raise exception 'invalid import shape';end if;
  if jsonb_array_length(rows) not between 1 and 100 or (select count(*) from jsonb_object_keys(mapping))<>8 or not(mapping ?& array['transaction_id','date','reference','direction','currency','gross_minor','fee_minor','net_minor']) then raise exception 'invalid import mapping or row count';end if;
  if exists(select 1 from jsonb_each(mapping) where jsonb_typeof(value) is distinct from 'string' or length(value#>>'{}') not between 1 and 80) or
    (select count(distinct value) from jsonb_each(mapping))<>8 then raise exception 'invalid import mapping';end if;
  fingerprint:=encode(sha256(convert_to(jsonb_build_object('bank',bank,'rows',rows,'mapping',mapping)::text,'UTF8')),'hex');
  select * into existing from campus.bank_imports where institution_id=tenant and id=batch;
  if found then if existing.content_hash<>fingerprint then raise exception 'batch ID already used with different content' using errcode='23505';end if;return campus.bank_import_summary(tenant,existing.id);end if;
  select * into existing from campus.bank_imports where institution_id=tenant and bank_source_id=bank and content_hash=fingerprint;
  if found then return campus.bank_import_summary(tenant,existing.id);end if;
  insert into campus.bank_imports(institution_id,id,bank_source_id,content_hash,column_map,status,row_count,error_count,prepared_by) values(tenant,batch,bank,fingerprint,mapping,'staged',jsonb_array_length(rows),0,auth.uid());
  for raw in select value from jsonb_array_elements(rows) loop
    row_index:=row_index+1;normalised:=campus.validate_bank_row(tenant,bank,raw,mapping);
    if (select count(*) from jsonb_array_elements(rows) where value->>(mapping->>'transaction_id')=normalised->>'transaction_id')>1 then normalised:=jsonb_set(normalised,'{errors}',(normalised->'errors')||'"duplicate_transaction_id"'::jsonb);end if;
    if jsonb_array_length(normalised->'errors')>0 then bad_rows:=bad_rows+1;
    else gross:=gross+(normalised->>'gross_minor')::numeric;fees:=fees+(normalised->>'fee_minor')::numeric;net:=net+(normalised->>'net_minor')::numeric;end if;
    insert into campus.bank_import_rows values(tenant,gen_random_uuid(),batch,row_index,raw,normalised);
  end loop;
  update campus.bank_imports set status=case when bad_rows>0 then 'invalid' else 'staged' end,error_count=bad_rows,
    total_gross_minor=case when bad_rows=0 then gross else null end,total_fee_minor=case when bad_rows=0 then fees else null end,total_net_minor=case when bad_rows=0 then net else null end where institution_id=tenant and id=batch;
  insert into campus.treasury_audit(institution_id,subject_id,actor_id,action,version) values(tenant,batch,auth.uid(),'import_staged',1);
  return campus.bank_import_summary(tenant,batch);
end $$;
create function campus.accept_bank_import(tenant uuid,batch uuid,expected_version integer,verification text) returns integer
language plpgsql security definer set search_path='' as $$
declare source campus.bank_imports;row campus.bank_import_rows;
begin
  if campus.member_role(tenant) is distinct from 'bursar' then raise exception 'permission denied' using errcode='42501';end if;
  select * into source from campus.bank_imports where institution_id=tenant and id=batch;
  if not found then raise exception 'import unavailable';end if;
  perform 1 from campus.bank_sources where institution_id=tenant and id=source.bank_source_id for update;
  select * into source from campus.bank_imports where institution_id=tenant and id=batch for update;
  if source.prepared_by=auth.uid() then raise exception 'independent verifier required' using errcode='42501';end if;
  if verification is null or length(trim(verification)) not between 1 and 200 then raise exception 'independent verification reference required';end if;
  if source.status='accepted' and expected_version in (source.version-1,source.version) and source.verification_note=trim(verification) then return source.version;end if;
  if expected_version is null or source.version<>expected_version then raise exception 'version conflict' using errcode='40001';end if;
  if source.status<>'staged' or source.error_count>0 then raise exception 'import contains errors';end if;
  for row in select * from campus.bank_import_rows where institution_id=tenant and batch_id=batch order by row_number loop
    if exists(select 1 from campus.bank_lines where institution_id=tenant and bank_source_id=source.bank_source_id and transaction_id=row.normalised->>'transaction_id') then raise exception 'bank transaction already imported' using errcode='23505';end if;
    insert into campus.bank_lines values(tenant,row.id,batch,source.bank_source_id,row.normalised->>'transaction_id',(row.normalised->>'date')::date,row.normalised->>'reference',row.normalised->>'direction',row.normalised->>'currency',
      (row.normalised->>'gross_minor')::numeric,(row.normalised->>'fee_minor')::numeric,(row.normalised->>'net_minor')::numeric);
  end loop;
  update campus.bank_imports set status='accepted',version=version+1,verified_by=auth.uid(),verification_note=trim(verification),verified_at=clock_timestamp() where institution_id=tenant and id=batch;
  insert into campus.treasury_audit(institution_id,subject_id,actor_id,action,version) values(tenant,batch,auth.uid(),'import_verified',expected_version+1);return expected_version+1;
end $$;
revoke all on function campus.validate_bank_row(uuid,uuid,jsonb,jsonb),campus.bank_import_summary(uuid,uuid) from public,authenticated;
revoke all on function campus.create_bank_source(uuid,uuid,text,uuid),campus.stage_bank_import(uuid,uuid,uuid,jsonb,jsonb),campus.accept_bank_import(uuid,uuid,integer,text) from public;
grant execute on function campus.create_bank_source(uuid,uuid,text,uuid),campus.stage_bank_import(uuid,uuid,uuid,jsonb,jsonb),campus.accept_bank_import(uuid,uuid,integer,text) to authenticated;
commit;
