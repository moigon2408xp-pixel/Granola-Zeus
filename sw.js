const CACHE_NAME = 'zeus-granola-v4';
const ASSETS = [
  './',
  './index.html',
  './styles.css?v=4',
  './app.js?v=4',
  './logo_zeus.jpg',
  './manifest.webmanifest'
];

self.addEventListener('install', (e) => {
  e.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(ASSETS))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) => {
      return Promise.all(
        keys.map((k) => {
          if (k !== CACHE_NAME) return caches.delete(k);
        })
      );
    })
  );
  self.clients.claim();
});

// Soporte para limpieza remota y actualización forzada
self.addEventListener('message', (event) => {
  if (event.data) {
    if (event.data.action === 'skipWaiting') {
      self.skipWaiting();
    }
    if (event.data.action === 'clearCache') {
      caches.keys().then((keys) => Promise.all(keys.map((k) => caches.delete(k))));
    }
  }
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;

  // Red primero para la navegación HTML principal (permite detectar cambios de inmediato)
  if (e.request.mode === 'navigate') {
    e.respondWith(
      fetch(e.request).then((res) => {
        const resClone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(e.request, resClone));
        return res;
      }).catch(() => caches.match(e.request))
    );
    return;
  }

  e.respondWith(
    caches.match(e.request).then((cached) => {
      const networked = fetch(e.request).then((res) => {
        const resClone = res.clone();
        caches.open(CACHE_NAME).then((cache) => cache.put(e.request, resClone));
        return res;
      }).catch(() => cached);
      return cached || networked;
    })
  );
});
