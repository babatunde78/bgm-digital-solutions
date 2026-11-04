-- Apply once to the store's Supabase project, first in an isolated test project.
begin;

-- Existing product data is preserved. New installs start with no published products.
create table if not exists public.products (
  id text primary key, name text not null, category text not null default 'Digital products',
  short text not null default '', description text not null default '', features jsonb not null default '[]',
  amounts jsonb not null default '{}', status text not null default 'draft',
  delivery_ready boolean not null default false, blob_pathnames text[] not null default '{}',
  created_at timestamptz not null default now()
);
alter table public.products enable row level security;

create table public.store_orders (
  id uuid primary key default gen_random_uuid(),
  reference text not null unique,
  idempotency_key uuid not null,
  session_hash text not null,
  email text not null,
  environment text not null check (environment in ('test','live')),
  product_id text not null,
  product_name text not null,
  amount bigint not null check (amount >= 100 and amount <= 9007199254740991),
  currency text not null check (currency ~ '^[A-Z]{3}$'),
  assets text[] not null check (cardinality(assets) > 0),
  status text not null default 'pending' check (status in ('pending','paid')),
  authorization_url text,
  provider_transaction text,
  initialization_started_at timestamptz,
  created_at timestamptz not null default now(),
  paid_at timestamptz,
  revoked_at timestamptz,
  revocation_reason text,
  reconcile_after timestamptz not null default now(),
  reconcile_attempts integer not null default 0,
  unique(environment, idempotency_key), unique(environment, provider_transaction)
);
create index store_pending_orders on public.store_orders(reconcile_after) where status='pending';
create index store_recovery_lookup on public.store_orders(email, environment) where status='paid';

create table public.store_order_sessions (
  order_id uuid not null references public.store_orders(id), session_hash text not null,
  expires_at timestamptz not null, primary key(order_id, session_hash)
);
create table public.store_events (
  id uuid primary key default gen_random_uuid(), event_key text not null unique,
  event_type text not null, reference text not null, environment text not null,
  state text not null default 'pending' check(state in ('pending','done','review')),
  attempts integer not null default 0, next_attempt timestamptz not null default now(),
  last_error text, created_at timestamptz not null default now()
);
create index store_pending_events on public.store_events(next_attempt) where state='pending';
create table public.store_email_outbox (
  id uuid primary key default gen_random_uuid(), order_id uuid not null references public.store_orders(id),
  kind text not null check(kind in ('receipt','recovery')), dedupe_key text not null unique,
  state text not null default 'pending' check(state in ('pending','sent','review')),
  attempts integer not null default 0, next_attempt timestamptz not null default now(),
  sent_at timestamptz, access_issued_at timestamptz, created_at timestamptz not null default now(), last_error text
);
create index store_pending_emails on public.store_email_outbox(next_attempt) where state='pending';
create table public.store_recovery_tokens (
  token_hash text primary key, order_id uuid not null references public.store_orders(id),
  expires_at timestamptz not null, consumed_at timestamptz
);
create table public.store_rate_limits (
  key text primary key, window_start timestamptz not null default now(), count integer not null default 1
);

-- All mutation functions are server-only SECURITY INVOKER functions. RLS remains enabled.
create function public.store_rate_limit(p_key text, p_limit integer)
returns boolean language plpgsql set search_path = '' as $$
declare hits integer;
begin
  insert into public.store_rate_limits as limits(key) values(p_key)
  on conflict(key) do update set
    count=case when limits.window_start < now()-interval '1 minute' then 1 else limits.count+1 end,
    window_start=case when limits.window_start < now()-interval '1 minute' then now() else limits.window_start end
  returning count into hits;
  return hits <= p_limit;
end $$;

-- The order row is also the entitlement: paid + not revoked grants the snapshotted assets.
-- One attempt/reference per order keeps uncertain initialization retries deterministic.
create function public.store_create_order(p_key uuid, p_session text, p_email text, p_environment text,
  p_product text, p_name text, p_amount bigint, p_currency text, p_assets text[], p_reference text default null)
returns jsonb language plpgsql set search_path = '' as $$
declare o public.store_orders;
begin
  insert into public.store_orders(reference,idempotency_key,session_hash,email,environment,product_id,product_name,amount,currency,assets)
  values(coalesce(p_reference,'bgm-'||gen_random_uuid()::text),p_key,p_session,p_email,p_environment,p_product,p_name,p_amount,p_currency,p_assets)
  on conflict(environment,idempotency_key) do nothing;
  select * into strict o from public.store_orders where environment=p_environment and idempotency_key=p_key;
  if o.session_hash<>p_session or o.email<>p_email or o.product_id<>p_product or o.currency<>p_currency then
    raise exception 'Idempotency key conflict';
  end if;
  return to_jsonb(o);
end $$;

create function public.store_claim_initialization(p_order uuid)
returns boolean language plpgsql set search_path = '' as $$
declare claimed uuid;
begin
  update public.store_orders set initialization_started_at=now()
  where id=p_order and initialization_started_at is null and status='pending'
  returning id into claimed;
  return claimed is not null;
end $$;

