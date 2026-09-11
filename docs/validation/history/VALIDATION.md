# ASTRIS v0.1.2 — validation

Дата baseline: 2026-09-10.

## Статична валідація release

- `node --check` — PASS для всіх server-side `.mjs` і client `.js` utility/map files.
- TypeScript `transpileModule` JSX parser — PASS для всіх `.jsx/.js` у `client/src`.
- Relative import scan — **0 missing imports**.
- Runtime references `IRMAS` у `client/src` і `server` — **0**.
- Map preview assets — **10/10**.
- root/client/server package versions — **0.1.2**.
- MapLibre label scaling regression: базовий `text-size` кешується на `style.load`; повторна зміна scale не множить вже масштабоване значення.
- Building auto-zoom: увімкнення `3D будівлі` при `buildingAutoZoom=ON` викликає реальний camera `show3d()`.
- Неактивні `renderFps/smoothingMs` controls вилучені з v0.1.2, щоб UI не містив controls без runtime effect.

## Map UI/UX parity acceptance scope

Перевірити після `npm install && npm run dev`:

1. Основний workspace — повнорозмірна MapLibre-карта зі status strip і tools panel.
2. Presets: `2D`, `3D Місто`, `Глобус`, `Орбіти`, `Satellite 3D`.
3. 10 basemap cards із preview перемикаються без втрати orbital overlays.
4. Brightness і label scale змінюються стабільно; повторне scale 100→150→100 не накопичує множення.
5. WGS84 grid: auto/manual step, major lines, labels, palette/opacity/width controls.
6. Globe ↔ Mercator transition зберігає observer, selected satellite та orbital layer.
7. Atmosphere/day-night/space background працюють у globe mode.
8. 3D buildings: material, lighting, opacity, height, min zoom, auto-zoom і recommended view.
9. Terrain/hillshade/exaggeration і camera pitch працюють у flat 3D mode.
10. Center observer / reset / fullscreen / compass / zoom / metric scale працюють.
11. Orbital filters: GNSS constellations + Starlink; `all` / `над горизонтом`.
12. Selected satellite card, orbit, selected coverage, group coverage та LOS lines працюють.
13. IRMAS robot/LiDAR/SLAM/sensor/GSV-SNR controls відсутні.
14. Перезавантаження сторінки відновлює map settings із `localStorage`.

## Що не підтверджено в sandbox

У release немає `node_modules`; повний dependency install / `npm run test` / Vite production build мають бути виконані на локальному ПК із доступом до npm registry. Live map tiles, terrain і external CelesTrak/IP services також потребують мережевого доступу.

```bash
npm install
npm run check
npm run dev
npm run bench:scene
```
