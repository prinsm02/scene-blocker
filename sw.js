// Offline cache. Bump VERSION after every change so phones pick up the new files.
const VERSION = "scene-blocker-v1";
const FILES = ["./", "index.html", "style.css", "config.js", "sync.js", "devseed.js", "store.js", "parse.js", "assets.js", "app.js", "manifest.webmanifest", "assets/icon.svg", "assets/icon-180.png", "assets/icon-512.png"];
self.addEventListener("install", e => e.waitUntil(caches.open(VERSION).then(c => c.addAll(FILES)).then(() => self.skipWaiting())));
self.addEventListener("activate", e => e.waitUntil(caches.keys().then(k => Promise.all(k.filter(x => x !== VERSION).map(x => caches.delete(x)))).then(() => self.clients.claim())));
self.addEventListener("fetch", e => {
  if (e.request.method !== "GET") return;
  const u = new URL(e.request.url);
  if (u.hostname.includes("firestore") || u.hostname.includes("googleapis")) return; // live data never from cache
  e.respondWith(caches.match(e.request).then(r => r || fetch(e.request).then(res => {
    if (res.ok && (u.origin === location.origin || u.hostname.includes("cdnjs") || u.hostname.includes("gstatic"))) { const cp = res.clone(); caches.open(VERSION).then(c => c.put(e.request, cp)); }
    return res;
  }).catch(() => caches.match("index.html"))));
});
