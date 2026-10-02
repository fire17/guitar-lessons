// path.js: home path (DESIGN §7)
import { h, richText, fmtDate, iconEl } from "../dom.js";
import { DB, lessonTitle, conceptFor } from "../data.js";
import * as store from "../store.js";
import { go } from "../router.js";
import { openSheet } from "../sheet.js";
import { unitMastery, nextLevel, ring, ringColor } from "../session.js";
import { openAsk } from "./ask.js";
import { openHomework, openQuestions } from "./homework.js";
import * as audio from "../audio.js";

const OFFSETS = [0, -50, -70, -50, 0, 50, 70, 50];

export function greeting() {
  const hr = new Date().getHours();
  const g = hr >= 5 && hr <= 11 ? "בוקר טוב" : hr >= 12 && hr <= 16 ? "צהריים טובים" : hr >= 17 && hr <= 21 ? "ערב טוב" : "לילה טוב";
  const student = (DB.lessons[0] && DB.lessons[0].student_he) || "";
  return student ? `${g}, ${student}` : g;
}

export function recommendedUnit() {
  return DB.units.find((u) => store.levelsDone(u.uid) < 3) || null;
}

export function renderPath(main) {
  const xp = store.xpToday();
  const goal = store.get().goal;
  const left = Math.max(0, goal - xp);
  const page = h("div", { class: "page path-page" });
  page.appendChild(h("div", { class: "greet" },
    h("h1", { class: "greet-h" }, greeting()),
    h("p", { class: "greet-sub" }, left > 0 ? ["עוד ", h("bdi", { dir: "ltr", class: "nb" }, `${left} XP`), " ליעד היומי"] : "היעד היומי הושלם ✓")));
  const rec = recommendedUnit();
  let recEl = null;
  let nodeIdx = 0;

  for (const lesson of DB.lessons) {
    const band = h("section", { class: "band", "aria-label": `שיעור ${lesson.lesson_number}` });
    band.appendChild(lessonHeader(lesson));
    const col = h("div", { class: "path-col" });
    for (const u of lesson.units) {
      if (!u.uid) continue;
      const off = OFFSETS[nodeIdx++ % OFFSETS.length];
      const el = unitNode(u, off, rec === u);
      if (rec === u) recEl = el;
      col.appendChild(el);
    }
    if (lesson.homework && lesson.homework.length) {
      const off = OFFSETS[nodeIdx++ % OFFSETS.length];
      col.appendChild(extraNode("📝", "שיעורי בית", off, () => openHomework(lesson), "hw"));
    }
    const off = OFFSETS[nodeIdx++ % OFFSETS.length];
    col.appendChild(extraNode("❓", "שאלות לשיעור הבא", off, () => openQuestions(lesson), "qs"));
    band.appendChild(col);
    page.appendChild(band);
  }
  page.appendChild(h("div", { class: "path-col" }, h("div", { class: "node-wrap" }, h("div", { class: "node node-next", "aria-hidden": "true" }, "＋"), h("div", { class: "node-title muted" }, "השיעור הבא יופיע כאן"))));
  main.appendChild(page);
  if (recEl) {
    requestAnimationFrame(() => {
      const r = recEl.getBoundingClientRect();
      const y = window.scrollY + r.top + r.height / 2 - window.innerHeight * 0.4;
      if (y > 40) window.scrollTo({ top: y, behavior: "instant" in window ? "instant" : "auto" });
    });
  }
}

function lessonHeader(lesson) {
  const gist = h("p", { class: "lh-gist clamp3", html: richText(lesson.gist_he || "") });
  const more = h("button", { type: "button", class: "link-btn lh-more" }, "עוד");
  more.addEventListener("click", () => { gist.classList.toggle("clamp3"); more.textContent = gist.classList.contains("clamp3") ? "עוד" : "פחות"; });
  const card = h("article", { class: "lesson-head wood" },
    h("p", { class: "lh-meta" }, `שיעור ${lesson.lesson_number} · ${fmtDate(lesson.date)} · עם ${lesson.teacher_he || "המורה"}`),
    h("h2", { class: "lh-title" }, lessonTitle(lesson)),
    gist, more,
    lesson.goal_he ? h("figure", { class: "lh-goal" }, h("figcaption", { class: "lh-goal-cap" }, "המטרה, בניסוח חופשי"), h("blockquote", { html: richText(lesson.goal_he.text_he) }), lesson.goal_he.ts ? h("span", { html: richText("⏱ " + lesson.goal_he.ts) }) : null) : null,
    h("div", { class: "lh-actions" }, h("a", { class: "btn btn-wood", href: `#/notes/${lesson.id}` }, "📖 הסיכום")));
  return card;
}

