// tools.js: tools hub, metronome, progression player, fretboard explorer (DESIGN §14.3, §14.6, §14.7)
import { h, iconEl, richText, toast } from "../dom.js";
import * as audio from "../audio.js";
import * as T from "../theory.js";
import * as store from "../store.js";
import { Fretboard } from "../fretboard.js";
import { go } from "../router.js";

let cleanup = [];
export function teardownTools() { cleanup.forEach((f) => { try { f(); } catch (e) { /* ignore */ } }); cleanup = []; }

export const TOOLS = [
  { id: "player", icon: "🔁", title: "נגן מהלכים", sub: "1-5-6-4 וחלק ב' בכל סולם, עם מספרים גדולים", ts: "38:38" },
  { id: "drill", icon: "⚡", title: "תרגיל המהירות", sub: "דרגות על מיתרים 6 ו-5, פחות משתי שניות", ts: "1:32:37" },
  { id: "explorer", icon: "🎸", title: "סייר הצוואר", sub: "הדרגות של כל סולם על הצוואר, והקווינטה כעוגן", ts: "35:36" },
  { id: "songbook", icon: "📒", title: "שירים בדרגות", sub: "לכתוב שירים במספרים ולפענח שירים של אחרים", ts: "1:30:04" },
  { id: "metronome", icon: "⏱️", title: "מטרונום", sub: "60 · 70 · 80 · 160, ומקצב הרמוני מול דאבל טיים", ts: "46:41" },
];

export function renderToolsHub(main) {
  const page = h("div", { class: "page" }, h("h1", { class: "page-title" }, "כלים"), h("p", { class: "page-sub" }, "כלי תרגול מתוך השיעור. כל הצלילים מסונתזים בדפדפן."));
  const grid = h("div", { class: "tool-grid" });
  TOOLS.forEach((t) => {
    grid.appendChild(h("a", { class: "tool-card", href: `#/tools/${t.id}` },
      h("span", { class: "tool-icon", "aria-hidden": "true" }, t.icon),
      h("span", { class: "tool-text" }, h("b", null, t.title), h("small", { html: richText(t.sub) })),
      h("span", { class: "tool-ts", html: richText("⏱ " + t.ts) })));
  });
  page.appendChild(grid);
  page.appendChild(h("p", { class: "muted small tip" }, "אין צליל באייפון? בדוק את מתג השקט."));
  main.appendChild(page);
}

// ---------- shared controls ----------
export function keyChips(current, onPick, keys = T.KEYS12) {
  const row = h("div", { class: "chips-row keys", role: "radiogroup", "aria-label": "סולם" });
  keys.forEach((k) => {
    const b = h("button", { type: "button", class: "chip-btn", role: "radio", "aria-checked": String(k === current), dir: "ltr" }, k);
    b.addEventListener("click", () => {
      row.querySelectorAll(".chip-btn").forEach((x) => x.setAttribute("aria-checked", "false"));
      b.setAttribute("aria-checked", "true");
      onPick(k);
    });
    row.appendChild(b);
  });
  return row;
}

export function seg(options, current, onPick, label) {
  const g = h("div", { class: "seg", role: "radiogroup", "aria-label": label || "" });
  options.forEach(([v, text]) => {
    const b = h("button", { type: "button", class: "seg-btn", role: "radio", "aria-checked": String(v === current), "aria-pressed": String(v === current) }, text);
    b.addEventListener("click", () => {
      g.querySelectorAll(".seg-btn").forEach((x) => { x.setAttribute("aria-checked", "false"); x.setAttribute("aria-pressed", "false"); });
      b.setAttribute("aria-checked", "true");
      b.setAttribute("aria-pressed", "true");
      onPick(v);
    });
    g.appendChild(b);
  });
  return g;
}

export function toggle(label, value, onChange) {
  const input = h("input", { type: "checkbox", class: "switch-input", checked: value || null });
  input.addEventListener("change", () => onChange(input.checked));
  return h("label", { class: "switch" }, input, h("span", { class: "switch-ui", "aria-hidden": "true" }), h("span", { class: "switch-label" }, label));
}

