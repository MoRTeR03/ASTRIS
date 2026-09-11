import { useEffect, useState } from 'react';

export const ASTRIS_MAP_SETTINGS_KEY = 'astris_map_settings_v4';
export const ASTRIS_MAP_SETTINGS_LEGACY_KEYS = Object.freeze(['astris_map_settings_v3', 'astris_map_settings_v2', 'astris_map_settings_v1']);

export const ASTRIS_GRATICULE_STEPS = Object.freeze([30, 10, 5, 2, 1, 0.5, 0.2, 0.1, 0.05, 0.02, 0.01]);
export const ASTRIS_GRATICULE_PALETTES = Object.freeze({
  neutral: { label: 'Нейтральна', line: '#d4d4d8', major: '#fafafa', labelColor: '#e4e4e7' },
  violet: { label: 'Фіолетова', line: '#8b5cf6', major: '#c4b5fd', labelColor: '#ddd6fe' },
  cyan: { label: 'Блакитна', line: '#22d3ee', major: '#a5f3fc', labelColor: '#cffafe' },
  amber: { label: 'Бурштинова', line: '#f59e0b', major: '#fde68a', labelColor: '#fef3c7' },
});

export const ASTRIS_MAP_LAYERS = Object.freeze({
  ofmDark: { label: 'OLED Vector', short: 'OLED', engine: 'OpenFreeMap Dark', kind: 'style', styleUrl: 'https://tiles.openfreemap.org/styles/dark', attribution: '© OpenMapTiles © OpenStreetMap contributors', supportsBuildings: true, preview: '/map-previews/ofmDark.png', family: 'vector' },
  ofmLiberty: { label: 'Vector Standard', short: 'STD', engine: 'OpenFreeMap Liberty', kind: 'style', styleUrl: 'https://tiles.openfreemap.org/styles/liberty', attribution: '© OpenMapTiles © OpenStreetMap contributors', supportsBuildings: true, nativeBuildings: true, preview: '/map-previews/ofmLiberty.png', family: 'vector' },
  ofmBright: { label: 'Vector Bright', short: 'BRIGHT', engine: 'OpenFreeMap Bright', kind: 'style', styleUrl: 'https://tiles.openfreemap.org/styles/bright', attribution: '© OpenMapTiles © OpenStreetMap contributors', supportsBuildings: true, preview: '/map-previews/ofmBright.png', family: 'vector' },
  ofmPositron: { label: 'Vector Minimal', short: 'MIN', engine: 'OpenFreeMap Positron', kind: 'style', styleUrl: 'https://tiles.openfreemap.org/styles/positron', attribution: '© OpenMapTiles © OpenStreetMap contributors', supportsBuildings: true, preview: '/map-previews/ofmPositron.png', family: 'vector' },
  esriSat: { label: 'Satellite', short: 'SAT', engine: 'Esri World Imagery', kind: 'raster', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', attribution: 'Tiles © Esri', maxZoom: 19, supportsBuildings: true, preview: '/map-previews/esriSat.png', family: 'imagery' },
  esriTopo: { label: 'Topographic', short: 'TOPO', engine: 'Esri World Topographic', kind: 'raster', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Topo_Map/MapServer/tile/{z}/{y}/{x}', attribution: 'Tiles © Esri', maxZoom: 19, preview: '/map-previews/esriTopo.png', family: 'terrain' },
  osm: { label: 'OpenStreetMap', short: 'OSM', engine: 'OSM Raster', kind: 'raster', url: 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png', attribution: '© OpenStreetMap contributors', maxZoom: 19, preview: '/map-previews/osm.png', family: 'street' },
  cartoDark: { label: 'Carto Dark', short: 'DARK', engine: 'CARTO Dark Matter', kind: 'raster', url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', urlNoLabels: 'https://{s}.basemaps.cartocdn.com/dark_nolabels/{z}/{x}/{y}{r}.png', attribution: '© OpenStreetMap contributors © CARTO', maxZoom: 19, preview: '/map-previews/cartoDark.png', family: 'street' },
  cartoLight: { label: 'Carto Light', short: 'LIGHT', engine: 'CARTO Positron', kind: 'raster', url: 'https://{s}.basemaps.cartocdn.com/light_all/{z}/{x}/{y}{r}.png', urlNoLabels: 'https://{s}.basemaps.cartocdn.com/light_nolabels/{z}/{x}/{y}{r}.png', attribution: '© OpenStreetMap contributors © CARTO', maxZoom: 19, preview: '/map-previews/cartoLight.png', family: 'street' },
  topo: { label: 'OpenTopoMap', short: 'OTM', engine: 'OpenTopoMap', kind: 'raster', url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', attribution: 'Map data © OpenStreetMap contributors, SRTM | Style © OpenTopoMap', maxZoom: 17, preview: '/map-previews/topo.png', family: 'terrain' },
});

export function defaultGraticuleSettings() {
  return { mode: 'auto', step: 1, majorEvery: 5, labels: true, opacity: 34, majorOpacity: 62, lineWidth: 1, majorLineWidth: 1.4, labelSize: 11, palette: 'neutral' };
}

/** Late-IRMAS orbital defaults, adapted only where ASTRIS legitimately needs a larger catalogue. */
export function defaultOrbitalOverlaySettings() {
  return {
    enabled: true,
    mode: 'all',
    labels: true,
    tracks: true,
    observerLinks: true,
    observerLinkMode: 'physical',
    spaceBackground: true,
    spaceBackgroundMode: 'synthetic',
    coverage: false,
    selectedCoverage: true,
    coverageMinElevationDeg: 5,
    coverageOpacity: 18,
    coverageLiftKm: 0.05,
    renderMode: 'altitude',
    altitudeScale: 50,
    renderFps: 60,
    interpolationStepMs: 500,
    smoothingMs: 60,
    horizonDeg: 0,
    opacity: 94,
    pointRadius: 7,
    signalRingWidth: 3,
    glowRadius: 6,
    glowOpacity: 18,
    refreshMs: 1000,
    tracksRefreshMs: 60_000,
    trackMode: 'full',
    trackMinutes: 720,
    trackStepMinutes: 4,
    trackLimit: 192,
    // Unlike IRMAS (GNSS only), ASTRIS can render the Starlink catalogue.
    limit: 12000,
    selected: { GPS: true, GLONASS: true, GALILEO: true, BEIDOU: true, QZSS: true, SBAS: true, STARLINK: false },
  };
}

export function defaultMapPanelSections() {
  return { observer: true, search: true, view: true, base: true, display: true, orbital: true };
}

export function defaultMapSettings() {
  return {
    layer: 'ofmDark',
    brightness: 92,
    labelScale: 112,
    labels: true,
    grid: false,
    graticule: defaultGraticuleSettings(),
    cursor: true,
    dim: false,
    buildings: false,
    buildingScale: 100,
    buildingOpacity: 92,
    buildingMinZoom: 14.6,
    buildingPalette: 'adaptive',
    buildingLighting: 'soft',
    buildingAutoZoom: true,
    buildingOccludesMapDetails: true,
    observerCoreRadius: 9,
    observerHaloRadius: 24,
    globe: true,
    atmosphere: true,
    dayNight: true,
    terrain: false,
    terrainExaggeration: 115,
    pitch3d: 56,
    orbitalOverlay: defaultOrbitalOverlaySettings(),
    panelOpen: true,
    panelSections: defaultMapPanelSections(),
  };
}

export const ASTRIS_MAP_VIEW_PRESETS = Object.freeze({
  flat: { label: '2D', description: 'Плоска операторська карта', patch: { globe: false, buildings: false, terrain: false, pitch3d: 0 } },
  city: { label: '3D Місто', description: 'Векторна карта з обʼємними будівлями', patch: { layer: 'ofmDark', globe: false, buildings: true, terrain: false, pitch3d: 56 } },
  globe: { label: 'Глобус', description: 'Сферична проєкція Землі', patch: { layer: 'ofmDark', globe: true, buildings: false, terrain: false, pitch3d: 0 } },
  orbital: { label: 'Орбіти', description: 'GNSS + Starlink у globe-режимі', patch: { layer: 'ofmDark', globe: true, buildings: false, terrain: false, pitch3d: 0, orbitalOverlay: { ...defaultOrbitalOverlaySettings(), enabled: true } } },
  satellite3d: { label: 'Satellite 3D', description: 'Супутникова карта, рельєф і будівлі', patch: { layer: 'esriSat', globe: false, buildings: true, terrain: true, pitch3d: 58 } },
});

function clampInt(value, fallback, min, max) {
  const n = Number.parseInt(value ?? fallback, 10);
  return Math.max(min, Math.min(max, Number.isFinite(n) ? n : fallback));
}
function clampNumber(value, fallback, min, max) {
  const n = Number(value ?? fallback);
  return Math.max(min, Math.min(max, Number.isFinite(n) ? n : fallback));
}

export function normalizeMapSettings(candidate) {
  const base = defaultMapSettings();
  const next = { ...base, ...(candidate || {}) };
  if (!ASTRIS_MAP_LAYERS[next.layer]) next.layer = base.layer;
  next.brightness = clampInt(next.brightness, base.brightness, 45, 125);
  next.labelScale = clampInt(next.labelScale, base.labelScale, 80, 180);
  next.labels = next.labels !== false;
  next.grid = next.grid === true;
  next.cursor = next.cursor !== false;
  next.dim = next.dim === true;
  next.globe = next.globe === true;
  next.buildings = ASTRIS_MAP_LAYERS[next.layer]?.nativeBuildings === true ? true : next.buildings === true;
  next.atmosphere = next.atmosphere !== false;
  next.dayNight = next.dayNight !== false;
  next.terrain = next.terrain === true;
  next.buildingScale = clampInt(next.buildingScale, base.buildingScale, 50, 180);
  next.buildingOpacity = clampInt(next.buildingOpacity, base.buildingOpacity, 35, 100);
  next.buildingMinZoom = clampNumber(next.buildingMinZoom, base.buildingMinZoom, 13, 18);
  next.buildingPalette = ['adaptive', 'standard', 'oled', 'cool', 'warm'].includes(next.buildingPalette) ? next.buildingPalette : base.buildingPalette;
  next.buildingLighting = ['soft', 'balanced', 'contrast'].includes(next.buildingLighting) ? next.buildingLighting : base.buildingLighting;
  next.buildingAutoZoom = next.buildingAutoZoom !== false;
  next.buildingOccludesMapDetails = next.buildingOccludesMapDetails !== false;
  next.observerCoreRadius = clampInt(next.observerCoreRadius, base.observerCoreRadius, 4, 30);
  next.observerHaloRadius = clampInt(next.observerHaloRadius, base.observerHaloRadius, 0, 64);
  next.terrainExaggeration = clampInt(next.terrainExaggeration, base.terrainExaggeration, 50, 250);
  next.pitch3d = clampInt(next.pitch3d, base.pitch3d, 0, 78);
  next.panelOpen = next.panelOpen !== false;
  const sections = defaultMapPanelSections();
  next.panelSections = Object.fromEntries(Object.keys(sections).map((key) => [key, next.panelSections?.[key] !== false]));

  const g = { ...defaultGraticuleSettings(), ...(next.graticule || {}) };
  g.mode = g.mode === 'manual' ? 'manual' : 'auto';
  g.step = ASTRIS_GRATICULE_STEPS.includes(Number(g.step)) ? Number(g.step) : 1;
  g.majorEvery = clampInt(g.majorEvery, 5, 2, 10);
  g.labels = g.labels !== false;
  g.opacity = clampInt(g.opacity, 34, 8, 100);
  g.majorOpacity = clampInt(g.majorOpacity, 62, 15, 100);
  g.lineWidth = clampNumber(g.lineWidth, 1, .5, 3);
  g.majorLineWidth = clampNumber(g.majorLineWidth, 1.4, .8, 4);
  g.labelSize = clampInt(g.labelSize, 11, 8, 18);
  if (!ASTRIS_GRATICULE_PALETTES[g.palette]) g.palette = 'neutral';
  next.graticule = g;

  const orbitalBase = defaultOrbitalOverlaySettings();
  const o = { ...orbitalBase, ...(next.orbitalOverlay || {}), selected: { ...orbitalBase.selected, ...(next.orbitalOverlay?.selected || {}) } };
  o.enabled = o.enabled !== false;
  o.mode = o.mode === 'visible' ? 'visible' : 'all';
  o.labels = o.labels !== false;
  o.tracks = o.tracks !== false;
  o.observerLinks = o.observerLinks !== false;
  o.observerLinkMode = o.observerLinkMode === 'legacy-scale' ? 'legacy-scale' : 'physical';
  o.spaceBackgroundMode = o.spaceBackgroundMode === 'off' ? 'off' : 'synthetic';
  o.spaceBackground = o.spaceBackgroundMode !== 'off';
  o.coverage = o.coverage === true;
  o.selectedCoverage = o.selectedCoverage !== false;
  o.coverageMinElevationDeg = clampNumber(o.coverageMinElevationDeg, orbitalBase.coverageMinElevationDeg, 0, 30);
  o.coverageOpacity = clampInt(o.coverageOpacity, orbitalBase.coverageOpacity, 4, 60);
  o.coverageLiftKm = clampNumber(o.coverageLiftKm, orbitalBase.coverageLiftKm, 0, .25);
  o.renderMode = 'altitude';
  o.altitudeScale = clampInt(o.altitudeScale, orbitalBase.altitudeScale, 0, 100);
  o.renderFps = clampInt(o.renderFps, orbitalBase.renderFps, 10, 60);
  o.interpolationStepMs = clampInt(o.interpolationStepMs, orbitalBase.interpolationStepMs, 100, 5000);
  o.smoothingMs = clampInt(o.smoothingMs, orbitalBase.smoothingMs, 0, 250);
  o.horizonDeg = clampNumber(o.horizonDeg, orbitalBase.horizonDeg, -10, 30);
  o.opacity = clampInt(o.opacity, orbitalBase.opacity, 20, 100);
  o.pointRadius = clampInt(o.pointRadius, orbitalBase.pointRadius, 3, 18);
  o.signalRingWidth = clampInt(o.signalRingWidth, orbitalBase.signalRingWidth, 1, 8);
  o.glowRadius = clampInt(o.glowRadius, orbitalBase.glowRadius, 0, 18);
  o.glowOpacity = clampInt(o.glowOpacity, orbitalBase.glowOpacity, 0, 80);
  o.refreshMs = clampInt(o.refreshMs, orbitalBase.refreshMs, 300, 5000);
  o.tracksRefreshMs = clampInt(o.tracksRefreshMs, orbitalBase.tracksRefreshMs, 15_000, 180_000);
  o.trackMode = o.trackMode === 'window' ? 'window' : 'full';
  o.trackMinutes = clampInt(o.trackMinutes, orbitalBase.trackMinutes, 5, 1440);
  o.trackStepMinutes = clampInt(o.trackStepMinutes, orbitalBase.trackStepMinutes, 1, 30);
  o.trackLimit = clampInt(o.trackLimit, orbitalBase.trackLimit, 1, 250);
  o.limit = clampInt(o.limit, orbitalBase.limit, 32, 20000);
  next.orbitalOverlay = o;
  return next;
}

function readPersistedSettings() {
  for (const key of [ASTRIS_MAP_SETTINGS_KEY, ...ASTRIS_MAP_SETTINGS_LEGACY_KEYS]) {
    try {
      const raw = localStorage.getItem(key);
      if (raw) return normalizeMapSettings(JSON.parse(raw));
    } catch { /* continue */ }
  }
  return defaultMapSettings();
}

export function useAstrisMapSettings() {
  const [settings, setSettings] = useState(readPersistedSettings);
  useEffect(() => {
    try { localStorage.setItem(ASTRIS_MAP_SETTINGS_KEY, JSON.stringify(settings)); } catch { /* noop */ }
  }, [settings]);
  return [settings, (updater) => setSettings((current) => normalizeMapSettings(typeof updater === 'function' ? updater(current) : updater))];
}
