# ASTRIS v0.1.9 — аудит синхронізації, MapLibre style lifecycle та Starlink

## Причина візуального розходження точка / виток / LOS

У попередньому runtime точка супутника інтерполювалася у WebGL щокадру, повний ECI-виток коригував обертання Землі дискретним clock bucket, а LOS endpoint будувався з останньої статичної позиції рядка. Це створювало три близькі, але не тотожні часові стани.

v0.1.9 переводить усі три primitives на один `correctedNowMs`. LOS використовує `interpolatedRowPosition()`, selected/small track set має до ~30 Hz clock correction, а WebGL marker бере той самий timestamp.

Окремо виправлено sampling bug: `fullOrbitTrack()` трактував аргумент як верхню межу, але для LEO фактично часто залишав лише 90 сегментів. Тепер requested count є фактичним target (72..720), а selected orbit використовує 480 сегментів.

## Чому settings інколи спрацьовували тільки після reload

MapLibre `setStyle()` є асинхронним lifecycle. Попередній код міг отримати нову зміну layer/settings, поки попередній style ще не завершився, побачити map як not-loaded і просто вийти з effect.

У v0.1.9 є `pendingStyleSyncRef`, `requestDesiredStyle()` та `reconcileStyleAfterLoad()`: останній бажаний style не губиться і перевіряється після `style.load` / `styledata` / `idle`. Для runtime-параметрів достатньо `isStyleLoaded()`, тому вони не чекають завершення завантаження всіх tiles.

## Миттєві супутникові фільтри

GNSS є невеликим каталогом, тому при активному GNSS ASTRIS отримує всі шість GNSS constellations як reusable scene. UI потім локально вмикає/вимикає GPS, GLONASS, Galileo, BeiDou, QZSS і SBAS. ALL/VISIBLE та horizon display filter також локальні. Starlink каталог підключається лише коли Starlink увімкнений.

## Starlink performance

- максимум 360 DOM markers;
- повний scene лишається у GPU path;
- 2D працює з bounded interaction subset;
- geometry buffers мають окремі signatures замість одного global revision;
- track geometry не перебудовується на кожен SGP4 snapshot, якщо сам track cache не змінився;
- великі Starlink snapshots залишаються paced, а рух між ними відбувається через predictive GPU interpolation.

## UI rollback scope

У цьому release не робиться глобальний rollback дизайну. Точно повернуті з v0.1.6: `astris-map-native-head`, semantic status strip (`tone-fix` та інші tones), `astris-map-native-meta`, profile manager geometry. Responsive font scaling лишається новим. `astris-map-panel-section-body` стабілізований поверх controlled disclosure markup.
