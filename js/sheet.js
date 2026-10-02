// sheet.js: bottom sheets / side panel overlays (DESIGN §5 overlays, §13.1, §18 dialogs)
import { h, iconEl } from "./dom.js";

const stack = [];
let skipPops = 0;
let afterPops = [];   // callbacks run once our own history.back() calls have landed

window.addEventListener("popstate", () => {
  if (skipPops > 0) {
    skipPops--;
    if (skipPops === 0 && afterPops.length) { const fs = afterPops; afterPops = []; fs.forEach((f) => f()); }
    return;
  }
  const top = stack[stack.length - 1];
  if (top) teardown(top);
});
window.addEventListener("hashchange", () => { while (stack.length) teardown(stack[stack.length - 1]); });

export function openSheet({ title, subtitle, content, className = "", onClose, side = false, avatar = null, label, noHandle = false, dismissible = true } = {}) {
  const root = document.getElementById("sheets");
  const prevFocus = document.activeElement;
  const scrim = h("div", { class: "scrim" });
  const closeBtn = dismissible ? h("button", { type: "button", class: "icon-btn sheet-close", "aria-label": "סגור" }, iconEl("close")) : null;
  const head = title != null ? h("div", { class: "sheet-head" },
    avatar,
    h("div", { class: "sheet-titles" }, h("h2", { class: "sheet-title", id: "sh-t-" + stack.length }, title), subtitle ? h("p", { class: "sheet-sub" }, subtitle) : null),
    closeBtn) : null;
  const body = h("div", { class: "sheet-body" }, content);
  const panel = h("div", {
    class: `sheet ${side ? "sheet-side" : ""} ${className}`, role: "dialog", "aria-modal": "true",
    "aria-labelledby": title != null ? "sh-t-" + stack.length : null, "aria-label": title == null ? (label || "חלון") : null, tabindex: "-1",
  }, noHandle ? null : h("div", { class: "sheet-handle", "aria-hidden": "true" }), head, body);
  const wrap = h("div", { class: "sheet-wrap" }, scrim, panel);
  root.appendChild(wrap);
  requestAnimationFrame(() => wrap.classList.add("open"));
  const entry = { wrap, panel, onClose, prevFocus, body };
  stack.push(entry);
  try { history.pushState({ sheet: stack.length }, ""); entry.pushed = true; } catch (e) { entry.pushed = false; }
  if (dismissible) scrim.addEventListener("click", () => close(entry));
  if (closeBtn) closeBtn.addEventListener("click", () => close(entry));
  panel.addEventListener("keydown", (e) => {
    if (e.key === "Escape" && dismissible) { e.stopPropagation(); close(entry); }
    if (e.key === "Tab") trap(e, panel);
  });
  setTimeout(() => {
    const f = panel.querySelector("[autofocus]") || panel.querySelector("button:not(.sheet-close), [href], input, select, textarea") || panel;
    try { f.focus({ preventScroll: true }); } catch (e) { /* ignore */ }
  }, 60);
  entry.close = (then) => close(entry, then);
  return entry;
}

function trap(e, panel) {
  const f = Array.from(panel.querySelectorAll("button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])")).filter((x) => !x.disabled && x.offsetParent !== null);
  if (!f.length) return;
  const first = f[0], last = f[f.length - 1];
  if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
  else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
}

function teardown(entry) {
  const i = stack.indexOf(entry);
  if (i < 0) return;
  stack.splice(i, 1);
  entry.wrap.classList.remove("open");
  entry.wrap.classList.add("closing");
  setTimeout(() => entry.wrap.remove(), 220);
  if (entry.onClose) { try { entry.onClose(); } catch (e) { console.error(e); } }
  if (entry.prevFocus && entry.prevFocus.isConnected) { try { entry.prevFocus.focus({ preventScroll: true }); } catch (e) { /* ignore */ } }
}

export function close(entry, then) {
  if (!entry || stack.indexOf(entry) < 0) { if (then) then(); return; }
  const isTop = stack[stack.length - 1] === entry;
  teardown(entry);
  if (isTop && entry.pushed) { skipPops++; if (then) afterPops.push(then); history.back(); }
  else if (then) then();
}

export function closeAll() {
  while (stack.length) close(stack[stack.length - 1]);
}

// close every sheet (unwinding their history entries), then run fn (used before navigating)
export function closeAllThen(fn) {
  const n = stack.filter((e) => e.pushed).length;
  while (stack.length) teardown(stack[stack.length - 1]);
  if (!n) { fn(); return; }
  skipPops += n;
  afterPops.push(fn);
  history.go(-n);
}

export function topSheet() { return stack[stack.length - 1] || null; }
export function anyOpen() { return stack.length > 0; }

export function confirmSheet({ title, text, yes, no, danger = false }) {
  return new Promise((resolve) => {
    let done = false;
    const finish = (v) => { if (done) return; done = true; close(entry, () => resolve(v)); };
    const content = h("div", { class: "confirm" },
      text ? h("p", { class: "confirm-text" }, text) : null,
      h("div", { class: "btn-col" },
        h("button", { type: "button", class: `btn ${danger ? "btn-danger" : "btn-primary"}`, onclick: () => finish(true), autofocus: true }, yes),
        h("button", { type: "button", class: "btn btn-ghost", onclick: () => finish(false) }, no)));
    const entry = openSheet({ title, content, onClose: () => { if (!done) { done = true; resolve(null); } } });   // dismissed: null
  });
}