function nodeState(u, recommended) {
  const n = store.levelsDone(u.uid);
  const m = unitMastery(u);
  if (n >= 3) return m >= 80 ? "gold" : "complete";
  if (recommended) return "recommended";
  if (n >= 1) return "progress";
  return "new";
}

function unitNode(u, off, recommended) {
  const state = nodeState(u, recommended);
  const m = unitMastery(u);
  const n = store.levelsDone(u.uid);
  const levels = store.peekUnit(u.uid).levels;
  const btn = h("button", { type: "button", class: `node node-${state}`, "aria-label": `${u.title_he}. ${n} מתוך 3 רמות. שליטה ${m}%` },
    ringSvg(m),
    h("span", { class: "node-face" }, h("span", { class: "node-emoji", "aria-hidden": "true" }, u.icon || "🎵")),
    state === "complete" || state === "gold" ? h("span", { class: "node-check", "aria-hidden": "true" }, "✓") : null);
  btn.addEventListener("click", () => openNode(u));
  const wrap = h("div", { class: "node-wrap", style: { transform: `translateX(${off}px)` } },
    recommended ? h("div", { class: "node-bubble" }, n > 0 ? "המשך" : "התחל") : null,
    btn,
    h("div", { class: "pips", "aria-hidden": "true" }, levels.map((d) => h("i", { class: d ? "on" : "" }))),
    h("div", { class: "node-title", html: richText(u.path_title_he || u.title_he) }));
  return wrap;
}

function ringSvg(p) {
  const size = 96, stroke = 6, r = 44;
  const c = 2 * Math.PI * r;
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("class", "node-ring");
  svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = `<circle cx="48" cy="48" r="${r}" fill="none" stroke="var(--track)" stroke-width="${stroke}"/>` +
    (p > 0 ? `<circle cx="48" cy="48" r="${r}" fill="none" stroke="${ringColor(p)}" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - p / 100)}" transform="rotate(-90 48 48)"/>` : "");
  return svg;
}

function extraNode(emoji, title, off, onClick, cls) {
  const btn = h("button", { type: "button", class: `node node-square node-${cls}`, "aria-label": title }, h("span", { class: "node-face" }, h("span", { class: "node-emoji", "aria-hidden": "true" }, emoji)));
  btn.addEventListener("click", onClick);
  return h("div", { class: "node-wrap", style: { transform: `translateX(${off}px)` } }, btn, h("div", { class: "node-title" }, title));
}

export function openNode(u) {
  const lv = nextLevel(u);
  const levels = store.peekUnit(u.uid).levels;
  const m = unitMastery(u);
  const concept = h("p", { class: "pop-concept clamp4", html: richText(u.concept_he || "") });
  const more = h("button", { type: "button", class: "link-btn", hidden: true }, "עוד");
  more.addEventListener("click", () => { concept.classList.toggle("clamp4"); more.textContent = concept.classList.contains("clamp4") ? "עוד" : "פחות"; });
  const start = h("button", { type: "button", class: "btn btn-primary btn-block", autofocus: true }, lv ? `התחל רמה ${lv}` : "תרגול נוסף");
  start.addEventListener("click", () => { audio.ensure(); go(`#/play/${u.lessonId}/${u.id}`); });
  const read = h("button", { type: "button", class: "btn btn-secondary btn-block" }, "📖 קרא את הסיכום");
  read.addEventListener("click", () => go(`#/notes/${u.lessonId}/${u.id}`));
  const ask = h("button", { type: "button", class: "btn btn-ghost btn-block" }, "שאלה על המושג");
  ask.addEventListener("click", () => openAsk(u, conceptFor(u, null)));
  const content = h("div", { class: "node-pop" },
    h("div", { class: "pop-top" },
      h("div", { class: "pop-info" }, concept, more,
        h("div", { class: "pop-levels" }, levels.map((d, i) => h("span", { class: `pop-level ${d ? "on" : ""}` }, h("i", { "aria-hidden": "true" }), `רמה ${i + 1}`, d ? " ✓" : "")))),
      h("div", { class: "pop-ring" }, ring(m, 84, 7), h("small", null, "שליטה"))),
    h("div", { class: "btn-col" }, start, read, ask));
  const title = h("span", null, h("span", { class: "pop-emoji", "aria-hidden": "true" }, u.icon || "🎵"), " ", h("span", { html: richText(u.title_he) }));
  const entry = openSheet({ title, content, className: "node-sheet" });
  requestAnimationFrame(() => { if (concept.scrollHeight > concept.clientHeight + 4) more.hidden = false; });
  return entry;
}
