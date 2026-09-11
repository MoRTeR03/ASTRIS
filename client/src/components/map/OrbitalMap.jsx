import { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef } from 'react';
import * as maplibregl from 'maplibre-gl';
import { createAstrisOrbitalLayer, trackLongitudeAtCurrentFrame } from '../../map/rendering/AstrisOrbitalLayer.js';
import { colorFor } from '../../lib/colors.js';
import { angularDistanceDeg, splitTrackAtAntimeridian } from '../../lib/geo.js';
import { scaleMapLibreTextSize } from '../../lib/mapStyleExpressions.js';
import { ASTRIS_GRATICULE_PALETTES, ASTRIS_MAP_LAYERS } from '../../map/config/MapSettingsStore.js';
import { coverageFootprint } from '../../map/geometry/OrbitalCoverageFootprint.js';
import { solarMapLightPosition, solarSubpoint } from '../../map/geometry/dayNightModel.js';
import { evaluateObserverLineOfSight } from '../../map/geometry/OrbitalLineOfSight.js';

const IDS = Object.freeze({
  points: 'astris-satellites-2d', halo: 'astris-satellites-halo-2d', labelsSource: 'astris-satellites-label-source-2d', labels: 'astris-satellites-labels-2d',
  track: 'astris-track-2d', links: 'astris-links-2d', coverage: 'astris-coverage', coverageFill: 'astris-coverage-fill', coverageLine: 'astris-coverage-line',
  grid: 'astris-wgs84-grid', gridMinor: 'astris-wgs84-grid-minor', gridMajor: 'astris-wgs84-grid-major', gridLabels: 'astris-wgs84-grid-labels',
  terrain: 'astris-terrain-dem', hillshade: 'astris-terrain-hillshade', buildingsSource: 'astris-openfreemap-buildings', buildings: 'astris-3d-buildings',
});
const BUILDING_SOURCE_URL = 'https://tiles.openfreemap.org/planet';
const TERRAIN_URL = 'https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png';
const BUILDING_PALETTES = { standard: '#c8c0b4', oled: '#3d4654', cool: '#334856', warm: '#574539', satellite: '#afbdc8' };
const MAX_INTERACTIVE_2D_ROWS = 520;
const MAX_LOS_LINKS = 300;
const GLOBE_OVERVIEW_ZOOM = 0.4;
const ORBITAL_OVERVIEW_ZOOM = 0.15;

const LIGHTS = {
  soft: { anchor: 'viewport', color: '#edf4ff', intensity: 0.26, position: [1.25, 215, 42] },
  balanced: { anchor: 'map', color: '#fff8ed', intensity: 0.38, position: [1.2, 210, 34] },
  contrast: { anchor: 'viewport', color: '#ffffff', intensity: 0.52, position: [1.35, 225, 36] },
};

function expandTileTemplates(url) {
  if (!url) return [];
  const clean = url.replace('{r}', '');
  return clean.includes('{s}') ? ['a', 'b', 'c'].map((s) => clean.replace('{s}', s)) : [clean];
}

function buildRasterStyle(settings) {
  const cfg = ASTRIS_MAP_LAYERS[settings.layer] || ASTRIS_MAP_LAYERS.osm;
  const selectedUrl = settings.labels ? cfg.url : (cfg.urlNoLabels || cfg.url);
  return {
    version: 8,
    glyphs: 'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf',
    projection: { type: settings.globe ? 'globe' : 'mercator' },
    sources: { base: { type: 'raster', tiles: expandTileTemplates(selectedUrl), tileSize: 256, maxzoom: cfg.maxZoom || 19, attribution: cfg.attribution || '' } },
    layers: [{ id: 'base', type: 'raster', source: 'base', paint: { 'raster-opacity': 1, 'raster-brightness-min': 0, 'raster-brightness-max': settings.brightness / 100, 'raster-saturation': settings.layer === 'esriSat' ? 0.08 : 0.02, 'raster-contrast': settings.layer === 'esriSat' ? 0.08 : 0.04 } }],
  };
}

function buildMapStyle(settings) {
  const cfg = ASTRIS_MAP_LAYERS[settings.layer] || ASTRIS_MAP_LAYERS.ofmDark;
  return cfg.kind === 'style' ? cfg.styleUrl : buildRasterStyle(settings);
}

function styleSettingsKey(settings) {
  const cfg = ASTRIS_MAP_LAYERS[settings.layer] || ASTRIS_MAP_LAYERS.ofmDark;
  // Label visibility is a live setting and must never force a full setStyle()
  // cycle. Raster basemaps use RasterTileSource.setTiles(), while vector
  // basemaps toggle symbol layer visibility in-place.
  return `${settings.layer}|${cfg.kind || 'style'}`;
}

function graticuleStepForZoom(zoom) {
  if (zoom < 1.5) return 30; if (zoom < 3) return 10; if (zoom < 5) return 5; if (zoom < 7) return 2;
  if (zoom < 9) return 1; if (zoom < 11) return .5; if (zoom < 12.5) return .2; if (zoom < 14) return .1;
  if (zoom < 15.5) return .05; if (zoom < 17) return .02; return .01;
}
function fmtCoord(v, axis) { const a = Math.abs(v); const d = a < .1 ? 3 : a < 1 ? 2 : a < 10 ? 1 : 0; return `${a.toFixed(d)}°${axis === 'lat' ? (v > 0 ? 'N' : v < 0 ? 'S' : '') : (v > 0 ? 'E' : v < 0 ? 'W' : '')}`; }

function normalizeLongitude(value) {
  let longitude = Number(value);
  if (!Number.isFinite(longitude)) return Number.NaN;
  while (longitude > 180) longitude -= 360;
  while (longitude < -180) longitude += 360;
  return longitude;
}

function destinationCoordinate(longitudeDeg, latitudeDeg, bearingDeg, angularDistanceDeg = 90) {
  const latitude = Number(latitudeDeg) * Math.PI / 180;
  const longitude = Number(longitudeDeg) * Math.PI / 180;
  const bearing = Number(bearingDeg) * Math.PI / 180;
  const distance = Number(angularDistanceDeg) * Math.PI / 180;
  const targetLatitude = Math.asin(
    Math.sin(latitude) * Math.cos(distance)
      + Math.cos(latitude) * Math.sin(distance) * Math.cos(bearing),
  );
  const targetLongitude = longitude + Math.atan2(
    Math.sin(bearing) * Math.sin(distance) * Math.cos(latitude),
    Math.cos(distance) - Math.sin(latitude) * Math.sin(targetLatitude),
  );
  return [normalizeLongitude(targetLongitude * 180 / Math.PI), targetLatitude * 180 / Math.PI];
}
function buildGraticule(map, settings) {
  const g = settings.graticule; const zoom = map.getZoom(); const step = g.mode === 'manual' ? g.step : graticuleStepForZoom(zoom);
  const bounds = map.getBounds(); let west = zoom < 2.5 ? -180 : Math.max(-180, bounds.getWest() - step); let east = zoom < 2.5 ? 180 : Math.min(180, bounds.getEast() + step);
  let south = zoom < 2.5 ? -85 : Math.max(-85, bounds.getSouth() - step); let north = zoom < 2.5 ? 85 : Math.min(85, bounds.getNorth() + step);
  if (east < west || east - west > 330) { west = -180; east = 180; }
  const features = []; const majorStep = step * g.majorEvery; let count = 0; const seg = Math.max(.05, Math.min(2, step));
  for (let lon = Math.ceil(west / step) * step; lon <= east + 1e-6 && count < 320; lon += step, count += 1) {
    const x = Number(lon.toFixed(8)); const major = Math.abs(x / majorStep - Math.round(x / majorStep)) < .001; const coords = [];
    for (let lat = south; lat <= north + 1e-6; lat += seg) coords.push([x, Math.min(north, lat)]);
    features.push({ type: 'Feature', properties: { major }, geometry: { type: 'LineString', coordinates: coords } });
    if (major && g.labels) features.push({ type: 'Feature', properties: { major, label: fmtCoord(x, 'lon') }, geometry: { type: 'Point', coordinates: [x, south + Math.min(step * .35, Math.max(.02, (north - south) * .04))] } });
  }
  for (let lat = Math.ceil(south / step) * step; lat <= north + 1e-6 && count < 320; lat += step, count += 1) {
    const y = Number(lat.toFixed(8)); const major = Math.abs(y / majorStep - Math.round(y / majorStep)) < .001; const coords = [];
    for (let lon = west; lon <= east + 1e-6; lon += seg) coords.push([Math.min(east, lon), y]);
    features.push({ type: 'Feature', properties: { major }, geometry: { type: 'LineString', coordinates: coords } });
    if (major && g.labels) features.push({ type: 'Feature', properties: { major, label: fmtCoord(y, 'lat') }, geometry: { type: 'Point', coordinates: [west + Math.min(step * .35, Math.max(.02, (east - west) * .03)), y] } });
  }
  return { type: 'FeatureCollection', features };
}

function interactiveRows(rowsValue, selectedNoradId, limit = MAX_INTERACTIVE_2D_ROWS) {
  const rows = Array.isArray(rowsValue) ? rowsValue : [];
  const selectedId = String(selectedNoradId ?? '');
  const result = [];
  const used = new Set();
  const push = (row) => {
    if (!row || result.length >= limit) return;
    const id = String(row.noradId ?? '');
    if (!id || used.has(id)) return;
    used.add(id); result.push(row);
  };
  if (selectedId) push(rows.find((row) => String(row.noradId) === selectedId));
  for (const row of rows) if (String(row.constellation).toUpperCase() !== 'STARLINK') push(row);
  for (const row of rows) if (row.visible === true) push(row);
  for (const row of rows) push(row);
  return result;
}

function longitudeInRange(longitudeDeg, westDeg, eastDeg) {
  const lon = Number(longitudeDeg);
  const west = Number(westDeg);
  const east = Number(eastDeg);
  if (![lon, west, east].every(Number.isFinite)) return false;
  if (west <= east) return lon >= west && lon <= east;
  return lon >= west || lon <= east;
}

