import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const widget = read('client/src/components/AstrisMapWidget.jsx');
const map = read('client/src/components/OrbitalMap.jsx');
const css = read('client/src/map-parity.css');
const settings = read('client/src/map/MapSettingsStore.js');

const checks = [
  ['controlled panel disclosure', widget.includes('astris-map-panel-section-summary') && widget.includes('aria-expanded={open}')],
  ['IRMAS LOS segmented mode', widget.includes('ФІЗИЧНИЙ LOS') && widget.includes('СТАРИЙ ПРЯМИЙ')],
  ['LOS setting persistence', settings.includes("observerLinkMode: 'physical'") && settings.includes("'legacy-scale'")],
  ['WGS84 LOS integration', map.includes('evaluateObserverLineOfSight') && map.includes('observerGlobeLineOfSight')],
  ['camera-linked synthetic sky', map.includes('syncSpaceBackgroundCamera') && css.includes('--astris-space-x')],
  ['solar disc', map.includes('solarSubpoint') && css.includes('--astris-sun-opacity') && css.includes('is-space-synthetic::after')],
  ['dark orbital buttons', css.includes('.astris-map-native-panel .astris-map-orbital-options button') && css.includes('background: rgba(22, 25, 33, .92)')],
  ['canonical dark range track', css.includes("input[type='range']::-webkit-slider-runnable-track") && css.includes('background: #24242b')],
];

const losModule = await import(pathToFileURL(path.join(root, 'client/src/map/OrbitalLineOfSight.js')).href);
const overhead = losModule.evaluateObserverLineOfSight(
  { lat: 0, lon: 0, altM: 0 },
  { latitudeDeg: 0, longitudeDeg: 0, altitudeKm: 550, renderedAltitudeM: 275_000, visible: true, elevationDeg: 90 },
  { guardDeg: 0.12 },
);
const backside = losModule.evaluateObserverLineOfSight(
  { lat: 0, lon: 0, altM: 0 },
  { latitudeDeg: 0, longitudeDeg: 180, altitudeKm: 550, renderedAltitudeM: 275_000, visible: false, elevationDeg: -90 },
  { guardDeg: 0.12 },
);
checks.push(['physical LOS overhead visible', overhead.physicalVisible === true]);
checks.push(['physical LOS backside occluded', backside.physicalVisible === false]);

let failed = 0;
for (const [name, ok] of checks) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`);
  if (!ok) failed += 1;
}
console.log(`\nASTRIS v0.1.4 parity checks: ${checks.length - failed}/${checks.length}`);
if (failed) process.exit(1);
