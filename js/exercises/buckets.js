// buckets.js: family_sort (DESIGN §9.5). Tap a tile, then tap a bucket.
import { h, shuffle, reducedMotion } from "../dom.js";

export function mount(ex, api) {
  const items = shuffle(ex.items.map((it, i) => ({ ...it, i })));
  const place = new Map();   // item index -> bucket id
  let picked = null;
  let locked = false;

  const body = h("div", { class: "ex-body buckets" });
  body.appendChild(h("div", { class: "ex-chiprow" }, h("span", { class: "key-badge" }, "סולם ", h("bdi", { dir: "ltr", class: "mus-strong" }, ex.key), " מז'ור")));
  const tray = h("div", { class: "tray", "aria-label": "אקורדים למיון" });
  body.appendChild(tray);
  const hint = h("p", { class: "hint" }, "הקש על אקורד ואז על המשפחה שלו.");
  body.appendChild(hint);

  const tiles = new Map();
  items.forEach((it) => {
    const t = h("button", { type: "button", class: "tile sort-tile", "aria-pressed": "false", "aria-label": `${it.chord}, דרגה ${it.degree}` },
      h("bdi", { dir: "ltr", class: "mus-strong" }, it.chord), h("small", null, String(it.degree)));
    t.addEventListener("click", (e) => {
      e.stopPropagation();
      if (locked) return;
      if (place.has(it.i)) { place.delete(it.i); picked = null; paint(); return; }
      picked = picked === it.i ? null : it.i;
      paint();
    });
    tiles.set(it.i, t);
  });

  const bucketEls = new Map();
  const bucketsWrap = h("div", { class: "bucket-list" });
  ex.buckets.forEach((b) => {
    const zone = h("div", { class: "bucket-zone" });
    const el = h("button", { type: "button", class: "bucket", "aria-label": `משפחה: ${b.label_he}` }, h("span", { class: "bucket-label" }, b.label_he));
    const wrap = h("div", { class: "bucket-wrap" }, el, zone);
    el.addEventListener("click", () => drop(b.id));
    wrap.addEventListener("click", (e) => { if (e.target === wrap || e.target === zone) drop(b.id); });
    bucketEls.set(b.id, { el, zone, wrap });
    bucketsWrap.appendChild(wrap);
  });
  body.appendChild(bucketsWrap);

  function drop(bid) {
    if (locked || picked == null) return;
    place.set(picked, bid);
    picked = null;
    paint();
  }

  function paint() {
    const empty = tray.querySelector(".tray-empty");
    if (empty) empty.remove();
    items.forEach((it) => {
      const t = tiles.get(it.i);
      const where = place.get(it.i);
      t.classList.toggle("lifted", picked === it.i);
      t.setAttribute("aria-pressed", String(picked === it.i));
      const target = where ? bucketEls.get(where).zone : tray;
      if (t.parentNode !== target) target.appendChild(t);
    });
    bucketEls.forEach(({ wrap }) => wrap.classList.toggle("armed", picked != null && !locked));
    if (!tray.querySelector(".tile")) tray.appendChild(h("span", { class: "tray-empty" }, "כל האקורדים מוינו ✓"));
    api.setReady(place.size === items.length);
  }

  function check() {
    locked = true;
    picked = null;
    let allOk = true;
    const wrong = [];
    items.forEach((it) => {
      const got = place.get(it.i);
      const ok = got === it.family || (it.also_accept || []).includes(got);
      const t = tiles.get(it.i);
      t.disabled = true;
      t.classList.add(ok ? "ok" : "bad");
      t.appendChild(h("span", { class: "tile-mark", "aria-hidden": "true" }, ok ? "✓" : "✕"));
      if (!ok) { allOk = false; wrong.push(it); }
    });
    paint();
    bucketEls.forEach(({ el }) => { el.disabled = true; });
    // the empty tray and the hint only push the buckets under the feedback sheet: collapse them
    tray.hidden = true;
    hint.hidden = true;
    // slide wrong tiles to their right bucket, then bring the first correction into view above the sheet
    setTimeout(() => {
      wrong.forEach((it) => {
        const t = tiles.get(it.i);
        t.classList.add("moving");
        bucketEls.get(it.family).zone.appendChild(t);
        setTimeout(() => t.classList.remove("moving"), 260);
      });
      if (wrong.length) {
        const w = bucketEls.get(wrong[0].family).wrap;
        try { w.scrollIntoView({ block: "start", behavior: reducedMotion() ? "auto" : "smooth" }); } catch (e) { w.scrollIntoView(true); }
      }
    }, 450);
    const label = (id) => String((ex.buckets.find((b) => b.id === id) || {}).label_he || id).replace(/\s*\(.*\)$/, "");
    return {
      correct: allOk,
      answerText: ex.buckets.map((b) => `${b.label_he}: ${ex.items.filter((i) => i.family === b.id).map((i) => i.chord).join(", ")}`).join(" · "),
      chosenText: wrong.map((w) => `${w.chord} ב${label(place.get(w.i))}`).join(", "),
      extras: null,
    };
  }

  function key(e) {
    if (locked) return false;
    if (/^[1-9]$/.test(e.key)) {
      const i = Number(e.key) - 1;
      if (picked != null && i < ex.buckets.length) { drop(ex.buckets[i].id); return true; }
      const free = items.filter((it) => !place.has(it.i));
      if (free[i]) { picked = free[i].i; paint(); return true; }
    }
    return false;
  }

  paint();
  return { el: body, check, key };
}
