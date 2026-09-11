# ASTRIS v0.1.2 — IRMAS MapLibre UI/UX parity

ASTRIS успадковує операторську MapLibre-консоль з актуального IRMAS WEB, але без робототехнічних доменів.

## Перенесено та адаптовано

- повноекранну MapLibre-композицію зі status strip і згортною правою панеллю інструментів;
- 5 просторових preset-ів: 2D, 3D Місто, Глобус, Орбіти, Satellite 3D;
- 10 basemap-профілів із preview: OpenFreeMap Dark/Liberty/Bright/Positron, Esri Satellite/Topographic, OSM, CARTO Dark/Light, OpenTopoMap;
- brightness і label scale;
- MapLibre NavigationControl, compass/pitch, ScaleControl metric, FullscreenControl і attribution;
- WGS84 graticule: auto/manual step 30° → 0.01°, major lines, labels, opacity, line widths, label size, 4 palettes;
- 3D buildings: height scale, opacity, min zoom, adaptive/material palettes, lighting profiles, auto-zoom, recommended 3D camera;
- terrain + hillshade + exaggeration;
- camera pitch;
- globe + atmosphere + day/night lighting;
- synthetic space background;
- crosshair/DIM;
- localStorage persistence для map settings;
- orbital native custom layer, синхронізований із MapLibre camera/projection matrix;
- all/above-horizon mode, constellation filters, selected satellite, selected orbit, observer LOS, group/selected coverage;
- окремі tuning controls для point/ring/glow/opacity/altitude scale.

## Замінено для ASTRIS

- IRMAS robot marker → ASTRIS observer marker;
- GNSS receiver position → IP/manual observer;
- IRMAS GNSS catalog semantics → GNSS + Starlink OMM/SGP4 catalog;
- GSV/SNR signal ring → нейтральний orbital outline; колір середини позначає систему/каталог;
- «Слідувати за роботом» → «Центр на спостерігачі»;
- IRMAS map header/status → ASTRIS orbital monitoring status.

## Навмисно не перенесено

- LiDAR overlay;
- SLAM/occupancy/costmap;
- sensor heatmaps і environmental layers;
- robot trail / route / mission controls;
- IRMAS telemetry, GSV/SNR/REB-specific controls;
- drive/autonomy controls;
- camera/media layers.

## Важливе правило

ASTRIS не містить декоративних controls, які не впливають на runtime. Старі `renderFps`/`smoothingMs` orbital sliders не перенесені у v0.1.2, доки v0.2 не отримає справжню client-side continuous orbital interpolation / performance pipeline.

## Performance guards

- group coverage: максимум 48 видимих апаратів одночасно;
- observer LOS: максимум 300 ліній;
- Starlink за замовчуванням вимкнений у першому запуску;
- CelesTrak catalog cache не обходить 2-годинний refresh floor.
