import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const widget = read('client/src/components/AstrisMapWidget.jsx');
const map = read('client/src/components/OrbitalMap.jsx');
const layer = read('client/src/components/AstrisOrbitalLayer.js');
const app = read('client/src/App.jsx');
const css = read('client/src/astris-map-v016.css');
const main = read('client/src/main.jsx');
const service = read('server/services/catalog-service.mjs');
const profileService = read('server/services/profile-service.mjs');
const routes = read('server/routes/api.routes.mjs');
const gitignore = read('.gitignore');
const pkg = JSON.parse(read('package.json'));
const clientPkg = JSON.parse(read('client/package.json'));
const serverPkg = JSON.parse(read('server/package.json'));

const checks = [];
const check = (name, ok, detail='') => checks.push({ name, ok: Boolean(ok), detail });
check('versions 0.1.6', [pkg.version, clientPkg.version, serverPkg.version].every((v) => v === '0.1.6'));
check('map info footer restored', widget.includes('astris-map-native-meta') && widget.includes('SGP4 ${scene.propagationStepMs'));
check('duplicate header state/toggle removed', !widget.includes('engine-state') && !widget.includes(">Сховати інструменти<"));
check('IRMAS scale styling restored', css.includes('.astris-map-native .maplibregl-ctrl-scale') && css.includes('background:rgba(8,8,10,.78)'));
check('IRMAS disclosure body restored', css.includes('border-radius:14px !important') && css.includes('gap:8px !important') && css.includes('padding:11px 12px 13px !important'));
check('semantic strip tones restored', ['tone-fix','tone-danger','tone-offline','tone-info','tone-ok','tone-warn'].every((tone) => css.includes(tone)));
check('metric tones applied in widget', widget.includes("astris-map-native-metric ${(scene.count || 0) > 0 ? 'tone-ok' : 'tone-warn'}"));
check('GPU current/next marker interpolation', layer.includes('a_position_next') && layer.includes('uniform float u_interp') && layer.includes('mix(a_position, a_position_next'));
check('globe track clock follows interpolated marker time', layer.includes('updateClock(correctedNowMs)') && map.includes('nativeRef.current?.updateClock?.(nowMs)') && layer.includes('trackGeometryKey ='));
check('globe no Starlink 3 FPS CPU cap', map.includes('if (globe) return requested') && !map.includes('rowCount >= 9000'));
check('2D interpolation uses bounded rows', map.includes('const cpuRows = interactiveRows(currentState.rows'));
check('prediction horizon exceeds poll cadence', app.includes('intervalMs * 1.5') && app.includes('effectiveInterpolationStepMs'));
check('orbit track scene anchor is exact', service.includes('if (points % 2 !== 0) points += 1') && service.includes('for (let index = -halfSteps; index <= halfSteps; index += 1)'));
check('server-backed profiles', routes.includes("'/api/profiles'") && routes.includes("'/api/profiles/:name'") && profileService.includes("astris-profiles.json"));
check('profile writes serialized', profileService.includes('writeQueue') && profileService.includes('rename(tempPath, filePath)'));
check('profile manager lives in map head', widget.includes('astris-map-profile-manager') && widget.includes('mapRef.current?.getViewState'));
check('profile JSON excluded from git', gitignore.includes('server/data/astris-profiles.json'));
check('v0.1.6 CSS imported last', main.indexOf("./astris-map-v016.css") > main.indexOf("./astris-map-v015.css"));
check('only intended MapLibre controls', map.includes('new maplibregl.NavigationControl') && map.includes('new maplibregl.ScaleControl') && !map.includes('new maplibregl.FullscreenControl'));

let balance = 0; let cssOk = true;
for (const ch of css) { if (ch === '{') balance += 1; else if (ch === '}') { balance -= 1; if (balance < 0) cssOk = false; } }
check('v0.1.6 CSS brace balance', cssOk && balance === 0, `balance=${balance}`);

for (const item of checks) console.log(`${item.ok ? 'PASS' : 'FAIL'}  ${item.name}${item.detail ? ` — ${item.detail}` : ''}`);
const failed = checks.filter((item) => !item.ok);
console.log(`\nASTRIS v0.1.6 regression/profile checks: ${checks.length - failed.length}/${checks.length}`);
if (failed.length) process.exitCode = 1;
