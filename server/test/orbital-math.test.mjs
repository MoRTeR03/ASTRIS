import test from 'node:test';
import assert from 'node:assert/strict';
import * as satellite from 'satellite.js';
import { eciToGeodeticAt, fullOrbitTrack, normalizeObserver, normalizeOmm } from '../src/services/catalog-service.mjs';

const OMM = {
  OBJECT_NAME: 'HELIOS 2A',
  OBJECT_ID: '2004-049A',
  EPOCH: '2025-03-26T05:19:34.116960',
  MEAN_MOTION: 15.00555103,
  ECCENTRICITY: 0.000583,
  INCLINATION: 98.3164,
  RA_OF_ASC_NODE: 103.8411,
  ARG_OF_PERICENTER: 20.5667,
  MEAN_ANOMALY: 339.5789,
  EPHEMERIS_TYPE: 0,
  CLASSIFICATION_TYPE: 'U',
  NORAD_CAT_ID: 28492,
  ELEMENT_SET_NO: 999,
  REV_AT_EPOCH: 8655,
  BSTAR: 0.00048021,
  MEAN_MOTION_DOT: 0.00005995,
  MEAN_MOTION_DDOT: 0,
};

test('ECI to geodetic conversion uses GMST for each sample time', () => {
  const position = { x: 7000, y: 0, z: 0 };
  const first = eciToGeodeticAt(position, new Date('2026-09-10T00:00:00Z'));
  const later = eciToGeodeticAt(position, new Date('2026-09-10T06:00:00Z'));
  const firstLon = satellite.degreesLong(first.longitude);
  const laterLon = satellite.degreesLong(later.longitude);
  const delta = Math.abs(((laterLon - firstLon + 540) % 360) - 180);
  assert.ok(delta > 80 && delta < 100, `expected roughly 90° Earth rotation, got ${delta}`);
});

test('full orbit track samples a valid OMM across one orbital period', () => {
  const record = normalizeOmm(OMM, 'GNSS');
  const satrec = satellite.json2satrec(OMM);
  const track = fullOrbitTrack(record, new Date('2025-03-26T05:30:00Z'), satrec, 120);
  assert.ok(track.length >= 90);
  assert.ok(track.every((point) => Number.isFinite(point.latitudeDeg) && point.latitudeDeg >= -90 && point.latitudeDeg <= 90));
  assert.ok(track.every((point) => Number.isFinite(point.longitudeDeg) && point.longitudeDeg >= -180 && point.longitudeDeg <= 180));
  assert.ok(track.every((point) => Number.isFinite(point.altitudeKm) && point.altitudeKm > 0));
  assert.notEqual(track[0].at, track.at?.(-1)?.at);
  const sceneIso = new Date('2025-03-26T05:30:00Z').toISOString();
  const sceneAnchor = track.find((point) => point.at === sceneIso);
  assert.ok(sceneAnchor, 'full orbit track must contain an exact sample at the scene epoch');
  const propagatedAtScene = satellite.propagate(satrec, new Date(sceneIso));
  assert.ok(propagatedAtScene?.position, 'scene propagation must produce a position');
  const sceneGmst = satellite.gstime(new Date(sceneIso));
  const expected = satellite.eciToGeodetic(propagatedAtScene.position, sceneGmst);
  const lonDelta = Math.abs(((sceneAnchor.longitudeDeg - satellite.degreesLong(expected.longitude) + 540) % 360) - 180);
  const latDelta = Math.abs(sceneAnchor.latitudeDeg - satellite.degreesLat(expected.latitude));
  assert.ok(lonDelta < 1e-7 && latDelta < 1e-7, `scene anchor mismatch lon=${lonDelta} lat=${latDelta}`);
});

test('observer normalization rejects impossible coordinates', () => {
  assert.deepEqual(normalizeObserver({ lat: 0, lon: 0 }), { lat: 0, lon: 0, altM: 0 });
  assert.throws(() => normalizeObserver({ lat: 90.01, lon: 0 }), /latitude/);
  assert.throws(() => normalizeObserver({ lat: 0, lon: 180.01 }), /longitude/);
  assert.throws(() => normalizeObserver({ lat: 0, lon: 0, altM: 100001 }), /altitude/);
});
