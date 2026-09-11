# ASTRIS v0.2.1 — Sun / Layout Synchronization + Panel Typography

## Причина дефекту Сонця

Synthetic Sun малюється DOM/CSS overlay поверх MapLibre, але його позиція розраховується через `map.project()`. До v0.2.1 ширина/висота для нормалізації бралася насамперед із зовнішнього React-контейнера. Під час першого layout pass або після відкриття disclosure-панелі DOM міг уже мати новий розмір, а MapLibre camera/canvas ще працювали зі старим viewport. У результаті змішувалися дві різні системи координат.

## Виправлення

- viewport береться з `map.getCanvas().width / map.getPixelRatio()` та відповідної висоти;
- центр screen-space solar math — центр фактичного MapLibre render viewport;
- solar distance масштабується через projected Earth radius;
- MapLibre `resize` event запускає post-layout Sun sync;
- перший `style.load` отримує додатковий `requestAnimationFrame` sync;
- imperative `resize()` ASTRIS після `map.resize()` також синхронізує sky overlay;
- зміни disclosure layout у панелі запускають multi-frame resize reconciliation.

## Типографіка панелі

Для блоків `3D будівлі` та `Мітка спостерігача` додано єдиний title/subtitle stack: `b` і `small` тепер block/grid elements із узгодженими font-size, line-height та gap. Це усуває склеювання тексту, видиме на Chromium.

## Acceptance

Перевірити:

1. cold start у Globe;
2. 10× відкрити/закрити disclosure-секції;
3. перемикати Labels/Grid/Buildings/Terrain;
4. сховати/показати всю side panel;
5. виконати Reset;
6. змінити zoom/bearing/pitch;
7. перевірити, що Sun не змінює відносне положення через сам факт UI layout change;
8. перевірити, що `3D будівлі` та `Мітка спостерігача` мають окремі рядки title/subtitle.
