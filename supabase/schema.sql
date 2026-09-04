-- The Genius Star — Supabase schema
-- Run this once in the Supabase SQL editor (Dashboard → SQL → New query → paste → Run).
--
-- What it creates
--   profiles : one row per account (nickname), created automatically on sign-up
--   games    : one row per finished puzzle (solo or lobby) for signed-in players
-- Row Level Security makes sure every player can only read and write their own rows.
-- Guests never touch the database (their history stays in their browser).

-- ---------------------------------------------------------------- profiles
create table if not exists public.profiles (
  id          uuid primary key references auth.users (id) on delete cascade,
  nick        text not null check (char_length(nick) between 2 and 16),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles: read own" on public.profiles;
create policy "profiles: read own"
  on public.profiles for select
  using (auth.uid() = id);

drop policy if exists "profiles: update own" on public.profiles;
create policy "profiles: update own"
  on public.profiles for update
  using (auth.uid() = id)
  with check (auth.uid() = id);

-- Create the profile row when a user signs up (nickname comes from the sign-up form).
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  wanted text;
begin
  wanted := regexp_replace(coalesce(new.raw_user_meta_data ->> 'nick', ''), '\s+', ' ', 'g');
  wanted := btrim(left(wanted, 16));
  if char_length(wanted) < 2 then
    wanted := 'Player';
  end if;
  insert into public.profiles (id, nick) values (new.id, wanted)
  on conflict (id) do nothing;
  return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

drop trigger if exists profiles_touch_updated_at on public.profiles;
create trigger profiles_touch_updated_at
  before update on public.profiles
  for each row execute procedure public.touch_updated_at();

-- ---------------------------------------------------------------- games
create table if not exists public.games (
  id            bigint generated always as identity primary key,
  user_id       uuid not null default auth.uid() references auth.users (id) on delete cascade,
  nick          text not null check (char_length(nick) between 1 and 16),
  blocked       smallint[] not null
                check (array_length(blocked, 1) = 7 and 1 <= all (blocked) and 48 >= all (blocked)),
  roll          smallint[]
                check (roll is null or (array_length(roll, 1) = 7 and 1 <= all (roll) and 48 >= all (roll))),
  custom        boolean not null default false,
  time_ms       integer not null check (time_ms >= 0 and time_ms < 86400000),
  golden        boolean not null default false,
  hints         smallint not null default 0 check (hints between 0 and 50),
  revealed      boolean not null default false,
  lobby_code    text check (lobby_code is null or lobby_code ~ '^[A-Z0-9]{5}$'),
  round         smallint check (round is null or round between 1 and 1000),
  rank          smallint check (rank is null or rank between 1 and 5),
  player_count  smallint check (player_count is null or player_count between 1 and 5),
  created_at    timestamptz not null default now()
);

create index if not exists games_user_created_idx on public.games (user_id, created_at desc);

alter table public.games enable row level security;

drop policy if exists "games: read own" on public.games;
create policy "games: read own"
  on public.games for select
  using (auth.uid() = user_id);

drop policy if exists "games: insert own" on public.games;
create policy "games: insert own"
  on public.games for insert
  with check (auth.uid() = user_id);

drop policy if exists "games: delete own" on public.games;
create policy "games: delete own"
  on public.games for delete
  using (auth.uid() = user_id);

-- No update policy on purpose: a logged game is immutable.

-- ---------------------------------------------------------------- notes
-- * Realtime lobbies use Broadcast + Presence channels only; nothing is stored for them.
-- * Recommended Auth settings (Dashboard → Authentication → Providers → Email):
--     - "Confirm email" ON  (players verify their address before signing in), or OFF for a quick demo.
--     - Minimum password length 8+.
