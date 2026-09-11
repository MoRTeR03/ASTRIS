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
const index = read('client/index.html');
const mapCss = read('client/src/map-parity.css');
const mapJs = read('client/src/components/OrbitalMap.jsx');
const loaderStars = read('client/src/assets/astris-loader-starfield.svg');
const mapStars = read('client/src/assets/astris-map-starfield.svg');
const favicon = read('client/public/astris-favicon.svg');

add('root version 0.1.13', pkg.version === '0.1.13');
add('client version 0.1.13', clientPkg.version === '0.1.13');
add('server version 0.1.13', serverPkg.version === '0.1.13');
add('health version 0.1.13', api.includes("version: '0.1.13'"));
add('MapLibre uses realistic non-repeating star asset', mapCss.includes("url('./assets/astris-map-starfield.svg')") && mapCss.includes('background-repeat: no-repeat'));
add('MapLibre star catalogue matches accepted loader field', loaderStars === mapStars);
add('star asset remains dense', (mapStars.match(/<circle /g) || []).length >= 300);
add('camera parallax is bounded for non-repeating sky', mapJs.includes('Math.max(32, Math.min(68, starX))') && mapJs.includes('Math.max(34, Math.min(66, starY))'));
add('Sun layer retained', mapCss.includes('--astris-sun-x') && mapCss.includes('--astris-sun-opacity'));
add('favicon asset exists', exists('client/public/astris-favicon.svg'));
add('favicon linked from page head', index.includes('<link rel="icon" href="/astris-favicon.svg" type="image/svg+xml" />'));
add('favicon has transparent SVG root', favicon.includes('<svg') && !favicon.includes('<rect'));
add('favicon keeps orbital brand semantics', favicon.includes('<ellipse') && favicon.includes('#67E8F9'));

const failed = checks.filter((c) => !c.ok);
for (const check of checks) console.log(`${check.ok ? 'PASS' : 'FAIL'} ${check.name}`);
console.log(`\n${checks.length - failed.length}/${checks.length} PASS`);
if (failed.length) process.exit(1);
