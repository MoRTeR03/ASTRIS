import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const pkg = JSON.parse(read('package.json'));
const clientPkg = JSON.parse(read('client/package.json'));
const serverPkg = JSON.parse(read('server/package.json'));
const main = read('client/src/main.jsx');
const css = read('client/src/map-parity.css');
const widget = read('client/src/components/AstrisMapWidget.jsx');
const map = read('client/src/components/OrbitalMap.jsx');
const layer = read('client/src/components/AstrisOrbitalLayer.js');
const lineOfSight = read('client/src/map/OrbitalLineOfSight.js');
const app = read('client/src/App.jsx');
const service = read('server/services/catalog-service.mjs');
const routes = read('server/routes/api.routes.mjs');

const checks = [];
const check = (name, ok, detail = '') => checks.push({ name, ok: Boolean(ok), detail });

check('versions are 0.1.9', [pkg.version, clientPkg.version, serverPkg.version].every((v) => v === '0.1.9'));
check('single visual CSS runtime', main.includes("import './styles.css';") && main.includes("import './map-parity.css';") && !/astris-map-v01|irmas-map-parity/.test(main));
check('v0.1.6 header/profile surface restored', css.includes('flex:0 1 620px;display:grid !important;') && css.includes('background:linear-gradient(145deg,rgba(139,92,246,.055),rgba(8,10,15,.90))'));
check('v0.1.6 semantic FIX strip restored', css.includes('.astris-map-native-strip.tone-fix { --map-strip-accent:#3b82f6;') && css.includes('box-shadow:inset 3px 0 var(--map-strip-accent)'));
check('v0.1.6 map meta surface restored', css.includes('border-radius:9px;background:rgba(10,10,12,.88) !important;') && css.includes('.astris-map-native-meta .map-position-fix'));
check('panel body stabilized', css.includes('.astris-map-native .astris-map-panel-section-body') && css.includes('padding:11px 12px 13px !important;') && css.includes('background:rgba(3,5,9,.28) !important;'));
check('responsive typography retained', css.includes('font-size:clamp(15px,calc(.52cqi + 8px),25px)') && css.includes('font-size:clamp(9px,calc(.20cqi + 7px),13px)'));
check('navigation control is top-left', map.includes("}), 'top-left');") && map.includes("new maplibregl.NavigationControl"));
check('scale control remains bottom-left', map.includes("new maplibregl.ScaleControl") && map.includes("}), 'bottom-left');"));
check('MapLibre control corners pinned', css.includes('.maplibregl-ctrl-top-left { top:10px !important;left:10px !important; }') && css.includes('.maplibregl-ctrl-bottom-left { bottom:10px !important;left:10px !important; }'));
check('map info button + popover restored', widget.includes('title="Інформація про карту"') && widget.includes('astris-map-native-info-popover') && css.includes('.astris-map-native-info-popover'));
check('latest style request is queued during style load', map.includes('pendingStyleSyncRef') && map.includes('reconcileStyleAfterLoad') && map.includes('requestDesiredStyle(map)'));
check('settings sync uses style readiness, not full tile loaded state', map.includes("const styleReady = typeof map.isStyleLoaded !== 'function' || map.isStyleLoaded();") && map.includes('useLayoutEffect'));
check('catalog-level scene cache enables instant GNSS filters', app.includes('hasGnssCatalog') && app.includes('sceneConstellations') && app.includes("mode: 'global'") && app.includes('catalogKey'));
check('display horizon is local/immediate', widget.includes('elevation < horizonDeg') && lineOfSight.includes('serverElevation >= guardDeg'));
check('one visual clock drives marker/track/LOS', layer.includes('One visual clock for all orbital primitives') && layer.includes('const correctedNowMs = Number.isFinite(Number(state.correctedNowMs))'));
check('LOS vertices interpolate current satellite position', layer.includes('const visual = interpolatedRowPosition(row, state, state.correctedNowMs)'));
check('small track sets use tight clock buckets', layer.includes('trackCount <= 8 ? 34 : trackCount <= 32 ? 67 : trackCount <= 96 ? 125 : 250'));
check('track geometry no longer invalidated by generic revision', layer.includes('function trackDataSignature') && !/function trackSignature[\s\S]{0,260}state\.revision/.test(layer));
check('marker geometry no longer invalidated by unrelated revision', !/function dynamicSignature[\s\S]{0,320}state\.revision/.test(layer));
check('selected orbit sampling is high resolution', service.includes('requestedPoints = 180') && service.includes('Math.min(720') && service.includes('selectedRecord, date, getSatrec(selectedKey, selectedRecord), 480'));
check('Starlink render budget remains bounded', layer.includes('MAX_DOM_MARKERS = 360') && map.includes('MAX_INTERACTIVE_2D_ROWS'));
check('server-backed profiles retained', routes.includes("'/api/profiles'") || routes.includes('/api/profiles'));
check('v0.1.4 starfield + Sun retained', css.includes('.is-space-orbit-bg.is-space-synthetic::before') && css.includes('.is-space-orbit-bg.is-space-synthetic::after') && css.includes('--astris-sun-x'));
check('duplicate fullscreen control absent', !map.includes('new maplibregl.FullscreenControl'));

let balance = 0; let cssOk = true;
for (const ch of css) {
  if (ch === '{') balance += 1;
  else if (ch === '}') { balance -= 1; if (balance < 0) cssOk = false; }
}
check('CSS brace balance', cssOk && balance === 0, `balance=${balance}`);

for (const item of checks) console.log(`${item.ok ? 'PASS' : 'FAIL'}  ${item.name}${item.detail ? ` — ${item.detail}` : ''}`);
const failed = checks.filter((item) => !item.ok);
console.log(`\nASTRIS v0.1.9 synchronization/style checks: ${checks.length - failed.length}/${checks.length}`);
if (failed.length) process.exitCode = 1;
