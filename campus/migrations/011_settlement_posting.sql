begin;
create function campus.settlement_leg(account uuid,amount numeric,debit boolean)returns jsonb language sql immutable set search_path='' as $$
 select case when amount=0 then '[]'::jsonb else jsonb_build_array(jsonb_build_object('account_id',account,'debit_minor',case when debit then amount::text else '0' end,'credit_minor',case when debit then '0' else amount::text end))end
$$;
create function campus.settlement_snapshot(tenant uuid,bank_line uuid,posting_date date,cash_profile uuid,accrual_profile uuid)returns jsonb language plpgsql security definer set search_path='' as $$
declare line campus.bank_lines;profile campus.settlement_profiles;selected uuid;matched numeric;bank_tolerance numeric;source_tolerance numeric;book_gross numeric;source record;footprint numeric;consumed numeric;sources jsonb;matches jsonb;tolerances jsonb;plans jsonb:='[]'::jsonb;entries jsonb;
begin
 select * into line from campus.bank_lines where institution_id=tenant and id=bank_line for update;
 if not found or posting_date is null or posting_date<line.bank_date then raise exception 'accepted bank line and valid posting date required';end if;
 if exists(select 1 from campus.reconciliation_pairs p join campus.reconciliations r on r.institution_id=p.institution_id and r.id=p.reconciliation_id where p.institution_id=tenant and p.bank_line_id=bank_line and r.status in('void_submitted','void_reviewed'))or
  exists(select 1 from campus.reconciliation_tolerances where institution_id=tenant and bank_line_id=bank_line and status in('void_submitted','void_reviewed'))then raise exception 'resolve pending match or tolerance void first';end if;
 if exists(select 1 from campus.reconciliation_tolerances where institution_id=tenant and bank_line_id=bank_line and status='approved' and(cash_profile_id<>cash_profile or accrual_profile_id<>accrual_profile))then raise exception 'settlement profiles must match approved tolerances';end if;
 select coalesce(sum(p.amount_minor),0),coalesce(jsonb_agg(jsonb_build_object('match_id',r.id,'version',r.version,'event_id',p.event_id,'amount_minor',p.amount_minor::text)order by r.id,p.event_id),'[]'::jsonb)into matched,matches
 from campus.reconciliation_pairs p join campus.reconciliations r on r.institution_id=p.institution_id and r.id=p.reconciliation_id where p.institution_id=tenant and p.bank_line_id=bank_line and r.status='approved';
 select coalesce(sum(amount_minor)filter(where side='bank'),0),coalesce(sum(amount_minor)filter(where side='source'),0),coalesce(jsonb_agg(jsonb_build_object('id',id,'version',version,'side',side,'event_id',event_id,'amount_minor',amount_minor::text)order by id),'[]'::jsonb)into bank_tolerance,source_tolerance,tolerances
 from campus.reconciliation_tolerances where institution_id=tenant and bank_line_id=bank_line and status='approved';
 if matched<=0 or matched+bank_tolerance<>line.gross_minor then raise exception 'complete reviewed matching and approved differences required';end if;
 book_gross:=matched+source_tolerance;if book_gross>999999999999999999 then raise exception 'book amount exceeds supported line range';end if;
 select jsonb_agg(jsonb_build_object('event_id',event_id,'amount_minor',amount::text)order by event_id)into sources from(
  select event_id,sum(amount)as amount from(
   select p.event_id,p.amount_minor as amount from campus.reconciliation_pairs p join campus.reconciliations r on r.institution_id=p.institution_id and r.id=p.reconciliation_id where p.institution_id=tenant and p.bank_line_id=bank_line and r.status='approved'
   union all select event_id,amount_minor from campus.reconciliation_tolerances where institution_id=tenant and bank_line_id=bank_line and side='source' and status='approved'
  )amounts group by event_id
 )book;
 perform 1 from campus.revenue_events where institution_id=tenant and id in(select(value->>'event_id')::uuid from jsonb_array_elements(sources))order by id for update;
 foreach selected in array array[cash_profile,accrual_profile]loop
  select * into profile from campus.settlement_profiles where institution_id=tenant and id=selected and approved_by is not null and bank_source_id=line.bank_source_id and effective_from<=line.bank_date and effective_from<=posting_date;
  if not found or(selected=cash_profile and profile.basis<>'cash')or(selected=accrual_profile and profile.basis<>'accrual')then raise exception 'approved effective profiles for both bases required';end if;
  if bank_tolerance+source_tolerance>profile.limit_minor then raise exception 'approved tolerance limit exceeded';end if;
  for source in select(value->>'event_id')::uuid as id,(value->>'amount_minor')::numeric as amount from jsonb_array_elements(sources)loop
   if not exists(select 1 from campus.reconcilable_sources where institution_id=tenant and id=source.id and direction=line.direction)then raise exception 'posted reconcilable source required';end if;
   select coalesce(sum(l.debit_minor-l.credit_minor),0)into footprint from campus.journals j join campus.journal_lines l on l.institution_id=j.institution_id and l.journal_id=j.id where j.institution_id=tenant and j.source_id=source.id and j.basis=profile.basis and j.status='posted' and l.account_id=profile.clearing_account_id;
   if line.direction='debit'then footprint:=-footprint;end if;
   select coalesce(sum(c.amount_minor),0)into consumed from campus.treasury_consumptions c join campus.treasury_settlements s on s.institution_id=c.institution_id and s.id=c.settlement_id
    where c.institution_id=tenant and c.event_id=source.id and c.basis=profile.basis and c.account_id=profile.clearing_account_id and s.status='posted' and s.reversal_of is null and
     not exists(select 1 from campus.treasury_settlements r where r.institution_id=s.institution_id and r.reversal_of=s.id and r.status='posted');
   if footprint-consumed<source.amount then raise exception 'insufficient source clearing entry; bank cash cannot be counted twice';end if;
  end loop;
  if line.direction='credit'then
   entries:=campus.settlement_leg(profile.bank_account_id,line.net_minor,true)||campus.settlement_leg(profile.fee_account_id,line.fee_minor,true)||campus.settlement_leg(profile.clearing_account_id,book_gross,false);
   if line.gross_minor>=book_gross then entries:=entries||campus.settlement_leg(profile.variance_account_id,line.gross_minor-book_gross,false);else entries:=entries||campus.settlement_leg(profile.variance_account_id,book_gross-line.gross_minor,true);end if;
  else
   entries:=campus.settlement_leg(profile.clearing_account_id,book_gross,true)||campus.settlement_leg(profile.fee_account_id,line.fee_minor,true)||campus.settlement_leg(profile.bank_account_id,line.net_minor,false);
   if line.gross_minor>=book_gross then entries:=entries||campus.settlement_leg(profile.variance_account_id,line.gross_minor-book_gross,true);else entries:=entries||campus.settlement_leg(profile.variance_account_id,book_gross-line.gross_minor,false);end if;
  end if;
  plans:=plans||jsonb_build_array(jsonb_build_object('basis',profile.basis,'profile_id',profile.id,'policy_id',profile.policy_id,'clearing_account_id',profile.clearing_account_id,'lines',entries));
 end loop;
 return jsonb_build_object('bank_line_id',bank_line,'direction',line.direction,'gross_minor',line.gross_minor::text,'fee_minor',line.fee_minor::text,'net_minor',line.net_minor::text,
  'matched_minor',matched::text,'bank_tolerance_minor',bank_tolerance::text,'source_tolerance_minor',source_tolerance::text,'book_gross_minor',book_gross::text,'sources',sources,'matches',matches,'tolerances',tolerances,'plans',plans);
