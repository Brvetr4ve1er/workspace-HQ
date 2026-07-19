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
}

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
setInterval(load, 2000);
