# ASTRIS v0.1.19 — Runtime Port Isolation + MapLibre Label Expression Fix

## Причини

1. ASTRIS client стартував на `5174`, бо `5173` уже був зайнятий. Vite це дозволяв автоматично.
2. API proxy залишався жорстко спрямованим на `http://localhost:3001`. Якщо на `3001` працював інший Node/IRMAS server, ASTRIS отримував `404` для `/api/location` і `/api/orbits/scene`.
3. `applyLabels()` масштабував MapLibre `text-size` як `['*', originalExpression, scale]`. Для стилів, де `originalExpression` містив `['zoom']`, це вкладало `zoom` усередину арифметичного виразу. MapLibre дозволяє `zoom` у layout/paint property лише як input верхньорівневого `step` або `interpolate`.

## Виправлення

- default client port: `5174`;
- default API port: `3101`;
- Vite `strictPort: true`;
- `/api` proxy → `127.0.0.1:3101`;
- порти можна перевизначати через `ASTRIS_CLIENT_PORT`, `ASTRIS_PORT`, `ASTRIS_API_TARGET`;
- додано зрозуміле повідомлення `EADDRINUSE`;
- додано `scaleMapLibreTextSize()` для безпечного масштабування numeric/step/interpolate/let/data expressions;
- невідомі zoom-expressions залишаються без масштабування замість створення невалідного style expression;
- повторні однакові `setLayoutProperty()` під час style restore дедуплікуються.

## Очікуваний результат

- `/api/location` та `/api/orbits/scene` більше не повинні потрапляти в чужий server на `3001`;
- `layers.place_country_*.layout.text-size: "zoom" expression...` має зникнути;
- кількість style-validation і WebGL churn має суттєво зменшитися;
- Chromium `READ-usage buffer` warning може залишитися як окремий GPU/readback performance warning і сам по собі не означає crash ASTRIS.
