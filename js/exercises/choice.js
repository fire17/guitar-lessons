// choice.js: mcq, degree_to_chord, chord_to_degree, relative_minor, interval_inversion, fill_blank,
// ear_degree, ear_quality, and any exercise with clips (DESIGN §9.1-9.3)
import { h, richText, shuffle, mus } from "../dom.js";
import * as T from "../theory.js";
import { ClipPlayer } from "./clips.js";
import { qualitySeq, qualityChips } from "./learn.js";

const NUMERIC = ["chord_to_degree", "ear_degree"];

export function mount(ex, api) {
  const opts = shuffle(ex.options || []);
  const numeric = NUMERIC.includes(ex.type) || opts.every((o) => typeof o === "number");
  let chosen = null;
  const body = h("div", { class: "ex-body choice" });
  let player = null;

  // headers
  if (ex.type === "degree_to_chord") {
    body.appendChild(h("div", { class: "ex-chiprow" }, keyBadge(ex.key), h("span", { class: "deg-circle", "aria-label": `דרגה ${ex.degree}` }, String(ex.degree))));
  } else if (ex.type === "chord_to_degree") {
    body.appendChild(h("div", { class: "ex-chiprow" }, keyBadge(ex.key), h("span", { class: "chord-pill" }, mus(ex.chord))));
  } else if (ex.type === "relative_minor") {
    body.appendChild(h("div", { class: "ex-chiprow" }, h("span", { class: "key-badge" }, ex.direction === "minor_to_major" ? "ממינור למז'ור" : "ממז'ור למינור"), h("span", { class: "chord-pill" }, mus(ex.given))));
  } else if (ex.type === "interval_inversion" && ex.given) {
    body.appendChild(h("div", { class: "ex-chiprow" }, h("span", { class: "chord-pill heb" }, ex.given)));
  }
  if (ex.clips && ex.clips.length) {
    player = ClipPlayer(ex.clips, { autoplay: true });
    body.appendChild(player.el);
  }

  // fill_blank sentence
  let slot = null;
  if (ex.type === "fill_blank" && ex.text_he) {
    const parts = ex.text_he.split("___");
    slot = h("button", { type: "button", class: "blank-slot", "aria-label": "המקום הריק" }, " ");
    slot.addEventListener("click", () => { if (chosen != null && !locked) select(null); });
    const sentence = h("p", { class: "blank-sentence" });
    parts.forEach((p, i) => {
      sentence.appendChild(h("span", { html: richText(p) }));
      if (i < parts.length - 1) sentence.appendChild(i === 0 ? slot : h("span", { class: "blank-slot static" }, "___"));
    });
    body.appendChild(sentence);
  }

  // options
  const short = opts.every((o) => String(o).length <= 8);
  const seqs = opts.map((o) => qualitySeq(o));
  const chips = seqs.every(Boolean);   // "מז'ור · מינור · ..." → one row of 7 colored chips
  // keyboard badges 1-4 never sit next to numeric answers (a "1" badge beside the answer "5" reads as data);
  // on touch they are hidden by CSS, keys 1-4 still work through data-i
  const showNum = !numeric && !opts.some((o) => /^\s*\d/.test(String(o)));
  const grid = h("div", { class: `options ${numeric ? "numeric" : ""} ${short && !chips ? "two-col" : "one-col"} ${chips ? "chips" : ""}`, role: "radiogroup", "aria-label": "תשובות" });
  const buttons = opts.map((o, i) => {
    const b = h("button", { type: "button", class: "opt", role: "radio", "aria-checked": "false", "data-i": i, "aria-label": chips ? String(o) : null },
      showNum ? h("span", { class: "opt-num", "aria-hidden": "true" }, String(i + 1)) : null,
      numeric ? h("span", { class: "opt-digit" }, String(o))
        : chips ? qualityChips(seqs[i])
          : h("span", { class: "opt-text", html: richText(String(o)) }));
    b.addEventListener("click", () => { if (!locked) select(i); });
    grid.appendChild(b);
    return b;
  });
  body.appendChild(grid);
  let locked = false;

  function select(i) {
    chosen = i;
    buttons.forEach((b, j) => { b.classList.toggle("selected", j === i); b.setAttribute("aria-checked", String(j === i)); });
    if (slot) {
      slot.innerHTML = "";
      if (i != null) { slot.appendChild(h("span", { html: richText(String(opts[i])) })); slot.classList.add("filled"); }
      else { slot.textContent = " "; slot.classList.remove("filled"); }
    }
    api.setReady(i != null);
  }

  function check() {
    locked = true;
    const val = opts[chosen];
    const correct = String(val) === String(ex.answer);
    buttons.forEach((b, j) => {
      b.disabled = true;
      const isAns = String(opts[j]) === String(ex.answer);
      if (isAns) { b.classList.add("ok"); b.appendChild(h("span", { class: "opt-mark", "aria-hidden": "true" }, "✓")); }
      if (j === chosen && !correct) { b.classList.add("bad"); b.appendChild(h("span", { class: "opt-mark", "aria-hidden": "true" }, "✕")); }
    });
    if (slot) slot.classList.add(correct ? "ok" : "bad");
    if (player) player.revealLabels();
    return {
      correct,
      answerText: String(ex.answer),
      chosenText: val == null ? "" : String(val),
      // quality sequences read faster as the same chip row than as seven Hebrew words
      chosenNode: chips && chosen != null ? qualityChips(seqs[chosen], { numbers: false }) : null,
      answerNode: chips ? qualityChips(qualitySeq(ex.answer), { numbers: false }) : null,
      clipLabels: player ? player.labelsText() : null,
      extras: safe(() => extras(ex, val, correct)),
    };
  }

  function key(e) {
    if (locked) return false;
    if (/^[1-9]$/.test(e.key)) {
      const i = Number(e.key) - 1;
      if (i < buttons.length) { select(i); buttons[i].focus(); return true; }
    }
    if (e.key === " " && player) { e.preventDefault(); player.replay(); return true; }
    return false;
  }

  return { el: body, check, key, destroy() { if (player) player.stop(); }, player };
}