function interactiveRowsIn2dViewport(map, rowsValue, selectedNoradId, limit = MAX_INTERACTIVE_2D_ROWS) {
  const rows = Array.isArray(rowsValue) ? rowsValue : [];
  let bounds;
  try { bounds = map?.getBounds?.(); } catch { bounds = null; }
  if (!bounds) return interactiveRows(rows, selectedNoradId, limit);
  const south = Number(bounds.getSouth?.());
  const north = Number(bounds.getNorth?.());
  const west = Number(bounds.getWest?.());
  const east = Number(bounds.getEast?.());
  if (![south, north, west, east].every(Number.isFinite)) return interactiveRows(rows, selectedNoradId, limit);

  const latPad = Math.min(20, Math.max(1, (north - south) * 0.12));
  const paddedSouth = Math.max(-90, south - latPad);
  const paddedNorth = Math.min(90, north + latPad);
  const viewportRows = rows.filter((row) => {
    const lat = Number(row.latitudeDeg);
    return Number.isFinite(lat) && lat >= paddedSouth && lat <= paddedNorth
      && longitudeInRange(row.longitudeDeg, west, east);
  });
  if (!viewportRows.length) return interactiveRows(rows, selectedNoradId, limit);
  return interactiveRows(viewportRows, selectedNoradId, limit);
}

function labelRowsIn2dViewport(map, rowsValue, selectedNoradId, limit = 140) {
  const candidates = interactiveRowsIn2dViewport(map, rowsValue, selectedNoradId, Math.max(limit * 3, 320));
  const selectedId = String(selectedNoradId ?? '');
  let center;
  try { center = map?.getCenter?.(); } catch { center = null; }
  const centerLon = Number(center?.lng ?? 0);
  const centerLat = Number(center?.lat ?? 0);
  return candidates
    .map((row) => ({
      row,
      selected: String(row?.noradId ?? '') === selectedId,
      systemPriority: String(row?.constellation || '').toUpperCase() === 'STARLINK' ? 1 : 0,
      distance: angularDistanceDeg(centerLon, centerLat, row?.longitudeDeg, row?.latitudeDeg),
    }))
    .sort((a, b) => Number(b.selected) - Number(a.selected)
      || a.systemPriority - b.systemPriority
      || a.distance - b.distance
      || Number(b.row?.elevationDeg ?? -90) - Number(a.row?.elevationDeg ?? -90))
    .slice(0, Math.max(1, Math.min(240, Number(limit) || 140)))
    .map((entry) => entry.row);
}

function pointsGeoJson(rows) {
  return { type: 'FeatureCollection', features: rows.map((row) => ({ type: 'Feature', properties: { noradId: String(row.noradId), label: row.prn || row.objectName, constellation: row.constellation, color: colorFor(row), visible: row.visible === true ? 1 : row.visible === false ? 0 : -1 }, geometry: { type: 'Point', coordinates: [row.longitudeDeg, row.latitudeDeg] } })) };
}
function tracksGeoJson(tracks, correctedNowMs, selectedNoradId) {
  const selectedId = String(selectedNoradId ?? '');
  const features = [];
  for (const track of Array.isArray(tracks) ? tracks : []) {
    const noradId = String(track?.noradId ?? '');
    const constellation = String(track?.constellation || 'OTHER').toUpperCase();
    const points = (Array.isArray(track?.points) ? track.points : []).map((point) => ({
      ...point,
      longitudeDeg: trackLongitudeAtCurrentFrame(
        point?.longitudeDeg,
        track?.referenceAtMs,
        correctedNowMs,
        track?.referenceFrame,
      ),
    }));
    for (const coordinates of splitTrackAtAntimeridian(points)) {
      features.push({
        type: 'Feature',
        properties: {
          noradId,
          constellation,
          selected: noradId === selectedId ? 1 : 0,
          color: colorFor({ constellation }),
        },
        geometry: { type: 'LineString', coordinates },
      });
    }
  }
  return { type: 'FeatureCollection', features };
}
function decorateLosRows(rowsValue, observer, settings, selectedNoradId) {
  const rows = Array.isArray(rowsValue) ? rowsValue : [];
  const observerValid = Number.isFinite(Number(observer?.lat)) && Number.isFinite(Number(observer?.lon));
  const selectedId = String(selectedNoradId ?? '');
  const horizonDeg = Math.max(0.12, Number(settings?.orbitalOverlay?.horizonDeg ?? 0));
  const candidateIds = new Set();
  if (selectedId) candidateIds.add(selectedId);
  for (const row of rows) {
    if (candidateIds.size >= MAX_LOS_LINKS) break;
    const elevation = Number(row?.elevationDeg);
    if (Number.isFinite(elevation) && elevation >= horizonDeg) candidateIds.add(String(row.noradId));
  }
  return rows.map((row) => {
    const renderedAltitudeM = Math.max(0, Number(row.altitudeKm || 0) * 1000 * Number(settings?.orbitalOverlay?.altitudeScale ?? 50) / 100);
    if (!observerValid || !candidateIds.has(String(row.noradId))) {
      const elevation = Number(row?.elevationDeg);
      const thresholdVisible = Number.isFinite(elevation) ? elevation >= horizonDeg : row?.visible !== false;
      return { ...row, renderedAltitudeM, observerPhysicalLineOfSight: false, observerDisplayLineOfSight: false, observerServerLineOfSight: thresholdVisible, observerGlobeLineOfSight: false, observerLegacyLineOfSight: false, observerFlatLineOfSight: false, observerLineOfSight: false };
    }
    const lineOfSight = evaluateObserverLineOfSight(observer, { ...row, renderedAltitudeM }, { guardDeg: horizonDeg, marginM: 0 });
    const physicalVisible = lineOfSight.physicalVisible && lineOfSight.serverVisible;
    const legacyVisible = lineOfSight.legacyVisible;
    const useLegacyScale = settings?.orbitalOverlay?.observerLinkMode === 'legacy-scale';
    return {
      ...row,
      renderedAltitudeM,
      observerElevationDeg: lineOfSight.elevationDeg,
      observerPhysicalLineOfSight: lineOfSight.physicalVisible,
      observerDisplayLineOfSight: lineOfSight.displayVisible,
      observerServerLineOfSight: lineOfSight.serverVisible,
      observerGlobeLineOfSight: physicalVisible,
      observerLegacyLineOfSight: legacyVisible,
      observerFlatLineOfSight: physicalVisible,
      observerLineOfSight: useLegacyScale ? legacyVisible : physicalVisible,
    };
  });
}

function linksGeoJson(rows, observer) {
  if (!Number.isFinite(Number(observer?.lat)) || !Number.isFinite(Number(observer?.lon))) return { type: 'FeatureCollection', features: [] };
  return { type: 'FeatureCollection', features: rows.filter((r) => r.observerLineOfSight === true).slice(0, MAX_LOS_LINKS).map((row) => ({ type: 'Feature', properties: { color: colorFor(row) }, geometry: { type: 'LineString', coordinates: [[Number(observer.lon), Number(observer.lat)], [row.longitudeDeg, row.latitudeDeg]] } })) };
}
function coverageGeoJson(rows, selected, settings) {
  const targets = [];
  const horizonDeg = Number(settings?.orbitalOverlay?.horizonDeg || 0);
  if (settings.orbitalOverlay.coverage) targets.push(...rows.filter((r) => {
    const elevation = Number(r?.elevationDeg);
    return Number.isFinite(elevation) ? elevation >= horizonDeg : r.visible !== false;
  }).slice(0, 48));
  if (settings.orbitalOverlay.selectedCoverage && selected && !targets.some((r) => String(r.noradId) === String(selected.noradId))) targets.push(selected);
  const features = [];
  for (const row of targets) {
    const c = coverageFootprint(row, settings.orbitalOverlay.coverageMinElevationDeg, 96); if (!c) continue;
    features.push({ type: 'Feature', properties: { noradId: String(row.noradId), selected: selected && String(row.noradId) === String(selected.noradId) ? 1 : 0, color: colorFor(row) }, geometry: { type: 'Polygon', coordinates: [c.polygon] } });
  }
  return { type: 'FeatureCollection', features };
}
function firstSymbolLayerId(map) { return (map.getStyle()?.layers || []).find((l) => l.type === 'symbol')?.id; }
function buildingColor(settings) { if (settings.buildingPalette !== 'adaptive') return BUILDING_PALETTES[settings.buildingPalette] || BUILDING_PALETTES.oled; return ASTRIS_MAP_LAYERS[settings.layer]?.family === 'imagery' ? BUILDING_PALETTES.satellite : ['ofmLiberty', 'ofmBright', 'ofmPositron', 'cartoLight'].includes(settings.layer) ? BUILDING_PALETTES.standard : BUILDING_PALETTES.oled; }

function orbitalTracksForState(state) {
  const list = Array.isArray(state?.tracks) ? [...state.tracks] : [];
  const selectedId = String(state?.selectedNoradId ?? '');
  if (selectedId && Array.isArray(state?.track) && state.track.length && !list.some((item) => String(item?.noradId) === selectedId)) {
    const selectedRow = (state.rows || []).find((row) => String(row.noradId) === selectedId);
    list.unshift({
      noradId: selectedId,
      constellation: selectedRow?.constellation || 'OTHER',
      points: state.track,
      referenceFrame: state.trackReferenceFrame || '',
      referenceAtMs: state.trackReferenceAtMs ?? state.sceneAtMs ?? null,
    });
  }
  return list;
}

function correctedSceneNow(state) {
  return Date.now() + (Number.isFinite(Number(state?.clockOffsetMs)) ? Number(state.clockOffsetMs) : 0);
}

function clamp01(value) {
  return Math.max(0, Math.min(1, Number(value) || 0));
}

function interpolateLongitude(fromValue, toValue, ratio) {
  const from = Number(fromValue);
  const to = Number(toValue);
  if (!Number.isFinite(from) || !Number.isFinite(to)) return Number.isFinite(from) ? from : to;
  const delta = ((to - from + 540) % 360) - 180;
  return normalizeLongitude(from + delta * ratio);
}

