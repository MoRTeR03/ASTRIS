# ASTRIS v0.1.13 — Map starfield + favicon

## Мета

Перенести прийняте реалістичне неповторюване зоряне поле з entry-loader у космічний режим MapLibre без повернення старих tiled radial-gradient патернів, та додати favicon ASTRIS без рамки/фонового контейнера.

## Реалізація

- MapLibre synthetic sky використовує окремий `astris-map-starfield.svg`, байт-у-байт ідентичний прийнятому loader starfield.
- Asset має понад 300 нерегулярно розподілених зірок різної яскравості, радіуса та відтінку.
- `background-repeat: no-repeat`; старі повторювані зоряні tile-патерни більше не використовуються у synthetic sky.
- Збережено camera-linked bearing/pitch/roll/parallax і UTC Sun.
- Для no-repeat asset діапазон background-position обмежено, щоб при обертанні глобуса не оголювати край фонового SVG.
- Додано `client/public/astris-favicon.svg`: прозорий orbital brand mark без картки, рамки чи фіолетового background.
- `client/index.html` підключає favicon через `rel="icon"`.

## Не змінювалось

Orbital SGP4, Starlink budgets, LOS, tracks, profiles, basemap lifecycle та entry-loader timing не змінювалися.