function safe(fn) { try { return fn(); } catch (e) { console.error(e); return null; } }

function keyBadge(key) {
  return h("span", { class: "key-badge" }, "סולם ", mus(key), " מז'ור");
}

// ---- teaching extras (§9.2) ----
export function extras(ex, chosen, correct) {
  if (ex.type === "relative_minor") return relativeLadder(ex, chosen, correct);
  if (ex.type === "interval_inversion") return inversionLine(ex);
  if (ex.type === "degree_to_chord" || ex.type === "chord_to_degree") return degreeStrip(ex);
  return null;
}

function relativeLadder(ex, chosen, correct) {
  const majToMin = ex.direction !== "minor_to_major";
  const dir = majToMin ? -1 : 1;
  const from = String(ex.given).replace(/m$/, "");
  const to = String(ex.answer).replace(/m$/, "");
  const scaleKey = majToMin ? from : to;
  const wrap = h("div", { class: "ladders" });
  const lad = T.letterLadder(from, to, dir, scaleKey);
  if (lad) wrap.appendChild(ladderRow(lad, false));
  if (!correct && chosen != null) {
    const pick = String(chosen).replace(/m$/, "");
    const bad = T.letterLadder(from, pick, dir, scaleKey);
    if (bad && bad.steps.length) wrap.appendChild(ladderRow(bad, true));
  }
  return wrap;
}

function ladderRow(lad, bad) {
  const row = h("div", { class: `ladder ${bad ? "bad" : ""}`, dir: "ltr" });
  row.appendChild(h("span", { class: "ladder-note" }, lad.notes[0]));
  lad.steps.forEach((s) => {
    row.appendChild(h("span", { class: "ladder-step" }, h("small", null, String(s.semis)), "→"));
    row.appendChild(h("span", { class: "ladder-note" }, s.to));
  });
  // an enharmonic pick (Cm for D#) IS a tone and a half away: the mistake is the letter count, not the distance
  const names = ["", "שם תו אחד", "שני שמות תווים", "שלושה שמות תווים", "ארבעה שמות תווים", "חמישה שמות תווים", "שישה שמות תווים"][lad.steps.length] || `${lad.steps.length} שמות תווים`;
  const msg = !bad ? `= ${T.semisWords(lad.total)} (${lad.total} חצאי טונים)`
    : lad.total === 3 ? `הבחירה שלך: ${names} במקום שניים. אותו צליל, אבל שם של סולם אחר`
      : `הבחירה שלך: ${T.semisWords(lad.total)} (${lad.total} חצאי טונים), לא טון וחצי`;
  const total = h("div", { class: `ladder-total ${bad ? "bad" : ""}` }, msg);
  return h("div", { class: "ladder-wrap" }, row, total);
}

function inversionLine(ex) {
  const a = T.parseInterval(ex.given);
  const b = T.parseInterval(ex.answer);
  if (!a.num || !b.num) return null;
  const line = h("div", { class: "inv-line" }, h("bdi", { dir: "ltr", class: "mus-strong" }, `${a.num} + ${b.num} = 9`));
  if (a.q && b.q && a.q !== b.q) line.appendChild(h("span", { class: "inv-q" }, `${a.q} ↔ ${b.q}`));
  return line;
}

function degreeStrip(ex) {
  const chords = T.scaleChords(ex.key);
  const asked = ex.type === "degree_to_chord" ? ex.degree : ex.answer;
  return h("div", { class: "deg-strip", dir: "ltr", "aria-label": `אקורדי סולם ${ex.key} מז'ור` },
    chords.map((c, i) => h("div", { class: `deg-cell ${i + 1 === Number(asked) ? "asked" : ""}` }, h("b", null, c), h("small", null, String(i + 1)))));
}
