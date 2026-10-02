// session.js: session builder + runner + feedback + scoring + SRS + completion (DESIGN §8)
import { h, iconEl, richText, announce, reducedMotion, toast } from "./dom.js";
import { DB, RENDERER, unitExercises, conceptFor } from "./data.js";
import * as store from "./store.js";
import * as audio from "./audio.js";
import { go } from "./router.js";
import { confirmSheet, anyOpen } from "./sheet.js";
import * as choice from "./exercises/choice.js";
import * as order from "./exercises/order.js";
import * as buckets from "./exercises/buckets.js";
import * as fret from "./exercises/fret.js";
import * as learn from "./exercises/learn.js";
import { openAsk } from "./views/ask.js";

const RENDERERS = { choice, order, buckets, fret, learn };
const rendererOf = (ex) => (ex.type === "learn" ? "learn" : RENDERER[ex.type]);
const CORRECT_TITLES = ["יפה!", "בדיוק.", "זה יפה.", "נכון!"];
let correctTitleIdx = 0;
let active = null;

// ---------- mastery (§8.6) ----------
export function skillMastery(skillId) {
  const sk = DB.skillById[skillId];
  if (!sk) return 0;
  const exs = sk.exercises.filter((e) => !e.bonus);
  if (!exs.length) return 0;
  const sum = exs.reduce((a, e) => a + ((store.item(e.uid) || {}).box || 0) / 5, 0);
  return Math.round((100 * sum) / exs.length);
}
export function unitMastery(unit) {
  if (!unit.skills.length) return 0;
  return Math.round(unit.skills.reduce((a, s) => a + skillMastery(s), 0) / unit.skills.length);
}
export function ringColor(p) { return p >= 80 ? "var(--gold-hi)" : p >= 40 ? "var(--brass-strong)" : "var(--wood)"; }

export function dueExercises() {
  const bonusOk = store.settings().bonus;
  const noAudio = store.settings().noAudio;
  return DB.exercises.filter((e) => store.isDue(e.uid) && (bonusOk || !e.bonus) && !(noAudio && isEar(e)));
}
export function dueCount() { return dueExercises().length; }
export function dueBy(day) {
  const bonusOk = store.settings().bonus;
  return DB.exercises.filter((e) => { const it = store.item(e.uid); return it && it.seen && it.due <= day && (bonusOk || !e.bonus); }).length;
}

export function nextLevel(unit) {
  const lv = store.peekUnit(unit.uid).levels;
  const i = lv.indexOf(false);
  return i < 0 ? 0 : i + 1;   // 0 = all done → practice
}

// ---------- builder (§8.2, §8.7) ----------
const isEar = (e) => !!(e.clips && e.clips.length) || /^ear_/.test(e.type);
const seen = (e) => !!(store.item(e.uid) || {}).seen;
const box = (e) => (store.item(e.uid) || {}).box || 0;
const last = (e) => (store.item(e.uid) || {}).last || "";
const due = (e) => (store.item(e.uid) || {}).due || "";

function arrange(list) {
  if (!list.length) return list;
  const rest = list.slice();
  const fi = rest.findIndex((e) => e.difficulty === 1 && !isEar(e));
  const out = [];
  if (fi >= 0) out.push(rest.splice(fi, 1)[0]);
  while (rest.length) {
    const prev = out.length ? rendererOf(out[out.length - 1]) : null;
    let j = rest.findIndex((e) => rendererOf(e) !== prev);
    if (j < 0) j = 0;
    out.push(rest.splice(j, 1)[0]);
  }
  return out;
}

