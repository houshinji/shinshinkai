importScripts('https://storage.googleapis.com/workbox-cdn/releases/6.4.1/workbox-sw.js');

if (workbox) {
    const CACHE_NAME = 'shinshinkai-kashu-v6';

    // 1. インストール時に基本アセットをプリキャッシュ（オフライン起動を保証）
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
    });

    // 2. 音楽ファイル (.mp3) 専用戦略
    // RangeRequestsPlugin により Android/iOS でのキャッシュ再生を正常化
    workbox.routing.registerRoute(
        ({ url }) => url.pathname.endsWith('.mp3'),
        new workbox.strategies.CacheFirst({
            cacheName: 'musics-cache',
            plugins: [
                new workbox.rangeRequests.RangeRequestsPlugin(),
                new workbox.expiration.ExpirationPlugin({
                    maxEntries: 100,
                    maxAgeSeconds: 30 * 24 * 60 * 60, // 30日間保持
                }),
            ],
        })
    );

    // 3. 歌詞ファイルなどの音楽メタデータ
    workbox.routing.registerRoute(
        ({ url }) => url.pathname.includes('/musics/') && !url.pathname.endsWith('.mp3'),
        new workbox.strategies.NetworkFirst({
            cacheName: 'musics-meta-cache'
        })
    );

    // 4. その他の静的ファイル
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
    });
}