end $$;

create function campus.prepare_settlement(tenant uuid,settlement uuid,bank_line uuid,period uuid,posting_date date,cash_profile uuid,accrual_profile uuid)returns integer language plpgsql security definer set search_path='' as $$
declare snapshot jsonb;existing campus.treasury_settlements;
begin
 if coalesce(campus.member_role(tenant),'')not in('bursar','student_accounts')then raise exception 'permission denied' using errcode='42501';end if;
 select * into existing from campus.treasury_settlements where institution_id=tenant and id=settlement;
 if found then if existing.reversal_of is null and existing.bank_line_id=bank_line and existing.period_id=period and existing.posting_date=posting_date and existing.cash_profile_id=cash_profile and existing.accrual_profile_id=accrual_profile then return existing.version;end if;raise exception 'settlement ID already used' using errcode='23505';end if;
 perform campus.check_revenue_period(tenant,period,posting_date);
 snapshot:=campus.settlement_snapshot(tenant,bank_line,posting_date,cash_profile,accrual_profile);
 insert into campus.treasury_settlements(institution_id,id,bank_line_id,period_id,posting_date,cash_profile_id,accrual_profile_id,snapshot,prepared_by)values(tenant,settlement,bank_line,period,posting_date,cash_profile,accrual_profile,snapshot,auth.uid());
 insert into campus.treasury_settlement_claims values(tenant,bank_line,settlement);
 insert into campus.treasury_audit(institution_id,subject_id,actor_id,action,version)values(tenant,settlement,auth.uid(),'settlement_prepared',1);return 1;
