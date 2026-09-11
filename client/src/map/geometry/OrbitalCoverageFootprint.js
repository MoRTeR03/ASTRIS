const EARTH_RADIUS_M = 6_378_137;

function normalizeLongitude(longitudeDeg) {
  return ((Number(longitudeDeg) + 540) % 360) - 180;
}

function destinationPoint(longitudeDeg, latitudeDeg, bearingDeg, angularDistanceRad) {
  const lon1 = Number(longitudeDeg) * Math.PI / 180;
  const lat1 = Number(latitudeDeg) * Math.PI / 180;
  const bearing = Number(bearingDeg) * Math.PI / 180;
  if (![lon1, lat1, bearing, angularDistanceRad].every(Number.isFinite)) return null;
  const sinLat1 = Math.sin(lat1);
  const cosLat1 = Math.cos(lat1);
  const sinDistance = Math.sin(angularDistanceRad);
  const cosDistance = Math.cos(angularDistanceRad);
  const lat2 = Math.asin(sinLat1 * cosDistance + cosLat1 * sinDistance * Math.cos(bearing));
  const lon2 = lon1 + Math.atan2(
    Math.sin(bearing) * sinDistance * cosLat1,
    cosDistance - sinLat1 * Math.sin(lat2),
  );
  return [normalizeLongitude(lon2 * 180 / Math.PI), lat2 * 180 / Math.PI];
}

function unwrapLongitudeRing(ring = []) {
  if (!Array.isArray(ring) || !ring.length) return [];
  const result = [];
  let previous = Number(ring[0]?.[0]);
  if (!Number.isFinite(previous)) return [];
  result.push([previous, Number(ring[0]?.[1])]);
  for (let index = 1; index < ring.length; index += 1) {
    let longitude = Number(ring[index]?.[0]);
    const latitude = Number(ring[index]?.[1]);
    if (!Number.isFinite(longitude) || !Number.isFinite(latitude)) continue;
    while (longitude - previous > 180) longitude -= 360;
    while (longitude - previous < -180) longitude += 360;
    result.push([longitude, latitude]);
    previous = longitude;
  }
  if (result.length >= 3) {
    const first = result[0];
    const last = result[result.length - 1];
    if (Math.abs(first[0] - last[0]) > 1e-7 || Math.abs(first[1] - last[1]) > 1e-7) {
      result.push([...first]);
    }
  }
  return result;
}

// Spherical-Earth line-of-sight footprint. This is geometric availability at
// a minimum ground elevation angle, not an RF beam contour or link budget.
export function coverageCentralAngleRad(altitudeKm, minimumElevationDeg = 5, earthRadiusKm = EARTH_RADIUS_M / 1000) {
  const altitude = Math.max(0, Number(altitudeKm || 0));
  const radius = Number(earthRadiusKm);
  if (!Number.isFinite(altitude) || !Number.isFinite(radius) || altitude <= 0 || radius <= 0) return 0;
  const elevationRad = Math.max(0, Math.min(89, Number(minimumElevationDeg || 0))) * Math.PI / 180;
  const ratio = radius / (radius + altitude);
  return Math.max(0, Math.acos(Math.max(-1, Math.min(1, ratio * Math.cos(elevationRad)))) - elevationRad);
}

export function coverageFootprint(row, minimumElevationDeg = 5, segments = 128) {
  const altitudeKm = Math.max(0, Number(row?.altitudeKm || 0));
  const longitudeDeg = Number(row?.longitudeDeg);
  const latitudeDeg = Number(row?.latitudeDeg);
  if (![altitudeKm, longitudeDeg, latitudeDeg].every(Number.isFinite) || altitudeKm <= 0) return null;
  const earthRadiusKm = EARTH_RADIUS_M / 1000;
  const centralAngle = coverageCentralAngleRad(altitudeKm, minimumElevationDeg, earthRadiusKm);
  if (!Number.isFinite(centralAngle) || centralAngle <= 0) return null;
  const ring = [];
  for (let index = 0; index <= segments; index += 1) {
    const point = destinationPoint(longitudeDeg, latitudeDeg, index / segments * 360, centralAngle);
    if (point) ring.push(point);
  }
  const polygon = unwrapLongitudeRing(ring);
  if (polygon.length < 4) return null;
  return {
    ...row,
    minimumElevationDeg: Math.max(0, Math.min(89, Number(minimumElevationDeg || 0))),
    polygon,
    footprintRadiusKm: earthRadiusKm * centralAngle,
  };
}
