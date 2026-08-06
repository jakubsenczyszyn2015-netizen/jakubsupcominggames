/* Jakub's Upcoming Sites/Games
   Data source: GitHub Issues labelled "game" in this repository.
   Each issue body carries a ```json fenced block:
   { "kind": "game", "release": "2026-12-24T18:00:00Z", "url": "...", "action": "play", "desc": "..." }
*/

const REPO = 'jakubsenczyszyn2015-netizen/jakubsupcominggames';
const LABEL = 'game';
const ADMIN_CODE = 'jfbbb123';

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

/* ---------------- theme ---------------- */
const root = document.documentElement;
const savedTheme = localStorage.getItem('theme') || 'dark';
setTheme(savedTheme);

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
  window.scrollTo({ top: 0, behavior: 'smooth' });
}
$$('.tab').forEach(t => t.addEventListener('click', () => go(t.dataset.tab)));
$('[data-go]').addEventListener('click', e => { e.preventDefault(); go('games'); });

/* ---------------- back to top ---------------- */
const topBtn = $('#top');
addEventListener('scroll', () => topBtn.classList.toggle('on', scrollY > 400), { passive: true });
topBtn.addEventListener('click', () => scrollTo({ top: 0, behavior: 'smooth' }));

/* ---------------- reveal on scroll ---------------- */
const io = new IntersectionObserver(entries => {
  entries.forEach(e => { if (e.isIntersecting) { e.target.classList.add('in'); io.unobserve(e.target); } });
}, { threshold: .12 });

/* ---------------- clock ----------------
   Countdowns must not depend on the visitor's own clock — a device running a few
   minutes fast or slow made the same timer read differently for different people.
   Every GitHub response carries a Date header, so the offset between that and the
   local clock is measured once per poll and applied to every countdown. */
let skew = 0;                       // serverTime - localTime, in ms
function now() { return Date.now() + skew; }

/* ---------------- load data ---------------- */
let projects = [];

function decodeLink(b64) {
  if (!b64) return '';
  try { return decodeURIComponent(escape(atob(b64))); } catch (_) { return ''; }
}
function encodeLink(url) {
  return btoa(unescape(encodeURIComponent(url)));
}

