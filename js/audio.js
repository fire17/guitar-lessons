// audio.js: Karplus-Strong plucked strings, clip player, strum, metronome, sfx (DESIGN §11). No audio files.
import * as store from "./store.js";

let ctx = null;
let master = null;
let out = null;
const cache = new Map();
let currentClip = null;
const pendingOnUnlock = [];

export function context() { return ctx; }
export function isUnlocked() { return !!ctx && ctx.state === "running"; }

function soundOn() {
  const s = store.settings();
  return s.sound !== false;
}

export function ensure() {
  if (!ctx) {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return null;
    ctx = new AC({ latencyHint: "interactive" });
    // iOS: "playback" plays through the ringer/silent switch (Safari 16.4+), so ear training is not silently muted
    try { if (navigator.audioSession) navigator.audioSession.type = "playback"; } catch (e) { /* ignore */ }
    master = ctx.createGain();
    master.gain.value = store.settings().volume ?? 0.8;
    const body = ctx.createBiquadFilter();
    body.type = "peaking"; body.frequency.value = 110; body.gain.value = 3; body.Q.value = 1;
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = 5500;
    const comp = ctx.createDynamicsCompressor();
    comp.threshold.value = -18; comp.ratio.value = 4;
    master.connect(body); body.connect(lp); lp.connect(comp); comp.connect(ctx.destination);
    out = master;
    ctx.onstatechange = () => {
      if (ctx.state === "running") {
        while (pendingOnUnlock.length) { try { pendingOnUnlock.shift()(); } catch (e) { console.error(e); if (window.__errors) window.__errors.push("audio unlock: " + String((e && e.message) || e)); } }
      }
    };
  }
  // iOS reports "interrupted" after a call / Siri / app switch, not "suspended"
  if (ctx.state !== "running") ctx.resume().catch(() => {});
  return ctx;
}
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "visible" && ctx && ctx.state !== "running") ctx.resume().catch(() => {});
});

// unlock on the first gesture anywhere (§11.1)
export function installUnlock() {
  const h = () => { ensure(); };
  ["pointerdown", "keydown", "touchend"].forEach((ev) => window.addEventListener(ev, h, { capture: true, passive: true }));
}

export function setVolume(v) { if (master) master.gain.value = v; }

// ---- Karplus-Strong (§11.2) ----
export function renderKS(midi, sr, t60Override) {
  const f = 440 * 2 ** ((midi - 69) / 12);
  const N = Math.max(2, Math.round(sr / f - 0.5));
  const f0 = sr / (N + 0.5);
  const T60 = t60Override ?? Math.min(4.5, Math.max(1.2, 4.5 - (midi - 40) * 0.06));
  const rho = 0.001 ** (1 / (f0 * T60));
  const len = Math.ceil(sr * Math.min(T60, 3.0));
  const y = new Float32Array(len);
  let prev = 0;
  for (let n = 0; n < N && n < len; n++) {
    const w = Math.random() * 2 - 1;
    const x = 0.5 * w + 0.5 * prev;
    prev = x;
    y[n] = x;
  }
  for (let n = N; n < len; n++) {
    y[n] = rho * 0.5 * (y[n - N] + (n - N - 1 >= 0 ? y[n - N - 1] : 0));
  }
  const fade = Math.floor(sr * 0.01);
  for (let i = 0; i < fade; i++) y[len - 1 - i] *= i / fade;
  let peak = 0;
  for (let i = 0; i < len; i++) peak = Math.max(peak, Math.abs(y[i]));
  if (peak > 0) { const g = 0.6 / peak; for (let i = 0; i < len; i++) y[i] *= g; }
  return { data: y, rate: f / f0, N, f0, f };
}

function buffer(midi, t60) {
  const k = t60 ? `${midi}@${t60}` : String(midi);
  let b = cache.get(k);
  if (!b) {
    const r = renderKS(midi, ctx.sampleRate, t60);
    const ab = ctx.createBuffer(1, r.data.length, ctx.sampleRate);
    ab.copyToChannel ? ab.copyToChannel(r.data, 0) : ab.getChannelData(0).set(r.data);
    b = { ab, rate: r.rate };
    cache.set(k, b);
  }
  return b;
}