function bpmControl(get, set) {
  const num = h("output", { class: "bpm-num", "aria-live": "polite" }, String(get()));
  const slider = h("input", { type: "range", min: "40", max: "200", value: String(get()), class: "slider", "aria-label": "קצב (BPM)" });
  const upd = (v) => { v = Math.max(40, Math.min(200, Math.round(v))); set(v); num.textContent = String(v); slider.value = String(v); };
  slider.addEventListener("input", () => upd(Number(slider.value)));
  const hold = (btn, d) => {
    let t1 = null, t2 = null, long = false;
    const start = (e) => { e.preventDefault(); long = false; t1 = setTimeout(() => { long = true; upd(get() + d * 5); t2 = setInterval(() => upd(get() + d * 5), 180); }, 450); };
    const end = () => { clearTimeout(t1); clearInterval(t2); if (!long) upd(get() + d); };
    btn.addEventListener("pointerdown", start);
    btn.addEventListener("pointerup", end);
    btn.addEventListener("pointerleave", () => { clearTimeout(t1); clearInterval(t2); });
    btn.addEventListener("keydown", (e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); upd(get() + d); } });
  };
  const minus = h("button", { type: "button", class: "round-btn", "aria-label": "האט" }, iconEl("minus"));
  const plus = h("button", { type: "button", class: "round-btn", "aria-label": "האץ" }, iconEl("plus"));
  hold(minus, -1); hold(plus, 1);
  const el = h("div", { class: "bpm-ctl" }, h("div", { class: "bpm-row" }, plus, h("div", { class: "bpm-box" }, num, h("small", null, "BPM")), minus), slider);
  return { el, upd };
}

// ---------- metronome (§14.7) ----------
export function renderMetronome(main, query) {
  const m = audio.Metronome({ bpm: clampBpm(query.bpm, 70), beats: 4, accent: true, onBeat: (b) => pulse(b) });
  cleanup.push(() => m.stop());
  const dots = h("div", { class: "metro-dots", "aria-hidden": "true" });
  const paintDots = () => { dots.innerHTML = ""; for (let i = 0; i < m.beats; i++) dots.appendChild(h("i", { class: i === 0 ? "one" : "" })); };
  paintDots();
  function pulse(b) { Array.from(dots.children).forEach((d, i) => d.classList.toggle("on", i === b)); }
  const bpm = bpmControl(() => m.bpm, (v) => { m.bpm = v; });
  const presets = h("div", { class: "chips-row" }, [60, 70, 80, 160].map((v) => h("button", { type: "button", class: "chip-btn", onclick: () => bpm.upd(v) }, String(v))));
  const startBtn = h("button", { type: "button", class: "big-play", "aria-label": "הפעל" }, iconEl("play", 34));
  startBtn.addEventListener("click", () => {
    audio.ensure();
    m.toggle();
    startBtn.innerHTML = "";
    startBtn.appendChild(iconEl(m.running ? "stop" : "play", 34));
    startBtn.setAttribute("aria-label", m.running ? "עצור" : "הפעל");
    if (!m.running) pulse(-1);
  });
  const taps = [];
  const tap = h("button", { type: "button", class: "btn btn-secondary" }, "הקש קצב");
  tap.addEventListener("click", () => {
    const now = performance.now();
    if (taps.length && now - taps[taps.length - 1] > 2000) taps.length = 0;
    taps.push(now);
    if (taps.length > 5) taps.shift();
    if (taps.length >= 2) {
      const iv = []; for (let i = 1; i < taps.length; i++) iv.push(taps[i] - taps[i - 1]);
      const last4 = iv.slice(-4);
      bpm.upd(60000 / (last4.reduce((a, b) => a + b, 0) / last4.length));
    }
  });
  const page = h("div", { class: "page tool-page" },
    h("div", { class: "metro" }, dots, bpm.el, presets,
      h("div", { class: "tool-row" }, h("span", { class: "lbl" }, "פעמות בתיבה"), seg([[2, "2"], [3, "3"], [4, "4"]], 4, (v) => { m.beats = v; paintDots(); }, "פעמות בתיבה")),
      h("div", { class: "tool-row" }, toggle("הדגשה על פעמה 1", true, (v) => { m.accent = v; }), tap),
      startBtn,
      h("p", { class: "muted small", html: richText("דאבל טיים: אותו דבר בדיוק, פי שניים מהר, למשל מ-80 ל-160 BPM (⏱ 46:41).") })));
  main.appendChild(page);
}

