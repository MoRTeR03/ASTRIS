# ASTRIS v0.1.20 → v0.2.0 migration

## Рекомендований спосіб

Через повну реорганізацію директорій рекомендовано **замінити старий source на FULL SOURCE v0.2.0**, а не накладати його поверх `v0.1.20` без очищення.

Причина: значна частина файлів не просто змінена, а **переміщена**. Якщо залишити старі шляхи, Git/IDE бачитиме дублікати історичного і поточного коду.

## Старі активні шляхи, які більше не використовуються

```text
client/public/astris-favicon.svg

client/src/App.jsx
client/src/main.jsx
client/src/styles.css
client/src/entry-loader.css
client/src/map-parity.css

client/src/assets/astris-loader-starfield.svg
client/src/assets/astris-map-starfield.svg
client/src/assets/astris-map-starfield-a.svg
client/src/assets/astris-map-starfield-b.svg
client/src/assets/astris-map-starfield-c.svg

client/src/components/AstrisEntryLoader.jsx
client/src/components/AstrisMapErrorBoundary.jsx
client/src/components/AstrisMapWidget.jsx
client/src/components/AstrisOrbitalLayer.js
client/src/components/OrbitalMap.jsx

client/src/map/MapSettingsStore.js
client/src/map/OrbitalCoverageFootprint.js
client/src/map/OrbitalLineOfSight.js
client/src/map/dayNightModel.js

server/index.mjs
server/routes/
server/services/

tools/validate-v*.mjs
```

Історичні `docs/*.md`, `docs/VALIDATION_*` та `RELEASE_VALIDATION.txt` у `v0.2.0` теж розкладені за:

```text
docs/architecture/
docs/planning/
docs/releases/
docs/validation/history/
```

## Нові canonical paths

```text
client/src/app/
client/src/components/common/
client/src/components/map/
client/src/styles/
client/src/assets/starfield/
client/src/map/config/
client/src/map/geometry/
client/src/map/rendering/

server/src/
tools/validation/current/
tools/validation/history/
```

Повний опис структури:

```text
docs/architecture/REPOSITORY_STRUCTURE.md
```

## Після міграції

```bash
npm install
npm run check:map-parity
npm test
npm run build
npm run dev
```

Очікувані dev endpoints:

```text
Client: http://localhost:5174
API:    http://localhost:3101
```
