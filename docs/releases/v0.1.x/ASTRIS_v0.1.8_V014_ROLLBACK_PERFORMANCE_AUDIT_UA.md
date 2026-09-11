# ASTRIS v0.1.8 — v0.1.4 UI/UX rollback + orbital performance stabilization

## Source of truth

Visual baseline: **ASTRIS v0.1.4** and the user-provided current **IRMAS WEB client (`WEB_IR.zip`)** for MapLibre/orbital behavior. Later v0.1.5–v0.1.7 CSS layers are not used by production runtime.

## Root cause of visual regression

v0.1.7 loaded the base ASTRIS styles and four additional map override stylesheets. The resulting cascade contained several generations of `astris-map-native-*` rules at the same time. A "rollback" stylesheet appended at the end could not fully reconstruct the v0.1.4 component/CSS contract because earlier overrides still affected layout, controls and responsive behavior.

v0.1.8 uses only:

```text
maplibre-gl/dist/maplibre-gl.css
client/src/styles.css
client/src/map-parity.css
```

The first 63,071 bytes of `map-parity.css` are the exact v0.1.4 file. The first 6,402 bytes of `styles.css` are the exact v0.1.4 file. v0.1.8 appends only scoped fixes for profiles, fixed MapLibre control corners, semantic tones and responsive typography.

## Satellite motion delay

Two latency sources were removed:

1. Scene keyframes were committed with React `startTransition()`, so under a large Starlink update React could postpone the new keyframe even though HTTP had completed. The high-rate scene now calls `setState()` directly.
2. Server/client clock offset used an EWMA (`82% old + 18% new`), which can take several scene polls to converge after timing changes. It now uses the median of the last five request-midpoint samples.

The existing GPU interpolation path remains: globe marker vertices keep current and next SGP4 positions resident in WebGL and interpolate through `u_interp` at the configured render FPS.

## Orbit-line alignment

Cached ECI orbit tracks are not rebuilt at animation-frame cadence. Their Earth-rotation clock update is now adaptive:

- up to 32 tracks: 125 ms bucket;
- 33–96 tracks: 250 ms;
- more than 96 tracks: 500 ms.

This reduces the visible step between a smoothly moving satellite and a small set of orbit tracks without making a large Starlink track scene rebuild hundreds of line strips every frame.

## Starlink performance

The high-rate scene response was compacted:

- per-row `nextAt` / `nextAtMs` were removed because the timestamp is identical for the entire scene;
- per-row velocity, azimuth and range are no longer sent for every satellite; detailed values remain in `selected`;
- world coordinates are rounded to rendering-appropriate precision;
- the existing 15k input / 360 DOM interaction budget and GPU full-scene renderer are retained;
- heavy Starlink scenes use at least a 1500 ms SGP4/JSON snapshot interval while GPU interpolation continues at 20–60 FPS.

This separates **simulation snapshot cadence** from **visual render cadence**.

## MapLibre controls

The v0.1.4 synthetic-space CSS intentionally places the canvas above the star pseudo-element. It also set `.maplibregl-control-container` to `position: relative`, which can make controls appear to shift with layout/camera changes. v0.1.8 overrides only the control container and four MapLibre control corners to absolute pinned positions.

Navigation is bottom-right; metric scale is bottom-left. No invisible Fullscreen/Attribution control groups are created.

## v0.1.4 sky and Sun

The exact v0.1.4 synthetic background is restored, including its layered radial-gradient star field and CSS Sun. `OrbitalMap.jsx` still updates the v0.1.4 variables:

```text
--astris-space-roll
--astris-space-x
--astris-space-y
--astris-space-scale
--astris-sun-x
--astris-sun-y
--astris-sun-opacity
```

## Responsive typography

The map console keeps the v0.1.4 container-query typography. A small extension adds `clamp()` sizing to the top ASTRIS brand, IP-location form, search UI and explanatory copy so larger 2K/4K layouts do not retain tiny fixed 8–11 px text.

## Deliberately retained post-v0.1.4 functionality

- server-backed named profiles in `server/data/astris-profiles.json`;
- profile Save / Load / Delete / Export;
- GPU current/next interpolation;
- Starlink DOM/render budgets;
- physical / legacy LOS;
- full orbit cache and track controls;
- building ownership/style recovery;
- observer marker zoom scaling;
- map information footer.

These are functionality/runtime improvements, not replacement visual systems.
