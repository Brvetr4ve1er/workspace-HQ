/* record-panel.js — v3 STUDIO record cockpit
 *
 * Owned by Group 3 (frontend lane). Contract with Group 1 (main-process
 * screen-capture module) is via window.hq.studio.rec* + snip-sources.
 *
 * Behaviour:
 *   - list sources with recSources() and render a thumbnail grid
 *   - one-click select, then click the big red REC to start
 *   - MediaRecorder(video/webm;codecs=vp9,opus), 500ms timeslice
 *   - every ondataavailable → arrayBuffer → recChunk(recId, seq, buf)
 *   - onstop → recStop(recId); saved state shows Reveal
 *   - mic and system-audio toggles composed into a single MediaStream
 *   - status pushes from main (backpressure / drained / stopped / lowdisk / error)
 *     handled via onRecStatus so pause/resume happens without polling
 *
 * XSS: every source label + every timer + every status message is written with
 * textContent. No innerHTML anywhere on untrusted data.
 *
 * Button discipline: every control that would call a missing bridge method
 * starts disabled with a title="<reason>". No dead or lying controls.
 */
'use strict';

const bridge = (window.hq && window.hq.studio) || null;

// ---- DOM handles -----------------------------------------------------------
const $ = (id) => document.getElementById(id);
const els = {
  body:         document.body,
  sources:      $('sources'),
  sourcesEmpty: $('sourcesEmpty'),
  optMic:       $('optMic'),
  optSys:       $('optSys'),
  btnRec:       $('btnRec'),
  btnRecLbl:    $('btnRecLbl'),
  btnReveal:    $('btnReveal'),
  btnRefresh:   $('btnRefresh'),
  timer:        $('timer'),
  statusText:   $('statusText'),
};

// ---- Runtime state ---------------------------------------------------------
const state = {
  sources: [],
  selectedId: null,        // string sourceId or null
  recording: false,
  finishing: false,        // stop button pressed, awaiting flush
  recId: null,             // opaque id from main
  seq: 0,                  // monotonic chunk sequence
  startedAt: 0,
  timerHandle: 0,
  stream: null,            // MediaStream
  micStream: null,         // separate for cleanup
  sysStream: null,         // separate for cleanup
  recorder: null,          // MediaRecorder
  lastPath: null,          // final path on success
  bytes: 0,
  bpPaused: false,         // paused for backpressure
};

// ---- Bridge helpers --------------------------------------------------------
function have(name) { return !!(bridge && typeof bridge[name] === 'function'); }

function disableWithReason(btn, reason) {
  btn.disabled = true;
  btn.title = reason;
}

function ensureBridge() {
  if (!bridge) {
    setStatus('Bridge unavailable — reload the app', 'err');
    disableWithReason(els.btnRec,     'window.hq.studio is not exposed');
    disableWithReason(els.btnRefresh, 'window.hq.studio is not exposed');
    disableWithReason(els.btnReveal,  'window.hq.studio is not exposed');
    els.optMic.disabled = true; els.optMic.title = 'Bridge unavailable';
    els.optSys.disabled = true; els.optSys.title = 'Bridge unavailable';
    return false;
  }
  if (!have('recSources')) disableWithReason(els.btnRefresh, 'recSources missing on bridge');
  if (!have('recStart') || !have('recChunk') || !have('recStop')) {
    disableWithReason(els.btnRec, 'recStart / recChunk / recStop missing on bridge');
  }
  if (!have('libraryReveal')) disableWithReason(els.btnReveal, 'libraryReveal missing on bridge');
  return true;
}

// ---- Status / timer --------------------------------------------------------
function setStatus(text, kind) {
  els.statusText.textContent = String(text || '');
  els.body.classList.remove('err', 'saved', 'warn');
  if (kind) els.body.classList.add(kind);
}

function fmtElapsed(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n) => n < 10 ? '0' + n : String(n);
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

