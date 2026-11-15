# 🐾 Pawmap

A map app with **no sign-up and no Google Play**. Search, discover nearby places and navigate — all inside the app. The only permission it asks for is **location**.

- **Auto-detects where you are** on launch and recommends nearby food, coffee, parks, sights and shops.
- **In-app search & turn-by-turn navigation** (drive or walk). Nothing hands off to another app.
- **Pitch-black AMOLED** dark theme, plus Light and **Quest** mode.
- **Hamburger settings**: mode (Dark / Light / Quest), traffic toggle, map style, over-the-air updates.
- **Quest mode** — walking only. Cute cats spawn around you; tap one (meow! purr! *let's catch them all!*) or stroll past it to earn XP. Tracks distance walked and rough calories burned.

## Maps & keys

| Feature | Provider | Key? |
|---|---|---|
| Base map | OpenStreetMap data, CARTO tiles | No |
| Search | Nominatim | No |
| Routing | OSRM (routing.openstreetmap.de) | No |
| Nearby places | Overpass API | No |
| Google roadmap / satellite / **live traffic** | Google Maps JS API | Optional — paste your own key in Settings. It stays on your device. |

Traffic needs the optional Google key (there is no free keyless traffic source). Everything else works out of the box.

## Install (not via Google Play)

Pawmap is a Progressive Web App. Host it anywhere static (a GitHub Pages workflow is included — enable **Settings → Pages → GitHub Actions**), open the URL in Chrome on Android, then **⋮ → Install app**. It gets its own icon, runs full-screen and works offline for the app shell.

> Geolocation needs HTTPS (GitHub Pages is) or `localhost`.

## Over-the-air updates

Installed copies check for a new version on launch and every 30 minutes. **Settings → Check for updates** forces a check; when one is ready you get a dot on ☰ and an **Install & restart** button. To ship an update:

```bash
./bump-version.sh 1.1.0 "What's new"
git commit -am "Release 1.1.0" && git push
```

## Develop

```bash
python3 -m http.server 8000   # then open http://localhost:8000
```

No build step, no dependencies to install (Leaflet is vendored). In Settings turn on **Simulate walking** to test Quest mode from a desktop.

## Notes

- Calories use ≈ 0.53 kcal × kg × km for walking; set your weight in Settings.
- Quest ignores movement faster than ~11 km/h so driving doesn't farm XP.
- Public routing/search/places servers are shared community services — fine for personal use; self-host them if you ship widely.
