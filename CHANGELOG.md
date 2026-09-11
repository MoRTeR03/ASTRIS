# Changelog

## v0.2.0 — Repository Reorganization + MapLibre 6 Globe Renderer Migration

- reorganized client, server, docs and validation files by responsibility;
- moved all ASTRIS CSS into `client/src/styles/`;
- moved imported starfield assets into `client/src/assets/starfield/` and public favicon/previews into dedicated public folders;
- moved production server code into `server/src/`, preserving tests and benchmarks as separate domains;
- archived all v0.1.x validators and reports under history folders;
- upgraded `maplibre-gl` from 5.24.0 to 6.9.0 and pinned the exact production version;
- configured MapLibre v6 ESM worker correctly for Vite using `?worker&url`;
- migrated default MapLibre import to v6 namespace/named ESM imports;
- removed the v5 `Map#easeTo` monkey patch and returned globe interaction to MapLibre v6 native handlers;
- migrated the custom orbital renderer to the public v6 projection shader contract (`shaderData.vertexShaderPrelude`, `defaultProjectionData`, `projectTileFor3D`);
- orbital geometry now remains in normalized Mercator coordinates and no longer needs CPU reprojection/VBO rebuilds on camera motion or projection changes;
- targets the actual v5 globe GPU latitude-correction/readback path visible in the `_renderErrorTexture → updateErrorLoop → updateGPUdependent` stack;
- retained ASTRIS ports 5174/3101, provider failover, persistent cache, label-expression fix and map-scoped React Error Boundary.

## v0.1.20 — Globe Camera + GPU Buffer Stability

- added a globe-safe camera guard that strips unsupported `around` targets from any `easeTo()` call while the globe projection is active;
- configured wheel, touch zoom/rotate and touch pitch to use center-anchored globe interaction, disabled globe double-click zoom, and set `aroundCenter: false` for predictable desktop rotation;
- switched the MapLibre WebGL context to the high-performance, non-MSAA path (`powerPreference: high-performance`, `antialias: false`, `preserveDrawingBuffer: false`);
- replaced single-buffer orbital VBO rewrites with a 4-slot GPU streaming ring using `STREAM_DRAW` + `bufferSubData`, avoiding immediate rewrite of the buffer used by the previous frame;
- removed synchronous per-frame `gl.getParameter()` state readbacks and stale MapLibre-owned state rebinding from the custom orbital layer;
- converted custom orbital output to premultiplied alpha so the renderer can use MapLibre's documented custom-layer blend contract;
- removed redundant repaint requests during map motion and after native orbital clock updates;
- retained the v0.1.19 dedicated-port and MapLibre label-expression fixes.

## v0.1.19 — Runtime port isolation + MapLibre label-expression fix

- moved default ASTRIS dev ports to `5174` (client) and `3101` (API) to avoid collisions with the IRMAS baseline (`5173` / `3001`);
- Vite now uses `strictPort: true` and an explicit `/api` proxy target;
- added clear `EADDRINUSE` diagnostics for the API server;
- fixed MapLibre `text-size` scaling: zoom camera expressions remain top-level `step`/`interpolate` expressions instead of being wrapped in `["*", expression, scale]`;
- added safe scaling for numeric, `step`, `interpolate`, `let`, and data-only text-size expressions;
- added label-layout write deduplication during style-restore retries to reduce repeated validation/render churn.

## 0.1.18 — Map interaction crash containment

- Fixed the fatal `ReferenceError: angularDistanceDeg is not defined` in `OrbitalMap.jsx` by promoting the great-circle helper to `client/src/lib/geo.js` and importing it explicitly.
- Fixed panel-triggered blank-page crashes: settings changes can safely rebuild 2D label rows again.
- Added a map-scoped React Error Boundary so a future renderer failure cannot clear the whole ASTRIS operator UI.
- Replaced the custom globe wheel shim with MapLibre's supported center-anchored `scrollZoom.enable({ around: 'center' })`; globe double-click zoom remains disabled to avoid unsupported pointer-anchored easing.
- Kept the Chromium READ-usage warning classified as an upstream WebGL/MapLibre performance warning, not the cause of the React blank page.

# ASTRIS v0.1.17 — Provider Failover + Globe/WebGL Stability

