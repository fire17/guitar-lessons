// notes.js: lesson-notes reader (DESIGN §12)
import { h, richText, md, fmtDate, escape, toast } from "../dom.js";
import { DB, lessonTitle, conceptFor } from "../data.js";
import * as store from "../store.js";
import * as audio from "../audio.js";
import * as T from "../theory.js";
import { go } from "../router.js";
import { openAsk } from "./ask.js";
import { renderHomework, renderQuestions } from "./homework.js";

export function renderNotesList(main) {
  const page = h("div", { class: "page" }, h("h1", { class: "page-title" }, "סיכומים"));
  const list = h("div", { class: "lesson-list" });
  DB.lessons.slice().reverse().forEach((l) => {
    const read = l.units.filter((u) => store.peekUnit(u.uid).read).length;
    list.appendChild(h("a", { class: "lesson-card wood", href: `#/notes/${l.id}` },
      h("p", { class: "lh-meta" }, `שיעור ${l.lesson_number} · ${fmtDate(l.date)}`),
      h("h2", { class: "lh-title sm" }, lessonTitle(l)),
      h("p", { class: "lh-gist clamp3", html: richText(l.gist_he || "") }),
      h("p", { class: "lh-meta" }, `📖 ${read}/${l.units.length} יחידות נקראו`)));
  });
  page.appendChild(list);
  main.appendChild(page);
}

