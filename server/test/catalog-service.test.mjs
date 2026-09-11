import test from 'node:test';
import assert from 'node:assert/strict';
import { detectConstellation, normalizeOmm, MIN_REFRESH_MS } from '../src/services/catalog-service.mjs';

test('detects main GNSS constellations and Starlink', () => {
  assert.equal(detectConstellation('GPS BIIR-5 (PRN 22)'), 'GPS');
  assert.equal(detectConstellation('GLONASS-M 730'), 'GLONASS');
  assert.equal(detectConstellation('GALILEO 24'), 'GALILEO');
  assert.equal(detectConstellation('BEIDOU-3 M20'), 'BEIDOU');
  assert.equal(detectConstellation('QZS-6'), 'QZSS');
  assert.equal(detectConstellation('EGNOS 5'), 'SBAS');
  assert.equal(detectConstellation('STARLINK-1234', 'STARLINK'), 'STARLINK');
});

test('normalizes OMM record', () => {
  const row = normalizeOmm({
    OBJECT_NAME: 'GPS BIIR-5 (PRN 22)',
    OBJECT_ID: '2000-040A',
    NORAD_CAT_ID: 26407,
    EPOCH: '2026-09-10T00:00:00.000000',
    MEAN_MOTION: 2.0056,
    ECCENTRICITY: 0.01,
    INCLINATION: 55,
  }, 'GNSS');
  assert.equal(row.noradId, '26407');
  assert.equal(row.constellation, 'GPS');
  assert.equal(row.prn, 22);
  assert.equal(row.catalogKind, 'GNSS');
});

test('CelesTrak refresh floor is two hours', () => {
  assert.equal(MIN_REFRESH_MS, 7_200_000);
});

const SAMPLE_OMM = {
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

test('visible scene applies horizon filter and reports visibility consistently', async () => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const { createCatalogService } = await import('../src/services/catalog-service.mjs');
  const temp = await mkdtemp(path.join(tmpdir(), 'astris-test-'));
  try {
    const fetchImpl = async () => ({ ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify([SAMPLE_OMM]) });
    const service = createCatalogService({ cacheDir: temp, fetchImpl, now: () => Date.parse('2025-03-26T05:30:00Z') });
    const global = await service.scene({
      catalogs: ['GNSS'], observer: { lat: 48.62, lon: 22.30, altM: 120 }, mode: 'global', horizonDeg: 0, limit: 100,
      at: new Date('2025-03-26T05:30:00Z'),
    });
    assert.equal(global.rows.length, 1);
    assert.equal(typeof global.rows[0].visible, 'boolean');
    const threshold = Math.max(-10, Math.min(90, global.rows[0].elevationDeg + 0.1));
    const visible = await service.scene({
      catalogs: ['GNSS'], observer: { lat: 48.62, lon: 22.30, altM: 120 }, mode: 'visible', horizonDeg: threshold, limit: 100,
      at: new Date('2025-03-26T05:30:00Z'),
    });
    assert.equal(visible.rows.length, 0);
    assert.equal(visible.visibleCount, 0);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});


test('provider-chain failure opens a cooldown instead of hammering upstreams', async () => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const { createCatalogService, CatalogUnavailableError } = await import('../src/services/catalog-service.mjs');
  const temp = await mkdtemp(path.join(tmpdir(), 'astris-backoff-'));
  let calls = 0;
  try {
    const fetchImpl = async () => {
      calls += 1;
      return { ok: false, status: 403, headers: { get: () => null }, text: async () => 'GP data has not updated since your last successful download' };
    };
    const service = createCatalogService({ cacheDir: temp, fetchImpl, now: () => Date.parse('2026-09-11T00:00:00Z') });
    await assert.rejects(() => service.scene({ catalogs: ['GNSS'], constellations: ['GPS'], limit: 10 }), CatalogUnavailableError);
    await assert.rejects(() => service.scene({ catalogs: ['GNSS'], constellations: ['GPS'], limit: 10 }), CatalogUnavailableError);
    assert.equal(calls, 2); // primary CelesTrak + one mirror attempt; second scene stays in cooldown
    assert.ok(service.status().GNSS.retryAfterMs >= MIN_REFRESH_MS);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});

test('last good cache remains usable when provider refresh fails', async () => {
  const { mkdtemp, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const { createCatalogService } = await import('../src/services/catalog-service.mjs');
  const temp = await mkdtemp(path.join(tmpdir(), 'astris-stale-'));
  let nowMs = Date.parse('2025-03-26T05:30:00Z');
  let fail = false;
  try {
    const fetchImpl = async () => fail
      ? ({ ok: false, status: 503, headers: { get: () => null }, text: async () => 'temporary outage' })
      : ({ ok: true, status: 200, headers: { get: () => null }, text: async () => JSON.stringify([SAMPLE_OMM]) });
    const service = createCatalogService({ cacheDir: temp, fetchImpl, now: () => nowMs });
    const first = await service.scene({ catalogs: ['GNSS'], constellations: [], limit: 10, at: new Date(nowMs) });
    assert.equal(first.rows.length, 1);
    fail = true;
    nowMs += MIN_REFRESH_MS + 1000;
    const stale = await service.scene({ catalogs: ['GNSS'], constellations: [], limit: 10, at: new Date(nowMs) });
    assert.equal(stale.rows.length, 1);
    assert.equal(stale.catalogs.GNSS.degraded, true);
    assert.equal(stale.catalogs.GNSS.stale, true);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});


test('CelesTrak 403 falls back to the OMM mirror and persists a usable scene', async () => {
  const { mkdtemp, rm, readFile } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const path = await import('node:path');
  const { createCatalogService } = await import('../src/services/catalog-service.mjs');
  const temp = await mkdtemp(path.join(tmpdir(), 'astris-mirror-'));
  const calls = [];
  try {
    const fetchImpl = async (url) => {
      calls.push(String(url));
      if (String(url).includes('celestrak.org')) {
        return {
          ok: false,
          status: 403,
          headers: { get: () => null },
          text: async () => '<!DOCTYPE html><html><title>403 - Forbidden</title><body>Access is denied.</body></html>',
        };
      }
      return {
        ok: true,
        status: 200,
        headers: { get: (name) => String(name).toLowerCase() === 'last-modified' ? 'Thu, 10 Sep 2026 20:00:00 GMT' : null },
        text: async () => JSON.stringify([SAMPLE_OMM]),
      };
    };
    const nowMs = Date.parse('2026-09-11T00:00:00Z');
    const service = createCatalogService({ cacheDir: temp, fetchImpl, now: () => nowMs });
    const scene = await service.scene({ catalogs: ['GNSS'], limit: 10, at: new Date(nowMs) });
    assert.equal(scene.rows.length, 1);
    assert.equal(scene.catalogs.GNSS.provider, 'Satvisor mirror');
    assert.equal(scene.catalogs.GNSS.originProvider, 'CelesTrak');
    assert.equal(scene.catalogs.GNSS.fallbackUsed, true);
    assert.equal(scene.catalogs.GNSS.degraded, true);
    assert.ok(scene.catalogs.GNSS.providerWarning.includes('HTTP 403'));
    assert.equal(scene.catalogs.GNSS.providerWarning.includes('<!DOCTYPE'), false);
    assert.equal(calls.length, 2);
    const disk = JSON.parse(await readFile(path.join(temp, 'gnss.json'), 'utf8'));
    assert.equal(disk.provider, 'Satvisor mirror');
    assert.equal(disk.records.length, 1);
  } finally {
    await rm(temp, { recursive: true, force: true });
  }
});
