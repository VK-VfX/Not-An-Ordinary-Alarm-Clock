/* Pawmap — maps with no sign-up. Leaflet + open data; Google layers optional. */
(() => {
'use strict';

const APP_VERSION = '1.0.0';
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const KL = [3.139, 101.687]; // fallback view until we get a fix

/* ---------- state ---------- */
const KEY = 'pawmap.v1';
const S = Object.assign({
  theme: 'dark', traffic: false, gkey: '', base: 'open', weight: 65, sim: false,
  xp: 0, caught: 0,
}, (() => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch { return {}; } })());
const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch {} };

let me = null;            // {lat, lon, acc, ts}
let following = false;
const session = { dist: 0, cats: 0, xpRem: 0, lastSlow: 0 };

/* ---------- geo helpers ---------- */
const R = 6371000, rad = d => d * Math.PI / 180, deg = r => r * 180 / Math.PI;
function dist(a, b) {
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
const fmtDist = m => m < 1000 ? `${Math.round(m / 10) * 10 || Math.round(m)} m` : `${(m / 1000).toFixed(m < 10000 ? 1 : 0)} km`;
const fmtTime = s => { const m = Math.max(1, Math.round(s / 60)); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`; };
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const pick = a => a[Math.floor(Math.random() * a.length)];

/* ---------- toast ---------- */
let toastT;
function toast(msg, ms = 1900) {
  const t = $('#toast');
  t.textContent = msg; t.classList.add('show');
  clearTimeout(toastT); toastT = setTimeout(() => t.classList.remove('show'), ms);
}

/* ---------- map ---------- */
const map = L.map('map', { zoomControl: false, center: KL, zoom: 13, zoomSnap: 0.5, tap: true });
map.attributionControl.setPrefix(false);
map.on('dragstart', () => { following = false; $('#locateBtn').classList.remove('on'); });

let baseLayer = null, gPromise = null;
const GOOGLE_DARK = [
  { elementType: 'geometry', stylers: [{ color: '#000000' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#9a9a9a' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#000000' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#1c1c1c' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#050d16' }] },
  { featureType: 'poi.park', elementType: 'geometry', stylers: [{ color: '#03110a' }] },
  { featureType: 'poi', elementType: 'labels', stylers: [{ visibility: 'off' }] },
];

function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src; s.onload = res; s.onerror = () => rej(new Error('load ' + src));
    document.head.appendChild(s);
  });
}
function loadGoogle() {
  if (gPromise) return gPromise;
  gPromise = new Promise((res, rej) => {
    window.__gmReady = () => loadScript('vendor/googlemutant/Leaflet.GoogleMutant.js').then(res, rej);
    window.gm_authFailure = () => toast('Google rejected that API key');
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(S.gkey)}&callback=__gmReady`;
    s.onerror = () => { gPromise = null; rej(new Error('Google Maps failed to load')); };
    document.head.appendChild(s);
  });
  return gPromise;
}

let baseToken = 0;
async function applyBase() {
  const token = ++baseToken;
  const dark = S.theme !== 'light';
  const useGoogle = S.gkey && S.base !== 'open';
  const mapEl = $('#map');
  let layer;
  if (useGoogle) {
    try { await loadGoogle(); } catch (e) {
      toast('Google Maps unavailable — using open map');
      S.base = 'open'; save(); syncUI(); return applyBase();
    }
    if (token !== baseToken) return;
    layer = L.gridLayer.googleMutant({
      type: S.base === 'gsat' ? 'hybrid' : 'roadmap',
      styles: dark && S.base !== 'gsat' ? GOOGLE_DARK : [],
      maxZoom: 21,
    });
    mapEl.classList.remove('open-dark');
  } else {
    const url = dark
      ? 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png'
      : 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png';
    layer = L.tileLayer(url, {
      subdomains: 'abcd', maxZoom: 19,
      attribution: '© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> · © <a href="https://carto.com/attributions">CARTO</a>',
    });
    mapEl.classList.toggle('open-dark', dark);
  }
  if (baseLayer) map.removeLayer(baseLayer);
  baseLayer = layer.addTo(map);
  baseLayer.bringToBack?.();
  applyTraffic();
}
function trafficAvailable() { return !!S.gkey && S.base !== 'open'; }
function applyTraffic() {
  if (!baseLayer?.addGoogleLayer) return;
  const want = S.traffic && S.theme !== 'quest';
  try {
    if (want) baseLayer.addGoogleLayer('TrafficLayer'); else baseLayer.removeGoogleLayer?.('TrafficLayer');
  } catch {}
}

