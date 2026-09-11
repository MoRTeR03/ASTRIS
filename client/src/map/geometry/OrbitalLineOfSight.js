const WGS84_A_M = 6_378_137.0;
const WGS84_B_M = 6_356_752.314245;
const WGS84_E2 = 1 - (WGS84_B_M * WGS84_B_M) / (WGS84_A_M * WGS84_A_M);

function finiteValue(value) {
  return value !== null && value !== undefined && value !== '' && Number.isFinite(Number(value));
}

function validGeodetic(longitudeDeg, latitudeDeg) {
  return finiteValue(longitudeDeg)
    && finiteValue(latitudeDeg)
    && Number(longitudeDeg) >= -180
    && Number(longitudeDeg) <= 180
    && Number(latitudeDeg) >= -90
    && Number(latitudeDeg) <= 90;
}

export function geodeticToWgs84Ecef(longitudeDeg, latitudeDeg, altitudeM = 0) {
  if (!validGeodetic(longitudeDeg, latitudeDeg) || !finiteValue(altitudeM)) return null;
  const longitude = Number(longitudeDeg) * Math.PI / 180;
  const latitude = Number(latitudeDeg) * Math.PI / 180;
  const altitude = Number(altitudeM);
  const sinLatitude = Math.sin(latitude);
  const cosLatitude = Math.cos(latitude);
  const sinLongitude = Math.sin(longitude);
  const cosLongitude = Math.cos(longitude);
  const primeVertical = WGS84_A_M / Math.sqrt(1 - WGS84_E2 * sinLatitude * sinLatitude);
  return [
    (primeVertical + altitude) * cosLatitude * cosLongitude,
    (primeVertical + altitude) * cosLatitude * sinLongitude,
    (primeVertical * (1 - WGS84_E2) + altitude) * sinLatitude,
  ];
}

export function observerElevationWgs84Deg(observer, target) {
  const observerLongitude = Number(observer?.lon);
  const observerLatitude = Number(observer?.lat);
  const observerAltitude = Number(observer?.altM ?? 0);
  const targetLongitude = Number(target?.longitudeDeg);
  const targetLatitude = Number(target?.latitudeDeg);
  const targetAltitude = Number(target?.altitudeM ?? (Number(target?.altitudeKm) * 1000));
  if (!validGeodetic(observer?.lon, observer?.lat)
    || !validGeodetic(target?.longitudeDeg, target?.latitudeDeg)
    || ![observerAltitude, targetAltitude].every(Number.isFinite)) {
    return Number.NaN;
  }
  const origin = geodeticToWgs84Ecef(observerLongitude, observerLatitude, observerAltitude);
  const destination = geodeticToWgs84Ecef(targetLongitude, targetLatitude, targetAltitude);
  if (!origin || !destination) return Number.NaN;
  const dx = destination[0] - origin[0];
  const dy = destination[1] - origin[1];
  const dz = destination[2] - origin[2];
  const longitude = observerLongitude * Math.PI / 180;
  const latitude = observerLatitude * Math.PI / 180;
  const sinLongitude = Math.sin(longitude);
  const cosLongitude = Math.cos(longitude);
  const sinLatitude = Math.sin(latitude);
  const cosLatitude = Math.cos(latitude);
  const east = -sinLongitude * dx + cosLongitude * dy;
  const north = -sinLatitude * cosLongitude * dx - sinLatitude * sinLongitude * dy + cosLatitude * dz;
  const up = cosLatitude * cosLongitude * dx + cosLatitude * sinLongitude * dy + sinLatitude * dz;
  return Math.atan2(up, Math.hypot(east, north)) * 180 / Math.PI;
}

/**
 * True when an interior point of the finite segment is inside the WGS84
 * ellipsoid. Endpoints are excluded, so an observer on the surface does not
 * self-occlude. A positive margin expands Earth and stabilizes the horizon.
 */
