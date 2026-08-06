/* Supabase data layer.
 *
 * Everything the page knows about projects comes through here. Two things are
 * deliberately not done in the browser:
 *
 *   - Release links are never fetched until the countdown has finished. The
 *     database refuses to return one early, so an unreleased link genuinely is
 *     not obtainable rather than merely hidden.
 *   - Writes go through admin_* functions that check the admin code in the
 *     database. The tables themselves are read-only to anonymous callers.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export const supa = createClient(window.SUPABASE_URL, window.SUPABASE_ANON_KEY, {
  auth: { persistSession: false }
});

export const configured = /^https:\/\/[a-z0-9-]+\.supabase\.co/.test(window.SUPABASE_URL || '');

/* ---------------- clock ----------------
   Countdowns run against the database clock, not the visitor's, so a device
   running fast or slow shows the same remaining time as everyone else. */
let skew = 0;
export function now() { return Date.now() + skew; }

export async function syncClock() {
  const t0 = Date.now();
  const { data, error } = await supa.rpc('server_now');
  if (error || !data) return;
  const rtt = Date.now() - t0;
  // Assume the reply took half the round trip to reach us.
  skew = new Date(data).getTime() + rtt / 2 - Date.now();
}

/* ---------------- reading ---------------- */

export async function fetchProjects() {
  const [{ data: games, error: e1 }, { data: updates, error: e2 }] = await Promise.all([
    supa.from('games').select('*').order('release', { ascending: true, nullsFirst: false }),
    supa.from('game_updates').select('*').order('released', { ascending: false })
  ]);
  if (e1) throw new Error(e1.message);
  if (e2) throw new Error(e2.message);

  const byGame = new Map();
  (updates || []).forEach(u => {
    if (!byGame.has(u.game_id)) byGame.set(u.game_id, []);
    byGame.get(u.game_id).push({
      version: u.version || '',
      date: u.released ? new Date(u.released) : null,
      notes: u.notes || ''
    });
  });

  return (games || []).map(g => ({
    id: g.id,
    title: g.title,
    desc: g.description || '',
    kind: (g.kind || 'game').toLowerCase(),
    action: (g.action || 'play').toLowerCase(),
    release: g.release ? new Date(g.release) : null,
    hype: g.hype || 0,
    updates: byGame.get(g.id) || [],
    link: null                      // filled in by fetchLink() once released
  }));
}

// Only succeeds after the release time — the check is server-side.
export async function fetchLink(id) {
  const { data, error } = await supa.rpc('get_link', { p_game: id });
  if (error) return null;
  return data || null;
}

export async function addHype(id) {
  const { data, error } = await supa.rpc('add_hype', { p_game: id });
  if (error) throw new Error(error.message);
  return data;
}

export async function removeHype(id) {
  const { data, error } = await supa.rpc('remove_hype', { p_game: id });
  if (error) throw new Error(error.message);
  return data;
}

/* ---------------- realtime ----------------
   Changes arrive over a websocket the moment they are saved, so there is no
   polling and no rate limit to run into. */
export function subscribe(onChange) {
  return supa.channel('projects')
    .on('postgres_changes', { event: '*', schema: 'public', table: 'games' }, onChange)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'game_updates' }, onChange)
    .subscribe();
}

/* ---------------- writing (admin) ---------------- */

export async function saveGame(code, g) {
  const { data, error } = await supa.rpc('admin_save_game', {
    code,
    p_id: g.id || null,
    p_title: g.title,
    p_kind: g.kind,
    p_desc: g.desc,
    p_release: g.release,
    p_action: g.action,
    p_url: g.url
  });
  if (error) throw new Error(error.message);
  return data;
}

export async function addUpdate(code, gameId, u) {
  const { error } = await supa.rpc('admin_add_update', {
    code,
    p_game: gameId,
    p_version: u.version,
    p_released: u.date,
    p_notes: u.notes
  });
  if (error) throw new Error(error.message);
}

export async function deleteGame(code, id) {
  const { error } = await supa.rpc('admin_delete_game', { code, p_id: id });
  if (error) throw new Error(error.message);
}

export async function adminGetLink(code, id) {
  const { data, error } = await supa.rpc('admin_get_link', { code, p_game: id });
  if (error) throw new Error(error.message);
  return data || '';
}
