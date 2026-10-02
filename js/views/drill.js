// drill.js: the teacher's speed drill on strings 6 and 5 (DESIGN §14.5)
import { h, richText, shuffle, toast } from "../dom.js";
import { Fretboard } from "../fretboard.js";
import * as T from "../theory.js";
import * as store from "../store.js";
import * as audio from "../audio.js";

const ROOTS = { G: 3, A: 5, C: 8 };

export function renderDrill(main, query, cleanup) {
  let key = ROOTS[query.key] != null ? query.key : "G";
  const page = h("div", { class: "page tool-page drill" });
  main.appendChild(page);
  intro();

  function intro() {
    page.innerHTML = "";
    const best = (store.get().drill[key] || {}).bestAvgMs;
    const keyRow = h("div", { class: "seg", role: "radiogroup", "aria-label": "סולם" }, Object.keys(ROOTS).map((k) => {
      const b = h("button", { type: "button", class: "seg-btn", role: "radio", "aria-checked": String(k === key), "aria-pressed": String(k === key) }, h("bdi", { dir: "ltr" }, k), h("small", null, ` סריג ${ROOTS[k]}`));
      b.addEventListener("click", () => { key = k; intro(); });
      return b;
    }));
    const start = h("button", { type: "button", class: "btn btn-primary btn-block", autofocus: true }, "התחל (12 דרגות)");
    start.addEventListener("click", () => { audio.ensure(); run(); });
    page.append(
      h("div", { class: "drill-intro" },
        h("div", { class: "drill-hero", "aria-hidden": "true" }, "⚡"),
        h("h2", { class: "drill-h" }, "רואים, לא סופרים"),
        h("p", { html: richText("שיעורי הבית מהמורה: לשחק עם מפת היחסים רק על שני המיתרים הנמוכים (⏱ 1:32:30–1:32:37), ולמצוא דרגה לפי המקום שלה על הצוואר, בלי לחשב (⏱ 33:10, 1:31:53).") }),
        h("p", { class: "muted", html: richText("דרגה מופיעה בגדול. הקש עליה על מיתר 6 או 5. בסבבים 1-6 השורש מסומן, ובסבבים 7-12 הוא נעלם. **איך יודעים שזה עובד:** פחות משתי שניות לדרגה, בלי לספור.") }),
        h("div", { class: "tool-sec" }, h("h3", null, "שורש על מיתר 6"), keyRow),
        best ? h("p", { class: "drill-best" }, `השיא שלך ב-${key}: ${(best / 1000).toFixed(2)} שניות לדרגה`) : null,
        start));
  }

  function run() {
    page.innerHTML = "";
    const r = ROOTS[key];
    const frets = [Math.max(0, r - 3), Math.min(12, r + 5)];
    const prompts = [...shuffle([1, 2, 3, 4, 5, 6]), ...shuffle([1, 2, 3, 4, 5, 6])];
    const times = [];
    const errors = [];
    let i = 0;
    let shownAt = 0;
    let busy = false;
    const deg = h("div", { class: "drill-deg", "aria-live": "assertive" });
    const word = h("div", { class: "drill-word" });
    const prog = h("div", { class: "drill-prog" });
    const holder = h("div", { class: "fb-holder" });
    page.append(h("div", { class: "drill-stage" }, prog, deg, word), holder);
    const rootMark = { string: 6, fret: r, kind: "root", label: "1", deg: 1 };
    const fb = Fretboard(holder, {
      frets, strings: [6, 5], key, labels: "none", soundOnTap: false, compact: true,
      onTap: ({ string, fret, midi }) => {
        if (busy) return;
        const d = prompts[i];
        const ok = T.degreeOfPc(key, midi % 12) === d;
        const ms = performance.now() - shownAt;
        busy = true;
        audio.pluck(midi, 0, 0.5);
        if (ok) {
          times.push({ d, ms });
          fb.setMarks([...(i < 6 ? [rootMark] : []), { string, fret, kind: "correct", label: String(d) }]);
        } else {
          errors.push(d);
          times.push({ d, ms: ms + 1000 });
          const right = [];
          for (const s of [6, 5]) for (let f = frets[0]; f <= frets[1]; f++) if (T.degreeOfPc(key, T.midiAt(s, f) % 12) === d) right.push({ string: s, fret: f, kind: "correct", label: String(d), pulse: true });
          fb.setMarks([...(i < 6 ? [rootMark] : []), { string, fret, kind: "wrong", label: "" }, ...right]);
        }
        setTimeout(() => { i++; busy = false; if (i < prompts.length) next(); else done(); }, 600);
      },
    });
    cleanup.push(() => fb.destroy());
    function next() {
      const d = prompts[i];
      deg.textContent = String(d);
      word.textContent = T.DEG_WORDS[d];
      prog.textContent = `${i + 1}/12${i >= 6 ? " · בלי שורש" : ""}`;
      fb.setMarks(i < 6 ? [rootMark] : []);
      shownAt = performance.now();
    }
    function done() {
      fb.destroy();
      const avg = times.reduce((a, t) => a + t.ms, 0) / times.length;
      const per = [1, 2, 3, 4, 5, 6].map((d) => {
        const ts = times.filter((t) => t.d === d);
        return { d, ms: ts.reduce((a, t) => a + t.ms, 0) / (ts.length || 1) };
      });
      const isBest = store.drillResult(key, avg);
      store.addXP(10);
      toast("+10 XP · תרגיל המהירות");
      const max = Math.max(2500, ...per.map((p) => p.ms));
      const ok = avg < 2000;
      page.innerHTML = "";
      page.append(h("div", { class: "drill-result" },
        h("div", { class: "drill-avg" }, `${(avg / 1000).toFixed(2)}`, h("small", null, " שניות לדרגה")),
        h("p", { class: `drill-verdict ${ok ? "ok" : ""}` }, ok ? "מתחת לשתי שניות: עובד ✓" : "עוד לא, נסה שוב מחר"),
        isBest ? h("p", { class: "drill-best" }, "שיא חדש ✓") : null,
        errors.length ? h("p", { class: "muted" }, `טעויות: ${errors.length} (כל טעות מוסיפה שנייה)`) : null,
        h("div", { class: "bars", role: "img", "aria-label": per.map((p) => `דרגה ${p.d}: ${(p.ms / 1000).toFixed(1)} שניות`).join(", ") },
          per.map((p) => h("div", { class: "bar-col" },
            h("div", { class: "bar-val" }, (p.ms / 1000).toFixed(1)),
            h("div", { class: "bar-track" }, h("div", { class: `bar ${p.ms < 2000 ? "ok" : ""}`, style: { height: `${Math.round((p.ms / max) * 100)}%` } }), h("i", { class: "bar-goal", style: { bottom: `${(2000 / max) * 100}%` } })),
            h("div", { class: "bar-lab" }, String(p.d))))),
        h("p", { class: "muted small" }, "הקו המקווקו: שתי שניות."),
        h("div", { class: "btn-col" },
          h("button", { type: "button", class: "btn btn-primary btn-block", onclick: () => run() }, "שוב"),
          h("button", { type: "button", class: "btn btn-ghost btn-block", onclick: () => intro() }, "החלף סולם"))));
    }
    next();
  }
}
