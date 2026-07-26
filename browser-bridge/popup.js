const DEFAULTS = { endpoint: 'http://127.0.0.1:47821', paused: false, token: '' };
const $ = (id) => document.getElementById(id);

async function load() {
  const { hq_state } = await chrome.storage.local.get('hq_state');
  const { hq_cfg } = await chrome.storage.local.get('hq_cfg');
  const s = hq_state || {}, cfg = { ...DEFAULTS, ...(hq_cfg || {}) };

  const cur = s.current;
  $('now-domain').textContent = cur ? (cur.host || cur.domain) : '— idle —';
  $('now-title').textContent = cur ? (cur.title || '') : '';
  $('s-queued').textContent = (s.queue || []).length;

  // "connected" = a successful flush within the last 90s
  const fresh = s.lastOk && (Date.now() - s.lastOk < 90_000);
  $('dot').className = 'dot ' + (fresh ? 'on' : 'off');
  $('s-conn').textContent = fresh ? 'live' : 'off';
  $('err').textContent = (!fresh && s.lastError) ? ('link: ' + s.lastError) : '';

  $('paused').checked = !!cfg.paused;
  $('endpoint').value = cfg.endpoint;
  $('token').value = cfg.token || '';
  if ($('masto') && document.activeElement !== $('masto')) $('masto').value = cfg.mastodonHost || '';
}

// Mastodon is federated — grant host permission for the user's specific instance
// so chrome.scripting can inject the adapter there, then remember the host.
$('masto-connect').addEventListener('click', async () => {
  const raw = ($('masto').value || '').trim();
  if (!raw) { $('masto-status').textContent = 'enter your instance URL'; return; }
  let origin;
  try { origin = new URL(raw).origin; } catch { $('masto-status').textContent = 'invalid URL'; return; }
  const granted = await chrome.permissions.request({ origins: [origin + '/*'] }).catch(() => false);
  if (!granted) { $('masto-status').textContent = 'permission denied'; return; }
  const { hq_cfg } = await chrome.storage.local.get('hq_cfg');
  await chrome.storage.local.set({ hq_cfg: { ...DEFAULTS, ...(hq_cfg || {}), mastodonHost: origin } });
  $('masto-status').textContent = 'connected ✓ ' + origin;
});

// ---- social outbox (the human approval surface) ----------------------------
function appHeaders(cfg, post) {
  return { ...(post ? { 'Content-Type': 'application/json' } : {}), 'X-HQ-Bridge': '1', ...(cfg.token ? { 'X-HQ-Token': cfg.token } : {}) };
}
async function getCfg() {
  const { hq_cfg } = await chrome.storage.local.get('hq_cfg');
  return { ...DEFAULTS, ...(hq_cfg || {}) };
}
async function socialLoad() {
  const list = $('social-list');
  const cfg = await getCfg();
  let data;
  try { data = await fetch(cfg.endpoint.replace(/\/$/, '') + '/social/outbox', { headers: appHeaders(cfg, false) }).then((r) => r.json()); }
  catch (e) { list.innerHTML = '<div class="social-empty">app link off</div>'; return; }
  const actions = (data && data.actions) || [];
  if (!actions.length) { list.innerHTML = '<div class="social-empty">nothing staged</div>'; return; }
  list.innerHTML = '';
  for (const a of actions) {
    const row = document.createElement('div');
    row.className = 'social-item';
    const top = document.createElement('div'); top.className = 'si-top';
    const plat = document.createElement('span'); plat.className = 'si-plat'; plat.textContent = a.platform || '?';
    const op = document.createElement('span'); op.className = 'si-op'; op.textContent = (a.op || '') + (a.reply_to ? ' ↩' : '');
    top.append(plat, op);
    const txt = document.createElement('div'); txt.className = 'si-text';
    txt.textContent = a.text || '';            // textContent — never render post text as HTML
    const btn = document.createElement('button'); btn.className = 'si-send'; btn.textContent = 'Approve & Send';
    btn.addEventListener('click', async () => {
      btn.disabled = true; btn.textContent = 'sending…';
      const res = await chrome.runtime.sendMessage({ type: 'social:send', action: a });
      btn.textContent = res && res.ok ? 'sent ✓' : ('failed: ' + ((res && res.error) || '?'));
      setTimeout(socialLoad, 1400);
    });
    row.append(top, txt, btn);
    list.appendChild(row);
  }
}
$('social-sync').addEventListener('click', async () => {
  const b = $('social-sync'); b.disabled = true; b.textContent = '…';
  try { await chrome.runtime.sendMessage({ type: 'social:sync' }); } catch (e) { /* SW asleep */ }
  setTimeout(() => { b.disabled = false; b.textContent = 'Sync'; socialLoad(); }, 1600);
});

$('paused').addEventListener('change', async (e) => {
  const { hq_cfg } = await chrome.storage.local.get('hq_cfg');
  await chrome.storage.local.set({ hq_cfg: { ...DEFAULTS, ...(hq_cfg || {}), paused: e.target.checked } });
});

$('save').addEventListener('click', async () => {
  const { hq_cfg } = await chrome.storage.local.get('hq_cfg');
  const endpoint = ($('endpoint').value || DEFAULTS.endpoint).trim();
  const token = $('token').value.trim();
  await chrome.storage.local.set({ hq_cfg: { ...DEFAULTS, ...(hq_cfg || {}), endpoint, token } });
  $('saved').textContent = 'saved ✓';
  setTimeout(() => ($('saved').textContent = ''), 1500);
});

load();
socialLoad();
setInterval(() => { load(); socialLoad(); }, 2500);
