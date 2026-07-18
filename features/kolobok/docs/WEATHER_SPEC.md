# WEATHER_SPEC.md — live weather and true daylight

The scene mirrors the user's real sky: actual weather (clear, clouds, rain,
snow, fog, storm) and the true position of the sun — sunrise, golden hour,
day, sunset, twilight, night — computed from the device's location and time.
This REPLACES the fixed hour table in ART_SPEC §8 as the driver; the §8
palette rows remain the color anchors that get blended.

## 1. Services (`src/services/`)

### location.js
- `expo-location`: request foreground permission ONCE on first launch with a
  friendly rationale (strings key `weather.permission`). Low accuracy is
  fine (`Accuracy.Lowest`) — we need a city, not a street.
- Cache last known coords in memory. If denied or unavailable → return
  `null`; everything downstream falls back gracefully (see §5).

### weather.js
- Fetch Open-Meteo (free, no API key):
  `https://api.open-meteo.com/v1/forecast?latitude={lat}&longitude={lon}`
  `&current=temperature_2m,weather_code,cloud_cover,is_day`
  `&daily=sunrise,sunset&timezone=auto`
- Refresh: on launch, on app foreground, and every 30 min while active.
  Debounce: never more than one request per 5 min.
- Expose `{ weatherCode, cloudCover, sunrise, sunset, fetchedAt }` via a
  transient object (like `orbit`) — per-frame consumers read it without
  re-renders; a `weatherState` string goes to the zustand store as a
  discrete event when the mapped state CHANGES.

### sun.js
- NOAA-style solar position approximation (pure math, ~30 lines, no deps):
  from lat/lon + UTC time compute solar **elevation** and **azimuth**.
  Recompute once per minute (not per frame).
- Map elevation → day phase bands, blending palettes continuously:
  - elevation < −8°: `night`
  - −8°…0°: twilight — blend `night` ↔ `sunrise/sunset` colors (below)
  - 0°…10°: golden hour — blend toward `morning` (before noon) or
    `evening` (after noon)
  - > 10°: `day`
- Extra palette rows to ADD to `config/atmosphere.js` for the twilight blend:

| phase   | zenith    | horizon   | dirLight  | dirInt | ambient | fog       |
|---------|-----------|-----------|-----------|--------|---------|-----------|
| sunrise | `#8fa0c8` | `#f2b98a` | `#ffd9b0` | 0.7    | 0.45    | `#d8b9a0` |
| sunset  | `#6f74a8` | `#f09a6a` | `#ffb886` | 0.7    | 0.45    | `#d09a84` |

- The sun/moon meshes (ART_SPEC §7) are placed at the computed azimuth
  (relative to the camera's world, not the island spin — the sky does not
  rotate with the turntable) and elevation on the dome radius. Moon azimuth
  = sun azimuth + 180°, shown when sun elevation < 0°.

## 2. Weather states (WMO `weather_code` → scene)

| codes | state | scene changes |
|-------|-------|---------------|
| 0 | `clear` | baseline; clouds 2, opacity 0.7 |
| 1–2 | `partly` | clouds 5, opacity 0.85 |
| 3 | `overcast` | clouds 8, gray tint `#c8ccd2`, dirInt ×0.8, ambient +0.05, sky desaturated 20% (lerp zenith/horizon toward `#aab4bd`) |
| 45,48 | `fog` | fog near 8 / far 20, wolf-style wisps spawn island-wide (8), dirInt ×0.7 |
| 51–67, 80–82 | `rain` | rain particles ON (§3), clouds 7 dark `#8a94a2`, dirInt ×0.7, sky toward overcast tint, path ring darkened `#a5825a` |
| 71–77, 85–86 | `snow` | snow particles ON (§3), snow caps ON (§4), ambient +0.1, ground vertex colors lerp 25% toward `#e8ecf0` |
| 95–99 | `storm` | rain state + clouds 8 near-black `#5a616e`, dirInt ×0.55, every 8–20 s a lightning beat: sky + ambient flash to white 80 ms, decay 250 ms |

Transitions between states lerp over 4 s (particle counts ramp, colors
lerp) — weather never pops.

## 3. Precipitation particles (extend ART_SPEC §9)

- **Rain**: one Points system, 220 points, spawn in a disc r=9 at height
  7–9, fall speed 9/s with slight slant (wind x +0.6/s), respawn at top;
  color `#aebfd0`, size 0.05, opacity 0.55. Rendered as short vertical
  streaks via a 2×8 px DataTexture sprite.
- **Snow**: 160 points, fall 1.1/s with sine drift (±0.3, per-point phase),
  slow tumble via size pulse ±15%; color `#ffffff`, size 0.08, opacity 0.9.
- Both obey sleep mode (halve counts) and pause with the frameloop.

## 4. Snow caps (toggle with `snow` state, fade scale-in 4 s)

Pre-built, hidden by default: white flattened spheres/boxes sitting on —
izba roof slabs (2), chimney top, spruce tier tops (instanced, matching
tree matrices), the crossroads stone crown, path ring lightened 15%.
Color `#f2f5f8`, roughness 1.

## 5. Fallback chain (must never block the scene)

1. Location denied/unavailable → skip weather fetch; day phase from the
   device clock using the original ART_SPEC §8 hour table; state `clear`.
2. Location OK, network fails → use last in-memory fetch if < 3 h old,
   else clock table + `clear`.
3. Open-Meteo returns unknown code → `partly`.
4. Dev overrides: `weather.force = 'snow'` etc. and
   `atmosphere.forcePhase` must both work for testing every state.

## 6. Acceptance

- With location granted, the in-scene sun rises/sets within a few minutes
  of the API's sunrise/sunset for the user's actual location, and passes
  through sunrise/golden/day/sunset/twilight/night blends.
- Forcing each of the 7 weather states shows the mapped changes and 4 s
  transitions; storm flashes are visible but not seizure-rapid (≥ 8 s gaps).
- Airplane-mode cold start still renders a correct clock-based scene.
- No more than one network request per 5 min; none when backgrounded.
