const CATALOGS = new Set(['GNSS', 'STARLINK']);
const CONSTELLATIONS = new Set(['GPS', 'GLONASS', 'GALILEO', 'BEIDOU', 'QZSS', 'SBAS', 'STARLINK', 'OTHER']);

export class RequestValidationError extends Error {
  constructor(message) {
    super(message);
    this.name = 'RequestValidationError';
  }
}

function listQuery(value) {
  return [...new Set(String(value || '').split(',').map((entry) => entry.trim().toUpperCase()).filter(Boolean))];
}

function finiteQuery(value, { name, fallback, min, max, integer = false } = {}) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  if (!Number.isFinite(n)) throw new RequestValidationError(`${name} must be a finite number`);
  if (integer && !Number.isInteger(n)) throw new RequestValidationError(`${name} must be an integer`);
  if (n < min || n > max) throw new RequestValidationError(`${name} must be within ${min}..${max}`);
  return n;
}

function booleanQuery(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  const normalized = String(value).trim().toLowerCase();
  if (['1', 'true', 'yes', 'on'].includes(normalized)) return true;
  if (['0', 'false', 'no', 'off'].includes(normalized)) return false;
  throw new RequestValidationError('boolean query values must be 0/1 or true/false');
}

export function validatedList(value, allowed, name, fallback = []) {
  const values = listQuery(value);
  if (!values.length) return [...fallback];
  const invalid = values.filter((entry) => !allowed.has(entry));
  if (invalid.length) throw new RequestValidationError(`${name} contains unsupported values: ${invalid.join(', ')}`);
  return values;
}

function parseObserver(query) {
  const hasLat = query.lat !== undefined && query.lat !== '';
  const hasLon = query.lon !== undefined && query.lon !== '';
  if (!hasLat && !hasLon) return null;
  if (!hasLat || !hasLon) throw new RequestValidationError('lat and lon must be provided together');
  return {
    lat: finiteQuery(query.lat, { name: 'lat', min: -90, max: 90 }),
    lon: finiteQuery(query.lon, { name: 'lon', min: -180, max: 180 }),
    altM: finiteQuery(query.altM, { name: 'altM', fallback: 0, min: -500, max: 100000 }),
  };
}

export function parseCatalogRefreshQuery(query = {}) {
  return validatedList(query.catalogs, CATALOGS, 'catalogs', ['GNSS']);
}

export function parseSceneQuery(query = {}) {
  const mode = String(query.mode || 'global').toLowerCase();
  if (mode !== 'global' && mode !== 'visible') throw new RequestValidationError('mode must be global or visible');

  const at = query.at === undefined || query.at === '' ? new Date() : new Date(String(query.at));
  if (!Number.isFinite(at.getTime())) throw new RequestValidationError('at must be a valid date/time');

  const selectedNoradId = String(query.selectedNoradId || '').trim();
  if (selectedNoradId && !/^\d{1,9}$/.test(selectedNoradId)) {
    throw new RequestValidationError('selectedNoradId must be a numeric NORAD catalog id');
  }

  const search = String(query.query || '').trim();
  if (search.length > 120) throw new RequestValidationError('query must not exceed 120 characters');

  const observer = parseObserver(query);
  if (mode === 'visible' && !observer) throw new RequestValidationError('visible mode requires lat and lon observer coordinates');

  return {
    catalogs: validatedList(query.catalogs, CATALOGS, 'catalogs', ['GNSS', 'STARLINK']),
    constellations: validatedList(query.constellations, CONSTELLATIONS, 'constellations', []),
    observer,
    horizonDeg: finiteQuery(query.horizonDeg, { name: 'horizonDeg', fallback: 0, min: -10, max: 90 }),
    mode,
    query: search,
    limit: finiteQuery(query.limit, { name: 'limit', fallback: 12000, min: 1, max: 20000, integer: true }),
    includeTracks: booleanQuery(query.includeTracks, false),
    trackMode: String(query.trackMode || 'full').toLowerCase() === 'window' ? 'window' : 'full',
    trackMinutes: finiteQuery(query.trackMinutes, { name: 'trackMinutes', fallback: 720, min: 5, max: 1440, integer: true }),
    trackStepMinutes: finiteQuery(query.trackStepMinutes, { name: 'trackStepMinutes', fallback: 4, min: 1, max: 30, integer: true }),
    trackLimit: finiteQuery(query.trackLimit, { name: 'trackLimit', fallback: 192, min: 1, max: 250, integer: true }),
    interpolationStepMs: finiteQuery(query.interpolationStepMs, { name: 'interpolationStepMs', fallback: 500, min: 100, max: 5000, integer: true }),
    selectedNoradId,
    at,
  };
}


export function parseSearchQuery(query = {}) {
  const search = String(query.query || '').trim();
  if (search.length < 2) throw new RequestValidationError('query must contain at least 2 characters');
  if (search.length > 120) throw new RequestValidationError('query must not exceed 120 characters');
  return {
    catalogs: validatedList(query.catalogs, CATALOGS, 'catalogs', ['GNSS', 'STARLINK']),
    constellations: validatedList(query.constellations, CONSTELLATIONS, 'constellations', []),
    query: search,
    limit: finiteQuery(query.limit, { name: 'limit', fallback: 20, min: 1, max: 50, integer: true }),
  };
}
