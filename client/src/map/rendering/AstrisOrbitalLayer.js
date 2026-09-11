import { alignMercatorX, applyProjectionUniforms, mapLibreGlobePosition, mercatorVertex, projectGeodeticToClip, projectionUniformLocations } from './projectionMath.js';

const LAYER_ID = 'astris-native-orbital-3d';
const MARKER_MIN_HIT_SIZE_PX = 24;
const MAX_DOM_MARKERS = 360;
const MAX_VIEWPORT_LABELS = 180;
const MAX_VIEWPORT_ROUGH_CANDIDATES = 1200;
const EARTH_RADIUS_M = 6_378_137;
const SIDEREAL_DAY_MS = 86_164_090.5;
const GPU_BUFFER_RING_SIZE = 4;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

export function trackLongitudeAtCurrentFrame(longitudeDeg, referenceAtMs, correctedNowMs, referenceFrame) {
  const longitude = Number(longitudeDeg);
  if (!Number.isFinite(longitude)) return Number.NaN;
  if (referenceFrame !== 'eci-orbit-at-scene-gmst') return longitude;
  const reference = Number(referenceAtMs);
  const current = Number(correctedNowMs);
  if (!Number.isFinite(reference) || !Number.isFinite(current)) return longitude;
  return ((longitude - (current - reference) / SIDEREAL_DAY_MS * 360 + 540) % 360) - 180;
}

function interpolationRatio(state, correctedNowMs = Date.now() + (Number(state?.clockOffsetMs) || 0)) {
  const fromMs = Number(state?.sceneAtMs);
  const toMs = Number(state?.nextAtMs);
  if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs) return 0;
  return clamp((correctedNowMs - fromMs) / (toMs - fromMs), 0, 1);
}

function interpolateLongitudeDeg(fromValue, toValue, ratio) {
  const from = Number(fromValue);
  const to = Number(toValue);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return Number.isFinite(from) ? from : to;
  const delta = ((to - from + 540) % 360) - 180;
  return ((from + delta * ratio + 540) % 360) - 180;
}

function interpolatedRowPosition(row, state, correctedNowMs) {
  const ratio = interpolationRatio(state, correctedNowMs);
  const longitudeDeg = Number.isFinite(Number(row?.nextLongitudeDeg))
    ? interpolateLongitudeDeg(row.longitudeDeg, row.nextLongitudeDeg, ratio)
    : Number(row?.longitudeDeg);
  const latitudeDeg = Number.isFinite(Number(row?.nextLatitudeDeg))
    ? Number(row.latitudeDeg) + (Number(row.nextLatitudeDeg) - Number(row.latitudeDeg)) * ratio
    : Number(row?.latitudeDeg);
  const altitudeScale = clamp((state?.settings?.altitudeScale ?? 50) / 100, 0, 1);
  const altitudeKm = Number.isFinite(Number(row?.nextAltitudeKm))
    ? Number(row.altitudeKm) + (Number(row.nextAltitudeKm) - Number(row.altitudeKm)) * ratio
    : Number(row?.altitudeKm);
  return { longitudeDeg, latitudeDeg, renderedAltitudeM: Math.max(0, altitudeKm || 0) * 1000 * altitudeScale, ratio };
}

export function markerShapeMetrics(pointRadiusValue, ringWidthValue, glowRadiusValue, selectedValue = false) {
  const pointRadius = clamp(pointRadiusValue, 3, 18);
  const ringWidth = clamp(ringWidthValue, 1, 8);
  const glowRadius = clamp(glowRadiusValue, 0, 18);
  const selectionRadius = selectedValue ? 3 : 0;
  const totalRadius = pointRadius + ringWidth + glowRadius + selectionRadius;
  return {
    pointRadius,
    ringWidth,
    glowRadius,
    totalRadius,
    coreRatio: pointRadius / Math.max(1, totalRadius) * 0.5,
    ringRatio: (pointRadius + ringWidth) / Math.max(1, totalRadius) * 0.5,
  };
}

function hexToRgb(value, fallback = [96, 165, 250]) {
  const text = String(value || '').trim().replace('#', '');
  const normalized = text.length === 3 ? text.split('').map((part) => `${part}${part}`).join('') : text;
  const numeric = Number.parseInt(normalized, 16);
  if (!Number.isFinite(numeric)) return fallback;
  return [(numeric >> 16) & 255, (numeric >> 8) & 255, numeric & 255];
}

function multiplyMat4Vec4(matrix, vector) {
  const [x, y, z, w] = vector;
  return [
    matrix[0] * x + matrix[4] * y + matrix[8] * z + matrix[12] * w,
    matrix[1] * x + matrix[5] * y + matrix[9] * z + matrix[13] * w,
    matrix[2] * x + matrix[6] * y + matrix[10] * z + matrix[14] * w,
    matrix[3] * x + matrix[7] * y + matrix[11] * z + matrix[15] * w,
  ];
}

export function invertMat4(matrix) {
  if (!matrix || matrix.length < 16) return null;
  const a00 = matrix[0]; const a01 = matrix[1]; const a02 = matrix[2]; const a03 = matrix[3];
  const a10 = matrix[4]; const a11 = matrix[5]; const a12 = matrix[6]; const a13 = matrix[7];
  const a20 = matrix[8]; const a21 = matrix[9]; const a22 = matrix[10]; const a23 = matrix[11];
  const a30 = matrix[12]; const a31 = matrix[13]; const a32 = matrix[14]; const a33 = matrix[15];
  const b00 = a00 * a11 - a01 * a10;
  const b01 = a00 * a12 - a02 * a10;
  const b02 = a00 * a13 - a03 * a10;
  const b03 = a01 * a12 - a02 * a11;
  const b04 = a01 * a13 - a03 * a11;
  const b05 = a02 * a13 - a03 * a12;
  const b06 = a20 * a31 - a21 * a30;
  const b07 = a20 * a32 - a22 * a30;
  const b08 = a20 * a33 - a23 * a30;
  const b09 = a21 * a32 - a22 * a31;
  const b10 = a21 * a33 - a23 * a31;
  const b11 = a22 * a33 - a23 * a32;
  let determinant = b00 * b11 - b01 * b10 + b02 * b09
    + b03 * b08 - b04 * b07 + b05 * b06;
  if (!Number.isFinite(determinant) || Math.abs(determinant) < 1e-18) return null;
  determinant = 1 / determinant;
  return [
    (a11 * b11 - a12 * b10 + a13 * b09) * determinant,
    (a02 * b10 - a01 * b11 - a03 * b09) * determinant,
    (a31 * b05 - a32 * b04 + a33 * b03) * determinant,
    (a22 * b04 - a21 * b05 - a23 * b03) * determinant,
    (a12 * b08 - a10 * b11 - a13 * b07) * determinant,
    (a00 * b11 - a02 * b08 + a03 * b07) * determinant,
    (a32 * b02 - a30 * b05 - a33 * b01) * determinant,
    (a20 * b05 - a22 * b02 + a23 * b01) * determinant,
    (a10 * b10 - a11 * b08 + a13 * b06) * determinant,
    (a01 * b08 - a00 * b10 - a03 * b06) * determinant,
    (a30 * b04 - a31 * b02 + a33 * b00) * determinant,
    (a21 * b02 - a20 * b04 - a23 * b00) * determinant,
    (a11 * b07 - a10 * b09 - a12 * b06) * determinant,
    (a00 * b09 - a01 * b07 + a02 * b06) * determinant,
    (a31 * b01 - a30 * b03 - a32 * b00) * determinant,
    (a20 * b03 - a21 * b01 + a22 * b00) * determinant,
  ];
}

