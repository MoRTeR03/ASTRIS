import { MercatorCoordinate } from 'maplibre-gl';

export const MAPLIBRE_GLOBE_RADIUS_M = 6_371_008.8;

export function clampNumber(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

export function mercatorVertex(longitudeDeg, latitudeDeg, altitudeM = 0) {
  const longitude = Number(longitudeDeg);
  const latitude = clampNumber(latitudeDeg, -85.051129, 85.051129);
  const altitude = Number(altitudeM || 0);
  if (![longitude, latitude, altitude].every(Number.isFinite)) return null;
  const coordinate = MercatorCoordinate.fromLngLat({ lng: longitude, lat: latitude }, altitude);
  return {
    x: coordinate.x,
    y: coordinate.y,
    elevationM: altitude,
    elevationMercator: coordinate.z,
  };
}

export function alignMercatorX(referenceX, targetX) {
  let aligned = Number(targetX);
  const reference = Number(referenceX);
  if (!Number.isFinite(reference) || !Number.isFinite(aligned)) return aligned;
  while (aligned - reference > 0.5) aligned -= 1;
  while (aligned - reference < -0.5) aligned += 1;
  return aligned;
}

export function mapLibreGlobePosition(longitudeDeg, latitudeDeg, altitudeM = 0) {
  const longitude = Number(longitudeDeg) * Math.PI / 180;
  const latitude = Number(latitudeDeg) * Math.PI / 180;
  const altitude = Number(altitudeM || 0);
  if (![longitude, latitude, altitude].every(Number.isFinite)) return null;
  const cosLatitude = Math.cos(latitude);
  const scale = 1 + altitude / MAPLIBRE_GLOBE_RADIUS_M;
  return [
    Math.sin(longitude) * cosLatitude * scale,
    Math.sin(latitude) * scale,
    Math.cos(longitude) * cosLatitude * scale,
  ];
}

export function mixVec4(left, right, ratio) {
  const t = clampNumber(ratio, 0, 1);
  return left.map((value, index) => value * (1 - t) + right[index] * t);
}

export function projectGeodeticToClip(args, longitudeDeg, latitudeDeg, altitudeM = 0, multiplyMat4Vec4) {
  const projectionData = args?.defaultProjectionData;
  const matrix = projectionData?.mainMatrix;
  if (!matrix || typeof multiplyMat4Vec4 !== 'function') return null;
  const mercator = mercatorVertex(longitudeDeg, latitudeDeg, altitudeM);
  if (!mercator) return null;
  const variant = String(args?.shaderData?.variantName || '').toLowerCase();
  const isGlobe = variant.includes('globe');
  if (!isGlobe) {
    return multiplyMat4Vec4(matrix, [mercator.x, mercator.y, mercator.elevationMercator, 1]);
  }

  const sphere = mapLibreGlobePosition(longitudeDeg, latitudeDeg, altitudeM);
  if (!sphere) return null;
  const globeClip = multiplyMat4Vec4(matrix, [sphere[0], sphere[1], sphere[2], 1]);
  const transition = Number(projectionData?.projectionTransition ?? 1);
  const fallbackMatrix = projectionData?.fallbackMatrix;
  if (transition > 0.999 || !fallbackMatrix) return globeClip;

  // Under the globe shader contract, projectTileFor3D receives elevation in
  // metres. The fallback matrix supplied by MapLibre is built for the same
  // transition path, so keep the metric elevation here as well.
  const flatClip = multiplyMat4Vec4(fallbackMatrix, [mercator.x, mercator.y, Number(altitudeM || 0), 1]);
  return mixVec4(flatClip, globeClip, transition);
}

export function applyProjectionUniforms(gl, locations, projectionData) {
  if (!gl || !locations || !projectionData) return;
  if (locations.mainMatrix && projectionData.mainMatrix) {
    gl.uniformMatrix4fv(locations.mainMatrix, false, projectionData.mainMatrix);
  }
  if (locations.fallbackMatrix && projectionData.fallbackMatrix) {
    gl.uniformMatrix4fv(locations.fallbackMatrix, false, projectionData.fallbackMatrix);
  }
  if (locations.tileMercatorCoords && projectionData.tileMercatorCoords) {
    gl.uniform4fv(locations.tileMercatorCoords, projectionData.tileMercatorCoords);
  }
  if (locations.clippingPlane && projectionData.clippingPlane) {
    gl.uniform4fv(locations.clippingPlane, projectionData.clippingPlane);
  }
  if (locations.projectionTransition) {
    gl.uniform1f(locations.projectionTransition, Number(projectionData.projectionTransition ?? 0));
  }
}

export function projectionUniformLocations(gl, program) {
  return {
    mainMatrix: gl.getUniformLocation(program, 'u_projection_matrix'),
    fallbackMatrix: gl.getUniformLocation(program, 'u_projection_fallback_matrix'),
    tileMercatorCoords: gl.getUniformLocation(program, 'u_projection_tile_mercator_coords'),
    clippingPlane: gl.getUniformLocation(program, 'u_projection_clipping_plane'),
    projectionTransition: gl.getUniformLocation(program, 'u_projection_transition'),
  };
}
