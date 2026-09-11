import { startTransition, useCallback, useEffect, useRef, useState } from 'react';
import { Orbit } from 'lucide-react';
import AstrisMapWidget from '../components/map/AstrisMapWidget.jsx';
import AstrisMapErrorBoundary from '../components/common/AstrisMapErrorBoundary.jsx';
import AstrisEntryLoader from '../components/common/AstrisEntryLoader.jsx';
import { useAstrisMapSettings } from '../map/config/MapSettingsStore.js';

const FILTER_ORDER = ['GPS', 'GLONASS', 'GALILEO', 'BEIDOU', 'QZSS', 'SBAS', 'STARLINK'];

const LAST_OBSERVER_KEY = 'astris_last_observer_v1';

function readLastObserver() {
  try {
    const value = JSON.parse(localStorage.getItem(LAST_OBSERVER_KEY) || 'null');
    const lat = Number(value?.lat); const lon = Number(value?.lon); const altM = Number(value?.altM || 0);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) return null;
    return { lat, lon, altM, source: 'cached' };
  } catch { return null; }
}

function persistObserver(value) {
  try {
    if (!value || !Number.isFinite(Number(value.lat)) || !Number.isFinite(Number(value.lon))) return;
    localStorage.setItem(LAST_OBSERVER_KEY, JSON.stringify({ lat: Number(value.lat), lon: Number(value.lon), altM: Number(value.altM || 0) }));
  } catch { /* localStorage may be unavailable */ }
}

function median(values) {
  const rows = values.filter(Number.isFinite).slice().sort((a, b) => a - b);
  if (!rows.length) return 0;
  const middle = Math.floor(rows.length / 2);
  return rows.length % 2 ? rows[middle] : (rows[middle - 1] + rows[middle]) * 0.5;
}