/* ---------- location ---------- */
let meMarker = null, accCircle = null, simTimer = null, simHeading = Math.random() * 6.28, watchId = null;
const firstFix = { done: false };

function onPos(lat, lon, acc, ts = Date.now()) {
  const prev = me;
  me = { lat, lon, acc, ts };
  const ll = [lat, lon];
  if (!meMarker) {
    meMarker = L.marker(ll, { icon: L.divIcon({ className: 'me', html: '<i></i>', iconSize: [28, 28] }), interactive: false, zIndexOffset: 1000 }).addTo(map);
    accCircle = L.circle(ll, { radius: acc, weight: 1, color: '#2f8bff', fillOpacity: .08, interactive: false }).addTo(map);
  } else { meMarker.setLatLng(ll); accCircle.setLatLng(ll).setRadius(acc); }

  if (!firstFix.done) {
    firstFix.done = true; following = true; $('#locateBtn').classList.add('on');
    map.setView(ll, quest.on ? 17 : 16, { animate: false });
    $('#locLabel').textContent = 'Around your location';
    loadNearby();
    if (quest.on) topUpCats();
  } else if (following) {
    map.panTo(ll, { animate: true, duration: .6 });
  }

  if (quest.on) questTick(prev, me);
  if (nav.active) navTick();
}

function startLocation() {
  if (!('geolocation' in navigator)) { $('#locLabel').textContent = 'Location not supported'; return; }
  if (watchId != null) navigator.geolocation.clearWatch(watchId);
  watchId = navigator.geolocation.watchPosition(
    p => { if (!S.sim) onPos(p.coords.latitude, p.coords.longitude, p.coords.accuracy || 20, p.timestamp); },
    err => {
      $('#locLabel').textContent = err.code === 1 ? 'Location is off — tap ◎ to retry' : 'Can’t find you yet…';
      if (!me && !firstFix.done) renderNearby();
    },
    { enableHighAccuracy: true, maximumAge: 2000, timeout: 25000 }
  );
}
function setSim(on) {
  S.sim = on; save();
  clearInterval(simTimer); simTimer = null;
  if (!on) return;
  if (!me) onPos(KL[0], KL[1], 8);
  simTimer = setInterval(() => {
    simHeading += (Math.random() - .5) * .6;
    const p = offset([me.lat, me.lon], 3.1, simHeading); // brisk march: ~3 m/s, just under the walking cap
    onPos(p[0], p[1], 8);
  }, 1000);
}

/* ---------- nearby places (Overpass) ---------- */
const CATS_UI = [
  { id: 'all', label: 'All', icon: '✨' },
  { id: 'food', label: 'Food', icon: '🍜' },
  { id: 'coffee', label: 'Coffee', icon: '☕' },
  { id: 'park', label: 'Parks', icon: '🌳' },
  { id: 'sight', label: 'Sights', icon: '📸' },
  { id: 'shop', label: 'Shops', icon: '🛍️' },
];
function categorize(t) {
  if (t.amenity === 'cafe' || t.amenity === 'ice_cream') return 'coffee';
  if (['restaurant', 'fast_food', 'bar', 'pub', 'food_court'].includes(t.amenity)) return 'food';
  if (t.leisure) return 'park';
  if (t.tourism || t.amenity === 'place_of_worship' || t.amenity === 'cinema' || t.amenity === 'library') return 'sight';
  if (t.shop) return 'shop';
  return 'sight';
}
const ICON = { coffee: '☕', food: '🍜', park: '🌳', sight: '📸', shop: '🛍️' };
const pretty = s => String(s || '').replace(/_/g, ' ').replace(/^./, c => c.toUpperCase());