function interpolatedSceneRows(rowsValue, state, correctedNowMs) {
  const rows = Array.isArray(rowsValue) ? rowsValue : [];
  const fromMs = Number(state?.sceneAtMs);
  const toMs = Number(state?.nextAtMs);
  const ratio = Number.isFinite(fromMs) && Number.isFinite(toMs) && toMs > fromMs
    ? clamp01((correctedNowMs - fromMs) / (toMs - fromMs))
    : 0;
  const visualRows = rows.map((row) => {
    const longitudeDeg = Number.isFinite(Number(row.nextLongitudeDeg))
      ? interpolateLongitude(row.longitudeDeg, row.nextLongitudeDeg, ratio)
      : Number(row.longitudeDeg);
    const latitudeDeg = Number.isFinite(Number(row.nextLatitudeDeg))
      ? Number(row.latitudeDeg) + (Number(row.nextLatitudeDeg) - Number(row.latitudeDeg)) * ratio
      : Number(row.latitudeDeg);
    const altitudeKm = Number.isFinite(Number(row.nextAltitudeKm))
      ? Number(row.altitudeKm) + (Number(row.nextAltitudeKm) - Number(row.altitudeKm)) * ratio
      : Number(row.altitudeKm);
    return { ...row, longitudeDeg, latitudeDeg, altitudeKm };
  });
  return { rows: visualRows, ratio };
}

function effectiveOrbitalFps(rowCount, requestedFps, globe = false) {
  const requested = Math.max(1, Math.min(60, Number(requestedFps) || 60));
  if (globe) return requested;
  // 2D updates only the interaction budget (<=520 GeoJSON points), not the
  // full Starlink catalogue. 30 FPS stays fluid without flooding setData().
  if (rowCount >= 400) return Math.min(requested, 30);
  return requested;
}


