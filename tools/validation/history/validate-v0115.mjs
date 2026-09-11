import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve(path.dirname(new URL(import.meta.url).pathname), '..');
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8');
const checks = [];
const add = (name, ok) => checks.push({ name, ok: Boolean(ok) });

const pkg = JSON.parse(read('package.json'));
const clientPkg = JSON.parse(read('client/package.json'));
const serverPkg = JSON.parse(read('server/package.json'));
const api = read('server/routes/api.routes.mjs');
const widget = read('client/src/components/AstrisMapWidget.jsx');
const map = read('client/src/components/OrbitalMap.jsx');
const native = read('client/src/components/AstrisOrbitalLayer.js');
const css = read('client/src/map-parity.css');
const settings = read('client/src/map/MapSettingsStore.js');

add('root version 0.1.15', pkg.version === '0.1.15');
add('client version 0.1.15', clientPkg.version === '0.1.15');
add('server version 0.1.15', serverPkg.version === '0.1.15');
add('health version 0.1.15', api.includes("version: '0.1.15'"));
add('map parity script points to v0.1.15', pkg.scripts?.['check:map-parity'] === 'node tools/validate-v0115.mjs');

add('base label visibility no longer belongs to style key', map.includes("return `${settings.layer}|${cfg.kind || 'style'}`") && !map.includes("|labels:${settings.labels"));
add('raster labels update in place with setTiles', map.includes("typeof source.setTiles === 'function'") && map.includes('source.setTiles(expandTileTemplates(selectedUrl))'));
add('base labels have dedicated live layout effect', map.includes('applyBaseLabelsLive(map);') && map.includes('}, [settings.labels, settings.layer]);'));
add('orbital labels have dedicated live layout effect', map.includes('applyOrbitalLabelsLive(map);') && map.includes('settings.orbitalOverlay.labels, settings.globe]'));
add('native globe label layer exposes immediate refresh', native.includes('refreshLabels()') && native.includes('lastLabelProjectionAt = 0') && native.includes('viewportSelectionDirty = true'));
add('orbital label live apply forces native refresh', map.includes('nativeRef.current?.refreshLabels?.()'));

add('quick actions use v0.1.5 icon-first controls', widget.includes('<LocateFixed size={14} /><span>Observer</span>')
  && widget.includes('<Grid3X3 size={14} /><span>Grid</span>')
  && widget.includes('<Tags size={14} /><span>Labels</span>')
  && widget.includes('<RefreshCw size={14} /><span>Catalog</span>'));
add('quick action v0.1.5 CSS contract present', css.includes('exact v0.1.5 quick-actions visual contract')
  && css.includes('gap: 5px;') && css.includes('stroke-width: 1.8;'));

add('globe and buildings remain independent', !settings.includes('if (next.globe) next.buildings = false')
  && !widget.includes("patch({ buildings: true, globe: false })")
  && !map.includes('if (!s.buildings || s.globe)'));
add('single production map stylesheet remains', !fs.existsSync(path.join(root, 'client/src/astris-map-v015.css'))
  && !fs.existsSync(path.join(root, 'client/src/irmas-map-parity.css')));

const failed = checks.filter((c) => !c.ok);
for (const check of checks) console.log(`${check.ok ? 'PASS' : 'FAIL'} ${check.name}`);
console.log(`\n${checks.length - failed.length}/${checks.length} PASS`);
if (failed.length) process.exit(1);
