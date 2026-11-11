// Security space - the footprint map's pure engine. No DOM, no IPC, no clock, no Math.random: the same input is the same picture.
//
//   buildMapModel({ map, owner })          what hq:security:read answered -> { nodes, edges, counts }   (nodes carry flags in words' ids)
//   filterByDate(model, 'YYYY-MM-DD'|null) the time slider: accounts created on or before the day (manual ones from their createdAt)
//   dateStops(model)                       the distinct creation days, oldest first (the slider's stops)
//   layoutGraph({ nodes, edges }, { width, height, iterations = 300 })
//                                          deterministic force layout -> { nodes: [{ ...node, x, y, r }], edges, folded, clipped }
//   growthSummary(snapshots)               a numbers-only growth line from the kept snapshots
//
// Only names and flags ever pass through here: an account's title and host, the booleans, an identity label the main window
// decrypted (or null = locked). A label that still looks like ciphertext ('enc:...') is treated as locked, never shown.
//
// Layout (Fruchterman-Reingold, seeded from a hash of each node id): r = 8 + 4 * sqrt(degree), every node clamped inside
// [r, width - r] x [r, height - r], at most MAX_NODES nodes. Past that the smallest-degree accounts fold into ONE '+N more' node
// per identity (round-robin across identities so no identity is folded first), and N is exact: kept accounts + the Ns = all accounts.

export const MAX_NODES = 600;
export const FLAG_ORDER = Object.freeze(['breached', 'reused', 'weak', 'no2fa', 'old', 'not-in-vault']);
export const LOCKED_LABEL = 'locked - refresh to restore';

const isObj = (x) => !!x && typeof x === 'object' && !Array.isArray(x);
const arr = (x) => (Array.isArray(x) ? x : []);
const str = (x) => (typeof x === 'string' ? x : '');

/** A label main decrypted, or null when it is locked (null, empty, or still ciphertext). */
export function cleanLabel(x) {
  if (typeof x !== 'string') return null;
  const t = x.trim();
  if (!t || t.startsWith('enc:')) return null;
  return t.slice(0, 200);
}

// ---- the model ---------------------------------------------------------------------------------------------------------

function flagsOf(a, oa, vaultKnown) {
  const f = [];
  if (a.breached === true) f.push('breached');
  if (a.reuseGroup != null && a.reuseGroup !== false) f.push('reused');
  if (a.strength === 'weak') f.push('weak');
  const tw = oa && typeof oa.twofa === 'string' ? oa.twofa : 'unknown';
  const hasFactor = a.totp === true || a.passkey === true || tw === 'ente' || tw === 'sms' || tw === 'passkey';
  if (tw === 'none' || (!hasFactor)) f.push('no2fa');
  if (a.old === true) f.push('old');
  if (vaultKnown === false) f.push('not-in-vault');
  return f;
}

/**
 * hq:security:read's answer -> nodes and edges.
 *   node: { id, kind: 'identity'|'account'|'manual'|'ghost', label, host, flags, archived, hidden, created, twofa, locked, ref, degree }
 *   edge: { a, b, kind: 'uses'|'signs-in-with'|'recovers' }   (a = the account, b = what it points at)
 * An archived account keeps no flags (it is closed). A manual account counts as 'not-in-vault'. An owner edit whose account is no
 * longer in the vault (after at least one refresh) becomes a 'ghost' node instead of vanishing.
 */