- Added CelesTrak → Satvisor OMM mirror failover for cold-start catalog recovery.
- Preserved two-hour primary-provider refresh floor and persistent last-known-good cache.
- Sanitized provider HTML errors so raw 403 pages do not leak into the dashboard.
- Replaced globe pointer-anchored wheel/double-click zoom with camera-centered easing.
- Added generic local fallback for unresolved style sprites to avoid repeated error-texture churn.
- Kept MapLibre pinned to 5.24.0; no risky v6 migration in this hotfix.
- Preserved accepted v0.1.16 synthetic sky/Sun behavior and orbital layer logic.

# ASTRIS v0.1.16 — Provider Resilience + Globe Sky Recovery

## Fixed
- Stopped the `/api/orbits/scene` request storm when CelesTrak is unavailable. The server now keeps provider failure state and the client respects `Retry-After`/exponential backoff.
- CelesTrak 403/429 responses now open a minimum two-hour circuit breaker instead of being retried by every scene poll.
- Last-known-good GNSS/Starlink OMM data remains usable as stale cache when upstream refresh fails.
- Catalog cache moved to a persistent OS location so clean ASTRIS source upgrades no longer discard the last successful download. Legacy project-local cache is migrated when present.
- IP observer now has `ipapi.co → ipwho.is → disk cache → browser last observer` fallback layers.
- Restored the accepted pre-sidereal Sun projection behavior from v0.1.12.
- Replaced the finite MapLibre star background with three independent large repeating star catalogues, eliminating visible image edges/empty space and making the sky respond to both center drag and bearing/roll.
- Added MapLibre v5-compatible `styleimagemissing` handling for missing `circle-N` sprites, with a feature-detected v6 resolver path.

## Diagnostics
- Catalog 503 responses now expose catalog name, upstream HTTP status, retry delay and catalog status.
- `/api/catalog/status` exposes stale/degraded/failure/cooldown state.
- New validator: `tools/validate-v0116.mjs`.

---

# ASTRIS v0.1.15 — Live Labels Recovery + v0.1.5 Quick Actions

## Fixed
- Map label toggles no longer force a full `setStyle()` cycle. Vector labels are changed in-place; raster layers with a no-label variant use `RasterTileSource.setTiles()`.
- Orbital labels have a dedicated immediate apply path in both 2D and Globe. Enabling labels invalidates the viewport label selection and schedules an immediate custom-layer repaint instead of waiting for a scene refresh, camera gesture or page reload.
- Globe label refresh now explicitly resets label projection cadence and viewport selection when the label switch changes.
- Clean-source regression baseline retained for 3D buildings; Globe and 3D buildings remain independent.

## Restored
- `astris-map-native-quick-actions` restored exactly to the v0.1.5 icon-first Lucide presentation: `LocateFixed`, `Grid3X3`, `Tags`, `RefreshCw`, compact 14px icons and 30px control height.

## Release rule
- v0.1.15 was built from the clean v0.1.14 FULL SOURCE, not from a stacked patch tree. For browser acceptance, use the FULL SOURCE in a new directory.

---

# ASTRIS v0.1.14 — Globe Buildings, Labels, Celestial Sky & Brand Parity

## Fixed
- Satellite labels now have a dedicated viewport-budgeted MapLibre source in 2D, isolated from basemap symbol collisions.
- Globe DOM labels recover from transient projection/style matrices instead of remaining empty.
- Enabling 3D buildings no longer forces Mercator/2D mode.
- Removed settings normalization that silently disabled buildings whenever globe mode was enabled.
- 3D building ownership/lifecycle now runs in globe projection as well as Mercator.
- Profile action buttons are vertically centered in the global profile manager.
- Starfield now follows camera bearing and advances with sidereal time; the Sun remains UTC-driven.
- Map space background uses the same near-black visual base as the accepted entry loader.

## Restored / changed
- `astris-map-native-quick-actions` restored to the compact v0.1.4 text/glyph presentation.
- Favicon replaced with the exact Lucide `Orbit` glyph used by the current ASTRIS `brand-mark`, without frame/background.

## Preserved
- Starlink GPU catalogue path and DOM/label budgets.
- Native MapLibre compact attribution `(i)` plus ASTRIS technical info window.
- Observer/track/LOS interpolation, profiles, loader and accepted v0.1.13 star catalogue.
