// Offline-Unterstützung: App-Dateien werden zwischengespeichert.
// Strategie „Netz zuerst, sonst Zwischenspeicher“ – Updates kommen sofort an, offline läuft die App weiter.
const CACHE = 'auto360-v1';
const FILES = [
  './', 'index.html', 'styles.css', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/icon-512.png',
  'js/app.js', 'js/compose.js', 'js/estimate.js', 'js/jpeg.js', 'js/math.js',
  'js/store.js', 'js/viewer.js', 'js/viewer-export.js', 'js/worker.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== location.origin) return;
  e.respondWith(
    fetch(req)
      .then((res) => {
        if (res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      })
      .catch(() => caches.match(req, { ignoreSearch: true }).then((r) => r || caches.match('index.html')))
  );
});
