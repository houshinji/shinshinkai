const CACHE_NAME = 'shinshinkai-v1';
const ASSETS = [
  '/shinshinkai/',
  '/shinshinkai/index.html',
  '/shinshinkai/manifest.json',
  '/shinshinkai/sw.js',
  '/shinshinkai/favicon.svg',
  '/shinshinkai/icons/icon-192.png',
  '/shinshinkai/icons/icon-512.png',
  '/shinshinkai/style.css',
  '/shinshinkai/app.js',
  // 必要なら他の静的リソースを追加
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(
        keys.map((key) => {
          if (key !== CACHE_NAME) {
            return caches.delete(key);
          }
        })
      ))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const requestURL = new URL(event.request.url);
  if (requestURL.origin === location.origin) {
    event.respondWith(
      caches.match(event.request)
        .then((cached) => cached || fetch(event.request)
          .then((networkResponse) => {
            if (event.request.method === 'GET' && networkResponse && networkResponse.ok) {
              const responseClone = networkResponse.clone();
              caches.open(CACHE_NAME).then((cache) => cache.put(event.request, responseClone));
            }
            return networkResponse;
          })
        )
        .catch(() => caches.match('/shinshinkai/'))
    );
  }
});
