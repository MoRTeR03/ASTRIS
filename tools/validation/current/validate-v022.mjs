import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const pkg = JSON.parse(read('package.json'));
const clientPkg = JSON.parse(read('client/package.json'));
const serverPkg = JSON.parse(read('server/package.json'));
const map = read('client/src/components/map/OrbitalMap.jsx');
const widget = read('client/src/components/map/AstrisMapWidget.jsx');
const api = read('server/src/routes/api.routes.mjs');
const checks = [];
const check = (name, ok) => checks.push([name, Boolean(ok)]);
check('root version 0.2.2', pkg.version === '0.2.2');
check('client version 0.2.2', clientPkg.version === '0.2.2');
check('server version 0.2.2', serverPkg.version === '0.2.2');
check('health version 0.2.2', api.includes("version: '0.2.2'"));
check('accepted Sun distance formula restored', map.includes('const rawSunDistance = Math.max(0, (180 - solarCentralAngleDeg) / 90) * Math.min(width, height) * 0.5;'));
check('projected-Earth-radius solar scaling removed', !map.includes('Math.max(0, Math.min(2.25, (180 - solarCentralAngleDeg) / 90)) * projectedEarthRadius'));
check('ResizeObserver used on actual map container', map.includes('new ResizeObserver') && map.includes('resizeObserver?.observe(containerRef.current)'));
check('Sun waits for MapLibre render after resize', map.includes("map.once('render', onRender)") && map.includes('scheduleSpaceBackgroundSync(map, { resize: true })'));
check('cold start reuses Reset preset', map.includes('bootstrapPresetAppliedRef') && map.includes("applyViewPreset(map, stateRef.current.settings.globe ? 'globe'"));
check('panel disclosure no longer drives guessed resize effect', !widget.includes('[settings.panelOpen, settings.panelSections]'));
check('panel typography retained', read('client/src/styles/map-parity.css').includes('ASTRIS v0.2.1 — panel typography'));
check('MapLibre 6.9.0 retained', clientPkg.dependencies?.['maplibre-gl'] === '6.9.0');

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) failed += 1;
}
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
if (failed) process.exit(1);
