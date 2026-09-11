# ASTRIS v0.1.3 — IRMAS Map Runtime Parity

## Причини регресій v0.1.2

1. Starlink до 12–15 тис. рядків дублювався у React state, GeoJSON та native WebGL, а native overlay створював DOM-кнопку для кожного супутника.
2. `map.on("move")` оновлював React state на кожному кадрі жесту.
3. Projection preset змінював `globe`, але не повертав IRMAS camera zoom/pitch/bearing preset.
4. `setProjection()` викликався у кількох незалежних місцях без idle/style recovery.
5. Пошук входив у великий `/api/orbits/scene`, тому кожен ввід у search поле запускав масову SGP4 propagation.
6. У v0.1.1 orbit track був змінений на Earth-fixed ground track, тоді як стабільний IRMAS globe використовував inertial orbit at scene GMST + renderer Earth-rotation compensation.

## Виправлення

- Native GPU layer малює повний каталог у Mercator і Globe.
- DOM interactivity/labels обмежено 360 пріоритетними апаратами; selected + GNSS завжди мають пріоритет.
- GeoJSON interaction layer обмежено 520 апаратами; важкі circle layers не дублюють native GPU points.
- Starlink scene poll: 5 s; GNSS-only: 1 s.
- React runtime map state оновлюється лише на `moveend`.
- Під час camera gesture native geometry не перебудовується на кожному zoom frame; після `moveend` projection cache інвалідовується.
- Додано `idle/styledata` projection guard і custom-layer restore.
- Presets знову застосовують IRMAS camera profile (`globe ≈ z0.4`, orbital overview, city/satellite 3D zoom+pitch).
- Пошук винесено в `/api/orbits/search`, без SGP4 propagation.
- 3D selected orbit повернено до `eci-orbit-at-scene-gmst` semantics.

## Свідомі бюджети

- full scene GPU rows: до 12 000 зі Starlink;
- interactive GeoJSON: до 520;
- globe DOM hit/label markers: до 360;
- LOS: до 300;
- coverage: до 48.

Це повторює ключовий принцип IRMAS: повний orbital catalogue не має автоматично ставати повним DOM/GeoJSON catalogue.