let nearby = [], nearbyState = 'idle', nearbyFilter = 'all', nearbyAbort = null;
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter'];

async function loadNearby() {
  if (!me) return;
  nearbyState = 'loading'; renderNearby();
  nearbyAbort?.abort(); const ac = nearbyAbort = new AbortController();
  const { lat, lon } = me, r = 1200;
  const q = `[out:json][timeout:15];(
    nwr(around:${r},${lat},${lon})[amenity~"^(cafe|restaurant|fast_food|bar|pub|ice_cream|cinema|library|place_of_worship|food_court)$"][name];
    nwr(around:${r},${lat},${lon})[tourism~"^(attraction|museum|viewpoint|gallery|zoo|theme_park|artwork)$"][name];
    nwr(around:${r},${lat},${lon})[leisure~"^(park|garden|playground|nature_reserve)$"][name];
    nwr(around:${r},${lat},${lon})[shop~"^(mall|supermarket|convenience|books|bakery)$"][name];
  );out center 80;`;
  for (const url of OVERPASS) {
    try {
      const to = setTimeout(() => ac.abort(), 14000);
      const res = await fetch(url, { method: 'POST', body: 'data=' + encodeURIComponent(q), signal: ac.signal, headers: { 'Content-Type': 'application/x-www-form-urlencoded' } });
      clearTimeout(to);
      if (!res.ok) throw new Error(res.status);
      const j = await res.json();
      const seen = new Set();
      nearby = j.elements.map(e => {
        const c = e.center || e; const t = e.tags || {};
        return { id: e.type + e.id, name: t.name, lat: c.lat, lon: c.lon, cat: categorize(t),
          kind: pretty(t.cuisine ? t.cuisine.split(';')[0] : (t.amenity || t.tourism || t.leisure || t.shop)), d: dist([lat, lon], [c.lat, c.lon]) };
      }).filter(p => p.name && p.lat && !seen.has(p.name + p.cat) && seen.add(p.name + p.cat)).sort((a, b) => a.d - b.d);
      nearbyState = 'ok'; renderNearby(); return;
    } catch (e) { if (ac.signal.aborted && nearbyAbort !== ac) return; }
  }
  nearbyState = 'error'; renderNearby();
}

function renderNearby() {
  $('#chips').innerHTML = CATS_UI.map(c => `<button class="chip ${c.id === nearbyFilter ? 'on' : ''}" data-c="${c.id}">${c.icon} ${c.label}</button>`).join('');
  const ul = $('#places');
  let html = '';
  if (!me) html = '<li class="empty">Allow location to see places near you.<br>You can still search above.</li>';
  else if (nearbyState === 'loading') html = '<li class="empty">Sniffing out places nearby… 🐾</li>';
  else if (nearbyState === 'error') html = '<li class="empty" data-retry="1">Couldn’t load places. Tap to retry.</li>';
  else {
    const list = nearby.filter(p => nearbyFilter === 'all' || p.cat === nearbyFilter).slice(0, 40);
    html = list.length ? list.map(p => `<li data-id="${p.id}"><div class="ico">${ICON[p.cat]}</div><div class="li-main"><div class="li-title">${esc(p.name)}</div><div class="li-sub">${esc(p.kind)}</div></div><div class="li-dist">${fmtDist(p.d)}</div></li>`).join('')
      : '<li class="empty">Nothing here. Try another category.</li>';
  }
  ul.innerHTML = html;
}
$('#chips').addEventListener('click', e => { const b = e.target.closest('.chip'); if (b) { nearbyFilter = b.dataset.c; renderNearby(); } });
$('#places').addEventListener('click', e => {
  if (e.target.closest('[data-retry]')) return loadNearby();
  const li = e.target.closest('li[data-id]'); if (!li) return;
  const p = nearby.find(x => x.id === li.dataset.id); if (p) selectPlace({ name: p.name, lat: p.lat, lon: p.lon, sub: p.kind });
});