function useScene({ observer, settings, selectedNoradId }) {
  const [state, setState] = useState({
    phase: 'loading', rows: [], tracks: [], track: [], selected: null, catalogs: {}, error: '',
    count: 0, visibleCount: null, at: null, atMs: null, nextAtMs: null,
    trackReferenceAtMs: null, trackReferenceFrame: '', propagationStepMs: null,
    receivedAtMs: 0, clockOffsetMs: 0, latencyMs: null,
  });
  const requestRef = useRef(null);
  const tracksRef = useRef([]);
  const tracksFetchedAtRef = useRef(0);
  const trackScopeRef = useRef('');
  const clockOffsetRef = useRef(0);
  const clockSamplesRef = useRef([]);
  const failureStreakRef = useRef(0);
  const orbital = settings.orbitalOverlay;
  const selectedSystems = FILTER_ORDER.filter((key) => orbital.selected[key]);
  const hasGnssCatalog = selectedSystems.some((key) => key !== 'STARLINK');
  const hasStarlinkCatalog = selectedSystems.includes('STARLINK');
  // Load each enabled catalog as a reusable client-side scene. GNSS is small,
  // so switching GPS/GLONASS/Galileo/BeiDou/QZSS/SBAS no longer waits for a
  // new network request: the map filters the cached rows immediately.
  const sceneConstellations = [
    ...(hasGnssCatalog ? ['GPS', 'GLONASS', 'GALILEO', 'BEIDOU', 'QZSS', 'SBAS'] : []),
    ...(hasStarlinkCatalog ? ['STARLINK'] : []),
  ];
  const catalogKey = [hasGnssCatalog ? 'GNSS' : '', hasStarlinkCatalog ? 'STARLINK' : ''].filter(Boolean).join(',');
  const trackScope = JSON.stringify({
    catalogKey,
    trackMode: orbital.trackMode,
    trackMinutes: orbital.trackMinutes,
    trackStepMinutes: orbital.trackStepMinutes,
    trackLimit: orbital.trackLimit,
    limit: orbital.limit,
    selectedNoradId: String(selectedNoradId || ''),
  });

  useEffect(() => {
    let cancelled = false;
    let timer = null;
    if (trackScopeRef.current !== trackScope) {
      trackScopeRef.current = trackScope;
      tracksRef.current = [];
      tracksFetchedAtRef.current = 0;
    }
    const requestedIntervalMs = Math.max(300, Math.min(5000, Number(orbital.refreshMs || 1000)));
    const starlinkHeavyScene = hasStarlinkCatalog && Number(orbital.limit || 12000) > 4000;
    // Starlink can mean >10k satellites. Keep SGP4/JSON snapshots at a sane
    // cadence while the GPU still renders at the selected 20–60 FPS from
    // predictive keyframes. This removes main-thread parse spikes without
    // making the visual motion wait for the network.
    const intervalMs = starlinkHeavyScene ? Math.max(1500, requestedIntervalMs) : requestedIntervalMs;
    const tracksRefreshMs = Math.max(15_000, Math.min(180_000, Number(orbital.tracksRefreshMs || 60_000)));
    // The prediction horizon must outlive the polling period, otherwise the
    // interpolation ratio reaches 1.0 and every satellite visibly pauses while
    // the next HTTP response is still in flight. Smoothing contributes only
    // headroom; it no longer low-pass-lags satellites away from their orbits.
    const effectiveInterpolationStepMs = Math.max(
      Number(orbital.interpolationStepMs || 500),
      Math.min(5000, intervalMs * 1.5 + Number(orbital.smoothingMs || 0)),
    );

    const poll = async () => {
      const startedPerf = performance.now();
      const requestStartedAtMs = Date.now();
      let nextDelayMs = intervalMs;
      requestRef.current?.abort();
      const controller = new AbortController();
      requestRef.current = controller;
      const selected = sceneConstellations;
      if (!orbital.enabled || !selected.length) {
        tracksRef.current = [];
        if (!cancelled) setState({
          phase: 'ready', rows: [], tracks: [], track: [], selected: null, catalogs: {}, error: '', count: 0,
          visibleCount: 0, at: new Date().toISOString(), atMs: Date.now(), nextAtMs: null,
          trackReferenceAtMs: null, trackReferenceFrame: '', propagationStepMs: null,
          receivedAtMs: Date.now(), clockOffsetMs: 0, latencyMs: 0,
        });
        timer = window.setTimeout(poll, intervalMs);
        return;
      }
      const catalogs = [];
      if (hasGnssCatalog) catalogs.push('GNSS');
      if (hasStarlinkCatalog) catalogs.push('STARLINK');
      const includeTracks = orbital.tracks !== false
        && (tracksRef.current.length === 0 || Date.now() - tracksFetchedAtRef.current >= tracksRefreshMs);
      const params = new URLSearchParams({
        catalogs: catalogs.join(','),
        constellations: selected.join(','),
        // Keep one reusable global scene per enabled catalog. ALL/VISIBLE and
        // horizon filtering are display concerns and are applied client-side,
        // so those controls no longer wait for another large Starlink fetch.
        mode: 'global',
        horizonDeg: String(orbital.horizonDeg),
        limit: String(orbital.limit || 12000),
        includeTracks: includeTracks ? '1' : '0',
        trackMode: String(orbital.trackMode || 'full'),
        trackMinutes: String(orbital.trackMinutes || 720),
        trackStepMinutes: String(orbital.trackStepMinutes || 4),
        trackLimit: String(orbital.trackLimit || 192),
        interpolationStepMs: String(effectiveInterpolationStepMs),
      });
      if (selectedNoradId) params.set('selectedNoradId', selectedNoradId);
      if (Number.isFinite(Number(observer?.lat)) && Number.isFinite(Number(observer?.lon))) {
        params.set('lat', String(observer.lat));
        params.set('lon', String(observer.lon));
        params.set('altM', String(observer.altM || 0));
      }
      try {
        const response = await fetch(`/api/orbits/scene?${params}`, { cache: 'no-store', signal: controller.signal });
        const payload = await response.json();
        if (!response.ok || payload.ok === false) {
          const error = new Error(payload.message || `HTTP ${response.status}`);
          const headerRetrySeconds = Number(response.headers.get('retry-after'));
          error.retryAfterMs = Math.max(
            Number(payload.retryAfterMs || 0),
            Number.isFinite(headerRetrySeconds) ? headerRetrySeconds * 1000 : 0,
          );
          error.catalogs = payload.catalogs || null;
          throw error;
        }
        failureStreakRef.current = 0;
        if (includeTracks && Array.isArray(payload.tracks)) {
          const referenceAtMs = Number(payload.atMs ?? Date.parse(payload.at || ''));
          tracksRef.current = payload.tracks.map((track) => ({
            ...track,
            referenceAtMs: Number.isFinite(Number(track.referenceAtMs))
              ? Number(track.referenceAtMs)
              : (Number.isFinite(referenceAtMs) ? referenceAtMs : requestStartedAtMs),
          }));
          tracksFetchedAtRef.current = Date.now();
        }
        if (cancelled) return;
        const receivedAtMs = Date.now();
        const serverNowMs = Number(payload.serverNowMs);
        const midpointMs = (requestStartedAtMs + receivedAtMs) * 0.5;
        const offsetSample = Number.isFinite(serverNowMs) ? serverNowMs - midpointMs : Number.NaN;
        if (Number.isFinite(offsetSample)) {
          const samples = [...clockSamplesRef.current, offsetSample].slice(-5);
          clockSamplesRef.current = samples;
          clockOffsetRef.current = median(samples);
        }
        const selectedTrack = selectedNoradId
          ? tracksRef.current.find((item) => String(item.noradId) === String(selectedNoradId))
          : null;
        // Scene keyframes are latency-sensitive input to the GPU interpolation loop.
        // Do not defer them as a React transition: under Starlink load that can make
        // the next keyframe arrive visually late even though the HTTP response is ready.
        setState({
          phase: 'ready', error: '', ...payload,
          tracks: tracksRef.current,
          track: selectedTrack?.points || payload.track || [],
          trackReferenceAtMs: selectedTrack?.referenceAtMs ?? payload.trackReferenceAtMs ?? payload.atMs ?? null,
          trackReferenceFrame: selectedTrack?.referenceFrame || payload.trackReferenceFrame || '',
          receivedAtMs,
          clockOffsetMs: Number.isFinite(clockOffsetRef.current) ? clockOffsetRef.current : 0,
          latencyMs: Math.round(performance.now() - startedPerf),
        });
      } catch (error) {
        if (!cancelled && error?.name !== 'AbortError') {
          failureStreakRef.current += 1;
          const localBackoffMs = Math.min(120_000, 5_000 * (2 ** Math.min(5, failureStreakRef.current - 1)));
          nextDelayMs = Math.max(intervalMs, Number(error?.retryAfterMs || 0), localBackoffMs);
          setState((prev) => ({
            ...prev,
            // Keep an already rendered scene alive if the provider disappears.
            // A first-run catalogue failure still reports a real error.
            phase: prev.rows?.length ? 'ready' : 'error',
            error: error?.message || String(error),
            catalogs: error?.catalogs || prev.catalogs || {},
            retryAfterMs: nextDelayMs,
            latencyMs: Math.round(performance.now() - startedPerf),
          }));
        }
      } finally {
        if (!cancelled) {
          const elapsed = performance.now() - startedPerf;
          timer = window.setTimeout(poll, Math.max(250, nextDelayMs - elapsed));
        }
      }
    };
    poll();
    return () => { cancelled = true; window.clearTimeout(timer); requestRef.current?.abort(); };
  }, [observer?.lat, observer?.lon, observer?.altM, orbital.enabled,
    orbital.refreshMs, orbital.tracks, orbital.tracksRefreshMs, orbital.interpolationStepMs, orbital.smoothingMs,
    catalogKey, selectedNoradId, trackScope]);
  return state;
}

