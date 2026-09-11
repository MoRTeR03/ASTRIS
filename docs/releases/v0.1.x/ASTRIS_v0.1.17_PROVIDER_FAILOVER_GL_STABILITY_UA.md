# ASTRIS v0.1.17 — Provider Failover + Globe/WebGL Stability

## Мета

Цей етап виправляє три регресійні класи, зафіксовані на актуальному v0.1.16 FULL SOURCE: холодний старт без orbital cache при CelesTrak HTTP 403, MapLibre globe `around` easing warning та WebGL/error-texture spam. Візуальні контракти v0.1.16 (зоряне небо, Сонце, globe, labels, buildings) не переробляються.

## 1. Orbital provider chain

Primary: `CelesTrak GP OMM/JSON`. Мінімальний інтервал повторного завантаження лишається 2 години. Якщо primary не дає придатний JSON, сервер один раз у тому самому refresh cycle пробує static mirror Satvisor (`satvisorcom/satvisor-data`), який дзеркалить CelesTrak OMM JSON. Успішний fallback записується у той самий persistent cache.

Runtime status тепер містить `provider`, `originProvider`, `fallbackUsed` і `providerWarning`. Якщо mirror працює, `/api/orbits/scene` повертає 200 і супутники не зникають. Якщо не працюють обидва джерела й немає cache — лишається контрольований 503 з `Retry-After`.

## 2. 403/HTML hardening

HTML CelesTrak error body більше не віддається як сирий `<!DOCTYPE ...>` у React. Provider message очищається від markup і обрізається до діагностичного тексту.

## 3. Globe camera

У globe mode native `scrollZoom` і `doubleClickZoom` відключені, бо pointer-anchored MapLibre easing використовує `around`, який globe camera не підтримує. ASTRIS обробляє wheel/double-click сам і змінює лише `zoom`, тобто навколо центра камери. У Mercator native handlers автоматично повертаються.

## 4. WebGL / missing sprite hardening

`circle-N` як і раніше генерується локально. Додатково будь-який інший unresolved style sprite отримує прозорий fallback. Це не підміняє реальні піктограми, але не дозволяє сторонньому basemap style нескінченно заходити в error-texture path.

Chromium warning `READ-usage buffer was written...` не породжується ASTRIS custom orbital VBO: ASTRIS використовує `gl.DYNAMIC_DRAW` і не виконує buffer readback. Такий самий warning зафіксований upstream у MapLibre/Chrome. Тому v0.1.17 прибирає ASTRIS-side error churn, але не маскує console і не заявляє, що browser/MapLibre warning фізично неможливий.

## 5. Чому MapLibre не оновлювався до v6

v0.1.17 лишає `maplibre-gl 5.24.0`. v6 — breaking migration, зокрема видаляє `map.transform`; ASTRIS custom orbital layer ще має compatibility path, який використовує transform helpers. Оновлення major-version треба робити окремим stage з globe parity тестами, а не у hotfix.

## Acceptance

- direct CelesTrak 200 → provider=CelesTrak;
- direct CelesTrak 403 + mirror 200 → `/api/orbits/scene` 200, `fallbackUsed=true`, satellites > 0;
- both fail + no cache → 503 + sanitized message + Retry-After;
- second scene request during cooldown does not hammer providers;
- globe wheel/double click does not emit `Easing around a point...`;
- changing globe/mercator restores the correct zoom handlers;
- missing third-party sprites do not generate repeated error-texture requests;
- starfield/Sun behavior remains from v0.1.16.