/* ---------- search (Nominatim) ---------- */
let searchT, searchAbort;
const qEl = $('#q'), resEl = $('#results');
qEl.addEventListener('input', () => {
  $('#clearQ').hidden = !qEl.value;
  clearTimeout(searchT);
  if (qEl.value.trim().length < 3) { resEl.hidden = true; return; }
  searchT = setTimeout(doSearch, 450);
});
qEl.addEventListener('keydown', e => { if (e.key === 'Enter') { clearTimeout(searchT); doSearch(); qEl.blur(); } });
$('#clearQ').addEventListener('click', () => { qEl.value = ''; resEl.hidden = true; $('#clearQ').hidden = true; qEl.focus(); });

async function doSearch() {
  const text = qEl.value.trim(); if (text.length < 2) return;
  searchAbort?.abort(); const ac = searchAbort = new AbortController();
  const c = me ? [me.lat, me.lon] : map.getCenter().lat ? [map.getCenter().lat, map.getCenter().lng] : KL;
  const vb = `${c[1] - .5},${c[0] + .5},${c[1] + .5},${c[0] - .5}`;
  resEl.hidden = false; resEl.innerHTML = '<li class="empty">Searching…</li>';
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/search?format=jsonv2&limit=7&q=${encodeURIComponent(text)}&viewbox=${vb}`, { signal: ac.signal, headers: { 'Accept-Language': navigator.language || 'en' } });
    if (!res.ok) throw new Error(res.status);
    const arr = await res.json();
    if (!arr.length) { resEl.innerHTML = '<li class="empty">No results. Try a different spelling.</li>'; return; }
    resEl.innerHTML = arr.map((r, i) => {
      const parts = r.display_name.split(', ');
      const d = me ? fmtDist(dist([me.lat, me.lon], [+r.lat, +r.lon])) : '';
      return `<li data-i="${i}"><div class="ico">📍</div><div class="li-main"><div class="li-title">${esc(r.name || parts[0])}</div><div class="li-sub">${esc(parts.slice(1, 4).join(', '))}</div></div><div class="li-dist">${d}</div></li>`;
    }).join('');
    resEl._data = arr;
  } catch (e) { if (!ac.signal.aborted) resEl.innerHTML = '<li class="empty">Search failed. Check your connection.</li>'; }
}
resEl.addEventListener('click', e => {
  const li = e.target.closest('li[data-i]'); if (!li) return;
  const r = resEl._data[+li.dataset.i]; resEl.hidden = true; qEl.value = r.name || r.display_name.split(', ')[0];
  selectPlace({ name: qEl.value, lat: +r.lat, lon: +r.lon, sub: r.display_name.split(', ').slice(1, 4).join(', ') });
});
document.addEventListener('pointerdown', e => { if (!e.target.closest('#results, #topbar')) resEl.hidden = true; });

/* ---------- routing (OSRM by FOSSGIS — free, no key) ---------- */
const nav = { dest: null, mode: 'car', route: null, destMarker: null, line: [], active: false, idx: 0, off: 0, abort: null };

async function selectPlace(place) {
  if (!me) { toast('Waiting for your location…'); if (!firstFix.done) startLocation(); }
  nav.dest = place;
  nav.mode = quest.on ? 'foot' : (nav.mode || 'car');
  nav.destMarker?.remove();
  nav.destMarker = L.marker([place.lat, place.lon], { icon: L.divIcon({ className: '', html: '<div class="pin">📍</div>', iconSize: [0, 0] }) }).addTo(map);
  $('#destName').textContent = place.name; $('#destSub').textContent = place.sub || '';
  $('#nearbyView').hidden = true; $('#navView').hidden = false; $('#steps').hidden = true;
  $('#sheet').classList.remove('collapsed');
  syncModeSeg(); syncPanels();
  if (me) await fetchRoute(); else map.setView([place.lat, place.lon], 16);
}
function syncModeSeg() {
  $$('#modeSwitch button').forEach(b => { b.classList.toggle('on', b.dataset.mode === nav.mode); b.disabled = quest.on && b.dataset.mode === 'car'; });
}
$('#modeSwitch').addEventListener('click', e => { const b = e.target.closest('button'); if (!b || b.disabled) return; nav.mode = b.dataset.mode; syncModeSeg(); fetchRoute(); });

async function fetchRoute(silent) {
  if (!me || !nav.dest) return;
  nav.abort?.abort(); const ac = nav.abort = new AbortController();
  const profile = nav.mode === 'foot' ? 'routed-foot' : 'routed-car';
  const url = `https://routing.openstreetmap.de/${profile}/route/v1/driving/${me.lon},${me.lat};${nav.dest.lon},${nav.dest.lat}?overview=full&geometries=geojson&steps=true`;
  if (!silent) $('#routeSummary').innerHTML = '<small>Finding the best route…</small>';
  try {
    const res = await fetch(url, { signal: ac.signal });
    const j = await res.json();
    if (j.code !== 'Ok' || !j.routes?.length) throw new Error(j.code);
    const r = nav.route = j.routes[0];
    nav.line.forEach(l => l.remove());
    const ll = r.geometry.coordinates.map(c => [c[1], c[0]]);
    nav.line = [
      L.polyline(ll, { color: getAccent(), weight: 12, opacity: .22, interactive: false }).addTo(map),
      L.polyline(ll, { color: getAccent(), weight: 5, opacity: .95, interactive: false }).addTo(map),
    ];
    if (!nav.active) { following = false; $('#locateBtn').classList.remove('on'); map.fitBounds(L.latLngBounds(ll).pad(.25), { paddingBottomRight: [0, 200] }); }
    const steps = r.legs.flatMap(l => l.steps);
    nav.steps = steps;
    $('#routeSummary').innerHTML = `${fmtTime(r.duration)} <small>${fmtDist(r.distance)} · ${nav.mode === 'foot' ? 'walking' : 'driving'}</small>`;
    $('#steps').innerHTML = steps.map(s => `<li><div class="ico">${arrow(s)}</div><div class="li-main"><div class="li-title">${esc(instr(s))}</div><div class="li-sub">${s.distance ? fmtDist(s.distance) : ''}</div></div></li>`).join('');
    nav.idx = 0; nav.off = 0;
  } catch (e) {
    if (ac.signal.aborted) return;
    $('#routeSummary').innerHTML = '<small>No route found. Try another mode or place.</small>';
  }
}
const getAccent = () => getComputedStyle(document.body).getPropertyValue('--accent').trim() || '#3df5d0';

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
  if (m.type === 'arrive') return '🏁'; if (m.type === 'depart') return '🚀';
  if (m.type === 'roundabout' || m.type === 'rotary') return '⟳';
  return { left: '←', 'sharp left': '↰', 'slight left': '↖', right: '→', 'sharp right': '↱', 'slight right': '↗', uturn: '↩', straight: '↑' }[mod] || '↑';
}