export function buildUnitSession(unit, L) {
  const s = store.settings();
  let exs = unitExercises(unit).filter((e) => !e.bonus || (L >= 3 && s.bonus));
  if (s.noAudio) exs = exs.filter((e) => !isEar(e));
  const chosen = [];
  const add = (e) => { if (!chosen.includes(e)) chosen.push(e); };
  exs.filter((e) => !seen(e) && e.difficulty === L).slice(0, 7).forEach(add);
  exs.filter((e) => seen(e) && e.difficulty <= L && !chosen.includes(e))
    .sort((a, b) => box(a) - box(b) || last(a).localeCompare(last(b)))
    .forEach((e) => { if (chosen.length < 8) add(e); });
  exs.filter((e) => !seen(e) && e.difficulty === L + 1 && !chosen.includes(e)).forEach((e) => { if (chosen.length < 8) add(e); });
  dueExercises().filter((e) => !chosen.includes(e)).sort((a, b) => box(a) - box(b) || due(a).localeCompare(due(b))).slice(0, 2).forEach(add);
  if (chosen.length < 5) {
    const pool = unitExercises(unit).filter((e) => !chosen.includes(e) && (!e.bonus || s.bonus) && !(s.noAudio && isEar(e)));
    pool.sort((a, b) => Number(seen(b)) - Number(seen(a)) || a.difficulty - b.difficulty);
    for (const e of pool) { if (chosen.length >= 5) break; add(e); }
  }
  const list = arrange(chosen.slice(0, 10));
  // teach before test: the first time a unit is opened, a "learn" card comes before any question
  const fresh = L === 1 && !unitExercises(unit).some(seen);
  return fresh && list.length ? [learn.card(unit), ...list] : list;
}

export function buildReview() {
  return arrange(dueExercises().sort((a, b) => box(a) - box(b) || due(a).localeCompare(due(b))).slice(0, 10));
}
export function buildWeak() {
  const s = store.settings();
  return arrange(DB.exercises.filter((e) => seen(e) && (s.bonus || !e.bonus) && !(s.noAudio && isEar(e))).sort((a, b) => box(a) - box(b) || last(a).localeCompare(last(b))).slice(0, 10));
}
export function buildSkill(skillId) {
  const s = store.settings();
  const sk = DB.skillById[skillId];
  if (!sk) return [];
  return arrange(sk.exercises.filter((e) => (s.bonus || !e.bonus) && !(s.noAudio && isEar(e))).sort((a, b) => box(a) - box(b) || a.order - b.order).slice(0, 8));
}

// ---------- runner ----------
export function teardown() {
  if (!active) return;
  active.destroy();
  active = null;
}
export function isActive() { return !!active; }
export function current() { return active && active.S.queue[active.S.pos] ? { ex: active.S.queue[active.S.pos].ex, attempt: active.S.queue[active.S.pos].attempt, phase: active.S.phase, pos: active.S.pos, len: active.S.queue.length, xp: active.S.xp } : (active ? { phase: active.S.phase } : null); }

