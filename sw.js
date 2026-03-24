const CACHE_NAME = 'shinshinkai-v1';
const ASSETS = [
  'index.html',
  'manifest.json',
  'sw.js',
  'favicon.svg',
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
        keys
          .filter((key) => key !== CACHE_NAME)
          .map((key) => caches.delete(key))
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
        .catch(() => caches.match('/'))
    );
  }
});