function clampBpm(v, d) { const n = Number(v); return n >= 40 && n <= 200 ? Math.round(n) : d; }

// ---------- progression engine (player + songbook) ----------
export function ProgressionEngine({ bpm = 70, beatsPerChord = 4, loop = true, clickOn = true, onChord, onBeat, onEnd } = {}) {
  let chords = [];
  let timer = null;
  let next = 0;
  let ci = 0, b = 0, gb = 0;
  let voices = [];
  const fade = (vs, at, r = 0.06) => vs.forEach((v) => { if (v) { try { v.gain.gain.setValueAtTime(v.gain.gain.value, at); v.gain.gain.linearRampToValueAtTime(0, at + r); v.src.stop(at + r + 0.04); } catch (x) { /* ignore */ } } });
  const e = {
    bpm, beatsPerChord, loop, clickOn, running: false,
    setChords(cs) { chords = cs; },
    start() {
      if (!audio.ensure() || !chords.length) return;
      e.running = true; ci = 0; b = 0; gb = 0; next = audio.context().currentTime + 0.08;
      timer = setInterval(tick, 25); tick();
    },
    stop() {
      e.running = false; clearInterval(timer); timer = null;
      const ctx = audio.context();
      if (ctx) fade(voices, ctx.currentTime, 0.05);
      voices = [];
    },
  };
  function tick() {
    const ctx = audio.context();
    while (next < ctx.currentTime + 0.1) {
      if (ci >= chords.length) {
        if (e.loop) { ci = 0; b = 0; continue; }
        const at = next;
        clearInterval(timer); timer = null;
        setTimeout(() => { e.stop(); if (onEnd) onEnd(); }, Math.max(0, (at - ctx.currentTime) * 1000 + 600));
        return;
      }
      const c = chords[ci];
      const bpc = c.beats || e.beatsPerChord;
      const at = next;
      if (e.clickOn) audio.click(at, gb % 4 === 0, 0.25);
      const notes = c.notes || T.voicing(c.name);
      const myCi = ci, myB = b, myGb = gb;
      if (b === 0) {
        fade(voices, at);
        voices = audio.strum(notes, at, { gain: 0.55 });
        if (onChord) setTimeout(() => onChord(myCi, c), Math.max(0, (at - ctx.currentTime) * 1000));
      } else {
        const down = b % 2 === 0;
        voices.push(...audio.strum(notes, at, { gain: 0.22, down, gap: 0.015 }));
        if (voices.length > 40) voices.splice(0, voices.length - 40);
      }
      if (onBeat) setTimeout(() => onBeat(myB, myGb), Math.max(0, (at - ctx.currentTime) * 1000));
      next += 60 / e.bpm;
      gb++; b++;
      if (b >= bpc) { b = 0; ci++; }
    }
  }
  return e;
}