export function segmentIntersectsWgs84Earth(start, end, marginM = 0) {
  if (!Array.isArray(start) || !Array.isArray(end) || start.length < 3 || end.length < 3) return false;
  const values = [...start.slice(0, 3), ...end.slice(0, 3)].map(Number);
  if (!values.every(Number.isFinite)) return false;
  const [x0, y0, z0, x1, y1, z1] = values;
  const dx = x1 - x0;
  const dy = y1 - y0;
  const dz = z1 - z0;
  const equatorial = WGS84_A_M + Math.max(0, Number(marginM) || 0);
  const polar = WGS84_B_M + Math.max(0, Number(marginM) || 0);
  const invA2 = 1 / (equatorial * equatorial);
  const invB2 = 1 / (polar * polar);
  const qa = (dx * dx + dy * dy) * invA2 + dz * dz * invB2;
  if (!Number.isFinite(qa) || qa <= 0) return false;
  const qb = 2 * ((x0 * dx + y0 * dy) * invA2 + z0 * dz * invB2);
  const qc = (x0 * x0 + y0 * y0) * invA2 + z0 * z0 * invB2 - 1;
  const discriminant = qb * qb - 4 * qa * qc;
  if (!Number.isFinite(discriminant) || discriminant <= 0) return false;
  const root = Math.sqrt(discriminant);
  const t0 = (-qb - root) / (2 * qa);
  const t1 = (-qb + root) / (2 * qa);
  const epsilon = 1e-6;
  if ((t0 > epsilon && t0 < 1 - epsilon) || (t1 > epsilon && t1 < 1 - epsilon)) return true;
  // With both endpoints on (or just outside) the ellipsoid the two roots can
  // be excluded as endpoints even though the whole chord between them is
  // underground. Test the closest interior point as required by the contract.
  const closestT = Math.max(epsilon, Math.min(1 - epsilon, -qb / (2 * qa)));
  return qa * closestT * closestT + qb * closestT + qc < -1e-12;
}

export function evaluateObserverLineOfSight(observer, row, options = {}) {
  const altitudeKmValid = finiteValue(row?.altitudeKm);
  const physicalAltitudeM = altitudeKmValid ? Number(row.altitudeKm) * 1000 : Number.NaN;
  const renderedAltitudeValid = row?.renderedAltitudeM === undefined || row?.renderedAltitudeM === null
    || finiteValue(row.renderedAltitudeM);
  const displayAltitudeM = renderedAltitudeValid
    ? Number(row?.renderedAltitudeM ?? physicalAltitudeM)
    : Number.NaN;
  const observerLongitude = Number(observer?.lon);
  const observerLatitude = Number(observer?.lat);
  const observerAltitude = Number(observer?.altM ?? 0);
  const targetLongitude = Number(row?.longitudeDeg);
  const targetLatitude = Number(row?.latitudeDeg);
  const guardDeg = Math.max(0, Number(options.guardDeg ?? 0.12));
  const horizonEpsilonDeg = Math.max(0, Number(options.horizonEpsilonDeg ?? 1e-7));
  const marginM = Math.max(0, Number(options.marginM ?? 0));
  const valid = validGeodetic(observer?.lon, observer?.lat)
    && validGeodetic(row?.longitudeDeg, row?.latitudeDeg)
    && [observerLongitude, observerLatitude, observerAltitude, targetLongitude, targetLatitude, physicalAltitudeM, displayAltitudeM].every(Number.isFinite)
    && physicalAltitudeM >= 0
    && displayAltitudeM >= 0;
  if (!valid) {
    return {
      elevationDeg: Number.NaN,
      physicalVisible: false,
      displayVisible: false,
      serverVisible: row?.visible !== false,
      legacyVisible: false,
      visible: false,
    };
  }
  // WGS84 altitude may be negative at a valid ground location. The ellipsoid is
  // our occluder (terrain is unavailable), so anchor the observer just outside
  // it while retaining the receiver coordinates and rejecting invalid targets.
  const effectiveObserver = { ...observer, altM: Math.max(0.5, observerAltitude) };
  const origin = geodeticToWgs84Ecef(observerLongitude, observerLatitude, effectiveObserver.altM);
  const physicalTarget = geodeticToWgs84Ecef(targetLongitude, targetLatitude, physicalAltitudeM);
  const displayTarget = geodeticToWgs84Ecef(targetLongitude, targetLatitude, displayAltitudeM);
  const elevationDeg = observerElevationWgs84Deg(effectiveObserver, { ...row, altitudeM: physicalAltitudeM });
  const serverElevation = finiteValue(row?.elevationDeg) ? Number(row.elevationDeg) : Number.NaN;
  const serverVisible = Number.isFinite(serverElevation)
    ? serverElevation >= guardDeg
    : row?.visible !== false;
  const physicalVisible = Number.isFinite(elevationDeg)
    && elevationDeg > guardDeg + horizonEpsilonDeg
    && !segmentIntersectsWgs84Earth(origin, physicalTarget, marginM);
  const displayVisible = !segmentIntersectsWgs84Earth(origin, displayTarget, marginM);
  const legacyVisible = displayVisible && serverVisible;
  return {
    elevationDeg,
    physicalVisible,
    displayVisible,
    serverVisible,
    legacyVisible,
    // Decorative altitude compression must never change physical availability.
    // displayVisible remains diagnostic data for choosing a safe visual path.
    visible: physicalVisible && serverVisible,
  };
}

export const WGS84 = Object.freeze({ aM: WGS84_A_M, bM: WGS84_B_M, e2: WGS84_E2 });
