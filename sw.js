// Garde une copie de l'appli pour qu'elle s'ouvre même sans réseau (les données restent sur GitHub).
const C = "thinklivre-v9";
const FICHIERS = ["./", "index.html", "app.js", "style.css", "manifest.json", "icon-192.png", "icon-180.png", "vendor/tweetnacl.mjs", "vendor/blakejs.mjs"];
self.addEventListener("install", e => { e.waitUntil(caches.open(C).then(c => c.addAll(FICHIERS)).then(() => self.skipWaiting())); });
self.addEventListener("activate", e => { e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== C).map(k => caches.delete(k)))).then(() => self.clients.claim())); });
self.addEventListener("fetch", e => {
  const u = new URL(e.request.url);
  if (e.request.method !== "GET" || u.origin !== location.origin || u.pathname.includes("/v/")) return;   // les vidéos ne passent pas par le cache   // l'API GitHub n'est jamais mise en cache ici
  e.respondWith(fetch(e.request).then(r => { const copie = r.clone(); caches.open(C).then(c => c.put(e.request, copie)); return r; })
    .catch(() => caches.match(e.request, {ignoreSearch: true})));
});
