import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const checks = [];
const add = (name, ok) => checks.push({ name, ok: Boolean(ok) });

const app = read('client/src/App.jsx');
const widget = read('client/src/components/AstrisMapWidget.jsx');
const loader = read('client/src/components/AstrisEntryLoader.jsx');
const loaderCss = read('client/src/entry-loader.css');
const main = read('client/src/main.jsx');
const map = read('client/src/components/OrbitalMap.jsx');
const pkg = JSON.parse(read('package.json'));
const clientPkg = JSON.parse(read('client/package.json'));
const serverPkg = JSON.parse(read('server/package.json'));
const api = read('server/routes/api.routes.mjs');

add('root version 0.1.11', pkg.version === '0.1.11');
add('client version 0.1.11', clientPkg.version === '0.1.11');
add('server version 0.1.11', serverPkg.version === '0.1.11');
add('health version 0.1.11', api.includes("version: '0.1.11'"));
add('entry loader component mounted', app.includes('<AstrisEntryLoader ready={scene.phase'));
add('entry loader uses current Orbit brand glyph', loader.includes('<Orbit size={62}'));
add('entry loader waits for scene readiness with safety timeout', loader.includes('MIN_VISIBLE_MS') && loader.includes('MAX_VISIBLE_MS'));
add('entry loader CSS imported', main.includes("import './entry-loader.css';"));
add('entry loader has reduced-motion fallback', loaderCss.includes('@media (prefers-reduced-motion: reduce)'));
add('entry loader exits with opacity instead of layout animation', loaderCss.includes('transition: opacity'));
add('custom map information popover restored', widget.includes('mapInfoOpen') && widget.includes('astris-map-native-info-popover'));
add('custom info exposes map diagnostics', widget.includes('SGP4/API') && widget.includes('Системи'));
add('native compact MapLibre attribution remains', map.includes("new maplibregl.AttributionControl({ compact: true })"));
add('native attribution remains bottom-left', map.includes("AttributionControl({ compact: true }), 'bottom-left'"));
add('same-satellite click toggle retained', app.includes("String(currentId) === nextId ? '' : nextId"));
add('Node watch preserves output', serverPkg.scripts?.dev?.includes('--watch-preserve-output'));

const failed = checks.filter((c) => !c.ok);
for (const check of checks) console.log(`${check.ok ? 'PASS' : 'FAIL'} ${check.name}`);
console.log(`\n${checks.length - failed.length}/${checks.length} PASS`);
if (failed.length) process.exit(1);
