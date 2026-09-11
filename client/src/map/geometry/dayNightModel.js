function julianDate(date = new Date()) {
  return date.getTime() / 86_400_000 + 2_440_587.5;
}

function normalizeDegrees(value) {
  return ((Number(value) % 360) + 360) % 360;
}

function normalizeLongitudeSigned(value) {
  const normalized = normalizeDegrees(value + 180) - 180;
  return normalized === -180 ? 180 : normalized;
}

export function solarSubpoint(date = new Date()) {
  const jd = julianDate(date);
  const days = jd - 2_451_545.0;
  const meanLongitude = normalizeDegrees(280.460 + 0.9856474 * days);
  const meanAnomaly = normalizeDegrees(357.528 + 0.9856003 * days) * Math.PI / 180;
  const eclipticLongitude = normalizeDegrees(meanLongitude + 1.915 * Math.sin(meanAnomaly) + 0.020 * Math.sin(2 * meanAnomaly)) * Math.PI / 180;
  const obliquity = (23.439 - 0.0000004 * days) * Math.PI / 180;
  const rightAscension = Math.atan2(Math.cos(obliquity) * Math.sin(eclipticLongitude), Math.cos(eclipticLongitude));
  const declination = Math.asin(Math.sin(obliquity) * Math.sin(eclipticLongitude));
  const gmst = normalizeDegrees(280.46061837 + 360.98564736629 * (jd - 2_451_545.0)) * Math.PI / 180;
  return {
    longitudeDeg: normalizeLongitudeSigned((rightAscension - gmst) * 180 / Math.PI),
    latitudeDeg: declination * 180 / Math.PI,
  };
}

export function solarMapLightPosition(date = new Date(), radial = 1.5) {
  const sun = solarSubpoint(date);
  const longitude = sun.longitudeDeg * Math.PI / 180;
  const latitude = sun.latitudeDeg * Math.PI / 180;

  // MapLibre's globe vector for lon/lat is
  // [sin(lon) cos(lat), sin(lat), cos(lon) cos(lat)]. Its atmosphere shader
  // negates the serialized light vector, so serialize the opposite vector in
  // the style-spec [radius, azimuth, polar] coordinate system.
  const lightX = -Math.sin(longitude) * Math.cos(latitude);
  const lightY = -Math.sin(latitude);
  const lightZ = -Math.cos(longitude) * Math.cos(latitude);
  const polarDeg = Math.acos(Math.max(-1, Math.min(1, lightZ))) * 180 / Math.PI;
  const azimuthDeg = normalizeDegrees(Math.atan2(-lightX, lightY) * 180 / Math.PI);
  return [Math.max(1, Number(radial) || 1.5), azimuthDeg, polarDeg];
}
