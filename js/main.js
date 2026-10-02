// main.js: boot, shell, routes (DESIGN §2, §5, §6)
import { h, iconEl, setConfig, toast } from "./dom.js";
import { DB, loadAll } from "./data.js";
import * as store from "./store.js";
import * as router from "./router.js";
import * as audio from "./audio.js";
import * as session from "./session.js";
import { applyTheme } from "./theme.js";
import { renderPath } from "./views/path.js";
import { renderNotesList, renderNotes } from "./views/notes.js";
import { renderToolsHub, renderMetronome, renderPlayer, renderExplorer, teardownTools, TOOLS } from "./views/tools.js";
import { renderDrill } from "./views/drill.js";
import { renderSongbook } from "./views/songbook.js";
import { renderMe } from "./views/me.js";
import { renderDev } from "./views/dev.js";

const main = document.getElementById("main");
const topbar = document.getElementById("topbar");
const tabbar = document.getElementById("tabbar");
const banner = document.getElementById("banner");
let chrome = "tabs";
let firstRender = true;   // no programmatic focus on the very first page (nothing to announce yet)
let toolCleanup = [];

function setChrome(mode, opts = {}) {
  chrome = mode;
  document.body.classList.toggle("fullscreen", mode === "full");
  document.body.classList.toggle("plain", mode === "plain");
  topbar.hidden = mode === "full" || mode === "plain";
  tabbar.hidden = mode !== "tabs";
  renderTopbar(opts);
  renderTabbar();
}

function renderTopbar(opts = {}) {
  if (topbar.hidden) return;
  topbar.innerHTML = "";
  const st = store.get();
  const xp = store.xpToday();
  const due = session.dueCount();
  const pct = Math.min(100, Math.round((100 * xp) / st.goal));
  const r = 9, c = 2 * Math.PI * r;
  const mini = `<svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true"><circle cx="12" cy="12" r="${r}" fill="none" stroke="var(--track)" stroke-width="3"/><circle cx="12" cy="12" r="${r}" fill="none" stroke="${pct >= 100 ? "var(--gold-hi)" : "var(--brass-strong)"}" stroke-width="3" stroke-linecap="round" stroke-dasharray="${c}" stroke-dashoffset="${c * (1 - pct / 100)}" transform="rotate(-90 12 12)"/></svg>`;
  const start = opts.back
    ? h("div", { class: "tb-start" },
      h("a", { class: "icon-btn", href: opts.back, "aria-label": "חזרה" }, iconEl("back")),
      h("span", { class: "tb-title tool" }, opts.title || ""))
    : h("a", { class: "tb-start brand", href: "#/", "aria-label": "מספרים על הצוואר, למסלול" },
      h("img", { src: "icons/icon.svg", width: "24", height: "24", alt: "" }),
      h("span", { class: "tb-title" }, "מספרים על הצוואר"));
  const counters = h("div", { class: "tb-counters" },
    h("a", { class: "counter", href: "#/me", "aria-label": `רצף: ${st.streak.count} ימים` }, h("span", { "aria-hidden": "true" }, "🔥"), h("b", null, String(st.streak.count))),
    pct >= 100
      ? h("a", { class: "counter goal-done", href: "#/me", "aria-label": `היעד היומי הושלם: ${xp} XP היום`, html: `${mini}<b class="xp-frac done" aria-hidden="true">✓</b>` })
      : h("a", { class: "counter", href: "#/me", "aria-label": `היום ${xp} מתוך ${st.goal} XP`, html: `${mini}<b class="xp-frac" dir="ltr">${xp}/${st.goal}</b>` }),
    due ? h("a", { class: "counter", href: "#/review", "aria-label": `${due} פריטים לחזרה` }, h("span", { "aria-hidden": "true" }, "🔁"), h("b", null, String(due))) : null);
  topbar.append(start, counters);
}

