# ASTRIS v0.1.10 — аудит native info / viewport labels / selection UX

## Причини дефектів

### Білі прямокутники у 3D/marker controls
У markup існували `astris-map-building-detail-mode button` та кнопка reset у `astris-map-marker-control-head`, але canonical OLED button selector покривав лише `astris-map-building-options`. Chromium тому малював системний білий `button`. У v0.1.10 ці selectors отримали той самий border/background/hover/disabled contract.

### Неправильна кнопка інформації
У v0.1.4 кругла `(i)` була не кастомним компонентом ASTRIS, а `maplibregl.AttributionControl({ compact: true })` у `bottom-left`. У пізніших релізах вона була вилучена, а замість неї доданий custom info popover. v0.1.10 повертає native control і прибирає дубль.

### Selection не скидався повторним click
`selectRow()` завжди записував NORAD ID. Тепер той самий NORAD ID працює як toggle: selected → click same satellite → empty selection.

### Starlink labels
Попередній custom globe layer спочатку вибирав глобальний top-360 DOM subset, а вже після цього ховав елементи поза viewport. Наслідки: частина реально видимих Starlink не мала label/click-target, тоді як невидимі апарати могли займати DOM budget.

v0.1.10 робить двоступеневий viewport selection:

1. cheap angular prefilter відносно camera center;
2. precise MapLibre custom-layer matrix clip + globe occlusion;
3. max 360 DOM hit-targets у viewport;
4. adaptive text label budget до 180;
5. selected satellite має найвищий priority, GNSS — вище за Starlink.

Повний каталог не видаляється з WebGL marker buffer, тому це optimization тільки UI/interaction layer, а не зменшення orbital scene.

## Performance contract

- Full GPU catalogue: unchanged.
- DOM hit targets: <= 360.
- Text labels: <= 180, only viewport candidates.
- Catalogue viewport scan: scene/selection change or camera interaction end, not every animation frame.
- Existing GPU current→next interpolation remains active.

## Додатковий filter/2D fix

Під час client-side перемикання constellation rows можуть змінитися без нового `sceneAtMs`. v0.1.10 окремо визначає зміну reference масиву `rows`, інвалідовує GPU marker buffer і viewport shortlist, тому GPS/Starlink filter не чекає нового HTTP snapshot.

У 2D interaction/label source також формується з поточного MapLibre viewport після `moveend` і при зміні scene/filter. Анімаційний цикл використовує вже кешований shortlist, тому повний Starlink каталог не сканується на кожному кадрі.
