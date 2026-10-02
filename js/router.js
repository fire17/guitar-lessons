// router.js: hash router (DESIGN §5)
import { anyOpen, closeAllThen } from "./sheet.js";
const routes = [];
let notFound = null;
let current = null;

export function route(pattern, handler) {
  const keys = [];
  const re = new RegExp("^" + pattern.replace(/:[a-zA-Z]+/g, (m) => { keys.push(m.slice(1)); return "([^/]+)"; }) + "/?$");
  routes.push({ re, keys, handler, pattern });
}
export function fallback(handler) { notFound = handler; }

export function parseHash(hash = location.hash) {
  let h = hash.replace(/^#/, "") || "/";
  if (!h.startsWith("/")) h = "/" + h;
  const qi = h.indexOf("?");
  const path = qi >= 0 ? h.slice(0, qi) : h;
  const query = {};
  if (qi >= 0) new URLSearchParams(h.slice(qi + 1)).forEach((v, k) => { query[k] = v; });
  return { path, query };
}

export function resolve() {
  const { path, query } = parseHash();
  for (const r of routes) {
    const m = path.match(r.re);
    if (m) {
      const params = {};
      r.keys.forEach((k, i) => { params[k] = decodeURIComponent(m[i + 1]); });
      current = { path, query, params, pattern: r.pattern };
      return r.handler(params, query);
    }
  }
  if (notFound) return notFound(path);
}

export function go(hash, replace = false) {
  if (!hash.startsWith("#")) hash = "#" + hash;
  if (anyOpen()) { closeAllThen(() => go(hash, replace)); return; }
  if (replace) { history.replaceState(history.state, "", hash); resolve(); }
  else if (location.hash === hash) resolve();
  else location.hash = hash;
}

export function currentRoute() { return current; }

export function start() {
  window.addEventListener("hashchange", resolve);
  resolve();
}
