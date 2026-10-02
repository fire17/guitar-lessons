// homework.js: homework list + questions for the next lesson (DESIGN §14.1, §14.2)
import { h, richText, iconEl, toast, plainText } from "../dom.js";
import { openSheet } from "../sheet.js";
import * as store from "../store.js";
import { go } from "../router.js";

export function renderHomework(lesson, { onChange } = {}) {
  const wrap = h("div", { class: "hw" });
  const groups = [
    ["teacher", "המורה ביקש"],
    ["suggestion", "הצעות לתרגול"],
  ];
  const last7 = [...Array(7)].map((_, i) => store.addDays(store.today(), i - 6));
  for (const [from, title] of groups) {
    const items = (lesson.homework || []).filter((x) => x.from === from);
    if (!items.length) continue;
    const list = h("ol", { class: "hw-list" });
    items.forEach((it) => {
      const key = `${lesson.id}/${it.id}`;
      const days = store.homeworkDays(key);
      const doneToday = days.includes(store.today());
      const locked = !!it.locked;
      const cb = h("input", { type: "checkbox", class: "hw-cb", id: "hw-" + it.id, checked: doneToday || null, disabled: locked || null });
      cb.addEventListener("change", () => {
        const added = store.toggleHomework(key);
        if (added) {
          const s = store.get();
          s.hwXp = s.hwXp || {};
          const tag = `${key}@${store.today()}`;
          if (!s.hwXp[tag]) { s.hwXp[tag] = 1; store.addXP(5); toast("+5 XP · עשית היום ✓"); }
        }
        strip.replaceWith(strip = dots(store.homeworkDays(key)));
        if (onChange) onChange();
      });
      let strip = dots(days);
      function dots(ds) {
        return h("div", { class: "hw-dots", "aria-label": `בוצע ב-${last7.filter((d) => ds.includes(d)).length} מתוך 7 הימים האחרונים` },
          last7.map((d) => h("i", { class: ds.includes(d) ? "on" : "", title: d })));
      }
      const row = h("li", { class: `hw-item ${locked ? "locked" : ""}` },
        h("div", { class: "hw-text", html: richText(it.text_he) }),
        it.note_he ? h("p", { class: "hw-note", html: richText(it.note_he) }) : null,
        h("div", { class: "hw-meta" },
          it.ts ? h("span", { html: richText("⏱ " + it.ts) }) : null,
          from === "suggestion" ? h("span", { class: "tag tag-suggest" }, "הצעה, לא מהמורה") : null),
        h("div", { class: "hw-actions" },
          locked ? h("span", { class: "hw-lock" }, h("span", { html: iconElHTML("lock") }), " בשיעור הבא") :
            h("label", { class: "hw-check", for: "hw-" + it.id }, cb, h("span", null, "עשיתי היום")),
          it.practice && it.practice.route ? h("button", { type: "button", class: "btn btn-secondary btn-sm", onclick: () => go(it.practice.route) }, "תרגל") : null,
          locked ? null : strip));
      list.appendChild(row);
    });
    wrap.appendChild(h("section", { class: "hw-group" }, h("h3", null, title), list));
  }
  return wrap;
}

function iconElHTML(name) { const d = document.createElement("div"); d.appendChild(iconEl(name, 18)); return d.innerHTML; }

export function openHomework(lesson) {
  return openSheet({ title: "📝 שיעורי בית", subtitle: `שיעור ${lesson.lesson_number}`, content: renderHomework(lesson), side: true });
}

export function renderQuestions(lesson) {
  const st = store.get();
  st.qAsked = st.qAsked || {};
  const wrap = h("div", { class: "qs" });
  const list = h("ul", { class: "q-list" });
  const rows = [];
  (lesson.open_questions || []).forEach((q, i) => {
    const key = `${lesson.id}/oq${i}`;
    rows.push({ text: q.text_he, ts: q.ts, asked: !!st.qAsked[key], set: (v) => { st.qAsked[key] = v; store.save(); }, own: false });
  });
  const paint = () => {
    list.innerHTML = "";
    const mine = store.get().questions.filter((q) => !q.lesson || q.lesson === lesson.id || true);
    const all = [...rows, ...mine.map((q) => ({ text: q.text, asked: q.asked, set: (v) => store.updateQuestion(q.id, { asked: v }), own: true, q }))];
    if (!all.length) list.appendChild(h("li", { class: "muted" }, "עוד אין שאלות. שאלות ששאלת את המורה ונשמרו יופיעו כאן."));
    all.forEach((r, i) => {
      const id = `q-${i}`;
      const cb = h("input", { type: "checkbox", id, checked: r.asked || null });
      cb.addEventListener("change", () => { r.set(cb.checked); r.asked = cb.checked; li.classList.toggle("asked", cb.checked); });
      const text = r.own ? h("div", { class: "q-text", contenteditable: "true", role: "textbox", "aria-label": "עריכת השאלה" }, r.text) : h("div", { class: "q-text", html: richText(r.text) });
      if (r.own) text.addEventListener("blur", () => { const v = text.textContent.trim(); if (v && v !== r.q.text) store.updateQuestion(r.q.id, { text: v }); });
      const li = h("li", { class: `q-item ${r.asked ? "asked" : ""} ${r.own ? "own" : ""}` },
        text,
        h("div", { class: "q-meta" },
          r.ts ? h("span", { html: richText("⏱ " + r.ts) }) : null,
          r.own ? h("span", { class: "tag tag-mine" }, "השאלה שלי") : null,
          h("label", { class: "q-check", for: id }, cb, h("span", null, "נשאל ✓")),
          r.own ? h("button", { type: "button", class: "icon-btn sm", "aria-label": "מחק שאלה", onclick: () => { store.deleteQuestion(r.q.id); paint(); } }, iconEl("trash", 18)) : null));
      list.appendChild(li);
    });
  };
  paint();
  const input = h("input", { type: "text", class: "text-input", placeholder: "הוסף שאלה לשיעור הבא", "aria-label": "הוסף שאלה לשיעור הבא" });
  const add = h("button", { type: "button", class: "btn btn-secondary btn-sm" }, iconEl("plus", 18), " הוסף");
  const doAdd = () => { const v = input.value.trim(); if (!v) return; store.addQuestion({ lesson: lesson.id, text: v }); input.value = ""; paint(); };
  add.addEventListener("click", doAdd);
  input.addEventListener("keydown", (e) => { if (e.key === "Enter") doAdd(); });
  const share = h("button", { type: "button", class: "btn btn-primary btn-block" }, iconEl("share", 18), " שתף את הרשימה");
  share.addEventListener("click", async () => {
    const lines = [...list.querySelectorAll(".q-item")].map((li, i) => `${i + 1}. ${plainText(li.querySelector(".q-text").textContent)}${li.classList.contains("asked") ? " ✓" : ""}`);
    const text = `שאלות לשיעור הבא\n${lines.join("\n")}`;
    try {
      if (navigator.share) { await navigator.share({ text }); return; }
    } catch (e) { if (e && e.name === "AbortError") return; }
    try { await navigator.clipboard.writeText(text); toast("הרשימה הועתקה"); }
    catch (e) { toast("לא הצלחתי להעתיק"); }
  });
  wrap.append(list, h("div", { class: "q-add" }, input, add), share);
  return wrap;
}

export function openQuestions(lesson) {
  return openSheet({ title: "❓ שאלות לשיעור הבא", content: renderQuestions(lesson), side: true });
}
