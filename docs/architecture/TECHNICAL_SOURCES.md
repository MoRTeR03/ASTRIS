# ASTRIS — технічні джерела

Цей файл підготовлено як основу для подальшого звіту з практики та бібліографії.

## MapLibre GL JS

- Документація: https://maplibre.org/maplibre-gl-js/docs/
- Globe View: https://maplibre.org/roadmap/maplibre-gl-js/globe-view/

Використання в ASTRIS: інтерактивна 2D-карта, 3D Globe, власний WebGL custom layer для висотних орбітальних точок.

## CelesTrak

- Current GP Element Sets: https://celestrak.org/NORAD/elements/
- GP data formats: https://celestrak.org/NORAD/documentation/gp-data-formats.php
- Usage policy: https://celestrak.org/usage-policy.php

Використання в ASTRIS: каталоги GNSS та Starlink у форматі OMM JSON. Дані кешуються на сервері; повторне мережеве завантаження не виконується частіше ніж раз на 2 години.

## satellite.js

- npm: https://www.npmjs.com/package/satellite.js
- GitHub: https://github.com/shashwatak/satellite-js

Використання в ASTRIS: `json2satrec`, SGP4/SDP4 propagation, ECI/ECF/geodetic transforms, azimuth/elevation/range відносно спостерігача.

## ipapi.co

- API docs: https://ipapi.co/api/

Використання в ASTRIS: приблизні latitude/longitude за публічною IP-адресою. Координати не трактуються як точний GPS/GNSS fix; у UI передбачено ручний override.
