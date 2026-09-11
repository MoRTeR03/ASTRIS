import assert from 'node:assert/strict';
import { performance } from 'node:perf_hooks';
import { selectInteractiveMarkerRows } from '../../client/src/map/rendering/AstrisOrbitalLayer.js';

const rows = Array.from({ length: 15000 }, (_, index) => ({
  noradId: String(60000 + index),
  constellation: index < 180 ? ['GPS','GLONASS','GALILEO','BEIDOU','QZSS','SBAS'][index % 6] : 'STARLINK',
  visible: index % 7 === 0,
  elevationDeg: index % 7 === 0 ? 80 - (index % 80) : -20,
}));
const selected = rows.at(-1).noradId;
const started = performance.now();
const picked = selectInteractiveMarkerRows(rows, selected);
const elapsed = performance.now() - started;
assert.equal(picked.length, 360);
assert.equal(picked[0].noradId, selected);
assert.ok(picked.some((row) => row.constellation === 'GPS'));
console.log(JSON.stringify({ ok: true, inputRows: rows.length, domRows: picked.length, selectedPreserved: picked[0].noradId === selected, selectMs: Number(elapsed.toFixed(3)) }, null, 2));
