-- Run in your own Supabase project SQL editor. No public write policies.
create table if not exists public.products (
 id text primary key, name text not null, category text not null,
 short text not null default '', description text not null default '',
 features jsonb not null default '[]'::jsonb,
 amounts jsonb not null default '{}'::jsonb,
 status text not null default 'draft' check (status in ('draft','published','archived')),
 delivery_ready boolean not null default false,
 blob_pathnames jsonb not null default '[]'::jsonb,
 channels jsonb not null default '{}'::jsonb,
 created_at timestamptz not null default now(),
 updated_at timestamptz not null default now()
);
alter table public.products enable row level security;
-- Service-role access only through protected Vercel functions.
