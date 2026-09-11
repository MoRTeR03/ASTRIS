# ASTRIS v0.1.15 — Live Labels Recovery

## Вихідні симптоми

У patch-based дереві перемикач підписів або 3D-будівель міг призводити до зникнення сторінки. На чистому FULL SOURCE v0.1.14 3D-будівлі працювали, але підписи після ввімкнення ставали видимими лише після перезавантаження сторінки. Це розділяє проблему на дві частини: накопичена patch-регресія та окремий live-apply дефект labels.

## Виправлення базових MapLibre labels

`settings.labels` більше не входить до ключа, який запускає повний `map.setStyle()`.

- vector style: `setLayoutProperty(..., visibility, ...)`;
- raster style із `urlNoLabels`: `RasterTileSource.setTiles()`;
- після зміни викликається `triggerRepaint()`;
- якщо style перебуває у переході, apply одноразово повторюється на `style.load`.

Це прибирає важкий style lifecycle з простого перемикача Labels.

## Виправлення orbital labels

Окремий `useLayoutEffect` реагує саме на `orbitalOverlay.labels`.

### 2D

- оновлюється viewport-budgeted label source;
- `astris-satellites-labels-2d` перемикається `visible/none` напряму.

### Globe

- current native state передається в custom layer;
- `refreshLabels()` примусово скидає viewport selection cache;
- `lastLabelProjectionAt` обнуляється;
- MapLibre отримує `triggerRepaint()` одразу.

Отже labels більше не мають чекати нового SGP4 snapshot, руху камери чи F5.

## Quick Actions

Повернуто v0.1.5 icon-first UX:

- `LocateFixed` — Observer;
- `Grid3X3` — Grid;
- `Tags` — Labels;
- `RefreshCw` — Catalog.

## 3D Buildings

Чистий v0.1.14 FULL SOURCE не відтворював зникнення сторінки при 3D buildings, тому building pipeline не переписувався повторно. Збережено незалежність `Globe` та `buildings`, а v0.1.15 створено тільки від clean FULL baseline.

## Acceptance

1. Запустити FULL SOURCE в новій папці.
2. На Globe: `Підписи OFF -> ON -> OFF -> ON` без F5.
3. На 2D: повторити той самий тест.
4. Переключити кілька basemap-ів і повторити Labels.
5. Увімкнути 3D buildings, вимкнути, знову ввімкнути.
6. Перевірити, що сторінка не зникає і MapLibre canvas не перемонтовується.
7. Перевірити quick-actions проти v0.1.5.