end $$;
create function campus.prepare_settlement_reversal(tenant uuid,reversal uuid,original uuid,period uuid,posting_date date,reason text)returns integer language plpgsql security definer set search_path='' as $$
declare source campus.treasury_settlements;existing campus.treasury_settlements;reversal_snapshot jsonb;plans jsonb;
begin
 if coalesce(campus.member_role(tenant),'')not in('bursar','student_accounts')then raise exception 'permission denied' using errcode='42501';end if;
 if reason is null or length(trim(reason))not between 1 and 500 then raise exception 'reversal reason required';end if;
 select * into existing from campus.treasury_settlements where institution_id=tenant and id=reversal;
 if found then if existing.reversal_of=original and existing.period_id=period and existing.posting_date=posting_date and existing.reason=trim(reason)then return existing.version;end if;raise exception 'settlement ID already used' using errcode='23505';end if;
 perform campus.check_revenue_period(tenant,period,posting_date);
 select * into source from campus.treasury_settlements where institution_id=tenant and id=original for update;
 if not found or source.status<>'posted' or source.reversal_of is not null or posting_date<source.posting_date then raise exception 'posted original settlement and valid reversal date required';end if;
 perform 1 from campus.bank_lines where institution_id=tenant and id=source.bank_line_id for update;
 if not exists(select 1 from campus.treasury_settlement_claims where institution_id=tenant and bank_line_id=source.bank_line_id and settlement_id=original)then raise exception 'original settlement already reversed';end if;
 select jsonb_agg(jsonb_set(p.value,'{lines}',(select jsonb_agg(jsonb_build_object('account_id',l.value->>'account_id','debit_minor',l.value->>'credit_minor','credit_minor',l.value->>'debit_minor')order by l.ordinality)from jsonb_array_elements(p.value->'lines')with ordinality l))order by p.ordinality)
  into plans from jsonb_array_elements(source.snapshot->'plans')with ordinality p;
 reversal_snapshot:=jsonb_set(source.snapshot,'{plans}',plans);
 insert into campus.treasury_settlements(institution_id,id,bank_line_id,period_id,posting_date,cash_profile_id,accrual_profile_id,snapshot,reversal_of,reason,prepared_by)
  values(tenant,reversal,source.bank_line_id,period,posting_date,source.cash_profile_id,source.accrual_profile_id,reversal_snapshot,original,trim(reason),auth.uid());
 insert into campus.treasury_audit(institution_id,subject_id,actor_id,action,version)values(tenant,reversal,auth.uid(),'settlement_reversal_prepared',1);return 1;