export function prerender(midis) {
  if (!ctx) return;
  const list = [...new Set(midis)].filter((m) => !cache.has(String(m)));
  if (!list.length) return;
  const idle = window.requestIdleCallback || ((fn) => setTimeout(fn, 30));
  const step = () => { const m = list.shift(); if (m != null) { buffer(m); idle(step); } };
  idle(step);
}

// one plucked note; returns { src, gain }
export function pluck(midi, when = 0, gain = 0.5, opts = {}) {
  if (!ensure() || !soundOn()) return null;
  const t = Math.max(ctx.currentTime, when || ctx.currentTime);
  const b = buffer(midi, opts.t60);
  const src = ctx.createBufferSource();
  src.buffer = b.ab;
  src.playbackRate.value = b.rate;
  const g = ctx.createGain();
  g.gain.value = gain;
  let node = g;
  src.connect(g);
  if (opts.lowpass) {
    const lp = ctx.createBiquadFilter();
    lp.type = "lowpass"; lp.frequency.value = opts.lowpass;
    g.connect(lp); node = lp;
  }
  node.connect(out);
  src.start(t);
  return { src, gain: g, t };
}

function damp(voices, at, ramp = 0.06) {
  for (const v of voices) {
    if (!v) continue;
    try {
      v.gain.gain.setValueAtTime(v.gain.gain.value, at);
      v.gain.gain.linearRampToValueAtTime(0, at + ramp);
      v.src.stop(at + ramp + 0.02);
    } catch (e) { /* already stopped */ }
  }
}

export function strum(notes, when, { gain = 0.55, down = true, gap = 0.02 } = {}) {
  const sorted = notes.slice().sort((a, b) => a - b);
  if (!down) sorted.reverse();
  const g = gain / Math.sqrt(sorted.length || 1);
  return sorted.map((m, i) => pluck(m, when + i * gap, g));
}

// ---- clip playback (§11.3) ----
export function playClip(clip, { rate = 1, onBeat, onEvent } = {}) {
  stopClip();
  if (!ensure() || !soundOn()) {
    return { done: Promise.resolve(false), stop() {} };
  }
  const t0 = ctx.currentTime + 0.08;
  const spb = 60 / (clip.bpm * rate);
  let t = t0;
  const all = [];
  const timers = [];
  let prevVoices = [];
  let beatIndex = 0;
  clip.events.forEach((ev, ei) => {
    const evStart = t;
    if (prevVoices.length) damp(prevVoices, evStart);
    let voices = strum(ev.notes, evStart, { gain: 0.55, down: true, gap: 0.02 });
    const evVoices = [...voices];
    if (onEvent) timers.push(setTimeout(() => onEvent(ei, ev), Math.max(0, (evStart - ctx.currentTime) * 1000)));
    for (let b = 0; b < ev.beats; b++) {
      const bt = evStart + b * spb;
      const bi = beatIndex++;
      if (onBeat) timers.push(setTimeout(() => onBeat(bi, b), Math.max(0, (bt - ctx.currentTime) * 1000)));
      if (clip.strum_every_beat && b > 0) {
        damp(voices, bt, 0.03);
        const down = b % 2 === 0;
        voices = strum(ev.notes, bt, { gain: 0.55 * (down ? 1 : 0.8), down, gap: down ? 0.02 : 0.015 });
        evVoices.push(...voices);
      }
    }
    prevVoices = voices;
    all.push(...evVoices);
    t += ev.beats * spb;
  });
  const endAt = t + 0.4;
  let resolve;
  const done = new Promise((r) => { resolve = r; });
  timers.push(setTimeout(() => resolve(true), Math.max(0, (endAt - ctx.currentTime) * 1000)));
  const handle = {
    done,
    stop() {
      timers.forEach(clearTimeout);
      const now = ctx.currentTime;
      damp(all, now, 0.04);
      resolve(false);
      if (currentClip === handle) currentClip = null;
    },
  };
  currentClip = handle;
  return handle;
}
export function stopClip() { if (currentClip) currentClip.stop(); currentClip = null; }

