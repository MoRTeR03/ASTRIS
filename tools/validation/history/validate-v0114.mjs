import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const exists = (rel) => fs.existsSync(path.join(root, rel));
const checks = [];
const add = (name, ok) => checks.push({ name, ok: Boolean(ok) });

const pkg = JSON.parse(read('package.json'));
const clientPkg = JSON.parse(read('client/package.json'));
const serverPkg = JSON.parse(read('server/package.json'));
const api = read('server/routes/api.routes.mjs');
const widget = read('client/src/components/AstrisMapWidget.jsx');
const map = read('client/src/components/OrbitalMap.jsx');
const native = read('client/src/components/AstrisOrbitalLayer.js');
const settings = read('client/src/map/MapSettingsStore.js');
const css = read('client/src/map-parity.css');
const favicon = read('client/public/astris-favicon.svg');
const index = read('client/index.html');

add('root version 0.1.14', pkg.version === '0.1.14');
add('client version 0.1.14', clientPkg.version === '0.1.14');
add('server version 0.1.14', serverPkg.version === '0.1.14');
add('health version 0.1.14', api.includes("version: '0.1.14'"));

add('globe no longer disables buildings in normalization', !settings.includes('if (next.globe) next.buildings = false'));
add('building toggle no longer switches globe off', !widget.includes("patch({ buildings: true, globe: false })"));
add('building renderer is not gated off on globe', !map.includes('if (!s.buildings || s.globe)') && !map.includes('usesNativeBuildingStyle() && !s.globe'));
add('MapLibre construction allows cross-source label isolation', map.includes('crossSourceCollisions: false'));
add('2D satellite labels use dedicated source', map.includes("labelsSource: 'astris-satellites-label-source-2d'") && map.includes('source: IDS.labelsSource'));
add('2D label source is viewport-budgeted', map.includes('function labelRowsIn2dViewport') && map.includes('map.getSource(IDS.labelsSource)?.setData'));
add('globe labels have transient projection fallback', native.includes('const labelCandidates = precise.length ? precise.map') && native.includes('selectInteractiveMarkerRows(rows, selectedId'));

add('quick actions restored to v0.1.4 visual contract', widget.includes('⌖ Observer') && widget.includes('⌗ Grid') && widget.includes('🏷 Labels') && widget.includes('↻ Catalog'));
add('profile actions explicitly centered', css.includes('align-self:center;justify-self:center;height:31px'));

add('map sky uses loader-black background', css.includes('background-color: #020204') && css.includes('linear-gradient(180deg, #020204 0%, #010102 100%)'));
add('starfield uses sidereal clock', map.includes('function greenwichMeanSiderealDegrees') && map.includes('const siderealDeg = greenwichMeanSiderealDegrees(date)'));
add('starfield follows camera bearing', map.includes('const celestialRoll = normalizeLongitude(-bearing - roll)'));
add('Sun retained', css.includes('--astris-sun-x') && css.includes('--astris-sun-opacity'));

add('favicon exists and linked', exists('client/public/astris-favicon.svg') && index.includes('/astris-favicon.svg'));
add('favicon is exact Lucide Orbit geometry', favicon.includes('M20.341 6.484A10 10 0 0 1 10.266 21.85')
  && favicon.includes('M3.659 17.516A10 10 0 0 1 13.74 2.152')
  && favicon.includes('<circle cx="12" cy="12" r="3"/>')
  && favicon.includes('<circle cx="19" cy="5" r="2"/>')
  && favicon.includes('<circle cx="5" cy="19" r="2"/>')
  && !favicon.includes('<rect'));

const failed = checks.filter((c) => !c.ok);
for (const check of checks) console.log(`${check.ok ? 'PASS' : 'FAIL'} ${check.name}`);
console.log(`\n${checks.length - failed.length}/${checks.length} PASS`);
if (failed.length) process.exit(1);
