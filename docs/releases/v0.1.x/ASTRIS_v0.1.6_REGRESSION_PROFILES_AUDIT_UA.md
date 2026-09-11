# ASTRIS v0.1.6 — Regression Recovery, Smooth Orbit & Global Profiles

Дата: 2026-09-10

## База порівняння

Цей етап виконано після живої browser-перевірки ASTRIS v0.1.5. Еталоном для UI/UX і поведінки MapLibre використано актуальний користувацький `WEB_IR.zip` (клієнт IRMAS), а не попередні спрощені ASTRIS-реалізації.

ASTRIS залишається окремим продуктом: не повертаються LiDAR, SLAM, robot telemetry, sensor heatmaps, GSV/SNR/REB, drive/route та media-функції IRMAS.

## Виявлені регресії

1. `maplibregl-ctrl-scale` втратив еталонний IRMAS OLED-вигляд через пізні CSS override-и.
2. Нижній інформаційний footer карти не рендерився, хоча частина CSS залишалася.
3. `astris-map-panel-section-body` відрізнявся від пізнього IRMAS disclosure-контракту.
4. Semantic status strip перестав передавати стан через кольори.
5. У header дублювалися `engine-state ready` та текстова кнопка приховування інструментів.
6. При великому Starlink-каталозі globe animation навмисно обмежувалась до 3 FPS.
7. `interpolationStepMs=500` при scene polling близько 1000 ms призводив до ratio=1 ще до наступного snapshot і короткого завмирання.
8. Low-pass smoothing позиції додавав візуальне запізнення відносно геометрії орбіти.
9. Cached ECI orbit line не отримував окремого clock update під час GPU interpolation точки, тому точка могла візуально відходити від витка між scene updates.
10. Глобальних іменованих профілів конфігурації не було.

## Виправлення UI/CSS

### MapLibre ScaleControl

Повернуто пізній IRMAS contract:

- OLED background `rgba(8,8,10,.78)`;
- border від design token;
- приглушений текст;
- compact map typography;
- backdrop blur.

Нативний `ScaleControl` не замінюється власним DOM-компонентом — змінюється лише його оформлення у namespace ASTRIS.

### Map metadata footer

Повернуто `astris-map-native-meta` з трьома групами інформації:

- активний basemap / projection / кількість orbital objects / render FPS;
- observer source та координати;
- SGP4 step / API latency / кількість tracks або error state.

### Disclosure/settings panel

Повернуто еталонні IRMAS geometry та spacing:

- radius 14 px;
- gradient panel surface;
- violet inset для opened section;
- summary padding 11×12 px;
- body gap 8 px;
- body padding 11×12×13 px;
- IRMAS dark body background.

### Semantic status strip

Відновлено semantic tones:

- `tone-fix` — blue;
- `tone-info` — violet;
- `tone-ok` — green;
- `tone-warn` — amber;
- `tone-danger` — red;
- `tone-offline` — amber/offline context.

ASTRIS застосовує їх окремо до scene, visible count, cache state та projection metrics.

### Header cleanup

Видалено:

- `engine-state ready`;
- текстову кнопку `Сховати інструменти`.

Керування tools panel залишається через floating map action.

## Плавний orbital runtime

### Причина ривків Starlink

У v0.1.5 діяло правило, яке для великих сцен знижувало візуальну частоту до 3 FPS. Для ~11k Starlink це було головною прямою причиною ривків.

У v0.1.6:

- globe отримує requested render FPS;
- current/next satellite XYZ передаються у GPU;
- vertex shader виконує `mix(current, next, interpolationRatio)`;
- повний каталог не перераховується JavaScript-ом на кожному visual frame;
- 2D лишається bounded: інтерполюється тільки interactive subset.

### Prediction horizon

Клієнт більше не дозволяє next keyframe завершитися раніше, ніж очікується наступний HTTP snapshot. Effective interpolation horizon враховує polling interval і configured smoothing headroom.

### Orbit registration

Full orbit track має парне число сегментів і гарантований точний sample у scene epoch. Window track будується симетричними integer offsets навколо нуля, тому також завжди містить scene epoch.

Для globe:

- marker рухається GPU interpolation між поточним і наступним SGP4 keyframe;
- cached `eci-orbit-at-scene-gmst` line отримує окремий corrected-clock update;
- Earth-rotation correction інвалідовує тільки track geometry приблизно раз на 500 ms;
- 10k+ marker vertices при цьому не перевантажуються.

Це відновлює реєстрацію «точка на витку» без повернення важкого full-scene CPU animation.

## Глобальні профілі ASTRIS

Додано server-backed профілі. Один профіль містить:

- весь normalized `MapSettingsStore` state;
- orbital tuning;
- panel state;
- observer mode (`ip` або `manual`);
- manual LAT/LON/ALT;
- MapLibre center/zoom/bearing/pitch/projection.

Не зберігаються transient state:

- текст search query;
- поточно вибраний satellite.

### Storage

Усі профілі зберігаються в одному файлі:

`server/data/astris-profiles.json`

Формат store: `astris.profiles.v1`.

Запис серіалізований внутрішньою promise-чергою. Новий JSON спочатку записується у temp file, після чого замінює основний через rename. Сам runtime JSON виключений з Git, а `server/data/.gitkeep` лишається у репозиторії.

### API

- `GET /api/profiles`
- `GET /api/profiles/export`
- `GET /api/profiles/:name`
- `PUT /api/profiles/:name`
- `DELETE /api/profiles/:name`

### UI

Profile manager розміщений у `astris-map-native-head`:

- select профілю;
- поле назви;
- Save;
- Delete;
- Export JSON.

## Performance contract

Збережено v0.1.5 render budgets:

- full globe catalogue — GPU;
- DOM interaction markers — max 360;
- bounded 2D interactive set — max 520.

Важлива оптимізація v0.1.6: selection/sorting 10k+ Starlink для DOM більше не виконується на кожному visual frame. Підмножина кешується при scene/state sync; label projection працює вже по bounded rows.

## Статична валідація

- `tools/validate-v016.mjs`: 20/20 PASS;
- server `.mjs` syntax: PASS;
- client JS/JSX parse через TypeScript parser: 12 files, 0 failures;
- profile service tests: 2/2 PASS;
- synthetic render budget: 15,000 input → 360 DOM rows, selected preserved;
- CSS brace balance: PASS.

Повні dependency-based `npm test` (orbital tests із `satellite.js`) та Vite production build не оголошуються PASS у sandbox: `npm install` не завершився через зовнішній registry/network timeout. Їх необхідно прогнати на target Windows PC.

## Browser acceptance для v0.1.6

1. Увімкнути STARLINK та `Повні орбіти`.
2. Встановити 60 FPS і переконатися, що globe рух плавний, без старого 3 FPS cap.
3. Перевірити, що satellite disc не відривається від свого orbit line під час 20–30 секунд спостереження.
4. Переключити 2D → Globe → 3D City → Globe кілька разів.
5. Перевірити ScaleControl та нижній map footer.
6. Відкрити всі settings sections і звірити spacing/body з IRMAS.
7. Сховати tools panel: карта повинна зайняти всю ширину.
8. Створити профіль, змінити basemap/globe/orbital controls, завантажити профіль і перевірити повне відновлення.
9. Перезапустити Node і переконатися, що профіль лишився у `server/data/astris-profiles.json`.
