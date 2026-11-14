const CACHE_NAME = 'forone-stock-v11';
const APP_SHELL = [
  './', './index.html', './styles.css', './app.js', './visual-recognition.js',
  './manifest.json', './manus-routes.json', './vendor/html5-qrcode.min.js', './vendor/xlsx.full.min.js'
];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(caches.keys().then((keys) => Promise.all(
    keys.filter((key) => key !== CACHE_NAME).map((key) => caches.delete(key))
  )).then(() => self.clients.claim()));
});

self.addEventListener('fetch', (event) => {
  if (event.request.method !== 'GET') return;
  const url = new URL(event.request.url);
  if (url.origin !== self.location.origin) return;
  const isNavigation = event.request.mode === 'navigate' || event.request.destination === 'document';
  event.respondWith(
    caches.match(event.request).then((cached) => cached || fetch(event.request).then((response) => {
      if (response.ok) caches.open(CACHE_NAME).then((cache) => cache.put(event.request, response.clone()));
      return response;
    }).catch(() => (isNavigation ? caches.match('./index.html') : Response.error())))
  );
});
