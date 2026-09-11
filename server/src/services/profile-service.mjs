import path from 'node:path';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';

const PROFILE_SCHEMA = 'astris.profiles.v1';
const MAX_PROFILES = 64;
const MAX_PROFILE_NAME = 64;

function cleanName(value) {
  const name = String(value ?? '').trim().replace(/\s+/g, ' ');
  if (!name || name.length > MAX_PROFILE_NAME) throw new TypeError(`profile name must be 1..${MAX_PROFILE_NAME} characters`);
  if(/[\u0000-\u001f<>:"/\\|?*]/.test(name)) throw new TypeError('profile name contains unsupported characters');
  return name;
}

function finite(value, fallback = null) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function normalizeObserver(value) {
  if (!value || typeof value !== 'object') return null;
  const mode = value.mode === 'manual' ? 'manual' : 'ip';
  const lat = finite(value.lat);
  const lon = finite(value.lon);
  const altM = finite(value.altM, 0);
  if (mode === 'manual') {
    if (lat === null || lon === null || lat < -90 || lat > 90 || lon < -180 || lon > 180) {
      throw new TypeError('manual profile observer requires valid lat/lon');
    }
    return { mode, lat, lon, altM: Math.max(-500, Math.min(20_000, altM)) };
  }
  return { mode: 'ip' };
}

function normalizeMapView(value) {
  if (!value || typeof value !== 'object') return null;
  const center = Array.isArray(value.center) ? value.center : [];
  const lon = finite(center[0]);
  const lat = finite(center[1]);
  const zoom = finite(value.zoom);
  const bearing = finite(value.bearing, 0);
  const pitch = finite(value.pitch, 0);
  const projection = value.projection === 'globe' ? 'globe' : 'mercator';
  if (lon === null || lat === null || zoom === null || lon < -180 || lon > 180 || lat < -90 || lat > 90) return null;
  return {
    center: [lon, lat],
    zoom: Math.max(0, Math.min(24, zoom)),
    bearing: ((bearing % 360) + 360) % 360,
    pitch: Math.max(0, Math.min(85, pitch)),
    projection,
  };
}

function normalizeSettings(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('profile settings object is required');
  // The authoritative shape is normalized by MapSettingsStore on the client.
  // Server persistence intentionally preserves forward-compatible keys while
  // preventing prototypes/functions and pathological payloads.
  const serialized = JSON.stringify(value);
  if (!serialized || serialized.length > 96_000) throw new TypeError('profile settings are too large');
  const parsed = JSON.parse(serialized);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new TypeError('invalid profile settings');
  return parsed;
}

function emptyStore() {
  return { schema: PROFILE_SCHEMA, updatedAt: null, profiles: {} };
}

async function readStore(filePath) {
  try {
    const parsed = JSON.parse(await readFile(filePath, 'utf8'));
    if (parsed?.schema !== PROFILE_SCHEMA || !parsed.profiles || typeof parsed.profiles !== 'object') return emptyStore();
    return parsed;
  } catch (error) {
    if (error?.code === 'ENOENT') return emptyStore();
    throw error;
  }
}

export function createProfileService({ dataDir, now = () => new Date() } = {}) {
  if (!dataDir) throw new TypeError('dataDir is required');
  const filePath = path.join(dataDir, 'astris-profiles.json');
  let writeQueue = Promise.resolve();

  async function persist(store) {
    await mkdir(dataDir, { recursive: true });
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tempPath, `${JSON.stringify(store, null, 2)}\n`, 'utf8');
    await rename(tempPath, filePath);
  }

  function enqueueWrite(task) {
    const next = writeQueue.then(task, task);
    writeQueue = next.catch(() => {});
    return next;
  }

  async function list() {
    await writeQueue;
    const store = await readStore(filePath);
    return Object.values(store.profiles)
      .map(({ name, updatedAt, createdAt }) => ({ name, updatedAt, createdAt }))
      .sort((a, b) => String(a.name).localeCompare(String(b.name), 'uk'));
  }

  async function get(nameValue) {
    await writeQueue;
    const name = cleanName(nameValue);
    const store = await readStore(filePath);
    return store.profiles[name] || null;
  }

  async function save(nameValue, payload = {}) {
    const name = cleanName(nameValue);
    const settings = normalizeSettings(payload.settings);
    const observer = normalizeObserver(payload.observer);
    const mapView = normalizeMapView(payload.mapView);
    return enqueueWrite(async () => {
      const store = await readStore(filePath);
      const existing = store.profiles[name];
      if (!existing && Object.keys(store.profiles).length >= MAX_PROFILES) throw new TypeError(`profile limit ${MAX_PROFILES} reached`);
      const timestamp = now().toISOString();
      const profile = {
        name,
        createdAt: existing?.createdAt || timestamp,
        updatedAt: timestamp,
        settings,
        observer,
        mapView,
      };
      store.profiles[name] = profile;
      store.updatedAt = timestamp;
      await persist(store);
      return profile;
    });
  }

  async function remove(nameValue) {
    const name = cleanName(nameValue);
    return enqueueWrite(async () => {
      const store = await readStore(filePath);
      if (!store.profiles[name]) return false;
      delete store.profiles[name];
      store.updatedAt = now().toISOString();
      await persist(store);
      return true;
    });
  }

  async function exportStore() {
    await writeQueue;
    return readStore(filePath);
  }

  return { list, get, save, remove, exportStore, filePath };
}
