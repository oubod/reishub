const CACHE_NAME = 'resihub-mauritania-v25';
const CACHE_PREFIXES = ['residanat-nktt-', `R${'\u00e9'}siHub-mauritania-`, 'resihub-mauritania-'];
const URLS_TO_CACHE = [
    './',
    './index.html',
    './mauritania-tunis-lite.html',
    './login.html',
    './css/style.css',
    './js/app.js',
    './js/supabase-client.js',
    './js/portal-auth.js',
    '../assets/js/pwa-update.js',
    './manifest.json',
    './favicon.ico',
    './data/lectures.json',
    './images/favicon-16.png',
    './images/favicon-32.png',
    './images/apple-touch-icon.png',
    './images/icon-16.png',
    './images/icon-32.png',
    './images/icon-48.png',
    './images/icon-72.png',
    './images/icon-96.png',
    './images/icon-128.png',
    './images/icon-144.png',
    './images/icon-152.png',
    './images/icon-180.png',
    './images/icon-192.png',
    './images/icon-384.png',
    './images/icon-512.png',
    './images/maskable-192.png',
    './images/maskable-512.png',
    'https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.2/css/all.min.css',
    'https://fonts.googleapis.com/css2?family=Poppins:wght@300;400;500;600;700&display=swap'
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME)
      .then(cache => {
        console.log('Opened cache and caching core assets');
        return cache.addAll(URLS_TO_CACHE);
      })
      .catch(error => {
        console.error('Failed to cache core assets:', error);
      })
  );
});

self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') {
    self.skipWaiting();
  }
});

self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(cacheNames => {
      return Promise.all(
        cacheNames.map(cacheName => {
          if (CACHE_PREFIXES.some(prefix => cacheName.startsWith(prefix)) && cacheName !== CACHE_NAME) {
            console.log('Deleting old cache:', cacheName);
            return caches.delete(cacheName);
          }
        })
      );
    })
  );
  self.clients.claim();
});

self.addEventListener('fetch', event => {
  const url = new URL(event.request.url);

  if (url.pathname.endsWith('.pdf')) {
    event.respondWith(fetch(event.request));
    return;
  }

  event.respondWith(
    caches.match(event.request)
      .then(response => {
        if (response) {
          return response;
        }

        return fetch(event.request);
      }
    )
  );
});
