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

/* ---------------- load data ---------------- */
let projects = [];

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
  return {
    id: issue.number,
    title: issue.title,
    url: issue.html_url,
    desc: data.desc || '',
    kind: (data.kind || 'game').toLowerCase(),
    action: (data.action || 'play').toLowerCase(),
    link: normaliseUrl(data.url),
    release: release && !isNaN(release) ? release : null
  };
}

async function load() {
  const state = $('#state');
  try {
    // Every open issue is considered; anything without a valid JSON block is
    // ignored, so a missing "game" label never hides a project.
    const res = await fetch(`https://api.github.com/repos/${REPO}/issues?state=open&per_page=100`, {
      headers: { Accept: 'application/vnd.github+json' }
    });
    if (!res.ok) throw new Error('GitHub API returned ' + res.status);
    const issues = (await res.json()).filter(i => !i.pull_request);
    projects = issues.map(parseIssue).filter(Boolean).sort((a, b) => {
      if (!a.release) return 1;
      if (!b.release) return -1;
      return a.release - b.release;
    });
    render();
    renderAdminList();
  } catch (err) {
    state.innerHTML = `Couldn't load projects — ${err.message}.<br><br>
      <a class="btn ghost" href="https://github.com/${REPO}/issues">Open the issues on GitHub</a>`;
  }
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
    return `<article class="card" data-id="${p.id}">
      <span class="kind">${p.kind === 'site' ? 'Site' : 'Game'}</span>
      <h3>${esc(p.title)}</h3>
      <p class="desc">${esc(p.desc)}</p>
      <div class="cd" data-cd="${p.release ? p.release.toISOString() : ''}">
        ${['Days', 'Hours', 'Mins', 'Secs'].map(u => `<div><b>--</b><span>${u}</span></div>`).join('')}
      </div>
      <div class="row">
        ${p.link
          ? `<a class="btn" data-link="${esc(p.link)}" href="${esc(p.link)}" target="_blank" rel="noopener">${label}</a>`
          : `<span class="btn" disabled>Link coming soon</span>`}
        <a class="btn ghost" href="${p.url}" target="_blank" rel="noopener">Details</a>
      </div>
    </article>`;
  }).join('');
  $$('.card', grid).forEach(c => io.observe(c));
  tick();
}

function esc(s) {
  return String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

/* ---------------- countdown ---------------- */
function tick() {
  $$('.cd').forEach(cd => {
    const card = cd.closest('.card');
    const iso = cd.dataset.cd;
    const btn = card.querySelector('[data-link]');
    if (!iso) { cd.innerHTML = '<div style="grid-column:1/-1"><b>TBA</b><span>release date</span></div>'; lock(btn, true); return; }
    let diff = new Date(iso) - Date.now();
    if (diff <= 0) {
      cd.outerHTML = '<div class="released">✦ Out now — go play it</div>';
      lock(btn, false);
      return;
    }
    lock(btn, true);
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

function lock(btn, locked) {
  if (!btn) return;
  if (locked) {
    btn.setAttribute('disabled', '');
    btn.removeAttribute('href');
    btn.textContent = '🔒 Locked until release';
  } else if (!btn.hasAttribute('href')) {
    btn.removeAttribute('disabled');
    btn.setAttribute('href', btn.dataset.link);
  }
}
setInterval(tick, 1000);

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
  const payload = {
    kind: $('#f-kind').value,
    release: new Date(date).toISOString(),
    url: $('#f-url').value.trim(),
    action: $('#f-action').value,
    desc: $('#f-desc').value.trim()
  };
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
  ['#f-title', '#f-desc', '#f-date', '#f-url'].forEach(s => $(s).value = '');
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
