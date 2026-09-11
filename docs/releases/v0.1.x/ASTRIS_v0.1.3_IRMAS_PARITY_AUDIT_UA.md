# ASTRIS v0.1.3 — аудит runtime-паритету з IRMAS

## Мета

Виправити дві регресії ASTRIS v0.1.2, яких не було у стабільній IRMAS MapLibre-сцені: сильне зависання після увімкнення Starlink та нестабільне перемикання 2D / Globe / 3D City / Satellite 3D.

## Встановлені причини

### Starlink

У v0.1.2 один і той самий великий каталог одночасно існував як React state, повний GeoJSON, native WebGL geometry та DOM-кнопка для кожного супутника. Пошук також був частиною `/api/orbits/scene`, тому введення тексту могло повторно запускати масову SGP4 propagation. Додатково `map.on("move")` оновлював React state на кожному кадрі gesture.

### Projection / camera lifecycle

ASTRIS змінював projection, але не застосовував camera preset, який використовує IRMAS. Через це після 3D City карта могла перейти в globe, лишившись на міському zoom/pitch. Також не вистачало IRMAS-подібного `idle/styledata` recovery і custom-layer restore.

### CSS

Глобальний stylesheet містив старий pre-parity layout одночасно з новим IRMAS-подібним map-console CSS. Це створювало конфлікт двох дизайн-систем.

## Реалізовано

- Повний orbital catalogue лишається у native GPU layer.
- DOM markers обмежені 360 пріоритетними об'єктами.
- 2D interactive GeoJSON обмежений 520 об'єктами.
- Selected satellite і GNSS мають пріоритет у bounded interaction set.
- React map runtime оновлюється на `moveend`, а не на кожному `move`.
- Під час camera gesture важка orbital geometry не перебудовується на кожному кадрі.
- Search винесено в `/api/orbits/search` без SGP4 propagation.
- Повернуті IRMAS camera presets і projection guard.
- Native layer активний і в Mercator, і в Globe.
- Selected 3D orbit повернено до reference frame `eci-orbit-at-scene-gmst`.
- Старий pre-parity CSS видалений із глобального stylesheet.
- localStorage schema карти піднята до v3, щоб старі конфліктні settings не ламали новий baseline.

## Бюджети

| Контур | Budget |
|---|---:|
| Starlink/GNSS full GPU scene | до 12 000 |
| 2D interactive GeoJSON | до 520 |
| DOM markers/labels | до 360 |
| LOS | до 300 |
| Coverage | до 48 |

## Перевірки

- API query tests: 5/5 PASS.
- Client JS/JSX parse: 10/10 PASS.
- CSS brace balance: PASS.
- Relative imports: 0 missing.
- Synthetic 15 000-row render budget: 360 DOM rows, selected preserved — PASS.

Повний Vite build та живий MapLibre/WebGL acceptance не заявляються як пройдені, оскільки залежності проєкту в artifact runtime не встановлені.
