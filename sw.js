const CACHE_VERSION = "RésiHub-pwa-v22";
const APP_SHELL_CACHE = `${CACHE_VERSION}-shell`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

const APP_SHELL = [
  "./",
  "./index.html",
  "./tunis.html",
  "./login-tunis.html",
  "./auth-tunis.js",
  "./manifest.webmanifest",
  "./logo.png",
  "./favicon.ico",
  "./assets/icons/favicon-16.png",
  "./assets/icons/favicon-32.png",
  "./assets/icons/apple-touch-icon.png",
  "./assets/icons/icon-192.png",
  "./assets/icons/icon-512.png",
  "./assets/icons/maskable-192.png",
  "./assets/icons/maskable-512.png",
  "./data/lectures.json",
  "./data/quiz-bank.json",
  "./data/series-cycle-ecn-2025.json",
  "./exams/examens.json",
  "./clinical-cases/cas-cliniques.json",
  "./residanat-mauritania/index.html",
  "./residanat-mauritania/mauritania-tunis-lite.html",
  "./residanat-mauritania/manifest.json",
  "./residanat-mauritania/favicon.ico",
  "./residanat-mauritania/css/style.css",
  "./residanat-mauritania/js/app.js",
  "./residanat-mauritania/js/supabase-client.js",
  "./residanat-mauritania/js/portal-auth.js",
  "./residanat-mauritania/js/vendors/jspdf.umd.min.js",
  "./residanat-mauritania/js/vendors/jspdf.plugin.autotable.min.js",
  "./residanat-mauritania/data/lectures.json",
  "./residanat-mauritania/images/icon-192.png",
  "./residanat-mauritania/images/icon-512.png"
];

async function quizUrlsFromLectures() {
  try {
    const response = await fetch("./data/lectures.json", { cache: "no-store" });
    if (!response.ok) return [];
    const text = await response.text();
    const data = JSON.parse(text.replace(/^\uFEFF/, ""));
    return (data.lectures || [])
      .map((lecture) => lecture.quiz)
      .filter(Boolean)
      .map((path) => `./${path}`);
  } catch {
    return [];
  }
}

self.addEventListener("install", (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(APP_SHELL_CACHE);
    const quizUrls = await quizUrlsFromLectures();
    await cache.addAll([...APP_SHELL, ...quizUrls]);
    await self.skipWaiting();
  })());
});

self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    const names = await caches.keys();
    await Promise.all(
      names
        .filter((name) => name.startsWith("residanat-pwa-") && ![APP_SHELL_CACHE, RUNTIME_CACHE].includes(name))
        .map((name) => caches.delete(name))
    );
    await self.clients.claim();
  })());
});

async function cacheFirst(request) {
  const cached = await caches.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok) {
    const cache = await caches.open(RUNTIME_CACHE);
    cache.put(request, response.clone());
  }
  return response;
}

async function networkFirst(request) {
  try {
    const response = await fetch(request);
    if (response.ok) {
      const cache = await caches.open(APP_SHELL_CACHE);
      cache.put(request, response.clone());
    }
    return response;
  } catch {
    const cached = await caches.match(request);
    if (cached) return cached;
    throw new Error("Offline and no cached response.");
  }
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  const cacheableExternalHosts = new Set([
    "cdn.tailwindcss.com",
    "cdnjs.cloudflare.com",
    "fonts.googleapis.com",
    "fonts.gstatic.com",
    "cdn.jsdelivr.net"
  ]);

  if (url.origin !== self.location.origin) {
    if (cacheableExternalHosts.has(url.hostname)) {
      event.respondWith(cacheFirst(request));
    }
    return;
  }

  if (url.pathname.toLowerCase().endsWith(".pdf")) {
    event.respondWith(cacheFirst(request));
    return;
  }

  if (request.mode === "navigate" || url.pathname.endsWith("/") || url.pathname.endsWith(".html")) {
    event.respondWith(networkFirst(request));
    return;
  }

  if (url.pathname.endsWith(".json")) {
    event.respondWith(networkFirst(request));
    return;
  }

  event.respondWith(cacheFirst(request));
});