export function run(root, exercises, meta) {
  teardown();
  const S = {
    queue: exercises.map((ex) => ({ ex, attempt: 1 })),
    pos: 0,
    done: 0,
    firstTry: new Set(),
    missed: new Set(),
    xp: 0,
    combo: 0,
    start: Date.now(),
    renderer: null,
    phase: "answer",
    result: null,
    masteryBefore: {},
    streakBefore: store.get().streak.count,
    streakGrew: false,
    goalMet: false,
    goalShown: false,
  };
  const skillIds = [...new Set(exercises.map((e) => e.skill))];
  skillIds.forEach((s) => { S.masteryBefore[s] = skillMastery(s); });
  audio.prerender(audio.clipNotes(exercises.flatMap((e) => e.clips || [])));

  const closeBtn = h("button", { type: "button", class: "icon-btn", "aria-label": "סגור את התרגול" }, iconEl("close"));
  const bar = h("div", { class: "ses-bar", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": "100", "aria-label": "התקדמות" }, h("i"));
  const combo = h("div", { class: "combo", hidden: true });
  const askBtn = h("button", { type: "button", class: "icon-btn", "aria-label": "שאלה על המושג" }, iconEl("question"));
  const head = h("header", { class: "ses-head" }, closeBtn, bar, combo, askBtn);
  const scroll = h("div", { class: "ses-scroll" });
  const checkBtn = h("button", { type: "button", class: "btn btn-primary btn-block", disabled: true }, "בדוק");
  const foot = h("footer", { class: "ses-foot" }, checkBtn);
  const fbWrap = h("div", { class: "fbk-wrap" });
  const screen = h("div", { class: "session" }, head, scroll, foot, fbWrap);
  root.innerHTML = "";
  root.appendChild(screen);

  if (!exercises.length) {
    scroll.appendChild(h("div", { class: "empty" }, h("p", null, "אין תרגילים לסשן הזה."), h("button", { type: "button", class: "btn btn-primary", onclick: () => go("#/") }, "חזרה למסלול")));
    foot.hidden = true;
  }

  closeBtn.addEventListener("click", exit);
  askBtn.addEventListener("click", () => {
    const cur = S.queue[S.pos];
    if (!cur) return;
    const unit = DB.unitByKey[`${cur.ex.lessonId}/${cur.ex.unitId}`];
    openAsk(unit, conceptFor(unit, cur.ex), cur.ex);
  });
  checkBtn.addEventListener("click", () => { if (S.queue[S.pos] && S.queue[S.pos].ex.type === "learn") learnNext(); else doCheck(); });

  async function exit() {
    if (S.phase === "complete") { go("#/"); return; }
    const ok = await confirmSheet({ title: "לצאת מהתרגול?", text: "ה-XP שכבר צברת נשמר.", yes: "להמשיך לתרגל", no: "לצאת" });
    if (ok === false) go("#/");   // dismissing the sheet (back, ✕, Escape) keeps practicing
  }

  function paintBar() {
    const total = S.queue.length;
    const pct = total ? Math.round((100 * S.done) / total) : 0;
    bar.firstChild.style.width = pct + "%";
    bar.setAttribute("aria-valuenow", String(pct));
    combo.hidden = S.combo < 3;
    combo.textContent = `🔥 ${S.combo} ברצף`;
  }

  function show() {
    S.phase = "answer";
    fbWrap.innerHTML = "";
    fbWrap.classList.remove("open");
    const item = S.queue[S.pos];
    if (!item) return complete();
    const ex = item.ex;
    if (S.renderer && S.renderer.destroy) S.renderer.destroy();
    const unit = DB.unitByKey[`${ex.lessonId}/${ex.unitId}`];
    const sk = DB.skillById[ex.skill];
    const isLearn = ex.type === "learn";
    // one quiet line: retry, bonus, skill. The lesson moment (⏱) lives in the feedback explanation.
    const badges = h("div", { class: "ex-badges" },
      isLearn ? h("span", { class: "learn-badge" }, "מושג חדש ✨") : null,
      item.attempt > 1 ? h("span", { class: "retry-badge" }, "עוד הזדמנות 🔁") : null,
      ex.bonus ? h("span", { class: "tag tag-bonus" }, "בונוס") : null,
      sk && !isLearn ? h("span", { class: "badge-skill", html: richText(sk.title_he) }) : null);
    const q = h("h1", { class: "ex-q", html: richText(ex.question_he), tabindex: "-1" });
    const R = RENDERERS[rendererOf(ex)];
    S.renderer = R.mount(ex, {
      setReady: (v) => { checkBtn.disabled = !v; },
      submit: () => doCheck(),
      unit,
    });
    scroll.innerHTML = "";
    scroll.scrollTop = 0;
    scroll.style.paddingBottom = "";
    const wrap = h("div", { class: `ses-ex r-${rendererOf(ex)}` }, badges, q, S.renderer.el);
    scroll.appendChild(wrap);
    foot.hidden = !!S.renderer.immediate;
    checkBtn.textContent = isLearn ? "הבנתי, בוא נתרגל" : "בדוק";
    checkBtn.disabled = !isLearn;
    paintBar();
    requestAnimationFrame(() => { try { q.focus({ preventScroll: true }); } catch (e) { /* ignore */ } });
  }

  function learnNext() {
    if (S.phase !== "answer") return;
    S.done += 1;
    S.pos += 1;
    show();
  }

  function doCheck() {
    if (S.phase !== "answer") return;
    const item = S.queue[S.pos];
    if (item.ex.type === "learn") { learnNext(); return; }
    const r = S.renderer.check();
    if (!r) return;
    S.phase = "feedback";
    S.result = r;
    const ex = item.ex;
    const first = item.attempt === 1;
    let gained = 0;
    if (r.correct) {
      gained = first ? 10 : 5;
      if (first) S.firstTry.add(ex.uid);
      S.combo += 1;
      audio.sfx("correct");
    } else {
      S.combo = 0;
      S.missed.add(ex.uid);
      audio.sfx("wrong");
      if (store.settings().haptics && navigator.vibrate) { try { navigator.vibrate(15); } catch (e) { /* ignore */ } }
      if (first) S.queue.push({ ex, attempt: 2 });
      const chosen = scroll.querySelector(".opt.bad, .slot.bad, .tile.bad");
      if (chosen && !reducedMotion()) chosen.classList.add("shake");
    }
    if (r.correct && !reducedMotion()) {
      const c = scroll.querySelector(".opt.ok.selected, .opt.ok");
      if (c) c.classList.add("pop");
    }
    store.recordAnswer(ex.uid, first, r.correct);
    if (gained) {
      S.xp += gained;
      const res = store.addXP(gained);
      if (res.streakGrew) S.streakGrew = true;
      if (res.goalMet) S.goalMet = true;
    }
    if (S.renderer.afterCheck) S.renderer.afterCheck(r);
    S.done += 1;
    paintBar();
    feedback(ex, r, gained);
  }

  function feedback(ex, r, gained) {
    const unit = DB.unitByKey[`${ex.lessonId}/${ex.unitId}`];
    const title = r.correct ? CORRECT_TITLES[correctTitleIdx++ % CORRECT_TITLES.length] : "לא בדיוק.";
    const explain = h("div", { class: "fbk-explain clamp", html: richText(ex.explain_he || "") });
    const explainHasTs = /⏱/.test(ex.explain_he || "") || !!r.hint;
    const more = h("button", { type: "button", class: "link-btn fbk-more", hidden: true }, "עוד");
    more.addEventListener("click", () => { explain.classList.toggle("clamp"); more.textContent = explain.classList.contains("clamp") ? "עוד" : "פחות"; });
    const cont = h("button", { type: "button", class: "btn btn-primary btn-block", autofocus: true }, "המשך");
    cont.addEventListener("click", next);
    const ask = h("button", { type: "button", class: "btn btn-ghost" }, "שאלה על המושג");
    ask.addEventListener("click", () => openAsk(unit, conceptFor(unit, ex), ex));
    const panel = h("section", { class: `fbk ${r.correct ? "ok" : "bad"}`, "aria-label": r.correct ? "תשובה נכונה" : "תשובה שגויה" },
      h("div", { class: "fbk-top" },
        h("span", { class: "fbk-icon", "aria-hidden": "true" }, iconEl(r.correct ? "check" : "cross", 22)),
        h("h2", { class: "fbk-title" }, title),
        gained ? h("span", { class: "fbk-xp", dir: "ltr" }, `+${gained} XP`) : null),
      !r.correct && r.chosenText ? (r.chosenNode ? h("p", { class: "fbk-chosen" }, "בחרת: ", r.chosenNode) : h("p", { class: "fbk-chosen", html: `בחרת: ${richText(r.chosenText)}` })) : null,
      !r.correct ? (r.answerNode ? h("p", { class: "fbk-answer" }, "התשובה הנכונה: ", r.answerNode) : h("p", { class: "fbk-answer", html: `התשובה הנכונה: ${richText(r.answerText)}` })) : null,
      r.hint ? h("p", { class: "fbk-hint" }, r.hint, " ", h("span", { html: richText("⏱ 33:10") })) : null,
      explain, more,
      r.clipLabels ? h("p", { class: "fbk-heard" }, "שמעת: ", h("bdi", { dir: "ltr", class: "mus-strong" }, r.clipLabels)) : null,
      r.extras || null,
      h("div", { class: "fbk-row" }, ex.source_ts && !explainHasTs ? h("span", { html: richText("⏱ " + ex.source_ts) }) : h("span"), ask),
      cont);
    fbWrap.innerHTML = "";
    fbWrap.appendChild(panel);
    requestAnimationFrame(() => {
      fbWrap.classList.add("open");
      scroll.style.paddingBottom = `${panel.offsetHeight + 8}px`;
      if (explain.scrollHeight > explain.clientHeight + 4) more.hidden = false;
      try { cont.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
    });
    foot.hidden = true;
    announce(`${title} ${!r.correct ? (r.chosenText ? "בחרת: " + r.chosenText + ". " : "") + "התשובה הנכונה: " + r.answerText + "." : ""} ${(ex.explain_he || "").replace(/⏱\s?[\d:–-]+/g, "")}`);
  }

  function next() {
    if (S.phase !== "feedback") return;
    S.pos += 1;
    show();
  }

  function complete() {
    S.phase = "complete";
    if (S.renderer && S.renderer.destroy) S.renderer.destroy();
    const unique = new Set(S.queue.filter((q) => q.ex.type !== "learn").map((q) => q.ex.uid)).size;
    let bonusXp = 10;
    const perfect = S.missed.size === 0 && unique > 0;
    if (perfect) bonusXp += 10;
    const res = store.addXP(bonusXp);
    if (res.streakGrew) S.streakGrew = true;
    if (res.goalMet) S.goalMet = true;
    S.xp += bonusXp;
    if (meta.unitKey && meta.level) store.markLevel(meta.unitKey, meta.level);
    audio.sfx("complete");
    const secs = Math.round((Date.now() - S.start) / 1000);
    const acc = unique ? Math.round((100 * S.firstTry.size) / unique) : 0;
    const streak = store.get().streak.count;
    const tomorrow = dueBy(store.addDays(store.today(), 1));
    const deltas = Object.keys(S.masteryBefore).map((s) => ({ s, a: S.masteryBefore[s], b: skillMastery(s) }))
      .sort((x, y) => (y.b - y.a) - (x.b - x.a)).slice(0, 3);
    foot.hidden = true;
    fbWrap.innerHTML = "";
    fbWrap.classList.remove("open");
    scroll.style.paddingBottom = "";
    bar.firstChild.style.width = "100%";
    combo.hidden = true;
    askBtn.hidden = true;
    const xpEl = h("div", { class: "done-xp", dir: "ltr" }, reducedMotion() ? `+${S.xp} XP` : "+0 XP");
    const again = h("button", { type: "button", class: "btn btn-ghost btn-block" }, "עוד סשן");
    again.addEventListener("click", () => { if (meta.again) proceed(meta.again()); });
    const contBtn = h("button", { type: "button", class: "btn btn-primary btn-block", autofocus: true }, "המשך");
    contBtn.addEventListener("click", () => proceed("#/"));
    const ringsRow = h("div", { class: "done-rings" }, deltas.map((d) => miniRing(DB.skillById[d.s], d.a, d.b)));
    scroll.innerHTML = "";
    scroll.appendChild(h("div", { class: "done" },
      h("div", { class: "done-badge", "aria-hidden": "true" }, perfect ? "🏆" : "🎸"),
      h("h1", { class: "done-title", tabindex: "-1" }, perfect ? "סשן מושלם." : "הסשן הושלם."),
      xpEl,
      h("div", { class: "done-stats" },
        stat("דיוק", `${acc}%`, true), stat("זמן", `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, "0")}`, true), stat("רצף", `🔥 ${streak} ${streak === 1 ? "יום" : "ימים"}`)),
      S.streakGrew ? h("p", { class: "done-streak" }, h("span", { class: "flame", "aria-hidden": "true" }, "🔥"), " הרצף ממשיך!") : null,
      deltas.length ? h("div", { class: "done-sec" }, h("h2", null, "שליטה"), ringsRow) : null,
      h("p", { class: "done-tomorrow" }, tomorrow ? `מחר יחכו לך ${tomorrow} פריטים לחזרה.` : "מחר אין פריטים לחזרה. אפשר להתקדם ביחידה הבאה."),
      h("div", { class: "btn-col" }, contBtn, meta.again ? again : null)));
    if (!reducedMotion()) {
      countUp(xpEl, S.xp, 800);
      confetti(screen);
    }
    announce(`הסשן הושלם. ${S.xp} XP. דיוק ${acc} אחוז.`);
    setTimeout(() => { try { contBtn.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }, 100);
  }

  // daily goal crossed during this session → one celebration screen before leaving
  function proceed(target) {
    if (!S.goalMet || S.goalShown) { go(target); return; }
    S.goalShown = true;
    const st = store.get();
    const xpDay = store.xpToday();
    const streak = st.streak.count;
    const flameNum = h("b", { class: "goal-streak-n", dir: "ltr" }, String(reducedMotion() ? streak : S.streakBefore));
    const cont = h("button", { type: "button", class: "btn btn-primary btn-block" }, "המשך");
    cont.addEventListener("click", () => go(target));
    const big = h("div", { class: "ring-box goal-ring", style: { width: "148px", height: "148px" } }, ring(100, 148, 12, false), h("span", { class: "goal-ring-c", "aria-hidden": "true" }, "🎯"));
    scroll.innerHTML = "";
    scroll.appendChild(h("div", { class: "done goal-done" },
      big,
      h("h1", { class: "done-title", tabindex: "-1" }, "היעד היומי הושלם! 🎯"),
      h("p", { class: "goal-done-sub" }, h("bdi", { dir: "ltr", class: "nb" }, `${xpDay} XP`), ` היום, היעד היה ${st.goal}.`),
      h("div", { class: "goal-streak", role: "img", "aria-label": `רצף: ${streak} ${streak === 1 ? "יום" : "ימים"}` },
        h("span", { class: "flame", "aria-hidden": "true" }, "🔥"), flameNum, h("span", null, streak === 1 ? "יום ברצף" : "ימים ברצף")),
      h("div", { class: "btn-col" }, cont)));
    if (!reducedMotion()) {
      if (streak !== S.streakBefore) setTimeout(() => countUp(flameNum, streak, 700, S.streakBefore, (v) => String(v)), 350);
      confetti(screen);
    }
    announce(`היעד היומי הושלם. רצף של ${streak} ${streak === 1 ? "יום" : "ימים"}.`);
    setTimeout(() => { try { cont.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }, 100);
  }

  function onKey(e) {
    if (anyOpen()) return;
    if (e.target && /INPUT|TEXTAREA|SELECT/.test(e.target.tagName)) return;
    if (e.key === "Escape") { e.preventDefault(); exit(); return; }
    if (S.phase === "answer") {
      if (S.renderer && S.renderer.key && S.renderer.key(e)) { e.preventDefault(); return; }
      if (e.key === "Enter" && !checkBtn.disabled && !foot.hidden) {
        const a = document.activeElement;
        // Enter on a focused control activates it (pick a tile, choose an option); Enter elsewhere checks
        const armed = a && a.classList.contains("selected") && (a.classList.contains("opt") || a.classList.contains("fb-cell"));
        if (a && a !== checkBtn && a.tagName === "BUTTON" && !armed) return;
        e.preventDefault();
        doCheck();
      }
    } else if (S.phase === "feedback") {
      const a = document.activeElement;
      if (e.key === "Enter" && a && a.tagName === "BUTTON" && fbWrap.contains(a) && a.textContent !== "המשך") return;
      if (e.key === "Enter") { e.preventDefault(); next(); }
      if (e.key === " " && S.renderer && S.renderer.player) { e.preventDefault(); S.renderer.player.replay(); }
    }
  }
  document.addEventListener("keydown", onKey);

  active = {
    S,
    destroy() {
      document.removeEventListener("keydown", onKey);
      if (S.renderer && S.renderer.destroy) S.renderer.destroy();
      audio.stopClip();
    },
  };
  if (exercises.length) show();
}

function stat(label, value, ltr = false) {
  return h("div", { class: "stat" }, h("div", { class: "stat-v", dir: ltr ? "ltr" : null }, value), h("div", { class: "stat-l" }, label));
}

export function ring(pct, size = 88, stroke = 6, label = true) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const ns = "http://www.w3.org/2000/svg";
  const svg = document.createElementNS(ns, "svg");
  svg.setAttribute("viewBox", `0 0 ${size} ${size}`);
  svg.setAttribute("width", size);
  svg.setAttribute("height", size);
  svg.setAttribute("class", "ring");
  svg.setAttribute("aria-hidden", "true");
  svg.innerHTML = `<circle cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="var(--track)" stroke-width="${stroke}"/>` +
    `<circle class="ring-fill" cx="${size / 2}" cy="${size / 2}" r="${r}" fill="none" stroke="${ringColor(pct)}" stroke-width="${stroke}" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct / 100)}" transform="rotate(-90 ${size / 2} ${size / 2})"/>`;
  if (!label) return svg;
  return h("div", { class: "ring-box", style: { width: size + "px", height: size + "px" } }, svg, h("span", { class: "ring-pct" }, pct >= 80 ? `${pct}% ✓` : `${pct}%`));
}

function miniRing(sk, a, b) {
  const box = ring(a, 72, 6);
  const fill = box.querySelector(".ring-fill");
  const pctEl = box.querySelector(".ring-pct");
  const r = (72 - 6) / 2, c = 2 * Math.PI * r;
  if (!reducedMotion()) {
    setTimeout(() => {
      fill.style.transition = "stroke-dashoffset 900ms cubic-bezier(.2,.8,.2,1), stroke 900ms";
      fill.setAttribute("stroke-dashoffset", String(c * (1 - b / 100)));
      fill.setAttribute("stroke", ringColor(b));
      countUp(pctEl, b, 900, a, (v) => (v >= 80 ? `${v}% ✓` : `${v}%`));
    }, 400);
  } else {
    fill.setAttribute("stroke-dashoffset", String(c * (1 - b / 100)));
    pctEl.textContent = `${b}%`;
  }
  return h("div", { class: "mini-ring" }, box, h("div", { class: "mini-ring-l", html: sk ? richText(sk.title_he) : "" }), h("div", { class: "mini-ring-d", dir: "ltr" }, b > a ? `+${b - a}%` : "—"));
}

export function countUp(el, to, ms, from = 0, fmt = (v) => `+${v} XP`) {
  const t0 = performance.now();
  const step = (t) => {
    const k = Math.min(1, (t - t0) / ms);
    const v = Math.round(from + (to - from) * (1 - Math.pow(1 - k, 3)));
    el.textContent = fmt(v);
    if (k < 1) requestAnimationFrame(step);
  };
  requestAnimationFrame(step);
}

function confetti(root) {
  const wrap = h("div", { class: "confetti", "aria-hidden": "true" });
  const colors = ["var(--brass)", "var(--gold-hi)", "var(--wood)", "var(--deg-6)", "var(--deg-4)"];
  for (let i = 0; i < 24; i++) {
    const p = h("i");
    p.style.left = `${Math.random() * 100}%`;
    p.style.background = colors[i % colors.length];
    p.style.animationDelay = `${Math.random() * 0.25}s`;
    p.style.setProperty("--dx", `${(Math.random() - 0.5) * 120}px`);
    p.style.setProperty("--rot", `${Math.random() * 720 - 360}deg`);
    wrap.appendChild(p);
  }
  root.appendChild(wrap);
  setTimeout(() => wrap.remove(), 1600);
}

export function toastXP(n, text) { toast(`+${n} XP · ${text}`); }