end $$;
create function campus.transition_settlement(tenant uuid,settlement uuid,expected_version integer,target text)returns integer language plpgsql security definer set search_path='' as $$
declare source campus.treasury_settlements;caller text;plan jsonb;entries jsonb;journal uuid;original_journal uuid;item jsonb;
begin
 caller:=campus.member_role(tenant);if coalesce(caller,'')not in('bursar','student_accounts','reviewer')then raise exception 'permission denied' using errcode='42501';end if;
 select * into source from campus.treasury_settlements where institution_id=tenant and id=settlement for update;
 if not found then raise exception 'settlement unavailable';end if;
 if expected_version is null or source.version<>expected_version then raise exception 'version conflict' using errcode='40001';end if;
 if target='cancelled'then
  if source.status in('posted','cancelled')or(caller<>'bursar'and(source.prepared_by<>auth.uid()or source.status<>'draft'))then raise exception 'permission denied' using errcode='42501';end if;
  if source.reversal_of is null then delete from campus.treasury_settlement_claims where institution_id=tenant and settlement_id=settlement;end if;
 else
  perform campus.check_revenue_period(tenant,source.period_id,source.posting_date);
  if not((source.status='draft'and target='submitted')or(source.status='submitted'and target='reviewed')or(source.status='reviewed'and target='approved')or(source.status='approved'and target='posted'))then raise exception 'invalid settlement transition';end if;
  if target='submitted'and(source.prepared_by<>auth.uid()or caller not in('bursar','student_accounts'))then raise exception 'permission denied' using errcode='42501';end if;
  if target='reviewed'and(caller not in('reviewer','bursar')or source.prepared_by=auth.uid())then raise exception 'independent reviewer required' using errcode='42501';end if;
  if target='approved'and(caller<>'bursar'or source.prepared_by=auth.uid())then raise exception 'independent approver required' using errcode='42501';end if;
  if target='posted'and caller<>'bursar'then raise exception 'permission denied' using errcode='42501';end if;
  if target in('approved','posted')then
   perform 1 from campus.bank_lines where institution_id=tenant and id=source.bank_line_id for update;
   if not exists(select 1 from campus.treasury_settlement_claims where institution_id=tenant and bank_line_id=source.bank_line_id and settlement_id=coalesce(source.reversal_of,source.id))then raise exception 'settlement claim unavailable';end if;
   if source.reversal_of is null and campus.settlement_snapshot(tenant,source.bank_line_id,source.posting_date,source.cash_profile_id,source.accrual_profile_id)<>source.snapshot then raise exception 'settlement snapshot changed';end if;
  end if;
  if target='posted'then
   insert into campus.treasury_posting_authority values(tenant,settlement,txid_current());
   for plan in select value from jsonb_array_elements(source.snapshot->'plans')loop
    original_journal:=null;
    if source.reversal_of is null then entries:=plan->'lines';
    else
     select id into original_journal from campus.journals where institution_id=tenant and source_id=source.reversal_of and basis=plan->>'basis' and status='posted';
     if not found then raise exception 'original settlement journal unavailable';end if;
     select jsonb_agg(jsonb_build_object('account_id',account_id,'debit_minor',credit_minor::text,'credit_minor',debit_minor::text)order by line_no)into entries from campus.journal_lines where institution_id=tenant and journal_id=original_journal;
     if entries<>plan->'lines'then raise exception 'reversal snapshot differs from original ledger';end if;
    end if;
    journal:=gen_random_uuid();perform campus.create_journal(tenant,journal,plan->>'basis',(plan->>'policy_id')::uuid,source.period_id,settlement,source.posting_date,entries);
    update campus.journals set status='posted',version=2,prepared_by=source.prepared_by,reviewed_by=source.reviewed_by,approved_by=source.approved_by,reversal_of=original_journal,reversal_reason=case when original_journal is not null then source.reason else null end where institution_id=tenant and id=journal;
    insert into campus.audit_events(institution_id,actor_id,journal_id,action,version)values(tenant,auth.uid(),journal,case when original_journal is null then 'approved_settlement_posted'else 'settlement_reversal_posted'end,2);
    if source.reversal_of is null then
     for item in select value from jsonb_array_elements(source.snapshot->'sources')loop
      insert into campus.treasury_consumptions values(tenant,settlement,(item->>'event_id')::uuid,plan->>'basis',(plan->>'clearing_account_id')::uuid,(item->>'amount_minor')::numeric);
     end loop;
    end if;
   end loop;
   delete from campus.treasury_posting_authority where institution_id=tenant and settlement_id=settlement and transaction_id=txid_current();
   if source.reversal_of is not null then delete from campus.treasury_settlement_claims where institution_id=tenant and settlement_id=source.reversal_of;end if;
  end if;
 end if;
 update campus.treasury_settlements set status=target,version=version+1,reviewed_by=case when target='reviewed'then auth.uid()else reviewed_by end,approved_by=case when target='approved'then auth.uid()else approved_by end where institution_id=tenant and id=settlement;
 insert into campus.treasury_audit(institution_id,subject_id,actor_id,action,version)values(tenant,settlement,auth.uid(),target,expected_version+1);return expected_version+1;
