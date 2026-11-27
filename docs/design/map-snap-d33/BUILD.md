# D33 build spec: Snap-style fast map (plan task 1.20)

Approved by the owner on 26 Nov ("Build D33"): MapLibre (free) on the phone, 3D buildings at street zoom.
Design: `map-d33.html` (published as artifact LsPjYfvQbp7FCbiRktMAYM). Every current map feature must stay: `FEATURES.md` (37 items). If a step would drop one, stop and report.

## The idea in one paragraph

Today the phone map is react-native-maps (Google). Every pin is a React view snapshotted into a bitmap, the whole map re-renders on every camera stop, and a 15-per-second clock re-renders it again for ripples and the intro. That is the lag. D33 moves the phone to **MapLibre Native** (`@maplibre/maplibre-react-native` 11.5.1, new architecture), the same engine and OpenFreeMap styles the web already uses. The rules that decide *what* is shown (groupPins → layoutPins → pinLabels → offersOf, all in `lib/` and `components/MapPinLayer.tsx` / `JobsMap.tiles.tsx`) do not change, so every feature keeps working. What changes is *how* it is drawn:

- **Pins** (price pins, task pins with faces, helper service-icon pins, face stacks, promoted pins, You marker) stay the existing `MapMarkers.tsx` components, drawn as MapLibre `Marker` (a real native view the engine moves itself on Android; no snapshot, faces and motion just work). Grouping already caps them at what fits on screen (~50), never one per raw pin.
- **Everything else** (reach ring, spread-area circles, heat glow, "Approximate area" circle, 3D buildings) is engine-drawn style layers from GeoJSON: `lib/mapLayers.ts` (shared, tested, already written). Web and phone use the same layer specs.
- **Motion** moves into each pin (RN `Animated` with the native driver), so nothing re-renders the whole map per frame.

## Units (easy to get wrong)

- MapLibre zoom (both engines) counts 512 px tiles. `lib/mapLayout`, `lib/mapReach`, `lib/mapCluster`, `MapPicker.tiles` count 256 px tiles: app zoom = GL zoom + 1 (`glToTile` / `tileToGl` in `lib/mapLayers.ts`, `GL_TO_TILE` in `GlMap.web.tsx`). `SPREAD_ZOOM` 14 = GL 13. `MAX_ZOOM` from `JobsMap.tiles` is an app zoom.
- The layout runs in screen pixels with the flat projection (`project`/`unproject` from `MapPicker.tiles`) at the app zoom and the camera centre. Under 3D tilt this is approximate; that is fine (only grouping and spread use it; pins are placed by the engine at their lng/lat).

## Privacy (must not break)

- Keep reading the same published fields (`lat`/`lng` on the pins = rounded spots, `map_people_around` for people). Never ask for or draw an exact location.
- Helpers stay a service icon until tapped: no photo, no name on the map (D13).
- Guests never call the people path.
- `lib/useMapSpot.ts` / `lib/mapSpot.ts` untouched.

## Steps

### Step A [opus] Shared layers. DONE
`lib/mapLayers.ts` + `lib/mapLayers.test.ts`: `sceneShapes()` (GeoJSON for ring / areas / glow / approx circle + label), `shapeLayers()` (style-spec layers, bottom to top), `buildingLayer()` (3D, from GL zoom 15), `tiltAfterZoom()`, zoom unit helpers.

