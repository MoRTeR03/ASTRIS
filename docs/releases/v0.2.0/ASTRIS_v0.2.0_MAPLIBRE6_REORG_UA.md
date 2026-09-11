# ASTRIS v0.2.0 — Repository Reorganization + MapLibre 6 Globe Renderer Migration

## Причина нового major-baseline

Після `v0.1.20` browser log все ще містив:

```text
performance warning: READ-usage buffer was written, then fenced...
WebGL: too many errors, no more errors will be reported...
_renderErrorTexture
updateErrorLoop
updateGPUdependent
```

Це показало, що проблема не була зведена до ASTRIS VBO. Stack проходив через старий MapLibre globe GPU correction path.

## Root cause

MapLibre v5 використовував runtime correction для GPU latitude precision: періодично рендерив 1×1 framebuffer, робив readback та коригував globe matrix. У сучасній реалізації ця схема видалена; latitude projection переписана через tangent half-angle identities без `atan`/`sin`/`cos` precision correction loop.

Тому ASTRIS переходить з `maplibre-gl 5.24.0` на `6.9.0`.

## MapLibre v6 migration

- ESM-only import;
- Vite worker через `?worker&url` + `setWorkerUrl()`;
- WebGL2 required;
- default import замінено namespace/named imports;
- не використовується internal `map.transform`;
- missing-style-image path використовує `setMissingStyleImageResolver`;
- v5 `easeTo` monkey patch видалено;
- native v6 globe camera handlers використовуються без ASTRIS pointer/center workaround.

## Custom orbital renderer

Renderer тепер компілює shader variant за `args.shaderData.variantName` і вставляє:

```text
shaderData.vertexShaderPrelude
shaderData.define
```

Projection uniforms беруться з:

```text
args.defaultProjectionData
```

3D orbital vertices проектуються через MapLibre `projectTileFor3D`.

CPU більше не перебудовує orbital VBO лише через camera movement або Globe↔Mercator transition.

## Repository cleanup

Додано чіткі домени:

```text
client/src/app
client/src/components/common
client/src/components/map
client/src/styles
client/src/assets/starfield
client/src/map/config
client/src/map/geometry
client/src/map/rendering
server/src
server/test
server/bench
docs/architecture
docs/planning
docs/releases
docs/validation
tools/validation
```

## Acceptance

Обов'язковий live test після `npm install`:

1. `npm run check:map-parity`
2. `npm test`
3. `npm run build`
4. `npm run dev`
5. Globe: rotate / pan / wheel zoom / pitch / double-click
6. Globe ↔ Mercator 20+ разів
7. Labels / Grid / Terrain / Buildings / Day-Night
8. GNSS + Starlink
9. Console: перевірити відсутність v5 `updateErrorLoop` stack

Критичний критерій: старий MapLibre v5 `_renderErrorTexture → updateErrorLoop → updateGPUdependent` loop більше не повинен бути присутнім, бо ASTRIS `v0.2.0` вже не містить MapLibre 5.24.0.