const TABS = [
  { id: "path", href: "#/", label: "מסלול", icon: "path", match: (p) => p === "/" },
  { id: "notes", href: "#/notes", label: "סיכומים", icon: "book", match: (p) => p.startsWith("/notes") },
  { id: "tools", href: "#/tools", label: "כלים", icon: "metronome", match: (p) => p.startsWith("/tools") },
  { id: "me", href: "#/me", label: "אני", icon: "person", match: (p) => p.startsWith("/me") },
];
function renderTabbar() {
  if (tabbar.hidden) return;
  const p = router.parseHash().path;
  tabbar.innerHTML = "";
  TABS.forEach((t) => {
    const on = t.match(p);
    tabbar.appendChild(h("a", { class: `tab ${on ? "on" : ""}`, href: t.href, "aria-current": on ? "page" : null }, iconEl(t.icon), h("span", null, t.label)));
  });
}

function renderBanner() {
  banner.innerHTML = "";
  if (store.storageOk) return;
  let dismissed = false;
  try { dismissed = sessionStorage.getItem("gl.banner") === "1"; } catch (e) { /* ignore */ }
  if (dismissed || window.__bannerDismissed) return;
  const close = h("button", { type: "button", class: "icon-btn sm", "aria-label": "סגור הודעה" }, iconEl("close", 18));
  close.addEventListener("click", () => { window.__bannerDismissed = true; try { sessionStorage.setItem("gl.banner", "1"); } catch (e) { /* ignore */ } banner.innerHTML = ""; });
  banner.appendChild(h("div", { class: "storage-banner", role: "status" }, h("span", null, "ההתקדמות לא נשמרת בדפדפן הזה (מצב פרטי?). אפשר לגבות ידנית בעמוד \"אני\"."), close));
}

function clear() {
  session.teardown();
  teardownTools();
  toolCleanup.forEach((f) => { try { f(); } catch (e) { /* ignore */ } });
  toolCleanup = [];
  audio.stopClip();
  main.innerHTML = "";
}

