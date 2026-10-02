// me.js: progress + settings + backup (DESIGN §15.1, §15.2)
import { h, iconEl, toast, richText } from "../dom.js";
import { DB } from "../data.js";
import * as store from "../store.js";
import * as audio from "../audio.js";
import { skillMastery, ring } from "../session.js";
import { openSheet, confirmSheet } from "../sheet.js";
import { seg, toggle } from "./tools.js";
import { go } from "../router.js";
import { applyTheme } from "../theme.js";

export function renderMe(main) {
  const st = store.get();
  const xp = store.xpToday();
  const goalPct = Math.min(100, Math.round((100 * xp) / st.goal));
  const page = h("div", { class: "page me" }, h("h1", { class: "page-title" }, "ההתקדמות שלך"));

  // goal + streak
  const goalRing = ring(goalPct, 140, 12, false);
  page.appendChild(h("div", { class: "me-top" },
    h("div", { class: "goal-card card" },
      h("div", { class: "ring-box", style: { width: "140px", height: "140px" } }, goalRing, h("div", { class: "goal-center" }, h("b", null, String(xp)), h("small", null, "מתוך ", h("bdi", { dir: "ltr", class: "nb" }, `${st.goal} XP`)))),
      h("p", { class: "goal-line" }, xp >= st.goal ? "היעד היומי הושלם ✓" : ["עוד ", h("bdi", { dir: "ltr", class: "nb" }, `${st.goal - xp} XP`), " ליעד היומי"])),
    h("div", { class: "streak-card card" },
      h("div", { class: "streak-big" }, h("span", { "aria-hidden": "true" }, "🔥"), ` ${st.streak.count} `, h("small", null, st.streak.count === 1 ? "יום" : "ימים")),
      h("p", null, `שיא: ${st.streak.best} ${st.streak.best === 1 ? "יום" : "ימים"}`),
      h("p", { class: "muted small" }, h("span", { "aria-hidden": "true" }, "❄️ "), `הקפאות רצף: ${st.streak.freezes || 0}`, h("br"), "כל 7 ימים ברצף מוסיפים הקפאה (עד 2), ששומרת על הרצף כשמפספסים יום."),
      h("p", { class: "muted small" }, "סך הכול ", h("bdi", { dir: "ltr", class: "nb" }, `${st.xp.total} XP`)))));

  // 5-week calendar, Sunday at the right
  const goalDays = new Set(store.goalDays());
  const todayIso = store.today();
  const now = new Date();
  const startSunday = store.addDays(todayIso, -now.getDay() - 28);
  const cal = h("div", { class: "cal", role: "grid", "aria-label": "חמשת השבועות האחרונים" });
  ["א", "ב", "ג", "ד", "ה", "ו", "ש"].forEach((d) => cal.appendChild(h("div", { class: "cal-h", "aria-hidden": "true" }, d)));
  // month caption, alternating month shading and a month tag on each "1", so "30 31 1 2" does not read as one run
  const monthName = (iso, style = "long") => { const [y, m] = iso.split("-").map(Number); try { return new Intl.DateTimeFormat("he", { month: style }).format(new Date(y, m - 1, 15)); } catch (e) { return String(m); } };
  const endIso = store.addDays(startSunday, 34);
  const m0 = Number(startSunday.slice(5, 7));
  for (let i = 0; i < 35; i++) {
    const d = store.addDays(startSunday, i);
    const met = goalDays.has(d);
    const day = Number(d.slice(8));
    const alt = (Number(d.slice(5, 7)) - m0 + 12) % 2 === 1;
    cal.appendChild(h("div", { class: `cal-d ${met ? "met" : ""} ${d === todayIso ? "today" : ""} ${d > todayIso ? "future" : ""} ${alt ? "m-alt" : ""} ${day === 1 ? "first" : ""}`, role: "gridcell", "aria-label": `${day} ב${monthName(d)}${met ? ", היעד הושג" : ""}` },
      String(day), day === 1 ? h("small", { "aria-hidden": "true" }, monthName(d, "short")) : null));
  }
  const months = startSunday.slice(0, 7) === endIso.slice(0, 7) ? monthName(startSunday) : `${monthName(startSunday)} – ${monthName(endIso)}`;
  page.appendChild(h("section", { class: "card me-sec" }, h("h2", null, "ימים שבהם היעד הושג"), h("p", { class: "cal-cap muted" }, months), cal));

  // skills grid
  const grid = h("div", { class: "skills-grid" });
  DB.skills.forEach((sk) => {
    const m = skillMastery(sk.id);
    const b = h("button", { type: "button", class: "skill-cell", "aria-label": `${sk.title_he}: ${m}%` }, ring(m, 88, 7), h("span", { class: "skill-name", html: richText(sk.title_he) }));
    b.addEventListener("click", () => openSkill(sk));
    grid.appendChild(b);
  });
  page.appendChild(h("section", { class: "card me-sec" }, h("h2", null, "שליטה לפי מיומנות"), grid));

  // drill bests
  const drills = Object.entries(st.drill || {}).filter(([, v]) => v && v.bestAvgMs);
  page.appendChild(h("section", { class: "card me-sec" }, h("h2", null, "⚡ תרגיל המהירות"),
    drills.length ? h("div", { class: "drill-bests" }, drills.map(([k, v]) => h("div", { class: "stat" }, h("div", { class: "stat-v" }, `${(v.bestAvgMs / 1000).toFixed(2)}s`), h("div", { class: "stat-l" }, h("bdi", { dir: "ltr" }, k))))) :
      h("p", { class: "muted" }, "עוד לא רצת את תרגיל המהירות."),
    h("a", { class: "btn btn-secondary btn-sm", href: "#/tools/drill?key=G" }, "לתרגיל")));

  page.appendChild(settingsSection());
  main.appendChild(page);
}