export function buildMapModel(input) {
  const { map, owner } = isObj(input) ? input : {};
  const M = isObj(map) ? map : null, O = isObj(owner) ? owner : {};
  const oAcc = isObj(O.accounts) ? O.accounts : {};
  const nodes = [], edges = [], seen = new Set();
  const push = (n) => { if (!seen.has(n.id)) { seen.add(n.id); nodes.push(n); } };

  // identities: the vault's, then the owner's own additions (same ref = the same node, the label that is readable wins)
  const idLabel = new Map(), idKind = new Map(), idOrder = [];
  for (const i of arr(M && M.identities).concat(arr(O.identities))) {
    if (!isObj(i) || typeof i.ref !== 'string' || !i.ref) continue;
    if (!idKind.has(i.ref)) { idKind.set(i.ref, i.kind === 'phone' ? 'phone' : 'email'); idLabel.set(i.ref, null); idOrder.push(i.ref); }
    const l = cleanLabel(i.label);
    if (l && !idLabel.get(i.ref)) idLabel.set(i.ref, l);
  }
  for (const ref of idOrder) {
    const label = idLabel.get(ref);
    push({ id: ref, kind: 'identity', identityKind: idKind.get(ref), label: label || LOCKED_LABEL, locked: !label, host: '', flags: [], archived: false, hidden: false, created: null, twofa: '', ref, degree: 0 });
  }

  const refreshed = !!(M && str(M.refreshedAt));
  const addAccount = (a, kind, vaultKnown) => {
    const oa = isObj(oAcc[a.id]) ? oAcc[a.id] : null;
    const archived = !!(oa && oa.archived === true);
    const title = str(a.title).trim() || '(untitled)';
    push({
      id: a.id, kind, label: title.slice(0, 120), host: str(a.host).slice(0, 120), locked: false,
      flags: archived ? [] : flagsOf(a, oa, vaultKnown), archived, hidden: !!(oa && oa.hiddenFromClaude === true),
      created: str(a.created || a.createdAt) || null, twofa: oa && typeof oa.twofa === 'string' ? oa.twofa : 'unknown', ref: '',
      breached: a.breached === true ? true : a.breached === false ? false : null, group: str(a.group).slice(0, 200), degree: 0,
    });
    if (typeof a.identityRef === 'string' && idKind.has(a.identityRef)) edges.push({ a: a.id, b: a.identityRef, kind: 'uses' });
  };
  const inVault = new Set();
  for (const a of arr(M && M.accounts)) {
    if (!isObj(a) || typeof a.id !== 'string' || !a.id || seen.has(a.id)) continue;
    inVault.add(a.id);
    addAccount(a, 'account', true);
  }
  for (const m of arr(O.manual)) {
    if (!isObj(m) || typeof m.id !== 'string' || !m.id || seen.has(m.id)) continue;
    addAccount({ id: m.id, title: m.title, host: m.host, createdAt: m.createdAt }, 'manual', false);
  }
  if (refreshed) {
    for (const id of Object.keys(oAcc)) {
      if (seen.has(id) || !/^k-/.test(id)) continue;
      const oa = isObj(oAcc[id]) ? oAcc[id] : {};
      push({ id, kind: 'ghost', label: 'not in vault (' + id + ')', host: '', locked: false, flags: oa.archived === true ? [] : ['not-in-vault'], archived: oa.archived === true, hidden: oa.hiddenFromClaude === true, created: null, twofa: typeof oa.twofa === 'string' ? oa.twofa : 'unknown', ref: '', breached: null, group: '', degree: 0 });
    }
  }
  // the owner's own links
  for (const [id, oa] of Object.entries(oAcc)) {
    if (!isObj(oa) || !seen.has(id)) continue;
    if (typeof oa.signInWith === 'string' && oa.signInWith && oa.signInWith !== id && seen.has(oa.signInWith)) edges.push({ a: id, b: oa.signInWith, kind: 'signs-in-with' });
    if (typeof oa.recoveryRef === 'string' && idKind.has(oa.recoveryRef)) edges.push({ a: id, b: oa.recoveryRef, kind: 'recovers' });
  }
  // degrees (an identity's degree = how many accounts hang off it)
  const deg = new Map();
  for (const e of edges) { deg.set(e.a, (deg.get(e.a) || 0) + 1); deg.set(e.b, (deg.get(e.b) || 0) + 1); }
  for (const n of nodes) n.degree = deg.get(n.id) || 0;

  const counts = { accounts: 0, identities: idOrder.length, archived: 0, breachUnknown: 0, flags: { weak: 0, reused: 0, breached: 0, no2fa: 0, old: 0, notInVault: 0 } };
  for (const n of nodes) {
    if (n.kind === 'identity') continue;
    if (n.archived) { counts.archived++; continue; }
    counts.accounts++;
    if (n.kind === 'account' && n.breached === null) counts.breachUnknown++;
    for (const f of n.flags) counts.flags[f === 'not-in-vault' ? 'notInVault' : f]++;
  }
  return { nodes, edges, counts };
}

// ---- the time slider ---------------------------------------------------------------------------------------------------

const day = (iso) => (typeof iso === 'string' && /^\d{4}-\d{2}-\d{2}/.test(iso) ? iso.slice(0, 10) : null);

