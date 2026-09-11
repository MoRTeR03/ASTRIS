import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const p = (...parts) => path.join(root, ...parts);
const exists = (...parts) => fs.existsSync(p(...parts));
const read = (...parts) => fs.readFileSync(p(...parts), 'utf8');
const json = (...parts) => JSON.parse(read(...parts));

const checks = [];
function check(name, fn) {
  try {
    fn();
    checks.push({ name, ok: true });
  } catch (error) {
    checks.push({ name, ok: false, error: error?.message || String(error) });
  }
}

const rootPackage = json('package.json');
const clientPackage = json('client', 'package.json');
const serverPackage = json('server', 'package.json');
const main = read('client', 'src', 'app', 'main.jsx');
const app = read('client', 'src', 'app', 'App.jsx');
const orbitalMap = read('client', 'src', 'components', 'map', 'OrbitalMap.jsx');
const orbitalLayer = read('client', 'src', 'map', 'rendering', 'AstrisOrbitalLayer.js');
const projectionMath = read('client', 'src', 'map', 'rendering', 'projectionMath.js');
const vite = read('client', 'vite.config.js');
const html = read('client', 'index.html');
const routes = read('server', 'src', 'routes', 'api.routes.mjs');

check('root package version is 0.2.0', () => assert.equal(rootPackage.version, '0.2.0'));
check('client package version is 0.2.0', () => assert.equal(clientPackage.version, '0.2.0'));
check('server package version is 0.2.0', () => assert.equal(serverPackage.version, '0.2.0'));
check('MapLibre is pinned to 6.9.0', () => assert.equal(clientPackage.dependencies['maplibre-gl'], '6.9.0'));
check('active validator path points to v0.2.0 gate', () => assert.equal(rootPackage.scripts['check:map-parity'], 'node tools/validation/current/validate-v020.mjs'));
check('health endpoint reports 0.2.0', () => assert.match(routes, /version:\s*['"]0\.2\.0['"]/));

check('Vite MapLibre worker uses ?worker&url', () => {
  assert.match(main, /maplibre-gl-worker\.mjs\?worker&url/);
  assert.match(main, /setWorkerUrl\(workerUrl\)/);
});
check('MapLibre CSS is imported from app entrypoint', () => assert.match(main, /maplibre-gl\/dist\/maplibre-gl\.css/));
check('OrbitalMap uses v6 namespace import', () => assert.match(orbitalMap, /import \* as maplibregl from ['"]maplibre-gl['"]/));
check('no v5 default MapLibre import remains in active client', () => {
  const active = collectFiles(p('client', 'src'), /\.(js|jsx)$/);
  for (const file of active) {
    const source = fs.readFileSync(file, 'utf8');
    assert.doesNotMatch(source, /import\s+maplibregl\s+from\s+['"]maplibre-gl['"]/);
  }
});
check('no map.transform private API remains', () => assert.doesNotMatch(orbitalMap + orbitalLayer, /\bmap\.transform\b/));
check('old globe ease monkey patch is removed', () => assert.doesNotMatch(orbitalMap, /\binstallGlobeSafeEase\b|\boriginalEaseTo\b/));
check('native globe interactions are enabled without around-point override', () => {
  assert.match(orbitalMap, /scrollZoom:\s*true/);
  assert.match(orbitalMap, /touchZoomRotate:\s*true/);
  assert.match(orbitalMap, /touchPitch:\s*true/);
  assert.match(orbitalMap, /doubleClickZoom:\s*true/);
  assert.doesNotMatch(orbitalMap, /around:\s*['"]center['"]/);
});

check('custom renderer consumes public projection shader data', () => {
  assert.match(orbitalLayer, /shaderData\?\.vertexShaderPrelude/);
  assert.match(orbitalLayer, /shaderData\?\.define/);
  assert.match(orbitalLayer, /shaderData\?\.variantName/);
  assert.match(orbitalLayer, /defaultProjectionData/);
  assert.match(orbitalLayer, /projectTileFor3D/);
});
check('projection variants are cached, not recompiled every frame', () => {
  assert.match(orbitalLayer, /programCache\.get\(key\)/);
  assert.match(orbitalLayer, /programCache\.set\(key, bundle\)/);
});
check('projection helper uses public MercatorCoordinate import', () => {
  assert.match(projectionMath, /import \{ MercatorCoordinate \} from ['"]maplibre-gl['"]/);
  assert.match(projectionMath, /MercatorCoordinate\.fromLngLat/);
});
check('renderer keeps projection-independent GPU geometry', () => {
  assert.match(orbitalLayer, /normalized Mercator coordinates/);
  assert.match(orbitalLayer, /uploadChangedGeometry\(gl\)/);
  assert.doesNotMatch(orbitalLayer, /gl\.getParameter\(gl\.(DEPTH_WRITEMASK|CURRENT_PROGRAM|ARRAY_BUFFER_BINDING|VERTEX_ARRAY_BINDING)/);
});
check('4-slot streamed VBO ring is retained', () => {
  assert.match(orbitalLayer, /GPU_BUFFER_RING_SIZE = 4/);
  assert.match(orbitalLayer, /gl\.STREAM_DRAW/);
  assert.match(orbitalLayer, /gl\.bufferSubData/);
});

check('styles are consolidated in client/src/styles', () => {
  for (const file of ['globals.css', 'entry-loader.css', 'map-parity.css']) assert.ok(exists('client', 'src', 'styles', file), file);
  const misplaced = collectFiles(p('client', 'src'), /\.css$/).filter((file) => path.dirname(file) !== p('client', 'src', 'styles'));
  assert.deepEqual(misplaced, []);
});
check('starfield assets are consolidated in assets/starfield', () => {
  const svg = collectFiles(p('client', 'src'), /\.svg$/);
  assert.ok(svg.length >= 5);
  for (const file of svg) assert.equal(path.dirname(file), p('client', 'src', 'assets', 'starfield'));
});
check('map preview images are consolidated in public/map-previews', () => {
  const images = collectFiles(p('client', 'public'), /\.(png|jpg|jpeg|webp)$/i);
  assert.ok(images.length >= 1);
  for (const file of images) assert.equal(path.dirname(file), p('client', 'public', 'map-previews'));
});
check('favicon is consolidated in public/icons', () => assert.ok(exists('client', 'public', 'icons', 'astris-favicon.svg')));
check('React entry files live in client/src/app', () => {
  assert.ok(exists('client', 'src', 'app', 'App.jsx'));
  assert.ok(exists('client', 'src', 'app', 'main.jsx'));
  assert.equal(exists('client', 'src', 'App.jsx'), false);
  assert.equal(exists('client', 'src', 'main.jsx'), false);
});
check('map components live in components/map', () => {
  assert.ok(exists('client', 'src', 'components', 'map', 'OrbitalMap.jsx'));
  assert.ok(exists('client', 'src', 'components', 'map', 'AstrisMapWidget.jsx'));
});
check('map code is split into config/geometry/rendering', () => {
  for (const dir of ['config', 'geometry', 'rendering']) assert.ok(fs.statSync(p('client', 'src', 'map', dir)).isDirectory());
});
check('server runtime lives under server/src', () => {
  assert.ok(exists('server', 'src', 'index.mjs'));
  assert.ok(exists('server', 'src', 'routes', 'api.routes.mjs'));
  assert.ok(exists('server', 'src', 'services', 'catalog-service.mjs'));
  assert.equal(exists('server', 'index.mjs'), false);
});
check('server scripts point to server/src/index.mjs', () => {
  assert.equal(serverPackage.scripts.dev, 'node --watch --watch-preserve-output src/index.mjs');
  assert.equal(serverPackage.scripts.start, 'node src/index.mjs');
});
check('historical validators are not in active validation folder', () => {
  const current = collectFiles(p('tools', 'validation', 'current'), /\.mjs$/).map((file) => path.basename(file));
  assert.deepEqual(current.sort(), ['validate-v020.mjs']);
  assert.ok(collectFiles(p('tools', 'validation', 'history'), /\.mjs$/).length >= 10);
});
check('historical validation reports are under docs/validation/history', () => assert.ok(collectFiles(p('docs', 'validation', 'history'), /\.(txt|json|md)$/).length >= 10));
check('repository structure documentation exists', () => assert.ok(exists('docs', 'architecture', 'REPOSITORY_STRUCTURE.md')));
check('v0.2.0 release documentation exists', () => assert.ok(exists('docs', 'releases', 'v0.2.0', 'ASTRIS_v0.2.0_MAPLIBRE6_REORG_UA.md')));
check('client index references organized favicon and app entrypoint', () => {
  assert.match(html, /\/icons\/astris-favicon\.svg/);
  assert.match(html, /\/src\/app\/main\.jsx/);
});
check('Vite uses isolated ASTRIS defaults 5174 -> 3101', () => {
  assert.match(vite, /5174/);
  assert.match(vite, /3101/);
  assert.match(vite, /strictPort:\s*true/);
});
check('README declares v0.2.0 and current ports', () => {
  const readme = read('README.md');
  assert.match(readme, /baseline:\s*`v0\.2\.0`/i);
  assert.match(readme, /5174/);
  assert.match(readme, /3101/);
  assert.match(readme, /MapLibre GL JS 6\.9\.0/);
});
check('no active source imports old pre-reorg paths', () => {
  const badPatterns = [
    /client\/src\/components\/OrbitalMap/,
    /client\/src\/components\/AstrisOrbitalLayer/,
    /server\/routes\//,
    /server\/services\//,
    /tools\/validate-v0/,
  ];
  const files = [
    ...collectFiles(p('client', 'src'), /\.(js|jsx)$/),
    ...collectFiles(p('server'), /\.mjs$/),
  ];
  for (const file of files) {
    const source = fs.readFileSync(file, 'utf8');
    for (const pattern of badPatterns) assert.doesNotMatch(source, pattern, `${path.relative(root, file)} matched ${pattern}`);
  }
});

function collectFiles(directory, pattern) {
  const result = [];
  if (!fs.existsSync(directory)) return result;
  for (const entry of fs.readdirSync(directory, { withFileTypes: true })) {
    const full = path.join(directory, entry.name);
    if (entry.isDirectory()) result.push(...collectFiles(full, pattern));
    else if (pattern.test(entry.name)) result.push(full);
  }
  return result;
}

const failures = checks.filter((item) => !item.ok);
for (const item of checks) {
  console.log(`${item.ok ? 'PASS' : 'FAIL'}  ${item.name}${item.ok ? '' : `\n      ${item.error}`}`);
}
console.log(`\nASTRIS v0.2.0 structural/map gate: ${checks.length - failures.length}/${checks.length} PASS`);
if (failures.length) process.exitCode = 1;
