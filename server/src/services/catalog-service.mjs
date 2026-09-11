import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import * as satellite from 'satellite.js';

const CELESTRAK_BASE = 'https://celestrak.org/NORAD/elements/gp.php';
const CELESTRAK_MIRROR_BASE = 'https://raw.githubusercontent.com/satvisorcom/satvisor-data/master/celestrak/json';
export const MIN_REFRESH_MS = 2 * 60 * 60 * 1000;
const TRANSIENT_RETRY_BASE_MS = 30_000;
const TRANSIENT_RETRY_MAX_MS = 15 * 60 * 1000;
const DEG = 180 / Math.PI;

const CATALOGS = Object.freeze({
  GNSS: { group: 'GNSS', label: 'GNSS', cache: 'gnss.json', mirrorSlug: 'gnss', maxItems: 1500 },
  STARLINK: { group: 'STARLINK', label: 'Starlink', cache: 'starlink.json', mirrorSlug: 'starlink', maxItems: 20000 },
});

export class CatalogUnavailableError extends Error {
  constructor(catalog, message, { retryAfterMs = 0, upstreamStatus = null } = {}) {
    super(message);
    this.name = 'CatalogUnavailableError';
    this.catalog = catalog;
    this.retryAfterMs = Math.max(0, Number(retryAfterMs) || 0);
    this.upstreamStatus = Number.isFinite(Number(upstreamStatus)) ? Number(upstreamStatus) : null;
  }
}

function parseRetryAfterMs(response) {
  try {
    const raw = response?.headers?.get?.('retry-after');
    if (!raw) return 0;
    const seconds = Number(raw);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const at = Date.parse(raw);
    return Number.isFinite(at) ? Math.max(0, at - Date.now()) : 0;
  } catch {
    return 0;
  }
}

function transientBackoffMs(failureCount) {
  const exponent = Math.max(0, Math.min(6, Number(failureCount || 1) - 1));
  return Math.min(TRANSIENT_RETRY_MAX_MS, TRANSIENT_RETRY_BASE_MS * (2 ** exponent));
}

function providerCooldownMs(error, failureCount) {
  const status = Number(error?.upstreamStatus);
  const retryAfter = Math.max(0, Number(error?.retryAfterMs) || 0);
  // CelesTrak explicitly asks clients not to redownload GP data more often
  // than once per 2-hour update. A 403/429 therefore opens a full update
  // window instead of hammering the provider from the scene poll loop.
  if (status === 403 || status === 429) return Math.max(MIN_REFRESH_MS, retryAfter);
  if (status === 400 || status === 404) return Math.max(MIN_REFRESH_MS, retryAfter);
  return Math.max(retryAfter, transientBackoffMs(failureCount));
}

function finite(value, fallback = null) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function normalizeText(value) {
  return String(value ?? '').trim();
}

function sanitizeProviderText(value, maxLength = 280) {
  const text = String(value ?? '')
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
  return text.slice(0, maxLength);
}

function lastModifiedMs(response, fallbackMs) {
  try {
    const value = Date.parse(response?.headers?.get?.('last-modified') || '');
    return Number.isFinite(value) ? value : fallbackMs;
  } catch {
    return fallbackMs;
  }
}

async function fetchOmmProvider({ fetchImpl, url, provider, definition, key, userAgent, nowMs }) {
  let response;
  try {
    response = await fetchImpl(url, {
      signal: AbortSignal.timeout(20_000),
      headers: {
        Accept: 'application/json',
        'User-Agent': userAgent,
        'Cache-Control': 'max-age=120',
      },
    });
  } catch (cause) {
    const detail = sanitizeProviderText(cause?.message || String(cause), 180);
    const error = new Error(`${provider} ${definition.group}: network request failed${detail ? ` — ${detail}` : ''}`);
    error.provider = provider;
    throw error;
  }

  const body = await response.text();
  if (!response.ok) {
    const detail = sanitizeProviderText(body, 220);
    const error = new Error(`${provider} ${definition.group}: HTTP ${response.status}${detail ? ` — ${detail}` : ''}`);
    error.provider = provider;
    error.upstreamStatus = response.status;
    error.retryAfterMs = parseRetryAfterMs(response);
    throw error;
  }

  let payload;
  try { payload = JSON.parse(body); }
  catch {
    const error = new TypeError(`${provider} ${definition.group}: invalid JSON response`);
    error.provider = provider;
    error.upstreamStatus = response.status;
    throw error;
  }
  if (!Array.isArray(payload)) {
    const error = new TypeError(`${provider} ${definition.group}: expected JSON array`);
    error.provider = provider;
    error.upstreamStatus = response.status;
    throw error;
  }
  const records = payload.map((row) => normalizeOmm(row, key)).filter(Boolean);
  if (!records.length) {
    const error = new Error(`${provider} ${definition.group}: empty catalog`);
    error.provider = provider;
    error.upstreamStatus = response.status;
    throw error;
  }
  if (records.length > definition.maxItems) {
    const error = new Error(`${provider} ${definition.group}: catalog too large (${records.length})`);
    error.provider = provider;
    error.upstreamStatus = response.status;
    throw error;
  }
  return {
    records,
    httpStatus: response.status,
    sourceUpdatedAt: lastModifiedMs(response, nowMs),
  };
}

