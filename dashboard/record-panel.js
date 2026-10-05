/* record-panel.js — the recorder satellite (v5 clean pass S2).
 *
 * Setup card (kind · source · mic / system audio · start) → live pill (elapsed · pause/resume ·
 * stop) → back to setup with "saved <file> · reveal". MediaRecorder runs here; main
 * (screen-capture.js) owns the file. Contract with main: window.hq.studio.rec*, panelMode,
 * onRecCommand (IPC-CONTRACT "v3 STUDIO" + "Pending — v5 clean pass").
 *
 * The empty-recording fix, in this file:
 *   - every non-empty chunk gets its seq SYNCHRONOUSLY in ondataavailable, from 0, BEFORE
 *     `await blob.arrayBuffer()` — so seqs match MediaRecorder's order however the reads resolve
 *     (main used to wait for 0 while this file numbered from 1);
 *   - onstop awaits every pending send before calling recStop, so the final chunk can't race
 *     the stop.
 * Pausing: a user pause (sent to main with recPause, which excludes it from elapsedMs) and a
 * backpressure pause (rec-status 'backpressure' / 'drained') are tracked separately; the
 * MediaRecorder runs only while neither holds, so 'drained' never resumes a user pause.
 * Main-initiated stops (hotkey, low disk, 30-min limit) arrive on onRecCommand and take the same
 * clean path; if this panel hasn't finished in 3 s main hard-stops and pushes rec-status 'stopped'.
 *
 * XSS: source labels, file names and errors are written with textContent only.
 * Button discipline: a control whose bridge method is missing starts disabled with a title saying why.
 */
'use strict';

const bridge = (window.hq && window.hq.studio) || null;

// ---- DOM handles -----------------------------------------------------------
const $ = (id) => document.getElementById(id);
const els = {
  body:       document.body,
  setup:      $('setup'),
  live:       $('live'),
  kindBtns:   Array.from(document.querySelectorAll('[data-kind]')),
  source:     $('source'),
  btnRefresh: $('btnRefresh'),
  btnHide:    $('btnHide'),
  optMic:     $('optMic'),
  optSys:     $('optSys'),
  btnRec:     $('btnRec'),
  statusText: $('statusText'),
  btnReveal:  $('btnReveal'),
  timer:      $('timer'),
  btnPause:   $('btnPause'),
  btnStop:    $('btnStop'),
};

// Why a recording ended, as the setup card says it afterwards ('' = the user's own stop).
const STOP_TEXT = {
  user: '',
  hotkey: 'Stopped by hotkey',
  lowdisk: 'Stopped — low disk space',
  limit: 'Stopped — 30 min limit',
  'source-ended': 'Source closed',
  'main-error': 'Recorder error',
  main: 'Stopped (main)',        // main stopped it and didn't say why — no guessing
};

// ---- Runtime state ---------------------------------------------------------
const state = {
  sources: [],
  kind: 'screen',          // 'screen' | 'window' (region recording is a recorded cut)
  selectedId: null,
  mic: false,
  sys: false,
  recording: false,
  finishing: false,        // stop requested, awaiting the last chunk + recStop
  recId: null,
  seq: 0,                  // next chunk seq — starts at 0, assigned synchronously
  pending: new Set(),      // in-flight arrayBuffer → recChunk sends
  startedAt: 0,
  pausedAt: null,          // open user pause (ms), or null
  pausedTotal: 0,          // closed user-paused spans (ms)
  userPaused: false,
  bpPaused: false,         // paused by main's backpressure push
  timerHandle: 0,
  stream: null, videoStream: null, micStream: null, sysStream: null,
  recorder: null,
  lastPath: null,
  bytes: 0,
  stopReason: null,
  notes: [],               // degradations to report once saved ("no system audio" …)
};

// ---- Bridge helpers --------------------------------------------------------
function have(name) { return !!(bridge && typeof bridge[name] === 'function'); }
const errMsg = (e) => (e && e.message ? e.message : 'unknown');

function disableWithReason(btn, reason) {
  btn.disabled = true;
  btn.title = reason;
}