### Step B [sonnet] Phone map on MapLibre Native
1. `npm install @maplibre/maplibre-react-native@11.5.1 -w apps/mobile` (exact version). Add `"@maplibre/maplibre-react-native"` to the Expo plugins (app.json, or `app.config.js` next to the existing plugin handling). Read the v11 docs (context7 `/maplibre/maplibre-react-native/v11.5.1`) for `Map`, `Camera` (ref: `flyTo`, `easeTo`, `fitBounds`), `GeoJSONSource`, `Layer` (`type`, `paint`, `layout`, `beforeId`/below-layer prop), `Marker` (`lngLat`, `anchor`), region events (`onRegionDidChange`, user-interaction flag), `contentInset` / camera padding.
2. Rewrite `components/JobsMap.native.tsx` on MapLibre. Same `JobsMapProps`, same behaviour for every prop (`me`, `pins`, `selectedId`, `onSelect`, `height`, `ringKm`, `tone`, `focusId`, `onExpand`, `fill`, `dim`, `onMoveEnd` (user gestures only), `startAt`, `startZoom`, `fit`, `ringAt`, `bare`, `meKind`). Keep:
   - Expo Go → `TileJobsMap` (MapLibre's native module is not in Expo Go). Also fall back to `TileJobsMap` if the native module is missing at runtime (an older APK that gets this JS).
   - Style: `glStyleUrl(isDark)` from `GlMap.web.tsx` (move it to a shared non-web file, e.g. `lib/mapStyle.ts`, and import it from both). Attribution on (licence), MapLibre logo off. No rotation. Min/max zoom same as today (converted to GL).
   - Layout: on region did-change, set `{ centre, glZoom, pitch }` state; run the same pipeline as today (byOffer → project at app zoom → in-view filter → groupPins → layoutPins → offersOf → pinLabels → introDelays) only then, never per frame.
   - Pins: one `<Marker>` per layout item, rendering the same `MapMarkers` component as today with the same props, keys, z-order (`zIndex` on the marker view), faded (`dim`), labels/`dx`/`hidePlace`, accessibility labels, anchors (`box.anchor / box.h` → use `anchor` + `offset` so the pin's point sits on the place). Drop `useSnapshot`/`tracksViewChanges` entirely.
   - Shapes: `sceneShapes()` with the same layout → four `GeoJSONSource`s (`SRC.*`) + `shapeLayers()` placed below the base style's first symbol layer; `buildingLayer(isDark)` from the base vector source. Colours from theme tokens: `hue` = today's `hue`, `ring` = today's `blue`, `ink` = `t.colors.ink`, `halo` = `t.colors.bg`.
   - Camera: start, fly to `me` once, `fit` (use `zoomToFit` from `lib/mapReach` → GL zoom, or `fitBounds` of the circle's box with padding), `focusId`, group tap = fly to `max(round(appZoom)+2, SPREAD_ZOOM)` (GL-converted) over ~600 ms, zoom buttons, "Back to my area". Reduced motion → duration 0. `fill` insets → camera padding/content inset so the uncovered part is the centre (as `mapPadding` did).
   - 3D: touch pitch on; after a zoom ends, `tiltAfterZoom(glZoom, pitch, reduced)` → ease pitch.
   - Overlay notes (legend, privacy line, controls) unchanged; the privacy line no longer needs to dodge the Google logo.
   - Remove the 15-per-second `useMapClock` re-render on the phone: ripple, intro and pulse move into the pins in Step D. Until then pins may simply appear without intro.
3. Rewrite `components/MapPicker.native.tsx` on MapLibre the same way (same props/behaviour, Expo Go fallback stays).
4. When nothing imports `react-native-maps` any more: remove the dependency and its plugin + key handling in `app.config.js` (keep Sentry handling exactly). Check `MapPicker.tiles.tsx` only mentions it in a comment.
5. `npm run check` green (from repo root). Report what you could not verify (no phone run in this step).

### Step C [sonnet] Web map on the shared layers
In `components/JobsMap.web.tsx` / `GlMap.web.tsx` / `MapPinLayer.tsx`:
1. Draw the reach ring, spread areas, heat glow and "Approximate area" circle with `sceneShapes()` + `shapeLayers()` (sources added once after style load and again after a theme style swap), replacing the CSS ring, CSS heat discs and CSS area circles. Pins stay the React overlay.
2. Add `buildingLayer(isDark)`; enable touch/drag pitch (`touchPitch`, `pitchWithRotate` stay off for rotation; use `maxPitch` 60) and `tiltAfterZoom` after zoom ends. Keep `noRotation`.
3. Speed: during `move`, do not re-run grouping/labels; re-project the existing items only. Re-group on `moveend`. (Pins must stay glued to the map while it moves.)
4. `npm run check` green; web e2e on port 8123 (`docs` / memory: map e2e) still green.

### Step D [sonnet] Motion inside the pins (both engines), reduced motion
In `MapMarkers.tsx` (shared by web and phone), with RN `Animated` + `useNativeDriver: true`, all off under `useReducedMotion()`:
- **Intro**: each pin fades and scales in after its `introDelays` delay, once per new set of things (not on map moves).
- **Burst / fold**: a pin that just became part of a spread starts at its group centre (pass the pixel offset centre − spot) and springs out over `SPREAD_MS` (450 ms); on fold the group pin scales in. If the Android `Marker` clips the moving child, fall back to fade + scale from the centre and say so.
- **Just posted ripple**: a ring view inside the task pin (max 2 fresh, `rippleAt` timing: 3.6 s loop, 20 → 50 px, fading), replacing the map-wide clock on the phone and the clock-driven ring on web.
- **Active-now dot pulse** on helper pins and face stacks (soft, ~1.6 s loop).
- **Approximate area** circle fades in (already in the layer transition).
Remove `useMapClock` from the map components once nothing needs it (keep the file if anything else imports it).

### Step E [sonnet] Tests and the 2,000-pin speed check
- Unit tests for any new pure helpers. `npm run check` green.
- A dev-only way to load 2,000 fake pins on the map (never in production builds; behind `__DEV__` or an e2e flag).
- Web: an e2e that flies the camera round with 2,000 pins and records frames per second via `requestAnimationFrame`; report the median and worst 1 % frame time. Target ≥ 50 fps median on the dev machine.
- Phone: same fly-round on the CPH2585 with the local build (Step G); report what the RN perf monitor / `adb shell dumpsys gfxinfo <package>` shows (janky frames %).

### Step F [sonnet] Feature check on web
Walk all 37 items in `FEATURES.md` on the web build (port 8123), Earn and Hire, signed in and guest, light and dark, phone width and desktop. Report a table: item → pass / fail / not checkable on web.

### Step G [sonnet] Local Android build and phone check
Local build route in memory note `local-android-build.md` (C:\tdb, `C:\td-tools\b5\lb.mjs`; traps: EXPO_PUBLIC vars, google-services.json). The Google Maps key trap goes away with react-native-maps. Install on the CPH2585 over adb, walk the phone-checkable items of `FEATURES.md`, run the speed check. **Do not** upload the APK to the site or publish an OTA: the owner is asked first.

### Step H [opus] Review and merge
Diff review, `security-review` on the diff (rule 9), `npm run check`, PR into `redesigned-2.0`, merge, plan 1.20 updated (ULTIMATE_PLAN.md + HTML).

## Done means
- Phone and web maps run on MapLibre with the same look; pans and zooms are smooth with 2,000 pins.
- All 37 features pass (or are listed with a reason).
- No react-native-maps, no Google Maps key in the Android app.
- New APK built locally and checked on the phone; OTA / site APK waiting for the owner's OK.
