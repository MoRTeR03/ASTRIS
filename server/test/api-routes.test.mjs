import test from 'node:test';
import assert from 'node:assert/strict';
import { parseSceneQuery, parseSearchQuery, RequestValidationError } from '../src/routes/query-validation.mjs';

test('scene query accepts valid observer and preserves coordinates', () => {
  const parsed = parseSceneQuery({ lat: '48.62', lon: '22.30', altM: '120', mode: 'visible', horizonDeg: '5', limit: '2500' });
  assert.deepEqual(parsed.observer, { lat: 48.62, lon: 22.30, altM: 120 });
  assert.equal(parsed.mode, 'visible');
  assert.equal(parsed.horizonDeg, 5);
  assert.equal(parsed.limit, 2500);
});

test('scene query rejects incomplete or out-of-range observer instead of clamping it', () => {
  assert.throws(() => parseSceneQuery({ lat: '48.6' }), RequestValidationError);
  assert.throws(() => parseSceneQuery({ lat: '91', lon: '22.3' }), /lat must be within -90\.\.90/);
  assert.throws(() => parseSceneQuery({ lat: '48.6', lon: '-181' }), /lon must be within -180\.\.180/);
});

test('visible mode requires an observer', () => {
  assert.throws(() => parseSceneQuery({ mode: 'visible' }), /visible mode requires lat and lon/);
});

test('scene query rejects invalid mode, time, limit, catalogs and NORAD id', () => {
  assert.throws(() => parseSceneQuery({ mode: 'planetarium' }), /mode must be global or visible/);
  assert.throws(() => parseSceneQuery({ at: 'not-a-date' }), /valid date\/time/);
  assert.throws(() => parseSceneQuery({ limit: '20001' }), /limit must be within 1\.\.20000/);
  assert.throws(() => parseSceneQuery({ catalogs: 'GNSS,UNKNOWN' }), /unsupported values/);
  assert.throws(() => parseSceneQuery({ selectedNoradId: 'GPS-22' }), /numeric NORAD/);
});


test('search query validates lightweight catalogue lookup', () => {
  assert.deepEqual(parseSearchQuery({ query: 'STARLINK', catalogs: 'STARLINK', constellations: 'STARLINK', limit: '12' }), {
    catalogs: ['STARLINK'], constellations: ['STARLINK'], query: 'STARLINK', limit: 12,
  });
  assert.throws(() => parseSearchQuery({ query: 'x' }), /at least 2/);
  assert.throws(() => parseSearchQuery({ query: 'GPS', limit: '99' }), /within 1..50/);
});
