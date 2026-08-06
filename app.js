/* Jakub's Upcoming Sites/Games — UI layer.
   Data comes from Supabase via data.js; this file renders it. */

import {
  configured, now, syncClock, fetchProjects, fetchLink, addHype, removeHype, subscribe,
  saveGame, addUpdate, deleteGame, adminGetLink
} from './data.js';

const ADMIN_CODE = 'jfbbb123';   // gates the UI; the database checks it again on every write

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

const esc = s => String(s ?? '').replace(/[&<>"']/g,
  c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

/* ---------------- theme ---------------- */
const root = document.documentElement;
setTheme(localStorage.getItem('theme') || 'dark');
function setTheme(t) {
  root.dataset.theme = t;
  localStorage.setItem('theme', t);
  $('#theme').textContent = t === 'dark' ? '🌙' : '☀️';
}
$('#theme').addEventListener('click', () => setTheme(root.dataset.theme === 'dark' ? 'light' : 'dark'));

/* ---------------- tabs ---------------- */
function go(name) {
  $$('.tab').forEach(t => t.classList.toggle('active', t.dataset.tab === name));
  $$('.panel').forEach(p => p.classList.toggle('active', p.id === 'panel-' + name));
  scrollTo({ top: 0, behavior: 'smooth' });
}
$$('.tab').forEach(t => t.addEventListener('click', () => go(t.dataset.tab)));
$('[data-go]').addEventListener('click', e => { e.preventDefault(); go('games'); });

/* ---------------- back to top ---------------- */
const topBtn = $('#top');
addEventListener('scroll', () => topBtn.classList.toggle('on', scrollY > 400), { passive: true });
topBtn.addEventListener('click', () => scrollTo({ top: 0, behavior: 'smooth' }));

const io = new IntersectionObserver(es => {
  es.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
}, { threshold: .12 });

/* ---------------- state ---------------- */
let projects = [];
let bootstrapped = false;
const links = new Map();          // id -> url, only ever populated after release

function statusOf(p) {
  const t = now();
  const live = p.release && +p.release <= t;
  const shipped = p.updates.filter(u => u.date && +u.date <= t);
  const upcoming = p.updates.filter(u => u.date && +u.date > t).sort((a, b) => a.date - b.date);
  return {
    live,
    latest: shipped[0] || null,
    next: upcoming[0] || null,
    target: !live ? p.release : (upcoming[0] ? upcoming[0].date : null),
    targetLabel: !live ? 'release' : 'update'
  };
}

async function refresh() {
  try {
    projects = await fetchProjects();
    note('');
    detectEvents();
    render();
    renderAdminList();
    bootstrapped = true;
  } catch (err) {
    if (projects.length) { note(err.message); return; }
    $('#state').style.display = '';
    $('#state').innerHTML = `Couldn't load projects — ${esc(err.message)}`;
  }
}

/* ---------------- render ---------------- */
function render() {
  const grid = $('#grid'), state = $('#state');
  if (!projects.length) {
    state.style.display = '';
    state.innerHTML = 'No projects yet. Add one from the <b>Admin</b> tab.';
    grid.innerHTML = '';
    renderHyped();
    return;
  }
  state.style.display = 'none';
  grid.innerHTML = projects.map(cardHTML).join('');
  wireCards(grid);
  renderHyped();
  tick();
}

function cardHTML(p) {
  const st = statusOf(p);
  const label = p.action === 'download' ? 'Download ⬇' : 'Open / Play ↗';
  const watching = isWatched(p.id);
  return `<article class="card" data-id="${p.id}">
    <div class="tagrow">
      <span class="kind">${p.kind === 'site' ? 'Site' : 'Game'}</span>
      ${st.latest && st.latest.version ? `<span class="kind ver">v${esc(st.latest.version)}</span>` : ''}
      ${st.live ? '<span class="kind live">Live</span>' : ''}
    </div>
    <h3>${esc(p.title)}</h3>
    <p class="desc">${esc(p.desc)}</p>

    <div class="cd" data-cd="${st.target ? new Date(st.target).toISOString() : ''}" data-for="${st.targetLabel}">
      ${['Days', 'Hours', 'Mins', 'Secs'].map(u => `<div><b>--</b><span>${u}</span></div>`).join('')}
    </div>
    ${st.next ? `<p class="cdnote">Next update${st.next.version ? ` · v${esc(st.next.version)}` : ''}</p>` : ''}
    ${renderUpdates(p, st)}

    <div class="row">
      <a class="btn" data-play="${p.id}" data-label="${label}">${label}</a>
      <button class="btn hype${watching ? ' on' : ''}" data-hype="${p.id}">
        <span class="flame">🔥</span>
        <span class="hcount">${p.hype}</span>
        <span class="hlabel">${watching ? 'Hyped' : 'Hype &amp; notify me'}</span>
      </button>
    </div>
  </article>`;
}

function wireCards(grid) {
  $$('.card', grid).forEach(c => io.observe(c));
  $$('[data-hype]', grid).forEach(b => b.addEventListener('click', () => hypeClick(b.dataset.hype, b)));
}

// The Hyped tab: the same cards, filtered to what this browser has hyped.
function renderHyped() {
  const grid = $('#hypedgrid'), state = $('#hypedstate');
  if (!grid) return;
  const mine = projects.filter(p => isWatched(p.id));
  $('#hypedcount').textContent = mine.length;
  $('#hypedcount').classList.toggle('zero', !mine.length);

  if (!mine.length) {
    state.style.display = '';
    state.innerHTML = 'Nothing hyped yet. Press <b>🔥 Hype &amp; notify me</b> on anything you want to be told about.';
    grid.innerHTML = '';
    return;
  }
  state.style.display = 'none';
  grid.innerHTML = mine.map(cardHTML).join('');
  wireCards(grid);
}

function renderUpdates(p, st) {
  const shipped = p.updates.filter(u => u.date && +u.date <= now());
  if (!shipped.length) return '';
  const items = shipped.map(u => `
    <li><b>${u.version ? 'v' + esc(u.version) : 'Update'}</b>
      <time>${u.date.toLocaleDateString()}</time>
      ${u.notes ? `<p>${esc(u.notes)}</p>` : ''}</li>`).join('');
  return `<details class="updates"${st.live ? ' open' : ''}>
      <summary>What's new <span class="count">${shipped.length}</span></summary>
      <ul>${items}</ul>
    </details>`;
}

// A toast, so a problem is visible whichever tab you are on.
let noteTimer = null;
function note(msg) {
  let el = $('#note');
  if (!el) {
    el = document.createElement('div');
    el.id = 'note';
    document.body.appendChild(el);
  }
  clearTimeout(noteTimer);
  if (!msg) { el.classList.remove('on'); return; }
  el.textContent = '⚠ ' + msg;
  el.classList.add('on');
  noteTimer = setTimeout(() => el.classList.remove('on'), 6000);
}

/* ---------------- countdown ---------------- */
function tick() {
  $$('.cd').forEach(cd => {
    const card = cd.closest('.card');
    const iso = cd.dataset.cd;
    const btn = card.querySelector('[data-play]');
    const id = card.dataset.id;
    const live = card.querySelector('.kind.live');

    if (!iso) {
      if (live) cd.outerHTML = '<div class="released">✦ Out now — go play it</div>';
      else if (!cd.dataset.tba) {
        cd.dataset.tba = '1';
        cd.innerHTML = '<div style="grid-column:1/-1"><b>TBA</b><span>release date</span></div>';
      }
      unlock(btn, id, !!live);
      return;
    }

    const diff = new Date(iso) - now();
    if (diff <= 0) {
      const isUpdate = cd.dataset.for === 'update';
      cd.outerHTML = `<div class="released">✦ ${isUpdate ? 'Update out now' : 'Out now — go play it'}</div>`;
      celebrate(id, isUpdate ? 'update' : 'release');
      unlock(btn, id, true);
      return;
    }

    unlock(btn, id, !!live);
    const d = Math.floor(diff / 864e5), h = Math.floor(diff / 36e5) % 24;
    const m = Math.floor(diff / 6e4) % 60, s = Math.floor(diff / 1e3) % 60;
    [d, h, m, s].forEach((v, i) => {
      const el = cd.children[i] && cd.children[i].querySelector('b');
      if (!el) return;
      const txt = i === 0 ? String(v) : String(v).padStart(2, '0');
      if (el.textContent !== txt) el.textContent = txt;
    });
  });
}
setInterval(tick, 1000);

/* The link is requested from the database only once the countdown has finished.
   Before that the server refuses to hand it over, so there is nothing in the
   page — or reachable from it — that would let someone start early. */
const asked = new Set();
function unlock(btn, id, released) {
  if (!btn) return;
  if (!released) {
    btn.setAttribute('disabled', '');
    btn.removeAttribute('href');
    btn.textContent = '🔒 Locked until release';
    return;
  }
  if (btn.hasAttribute('href')) return;

let url = links.get(id);

if (url && !/^https?:\/\//i.test(url)) {
  url = 'https://' + url;
}

if (url) {
  btn.removeAttribute('disabled');
  btn.href = url;
  btn.target = '_blank';
  btn.rel = 'noopener';
  btn.textContent = btn.dataset.label;
  return;
}
  if (asked.has(id)) return;
  asked.add(id);
  btn.textContent = 'Unlocking…';
  fetchLink(id).then(u => {
    asked.delete(id);
    if (u) { links.set(id, u); tick(); }
    else { btn.setAttribute('disabled', ''); btn.textContent = 'Link coming soon'; }
  });
}

/* ---------------- hype & notifications ---------------- */
const WATCH_KEY = 'watching', SEEN_KEY = 'seen';
const readSet = k => { try { return new Set(JSON.parse(localStorage.getItem(k)) || []); } catch (_) { return new Set(); } };
const writeSet = (k, s) => localStorage.setItem(k, JSON.stringify([...s]));
const isWatched = id => readSet(WATCH_KEY).has(id);

/* One hype per browser per project. The button toggles, and un-hyping gives the
   count back, so clicking it repeatedly cannot inflate the number. Overlapping
   clicks are ignored while a request is in flight. */
const hyping = new Set();

// The same project can be on screen twice (Games/Sites and Hyped), so update
// every button for it, not just the one that was clicked.
function paintHype(id, on, total) {
  $$(`[data-hype="${id}"]`).forEach(b => {
    b.classList.toggle('on', on);
    b.querySelector('.hlabel').textContent = on ? 'Hyped' : 'Hype & notify me';
    if (total !== undefined) b.querySelector('.hcount').textContent = total;
  });
}

async function hypeClick(id, btn) {
  if (hyping.has(id)) return;
  hyping.add(id);
  $$(`[data-hype="${id}"]`).forEach(b => { b.disabled = true; });

  const set = readSet(WATCH_KEY);
  const wasOn = set.has(id);

  // Flip immediately; the count follows what the database reports.
  if (wasOn) set.delete(id); else set.add(id);
  writeSet(WATCH_KEY, set);
  paintHype(id, !wasOn);
  if (!wasOn) {
    btn.classList.remove('pop'); void btn.offsetWidth; btn.classList.add('pop');
    burst(btn);
  }

  try {
    const total = wasOn ? await removeHype(id) : await addHype(id);
    const p = projects.find(x => x.id === id);
    if (p) p.hype = total;
    paintHype(id, !wasOn, total);
    renderHyped();
    note('');
  } catch (err) {
    // Put the subscription back so the button never claims a state the database
    // did not accept — and say why, rather than silently springing back.
    const back = readSet(WATCH_KEY);
    if (wasOn) back.add(id); else back.delete(id);
    writeSet(WATCH_KEY, back);
    paintHype(id, wasOn);
    renderHyped();
    note(/function/i.test(err.message)
      ? 'Hype needs the latest database functions — re-run supabase/schema.sql.'
      : 'Could not save that: ' + err.message);
  } finally {
    hyping.delete(id);
    $$(`[data-hype="${id}"]`).forEach(b => { b.disabled = false; });
  }

  if (!wasOn && 'Notification' in window && Notification.permission === 'default') {
    try { await Notification.requestPermission(); } catch (_) { /* ignore */ }
  }
}

function celebrate(id, kind, versionKey) {
  if (versionKey === undefined) {
    const p = projects.find(x => x.id === id);
    const latest = p && statusOf(p).latest;
    versionKey = kind === 'update' && latest ? (latest.version || String(+latest.date)) : '';
  }
  const key = `${id}:${kind}:${versionKey || ''}`;
  const seen = readSet(SEEN_KEY);
  if (seen.has(key)) return;
  seen.add(key);
  writeSet(SEEN_KEY, seen);
  if (!bootstrapped) return;            // don't celebrate history on first load

  const p = projects.find(x => x.id === id);
  confetti();
  if (isWatched(id) && 'Notification' in window && Notification.permission === 'granted') {
    try {
      new Notification(`${p ? p.title : 'A project'} — ${kind === 'update' ? 'updated' : 'out now'}`, {
        body: kind === 'update' ? 'A new update just went live.' : 'It just released — go play it.',
        icon: 'assets/favicon.svg'
      });
    } catch (_) { /* ignore */ }
  }
}

function detectEvents() {
  projects.forEach(p => {
    const st = statusOf(p);
    if (st.live) celebrate(p.id, 'release', '');
    if (st.latest) celebrate(p.id, 'update', st.latest.version || String(+st.latest.date));
  });
}

/* ---------------- confetti (launches from the bottom) ---------------- */
let cvs, ctx, bits = [], raf = null;

function confetti() {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  if (!cvs) {
    cvs = document.createElement('canvas');
    cvs.id = 'confetti';
    document.body.appendChild(cvs);
    ctx = cvs.getContext('2d');
    addEventListener('resize', sizeCanvas);
  }
  sizeCanvas();
  const colours = ['#ff2b3d', '#b3001b', '#ffffff', '#ff7a86', '#1a1a1f'];
  for (let i = 0; i < 140; i++) {
    bits.push({
      x: Math.random() * cvs.width,
      y: cvs.height + Math.random() * 40,
      vx: (Math.random() - .5) * 5,
      vy: -(11 + Math.random() * 9),
      size: 5 + Math.random() * 7,
      rot: Math.random() * Math.PI,
      spin: (Math.random() - .5) * .3,
      colour: colours[(Math.random() * colours.length) | 0],
      life: 0
    });
  }
  if (!raf) raf = requestAnimationFrame(drawConfetti);
}

function sizeCanvas() { if (cvs) { cvs.width = innerWidth; cvs.height = innerHeight; } }

function drawConfetti() {
  ctx.clearRect(0, 0, cvs.width, cvs.height);
  bits = bits.filter(b => b.life < 260 && b.y < cvs.height + 60);
  bits.forEach(b => {
    b.life++; b.vy += .28; b.vx *= .995;
    b.x += b.vx; b.y += b.vy; b.rot += b.spin;
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(b.rot);
    ctx.globalAlpha = Math.max(0, 1 - b.life / 260);
    ctx.fillStyle = b.colour;
    ctx.fillRect(-b.size / 2, -b.size / 2, b.size, b.size * .6);
    ctx.restore();
  });
  if (bits.length) raf = requestAnimationFrame(drawConfetti);
  else { ctx.clearRect(0, 0, cvs.width, cvs.height); raf = null; }
}

function burst(btn) {
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
  const r = btn.getBoundingClientRect();
  for (let i = 0; i < 8; i++) {
    const s = document.createElement('span');
    s.className = 'spark';
    s.textContent = '🔥';
    s.style.left = (r.left + r.width / 2) + 'px';
    s.style.top = (r.top + r.height / 2) + 'px';
    s.style.setProperty('--dx', ((Math.random() - .5) * 120) + 'px');
    s.style.setProperty('--dy', (-40 - Math.random() * 70) + 'px');
    document.body.appendChild(s);
    setTimeout(() => s.remove(), 900);
  }
}

/* ---------------- admin ---------------- */
const lockBox = $('#lock');
let code = '';                          // held in memory for the session only
let editing = null;                     // id of the project being edited

function tryUnlock() {
  if ($('#code').value.trim() === ADMIN_CODE) {
    code = $('#code').value.trim();
    lockBox.style.display = 'none';
    $('#admin').style.display = 'block';
    sessionStorage.setItem('admin', code);
    renderAdminList();
  } else {
    $('#lockmsg').classList.add('show');
    lockBox.classList.remove('shake'); void lockBox.offsetWidth; lockBox.classList.add('shake');
  }
}
$('#unlock').addEventListener('click', tryUnlock);
$('#code').addEventListener('keydown', e => { if (e.key === 'Enter') tryUnlock(); });
if (sessionStorage.getItem('admin')) {
  code = sessionStorage.getItem('admin');
  lockBox.style.display = 'none';
  $('#admin').style.display = 'block';
}

// Leave the admin panel: forget the code and require it again.
$('#signout').addEventListener('click', () => {
  code = '';
  editing = null;
  sessionStorage.removeItem('admin');
  resetForm();
  $('#formmsg').className = 'msg';
  $('#admin').style.display = 'none';
  lockBox.style.display = '';
  $('#lockmsg').classList.remove('show');
  $('#code').value = '';
  $('#code').focus();
});

const localInput = d => {                // Date -> value for datetime-local
  if (!d) return '';
  const p = n => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}T${p(d.getHours())}:${p(d.getMinutes())}`;
};

$('#save').addEventListener('click', async () => {
  const title = $('#f-title').value.trim();
  const date = $('#f-date').value;
  if (!title) return flash('A name is required.', false);

  flash('Saving…', true);
  try {
    const id = await saveGame(code, {
      id: editing,
      title,
      kind: $('#f-kind').value,
      desc: $('#f-desc').value.trim(),
      release: date ? new Date(date).toISOString() : null,
      action: $('#f-action').value,
      url: $('#f-url').value.trim()
    });

    const ver = $('#f-ver').value.trim(), notes = $('#f-notes').value.trim();
    if (ver || notes) {
      await addUpdate(code, id, {
        version: ver,
        date: new Date($('#f-udate').value || Date.now()).toISOString(),
        notes
      });
    }
    flash(editing ? 'Saved.' : 'Published.', true);
    resetForm();
    refresh();
  } catch (err) {
    flash('Failed: ' + err.message, false);
  }
});

$('#clear').addEventListener('click', resetForm);

function resetForm() {
  ['#f-title', '#f-desc', '#f-date', '#f-url', '#f-ver', '#f-notes', '#f-udate']
    .forEach(s => $(s).value = '');
  editing = null;
  $('#save').textContent = 'Publish';
  $('#editing').textContent = '';
}

async function editGame(id) {
  const p = projects.find(x => x.id === id);
  if (!p) return;
  editing = id;
  $('#f-title').value = p.title;
  $('#f-kind').value = p.kind;
  $('#f-desc').value = p.desc;
  $('#f-date').value = localInput(p.release);
  $('#f-action').value = p.action;
  $('#save').textContent = 'Save changes';
  $('#editing').textContent = `Editing “${p.title}”`;
  try { $('#f-url').value = await adminGetLink(code, id); } catch (_) { $('#f-url').value = ''; }
  $('#f-title').scrollIntoView({ behavior: 'smooth', block: 'center' });
}

async function removeGame(id) {
  const p = projects.find(x => x.id === id);
  if (!confirm(`Delete “${p ? p.title : 'this project'}” and its updates? This cannot be undone.`)) return;
  try { await deleteGame(code, id); refresh(); }
  catch (err) { flash('Failed: ' + err.message, false); }
}

function flash(text, ok) {
  const m = $('#formmsg');
  m.textContent = text;
  m.className = 'msg show ' + (ok ? 'ok' : 'err');
}

function renderAdminList() {
  const list = $('#list');
  if (!list) return;
  if (!projects.length) { list.innerHTML = '<p class="hint">Nothing published yet.</p>'; return; }
  list.innerHTML = projects.map(p => `
    <div class="arow">
      <div>
        <b>${esc(p.title)}</b>
        <div class="hint">${p.release ? p.release.toLocaleString() : 'No date set'} · ${esc(p.kind)} · 🔥${p.hype}</div>
      </div>
      <div class="row">
        <button class="btn ghost" data-edit="${p.id}">Edit</button>
        <button class="btn ghost danger" data-del="${p.id}">Delete</button>
      </div>
    </div>`).join('');
  $$('[data-edit]', list).forEach(b => b.addEventListener('click', () => editGame(b.dataset.edit)));
  $$('[data-del]', list).forEach(b => b.addEventListener('click', () => removeGame(b.dataset.del)));
}

/* ---------------- start ---------------- */
if (!configured) {
  $('#state').innerHTML =
    'Supabase is not configured yet — fill in <code>config.js</code> with your project URL and anon key.';
} else {
  await syncClock();
  await refresh();
  // Realtime: changes show up the moment they are saved, with no polling.
  subscribe(() => refresh());
  // Re-sync the clock occasionally in case the device drifts while open.
  setInterval(syncClock, 10 * 60 * 1000);
}