function fmtBytes(n) {
  if (!n || n < 1024) return `${n | 0} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  if (n < 1024 * 1024 * 1024) return `${(n / (1024 * 1024)).toFixed(1)} MB`;
  return `${(n / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

function startTimer() {
  clearInterval(state.timerHandle);
  state.timerHandle = setInterval(() => {
    const ms = Date.now() - state.startedAt;
    els.timer.textContent = fmtElapsed(ms);
  }, 250);
}

function stopTimer() {
  clearInterval(state.timerHandle);
  state.timerHandle = 0;
}

// ---- Source rendering ------------------------------------------------------
function clearSources() {
  while (els.sources.firstChild) els.sources.removeChild(els.sources.firstChild);
}

function renderSources() {
  clearSources();
  if (!state.sources.length) {
    els.sourcesEmpty.hidden = false;
    return;
  }
  els.sourcesEmpty.hidden = true;

  for (const src of state.sources) {
    const tile = document.createElement('div');
    tile.className = 'src';
    tile.setAttribute('role', 'radio');
    tile.setAttribute('tabindex', '0');
    tile.setAttribute('aria-checked', String(src.sourceId === state.selectedId));
    tile.dataset.sourceId = src.sourceId;

    const thumb = document.createElement('div');
    thumb.className = 'thumb';
    if (src.thumbnail && typeof src.thumbnail === 'string' && src.thumbnail.startsWith('data:image/')) {
      // data: URLs allowed under CSP default-src 'self' img-src fallback — main
      // provides them; we only trust the data: scheme prefix, never inline HTML.
      thumb.style.backgroundImage = `url("${src.thumbnail}")`;
    } else {
      thumb.classList.add('placeholder');
      thumb.textContent = 'no preview';
    }
    tile.appendChild(thumb);

    const meta = document.createElement('div');
    meta.className = 'meta';

    const kind = document.createElement('span');
    kind.className = 'kind ' + (src.kind === 'screen' ? 'screen' : 'window');
    kind.textContent = src.kind === 'screen' ? 'Screen' : 'Window';
    meta.appendChild(kind);

    const name = document.createElement('span');
    name.className = 'name';
    name.textContent = String(src.label || '(unnamed)');
    name.title = String(src.label || '(unnamed)') + (src.width && src.height ? ` — ${src.width}×${src.height}` : '');
    meta.appendChild(name);

    if (src.primary) {
      const prim = document.createElement('span');
      prim.className = 'prim';
      prim.textContent = '★';
      prim.title = 'Primary display';
      meta.appendChild(prim);
    }

    tile.appendChild(meta);

    tile.addEventListener('click', () => selectSource(src.sourceId));
    tile.addEventListener('keydown', (e) => {
      if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); selectSource(src.sourceId); }
    });

    els.sources.appendChild(tile);
  }
}

function selectSource(sourceId) {
  if (state.recording || state.finishing) return; // don't hot-swap mid-record
  state.selectedId = sourceId;
  for (const tile of els.sources.querySelectorAll('.src')) {
    tile.setAttribute('aria-checked', String(tile.dataset.sourceId === sourceId));
  }
  refreshRecButton();
}

function refreshRecButton() {
  if (!have('recStart') || !have('recChunk') || !have('recStop')) return; // already disabled with reason
  if (state.recording) {
    els.btnRec.disabled = false;
    els.btnRec.title = 'Stop recording';
    els.btnRecLbl.textContent = 'Stop';
    return;
  }
  if (state.finishing) {
    els.btnRec.disabled = true;
    els.btnRec.title = 'Finalizing…';
    els.btnRecLbl.textContent = 'Saving…';
    return;
  }
  if (!state.selectedId) {
    disableWithReason(els.btnRec, 'Pick a source first');
    els.btnRecLbl.textContent = 'Record';
    return;
  }
  els.btnRec.disabled = false;
  els.btnRec.title = 'Start recording';
  els.btnRecLbl.textContent = 'Record';
}

async function loadSources() {
  if (!have('recSources')) return;
  setStatus('Scanning sources…');
  try {
    const list = await bridge.recSources();
    state.sources = Array.isArray(list) ? list : [];
    // Preserve selection if still valid; otherwise auto-pick primary screen.
    if (state.selectedId && !state.sources.some((s) => s.sourceId === state.selectedId)) {
      state.selectedId = null;
    }
    if (!state.selectedId) {
      const auto = state.sources.find((s) => s.kind === 'screen' && s.primary)
                || state.sources.find((s) => s.kind === 'screen')
                || state.sources[0];
      state.selectedId = auto ? auto.sourceId : null;
    }
    renderSources();
    refreshRecButton();
    setStatus(state.sources.length
      ? `${state.sources.length} source${state.sources.length === 1 ? '' : 's'} — ready`
      : 'No sources available');
  } catch (e) {
    // e.message is a chromium error, not user-supplied — but still route via
    // textContent path (setStatus does that).
    setStatus('Failed to list sources: ' + (e && e.message ? e.message : 'unknown'), 'err');
    state.sources = [];
    renderSources();
  }
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
    // Try to bind loopback audio to the same desktop source (Windows path).
    try {
      sysStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          mandatory: {
            chromeMediaSource: 'desktop',
            chromeMediaSourceId: sourceId,
          },
        },
        video: videoConstraints,
      });
    } catch (e) {
      // System audio failed — surface but keep going with video-only path.
      setStatus('System audio unavailable — recording without it', 'warn');
      sysStream = null;
    }
  }

  // If sysStream succeeded it already has the video track; otherwise grab video alone.
  let videoStream = sysStream;
  if (!videoStream) {
    videoStream = await navigator.mediaDevices.getUserMedia({
      audio: false,
      video: videoConstraints,
    });
  }

  let micStream = null;
  if (opts.mic) {
    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: true,
        video: false,
      });
    } catch (e) {
      setStatus('Mic unavailable — recording without it', 'warn');
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

async function beginRecord() {
  if (!have('recStart') || !have('recChunk') || !have('recStop')) {
    setStatus('Recorder bridge is missing', 'err');
    return;
  }
  if (!state.selectedId) {
    setStatus('Pick a source first', 'warn');
    return;
  }
  const { mime, fallback } = pickMimeType();
  if (!mime) {
    setStatus('No supported WebM codec on this Chromium build', 'err');
    return;
  }

  const opts = {
    sourceId: state.selectedId,
    mic:      !!els.optMic.checked,
    sysAudio: !!els.optSys.checked,
    fps:      30,
  };

  // Freeze the picker UI + hide any prior Reveal so the state is unambiguous.
  els.btnReveal.hidden = true;
  els.body.classList.remove('saved', 'err', 'warn');
  els.btnRec.disabled = true;
  els.btnRec.title = 'Starting…';
  setStatus('Starting recorder…');

  // 1. Acquire the media stream FIRST — that's where the user sees a permission
  //    dialog or a driver-level failure. If it fails we haven't reserved a file.
  let acquired;
  try {
    acquired = await acquireStream(opts.sourceId, opts);
  } catch (e) {
    setStatus('Capture failed: ' + (e && e.message ? e.message : 'unknown'), 'err');
    refreshRecButton();
    return;
  }

  // 2. Ask main to open the .part file and hand us a recId.
  let startInfo;
  try {
    startInfo = await bridge.recStart(opts);
  } catch (e) {
    stopAllTracks(acquired.composed, acquired.videoStream, acquired.micStream, acquired.sysStream);
    setStatus('recStart failed: ' + (e && e.message ? e.message : 'unknown'), 'err');
    refreshRecButton();
    return;
  }
  if (!startInfo || !startInfo.recId) {
    stopAllTracks(acquired.composed, acquired.videoStream, acquired.micStream, acquired.sysStream);
    setStatus('Recorder rejected start', 'err');
    refreshRecButton();
    return;
  }

  state.recId = startInfo.recId;
  state.seq = 0;
  state.bytes = 0;
  state.bpPaused = false;
  state.stream = acquired.composed;
  state.micStream = acquired.micStream;
  state.sysStream = acquired.sysStream;

  // 3. MediaRecorder — VP9+Opus preferred, gracefully falls back if unsupported.
  let recorder;
  try {
    recorder = new MediaRecorder(state.stream, { mimeType: mime, videoBitsPerSecond: 8_000_000 });
  } catch (e) {
    stopAllTracks(state.stream, acquired.videoStream, state.micStream, state.sysStream);
    await bridge.recAbort(state.recId).catch(() => {});
    setStatus('MediaRecorder init failed: ' + (e && e.message ? e.message : 'unknown'), 'err');
    state.recId = null;
    refreshRecButton();
    return;
  }
  state.recorder = recorder;

  recorder.ondataavailable = async (evt) => {
    if (!evt.data || evt.data.size === 0) return;
    try {
      const buf = await evt.data.arrayBuffer();
      state.bytes += buf.byteLength;
      bridge.recChunk(state.recId, ++state.seq, buf);
      // 1Hz footer refresh so we don't spam DOM during recording.
      if (state.seq % 2 === 0) {
        const elapsed = fmtElapsed(Date.now() - state.startedAt);
        setStatus(`● ${elapsed} · ${fmtBytes(state.bytes)}`);
      }
    } catch (e) {
      setStatus('Chunk drop: ' + (e && e.message ? e.message : 'unknown'), 'warn');
    }
  };

  recorder.onerror = (evt) => {
    const err = evt && evt.error;
    setStatus('Recorder error: ' + (err && err.message ? err.message : 'unknown'), 'err');
  };

  recorder.onstop = () => {
    // The final ondataavailable has already fired synchronously in Chromium's
    // MediaRecorder before onstop, so state.seq is fully flushed by now.
    finalizeRecord().catch((e) => {
      setStatus('Finalize failed: ' + (e && e.message ? e.message : 'unknown'), 'err');
    });
  };

  try {
    recorder.start(500); // 500 ms timeslice — chunk cadence per Group 3 spec
  } catch (e) {
    stopAllTracks(state.stream, acquired.videoStream, state.micStream, state.sysStream);
    await bridge.recAbort(state.recId).catch(() => {});
    setStatus('start() failed: ' + (e && e.message ? e.message : 'unknown'), 'err');
    state.recId = null;
    refreshRecButton();
    return;
  }

  state.recording = true;
  state.startedAt = Date.now();
  els.body.classList.add('rec');
  els.optMic.disabled = true; els.optSys.disabled = true;
  els.btnRefresh.disabled = true;
  els.timer.textContent = '00:00';
  startTimer();
  refreshRecButton();
  setStatus(fallback ? `● Recording (codec fallback: ${mime})` : '● Recording');

  // If the video track ends outside our control (user stopped sharing at OS
  // level), stop cleanly. Only fires for tracks we didn't stop ourselves.
  const videoTrack = state.stream.getVideoTracks()[0];
  if (videoTrack) {
    videoTrack.addEventListener('ended', () => {
      if (state.recording) endRecord({ reason: 'source-ended' });
    });
  }
}

function endRecord(reason) {
  if (!state.recording || state.finishing) return;
  state.finishing = true;
  els.body.classList.add('finishing');
  els.btnRec.disabled = true;
  els.btnRec.title = 'Finalizing…';
  els.btnRecLbl.textContent = 'Saving…';
  stopTimer();
  setStatus('Stopping…');
  try {
    if (state.recorder && state.recorder.state !== 'inactive') {
      state.recorder.stop();
    } else {
      // No recorder — go straight to finalize.
      finalizeRecord().catch(() => {});
    }
  } catch (e) {
    setStatus('Stop failed: ' + (e && e.message ? e.message : 'unknown'), 'err');
  }
}

async function finalizeRecord() {
  // Tear down media first — releases the display capture handle.
  stopAllTracks(state.stream, state.micStream, state.sysStream);
  state.stream = state.micStream = state.sysStream = null;
  state.recorder = null;

  const recId = state.recId;
  state.recId = null;
  state.recording = false;

  if (!recId || !have('recStop')) {
    finishUiReset();
    return;
  }
  try {
    const res = await bridge.recStop(recId);
    if (res && res.path) {
      state.lastPath = String(res.path);
      const stem = state.lastPath.split(/[/\\]/).pop() || 'recording.webm';
      setStatus('Saved ' + stem, 'saved');
      els.btnReveal.hidden = !have('libraryReveal');
      els.btnReveal.title = have('libraryReveal') ? 'Open the containing folder' : 'libraryReveal missing on bridge';
    } else if (res && res.error) {
      setStatus('Save failed: ' + res.error, 'err');
    } else {
      setStatus('Saved');
    }
  } catch (e) {
    setStatus('recStop failed: ' + (e && e.message ? e.message : 'unknown'), 'err');
  } finally {
    finishUiReset();
  }
}

function finishUiReset() {
  state.finishing = false;
  els.body.classList.remove('rec', 'finishing');
  els.optMic.disabled = false; els.optSys.disabled = false;
  els.btnRefresh.disabled = false;
  els.timer.textContent = '00:00';
  refreshRecButton();
}

// ---- Main-process status stream --------------------------------------------
function wireStatus() {
  if (!have('recStatus')) return;
  bridge.recStatus((payload) => {
    if (!payload || typeof payload !== 'object') return;
    if (payload.recId && state.recId && payload.recId !== state.recId) return;
    switch (payload.state) {
      case 'backpressure':
        if (state.recorder && state.recorder.state === 'recording' && !state.bpPaused) {
          try { state.recorder.pause(); state.bpPaused = true; } catch { /* ignore */ }
          setStatus('Paused (backpressure)…', 'warn');
        }
        break;
      case 'drained':
        if (state.recorder && state.recorder.state === 'paused' && state.bpPaused) {
          try { state.recorder.resume(); state.bpPaused = false; } catch { /* ignore */ }
          setStatus('● Recording (resumed)');
        }
        break;
      case 'auto-split':
        setStatus('Auto-split — recording continues in a new file', 'warn');
        break;
      case 'stopped-lowdisk':
        setStatus('Stopped — low disk space', 'err');
        endRecord({ reason: 'lowdisk' });
        break;
      case 'error':
        setStatus('Recorder error (main)', 'err');
        endRecord({ reason: 'main-error' });
        break;
      default:
        // 'recording' / 'stopped' handled locally; ignore duplicates from main.
        break;
    }
  });
}

// ---- Wiring ----------------------------------------------------------------
function wireControls() {
  els.btnRec.addEventListener('click', () => {
    if (state.finishing) return;
    if (state.recording) endRecord({ reason: 'user' });
    else beginRecord();
  });

  els.btnRefresh.addEventListener('click', () => {
    if (state.recording || state.finishing) return;
    loadSources();
  });

  els.btnReveal.addEventListener('click', () => {
    if (!have('libraryReveal') || !state.lastPath) return;
    bridge.libraryReveal(state.lastPath).catch((e) => {
      setStatus('Reveal failed: ' + (e && e.message ? e.message : 'unknown'), 'err');
    });
  });

  // Guard against page unload while recording — we abort cleanly.
  window.addEventListener('beforeunload', () => {
    if (state.recording) {
      try { state.recorder && state.recorder.stop(); } catch { /* ignore */ }
      if (state.recId && have('recAbort')) bridge.recAbort(state.recId);
      stopAllTracks(state.stream, state.micStream, state.sysStream);
    }
  });
}

// ---- Boot ------------------------------------------------------------------
function boot() {
  if (!ensureBridge()) return;
  wireControls();
  wireStatus();
  loadSources();
}

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', boot);
} else {
  boot();
}
