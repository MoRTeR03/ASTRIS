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
const index = read('server/index.mjs');
const catalog = read('server/services/catalog-service.mjs');
const ip = read('server/services/ip-location-service.mjs');
const app = read('client/src/App.jsx');
const map = read('client/src/components/OrbitalMap.jsx');
const css = read('client/src/map-parity.css');

add('root version 0.1.16', pkg.version === '0.1.16');
add('client version 0.1.16', clientPkg.version === '0.1.16');
add('server version 0.1.16', serverPkg.version === '0.1.16');
add('health version 0.1.16', api.includes("version: '0.1.16'"));
add('map parity script points to v0.1.16', pkg.scripts?.['check:map-parity'] === 'node tools/validate-v0116.mjs');

add('persistent OS catalogue cache configured', index.includes('defaultPersistentCacheDir') && index.includes("'ASTRIS', 'cache'") && index.includes('fallbackCacheDirs'));
add('CelesTrak failure circuit breaker exists', catalog.includes('nextAttemptAt') && catalog.includes('providerCooldownMs') && catalog.includes('failureCount'));
add('CelesTrak 403/429 opens two-hour cooldown', catalog.includes('status === 403 || status === 429') && catalog.includes('MIN_REFRESH_MS'));
add('stale cache remains usable', catalog.includes('keep last known good catalogue') && !catalog.includes('cache older than 48 hours'));
add('503 exposes Retry-After', api.includes("res.setHeader('Retry-After'") && api.includes('retryAfterMs'));
add('client backs off after scene failure', app.includes('failureStreakRef') && app.includes('localBackoffMs') && app.includes('nextDelayMs'));
add('client keeps rendered scene on provider failure', app.includes("phase: prev.rows?.length ? 'ready' : 'error'"));
add('IP provider fallback configured', ip.includes("source: 'ipapi.co'") && ip.includes("source: 'ipwho.is'"));
add('IP disk fallback configured', ip.includes('ip-location.json') && ip.includes('approximate-stale'));
add('browser remembers last observer', app.includes('astris_last_observer_v1') && app.includes('persistObserver'));

add('sun projection restored to pre-sidereal camera contract', map.includes('const skyLongitude = normalizeLongitude(centerLongitude + bearing)') && !map.includes('greenwichMeanSiderealDegrees'));
add('starfield responds to normal globe pan', map.includes('const starBaseX = -skyLongitude * 5.2'));
add('infinite multilayer starfield assets exist', ['a','b','c'].every((name) => exists(`client/src/assets/astris-map-starfield-${name}.svg`)));
add('starfield repeats without finite edge', css.includes('background-repeat: repeat, repeat, repeat') && css.includes('astris-map-starfield-a.svg') && css.includes('astris-map-starfield-c.svg'));
add('loader-black map sky retained', css.includes('background-color: #020204') && css.includes('linear-gradient(180deg, #020204 0%, #010102 100%)'));
add('MapLibre missing circle sprites resolved locally', map.includes('setMissingStyleImageResolver') && map.includes('/^circle-\\d+$/'));

let balance = 0; let cssOk = true;
for (const ch of css) { if (ch === '{') balance += 1; else if (ch === '}') { balance -= 1; if (balance < 0) cssOk = false; } }
add('map CSS brace balance', cssOk && balance === 0);

const failed = checks.filter((c) => !c.ok);
for (const check of checks) console.log(`${check.ok ? 'PASS' : 'FAIL'} ${check.name}`);
console.log(`\n${checks.length - failed.length}/${checks.length} PASS`);
if (failed.length) process.exit(1);
