// ask.js: "שאלה על המושג" sheet (DESIGN §13). Only quote_he is the teacher's own words; every other answer
// here is app-written (summary / FAQ), so it speaks as a neutral 📖 guide, never in the teacher's voice.
import { h, richText, iconEl, toast, md } from "../dom.js";
import { openSheet } from "../sheet.js";
import { ClipPlayer } from "../exercises/clips.js";
import { Fretboard } from "../fretboard.js";
import * as teacher from "../teacher.js";
import * as store from "../store.js";
import { go } from "../router.js";

function draftKey(c, unit) { return `gl.draft.${unit ? unit.uid : ""}.${c.id}`; }
function getDraft(k) { try { return sessionStorage.getItem(k) || ""; } catch (e) { return ""; } }
function setDraft(k, v) { try { if (v) sessionStorage.setItem(k, v); else sessionStorage.removeItem(k); } catch (e) { /* ignore */ } }

export function openAsk(unit, concept, ex) {
  if (!unit || !concept) return;
  const c = concept;
  const history = [];
  const content = h("div", { class: "ask" });

  if (c.quote_he) {
    content.appendChild(h("figure", { class: "quote-card" },
      h("figcaption", null, "במילים של המורה"),
      h("blockquote", { html: richText(`"${c.quote_he}"`) }),
      c.source_ts ? h("div", { html: richText("⏱ " + c.source_ts) }) : null));
  }
  if (c.concept_he) content.appendChild(h("section", { class: "ask-sec" }, h("h3", null, "בקצרה"), h("p", { html: richText(c.concept_he) })));
  if (c.deeper_he) content.appendChild(h("section", { class: "ask-sec" }, h("h3", null, c._fallback ? "ההסבר מהתרגיל" : "הסבר מעמיק"), h("div", { class: "reading", html: md(c.deeper_he) })));
  else if (c._fallback && !c.deeper_he && unit.notes_md) content.appendChild(h("section", { class: "ask-sec" }, h("h3", null, "מהסיכום"), h("div", { class: "reading", html: md(unit.notes_md) })));

  // example
  const ex2 = c.example || {};
  if ((ex2.clips && ex2.clips.length) || c.fretboard) {
    const sec = h("section", { class: "ask-sec" }, h("h3", null, "דוגמה"));
    if (ex2.clips && ex2.clips.length) sec.appendChild(ClipPlayer(ex2.clips, { showLabels: true }).el);
    if (c.fretboard) {
      const f = c.fretboard;
      const holder = h("div", { class: "fb-holder mini" });
      const toggle = h("div", { class: "seg", role: "group", "aria-label": "תוויות" });
      let fb = null;
      const mk = (mode, text) => {
        const b = h("button", { type: "button", class: "seg-btn", "aria-pressed": String(mode === "degrees") }, text);
        b.addEventListener("click", () => {
          toggle.querySelectorAll(".seg-btn").forEach((x) => x.setAttribute("aria-pressed", "false"));
          b.setAttribute("aria-pressed", "true");
          fb.setLabels(mode);
        });
        return b;
      };
      toggle.append(mk("degrees", "דרגות"), mk("names", "שמות תווים"));
      sec.append(toggle, holder);
      setTimeout(() => {
        fb = Fretboard(holder, { frets: f.frets || [0, 9], strings: f.strings || [6, 5], key: f.key, labels: "degrees", marks: (f.marks || []).map((m) => ({ ...m, deg: Number(m.label) || undefined })), soundOnTap: true, compact: true });
      }, 0);
    }
    content.appendChild(sec);
  }

  const practice = h("button", { type: "button", class: "btn btn-secondary btn-block" }, "תרגל את זה");
  practice.addEventListener("click", () => go(`#/practice/skill/${c.skill || (ex && ex.skill) || unit.skills[0]}`));
  content.appendChild(practice);

  // chat
  const chat = h("div", { class: "chat", "aria-live": "polite" });
  const faqRow = h("div", { class: "faq-row" });
  (c.faq || []).filter((f) => f.q_he).forEach((f) => {
    const chip = h("button", { type: "button", class: "chip-btn faq-chip" }, f.q_he);
    chip.addEventListener("click", () => {
      bubble("user", f.q_he);
      bubble("guide", f.answer_he, saveBtn(f.q_he));
      history.push({ role: "user", text_he: f.q_he }, { role: "guide", text_he: f.answer_he });
      chip.remove();
    });
    faqRow.appendChild(chip);
  });
  if (faqRow.children.length) content.appendChild(h("section", { class: "ask-sec" }, h("h3", null, "שאלות שעולות"), faqRow));
  content.appendChild(chat);

  const dk = draftKey(c, unit);
  const input = h("textarea", { class: "composer-input", rows: "1", placeholder: "שאלה משלך…", "aria-label": "שאלה משלך על המושג" });
  input.value = getDraft(dk);
  const send = h("button", { type: "button", class: "send-btn", "aria-label": "שלח" }, iconEl("send", 22));
  const composer = h("div", { class: "composer" }, input, send);
  content.appendChild(composer);
  input.addEventListener("input", () => {
    setDraft(dk, input.value);
    input.style.height = "auto";
    input.style.height = Math.min(140, input.scrollHeight) + "px";
  });
  input.addEventListener("keydown", (e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } });
  send.addEventListener("click", submit);

  function bubble(role, text, extra) {
    const b = h("div", { class: `bubble ${role}` },
      role === "guide" ? h("div", { class: "bubble-who" }, h("span", { "aria-hidden": "true" }, "📖"), " מהסיכום") : null,
      h("div", { class: "bubble-text", html: md(text) }), extra || null);
    chat.appendChild(b);
    b.scrollIntoView({ block: "nearest", behavior: "smooth" });
    return b;
  }

  // queue a question for the next lesson with יונתן (the only path from this sheet to the real teacher)
  function saveQuestion(q) {
    store.addQuestion({ lesson: unit.lessonId, unit: unit.id, concept: c.id, text: q });
    toast("השאלה נשמרה לשיעור הבא ✓");
  }
  function saveBtn(q) {
    const b = h("button", { type: "button", class: "btn btn-ghost btn-sm" }, "שמור לשיעור הבא");
    b.addEventListener("click", () => { saveQuestion(q); b.disabled = true; b.textContent = "נשמר לשיעור הבא ✓"; });
    return h("div", { class: "bubble-extra" }, b);
  }

  async function submit() {
    const q = input.value.trim();
    if (!q) return;
    input.value = "";
    setDraft(dk, "");
    input.style.height = "auto";
    bubble("user", q);
    const typing = bubble("guide", "…");
    const req = {
      lesson_id: unit.lessonId, unit_id: unit.id, concept_id: c.id, question_he: q, history: history.slice(),
      grounding: { concept_he: c.concept_he || unit.concept_he, deeper_he: c.deeper_he || "", quote_he: c.quote_he || "", notes_md_excerpt: (unit.notes_md || unit.concept_he || "").slice(0, 1200), explain_he: ex ? ex.explain_he : undefined },
      faq: c.faq || [],
    };
    const res = await teacher.ask(req);
    typing.remove();
    const extra = h("div", { class: "bubble-extra" },
      res.suggested_skill ? h("button", { type: "button", class: "btn btn-ghost btn-sm", onclick: () => go(`#/practice/skill/${res.suggested_skill}`) }, "תרגל את זה") : null);
    if (!res.saved) extra.appendChild(saveBtn(q).firstChild);
    bubble("guide", res.answer_he, extra);
    history.push({ role: "user", text_he: q }, { role: "guide", text_he: res.answer_he });
    if (res.saved) saveQuestion(q);
  }

  const avatar = h("div", { class: "teacher-avatar guide", "aria-hidden": "true" }, "📖");
  return openSheet({ title: "שאלה על המושג", subtitle: String(c.title_he || unit.title_he || "").replace(/\s*\[(שחזור|הערה|בונוס)\]/g, ""), content, avatar, side: true, className: "ask-sheet" });
}
