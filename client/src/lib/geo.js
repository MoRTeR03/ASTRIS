export function splitTrackAtAntimeridian(points = []) {
  const segments = [];
  let current = [];
  for (const point of points) {
    const lon = Number(point.longitudeDeg);
    const lat = Number(point.latitudeDeg);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) continue;
    if (current.length) {
      const prevLon = current[current.length - 1][0];
      if (Math.abs(lon - prevLon) > 180) {
        if (current.length > 1) segments.push(current);
        current = [];
      }
    }
    current.push([lon, lat]);
  }
  if (current.length > 1) segments.push(current);
  return segments;
}

export function angularDistanceDeg(aLon, aLat, bLon, bLat) {
  const toRad = Math.PI / 180;
  const lon1 = Number(aLon);
  const lat1Deg = Number(aLat);
  const lon2 = Number(bLon);
  const lat2Deg = Number(bLat);
  if (![lon1, lat1Deg, lon2, lat2Deg].every(Number.isFinite)) return 180;
  const lat1 = lat1Deg * toRad;
  const lat2 = lat2Deg * toRad;
  const dLon = (lon2 - lon1) * toRad;
  const cosine = Math.sin(lat1) * Math.sin(lat2)
    + Math.cos(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return Math.acos(Math.max(-1, Math.min(1, cosine))) / toRad;
}

