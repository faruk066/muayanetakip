const CACHE_ADI = "heathack-cache-v1";
const DOSYALAR = [
  "./",
  "./index.html",
  "./manifest.webmanifest",
  "./icons/icon-192.svg",
  "./icons/icon-512.svg",
  "./tessdata/eng.traineddata",
  "./vendor/tesseract/worker.min.js",
  "./vendor/tesseract/tesseract-core-simd-lstm.js",
  "./vendor/tesseract/tesseract-core-simd-lstm.wasm",
  "./vendor/tesseract/tesseract-core-lstm.js",
  "./vendor/tesseract/tesseract-core-lstm.wasm",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(CACHE_ADI).then(async (cache) => {
      for (const url of DOSYALAR) {
        try {
          await cache.add(url);
        } catch {
          // Tek dosya 404 olursa tüm install fail olmasın
        }
      }
    }),
  );
});

self.addEventListener("message", (event) => {
  if (event.data && event.data.type === "SKIP_WAITING") {
    self.skipWaiting();
  }
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((key) => key !== CACHE_ADI).map((key) => caches.delete(key))),
    ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  if (event.request.method !== "GET") return;
  const url = new URL(event.request.url);
  // Sadece aynı origin + http(s) istekleri cache'le
  if (url.origin !== self.location.origin) return;
  if (!url.protocol.startsWith("http")) return;
  // Sayfa geçişlerinde önce ağı dene: çevrimiçiyken her zaman güncel HTML gelsin
  if (event.request.mode === "navigate") {
    event.respondWith(
      fetch(event.request).then((response) => {
        if (response && response.ok) {
          const copy = response.clone();
          caches.open(CACHE_ADI).then((cache) => cache.put(event.request, copy));
        }
        return response;
      }).catch(() => caches.match(event.request).then((cached) => cached || caches.match("./")))
    );
    return;
  }
  event.respondWith(
    caches.match(event.request).then((cached) => {
      if (cached) {
        return cached;
      }
      return fetch(event.request).then((response) => {
        // Hata sayfalarını (404/500) kalıcı cache'leme
        if (!response || !response.ok) return response;
        const copy = response.clone();
        caches.open(CACHE_ADI).then((cache) => cache.put(event.request, copy));
        return response;
      }).catch(() => caches.match("./"));
    })
  );
});
