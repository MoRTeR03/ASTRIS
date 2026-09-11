import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const checks = [];
const add = (name, ok) => checks.push({ name, ok: Boolean(ok) });

const loader = read('client/src/components/AstrisEntryLoader.jsx');
const css = read('client/src/entry-loader.css');
const svg = read('client/src/assets/astris-loader-starfield.svg');
const pkg = JSON.parse(read('package.json'));
const clientPkg = JSON.parse(read('client/package.json'));
const serverPkg = JSON.parse(read('server/package.json'));
const api = read('server/routes/api.routes.mjs');

add('root version 0.1.12', pkg.version === '0.1.12');
add('client version 0.1.12', clientPkg.version === '0.1.12');
add('server version 0.1.12', serverPkg.version === '0.1.12');
add('health version 0.1.12', api.includes("version: '0.1.12'"));
add('loader minimum duration tripled to 2850 ms', loader.includes('MIN_VISIBLE_MS = 2850'));
add('loader safety timeout tripled to 8400 ms', loader.includes('MAX_VISIBLE_MS = 8400'));
add('loader status stays loading text', loader.includes('<small>Завантаження орбітальної сцени</small>') && !loader.includes('Орбітальна сцена готова'));
add('non tiled star asset used', css.includes("url('./assets/astris-loader-starfield.svg')") && css.includes('background-repeat: no-repeat'));
add('old repeating star tiles removed', !css.includes('background-size: 132px') && !css.includes('background-size: 183px'));
add('star field uses compositor-friendly motion', css.includes('will-change: transform, opacity'));
add('star asset has dense unique catalogue', (svg.match(/<circle /g) || []).length >= 300);
add('reduced motion fallback retained', css.includes('@media (prefers-reduced-motion: reduce)'));

const failed = checks.filter((c) => !c.ok);
for (const check of checks) console.log(`${check.ok ? 'PASS' : 'FAIL'} ${check.name}`);
console.log(`\n${checks.length - failed.length}/${checks.length} PASS`);
if (failed.length) process.exit(1);