function distance3(left, right) {
  return Math.hypot(left[0] - right[0], left[1] - right[1], left[2] - right[2]);
}

export function cameraPositionFromMatrix(matrix) {
  const inverse = invertMat4(matrix);
  if (!inverse) return null;
  // A perspective camera maps its own origin to a homogeneous clip direction
  // with w=0. Undoing that direction recovers the exact camera used by the
  // current MapLibre main matrix, including pitch, bearing and roll.
  const homogeneous = multiplyMat4Vec4(inverse, [0, 0, 1, 0]);
  if (!homogeneous.every(Number.isFinite) || Math.abs(homogeneous[3]) < 1e-12) return null;
  return homogeneous.slice(0, 3).map((value) => value / homogeneous[3]);
}

export function sphereBlocksSegment(origin, target, center, radiusValue) {
  if (![origin, target, center].every((point) => Array.isArray(point) && point.length >= 3)) return false;
  const radius = Number(radiusValue);
  if (!Number.isFinite(radius) || radius <= 0) return false;
  const direction = target.map((value, index) => Number(value) - Number(origin[index]));
  const offset = origin.map((value, index) => Number(value) - Number(center[index]));
  if (![...direction, ...offset].every(Number.isFinite)) return false;
  const a = direction.reduce((sum, value) => sum + value * value, 0);
  const b = 2 * direction.reduce((sum, value, index) => sum + value * offset[index], 0);
  const c = offset.reduce((sum, value) => sum + value * value, 0) - radius * radius;
  if (a <= 1e-24 || c <= 0) return false;
  const discriminant = b * b - 4 * a * c;
  const tangentTolerance = 1e-12 * Math.max(1, b * b, Math.abs(4 * a * c));
  // A mathematical tangent does not hide the marker. This matches the WebGL
  // limb and avoids reintroducing an invisible atmospheric occlusion margin.
  if (!Number.isFinite(discriminant) || discriminant <= tangentTolerance) return false;
  const near = (-b - Math.sqrt(discriminant)) / (2 * a);
  return near > 1e-7 && near < 1 - 1e-7;
}

function renderVertex(longitudeDeg, latitudeDeg, altitudeM = 0) {
  const point = mercatorVertex(longitudeDeg, latitudeDeg, altitudeM);
  if (!point) return null;
  return [point.x, point.y, point.elevationM, point.elevationMercator];
}

function globeWorldPosition(longitudeDeg, latitudeDeg, altitudeM = 0) {
  return mapLibreGlobePosition(longitudeDeg, latitudeDeg, altitudeM);
}

function globeOcclusionFrame(args, matrix) {
  const variant = String(args?.shaderData?.variantName || '').toLowerCase();
  const transition = Number(args?.defaultProjectionData?.projectionTransition ?? 1);
  if (!variant.includes('globe') || transition < 0.15) return null;
  const camera = cameraPositionFromMatrix(matrix);
  if (!camera || distance3(camera, [0, 0, 0]) <= 1) return null;
  return { camera, center: [0, 0, 0], radius: 1 };
}

function createShader(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const message = gl.getShaderInfoLog(shader) || 'Unknown shader compile error';
    gl.deleteShader(shader);
    throw new Error(message);
  }
  return shader;
}

function linkProgram(gl, vertexSource, fragmentSource) {
  const vertex = createShader(gl, gl.VERTEX_SHADER, vertexSource);
  const fragment = createShader(gl, gl.FRAGMENT_SHADER, fragmentSource);
  const program = gl.createProgram();
  gl.attachShader(program, vertex);
  gl.attachShader(program, fragment);
  gl.linkProgram(program);
  gl.deleteShader(vertex);
  gl.deleteShader(fragment);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const message = gl.getProgramInfoLog(program) || 'Unknown program link error';
    gl.deleteProgram(program);
    throw new Error(message);
  }
  return program;
}

function projectionShaderHeader(shaderData) {
  return `#version 300 es
    precision highp float;
    ${shaderData?.vertexShaderPrelude || ''}
    ${shaderData?.define || ''}
  `;
}

function createLineProgram(gl, shaderData) {
  const program = linkProgram(gl, `${projectionShaderHeader(shaderData)}
    layout(location = 0) in vec2 a_mercator;
    layout(location = 1) in float a_elevation_m;
    layout(location = 2) in float a_elevation_mercator;
    layout(location = 3) in vec4 a_color;
    out vec4 v_color;
    vec4 astrisProject(vec2 mercator, float elevationM, float elevationMercator) {
      #ifdef GLOBE
        return projectTileFor3D(mercator, elevationM);
      #else
        return projectTileFor3D(mercator, elevationMercator);
      #endif
    }
    void main() {
      gl_Position = astrisProject(a_mercator, a_elevation_m, a_elevation_mercator);
      v_color = a_color;
    }
  `, `#version 300 es
    precision highp float;
    in vec4 v_color;
    out vec4 outColor;
    void main() { outColor = v_color; }
  `);
  return {
    program,
    projection: projectionUniformLocations(gl, program),
  };
}

function createMarkerProgram(gl, shaderData) {
  const program = linkProgram(gl, `${projectionShaderHeader(shaderData)}
    layout(location = 0) in vec2 a_mercator;
    layout(location = 1) in float a_elevation_m;
    layout(location = 2) in float a_elevation_mercator;
    layout(location = 3) in vec2 a_mercator_next;
    layout(location = 4) in float a_elevation_m_next;
    layout(location = 5) in float a_elevation_mercator_next;
    layout(location = 6) in vec4 a_fill;
    layout(location = 7) in vec4 a_ring;
    layout(location = 8) in float a_size;
    layout(location = 9) in float a_glow;
    layout(location = 10) in float a_selected;
    layout(location = 11) in float a_core_ratio;
    layout(location = 12) in float a_ring_ratio;
    uniform float u_scale;
    uniform float u_interp;
    out vec4 v_fill;
    out vec4 v_ring;
    out float v_glow;
    out float v_selected;
    out float v_core_ratio;
    out float v_ring_ratio;
    vec4 astrisProject(vec2 mercator, float elevationM, float elevationMercator) {
      #ifdef GLOBE
        return projectTileFor3D(mercator, elevationM);
      #else
        return projectTileFor3D(mercator, elevationMercator);
      #endif
    }
    void main() {
      float ratio = clamp(u_interp, 0.0, 1.0);
      vec2 mercator = mix(a_mercator, a_mercator_next, ratio);
      float elevationM = mix(a_elevation_m, a_elevation_m_next, ratio);
      float elevationMercator = mix(a_elevation_mercator, a_elevation_mercator_next, ratio);
      gl_Position = astrisProject(mercator, elevationM, elevationMercator);
      gl_PointSize = clamp(a_size * u_scale, 8.0, 62.0);
      v_fill = a_fill;
      v_ring = a_ring;
      v_glow = a_glow;
      v_selected = a_selected;
      v_core_ratio = a_core_ratio;
      v_ring_ratio = a_ring_ratio;
    }
  `, `#version 300 es
    precision highp float;
    in vec4 v_fill;
    in vec4 v_ring;
    in float v_glow;
    in float v_selected;
    in float v_core_ratio;
    in float v_ring_ratio;
    out vec4 outColor;
    void main() {
      vec2 centered = gl_PointCoord - vec2(0.5);
      float radius = length(centered);
      if (radius > 0.5) discard;

      vec4 color;
      if (v_selected > 0.5 && radius > 0.455) {
        float edge = 1.0 - smoothstep(0.455, 0.5, radius);
        color = vec4(1.0, 1.0, 1.0, 0.96 * edge);
      } else if (radius > v_ring_ratio) {
        float halo = 1.0 - smoothstep(v_ring_ratio, 0.5, radius);
        color = vec4(v_fill.rgb, v_fill.a * v_glow * halo);
      } else if (radius > v_core_ratio) {
        color = v_ring;
      } else {
        float highlight = max(0.0, 1.0 - length(centered - vec2(-0.08, -0.08)) * 4.2);
        color = vec4(min(vec3(1.0), v_fill.rgb + highlight * 0.12), v_fill.a);
      }
      outColor = vec4(color.rgb * color.a, color.a);
    }
  `);
  return {
    program,
    projection: projectionUniformLocations(gl, program),
    scale: gl.getUniformLocation(program, 'u_scale'),
    interp: gl.getUniformLocation(program, 'u_interp'),
  };
}

