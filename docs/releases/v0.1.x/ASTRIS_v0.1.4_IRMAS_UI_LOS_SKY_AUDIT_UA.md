# ASTRIS v0.1.4 — аудит IRMAS UI / LOS / Sky parity

Дата: 2026-09-10

## Причини дефектів v0.1.3

### 1. Панель налаштувань виглядала незавершеною

ASTRIS мав JSX-компонент на `<details>/<summary>`, але CSS-контракт `CollapsibleMapSection` з IRMAS не був перенесений. У результаті браузер малював майже дефолтні disclosure-заголовки, а користувацька ієрархія меню губилась.

У v0.1.4 disclosure переведено на контрольований React button + conditional body. Візуальний контракт адаптовано з пізнього IRMAS: card border, violet active edge, SVG-chevron, dark body, focus state.

### 2. Білі кнопки та range tracks

Частина кнопок orbital panel не мала базового dark-button contract, тому Chromium застосовував системний фон. Аналогічно `input[type=range]` успадковував браузерний track.

v0.1.4 додає явні `appearance`, border/background/hover/active rules і IRMAS-подібний range track + violet thumb.

### 3. LOS був спрощений

v0.1.3 використовував server-side `visible === true` як єдиний критерій і виставляв однакові `observerGlobeLineOfSight` / `observerLegacyLineOfSight`. Це не відповідало IRMAS.

У v0.1.4 перенесено `OrbitalLineOfSight.js` з WGS84 ECEF-перетворенням та перевіркою перетину відрізка з еліпсоїдом Землі. Повернуто два режими:

- `physical` — фізична пряма видимість по реальній висоті;
- `legacy-scale` — старий прямий режим до візуально стиснутої висоти.

Для Starlink LOS computation має окремий budget 300 ліній; весь 10k+ каталог не проходить повний WGS84 ray-test на кожен UI update.

### 4. Зоряне небо не відповідало IRMAS

v0.1.3 мав статичний декоративний `::before` без camera-linked зміщення і без Sun layer.

v0.1.4 переносить пізню IRMAS модель:

- багатошаровий synthetic starfield;
- background position залежить від center longitude + bearing;
- vertical offset залежить від latitude + pitch;
- roll глобуса обертає зоряний фон;
- zoom змінює scale;
- Сонце рахується за UTC solar subpoint;
- позиція Сонця проєктується відносно поточної globe camera;
- біля краю Землі застосовується плавний fade/occlusion;
- MapLibre day/night light використовує той самий solar time.

## Що не повернуто з IRMAS

Навмисно відсутні:

- GSV / SNR;
- GNSS receiver telemetry;
- РЕБ;
- LiDAR;
- SLAM;
- sensor heatmaps;
- robot route/trail/control.

Вони не належать предметній області ASTRIS.

## Performance contract

Збережено v0.1.3:

- full Starlink catalogue → native WebGL;
- DOM labels/hit targets → budget 360;
- 2D interactive GeoJSON → budget 520;
- LOS → budget 300;
- group coverage → budget 48;
- heavy orbital geometry не перебудовується на кожен `move` frame;
- camera-linked sky update на `move/rotate/pitch/roll` є CSS/lightweight operation.

## Regression gate

```bash
npm run check:ui-parity
```

Перевіряє:

- controlled disclosure UI;
- LOS mode selector;
- persistence `observerLinkMode`;
- WGS84 LOS integration;
- camera-linked starfield;
- Sun layer;
- dark button contract;
- dark range track;
- overhead LOS visible;
- backside LOS occluded.

## MapLibre compatibility references

- Custom layers: https://maplibre.org/maplibre-gl-js/docs/API/interfaces/CustomLayerInterface/
- Sky specification: https://maplibre.org/maplibre-style-spec/sky/
- `Map.setSky()`: https://maplibre.org/maplibre-gl-js/docs/API/classes/Map/#setSky
- Globe atmosphere example: https://maplibre.org/maplibre-gl-js/docs/examples/display-a-globe-with-an-atmosphere/