// Accept "example.com/thing" as well as a full URL.
function normaliseUrl(u) {
  u = (u || '').trim();
  if (!u) return '';
  if (/^https?:\/\//i.test(u)) return u;
  if (/^(javascript|data|vbscript):/i.test(u)) return '';
  return 'https://' + u.replace(/^\/+/, '');
}

// Some clients store the body with HTML entities (&quot; / &#34;) instead of
// raw quotes, which breaks JSON.parse — decode before parsing.
function unentity(s) {
  const t = document.createElement('textarea');
  t.innerHTML = s;
  return t.value;
}

function parseIssue(issue) {
  const body = issue.body || '';
  let data = null;
  const fence = body.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const raw = fence ? fence[1] : body;
  for (const candidate of [raw, unentity(raw)]) {
    try { data = JSON.parse(candidate); break; } catch (_) { /* try next */ }
  }
  if (!data || typeof data !== 'object') return null;
  const release = data.release ? new Date(data.release) : null;

  // Updates: newest first, each { version, date, notes }. An update dated in the
  // future is treated as an upcoming update and gets its own countdown.
  const updates = (Array.isArray(data.updates) ? data.updates : [])
    .map(u => ({
      version: String(u.version || '').trim(),
      date: u.date && !isNaN(new Date(u.date)) ? new Date(u.date) : null,
      notes: String(u.notes || '').trim()
    }))
    .filter(u => u.version || u.notes)
    .sort((a, b) => (b.date || 0) - (a.date || 0));

  return {
    id: issue.number,
    title: issue.title,
    url: issue.html_url,
    desc: data.desc || '',
    kind: (data.kind || 'game').toLowerCase(),
    action: (data.action || 'play').toLowerCase(),
    // url_b64 keeps the link out of the issue as readable text; plain url still works.
    link: normaliseUrl(data.url || decodeLink(data.url_b64)),
    release: release && !isNaN(release) ? release : null,
    updates,
    hype: issue.reactions ? issue.reactions.total_count : 0
  };
}

// A project's live status, derived from the corrected clock.
function statusOf(p) {
  const t = now();
  const live = p.release && p.release <= t;
  const shipped = p.updates.filter(u => u.date && u.date <= t);
  const upcoming = p.updates.filter(u => u.date && u.date > t).sort((a, b) => a.date - b.date);
  return {
    live,
    latest: shipped[0] || null,             // most recent shipped update
    next: upcoming[0] || null,              // next update still to land
    // What the countdown on this card is aiming at.
    target: !live ? p.release : (upcoming[0] ? upcoming[0].date : null),
    targetLabel: !live ? 'release' : 'update'
  };
}

const CACHE_KEY = 'lastIssues';
let etag = null;
let bootstrapped = false;

// Render from the last good API response (used when the API is unavailable).
function loadCache() {
  try {
    const cached = JSON.parse(localStorage.getItem(CACHE_KEY));
    if (!Array.isArray(cached) || !cached.length) return false;
    projects = cached.map(parseIssue).filter(Boolean).sort((a, b) => {
      if (!a.release) return 1;
      if (!b.release) return -1;
      return a.release - b.release;
    });
    if (!projects.length) return false;
    detectUpdates();
    render();
    renderAdminList();
    bootstrapped = true;
    return true;
  } catch (_) { return false; }
}
let remaining = null;      // x-ratelimit-remaining from the last response
let resetAt = 0;           // epoch ms when the quota refills
let inFlight = false;

async function load() {
  const state = $('#state');
  if (inFlight) return;
  inFlight = true;
  try {
    // Only open issues are requested, so closing an issue removes its card on
    // the next poll. Anything without a valid JSON block is ignored, so a
    // missing "game" label never hides a project.
    const headers = { Accept: 'application/vnd.github+json' };
    // Conditional request: unchanged data comes back as a small 304.
    if (etag) headers['If-None-Match'] = etag;

    const res = await fetch(`https://api.github.com/repos/${REPO}/issues?state=open&per_page=100`, { headers });

    // Re-sync the clock on every response, including a 304.
    const serverDate = res.headers.get('Date');
    if (serverDate) {
      const t = new Date(serverDate).getTime();
      if (!isNaN(t)) skew = t - Date.now();
    }

    // Track the quota so polling can slow down before GitHub starts refusing.
    const rem = res.headers.get('X-RateLimit-Remaining');
    const rst = res.headers.get('X-RateLimit-Reset');
    if (rem !== null) remaining = +rem;
    if (rst !== null) resetAt = +rst * 1000;

    if (res.status === 304) return;               // nothing changed
    if (res.status === 403 || res.status === 429) {
      throw new Error(remaining === 0
        ? `rate limited — GitHub allows 60 requests an hour and this browser has used them all. Back at ${new Date(resetAt).toLocaleTimeString()}.`
        : 'GitHub refused the request (403).');
    }
    if (!res.ok) throw new Error('GitHub API returned ' + res.status);
    etag = res.headers.get('ETag');

    const issues = (await res.json()).filter(i => !i.pull_request);
    projects = issues.map(parseIssue).filter(Boolean).sort((a, b) => {
      if (!a.release) return 1;
      if (!b.release) return -1;
      return a.release - b.release;
    });
    try { localStorage.setItem(CACHE_KEY, JSON.stringify(issues)); } catch (_) { /* quota */ }
    note('');
    detectUpdates();
    render();
    renderAdminList();
    bootstrapped = true;      // later polls may celebrate; the first one may not
  } catch (err) {
    // Keep whatever is already on screen if a later poll fails — the countdowns
    // keep running locally, so a throttled poll is not a broken page.
    if (projects.length) { note(err.message); return; }
    // Nothing on screen yet: fall back to the last good response so a visitor
    // who arrives while rate limited still sees the cards and countdowns.
    if (loadCache()) { note(err.message + ' Showing the last saved copy.'); return; }
    state.style.display = '';
    state.innerHTML = `Couldn't load projects — ${err.message}<br><br>
      <a class="btn ghost" href="https://github.com/${REPO}/issues">Open the issues on GitHub</a>`;
  } finally {
    inFlight = false;
    schedule();
  }
}

/* ---------------- polling schedule ----------------
   GitHub allows 60 unauthenticated API requests per hour per IP, so a flat
   5-second poll (720/hour) exhausts the quota in five minutes and everything
   after that is a 403. It also is not needed: the countdowns tick locally off
   the corrected clock, so polling only exists to notice new or edited issues.

   So: poll every 5 seconds when it actually matters — the last two minutes
   before something is due to release or update, when the page needs to flip
   promptly — and back off to once a minute the rest of the time. If the quota
   does run out, wait for the reset rather than hammering a closed door. */
const FAST = 5000, SLOW = 60000, HOT_WINDOW = 120000;
let timer = null;

function nextDelay() {
  const t = now();
  if (remaining === 0 && resetAt > t) return Math.min(resetAt - t + 1000, 15 * 60000);

  // How close is the nearest countdown to firing?
  const targets = projects.map(p => statusOf(p).target).filter(Boolean).map(d => +d - t).filter(ms => ms > -5000);
  const soonest = targets.length ? Math.min(...targets) : Infinity;
  const hot = soonest < HOT_WINDOW;

  // Keep a reserve so a burst near a release cannot strand the page at zero.
  if (hot && (remaining === null || remaining > 10)) return FAST;
  return SLOW;
}

function schedule() {
  clearTimeout(timer);
  if (document.hidden) return;                 // resumed by visibilitychange
  timer = setTimeout(load, nextDelay());
}

document.addEventListener('visibilitychange', () => { if (!document.hidden) load(); });

// Small status line under the grid, so a throttled poll is visible but quiet.
function note(msg) {
  let el = $('#note');
  if (!el) {
    el = document.createElement('p');
    el.id = 'note';
    el.className = 'hint';
    el.style.cssText = 'text-align:center;margin-top:22px';
    $('#grid').after(el);
  }
  el.textContent = msg ? '⚠ ' + msg : '';
}

function render() {
  const grid = $('#grid'), state = $('#state');
  if (!projects.length) {
    state.style.display = '';
    state.innerHTML = 'No projects yet. Add one from the <b>Admin</b> tab.';
    grid.innerHTML = '';
    return;
  }
  state.style.display = 'none';
  grid.innerHTML = projects.map(p => {
    const label = p.action === 'download' ? 'Download ⬇' : 'Open / Play ↗';
    const st = statusOf(p);
    const watching = isWatched(p.id);

    return `<article class="card" data-id="${p.id}">
      <div class="tagrow">
        <span class="kind">${p.kind === 'site' ? 'Site' : 'Game'}</span>
        ${st.latest && st.latest.version ? `<span class="kind ver">v${esc(st.latest.version)}</span>` : ''}
        ${st.live ? '<span class="kind live">Live</span>' : ''}
      </div>
      <h3>${esc(p.title)}</h3>
      <p class="desc">${esc(p.desc)}</p>

      <div class="cd" data-cd="${st.target ? st.target.toISOString() : ''}" data-for="${st.targetLabel}">
        ${['Days', 'Hours', 'Mins', 'Secs'].map(u => `<div><b>--</b><span>${u}</span></div>`).join('')}
      </div>

      ${st.next ? `<p class="cdnote">Next update${st.next.version ? ` · v${esc(st.next.version)}` : ''}</p>` : ''}
      ${renderUpdates(p, st)}

      <div class="row">
        ${p.link
          ? `<a class="btn" data-play="${p.id}" data-label="${label}">${label}</a>`
          : `<span class="btn" disabled>Link coming soon</span>`}
        <button class="btn hype${watching ? ' on' : ''}" data-hype="${p.id}">
          <span class="flame">🔥</span><span class="hlabel">${watching ? 'Hyped — you’ll be told' : 'Hype &amp; notify me'}</span>
        </button>
        <a class="btn ghost" href="${p.url}" target="_blank" rel="noopener">Details${p.hype ? ` · 🔥${p.hype}` : ''}</a>
      </div>
    </article>`;
  }).join('');
  $$('.card', grid).forEach(c => io.observe(c));
  $$('[data-hype]', grid).forEach(b => b.addEventListener('click', () => toggleWatch(+b.dataset.hype, b)));
  tick();
}

// Changelog for anything already shipped, newest first.
function renderUpdates(p, st) {
  const shipped = p.updates.filter(u => u.date && u.date <= now());
  if (!shipped.length) return '';
  const items = shipped.map(u => `
    <li>
      <b>${u.version ? 'v' + esc(u.version) : 'Update'}</b>
      <time>${u.date.toLocaleDateString()}</time>
      ${u.notes ? `<p>${esc(u.notes)}</p>` : ''}
    </li>`).join('');
  return `<details class="updates"${st.live ? ' open' : ''}>
      <summary>What's new <span class="count">${shipped.length}</span></summary>
      <ul>${items}</ul>
    </details>`;
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------------- countdown ---------------- */
function tick() {
  $$('.cd').forEach(cd => {
    const card = cd.closest('.card');
    const iso = cd.dataset.cd;
    const btn = card.querySelector('[data-play]');
    const id = +card.dataset.id;
    const forWhat = cd.dataset.for;
    // Already-released projects stay playable even while counting down to an update.
    const live = card.querySelector('.kind.live');

    if (!iso) {
      // No date to count to: either unannounced, or live with no update queued.
      if (live) {
        cd.outerHTML = '<div class="released">✦ Out now — go play it</div>';
      } else if (!cd.dataset.tba) {
        cd.dataset.tba = '1';       // write once, otherwise this rebuilds every second
        cd.innerHTML = '<div style="grid-column:1/-1"><b>TBA</b><span>release date</span></div>';
      }
      lock(btn, !live);
      return;
    }

    let diff = new Date(iso) - now();
    if (diff <= 0) {
      if (forWhat === 'update') {
        cd.outerHTML = '<div class="released">✦ Update out now</div>';
        celebrate(id, 'update');
      } else {
        cd.outerHTML = '<div class="released">✦ Out now — go play it</div>';
        celebrate(id, 'release');
      }
      lock(btn, false);
      return;
    }
    lock(btn, !live);
    const d = Math.floor(diff / 864e5);
    const h = Math.floor(diff / 36e5) % 24;
    const m = Math.floor(diff / 6e4) % 60;
    const s = Math.floor(diff / 1e3) % 60;
    [d, h, m, s].forEach((v, i) => {
      const el = cd.children[i].querySelector('b');
      const txt = i === 0 ? String(v) : String(v).padStart(2, '0');
      if (el.textContent !== txt) el.textContent = txt;
    });
  });
}

// The href is only written into the DOM once the countdown has finished, so the
// link is not sitting in the page source while the project is still unreleased.
function lock(btn, locked) {
  if (!btn) return;
  if (locked) {
    btn.setAttribute('disabled', '');
    btn.removeAttribute('href');
    btn.textContent = '🔒 Locked until release';
  } else if (!btn.hasAttribute('href')) {
    const p = projects.find(x => String(x.id) === btn.dataset.play);
    if (!p || !p.link) return;
    btn.removeAttribute('disabled');
    btn.href = p.link;
    btn.target = '_blank';
    btn.rel = 'noopener';
    btn.textContent = btn.dataset.label;
  }
}
setInterval(tick, 1000);

/* ---------------- hype & notifications ----------------
   One button per card: it marks the project as hyped and subscribes you to a
   notification. Subscriptions live in this browser's localStorage — there is no
   server, so notifications arrive while the site is open in a tab, not by email
   or push when it is closed. The 🔥 count next to Details is the issue's GitHub
   reaction total, which is why adding to it happens on the issue itself. */
const WATCH_KEY = 'watching';
const SEEN_KEY = 'seen';

const readSet = k => { try { return new Set(JSON.parse(localStorage.getItem(k)) || []); } catch (_) { return new Set(); } };
const writeSet = (k, s) => localStorage.setItem(k, JSON.stringify([...s]));

const isWatched = id => readSet(WATCH_KEY).has(id);

async function toggleWatch(id, btn) {
  const set = readSet(WATCH_KEY);
  const label = btn.querySelector('.hlabel');

  if (set.has(id)) {
    set.delete(id);
    btn.classList.remove('on');
    label.textContent = 'Hype & notify me';
  } else {
    set.add(id);
    btn.classList.add('on');
    btn.classList.remove('pop'); void btn.offsetWidth; btn.classList.add('pop');
    burst(btn);                                    // little flame puff on click
    if ('Notification' in window && Notification.permission === 'default') {
      try { await Notification.requestPermission(); } catch (_) { /* ignore */ }
    }
    const ok = 'Notification' in window && Notification.permission === 'granted';
    label.textContent = ok ? 'Hyped — you’ll be told' : 'Hyped';
  }
  writeSet(WATCH_KEY, set);
}

// Fires once per project per event, remembered across reloads.
function celebrate(id, kind, versionKey) {
  if (versionKey === undefined) {
    // Resolve the same key tick() and detectUpdates() would produce.
    const p = projects.find(x => x.id === id);
    const latest = p && statusOf(p).latest;
    versionKey = kind === 'update' && latest ? (latest.version || String(+latest.date)) : '';
  }
  const key = `${id}:${kind}:${versionKey || ''}`;
  const seen = readSet(SEEN_KEY);
  if (seen.has(key)) return;
  seen.add(key);
  writeSet(SEEN_KEY, seen);

  // First visit: record the world as it is without throwing confetti for things
  // that shipped long before this browser ever loaded the page.
  if (!bootstrapped) return;

  const p = projects.find(x => x.id === id);
  const name = p ? p.title : 'A project';
  confetti();
  if (isWatched(id) && 'Notification' in window && Notification.permission === 'granted') {
    const body = kind === 'update' ? 'A new update just went live.' : 'It just released — go play it.';
    try { new Notification(`${name} — ${kind === 'update' ? 'updated' : 'out now'}`, { body, icon: 'assets/favicon.svg' }); } catch (_) { /* ignore */ }
  }
}

// Detect updates that appeared in the issue data between two polls.
function detectUpdates() {
  projects.forEach(p => {
    const st = statusOf(p);
    if (st.live) celebrate(p.id, 'release', '');
    if (st.latest) celebrate(p.id, 'update', st.latest.version || String(+st.latest.date));
  });
}

/* ---------------- confetti ----------------
   Launches from the bottom edge of the screen and arcs upward. */
let cvs, ctx, bits = [], raf = null;

function confetti() {
  if (!cvs) {
    cvs = document.createElement('canvas');
    cvs.id = 'confetti';
    document.body.appendChild(cvs);
    ctx = cvs.getContext('2d');
    addEventListener('resize', sizeCanvas);
  }
  sizeCanvas();
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const colours = ['#ff2b3d', '#b3001b', '#ffffff', '#ff7a86', '#1a1a1f'];
  for (let i = 0; i < 140; i++) {
    bits.push({
      x: Math.random() * cvs.width,
      y: cvs.height + Math.random() * 40,
      vx: (Math.random() - .5) * 5,
      vy: -(11 + Math.random() * 9),            // upward launch
      size: 5 + Math.random() * 7,
      rot: Math.random() * Math.PI,
      spin: (Math.random() - .5) * .3,
      colour: colours[(Math.random() * colours.length) | 0],
      life: 0
    });
  }
  if (!raf) raf = requestAnimationFrame(drawConfetti);
}

function sizeCanvas() {
  if (!cvs) return;
  cvs.width = innerWidth;
  cvs.height = innerHeight;
}

function drawConfetti() {
  ctx.clearRect(0, 0, cvs.width, cvs.height);
  bits = bits.filter(b => b.life < 260 && b.y < cvs.height + 60);
  bits.forEach(b => {
    b.life++;
    b.vy += .28;                                 // gravity
    b.vx *= .995;
    b.x += b.vx;
    b.y += b.vy;
    b.rot += b.spin;
    ctx.save();
    ctx.translate(b.x, b.y);
    ctx.rotate(b.rot);
    ctx.globalAlpha = Math.max(0, 1 - b.life / 260);
    ctx.fillStyle = b.colour;
    ctx.fillRect(-b.size / 2, -b.size / 2, b.size, b.size * .6);
    ctx.restore();
  });
  if (bits.length) { raf = requestAnimationFrame(drawConfetti); }
  else { ctx.clearRect(0, 0, cvs.width, cvs.height); raf = null; }
}

// Small puff of flames out of the hype button.
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
function tryUnlock() {
  if ($('#code').value.trim() === ADMIN_CODE) {
    lockBox.style.display = 'none';
    $('#admin').style.display = 'block';
    $('#admin').classList.add('panel', 'active');
    sessionStorage.setItem('admin', '1');
    renderAdminList();
  } else {
    $('#lockmsg').classList.add('show');
    lockBox.classList.remove('shake');
    void lockBox.offsetWidth;
    lockBox.classList.add('shake');
  }
}
$('#unlock').addEventListener('click', tryUnlock);
$('#code').addEventListener('keydown', e => { if (e.key === 'Enter') tryUnlock(); });
if (sessionStorage.getItem('admin') === '1') { lockBox.style.display = 'none'; $('#admin').style.display = 'block'; }

let built = null;

$('#make').addEventListener('click', () => {
  const title = $('#f-title').value.trim();
  const date = $('#f-date').value;
  const msg = $('#formmsg');
  if (!title || !date) {
    msg.textContent = 'Name and release date are both required.';
    msg.className = 'msg err show';
    return;
  }
  msg.className = 'msg';
  const url = normaliseUrl($('#f-url').value);
  const payload = {
    kind: $('#f-kind').value,
    release: new Date(date).toISOString(),
    // Stored encoded so the link is not readable at a glance in the issue.
    url_b64: url ? encodeLink(url) : '',
    action: $('#f-action').value,
    desc: $('#f-desc').value.trim()
  };

  const ver = $('#f-ver').value.trim();
  const notes = $('#f-notes').value.trim();
  const udate = $('#f-udate').value;
  if (ver || notes) {
    payload.updates = [{
      version: ver,
      date: new Date(udate || Date.now()).toISOString(),
      notes
    }];
  }
  const body = '```json\n' + JSON.stringify(payload, null, 2) + '\n```';
  built = { title, body };
  $('#body').textContent = body;
  $('#openissue').href =
    `https://github.com/${REPO}/issues/new?labels=${LABEL}` +
    `&title=${encodeURIComponent(title)}&body=${encodeURIComponent(body)}`;
  $('#result').style.display = 'block';
  $('#result').scrollIntoView({ behavior: 'smooth', block: 'start' });
});

$('#clear').addEventListener('click', () => {
  ['#f-title', '#f-desc', '#f-date', '#f-url', '#f-ver', '#f-notes', '#f-udate'].forEach(s => $(s).value = '');
  $('#result').style.display = 'none';
  built = null;
});

$('#copy').addEventListener('click', async () => {
  if (!built) return;
  await navigator.clipboard.writeText(built.body);
  flash('Copied to clipboard.', true);
});

$('#post').addEventListener('click', async () => {
  const token = $('#token').value.trim();
  if (!built) return;
  if (!token) return flash('Paste a token first, or use option A.', false);
  flash('Creating issue…', true);
  try {
    const res = await fetch(`https://api.github.com/repos/${REPO}/issues`, {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: 'Bearer ' + token,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({ title: built.title, body: built.body, labels: [LABEL] })
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.message || res.status);
    $('#token').value = '';
    flash(`Created issue #${data.number}. Reloading the list…`, true);
    load();
  } catch (err) {
    flash('Failed: ' + err.message, false);
  }
});

function flash(text, ok) {
  const m = $('#postmsg');
  m.textContent = text;
  m.className = 'msg show ' + (ok ? 'ok' : 'err');
}

function renderAdminList() {
  const list = $('#list');
  if (!list) return;
  if (!projects.length) { list.innerHTML = '<p class="hint">Nothing published yet.</p>'; return; }
  list.innerHTML = projects.map(p => `
    <div style="display:flex;gap:12px;align-items:center;justify-content:space-between;padding:12px 0;border-top:1px solid var(--border);flex-wrap:wrap">
      <div>
        <b>${esc(p.title)}</b>
        <div class="hint">${p.release ? p.release.toLocaleString() : 'No date set'} · ${p.kind}</div>
      </div>
      <a class="btn ghost" href="${p.url}" target="_blank" rel="noopener">Edit on GitHub ↗</a>
    </div>`).join('');
}

load();
