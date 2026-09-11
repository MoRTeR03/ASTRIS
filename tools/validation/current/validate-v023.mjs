import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(import.meta.dirname, '../../..');
const read = (p) => fs.readFileSync(path.join(root, p), 'utf8');
const pkg = JSON.parse(read('package.json'));
const clientPkg = JSON.parse(read('client/package.json'));
const serverPkg = JSON.parse(read('server/package.json'));
const widget = read('client/src/components/map/AstrisMapWidget.jsx');
const map = read('client/src/components/map/OrbitalMap.jsx');
const css = read('client/src/styles/map-parity.css');
const api = read('server/src/routes/api.routes.mjs');
const checks = [];
const check = (name, ok) => checks.push([name, Boolean(ok)]);
check('root version 0.2.3', pkg.version === '0.2.3');
check('client version 0.2.3', clientPkg.version === '0.2.3');
check('server version 0.2.3', serverPkg.version === '0.2.3');
check('health version 0.2.3', api.includes("version: '0.2.3'"));
check('panel-closed high-specificity workbench override', css.includes('section.astris-map-native[data-astris-map-native="true"].panel-closed .astris-map-native-workbench'));
check('panel-closed collapses to one grid column', css.includes('grid-template-columns: minmax(0, 1fr) !important;'));
check('panel-closed hides aside with high specificity', css.includes('section.astris-map-native[data-astris-map-native="true"].panel-closed .astris-map-native-panel'));
check('stage explicitly owns full closed-panel track', css.includes('grid-column: 1 / -1;') && css.includes('inline-size: 100%;'));
check('panel toggle schedules explicit map resize', widget.includes('useLayoutEffect(() =>') && widget.includes('[settings.panelOpen]') && widget.includes('mapRef.current?.resize?.()'));
check('panel resize waits two animation frames', widget.includes('raf1 = window.requestAnimationFrame') && widget.includes('raf2 = window.requestAnimationFrame'));
check('OrbitalMap resize keeps Sun reconciliation path', map.includes('resize() {') && map.includes('scheduleSpaceBackgroundSync(map, { resize: true })'));
check('v0.2.2 accepted Sun formula retained', map.includes('const rawSunDistance = Math.max(0, (180 - solarCentralAngleDeg) / 90) * Math.min(width, height) * 0.5;'));
check('MapLibre 6.9.0 retained', clientPkg.dependencies?.['maplibre-gl'] === '6.9.0');

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) failed += 1;
}
console.log(`\n${checks.length - failed}/${checks.length} checks passed`);
if (failed) process.exit(1);