function createProgramBundle(gl, shaderData) {
  return {
    variantName: String(shaderData?.variantName || 'unknown'),
    line: createLineProgram(gl, shaderData),
    marker: createMarkerProgram(gl, shaderData),
  };
}

function nextPow2(value) {
  let capacity = 256;
  const target = Math.max(0, Number(value) || 0);
  while (capacity < target) capacity *= 2;
  return capacity;
}

function createGeometryRing(createSlot) {
  return {
    slots: Array.from({ length: GPU_BUFFER_RING_SIZE }, createSlot),
    index: 0,
    count: 0,
  };
}

function activeGeometrySlot(geometry) {
  return geometry?.slots?.[geometry.index] || null;
}

function createLineGeometry(gl) {
  const strideFloats = 8;
  const stride = strideFloats * Float32Array.BYTES_PER_ELEMENT;
  const attrs = [
    [0, 2, 0],
    [1, 1, 2],
    [2, 1, 3],
    [3, 4, 4],
  ];
  return createGeometryRing(() => {
    const vao = gl.createVertexArray();
    const buffer = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    for (const [location, size, offset] of attrs) {
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride, offset * Float32Array.BYTES_PER_ELEMENT);
    }
    gl.bindVertexArray(null);
    return { vao, buffer, capacityBytes: 0 };
  });
}

function createMarkerGeometry(gl) {
  const strideFloats = 21;
  const stride = strideFloats * Float32Array.BYTES_PER_ELEMENT;
  const attrs = [
    [0, 2, 0],
    [1, 1, 2],
    [2, 1, 3],
    [3, 2, 4],
    [4, 1, 6],
    [5, 1, 7],
    [6, 4, 8],
    [7, 4, 12],
    [8, 1, 16],
    [9, 1, 17],
    [10, 1, 18],
    [11, 1, 19],
    [12, 1, 20],
  ];
  return createGeometryRing(() => {
    const vao = gl.createVertexArray();
    const buffer = gl.createBuffer();
    gl.bindVertexArray(vao);
    gl.bindBuffer(gl.ARRAY_BUFFER, buffer);
    for (const [location, size, offset] of attrs) {
      gl.enableVertexAttribArray(location);
      gl.vertexAttribPointer(location, size, gl.FLOAT, false, stride, offset * Float32Array.BYTES_PER_ELEMENT);
    }
    gl.bindVertexArray(null);
    return { vao, buffer, capacityBytes: 0 };
  });
}

function deleteGeometry(gl, geometry) {
  if (!geometry) return;
  for (const slot of geometry.slots || []) {
    try { if (slot.buffer) gl.deleteBuffer(slot.buffer); } catch (error) {}
    try { if (slot.vao) gl.deleteVertexArray(slot.vao); } catch (error) {}
  }
}

function uploadGeometry(gl, geometry, vertices, strideFloats) {
  if (!geometry?.slots?.length) return;
  geometry.index = (geometry.index + 1) % geometry.slots.length;
  const slot = activeGeometrySlot(geometry);
  gl.bindBuffer(gl.ARRAY_BUFFER, slot.buffer);
  const requiredBytes = vertices.byteLength;
  if (requiredBytes > slot.capacityBytes) {
    slot.capacityBytes = nextPow2(requiredBytes);
    gl.bufferData(gl.ARRAY_BUFFER, slot.capacityBytes, gl.STREAM_DRAW);
  }
  if (requiredBytes > 0) gl.bufferSubData(gl.ARRAY_BUFFER, 0, vertices);
  geometry.count = vertices.length / strideFloats;
}

function pushLine(target, left, right, color, alpha = 1) {
  if (!left || !right) return;
  const a = clamp(alpha, 0, 1);
  const rgba = [color[0] / 255 * a, color[1] / 255 * a, color[2] / 255 * a, a];
  target.push(
    left[0], left[1], left[2], left[3], rgba[0], rgba[1], rgba[2], rgba[3],
    right[0], right[1], right[2], right[3], rgba[0], rgba[1], rgba[2], rgba[3],
  );
}

function geodeticUnit(longitudeDeg, latitudeDeg) {
  const longitude = Number(longitudeDeg) * Math.PI / 180;
  const latitude = Number(latitudeDeg) * Math.PI / 180;
  const cosLatitude = Math.cos(latitude);
  return [
    cosLatitude * Math.cos(longitude),
    cosLatitude * Math.sin(longitude),
    Math.sin(latitude),
  ];
}

function interpolateGreatCircle(start, end, ratio) {
  const dot = clamp(start[0] * end[0] + start[1] * end[1] + start[2] * end[2], -1, 1);
  const angle = Math.acos(dot);
  if (!Number.isFinite(angle) || angle < 1e-7) return { unit: start, angle: 0 };
  const sinAngle = Math.sin(angle);
  if (Math.abs(sinAngle) < 1e-7) {
    const mixed = start.map((value, index) => value * (1 - ratio) + end[index] * ratio);
    const length = Math.hypot(...mixed) || 1;
    return { unit: mixed.map((value) => value / length), angle };
  }
  const left = Math.sin((1 - ratio) * angle) / sinAngle;
  const right = Math.sin(ratio * angle) / sinAngle;
  return {
    unit: start.map((value, index) => value * left + end[index] * right),
    angle,
  };
}

function geodeticFromUnit(unit) {
  return {
    longitudeDeg: Math.atan2(unit[1], unit[0]) * 180 / Math.PI,
    latitudeDeg: Math.atan2(unit[2], Math.hypot(unit[0], unit[1])) * 180 / Math.PI,
  };
}

