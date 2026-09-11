# ASTRIS v0.1.5 — Full IRMAS MapLibre parity

Еталон: наданий користувачем `WEB_IR.zip`, клієнтська MapLibre підсистема IRMAS.

## Відновлено

- Повні орбітальні витки для активних систем, а не лише selected orbit.
- Окремий кеш траєкторій і незалежна частота `tracksRefreshMs`.
- `renderFps`, `interpolationStepMs`, `smoothingMs`, `refreshMs`, `tracksRefreshMs`, `trackMode`, `trackMinutes`, `trackStepMinutes`, `trackLimit`.
- Колір підпису = колір системи/каталогу супутника.
- Immediate local renderer sync через `requestAnimationFrame`.
- Розширення MapLibre після закриття панелі та `map.resize()`.
- Lucide SVG quick-actions.
- Лише NavigationControl + metric ScaleControl на canvas.
- IRMAS building ownership: native Liberty 3D або ASTRIS custom extrusion, але не два одночасно.
- Multi-pass style restore після `setStyle(diff:false)` і guards на `styledata`/`idle`.
- Zoom-adaptive observer marker.
- Пізній IRMAS map CSS порт + ASTRIS-only final overrides.

## Не переноситься навмисно

LiDAR, SLAM, robot marker/trail/route, drive controls, sensor layers, GSV/SNR/REB і будь-які hardware-specific IRMAS contracts.

## Performance policy

ASTRIS може містити понад 10k Starlink-об'єктів. Тому UI parity не означає сліпо запускати 60 Hz CPU projection для всього каталогу. `renderFps` є target, а runtime застосовує safety cap для великих сцен; повний каталог лишається в WebGL, тоді як DOM interactivity залишається bounded.
