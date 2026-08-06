-- Jakub's Upcoming Sites/Games — Supabase schema
-- Run this once in the Supabase SQL editor (Dashboard → SQL → New query).
--
-- Design notes:
--   * Release links live in a separate table that anonymous visitors cannot read
--     at all. The only way to get one is get_link(), which refuses until the
--     release time has passed. That is enforced by the database, so a link
--     cannot be dug out of the page early.
--   * Public tables are readable by everyone and writable by no one. Every write
--     goes through an admin_* function that checks the admin code server-side.
--   * Realtime broadcasts rows from the public tables only, so nothing secret
--     travels over the websocket.

-- ---------------------------------------------------------------- tables

create table if not exists public.games (
  id          uuid primary key default gen_random_uuid(),
  title       text not null,
  kind        text not null default 'game' check (kind in ('game', 'site')),
  description text not null default '',
  release     timestamptz,
  action      text not null default 'play' check (action in ('play', 'download')),
  hype        integer not null default 0,
  created_at  timestamptz not null default now()
);

create table if not exists public.game_updates (
  id       uuid primary key default gen_random_uuid(),
  game_id  uuid not null references public.games(id) on delete cascade,
  version  text not null default '',
  released timestamptz not null default now(),
  notes    text not null default ''
);
create index if not exists game_updates_game_id_idx on public.game_updates(game_id);

-- Secret until release. No anon access, ever.
create table if not exists public.game_links (
  game_id uuid primary key references public.games(id) on delete cascade,
  url     text not null default ''
);

-- Server-side settings. Not readable by anon.
create table if not exists public.app_settings (
  key   text primary key,
  value text not null
);

-- The admin code. Change it here and the site follows — it is compared
-- server-side, so editing this row is what actually controls write access.
insert into public.app_settings (key, value)
values ('admin_code', 'jfbbb123')
on conflict (key) do nothing;

-- ---------------------------------------------------------------- security

alter table public.games        enable row level security;
alter table public.game_updates enable row level security;
alter table public.game_links   enable row level security;
alter table public.app_settings enable row level security;

-- Anyone may read the public tables.
drop policy if exists games_read on public.games;
create policy games_read on public.games for select using (true);

drop policy if exists updates_read on public.game_updates;
create policy updates_read on public.game_updates for select using (true);

-- game_links and app_settings deliberately have no policies at all, so no
-- anonymous request can read or write them. Only the security-definer
-- functions below can touch them.

-- ---------------------------------------------------------------- functions

create or replace function public.check_code(code text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if code is null or code <> (select value from app_settings where key = 'admin_code') then
    raise exception 'Wrong admin code';
  end if;
end $$;

-- The release link, and only once the countdown has finished.
create or replace function public.get_link(p_game uuid)
returns text language plpgsql security definer set search_path = public as $$
declare
  rel timestamptz;
begin
  select release into rel from games where id = p_game;
  if rel is null or rel > now() then
    return null;                      -- not out yet: nothing to hand over
  end if;
  return (select url from game_links where game_id = p_game);
end $$;

-- Server clock, so every visitor counts down against the same time.
create or replace function public.server_now()
returns timestamptz language sql stable as $$ select now() $$;

-- Hype: a shared counter. The browser remembers whether it has hyped a given
-- project and calls add/remove accordingly, so hyping and un-hyping cancel out
-- instead of ratcheting the number upwards.
create or replace function public.add_hype(p_game uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  n integer;
begin
  update games set hype = hype + 1 where id = p_game returning hype into n;
  return n;
end $$;

create or replace function public.remove_hype(p_game uuid)
returns integer language plpgsql security definer set search_path = public as $$
declare
  n integer;
begin
  -- greatest() keeps the counter from going negative if state ever disagrees.
  update games set hype = greatest(hype - 1, 0) where id = p_game returning hype into n;
  return n;
end $$;

create or replace function public.admin_save_game(
  code text, p_id uuid, p_title text, p_kind text, p_desc text,
  p_release timestamptz, p_action text, p_url text
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  gid uuid;
begin
  perform check_code(code);

  if p_id is null then
    insert into games (title, kind, description, release, action)
    values (p_title, p_kind, coalesce(p_desc, ''), p_release, p_action)
    returning id into gid;
  else
    update games set title = p_title, kind = p_kind, description = coalesce(p_desc, ''),
                     release = p_release, action = p_action
    where id = p_id returning id into gid;
    if gid is null then raise exception 'No such game'; end if;
  end if;

  insert into game_links (game_id, url) values (gid, coalesce(p_url, ''))
  on conflict (game_id) do update set url = excluded.url;

  return gid;
end $$;

create or replace function public.admin_add_update(
  code text, p_game uuid, p_version text, p_released timestamptz, p_notes text
) returns uuid language plpgsql security definer set search_path = public as $$
declare
  uid uuid;
begin
  perform check_code(code);
  insert into game_updates (game_id, version, released, notes)
  values (p_game, coalesce(p_version, ''), coalesce(p_released, now()), coalesce(p_notes, ''))
  returning id into uid;
  return uid;
end $$;

create or replace function public.admin_delete_game(code text, p_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform check_code(code);
  delete from games where id = p_id;
end $$;

-- The admin form needs to read back the link it saved; gated by the code.
create or replace function public.admin_get_link(code text, p_game uuid)
returns text language plpgsql security definer set search_path = public as $$
begin
  perform check_code(code);
  return (select url from game_links where game_id = p_game);
end $$;

-- ---------------------------------------------------------------- grants

revoke all on public.game_links, public.app_settings from anon, authenticated;

grant execute on function public.get_link(uuid)          to anon, authenticated;
grant execute on function public.server_now()            to anon, authenticated;
grant execute on function public.add_hype(uuid)          to anon, authenticated;
grant execute on function public.remove_hype(uuid)       to anon, authenticated;
grant execute on function public.admin_save_game(text, uuid, text, text, text, timestamptz, text, text) to anon, authenticated;
grant execute on function public.admin_add_update(text, uuid, text, timestamptz, text) to anon, authenticated;
grant execute on function public.admin_delete_game(text, uuid) to anon, authenticated;
grant execute on function public.admin_get_link(text, uuid)    to anon, authenticated;
revoke execute on function public.check_code(text) from anon, authenticated;

-- ---------------------------------------------------------------- realtime

-- Adding a table that is already published raises 42710, which would abort a
-- re-run of this script, so each one is added only if it is missing.
do $$
begin
  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'games'
  ) then
    alter publication supabase_realtime add table public.games;
  end if;

  if not exists (
    select 1 from pg_publication_tables
    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'game_updates'
  ) then
    alter publication supabase_realtime add table public.game_updates;
  end if;
end $$;
