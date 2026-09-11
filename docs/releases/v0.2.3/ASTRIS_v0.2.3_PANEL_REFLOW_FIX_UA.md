# ASTRIS v0.2.3 — Panel Reflow / Full Map Stage Fix

## Симптом

Після натискання кнопки приховування `astris-map-native-panel` правий sidebar зникав, але карта не займала звільнену ширину. Замість неї залишався чорний сектор.

## Причина

У ранній частині `map-parity.css` уже існувало правильне правило `.astris-map-native.panel-closed .astris-map-native-workbench { grid-template-columns: minmax(0, 1fr); }`. Пізніше файл містив більш специфічне правило `section.astris-map-native[data-astris-map-native="true"] .astris-map-native-workbench`, яке знову встановлювало дві desktop grid-колонки. Через більшу specificity воно вигравало каскад навіть коли root мав `panel-closed`.

## Fix

1. В кінці stylesheet додано high-specificity `panel-closed` override з `!important`.
2. Stage явно розтягується на `grid-column: 1 / -1` та `inline-size: 100%`.
3. `AstrisMapWidget` після зміни `settings.panelOpen` чекає два animation frames і викликає imperative `OrbitalMap.resize()`.
4. `OrbitalMap.resize()` не обходить solar logic: він викликає `scheduleSpaceBackgroundSync(map, { resize: true })`, тому MapLibre canvas, synthetic sky та Sun синхронізуються після render.

## Не змінено

- SGP4;
- orbital GPU layer;
- MapLibre 6.9.0;
- accepted Sun formula з v0.2.2;
- server/API.
