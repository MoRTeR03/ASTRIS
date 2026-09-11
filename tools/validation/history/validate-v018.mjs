import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const main = read('client/src/main.jsx');
const styles = read('client/src/styles.css');
const css = read('client/src/map-parity.css');
const widget = read('client/src/components/AstrisMapWidget.jsx');
const map = read('client/src/components/OrbitalMap.jsx');
const layer = read('client/src/components/AstrisOrbitalLayer.js');
const app = read('client/src/App.jsx');
const service = read('server/services/catalog-service.mjs');
const profileService = read('server/services/profile-service.mjs');
const routes = read('server/routes/api.routes.mjs');
const pkg = JSON.parse(read('package.json'));
const clientPkg = JSON.parse(read('client/package.json'));
const serverPkg = JSON.parse(read('server/package.json'));

const checks = [];
const check = (name, ok, detail='') => checks.push({ name, ok: Boolean(ok), detail });

check('versions 0.1.8', [pkg.version, clientPkg.version, serverPkg.version].every((v) => v === '0.1.8'));
check('single v0.1.4 visual CSS baseline',
  main.includes("import './styles.css';") && main.includes("import './map-parity.css';") &&
  !/irmas-map-parity|astris-map-v015|astris-map-v016/.test(main));
check('later competing CSS files removed',
  ['client/src/irmas-map-parity.css','client/src/astris-map-v015.css','client/src/astris-map-v016.css','client/src/astris-map-v0161-v014-visual-rollback.css']
    .every((rel) => !fs.existsSync(path.join(root, rel))));
check('v0.1.4 disclosure DOM contract',
  widget.includes("astris-map-panel-section astris-ios-disclosure ${open ? 'is-open' : 'is-closed'}") &&
  widget.includes('className="astris-map-panel-section-summary"') &&
  widget.includes('className="astris-map-panel-section-body"'));
check('v0.1.4 observer form contract',
  widget.includes('className="location-card"') && widget.includes('className="coordinate-grid"') &&
  widget.includes('className="secondary-button"') && widget.includes('className="microcopy"'));
check('v0.1.4 section body geometry exact',
  css.includes('gap: 8px !important;') && css.includes('padding: 11px 12px 13px !important;') && css.includes('background: rgba(3,5,9,.28) !important;'));
check('v0.1.4 synthetic star field and Sun restored',
  css.includes('.is-space-orbit-bg.is-space-synthetic::before') &&
  css.includes('.is-space-orbit-bg.is-space-synthetic::after') &&
  css.includes('--astris-sun-x'));
check('space background camera sync still active',
  map.includes("container.classList.toggle('is-space-synthetic'") && map.includes("--astris-sun-x"));
check('MapLibre controls pinned to fixed corners',
  css.includes('.maplibregl-control-container') && css.includes('position:absolute !important;') &&
  css.includes('.maplibregl-ctrl-bottom-right') && css.includes('.maplibregl-ctrl-bottom-left'));
check('navigation + scale are only core controls',
  map.includes('new maplibregl.NavigationControl') && map.includes("}), 'bottom-right');") &&
  map.includes('new maplibregl.ScaleControl') && !map.includes('new maplibregl.FullscreenControl'));
check('scene updates not deferred through React transition',
  app.includes('Scene keyframes are latency-sensitive') && !/startTransition\(\(\) => setState\(\{\s*phase: 'ready'/.test(app));
check('clock correction median window', app.includes('clockSamplesRef') && app.includes('median(samples)') && !app.includes('previous * 0.82'));
check('heavy Starlink scene snapshot safety floor', app.includes('starlinkHeavyScene') && app.includes('Math.max(1500, requestedIntervalMs)'));
check('GPU keyframe interpolation retained', layer.includes('a_position_next') && layer.includes('u_interp') && layer.includes('mix(a_position, a_position_next'));
check('adaptive orbit-track clock bucket', layer.includes('trackCount <= 32 ? 125 : trackCount <= 96 ? 250 : 500'));
check('high-rate scene payload compacted',
  service.includes('Scene-level timestamps live once on the payload') &&
  service.includes('sceneNumber(propagated.latitudeDeg, 6)') &&
  !/rows\.push\(\{[\s\S]{0,500}nextAt:\s*nextDate/.test(service));
check('server-backed profiles retained', routes.includes("'/api/profiles'") && profileService.includes('astris-profiles.json'));
check('responsive typography extension', styles.includes('font-size: clamp(16px, 1.05vw, 22px)') && css.includes('font-size:var(--map-font-xs)'));
check('map footer retained', widget.includes('astris-map-native-meta'));
check('duplicate header engine/hide button remains removed', !widget.includes('engine-state') && !widget.includes('>Сховати інструменти<'));

let balance = 0; let cssOk = true;
for (const ch of css) {
  if (ch === '{') balance += 1;
  else if (ch === '}') { balance -= 1; if (balance < 0) cssOk = false; }
}
check('map CSS brace balance', cssOk && balance === 0, `balance=${balance}`);

for (const item of checks) console.log(`${item.ok ? 'PASS' : 'FAIL'}  ${item.name}${item.detail ? ` — ${item.detail}` : ''}`);
const failed = checks.filter((item) => !item.ok);
console.log(`\nASTRIS v0.1.8 rollback/performance checks: ${checks.length - failed.length}/${checks.length}`);
if (failed.length) process.exitCode = 1;
