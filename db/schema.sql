-- KaantaMandi database (Supabase Postgres). Run once: Supabase → SQL editor → paste → Run.
-- Safe to run again. The server (server/supabase.js) reads and writes these tables with the secret key.
--
-- Each record is one row: `id` plus the full record in `doc` (jsonb). A few columns are generated from
-- `doc` so the Table editor is readable and they can be indexed; the app never writes them directly.
-- Row-level security is ON with no policies: the public anon key sees nothing. Never put the secret key
-- in the website or the mobile app.

create or replace function km_touch() returns trigger language plpgsql as $$
begin new.updated_at = now(); return new; end $$;

create table if not exists users (
  id text primary key, doc jsonb not null, updated_at timestamptz not null default now(),
  role text generated always as (doc->>'role') stored,
  email text generated always as (lower(doc->>'email')) stored,
  name text generated always as (doc->>'name') stored,
  business text generated always as (doc->>'business') stored,
  guest boolean generated always as (coalesce((doc->>'guest')::boolean, false)) stored
);
create index if not exists users_email on users (email);

create table if not exists sessions (
  id text primary key, doc jsonb not null, updated_at timestamptz not null default now(),
  user_id text generated always as (doc->>'uid') stored
);
create index if not exists sessions_user on sessions (user_id);

create table if not exists suppliers (
  id text primary key, doc jsonb not null, updated_at timestamptz not null default now(),
  name text generated always as (doc->>'name') stored,
  city text generated always as (doc->>'city') stored,
  owner_id text generated always as (doc->>'ownerId') stored
);

create table if not exists rfqs (
  id text primary key, doc jsonb not null, updated_at timestamptz not null default now(),
  owner_id text generated always as (doc->>'ownerId') stored,
  product text generated always as (doc->>'productId') stored,
  status text generated always as (doc->>'status') stored
);
create index if not exists rfqs_owner on rfqs (owner_id);

create table if not exists orders (
  id text primary key, doc jsonb not null, updated_at timestamptz not null default now(),
  owner_id text generated always as (doc->>'ownerId') stored,
  supplier_id text generated always as (doc->>'sid') stored,
  stage text generated always as (doc->>'stage') stored
);
create index if not exists orders_owner on orders (owner_id);
create index if not exists orders_supplier on orders (supplier_id);

create table if not exists plan_payments (id text primary key, doc jsonb not null, updated_at timestamptz not null default now());
create table if not exists signups       (id text primary key, doc jsonb not null, updated_at timestamptz not null default now());
create table if not exists leads         (id text primary key, doc jsonb not null, updated_at timestamptz not null default now());
create table if not exists schedules     (id text primary key, doc jsonb not null, updated_at timestamptz not null default now());
create table if not exists org_invites   (id text primary key, doc jsonb not null, updated_at timestamptz not null default now());
create table if not exists messages      (id text primary key, doc jsonb not null, updated_at timestamptz not null default now());
create table if not exists app_state     (id text primary key, doc jsonb not null, updated_at timestamptz not null default now());

do $$
declare t text;
begin
  foreach t in array array['users','sessions','suppliers','rfqs','orders','plan_payments','signups','leads','schedules','org_invites','messages','app_state'] loop
    execute format('alter table %I enable row level security', t);
    execute format('drop trigger if exists %I on %I', t || '_touch', t);
    execute format('create trigger %I before update on %I for each row execute function km_touch()', t || '_touch', t);
  end loop;
end $$;
