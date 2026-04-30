const CACHE_NAME = 'mundial-26-cache-v7';
const urlsToCache = [
  './',
  './index.html',
  './register.html',
  './css/styles.css',
  './css/register.css',
  './js/app.js',
  './js/register.js',
  './js/config/firebaseConfig.js',
  './js/data/albumData.js',
  './js/features/pdfExport.js',
  './js/services/albumService.js',
  './manifest.json',
  './assets/images/logo26.png',
  './assets/images/icon.png'
];

self.addEventListener('install', event => {
  self.skipWaiting(); // Force activate new worker
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => cache.addAll(urlsToCache))
  );
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (cacheName !== CACHE_NAME) {
            return caches.delete(cacheName); // Clean old caching
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});

// Network First strategy (Always fetches from network if available)
self.addEventListener('fetch', event => {
  event.respondWith(
    fetch(event.request).then(response => {
        // Refresh cache with new version if it succeeded
        return caches.open(CACHE_NAME).then(cache => {
             cache.put(event.request, response.clone());
             return response;
        });
    }).catch(() => {
        // Only fallback to cache if completely offline
        return caches.match(event.request);
    })
  );
});