function angularDistanceDeg(aLon, aLat, bLon, bLat) {
  const toRad = Math.PI / 180;
  const lat1 = Number(aLat) * toRad;
  const lat2 = Number(bLat) * toRad;
  const dLon = (Number(bLon) - Number(aLon)) * toRad;
  if (![lat1, lat2, dLon].every(Number.isFinite)) return 180;
  const cosine = Math.sin(lat1) * Math.sin(lat2) + Math.cos(lat1) * Math.cos(lat2) * Math.cos(dLon);
  return Math.acos(clamp(cosine, -1, 1)) / toRad;
}

function roughViewportRadiusDeg(zoomValue) {
  const zoom = Number(zoomValue || 0);
  if (zoom <= 0.4) return 125;
  if (zoom <= 1.0) return 105;
  if (zoom <= 1.8) return 82;
  if (zoom <= 2.8) return 58;
  if (zoom <= 4.0) return 38;
  return 24;
}

function markerLabel(row) {
  return String(row?.prnToken || row?.objectName || row?.noradId || '—');
}

function markerTitle(row) {
  const parts = [markerLabel(row), row?.constellation || 'GNSS'];
  if (Number.isFinite(Number(row?.altitudeKm))) parts.push(`${Number(row.altitudeKm).toFixed(0)} км`);
  if (Number.isFinite(Number(row?.elevationDeg))) parts.push(`El ${Number(row.elevationDeg).toFixed(1)}°`);
  if (Number.isFinite(Number(row?.observedSnr))) parts.push(`C/N₀ ${Number(row.observedSnr).toFixed(0)} dB-Hz`);
  return parts.join(' • ');
}

function createMarkerElement(row, onSelect) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'astris-native-orbital-marker is-webgl-disc';
  button.dataset.noradId = String(row.noradId);
  button.innerHTML = '<span class="astris-native-orbital-marker__disc" aria-hidden="true"></span><b></b>';
  const selectMarker = (event) => {
    event.preventDefault();
    event.stopPropagation();
    onSelect?.(button.__orbitalRow || row);
  };
  button.addEventListener('pointerdown', (event) => {
    if (event.button !== 0) return;
    selectMarker(event);
  });
  button.addEventListener('click', (event) => {
    event.preventDefault();
    event.stopPropagation();
  });
  button.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    selectMarker(event);
  });
  return button;
}

function updateMarkerVisual(element, row, state, labelVisible = true) {
  element.__orbitalRow = row;
  element.dataset.noradId = String(row.noradId);
  element.classList.toggle('is-selected', String(row.noradId) === String(state.selectedNoradId ?? ''));
  element.classList.toggle('is-observed', row.observed === true);
  element.classList.toggle('is-used', row.observedUsed === true);
  const fill = row.color || state.constellationColors?.[String(row.constellation || 'OTHER').toUpperCase()] || '#60a5fa';
  element.style.setProperty('--orbital-fill', fill);
  element.style.opacity = String(row.visible === false ? 0.55 : clamp((state.settings?.opacity || 94) / 100, 0.2, 1));
  const label = element.querySelector('b');
  if (label) label.textContent = state.settings?.labels === false || !labelVisible ? '' : markerLabel(row);
  element.title = markerTitle(row);
  element.setAttribute('aria-label', markerTitle(row));
}

export function selectInteractiveMarkerRows(rowsValue, selectedNoradId, limit = MAX_DOM_MARKERS) {
  const rows = Array.isArray(rowsValue) ? rowsValue : [];
  const selectedId = String(selectedNoradId ?? '');
  const maxRows = Math.max(1, Math.min(1200, Number(limit) || MAX_DOM_MARKERS));
  const result = [];
  const used = new Set();
  const push = (row) => {
    if (!row || result.length >= maxRows) return;
    const id = String(row.noradId ?? '');
    if (!id || used.has(id)) return;
    used.add(id); result.push(row);
  };
  if (selectedId) push(rows.find((row) => String(row.noradId) === selectedId));
  // GNSS remains fully interactive. Starlink is prioritised by visibility and
  // elevation, preventing thousands of DOM buttons from freezing the page.
  for (const row of rows) if (String(row.constellation).toUpperCase() !== 'STARLINK') push(row);
  const starlink = rows.filter((row) => String(row.constellation).toUpperCase() === 'STARLINK');
  starlink.sort((a, b) => Number(Boolean(b.visible)) - Number(Boolean(a.visible))
    || Number(b.elevationDeg ?? -90) - Number(a.elevationDeg ?? -90));
  for (const row of starlink) push(row);
  return result;
}

function trackDataSignature(tracksValue) {
  return (Array.isArray(tracksValue) ? tracksValue : []).map((track) => [
    track?.noradId ?? '', track?.referenceAtMs ?? '', track?.referenceFrame ?? '',
    Array.isArray(track?.points) ? track.points.length : 0,
  ].join(':')).join('|');
}

function markerVisualSignature(state) {
  const settings = state.settings || {};
  // DOM labels only need a new pass when the actual scene or visual settings
  // change. A generic revision invalidated 360 DOM nodes for unrelated LOS /
  // track changes and was a measurable Starlink main-thread tax.
  return [state.sceneAtMs ?? '', state.enabled ? 1 : 0, state.globe ? 1 : 0,
    state.selectedNoradId ?? '', settings.labels === false ? 0 : 1, settings.opacity || 94].join(';');
}

function trackSignature(state) {
  const settings = state.settings || {};
  return [trackDataSignature(state.tracks), settings.tracks === false ? 0 : 1,
    settings.altitudeScale ?? 50, state.selectedNoradId ?? ''].join(';');
}

function dynamicSignature(state) {
  const settings = state.settings || {};
  // Marker vertex buffers change on a new SGP4 keyframe or marker geometry
  // tuning, not on every unrelated settings revision.
  return [state.sceneAtMs ?? '', state.nextAtMs ?? '', settings.altitudeScale ?? 50,
    settings.pointRadius || 7, settings.signalRingWidth || 3, settings.glowRadius || 6,
    settings.glowOpacity || 18, settings.opacity || 94, state.selectedNoradId ?? ''].join(';');
}

function linkSignature(state) {
  const settings = state.settings || {};
  return [state.sceneAtMs ?? '', settings.observerLinks === false ? 0 : 1,
    settings.observerLinkMode || 'physical', settings.altitudeScale ?? 50, settings.opacity || 94,
    state.selectedNoradId ?? '', state.observer?.lon ?? '', state.observer?.lat ?? '',
    (state.linkRows || []).map((row) => `${row.noradId}:${row.observerGlobeLineOfSight ? 1 : 0}:${row.observerLegacyLineOfSight ? 1 : 0}`).join('|')].join(';');
}

function markerZoomScale(zoom) {
  const numeric = Number(zoom || 0);
  return clamp(0.9 + Math.max(0, numeric - 1.25) * 0.15, 0.9, 1.85);
}

