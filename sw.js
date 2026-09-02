importScripts('https://storage.googleapis.com/workbox-cdn/releases/6.4.1/workbox-sw.js');

if (workbox) {
    // キャッシュ名 (古いキャッシュを破棄するためバージョンを上げました)
    const CACHE_NAME = 'shinshinkai-kashu-v12';

    // インストール時に基本ファイルを強制キャッシュ
    self.addEventListener('install', (event) => {
        event.waitUntil(
            caches.open('static-assets').then((cache) => {
                // 曲リストは意図的に入れない。下の NetworkOnly ルートで扱うため読まれない。
                return cache.addAll([
                    'index.html',
                    'manifest.json',
                    'favicon.svg'
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

    // 2. 曲リストだけは絶対にキャッシュを返さない。
    // NetworkFirst 系はキャッシュから返しても response.ok が true になり、
    // アプリ側からは最新と区別できない。古い一覧を最新として扱ってしまうと、
    // 曲を入れ替えたことが利用者に伝わらないまま固定されてしまう。
    // 取得できなかったときの控えはアプリが localStorage で持っていて、
    // そちらは「前回の一覧」と明示して出すので、黙って古いものを見せることがない。
    workbox.routing.registerRoute(
        ({ url }) => url.pathname.endsWith('/musics/index.html'),
        new workbox.strategies.NetworkOnly()
    );

    // 3. 歌詞ファイルなど
    // 既存曲の歌詞はめったに変わらず、開いた時に待たされる方が体感が悪いので、
    // こちらは 3 秒で見切ってキャッシュを使う。変更は次に開いたときに反映される。
    workbox.routing.registerRoute(
        ({ url }) => url.pathname.includes('/musics/') && !url.pathname.endsWith('.mp3'),
        new workbox.strategies.NetworkFirst({
            cacheName: 'musics-meta-cache',
            networkTimeoutSeconds: 3
        })
    );

    // 4. 基本アセット
    // index.html 自体もここを通る。回線が遅いと応答待ちで真っ白なままになるので、
    // こちらも 3 秒で見切ってキャッシュの画面を先に出す。
    // 古い画面が出ても曲リストは実行時に取り直すので、曲の入れ替えは反映される。
    workbox.routing.registerRoute(
        ({ request }) =>
            ['document', 'style', 'script', 'image'].includes(request.destination) ||
            request.url.includes('manifest.json'),
        new workbox.strategies.NetworkFirst({
            cacheName: 'static-assets',
            networkTimeoutSeconds: 3
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
