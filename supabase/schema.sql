-- ============================================================
-- Engada Pochu — Supabase schema (free tier, no credit card)
-- How to use:
--   1. Create a free project at https://supabase.com
--   2. Open SQL Editor → New query → paste this file → Run
--   3. Authentication → Providers → Email: enable "Confirm email" OFF
--      (we use signInWithOtp which creates the user on first code)
--   4. Project Settings → API: copy Project URL + anon public key
--      into .env (VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY)
-- ============================================================

create table if not exists profiles (
  id uuid primary key references auth.users (id) on delete cascade,
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  settings jsonb not null default '{}'
);

create table if not exists categories (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  name text not null,
  emoji text,
  is_builtin boolean not null default false,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create table if not exists people (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  name text not null,
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz
);

create table if not exists transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references profiles (id) on delete cascade,
  person_id uuid references people (id) on delete set null,
  category_id uuid references categories (id) on delete set null,
  amount numeric(14,2) not null check (amount > 0),
  currency char(3) not null default 'INR',
  direction text not null check (direction in ('sent', 'received')),
  note text,
  source text not null default 'manual' check (source in ('voice', 'manual')),
  raw_speech text,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz,
  deleted_at timestamptz
);

create index if not exists tx_user_occurred on transactions (user_id, occurred_at desc);
create index if not exists tx_user_person on transactions (user_id, person_id);
create index if not exists tx_user_category on transactions (user_id, category_id);
create index if not exists tx_user_updated on transactions (user_id, updated_at);
create index if not exists people_user_updated on people (user_id, updated_at);
create index if not exists people_user_name on people (user_id, lower(name));
create index if not exists categories_user_updated on categories (user_id, updated_at);
create index if not exists categories_user_name on categories (user_id, lower(name));

-- Row Level Security: every user can only ever see/touch their own rows.
-- This is what makes the anon key safe to ship in a frontend app.
alter table profiles enable row level security;
alter table categories enable row level security;
alter table people enable row level security;
alter table transactions enable row level security;

drop policy if exists "profiles: own" on profiles;
create policy "profiles: own" on profiles
  for all using (auth.uid() = id) with check (auth.uid() = id);

drop policy if exists "categories: own" on categories;
create policy "categories: own" on categories
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "people: own" on people;
create policy "people: own" on people
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "transactions: own" on transactions;
create policy "transactions: own" on transactions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

grant usage on schema public to authenticated;
grant all on profiles, categories, people, transactions to authenticated;
