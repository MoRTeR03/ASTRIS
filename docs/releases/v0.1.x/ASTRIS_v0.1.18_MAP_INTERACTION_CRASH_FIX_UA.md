# ASTRIS v0.1.18 — Map Interaction Crash Fix

## Root cause

`labelRowsIn2dViewport()` in `OrbitalMap.jsx` called `angularDistanceDeg(...)`, but that helper existed only as a private function inside `AstrisOrbitalLayer.js`. It was neither imported nor defined in `OrbitalMap.jsx`.

Any settings change that executed `syncOperationalData()` could therefore throw a synchronous `ReferenceError`. React then unmounted the failed map subtree; because no Error Boundary existed around the map, the visible workspace could become blank.

## Fix

1. `angularDistanceDeg` is now a pure exported helper in `client/src/lib/geo.js` and is imported explicitly by `OrbitalMap.jsx`.
2. A map-scoped `AstrisMapErrorBoundary` prevents future map-renderer exceptions from clearing the whole ASTRIS UI.
3. Globe wheel zoom uses MapLibre's documented center-anchored handler instead of the v0.1.17 custom wheel shim. Double-click zoom stays disabled on globe.
4. The Chromium `READ-usage buffer...` warning remains observable; it is not suppressed because it is a GPU readback performance diagnostic and not the root cause of the blank page.

## Acceptance

- Open globe mode.
- Click every control in `.astris-map-native-panel`, including Grid, Labels, projection-related options, brightness, graticule and building controls.
- Confirm the page never becomes blank.
- Confirm the console has no `angularDistanceDeg is not defined`.
- Rotate and zoom the globe for at least 2 minutes.
- Confirm no `Easing around a point is not supported under globe projection` is produced by wheel zoom.
- If Chromium still prints `READ-usage buffer...`, record frequency separately; do not classify it as a React crash.
