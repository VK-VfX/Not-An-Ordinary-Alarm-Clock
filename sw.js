/* Maps and Cats service worker — offline shell + over-the-air updates.
   Bump VERSION (and APP_VERSION in app.js, version.json) to ship an update. */
const VERSION = '1.0.1';
const CACHE = 'mapsandcats-' + VERSION;
const SHELL = [
  './', 'index.html', 'app.css', 'app.js', 'manifest.webmanifest',
  'favicon-32.png', 'favicon-48.png', 'icon-192.png', 'icon-512.png', 'icon-maskable-512.png', 'icon-monochrome-512.png', 'assets/logo/logo-96.png', 'assets/profile.png',
  'vendor/maplibre/maplibre-gl.js', 'vendor/maplibre/maplibre-gl.css',
  ...['cat-face','cat','grin-cat','grin-smile-cat','smirk-cat','black-cat','kissing-cat','heart-eyes-cat','paws'].map(n => `assets/cats/${n}.svg`),
];

self.addEventListener('install', e => {
  // No skipWaiting here: the page offers "Install & restart" so users aren't interrupted mid-walk.
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => (k.startsWith('mapsandcats-') || k.startsWith('pawmap-')) && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('message', e => { if (e.data === 'SKIP_WAITING') self.skipWaiting(); });

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return; // map tiles & APIs go straight to network
  if (url.pathname.endsWith('/version.json')) return;                  // always fresh
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req)));
});
