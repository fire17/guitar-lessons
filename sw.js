// sw.js: offline support (DESIGN §19).
// SHELL is a content hash of SHELL_FILES. `python3 tools/check.py` fails when it is stale and
// `python3 tools/check.py --fix` rewrites it, so a shell edit can never ship without reaching returning users.
const SHELL = "gl-shell-53dbbae472";
const DATA = "gl-data-v1";
const FONTS = "gl-fonts-v1";
const SHELL_FILES = [
  "./",
  "index.html",
  "manifest.webmanifest",
  "css/tokens.css",
  "css/app.css",
  "js/main.js",
  "js/dom.js",
  "js/router.js",
  "js/store.js",
  "js/data.js",
  "js/theory.js",
  "js/audio.js",
  "js/fretboard.js",
  "js/session.js",
  "js/sheet.js",
  "js/theme.js",
  "js/teacher.js",
  "js/exercises/choice.js",
  "js/exercises/clips.js",
  "js/exercises/order.js",
  "js/exercises/buckets.js",
  "js/exercises/fret.js",
  "js/exercises/learn.js",
  "js/views/path.js",
  "js/views/notes.js",
  "js/views/ask.js",
  "js/views/homework.js",
  "js/views/tools.js",
  "js/views/drill.js",
  "js/views/songbook.js",
  "js/views/me.js",
  "js/views/dev.js",
  "icons/icon.svg",
  "icons/icon-192.png",
  "icons/icon-512.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const shell = await caches.open(SHELL);
    await shell.addAll(SHELL_FILES.map((u) => new Request(u, { cache: "reload" })));
    const data = await caches.open(DATA);
    try {
      const idxRes = await fetch("data/lessons/index.json", { cache: "no-cache" });
      const idx = await idxRes.clone().json();
      await data.put("data/lessons/index.json", idxRes);
      await data.add("data/config.json");
      await Promise.all(idx.lessons.map((l) => data.add("data/lessons/" + l.file)));
    } catch (e) { /* data is retried on fetch */ }
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const keep = [SHELL, DATA, FONTS];
    const names = await caches.keys();
    await Promise.all(names.filter((n) => !keep.includes(n)).map((n) => caches.delete(n)));
    await self.clients.claim();
    // prune lesson files that index.json no longer lists
    try {
      const dc = await caches.open(DATA);
      const idx = await dc.match("data/lessons/index.json");
      if (idx) {
        const files = (await idx.json()).lessons.map((l) => "/data/lessons/" + l.file);
        for (const r of await dc.keys()) {
          const p = new URL(r.url).pathname;
          if (p.includes("/data/lessons/") && !p.endsWith("/index.json") && !files.some((f) => p.endsWith(f))) await dc.delete(r);
        }
      }
    } catch (e) { /* best effort */ }
  })());
});

function timeout(ms) { return new Promise((_, rej) => setTimeout(() => rej(new Error("timeout")), ms)); }

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;
  const url = new URL(req.url);
  // Google Fonts: stale-while-revalidate in their own cache (survives shell updates)
  if (url.hostname === "fonts.googleapis.com" || url.hostname === "fonts.gstatic.com") {
    event.respondWith((async () => {
      const cache = await caches.open(FONTS);
      const hit = await cache.match(req);
      const net = fetch(req).then((res) => { if (res && (res.ok || res.type === "opaque")) cache.put(req, res.clone()); return res; });
      event.waitUntil(net.catch(() => {}));
      return hit || net;
    })());
    return;
  }
  if (url.origin !== self.location.origin) return;
  const scope = new URL(self.registration.scope);
  const rel = url.pathname.startsWith(scope.pathname) ? url.pathname.slice(scope.pathname.length) : url.pathname;
  // data: network-first. A late network answer still refreshes the cache; a cold cache waits for the network.
  if (rel.startsWith("data/")) {
    event.respondWith((async () => {
      const cache = await caches.open(DATA);
      const net = fetch(req, { cache: "no-cache" }).then((r) => { if (r && r.ok) cache.put(req, r.clone()); return r; });
      event.waitUntil(net.catch(() => {}));
      const hit = await cache.match(req, { ignoreSearch: true });
      if (!hit) return net;
      try { return await Promise.race([net, timeout(1500)]); } catch (e) { return hit; }
    })());
    return;
  }
  // shell: cache-first (versioned by the content hash above)
  event.respondWith((async () => {
    const cache = await caches.open(SHELL);
    const hit = await cache.match(req, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const res = await fetch(req);
      if (res && res.ok) cache.put(req, res.clone());
      return res;
    } catch (e) {
      if (req.mode === "navigate") { const idx = await cache.match("index.html"); if (idx) return idx; }
      throw e;
    }
  })());
});