function ensureBridge() {
  if (!bridge) {
    setStatus('Bridge unavailable — reload the app', 'err');
    for (const b of [els.btnRec, els.btnRefresh, els.btnReveal, els.optMic, els.optSys]) {
      disableWithReason(b, 'window.hq.studio is not exposed');
    }
    els.source.disabled = true;
    return false;
  }
  if (!have('recSources')) disableWithReason(els.btnRefresh, 'recSources missing on bridge');
  if (!have('recStart') || !have('recChunk') || !have('recStop')) {
    disableWithReason(els.btnRec, 'recStart / recChunk / recStop missing on bridge');
  }
  if (!have('libraryReveal')) disableWithReason(els.btnReveal, 'libraryReveal missing on bridge');
  if (!have('recPause')) disableWithReason(els.btnPause, 'recPause missing on bridge — this main process cannot pause');
  if (!have('panelToggle')) disableWithReason(els.btnHide, 'panelToggle missing on bridge');
  return true;
}

// ---- Status / timer --------------------------------------------------------
function setStatus(text, kind) {
  els.statusText.textContent = String(text || '');
  els.statusText.title = String(text || '');
  els.body.classList.remove('err', 'saved', 'warn');
  if (kind) els.body.classList.add(kind);
}

function fmtElapsed(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => (n < 10 ? '0' + n : String(n));
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

// Recorded time: wall time since start minus user-paused spans (main's accounting, mirrored).
function elapsedMs(now = Date.now()) {
  const open = state.pausedAt != null ? now - state.pausedAt : 0;
  return Math.max(0, now - state.startedAt - state.pausedTotal - open);
}

function renderTimer() { els.timer.textContent = fmtElapsed(elapsedMs()); }

function startTimer() {
  clearInterval(state.timerHandle);
  renderTimer();
  state.timerHandle = setInterval(renderTimer, 250);
}

function stopTimer() {
  clearInterval(state.timerHandle);
  state.timerHandle = 0;
}

// ---- Mode: setup card ↔ live pill -----------------------------------------
function setMode(mode) {
  const live = mode === 'live';
  els.setup.hidden = live;
  els.live.hidden = !live;
  els.body.classList.toggle('live', live);
  if (have('panelMode')) {
    Promise.resolve(bridge.panelMode(mode)).catch(() => { /* window keeps its size; surfaces sit top-left */ });
  }
}

// ---- Sources ---------------------------------------------------------------
function sourcesOfKind() {
  return state.sources.filter((s) => (state.kind === 'window' ? s.kind === 'window' : s.kind === 'screen'));
}

function autoPick(list) {
  const auto = list.find((s) => s.kind === 'screen' && s.primary) || list[0];
  return auto ? auto.sourceId : null;
}

function sourceLabel(src, i) {
  if (src.kind === 'screen') {
    const dims = src.width && src.height ? ` · ${src.width}×${src.height}` : '';
    return `${src.label || 'Screen ' + (i + 1)}${src.primary ? ' ★' : ''}${dims}`;
  }
  return String(src.label || '(untitled window)');
}

function renderSources() {
  const list = sourcesOfKind();
  if (!list.some((s) => s.sourceId === state.selectedId)) state.selectedId = autoPick(list);
  while (els.source.firstChild) els.source.removeChild(els.source.firstChild);
  if (!list.length) {
    const opt = document.createElement('option');
    opt.value = '';
    opt.disabled = true;
    opt.selected = true;
    opt.textContent = state.sources.length ? `no ${state.kind}s found` : 'no sources';
    els.source.appendChild(opt);
  }
  list.forEach((src, i) => {
    const opt = document.createElement('option');
    opt.value = src.sourceId;
    opt.textContent = sourceLabel(src, i);
    opt.selected = src.sourceId === state.selectedId;
    els.source.appendChild(opt);
  });
  els.source.title = list.length ? (els.source.selectedOptions[0] || {}).textContent || '' : '';
  for (const b of els.kindBtns) b.setAttribute('aria-checked', String(b.dataset.kind === state.kind));
  refreshRecButton();
}

function setKind(kind) {
  if (state.recording || state.finishing) return;
  if (kind !== 'screen' && kind !== 'window') return;
  state.kind = kind;
  renderSources();
}

function refreshRecButton() {
  if (!have('recStart') || !have('recChunk') || !have('recStop')) return; // already disabled with reason
  if (state.recording || state.finishing) {
    disableWithReason(els.btnRec, 'Recording');
    return;
  }
  if (!state.selectedId) {
    disableWithReason(els.btnRec, 'Pick a source first');
    return;
  }
  els.btnRec.disabled = false;
  els.btnRec.title = 'Start recording';
}

async function loadSources() {
  if (!have('recSources')) return;
  setStatus('Scanning sources…');
  try {
    const list = await bridge.recSources();
    state.sources = Array.isArray(list) ? list : [];
    renderSources();
    const n = sourcesOfKind().length;
    setStatus(state.sources.length ? `${n} ${state.kind}${n === 1 ? '' : 's'} · ready` : 'No sources available');
  } catch (e) {
    state.sources = [];
    renderSources();
    setStatus('Failed to list sources: ' + errMsg(e), 'err');
  }
}

// ---- Audio toggles -----------------------------------------------------------
function renderToggles() {
  els.optMic.setAttribute('aria-pressed', String(state.mic));
  els.optMic.textContent = state.mic ? 'mic on' : 'mic off';
  els.optSys.setAttribute('aria-pressed', String(state.sys));
  els.optSys.textContent = state.sys ? 'system audio on' : 'system audio off';
}

function toggleAudio(which) {
  if (state.recording || state.finishing) return;
  state[which] = !state[which];
  renderToggles();
  // Remembered as the panel's defaults (settings keys main already allows).
  if (have('settingsSet')) {
    Promise.resolve(bridge.settingsSet(which === 'mic' ? { defaultMic: state.mic } : { defaultSysAudio: state.sys })).catch(() => {});
  }
}

async function loadDefaults() {
  if (!have('settingsGet')) return;
  try {
    const s = await bridge.settingsGet();
    if (s && typeof s === 'object') {
      state.mic = !!s.defaultMic;
      state.sys = !!s.defaultSysAudio;
      renderToggles();
    }
  } catch { /* keep off/off */ }
}

// ---- MediaRecorder plumbing ------------------------------------------------
function pickMimeType() {
  const MR = window.MediaRecorder;
  if (!MR || typeof MR.isTypeSupported !== 'function') return { mime: '', fallback: true };
  const candidates = [
    'video/webm;codecs=vp9,opus',
    'video/webm;codecs=vp8,opus',
    'video/webm;codecs=vp9',
    'video/webm;codecs=vp8',
    'video/webm',
  ];
  for (const c of candidates) {
    if (MR.isTypeSupported(c)) return { mime: c, fallback: c !== candidates[0] };
  }
  return { mime: '', fallback: true };
}

async function acquireStream(sourceId, opts) {
  // Video: desktopCapturer source via chromeMediaSourceId.
  const videoConstraints = {
    mandatory: {
      chromeMediaSource: 'desktop',
      chromeMediaSourceId: sourceId,
      minFrameRate: opts.fps || 30,
      maxFrameRate: opts.fps || 30,
    },
  };

  let sysStream = null;
  if (opts.sysAudio) {
    // Loopback audio bound to the same desktop source (the Windows path).
    try {
      sysStream = await navigator.mediaDevices.getUserMedia({
        audio: { mandatory: { chromeMediaSource: 'desktop', chromeMediaSourceId: sourceId } },
        video: videoConstraints,
      });
    } catch {
      state.notes.push('no system audio');
      sysStream = null;
    }
  }

  // If sysStream succeeded it already carries the video track; otherwise grab video alone.
  let videoStream = sysStream;
  if (!videoStream) {
    videoStream = await navigator.mediaDevices.getUserMedia({ audio: false, video: videoConstraints });
  }

  let micStream = null;
  if (opts.mic) {
    try {
      micStream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch {
      state.notes.push('no mic');
      micStream = null;
    }
  }

  // Compose: one video track + up to two audio tracks in a single stream.
  const composed = new MediaStream();
  for (const t of videoStream.getVideoTracks()) composed.addTrack(t);
  for (const t of videoStream.getAudioTracks()) composed.addTrack(t);
  if (micStream) for (const t of micStream.getAudioTracks()) composed.addTrack(t);

  return { composed, videoStream, micStream, sysStream };
}

function stopAllTracks(...streams) {
  for (const s of streams) {
    if (!s) continue;
    try { for (const t of s.getTracks()) t.stop(); } catch { /* ignore */ }
  }
}

function releaseMedia() {
  stopAllTracks(state.stream, state.videoStream, state.micStream, state.sysStream);
  state.stream = state.videoStream = state.micStream = state.sysStream = null;
  state.recorder = null;
}

// ondataavailable: seq is taken synchronously, BEFORE the async read, from 0.
function onChunk(evt) {
  if (!evt.data || evt.data.size === 0) return;   // empty chunks don't consume a seq
  const recId = state.recId;
  const seq = state.seq++;
  const send = evt.data.arrayBuffer().then((buf) => {
    state.bytes += buf.byteLength;
    bridge.recChunk(recId, seq, buf);
  }).catch((e) => {
    // main reports the hole when it stops; say it here too
    state.notes.push('chunk ' + seq + ' lost');
    console.error('[record-panel] chunk', seq, 'lost:', errMsg(e));
  });
  const pending = state.pending;
  pending.add(send);
  send.then(() => pending.delete(send));
}

// onstop: the final dataavailable has fired, but its read may still be in flight.
async function onRecorderStop() {
  try {
    while (state.pending.size) await Promise.allSettled([...state.pending]);
  } finally {
    await finalizeRecord();
  }
}

// User pause and backpressure pause, combined: the recorder runs only when neither holds.
function applyRecorderPause() {
  const r = state.recorder;
  if (!r) return;
  const want = state.userPaused || state.bpPaused;
  try {
    if (want && r.state === 'recording') r.pause();
    else if (!want && r.state === 'paused') r.resume();
  } catch { /* recorder stopping */ }
}

function renderPause() {
  els.body.classList.toggle('paused', state.userPaused);
  els.btnPause.textContent = state.userPaused ? '▶' : '❚❚';
  els.btnPause.title = state.userPaused ? 'Resume' : 'Pause';
  els.btnPause.setAttribute('aria-label', state.userPaused ? 'Resume' : 'Pause');
  els.live.title = state.userPaused ? 'Paused — paused time is not recorded' : (state.bpPaused ? 'Waiting for the disk to catch up' : '');
}

function togglePause() {
  if (!state.recording || state.finishing || !have('recPause')) return;
  const now = Date.now();
  state.userPaused = !state.userPaused;
  if (state.userPaused) state.pausedAt = now;
  else if (state.pausedAt != null) { state.pausedTotal += now - state.pausedAt; state.pausedAt = null; }
  try { bridge.recPause(state.recId, state.userPaused); } catch { /* main keeps counting; display still honest locally */ }
  applyRecorderPause();
  renderPause();
  renderTimer();
}

async function beginRecord() {
  if (!have('recStart') || !have('recChunk') || !have('recStop')) {
    setStatus('Recorder bridge is missing', 'err');
    return;
  }
  if (state.recording || state.finishing) return;
  if (!state.selectedId) {
    setStatus('Pick a source first', 'warn');
    return;
  }
  const { mime, fallback } = pickMimeType();
  if (!mime) {
    setStatus('No supported WebM codec on this Chromium build', 'err');
    return;
  }
  const src = state.sources.find((s) => s.sourceId === state.selectedId) || null;
  const opts = {
    sourceId: state.selectedId,
    sourceLabel: src ? String(src.label || '') : '',
    mic: state.mic,
    sysAudio: state.sys,
    fps: 30,
  };

  els.btnReveal.hidden = true;
  state.notes = [];
  if (fallback) state.notes.push('codec ' + mime);
  disableWithReason(els.btnRec, 'Starting…');
  setStatus('Starting recorder…');

  // 1. Acquire the media stream FIRST — a permission or driver failure reserves no file.
  let acquired;
  try {
    acquired = await acquireStream(opts.sourceId, opts);
  } catch (e) {
    setStatus('Capture failed: ' + errMsg(e), 'err');
    refreshRecButton();
    return;
  }
  const dropAcquired = () => stopAllTracks(acquired.composed, acquired.videoStream, acquired.micStream, acquired.sysStream);

  // 2. Ask main to open the .part file and hand us a recId.
  let startInfo;
  try {
    startInfo = await bridge.recStart(opts);
  } catch (e) {
    dropAcquired();
    setStatus('recStart failed: ' + errMsg(e), 'err');
    refreshRecButton();
    return;
  }
  if (!startInfo || !startInfo.recId) {
    dropAcquired();
    setStatus('Recorder rejected start' + (startInfo && startInfo.error ? ': ' + startInfo.error : ''), 'err');
    refreshRecButton();
    return;
  }

  Object.assign(state, {
    recId: startInfo.recId, seq: 0, bytes: 0, pending: new Set(),
    userPaused: false, bpPaused: false, pausedAt: null, pausedTotal: 0, stopReason: null,
    stream: acquired.composed, videoStream: acquired.videoStream,
    micStream: acquired.micStream, sysStream: acquired.sysStream,
  });

  // 3. MediaRecorder — VP9+Opus preferred, falls back if unsupported.
  let recorder;
  try {
    recorder = new MediaRecorder(state.stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
  } catch (e) {
    releaseMedia();
    if (have('recAbort')) bridge.recAbort(state.recId);
    state.recId = null;
    setStatus('MediaRecorder init failed: ' + errMsg(e), 'err');
    refreshRecButton();
    return;
  }
  state.recorder = recorder;
  recorder.ondataavailable = onChunk;
  recorder.onerror = (evt) => {
    const err = evt && evt.error;
    state.notes.push('recorder error: ' + errMsg(err));
    endRecord('main-error');
  };
  recorder.onstop = () => {
    onRecorderStop().catch((e) => setStatus('Finalize failed: ' + errMsg(e), 'err'));
  };

  try {
    recorder.start(500); // 500 ms timeslice
  } catch (e) {
    releaseMedia();
    if (have('recAbort')) bridge.recAbort(state.recId);
    state.recId = null;
    setStatus('start() failed: ' + errMsg(e), 'err');
    refreshRecButton();
    return;
  }

  state.recording = true;
  state.startedAt = Date.now();
  for (const b of [els.optMic, els.optSys, els.btnRefresh]) b.disabled = true;
  els.source.disabled = true;
  els.btnStop.disabled = false;
  if (have('recPause')) els.btnPause.disabled = false;
  renderPause();
  setMode('live');
  startTimer();
  refreshRecButton();
  setStatus('● Recording');

  // The source went away outside our control (window closed, sharing stopped): stop cleanly.
  const videoTrack = state.stream.getVideoTracks()[0];
  if (videoTrack) {
    videoTrack.addEventListener('ended', () => { if (state.recording) endRecord('source-ended'); });
  }
}

function endRecord(reason) {
  if (!state.recording || state.finishing) return;
  state.finishing = true;
  state.stopReason = reason || 'user';
  els.body.classList.add('finishing');
  els.btnStop.disabled = true;
  els.btnPause.disabled = true;
  stopTimer();
  renderTimer();
  els.timer.textContent = 'saving…';
  // A recorder paused by the user stops fine from 'paused'; close the open span first.
  if (state.pausedAt != null) { state.pausedTotal += Date.now() - state.pausedAt; state.pausedAt = null; }
  try {
    if (state.recorder && state.recorder.state !== 'inactive') {
      state.recorder.stop();            // → last dataavailable → onstop → onRecorderStop
    } else {
      onRecorderStop().catch(() => {});
    }
  } catch (e) {
    setStatus('Stop failed: ' + errMsg(e), 'err');
    onRecorderStop().catch(() => {});
  }
}

function savedText(p, verb) {
  const stem = String(p).split(/[/\\]/).pop() || 'recording.webm';
  const lead = STOP_TEXT[state.stopReason] || '';
  return [lead, `${verb} ${stem}`].concat(state.notes).filter(Boolean).join(' · ');
}

function showReveal(p) {
  state.lastPath = String(p);
  els.btnReveal.hidden = !have('libraryReveal');
  els.btnReveal.title = 'Show in folder';
}

async function finalizeRecord() {
  releaseMedia();
  const recId = state.recId;
  state.recId = null;
  state.recording = false;

  if (!recId || !have('recStop')) {
    finishUiReset();
    return;
  }
  try {
    const res = await bridge.recStop(recId);
    const p = (typeof res === 'string') ? res : (res && res.path);
    if (p) {
      if (res && res.gaps) state.notes.push(res.gaps + ' chunk(s) missing');
      setStatus(savedText(p, 'saved'), state.notes.length ? 'warn' : 'saved');
      showReveal(p);
    } else if (res && res.error) {
      setStatus('Save failed: ' + res.error, 'err');
    } else {
      setStatus('Stopped — main returned no file', 'warn');
    }
  } catch (e) {
    setStatus('recStop failed: ' + errMsg(e), 'err');
  } finally {
    finishUiReset();
  }
}

function finishUiReset() {
  stopTimer();
  state.finishing = false;
  state.recording = false;
  state.userPaused = state.bpPaused = false;
  els.body.classList.remove('finishing', 'paused');
  for (const b of [els.optMic, els.optSys]) b.disabled = false;
  if (have('recSources')) els.btnRefresh.disabled = false;
  els.source.disabled = false;
  els.timer.textContent = '00:00';
  setMode('setup');
  refreshRecButton();
}

// ---- Main-process pushes ---------------------------------------------------
function wireStatus() {
  if (!have('recStatus')) return;
  bridge.recStatus((payload) => {
    if (!payload || typeof payload !== 'object') return;
    if (payload.recId && state.recId && payload.recId !== state.recId) return;
    switch (payload.state) {
      case 'backpressure':
        if (state.recording && !state.bpPaused) { state.bpPaused = true; applyRecorderPause(); renderPause(); }
        break;
      case 'drained':
        if (state.bpPaused) { state.bpPaused = false; applyRecorderPause(); renderPause(); }
        break;
      case 'auto-split':
        // Main stops at the 30-min limit (recording does not continue in a new file);
        // the stop itself arrives as a rec-command.
        if (state.recording) state.stopReason = 'limit';
        break;
      case 'stopped-lowdisk':
        endRecord('lowdisk');
        break;
      case 'error':
        endRecord('main-error');
        break;
      case 'stopped':
      case 'aborted':
        // Main finalized without us (hard stop after 3 s, or the panel was slow): tear down
        // locally without calling recStop — the file is already closed.
        if (state.recording && !state.finishing) {
          state.finishing = true;
          if (!state.stopReason) state.stopReason = 'main';
          try { if (state.recorder && state.recorder.state !== 'inactive') { state.recorder.onstop = null; state.recorder.stop(); } } catch { /* ignore */ }
          releaseMedia();
          state.recId = null;
          state.recording = false;
          if (payload.state === 'stopped' && payload.lastPath) {
            setStatus(savedText(payload.lastPath, 'saved'), 'saved');
            showReveal(payload.lastPath);
          } else {
            setStatus(payload.state === 'aborted' ? 'Recording discarded (main)' : 'Stopped (main)', 'warn');
          }
          finishUiReset();
        }
        break;
      default:
        break;   // 'recording' ticks: the pill keeps its own (identical) clock
    }
  });
}

function wireCommands() {
  if (!have('onRecCommand')) return;
  bridge.onRecCommand((cmd) => {
    if (!cmd || cmd.cmd !== 'stop') return;
    if (cmd.recId && state.recId && cmd.recId !== state.recId) return;
    endRecord(Object.prototype.hasOwnProperty.call(STOP_TEXT, cmd.reason) ? cmd.reason : 'main');
  });
}

// ---- Wiring ----------------------------------------------------------------
function hidePanel() {
  if (state.recording || state.finishing || !have('panelToggle')) return;
  Promise.resolve(bridge.panelToggle()).catch(() => {});
}

function wireControls() {
  for (const b of els.kindBtns) b.addEventListener('click', () => setKind(b.dataset.kind));
  els.source.addEventListener('change', () => {
    state.selectedId = els.source.value || null;
    els.source.title = (els.source.selectedOptions[0] || {}).textContent || '';
    refreshRecButton();
  });
  els.btnRefresh.addEventListener('click', () => { if (!state.recording && !state.finishing) loadSources(); });
  els.btnHide.addEventListener('click', hidePanel);
  els.optMic.addEventListener('click', () => toggleAudio('mic'));
  els.optSys.addEventListener('click', () => toggleAudio('sys'));
  els.btnRec.addEventListener('click', () => { if (!state.recording && !state.finishing) beginRecord(); });
  els.btnPause.addEventListener('click', togglePause);
  els.btnStop.addEventListener('click', () => endRecord('user'));
  els.btnReveal.addEventListener('click', () => {
    if (!have('libraryReveal') || !state.lastPath) return;
    Promise.resolve(bridge.libraryReveal(state.lastPath)).catch((e) => setStatus('Reveal failed: ' + errMsg(e), 'err'));
  });
  window.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && !state.recording && !state.finishing) { e.preventDefault(); hidePanel(); }
  });

  // Page going away mid-recording: ask main to keep what it has (it also stops the
  // recording itself when this window's webContents is destroyed).
  window.addEventListener('beforeunload', () => {
    if (state.recording) {
      try { if (state.recorder) { state.recorder.onstop = null; state.recorder.stop(); } } catch { /* ignore */ }
      if (state.recId && have('recStop')) bridge.recStop(state.recId);
      releaseMedia();
    }
  });
}

// ---- Boot ------------------------------------------------------------------
function boot() {
  renderToggles();
  els.btnPause.disabled = true;
  els.btnStop.disabled = true;
  if (!ensureBridge()) return;
  wireControls();
  wireStatus();
  wireCommands();
  setMode('setup');   // a reload mid-recording leaves the window pill-sized; the take was saved by main
  loadDefaults();
  loadSources();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
