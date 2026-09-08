/**
 * Service-worker registration for the standalone viewer.
 *
 * Kept in its own file rather than inline in index.html: the CLI serves the
 * viewer under `script-src 'self'`, which blocks inline scripts, so an inline
 * registration never ran. The extension does not load this file — extension
 * pages have no service worker.
 */
if ("serviceWorker" in navigator) {
  navigator.serviceWorker.register("./sw.js").catch(() => {
    /* Offline caching is an enhancement; the viewer works without it. */
  });
}