/** The distinct creation days of the accounts that have one, oldest first. Accounts with no date are never hidden by the slider. */
export function dateStops(model) {
  const set = new Set();
  for (const n of arr(model && model.nodes)) if (n.kind !== 'identity') { const d = day(n.created); if (d) set.add(d); }
  return [...set].sort();
}

/** Keep the accounts created on or before `cutoff` ('YYYY-MM-DD'; null = no filter). Identities stay while one of their accounts does. */
export function filterByDate(model, cutoff) {
  const m = model || { nodes: [], edges: [] };
  const c = typeof cutoff === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(cutoff) ? cutoff : null;
  if (!c) return { nodes: m.nodes, edges: m.edges };
  const keep = new Set();
  for (const n of m.nodes) if (n.kind !== 'identity') { const d = day(n.created); if (d === null || d <= c) keep.add(n.id); }
  const kindOf = new Map(m.nodes.map((n) => [n.id, n.kind]));
  const withAccounts = new Set();
  for (const e of m.edges) {
    if (kindOf.get(e.b) === 'identity' && keep.has(e.a)) withAccounts.add(e.b);
    if (kindOf.get(e.a) === 'identity' && keep.has(e.b)) withAccounts.add(e.a);
  }
  const hasAny = new Set();
  for (const e of m.edges) { if (kindOf.get(e.b) === 'identity') hasAny.add(e.b); if (kindOf.get(e.a) === 'identity') hasAny.add(e.a); }
  for (const n of m.nodes) if (n.kind === 'identity' && (withAccounts.has(n.id) || !hasAny.has(n.id))) keep.add(n.id);
  return { nodes: m.nodes.filter((n) => keep.has(n.id)), edges: m.edges.filter((e) => keep.has(e.a) && keep.has(e.b)) };
}

// ---- growth ------------------------------------------------------------------------------------------------------------

const num = (x) => (typeof x === 'number' && Number.isFinite(x) && x >= 0 ? Math.floor(x) : 0);
const FLAG_KEYS = ['weak', 'reused', 'breached', 'no2fa', 'old', 'notInVault'];
const dayLabel = (iso) => day(iso) || 'an unknown day';

/** Numbers only: accounts, identities and the sum of the flag counts per kept snapshot (a flag count is not a count of accounts). */
export function growthSummary(snapshots) {
  const pts = arr(snapshots).filter(isObj).map((s) => {
    const f = isObj(s.flags) ? s.flags : {};
    return { at: str(s.at), accounts: num(s.accounts), identities: num(s.identities), flags: FLAG_KEYS.reduce((t, k) => t + num(f[k]), 0) };
  });
  if (!pts.length) return { points: [], text: 'No refresh kept yet. The growth line starts with the first one.', accountsPath: '', flagsPath: '' };
  const last = pts[pts.length - 1], first = pts[0];
  let text = last.accounts + ' accounts on ' + last.identities + ' identities, ' + last.flags + ' flags';
  if (pts.length > 1) text += ' · first kept ' + dayLabel(first.at) + ': ' + first.accounts + ' accounts, ' + first.flags + ' flags · ' + pts.length + ' refreshes kept';
  else text += ' · 1 refresh kept so far';
  const W = 300, H = 60, pad = 4;
  const path = (key) => {
    if (pts.length < 2) return '';
    const top = Math.max(1, ...pts.map((p) => Math.max(p.accounts, p.flags)));
    return pts.map((p, i) => (i ? 'L' : 'M') + (pad + (i * (W - 2 * pad)) / (pts.length - 1)).toFixed(1) + ' ' + (H - pad - (p[key] / top) * (H - 2 * pad)).toFixed(1)).join(' ');
  };
  return { points: pts, text, accountsPath: path('accounts'), flagsPath: path('flags') };
}

// ---- the layout --------------------------------------------------------------------------------------------------------

/** FNV-1a with a final avalanche: a stable 32-bit number for (text, salt). */
export function hash32(text, salt = 0) {
  let h = (2166136261 ^ salt) >>> 0;
  for (let i = 0; i < text.length; i++) { h ^= text.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; }
  h ^= h >>> 16; h = Math.imul(h, 2246822507) >>> 0;
  h ^= h >>> 13; h = Math.imul(h, 3266489909) >>> 0;
  h ^= h >>> 16;
  return h >>> 0;
}
const unit = (text, salt) => hash32(text, salt) / 4294967296;
const radiusOf = (degree) => 8 + 4 * Math.sqrt(Math.max(0, degree));

