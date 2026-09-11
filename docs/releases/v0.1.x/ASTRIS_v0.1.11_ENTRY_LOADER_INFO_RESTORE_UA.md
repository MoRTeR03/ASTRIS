# ASTRIS v0.1.11 — Entry Loader + Map Info Restore

## Мета

Повернути кастомне діагностичне інформаційне вікно ASTRIS, не видаляючи штатний compact MapLibre AttributionControl, і додати коротку вхідну анімацію у стилі технічного splash/loader, але з власною ASTRIS-айдентикою.

## Loader

- fullscreen OLED/black overlay;
- поточний ASTRIS Orbit brand-mark без рамки й фіолетової картки;
- ASTRIS wordmark;
- коротка orbital/satellite animation;
- тонка progress-line;
- основна сторінка й MapLibre ініціалізуються під overlay, тому splash не блокує network/runtime boot;
- overlay починає вихід приблизно через 1.35 s і повністю демонтується приблизно через 1.78 s;
- `prefers-reduced-motion: reduce` прибирає неважливу анімацію.

## Інформація карти

У floating actions знову є окрема кнопка `Info`, що відкриває ASTRIS diagnostics popover:

- basemap;
- projection;
- observer;
- visible/rendered satellite count;
- orbit tracks;
- renderer FPS;
- SGP4/API latency;
- active constellations.

Штатний круглий MapLibre attribution `(i)` лишається окремо для attribution джерел карти.