end $$;
create function campus.guard_treasury_journal()returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.reversal_of is not null and exists(select 1 from campus.journals j join campus.treasury_settlements s on s.institution_id=j.institution_id and s.id=j.source_id where j.institution_id=new.institution_id and j.id=new.reversal_of)and not exists(
  select 1 from campus.journals j join campus.treasury_settlements s on s.institution_id=j.institution_id and s.reversal_of=j.source_id where j.institution_id=new.institution_id and j.id=new.reversal_of and s.id=new.source_id and j.basis=new.basis)then raise exception 'treasury journal requires coordinated settlement reversal';end if;
 if exists(select 1 from campus.treasury_settlements where institution_id=new.institution_id and id=new.source_id)and not exists(select 1 from campus.treasury_posting_authority where institution_id=new.institution_id and settlement_id=new.source_id and transaction_id=txid_current())then raise exception 'treasury journal requires controlled posting' using errcode='42501';end if;
 return new;
end $$;
create trigger guard_treasury_journal before insert or update of status,reversal_of on campus.journals for each row execute function campus.guard_treasury_journal();
create function campus.guard_settlement_period_close()returns trigger language plpgsql security definer set search_path='' as $$
begin
 if new.locked and not old.locked and exists(select 1 from campus.treasury_settlements where institution_id=new.institution_id and period_id=new.id and status not in('posted','cancelled'))then raise exception 'unposted settlements remain';end if;return new;
end $$;
create trigger settlement_period_close before update of locked on campus.periods for each row execute function campus.guard_settlement_period_close();
create function campus.settlement_schedule(tenant uuid)returns jsonb language plpgsql stable security invoker set search_path='' as $$
begin
 if campus.member_role(tenant)is null then raise exception 'permission denied'using errcode='42501';end if;
 return jsonb_build_object('profiles',(select coalesce(jsonb_agg(to_jsonb(p)),'[]'::jsonb)from(select id,bank_source_id,basis,policy_id,effective_from,settings,bank_account_id,clearing_account_id,fee_account_id,variance_account_id,limit_minor::text,prepared_by,approved_by,version from campus.settlement_profiles where institution_id=tenant order by effective_from,id limit 100)p),
  'tolerances',(select coalesce(jsonb_agg(to_jsonb(t)),'[]'::jsonb)from(select id,bank_line_id,side,event_id,amount_minor::text,cash_profile_id,accrual_profile_id,reason,status,version,prepared_by,reviewed_by,approved_by,approval_note,void_prepared_by,void_reviewed_by,void_approved_by,void_reason from campus.reconciliation_tolerances where institution_id=tenant order by id limit 100)t),
  'settlements',(select coalesce(jsonb_agg(to_jsonb(s)),'[]'::jsonb)from(select id,bank_line_id,period_id,posting_date,cash_profile_id,accrual_profile_id,snapshot,reversal_of,reason,status,version,prepared_by,reviewed_by,approved_by,
   (select coalesce(jsonb_agg(jsonb_build_object('id',j.id,'basis',j.basis,'status',j.status,'version',j.version,'reversal_of',j.reversal_of)order by j.basis),'[]'::jsonb)from campus.journals j where j.institution_id=tenant and j.source_id=ts.id)as journals
   from campus.treasury_settlements ts where institution_id=tenant order by posting_date,id limit 100)s));
end $$;
revoke all on function campus.settlement_leg(uuid,numeric,boolean),campus.settlement_snapshot(uuid,uuid,date,uuid,uuid),campus.guard_treasury_journal(),campus.guard_settlement_period_close()from public,authenticated;
revoke all on function campus.prepare_settlement(uuid,uuid,uuid,uuid,date,uuid,uuid),campus.prepare_settlement_reversal(uuid,uuid,uuid,uuid,date,text),campus.transition_settlement(uuid,uuid,integer,text),campus.settlement_schedule(uuid)from public;
grant execute on function campus.prepare_settlement(uuid,uuid,uuid,uuid,date,uuid,uuid),campus.prepare_settlement_reversal(uuid,uuid,uuid,uuid,date,text),campus.transition_settlement(uuid,uuid,integer,text),campus.settlement_schedule(uuid)to authenticated;
commit;
