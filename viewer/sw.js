const CACHE = "apex-log-insights-v1.2.0";
const ASSETS = [
  "./index.html",
  "./app.js",
  "./register-sw.js",
  "./styles.css",
  "./apex-parser-worker.js",
  "./modules/normalize-report.js",
  "./modules/normalize-helpers.js",
  "./modules/normalize-summary-diagnostics.js",
  "./modules/normalize-execution.js",
  "./modules/normalize-database.js",
  "./modules/normalize-evidence-mapping.js",
  "./modules/compare-reports.js",
  "./modules/investigation-summary.js",
  "./modules/render-shell.js",
  "./modules/render-triage.js",
  "./modules/render-execution.js",
  "./modules/render-data.js",
  "./modules/render-diagnostics.js",
  "./modules/render-evidence.js",
  "./modules/render-report.js",
  "./modules/render-queries.js",
  "./modules/render-limits.js",
  "./modules/load-report.js",
  "./modules/sidebar.js",
  "./modules/shared-dom.js",
  "./modules/shared-evidence.js",
  "./modules/shared-format.js",
  "./modules/redact-pii.js",
];

self.addEventListener("install", (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(ASSETS)));
  self.skipWaiting();
});

self.addEventListener("activate", (e) => {
  e.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)),
        ),
      ),
  );
  self.clients.claim();
});

self.addEventListener("fetch", (e) => {
  if (e.request.method !== "GET") return;
  e.respondWith(
    fetch(e.request)
      .then((response) => {
        if (response.ok && new URL(e.request.url).origin === self.location.origin) {
          const copy = response.clone();
          e.waitUntil(caches.open(CACHE).then((cache) => cache.put(e.request, copy)));
        }
        return response;
      })
      .catch(() => caches.match(e.request, { ignoreSearch: true })),
  );
});