export function detectConstellation(nameValue, catalogKind = 'GNSS') {
  if (String(catalogKind).toUpperCase() === 'STARLINK') return 'STARLINK';
  const name = normalizeText(nameValue).toUpperCase();
  if (/\bGPS\b/.test(name)) return 'GPS';
  if (/\bGLONASS\b|\bCOSMOS\b/.test(name)) return 'GLONASS';
  if (/\bGALILEO\b|\bGSAT\b/.test(name)) return 'GALILEO';
  if (/\bBEIDOU\b|\bBDS\b|\bCOMPASS\b/.test(name)) return 'BEIDOU';
  if (/\bQZS\b|\bQZSS\b|MICHIBIKI/.test(name)) return 'QZSS';
  if (/WAAS|EGNOS|MSAS|GAGAN|SDCM|KASS|SOUTHPAN|SBAS/.test(name)) return 'SBAS';
  return 'OTHER';
}

function parsePrn(nameValue) {
  const name = normalizeText(nameValue).toUpperCase();
  const match = name.match(/\bPRN\s*[-:#]?\s*([A-Z]?\d{1,3})\b/);
  if (!match) return null;
  const numeric = Number(match[1].replace(/^[A-Z]/, ''));
  return Number.isFinite(numeric) ? numeric : null;
}

export function normalizeOmm(record, catalogKind) {
  if (!record || typeof record !== 'object') return null;
  const noradId = normalizeText(record.NORAD_CAT_ID ?? record.NORAD_ID ?? record.CATNR);
  const objectName = normalizeText(record.OBJECT_NAME ?? record.SATNAME ?? record.NAME);
  if (!noradId || !objectName) return null;
  const epoch = normalizeText(record.EPOCH) || null;
  return {
    noradId,
    objectName,
    objectId: normalizeText(record.OBJECT_ID) || null,
    catalogKind: String(catalogKind).toUpperCase(),
    constellation: detectConstellation(objectName, catalogKind),
    prn: parsePrn(objectName),
    epoch,
    epochMs: epoch ? Date.parse(epoch) : null,
    meanMotion: finite(record.MEAN_MOTION),
    eccentricity: finite(record.ECCENTRICITY),
    inclinationDeg: finite(record.INCLINATION),
    raw: record,
  };
}

function publicRecord(record) {
  return {
    noradId: record.noradId,
    objectName: record.objectName,
    objectId: record.objectId,
    catalogKind: record.catalogKind,
    constellation: record.constellation,
    prn: record.prn,
    epoch: record.epoch,
    epochMs: record.epochMs,
    meanMotion: record.meanMotion,
    eccentricity: record.eccentricity,
    inclinationDeg: record.inclinationDeg,
  };
}


function sceneNumber(value, digits = 6) {
  if (value == null || value === '') return null;
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const scale = 10 ** digits;
  return Math.round(number * scale) / scale;
}

function sceneRecord(record) {
  // Keep the high-rate scene payload intentionally compact. Full catalogue
  // metadata stays available through the lightweight search/selected path.
  return {
    noradId: record.noradId,
    objectName: record.objectName,
    constellation: record.constellation,
    prn: record.prn,
  };
}

export function normalizeObserver(observer) {
  if (observer == null) return null;
  const lat = Number(observer.lat);
  const lon = Number(observer.lon);
  const altM = observer.altM == null || observer.altM === '' ? 0 : Number(observer.altM);
  if (!Number.isFinite(lat) || lat < -90 || lat > 90) throw new TypeError('Observer latitude must be within -90..90');
  if (!Number.isFinite(lon) || lon < -180 || lon > 180) throw new TypeError('Observer longitude must be within -180..180');
  if (!Number.isFinite(altM) || altM < -500 || altM > 100000) throw new TypeError('Observer altitude must be within -500..100000 m');
  return { lat, lon, altM };
}

export function eciToGeodeticAt(position, date) {
  if (!position || !Number.isFinite(Number(position.x)) || !Number.isFinite(Number(position.y)) || !Number.isFinite(Number(position.z))) {
    throw new TypeError('Finite ECI position is required');
  }
  const sampleDate = date instanceof Date ? date : new Date(date);
  if (!Number.isFinite(sampleDate.getTime())) throw new TypeError('Valid date is required');
  const gmst = satellite.gstime(sampleDate);
  return satellite.eciToGeodetic(position, gmst);
}

function cacheFile(cacheDir, definition) {
  return path.join(cacheDir, definition.cache);
}

async function readCache(cacheDir, key) {
  const definition = CATALOGS[key];
  try {
    const payload = JSON.parse(await readFile(cacheFile(cacheDir, definition), 'utf8'));
    const records = Array.isArray(payload.records)
      ? payload.records.map((row) => normalizeOmm(row, key)).filter(Boolean)
      : [];
    if (!records.length) return null;
    return {
      records,
      savedAt: finite(payload.savedAt, 0),
      sourceUpdatedAt: finite(payload.sourceUpdatedAt, 0),
      provider: normalizeText(payload.provider) || 'CelesTrak',
      originProvider: normalizeText(payload.originProvider) || 'CelesTrak',
      providerWarning: normalizeText(payload.providerWarning),
    };
  } catch {
    return null;
  }
}

async function writeCache(cacheDir, key, records, savedAtMs, sourceUpdatedAtMs = savedAtMs, providerMeta = {}) {
  const definition = CATALOGS[key];
  await mkdir(cacheDir, { recursive: true });
  const file = cacheFile(cacheDir, definition);
  const temp = `${file}.tmp`;
  const payload = {
    schema: 'astris.celestrak.omm-cache.v2',
    provider: normalizeText(providerMeta.provider) || 'CelesTrak',
    originProvider: normalizeText(providerMeta.originProvider) || 'CelesTrak',
    providerWarning: normalizeText(providerMeta.providerWarning) || '',
    group: definition.group,
    savedAt: savedAtMs,
    sourceUpdatedAt: sourceUpdatedAtMs,
    records: records.map((row) => row.raw),
  };
  await writeFile(temp, `${JSON.stringify(payload)}\n`, 'utf8');
  await rename(temp, file);
}

function propagatedState(record, date, observer, satrec) {
  const state = satellite.propagate(satrec, date, { communityDecayCheckEnabled: true });
  if (!state?.position) return null;
  const gmst = satellite.gstime(date);
  const gd = eciToGeodeticAt(state.position, date);
  const velocity = state.velocity
    ? Math.hypot(state.velocity.x, state.velocity.y, state.velocity.z)
    : null;
  let look = null;
  if (observer) {
    const observerGd = {
      latitude: satellite.degreesToRadians(observer.lat),
      longitude: satellite.degreesToRadians(observer.lon),
      height: observer.altM / 1000,
    };
    const ecf = satellite.eciToEcf(state.position, gmst);
    look = satellite.ecfToLookAngles(observerGd, ecf);
  }
  return {
    latitudeDeg: satellite.degreesLat(gd.latitude),
    longitudeDeg: satellite.degreesLong(gd.longitude),
    altitudeKm: gd.height,
    velocityKmS: velocity,
    azimuthDeg: look ? (look.azimuth * DEG + 360) % 360 : null,
    elevationDeg: look ? look.elevation * DEG : null,
    rangeKm: look ? look.rangeSat : null,
  };
}

export function fullOrbitTrack(record, sceneDate, satrec, requestedPoints = 180) {
  const meanMotion = finite(record.meanMotion);
  if (!meanMotion || meanMotion <= 0) return [];
  const periodMinutes = 1440 / meanMotion;
  // requestedPoints is an actual sampling request, not merely an upper cap.
  // The previous period/2 formula collapsed every ~90 min LEO orbit to just
  // 90 segments even when the selected satellite asked for 240 points. At
  // regional zoom the polyline could visibly miss the smooth SGP4 marker.
  let points = Math.max(72, Math.min(720, Math.round(Number(requestedPoints) || 180)));
  // Keep an even segment count so index points/2 is exactly sceneDate. This
  // anchors the propagated satellite position to its rendered orbit instead
  // of letting the nearest track sample sit half a segment away.
  if (points % 2 !== 0) points += 1;
  const startMs = sceneDate.getTime() - (periodMinutes * 60_000) / 2;
  // Match the stable IRMAS globe implementation: the orbit is sampled in an
  // inertial frame frozen at the scene epoch. The renderer compensates Earth
  // rotation between scene updates instead of turning the 3D orbit into a
  // drifting ground track.
  const referenceGmst = satellite.gstime(sceneDate);
  const rows = [];
  for (let index = 0; index <= points; index += 1) {
    const sampleDate = new Date(startMs + (periodMinutes * 60_000 * index) / points);
    const state = satellite.propagate(satrec, sampleDate);
    if (!state?.position) continue;
    const gd = satellite.eciToGeodetic(state.position, referenceGmst);
    rows.push({
      at: sampleDate.toISOString(),
      latitudeDeg: satellite.degreesLat(gd.latitude),
      longitudeDeg: satellite.degreesLong(gd.longitude),
      altitudeKm: gd.height,
    });
  }
  return rows;
}

function sampledTrack(record, sceneDate, satrec, { trackMode = 'full', trackMinutes = 720, trackStepMinutes = 4 } = {}) {
  const meanMotion = finite(record.meanMotion);
  const periodMinutes = meanMotion && meanMotion > 0 ? Math.max(60, Math.min(1440, 1440 / meanMotion)) : 180;
  if (trackMode !== 'window') {
    const points = Math.max(72, Math.min(240, Math.round(periodMinutes / Math.max(0.5, Number(trackStepMinutes) || 4))));
    return {
      trackMode: 'full',
      referenceFrame: 'eci-orbit-at-scene-gmst',
      orbitalPeriodMinutes: periodMinutes,
      points: fullOrbitTrack(record, sceneDate, satrec, points),
    };
  }
  const minutes = Math.max(5, Math.min(1440, Number(trackMinutes) || 720));
  const step = Math.max(1, Math.min(30, Number(trackStepMinutes) || 4));
  const rows = [];
  // Generate symmetric offsets around zero so the scene epoch is always a
  // real sample, even when trackMinutes is not divisible by the chosen step.
  const halfSteps = Math.ceil(minutes / step);
  for (let index = -halfSteps; index <= halfSteps; index += 1) {
    const offset = index * step;
    const sampleDate = new Date(sceneDate.getTime() + offset * 60_000);
    const state = satellite.propagate(satrec, sampleDate, { communityDecayCheckEnabled: true });
    if (!state?.position) continue;
    const gd = eciToGeodeticAt(state.position, sampleDate);
    rows.push({ at: sampleDate.toISOString(), latitudeDeg: satellite.degreesLat(gd.latitude), longitudeDeg: satellite.degreesLong(gd.longitude), altitudeKm: gd.height });
  }
  return { trackMode: 'window', referenceFrame: 'earth-fixed-ground-track', orbitalPeriodMinutes: periodMinutes, points: rows };
}

export function createCatalogService({ cacheDir, fallbackCacheDirs = [], fetchImpl = globalThis.fetch, now = () => Date.now() } = {}) {
  if (!cacheDir) throw new TypeError('cacheDir is required');
  if (typeof fetchImpl !== 'function') throw new TypeError('fetch implementation is required');

  const cacheDirs = [...new Set([cacheDir, ...(Array.isArray(fallbackCacheDirs) ? fallbackCacheDirs : [])].filter(Boolean))];
  const state = new Map(Object.keys(CATALOGS).map((key) => [key, {
    records: [],
    satrecCache: new Map(),
    loadedAt: 0,
    sourceUpdatedAt: 0,
    loadedFrom: 'none',
    provider: 'none',
    originProvider: 'CelesTrak',
    providerWarning: '',
    lastAttemptAt: 0,
    lastSuccessAt: 0,
    lastError: '',
    lastHttpStatus: null,
    failureCount: 0,
    nextAttemptAt: 0,
    promise: null,
  }]));

  async function bootstrap(key) {
    const bucket = state.get(key);
    if (bucket.records.length) return;
    for (let index = 0; index < cacheDirs.length; index += 1) {
      const dir = cacheDirs[index];
      const cached = await readCache(dir, key);
      if (!cached) continue;
      bucket.records = cached.records;
      bucket.satrecCache.clear();
      bucket.loadedAt = cached.savedAt;
      bucket.sourceUpdatedAt = cached.sourceUpdatedAt;
      bucket.loadedFrom = index === 0 ? 'persistent-cache' : 'legacy-cache';
      bucket.provider = cached.provider || 'CelesTrak';
      bucket.originProvider = cached.originProvider || 'CelesTrak';
      bucket.providerWarning = cached.providerWarning || '';
      // Migrate an existing project-local cache into the persistent OS cache
      // so clean FULL SOURCE upgrades do not lose the last good catalogue.
      if (index > 0) {
        try { await writeCache(cacheDir, key, cached.records, cached.savedAt, cached.sourceUpdatedAt, { provider: cached.provider, originProvider: cached.originProvider, providerWarning: cached.providerWarning }); }
        catch { /* the legacy cache remains usable for this process */ }
      }
      return;
    }
  }

  function isFresh(bucket) {
    return Boolean(bucket.loadedAt && now() - bucket.loadedAt < MIN_REFRESH_MS);
  }

  function retryAfterMs(bucket) {
    return Math.max(0, Number(bucket.nextAttemptAt || 0) - now());
  }

  async function refreshOne(key, { force = false } = {}) {
    if (!CATALOGS[key]) throw new TypeError(`Unknown catalog: ${key}`);
    const bucket = state.get(key);
    await bootstrap(key);
    // A manual refresh must not bypass the provider's update window or a
    // backoff opened after an upstream failure.
    if (isFresh(bucket)) return statusOne(key);
    const coolingDown = retryAfterMs(bucket);
    if (coolingDown > 0) {
      if (bucket.records.length) return statusOne(key);
      throw new CatalogUnavailableError(
        key,
        `${key} catalog temporarily unavailable; retry after ${Math.ceil(coolingDown / 1000)} s`,
        { retryAfterMs: coolingDown, upstreamStatus: bucket.lastHttpStatus },
      );
    }
    if (bucket.promise) return bucket.promise;
    bucket.lastAttemptAt = now();
    bucket.promise = (async () => {
      try {
        const definition = CATALOGS[key];
        const primaryUrl = `${CELESTRAK_BASE}?GROUP=${encodeURIComponent(definition.group)}&FORMAT=JSON`;
        const mirrorUrl = `${CELESTRAK_MIRROR_BASE}/${encodeURIComponent(definition.mirrorSlug)}.json`;
        const requestTime = now();
        let result;
        let provider = 'CelesTrak';
        let loadedFrom = 'network';
        let providerWarning = '';
        let primaryFailure = null;

        try {
          result = await fetchOmmProvider({
            fetchImpl,
            url: primaryUrl,
            provider: 'CelesTrak',
            definition,
            key,
            nowMs: requestTime,
            userAgent: 'ASTRIS-Orbital-Monitor/0.1.17 (+educational-project)',
          });
        } catch (error) {
          primaryFailure = error;
          providerWarning = sanitizeProviderText(error?.message || String(error));
          try {
            result = await fetchOmmProvider({
              fetchImpl,
              url: mirrorUrl,
              provider: 'Satvisor mirror',
              definition,
              key,
              nowMs: requestTime,
              userAgent: 'ASTRIS-Orbital-Monitor/0.1.17 (+educational-project; provider-fallback)',
            });
            provider = 'Satvisor mirror';
            loadedFrom = 'network-mirror';
          } catch (mirrorError) {
            const primaryText = sanitizeProviderText(primaryFailure?.message || String(primaryFailure), 190);
            const mirrorText = sanitizeProviderText(mirrorError?.message || String(mirrorError), 190);
            const aggregate = new Error(`${key} catalog providers unavailable — ${primaryText}; ${mirrorText}`);
            aggregate.upstreamStatus = Number.isFinite(Number(primaryFailure?.upstreamStatus))
              ? Number(primaryFailure.upstreamStatus)
              : (Number.isFinite(Number(mirrorError?.upstreamStatus)) ? Number(mirrorError.upstreamStatus) : null);
            aggregate.retryAfterMs = Math.max(
              Number(primaryFailure?.retryAfterMs) || 0,
              Number(mirrorError?.retryAfterMs) || 0,
            );
            throw aggregate;
          }
        }

        const savedAt = now();
        bucket.records = result.records;
        bucket.satrecCache.clear();
        bucket.loadedAt = savedAt;
        bucket.sourceUpdatedAt = result.sourceUpdatedAt || savedAt;
        bucket.loadedFrom = loadedFrom;
        bucket.provider = provider;
        bucket.originProvider = 'CelesTrak';
        bucket.providerWarning = providerWarning;
        bucket.lastSuccessAt = savedAt;
        bucket.lastError = '';
        bucket.lastHttpStatus = result.httpStatus;
        bucket.failureCount = 0;
        bucket.nextAttemptAt = 0;
        await writeCache(cacheDir, key, result.records, savedAt, bucket.sourceUpdatedAt, {
          provider,
          originProvider: 'CelesTrak',
          providerWarning,
        });
        return statusOne(key);
      } catch (error) {
        bucket.failureCount += 1;
        bucket.lastError = error?.message || String(error);
        bucket.lastHttpStatus = Number.isFinite(Number(error?.upstreamStatus)) ? Number(error.upstreamStatus) : null;
        const cooldownMs = providerCooldownMs(error, bucket.failureCount);
        bucket.nextAttemptAt = now() + cooldownMs;
        if (!bucket.records.length) {
          // Re-check every known cache root once more. This also covers a cache
          // file that appeared while the network request was in flight.
          for (let index = 0; index < cacheDirs.length; index += 1) {
            const cached = await readCache(cacheDirs[index], key);
            if (!cached) continue;
            bucket.records = cached.records;
            bucket.satrecCache.clear();
            bucket.loadedAt = cached.savedAt;
            bucket.sourceUpdatedAt = cached.sourceUpdatedAt;
            bucket.loadedFrom = index === 0 ? 'persistent-cache' : 'legacy-cache';
            bucket.provider = cached.provider || 'CelesTrak';
            bucket.originProvider = cached.originProvider || 'CelesTrak';
            bucket.providerWarning = cached.providerWarning || '';
            break;
          }
        }
        if (!bucket.records.length) {
          throw new CatalogUnavailableError(key, bucket.lastError, {
            retryAfterMs: cooldownMs,
            upstreamStatus: bucket.lastHttpStatus,
          });
        }
        return statusOne(key);
      } finally {
        bucket.promise = null;
      }
    })();
    return bucket.promise;
  }

  function statusOne(key) {
    const bucket = state.get(key);
    const ageMs = bucket.loadedAt ? Math.max(0, now() - bucket.loadedAt) : null;
    const retryMs = retryAfterMs(bucket);
    return {
      key,
      group: CATALOGS[key].group,
      provider: bucket.provider === 'none' ? 'CelesTrak' : bucket.provider,
      originProvider: bucket.originProvider || 'CelesTrak',
      fallbackUsed: bucket.loadedFrom === 'network-mirror' || bucket.provider === 'Satvisor mirror',
      providerWarning: bucket.providerWarning || null,
      count: bucket.records.length,
      loadedFrom: bucket.loadedFrom,
      loadedAt: bucket.loadedAt || null,
      ageMs,
      fresh: Boolean(isFresh(bucket)),
      stale: Boolean(bucket.records.length && !isFresh(bucket)),
      degraded: Boolean(bucket.records.length && (bucket.lastError || bucket.providerWarning)),
      sourceUpdatedAt: bucket.sourceUpdatedAt || null,
      lastAttemptAt: bucket.lastAttemptAt || null,
      lastSuccessAt: bucket.lastSuccessAt || null,
      lastError: bucket.lastError || null,
      lastHttpStatus: bucket.lastHttpStatus,
      failureCount: bucket.failureCount,
      nextAttemptAt: bucket.nextAttemptAt || null,
      retryAfterMs: retryMs,
      refreshIntervalMs: MIN_REFRESH_MS,
    };
  }

  async function ensure(keys) {
    await Promise.all(keys.map(async (key) => {
      await bootstrap(key);
      const bucket = state.get(key);
      if (!bucket.records.length) {
        await refreshOne(key);
      } else if (!isFresh(bucket) && retryAfterMs(bucket) <= 0) {
        // Refresh opportunistically, but stale data remains usable for this
        // visualization if the provider is offline or rate-limiting us.
        try { await refreshOne(key); } catch { /* keep last known good catalogue */ }
      }
      if (!bucket.records.length) {
        const retryMs = retryAfterMs(bucket);
        throw new CatalogUnavailableError(key, `${key} catalog unavailable`, {
          retryAfterMs: retryMs,
          upstreamStatus: bucket.lastHttpStatus,
        });
      }
    }));
  }

  async function refreshCatalogs(keys = Object.keys(CATALOGS)) {
    const requested = [...new Set(keys.map((value) => String(value).toUpperCase()).filter((key) => CATALOGS[key]))];
    const output = {};
    for (const key of requested) output[key] = await refreshOne(key, { force: true });
    return output;
  }

  async function refreshAll() {
    return refreshCatalogs(Object.keys(CATALOGS));
  }

  function status() {
    return Object.fromEntries(Object.keys(CATALOGS).map((key) => [key, statusOne(key)]));
  }

  async function scene({
    catalogs = ['GNSS', 'STARLINK'],
    constellations = [],
    observer = null,
    horizonDeg = 0,
    mode = 'global',
    query = '',
    limit = 12000,
    includeTracks = false,
    trackMode = 'full',
    trackMinutes = 720,
    trackStepMinutes = 4,
    trackLimit = 192,
    interpolationStepMs = 500,
    selectedNoradId = '',
    at = new Date(),
  } = {}) {
    const keys = [...new Set(catalogs.map((value) => String(value).toUpperCase()).filter((key) => CATALOGS[key]))];
    if (!keys.length) throw new TypeError('At least one valid catalog is required');
    await ensure(keys);
    const date = at instanceof Date ? at : new Date(at);
    if (!Number.isFinite(date.getTime())) throw new TypeError('Invalid scene time');
    const constellationSet = new Set(constellations.map((value) => String(value).toUpperCase()).filter(Boolean));
    const search = normalizeText(query).toLowerCase();
    const requestedLimit = Number(limit);
    if (!Number.isFinite(requestedLimit) || !Number.isInteger(requestedLimit) || requestedLimit < 1 || requestedLimit > 20000) {
      throw new TypeError('limit must be an integer within 1..20000');
    }
    const maxRows = requestedLimit;
    const normalizedObserver = normalizeObserver(observer);
    const normalizedHorizonDeg = Number(horizonDeg);
    if (!Number.isFinite(normalizedHorizonDeg) || normalizedHorizonDeg < -10 || normalizedHorizonDeg > 90) {
      throw new TypeError('horizonDeg must be within -10..90');
    }
    if (mode !== 'global' && mode !== 'visible') throw new TypeError('mode must be global or visible');
    const stepMs = Math.max(100, Math.min(5000, Number(interpolationStepMs) || 500));
    const nextDate = new Date(date.getTime() + stepMs);
    const satrecByNorad = new Map();
    const recordByNorad = new Map();
    const getSatrec = (key, record) => {
      const bucket = state.get(key);
      const cacheKey = `${record.noradId}:${record.epoch || ''}`;
      if (!bucket.satrecCache.has(cacheKey)) bucket.satrecCache.set(cacheKey, satellite.json2satrec(record.raw));
      return bucket.satrecCache.get(cacheKey);
    };
    const rows = [];
    let totalCandidates = 0;
    for (const key of keys) {
      for (const record of state.get(key).records) {
        if (constellationSet.size && !constellationSet.has(record.constellation)) continue;
        if (search && !record.objectName.toLowerCase().includes(search) && !record.noradId.includes(search)) continue;
        totalCandidates += 1;
        let propagated;
        let propagatedNext;
        let satrec;
        try {
          satrec = getSatrec(key, record);
          propagated = propagatedState(record, date, normalizedObserver, satrec);
          // Next keyframe intentionally omits observer look-angle math; only the
          // world position is needed for IRMAS-style client interpolation.
          propagatedNext = propagatedState(record, nextDate, null, satrec);
        } catch { continue; }
        if (!propagated || !propagatedNext) continue;
        satrecByNorad.set(String(record.noradId), satrec);
        recordByNorad.set(String(record.noradId), record);
        const visible = normalizedObserver ? propagated.elevationDeg >= normalizedHorizonDeg : null;
        if (mode === 'visible' && normalizedObserver && !visible) continue;
        // High-rate scene rows intentionally contain only fields needed by the
        // map renderer. Scene-level timestamps live once on the payload instead
        // of being repeated for every Starlink satellite; detailed velocity /
        // look-angle metadata is returned through `selected`.
        rows.push({
          ...sceneRecord(record),
          latitudeDeg: sceneNumber(propagated.latitudeDeg, 6),
          longitudeDeg: sceneNumber(propagated.longitudeDeg, 6),
          altitudeKm: sceneNumber(propagated.altitudeKm, 3),
          elevationDeg: sceneNumber(propagated.elevationDeg, 3),
          nextLatitudeDeg: sceneNumber(propagatedNext.latitudeDeg, 6),
          nextLongitudeDeg: sceneNumber(propagatedNext.longitudeDeg, 6),
          nextAltitudeKm: sceneNumber(propagatedNext.altitudeKm, 3),
          visible,
        });
        if (rows.length >= maxRows) break;
      }
      if (rows.length >= maxRows) break;
    }
    rows.sort((a, b) => {
      if (normalizedObserver) return Number(Boolean(b.visible)) - Number(Boolean(a.visible)) || (b.elevationDeg ?? -90) - (a.elevationDeg ?? -90);
      return a.constellation.localeCompare(b.constellation) || Number(a.noradId) - Number(b.noradId);
    });

    let selected = null;
    if (selectedNoradId) {
      let selectedRecord = null;
      let selectedKey = null;
      for (const key of keys) {
        selectedRecord = state.get(key).records.find((row) => String(row.noradId) === String(selectedNoradId));
        if (selectedRecord) { selectedKey = key; break; }
      }
      if (selectedRecord && selectedKey) {
        const satrec = getSatrec(selectedKey, selectedRecord);
        let propagated = null;
        try { propagated = propagatedState(selectedRecord, date, normalizedObserver, satrec); } catch { /* ignore */ }
        selected = propagated ? { ...publicRecord(selectedRecord), ...propagated, visible: normalizedObserver ? propagated.elevationDeg >= normalizedHorizonDeg : null } : publicRecord(selectedRecord);
      }
    }

    const tracks = [];
    if (includeTracks) {
      const candidates = rows.slice(0, Math.max(1, Math.min(250, Number(trackLimit) || 192)));
      for (const row of candidates) {
        const id = String(row.noradId);
        const record = recordByNorad.get(id);
        const satrec = satrecByNorad.get(id);
        if (!record || !satrec) continue;
        try {
          const sampled = sampledTrack(record, date, satrec, { trackMode, trackMinutes, trackStepMinutes });
          if (sampled.points.length >= 2) tracks.push({
            noradId: row.noradId, objectName: row.objectName, constellation: row.constellation, prn: row.prn,
            trackMode: sampled.trackMode, referenceFrame: sampled.referenceFrame, referenceAtMs: date.getTime(),
            orbitalPeriodMinutes: sampled.orbitalPeriodMinutes, points: sampled.points,
          });
        } catch { /* one bad orbit must not invalidate scene */ }
      }
    }
    let selectedTrack = selectedNoradId ? tracks.find((item) => String(item.noradId) === String(selectedNoradId)) : null;
    let track = selectedTrack?.points || [];
    // Selected-track geometry is expensive and does not belong in the high-rate
    // position scene. The client invalidates its track cache when selection
    // changes, so compute a high-resolution selected orbit only on a track refresh.
    if (includeTracks && selectedNoradId && selected) {
      let selectedRecord = null; let selectedKey = null;
      for (const key of keys) {
        selectedRecord = state.get(key).records.find((row) => String(row.noradId) === String(selectedNoradId));
        if (selectedRecord) { selectedKey = key; break; }
      }
      if (selectedRecord && selectedKey) {
        try {
          const points = fullOrbitTrack(selectedRecord, date, getSatrec(selectedKey, selectedRecord), 480);
          if (points.length >= 2) {
            track = points;
            if (selectedTrack) selectedTrack.points = points;
            else {
              selectedTrack = {
                noradId: selected.noradId, objectName: selected.objectName, constellation: selected.constellation, prn: selected.prn,
                trackMode: 'full', referenceFrame: 'eci-orbit-at-scene-gmst', referenceAtMs: date.getTime(),
                orbitalPeriodMinutes: finite(selectedRecord.meanMotion) > 0 ? 1440 / finite(selectedRecord.meanMotion) : null, points,
              };
              tracks.unshift(selectedTrack);
            }
          }
        } catch { /* selected orbit must not invalidate the scene */ }
      }
    }

    return {
      at: date.toISOString(),
      atMs: date.getTime(),
      nextAt: nextDate.toISOString(),
      nextAtMs: nextDate.getTime(),
      serverNowMs: now(),
      propagationStepMs: stepMs,
      propagationMode: 'SGP4 keyframes + client interpolation',
      observer: normalizedObserver,
      mode,
      horizonDeg: normalizedHorizonDeg,
      totalCandidates,
      count: rows.length,
      visibleCount: normalizedObserver ? rows.filter((row) => row.visible).length : null,
      rows,
      selected,
      tracks,
      track,
      trackReferenceFrame: track.length ? 'eci-orbit-at-scene-gmst' : '',
      trackReferenceAtMs: track.length ? date.getTime() : null,
      catalogs: status(),
    };
  }


  async function search({ catalogs = ['GNSS', 'STARLINK'], constellations = [], query = '', limit = 20 } = {}) {
    const keys = [...new Set(catalogs.map((value) => String(value).toUpperCase()).filter((key) => CATALOGS[key]))];
    if (!keys.length) throw new TypeError('At least one valid catalog is required');
    await ensure(keys);
    const text = normalizeText(query).toLowerCase();
    if (text.length < 2) return [];
    const constellationSet = new Set(constellations.map((value) => String(value).toUpperCase()).filter(Boolean));
    const maxRows = Math.max(1, Math.min(50, Number(limit) || 20));
    const matches = [];
    for (const key of keys) {
      for (const record of state.get(key).records) {
        if (constellationSet.size && !constellationSet.has(record.constellation)) continue;
        const name = record.objectName.toLowerCase();
        const norad = String(record.noradId);
        if (!name.includes(text) && !norad.includes(text)) continue;
        const score = norad === text ? 0 : name === text ? 1 : name.startsWith(text) ? 2 : norad.startsWith(text) ? 3 : 4;
        matches.push({ score, row: publicRecord(record) });
      }
    }
    matches.sort((a, b) => a.score - b.score || a.row.objectName.localeCompare(b.row.objectName));
    return matches.slice(0, maxRows).map((item) => item.row);
  }

  return { status, refreshAll, refreshCatalogs, scene, search, refreshOne };
}
