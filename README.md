# 🐾 Maps and Cats

A map app with **no accounts, no API keys, no tracking backend**. Search, discover nearby places and navigate — all inside the app. The only permission it asks for is **location**.

## Stack (free, keyless, OSM ecosystem)

| Feature | Provider |
|---|---|
| Map | MapLibre GL + OpenFreeMap vector tiles (recoloured to pitch-black AMOLED) |
| Search | Photon + Nominatim, blended (optional Google Places for search only) |
| Routing | OSRM (car: router.project-osrm.org · walking: routing.openstreetmap.de) |
| Nearby places | POIs read straight from the vector tiles — no extra service |
| Voice | Browser/Android TTS, no language packs |

Photon/Nominatim/OSRM can be swapped for your own instances under **Settings → Custom servers**.

## Search logic
- Photon (proximity-ranked, typo-tolerant) and Nominatim (has alt-names Photon lacks) run in parallel. Photon's results come first; Nominatim/Google results within ~111 m of an existing one are dropped (grid-rounded `dedupeKey`).
- **Ranking:** results are scored on text relevance (exact / prefix / word match), real haversine distance, provider agreement (a place both providers return gets a boost) and prominence (landmarks up, side streets down) — not distance alone. Names are requested in your language so "Eiffel Tower" matches the tower, not a local-language variant.
- **Country scoping:** your country is resolved once (cached reverse-geocode). If any result is in your country, the rest are dropped — otherwise the global list is kept, so "Eiffel Tower" from Malaysia still finds Paris.
- **Google (optional):** paste a Places key in Settings to add Google results. Search only — maps and routing never use Google. It is called **only on Enter or when open results look weak**, and a **monthly counter stops at 4,500** (Text Search Pro's free cap is 5,000 — verify current caps) so you never get billed; it then falls back to open search. Google results aren't stored in recents (their terms). Check Google's terms on where Places results may be displayed before shipping commercially.

## Routing logic
- Alternatives shown as cards when OSRM finds genuinely different paths.
- **Avoid highways** sends `exclude=motorway`; the public OSRM demo rejects that (`InvalidValue`), so Maps and Cats retries without it and says so.
- **Multi-stop** with **Optimize order** (nearest-neighbour from your location — a heuristic, not a TSP solver).
- **Auto re-route** after >60 m off the line for two consecutive fixes (point-to-segment distance, so long straight roads don't false-trigger).
- **Offline fallback:** last route to each destination is cached and reused if OSRM is unreachable. If the walking server is down, walking time is estimated from the car network.

## Voice
Each instruction is split by Unicode script, so a Chinese/Japanese/Korean/Hindi/Thai/Arabic/Cyrillic place name mid-sentence gets its own voice. The default segment's language is deliberately left unset (some Android engines drop the whole utterance otherwise). **Test voice** previews the current selection without changing it.

## Map UI
POI clustering below z14.5 (bounded to the viewport, scan-capped) · long-press (550 ms / 10 px) to drop a pin · live scale bar · haptics (Capacitor if present, else Vibration API).

## Quest mode 🐾
Walking only. Cats (Google Noto emoji artwork — the Gboard set) spawn around you — tap one (meow! purr! *let's catch them all!*) or stroll past for XP. Tracks distance walked and rough calories (≈ 0.53 kcal × kg × km). Movement over ~11 km/h is ignored.

## Personalization
Home / Work / up to 5 favorites, recent searches, last 20 trips — plain `localStorage`.

## Traffic
There is no free keyless traffic data. The toggle works with any XYZ raster traffic tile URL you provide under Custom servers.

## Install & updates (not via Google Play)
- **PWA:** host the folder statically (HTTPS), open in Chrome → ⋮ → Install app. OTA: installed copies check for a new version on launch/every 30 min; **Settings → Check for updates**. Ship one with `./bump-version.sh 1.1.0 "notes"`.
- **APK:** `android/` is a small WebView wrapper bundling the app. Built entirely in GitHub Actions (`.github/workflows/apk.yml`, run **Build APK**) — no local Android SDK needed. Debug-signed, sideloadable.

## Develop
```bash
python3 -m http.server 8000   # http://localhost:8000
```
No build step. Settings → **Simulate walking** tests Quest mode from a desktop.

## Logo & icons
`assets/logo/source.jpg` is the master logo. `python3 tools/make-icons.py` (needs pillow, numpy, opencv-python-headless) regenerates every icon: PWA any/maskable/monochrome, favicons, and the Android adaptive icon with a **themed monochrome layer** (Pixel / Material You tinting, Android 13+) plus legacy launcher icons.