function page(fn, mode = "tabs", opts = {}, keepScroll = false) {
  return (...args) => {
    clear();
    setChrome(mode, opts);
    if (!keepScroll) window.scrollTo(0, 0);
    try { fn(...args); }
    catch (e) {
      console.error(e);
      // the #/dev gate and the test harness read window.__errors: a broken view must count
      if (window.__errors) window.__errors.push("render " + location.hash + ": " + String((e && e.message) || e));
      main.appendChild(h("div", { class: "page" }, h("p", null, "משהו השתבש בעמוד הזה."), h("pre", { class: "dev-pre" }, String(e && e.stack || e))));
    }
    // route change: move focus to the new page's heading (session screens manage their own focus)
    if (mode !== "full" && !firstRender) {
      requestAnimationFrame(() => {
        const t = main.querySelector("h1, .page-title") || main;
        if (!t.hasAttribute("tabindex")) t.setAttribute("tabindex", "-1");
        try { t.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
      });
    }
    firstRender = false;
  };
}

function setupRoutes() {
  router.route("/", page(() => renderPath(main)));
  router.route("/notes", page(() => renderNotesList(main)));
  router.route("/notes/:lessonId", page((p) => renderNotes(main, p.lessonId)));
  router.route("/notes/:lessonId/:unitId", page((p) => renderNotes(main, p.lessonId, p.unitId)));
  router.route("/play/:lessonId/:unitId", page((p, q) => {
    const unit = DB.unitByKey[`${p.lessonId}/${p.unitId}`];
    if (!unit) { router.go("#/", true); return; }
    let level = Number(q.level);
    let practice = false;
    if (!(level >= 1 && level <= 3)) {
      level = session.nextLevel(unit);
      if (!level) { level = 3; practice = true; }
    }
    const list = session.buildUnitSession(unit, level);
    session.run(main, list, {
      unitKey: practice ? null : unit.uid,
      level: practice ? null : level,
      again: () => `#/play/${unit.lessonId}/${unit.id}?r=${Date.now().toString(36)}`,
    });
  }, "full"));
  router.route("/review", page(() => {
    const list = session.buildReview();
    if (!list.length) { reviewEmpty(); return; }
    session.run(main, list, { again: () => `#/review?r=${Date.now().toString(36)}` });
  }, "full"));
  router.route("/review/weak", page(() => {
    session.run(main, session.buildWeak(), { again: () => `#/review/weak?r=${Date.now().toString(36)}` });
  }, "full"));
  router.route("/practice/skill/:skillId", page((p) => {
    session.run(main, session.buildSkill(p.skillId), { again: () => `#/practice/skill/${p.skillId}?r=${Date.now().toString(36)}` });
  }, "full"));
  router.route("/tools", page(() => renderToolsHub(main)));
  const toolTitle = (id) => (TOOLS.find((t) => t.id === id) || {}).title;
  router.route("/tools/metronome", page((p, q) => renderMetronome(main, q), "tool", { back: "#/tools", title: toolTitle("metronome") }));
  router.route("/tools/player", page((p, q) => renderPlayer(main, q), "tool", { back: "#/tools", title: toolTitle("player") }));
  router.route("/tools/explorer", page((p, q) => renderExplorer(main, q), "tool", { back: "#/tools", title: toolTitle("explorer") }));
  router.route("/tools/drill", page((p, q) => renderDrill(main, q, toolCleanup), "tool", { back: "#/tools", title: toolTitle("drill") }));
  router.route("/tools/songbook", page((p, q) => renderSongbook(main, q, toolCleanup), "tool", { back: "#/tools", title: toolTitle("songbook") }));
  router.route("/me", page(() => renderMe(main)));
  router.route("/dev", page(() => renderDev(main), "plain"));
  router.fallback(() => router.go("#/", true));
}

function reviewEmpty() {
  const weak = session.buildWeak();
  main.appendChild(h("div", { class: "session" },
    h("header", { class: "ses-head" }, h("a", { class: "icon-btn", href: "#/", "aria-label": "סגור" }, iconEl("close"))),
    h("div", { class: "ses-scroll" }, h("div", { class: "done" },
      h("div", { class: "done-badge", "aria-hidden": "true" }, "🌿"),
      h("h1", { class: "done-title" }, "אין מה לחזור היום. מעולה!"),
      h("p", { class: "muted" }, weak.length ? "אפשר לחזק את הפריטים החלשים ביותר שראית." : "עוד לא תרגלת. התחל ביחידה הראשונה במסלול."),
      h("div", { class: "btn-col" },
        weak.length ? h("a", { class: "btn btn-primary btn-block", href: "#/review/weak" }, "חזרה על נקודות חלשות") : h("a", { class: "btn btn-primary btn-block", href: "#/" }, "למסלול"),
        h("a", { class: "btn btn-ghost btn-block", href: "#/" }, "חזרה למסלול"))))));
}

function registerSW() {
  if (!("serviceWorker" in navigator) || !/^https?:$/.test(location.protocol)) return;
  if (/[?&]nosw=1/.test(location.search)) {
    navigator.serviceWorker.getRegistrations().then((rs) => Promise.all(rs.map((r) => r.unregister()))).then(() => caches && caches.keys().then((ks) => Promise.all(ks.map((k) => caches.delete(k))))).then(() => {
      const u = new URL(location.href); u.searchParams.delete("nosw"); location.replace(u.toString());
    });
    return;
  }
  const hadController = !!navigator.serviceWorker.controller;
  navigator.serviceWorker.addEventListener("controllerchange", () => { if (hadController) toast("גרסה חדשה הותקנה ✓"); });
  window.addEventListener("load", () => { navigator.serviceWorker.register("sw.js").catch((e) => console.warn("sw", e)); });
}

async function boot() {
  store.load();
  applyTheme();
  if (window.matchMedia) window.matchMedia("(prefers-color-scheme: dark)").addEventListener?.("change", applyTheme);
  audio.installUnlock();
  registerSW();
  try {
    await loadAll();
  } catch (e) {
    main.innerHTML = "";
    main.appendChild(h("div", { class: "page" }, h("h1", { class: "page-title" }, "לא הצלחתי לטעון את השיעורים"), h("p", null, String(e)), h("p", { class: "muted" }, "האפליקציה צריכה לרוץ משרת (http), לא מקובץ מקומי.")));
    return;
  }
  setConfig(DB.config);
  setupRoutes();
  renderBanner();
  store.subscribe(() => { if (!topbar.hidden) renderTopbar(lastOpts()); });
  router.start();
}
function lastOpts() {
  const p = router.parseHash().path;
  if (p.startsWith("/tools/")) { const id = p.split("/")[2]; return { back: "#/tools", title: (TOOLS.find((t) => t.id === id) || {}).title }; }
  return {};
}

boot();
window.__gl = { DB, store, session, audio };
