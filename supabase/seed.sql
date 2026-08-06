-- Optional: brings the FB26 entry across from the old GitHub issue.
-- Run after schema.sql. Adjust the release time before running — the original
-- was already in the past, so as written the card shows as out now.

with g as (
  insert into public.games (title, kind, description, release, action)
  values ('FB26', 'game', 'COOL FOOTBALL GAME!!', '2026-08-06T19:21:00Z', 'play')
  returning id
)
insert into public.game_links (game_id, url)
select id, 'https://fb26.jakubsenczyszyn2015.workers.dev' from g;
