/* Maps and Cats — maps with no sign-up. MapLibre + OpenFreeMap, Photon/Nominatim search, OSRM routing.
   Google is used for search suggestions only, and only if the user pastes their own key. */
(() => {
'use strict';

const APP_VERSION = '1.0.1';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const KL = [3.139, 101.687]; // [lat, lon] fallback view until we get a fix

/* ================= state ================= */
const KEY = 'mapsandcats.v1', RKEY = 'mapsandcats.routes';
const S = Object.assign({
  theme: 'dark', traffic: false, trafficProv: 'tomtom', trafficKey: '', gkey: '', weight: 65, sim: false, xp: 0, caught: 0, avoidHw: false,
  voice: { on: true, name: '' },
  servers: { photon: '', nominatim: '', osrm: '', traffic: '' },
  saved: { home: null, work: null, favs: [] }, recents: [], trips: [], country: null,
}, (() => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } })());
S.voice = Object.assign({ on: true, name: '' }, S.voice);
S.servers = Object.assign({ photon: '', nominatim: '', osrm: '', traffic: '' }, S.servers);
S.saved = Object.assign({ home: null, work: null, favs: [] }, S.saved);
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch {} };

let me = null;           // {lat, lon, acc, ts}
let following = false;
const session = { dist: 0, cats: 0, xpRem: 0, lastSlow: 0, anchor: null };

/* ================= helpers ================= */
const R = 6371000, rad = d => d * Math.PI / 180, deg = r => r * 180 / Math.PI;
function dist(a, b) { // haversine, a/b = [lat, lon]
  const dLat = rad(b[0] - a[0]), dLon = rad(b[1] - a[1]);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[0])) * Math.cos(rad(b[0])) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function offset(p, meters, bearingRad) {
  const d = meters / R, lat1 = rad(p[0]), lon1 = rad(p[1]);
  const lat2 = Math.asin(Math.sin(lat1) * Math.cos(d) + Math.cos(lat1) * Math.sin(d) * Math.cos(bearingRad));
  const lon2 = lon1 + Math.atan2(Math.sin(bearingRad) * Math.sin(d) * Math.cos(lat1), Math.cos(d) - Math.sin(lat1) * Math.sin(lat2));
  return [deg(lat2), deg(lon2)];
}
// distance from point to segment, in metres (local equirectangular projection — fine at street scale)
function distToSeg(p, a, b) {
  const k = Math.cos(rad(p[0])) * 111320, m = 110540;
  const px = (p[1] - a[1]) * k, py = (p[0] - a[0]) * m, bx = (b[1] - a[1]) * k, by = (b[0] - a[0]) * m;
  const L = bx * bx + by * by, t = L ? Math.max(0, Math.min(1, (px * bx + py * by) / L)) : 0;
  return Math.hypot(px - t * bx, py - t * by);
}
const fmtDist = m => m < 1000 ? `${Math.round(m / 10) * 10 || Math.round(m)} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
const fmtTime = s => { const m = Math.max(1, Math.round(s / 60)); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; };
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pick = a => a[Math.floor(Math.random() * a.length)];
const pretty = s => String(s || '').replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());
const getAccent = () => getComputedStyle(document.body).getPropertyValue('--accent').trim() || '#3df5d0';

let toastT;
function toast(msg, ms = 1900) {
  const t = $('#toast'); t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms);
}
// Haptics: Capacitor plugin when wrapped by Capacitor, else the Vibration API; silently no-ops otherwise.
function haptic(ms = 25) {
  try {
    const h = window.Capacitor?.Plugins?.Haptics;
    if (h?.vibrate) h.vibrate({ duration: ms }); else navigator.vibrate?.(ms);
  } catch {}
}

/* ================= map (MapLibre + OpenFreeMap) ================= */
const styleCache = {};
const FALLBACK_STYLE = dark => ({ version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': dark ? '#000' : '#f2f3f0' } }] });
const POI_GROUPS = {
  food: ['restaurant', 'fast_food', 'food_court', 'bar', 'pub', 'ice_cream', 'biergarten'],
  coffee: ['cafe', 'bakery'],
  park: ['park', 'garden', 'playground', 'nature_reserve', 'dog_park'],
  sight: ['attraction', 'museum', 'zoo', 'art_gallery', 'gallery', 'place_of_worship', 'castle', 'monument', 'viewpoint', 'theatre', 'cinema', 'library', 'aquarium', 'theme_park'],
  shop: ['shop', 'grocery', 'supermarket', 'convenience', 'clothing_store', 'department_store', 'mall', 'bookstore', 'florist', 'butcher'],
};
const POI_COLOR = { food: '#ffb84d', coffee: '#d49a6a', park: '#4ade80', sight: '#c084fc', shop: '#38bdf8' };
const catOfClass = c => Object.keys(POI_GROUPS).find(k => POI_GROUPS[k].includes(c)) || null;

function darkify(s) {
  const byId = {
    water: 'rgb(5,9,15)', waterway: 'rgb(5,9,15)', landuse_park: 'rgb(6,13,9)', landcover_wood: 'rgb(6,13,9)',
    landuse_residential: '#030303', building: 'rgb(12,12,14)', landcover_ice_shelf: '#000', landcover_glacier: '#000',
  };
  for (const l of s.layers) {
    if (l.type === 'background') l.paint['background-color'] = '#000';
    else if (byId[l.id]) l.paint[l.type === 'fill' ? 'fill-color' : 'line-color'] = byId[l.id];
    else if (l.type === 'symbol' && l.paint?.['text-color']) { l.paint['text-color'] = l.id.startsWith('place') ? '#a8a8ad' : '#7d7d85'; l.paint['text-halo-color'] = '#000'; }
  }
  return s;
}
function addPoiLayers(s, dark) {
  const font = s.layers.find(l => l.layout?.['text-font'])?.layout['text-font'] || ['Noto Sans Regular'];
  const colorExpr = ['match', ['get', 'class']];
  for (const g of Object.keys(POI_GROUPS)) colorExpr.push(POI_GROUPS[g], POI_COLOR[g]);
  colorExpr.push('#9ca3af');
  s.layers.push(
    { id: 'poi-dots', type: 'circle', source: 'openmaptiles', 'source-layer': 'poi', minzoom: 14.5, filter: ['has', 'name'],
      paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 14.5, 2.5, 17, 4.5, 19, 7], 'circle-opacity': .9, 'circle-color': colorExpr, 'circle-stroke-width': 1, 'circle-stroke-color': dark ? '#000' : '#fff' } },
    { id: 'poi-labels', type: 'symbol', source: 'openmaptiles', 'source-layer': 'poi', minzoom: 16, filter: ['has', 'name'],
      layout: { 'text-field': ['get', 'name'], 'text-font': font, 'text-size': 11, 'text-offset': [0, 1], 'text-anchor': 'top', 'text-optional': true, 'text-max-width': 7 },
      paint: { 'text-color': dark ? '#b5b5bb' : '#444', 'text-halo-color': dark ? '#000' : '#fff', 'text-halo-width': 1.2 } });
  return s;
}
async function buildStyle() {
  const dark = S.theme !== 'light', name = dark ? 'dark' : 'positron';
  try {
    if (!styleCache[name]) { const r = await fetch(`https://tiles.openfreemap.org/styles/${name}`); if (!r.ok) throw 0; styleCache[name] = await r.json(); }
    const s = JSON.parse(JSON.stringify(styleCache[name]));
    return addPoiLayers(dark ? darkify(s) : s, dark);
  } catch { toast('Map tiles need an internet connection'); return FALLBACK_STYLE(dark); }
}

