// fretboard.js: the neck component (DESIGN §10). Vertical under 720px, horizontal above.
import { h } from "./dom.js";
import * as T from "./theory.js";
import * as audio from "./audio.js";
import * as store from "./store.js";

const STRING_W = { 1: 1, 2: 1.2, 3: 1.5, 4: 2, 5: 2.5, 6: 3 };
const STRING_NAME = { 6: "E", 5: "A", 4: "D", 3: "G", 2: "B", 1: "E" };
const INLAYS = [3, 5, 7, 9];

export function Fretboard(container, opts = {}) {
  const o = Object.assign({
    frets: [0, 12],
    strings: [1, 2, 3, 4, 5, 6],
    labels: "degrees",
    key: null,
    marks: [],
    soundOnTap: true,
    onTap: null,
    lefty: store.settings().lefty,
    orientation: "auto",
    compact: false,
  }, opts);
  let marks = (o.marks || []).slice();
  let scaleMarks = [];
  let root = null;
  let cells = new Map();
  let vertical = true;
  let focusKey = null;
  let selectedKey = null;
  let locked = false;

  const isVertical = () => (o.orientation === "auto" ? window.innerWidth < 720 : o.orientation === "vertical");
  const [fa, fb] = o.frets;
  const nFrets = fb - fa + 1;
  const k = (s, f) => `${s}:${f}`;

  function render() {
    vertical = isVertical();
    if (root) root.remove();
    cells = new Map();
    const lefty = !!o.lefty;
    const rowH = (window.innerHeight < 700 && nFrets > 10) || o.compact ? 40 : 44;
    root = h("div", { class: `fb ${vertical ? "fb-v" : "fb-h"}${lefty ? " fb-lefty" : ""}`, dir: "ltr", role: "group", "aria-label": "צוואר הגיטרה" });
    const sizes = [];
    for (let f = fa; f <= fb; f++) sizes.push(f === 0 ? "40px" : `${rowH}px`);
    // a header track (string numbers + names) sits before the nut: row 1 when vertical, column 1 when horizontal
    if (vertical) {
      root.style.gridTemplateColumns = "24px repeat(6, minmax(40px, 1fr))";
      root.style.gridTemplateRows = ["34px", ...sizes].join(" ");
    } else {
      root.style.gridTemplateColumns = ["40px", ...sizes.map((s) => (s === "40px" ? "44px" : "minmax(44px, 1fr)"))].join(" ");
      root.style.gridTemplateRows = "repeat(6, 36px) 22px";
    }
    // placement helpers
    const along = (f) => (vertical ? f - fa : (lefty ? fb - f : f - fa));            // 0-based track index along the neck
    const across = (s) => (vertical ? (lefty ? s - 1 : 6 - s) : s - 1);              // 0-based across the neck
    const place = (el, s0, s1, f0, f1) => {
      // s0..s1 = across tracks (0-based, inclusive), f0..f1 = along tracks (0-based, inclusive)
      if (vertical) { el.style.gridColumn = `${2 + s0} / ${3 + s1}`; el.style.gridRow = `${2 + f0} / ${3 + f1}`; }
      else { el.style.gridRow = `${1 + s0} / ${2 + s1}`; el.style.gridColumn = `${2 + f0} / ${3 + f1}`; }
      return el;
    };
    // string header: "6 E" … "1 E", active strings gold + bold
    for (let s = 1; s <= 6; s++) {
      const on = o.strings.includes(s);
      const lab = h("div", { class: `fb-sname${on ? " on" : ""}`, "aria-hidden": "true" }, h("b", null, String(s)), h("small", null, STRING_NAME[s]));
      if (vertical) { lab.style.gridColumn = String(2 + across(s)); lab.style.gridRow = "1"; }
      else { lab.style.gridRow = String(1 + across(s)); lab.style.gridColumn = "1"; }
      root.appendChild(lab);
    }
    // board (frets >= 1)
    const boardFrom = Math.max(fa, 1);
    if (boardFrom <= fb) {
      const a0 = along(boardFrom), a1 = along(fb);
      root.appendChild(place(h("div", { class: "fb-board" }), 0, 5, Math.min(a0, a1), Math.max(a0, a1)));
    }
    // inlays
    for (let f = Math.max(fa, 1); f <= fb; f++) {
      if (INLAYS.includes(f)) root.appendChild(place(h("div", { class: "fb-inlay" }, h("i")), Math.min(across(4), across(3)), Math.max(across(4), across(3)), along(f), along(f)));
      if (f === 12) {
        root.appendChild(place(h("div", { class: "fb-inlay" }, h("i")), Math.min(across(3), across(2)), Math.max(across(3), across(2)), along(f), along(f)));
        root.appendChild(place(h("div", { class: "fb-inlay" }, h("i")), Math.min(across(5), across(4)), Math.max(across(5), across(4)), along(f), along(f)));
      }
    }
    // fret wires + nut
    for (let f = fa; f <= fb; f++) {
      const cls = f === 0 ? "fb-nut" : "fb-wire";
      root.appendChild(place(h("div", { class: cls }), 0, 5, along(f), along(f)));
    }
    // strings
    const aMin = 0, aMax = nFrets - 1;
    for (let s = 1; s <= 6; s++) {
      const el = h("div", { class: `fb-string${s >= 4 ? " wound" : ""}${o.strings.includes(s) ? "" : " dim"}` });
      el.style.setProperty("--sw", STRING_W[s] + "px");
      root.appendChild(place(el, across(s), across(s), aMin, aMax));
    }
    // gutter numbers
    for (let f = fa; f <= fb; f++) {
      if (![3, 5, 7, 9, 12].includes(f)) continue;
      const n = h("div", { class: "fb-num", "aria-hidden": "true" }, String(f));
      if (vertical) { n.style.gridColumn = "1"; n.style.gridRow = String(2 + along(f)); }
      else { n.style.gridRow = "7"; n.style.gridColumn = String(2 + along(f)); }
      root.appendChild(n);
    }
    // cells
    let first = null;
    for (let s = 6; s >= 1; s--) {
      for (let f = fa; f <= fb; f++) {
        const active = o.strings.includes(s);
        const b = h("button", {
          type: "button", class: `fb-cell${active ? "" : " off"}${f === 0 ? " open" : ""}${selectedKey === k(s, f) ? " selected" : ""}`,
          "aria-label": cellLabel(s, f), tabindex: "-1", "data-s": s, "data-f": f,
          "aria-disabled": active ? null : "true",
        });
        place(b, across(s), across(s), along(f), along(f));
        b.addEventListener("click", () => tap(s, f));
        b.addEventListener("keydown", onKey);
        cells.set(k(s, f), b);
        root.appendChild(b);
        if (active && !first) first = b;
      }
    }
    const fk = focusKey && cells.get(focusKey);
    (fk || first || cells.values().next().value).tabIndex = 0;
    container.appendChild(root);
    paint();
  }

  // with labels "none" (a fretboard_find question) the cell must not announce the note: that is the answer
  function cellLabel(s, f) {
    if (o.labels === "none") return `מיתר ${s}, סריג ${f}`;
    const midi = T.midiAt(s, f);
    const deg = o.key ? T.degreeOfPc(o.key, midi % 12) : 0;
    return `מיתר ${s}, סריג ${f}, ${T.noteName(midi, o.key)}${deg && o.labels === "degrees" ? `, דרגה ${deg}` : ""}`;
  }

  function onKey(e) {
    const s = Number(e.currentTarget.dataset.s);
    const f = Number(e.currentTarget.dataset.f);
    let ds = 0, df = 0;
    const lefty = !!o.lefty;
    if (vertical) {
      if (e.key === "ArrowUp") df = -1;
      else if (e.key === "ArrowDown") df = 1;
      else if (e.key === "ArrowLeft") ds = lefty ? -1 : 1;
      else if (e.key === "ArrowRight") ds = lefty ? 1 : -1;
    } else {
      if (e.key === "ArrowLeft") df = lefty ? 1 : -1;
      else if (e.key === "ArrowRight") df = lefty ? -1 : 1;
      else if (e.key === "ArrowUp") ds = -1;
      else if (e.key === "ArrowDown") ds = 1;
    }
    if (!ds && !df) return;
    e.preventDefault();
    let ns = s, nf = f;
    for (let i = 0; i < 6; i++) {
      ns = Math.min(6, Math.max(1, ns + ds));
      nf = Math.min(fb, Math.max(fa, nf + df));
      if (o.strings.includes(ns) || !ds) break;
    }
    const next = cells.get(k(ns, nf));
    if (next) {
      cells.forEach((c) => { c.tabIndex = -1; });
      next.tabIndex = 0;
      focusKey = k(ns, nf);
      next.focus();
    }
  }

  function tap(s, f) {
    if (locked || !o.strings.includes(s)) return;
    const midi = T.midiAt(s, f);
    flash(s, f);
    if (o.soundOnTap) audio.pluck(midi, 0, 0.5);
    focusKey = k(s, f);
    if (o.onTap) o.onTap({ string: s, fret: f, midi, note: T.noteName(midi, o.key) });
  }

  function flash(s, f) {
    const c = cells.get(k(s, f));
    if (!c) return;
    const ring = h("span", { class: "fb-flash", "aria-hidden": "true" });
    c.appendChild(ring);
    setTimeout(() => ring.remove(), 380);
  }

  function markLabel(m) {
    if (m.label != null && (m.kind !== "degree" && m.kind !== "root")) return m.label;
    if (m.label != null && o.labels === "none") return m.label;
    const midi = T.midiAt(m.string, m.fret);
    if (o.labels === "names") return T.noteName(midi, o.key);
    if (o.labels === "none") return "";
    return m.label != null ? m.label : (m.deg ? String(m.deg) : "");
  }

  function paint() {
    cells.forEach((c) => { const mk = c.querySelector(".fb-mark"); if (mk) mk.remove(); c.classList.remove("has-mark"); });
    const all = [...scaleMarks, ...marks];
    for (const m of all) {
      const c = cells.get(k(m.string, m.fret));
      if (!c) continue;
      const old = c.querySelector(".fb-mark");
      if (old) old.remove();
      let deg = m.deg;
      if (!deg && m.label && /^[1-7]$/.test(String(m.label))) deg = Number(m.label);
      const cls = ["fb-mark", "k-" + (m.kind || "degree")];
      if ((m.kind === "degree" || m.kind === "root" || m.kind === "target") && deg) cls.push("d" + deg);
      if (m.pulse) cls.push("pulse");
      const lab = markLabel(m);
      const glyph = m.kind === "correct" ? "✓" : m.kind === "wrong" ? "✕" : "";
      const el = h("span", { class: cls.join(" "), "aria-hidden": "true" }, glyph && !lab ? glyph : lab);
      if (glyph && lab) el.appendChild(h("small", null, glyph));
      c.appendChild(el);
      c.classList.add("has-mark");
    }
  }

  const api = {
    get el() { return root; },
    setMarks(ms) { marks = (ms || []).slice(); paint(); },
    addMarks(ms) { marks.push(...ms); paint(); },
    clearScale() { scaleMarks = []; paint(); },
    showScale(key, degrees = [1, 2, 3, 4, 5, 6, 7], { strings = o.strings } = {}) {
      if (key) { o.key = key; }
      scaleMarks = [];
      for (const s of strings) {
        for (let f = fa; f <= fb; f++) {
          const d = T.degreeOfPc(o.key, T.midiAt(s, f) % 12);
          if (d && degrees.includes(d)) scaleMarks.push({ string: s, fret: f, kind: d === 1 ? "root" : "degree", deg: d });
        }
      }
      paint();
    },
    setLabels(mode) { o.labels = mode; cells.forEach((c, key) => { const [s, f] = key.split(":").map(Number); c.setAttribute("aria-label", cellLabel(s, f)); }); paint(); },
    setSelected(s, f) {
      selectedKey = s == null ? null : k(s, f);
      cells.forEach((c, key) => { c.classList.toggle("selected", key === selectedKey); c.setAttribute("aria-pressed", key === selectedKey ? "true" : "false"); });
    },
    lock() { locked = true; cells.forEach((c) => c.setAttribute("aria-disabled", "true")); },
    setKey(key) { o.key = key; render(); },
    setStrings(strs) { o.strings = strs; render(); },
    flash,
    refresh: render,
    destroy() { window.removeEventListener("resize", onResize); if (root) root.remove(); },
    opts: o,
  };

  let lastV = null;
  function onResize() {
    if (root && !root.isConnected) { window.removeEventListener("resize", onResize); return; }
    const v = isVertical();
    if (v !== lastV) { lastV = v; render(); }
  }
  window.addEventListener("resize", onResize);
  render();
  lastV = vertical;
  return api;
}
