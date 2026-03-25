const CACHE_NAME = 'shinshinkai-kashu-v3';
const BASE_PATH = self.registration.scope;
const MUSIC_INDEX_URL = new URL('musics/index.html', BASE_PATH).toString();

const CORE_ASSETS = [
	new URL('./', BASE_PATH).toString(),
	new URL('index.html', BASE_PATH).toString(),
	new URL('manifest.json', BASE_PATH).toString(),
	new URL('favicon.svg', BASE_PATH).toString(),
	MUSIC_INDEX_URL
];

self.addEventListener('install', (event) => {
	event.waitUntil((async () => {
		const cache = await caches.open(CACHE_NAME);
		await cache.addAll(CORE_ASSETS);
		await self.skipWaiting();
	})());
});

self.addEventListener('activate', (event) => {
	event.waitUntil((async () => {
		const keys = await caches.keys();
		await Promise.all(
			keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
		);
		await self.clients.claim();
	})());
});

self.addEventListener('message', (event) => {
	if (!event.data || event.data.type !== 'SYNC_MUSICS') {
		return;
	}

	event.waitUntil((async () => {
		let result;
		try {
			result = await syncIndex();
		} catch (error) {
			result = {
				ok: false,
				error: error && error.message ? error.message : String(error)
			};
		}

		if (event.ports && event.ports[0]) {
			event.ports[0].postMessage(result);
		}
	})());
});

self.addEventListener('fetch', (event) => {
	const req = event.request;
	if (req.method !== 'GET') {
		return;
	}

	const url = new URL(req.url);
	const scopeUrl = new URL(BASE_PATH);

	if (url.origin !== scopeUrl.origin) {
		return;
	}

	if (req.mode === 'navigate') {
		event.respondWith(networkFirst(req));
		return;
	}

	if (isMusicAsset(url)) {
		event.respondWith(cacheFirst(req));
		return;
	}

	event.respondWith(staleWhileRevalidate(req));
});

function isMusicAsset(url) {
	const musicBase = new URL('musics/', BASE_PATH);
	return url.href.startsWith(musicBase.href);
}

async function networkFirst(req) {
	const cache = await caches.open(CACHE_NAME);

	try {
		const res = await fetch(req, { cache: 'no-cache' });
		if (res && res.ok) {
			await cache.put(req, res.clone());
		}
		return res;
	} catch {
		const cached = await cache.match(req);
		if (cached) {
			return cached;
		}
		return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
	}
}

async function cacheFirst(req) {
	const cache = await caches.open(CACHE_NAME);
	const cached = await cache.match(req);

	if (cached) {
		return cached;
	}

	try {
		const res = await fetch(req);
		if (res && res.ok) {
			await cache.put(req, res.clone());
		}
		return res;
	} catch {
		return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
	}
}

async function staleWhileRevalidate(req) {
	const cache = await caches.open(CACHE_NAME);
	const cached = await cache.match(req);

	const networkPromise = fetch(req, { cache: 'no-cache' })
		.then(async (res) => {
			if (res && res.ok) {
				await cache.put(req, res.clone());
			}
			return res;
		})
		.catch(() => null);

	if (cached) {
		return cached;
	}

	const networkResponse = await networkPromise;
	if (networkResponse) {
		return networkResponse;
	}

	return new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
}

function parseSongList(text) {
	return text
		.split(/\r?\n/)
		.map((line) => line.trim())
		.filter(Boolean);
}

function musicTextUrl(title) {
	return new URL(`musics/${encodeURIComponent(title)}.txt`, BASE_PATH).toString();
}

function musicMp3Url(title) {
	return new URL(`musics/${encodeURIComponent(title)}.mp3`, BASE_PATH).toString();
}

async function syncIndex() {
	const cache = await caches.open(CACHE_NAME);

	const oldRes = await cache.match(MUSIC_INDEX_URL);
	const oldTitles = oldRes ? parseSongList(await oldRes.text()) : [];

	let newRes;
	try {
		newRes = await fetch(MUSIC_INDEX_URL, { cache: 'no-cache' });
	} catch {
		return { ok: false, error: 'Network error' };
	}

	if (!newRes.ok) {
		return { ok: false, error: `HTTP ${newRes.status}` };
	}

	const newText = await newRes.clone().text();
	const newTitles = parseSongList(newText);

	await cache.put(MUSIC_INDEX_URL, newRes.clone());

	const newSet = new Set(newTitles);
	const removed = oldTitles.filter((title) => !newSet.has(title));

	for (const title of removed) {
		await cache.delete(musicTextUrl(title));
		await cache.delete(musicMp3Url(title));
	}

	return {
		ok: true,
		removed
	};
}