$('#toggleSteps').addEventListener('click', () => { const s = $('#steps'); s.hidden = !s.hidden; });
$('#closeRoute').addEventListener('click', clearRoute);
function clearRoute() {
  nav.abort?.abort(); stopNav(true);
  nav.line.forEach(l => l.remove()); nav.line = []; nav.route = null; nav.dest = null;
  nav.destMarker?.remove(); nav.destMarker = null;
  $('#navView').hidden = true; $('#nearbyView').hidden = false; syncPanels();
  qEl.value = ''; $('#clearQ').hidden = true;
}

/* turn-by-turn */
$('#startNav').addEventListener('click', () => {
  if (!nav.route || !me) return toast('Waiting for a route…');
  nav.active = true; nav.idx = 0; nav.off = 0; following = true;
  document.body.classList.add('navigating');
  $('#navBanner').hidden = false; resEl.hidden = true; syncPanels();
  map.setView([me.lat, me.lon], 18, { animate: true });
  navTick();
});
$('#navStop').addEventListener('click', () => stopNav(false));
function stopNav(silent) {
  if (!nav.active && silent) return;
  nav.active = false;
  document.body.classList.remove('navigating');
  $('#navBanner').hidden = true; syncPanels();
  if (!silent) toast('Navigation ended');
}
function navTick() {
  const steps = nav.steps || []; if (!steps.length || !me) return;
  const here = [me.lat, me.lon];
  // advance past maneuvers we've reached
  while (nav.idx + 1 < steps.length) {
    const m = steps[nav.idx + 1].maneuver.location;
    if (dist(here, [m[1], m[0]]) < 25) nav.idx++; else break;
  }
  const next = steps[Math.min(nav.idx + 1, steps.length - 1)];
  const nl = next.maneuver.location, dNext = dist(here, [nl[1], nl[0]]);
  if (next.maneuver.type === 'arrive' && dNext < 25) {
    toast('🎉 You have arrived!', 3500); stopNav(true); clearRoute(); return;
  }
  $('#navArrow').textContent = arrow(next); $('#navDist').textContent = fmtDist(dNext);
  const rest = steps.slice(nav.idx + 2).reduce((a, s) => a + s.distance, 0) + dNext;
  $('#navText').textContent = `${instr(next)} · ${fmtDist(rest)} left`;
  // off-route detection
  const line = nav.route.geometry.coordinates;
  let min = Infinity;
  for (let i = 0; i < line.length; i += 1) { const d = dist(here, [line[i][1], line[i][0]]); if (d < min) min = d; }
  nav.off = min > 70 ? nav.off + 1 : 0;
  if (nav.off >= 3) { nav.off = 0; toast('Rerouting…'); fetchRoute(true); }
}

