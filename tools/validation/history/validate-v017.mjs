import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const widget = read('client/src/components/AstrisMapWidget.jsx');
const map = read('client/src/components/OrbitalMap.jsx');
const layer = read('client/src/components/AstrisOrbitalLayer.js');
const app = read('client/src/App.jsx');
const css16 = read('client/src/astris-map-v016.css');
const css17 = read('client/src/astris-map-v0161-v014-visual-rollback.css');
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

check('versions 0.1.7', [pkg.version, clientPkg.version, serverPkg.version].every((v) => v === '0.1.7'));
check('v0.1.4 controlled disclosure markup restored',
  widget.includes("astris-map-panel-section astris-ios-disclosure ${open ? 'is-open' : 'is-closed'}") &&
  widget.includes('className="astris-map-panel-section-summary"') &&
  !widget.includes('<details className={`astris-map-panel-section'));
check('v0.1.4 disclosure visual contract restored',
  css17.includes('border-radius: 14px !important') &&
  css17.includes('.astris-map-native-panel > .astris-map-panel-section.is-open') &&
  css17.includes('class') === false &&
  css17.includes('padding: 11px 12px !important'));
check('v0.1.4 section body geometry restored',
  css17.includes('gap: 8px !important') && css17.includes('padding: 11px 12px 13px !important'));
check('v0.1.4 header chrome restored',
  css17.includes('padding: 13px 14px 10px !important') &&
  css17.includes('linear-gradient(180deg, rgba(16, 21, 34, 0.94), rgba(8, 11, 19, 0.86))'));
check('profile manager retained inside restored head',
  widget.includes('astris-map-native-head-actions astris-map-profile-manager') &&
  css17.includes('background: transparent !important'));
check('v0.1.4 ScaleControl shape restored',
  css17.includes('border-width: 0 2px 2px 2px !important') &&
  css17.includes('padding: 0 5px !important') &&
  css17.includes('line-height: 18px !important'));
check('visual rollback CSS imported last',
  main.indexOf("./astris-map-v0161-v014-visual-rollback.css") > main.indexOf("./astris-map-v016.css"));

// Preserve v0.1.6 behavior while rolling back only requested visual contracts.
check('map info footer preserved', widget.includes('astris-map-native-meta') && widget.includes('SGP4 ${scene.propagationStepMs'));
check('duplicate header state/toggle remains removed', !widget.includes('engine-state') && !widget.includes('>Сховати інструменти<'));
check('semantic strip tones preserved', ['tone-fix','tone-danger','tone-offline','tone-info','tone-ok','tone-warn'].every((tone) => css16.includes(tone)));
check('GPU current/next marker interpolation preserved', layer.includes('a_position_next') && layer.includes('uniform float u_interp') && layer.includes('mix(a_position, a_position_next'));
check('globe track clock preservation', layer.includes('updateClock(correctedNowMs)') && map.includes('nativeRef.current?.updateClock?.(nowMs)'));
check('prediction horizon preservation', app.includes('intervalMs * 1.5') && app.includes('effectiveInterpolationStepMs'));
check('server-backed profiles preserved', routes.includes("'/api/profiles'") && profileService.includes('astris-profiles.json'));
check('profile writes serialized', profileService.includes('writeQueue') && profileService.includes('rename(tempPath, filePath)'));
check('only intended MapLibre controls preserved', map.includes('new maplibregl.NavigationControl') && map.includes('new maplibregl.ScaleControl') && !map.includes('new maplibregl.FullscreenControl'));
check('profile JSON excluded from git', gitignore.includes('server/data/astris-profiles.json'));
check('orbit track scene anchor preserved', service.includes('if (points % 2 !== 0) points += 1') && service.includes('for (let index = -halfSteps; index <= halfSteps; index += 1)'));

let balance = 0; let cssOk = true;
for (const ch of css17) {
  if (ch === '{') balance += 1;
  else if (ch === '}') { balance -= 1; if (balance < 0) cssOk = false; }
}
check('v0.1.7 rollback CSS brace balance', cssOk && balance === 0, `balance=${balance}`);

for (const item of checks) console.log(`${item.ok ? 'PASS' : 'FAIL'}  ${item.name}${item.detail ? ` — ${item.detail}` : ''}`);
const failed = checks.filter((item) => !item.ok);
console.log(`\nASTRIS v0.1.7 visual rollback checks: ${checks.length - failed.length}/${checks.length}`);
if (failed.length) process.exitCode = 1;