// ---------- progression player (§14.3) ----------
const PRESETS = [
  { id: "145", label: "1-4-5", degrees: [1, 4, 5] },
  { id: "1564", label: "1-5-6-4", degrees: [1, 5, 6, 4] },
  { id: "6415", label: "6-4-1-5", degrees: [6, 4, 1, 5] },
  { id: "1637", label: "1-6-3-7 (מהמינור)", degrees: [6, 4, 1, 5], minor: true },
];
export function renderPlayer(main, query) {
  let key = T.KEYS12.includes(query.key) ? query.key : (query.key ? (T.parseNote(query.key) ? T.parseNote(query.key).name : "G") : "G");
  let preset = PRESETS.find((p) => p.id === query.prog) || PRESETS[1];
  let cpb = query.cpb === "2" ? 2 : 1;
  let numbersOnly = false;
  const eng = ProgressionEngine({ bpm: clampBpm(query.bpm, 70), beatsPerChord: 4 / cpb, loop: true, onChord: (i) => show(i), onBeat: (b) => beatDots(b) });
  cleanup.push(() => eng.stop());
  const big = h("div", { class: "big-deg", "aria-live": "off" });
  const name = h("div", { class: "big-name" });
  const nxt = h("div", { class: "big-next" });
  const dots = h("div", { class: "metro-dots small", "aria-hidden": "true" }, [0, 1, 2, 3].map((i) => h("i", { class: i === 0 ? "one" : "" })));
  const seq = h("div", { class: "prog-seq", dir: "ltr" });
  function chordsFor() {
    return preset.degrees.map((d) => ({ name: T.chordOn(key, d), deg: preset.minor ? T.minorDegree(d) : d }));
  }
  function paintSeq(active = -1) {
    const cs = chordsFor();
    seq.innerHTML = "";
    cs.forEach((c, i) => seq.appendChild(h("div", { class: `seq-cell ${i === active ? "on" : ""}` }, h("b", null, String(c.deg)), numbersOnly ? null : h("small", null, c.name))));
  }
  function show(i) {
    const cs = chordsFor();
    const c = cs[i];
    const n = cs[(i + 1) % cs.length];
    big.textContent = String(c.deg);
    name.textContent = numbersOnly ? "" : c.name;
    nxt.textContent = `הבא: ${n.deg}`;
    paintSeq(i);
  }
  function beatDots(b) { Array.from(dots.children).forEach((d, i) => d.classList.toggle("on", i === b % 4)); }
  function reset() { eng.setChords(chordsFor()); show(0); paintSeq(eng.running ? 0 : -1); if (eng.running) { eng.stop(); eng.start(); } }
  const playBtn = h("button", { type: "button", class: "big-play", "aria-label": "נגן" }, iconEl("play", 34));
  playBtn.addEventListener("click", () => {
    audio.ensure();
    if (eng.running) eng.stop(); else { eng.setChords(chordsFor()); eng.start(); }
    playBtn.innerHTML = ""; playBtn.appendChild(iconEl(eng.running ? "stop" : "play", 34));
    playBtn.setAttribute("aria-label", eng.running ? "עצור" : "נגן");
  });
  const bpm = bpmControl(() => eng.bpm, (v) => { eng.bpm = v; });
  const page = h("div", { class: "page tool-page" },
    h("div", { class: "player-stage" }, h("div", { class: "big-wrap" }, big, name), nxt, dots, seq),
    playBtn,
    h("div", { class: "tool-sec" }, h("h3", null, "מהלך"), seg(PRESETS.map((p) => [p.id, p.label]), preset.id, (v) => { preset = PRESETS.find((p) => p.id === v); reset(); }, "מהלך")),
    h("div", { class: "tool-sec" }, h("h3", null, "סולם"), keyChips(key, (k) => { key = k; reset(); })),
    h("div", { class: "tool-sec" }, h("h3", { html: richText("אקורדים בתיבה (מקצב הרמוני ⏱ 46:41)") }), seg([[1, "1"], [2, "2"]], cpb, (v) => { cpb = v; eng.beatsPerChord = 4 / v; reset(); }, "אקורדים בתיבה")),
    h("div", { class: "tool-sec" }, h("h3", null, "קצב"), bpm.el),
    h("div", { class: "tool-sec col" },
      toggle("רק מספרים (להגיד את הדרגות בקול)", false, (v) => { numbersOnly = v; reset(); }),
      toggle("קליק מטרונום", true, (v) => { eng.clickOn = v; })),
    h("p", { class: "muted small", html: richText("התרגיל מהשיעור: לנגן ולהגיד בקול \"ראשונה, חמישית, שישית, רביעית\", לא את שמות האקורדים (⏱ 38:38). 1-6-3-7 הוא אותו 6-4-1-5, כשסופרים מהמינור (⏱ 1:11:44).") }));
  main.appendChild(page);
  eng.setChords(chordsFor());
  show(0);
  paintSeq(-1);
}