function openSkill(sk) {
  const m = skillMastery(sk.id);
  const exs = sk.exercises.filter((e) => !e.bonus);
  const seen = exs.filter((e) => (store.item(e.uid) || {}).seen).length;
  const go2 = h("button", { type: "button", class: "btn btn-primary btn-block", autofocus: true }, "חזק את זה");
  go2.addEventListener("click", () => go(`#/practice/skill/${sk.id}`));
  openSheet({ title: sk.title_he, content: h("div", { class: "skill-pop" }, ring(m, 120, 10), h("p", null, `ראית ${seen} מתוך ${exs.length} תרגילים`), go2) });
}

function settingsSection() {
  const s = store.settings();
  const sec = h("section", { class: "card me-sec settings" }, h("h2", null, "הגדרות"));
  const row = (label, control, note) => h("div", { class: "set-row" }, h("div", { class: "set-l" }, label, note ? h("small", null, note) : null), control);
  sec.appendChild(row("ערכת צבע", seg([["system", "מערכת"], ["light", "בהיר"], ["dark", "כהה"]], s.theme, (v) => { store.setSetting("theme", v); applyTheme(); }, "ערכת צבע")));
  sec.appendChild(h("div", { class: "set-row" }, toggle("צליל", s.sound, (v) => store.setSetting("sound", v))));
  const vol = h("input", { type: "range", min: "0", max: "1", step: "0.05", value: String(s.volume), class: "slider", "aria-label": "עוצמה" });
  vol.addEventListener("input", () => { store.setSetting("volume", Number(vol.value)); audio.setVolume(Number(vol.value)); });
  vol.addEventListener("change", () => { audio.ensure(); audio.pluck(55, 0, 0.5); });
  sec.appendChild(row("עוצמה", vol, "אין צליל באייפון? בדוק את מתג השקט."));
  sec.appendChild(h("div", { class: "set-row" }, toggle("צלילי משוב", s.sfx, (v) => store.setSetting("sfx", v))));
  sec.appendChild(h("div", { class: "set-row" }, toggle("רטט", s.haptics, (v) => store.setSetting("haptics", v))));
  sec.appendChild(h("div", { class: "set-row" }, toggle("ללא צליל (מדלג על תרגילי שמיעה)", s.noAudio, (v) => store.setSetting("noAudio", v))));
  sec.appendChild(row("יעד יומי", seg([[20, "20"], [30, "30"], [50, "50"]], store.get().goal, (v) => { store.get().goal = v; store.save(); }, "יעד יומי")));
  sec.appendChild(h("div", { class: "set-row" }, toggle("תרגילי בונוס", s.bonus, (v) => store.setSetting("bonus", v))));
  sec.appendChild(h("div", { class: "set-row" }, toggle("שמאלי (מראה את הצוואר)", s.lefty, (v) => store.setSetting("lefty", v))));
  sec.appendChild(row("תוויות בצוואר כברירת מחדל", seg([["degrees", "דרגות"], ["names", "שמות"]], s.fbLabels, (v) => store.setSetting("fbLabels", v), "תוויות")));

  // backup
  const exp = h("button", { type: "button", class: "btn btn-secondary btn-sm" }, iconEl("download", 18), " ייצוא");
  exp.addEventListener("click", () => {
    const blob = new Blob([store.exportJSON()], { type: "application/json" });
    const a = h("a", { href: URL.createObjectURL(blob), download: `guitar-progress-${store.today()}.json` });
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  });
  const file = h("input", { type: "file", accept: "application/json,.json", hidden: true });
  const imp = h("button", { type: "button", class: "btn btn-secondary btn-sm" }, iconEl("upload", 18), " ייבוא");
  imp.addEventListener("click", () => file.click());
  file.addEventListener("change", async () => {
    const f = file.files[0];
    if (!f) return;
    try {
      const text = await f.text();
      const parsed = JSON.parse(text);
      if (!parsed || parsed.v !== 1) throw new Error("bad");
      if (await confirmSheet({ title: "לייבא גיבוי?", text: "ההתקדמות הנוכחית תוחלף בזו שבקובץ.", yes: "ייבא", no: "ביטול", danger: true })) {
        store.importJSON(text);
        toast("הגיבוי נטען ✓");
        go("#/me", true);
      }
    } catch (e) { toast("קובץ גיבוי לא תקין"); }
    file.value = "";
  });
  const resetBtn = h("button", { type: "button", class: "btn btn-ghost btn-sm danger" }, "איפוס התקדמות");
  resetBtn.addEventListener("click", () => {
    const input = h("input", { type: "text", class: "text-input", placeholder: "הקלד: איפוס", "aria-label": "הקלד איפוס לאישור" });
    const yes = h("button", { type: "button", class: "btn btn-danger btn-block", disabled: true }, "אפס הכול");
    input.addEventListener("input", () => { yes.disabled = input.value.trim() !== "איפוס"; });
    const entry = openSheet({ title: "איפוס התקדמות", content: h("div", { class: "confirm" }, h("p", null, "כל ה-XP, הרצף והשליטה יימחקו. ההגדרות נשמרות. כדי לאשר, הקלד איפוס."), input, yes) });
    yes.addEventListener("click", () => { store.reset(); entry.close(); toast("ההתקדמות אופסה"); setTimeout(() => go("#/me", true), 250); });
  });
  sec.appendChild(row("גיבוי", h("div", { class: "btn-row" }, exp, imp, file)));
  sec.appendChild(h("div", { class: "set-row" }, resetBtn));
  sec.appendChild(h("p", { class: "muted small" }, store.storageOk ? "ההתקדמות נשמרת בדפדפן הזה בלבד." : "ההתקדמות לא נשמרת בדפדפן הזה (מצב פרטי?). כדאי לייצא גיבוי."));
  return sec;
}
