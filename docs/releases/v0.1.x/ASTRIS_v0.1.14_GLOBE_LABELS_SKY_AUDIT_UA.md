# ASTRIS v0.1.14 — аудит Globe / 3D / Labels / Sky

Етап створено після live-перевірки v0.1.13.

## Причини регресій

### Підписи супутників
2D-підписи використовували той самий GeoJSON source, що й interaction layer, і брали участь у глобальній collision detection MapLibre разом із підписами базової карти. Для великої сцени це могло фактично витіснити orbital labels. Тепер підписи мають окремий viewport-budgeted source, а карта використовує `crossSourceCollisions:false`.

У Globe DOM-label selection також отримав fallback на випадок короткого projection/style transition, коли точна матриця тимчасово відсіює всі candidates.

### Globe + 3D buildings
Було три незалежні заборони:
1. normalize settings: `if (globe) buildings=false`;
2. UI toggle при включенні buildings переводив `globe:false`;
3. renderer `applyBuildings()` видаляв custom extrusion у globe.

Усі три заборони видалено. Projection тепер не змінюється при включенні 3D-будівель.

### Зоряне небо
Попереднє поле рухалось лише слабким horizontal parallax і майже не реагувало на bearing. Тепер camera bearing повертає celestial backdrop 1:1, а GMST + longitude задають sidereal phase. Background приведено до чорного loader-профілю.

### Favicon
Замість окремо намальованої orbital-іконки використано точну SVG-геометрію Lucide `Orbit`, яку React уже використовує як `brand-mark`.