function fold(nodes, edges) {
  if (nodes.length <= MAX_NODES) return { nodes, edges, folded: 0, clipped: 0 };
  const kindOf = new Map(nodes.map((n) => [n.id, n.kind]));
  const deg = new Map();
  for (const e of edges) { deg.set(e.a, (deg.get(e.a) || 0) + 1); deg.set(e.b, (deg.get(e.b) || 0) + 1); }
  const degOf = (n) => (Number.isFinite(n.degree) ? n.degree : deg.get(n.id) || 0);
  const owner = new Map();
  for (const e of edges) {
    if (e.kind !== 'uses') continue;
    if (kindOf.get(e.b) === 'identity') owner.set(e.a, e.b);
    else if (kindOf.get(e.a) === 'identity') owner.set(e.b, e.a);
  }
  const cand = nodes.filter((n) => n.kind !== 'identity').sort((a, b) => degOf(a) - degOf(b) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  const groups = new Map();
  for (const n of cand) { const k = owner.get(n.id) || ''; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(n); }
  const keys = [...groups.keys()].sort();
  let total = nodes.length;
  const used = new Set(), gone = new Map();   // gone: group key -> folded accounts
  outer: while (total > MAX_NODES) {
    let progressed = false;
    for (const k of keys) {
      const list = groups.get(k);
      if (!list.length) continue;
      const n = list.shift();
      progressed = true;
      if (!gone.has(k)) gone.set(k, []);
      gone.get(k).push(n);
      total--;
      if (!used.has(k)) { used.add(k); total++; }
      if (total <= MAX_NODES) break outer;
    }
    if (!progressed) break;
  }
  const goneIds = new Set();
  for (const list of gone.values()) for (const n of list) goneIds.add(n.id);
  const outNodes = nodes.filter((n) => !goneIds.has(n.id));
  const outEdges = edges.filter((e) => !goneIds.has(e.a) && !goneIds.has(e.b));
  for (const [k, list] of gone) {
    const id = 'more:' + (k || 'none');
    outNodes.push({ id, kind: 'more', label: '+' + list.length + ' more', count: list.length, identity: k, flags: [], archived: false, hidden: false, host: '', created: null, degree: 1, locked: false });
    if (k) outEdges.push({ a: id, b: k, kind: 'uses' });
  }
  let clipped = 0, nodesFinal = outNodes, edgesFinal = outEdges;
  if (nodesFinal.length > MAX_NODES) {   // more than 600 identities: no accounts left to fold; keep the best connected
    const ranked = nodesFinal.slice().sort((a, b) => degOf(b) - degOf(a) || (a.id < b.id ? -1 : 1)).slice(0, MAX_NODES);
    const keep = new Set(ranked.map((n) => n.id));
    clipped = nodesFinal.length - ranked.length;
    nodesFinal = nodesFinal.filter((n) => keep.has(n.id));
    edgesFinal = edgesFinal.filter((e) => keep.has(e.a) && keep.has(e.b));
  }
  return { nodes: nodesFinal, edges: edgesFinal, folded: goneIds.size, clipped };
}

/**
 * @param {{nodes: Array<{id:string, kind?:string, degree?:number}>, edges: Array<{a:string, b:string, kind:string}>}} graph
 * @param {{width?:number, height?:number, iterations?:number}} [opts]
 * @returns {{nodes: Array<object>, edges: Array<object>, folded: number, clipped: number}}
 */
export function layoutGraph(graph, opts = {}) {
  const g = isObj(graph) ? graph : {};
  const width = Number.isFinite(opts.width) && opts.width > 0 ? opts.width : 800;
  const height = Number.isFinite(opts.height) && opts.height > 0 ? opts.height : 520;
  const wanted = Number.isFinite(opts.iterations) && opts.iterations >= 0 ? Math.floor(opts.iterations) : 300;
  const ids = new Set(), inNodes = [];
  for (const n of arr(g.nodes)) { if (isObj(n) && typeof n.id === 'string' && !ids.has(n.id)) { ids.add(n.id); inNodes.push(n); } }
  const seenEdge = new Set(), inEdges = [];
  for (const e of arr(g.edges)) {
    if (!isObj(e) || !ids.has(e.a) || !ids.has(e.b) || e.a === e.b) continue;
    const key = e.a + '\u0000' + e.b + '\u0000' + e.kind;
    if (seenEdge.has(key)) continue;
    seenEdge.add(key); inEdges.push({ a: e.a, b: e.b, kind: str(e.kind) || 'uses' });
  }
  // degree of every input node (an explicit degree wins), before folding, so a kept node keeps its size
  const deg = new Map();
  for (const e of inEdges) { deg.set(e.a, (deg.get(e.a) || 0) + 1); deg.set(e.b, (deg.get(e.b) || 0) + 1); }
  const prepared = inNodes.map((n) => ({ ...n, degree: Number.isFinite(n.degree) ? n.degree : deg.get(n.id) || 0 }));
  const f = fold(prepared, inEdges);
  const nodes = f.nodes, n = nodes.length;
  const R = nodes.map((nd) => radiusOf(nd.degree));
  const lo = (r, size) => Math.min(r, size / 2), hi = (r, size) => Math.max(size - r, size / 2);
  const X = new Float64Array(n), Y = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    X[i] = lo(R[i], width) + unit(nodes[i].id, 1) * (hi(R[i], width) - lo(R[i], width));
    Y[i] = lo(R[i], height) + unit(nodes[i].id, 2) * (hi(R[i], height) - lo(R[i], height));
  }
  const index = new Map(nodes.map((nd, i) => [nd.id, i]));
  const links = f.edges.map((e) => [index.get(e.a), index.get(e.b)]).filter((p) => p[0] !== undefined && p[1] !== undefined);
  const iters = n > 400 ? Math.min(wanted, 90) : n > 200 ? Math.min(wanted, 200) : wanted;   // the pair loop is O(n^2): a big graph gets fewer steps (600 nodes: about 0.25 s)
  const k = Math.sqrt((width * height) / Math.max(1, n)) * 0.7;
  const DX = new Float64Array(n), DY = new Float64Array(n);
  let temp = Math.min(width, height) / 6;
  const cool = iters > 0 ? Math.pow(0.03, 1 / iters) : 1;
  for (let it = 0; it < iters && n > 1; it++) {
    DX.fill(0); DY.fill(0);
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        let dx = X[i] - X[j], dy = Y[i] - Y[j], d2 = dx * dx + dy * dy;
        if (d2 < 0.01) { dx = ((i * 7 + j * 3) % 5 - 2) * 0.3 + 0.1; dy = ((i * 5 + j * 11) % 7 - 3) * 0.3 + 0.1; d2 = dx * dx + dy * dy; }
        const d = Math.sqrt(d2), touch = R[i] + R[j] + 4;
        const force = (k * k) / d + (d < touch ? (touch - d) * 2 : 0);
        const fx = (dx / d) * force, fy = (dy / d) * force;
        DX[i] += fx; DY[i] += fy; DX[j] -= fx; DY[j] -= fy;
      }
    }
    for (let e = 0; e < links.length; e++) {
      const a = links[e][0], b = links[e][1];
      const dx = X[a] - X[b], dy = Y[a] - Y[b], d = Math.sqrt(dx * dx + dy * dy) || 0.01;
      const force = (d * d) / k;
      const fx = (dx / d) * force, fy = (dy / d) * force;
      DX[a] -= fx; DY[a] -= fy; DX[b] += fx; DY[b] += fy;
    }
    for (let i = 0; i < n; i++) {
      DX[i] += (width / 2 - X[i]) * 0.08; DY[i] += (height / 2 - Y[i]) * 0.08;   // a light pull to the middle keeps islands from drifting off
      const m = Math.sqrt(DX[i] * DX[i] + DY[i] * DY[i]) || 1, step = Math.min(m, temp);
      X[i] = Math.min(hi(R[i], width), Math.max(lo(R[i], width), X[i] + (DX[i] / m) * step));
      Y[i] = Math.min(hi(R[i], height), Math.max(lo(R[i], height), Y[i] + (DY[i] / m) * step));
    }
    temp *= cool;
  }
  return {
    nodes: nodes.map((nd, i) => ({ ...nd, x: X[i], y: Y[i], r: R[i] })),
    edges: f.edges,
    folded: f.folded,
    clipped: f.clipped,
  };
}
