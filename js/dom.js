// dom.js: h(), $, escape(), richText(), md(), icons (DESIGN §2, §12.2, §12.3, §16.7)

export function h(tag, attrs, ...children) {
  const el = tag === "frag" ? document.createDocumentFragment() : document.createElement(tag);
  if (attrs && (typeof attrs !== "object" || attrs instanceof Node || Array.isArray(attrs))) {
    children.unshift(attrs);
    attrs = null;
  }
  if (attrs) {
    for (const [k, v] of Object.entries(attrs)) {
      if (v == null || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "style" && typeof v === "object") Object.assign(el.style, v);
      else if (k === "html") el.innerHTML = v;
      else if (k === "dataset") Object.assign(el.dataset, v);
      else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2).toLowerCase(), v);
      else if (v === true) el.setAttribute(k, "");
      else el.setAttribute(k, v);
    }
  }
  append(el, children);
  return el;
}

function append(el, children) {
  for (const c of children) {
    if (c == null || c === false || c === true) continue;
    if (Array.isArray(c)) append(el, c);
    else if (c instanceof Node) el.appendChild(c);
    else el.appendChild(document.createTextNode(String(c)));
  }
}

export const $ = (sel, root = document) => root.querySelector(sel);
export const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));

export function escape(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

let CONFIG = { recording: null };
export function setConfig(c) { CONFIG = Object.assign({ recording: null }, c || {}); }

const T_ = "\\d{1,2}:\\d{2}(?::\\d{2})?";
const TS_RE = new RegExp(`⏱\\s?(${T_}(?:\\s?[–-]\\s?${T_})?(?:,\\s?${T_}(?:\\s?[–-]\\s?${T_})?)*)`, "g");
const TS_ONE = new RegExp(`^(${T_})(?:\\s?[–-]\\s?(${T_}))?$`);
// "(⏱ 25:32)" → the chip replaces the parentheses (a chip inside parens wraps as "( ⏱25:32 )")
const TS_PAREN = new RegExp(`\\(\\s*(⏱\\s?${T_}(?:\\s?[–-]\\s?${T_})?(?:,\\s?${T_}(?:\\s?[–-]\\s?${T_})?)*)\\s*\\)`, "g");
// one LTR island per musical run; ',' and '•' are inside so "1, 4, 5" / "C, Am" / "60 • 70" keep their order in RTL
const MUS_RE = /[A-Za-z0-9][A-Za-z0-9#♯♭ø°𝄫𝄪\-–→:/·•+=, ]*[A-Za-z0-9#♯♭ø°𝄫𝄪]|[A-Za-z0-9]/gu;
const DEG_RUN = /\b\d(?:[-–]\d)+\b/g;   // 1-5-6-4: never broken across lines
const TAGS = {
  "שחזור": '<span class="tag tag-recon">שחזור</span>',
  "הערה": '<span class="tag tag-note">💡 הערה</span>',
  "בונוס": '<span class="tag tag-bonus">בונוס</span>',
};

export function hasRecording() { return !!(CONFIG.recording && CONFIG.recording.url); }

export function tsChip(a, b) {
  const label = b ? `${a}–${b}` : a;
  if (hasRecording()) {
    return `<button type="button" class="ts ts-link" dir="ltr" data-seek="${a}" aria-label="נגן מהרגע ${label} בהקלטה">⏱ ${label}</button>`;
  }
  // no recording in the public build: a quiet reference, not a pill that looks tappable
  return `<span class="ts ts-plain" dir="ltr" aria-label="רגע בשיעור: ${label}">⏱ ${label}</span>`;
}

function isolate(raw) {
  let out = "";
  let last = 0;
  MUS_RE.lastIndex = 0;
  let m;
  while ((m = MUS_RE.exec(raw))) {
    out += escape(raw.slice(last, m.index));
    const run = m[0];
    // short runs never wrap (a wrapped LTR island inside RTL reads out of order); ≤22 chars fits a 320px line
    const nb = run.length <= 22;
    const inner = escape(run).replace(DEG_RUN, (d) => `<span class="nb">${d}</span>`);
    out += `<bdi dir="ltr" class="mus${nb ? " nb" : ""}">${inner}</bdi>`;
    last = m.index + m[0].length;
  }
  return out + escape(raw.slice(last));
}

// richText: escape → ts placeholders → musical isolation → ts chips → **bold** → [tags]
export function richText(s) {
  if (s == null) return "";
  const stamps = [];
  const PH = "\uE000";
  const raw = String(s).replace(TS_PAREN, "$1").replace(TS_RE, (_, list) => { stamps.push(list); return PH; });
  let html = isolate(raw);
  let i = 0;
  html = html.replace(/\uE000/g, () => stamps[i++].split(/,\s?/).map((one) => { const m = one.trim().match(TS_ONE); return m ? tsChip(m[1], m[2]) : escape(one); }).join(" "));
  // "(סיכום ⏱ 31:02)": keep a short parenthetical with its chip on one line (no orphan ")" on the next line)
  html = html.replace(/\(([^()<]{0,20})(<span class="ts[^>]*>[^<]*<\/span>)\)/g, '<span class="nb">($1$2)</span>');
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/\[(שחזור|הערה|בונוס)\]/g, (_, t) => TAGS[t]);
  return html;
}

export function rich(tag, s, attrs = {}) {
  return h(tag, Object.assign({}, attrs, { html: richText(s) }));
}

// md(): blank-line paragraphs, ### subheading, - bullets (one nested level), pipe tables, **bold**, tags
export function md(src, opts = {}) {
  if (!src) return "";
  const lines = String(src).replace(/\r/g, "").split("\n");
  let html = "";
  let i = 0;
  const cell = opts.cell || richText;
  while (i < lines.length) {
    const line = lines[i];
    if (!line.trim()) { i++; continue; }
    if (line.startsWith("### ")) { html += `<h4 class="md-h">${richText(line.slice(4))}</h4>`; i++; continue; }
    if (/^\s*\|/.test(line) && i + 1 < lines.length && /^\s*\|?\s*:?-{2,}/.test(lines[i + 1])) {
      const rows = [];
      while (i < lines.length && /^\s*\|/.test(lines[i])) { rows.push(lines[i]); i++; }
      const split = (r) => r.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
      const head = split(rows[0]);
      const body = rows.slice(2).map(split);
      html += `<div class="table-scroll"><table class="md-table"><thead><tr>${head.map((c, j) => `<th scope="col">${cell(c, true, j)}</th>`).join("")}</tr></thead><tbody>${body.map((r) => `<tr>${r.map((c, j) => (j === 0 ? `<th scope="row">${cell(c, false, j)}</th>` : `<td>${cell(c, false, j)}</td>`)).join("")}</tr>`).join("")}</tbody></table></div>`;
      continue;
    }
    if (/^- /.test(line)) {
      html += "<ul class=\"md-list\">";
      while (i < lines.length && (/^- /.test(lines[i]) || /^ {2}- /.test(lines[i]))) {
        let item = richText(lines[i].replace(/^- /, ""));
        i++;
        if (i < lines.length && /^ {2}- /.test(lines[i])) {
          item += "<ul>";
          while (i < lines.length && /^ {2}- /.test(lines[i])) { item += `<li>${richText(lines[i].replace(/^ {2}- /, ""))}</li>`; i++; }
          item += "</ul>";
        }
        html += `<li>${item}</li>`;
      }
      html += "</ul>";
      continue;
    }
    const para = [];
    while (i < lines.length && lines[i].trim() && !/^(- |### |\s*\|)/.test(lines[i])) { para.push(lines[i]); i++; }
    html += `<p>${richText(para.join(" "))}</p>`;
  }
  return html;
}

// musical token wrapper for option/tile text
export function mus(text) {
  return h("bdi", { dir: "ltr", class: "mus-strong" }, String(text));
}

export function plainText(s) {
  return String(s ?? "").replace(/\*\*/g, "").replace(/\[(שחזור|הערה|בונוס)\]/g, "$1");
}

// ---- icons (24px, 2px stroke, currentColor, round caps) ----
const P = {
  path: '<path d="M6 20c0-3 3-4 6-4s6-1 6-4-3-4-6-4-6-1-6-4"/><circle cx="6" cy="20" r="1.6"/><circle cx="6" cy="4" r="1.6"/>',
  book: '<path d="M4 5.5C4 4.7 4.7 4 5.5 4H11v16H5.5A1.5 1.5 0 0 1 4 18.5z"/><path d="M20 5.5c0-.8-.7-1.5-1.5-1.5H13v16h5.5c.8 0 1.5-.7 1.5-1.5z"/>',
  metronome: '<path d="M8.5 3h7l3.5 17H5z"/><path d="M12 15l5-9"/><path d="M8 15h8"/>',
  person: '<circle cx="12" cy="8" r="4"/><path d="M4.5 20c1.2-3.6 4-5 7.5-5s6.3 1.4 7.5 5"/>',
  play: '<path d="M8 5.5v13l11-6.5z" fill="currentColor"/>',
  stop: '<rect x="6.5" y="6.5" width="11" height="11" rx="2" fill="currentColor"/>',
  replay: '<path d="M4 12a8 8 0 1 0 2.6-5.9"/><path d="M4 4v4.5h4.5"/>',
  close: '<path d="M6 6l12 12M18 6L6 18"/>',
  check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
  cross: '<path d="M7 7l10 10M17 7L7 17"/>',
  share: '<circle cx="18" cy="5.5" r="2.5"/><circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="18.5" r="2.5"/><path d="M8.2 10.8l7.6-4M8.2 13.2l7.6 4"/>',
  send: '<path d="M12 19V5M6 11l6-6 6 6"/>',
  lock: '<rect x="5" y="11" width="14" height="9" rx="2"/><path d="M8 11V8a4 4 0 0 1 8 0v3"/>',
  turtle: '<path d="M4 15c0-4 3.5-7 8-7s8 3 8 7z"/><path d="M20 13.5h1.5a1.5 1.5 0 0 0 0-3H20"/><path d="M7 15v3M17 15v3M9 9.5l2 5.5M15 9.5l-2 5.5"/>',
  back: '<path d="M9 5l7 7-7 7"/>',
  plus: '<path d="M12 5v14M5 12h14"/>',
  minus: '<path d="M5 12h14"/>',
  question: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.3a2.5 2.5 0 0 1 4.8 1c0 1.7-2.4 2.2-2.4 3.7"/><circle cx="12" cy="17.2" r=".6" fill="currentColor"/>',
  trash: '<path d="M5 7h14M10 7V5h4v2M7 7l1 13h8l1-13"/>',
  sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
  moon: '<path d="M20 14.5A8 8 0 0 1 9.5 4a8 8 0 1 0 10.5 10.5z"/>',
  guitar: '<path d="M14 10l6-6M18 3l3 3"/><path d="M10.5 9.5a4 4 0 0 0-5.7.3c-1.6 1.7-1.3 3.3-.3 4.3-1.4 1.5-1.2 3.6.3 5s3.5 1.7 5 .3c1 1 2.6 1.3 4.3-.3a4 4 0 0 0 .3-5.7z"/><circle cx="9.5" cy="14.5" r="1.3"/>',
  grid: '<rect x="4" y="4" width="16" height="16" rx="2"/><path d="M4 9.3h16M4 14.6h16M9.3 4v16M14.6 4v16"/>',
  music: '<path d="M9 18V6l10-2v12"/><circle cx="6.5" cy="18" r="2.5"/><circle cx="16.5" cy="16" r="2.5"/>',
  bolt: '<path d="M13 3L5 13.5h6L10 21l8-10.5h-6z"/>',
  songs: '<path d="M5 4h11l3 3v13H5z"/><path d="M8.5 11h7M8.5 14.5h7M8.5 18h4"/>',
  download: '<path d="M12 4v11M7 10.5l5 5 5-5M5 20h14"/>',
  upload: '<path d="M12 20V9M7 13.5l5-5 5 5M5 4h14"/>',
};
export function icon(name, size = 24, cls = "") {
  return `<svg class="ic ${cls}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${P[name] || ""}</svg>`;
}
export function iconEl(name, size = 24, cls = "") {
  const t = document.createElement("template");
  t.innerHTML = icon(name, size, cls);
  return t.content.firstChild;
}

export function announce(text) {
  const live = document.getElementById("live");
  if (!live) return;
  live.textContent = "";
  setTimeout(() => { live.textContent = text; }, 30);
}

export function toast(text, ms = 2600) {
  const root = document.getElementById("toasts");
  if (!root) return;
  const m = String(text).match(/^\+(\d+) XP · (.*)$/);
  const t = m ? h("div", { class: "toast", role: "status" }, h("bdi", { dir: "ltr", class: "nb" }, `+${m[1]} XP`), " · ", m[2])
    : h("div", { class: "toast", role: "status" }, text);
  root.appendChild(t);
  requestAnimationFrame(() => t.classList.add("in"));
  setTimeout(() => { t.classList.remove("in"); setTimeout(() => t.remove(), 300); }, ms);
}

export function shuffle(arr) {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

export const reducedMotion = () => window.matchMedia && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

export function fmtDate(iso) {
  const [y, m, d] = String(iso).split("-").map(Number);
  return `${d}.${m}.${y}`;
}
