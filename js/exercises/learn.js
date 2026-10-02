// learn.js: the "teach before test" card that opens a unit the first time (no XP, no grading).
// Content comes from the lesson JSON: unit.concept_he, the unit's first ask[] quote_he (the teacher's
// own words), and an optional unit.learn = { table: "scale-qualities", key } visual.
import { h, richText } from "../dom.js";
import * as T from "../theory.js";

const QUAL_WORD = { "": "מז'ור", m: "מינור", "ø": "חצי מוקטן", "°": "מוקטן" };
const WORD_SYM = { "מז'ור": "M", "מינור": "m", "חצי מוקטן": "ø", "מוקטן": "°" };
const SYM_CLASS = { M: "q-maj", m: "q-min", "ø": "q-hdim", "°": "q-dim" };

// "מז'ור · מינור · ... · חצי מוקטן" → ["M","m",...], or null when the text is not a quality sequence
export function qualitySeq(text) {
  const parts = String(text).split(/\s*·\s*/);
  if (parts.length < 5) return null;
  const syms = parts.map((p) => WORD_SYM[p.trim()]);
  return syms.every(Boolean) ? syms : null;
}

// one row of colored chips, degree 1 on the left (same direction as every degree strip in the app)
export function qualityChips(syms, { numbers = true } = {}) {
  return h("span", { class: "q-row", dir: "ltr", "aria-hidden": "true" },
    syms.map((s, i) => h("span", { class: "q-cell" },
      h("span", { class: `q-chip ${SYM_CLASS[s] || ""}` }, s),
      numbers ? h("small", null, String(i + 1)) : null)));
}

export function card(unit) {
  return {
    type: "learn",
    id: "learn",
    uid: `${unit.uid}#learn`,
    lessonId: unit.lessonId,
    unitId: unit.id,
    skill: unit.skills[0],
    question_he: unit.title_he,
    difficulty: 1,
    unit,
  };
}

function scaleTable(key) {
  const chords = T.scaleChords(key);
  const syms = T.QUAL.map((q) => (q === "" ? "M" : q));
  return h("figure", { class: "learn-table" },
    h("div", { class: "lt-grid", dir: "ltr", role: "list", "aria-label": `אקורדי סולם ${key} מז'ור לפי דרגות` },
      chords.map((c, i) => h("div", { class: "lt-col", role: "listitem", "aria-label": `דרגה ${i + 1}: ${c}, ${QUAL_WORD[T.QUAL[i]]}` },
        h("span", { class: "lt-deg", "aria-hidden": "true" }, String(i + 1)),
        h("span", { class: `q-chip ${SYM_CLASS[syms[i]]}`, "aria-hidden": "true" }, syms[i]),
        h("b", { class: "lt-chord", "aria-hidden": "true" }, c)))),
    h("figcaption", { class: "lt-legend" },
      h("span", null, h("span", { class: "q-chip q-maj sm", "aria-hidden": "true" }, "M"), " מז'ור"),
      h("span", null, h("span", { class: "q-chip q-min sm", "aria-hidden": "true" }, "m"), " מינור"),
      h("span", null, h("span", { class: "q-chip q-hdim sm", "aria-hidden": "true" }, "ø"), " חצי מוקטן"),
      h("span", { class: "lt-key" }, "דוגמה: ", h("bdi", { dir: "ltr", class: "mus-strong" }, key), " מז'ור")));
}

export function mount(ex) {
  const unit = ex.unit;
  const body = h("div", { class: "ex-body learn" });
  if (unit.concept_he) body.appendChild(h("div", { class: "learn-concept", html: richText(unit.concept_he) }));
  const L = unit.learn || {};
  if (L.table === "scale-qualities") body.appendChild(scaleTable(L.key || "C"));
  const q = (unit.ask || []).find((c) => c.quote_he);
  if (q) {
    body.appendChild(h("figure", { class: "quote-card" },
      h("figcaption", null, "במילים של המורה"),
      h("blockquote", { html: richText(`"${q.quote_he}"`) }),
      q.source_ts ? h("div", { html: richText("⏱ " + q.source_ts) }) : null));
  }
  return { el: body, check() { return null; }, key() { return false; } };
}
