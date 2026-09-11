# ASTRIS — наступні етапи після v0.1.2

## v0.2 — Starlink performance + continuous orbital UX

Вхідний gate: виконати `npm run bench:scene` на реальному ПК та зафіксувати latency/payload для GNSS, Starlink і combined scene.

- замір SGP4/serialization/render performance для повного Starlink catalog;
- за потреби перехід на `satellite.js` Bulk Propagation API / WASM;
- справжня client-side continuous orbital interpolation між server snapshots;
- тільки після цього повернути функціональні renderer FPS / smoothing controls;
- debounce/окремий search endpoint без фільтрації основної карти;
- WebSocket/delta scene transport замість повного HTTP JSON кожні 2 с, якщо benchmark це виправдовує;
- lightweight payload/density mode для масових Starlink points;
- adaptive point/label density для zoom та globe distance;
- live browser FPS/frame-time diagnostics для map workspace.

## v0.3 — prediction

- прогноз наступного проходу над observer;
- AOS / max elevation / LOS;
- time slider;
- відображення минулої/майбутньої позиції;
- список найближчих проходів.

## v0.4 — orbital analytics

- sunlight / penumbra / umbra;
- висота, швидкість, період, eccentricity trends;
- favorites / watchlist;
- експорт вибраного об'єкта у JSON/CSV;
- порівняння двох супутників.

## v0.5 — practice release

- browser acceptance tests;
- screenshots для звіту;
- deployment profile;
- фінальний README;
- release tag;
- технічний Word-звіт про практику на основі фактичного Git history.
