// order.js: progression_build (DESIGN §9.4)
import { h, shuffle, iconEl } from "../dom.js";
import * as T from "../theory.js";
import * as audio from "../audio.js";

export function mount(ex, api) {
  const n = ex.answer.length;
  const slots = new Array(n).fill(null);   // pool index per slot
  const pool = shuffle(ex.pool.map((c, i) => ({ c, i })));
  let locked = false;

  const body = h("div", { class: "ex-body order" });
  body.appendChild(h("div", { class: "ex-chiprow" }, h("span", { class: "key-badge" }, "סולם ", h("bdi", { dir: "ltr", class: "mus-strong" }, ex.key), " מז'ור")));
  const slotRow = h("div", { class: "slot-row", dir: "ltr" });
  const slotEls = [];
  for (let i = 0; i < n; i++) {
    const b = h("button", { type: "button", class: "slot", "aria-label": `מקום ${i + 1}, דרגה ${ex.pattern[i]}, ריק` });
    b.addEventListener("click", () => { if (!locked && slots[i] != null) { slots[i] = null; paint(); } });
    const cell = h("div", { class: "slot-cell" }, b, h("div", { class: "slot-deg" }, String(ex.pattern[i])));
    slotEls.push({ b, cell });
    slotRow.appendChild(cell);
  }
  body.appendChild(slotRow);
  const poolRow = h("div", { class: "pool", dir: "ltr", "aria-label": "אקורדים לבחירה" });
  const tileEls = pool.map((p) => {
    const t = h("button", { type: "button", class: "tile", "aria-label": `אקורד ${p.c}` }, h("bdi", { dir: "ltr", class: "mus-strong" }, p.c));
    t.addEventListener("click", () => {
      if (locked) return;
      const free = slots.indexOf(null);
      if (free < 0) return;
      slots[free] = p.i;
      paint();
    });
    poolRow.appendChild(t);
    return { t, p };
  });
  body.appendChild(poolRow);

  function paint() {
    slotEls.forEach(({ b }, i) => {
      const pi = slots[i];
      b.innerHTML = "";
      if (pi != null) {
        b.appendChild(h("bdi", { dir: "ltr", class: "mus-strong" }, ex.pool[pi]));
        b.classList.add("filled");
        b.setAttribute("aria-label", `מקום ${i + 1}, דרגה ${ex.pattern[i]}, ${ex.pool[pi]}. הקש להחזרה`);
      } else {
        b.classList.remove("filled");
        b.setAttribute("aria-label", `מקום ${i + 1}, דרגה ${ex.pattern[i]}, ריק`);
      }
    });
    tileEls.forEach(({ t, p }) => {
      const used = slots.includes(p.i);
      t.classList.toggle("used", used);
      t.disabled = used || locked;
    });
    api.setReady(slots.every((s) => s != null));
  }

  function check() {
    locked = true;
    let allOk = true;
    slotEls.forEach(({ b, cell }, i) => {
      const got = ex.pool[slots[i]];
      const ok = got === ex.answer[i];
      if (!ok) allOk = false;
      b.classList.add(ok ? "ok" : "bad");
      b.appendChild(h("span", { class: "slot-mark", "aria-hidden": "true" }, ok ? "✓" : "✕"));
      b.disabled = true;
      if (!ok) cell.appendChild(h("div", { class: "slot-fix" }, h("bdi", { dir: "ltr" }, ex.answer[i])));
    });
    tileEls.forEach(({ t }) => { t.disabled = true; });
    const listen = h("button", { type: "button", class: "btn btn-secondary btn-sm listen-btn" }, iconEl("play", 18), " לשמוע");
    let handle = null;
    listen.addEventListener("click", () => {
      audio.ensure();
      if (handle) { handle.stop(); handle = null; return; }
      handle = audio.playClip(audio.progressionClip(ex.answer, T.voicing, { bpm: 80, beats: 2 }));
      handle.done.then(() => { handle = null; });
    });
    return {
      correct: allOk,
      answerText: ex.answer.join(" – "),
      chosenText: slots.map((s) => ex.pool[s]).join(" – "),
      extras: h("div", { class: "fb-extra-row" }, h("bdi", { dir: "ltr", class: "mus-strong prog-line" }, `${ex.pattern.join("-")} = ${ex.answer.join(" – ")}`), listen),
    };
  }

  function key(e) {
    if (locked) return false;
    if (/^[1-9]$/.test(e.key)) {
      const i = Number(e.key) - 1;
      if (tileEls[i] && !tileEls[i].t.disabled) { tileEls[i].t.click(); return true; }
    }
    if (e.key === "Backspace") {
      for (let i = n - 1; i >= 0; i--) if (slots[i] != null) { slots[i] = null; paint(); return true; }
    }
    return false;
  }

  paint();
  return { el: body, check, key };
}
