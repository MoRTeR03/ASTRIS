import assert from 'node:assert/strict';
import { mkdtemp, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { createProfileService } from '../src/services/profile-service.mjs';

test('profile service persists named settings to one JSON store', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'astris-profile-'));
  const service = createProfileService({ dataDir: dir, now: () => new Date('2026-09-10T18:00:00Z') });
  await service.save('Мій глобус', {
    settings: { globe: true, brightness: 91, orbitalOverlay: { renderFps: 60 } },
    observer: { mode: 'manual', lat: 50.45, lon: 30.52, altM: 170 },
    mapView: { center: [30.52, 50.45], zoom: 2.4, bearing: 11, pitch: 0, projection: 'globe' },
  });
  const loaded = await service.get('Мій глобус');
  assert.equal(loaded.settings.globe, true);
  assert.equal(loaded.observer.mode, 'manual');
  assert.equal((await service.list()).length, 1);
  const store = JSON.parse(await readFile(path.join(dir, 'astris-profiles.json'), 'utf8'));
  assert.equal(store.schema, 'astris.profiles.v1');
  assert.ok(store.profiles['Мій глобус']);
});

test('profile writes serialize and last update remains valid JSON', async () => {
  const dir = await mkdtemp(path.join(os.tmpdir(), 'astris-profile-'));
  let tick = 0;
  const service = createProfileService({ dataDir: dir, now: () => new Date(1_800_000_000_000 + tick++ * 1000) });
  await Promise.all(Array.from({ length: 8 }, (_, index) => service.save('Stress', { settings: { revision: index } })));
  const loaded = await service.get('Stress');
  assert.equal(typeof loaded.settings.revision, 'number');
  const raw = await readFile(path.join(dir, 'astris-profiles.json'), 'utf8');
  assert.doesNotThrow(() => JSON.parse(raw));
});
