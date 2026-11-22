alter table public.store_orders add column analytics_recorded_at timestamptz;

create index store_orders_pending_analytics
  on public.store_orders (paid_at, id)
  where environment = 'live' and paid_at is not null and analytics_recorded_at is null;