export function clipNotes(clips) {
  const s = [];
  (clips || []).forEach((c) => c.events.forEach((e) => s.push(...e.notes)));
  return s;
}

// chord progression → clip (tools, post-answer ▶ לשמוע)
export function progressionClip(chords, voicingFn, { bpm = 80, beats = 2, every = false } = {}) {
  return { bpm, strum_every_beat: every, events: chords.map((c) => ({ label: c, notes: voicingFn(c), beats })) };
}

// ---- sfx (§11.5) ----
function sfxOn() { return store.settings().sfx !== false && soundOn(); }
export function sfx(kind) {
  if (!sfxOn() || !ensure() || ctx.state !== "running") return;
  const t = ctx.currentTime + 0.02;
  if (kind === "correct") { pluck(55, t, 0.35); pluck(62, t + 0.03, 0.35); }
  else if (kind === "wrong") { pluck(40, t, 0.3, { t60: 0.3, lowpass: 800 }); }
  else if (kind === "complete") { [55, 59, 62, 67].forEach((m, i) => pluck(m, t + i * 0.09, 0.4)); }
}

// ---- metronome (§11.4) ----
export function click(when, accent = false, gain = 0.5) {
  if (!ensure()) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = "sine";
  o.frequency.value = accent ? 1500 : 1000;
  g.gain.setValueAtTime(0.0001, when);
  g.gain.exponentialRampToValueAtTime(gain, when + 0.001);
  g.gain.exponentialRampToValueAtTime(0.0001, when + 0.031);
  o.connect(g); g.connect(out);
  o.start(when); o.stop(when + 0.05);
}

export function Metronome({ bpm = 70, beats = 4, accent = true, onBeat } = {}) {
  let timer = null;
  let next = 0;
  let beat = 0;
  const m = {
    bpm, beats, accent, running: false,
    start() {
      if (!ensure()) return;
      m.running = true;
      next = ctx.currentTime + 0.06;
      beat = 0;
      timer = setInterval(tick, 25);
      tick();
    },
    stop() { m.running = false; clearInterval(timer); timer = null; },
    toggle() { m.running ? m.stop() : m.start(); },
  };
  function tick() {
    while (next < ctx.currentTime + 0.1) {
      const b = beat % m.beats;
      if (soundOn()) click(next, m.accent && b === 0);
      if (onBeat) {
        const at = next;
        setTimeout(() => onBeat(b), Math.max(0, (at - ctx.currentTime) * 1000));
      }
      next += 60 / m.bpm;
      beat++;
    }
  }
  return m;
}

// ---- pitch test (#/dev, §21.1) ----
export function estimatePitch(data, sr, N) {
  const start = Math.floor(sr * 0.1);
  const W = 8192;
  const lo = Math.floor(0.8 * N), hi = Math.ceil(1.2 * N);
  let best = -Infinity, bestLag = lo;
  const r = new Float64Array(hi + 2);
  for (let lag = lo - 1; lag <= hi + 1; lag++) {
    let s = 0;
    for (let i = 0; i < W; i++) s += data[start + i] * data[start + i + lag];
    r[lag] = s;
  }
  for (let lag = lo; lag <= hi; lag++) if (r[lag] > best) { best = r[lag]; bestLag = lag; }
  const a = r[bestLag - 1], b = r[bestLag], c = r[bestLag + 1];
  const den = a - 2 * b + c;
  const delta = den !== 0 ? 0.5 * (a - c) / den : 0;
  return sr / (bestLag + delta);
}

export function pitchTest(sr = 48000) {
  const rows = [];
  for (let midi = 40; midi <= 76; midi++) {
    const r = renderKS(midi, sr);
    const est = estimatePitch(r.data, sr, r.N) * r.rate;
    const cents = 1200 * Math.log2(est / r.f);
    rows.push({ midi, f: r.f, est, cents });
  }
  const max = Math.max(...rows.map((x) => Math.abs(x.cents)));
  return { rows, maxAbsCents: max, sr };
}

// play when unlocked, or ask for a tap (§11.1)
export function whenUnlocked(fn) {
  ensure();
  if (isUnlocked()) { fn(); return true; }
  pendingOnUnlock.push(fn);
  return false;
}
