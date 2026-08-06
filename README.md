# Jakub's Upcoming Sites/Games

A countdown site for upcoming games and sites. Red / black / white, dark by default.
Static front-end (hosted on Cloudflare), data in Supabase.

## Setup

**1 · Create the database**

Supabase Dashboard → SQL Editor → New query → paste [`supabase/schema.sql`](supabase/schema.sql) → Run.
Optionally run [`supabase/seed.sql`](supabase/seed.sql) to bring the old FB26 entry across.

**2 · Point the site at it**

Edit `config.js`:

```js
window.SUPABASE_URL = 'https://YOUR-PROJECT.supabase.co';
window.SUPABASE_ANON_KEY = 'YOUR-ANON-KEY';
```

Both come from Project Settings → Data API. The anon key is designed to be public — it is
safe in the page. **Never** put the `service_role` key here; that one bypasses every policy.

**3 · Deploy**

Cloudflare Pages → connect this repo. Build command: none. Output directory: `/`.

## How it works

Two tables are public and read-only: `games` and `game_updates`. The page subscribes to them
over **Supabase Realtime**, so a change you save appears on everyone's screen immediately —
no polling, and no rate limit to run into.

### Release links are actually protected

Links live in `game_links`, which anonymous visitors have **no** access to. The only route to
one is `get_link()`, which returns `null` while `release > now()`. The check runs in the
database, so an unreleased link is not in the page, not in the API response, and not
reachable by poking at the site. The button asks for it once the countdown ends.

### Countdowns

Timed against `server_now()` rather than the visitor's own clock, so a device running fast or
slow shows the same remaining time as everyone else. Re-synced every 10 minutes.

### Updates

Add an update to announce a patch. Past updates render as a "What's new" changelog on the card
with the newest version as a badge; an update dated in the future turns the countdown into a
*next update* countdown, and the play button stays unlocked because the project is already out.

### Hype & notifications

One **🔥 Hype & notify me** button per card. It adds to a shared counter everyone can see, and
subscribes you to a notification for that project. When it releases or updates, you get a
browser notification and confetti launches from the bottom of the screen.

The **Hyped** tab collects everything this browser has hyped, soonest first, with a count on
the tab itself.

The button toggles: hyping adds one, un-hyping gives it back, so clicking repeatedly cannot
inflate the number. Un-hyping needs `remove_hype()`, so re-run `schema.sql` if the button
springs back — the site will say so. That is one hype per browser — clearing site data lets the same person
hype again. A hard limit would need accounts, or logging a per-visitor identifier.

Subscriptions are per-browser (`localStorage`) and fire while the site is open in a tab. Real
push-when-closed would need Web Push — a service worker, VAPID keys, and an Edge Function.

## Admin tab

Gated by a code. Publishing, editing, and deleting all go through `admin_*` database functions
that re-check the code server-side, so the tables cannot be written to directly.

**Lock admin** forgets the code and puts the gate back, so it has to be typed in again. The
panel also locks itself when the tab is closed — the code is only ever held for the session.

Change the code by updating the `admin_code` row in `app_settings` **and** `ADMIN_CODE` in
`app.js` — the database is what enforces it, the constant only controls the UI.

**Understand the limit:** the code is typed into the browser and sent with each write, so
anyone who reads the JavaScript can find it and write to the database. It stops casual
tampering, not a determined person. Supabase Auth with a real login would fix that properly,
and the schema is ready for it — swap the `check_code()` call in each `admin_*` function for
`auth.uid() is not null`.