function useSatelliteSearch({ query, settings }) {
  const [rows, setRows] = useState([]);
  const orbital = settings.orbitalOverlay;
  const selectionKey = FILTER_ORDER.filter((key) => orbital.selected[key]).join(',');

  useEffect(() => {
    const text = query.trim();
    if (text.length < 2) { setRows([]); return undefined; }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      const selected = selectionKey.split(',').filter(Boolean);
      const catalogs = [];
      if (selected.some((key) => key !== 'STARLINK')) catalogs.push('GNSS');
      if (selected.includes('STARLINK')) catalogs.push('STARLINK');
      if (!catalogs.length) { setRows([]); return; }
      const params = new URLSearchParams({
        catalogs: catalogs.join(','),
        constellations: selected.join(','),
        query: text,
        limit: '20',
      });
      try {
        const response = await fetch(`/api/orbits/search?${params}`, { cache: 'no-store', signal: controller.signal });
        const payload = await response.json();
        if (!response.ok || payload.ok === false) throw new Error(payload.message || `HTTP ${response.status}`);
        startTransition(() => setRows(Array.isArray(payload.rows) ? payload.rows : []));
      } catch (error) {
        if (error?.name !== 'AbortError') setRows([]);
      }
    }, 280);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [query, selectionKey]);
  return rows;
}

