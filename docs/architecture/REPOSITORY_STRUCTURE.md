# ASTRIS Repository Structure

## Принцип

У `v0.2.0` файли групуються за відповідальністю, а не за історією появи.

## Client

### `client/src/app/`
React entrypoint і application shell.

### `client/src/components/common/`
Загальні UI-компоненти, що не належать одному домену карти.

### `client/src/components/map/`
React UI, який безпосередньо керує map scene та map controls.

### `client/src/styles/`
Усі глобальні/компонентні CSS-файли ASTRIS.

Нові `.css` не слід класти в `src/` root або поруч із `.jsx`, якщо вони не є CSS Modules.

### `client/src/assets/`
Imported/static source assets, які проходять через Vite pipeline.

### `client/public/`
Файли зі стабільним public URL: favicon, map preview thumbnails тощо.

### `client/src/map/config/`
Map settings, map layer catalog, view presets, map-related state contracts.

### `client/src/map/geometry/`
Чиста/майже чиста geometry: coverage, LOS, day/night mathematics.

### `client/src/map/rendering/`
WebGL2 renderer, projection bridge і GPU-specific code.

### `client/src/lib/`
Невеликі shared utilities, які не належать одному component/domain.

### `client/src/profiles/`
Map/profile persistence hooks.

## Server

### `server/src/`
Production Node.js runtime.

### `server/src/routes/`
HTTP/API contracts and query validation.

### `server/src/services/`
Business/domain services: catalogs, observer location, profiles.

### `server/test/`
Node test suite.

### `server/bench/`
Performance/benchmark tools.

### `server/cache/`, `data/`, `reports/`
Runtime-generated/project-local fallback storage. Generated files are excluded by `.gitignore` except `.gitkeep`.

## Documentation

### `docs/architecture/`
Long-lived architecture and repository documentation.

### `docs/planning/`
Roadmaps and planning notes.

### `docs/releases/<version>/`
Release-specific technical notes.

### `docs/validation/current/`
Current baseline validation output.

### `docs/validation/history/`
Historical reports only; they are not authoritative for current paths.

## Tools

### `tools/validation/current/`
Only validators used by the current `package.json` scripts.

### `tools/validation/history/`
Historical validators preserved for traceability.

## Rule of thumb

```text
UI component?        → client/src/components/
CSS?                 → client/src/styles/
Image/SVG imported?  → client/src/assets/
Stable public asset? → client/public/
Map math?            → client/src/map/geometry/
GPU/WebGL?           → client/src/map/rendering/
Map config/state?    → client/src/map/config/
Node production?     → server/src/
Test?                → server/test/
Benchmark?           → server/bench/
Current validator?   → tools/validation/current/
Historical document? → docs/.../history or releases/<old-version>/
```
