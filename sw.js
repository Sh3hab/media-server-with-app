const CACHE_NAME = 'media-server-cache-v2';
const ASSETS_TO_CACHE = [
  '/',
  '/index.html',
  '/script.js',
  '/js/downloadManager.js',
  '/css/font.css',
  '/css/collection.css',
  '/css/history.css',
  '/videojs/video-js.css',
  '/videojs/video.min.js',
  '/fontawesome/fontawesome/css/all.min.css',
  '/assets/logo.png',
  '/assets/logo/small-logo-2.svg',
  '/fontawesome/fontawesome/webfonts/fa-brands-400.woff2',
  '/fontawesome/fontawesome/webfonts/fa-regular-400.woff2',
  '/fontawesome/fontawesome/webfonts/fa-solid-900.woff2',
  '/fontawesome/fontawesome/webfonts/fa-v4compatibility.woff2',
  '/fonts/IBM_Plex_Sans_Arabic/IBMPlexSansArabic-Light.ttf',
  '/fonts/IBM_Plex_Sans_Arabic/IBMPlexSansArabic-Medium.ttf',
  '/fonts/IBM_Plex_Sans_Arabic/IBMPlexSansArabic-SemiBold.ttf',
  '/fonts/IBM_Plex_Sans_Arabic/IBMPlexSansArabic-Bold.ttf'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then((cache) => cache.addAll(ASSETS_TO_CACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((cacheNames) => {
      return Promise.all(
        cacheNames.map((name) => {
          if (name !== CACHE_NAME) {
            return caches.delete(name);
          }
        })
      );
    }).then(() => self.clients.claim())
  );
});


self.addEventListener('fetch', (event) => {
  const url = new URL(event.request.url);

  if (url.pathname.includes('/uploads/episodes/') || url.pathname.includes('/uploads/movies/')) {
    return;
  }

  if (url.pathname.startsWith('/api/')) {
    if (event.request.method !== 'GET') {
      event.respondWith(fetch(event.request));
      return;
    }
    event.respondWith(
      fetch(event.request)
        .then((response) => {
          const resClone = response.clone();
          caches.open(CACHE_NAME).then((cache) => cache.put(event.request, resClone));
          return response;
        })
        .catch(() => caches.match(event.request))
    );
    return;
  }

  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) {
        if (event.request.method === 'GET') {
          fetch(event.request).then((networkResponse) => {
            caches.open(CACHE_NAME).then((cache) => cache.put(event.request, networkResponse));
          }).catch(() => {});
        }
        return cachedResponse;
      }
      return fetch(event.request);
    })
  );
});
