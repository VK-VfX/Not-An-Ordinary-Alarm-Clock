/* Pawmap service worker — offline shell + over-the-air updates.
   Bump VERSION (and APP_VERSION in app.js, version.json) to ship an update. */
const VERSION = '1.0.0';
const CACHE = 'pawmap-' + VERSION;
const SHELL = [
  './', 'index.html', 'app.css', 'app.js', 'manifest.webmanifest',
  'icon.svg', 'icon-192.png', 'icon-512.png',
  'vendor/leaflet/leaflet.js', 'vendor/leaflet/leaflet.css',
  'vendor/googlemutant/Leaflet.GoogleMutant.js',
];

self.addEventListener('install', e => {
  // No skipWaiting here: the page offers "Install & restart" so users aren't interrupted mid-walk.
  e.waitUntil(caches.open(CACHE).then(c => c.addAll(SHELL)));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(k => k.startsWith('pawmap-') && k !== CACHE).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('message', e => { if (e.data === 'SKIP_WAITING') self.skipWaiting(); });

self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return; // map tiles & APIs go straight to network
  if (url.pathname.endsWith('/version.json')) return;                  // always fresh
  e.respondWith(caches.match(req, { ignoreSearch: true }).then(hit => hit || fetch(req)));
});