const CHORD_RE = /(?<![A-Za-z#♭])([A-G](?:#|♭)?(?:maj7|m7♭5|m|ø|°7|7|5)?)(?![A-Za-z0-9#♭])/gu;
function chordCell(raw, isHead, j) {
  if (isHead || j !== 0) return richText(raw);
  let out = "";
  let last = 0;
  let m;
  CHORD_RE.lastIndex = 0;
  while ((m = CHORD_RE.exec(raw))) {
    out += richText(raw.slice(last, m.index));
    out += `<button type="button" class="chord-btn" dir="ltr" data-chord="${escape(m[1])}" aria-label="נגן ${escape(m[1])}">${escape(m[1])}</button>`;
    last = m.index + m[0].length;
  }
  return out + richText(raw.slice(last));
}

export function renderNotes(main, lessonId, unitId) {
  const lesson = DB.lessonById[lessonId];
  if (!lesson) { go("#/notes", true); return; }
  const page = h("article", { class: "page notes" });
  page.appendChild(h("header", { class: "notes-head" },
    h("p", { class: "notes-meta" }, `שיעור ${lesson.lesson_number} · ${fmtDate(lesson.date)} · עם ${lesson.teacher_he || "המורה"}`),
    h("h1", { class: "notes-title" }, lessonTitle(lesson)),
    h("p", { class: "notes-gist", html: richText(lesson.gist_he || "") }),
    lesson.goal_he ? h("figure", { class: "quote-card paraphrase" }, h("figcaption", null, "המטרה, בניסוח חופשי של דברי המורה"), h("blockquote", { html: richText(lesson.goal_he.text_he) }), lesson.goal_he.ts ? h("div", { html: richText("⏱ " + lesson.goal_he.ts) }) : null) : null));

  const chips = h("nav", { class: "chips-row", "aria-label": "מה למדנו" });
  lesson.units.forEach((u) => {
    const c = h("button", { type: "button", class: "chip-btn" }, h("span", { "aria-hidden": "true" }, u.icon || ""), h("span", { html: richText(u.title_he) }));
    c.addEventListener("click", () => scrollToUnit(u.id));
    chips.appendChild(c);
  });
  page.appendChild(h("section", { class: "notes-sec" }, h("h2", { class: "sec-h" }, "📍 מה למדנו"), chips));

  const sentinels = [];
  lesson.units.forEach((u) => {
    const read = store.peekUnit(u.uid).read;
    const pill = h("span", { class: "read-pill", hidden: !read }, "נקרא ✓");
    const body = h("div", { class: "reading", html: u.notes_md ? md(u.notes_md) : `<p>${richText(u.concept_he || "")}</p>` });
    const practice = h("a", { class: "btn btn-primary", href: `#/play/${lesson.id}/${u.id}` }, "תרגל את היחידה");
    const ask = h("button", { type: "button", class: "btn btn-ghost" }, "שאלה על המושג");
    ask.addEventListener("click", () => openAsk(u, conceptFor(u, null)));
    const sentinel = h("div", { class: "sentinel", "aria-hidden": "true" });
    const sec = h("section", { class: "unit-card", id: `u-${u.id}`, "aria-labelledby": `uh-${u.id}` },
      h("header", { class: "unit-card-head" },
        h("span", { class: "uc-icon", "aria-hidden": "true" }, u.icon || ""),
        h("h2", { class: "uc-title", id: `uh-${u.id}`, html: richText(u.title_he) }),
        h("div", { class: "uc-meta" }, u.source_ts ? h("span", { html: richText("⏱ " + u.source_ts) }) : null, pill)),
      body, sentinel,
      h("footer", { class: "uc-foot" }, practice, ask));
    sentinels.push({ el: sentinel, u, pill });
    page.appendChild(sec);
  });

  if (lesson.chords_table_md) {
    const t = h("div", { class: "reading", html: md(lesson.chords_table_md, { cell: chordCell }) });
    t.addEventListener("click", (e) => {
      const b = e.target.closest(".chord-btn");
      if (!b) return;
      audio.ensure();
      const notes = T.voicing(b.dataset.chord);
      audio.whenUnlocked(() => audio.strum(notes, audio.context().currentTime + 0.03));
      b.classList.add("pressed");
      setTimeout(() => b.classList.remove("pressed"), 250);
    });
    page.appendChild(h("section", { class: "unit-card appendix", id: "chords" }, h("h2", { class: "uc-title" }, "🎸 אקורדים שעלו"), h("p", { class: "muted small" }, "הקש על אקורד כדי לשמוע אותו."), t));
  }
  if (lesson.homework && lesson.homework.length) {
    page.appendChild(h("section", { class: "unit-card appendix", id: "homework" }, h("h2", { class: "uc-title" }, "📝 שיעורי בית"), renderHomework(lesson)));
  }
  page.appendChild(h("section", { class: "unit-card appendix", id: "questions" }, h("h2", { class: "uc-title" }, "❓ שאלות לשיעור הבא"), renderQuestions(lesson)));
  page.appendChild(h("footer", { class: "notes-foot" }, h("div", { html: lesson.notes_footer_md ? md(lesson.notes_footer_md) : "<p>נבנה מתמלול אוטומטי של השיעור.</p>" })));
  main.appendChild(page);

  // read tracking
  if ("IntersectionObserver" in window) {
    const io = new IntersectionObserver((entries) => {
      for (const en of entries) {
        if (!en.isIntersecting) continue;
        const s = sentinels.find((x) => x.el === en.target);
        if (!s) continue;
        io.unobserve(en.target);
        if (store.markRead(s.u.uid)) {
          store.addXP(5);
          s.pill.hidden = false;
          toast("+5 XP · קראת את הסיכום");
        }
      }
    }, { rootMargin: "0px 0px -15% 0px" });
    setTimeout(() => { if (page.isConnected) sentinels.forEach((s) => { if (!store.peekUnit(s.u.uid).read) io.observe(s.el); }); }, 1200);
  }

  if (unitId) requestAnimationFrame(() => scrollToUnit(unitId, false));
}

function scrollToUnit(id, smooth = true) {
  const el = document.getElementById(`u-${id}`);
  if (!el) return;
  const y = el.getBoundingClientRect().top + window.scrollY - 64;
  window.scrollTo({ top: y, behavior: smooth ? "smooth" : "auto" });
}