export default function App() {
  const [settings, setSettings] = useAstrisMapSettings();
  const [query, setQuery] = useState('');
  const [selectedNoradId, setSelectedNoradId] = useState('');
  const initialObserverRef = useRef(null);
  if (initialObserverRef.current === null) initialObserverRef.current = readLastObserver() || false;
  const initialObserver = initialObserverRef.current || null;
  const [location, setLocation] = useState({ phase: initialObserver ? 'cached' : 'loading', data: null, error: '' });
  const [manual, setManual] = useState(() => initialObserver ? { lat: String(initialObserver.lat), lon: String(initialObserver.lon) } : { lat: '', lon: '' });
  const [observer, setObserver] = useState(initialObserver);

  const loadLocation = useCallback(async () => {
    setLocation((previous) => ({ ...previous, phase: 'loading', error: '' }));
    try {
      const response = await fetch('/api/location', { cache: 'no-store' }); const payload = await response.json();
      if (!response.ok || payload.ok === false) throw new Error(payload.message || 'Не вдалося визначити IP-локацію');
      setLocation({ phase: 'ready', data: payload.location, error: '' });
      const nextObserver = { lat: payload.location.latitude, lon: payload.location.longitude, altM: 0, source: payload.location.accuracy === 'approximate-stale' ? 'cached' : 'ip' };
      setObserver(nextObserver);
      persistObserver(nextObserver);
      setManual({ lat: String(payload.location.latitude), lon: String(payload.location.longitude) });
    } catch (error) {
      const cached = readLastObserver();
      if (cached) {
        setObserver(cached);
        setManual({ lat: String(cached.lat), lon: String(cached.lon) });
        setLocation({ phase: 'cached', data: null, error: error?.message || String(error) });
      } else {
        setLocation({ phase: 'error', data: null, error: error?.message || String(error) });
      }
    }
  }, []);
  useEffect(() => { loadLocation(); }, [loadLocation]);

  const scene = useScene({ observer, settings, selectedNoradId });
  const searchRows = useSatelliteSearch({ query, settings });
  function selectRow(row) {
    const nextId = row ? String(row.noradId) : '';
    setSelectedNoradId((currentId) => (nextId && String(currentId) === nextId ? '' : nextId));
  }
  function applyManualObserver() {
    const lat = Number(manual.lat); const lon = Number(manual.lon);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || lat < -90 || lat > 90 || lon < -180 || lon > 180) return;
    const nextObserver = { lat, lon, altM: 0, source: 'manual' };
    setObserver(nextObserver);
    persistObserver(nextObserver);
  }
  function applyProfileObserver(profileObserver) {
    if (profileObserver?.mode === 'manual') {
      const lat = Number(profileObserver.lat); const lon = Number(profileObserver.lon); const altM = Number(profileObserver.altM || 0);
      if (!Number.isFinite(lat) || !Number.isFinite(lon)) return;
      setManual({ lat: String(lat), lon: String(lon) });
      const nextObserver = { lat, lon, altM, source: 'manual' };
      setObserver(nextObserver);
      persistObserver(nextObserver);
      return;
    }
    loadLocation();
  }
  async function requestCatalogRefresh() {
    const selected = FILTER_ORDER.filter((key) => settings.orbitalOverlay.selected[key]); const catalogs = [];
    if (selected.some((key) => key !== 'STARLINK')) catalogs.push('GNSS'); if (selected.includes('STARLINK')) catalogs.push('STARLINK'); if (!catalogs.length) return;
    try { await fetch(`/api/catalog/refresh?catalogs=${encodeURIComponent(catalogs.join(','))}`, { method: 'POST' }); } catch { /* next scene poll reports state */ }
  }

  return <>
    <AstrisEntryLoader ready={scene.phase === 'ready' || scene.phase === 'error'} />
    <main className="app-shell">
    <header className="topbar"><div className="brand-lockup"><div className="brand-mark"><Orbit size={23} /></div><div><div className="brand-line"><strong>ASTRIS</strong><span>Advanced Satellite Tracking & Real-time Interactive System</span></div><p>Вебсистема інтерактивного моніторингу та візуалізації орбітального руху штучних супутників Землі</p></div></div><div className="top-status"><span className={`live-dot ${scene.phase === 'ready' ? 'is-live' : ''}`} /><b>{scene.phase === 'ready' ? 'LIVE' : scene.phase.toUpperCase()}</b><span>{scene.at ? new Date(scene.at).toLocaleTimeString('uk-UA') : '—'}</span></div></header>
    <section className="workspace workspace-map-only"><AstrisMapErrorBoundary><AstrisMapWidget scene={scene} observer={observer} location={location} manual={manual} setManual={setManual} loadLocation={loadLocation} applyManualObserver={applyManualObserver} applyProfileObserver={applyProfileObserver} query={query} setQuery={setQuery} searchRows={searchRows} selectedNoradId={selectedNoradId} onSelect={selectRow} requestCatalogRefresh={requestCatalogRefresh} settings={settings} setSettings={setSettings} /></AstrisMapErrorBoundary></section>
    </main>
  </>;
}
