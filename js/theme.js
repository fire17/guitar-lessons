// theme.js: data-theme on <html> from settings (DESIGN §16.1)
import * as store from "./store.js";

const THEME_COLOR = { light: "#F6EEE2", dark: "#16100B" };

export function applyTheme() {
  const t = store.settings().theme;
  const root = document.documentElement;
  if (t === "light" || t === "dark") root.setAttribute("data-theme", t);
  else root.removeAttribute("data-theme");
  // browser / PWA chrome follows a forced theme too, not only prefers-color-scheme
  document.querySelectorAll('meta[name="theme-color"]').forEach((m) => {
    if (!m.dataset.media) m.dataset.media = m.getAttribute("media") || "";
    if (t === "light" || t === "dark") { m.removeAttribute("media"); m.content = THEME_COLOR[t]; }
    else { if (m.dataset.media) m.setAttribute("media", m.dataset.media); m.content = /dark/.test(m.dataset.media) ? THEME_COLOR.dark : THEME_COLOR.light; }
  });
}
