# ASTRIS v0.1.16 — Provider Resilience + Globe Sky Recovery

## 1. Причина live-регресії

Browser log показав не одну помилку MapLibre, а каскад із трьох контурів:

1. `/api/orbits/scene` відповідав `503 Service Unavailable` для GNSS;
2. клієнт повторював scene polling з високою частотою;
3. чисті FULL SOURCE збірки не містили попередній runtime cache, тому кожна нова папка могла знову звертатися до CelesTrak як перший запуск.

Старий server-side catalog service не мав provider circuit breaker. Якщо upstream був заблокований, rate-limited або тимчасово недоступний, кожен наступний scene request запускав новий upstream fetch. Це не лише створювало шум у browser console, а й могло продовжувати provider block.

## 2. Нова cache / failure модель

```text
CelesTrak
   │
   ├─ success ───────────────→ persistent OS cache
   │                           │
   │                           └─ ASTRIS scene
   │
   ├─ 403 / 429
   │      ↓
   │   >= 2 h circuit breaker
   │      ↓
   │   last-known-good cache
   │
   └─ network / 5xx
          ↓
      exponential backoff
          ↓
      last-known-good cache
```

Persistent cache locations:

- Windows: `%LOCALAPPDATA%/ASTRIS/cache`
- macOS: `~/Library/Caches/ASTRIS`
- Linux: `~/.cache/astris`
- override: `ASTRIS_CACHE_DIR`

`server/cache` залишається legacy import source. Якщо там є старий каталог, він читається та переноситься у persistent cache.

### Поведінка при повній відсутності cache

Якщо це перший запуск на машині і CelesTrak уже не віддає дані, ASTRIS не може математично відновити актуальні OMM із порожнього диска. У такому випадку API повертає контрольований `503` з:

- `catalog`;
- `upstreamStatus`;
- `retryAfterMs`;
- повним catalog status.

Клієнт переходить у backoff і не повторює request щосекунди.

## 3. Observer / IP geolocation resilience

Новий fallback chain:

```text
ipapi.co
   ↓ fail
ipwho.is
   ↓ fail
persistent ip-location.json
   ↓ unavailable
browser localStorage observer
```

Ручний observer як і раніше має пріоритет над IP geolocation.

## 4. Globe starfield

Попередній single-image sky був принципово невдалим для необмеженого обертання Globe: при достатньому offset ставав видимим край bitmap/SVG та порожній background.

v0.1.16 використовує три окремі великі star catalogues:

```text
astris-map-starfield-a.svg
astris-map-starfield-b.svg
astris-map-starfield-c.svg
```

Кожний має інший розмір tile, інший offset і власну швидкість parallax. Патерни повторюються без геометричного краю, але через різні розміри їхнє сумарне повторення не читається як одна плитка.

Camera binding:

- normal left-drag → `center.lng/lat` → star offset;
- bearing → star rotation + horizontal phase;
- roll → star rotation;
- pitch → vertical parallax;
- zoom → слабкий scale.

Фон синтетичного space mode повернений до майже чорного loader-like profile.

## 5. Sun behavior

Видалена додаткова sidereal longitude correction, яка була введена після v0.1.12 і зробила Sun/backdrop візуально різними reference frames.

Повернута pre-sidereal Sun логіка:

```text
UTC
 → solar subpoint
 → central angle від camera center
 → bearing до solar subpoint
 → projected horizon vector
 → screen-space Sun
 → limb occlusion
```

Sun більше не отримує окрему штучну celestial rotation поверх solar UTC position.

## 6. Missing MapLibre sprites

У live console був `circle-11 could not be loaded` і далі WebGL error texture spam.

ASTRIS створює відсутні `circle-N` sprites локально. Для MapLibre 5.24 використовується `styleimagemissing`; при майбутньому переході на v6 feature detection переключить runtime на `setMissingStyleImageResolver`.

## 7. Validation

Static release gates:

```text
Client JS/JSX parse       13/13 PASS
Server/tools node --check PASS
ASTRIS v0.1.16 validator  22/22 PASS
CSS brace balance         PASS
Starfield SVG XML         3/3 PASS
Starlink render budget    PASS (15000 → 360 DOM)
```

Dependency-based `npm test` та Vite production build потребують локального `npm install` і мають бути підтверджені на development workstation.
