import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../../..');
const p = (...parts) => path.join(root, ...parts);
const read = (...parts) => fs.readFileSync(p(...parts), 'utf8');
const json = (...parts) => JSON.parse(read(...parts));
const checks=[];
function check(name, fn){try{fn();checks.push({name,ok:true});}catch(error){checks.push({name,ok:false,error:error?.message||String(error)});}}
const rootPackage=json('package.json');
const clientPackage=json('client','package.json');
const serverPackage=json('server','package.json');
const orbital=read('client','src','components','map','OrbitalMap.jsx');
const widget=read('client','src','components','map','AstrisMapWidget.jsx');
const css=read('client','src','styles','map-parity.css');
const routes=read('server','src','routes','api.routes.mjs');
const readme=read('README.md');

check('root package 0.2.1',()=>assert.equal(rootPackage.version,'0.2.1'));
check('client package 0.2.1',()=>assert.equal(clientPackage.version,'0.2.1'));
check('server package 0.2.1',()=>assert.equal(serverPackage.version,'0.2.1'));
check('health endpoint 0.2.1',()=>assert.match(routes,/version:\s*['"]0\.2\.1['"]/));
check('MapLibre remains pinned 6.9.0',()=>assert.equal(clientPackage.dependencies['maplibre-gl'],'6.9.0'));
check('active validator is v0.2.1',()=>assert.equal(rootPackage.scripts['check:map-parity'],'node tools/validation/current/validate-v021.mjs'));
check('solar viewport uses MapLibre backing canvas + applied pixel ratio',()=>{assert.match(orbital,/map\.getPixelRatio\?\.\(\)/);assert.match(orbital,/canvas\?\.width/);assert.match(orbital,/backingWidthCss/);});
check('solar center is render viewport center',()=>{assert.match(orbital,/const centerX = width \/ 2/);assert.match(orbital,/const centerY = height \/ 2/);});
check('solar distance is tied to projected Earth radius',()=>assert.match(orbital,/\* projectedEarthRadius/));
check('map resize re-synchronizes synthetic sky',()=>{assert.match(orbital,/const onMapResize = \(\) =>/);assert.match(orbital,/map\.on\(['"]resize['"], onMapResize\)/);});
check('first style-ready pass has post-layout Sun sync',()=>assert.match(orbital,/first application frame/));
check('imperative resize re-synchronizes Sun',()=>assert.match(orbital,/map\.resize\(\{ astrisLayout: true \}\)/));
check('panel disclosure changes trigger resize reconciliation',()=>assert.match(widget,/\[settings\.panelOpen, settings\.panelSections\]/));
check('3D building title stack is normalized',()=>{assert.match(css,/\.astris-map-building-title > span:last-child/);assert.match(css,/\.astris-map-building-title b/);assert.match(css,/\.astris-map-building-title small/);});
check('observer marker title stack is normalized',()=>{assert.match(css,/\.astris-map-marker-control-head > div > span:last-child/);assert.match(css,/\.astris-map-marker-control-head b/);assert.match(css,/\.astris-map-marker-control-head small/);});
check('README declares v0.2.1',()=>assert.match(readme,/baseline:\s*`v0\.2\.1`/i));
check('v0.2.1 release doc exists',()=>assert.ok(fs.existsSync(p('docs','releases','v0.2.1','ASTRIS_v0.2.1_SUN_LAYOUT_TYPOGRAPHY_UA.md'))));

const failures=checks.filter(x=>!x.ok);
for(const x of checks) console.log(`${x.ok?'PASS':'FAIL'}  ${x.name}${x.ok?'':`\n      ${x.error}`}`);
console.log(`\nASTRIS v0.2.1 Sun/layout/typography gate: ${checks.length-failures.length}/${checks.length} PASS`);
if(failures.length) process.exitCode=1;
