import fs from 'node:fs';
import path from 'node:path';
import { angularDistanceDeg } from '../client/src/lib/geo.js';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const checks = [];
const add = (name, ok) => checks.push({ name, ok: Boolean(ok) });

const pkg = JSON.parse(read('package.json'));
const clientPkg = JSON.parse(read('client/package.json'));
const serverPkg = JSON.parse(read('server/package.json'));
const api = read('server/routes/api.routes.mjs');
const app = read('client/src/App.jsx');
const map = read('client/src/components/OrbitalMap.jsx');
const geo = read('client/src/lib/geo.js');
const boundary = read('client/src/components/AstrisMapErrorBoundary.jsx');
const css = read('client/src/map-parity.css');

add('root version 0.1.18', pkg.version === '0.1.18');
add('client version 0.1.18', clientPkg.version === '0.1.18');
add('server version 0.1.18', serverPkg.version === '0.1.18');
add('health version 0.1.18', api.includes("version: '0.1.18'"));
add('map parity script points to v0.1.18', pkg.scripts?.['check:map-parity'] === 'node tools/validate-v0118.mjs');
add('angular distance exported from geo helper', geo.includes('export function angularDistanceDeg'));
add('OrbitalMap imports angular distance explicitly', map.includes("import { angularDistanceDeg, splitTrackAtAntimeridian } from '../lib/geo.js';"));
add('2D label sorting uses defined angular helper', map.includes('distance: angularDistanceDeg(centerLon, centerLat'));
add('same-point angular distance is zero', Math.abs(angularDistanceDeg(25, 50, 25, 50)) < 1e-9);
add('quarter-sphere angular distance is 90 degrees', Math.abs(angularDistanceDeg(0, 0, 90, 0) - 90) < 1e-9);
add('invalid angular inputs degrade safely', angularDistanceDeg(0, 0, Number.NaN, 0) === 180);
add('map error boundary exists', boundary.includes('getDerivedStateFromError') && boundary.includes('componentDidCatch'));
add('App wraps map in boundary', app.includes('<AstrisMapErrorBoundary><AstrisMapWidget'));
add('map boundary fallback styling exists', css.includes('.astris-map-runtime-error'));
add('globe scroll zoom is center anchored', map.includes("map.scrollZoom?.enable(globe ? { around: 'center' } : undefined)"));
add('globe double click remains disabled', map.includes('globe ? map.doubleClickZoom?.disable()'));
add('legacy custom globe wheel shim removed', !map.includes('onGlobeWheel') && !map.includes('globeWheelDelta'));

let balance = 0; let cssOk = true;
for (const ch of css) { if (ch === '{') balance += 1; else if (ch === '}') { balance -= 1; if (balance < 0) cssOk = false; } }
add('map CSS brace balance', cssOk && balance === 0);

const failed = checks.filter((c) => !c.ok);
for (const check of checks) console.log(`${check.ok ? 'PASS' : 'FAIL'} ${check.name}`);
console.log(`\n${checks.length - failed.length}/${checks.length} PASS`);
if (failed.length) process.exit(1);