/* ---------- Quest mode ---------- */
const CAT_TYPES = [
  { e: '🐱', xp: 10, w: 45, r: 0 }, { e: '🐈', xp: 12, w: 25, r: 0 },
  { e: '😺', xp: 20, w: 15, r: 1 }, { e: '🐈‍⬛', xp: 35, w: 11, r: 2 }, { e: '😻', xp: 90, w: 4, r: 3 },
];
const TAP_MSGS = ['Meow! 🐾', 'Purr… purr… 😽', 'Let’s catch them all! 🐱', 'Mrrp?', 'Nyaa~ ♥', 'Meeeow!', 'Prrrrr 💤', 'Gotcha, floof! 😸'];
const PASS_MSGS = ['A cat brushed past your leg! 🐾', 'Paws crossed — caught one!', 'Sneaky kitty joined you 😼', 'Purrfect timing!'];
const quest = { on: false, cats: [], timer: null };

const levelOf = xp => 1 + Math.floor(Math.sqrt(xp / 60));
function renderHud() {
  const lv = levelOf(S.xp), lo = 60 * (lv - 1) ** 2, hi = 60 * lv ** 2;
  $('#hudLvl').textContent = lv;
  $('#hudXp').textContent = `${S.xp} XP`;
  $('#hudXpFill').style.width = `${Math.min(100, (S.xp - lo) / (hi - lo) * 100)}%`;
  $('#hudDist').textContent = (session.dist / 1000).toFixed(2);
  $('#hudKcal').textContent = Math.round(session.dist / 1000 * S.weight * 0.53);
  $('#hudCats').textContent = session.cats;
}
function addXp(n) {
  const before = levelOf(S.xp); S.xp += n; save();
  if (levelOf(S.xp) > before) toast(`🎉 Level ${levelOf(S.xp)}! The cats are impressed.`, 2800);
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
function popXp(ll, n) {
  const m = L.marker(ll, { icon: L.divIcon({ className: 'xp-pop', html: `<b>+${n} XP</b>`, iconSize: [80, 24], iconAnchor: [40, 24] }), interactive: false, zIndexOffset: 2000 }).addTo(map);
  setTimeout(() => m.remove(), 1000);
}
function spawnCat() {
  if (!me) return;
  let roll = Math.random() * CAT_TYPES.reduce((a, c) => a + c.w, 0), type = CAT_TYPES[0];
  for (const c of CAT_TYPES) { if ((roll -= c.w) < 0) { type = c; break; } }
  const pos = offset([me.lat, me.lon], 40 + Math.random() * 260, Math.random() * Math.PI * 2);
  const cat = { type, pos };
  cat.marker = L.marker(pos, { icon: L.divIcon({ className: 'cat', html: `<span class="r${type.r}">${type.e}</span>`, iconSize: [44, 44], iconAnchor: [22, 22] }), zIndexOffset: 500 }).addTo(map);
  cat.marker.on('click', () => catchCat(cat, true));
  quest.cats.push(cat);
}
function topUpCats() {
  if (!quest.on || !me) return;
  quest.cats = quest.cats.filter(c => { if (dist([me.lat, me.lon], c.pos) > 600) { c.marker.remove(); return false; } return true; });
  while (quest.cats.length < 7) spawnCat();
}
function catchCat(cat, tapped) {
  if (cat.gone) return; cat.gone = true;
  quest.cats = quest.cats.filter(c => c !== cat);
  cat.marker.getElement()?.firstChild?.classList.add('caught');
  setTimeout(() => cat.marker.remove(), 450);
  session.cats++; S.caught++; addXp(cat.type.xp); popXp(cat.pos, cat.type.xp);
  toast(tapped ? pick(TAP_MSGS) : pick(PASS_MSGS)); purr();
  setTimeout(topUpCats, 1500);
}
function questTick(prev, cur) {
  // Measure from the last *counted* point so slow, small GPS steps still add up.
  const a = session.anchor || (session.anchor = cur);
  const d = dist([a.lat, a.lon], [cur.lat, cur.lon]);
  if (cur.acc <= 50 && d >= 5) {
    const v = d / Math.max(.5, (cur.ts - a.ts) / 1000);
    session.anchor = cur;
    if (v <= 3.2) { // walking pace (≤ ~11 km/h)
      session.dist += d; session.xpRem += d;
      if (session.xpRem >= 25) { const n = Math.floor(session.xpRem / 25); session.xpRem -= n * 25; addXp(n); }
    } else if (Date.now() - session.lastSlow > 20000) { session.lastSlow = Date.now(); toast('Whoa, speedy! Quest counts walking only 🚶'); }
  }
  for (const c of [...quest.cats]) if (dist([cur.lat, cur.lon], c.pos) < 20) catchCat(c, false);
  renderHud();
}
function setQuest(on) {
  quest.on = on;
  document.body.classList.toggle('quest-on', on);
  if (on) {
    session.dist = 0; session.cats = 0; session.xpRem = 0; session.anchor = null; renderHud();
    if (nav.dest && nav.mode === 'car') { nav.mode = 'foot'; syncModeSeg(); fetchRoute(); }
    if (me) { map.setView([me.lat, me.lon], 17); following = true; $('#locateBtn').classList.add('on'); topUpCats(); }
    clearInterval(quest.timer); quest.timer = setInterval(topUpCats, 8000);
    toast('Quest mode on — go find some cats! 🐾', 2600);
  } else {
    clearInterval(quest.timer); quest.cats.forEach(c => c.marker.remove()); quest.cats = [];
  }
  syncModeSeg(); syncPanels();
}
// Quest shows the HUD; opening a route swaps it for the route sheet (and the HUD returns when navigating).
function syncPanels() {
  const routeOpen = !!nav.dest && !nav.active;
  $('#sheet').hidden = quest.on && !routeOpen;
  $('#hud').hidden = !quest.on || routeOpen;
  document.body.classList.toggle('hud-on', quest.on && !routeOpen);
}

/* ---------- theme & settings UI ---------- */
function applyTheme(t) {
  const prev = S.theme; S.theme = t; save();
  document.body.dataset.theme = t;
  $('meta[name=theme-color]').content = t === 'light' ? '#ffffff' : '#000000';
  if ((prev === 'light') !== (t === 'light')) applyBase(); else { $('#map').classList.toggle('open-dark', t !== 'light' && !(S.gkey && S.base !== 'open')); applyTraffic(); }
  if ((t === 'quest') !== quest.on) setQuest(t === 'quest');
  if (nav.line.length) nav.line.forEach(l => l.setStyle({ color: getAccent() }));
  syncUI();
}
function syncUI() {
  $$('#themeSeg button').forEach(b => b.classList.toggle('on', b.dataset.theme === S.theme));
  $('#themeHint').textContent = { dark: 'Pitch-black AMOLED. Easy on the eyes and battery.', light: 'Bright and clean for daylight.', quest: 'Walking only. Cats spawn on the map — tap or stroll past them for XP.' }[S.theme];
  const tt = $('#trafficToggle');
  tt.checked = S.traffic && S.theme !== 'quest'; tt.disabled = S.theme === 'quest';
  $('#trafficHint').textContent = S.theme === 'quest' ? 'Off in Quest mode — you’re on foot.' : (trafficAvailable() ? 'Live traffic from Google Maps.' : 'Needs a Google Maps key and a Google map style (below).');
  $('#baseSel').value = S.base; $('#gkey').value = S.gkey; $('#weight').value = S.weight; $('#simToggle').checked = S.sim;
  $('#verLabel').textContent = 'v' + APP_VERSION;
}
function openDrawer(o) {
  $('#drawer').classList.toggle('open', o); $('#drawer').setAttribute('aria-hidden', String(!o)); $('#scrim').hidden = !o;
}
$('#menuBtn').addEventListener('click', () => openDrawer(true));
$('#closeDrawer').addEventListener('click', () => openDrawer(false));
$('#scrim').addEventListener('click', () => openDrawer(false));
document.addEventListener('keydown', e => { if (e.key === 'Escape') openDrawer(false); });
$('#themeSeg').addEventListener('click', e => { const b = e.target.closest('button'); if (b) applyTheme(b.dataset.theme); });
$('#trafficToggle').addEventListener('change', e => {
  if (e.target.checked && !trafficAvailable()) {
    e.target.checked = false;
    toast(S.gkey ? 'Switch map style to Google to see traffic' : 'Add a Google Maps key to enable traffic', 2800); return;
  }
  S.traffic = e.target.checked; save(); applyTraffic();
});
$('#baseSel').addEventListener('change', e => {
  if (e.target.value !== 'open' && !S.gkey) { e.target.value = 'open'; return toast('Paste a Google Maps key first', 2400); }
  S.base = e.target.value; save(); applyBase(); syncUI();
});
$('#saveKey').addEventListener('click', () => {
  const had = S.gkey; S.gkey = $('#gkey').value.trim(); if (!S.gkey) S.base = 'open', S.traffic = false; save();
  toast(S.gkey ? 'Key saved — reloading…' : 'Key removed — reloading…'); if (had !== S.gkey) setTimeout(() => location.reload(), 700);
});
$('#weight').addEventListener('change', e => { S.weight = Math.min(250, Math.max(30, +e.target.value || 65)); e.target.value = S.weight; save(); renderHud(); });
$('#simToggle').addEventListener('change', e => { setSim(e.target.checked); toast(e.target.checked ? 'Simulating a stroll 🚶' : 'Simulation off'); });

/* ---------- locate / sheet ---------- */
$('#locateBtn').addEventListener('click', () => {
  if (!me) { startLocation(); return toast('Looking for you…'); }
  following = true; $('#locateBtn').classList.add('on'); map.setView([me.lat, me.lon], Math.max(map.getZoom(), 16));
  if (!nav.dest && nearbyState !== 'loading' && (!nearby.length || dist([me.lat, me.lon], nearby[0] ? [nearby[0].lat, nearby[0].lon] : [0, 0]) > 3000)) loadNearby();
});
$('#sheetHandle').addEventListener('click', () => $('#sheet').classList.toggle('collapsed'));
new ResizeObserver(() => document.documentElement.style.setProperty('--sheet-h', ($('#sheet').hidden ? 0 : $('#sheet').offsetHeight) + 'px')).observe($('#sheet'));
map.on('click', () => { resEl.hidden = true; if (!nav.active) $('#sheet').classList.add('collapsed'); });

/* ---------- OTA updates (service worker + version.json) ---------- */
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
$('#installUpd').addEventListener('click', () => {
  updStatus('Installing…');
  if (waitingSW) waitingSW.postMessage('SKIP_WAITING'); else location.reload();
});
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

/* ---------- boot ---------- */
renderNearby();
syncUI();
document.body.dataset.theme = S.theme;
applyBase();
if (S.theme === 'quest') setQuest(true);
startLocation();
if (S.sim) setSim(true);
window.__pawmap = { map, S, onPos, quest, nav, spawnCat, catchCat, getMe: () => me };
})();