let map = null, mapStyleKind = null;
const emptyFC = { type: 'FeatureCollection', features: [] };
function onStyleLoad() {
  map.addSource('routes', { type: 'geojson', data: nav.fc || emptyFC });
  const before = map.getLayer('poi-dots') ? 'poi-dots' : undefined, acc = getAccent();
  map.addLayer({ id: 'route-alt', type: 'line', source: 'routes', filter: ['==', ['get', 'sel'], 0], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': '#7b8190', 'line-width': 5, 'line-opacity': .85 } }, before);
  map.addLayer({ id: 'route-glow', type: 'line', source: 'routes', filter: ['==', ['get', 'sel'], 1], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': acc, 'line-width': 14, 'line-opacity': .25, 'line-blur': 3 } }, before);
  map.addLayer({ id: 'route-main', type: 'line', source: 'routes', filter: ['==', ['get', 'sel'], 1], layout: { 'line-cap': 'round', 'line-join': 'round' }, paint: { 'line-color': acc, 'line-width': 6 } }, before);
  applyTraffic();
}
// Traffic: no free keyless source exists, so Maps and Cats supports TomTom's free-tier flow tiles (your own key) or any XYZ tile URL.
function trafficTpl() {
  if ((S.trafficProv || 'tomtom') === 'tomtom') return S.trafficKey ? `https://api.tomtom.com/traffic/map/4/tile/flow/relative/{z}/{x}/{y}.png?key=${encodeURIComponent(S.trafficKey)}&tileSize=256` : '';
  return (S.servers.traffic || '').trim();
}
function trafficOK() { const t = trafficTpl(); return ['{z}', '{x}', '{y}'].every(k => t.includes(k)); }
function applyTraffic() {
  if (!map?.isStyleLoaded()) return;
  const want = S.traffic && S.theme !== 'quest' && trafficOK(); syncTrafficBtn();
  if (map.getLayer('traffic')) map.removeLayer('traffic');
  if (map.getSource('traffic')) map.removeSource('traffic');
  if (want) {
    map.addSource('traffic', { type: 'raster', tiles: [trafficTpl()], tileSize: 256 });
    map.addLayer({ id: 'traffic', type: 'raster', source: 'traffic', paint: { 'raster-opacity': .85 } }, map.getLayer('route-alt') ? 'route-alt' : undefined);
  }
}
async function reloadStyle() {
  const kind = S.theme === 'light' ? 'light' : 'dark';
  if (kind === mapStyleKind) { recolorRoute(); applyTraffic(); return; }
  mapStyleKind = kind; map.setStyle(await buildStyle());
}
function recolorRoute() {
  const a = getAccent();
  for (const id of ['route-glow', 'route-main']) if (map.getLayer(id)) map.setPaintProperty(id, 'line-color', a);
}
async function initMap() {
  mapStyleKind = S.theme === 'light' ? 'light' : 'dark';
  const style = await buildStyle();
  map = new maplibregl.Map({ container: 'map', style, center: [KL[1], KL[0]], zoom: 13, attributionControl: false, dragRotate: false, pitchWithRotate: false, fadeDuration: 100 });
  map.touchZoomRotate.disableRotation();
  map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-right');
  map.on('style.load', onStyleLoad);
  map.on('dragstart', () => { following = false; $('#locateBtn').classList.remove('on'); });
  map.on('move', updateScale);
  map.on('moveend', () => { updateClusters(); });
  map.on('idle', () => { updateClusters(); maybeNearbyFromTiles(); });
  map.on('click', onMapClick);
  setupLongPress();
  updateScale();
}

/* --- scale bar: meters-per-pixel from Web Mercator at current zoom/latitude --- */
function updateScale() {
  const z = map.getZoom(), lat = map.getCenter().lat;
  const mpp = 78271.516964 * Math.cos(rad(lat)) / 2 ** z; // MapLibre uses 512px tiles
  const target = 90 * mpp, nice = [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10000, 20000, 50000, 100000, 200000, 500000, 1e6, 2e6];
  let len = nice[0]; for (const n of nice) if (n <= target) len = n;
  $('#scale i').style.width = Math.max(10, len / mpp) + 'px';
  $('#scale span').textContent = len >= 1000 ? `${len / 1000} km` : `${len} m`;
}

/* --- long-press to drop a pin (MapLibre has no native touch long-press) --- */
let lpFired = 0;
function setupLongPress() {
  const el = map.getCanvasContainer(); let t = null, sx = 0, sy = 0; const down = new Set();
  const cancel = () => { clearTimeout(t); t = null; };
  el.addEventListener('pointerdown', e => {
    down.add(e.pointerId); if (down.size > 1) return cancel();
    sx = e.clientX; sy = e.clientY;
    t = setTimeout(() => {
      t = null; lpFired = Date.now(); haptic(35);
      const r = el.getBoundingClientRect(), ll = map.unproject([sx - r.left, sy - r.top]);
      dropPin(ll.lat, ll.lng);
    }, 550);
  });
  el.addEventListener('pointermove', e => { if (t && Math.hypot(e.clientX - sx, e.clientY - sy) > 10) cancel(); });
  for (const ev of ['pointerup', 'pointercancel']) el.addEventListener(ev, e => { down.delete(e.pointerId); cancel(); });
}
async function dropPin(lat, lon) {
  const place = { name: 'Dropped pin', sub: `${lat.toFixed(5)}, ${lon.toFixed(5)}`, lat, lon };
  selectPlace(place, { quiet: true });
  try {
    const r = await fetch(`${SV().nominatim}/reverse?format=jsonv2&lat=${lat}&lon=${lon}&zoom=18`);
    const j = await r.json(); if (j.display_name && nav.dest === place) {
      const parts = j.display_name.split(', '); place.name = j.name || parts[0]; place.sub = parts.slice(1, 4).join(', ');
      $('#destName').textContent = place.name; $('#destSub').textContent = place.sub;
    }
  } catch {}
}

/* --- map taps: POIs, alternative routes --- */
function onMapClick(e) {
  if (Date.now() - lpFired < 600) return;
  $('#results').hidden = true;
  if (map.getLayer('route-alt')) {
    const f = map.queryRenderedFeatures([[e.point.x - 8, e.point.y - 8], [e.point.x + 8, e.point.y + 8]], { layers: ['route-alt'] })[0];
    if (f) return selectAlt(f.properties.i);
  }
  if (map.getLayer('poi-dots')) {
    const f = map.queryRenderedFeatures([[e.point.x - 10, e.point.y - 10], [e.point.x + 10, e.point.y + 10]], { layers: ['poi-dots'] })[0];
    if (f && f.properties.name) { const [lon, lat] = f.geometry.coordinates; return selectPlace({ name: f.properties.name, sub: pretty(f.properties.subclass || f.properties.class), lat, lon }, { quiet: true }); }
  }
  if (!nav.active) $('#sheet').classList.add('collapsed');
}

/* --- POI clustering: below z14.5, bin viewport POIs into count bubbles --- */
let clusterMarkers = [], clusterSig = '';
function updateClusters() {
  const z = map.getZoom();
  const sig = `${z.toFixed(1)}|${map.getCenter().lng.toFixed(3)}|${map.getCenter().lat.toFixed(3)}|${mapStyleKind}`;
  const sig2 = sig + (nav.dest ? '|route' : '');
  if (sig2 === clusterSig) return; clusterSig = sig2;
  clusterMarkers.forEach(m => m.remove()); clusterMarkers = [];
  if (nav.dest) return; // keep the route readable: no bubbles while a route is open
  if (z >= 14.5 || z < 11.5 || !map.getSource('openmaptiles') || !map.isStyleLoaded()) return;
  let feats = []; try { feats = map.querySourceFeatures('openmaptiles', { sourceLayer: 'poi', filter: ['has', 'name'] }); } catch { return; }
  const b = map.getBounds(), seen = new Set(), bins = new Map(), CAP = 4000; // cap the scan: tile cache counts are unreliable and can be huge
  for (let i = 0; i < feats.length && i < CAP; i++) {
    const g = feats[i].geometry; if (g.type !== 'Point') continue;
    const [lon, lat] = g.coordinates; if (!b.contains([lon, lat])) continue; // bound against the real viewport
    const k = `${feats[i].properties.name}|${lon.toFixed(5)}|${lat.toFixed(5)}`; if (seen.has(k)) continue; seen.add(k);
    const p = map.project([lon, lat]), cell = `${Math.floor(p.x / 90)},${Math.floor(p.y / 90)}`, c = bins.get(cell) || { n: 0, lat: 0, lon: 0 };
    c.n++; c.lat += lat; c.lon += lon; bins.set(cell, c);
  }
  for (const c of [...bins.values()].slice(0, 60)) {
    const el = document.createElement('div'); el.className = 'cluster'; el.textContent = c.n > 99 ? '99+' : c.n;
    const ll = [c.lon / c.n, c.lat / c.n];
    el.addEventListener('click', ev => { ev.stopPropagation(); map.easeTo({ center: ll, zoom: Math.min(16, z + 2.5) }); });
    clusterMarkers.push(new maplibregl.Marker({ element: el }).setLngLat(ll).addTo(map));
  }
}

/* ================= servers ================= */
const trim = u => (u || '').trim().replace(/\/+$/, '');
const SV = () => ({
  photon: trim(S.servers.photon) || 'https://photon.komoot.io',
  nominatim: trim(S.servers.nominatim) || 'https://nominatim.openstreetmap.org',
  osrm: trim(S.servers.osrm),
});
function osrmBase(mode) {
  const o = SV().osrm;
  if (o) return `${o}/route/v1/${mode === 'foot' ? 'foot' : 'driving'}`;
  return mode === 'foot' ? 'https://routing.openstreetmap.de/routed-foot/route/v1/driving' : 'https://router.project-osrm.org/route/v1/driving';
}

/* ================= location ================= */
let meMarker = null, simTimer = null, simHeading = Math.random() * 6.28, watchId = null;
const firstFix = { done: false };

function onPos(lat, lon, acc, ts = Date.now()) {
  const prev = me; me = { lat, lon, acc, ts };
  if (!map) return;
  if (!meMarker) {
    const el = document.createElement('div'); el.className = 'me'; el.innerHTML = '<i></i>';
    meMarker = new maplibregl.Marker({ element: el }).setLngLat([lon, lat]).addTo(map);
  } else meMarker.setLngLat([lon, lat]);

  if (!firstFix.done) {
    firstFix.done = true; following = true; $('#locateBtn').classList.add('on');
    map.jumpTo({ center: [lon, lat], zoom: quest.on ? 17 : 16 });
    $('#locLabel').textContent = 'Around your location';
    resolveCountry(); renderNearby();
    if (quest.on) topUpCats();
  } else if (following) map.easeTo({ center: [lon, lat], duration: 600 });

  if (quest.on) questTick(prev, me);
  if (nav.active) navTick();
}
function startLocation() {
  if (!('geolocation' in navigator)) { $('#locLabel').textContent = 'Location not supported'; return; }
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  watchId = navigator.geolocation.watchPosition(
    p => { if (!S.sim) onPos(p.coords.latitude, p.coords.longitude, p.coords.accuracy || 20, p.timestamp); },
    err => { $('#locLabel').textContent = err.code === 1 ? 'Location is off — tap ◎ to retry' : 'Can’t find you yet…'; if (!me) renderNearby(); },
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 25000 });
}
function setSim(on) {
  S.sim = on; save(); clearInterval(simTimer); simTimer = null; if (!on) return;
  if (!me) onPos(KL[0], KL[1], 8);
  simTimer = setInterval(() => {
    simHeading += (Math.random() - .5) * .6;
    const p = offset([me.lat, me.lon], 3.1, simHeading); // brisk march, just under the walking cap
    onPos(p[0], p[1], 8);
  }, 1000);
}

/* ================= nearby (vector-tile POIs: no extra service) ================= */
const CATS_UI = [{ id: 'all', label: 'All', icon: '✨' }, { id: 'food', label: 'Food', icon: '🍜' }, { id: 'coffee', label: 'Coffee', icon: '☕' },
  { id: 'park', label: 'Parks', icon: '🌳' }, { id: 'sight', label: 'Sights', icon: '📸' }, { id: 'shop', label: 'Shops', icon: '🛍️' }];
const ICON = { coffee: '☕', food: '🍜', park: '🌳', sight: '📸', shop: '🛍️' };
let nearby = [], nearbyFilter = 'all', nearbyAt = null, nearbyTries = 0;

function maybeNearbyFromTiles() {
  if (!me || !map.isStyleLoaded() || !map.getSource('openmaptiles')) return;
  if (nearbyAt && dist([me.lat, me.lon], nearbyAt) < 300 && nearby.length) return;
  if (nearbyTries > 6 && nearby.length) return;
  const feats = map.querySourceFeatures('openmaptiles', { sourceLayer: 'poi', filter: ['has', 'name'] });
  const here = [me.lat, me.lon], seen = new Set(), out = [];
  for (const f of feats.slice(0, 6000)) {
    if (f.geometry.type !== 'Point') continue; const cat = catOfClass(f.properties.class); if (!cat) continue;
    const [lon, lat] = f.geometry.coordinates, d = dist(here, [lat, lon]); if (d > 1500) continue;
    const k = f.properties.name + cat; if (seen.has(k)) continue; seen.add(k);
    out.push({ id: `${lat},${lon}`, name: f.properties.name, lat, lon, cat, kind: pretty(f.properties.subclass || f.properties.class), d });
  }
  nearbyTries++;
  if (!out.length) return;
  nearby = out.sort((a, b) => a.d - b.d); nearbyAt = here; renderNearby();
}
function renderNearby() {
  const savedChips = [S.saved.home && ['home', '🏠 Home'], S.saved.work && ['work', '💼 Work']].filter(Boolean);
  $('#chips').innerHTML = savedChips.map(([k, l]) => `<button class="chip" data-saved="${k}">${l}</button>`).join('') +
    CATS_UI.map(c => `<button class="chip ${c.id === nearbyFilter ? 'on' : ''}" data-c="${c.id}">${c.icon} ${c.label}</button>`).join('');
  let html;
  if (!me) html = '<li class="empty">Allow location to see places near you.<br>You can still search above.</li>';
  else if (!nearby.length) html = '<li class="empty">Sniffing out places nearby… 🐾</li>';
  else {
    const list = nearby.filter(p => nearbyFilter === 'all' || p.cat === nearbyFilter).slice(0, 40);
    html = list.length ? list.map(p => `<li data-id="${esc(p.id)}"><div class="ico">${ICON[p.cat]}</div><div class="li-main"><div class="li-title">${esc(p.name)}</div><div class="li-sub">${esc(p.kind)}</div></div><div class="li-dist">${fmtDist(dist([me.lat, me.lon], [p.lat, p.lon]))}</div></li>`).join('')
      : '<li class="empty">Nothing here. Try another category.</li>';
  }
  $('#places').innerHTML = html;
}
$('#chips').addEventListener('click', e => {
  const b = e.target.closest('.chip'); if (!b) return;
  if (b.dataset.saved) return choose(S.saved[b.dataset.saved]);
  nearbyFilter = b.dataset.c; renderNearby();
});
$('#places').addEventListener('click', e => {
  const li = e.target.closest('li[data-id]'); if (!li) return;
  const p = nearby.find(x => x.id === li.dataset.id); if (p) choose({ name: p.name, lat: p.lat, lon: p.lon, sub: p.kind });
});

/* ================= search: Photon + Nominatim (+ optional Google), blended ================= */
const dedupeKey = (lat, lon) => `${Math.round(lat * 1000)},${Math.round(lon * 1000)}`; // ~111 m grid
async function resolveCountry() {
  if (!me) return;
  const c = S.country; if (c && dist([c.lat, c.lon], [me.lat, me.lon]) < 300000) return;
  try {
    const j = await (await fetch(`${SV().nominatim}/reverse?format=jsonv2&lat=${me.lat}&lon=${me.lon}&zoom=3&addressdetails=1`)).json();
    const cc = j.address?.country_code; if (cc) { S.country = { cc, lat: me.lat, lon: me.lon }; save(); }
  } catch {}
}
function searchOrigin() { if (me) return [me.lat, me.lon]; const c = map.getCenter(); return [c.lat, c.lng]; }

const UI_LANG = (navigator.language || 'en').toLowerCase();
const PHOTON_LANG = ['en', 'de', 'fr', 'it'].includes(UI_LANG.slice(0, 2)) ? UI_LANG.slice(0, 2) : 'en'; // Photon only localises these
async function photonSearch(q, o, signal) {
  const r = await fetch(`${SV().photon}/api/?q=${encodeURIComponent(q)}&limit=8&lat=${o[0]}&lon=${o[1]}&lang=${PHOTON_LANG}`, { signal });
  if (!r.ok) throw new Error(r.status);
  return (await r.json()).features.map(f => {
    const p = f.properties, name = p.name || [p.street, p.housenumber].filter(Boolean).join(' ');
    return { name, sub: [p.name ? p.street : null, p.city || p.locality || p.county, p.state, p.country].filter(Boolean).join(', '),
      lat: f.geometry.coordinates[1], lon: f.geometry.coordinates[0], cc: (p.countrycode || '').toLowerCase() || null, src: 'photon', kind: `${p.osm_key}:${p.osm_value}` };
  }).filter(x => x.name);
}
async function nominatimSearch(q, o, signal) {
  const vb = `${o[1] - .5},${o[0] + .5},${o[1] + .5},${o[0] - .5}`;
  const r = await fetch(`${SV().nominatim}/search?format=jsonv2&limit=8&addressdetails=1&accept-language=${encodeURIComponent(UI_LANG + ',en')}&q=${encodeURIComponent(q)}&viewbox=${vb}`, { signal });
  if (!r.ok) throw new Error(r.status);
  return (await r.json()).map(x => { const parts = x.display_name.split(', ');
    return { name: x.name || parts[0], sub: parts.slice(1, 4).join(', '), lat: +x.lat, lon: +x.lon, cc: x.address?.country_code || null, src: 'nominatim', kind: `${x.category}:${x.type}`, imp: +x.importance || 0 }; });
}
async function googleSearch(q, o, signal) { // Places API (New) Text Search — optional, search only
  const r = await fetch('https://places.googleapis.com/v1/places:searchText', { method: 'POST', signal,
    headers: { 'Content-Type': 'application/json', 'X-Goog-Api-Key': S.gkey, 'X-Goog-FieldMask': 'places.displayName,places.formattedAddress,places.location' },
    body: JSON.stringify({ textQuery: q, maxResultCount: 6, locationBias: { circle: { center: { latitude: o[0], longitude: o[1] }, radius: 30000 } } }) });
  if (!r.ok) throw new Error(r.status);
  return ((await r.json()).places || []).map(p => ({ name: p.displayName?.text || '', sub: p.formattedAddress || '', lat: p.location.latitude, lon: p.location.longitude, cc: null, src: 'google' })).filter(x => x.name);
}
/* --- ranking: text relevance + distance + provider agreement + prominence (not distance alone) --- */
const norm = t => String(t || '').toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^\p{L}\p{N}\s]/gu, ' ').replace(/\s+/g, ' ').trim();
function relevance(q, r) {
  const nq = norm(q), nn = norm(r.name); if (!nq || !nn) return 0;
  if (nn === nq) return 1;
  if (nn.startsWith(nq)) return .88;
  const toks = nq.split(' '), words = nn.split(' ');
  if (toks.every(t => words.some(w => w.startsWith(t)))) return .75;
  if (nn.includes(nq)) return .6;
  const hay = nn + ' ' + norm(r.sub);
  return .15 + .35 * toks.filter(t => hay.includes(t)).length / toks.length;
}
const LANDMARK = /^(tourism:(attraction|museum|viewpoint|gallery|zoo|theme_park)|aeroway:|railway:(station|halt)|shop:mall|amenity:(place_of_worship|university|hospital|marketplace)|leisure:(park|stadium)|building:(mosque|church|temple))/;
const MINOR = /^(highway:|place:(house|house_number)|building:(yes|house|residential))/;
function mergeRank(q, o, lists) {
  const keys = new Map(), out = [], hasDigit = /\d/.test(q);
  for (const list of lists) for (const r of list || []) {
    const k = dedupeKey(r.lat, r.lon), ex = keys.get(k);
    if (ex) { ex.agree++; continue; }           // same place from another provider (~111 m grid) → confidence, not a duplicate row
    r.agree = 1; keys.set(k, r); out.push(r);
  }
  for (const r of out) {
    r.d = dist(o, [r.lat, r.lon]); r.rel = relevance(q, r);
    const boost = (LANDMARK.test(r.kind || '') ? .12 : 0) - (!hasDigit && MINOR.test(r.kind || '') ? .08 : 0) + (r.imp || 0) * .15;
    r.score = .55 * r.rel + .25 / (1 + r.d / 8000) + (r.agree > 1 ? .08 : 0) + boost;
  }
  // country scope: if anything matches your country, drop the rest; otherwise keep the global list (Eiffel Tower from Malaysia still works)
  const cc = S.country?.cc; let res = out;
  if (cc && out.some(r => r.cc === cc)) res = out.filter(r => r.cc === cc || (r.cc == null && r.d < 200000));
  return res.sort((a, b) => b.score - a.score).slice(0, 8);
}

/* --- Google: only on Enter or when open results look weak, and never past a monthly budget --- */
const G_LIMIT = 4500; // under Google's 5,000/month free cap for Text Search (Pro). Verify current caps in Google's pricing docs.
function gUsage() { const m = new Date().toISOString().slice(0, 7); if (!S.gUsage || S.gUsage.m !== m) S.gUsage = { m, n: 0 }; return S.gUsage; }
let gWarned = false;
function gCanCall() {
  if (!S.gkey) return false;
  if (gUsage().n < G_LIMIT) return true;
  if (!gWarned) { gWarned = true; toast('Google search budget used up for this month — using open search', 3200); }
  return false;
}
async function blendSearch(q, signal, { explicit = false, onPartial } = {}) {
  const o = searchOrigin();
  const [ph, nm] = (await Promise.allSettled([photonSearch(q, o, signal), nominatimSearch(q, o, signal)])).map(r => r.status === 'fulfilled' ? r.value : null);
  if (!ph && !nm && !S.gkey) throw new Error('search providers failed');
  let out = mergeRank(q, o, [ph, nm]);
  const weak = !out.length || (out[0].rel < .5 && out[0].agree < 2); // two providers agreeing counts as confident, even if the local-language name differs
  if (S.gkey && (explicit || weak) && gCanCall()) {
    onPartial?.(out);
    gUsage().n++; save(); syncUI();
    const gg = await googleSearch(q, o, signal).catch(() => null);
    if (gg) out = mergeRank(q, o, [ph, nm, gg]);
  } else if (!out.length && !ph && !nm) throw new Error('search providers failed');
  return out;
}

let searchT, searchAbort, addingStop = false;
const qEl = $('#q'), resEl = $('#results');
function kindLabel(r) { // "Fuel · address" — helps tell apart ten places with the same name
  const v = (r.kind || '').split(':')[1]; if (!v || ['yes', 'house', 'house_number', 'residential', 'undefined', 'null'].includes(v)) return '';
  return pretty(v) + ' · ';
}
function showList(items, emptyMsg) {
  resEl.hidden = false; resEl._data = items;
  resEl.innerHTML = items.length ? items.map((r, i) => `<li data-i="${i}"><div class="ico">${r.icon || (r.src === 'google' ? 'G' : '📍')}</div><div class="li-main"><div class="li-title">${esc(r.name)}</div><div class="li-sub">${esc(kindLabel(r))}${esc(r.sub)}</div></div><div class="li-dist">${r.d != null ? fmtDist(r.d) : ''}</div></li>`).join('')
    : `<li class="empty">${emptyMsg}</li>`;
}
function showQuick() {
  const items = [];
  if (S.saved.home) items.push({ ...S.saved.home, icon: '🏠', sub: 'Home' });
  if (S.saved.work) items.push({ ...S.saved.work, icon: '💼', sub: 'Work' });
  S.saved.favs.forEach(f => items.push({ ...f, icon: '⭐' }));
  S.recents.forEach(r => items.push({ ...r, icon: '🕘' }));
  if (items.length) showList(items, ''); else resEl.hidden = true;
}
qEl.addEventListener('focus', () => { if (!qEl.value.trim()) showQuick(); });
qEl.addEventListener('input', () => {
  $('#clearQ').hidden = !qEl.value; clearTimeout(searchT);
  const v = qEl.value.trim(); if (!v) return showQuick();
  if (v.length < 3) { resEl.hidden = true; return; }
  searchT = setTimeout(doSearch, 450);
});
qEl.addEventListener('keydown', e => { if (e.key === 'Enter') { clearTimeout(searchT); doSearch(true); qEl.blur(); } });
$('#clearQ').addEventListener('click', () => { qEl.value = ''; $('#clearQ').hidden = true; qEl.focus(); showQuick(); });
async function doSearch(explicit = false) {
  const text = qEl.value.trim(); if (text.length < 2) return;
  searchAbort?.abort(); const ac = searchAbort = new AbortController();
  showList([], 'Searching…');
  try {
    const items = await blendSearch(text, ac.signal, { explicit, onPartial: p => { if (!ac.signal.aborted && p.length) showList(p, ''); } });
    if (!ac.signal.aborted) showList(items, 'No results. Try a different spelling.');
  } catch (e) { if (!ac.signal.aborted) showList([], 'Search failed. Check your connection.'); }
}
resEl.addEventListener('click', e => {
  const li = e.target.closest('li[data-i]'); if (!li) return;
  const r = resEl._data[+li.dataset.i]; resEl.hidden = true; qEl.value = '';
  $('#clearQ').hidden = true;
  const fromSearch = r.icon == null && r.src !== 'google'; // Google content isn't stored (terms)
  if (fromSearch) { S.recents = [{ name: r.name, sub: r.sub, lat: r.lat, lon: r.lon }, ...S.recents.filter(x => dedupeKey(x.lat, x.lon) !== dedupeKey(r.lat, r.lon))].slice(0, 8); save(); renderSaved(); }
  choose({ name: r.name, sub: r.sub, lat: r.lat, lon: r.lon });
});
document.addEventListener('pointerdown', e => { if (!e.target.closest('#results, #topbar')) resEl.hidden = true; });

/* ================= routing (OSRM) ================= */
const nav = { dest: null, wps: [], mode: 'car', routes: [], sel: 0, fc: null, active: false, idx: 0, off: 0, abort: null, steps: [], marks: [], said: new Set(), tripAt: 0 };

function choose(place) { if (addingStop && nav.dest) { addingStop = false; $('#addStop').classList.remove('on-toggle'); addWaypoint(place); } else selectPlace(place); }

async function selectPlace(place, opts = {}) {
  if (!me && !firstFix.done) { toast('Waiting for your location…'); startLocation(); }
  nav.dest = place; nav.wps = []; nav.routes = []; nav.sel = 0;
  nav.mode = quest.on ? 'foot' : (nav.mode || 'car');
  $('#destName').textContent = place.name; $('#destSub').textContent = place.sub || '';
  $('#nearbyView').hidden = true; $('#navView').hidden = false; $('#steps').hidden = true; $('#saveMenu').hidden = true;
  $('#sheet').classList.remove('collapsed');
  $('#alts').innerHTML = ''; $('#routeSummary').innerHTML = '';
  drawMarkers(); syncModeSeg(); syncPanels(); syncSaveStar();
  if (me) await fetchRoute(); else map.easeTo({ center: [place.lon, place.lat], zoom: 16 });
}
function drawMarkers() {
  nav.marks.forEach(m => m.remove()); nav.marks = [];
  if (!nav.dest) return;
  nav.wps.forEach((w, i) => { const el = document.createElement('div'); el.className = 'stop-pin'; el.textContent = i + 1; nav.marks.push(new maplibregl.Marker({ element: el }).setLngLat([w.lon, w.lat]).addTo(map)); });
  const el = document.createElement('div'); el.className = 'pin'; el.textContent = '📍';
  nav.marks.push(new maplibregl.Marker({ element: el, anchor: 'bottom' }).setLngLat([nav.dest.lon, nav.dest.lat]).addTo(map));
}
function syncModeSeg() {
  $$('#modeSwitch button').forEach(b => { b.classList.toggle('on', b.dataset.mode === nav.mode); b.disabled = quest.on && b.dataset.mode === 'car'; });
  $('#avoidHw').classList.toggle('on-toggle', S.avoidHw); $('#avoidHw').hidden = nav.mode === 'foot';
}
$('#modeSwitch').addEventListener('click', e => { const b = e.target.closest('button'); if (!b || b.disabled) return; nav.mode = b.dataset.mode; syncModeSeg(); fetchRoute(); });
$('#avoidHw').addEventListener('click', () => { S.avoidHw = !S.avoidHw; save(); syncModeSeg(); fetchRoute(); });

/* waypoints */
$('#addStop').addEventListener('click', () => { addingStop = !addingStop; $('#addStop').classList.toggle('on-toggle', addingStop); if (addingStop) { toast('Search for a stop to add'); qEl.focus(); } });
function addWaypoint(p) { nav.wps.push(p); renderStops(); drawMarkers(); fetchRoute(); }
function renderStops() {
  const ol = $('#stops'); ol.hidden = !nav.wps.length;
  ol.innerHTML = nav.wps.map((w, i) => `<li><div class="stop-pin" style="position:static">${i + 1}</div><div class="li-main"><div class="li-title">${esc(w.name)}</div></div><button class="x" data-rm="${i}" aria-label="Remove stop">✕</button></li>`).join('');
  $('#optimizeStops').hidden = nav.wps.length < 1;
}
$('#stops').addEventListener('click', e => { const b = e.target.closest('[data-rm]'); if (!b) return; nav.wps.splice(+b.dataset.rm, 1); renderStops(); drawMarkers(); fetchRoute(); });
// Nearest-neighbour ordering from your location. Not a TSP solver — good enough for a handful of stops.
$('#optimizeStops').addEventListener('click', () => {
  if (!me || !nav.dest) return toast('Need your location first');
  const pool = [...nav.wps, nav.dest]; let cur = [me.lat, me.lon]; const order = [];
  while (pool.length) { let bi = 0, bd = Infinity; pool.forEach((p, i) => { const d = dist(cur, [p.lat, p.lon]); if (d < bd) { bd = d; bi = i; } }); const p = pool.splice(bi, 1)[0]; order.push(p); cur = [p.lat, p.lon]; }
  nav.dest = order.pop(); nav.wps = order;
  $('#destName').textContent = nav.dest.name; $('#destSub').textContent = nav.dest.sub || '';
  renderStops(); drawMarkers(); fetchRoute(); toast('Stops reordered 🔀');
});

/* fetch + cache */
const routeKey = () => [nav.mode, S.avoidHw && nav.mode === 'car' ? 'nhw' : '', ...nav.wps, nav.dest].map(p => typeof p === 'string' ? p : `${p.lat.toFixed(4)},${p.lon.toFixed(4)}`).join('|');
const rcache = { get() { try { return JSON.parse(localStorage.getItem(RKEY)) || {}; } catch { return {}; } }, put(k, routes) {
  try { const c = this.get(); c[k] = { t: Date.now(), routes }; const ks = Object.keys(c).sort((a, b) => c[b].t - c[a].t).slice(0, 8); const o = {}; ks.forEach(x => o[x] = c[x]); localStorage.setItem(RKEY, JSON.stringify(o)); } catch {} } };
const slim = r => ({ ...r, geometry: { type: 'LineString', coordinates: r.geometry.coordinates.map(c => [+c[0].toFixed(5), +c[1].toFixed(5)]) } });

async function osrmFetch(mode, coords, { exclude, signal }) {
  const path = coords.map(c => `${c[1]},${c[0]}`).join(';');
  const url = `${osrmBase(mode)}/${path}?overview=full&geometries=geojson&steps=true&alternatives=true${exclude ? '&exclude=' + exclude : ''}`;
  const r = await fetch(url, { signal }); let j = null; try { j = await r.json(); } catch {}
  if (!r.ok || j?.code !== 'Ok') throw Object.assign(new Error(j?.code || r.status), { code: j?.code, status: r.status });
  return j.routes;
}
// Avoid-highways and walking-server fallbacks live here so first-time routing and re-routing behave the same.
async function routesWithFallback(coords, signal) {
  let routes = null, approx = false;
  if (S.avoidHw && nav.mode === 'car') {
    try { routes = await osrmFetch('car', coords, { exclude: 'motorway', signal }); }
    catch (e) { if (signal.aborted) throw e; if (e.code === 'InvalidValue' || e.status === 400) toast('This routing server can’t avoid highways — showing the normal route', 3200); else throw e; }
  }
  if (!routes) {
    try { routes = await osrmFetch(nav.mode, coords, { signal }); }
    catch (e) { // walking server unreachable: approximate from the car network at walking speed rather than leave you stranded
      if (signal.aborted || nav.mode !== 'foot') throw e;
      routes = (await osrmFetch('car', coords, { signal })).map(r => ({ ...r, duration: r.distance / 1.35 })); approx = true;
    }
  }
  return { routes, approx };
}
const routeCoords = () => [[me.lat, me.lon], ...nav.wps.map(w => [w.lat, w.lon]), [nav.dest.lat, nav.dest.lon]];
async function fetchRoute(silent) {
  if (!me || !nav.dest) return;
  nav.abort?.abort(); const ac = nav.abort = new AbortController();
  const coords = routeCoords(), key = routeKey();
  if (!silent) $('#routeSummary').innerHTML = '<small>Finding the best route…</small>';
  let routes = null, approx = false;
  try {
    ({ routes, approx } = await routesWithFallback(coords, ac.signal));
    rcache.put(key, routes.map(slim));
  } catch (e) {
    if (ac.signal.aborted) return;
    const hit = rcache.get()[key];
    if (hit) { routes = hit.routes; toast('Offline — showing your last route to this place', 3200); }
    else { $('#routeSummary').innerHTML = '<small>No route found. Try another mode or place.</small>'; return; }
  }
  if (approx) toast('Walking server unavailable — walking time estimated', 3000);
  nav.routes = routes.slice(0, 3); nav.sel = 0; nav.idx = 0; nav.off = 0; nav.said.clear();
  drawRoutes(true); renderAlts(); selectAlt(0, true);
}
// Re-route while navigating: one request at a time, never cancelled by the next GPS fix, at most one attempt every 20 s.
async function reroute() {
  if (nav.rerouting || !me || !nav.dest || Date.now() - (nav.lastReroute || 0) < 20000) return;
  nav.rerouting = true; nav.lastReroute = Date.now();
  $('#navText').textContent = 'Rerouting…';
  const ac = new AbortController(), t = setTimeout(() => ac.abort(), 20000);
  try {
    const { routes } = await routesWithFallback(routeCoords(), ac.signal);
    if (!nav.active || !routes?.length) return;
    nav.routes = routes.slice(0, 1); nav.sel = 0; nav.idx = 0; nav.off = 0; nav.said.clear();
    drawRoutes(false); nav.steps = nav.routes[0].legs.flatMap(l => l.steps); haptic(30); speak('Rerouting.');
  } catch {} finally { clearTimeout(t); nav.rerouting = false; }
}
function ensureRouteLayers() { try { if (map.getStyle() && !map.getLayer('route-main')) { if (map.getSource('routes')) map.removeSource('routes'); onStyleLoad(); } } catch {} }
function drawRoutes(fit) {
  ensureRouteLayers();
  nav.fc = { type: 'FeatureCollection', features: nav.routes.map((r, i) => ({ type: 'Feature', properties: { i, sel: i === nav.sel ? 1 : 0 }, geometry: r.geometry })) };
  map.getSource('routes')?.setData(nav.fc);
  if (fit && !nav.active && nav.routes.length) {
    const b = new maplibregl.LngLatBounds(); nav.routes[0].geometry.coordinates.forEach(c => b.extend(c));
    following = false; $('#locateBtn').classList.remove('on');
    map.fitBounds(b, { padding: { top: 130, bottom: Math.min(380, innerHeight * .5), left: 40, right: 40 }, maxZoom: 17, duration: 700 });
  }
}
function routeVia(r) {
  const s = r.legs.flatMap(l => l.steps).filter(x => x.name).sort((a, b) => b.distance - a.distance)[0]; return s ? `via ${s.name}` : '';
}
function renderAlts() {
  $('#alts').innerHTML = nav.routes.length < 2 ? '' : nav.routes.map((r, i) =>
    `<button class="alt ${i === nav.sel ? 'on' : ''}" data-i="${i}"><div><b>${fmtTime(r.duration)}</b><small>${fmtDist(r.distance)} ${esc(routeVia(r))}</small></div>${i === 0 ? '<span class="tag">Fastest</span>' : ''}</button>`).join('');
}
$('#alts').addEventListener('click', e => { const b = e.target.closest('.alt'); if (b) selectAlt(+b.dataset.i); });
function selectAlt(i, silent) {
  if (!nav.routes[i]) return; nav.sel = i; const r = nav.routes[i];
  if (!silent) { drawRoutes(false); renderAlts(); haptic(10); }
  nav.steps = r.legs.flatMap(l => l.steps);
  $('#routeSummary').innerHTML = `${fmtTime(r.duration)} <small>${fmtDist(r.distance)} · ${nav.mode === 'foot' ? 'walking' : 'driving'}${nav.wps.length ? ` · ${nav.wps.length + 1} stops` : ''}</small>`;
  $('#steps').innerHTML = nav.steps.map(s => `<li><div class="ico">${arrow(s)}</div><div class="li-main"><div class="li-title">${esc(instr(s))}</div><div class="li-sub">${s.distance ? fmtDist(s.distance) : ''}</div></div></li>`).join('');
}

function instr(s) {
  const m = s.maneuver || {}, mod = m.modifier || '', road = s.name ? ` onto ${s.name}` : '';
  switch (m.type) {
    case 'depart': return `Head out${s.name ? ' on ' + s.name : ''}`;
    case 'arrive': return 'Arrive at your destination';
    case 'roundabout': case 'rotary': return `Take the roundabout${m.exit ? ', exit ' + m.exit : ''}${road}`;
    default:
      if (mod === 'straight' || !mod) return `Continue${s.name ? ' on ' + s.name : ' straight'}`;
      if (mod === 'uturn') return `Make a U-turn${road}`;
      if (mod.startsWith('slight')) return `Bear ${mod.replace('slight ', '')}${road}`;
      return `Turn ${mod}${road}`;
  }
}
function arrow(s) {
  const m = s.maneuver || {}, mod = m.modifier || '';
  if (m.type === 'arrive') return '🏁'; if (m.type === 'depart') return '🚀'; if (m.type === 'roundabout' || m.type === 'rotary') return '⟳';
  return { left: '←', 'sharp left': '↰', 'slight left': '↖', right: '→', 'sharp right': '↱', 'slight right': '↗', uturn: '↩', straight: '↑' }[mod] || '↑';
}
$('#toggleSteps').addEventListener('click', () => { const s = $('#steps'); s.hidden = !s.hidden; });
$('#closeRoute').addEventListener('click', clearRoute);
function clearRoute() {
  nav.abort?.abort(); stopNav(true); addingStop = false; $('#addStop').classList.remove('on-toggle');
  nav.routes = []; nav.fc = null; map.getSource('routes')?.setData(emptyFC);
  nav.marks.forEach(m => m.remove()); nav.marks = []; nav.dest = null; nav.wps = []; renderStops();
  $('#navView').hidden = true; $('#nearbyView').hidden = false; syncPanels(); renderNearby();
}

/* ---- turn-by-turn ---- */
$('#startNav').addEventListener('click', () => {
  if (!nav.routes[nav.sel] || !me) return toast('Waiting for a route…');
  nav.active = true; nav.idx = 0; nav.off = 0; nav.said.clear(); following = true; haptic(40);
  document.body.classList.add('navigating'); $('#navBanner').hidden = false; resEl.hidden = true; syncPanels(); syncMute();
  S.trips = [{ name: nav.dest.name, ts: Date.now(), mode: nav.mode, dist: nav.routes[nav.sel].distance }, ...S.trips].slice(0, 20); save(); renderSaved();
  map.easeTo({ center: [me.lon, me.lat], zoom: 17.5, duration: 800 });
  speak(`Starting navigation. ${instr(nav.steps[0])}.`);
  navTick();
});
// End = leave navigation and return to the map. Hide the UI first so a failure elsewhere can never leave you stuck.
function endNavigation() {
  document.body.classList.remove('navigating'); $('#navBanner').hidden = true; nav.active = false;
  try { stopSpeech(); } catch {}
  try { clearRoute(); } catch (e) { try { syncPanels(); } catch {} }
  toast('Navigation ended');
}
$('#navStop').addEventListener('click', endNavigation);
function stopNav(silent) {
  if (!nav.active && silent) return; nav.active = false;
  document.body.classList.remove('navigating'); $('#navBanner').hidden = true;
  try { stopSpeech(); } catch {}
  try { syncPanels(); } catch {}
  if (!silent) toast('Navigation ended');
}
function navTick() {
  const steps = nav.steps; if (!steps.length || !me) return; const here = [me.lat, me.lon];
  while (nav.idx + 1 < steps.length) { const m = steps[nav.idx + 1].maneuver.location; if (dist(here, [m[1], m[0]]) < 25) nav.idx++; else break; }
  const next = steps[Math.min(nav.idx + 1, steps.length - 1)], nl = next.maneuver.location, dNext = dist(here, [nl[1], nl[0]]);
  if (next.maneuver.type === 'arrive' && dNext < 25) {
    haptic(80); setTimeout(() => haptic(80), 200); speak('You have arrived at your destination.'); toast('🎉 You have arrived!', 3500); clearRoute(); return;
  }
  $('#navArrow').textContent = arrow(next); $('#navDist').textContent = fmtDist(dNext);
  const rest = steps.slice(nav.idx + 2).reduce((a, s) => a + s.distance, 0) + dNext;
  $('#navText').textContent = `${instr(next)} · ${fmtDist(rest)} left`;
  // voice: one heads-up, one "now"
  const far = nav.mode === 'foot' ? 80 : 400, near = nav.mode === 'foot' ? 25 : 80;
  const kf = `${nav.idx}f`, kn = `${nav.idx}n`;
  if (dNext < near && !nav.said.has(kn)) { nav.said.add(kn); nav.said.add(kf); speak(instr(next)); haptic(30); }
  else if (dNext < far && !nav.said.has(kf)) { nav.said.add(kf); speak(`In ${fmtDist(dNext).replace(' m', ' metres').replace(' km', ' kilometres')}, ${instr(next)}`); }
  // off-route: farther than max(60 m, 1.5× GPS accuracy) from the line for 3 consecutive good fixes (jitter and bad fixes are ignored)
  const line = nav.routes[nav.sel].geometry.coordinates; let min = Infinity;
  for (let i = 0; i + 1 < line.length; i++) { const d = distToSeg(here, [line[i][1], line[i][0]], [line[i + 1][1], line[i + 1][0]]); if (d < min) min = d; if (min < 15) break; }
  const lim = Math.max(60, (me.acc || 0) * 1.5);
  nav.off = (min > lim && (me.acc || 0) <= 100) ? nav.off + 1 : 0;
  if (nav.off >= 3) { nav.off = 0; reroute(); }
}

/* ================= voice guidance ================= */
const SCRIPTS = [ // per-character script → TTS language. Latin/other = default voice (lang deliberately left unset).
  [/\p{Script=Hiragana}|\p{Script=Katakana}/u, 'ja-JP'], [/\p{Script=Hangul}/u, 'ko-KR'], [/\p{Script=Han}/u, 'zh-CN'],
  [/\p{Script=Devanagari}/u, 'hi-IN'], [/\p{Script=Thai}/u, 'th-TH'], [/\p{Script=Arabic}/u, 'ar-SA'], [/\p{Script=Cyrillic}/u, 'ru-RU'],
  [/\p{Script=Hebrew}/u, 'he-IL'], [/\p{Script=Tamil}/u, 'ta-IN'], [/\p{Script=Greek}/u, 'el-GR'], [/\p{Script=Bengali}/u, 'bn-IN'],
];
function charLang(ch) {
  if (/[\s\p{P}\p{S}\p{N}]/u.test(ch)) return undefined; // neutral: stays with whatever came before
  for (const [re, l] of SCRIPTS) if (re.test(ch)) return l;
  return null; // Latin etc → default voice
}
function segmentByScript(text) {
  const segs = []; let cur = null;
  for (const ch of text) { const l = charLang(ch);
    if (l === undefined && cur) { cur.text += ch; continue; }
    if (!cur || (l !== undefined && cur.lang !== l)) { cur = { lang: l === undefined ? null : l, text: '' }; segs.push(cur); }
    cur.text += ch; }
  return segs.filter(s => s.text.trim());
}
const TTS = ('speechSynthesis' in window) ? window.speechSynthesis : null; // never touch the bare global: it may not exist
let voices = [], ttsUnlocked = false;
const NATIVE_TTS = (typeof window.AndroidTTS === 'object' && window.AndroidTTS) ? window.AndroidTTS : null; // set by the Android app
function stopSpeech() { try { if (NATIVE_TTS) NATIVE_TTS.stop(); else if (TTS && (TTS.speaking || TTS.pending)) TTS.cancel(); } catch {} }
function loadVoices() {
  voices = (!NATIVE_TTS && TTS && TTS.getVoices && TTS.getVoices()) || [];
  const sel = $('#voiceSel'); sel.textContent = '';
  if (NATIVE_TTS) { // voice is chosen in Android settings → Text-to-speech output
    const o = document.createElement('option'); o.value = ''; o.textContent = 'Phone’s text-to-speech voice'; sel.appendChild(o); sel.disabled = true; return;
  }
  const def = document.createElement('option'); def.value = ''; def.textContent = TTS ? 'System default voice' : 'Voice not supported here'; sel.appendChild(def);
  for (const v of voices) { const o = document.createElement('option'); o.value = v.name; o.textContent = `${v.name} (${v.lang})`; sel.appendChild(o); }
  sel.value = voices.some(v => v.name === S.voice.name) ? S.voice.name : ''; sel.selectedIndex = Math.max(0, sel.selectedIndex);
}
// iOS Safari only allows speech after one has been started from a tap: play a silent utterance on the first touch.
function unlockTts() {
  if (!TTS || ttsUnlocked) return; ttsUnlocked = true;
  try { const u = new SpeechSynthesisUtterance(' '); u.volume = 0; TTS.speak(u); } catch {}
}
for (const ev of ['pointerdown', 'touchend', 'click']) document.addEventListener(ev, unlockTts, { passive: true });
function speak(text, force) {
  if (!S.voice.on && !force) return false;
  if (NATIVE_TTS) { // Android app: real TTS, each script segment in its own language
    try { if (!NATIVE_TTS.ready()) { if (force) toast('Phone voice is still starting — try again'); return false; }
      NATIVE_TTS.speak(JSON.stringify(segmentByScript(text).map(g => ({ text: g.text, lang: g.lang || '' })))); return true; } catch { return false; }
  }
  if (!TTS) { if (force) toast('This browser has no speech engine'); return false; }
  try {
    if (!voices.length) loadVoices();
    const busy = TTS.speaking || TTS.pending;
    if (busy) TTS.cancel();                 // cancel() immediately followed by speak() is dropped on iOS → wait a beat after cancelling
    try { TTS.resume(); } catch {}
    const run = () => {
      const chosen = voices.find(v => v.name === S.voice.name);
      for (const seg of segmentByScript(text)) {
        const u = new SpeechSynthesisUtterance(seg.text);
        if (seg.lang) { u.lang = seg.lang; const v = voices.find(x => x.lang.toLowerCase().startsWith(seg.lang.slice(0, 2).toLowerCase())); if (v) u.voice = v; }
        else if (chosen) u.voice = chosen; // default segment: never assert a lang — some engines drop the whole utterance if the locale has no voice
        TTS.speak(u);
      }
    };
    busy ? setTimeout(run, 80) : run();
    return true;
  } catch { return false; }
}
if (TTS) { loadVoices(); TTS.addEventListener?.('voiceschanged', loadVoices); setTimeout(loadVoices, 800); } else loadVoices();
$('#voiceSel').addEventListener('change', e => { S.voice.name = e.target.value; save(); }); // selecting never speaks; use Test voice
$('#testVoice').addEventListener('click', () => {
  unlockTts(); if (speak('In 200 metres, turn left onto Jalan Ampang. 你好 東京 서울 Москва', true)) toast(voices.length ? '🔊 Playing… (check volume and the silent switch)' : '🔊 Playing with the system voice… (check volume and the silent switch)', 3200);
});
$('#voiceToggle').addEventListener('change', e => { S.voice.on = e.target.checked; save(); syncMute(); });
$('#navMute').addEventListener('click', () => { S.voice.on = !S.voice.on; save(); syncMute(); if (!S.voice.on) stopSpeech(); });
function syncMute() { $('#navMute').textContent = S.voice.on ? '🔊' : '🔇'; $('#voiceToggle').checked = S.voice.on; }

/* ================= personalization (localStorage only) ================= */
function syncSaveStar() {
  const d = nav.dest; if (!d) return;
  const k = dedupeKey(d.lat, d.lon), is = [S.saved.home, S.saved.work, ...S.saved.favs].some(p => p && dedupeKey(p.lat, p.lon) === k);
  $('#savePlace').textContent = is ? '★' : '☆';
}
$('#savePlace').addEventListener('click', () => { $('#saveMenu').hidden = !$('#saveMenu').hidden; });
$('#saveMenu').addEventListener('click', e => {
  const b = e.target.closest('[data-save]'); if (!b || !nav.dest) return;
  const p = { name: nav.dest.name, sub: nav.dest.sub, lat: nav.dest.lat, lon: nav.dest.lon };
  if (b.dataset.save === 'fav') {
    if (S.saved.favs.some(f => dedupeKey(f.lat, f.lon) === dedupeKey(p.lat, p.lon))) return toast('Already in favorites');
    if (S.saved.favs.length >= 5) return toast('Favorites are full (5). Remove one in Settings.', 2600);
    S.saved.favs.push(p);
  } else S.saved[b.dataset.save] = p;
  save(); haptic(20); $('#saveMenu').hidden = true; syncSaveStar(); renderSaved(); renderNearby(); toast('Saved ⭐');
});
function renderSaved() {
  const rows = [];
  if (S.saved.home) rows.push(['home', '🏠', 'Home', S.saved.home.name]); if (S.saved.work) rows.push(['work', '💼', 'Work', S.saved.work.name]);
  S.saved.favs.forEach((f, i) => rows.push([`fav${i}`, '⭐', f.name, f.sub || '']));
  $('#savedList').innerHTML = rows.length ? rows.map(r => `<li data-go="${r[0]}"><div class="ico">${r[1]}</div><div class="li-main"><div class="li-title">${esc(r[2])}</div><div class="li-sub">${esc(r[3])}</div></div><button class="x" data-del="${r[0]}" aria-label="Remove">✕</button></li>`).join('') : '<li class="empty">Nothing saved yet. Open a place and tap ☆.</li>';
  $('#recentList').innerHTML = S.recents.length ? S.recents.map((r, i) => `<li data-rec="${i}"><div class="ico">🕘</div><div class="li-main"><div class="li-title">${esc(r.name)}</div><div class="li-sub">${esc(r.sub)}</div></div></li>`).join('') : '<li class="empty">No recent searches.</li>';
  $('#tripList').innerHTML = S.trips.length ? S.trips.map(t => `<li><div class="ico">${t.mode === 'foot' ? '🚶' : '🚗'}</div><div class="li-main"><div class="li-title">${esc(t.name)}</div><div class="li-sub">${new Date(t.ts).toLocaleDateString()} · ${fmtDist(t.dist)}</div></div></li>`).join('') : '<li class="empty">No trips yet.</li>';
}
const savedBy = id => id === 'home' ? S.saved.home : id === 'work' ? S.saved.work : S.saved.favs[+id.slice(3)];
$('#savedList').addEventListener('click', e => {
  const del = e.target.closest('[data-del]'), id = del?.dataset.del || e.target.closest('[data-go]')?.dataset.go; if (!id) return;
  if (del) { if (id === 'home' || id === 'work') S.saved[id] = null; else S.saved.favs.splice(+id.slice(3), 1); save(); renderSaved(); renderNearby(); return; }
  openDrawer(false); choose(savedBy(id));
});
$('#recentList').addEventListener('click', e => { const li = e.target.closest('[data-rec]'); if (li) { openDrawer(false); choose(S.recents[+li.dataset.rec]); } });
$('#clearRecents').addEventListener('click', () => { S.recents = []; save(); renderSaved(); });
$('#clearTrips').addEventListener('click', () => { S.trips = []; save(); renderSaved(); });

/* ================= Quest mode ================= */
// Artwork: Google Noto emoji (the Gboard set), bundled in assets/cats so it looks the same on every device.
const CAT_TYPES = [
  { img: 'cat-face', xp: 10, w: 34, r: 0 }, { img: 'cat', xp: 12, w: 20, r: 0 }, { img: 'grin-cat', xp: 18, w: 14, r: 1 },
  { img: 'grin-smile-cat', xp: 20, w: 10, r: 1 }, { img: 'smirk-cat', xp: 25, w: 8, r: 1 }, { img: 'black-cat', xp: 40, w: 8, r: 2 },
  { img: 'kissing-cat', xp: 60, w: 4, r: 2 }, { img: 'heart-eyes-cat', xp: 90, w: 2, r: 3 },
];
const TAP_MSGS = ['Meow! 🐾', 'Purr… purr… 😽', 'Let’s catch them all! 🐱', 'Mrrp?', 'Nyaa~ ♥', 'Meeeow!', 'Prrrrr 💤', 'Gotcha, floof! 😸'];
const PASS_MSGS = ['A cat brushed past your leg! 🐾', 'Paws crossed — caught one!', 'Sneaky kitty joined you 😼', 'Purrfect timing!'];
const quest = { on: false, cats: [], timer: null, wobble: null };
const levelOf = xp => 1 + Math.floor(Math.sqrt(xp / 60));

function renderHud() {
  const lv = levelOf(S.xp), lo = 60 * (lv - 1) ** 2, hi = 60 * lv ** 2;
  $('#hudLvl').textContent = lv; $('#hudXp').textContent = `${S.xp} XP`;
  $('#hudXpFill').style.width = `${Math.min(100, (S.xp - lo) / (hi - lo) * 100)}%`;
  $('#hudDist').textContent = (session.dist / 1000).toFixed(2);
  $('#hudKcal').textContent = Math.round(session.dist / 1000 * S.weight * 0.53);
  $('#hudCats').textContent = session.cats;
}
function addXp(n) {
  const before = levelOf(S.xp); S.xp += n; save();
  if (levelOf(S.xp) > before) { toast(`🎉 Level ${levelOf(S.xp)}! The cats are impressed.`, 2800); haptic(60); }
  renderHud();
}
function purr() {
  try {
    const ac = purr.ac || (purr.ac = new (window.AudioContext || window.webkitAudioContext)());
    const o = ac.createOscillator(), g = ac.createGain(), t = ac.currentTime;
    o.type = 'triangle'; o.frequency.setValueAtTime(520, t); o.frequency.exponentialRampToValueAtTime(880, t + .12); o.frequency.exponentialRampToValueAtTime(420, t + .38);
    g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(.12, t + .05); g.gain.exponentialRampToValueAtTime(.001, t + .4);
    o.connect(g).connect(ac.destination); o.start(t); o.stop(t + .42);
  } catch {}
}
function popXp(pos, n) {
  const el = document.createElement('div'); el.className = 'xp-pop'; el.innerHTML = `<b>+${n} XP</b>`;
  const m = new maplibregl.Marker({ element: el }).setLngLat([pos[1], pos[0]]).addTo(map); setTimeout(() => m.remove(), 1000);
}
function spawnCat() {
  if (!me) return;
  let roll = Math.random() * CAT_TYPES.reduce((a, c) => a + c.w, 0), type = CAT_TYPES[0];
  for (const c of CAT_TYPES) { if ((roll -= c.w) < 0) { type = c; break; } }
  const pos = offset([me.lat, me.lon], 40 + Math.random() * 260, Math.random() * Math.PI * 2);
  const el = document.createElement('div'); el.className = 'cat'; el.innerHTML = `<span class="r${type.r}"><img src="assets/cats/${type.img}.svg" alt="" draggable="false"></span>`;
  const cat = { type, pos, el, span: el.firstChild, phase: Math.random() * 6.28 };
  el.addEventListener('click', ev => { ev.stopPropagation(); catchCat(cat, true); });
  cat.marker = new maplibregl.Marker({ element: el }).setLngLat([pos[1], pos[0]]).addTo(map);
  quest.cats.push(cat);
}
function topUpCats() {
  if (!quest.on || !me) return;
  quest.cats = quest.cats.filter(c => { if (dist([me.lat, me.lon], c.pos) > 600) { c.marker.remove(); return false; } return true; });
  while (quest.cats.length < 7) spawnCat();
}
function catchCat(cat, tapped) {
  if (cat.gone) return; cat.gone = true; quest.cats = quest.cats.filter(c => c !== cat);
  cat.span.classList.add('caught'); setTimeout(() => cat.marker.remove(), 450);
  session.cats++; S.caught++; addXp(cat.type.xp); popXp(cat.pos, cat.type.xp);
  toast(tapped ? pick(TAP_MSGS) : pick(PASS_MSGS)); purr(); haptic(30); setTimeout(topUpCats, 1500);
}
function questTick(prev, cur) {
  const a = session.anchor || (session.anchor = cur), d = dist([a.lat, a.lon], [cur.lat, cur.lon]);
  if (cur.acc <= 50 && d >= 5) {
    const v = d / Math.max(.5, (cur.ts - a.ts) / 1000); session.anchor = cur;
    if (v <= 3.2) { session.dist += d; session.xpRem += d; if (session.xpRem >= 25) { const n = Math.floor(session.xpRem / 25); session.xpRem -= n * 25; addXp(n); } }
    else if (Date.now() - session.lastSlow > 20000) { session.lastSlow = Date.now(); toast('Whoa, speedy! Quest counts walking only 🚶'); }
  }
  for (const c of [...quest.cats]) if (dist([cur.lat, cur.lon], c.pos) < 20) catchCat(c, false);
  renderHud();
}
function setQuest(on) {
  quest.on = on; document.body.classList.toggle('quest-on', on); clearInterval(quest.timer); clearInterval(quest.wobble);
  if (on) {
    Object.assign(session, { dist: 0, cats: 0, xpRem: 0, anchor: null }); renderHud();
    if (nav.dest && nav.mode === 'car') { nav.mode = 'foot'; syncModeSeg(); fetchRoute(); }
    if (me) { map.easeTo({ center: [me.lon, me.lat], zoom: 17 }); following = true; $('#locateBtn').classList.add('on'); topUpCats(); }
    quest.timer = setInterval(topUpCats, 8000);
    // cats wobble: sine-wave rotation re-applied every 140 ms
    quest.wobble = setInterval(() => { const t = Date.now() / 320; for (const c of quest.cats) if (!c.gone) c.span.style.transform = `rotate(${(Math.sin(t + c.phase) * 11).toFixed(1)}deg)`; }, 140);
    toast('Quest mode on — go find some cats! 🐾', 2600);
  } else { quest.cats.forEach(c => c.marker.remove()); quest.cats = []; }
  syncModeSeg(); syncPanels();
}
function syncPanels() {
  const routeOpen = !!nav.dest && !nav.active;
  $('#sheet').hidden = quest.on && !routeOpen; $('#hud').hidden = !quest.on || routeOpen;
  document.body.classList.toggle('hud-on', quest.on && !routeOpen);
}

/* ================= theme & settings ================= */
function applyTheme(t) {
  S.theme = t; save(); document.body.dataset.theme = t;
  $('meta[name=theme-color]').content = t === 'light' ? '#ffffff' : '#000000';
  if (map) reloadStyle();
  if ((t === 'quest') !== quest.on) setQuest(t === 'quest');
  syncUI();
}
function syncUI() {
  $$('#themeSeg button').forEach(b => b.classList.toggle('on', b.dataset.theme === S.theme));
  $('#themeHint').textContent = { dark: 'Pitch-black AMOLED. Easy on the eyes and battery.', light: 'Bright and clean for daylight.', quest: 'Walking only. Cats spawn on the map — tap or stroll past them for XP.' }[S.theme];
  const tt = $('#trafficToggle'); tt.checked = S.traffic && S.theme !== 'quest' && trafficOK(); tt.disabled = S.theme === 'quest';
  $('#trafficHint').textContent = S.theme === 'quest' ? 'Off in Quest mode — you’re on foot.' : trafficOK() ? 'Live traffic on the map (green = flowing, red = slow).' : 'No free keyless traffic data exists. Add a free TomTom key below to turn it on.';
  $('#trafficProv').value = S.trafficProv || 'tomtom'; $('#trafficKey').value = S.trafficKey || ''; $('#trafficKeyRow').hidden = (S.trafficProv || 'tomtom') !== 'tomtom'; $('#trafficCustomHint').hidden = (S.trafficProv || 'tomtom') !== 'custom';
  syncTrafficBtn();
  $('#gkey').value = S.gkey; $('#gUsage').textContent = S.gkey ? `Google searches this month: ${gUsage().n} / ${G_LIMIT}. Used only on Enter or when open results look weak.` : ''; $('#weight').value = S.weight; $('#simToggle').checked = S.sim; $('#verLabel').textContent = 'v' + APP_VERSION; $('#aboutVer').textContent = 'Version ' + APP_VERSION;
  $('#srvPhoton').value = S.servers.photon; $('#srvNominatim').value = S.servers.nominatim; $('#srvOsrm').value = S.servers.osrm; $('#srvTraffic').value = S.servers.traffic;
  syncMute();
}
function openDrawer(o) { $('#drawer').classList.toggle('open', o); $('#drawer').setAttribute('aria-hidden', String(!o)); $('#scrim').hidden = !o; }
$('#menuBtn').addEventListener('click', () => { renderSaved(); openDrawer(true); });
$('#closeDrawer').addEventListener('click', () => openDrawer(false));
// The trio: open the sibling apps (Android shell only; the website falls back to their pages)
for (const b of document.querySelectorAll('[data-pkg]')) {
  b.addEventListener('click', () => {
    if (window.AndroidApps) window.AndroidApps.open(b.dataset.pkg, b.dataset.url);
    else window.open(b.dataset.url, '_blank', 'noopener');
  });
}
$('#scrim').addEventListener('click', () => openDrawer(false));
document.addEventListener('keydown', e => { if (e.key === 'Escape') openDrawer(false); });
$('#themeSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (b) applyTheme(b.dataset.theme); });
function setTraffic(on) {
  if (on && !trafficOK()) { S.traffic = false; save(); syncUI(); needTrafficSetup(); return; }
  S.traffic = on; save(); applyTraffic(); syncUI(); if (on) toast('Traffic on 🚦');
}
function needTrafficSetup() { renderSaved(); openDrawer(true); $('#trafficCfg').scrollIntoView({ block: 'center' }); toast('Add a free TomTom key to see live traffic', 3200); }
function syncTrafficBtn() { const b = $('#trafficBtn'); if (!b) return; b.classList.toggle('on', !!S.traffic && trafficOK() && S.theme !== 'quest'); b.hidden = S.theme === 'quest'; }
$('#trafficToggle').addEventListener('change', e => setTraffic(e.target.checked));
$('#trafficBtn').addEventListener('click', () => setTraffic(!(S.traffic && trafficOK())));
$('#trafficProv').addEventListener('change', e => { S.trafficProv = e.target.value; save(); syncUI(); applyTraffic(); });
$('#trafficSave').addEventListener('click', () => { S.trafficKey = $('#trafficKey').value.trim(); if (S.trafficKey) S.traffic = true; save(); syncUI(); applyTraffic(); toast(S.trafficKey ? 'Traffic key saved — traffic on 🚦' : 'Traffic key removed'); });
$('#saveKey').addEventListener('click', () => { S.gkey = $('#gkey').value.trim(); save(); toast(S.gkey ? 'Google search enabled' : 'Google search off'); });
$('#srvToggle').addEventListener('click', () => { $('#srvBox').hidden = !$('#srvBox').hidden; });
$('#srvSave').addEventListener('click', () => {
  S.servers = { photon: trim($('#srvPhoton').value), nominatim: trim($('#srvNominatim').value), osrm: trim($('#srvOsrm').value), traffic: $('#srvTraffic').value.trim() };
  if (!trafficOK()) S.traffic = false; save(); syncUI(); applyTraffic(); toast('Servers saved');
});
$('#srvReset').addEventListener('click', () => { S.servers = { photon: '', nominatim: '', osrm: '', traffic: '' }; S.traffic = false; save(); syncUI(); applyTraffic(); toast('Using public servers'); });
$('#weight').addEventListener('change', e => { S.weight = Math.min(250, Math.max(30, +e.target.value || 65)); e.target.value = S.weight; save(); renderHud(); });
$('#simToggle').addEventListener('change', e => { setSim(e.target.checked); toast(e.target.checked ? 'Simulating a stroll 🚶' : 'Simulation off'); });

$('#locateBtn').addEventListener('click', () => {
  if (!me) { startLocation(); return toast('Looking for you…'); }
  following = true; $('#locateBtn').classList.add('on'); map.easeTo({ center: [me.lon, me.lat], zoom: Math.max(map.getZoom(), 16) });
});
$('#sheetHandle').addEventListener('click', () => $('#sheet').classList.toggle('collapsed'));
new ResizeObserver(() => document.documentElement.style.setProperty('--sheet-h', ($('#sheet').hidden ? 0 : $('#sheet').offsetHeight) + 'px')).observe($('#sheet'));

/* ================= OTA updates (service worker + version.json) ================= */
let swReg = null, waitingSW = null;
const updStatus = t => $('#updStatus').textContent = t;
function showUpdateReady() { $('#updateDot').hidden = false; $('#installUpd').hidden = false; updStatus('A new version is ready to install.'); }
async function checkUpdates(manual) {
  if (manual) updStatus('Checking…');
  try {
    if (swReg) await swReg.update();
    if (swReg?.waiting) { waitingSW = swReg.waiting; showUpdateReady(); return; }
    const j = await (await fetch('version.json?_=' + Date.now(), { cache: 'no-store' })).json();
    if (j.version !== APP_VERSION) { if (!swReg) { $('#installUpd').hidden = false; $('#updateDot').hidden = false; updStatus(`v${j.version} is available — reload to update.`); } else updStatus('Downloading update…'); }
    else if (manual) updStatus(`You’re up to date (v${APP_VERSION}).`);
  } catch { if (manual) updStatus('Couldn’t check — are you offline?'); }
}
$('#checkUpd').addEventListener('click', () => checkUpdates(true));
$('#installUpd').addEventListener('click', () => { updStatus('Installing…'); if (waitingSW) waitingSW.postMessage('SKIP_WAITING'); else location.reload(); });
if ('serviceWorker' in navigator) {
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => { if (reloading) return; reloading = true; location.reload(); });
  navigator.serviceWorker.register('sw.js').then(reg => {
    swReg = reg;
    const watch = w => w && w.addEventListener('statechange', () => { if (w.state === 'installed' && navigator.serviceWorker.controller) { waitingSW = reg.waiting; showUpdateReady(); } });
    if (reg.waiting && navigator.serviceWorker.controller) { waitingSW = reg.waiting; showUpdateReady(); }
    reg.addEventListener('updatefound', () => watch(reg.installing));
    checkUpdates(false); setInterval(() => checkUpdates(false), 30 * 60 * 1000);
  }).catch(() => {});
} else checkUpdates(false);

/* ================= boot ================= */
// Android back button hook: close drawer / stop nav / close route first, otherwise let the app exit.
window.__macBack = () => {
  if ($('#drawer').classList.contains('open')) { openDrawer(false); return true; }
  if (nav.active) { stopNav(false); return true; }
  if (nav.dest) { clearRoute(); return true; }
  return false;
};
document.body.dataset.theme = S.theme;
syncUI(); renderSaved(); renderNearby();
initMap().then(() => {
  if (S.theme === 'quest') setQuest(true);
  startLocation(); if (S.sim) setSim(true);
  window.__mac = { map, S, nav, quest, onPos, spawnCat, catchCat, segmentByScript, blendSearch, relevance, mergeRank, getMe: () => me };
});
})();