const OrbitalMap = forwardRef(function OrbitalMap({ rows, tracks, track, trackReferenceFrame, trackReferenceAtMs, sceneAtMs, nextAtMs, clockOffsetMs, observer, settings, selectedNoradId, onSelect, onRuntime }, ref) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const nativeRef = useRef(null);
  const markerRef = useRef(null);
  const cameraInteractingRef = useRef(false);
  const nativeRevisionRef = useRef(0);
  const syncRafRef = useRef(0);
  const styleRestoreTimersRef = useRef([]);
  const styleRevisionRef = useRef(0);
  const appliedStyleKeyRef = useRef('');
  const pendingStyleSyncRef = useRef(false);
  const nativeBuildingVisibilityRef = useRef(new Map());
  const labelDefaultsRef = useRef(new Map());
  const labelAppliedRef = useRef(new Map());
  const motionRef = useRef({ raf: 0, lastFrameAt: 0, frames: 0, fpsWindowAt: performance.now(), renderedFps: 0 });
  const visualRowsRef = useRef({ byId: new Map(), lastAtMs: 0, sourceAtMs: null });
  const interactive2dRef = useRef({ rows: [], sceneAtMs: null, selectedNoradId: '' });
  const stateRef = useRef({ rows, tracks, track, trackReferenceFrame, trackReferenceAtMs, sceneAtMs, nextAtMs, clockOffsetMs, observer, settings, selectedNoradId, onSelect });

  function refresh2dInteractiveRows(map, currentState = stateRef.current) {
    if (!map || currentState.settings?.globe === true) return;
    interactive2dRef.current = {
      rows: interactiveRowsIn2dViewport(map, currentState.rows, currentState.selectedNoradId),
      sceneAtMs: currentState.sceneAtMs,
      selectedNoradId: String(currentState.selectedNoradId ?? ''),
    };
  }
  stateRef.current = { rows, tracks, track, trackReferenceFrame, trackReferenceAtMs, sceneAtMs, nextAtMs, clockOffsetMs, observer, settings, selectedNoradId, onSelect };
  const selected = useMemo(() => rows.find((r) => String(r.noradId) === String(selectedNoradId)) || null, [rows, selectedNoradId]);

  function emitRuntime(map, extra = {}) {
    const c = map.getCenter();
    const solar = solarSubpoint(new Date());
    const effectiveFps = effectiveOrbitalFps(stateRef.current.rows?.length || 0, stateRef.current.settings.orbitalOverlay?.renderFps || 60, stateRef.current.settings.globe === true);
    onRuntime?.({
      center: { lat: c.lat, lon: c.lng, zoom: map.getZoom() },
      bearing: map.getBearing(),
      pitch: map.getPitch(),
      projection: map.getProjection()?.type || 'mercator',
      orbitalRenderFps: motionRef.current.renderedFps || 0,
      orbitalEffectiveFps: effectiveFps,
      solarLongitudeDeg: solar.longitudeDeg,
      solarLatitudeDeg: solar.latitudeDeg,
      ...extra,
    });
  }

  function syncSpaceBackgroundCamera(map, date = new Date()) {
    const container = containerRef.current;
    if (!container || !map) return;
    const currentSettings = stateRef.current.settings;
    const mode = currentSettings.globe === true
      && currentSettings.orbitalOverlay?.enabled === true
      && currentSettings.orbitalOverlay?.spaceBackgroundMode !== 'off'
      ? 'synthetic'
      : 'off';
    container.classList.toggle('is-space-orbit-bg', mode !== 'off');
    container.classList.toggle('is-space-synthetic', mode === 'synthetic');
    const center = map.getCenter?.() || { lng: 0, lat: 0 };
    const bearing = Number(map.getBearing?.() || 0);
    const pitch = Number(map.getPitch?.() || 0);
    const roll = Number(map.getRoll?.() || 0);
    const zoom = Number(map.getZoom?.() || 0);
    const centerLongitude = normalizeLongitude(Number(center.lng || 0));
    const centerLatitude = Math.max(-89, Math.min(89, Number(center.lat || 0)));
    // v0.1.12 camera contract: both normal globe dragging (center lng/lat) and
    // orbit-style rotation (bearing/roll) must visibly move the sky. Do not
    // inject a second sidereal animation into the camera transform; it made the
    // Sun and star backdrop look like two unrelated reference frames.
    const skyLongitude = normalizeLongitude(centerLongitude + bearing);
    const sun = solarSubpoint(date);
    const lat1 = centerLatitude * Math.PI / 180;
    const lat2 = sun.latitudeDeg * Math.PI / 180;
    const deltaLongitude = normalizeLongitude(sun.longitudeDeg - centerLongitude) * Math.PI / 180;
    const solarCentralAngleDeg = Math.acos(Math.max(-1, Math.min(1,
      Math.sin(lat1) * Math.sin(lat2) + Math.cos(lat1) * Math.cos(lat2) * Math.cos(deltaLongitude),
    ))) * 180 / Math.PI;
    const solarBearing = Math.atan2(
      Math.sin(deltaLongitude) * Math.cos(lat2),
      Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(deltaLongitude),
    ) * 180 / Math.PI;
    const width = Math.max(1, Number(container.clientWidth || map.getCanvas?.()?.clientWidth || 1));
    const height = Math.max(1, Number(container.clientHeight || map.getCanvas?.()?.clientHeight || 1));
    const projectedCenter = map.project?.([centerLongitude, centerLatitude]);
    const centerX = Number.isFinite(projectedCenter?.x) ? projectedCenter.x : width / 2;
    const centerY = Number.isFinite(projectedCenter?.y) ? projectedCenter.y : height / 2;
    const horizonCoordinate = destinationCoordinate(centerLongitude, centerLatitude, solarBearing, 90);
    const projectedHorizon = map.project?.(horizonCoordinate);
    const projectedDirectionX = Number(projectedHorizon?.x) - centerX;
    const projectedDirectionY = Number(projectedHorizon?.y) - centerY;
    const projectedDirectionLength = Math.hypot(projectedDirectionX, projectedDirectionY);
    const fallbackScreenBearing = (solarBearing - bearing) * Math.PI / 180;
    const directionX = Number.isFinite(projectedDirectionLength) && projectedDirectionLength > 1
      ? projectedDirectionX / projectedDirectionLength
      : Math.sin(fallbackScreenBearing);
    const directionY = Number.isFinite(projectedDirectionLength) && projectedDirectionLength > 1
      ? projectedDirectionY / projectedDirectionLength
      : -Math.cos(fallbackScreenBearing);
    const projectedEarthRadius = Number.isFinite(projectedDirectionLength) && projectedDirectionLength > 1
      ? projectedDirectionLength
      : Math.min(width, height) * Math.max(0.08, Math.min(1.25, 0.12 * (2 ** (zoom + 0.25))));
    const rawSunDistance = Math.max(0, (180 - solarCentralAngleDeg) / 90) * Math.min(width, height) * 0.5;
    const sunRadiusPx = Math.max(12, Math.min(24, width * 0.014));
    const limbClearance = rawSunDistance - projectedEarthRadius;
    const normalizedClearance = Math.max(0, Math.min(1, (limbClearance + sunRadiusPx) / Math.max(1, sunRadiusPx * 2)));
    const sunVisibility = normalizedClearance * normalizedClearance * (3 - 2 * normalizedClearance);
    const sunX = (centerX + directionX * rawSunDistance) / width * 100;
    const sunY = (centerY + directionY * rawSunDistance) / height * 100;
    // Infinite procedural-looking sky made from three independent repeating
    // random star catalogues. Each layer has a different tile size/offset, so
    // there is no finite image edge and no obvious one-tile repetition.
    // Longitude reacts to ordinary left-drag globe rotation; bearing/roll react
    // to orbit-style rotation. This deliberately restores the accepted v0.1.12
    // Sun math while improving only the star backdrop.
    const starBaseX = -skyLongitude * 5.2;
    const starBaseY = centerLatitude * 3.4 + pitch * 1.15;
    container.style.setProperty('--astris-space-roll', `${(-bearing - roll).toFixed(2)}deg`);
    container.style.setProperty('--astris-star-a-x', `${starBaseX.toFixed(1)}px`);
    container.style.setProperty('--astris-star-a-y', `${starBaseY.toFixed(1)}px`);
    container.style.setProperty('--astris-star-b-x', `${(starBaseX * 0.73 + 317).toFixed(1)}px`);
    container.style.setProperty('--astris-star-b-y', `${(starBaseY * 0.81 - 191).toFixed(1)}px`);
    container.style.setProperty('--astris-star-c-x', `${(starBaseX * 1.19 - 223).toFixed(1)}px`);
    container.style.setProperty('--astris-star-c-y', `${(starBaseY * 0.57 + 271).toFixed(1)}px`);
    container.style.setProperty('--astris-space-scale', String(Math.max(1.03, Math.min(1.18, 1.04 + zoom * 0.01))));
    container.style.setProperty('--astris-sun-x', `${sunX.toFixed(2)}%`);
    container.style.setProperty('--astris-sun-y', `${sunY.toFixed(2)}%`);
    container.style.setProperty('--astris-sun-opacity', mode === 'synthetic' ? sunVisibility.toFixed(3) : '0');
    container.dataset.solarUtc = date.toISOString();
    container.dataset.solarVisibility = sunVisibility.toFixed(3);
  }


  function syncProjectionZoomInteractions(map) {
    if (!map) return;
    // MapLibre v6 has projection-aware globe controls. Use the native handlers
    // instead of the v5-era ASTRIS center-anchoring workaround; v6 keeps the
    // pointer interaction stable on the sphere and handles globe edge cases
    // internally. Re-enabling clears any handler options inherited from an
    // older profile/runtime without monkey-patching Map#easeTo.
    try { map.scrollZoom?.disable(); map.scrollZoom?.enable(); } catch { /* noop */ }
    try { map.touchZoomRotate?.disable(); map.touchZoomRotate?.enable(); } catch { /* noop */ }
    try { map.touchPitch?.disable(); map.touchPitch?.enable(); } catch { /* noop */ }
    try { map.doubleClickZoom?.disable(); map.doubleClickZoom?.enable(); } catch { /* noop */ }
  }

  function ensureProjection(map) {
    const requested = stateRef.current.settings.globe ? 'globe' : 'mercator';
    const actual = String(map.getProjection?.()?.type || 'mercator');
    if (actual !== requested) {
      try { map.setProjection({ type: requested }); } catch { /* style/projection transition */ }
      nativeRef.current?.invalidateProjection?.();
    }
    syncProjectionZoomInteractions(map, requested);
    return requested;
  }

  function applyViewPreset(map, presetKey) {
    if (!map) return;
    const o = stateRef.current.observer;
    const center = Number.isFinite(Number(o?.lat)) && Number.isFinite(Number(o?.lon))
      ? [Number(o.lon), Number(o.lat)] : [20, 28];
    try { map.stop(); } catch { /* noop */ }
    const requestedProjection = presetKey === 'globe' || presetKey === 'orbital' ? 'globe' : 'mercator';
    try { if (String(map.getProjection?.()?.type || 'mercator') !== requestedProjection) map.setProjection({ type: requestedProjection }); } catch { /* projection transition */ }
    nativeRef.current?.invalidateProjection?.();
    if (presetKey === 'globe' || presetKey === 'orbital') {
      try { map.jumpTo({ center, zoom: presetKey === 'orbital' ? ORBITAL_OVERVIEW_ZOOM : GLOBE_OVERVIEW_ZOOM, pitch: 0, bearing: 0, roll: 0 }); } catch { map.jumpTo({ center, zoom: GLOBE_OVERVIEW_ZOOM, pitch: 0, bearing: 0 }); }
    } else if (presetKey === 'city') {
      map.easeTo({ center, zoom: Math.max(15.6, map.getZoom()), pitch: 56, bearing: map.getBearing(), duration: 420 });
    } else if (presetKey === 'satellite3d') {
      map.easeTo({ center, zoom: Math.max(14.8, map.getZoom()), pitch: 58, bearing: map.getBearing(), duration: 420 });
    } else {
      map.easeTo({ center, zoom: Math.max(2.2, Math.min(9, map.getZoom())), pitch: 0, bearing: 0, duration: 320 });
    }
    window.requestAnimationFrame(() => { ensureProjection(map); nativeRef.current?.invalidateProjection?.(); emitRuntime(map); });
  }

  function addOperationalLayers(map) {
    const s = stateRef.current; const globe = s.settings.globe;
    const addSource = (id, data) => { if (!map.getSource(id)) map.addSource(id, { type: 'geojson', data }); else map.getSource(id).setData(data); };
    addSource(IDS.points, pointsGeoJson(interactiveRows(s.rows, s.selectedNoradId)));
    addSource(IDS.labelsSource, pointsGeoJson(labelRowsIn2dViewport(map, s.rows, s.selectedNoradId)));
    if (!map.getLayer(IDS.halo)) map.addLayer({ id: IDS.halo, type: 'circle', source: IDS.points, paint: { 'circle-radius': ['+', ['case', ['==', ['get', 'constellation'], 'STARLINK'], s.settings.orbitalOverlay.pointRadius * .65, s.settings.orbitalOverlay.pointRadius], s.settings.orbitalOverlay.glowRadius], 'circle-color': ['get', 'color'], 'circle-opacity': s.settings.orbitalOverlay.glowOpacity / 180, 'circle-blur': .75 } });
    if (!map.getLayer(IDS.points)) map.addLayer({ id: IDS.points, type: 'circle', source: IDS.points, paint: { 'circle-radius': ['case', ['==', ['get', 'noradId'], String(s.selectedNoradId || '')], s.settings.orbitalOverlay.pointRadius + 3, ['==', ['get', 'constellation'], 'STARLINK'], Math.max(2, s.settings.orbitalOverlay.pointRadius * .62), s.settings.orbitalOverlay.pointRadius], 'circle-color': ['get', 'color'], 'circle-stroke-color': '#475569', 'circle-stroke-width': 0, 'circle-stroke-opacity': 0, 'circle-opacity': 0.001 } });
    if (!map.getLayer(IDS.labels)) map.addLayer({ id: IDS.labels, type: 'symbol', source: IDS.labelsSource, minzoom: 0, layout: { 'text-field': ['get', 'label'], 'text-size': 10, 'text-offset': [0, 1.35], 'text-allow-overlap': false, 'text-ignore-placement': true, 'text-padding': 2 }, paint: { 'text-color': ['get', 'color'], 'text-halo-color': 'rgba(3,5,9,.94)', 'text-halo-width': 1.15 } });
    addSource(IDS.track, tracksGeoJson(orbitalTracksForState(s), correctedSceneNow(s), s.selectedNoradId));
    if (!map.getLayer(IDS.track)) map.addLayer({ id: IDS.track, type: 'line', source: IDS.track, paint: { 'line-color': ['get', 'color'], 'line-width': ['case', ['==', ['get', 'selected'], 1], 2.0, 1.15], 'line-opacity': ['case', ['==', ['get', 'selected'], 1], .94, .44] } });
    addSource(IDS.links, linksGeoJson(s.rows, s.observer));
    if (!map.getLayer(IDS.links)) map.addLayer({ id: IDS.links, type: 'line', source: IDS.links, paint: { 'line-color': ['get', 'color'], 'line-width': 1, 'line-opacity': .35 } });
    addSource(IDS.coverage, coverageGeoJson(s.rows, s.rows.find((row) => String(row.noradId) === String(s.selectedNoradId)), s.settings));
    if (!map.getLayer(IDS.coverageFill)) map.addLayer({ id: IDS.coverageFill, type: 'fill', source: IDS.coverage, paint: { 'fill-color': ['get', 'color'], 'fill-opacity': ['case', ['==', ['get', 'selected'], 1], Math.min(.34, s.settings.orbitalOverlay.coverageOpacity / 100 + .08), s.settings.orbitalOverlay.coverageOpacity / 100] } });
    if (!map.getLayer(IDS.coverageLine)) map.addLayer({ id: IDS.coverageLine, type: 'line', source: IDS.coverage, paint: { 'line-color': ['get', 'color'], 'line-width': ['case', ['==', ['get', 'selected'], 1], 2, 1], 'line-opacity': .76 } });
    addSource(IDS.grid, buildGraticule(map, s.settings));
    const pal = ASTRIS_GRATICULE_PALETTES[s.settings.graticule.palette];
    if (!map.getLayer(IDS.gridMinor)) map.addLayer({ id: IDS.gridMinor, type: 'line', source: IDS.grid, filter: ['!=', ['get', 'major'], true], paint: { 'line-color': pal.line, 'line-opacity': s.settings.graticule.opacity / 100, 'line-width': s.settings.graticule.lineWidth } });
    if (!map.getLayer(IDS.gridMajor)) map.addLayer({ id: IDS.gridMajor, type: 'line', source: IDS.grid, filter: ['==', ['get', 'major'], true], paint: { 'line-color': pal.major, 'line-opacity': s.settings.graticule.majorOpacity / 100, 'line-width': s.settings.graticule.majorLineWidth } });
    if (!map.getLayer(IDS.gridLabels)) map.addLayer({ id: IDS.gridLabels, type: 'symbol', source: IDS.grid, filter: ['has', 'label'], layout: { 'text-field': ['get', 'label'], 'text-size': s.settings.graticule.labelSize }, paint: { 'text-color': pal.labelColor, 'text-halo-color': 'rgba(2,4,8,.88)', 'text-halo-width': 1 } });

    if (!nativeRef.current) nativeRef.current = createAstrisOrbitalLayer({ map, onSelect: (row) => stateRef.current.onSelect?.(row) });
    if (!map.getLayer(nativeRef.current.id)) map.addLayer(nativeRef.current.layer);
    syncOperationalData(map);
    applyTerrain(map); applyBuildings(map); applyLabels(map); applySkyAndLight(map);
    ensureProjection(map);
  }

  function syncNativeOrbitalState(map, correctedNowMs = correctedSceneNow(stateRef.current)) {
    const s = stateRef.current;
    const globe = s.settings.globe === true;
    // Keep the full catalogue zero-copy for the GPU path. Only the bounded
    // interaction subset receives LOS decoration; cloning 10k+ Starlink rows
    // on every settings change was a major source of main-thread stalls.
    const interactive = interactiveRows(s.rows, s.selectedNoradId);
    const linkRows = decorateLosRows(interactive, s.observer, s.settings, s.selectedNoradId);
    nativeRevisionRef.current += 1;
    nativeRef.current?.setState({
      enabled: s.settings.orbitalOverlay.enabled && globe,
      globe,
      rows: s.rows,
      interactiveRows: interactive,
      linkRows,
      tracks: orbitalTracksForState(s),
      observer: s.observer,
      selectedNoradId: s.selectedNoradId,
      settings: s.settings.orbitalOverlay,
      constellationColors: { GPS: '#60a5fa', GLONASS: '#fb923c', GALILEO: '#34d399', BEIDOU: '#facc15', QZSS: '#c084fc', SBAS: '#f472b6', STARLINK: '#22d3ee', OTHER: '#94a3b8' },
      correctedNowMs,
      sceneAtMs: s.sceneAtMs,
      nextAtMs: s.nextAtMs,
      clockOffsetMs: s.clockOffsetMs,
      revision: nativeRevisionRef.current,
      cameraInteracting: cameraInteractingRef.current,
    });
  }

  function syncMotionData(map, visualRows = stateRef.current.rows, correctedNowMs = correctedSceneNow(stateRef.current)) {
    const s = stateRef.current;
    const globe = s.settings.globe;
    const selectedRow = visualRows.find((row) => String(row.noradId) === String(s.selectedNoradId));
    const decoratedRows = decorateLosRows(visualRows, s.observer, s.settings, s.selectedNoradId);
    const interactive = interactiveRows(decoratedRows, s.selectedNoradId);
    map.getSource(IDS.points)?.setData(pointsGeoJson(interactive));
    map.getSource(IDS.labelsSource)?.setData(pointsGeoJson(labelRowsIn2dViewport(map, decoratedRows, s.selectedNoradId)));
    map.getSource(IDS.track)?.setData(tracksGeoJson(orbitalTracksForState(s), correctedNowMs, s.selectedNoradId));
    map.getSource(IDS.links)?.setData(linksGeoJson(interactive, s.observer));
    try {
      map.setLayoutProperty(IDS.halo, 'visibility', 'none');
      map.setLayoutProperty(IDS.points, 'visibility', globe || !s.settings.orbitalOverlay.enabled ? 'none' : 'visible');
      map.setLayoutProperty(IDS.labels, 'visibility', globe || !s.settings.orbitalOverlay.enabled || !s.settings.orbitalOverlay.labels ? 'none' : 'visible');
      map.setLayoutProperty(IDS.track, 'visibility', globe || !s.settings.orbitalOverlay.enabled || !s.settings.orbitalOverlay.tracks ? 'none' : 'visible');
      map.setLayoutProperty(IDS.links, 'visibility', globe || !s.settings.orbitalOverlay.enabled || !s.settings.orbitalOverlay.observerLinks ? 'none' : 'visible');
      map.setPaintProperty(IDS.track, 'line-color', ['get', 'color']);
      map.setPaintProperty(IDS.track, 'line-width', ['case', ['==', ['get', 'selected'], 1], 2.0, 1.15]);
      map.setPaintProperty(IDS.track, 'line-opacity', ['case', ['==', ['get', 'selected'], 1], .94, .44]);
      map.setPaintProperty(IDS.labels, 'text-color', ['get', 'color']);
      map.setPaintProperty(IDS.points, 'circle-radius', 12);
      map.setPaintProperty(IDS.points, 'circle-stroke-width', 0);
      map.setPaintProperty(IDS.points, 'circle-opacity', 0.001);
      map.setPaintProperty(IDS.halo, 'circle-opacity', s.settings.orbitalOverlay.glowOpacity / 180);
    } catch { /* style transition */ }

    syncObserverMarker(map);
    return selectedRow;
  }

  function syncOperationalData(map, visualRows = stateRef.current.rows, correctedNowMs = correctedSceneNow(stateRef.current)) {
    const s = stateRef.current;
    syncNativeOrbitalState(map, correctedNowMs);
    const selectedRow = syncMotionData(map, visualRows, correctedNowMs);
    const interactive = interactiveRows(visualRows, s.selectedNoradId);
    map.getSource(IDS.coverage)?.setData(coverageGeoJson(interactive, selectedRow, s.settings));
    for (const id of [IDS.coverageFill, IDS.coverageLine]) {
      try {
        map.setLayoutProperty(id, 'visibility', s.settings.orbitalOverlay.enabled
          && (s.settings.orbitalOverlay.coverage || (s.settings.orbitalOverlay.selectedCoverage && selectedRow))
          ? 'visible' : 'none');
      } catch { /* noop */ }
    }
    for (const id of [IDS.gridMinor, IDS.gridMajor, IDS.gridLabels]) {
      try { map.setLayoutProperty(id, 'visibility', s.settings.grid ? 'visible' : 'none'); } catch { /* noop */ }
    }
  }

  function observerZoomScale(map) {
    const zoom = Number(map.getZoom?.() || 0);
    const globe = stateRef.current.settings.globe === true;
    if (globe) return Math.max(0.22, Math.min(1.0, 0.18 + Math.max(0, zoom) * 0.16));
    return Math.max(0.20, Math.min(1.12, 0.16 + Math.max(0, zoom) * 0.075));
  }

  function applyObserverMarkerScale(map) {
    const element = markerRef.current?.getElement?.();
    if (!element) return;
    const { settings: current } = stateRef.current;
    const scale = observerZoomScale(map);
    const core = Math.max(2.25, Number(current.observerCoreRadius || 9) * scale);
    const halo = Math.max(0, Number(current.observerHaloRadius || 24) * scale);
    element.style.setProperty('--observer-core', `${core.toFixed(2)}px`);
    element.style.setProperty('--observer-halo', `${halo.toFixed(2)}px`);
    element.style.setProperty('--observer-label-scale', String(Math.max(.62, Math.min(1, .58 + scale * .42))));
  }

  function syncObserverMarker(map) {
    const { observer: currentObserver } = stateRef.current;
    if (!Number.isFinite(Number(currentObserver?.lat)) || !Number.isFinite(Number(currentObserver?.lon))) {
      markerRef.current?.remove();
      markerRef.current = null;
      return;
    }
    if (!markerRef.current) {
      const element = document.createElement('div');
      element.className = 'observer-marker astris-observer-map-marker';
      element.innerHTML = '<span></span><b>ASTRIS</b>';
      markerRef.current = new maplibregl.Marker({ element, anchor: 'center' })
        .setLngLat([Number(currentObserver.lon), Number(currentObserver.lat)])
        .addTo(map);
    } else {
      markerRef.current.setLngLat([Number(currentObserver.lon), Number(currentObserver.lat)]);
    }
    applyObserverMarkerScale(map);
  }

  function applyLabels(map) {
    const s = stateRef.current;
    const scale = Math.max(0.25, Math.min(3, Number(s.settings.labelScale || 100) / 100));
    for (const layer of map.getStyle()?.layers || []) {
      if (layer.type !== 'symbol' || layer.id.startsWith('astris-')) continue;
      if (!labelDefaultsRef.current.has(layer.id)) {
        labelDefaultsRef.current.set(layer.id, {
          visibility: layer.layout?.visibility || 'visible',
          textSize: layer.layout?.['text-size'] ?? null,
        });
      }

      const original = labelDefaultsRef.current.get(layer.id);
      const targetVisibility = s.settings.labels ? original.visibility : 'none';
      const targetTextSize = s.settings.labels && original.textSize != null
        ? scaleMapLibreTextSize(original.textSize, scale)
        : null;
      const stateKey = `${targetVisibility}|${JSON.stringify(targetTextSize)}`;

      // scheduleStyleRestore() intentionally retries while remote styles settle.
      // Avoid re-writing identical layout properties on every retry; it reduces
      // style validation churn and WebGL-side work.
      if (labelAppliedRef.current.get(layer.id) === stateKey) continue;

      try {
        map.setLayoutProperty(layer.id, 'visibility', targetVisibility);
        if (targetTextSize != null) map.setLayoutProperty(layer.id, 'text-size', targetTextSize);
        labelAppliedRef.current.set(layer.id, stateKey);
      } catch {
        // Do not cache failures: a later style-restore pass may succeed once the
        // remote style has finished loading.
      }
    }
  }

  function applyBaseLabelsLive(map) {
    const current = stateRef.current.settings;
    const cfg = ASTRIS_MAP_LAYERS[current.layer] || ASTRIS_MAP_LAYERS.ofmDark;
    if (cfg.kind === 'raster') {
      const source = map.getSource?.('base');
      const selectedUrl = current.labels ? cfg.url : (cfg.urlNoLabels || cfg.url);
      if (source && typeof source.setTiles === 'function' && selectedUrl) {
        try { source.setTiles(expandTileTemplates(selectedUrl)); } catch { /* source may be settling */ }
      }
    } else {
      applyLabels(map);
    }
    try { map.triggerRepaint(); } catch { /* noop */ }
  }

  function applyOrbitalLabelsLive(map) {
    const current = stateRef.current;
    if (!map?.getStyle?.()) return;
    const enabled = current.settings.orbitalOverlay.enabled && current.settings.orbitalOverlay.labels;
    if (current.settings.globe === true) {
      syncNativeOrbitalState(map, correctedSceneNow(current));
      nativeRef.current?.refreshLabels?.();
    } else {
      if (!map.getSource(IDS.labelsSource) || !map.getLayer(IDS.labels)) {
        try { addOperationalLayers(map); } catch { /* style may still be settling */ }
      }
      const rowsForLabels = labelRowsIn2dViewport(map, current.rows, current.selectedNoradId);
      try { map.getSource(IDS.labelsSource)?.setData(pointsGeoJson(rowsForLabels)); } catch { /* noop */ }
      try {
        if (map.getLayer(IDS.labels)) map.setLayoutProperty(IDS.labels, 'visibility', enabled ? 'visible' : 'none');
      } catch { /* noop */ }
    }
    try { map.triggerRepaint(); } catch { /* noop */ }
  }

  function applyTerrain(map) {
    const s = stateRef.current.settings; if (s.terrain && !map.getSource(IDS.terrain)) try { map.addSource(IDS.terrain, { type: 'raster-dem', tiles: [TERRAIN_URL], tileSize: 256, encoding: 'terrarium', maxzoom: 15, attribution: 'Terrain Tiles © Mapzen / AWS Open Data' }); } catch { /* noop */ }
    if (s.terrain && map.getSource(IDS.terrain)) { try { map.setTerrain({ source: IDS.terrain, exaggeration: s.terrainExaggeration / 100 }); } catch { /* noop */ } if (!map.getLayer(IDS.hillshade)) try { map.addLayer({ id: IDS.hillshade, type: 'hillshade', source: IDS.terrain, paint: { 'hillshade-shadow-color': '#050507', 'hillshade-highlight-color': '#d8d5e5', 'hillshade-accent-color': '#6d5aa8', 'hillshade-exaggeration': .34 } }, firstSymbolLayerId(map)); } catch { /* noop */ } }
    else { try { map.setTerrain(null); } catch { /* noop */ } if (map.getLayer(IDS.hillshade)) try { map.removeLayer(IDS.hillshade); } catch { /* noop */ } }
  }

  function isNativeBuildingLayer(layer) {
    if (!layer || layer.id === IDS.buildings || layer.type !== 'fill-extrusion') return false;
    const sourceLayer = String(layer['source-layer'] || '').toLowerCase();
    const id = String(layer.id || '').toLowerCase();
    return sourceLayer === 'building' || id.includes('building');
  }

  function isNativeBuildingFootprintLayer(layer) {
    if (!layer || layer.id === IDS.buildings || layer.type !== 'fill') return false;
    const sourceLayer = String(layer['source-layer'] || '').toLowerCase();
    const id = String(layer.id || '').toLowerCase();
    return sourceLayer === 'building' || id.includes('building');
  }

  function usesNativeBuildingStyle() {
    return ASTRIS_MAP_LAYERS[stateRef.current.settings.layer]?.nativeBuildings === true;
  }

  function rememberAndSetVisibility(map, layer, visibility) {
    const registry = nativeBuildingVisibilityRef.current;
    if (!registry.has(layer.id)) registry.set(layer.id, layer.layout?.visibility || 'visible');
    try { map.setLayoutProperty(layer.id, 'visibility', visibility); } catch { /* style settling */ }
  }

  function restoreNativeBuildingLayers(map, { forceVisible = false } = {}) {
    const registry = nativeBuildingVisibilityRef.current;
    const layers = (map.getStyle()?.layers || []).filter(isNativeBuildingLayer);
    for (const layer of layers) {
      const visibility = forceVisible ? 'visible' : (registry.get(layer.id) || layer.layout?.visibility || 'visible');
      try { map.setLayoutProperty(layer.id, 'visibility', visibility); } catch { /* noop */ }
    }
    return layers;
  }

  function restoreNativeBuildingFootprints(map) {
    const registry = nativeBuildingVisibilityRef.current;
    for (const layer of (map.getStyle()?.layers || []).filter(isNativeBuildingFootprintLayer)) {
      try { map.setLayoutProperty(layer.id, 'visibility', registry.get(layer.id) || layer.layout?.visibility || 'visible'); } catch { /* noop */ }
    }
  }

  function suppressNativeBuildingLayers(map) {
    for (const layer of (map.getStyle()?.layers || []).filter(isNativeBuildingLayer)) rememberAndSetVisibility(map, layer, 'none');
  }

  function suppressNativeBuildingFootprints(map) {
    for (const layer of (map.getStyle()?.layers || []).filter(isNativeBuildingFootprintLayer)) rememberAndSetVisibility(map, layer, 'none');
  }

  function removeCustomBuildingOverlay(map) {
    if (map.getLayer(IDS.buildings)) try { map.removeLayer(IDS.buildings); } catch { /* noop */ }
    if (map.getSource(IDS.buildingsSource)) try { map.removeSource(IDS.buildingsSource); } catch { /* noop */ }
  }

  function applyBuildingDetailOcclusion(map) {
    const s = stateRef.current.settings;
    if (!map.getLayer(IDS.buildings)) return;
    const occlude = s.layer === 'ofmDark' && s.buildings === true && s.buildingOccludesMapDetails !== false;
    if (!occlude) {
      const beforeId = firstSymbolLayerId(map);
      if (beforeId && beforeId !== IDS.buildings) try { map.moveLayer(IDS.buildings, beforeId); } catch { /* noop */ }
      return;
    }
    const operationalIds = [IDS.coverageFill, IDS.coverageLine, nativeRef.current?.id, IDS.points, IDS.labels, IDS.track, IDS.links].filter(Boolean);
    const beforeId = (map.getStyle()?.layers || []).map((layer) => layer.id).find((id) => operationalIds.includes(id));
    try { if (beforeId) map.moveLayer(IDS.buildings, beforeId); else map.moveLayer(IDS.buildings); } catch { /* noop */ }
  }

  function ensureOperationalLayerOrder(map) {
    const desired = [IDS.coverageFill, IDS.coverageLine, nativeRef.current?.id].filter((id) => id && map.getLayer(id));
    for (const id of desired) try { map.moveLayer(id); } catch { /* noop */ }
  }

  function applyBuildings(map) {
    const s = stateRef.current.settings;
    if (usesNativeBuildingStyle()) {
      removeCustomBuildingOverlay(map);
      restoreNativeBuildingLayers(map, { forceVisible: true });
      restoreNativeBuildingFootprints(map);
      return;
    }

    // Mirrors the late IRMAS ownership model: every non-Standard style is
    // owned by the ASTRIS extrusion overlay. Native extrusion/footprint layers
    // are suppressed so OLED cannot show coincident geometry as "shadows".
    suppressNativeBuildingLayers(map);
    if (s.layer === 'ofmDark' && s.buildings) suppressNativeBuildingFootprints(map);
    else restoreNativeBuildingFootprints(map);

    if (!s.buildings) {
      removeCustomBuildingOverlay(map);
      restoreNativeBuildingFootprints(map);
      return;
    }

    if (!map.getSource(IDS.buildingsSource)) {
      try { map.addSource(IDS.buildingsSource, { type: 'vector', url: BUILDING_SOURCE_URL }); } catch { return; }
    }
    const scale = s.buildingScale / 100;
    const alpha = s.buildingOpacity / 100;
    const height = ['*', ['coalesce', ['get', 'render_height'], ['get', 'height'], 8], scale];
    const base = ['*', ['coalesce', ['get', 'render_min_height'], ['get', 'min_height'], 0], scale];
    if (!map.getLayer(IDS.buildings)) {
      try {
        map.addLayer({
          id: IDS.buildings,
          type: 'fill-extrusion',
          source: IDS.buildingsSource,
          'source-layer': 'building',
          minzoom: s.buildingMinZoom,
          paint: {
            'fill-extrusion-color': buildingColor(s),
            'fill-extrusion-height': height,
            'fill-extrusion-base': base,
            'fill-extrusion-opacity': alpha,
            'fill-extrusion-vertical-gradient': true,
          },
        }, firstSymbolLayerId(map));
      } catch { return; }
    } else {
      try {
        map.setLayerZoomRange(IDS.buildings, s.buildingMinZoom, 24);
        map.setPaintProperty(IDS.buildings, 'fill-extrusion-color', buildingColor(s));
        map.setPaintProperty(IDS.buildings, 'fill-extrusion-height', height);
        map.setPaintProperty(IDS.buildings, 'fill-extrusion-base', base);
        map.setPaintProperty(IDS.buildings, 'fill-extrusion-opacity', alpha);
      } catch { /* noop */ }
    }
    applyBuildingDetailOcclusion(map);
    ensureOperationalLayerOrder(map);
  }

  function enforceBuildingOwnership(map) {
    if (!map.getStyle?.()) return;
    applyBuildings(map);
  }

  function requestDesiredStyle(map, { force = false } = {}) {
    if (!map) return false;
    const desiredSettings = stateRef.current.settings;
    const desiredKey = styleSettingsKey(desiredSettings);
    if (!force && appliedStyleKeyRef.current === desiredKey) {
      pendingStyleSyncRef.current = false;
      return false;
    }
    if (typeof map.isStyleLoaded === 'function' && !map.isStyleLoaded()) {
      pendingStyleSyncRef.current = true;
      return false;
    }
    pendingStyleSyncRef.current = false;
    appliedStyleKeyRef.current = desiredKey;
    styleRevisionRef.current += 1;
    clearStyleRestoreTimers();
    nativeBuildingVisibilityRef.current.clear();
    labelDefaultsRef.current.clear();
    labelAppliedRef.current.clear();
    const desiredProjection = desiredSettings.globe ? 'globe' : 'mercator';
    map.setStyle(buildMapStyle(desiredSettings), {
      diff: false,
      transformStyle: (_previous, nextStyle) => ({ ...nextStyle, projection: { type: desiredProjection } }),
    });
    scheduleStyleRestore(map);
    return true;
  }

  function reconcileStyleAfterLoad(map) {
    const desiredKey = styleSettingsKey(stateRef.current.settings);
    if (pendingStyleSyncRef.current || desiredKey !== appliedStyleKeyRef.current) {
      return requestDesiredStyle(map);
    }
    return false;
  }

  function clearStyleRestoreTimers() {
    for (const timer of styleRestoreTimersRef.current) window.clearTimeout(timer);
    styleRestoreTimersRef.current = [];
  }

  function scheduleStyleRestore(map) {
    clearStyleRestoreTimers();
    const revision = styleRevisionRef.current;
    const delays = [0, 80, 220, 520, 1050, 1800];
    styleRestoreTimersRef.current = delays.map((delay) => window.setTimeout(() => {
      if (!mapRef.current || revision !== styleRevisionRef.current || !map.getStyle?.()) return;
      try {
        ensureProjection(map);
        enforceBuildingOwnership(map);
        applyTerrain(map);
        applyLabels(map);
        applySkyAndLight(map);
        addOperationalLayers(map);
        ensureOperationalLayerOrder(map);
      } catch { /* remote style may still be settling */ }
    }, delay));
  }

  function applySkyAndLight(map, date = new Date()) {
    const s = stateRef.current.settings;
    const synthetic = s.globe && s.orbitalOverlay.enabled && s.orbitalOverlay.spaceBackgroundMode !== 'off';
    syncSpaceBackgroundCamera(map, date);
    try {
      map.setSky(s.globe && s.atmosphere ? {
        'sky-color': synthetic ? '#020204' : '#010104',
        'sky-horizon-blend': .18,
        'horizon-color': synthetic ? '#090b12' : '#24243b',
        'horizon-fog-blend': .14,
        'fog-color': synthetic ? '#020204' : '#070812',
        'fog-ground-blend': synthetic ? .18 : .20,
        'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 3, .45, 6, 0],
      } : {
        'sky-color': '#000', 'horizon-color': '#000', 'fog-color': '#000',
        'sky-horizon-blend': 0, 'horizon-fog-blend': 0, 'fog-ground-blend': 0, 'atmosphere-blend': 0,
      });
    } catch { /* MapLibre style may be settling */ }
    const light = s.dayNight && s.globe
      ? { anchor: 'map', color: '#fff8ed', intensity: .46, position: solarMapLightPosition(date, 1.5) }
      : (LIGHTS[s.buildingLighting] || LIGHTS.soft);
    try { map.setLight(light); } catch { /* noop */ }
  }

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return undefined;
    const initial = stateRef.current.settings;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: buildMapStyle(initial),
      center: [20, 28],
      zoom: initial.globe ? GLOBE_OVERVIEW_ZOOM : 1.3,
      pitch: initial.buildings || initial.terrain ? initial.pitch3d : 0,
      bearing: 0,
      rollEnabled: true,
      aroundCenter: false,
      scrollZoom: true,
      touchZoomRotate: true,
      touchPitch: true,
      doubleClickZoom: true,
      crossSourceCollisions: false,
      attributionControl: false,
      canvasContextAttributes: {
        antialias: false,
        alpha: true,
        preserveDrawingBuffer: false,
        powerPreference: 'high-performance',
      },
    });
    mapRef.current = map;
    // Third-party styles occasionally reference sprite ids that are absent in
    // a given theme. Leaving those requests unresolved drives MapLibre through
    // its error-texture path repeatedly and can flood Chrome's WebGL console.
    // Circle sprites get a local neutral disc; all other unresolved ids get a
    // transparent 2x2 fallback so the base map stays usable without inventing
    // a wrong pictogram.
    const resolveMissingStyleImage = (id) => {
      const imageId = String(id || '');
      if (!imageId || map.hasImage?.(imageId)) return false;
      if (/^circle-\d+$/.test(imageId)) {
        const requested = Math.max(6, Math.min(24, Number(imageId.split('-').pop()) || 11));
        const size = Math.max(16, requested * 2);
        const radius = requested * 0.5;
        const center = size * 0.5;
        const data = new Uint8Array(size * size * 4);
        for (let y = 0; y < size; y += 1) {
          for (let x = 0; x < size; x += 1) {
            const distance = Math.hypot(x + 0.5 - center, y + 0.5 - center);
            if (distance > radius) continue;
            const offset = (y * size + x) * 4;
            data[offset] = 180;
            data[offset + 1] = 188;
            data[offset + 2] = 202;
            data[offset + 3] = 210;
          }
        }
        try {
          map.addImage(imageId, { width: size, height: size, data }, { pixelRatio: 2 });
          return true;
        } catch {
          return false;
        }
      }
      try {
        map.addImage(imageId, {
          width: 2,
          height: 2,
          data: new Uint8Array(2 * 2 * 4),
        }, { pixelRatio: 1 });
        return true;
      } catch {
        return false;
      }
    };
    if (typeof map.setMissingStyleImageResolver === 'function') {
      map.setMissingStyleImageResolver((id) => { resolveMissingStyleImage(id); });
    } else {
      map.on('styleimagemissing', ({ id }) => { resolveMissingStyleImage(id); });
    }
    appliedStyleKeyRef.current = styleSettingsKey(initial);
    pendingStyleSyncRef.current = false;
    // Map controls: navigation + metric scale + the compact attribution/info
    // control used in ASTRIS v0.1.4. No Fullscreen control is created.
    map.addControl(new maplibregl.NavigationControl({
      visualizePitch: true,
      visualizeRoll: true,
      showCompass: true,
      showZoom: true,
    }), 'top-left');
    map.addControl(new maplibregl.ScaleControl({ maxWidth: 110, unit: 'metric' }), 'bottom-left');
    // v0.1.4 parity: compact native attribution control. The small ⓘ button
    // expands the map/source attribution without a custom ASTRIS popover.
    map.addControl(new maplibregl.AttributionControl({ compact: true }), 'bottom-left');

    syncProjectionZoomInteractions(map, initial.globe ? 'globe' : 'mercator');
    const ready = () => {
      if (reconcileStyleAfterLoad(map)) return;
      labelDefaultsRef.current.clear();
      labelAppliedRef.current.clear();
      try { addOperationalLayers(map); } catch (error) { console.error('[ASTRIS map] overlay restore failed', error); }
      syncSpaceBackgroundCamera(map);
      scheduleStyleRestore(map);
      syncObserverMarker(map);
      emitRuntime(map);
    };
    const onMoveStart = () => {
      cameraInteractingRef.current = true;
      nativeRef.current?.setCameraInteracting?.(true);
      syncSpaceBackgroundCamera(map);
    };
    const onMapMotion = () => {
      syncSpaceBackgroundCamera(map);
      applyObserverMarkerScale(map);
    };
    const onMoveEnd = () => {
      cameraInteractingRef.current = false;
      nativeRef.current?.setCameraInteracting?.(false);
      nativeRef.current?.invalidateProjection?.();
      syncSpaceBackgroundCamera(map);
      applyObserverMarkerScale(map);
      if (map.getSource(IDS.grid)) map.getSource(IDS.grid).setData(buildGraticule(map, stateRef.current.settings));
      if (stateRef.current.settings.globe !== true) {
        refresh2dInteractiveRows(map);
        syncOperationalData(map);
      }
      emitRuntime(map);
    };
    const onStyleSettling = () => {
      if (typeof map.isStyleLoaded === 'function' && map.isStyleLoaded() && reconcileStyleAfterLoad(map)) return;
      ensureProjection(map);
      syncSpaceBackgroundCamera(map);
      try { enforceBuildingOwnership(map); } catch { /* style settling */ }
      if (nativeRef.current && !map.getLayer(nativeRef.current.id)) {
        try { map.addLayer(nativeRef.current.layer); } catch { /* style settling */ }
      }
    };
    const onIdle = () => {
      onStyleSettling();
      ensureOperationalLayerOrder(map);
    };
    map.on('load', ready);
    map.on('style.load', ready);
    map.on('styledata', onStyleSettling);
    map.on('idle', onIdle);
    map.on('movestart', onMoveStart);
    map.on('move', onMapMotion);
    map.on('rotate', onMapMotion);
    map.on('pitch', onMapMotion);
    map.on('roll', onMapMotion);
    map.on('moveend', onMoveEnd);
    map.on('zoom', onMapMotion);
    map.on('click', IDS.points, (event) => {
      const id = event.features?.[0]?.properties?.noradId;
      const row = stateRef.current.rows.find((item) => String(item.noradId) === String(id));
      if (row) stateRef.current.onSelect?.(row);
    });
    map.on('mouseenter', IDS.points, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', IDS.points, () => { map.getCanvas().style.cursor = ''; });
    const solarTimer = window.setInterval(() => {
      const currentMap = mapRef.current;
      if (currentMap && (typeof currentMap.isStyleLoaded !== 'function' || currentMap.isStyleLoaded())) applySkyAndLight(currentMap);
    }, 15_000);
    return () => {
      window.clearInterval(solarTimer);
      if (syncRafRef.current) window.cancelAnimationFrame(syncRafRef.current);
      if (motionRef.current.raf) window.cancelAnimationFrame(motionRef.current.raf);
      clearStyleRestoreTimers();
      markerRef.current?.remove();
      nativeRef.current?.destroy?.();
      map.remove();
      mapRef.current = null;
      nativeRef.current = null;
    };
  }, []);

  // Label toggles are live UI controls, not style lifecycle events. Apply them
  // immediately and replay once after style.load only when MapLibre is in the
  // middle of a style swap. This avoids the old "toggle -> F5" behaviour.
  useLayoutEffect(() => {
    const map = mapRef.current;
    if (!map) return undefined;
    let cancelled = false;
    const apply = () => {
      if (cancelled || mapRef.current !== map) return;
      if (typeof map.isStyleLoaded === 'function' && !map.isStyleLoaded()) return;
      applyBaseLabelsLive(map);
    };
    if (typeof map.isStyleLoaded !== 'function' || map.isStyleLoaded()) apply();
    else map.once('style.load', apply);
    return () => {
      cancelled = true;
      try { map.off('style.load', apply); } catch { /* noop */ }
    };
  }, [settings.labels, settings.layer]);

  useLayoutEffect(() => {
    const map = mapRef.current;
    if (!map) return undefined;
    let cancelled = false;
    const apply = () => {
      if (cancelled || mapRef.current !== map) return;
      if (typeof map.isStyleLoaded === 'function' && !map.isStyleLoaded()) return;
      applyOrbitalLabelsLive(map);
    };
    if (typeof map.isStyleLoaded !== 'function' || map.isStyleLoaded()) apply();
    else map.once('style.load', apply);
    return () => {
      cancelled = true;
      try { map.off('style.load', apply); } catch { /* noop */ }
    };
  }, [settings.orbitalOverlay.enabled, settings.orbitalOverlay.labels, settings.globe]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return undefined;
    const styleReady = typeof map.isStyleLoaded !== 'function' || map.isStyleLoaded();
    if (!styleReady) return undefined;
    if (syncRafRef.current) window.cancelAnimationFrame(syncRafRef.current);
    syncRafRef.current = window.requestAnimationFrame(() => {
      syncRafRef.current = 0;
      const currentMap = mapRef.current;
      if (!currentMap) return;
      if (typeof currentMap.isStyleLoaded === 'function' && !currentMap.isStyleLoaded()) return;
      const currentState = stateRef.current;
      const nowMs = correctedSceneNow(currentState);
      if (visualRowsRef.current.sourceAtMs !== currentState.sceneAtMs) {
        visualRowsRef.current = { byId: new Map(), lastAtMs: 0, sourceAtMs: currentState.sceneAtMs };
      }
      if (currentState.settings.globe !== true) {
        // This effect already runs when the rendered row array / filters change;
        // refresh the viewport shortlist once here instead of rescanning the
        // full Starlink catalogue on every animation frame.
        refresh2dInteractiveRows(currentMap, currentState);
      }
      const cpuRows = currentState.settings.globe === true
        ? interactiveRows(currentState.rows, currentState.selectedNoradId)
        : (interactive2dRef.current.rows.length ? interactive2dRef.current.rows : interactiveRows(currentState.rows, currentState.selectedNoradId));
      const visual = interpolatedSceneRows(cpuRows, currentState, nowMs);
      visualRowsRef.current = { lastAtMs: nowMs, sourceAtMs: currentState.sceneAtMs };
      syncOperationalData(currentMap, visual.rows, nowMs);
      applyObserverMarkerScale(currentMap);
    });
    return () => {
      if (syncRafRef.current) window.cancelAnimationFrame(syncRafRef.current);
      syncRafRef.current = 0;
    };
  }, [rows, tracks, track, trackReferenceFrame, trackReferenceAtMs, sceneAtMs, nextAtMs, clockOffsetMs,
    observer?.lat, observer?.lon, observer?.altM, selectedNoradId, settings.orbitalOverlay]);

  // Globe markers are interpolated in the custom WebGL vertex shader. 2D
  // keeps a bounded GeoJSON interaction layer and updates only that small set.
  useEffect(() => {
    let cancelled = false;
    const tick = (perfNow) => {
      if (cancelled) return;
      const map = mapRef.current;
      const currentState = stateRef.current;
      const rowCount = currentState.rows?.length || 0;
      const globe = currentState.settings.globe === true;
      const effectiveFps = effectiveOrbitalFps(rowCount, currentState.settings.orbitalOverlay?.renderFps || 60, globe);
      const intervalMs = 1000 / Math.max(1, effectiveFps);
      const motion = motionRef.current;
      const styleReady = map && (typeof map.isStyleLoaded !== 'function' || map.isStyleLoaded());
      if (styleReady && currentState.settings.orbitalOverlay?.enabled && rowCount > 0
          && !cameraInteractingRef.current && perfNow - motion.lastFrameAt >= intervalMs) {
        const nowMs = correctedSceneNow(currentState);
        motion.lastFrameAt = perfNow;
        let ratio = 0;
        if (globe) {
          // Marker geometry stays resident in GPU. Advance the native clock
          // independently so cached ECI orbit lines rotate with Earth while
          // u_interp moves the marker between SGP4 keyframes.
          nativeRef.current?.updateClock?.(nowMs);
          const fromMs = Number(currentState.sceneAtMs);
          const toMs = Number(currentState.nextAtMs);
          ratio = Number.isFinite(fromMs) && Number.isFinite(toMs) && toMs > fromMs
            ? clamp01((nowMs - fromMs) / (toMs - fromMs)) : 0;
        } else {
          if (interactive2dRef.current.sceneAtMs !== currentState.sceneAtMs
              || interactive2dRef.current.selectedNoradId !== String(currentState.selectedNoradId ?? '')
              || !interactive2dRef.current.rows.length) {
            refresh2dInteractiveRows(map, currentState);
          }
          const cpuRows = interactive2dRef.current.rows.length
            ? interactive2dRef.current.rows
            : interactiveRows(currentState.rows, currentState.selectedNoradId);
          const visual = interpolatedSceneRows(cpuRows, currentState, nowMs);
          ratio = visual.ratio;
          syncMotionData(map, visual.rows, nowMs);
        }
        motion.frames += 1;
        if (perfNow - motion.fpsWindowAt >= 1000) {
          motion.renderedFps = Math.round(motion.frames * 1000 / Math.max(1, perfNow - motion.fpsWindowAt));
          motion.frames = 0;
          motion.fpsWindowAt = perfNow;
          emitRuntime(map, { orbitalEffectiveFps: effectiveFps, orbitalInterpolationRatio: ratio });
        }
      }
      motion.raf = window.requestAnimationFrame(tick);
    };
    motionRef.current.raf = window.requestAnimationFrame(tick);
    return () => {
      cancelled = true;
      if (motionRef.current.raf) window.cancelAnimationFrame(motionRef.current.raf);
      motionRef.current.raf = 0;
    };
  }, []);

  const prevStyleRef = useRef({ layer: settings.layer });
  useLayoutEffect(() => {
    const map = mapRef.current;
    if (!map) return;
    const needsStyle = prevStyleRef.current.layer !== settings.layer;
    prevStyleRef.current = { layer: settings.layer };

    if (needsStyle) {
      // Do not drop a second layer/label change while the first style is still
      // loading. requestDesiredStyle queues the latest desired state and
      // style.load replays it deterministically.
      requestDesiredStyle(map);
      return;
    }
    if (typeof map.isStyleLoaded === 'function' && !map.isStyleLoaded()) {
      pendingStyleSyncRef.current = pendingStyleSyncRef.current
        || styleSettingsKey(settings) !== appliedStyleKeyRef.current;
      return;
    }

    ensureProjection(map);
    applyTerrain(map);
    applyBuildings(map);
    applyBaseLabelsLive(map);
    applySkyAndLight(map);
    if (settings.buildings || settings.terrain) {
      try { map.setPitch(settings.pitch3d); } catch { /* noop */ }
    }
    const pal = ASTRIS_GRATICULE_PALETTES[settings.graticule.palette] || ASTRIS_GRATICULE_PALETTES.neutral;
    if (map.getSource(IDS.grid)) map.getSource(IDS.grid).setData(buildGraticule(map, settings));
    try {
      map.setPaintProperty(IDS.gridMinor, 'line-color', pal.line);
      map.setPaintProperty(IDS.gridMinor, 'line-opacity', settings.graticule.opacity / 100);
      map.setPaintProperty(IDS.gridMinor, 'line-width', settings.graticule.lineWidth);
      map.setPaintProperty(IDS.gridMajor, 'line-color', pal.major);
      map.setPaintProperty(IDS.gridMajor, 'line-opacity', settings.graticule.majorOpacity / 100);
      map.setPaintProperty(IDS.gridMajor, 'line-width', settings.graticule.majorLineWidth);
      map.setLayoutProperty(IDS.gridLabels, 'text-size', settings.graticule.labelSize);
      map.setPaintProperty(IDS.gridLabels, 'text-color', pal.labelColor);
      if (map.getLayer('base')) map.setPaintProperty('base', 'raster-brightness-max', settings.brightness / 100);
    } catch { /* operational layers may be restoring */ }
    syncOperationalData(map, stateRef.current.rows, correctedSceneNow(stateRef.current));
    applyObserverMarkerScale(map);
    ensureOperationalLayerOrder(map);
    emitRuntime(map);
  }, [settings.layer, settings.globe, settings.labels, settings.labelScale, settings.brightness, settings.grid, settings.graticule,
    settings.buildings, settings.buildingScale, settings.buildingOpacity, settings.buildingMinZoom,
    settings.buildingPalette, settings.buildingLighting, settings.buildingOccludesMapDetails,
    settings.observerCoreRadius, settings.observerHaloRadius, settings.terrain, settings.terrainExaggeration,
    settings.pitch3d, settings.atmosphere, settings.dayNight]);

  useImperativeHandle(ref, () => ({
    centerOnObserver() {
      const map = mapRef.current; const o = stateRef.current.observer;
      if (!map || !Number.isFinite(Number(o?.lat)) || !Number.isFinite(Number(o?.lon))) return;
      map.easeTo({ center: [Number(o.lon), Number(o.lat)], zoom: Math.max(map.getZoom(), stateRef.current.settings.globe ? 2.5 : 8), duration: 420 });
    },
    resetView() {
      const map = mapRef.current;
      if (!map) return;
      applyViewPreset(map, stateRef.current.settings.globe ? 'globe' : (stateRef.current.settings.buildings ? 'city' : 'flat'));
    },
    applyViewPreset(presetKey) { applyViewPreset(mapRef.current, presetKey); },
    show3d() {
      const map = mapRef.current;
      if (!map) return;
      ensureProjection(map);
      enforceBuildingOwnership(map);
      map.easeTo({ zoom: Math.max(map.getZoom(), stateRef.current.settings.buildingMinZoom + .4), pitch: Math.max(55, stateRef.current.settings.pitch3d), duration: 420 });
      window.requestAnimationFrame(() => { enforceBuildingOwnership(map); ensureOperationalLayerOrder(map); });
    },
    ensureBuildingsVisible() {
      const map = mapRef.current;
      if (!map?.getStyle?.()) return;
      const current = stateRef.current.settings;
      try {
        if (ASTRIS_MAP_LAYERS[current.layer]?.nativeBuildings === true) {
          removeCustomBuildingOverlay(map);
          restoreNativeBuildingLayers(map, { forceVisible: true });
          restoreNativeBuildingFootprints(map);
        } else {
          enforceBuildingOwnership(map);
        }
        if (!current.globe) {
          map.easeTo({ zoom: Math.max(map.getZoom(), current.buildingMinZoom + .4), pitch: Math.max(55, current.pitch3d), duration: 360 });
        }
        scheduleStyleRestore(map);
        ensureOperationalLayerOrder(map);
      } catch { /* style may still be settling */ }
    },
    retryBuildings() {
      const map = mapRef.current;
      if (!map) return;
      styleRevisionRef.current += 1;
      clearStyleRestoreTimers();
      nativeBuildingVisibilityRef.current.clear();
      try { removeCustomBuildingOverlay(map); } catch { /* noop */ }
      try { enforceBuildingOwnership(map); } catch { /* style settling */ }
      scheduleStyleRestore(map);
      window.setTimeout(() => {
        if (!mapRef.current) return;
        try { enforceBuildingOwnership(mapRef.current); ensureOperationalLayerOrder(mapRef.current); } catch { /* noop */ }
      }, 240);
    },
    getViewState() {
      const map = mapRef.current;
      if (!map) return null;
      const center = map.getCenter();
      return {
        center: [center.lng, center.lat],
        zoom: map.getZoom(),
        bearing: map.getBearing(),
        pitch: map.getPitch(),
        projection: map.getProjection?.()?.type || 'mercator',
      };
    },
    applyViewState(view) {
      const map = mapRef.current;
      if (!map || !view) return;
      const projection = view.projection === 'globe' ? 'globe' : 'mercator';
      try { if (map.getProjection?.()?.type !== projection) map.setProjection({ type: projection }); } catch { /* projection may be settling */ }
      const center = Array.isArray(view.center) && view.center.length >= 2 ? view.center : [map.getCenter().lng, map.getCenter().lat];
      try { map.jumpTo({ center, zoom: Number(view.zoom), bearing: Number(view.bearing || 0), pitch: Number(view.pitch || 0) }); } catch { /* invalid profile view ignored */ }
      nativeRef.current?.invalidateProjection?.();
      window.requestAnimationFrame(() => { map.resize(); emitRuntime(map); });
    },
    resize() { mapRef.current?.resize(); },
  }), []);

  return <div ref={containerRef} className={`astris-map-native-canvas orbital-map ${settings.globe && settings.orbitalOverlay.enabled && settings.orbitalOverlay.spaceBackgroundMode !== 'off' ? 'is-space-orbit-bg is-space-synthetic' : ''}`} style={{ '--map-brightness': settings.brightness / 100 }} />;
});

export default OrbitalMap;
