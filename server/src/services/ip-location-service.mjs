import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';

const PRIVATE_PATTERNS = [
  /^127\./,
  /^10\./,
  /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^::1$/,
  /^fc/i,
  /^fd/i,
  /^fe80:/i,
];

const DISK_STALE_MAX_MS = 7 * 24 * 60 * 60 * 1000;

function cleanIp(value) {
  return String(value || '').split(',')[0].trim().replace(/^::ffff:/, '');
}

function isPrivate(ip) {
  return !ip || PRIVATE_PATTERNS.some((pattern) => pattern.test(ip));
}

function finite(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeIpapi(payload, lookupIp) {
  if (payload?.error === true) throw new Error(payload?.message || payload?.reason || 'ipapi.co lookup failed');
  const latitude = finite(payload?.latitude);
  const longitude = finite(payload?.longitude);
  if (latitude == null || longitude == null) throw new Error('ipapi.co returned no coordinates');
  return {
    source: 'ipapi.co',
    accuracy: 'approximate',
    ip: payload.ip || lookupIp || null,
    city: payload.city || null,
    region: payload.region || null,
    country: payload.country_name || null,
    countryCode: payload.country_code || payload.country || null,
    timezone: payload.timezone || null,
    latitude,
    longitude,
  };
}

function normalizeIpWhois(payload, lookupIp) {
  if (payload?.success === false) throw new Error(payload?.message || 'ipwho.is lookup failed');
  const latitude = finite(payload?.latitude);
  const longitude = finite(payload?.longitude);
  if (latitude == null || longitude == null) throw new Error('ipwho.is returned no coordinates');
  return {
    source: 'ipwho.is',
    accuracy: 'approximate',
    ip: payload.ip || lookupIp || null,
    city: payload.city || null,
    region: payload.region || null,
    country: payload.country || null,
    countryCode: payload.country_code || null,
    timezone: payload.timezone?.id || payload.timezone || null,
    latitude,
    longitude,
  };
}

async function fetchJson(fetchImpl, url, timeoutMs) {
  const response = await fetchImpl(url, {
    signal: AbortSignal.timeout(timeoutMs),
    headers: { Accept: 'application/json', 'User-Agent': 'ASTRIS-IP-Location/0.1.17' },
  });
  const text = await response.text();
  if (!response.ok) throw new Error(`${new URL(url).hostname} HTTP ${response.status}`);
  try { return JSON.parse(text); }
  catch { throw new Error(`${new URL(url).hostname} returned invalid JSON`); }
}

export function createIpLocationService({
  fetchImpl = globalThis.fetch,
  ttlMs = 10 * 60 * 1000,
  now = () => Date.now(),
  cacheDir = null,
} = {}) {
  let cache = null;
  const cacheFile = cacheDir ? path.join(cacheDir, 'ip-location.json') : null;

  async function readDisk(cacheKey) {
    if (!cacheFile) return null;
    try {
      const payload = JSON.parse(await readFile(cacheFile, 'utf8'));
      if (payload?.key !== cacheKey || !payload?.value) return null;
      const savedAt = Number(payload.savedAt || 0);
      if (!savedAt || now() - savedAt > DISK_STALE_MAX_MS) return null;
      return { key: cacheKey, savedAt, value: { ...payload.value, accuracy: 'approximate-stale', source: `${payload.value.source || 'ip-cache'} cache` } };
    } catch {
      return null;
    }
  }

  async function writeDisk(cacheKey, value) {
    if (!cacheFile) return;
    try {
      await mkdir(cacheDir, { recursive: true });
      const temp = `${cacheFile}.tmp`;
      await writeFile(temp, `${JSON.stringify({ schema: 'astris.ip-location-cache.v1', key: cacheKey, savedAt: now(), value })}\n`, 'utf8');
      await rename(temp, cacheFile);
    } catch {
      // Geolocation must not fail because the persistence layer is unwritable.
    }
  }

  async function resolve(request) {
    const forwarded = request?.headers?.['x-forwarded-for'];
    const requestIp = cleanIp(forwarded || request?.socket?.remoteAddress || request?.ip);
    const lookupIp = isPrivate(requestIp) ? '' : requestIp;
    const cacheKey = lookupIp || 'self';
    if (cache?.key === cacheKey && now() - cache.savedAt < ttlMs) return cache.value;

    const providers = [
      {
        name: 'ipapi.co',
        url: lookupIp ? `https://ipapi.co/${encodeURIComponent(lookupIp)}/json/` : 'https://ipapi.co/json/',
        normalize: normalizeIpapi,
      },
      {
        name: 'ipwho.is',
        url: lookupIp ? `https://ipwho.is/${encodeURIComponent(lookupIp)}` : 'https://ipwho.is/',
        normalize: normalizeIpWhois,
      },
    ];

    const errors = [];
    for (const provider of providers) {
      try {
        const payload = await fetchJson(fetchImpl, provider.url, 8_000);
        const value = provider.normalize(payload, lookupIp);
        cache = { key: cacheKey, savedAt: now(), value };
        await writeDisk(cacheKey, value);
        return value;
      } catch (error) {
        errors.push(`${provider.name}: ${error?.message || String(error)}`);
      }
    }

    const disk = await readDisk(cacheKey);
    if (disk) {
      cache = disk;
      return disk.value;
    }
    throw new Error(`IP geolocation unavailable (${errors.join('; ')})`);
  }

  return { resolve };
}
