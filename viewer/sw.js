const CACHE = 'apex-log-insights-v1';
const ASSETS = [
  './index.html',
  './app.js',
  './styles.css',
  './apex-parser-worker.js',
  './modules/normalize-report.js',
  './modules/render-shell.js',
  './modules/render-triage.js',
  './modules/render-execution.js',
  './modules/render-data.js',
  './modules/render-diagnostics.js',
  './modules/render-evidence.js',
  './modules/render-report.js',
  './modules/shared-dom.js',
  './modules/shared-evidence.js',
  './modules/shared-format.js',
  './modules/redact-pii.js',
];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))),
    ),
  );
  self.clients.claim();
});

self.addEventListener('fetch', (e) => {
  e.respondWith(caches.match(e.request, { ignoreSearch: true }).then((r) => r ?? fetch(e.request)));
});