export function createAstrisOrbitalLayer({ map, onSelect, isOccluded }) {
  let glContext = null;
  const programCache = new Map();
  let trackGeometry = null;
  let linkGeometry = null;
  let markerGeometry = null;
  let trackGeometryKey = '';
  let linkGeometryKey = '';
  let dynamicGeometryKey = '';
  let trackStateKey = '';
  let linkStateKey = '';
  let dynamicStateKey = '';
  let state = {
    enabled: false, globe: false, rows: [], interactiveRows: [], linkRows: [], tracks: [], observer: null,
    selectedNoradId: null, settings: {}, constellationColors: {}, correctedNowMs: 0,
    sceneAtMs: null, nextAtMs: null, clockOffsetMs: 0, revision: 0, cameraInteracting: false,
  };
  let markerContainer = null;
  let markerSignature = '';
  let interactiveMarkerRows = [];
  let lastLabelProjectionAt = 0;
  let viewportSelectionDirty = true;
  let viewportLabelIds = new Set();
  const markerElements = new Map();
  const visibilityHistory = new Map();

  function ensureMarkerContainer() {
    if (markerContainer?.isConnected) return markerContainer;
    markerContainer = document.createElement('div');
    markerContainer.className = 'astris-native-orbital-marker-layer';
    markerContainer.setAttribute('aria-label', 'Супутники ASTRIS');
    (map.getCanvasContainer?.() || map.getContainer()).appendChild(markerContainer);
    return markerContainer;
  }

  function syncMarkerElements(rowsValue = interactiveMarkerRows, labelIdsValue = viewportLabelIds) {
    const rows = Array.isArray(rowsValue) ? rowsValue : [];
    const labelIds = labelIdsValue instanceof Set ? labelIdsValue : new Set();
    interactiveMarkerRows = rows;
    viewportLabelIds = labelIds;
    const nextIds = new Set(rows.map((row) => String(row.noradId)));
    for (const [id, element] of markerElements) {
      if (nextIds.has(id)) continue;
      element.remove();
      markerElements.delete(id);
      visibilityHistory.delete(id);
    }
    const container = ensureMarkerContainer();
    for (const row of rows) {
      const id = String(row.noradId);
      let element = markerElements.get(id);
      if (!element) {
        element = createMarkerElement(row, onSelect);
        markerElements.set(id, element);
        container.appendChild(element);
      }
      updateMarkerVisual(element, row, state, labelIds.has(id));
    }
  }

  function refreshViewportMarkerRows(args, matrix) {
    const rows = Array.isArray(state.rows) ? state.rows : [];
    const selectedId = String(state.selectedNoradId ?? '');
    const center = map.getCenter?.() || { lng: 0, lat: 0 };
    const zoom = Number(map.getZoom?.() || 0);
    const radiusDeg = roughViewportRadiusDeg(zoom);

    // Stage 1 is intentionally cheap: reduce a 10k+ Starlink catalogue using
    // angular distance to the camera center before invoking MapLibre's model
    // matrix for exact 3D clipping/occlusion.
    const rough = [];
    for (const row of rows) {
      const id = String(row?.noradId ?? '');
      if (!id) continue;
      const distance = angularDistanceDeg(center.lng, center.lat, row.longitudeDeg, row.latitudeDeg);
      const selected = id === selectedId;
      if (!selected && distance > radiusDeg) continue;
      const system = String(row.constellation || 'OTHER').toUpperCase();
      const systemPriority = system === 'STARLINK' ? 1 : 0;
      rough.push({ row, selected, systemPriority, distance });
    }
    rough.sort((a, b) => Number(b.selected) - Number(a.selected)
      || a.systemPriority - b.systemPriority
      || a.distance - b.distance
      || Number(b.row?.elevationDeg ?? -90) - Number(a.row?.elevationDeg ?? -90));

    const canvas = map.getCanvas();
    const width = Math.max(1, canvas.clientWidth || canvas.width || 1);
    const height = Math.max(1, canvas.clientHeight || canvas.height || 1);
    const occlusionFrame = globeOcclusionFrame(args, matrix);
    const precise = [];
    const nowMs = Number.isFinite(Number(state.correctedNowMs))
      ? Number(state.correctedNowMs)
      : Date.now() + (Number(state.clockOffsetMs) || 0);

    for (const candidate of rough.slice(0, MAX_VIEWPORT_ROUGH_CANDIDATES)) {
      const row = candidate.row;
      const visual = interpolatedRowPosition(row, state, nowMs);
      const position = globeWorldPosition(visual.longitudeDeg, visual.latitudeDeg, visual.renderedAltitudeM);
      if (!position) continue;
      const occluded = occlusionFrame
        ? sphereBlocksSegment(occlusionFrame.camera, position, occlusionFrame.center, occlusionFrame.radius)
        : (typeof isOccluded === 'function' ? isOccluded(row) : false);
      if (occluded) continue;
      const clip = projectGeodeticToClip(args, visual.longitudeDeg, visual.latitudeDeg, visual.renderedAltitudeM, multiplyMat4Vec4);
      if (!clip) continue;
      const w = clip[3];
      if (!Number.isFinite(w) || w <= 1e-8) continue;
      const x = clip[0] / w;
      const y = clip[1] / w;
      const z = clip[2] / w;
      if (![x, y, z].every(Number.isFinite) || z < -1.05 || z > 1.05 || x < -1.08 || x > 1.08 || y < -1.08 || y > 1.08) continue;
      const screenX = (x * 0.5 + 0.5) * width;
      const screenY = (1 - (y * 0.5 + 0.5)) * height;
      const centerDistance = Math.hypot(screenX - width * 0.5, screenY - height * 0.5);
      precise.push({ ...candidate, screenX, screenY, centerDistance });
    }

    precise.sort((a, b) => Number(b.selected) - Number(a.selected)
      || a.systemPriority - b.systemPriority
      || a.centerDistance - b.centerDistance
      || Number(b.row?.elevationDeg ?? -90) - Number(a.row?.elevationDeg ?? -90));

    // During a projection/style transition MapLibre can briefly provide a
    // matrix that rejects every candidate. Do not leave orbital labels stuck
    // empty: retain a bounded fallback until the next exact viewport pass.
    const picked = precise.length
      ? precise.slice(0, MAX_DOM_MARKERS).map((item) => item.row)
      : selectInteractiveMarkerRows(rows, selectedId, Math.min(MAX_DOM_MARKERS, 180));
    const labelBudget = Math.max(70, Math.min(MAX_VIEWPORT_LABELS, Math.floor((width * height) / 9500)));
    const labelIds = new Set();
    if (selectedId && picked.some((row) => String(row.noradId) === selectedId)) labelIds.add(selectedId);
    const labelCandidates = precise.length ? precise.map((item) => item.row) : picked;
    const pickedIds = new Set(picked.map((row) => String(row.noradId ?? '')));
    for (const row of labelCandidates) {
      if (labelIds.size >= labelBudget) break;
      const id = String(row?.noradId ?? '');
      if (!id || !pickedIds.has(id)) continue;
      labelIds.add(id);
    }
    syncMarkerElements(picked, labelIds);
    viewportSelectionDirty = false;
  }

  function buildTrackVertices() {
    if (state.settings?.tracks === false) return new Float32Array();
    const regular = [];
    const selected = [];
    const allowed = new Set((state.rows || []).map((row) => String(row.noradId)));
    const selectedId = String(state.selectedNoradId ?? '');
    const altitudeScale = clamp((state.settings?.altitudeScale ?? 50) / 100, 0, 1);
    const opacity = clamp((state.settings?.opacity || 94) / 100, 0.2, 1);
    for (const track of Array.isArray(state.tracks) ? state.tracks : []) {
      const noradId = String(track?.noradId ?? '');
      if (!allowed.has(noradId)) continue;
      const rgb = hexToRgb(state.constellationColors?.[String(track?.constellation || 'OTHER').toUpperCase()] || '#60a5fa');
      const target = noradId === selectedId ? selected : regular;
      let previous = null;
      for (const point of Array.isArray(track?.points) ? track.points : []) {
        const currentLongitude = trackLongitudeAtCurrentFrame(
          point?.longitudeDeg,
          track?.referenceAtMs,
          state.correctedNowMs,
          track?.referenceFrame,
        );
        const current = renderVertex(
          currentLongitude,
          point?.latitudeDeg,
          Math.max(0, Number(point?.altitudeKm) || 0) * 1000 * altitudeScale,
        );
        if (previous && current) pushLine(target, previous, current, rgb, noradId === selectedId ? 0.96 : 0.42 * opacity);
        previous = current;
      }
    }
    return new Float32Array([...regular, ...selected]);
  }

  function buildLinkVertices() {
    if (state.settings?.observerLinks === false
      || !Number.isFinite(Number(state.observer?.lon))
      || !Number.isFinite(Number(state.observer?.lat))) return new Float32Array();
    const regular = [];
    const selected = [];
    const selectedId = String(state.selectedNoradId ?? '');
    const opacity = clamp((state.settings?.opacity || 94) / 100, 0.2, 1);
    const observerAltitudeM = Math.max(2, Number(state.observer.altM || 0));
    const start = renderVertex(state.observer.lon, state.observer.lat, observerAltitudeM);
    const altitudeScale = clamp((state.settings?.altitudeScale ?? 50) / 100, 0, 1);
    const legacyScaleMode = state.settings?.observerLinkMode === 'legacy-scale';
    const observerUnit = geodeticUnit(state.observer.lon, state.observer.lat);
    for (const row of Array.isArray(state.linkRows) ? state.linkRows : []) {
      const lineVisible = legacyScaleMode
        ? row.observerLegacyLineOfSight === true
        : row.observerGlobeLineOfSight === true;
      if (!lineVisible) continue;
      const visual = interpolatedRowPosition(row, state, state.correctedNowMs);
      const end = renderVertex(visual.longitudeDeg, visual.latitudeDeg, visual.renderedAltitudeM);
      const rgb = Array.isArray(row.observedSignalRgb) ? row.observedSignalRgb : hexToRgb(row.color || state.constellationColors?.[String(row.constellation || 'OTHER').toUpperCase()] || '#60a5fa');
      const isSelected = String(row.noradId) === selectedId;
      const target = isSelected ? selected : regular;
      const alpha = isSelected ? 0.98 : 0.66 * opacity;
      if (legacyScaleMode || altitudeScale >= 0.999) {
        pushLine(target, start, end, rgb, alpha);
        continue;
      }

      // At 100% the segment is the physical straight ray. Compact altitude is
      // explicitly schematic: trace a great-circle display arc so compression
      // cannot make a physically valid link appear to tunnel through Earth.
      const satelliteUnit = geodeticUnit(visual.longitudeDeg, visual.latitudeDeg);
      const centralAngle = Math.acos(clamp(
        observerUnit[0] * satelliteUnit[0]
        + observerUnit[1] * satelliteUnit[1]
        + observerUnit[2] * satelliteUnit[2],
        -1,
        1,
      ));
      const surfaceDistanceM = centralAngle * EARTH_RADIUS_M;
      const liftM = (1 - altitudeScale) * Math.min(500_000, Math.max(20_000, surfaceDistanceM * 0.08));
      const steps = 20;
      let previous = start;
      for (let index = 1; index <= steps; index += 1) {
        const ratio = index / steps;
        const interpolated = interpolateGreatCircle(observerUnit, satelliteUnit, ratio);
        const geodetic = geodeticFromUnit(interpolated.unit);
        const altitudeM = observerAltitudeM * (1 - ratio)
          + Math.max(0, Number(visual.renderedAltitudeM) || 0) * ratio
          + Math.sin(Math.PI * ratio) * liftM;
        const current = renderVertex(geodetic.longitudeDeg, geodetic.latitudeDeg, altitudeM);
        pushLine(target, previous, current, rgb, alpha);
        previous = current;
      }
    }
    return new Float32Array([...regular, ...selected]);
  }

  function buildMarkerVertices() {
    const vertices = [];
    const selectedId = String(state.selectedNoradId ?? '');
    const opacity = clamp((state.settings?.opacity || 94) / 100, 0.2, 1);
    const pointRadius = clamp(state.settings?.pointRadius || 7, 3, 18);
    const ringWidth = clamp(state.settings?.signalRingWidth || 3, 1, 8);
    const glowRadius = clamp(state.settings?.glowRadius || 6, 0, 18);
    const glowOpacity = clamp((state.settings?.glowOpacity || 18) / 100, 0, 0.8);
    const altitudeScale = clamp((state.settings?.altitudeScale ?? 50) / 100, 0, 1);
    for (const row of Array.isArray(state.rows) ? state.rows : []) {
      const currentAltitudeM = Math.max(0, Number(row.altitudeKm || 0)) * 1000 * altitudeScale;
      const nextAltitudeM = Number.isFinite(Number(row.nextAltitudeKm))
        ? Math.max(0, Number(row.nextAltitudeKm)) * 1000 * altitudeScale
        : currentAltitudeM;
      const position = renderVertex(row.longitudeDeg, row.latitudeDeg, currentAltitudeM);
      let nextPosition = Number.isFinite(Number(row.nextLongitudeDeg)) && Number.isFinite(Number(row.nextLatitudeDeg))
        ? renderVertex(row.nextLongitudeDeg, row.nextLatitudeDeg, nextAltitudeM)
        : position;
      if (position && nextPosition) {
        nextPosition = [...nextPosition];
        nextPosition[0] = alignMercatorX(position[0], nextPosition[0]);
      }
      if (!position || !nextPosition) continue;
      const fillRgb = hexToRgb(row.color || state.constellationColors?.[String(row.constellation || 'OTHER').toUpperCase()] || '#60a5fa');
      const ringRgb = Array.isArray(row.observedSignalRgb) ? row.observedSignalRgb : [71, 85, 105];
      const visibleAlpha = row.visible === false ? opacity * 0.48 : opacity;
      const selected = String(row.noradId) === selectedId ? 1 : 0;
      const shape = markerShapeMetrics(pointRadius, ringWidth, glowRadius, selected === 1);
      vertices.push(
        position[0], position[1], position[2], position[3],
        nextPosition[0], nextPosition[1], nextPosition[2], nextPosition[3],
        fillRgb[0] / 255, fillRgb[1] / 255, fillRgb[2] / 255, visibleAlpha,
        ringRgb[0] / 255, ringRgb[1] / 255, ringRgb[2] / 255, row.observed ? 1 : 0.86,
        Math.min(62, shape.totalRadius * 2), glowOpacity, selected, shape.coreRatio, shape.ringRatio,
      );
    }
    return new Float32Array(vertices);
  }

  function uploadChangedGeometry(gl) {
    const nextTrackKey = trackStateKey;
    if (trackGeometryKey !== nextTrackKey) {
      uploadGeometry(gl, trackGeometry, buildTrackVertices(), 8);
      trackGeometryKey = nextTrackKey;
    }
    const linkCount = Array.isArray(state.linkRows) ? state.linkRows.length : 0;
    const linkBucketMs = linkCount <= 8 ? 34 : linkCount <= 48 ? 67 : 125;
    const linkClockBucket = Math.floor(Number(state.correctedNowMs || 0) / linkBucketMs);
    const nextLinkKey = `${linkStateKey}:${linkClockBucket}`;
    if (linkGeometryKey !== nextLinkKey) {
      uploadGeometry(gl, linkGeometry, buildLinkVertices(), 8);
      linkGeometryKey = nextLinkKey;
    }
    const nextDynamicKey = dynamicStateKey;
    if (dynamicGeometryKey !== nextDynamicKey) {
      uploadGeometry(gl, markerGeometry, buildMarkerVertices(), 21);
      dynamicGeometryKey = nextDynamicKey;
    }
  }

  function stableVisibility(id, shouldShow) {
    const previous = visibilityHistory.get(id) || { shown: shouldShow, agree: 0 };
    if (previous.shown === shouldShow) {
      previous.agree = 0;
      visibilityHistory.set(id, previous);
      return previous.shown;
    }
    previous.agree += 1;
    if (previous.agree >= 2) {
      previous.shown = shouldShow;
      previous.agree = 0;
    }
    visibilityHistory.set(id, previous);
    return previous.shown;
  }

  function projectLabels(args, matrix) {
    const projectionNow = performance.now();
    const labelFps = Math.max(10, Math.min(30, Number(state.settings?.renderFps || 60)));
    if (!state.cameraInteracting && projectionNow - lastLabelProjectionAt < 1000 / labelFps) return;
    lastLabelProjectionAt = projectionNow;
    const container = ensureMarkerContainer();
    const active = state.enabled === true && state.globe === true;
    container.style.display = active ? 'block' : 'none';
    if (!active) return;
    if (viewportSelectionDirty || !interactiveMarkerRows.length) refreshViewportMarkerRows(args, matrix);
    const canvas = map.getCanvas();
    const width = Math.max(1, canvas.clientWidth || canvas.width || 1);
    const height = Math.max(1, canvas.clientHeight || canvas.height || 1);
    const zoom = Number(map.getZoom?.() || 0);
    const labelSizePx = clamp(9 + Math.max(0, zoom - 1.5) * 0.62, 9, 15);
    const occlusionFrame = globeOcclusionFrame(args, matrix);
    for (const row of interactiveMarkerRows) {
      const id = String(row.noradId);
      const element = markerElements.get(id);
      if (!element) continue;
      const visualNowMs = Number.isFinite(Number(state.correctedNowMs)) ? Number(state.correctedNowMs) : Date.now() + (Number(state.clockOffsetMs) || 0);
      const visual = interpolatedRowPosition(row, state, visualNowMs);
      const position = globeWorldPosition(visual.longitudeDeg, visual.latitudeDeg, visual.renderedAltitudeM);
      if (!position) {
        element.style.display = 'none';
        continue;
      }
      // DOM labels cannot participate in the WebGL depth buffer. Use the exact
      // per-frame MapLibre camera and globe model instead; the ECEF fallback is
      // retained only for projection transitions where a stable sphere cannot
      // be recovered from getMatrixForModel().
      const occluded = occlusionFrame
        ? sphereBlocksSegment(occlusionFrame.camera, position, occlusionFrame.center, occlusionFrame.radius)
        : (typeof isOccluded === 'function' ? isOccluded(row) : false);
      const clip = projectGeodeticToClip(args, visual.longitudeDeg, visual.latitudeDeg, visual.renderedAltitudeM, multiplyMat4Vec4);
      if (!clip) {
        element.style.display = 'none';
        continue;
      }
      const w = clip[3];
      if (!Number.isFinite(w) || w <= 1e-8) {
        element.style.display = 'none';
        continue;
      }
      const x = clip[0] / w;
      const y = clip[1] / w;
      const z = clip[2] / w;
      const inside = [x, y, z].every(Number.isFinite)
        && z >= -1.05 && z <= 1.05 && x >= -1.15 && x <= 1.15 && y >= -1.15 && y <= 1.15;
      const shouldShow = inside && !occluded;
      if (!stableVisibility(id, shouldShow)) {
        element.style.display = 'none';
        continue;
      }
      element.style.display = 'block';
      const screenX = (x * 0.5 + 0.5) * width;
      const screenY = (1 - (y * 0.5 + 0.5)) * height;
      const selected = String(row.noradId) === String(state.selectedNoradId ?? '');
      const shape = markerShapeMetrics(
        state.settings?.pointRadius || 7,
        state.settings?.signalRingWidth || 3,
        state.settings?.glowRadius || 6,
        selected,
      );
      const hitSizePx = clamp(
        Math.min(62, shape.totalRadius * 2) * markerZoomScale(zoom),
        MARKER_MIN_HIT_SIZE_PX,
        96,
      );
      const anchorX = screenX - hitSizePx * 0.5;
      const anchorY = screenY - hitSizePx * 0.5;
      element.style.setProperty('--orbital-hit-size', `${hitSizePx.toFixed(2)}px`);
      element.style.setProperty('--orbital-label-size', `${labelSizePx.toFixed(2)}px`);
      // The WebGL point sprite moves at sub-pixel precision. Keep the fixed DOM
      // hit-box and label on the exact same projected coordinates; rounding
      // only this overlay made the number jump around a smoothly moving disc.
      element.style.transform = `translate3d(${anchorX.toFixed(3)}px, ${anchorY.toFixed(3)}px, 0)`;
      element.style.zIndex = String(element.classList.contains('is-selected') ? 30 : 5);
    }
  }

  function getProgramBundle(gl, args) {
    const shaderData = args?.shaderData;
    const key = String(shaderData?.variantName || 'unknown');
    let bundle = programCache.get(key);
    if (!bundle) {
      bundle = createProgramBundle(gl, shaderData);
      programCache.set(key, bundle);
    }
    return bundle;
  }

  function deleteProgramCache(gl) {
    for (const bundle of programCache.values()) {
      try { if (bundle?.line?.program) gl.deleteProgram(bundle.line.program); } catch (error) {}
      try { if (bundle?.marker?.program) gl.deleteProgram(bundle.marker.program); } catch (error) {}
    }
    programCache.clear();
  }

  function drawLines(gl, geometry, record, projectionData) {
    if (!geometry?.count || !record?.program) return;
    gl.useProgram(record.program);
    applyProjectionUniforms(gl, record.projection, projectionData);
    gl.bindVertexArray(activeGeometrySlot(geometry)?.vao || null);
    gl.drawArrays(gl.LINES, 0, geometry.count);
  }

  function drawMarkers(gl, record, projectionData, ratio) {
    if (!markerGeometry?.count || !record?.program) return;
    gl.useProgram(record.program);
    applyProjectionUniforms(gl, record.projection, projectionData);
    gl.uniform1f(record.scale, markerZoomScale(map.getZoom?.()));
    gl.uniform1f(record.interp, clamp(ratio, 0, 1));
    gl.bindVertexArray(activeGeometrySlot(markerGeometry)?.vao || null);
    gl.drawArrays(gl.POINTS, 0, markerGeometry.count);
  }

  const layer = {
    id: LAYER_ID,
    type: 'custom',
    renderingMode: '3d',
    onAdd(_map, gl) {
      glContext = gl;
      programCache.clear();
      trackGeometry = createLineGeometry(gl);
      linkGeometry = createLineGeometry(gl);
      markerGeometry = createMarkerGeometry(gl);
      ensureMarkerContainer();
      trackGeometryKey = '';
      linkGeometryKey = '';
      dynamicGeometryKey = '';
    },
    render(gl, args) {
      const projectionData = args?.defaultProjectionData;
      const matrix = projectionData?.mainMatrix;
      const active = state.enabled === true;
      if (!matrix || !active) {
        if (markerContainer) markerContainer.style.display = 'none';
        return;
      }

      // v0.2.0 keeps satellite vertices in normalized Mercator coordinates and
      // delegates the actual Mercator/globe projection to MapLibre v6's public
      // custom-layer shader contract. Camera motion therefore does not require
      // CPU reprojection or a VBO rewrite.
      if (!state.cameraInteracting || !markerGeometry?.count) uploadChangedGeometry(gl);
      projectLabels(args, matrix);
      if (!trackGeometry?.count && !linkGeometry?.count && !markerGeometry?.count) return;

      const correctedNowMs = Number.isFinite(Number(state.correctedNowMs))
        ? Number(state.correctedNowMs)
        : Date.now() + (Number(state.clockOffsetMs) || 0);
      const ratio = interpolationRatio(state, correctedNowMs);
      const programs = getProgramBundle(gl, args);

      drawLines(gl, trackGeometry, programs.line, projectionData);
      drawLines(gl, linkGeometry, programs.line, projectionData);
      drawMarkers(gl, programs.marker, projectionData, ratio);

      // Do not restore MapLibre-owned GL objects manually. The custom layer
      // leaves only its VAO unbound; MapLibre owns the rest of the frame state.
      gl.bindVertexArray(null);
    },
    onRemove(_map, gl) {
      deleteGeometry(gl, trackGeometry);
      deleteGeometry(gl, linkGeometry);
      deleteGeometry(gl, markerGeometry);
      deleteProgramCache(gl);
      trackGeometry = null;
      linkGeometry = null;
      markerGeometry = null;
      glContext = null;
      markerContainer?.remove();
      markerContainer = null;
      markerElements.clear();
      visibilityHistory.clear();
      interactiveMarkerRows = [];
      viewportLabelIds = new Set();
      viewportSelectionDirty = true;
      markerSignature = '';
      trackGeometryKey = '';
      linkGeometryKey = '';
      dynamicGeometryKey = '';
    },
  };

  return {
    id: LAYER_ID,
    layer,
    setState(nextState) {
      const rowsChanged = Array.isArray(nextState?.rows) && nextState.rows !== state.rows;
      const merged = { ...state, ...(nextState || {}), revision: Number(nextState?.revision ?? state.revision + 1) };
      const nextTrackStateKey = trackSignature(merged);
      const nextLinkStateKey = linkSignature(merged);
      const nextDynamicStateKey = dynamicSignature(merged);
      if (nextTrackStateKey !== trackStateKey) trackGeometryKey = '';
      if (nextLinkStateKey !== linkStateKey) linkGeometryKey = '';
      if (rowsChanged || nextDynamicStateKey !== dynamicStateKey) dynamicGeometryKey = '';
      trackStateKey = nextTrackStateKey;
      linkStateKey = nextLinkStateKey;
      dynamicStateKey = nextDynamicStateKey;
      const viewportChanged = rowsChanged
        || merged.sceneAtMs !== state.sceneAtMs
        || String(merged.selectedNoradId ?? '') !== String(state.selectedNoradId ?? '')
        || merged.enabled !== state.enabled
        || merged.globe !== state.globe
        || merged.settings?.labels !== state.settings?.labels;
      state = merged;
      if (viewportChanged) viewportSelectionDirty = true;
      if (markerElements.size) {
        const byId = new Map((state.rows || []).map((row) => [String(row.noradId), row]));
        for (const [id, element] of markerElements) {
          const row = byId.get(id);
          if (row) updateMarkerVisual(element, row, state, viewportLabelIds.has(id));
        }
      }
      try { map.triggerRepaint(); } catch (error) {}
    },
    refreshLabels() {
      // A label toggle must become visible on the very next custom-layer frame.
      // Do not wait for a camera gesture, scene keyframe or page reload.
      viewportSelectionDirty = true;
      markerSignature = '';
      lastLabelProjectionAt = 0;
      if (markerElements.size) {
        const byId = new Map((state.rows || []).map((row) => [String(row.noradId), row]));
        for (const [id, element] of markerElements) {
          const row = byId.get(id);
          if (row) updateMarkerVisual(element, row, state, viewportLabelIds.has(id));
        }
      }
      try { map.triggerRepaint(); } catch (error) {}
    },
    setCameraInteracting(active) {
      state = { ...state, cameraInteracting: active === true };
      if (!state.cameraInteracting) { trackGeometryKey = ''; linkGeometryKey = ''; dynamicGeometryKey = ''; viewportSelectionDirty = true; }
      try { map.triggerRepaint(); } catch (error) {}
    },
    updateClock(correctedNowMs) {
      const nextNow = Number(correctedNowMs);
      if (!Number.isFinite(nextNow)) return;
      const trackCount = Array.isArray(state.tracks) ? state.tracks.length : 0;
      // Keep a selected / small GNSS track set tightly clocked to the smoothly
      // interpolated satellite disc, but avoid rebuilding hundreds of Starlink
      // line strips at animation-frame cadence.
      // A selected / small track set must share almost the same visual clock
      // as the GPU marker; 125 ms was still visible at street/country zoom.
      // Larger Starlink track sets stay budgeted to avoid CPU line rebuilds.
      const bucketMs = trackCount <= 8 ? 34 : trackCount <= 32 ? 67 : trackCount <= 96 ? 125 : 250;
      const previousBucket = Math.floor(Number(state.correctedNowMs || 0) / bucketMs);
      const nextBucket = Math.floor(nextNow / bucketMs);
      state = { ...state, correctedNowMs: nextNow };
      if (nextBucket !== previousBucket) trackGeometryKey = '';
      try { map.triggerRepaint(); } catch (error) {}
    },
    invalidateProjection() {
      trackGeometryKey = '';
      linkGeometryKey = '';
      dynamicGeometryKey = '';
      viewportSelectionDirty = true;
      try { map.triggerRepaint(); } catch (error) {}
    },
    destroy() {
      if (map.getLayer(LAYER_ID)) {
        try { map.removeLayer(LAYER_ID); } catch (error) {}
      } else {
        markerContainer?.remove();
      }
      markerContainer = null;
      markerElements.clear();
      visibilityHistory.clear();
      interactiveMarkerRows = [];
      if (glContext) {
        deleteGeometry(glContext, trackGeometry);
        deleteGeometry(glContext, linkGeometry);
        deleteGeometry(glContext, markerGeometry);
        deleteProgramCache(glContext);
      }
      trackGeometry = null;
      linkGeometry = null;
      markerGeometry = null;
      glContext = null;
    },
  };
}

export { LAYER_ID as ASTRIS_ORBITAL_LAYER_ID };
