importScripts('https://storage.googleapis.com/workbox-cdn/releases/6.4.1/workbox-sw.js');

if (workbox) {
    // キャッシュ名 (古いキャッシュを破棄するためバージョンを上げました)
    const CACHE_NAME = 'shinshinkai-kashu-v12';

    // インストール時に基本ファイルを強制キャッシュ
    self.addEventListener('install', (event) => {
        event.waitUntil(
            caches.open('static-assets').then((cache) => {
                return cache.addAll([
                    'index.html',
                    'manifest.json',
                    'favicon.svg',
                    'musics/index.html'
                ]);
            })
        );
        self.skipWaiting();
    });

    // 1. MP3 ファイルの戦略：CacheFirst + RangeRequest
    // これにより、キャッシュからでも「分割読み込み」として正しく再生されます
    workbox.routing.registerRoute(
        ({ url }) => url.pathname.endsWith('.mp3'),
        new workbox.strategies.CacheFirst({
            cacheName: 'musics-cache',
            plugins: [
                new workbox.rangeRequests.RangeRequestsPlugin(),
                new workbox.expiration.ExpirationPlugin({
                    maxEntries: 100,
                    maxAgeSeconds: 30 * 24 * 60 * 60,
                }),
            ],
        })
    );

    // 2. 歌詞ファイルなど
    workbox.routing.registerRoute(
        ({ url }) => url.pathname.includes('/musics/') && !url.pathname.endsWith('.mp3'),
        new workbox.strategies.NetworkFirst({
            cacheName: 'musics-meta-cache'
        })
    );

    // 3. 基本アセット
    workbox.routing.registerRoute(
        ({ request }) => 
            ['document', 'style', 'script', 'image'].includes(request.destination) ||
            request.url.includes('manifest.json'),
        new workbox.strategies.NetworkFirst({
            cacheName: 'static-assets'
        })
    );

    // 古いキャッシュの削除
    self.addEventListener('activate', (event) => {
        event.waitUntil(
            caches.keys().then(keys => Promise.all(
                keys.filter(key => !['musics-cache', 'musics-meta-cache', 'static-assets'].includes(key))
                    .map(key => caches.delete(key))
            ))
        );
        self.clients.claim();
    });
}