// ---------- fretboard explorer (§14.6) ----------
export function renderExplorer(main, query) {
  let key = query.key && T.parseNote(query.key) ? T.parseNote(query.key).name : "G";
  let labels = store.settings().fbLabels || "degrees";
  let strings = [6, 5];
  let fifths = false;
  const holder = h("div", { class: "fb-holder explorer" });
  let fb = null;
  const build = () => {
    if (fb) fb.destroy();
    holder.innerHTML = "";
    fb = Fretboard(holder, { frets: [0, 12], strings, key, labels, soundOnTap: true });
    fb.showScale(key, [1, 2, 3, 4, 5, 6, 7], { strings });
    drawFifths();
  };
  function drawFifths() {
    const old = holder.querySelector(".fifths");
    if (old) old.remove();
    if (!fifths || !fb || !fb.el) return;
    const rootBox = fb.el.getBoundingClientRect();
    const ns = "http://www.w3.org/2000/svg";
    const svg = document.createElementNS(ns, "svg");
    svg.setAttribute("class", "fifths");
    svg.setAttribute("width", rootBox.width);
    svg.setAttribute("height", rootBox.height);
    svg.innerHTML = `<defs><marker id="arr" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="var(--gold-hi)"/></marker></defs>`;
    const cellAt = (s, f) => fb.el.querySelector(`.fb-cell[data-s="${s}"][data-f="${f}"]`);
    for (const s of strings) {
      const t = s - 1;
      if (t < 1 || !strings.includes(t)) continue;
      for (let f = 0; f <= 12; f++) {
        const d = T.degreeOfPc(key, T.midiAt(s, f) % 12);
        if (!d || d === 7) continue;   // from 7 the perfect fifth leaves the scale (F# in C); in-scale it is a tritone
        const tf = f + (t === 2 ? 3 : 2);
        if (tf > 12) continue;
        const a = cellAt(s, f), b = cellAt(t, tf);
        if (!a || !b) continue;
        const ra = a.getBoundingClientRect(), rb = b.getBoundingClientRect();
        const x1 = ra.left + ra.width / 2 - rootBox.left, y1 = ra.top + ra.height / 2 - rootBox.top;
        const x2 = rb.left + rb.width / 2 - rootBox.left, y2 = rb.top + rb.height / 2 - rootBox.top;
        const k = 0.62;
        const line = document.createElementNS(ns, "line");
        line.setAttribute("x1", x1 + (x2 - x1) * 0.28); line.setAttribute("y1", y1 + (y2 - y1) * 0.28);
        line.setAttribute("x2", x1 + (x2 - x1) * k + (x2 - x1) * 0.1); line.setAttribute("y2", y1 + (y2 - y1) * k + (y2 - y1) * 0.1);
        line.setAttribute("stroke", "var(--gold-hi)"); line.setAttribute("stroke-width", "2.5"); line.setAttribute("marker-end", "url(#arr)");
        svg.appendChild(line);
      }
    }
    fb.el.appendChild(svg);
  }
  const onResize = () => { if (fifths) setTimeout(drawFifths, 50); };
  window.addEventListener("resize", onResize);
  cleanup.push(() => { window.removeEventListener("resize", onResize); if (fb) fb.destroy(); });
  const stringToggles = h("div", { class: "chips-row" }, [6, 5, 4, 3, 2, 1].map((s) => {
    const b = h("button", { type: "button", class: "chip-btn", "aria-pressed": String(strings.includes(s)) }, `מיתר ${s}`);
    b.addEventListener("click", () => {
      strings = strings.includes(s) ? strings.filter((x) => x !== s) : [...strings, s];
      if (!strings.length) strings = [s];
      b.setAttribute("aria-pressed", String(strings.includes(s)));
      build();
    });
    return b;
  }));
  const page = h("div", { class: "page tool-page" },
    h("p", { class: "muted small", html: richText("להתחיל רק עם שני המיתרים הנמוכים, 6 ו-5: \"אין סיבה ללכת הלאה\" בינתיים (⏱ 1:32:37).") }),
    h("div", { class: "tool-sec" }, h("h3", null, "סולם"), keyChips(key, (k) => { key = k; build(); })),
    h("div", { class: "tool-sec" }, h("h3", null, "תוויות"), seg([["degrees", "דרגות"], ["names", "שמות תווים"], ["none", "ללא"]], labels, (v) => { labels = v; fb.setLabels(v); }, "תוויות")),
    h("div", { class: "tool-sec" }, h("h3", null, "מיתרים"), stringToggles),
    h("div", { class: "tool-sec col" }, toggle("קווינטה: חץ מכל דרגה לחמישית שלה", false, (v) => { fifths = v; drawFifths(); }),
      h("p", { class: "muted small", html: richText("[הערה] מדרגה 7 אין חץ: הקווינטה הזכה שלה יוצאת מהסולם.") })),
    holder,
    h("p", { class: "muted small", html: richText("כשאתה יודע איפה החמישית, היא נקודת עוגן ואין צורך לספור (⏱ 35:36).") }));
  main.appendChild(page);
  build();
}
