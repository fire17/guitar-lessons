// fret.js: fretboard_find (DESIGN §9.6). Tap a cell to place a mark (tap again elsewhere to move it), then בדוק.
// Pick-then-check: on a small phone the neck scrolls, and a scroll that starts on a cell must not be an answer.
import { h } from "../dom.js";
import { Fretboard } from "../fretboard.js";
import * as T from "../theory.js";
import * as audio from "../audio.js";

export function mount(ex, api) {
  const body = h("div", { class: "ex-body fret" });
  const key = ex.target && ex.target.key ? ex.target.key : null;
  const chips = h("div", { class: "ex-chiprow" });
  if (key) chips.appendChild(h("span", { class: "key-badge" }, "סולם ", h("bdi", { dir: "ltr", class: "mus-strong" }, key), " מז'ור"));
  if (ex.target && ex.target.degree) chips.appendChild(h("span", { class: "deg-circle sm", "aria-label": `דרגה ${ex.target.degree}` }, String(ex.target.degree)));
  if (ex.target && ex.target.note) chips.appendChild(h("span", { class: "chord-pill" }, h("bdi", { dir: "ltr", class: "mus-strong" }, ex.target.note)));
  body.appendChild(chips);
  const holder = h("div", { class: "fb-holder" });
  body.appendChild(holder);
  body.appendChild(h("p", { class: "hint" }, "הקש על המקום בצוואר, ואז בדוק."));
  let locked = false;
  let pick = null;

  const baseMarks = ex.root_marker ? [{ string: ex.root_marker.string, fret: ex.root_marker.fret, kind: "root", label: "1", deg: 1 }] : [];
  const fb = Fretboard(holder, {
    frets: ex.frets || [0, 12],
    strings: ex.strings,
    labels: "none",
    key,
    marks: baseMarks,
    soundOnTap: false,
    onTap: ({ string, fret, midi }) => {
      if (locked) return;
      pick = { string, fret, midi };
      fb.setMarks([...baseMarks, { string, fret, kind: "selected", label: "" }]);
      fb.setSelected(string, fret);
      api.setReady(true);
    },
  });

  function check() {
    if (!pick) return null;
    locked = true;
    const { string, fret, midi } = pick;
    const ok = ex.answers.some((a) => a.string === string && a.fret === fret);
    const name = T.noteName(midi, key);
    audio.ensure();
    if (ok) {
      audio.pluck(midi, 0, 0.55);
      fb.setMarks([...baseMarks, { string, fret, kind: "correct", label: name }]);
    } else {
      audio.pluck(midi, 0, 0.5);
      const a0 = ex.answers[0];
      const ctx = audio.context();
      if (ctx) audio.pluck(T.midiAt(a0.string, a0.fret), ctx.currentTime + 0.45, 0.55);
      fb.setMarks([...baseMarks, { string, fret, kind: "wrong", label: "" },
        ...ex.answers.map((a) => ({ string: a.string, fret: a.fret, kind: "correct", label: T.noteName(T.midiAt(a.string, a.fret), key), pulse: true }))]);
    }
    fb.setSelected(null);
    fb.lock();
    const ans = ex.answers.map((a) => `מיתר ${a.string}, סריג ${a.fret}`).join(" או ");
    return {
      correct: ok,
      answerText: ans,
      chosenText: `מיתר ${string}, סריג ${fret}`,
      hint: ok ? null : "תסתכל על הגיטרה, אל תספור.",
      extras: null,
      reveal: () => {
        if (key) fb.showScale(key, [1, 2, 3, 4, 5, 6, 7], { strings: ex.strings });
        fb.setLabels(key ? "degrees" : "names");
      },
    };
  }

  return {
    el: body,
    check,
    afterCheck(r) { if (r && r.reveal) r.reveal(); },
    destroy() { fb.destroy(); },
    fb,
  };
}