create function public.store_confirm_order(p_order uuid,p_transaction text)
returns jsonb language plpgsql set search_path = '' as $$
declare o public.store_orders;
begin
  select * into strict o from public.store_orders where id=p_order for update;
  if o.provider_transaction is not null and o.provider_transaction<>p_transaction then raise exception 'Transaction conflict'; end if;
  if o.revoked_at is not null then return to_jsonb(o); end if;
  update public.store_orders set status='paid',provider_transaction=p_transaction,paid_at=coalesce(paid_at,now())
  where id=p_order returning * into o;
  insert into public.store_email_outbox(order_id,kind,dedupe_key) values(o.id,'receipt','receipt:'||o.id)
  on conflict(dedupe_key) do nothing;
  return to_jsonb(o);
end $$;

create function public.store_queue_recovery(p_reference text,p_email text,p_environment text)
returns void language plpgsql set search_path = '' as $$
begin
  insert into public.store_email_outbox(order_id,kind,dedupe_key)
  select id,'recovery','recovery:'||id||':'||floor(extract(epoch from now())/600)::text
  from public.store_orders where reference=p_reference and email=p_email and environment=p_environment
    and status='paid' and revoked_at is null
  on conflict(dedupe_key) do nothing;
end $$;

create function public.store_exchange_recovery(p_hash text,p_session text,p_environment text)
returns text language plpgsql set search_path = '' as $$
declare t public.store_recovery_tokens; o public.store_orders;
begin
  select * into t from public.store_recovery_tokens where token_hash=p_hash and expires_at>now() and consumed_at is null for update;
  if not found then return null; end if;
  select * into strict o from public.store_orders where id=t.order_id;
  if o.status<>'paid' or o.revoked_at is not null or o.environment<>p_environment then return null; end if;
  update public.store_recovery_tokens set consumed_at=now() where token_hash=p_hash;
  insert into public.store_order_sessions(order_id,session_hash,expires_at) values(o.id,p_session,now()+interval '30 days')
  on conflict(order_id,session_hash) do update set expires_at=excluded.expires_at;
  return o.reference;
end $$;

-- Locks + leases keep overlapping scheduled invocations from claiming the same batch.
create function public.store_claim_work(p_kind text,p_environment text,p_limit integer default 8)
returns jsonb language plpgsql set search_path = '' as $$
declare result jsonb;
begin
  if p_kind='events' then
    with batch as (select id from public.store_events where state='pending' and environment=p_environment and next_attempt<=now()
      order by next_attempt for update skip locked limit least(p_limit,20)),
    claimed as (update public.store_events e set attempts=attempts+1,next_attempt=now()+interval '5 minutes'
      from batch where e.id=batch.id returning e.*)
    select coalesce(jsonb_agg(to_jsonb(claimed)),'[]'::jsonb) into result from claimed;
  elsif p_kind='emails' then
    with batch as (select e.id from public.store_email_outbox e join public.store_orders o on o.id=e.order_id
      where e.state='pending' and o.environment=p_environment and e.next_attempt<=now()
      order by e.next_attempt for update of e skip locked limit least(p_limit,20)),
    claimed as (update public.store_email_outbox e set attempts=attempts+1,next_attempt=now()+interval '5 minutes',access_issued_at=coalesce(access_issued_at,now())
      from batch where e.id=batch.id returning e.*)
    select coalesce(jsonb_agg(to_jsonb(claimed)),'[]'::jsonb) into result from claimed;
  elsif p_kind='orders' then
    with batch as (select id from public.store_orders where status='pending' and revoked_at is null and environment=p_environment
      and reconcile_after<=now() and created_at<now()-interval '1 minute' and reconcile_attempts<100
      order by reconcile_after for update skip locked limit least(p_limit,20)),
    claimed as (update public.store_orders o set reconcile_attempts=reconcile_attempts+1,
      reconcile_after=now()+least(interval '24 hours',interval '1 minute'*power(2,least(o.reconcile_attempts,10)))
      from batch where o.id=batch.id returning o.*)
    select coalesce(jsonb_agg(to_jsonb(claimed)),'[]'::jsonb) into result from claimed;
  else raise exception 'Unknown work kind'; end if;
  return result;
end $$;

create function public.store_maintenance()
returns void language plpgsql set search_path = '' as $$
begin
  delete from public.store_rate_limits where window_start<now()-interval '1 day';
  delete from public.store_order_sessions where expires_at<now();
  delete from public.store_recovery_tokens where expires_at<now()-interval '7 days';
end $$;

do $$
declare table_name text; f record;
begin
  foreach table_name in array array['store_orders','store_order_sessions','store_events','store_email_outbox','store_recovery_tokens','store_rate_limits'] loop
    execute format('alter table public.%I enable row level security',table_name);
    execute format('revoke all on table public.%I from public,anon,authenticated',table_name);
    execute format('grant all on table public.%I to service_role',table_name);
  end loop;
  for f in select p.oid::regprocedure as signature from pg_proc p join pg_namespace n on p.pronamespace=n.oid
    where n.nspname='public' and p.proname like 'store\_%' escape '\' loop
    execute format('revoke all on function %s from public,anon,authenticated',f.signature);
    execute format('grant execute on function %s to service_role',f.signature);
  end loop;
end $$;
grant select on public.products to service_role;
commit;
