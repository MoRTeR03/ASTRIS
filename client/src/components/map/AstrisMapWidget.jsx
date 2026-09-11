import { useMemo, useRef, useState } from 'react';
import {
  Crosshair,
  Download,
  Grid3X3,
  Save,
  Trash2,
  Info,
  LocateFixed,
  Menu,
  PanelRightClose,
  PanelRightOpen,
  RefreshCw,
  RotateCcw,
  Search,
  Tags,
  Wifi,
  X,
} from 'lucide-react';
import OrbitalMap from './OrbitalMap.jsx';
import { CONSTELLATION_META } from '../../lib/colors.js';
import {
  ASTRIS_GRATICULE_PALETTES,
  ASTRIS_GRATICULE_STEPS,
  ASTRIS_MAP_LAYERS,
  ASTRIS_MAP_VIEW_PRESETS,
  defaultOrbitalOverlaySettings,
} from '../../map/config/MapSettingsStore.js';
import { useAstrisProfiles } from '../../profiles/useAstrisProfiles.js';

const FILTER_ORDER = ['GPS', 'GLONASS', 'GALILEO', 'BEIDOU', 'QZSS', 'SBAS', 'STARLINK'];
const MAP_OPTIONS = Object.freeze([
  ['labels', '🏷️', 'Підписи'], ['grid', '📐', 'Сітка'], ['cursor', '🎯', 'Курсор'], ['dim', '🌘', 'DIM'],
  ['globe', '🌍', 'Глобус'], ['atmosphere', '✨', 'Атмосфера'], ['dayNight', '🌓', 'День / ніч'], ['buildings', '🏙️', '3D будівлі'], ['terrain', '⛰️', 'Рельєф'],
]);

function formatNumber(value, digits = 1) {
  const n = Number(value);
  return Number.isFinite(n) ? n.toFixed(digits) : '—';
}
function formatAge(ms) {
  const n = Number(ms);
  if (!Number.isFinite(n)) return '—';
  const minutes = Math.round(n / 60000);
  return minutes < 60 ? `${minutes} хв` : `${Math.round(minutes / 60)} год`;
}
function catalogFreshnessLabel(catalog) {
  if (!catalog) return 'система вимкнена';
  if (!catalog.fresh) return 'кеш застаріває';
  return catalog.fallbackUsed ? 'OMM • mirror fallback' : 'OMM актуальний';
}
function RangeControl({ label, value, min, max, step = 1, unit = '', onChange, hint = '' }) {
  return (
    <label className="astris-map-native-range" title={hint || undefined}>
      <span><b>{label}</b><i>{formatNumber(value, step < 1 ? 1 : 0)}{unit}</i></span>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(event) => onChange(Number(event.target.value))} />
    </label>
  );
}
function ToggleButton({ active, icon, label, disabled, onClick, title }) {
  return <button type="button" className={active ? 'active' : ''} aria-pressed={active} disabled={disabled} onClick={onClick} title={title}><span>{icon}</span><b>{label}</b></button>;
}
function Collapsible({ title, hint, open, onOpenChange, className = '', children }) {
  return (
    <section className={`astris-map-panel-section astris-ios-disclosure ${open ? 'is-open' : 'is-closed'} ${className}`.trim()}>
      <button
        type="button"
        className="astris-map-panel-section-summary"
        aria-expanded={open}
        onClick={() => onOpenChange?.(!open)}
      >
        <span><b>{title}</b><small>{hint}</small></span>
        <span className="astris-map-panel-section-indicator" aria-hidden="true">
          <svg viewBox="0 0 20 20" focusable="false"><path d="m5.5 7.5 4.5 4.5 4.5-4.5" /></svg>
        </span>
      </button>
      {open ? <div className="astris-map-panel-section-body">{children}</div> : null}
    </section>
  );
}

function SegmentedControl({ value, options, onChange, ariaLabel }) {
  return (
    <div className="astris-segmented-control" role="group" aria-label={ariaLabel}>
      {options.map((option) => <button key={option.value} type="button" aria-pressed={value === option.value} className={value === option.value ? 'active' : ''} onClick={() => onChange(option.value)}>{option.label}</button>)}
    </div>
  );
}

export default function AstrisMapWidget({
  scene, observer, location, manual, setManual, loadLocation, applyManualObserver, applyProfileObserver,
  query, setQuery, searchRows, selectedNoradId, onSelect, requestCatalogRefresh,
  settings, setSettings,
}) {
  const mapRef = useRef(null);
  const profileStore = useAstrisProfiles();
  const [activeProfile, setActiveProfile] = useState('');
  const [profileName, setProfileName] = useState('');
  const [profileMessage, setProfileMessage] = useState('');
  const [mapInfoOpen, setMapInfoOpen] = useState(false);
  const [runtime, setRuntime] = useState({
    center: { lat: 28, lon: 20, zoom: .8 }, bearing: 0, pitch: 0,
    projection: settings.globe ? 'globe' : 'mercator', orbitalRenderFps: 0,
  });
  const layer = ASTRIS_MAP_LAYERS[settings.layer];
  const selected = scene.selected || scene.rows?.find((row) => String(row.noradId) === String(selectedNoradId)) || null;
  const selectedAboveHorizon = selected && Number.isFinite(Number(selected.elevationDeg))
    ? Number(selected.elevationDeg) >= Number(settings.orbitalOverlay.horizonDeg || 0)
    : selected?.visible;
  const counts = useMemo(() => (scene.rows || []).reduce((acc, row) => {
    const key = String(row.constellation || 'OTHER').toUpperCase();
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {}), [scene.rows]);
  const enabled = FILTER_ORDER.filter((key) => settings.orbitalOverlay.selected[key]);
  const renderedRows = useMemo(() => {
    const selectedSystems = new Set(enabled);
    const horizonDeg = Number(settings.orbitalOverlay.horizonDeg || 0);
    return (scene.rows || []).filter((row) => {
      const system = String(row.constellation || '').toUpperCase();
      if (!selectedSystems.has(system)) return false;
      // Apply the display horizon locally so moving the threshold or switching
      // ALL/VISIBLE changes the map immediately instead of waiting for the
      // next SGP4 HTTP snapshot.
      if (settings.orbitalOverlay.mode === 'visible') {
        const elevation = Number(row.elevationDeg);
        if (!Number.isFinite(elevation) || elevation < horizonDeg) return false;
      }
      return true;
    });
  }, [scene.rows, settings.orbitalOverlay.selected, settings.orbitalOverlay.mode, settings.orbitalOverlay.horizonDeg]);
  const renderedVisibleCount = useMemo(() => {
    const horizonDeg = Number(settings.orbitalOverlay.horizonDeg || 0);
    return renderedRows.reduce((count, row) => count + (Number(row.elevationDeg) >= horizonDeg ? 1 : 0), 0);
  }, [renderedRows, settings.orbitalOverlay.horizonDeg]);
  const renderedIds = useMemo(() => new Set(renderedRows.map((row) => String(row.noradId))), [renderedRows]);
  const renderedTracks = useMemo(() => (scene.tracks || []).filter((track) => renderedIds.has(String(track.noradId))), [scene.tracks, renderedIds]);
  const nativeVectorBuildings = ASTRIS_MAP_LAYERS[settings.layer]?.nativeBuildings === true;

  const patch = (value) => setSettings((current) => ({ ...current, ...value }));
  const patchOrbital = (value) => setSettings((current) => ({ ...current, orbitalOverlay: { ...current.orbitalOverlay, ...value } }));
  const patchGrid = (value) => setSettings((current) => ({ ...current, graticule: { ...current.graticule, ...value } }));
  const setSection = (key, open) => setSettings((current) => ({ ...current, panelSections: { ...current.panelSections, [key]: open } }));


  const applyPreset = (key) => {
    setSettings((current) => {
      const preset = ASTRIS_MAP_VIEW_PRESETS[key];
      if (!preset) return current;
      return {
        ...current,
        ...preset.patch,
        orbitalOverlay: preset.patch.orbitalOverlay
          ? { ...current.orbitalOverlay, ...preset.patch.orbitalOverlay }
          : current.orbitalOverlay,
      };
    });
    window.requestAnimationFrame(() => mapRef.current?.applyViewPreset?.(key));
  };
  const toggleConstellation = (key) => patchOrbital({ selected: { ...settings.orbitalOverlay.selected, [key]: !settings.orbitalOverlay.selected[key] } });
  const toggleMapOption = (key) => {
    const next = !settings[key];
    if (key === 'globe') {
      patch({ globe: next });
      window.requestAnimationFrame(() => mapRef.current?.applyViewPreset?.(next ? 'globe' : (settings.buildings ? 'city' : 'flat')));
      return;
    }
    patch({ [key]: next });
    if (key === 'buildings' && next && settings.buildingAutoZoom) {
      // Let React commit the new building=true state before the imperative
      // visibility/zoom pass. Calling show3d() in the same frame could still
      // see the previous settings object and made the first enable look inert.
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => mapRef.current?.show3d?.()));
    }
  };

  async function loadProfile(name) {
    if (!name) return;
    setProfileMessage('Завантаження…');
    try {
      const profile = await profileStore.load(name);
      if (!profile) return;
      setSettings(profile.settings || settings);
      if (profile.observer) applyProfileObserver?.(profile.observer);
      setActiveProfile(profile.name || name);
      setProfileName(profile.name || name);
      setProfileMessage('Профіль застосовано');
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => mapRef.current?.applyViewState?.(profile.mapView)));
    } catch (error) {
      setProfileMessage(error?.message || 'Не вдалося завантажити профіль');
    }
  }

  async function saveProfile() {
    const name = String(profileName || activeProfile).trim();
    if (!name) { setProfileMessage('Вкажи назву профілю'); return; }
    setProfileMessage('Збереження…');
    try {
      const profile = await profileStore.save(name, {
        settings,
        observer: observer?.source === 'manual'
          ? { mode: 'manual', lat: Number(observer.lat), lon: Number(observer.lon), altM: Number(observer.altM || 0) }
          : { mode: 'ip' },
        mapView: mapRef.current?.getViewState?.() || null,
      });
      setActiveProfile(profile?.name || name);
      setProfileName(profile?.name || name);
      setProfileMessage('Збережено у server/data/astris-profiles.json');
    } catch (error) {
      setProfileMessage(error?.message || 'Не вдалося зберегти профіль');
    }
  }

  async function deleteProfile() {
    const name = activeProfile || profileName;
    if (!name) return;
    if (!window.confirm(`Видалити профіль «${name}»?`)) return;
    try {
      await profileStore.remove(name);
      setActiveProfile('');
      setProfileName('');
      setProfileMessage('Профіль видалено');
    } catch (error) {
      setProfileMessage(error?.message || 'Не вдалося видалити профіль');
    }
  }

  return (
    <section className={`astris-map-native ${settings.dim ? 'is-dim' : ''} ${settings.globe ? 'is-globe' : ''} ${settings.panelOpen ? 'panel-open' : 'panel-closed'}`} data-astris-map-native="true" data-astris-renderer="maplibre-native" style={{ '--map-brightness': settings.brightness / 100, '--map-label-scale': settings.labelScale / 100 }}>
      <header className="astris-map-native-head">
        <div className="astris-map-native-title"><span className="module-kicker">Глобальна просторова панель</span><h2>Карта орбітального моніторингу</h2><p>MapLibre • OMM/SGP4 • GNSS + Starlink • IP/manual observer • 2D / globe / 3D terrain</p></div>
        <div className="astris-map-native-head-actions astris-map-profile-manager" aria-label="Глобальні профілі ASTRIS">
          <label><span>Профіль</span><select value={activeProfile} onChange={(event) => { const name = event.target.value; setActiveProfile(name); if (name) loadProfile(name); }}><option value="">Не вибрано</option>{profileStore.profiles.map((profile) => <option key={profile.name} value={profile.name}>{profile.name}</option>)}</select></label>
          <label className="profile-name"><span>Назва / Save as</span><input value={profileName} maxLength={64} placeholder="Напр. Мій глобус" onChange={(event) => setProfileName(event.target.value)} /></label>
          <div className="profile-actions"><button type="button" onClick={saveProfile} title="Зберегти всі налаштування, observer і поточний view"><Save size={14} /><span>Зберегти</span></button><button type="button" disabled={!activeProfile} onClick={deleteProfile} title="Видалити профіль"><Trash2 size={14} /></button><a href="/api/profiles/export" title="Експорт одного JSON-файлу з усіма профілями"><Download size={14} /></a></div>
          <small className={profileStore.phase === 'error' ? 'is-error' : ''}>{profileMessage || (profileStore.error ? profileStore.error : 'Налаштування зберігаються на сервері в одному JSON-файлі')}</small>
        </div>
      </header>

      <div className={`astris-map-native-strip ${scene.phase === 'error' ? 'tone-danger' : scene.phase === 'ready' && observer ? 'tone-fix' : 'tone-offline'}`}>
        <div className="astris-map-native-status"><small>Спостерігач</small><b>{observer?.source === 'manual' ? 'MANUAL' : location.data?.city || 'IP LOCATION'}</b><span>{observer ? `${formatNumber(observer.lat, 4)}°, ${formatNumber(observer.lon, 4)}°` : 'координати відсутні'}</span></div>
        <div className="astris-map-native-metrics">
          <div className={`astris-map-native-metric ${renderedRows.length > 0 ? 'tone-ok' : 'tone-warn'}`}><small>Tracked</small><b>{renderedRows.length.toLocaleString('uk-UA')}</b><span>відображається</span></div>
          <div className={`astris-map-native-metric ${renderedVisibleCount > 0 ? 'tone-fix' : 'tone-warn'}`}><small>Visible</small><b>{renderedVisibleCount.toLocaleString('uk-UA')}</b><span>над горизонтом</span></div>
          <div title={scene.catalogs?.GNSS?.providerWarning || scene.catalogs?.GNSS?.provider || undefined} className={`astris-map-native-metric ${scene.catalogs?.GNSS?.fresh ? 'tone-ok' : scene.catalogs?.GNSS ? 'tone-warn' : 'tone-info'}`}><small>GNSS cache</small><b>{formatAge(scene.catalogs?.GNSS?.ageMs)}</b><span>{catalogFreshnessLabel(scene.catalogs?.GNSS)}</span></div>
          <div title={scene.catalogs?.STARLINK?.providerWarning || scene.catalogs?.STARLINK?.provider || undefined} className={`astris-map-native-metric ${scene.catalogs?.STARLINK?.fresh ? 'tone-ok' : scene.catalogs?.STARLINK ? 'tone-warn' : 'tone-info'}`}><small>Starlink cache</small><b>{formatAge(scene.catalogs?.STARLINK?.ageMs)}</b><span>{catalogFreshnessLabel(scene.catalogs?.STARLINK)}</span></div>
          <div className="astris-map-native-metric tone-info"><small>Projection</small><b>{String(runtime.projection || (settings.globe ? 'globe' : 'mercator')).toUpperCase()}</b><span>{layer?.short} • z{formatNumber(runtime.center?.zoom, 1)}</span></div>
        </div>
        <div className="astris-map-native-quick-actions">
          <button type="button" onClick={() => mapRef.current?.centerOnObserver?.()} title="Центр на спостерігачі"><LocateFixed size={14} /><span>Observer</span></button>
          <button type="button" className={settings.grid ? 'active' : ''} onClick={() => patch({ grid: !settings.grid })} title="WGS84 сітка"><Grid3X3 size={14} /><span>Grid</span></button>
          <button type="button" className={settings.labels ? 'active' : ''} onClick={() => patch({ labels: !settings.labels })} title="Підписи карти"><Tags size={14} /><span>Labels</span></button>
          <button type="button" onClick={requestCatalogRefresh} title="Оновити orbital catalog"><RefreshCw size={14} /><span>Catalog</span></button>
        </div>
      </div>

      <div className="astris-map-native-workbench">
        <div className="astris-map-native-stage">
          <OrbitalMap
            ref={mapRef}
            rows={renderedRows}
            tracks={renderedTracks}
            track={scene.track || []}
            trackReferenceFrame={scene.trackReferenceFrame || ''}
            trackReferenceAtMs={scene.trackReferenceAtMs ?? scene.atMs ?? null}
            sceneAtMs={scene.atMs ?? Date.parse(scene.at || '')}
            nextAtMs={scene.nextAtMs ?? null}
            clockOffsetMs={scene.clockOffsetMs || 0}
            observer={observer}
            settings={settings}
            selectedNoradId={selectedNoradId}
            onSelect={onSelect}
            onRuntime={setRuntime}
          />
          {settings.cursor ? <div className="astris-map-native-crosshair" aria-hidden="true"><i /><b /></div> : null}
          <div className="astris-map-native-floating-actions">
            <button type="button" onClick={() => mapRef.current?.centerOnObserver?.()} disabled={!observer} title="Центрувати по спостерігачу"><LocateFixed size={17} /></button>
            <button type="button" onClick={() => mapRef.current?.resetView?.()} title="Початковий огляд"><RotateCcw size={17} /></button>
            <button type="button" className={mapInfoOpen ? 'active' : ''} onClick={() => setMapInfoOpen((value) => !value)} title="Інформація про карту"><Info size={17} /></button>
            <button type="button" onClick={() => patch({ panelOpen: !settings.panelOpen })} title={settings.panelOpen ? 'Сховати інструменти' : 'Показати інструменти'}>{settings.panelOpen ? <PanelRightClose size={17} /> : <PanelRightOpen size={17} />}</button>
          </div>
          {mapInfoOpen ? <div className="astris-map-native-info-popover" role="dialog" aria-label="Інформація про карту">
            <div className="astris-map-native-info-head"><span><Info size={15} /><b>Інформація карти</b></span><button type="button" onClick={() => setMapInfoOpen(false)} title="Закрити"><X size={14} /></button></div>
            <dl>
              <div><dt>Базовий шар</dt><dd>{layer?.label || settings.layer}</dd></div>
              <div><dt>Проєкція</dt><dd>{String(runtime.projection || (settings.globe ? 'globe' : 'mercator')).toUpperCase()}</dd></div>
              <div><dt>Спостерігач</dt><dd>{observer ? `${formatNumber(observer.lat, 5)}°, ${formatNumber(observer.lon, 5)}°` : 'OFFLINE'}</dd></div>
              <div><dt>Супутники</dt><dd>{renderedRows.length.toLocaleString('uk-UA')} / {scene.count?.toLocaleString('uk-UA') || 0}</dd></div>
              <div><dt>Витки</dt><dd>{renderedTracks.length}</dd></div>
              <div><dt>Рендер</dt><dd>{runtime.orbitalRenderFps || 0} FPS</dd></div>
              <div><dt>SGP4/API</dt><dd>{scene.propagationStepMs ?? '—'} / {scene.latencyMs ?? '—'} ms</dd></div>
              <div><dt>Системи</dt><dd>{enabled.length ? enabled.join(' · ') : 'ЖОДНА'}</dd></div>
            </dl>
          </div> : null}
          <div className="astris-map-native-coordinate-chip">{formatNumber(runtime.center?.lat, 5)}, {formatNumber(runtime.center?.lon, 5)} • z{formatNumber(runtime.center?.zoom, 1)} • b{formatNumber(runtime.bearing, 0)}° • p{formatNumber(runtime.pitch, 0)}°</div>
          {scene.error ? <div className="map-error">{scene.error}</div> : null}
        </div>

        <aside className="astris-map-native-panel" aria-label="Налаштування карти ASTRIS">
          <Collapsible title="Позиція спостерігача" hint="IP location / ручні координати" open={settings.panelSections.observer} onOpenChange={(open) => setSection('observer', open)}>
            <div className="location-card"><div className="location-icon"><Wifi size={17} /></div><div><strong>{observer?.source === 'manual' ? 'Ручні координати' : (location.data?.city || 'Визначення…')}{observer?.source !== 'manual' && (location.data?.country || location.data?.countryName) ? `, ${location.data?.country || location.data?.countryName}` : ''}</strong><span>{observer ? `${formatNumber(observer.lat, 4)}°, ${formatNumber(observer.lon, 4)}°` : location.error || 'Очікування координат'}</span></div><button type="button" className="icon-button" onClick={loadLocation} title="Оновити IP-геолокацію"><RefreshCw size={15} /></button></div>
            <div className="coordinate-grid"><label>LAT<input value={manual.lat} onChange={(event) => setManual((value) => ({ ...value, lat: event.target.value }))} /></label><label>LON<input value={manual.lon} onChange={(event) => setManual((value) => ({ ...value, lon: event.target.value }))} /></label></div>
            <button type="button" className="secondary-button" onClick={applyManualObserver}><Crosshair size={15} />Застосувати вручну</button>
            <p className="microcopy">IP-геолокація приблизна. Ручні координати мають пріоритет для геометрії LOS та coverage.</p>
          </Collapsible>

          <Collapsible title="Пошук супутника" hint="Назва / NORAD ID" open={settings.panelSections.search} onOpenChange={(open) => setSection('search', open)}>
            <div className="search-box"><Search size={15} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="STARLINK-…, GPS…, 26407…" /></div>
            {searchRows.length ? <div className="search-results">{searchRows.map((row) => <button key={`${row.catalog}-${row.noradId}`} type="button" onClick={() => onSelect(row)}><i style={{ background: CONSTELLATION_META[row.constellation]?.color }} /><span><b>{row.objectName}</b><small>NORAD {row.noradId} · {row.constellation}</small></span></button>)}</div> : null}
            <p className="microcopy">Пошук працює по кешованому каталогу без масового SGP4. Вибраний апарат отримує окремий track/coverage.</p>
          </Collapsible>

          <Collapsible className="astris-map-native-view-section" title="Просторовий режим" hint="2D / globe / 3D city" open={settings.panelSections.view} onOpenChange={(open) => setSection('view', open)}>
            <div className="astris-map-native-view-presets">{Object.entries(ASTRIS_MAP_VIEW_PRESETS).map(([key, preset]) => <button key={key} type="button" onClick={() => applyPreset(key)} title={preset.description}><b>{preset.label}</b><small>{preset.description}</small></button>)}</div>
          </Collapsible>

          <Collapsible title="Базовий шар" hint={layer?.engine || ''} open={settings.panelSections.base} onOpenChange={(open) => setSection('base', open)}>
            <div className="astris-map-native-layer-grid">{Object.entries(ASTRIS_MAP_LAYERS).map(([key, value]) => <button key={key} type="button" className={settings.layer === key ? 'active' : ''} onClick={() => patch({ layer: key })} aria-pressed={settings.layer === key}><span className="layer-preview"><img src={value.preview} alt="" loading="lazy" /><i>{value.short}</i></span><span className="layer-copy"><b>{value.label}</b><small>{value.engine}</small></span>{settings.layer === key ? <em>✓</em> : null}</button>)}</div>
            <RangeControl label="Яскравість" value={settings.brightness} min={45} max={125} unit="%" onChange={(value) => patch({ brightness: value })} />
            <RangeControl label="Масштаб підписів" value={settings.labelScale} min={80} max={180} unit="%" onChange={(value) => patch({ labelScale: value })} />
          </Collapsible>

          <Collapsible title="Відображення" hint="Проєкція, будівлі, маркер, рельєф, WGS84" open={settings.panelSections.display} onOpenChange={(open) => setSection('display', open)}>
            <div className="astris-map-native-toggle-grid">{MAP_OPTIONS.map(([key, icon, label]) => {
              const nativeBuildingLock = key === 'buildings' && nativeVectorBuildings;
              const dayNightLock = key === 'dayNight' && !settings.globe;
              return <ToggleButton key={key} active={nativeBuildingLock ? true : !!settings[key]} icon={icon} label={label} onClick={() => toggleMapOption(key)} disabled={nativeBuildingLock || dayNightLock} title={nativeBuildingLock ? 'Vector Standard має власний штатний 3D-шар.' : dayNightLock ? 'День / ніч доступний у globe.' : ''} />;
            })}</div>

            {settings.buildings ? <div className={`astris-map-building-controls ${nativeVectorBuildings ? 'is-native-style' : ''}`}>
              <div className="astris-map-building-status status-ready"><div className="astris-map-building-title"><span>🏙️</span><span><b>3D будівлі</b><small>{nativeVectorBuildings ? 'Штатний OpenFreeMap Liberty 3D-шар' : 'ASTRIS overlay • OpenFreeMap building source'}</small></span></div><strong>{nativeVectorBuildings ? 'ВБУДОВАНИЙ 3D' : 'READY'}</strong></div>
              {nativeVectorBuildings ? <div className="astris-map-native-building-lock"><b>Керується стилем OpenFreeMap Liberty</b><span>ASTRIS не накладає другий extrusion поверх штатного шару — це прибирає дубльовані “тіні”.</span><button type="button" onClick={() => mapRef.current?.ensureBuildingsVisible?.()}>Показати штатний 3D</button></div> : <>
                <div className="astris-map-building-range-row"><RangeControl label="Висота будівель" value={settings.buildingScale} min={50} max={180} unit="%" onChange={(value) => patch({ buildingScale: value })} /><RangeControl label="Прозорість будівель" value={settings.buildingOpacity} min={35} max={100} unit="%" onChange={(value) => patch({ buildingOpacity: value })} /><RangeControl label="Мінімальний zoom" value={settings.buildingMinZoom} min={13} max={18} step={.1} onChange={(value) => patch({ buildingMinZoom: value })} /></div>
                <div className="astris-map-building-material-grid"><label><span>Матеріал</span><select value={settings.buildingPalette} onChange={(event) => patch({ buildingPalette: event.target.value })}><option value="adaptive">Авто під базовий шар</option><option value="standard">Vector Standard</option><option value="oled">OLED Slate</option><option value="cool">Холодний метал</option><option value="warm">Теплий камінь</option></select></label><label><span>Освітлення</span><select value={settings.buildingLighting} onChange={(event) => patch({ buildingLighting: event.target.value })}><option value="soft">Мʼяке операторське</option><option value="balanced">Збалансоване</option><option value="contrast">Контрастне</option></select></label></div>
                {settings.layer === 'ofmDark' ? <div className="astris-map-building-detail-mode" role="group"><button type="button" className={settings.buildingOccludesMapDetails ? 'active' : ''} onClick={() => patch({ buildingOccludesMapDetails: true })}>Ховати за 3D</button><button type="button" className={!settings.buildingOccludesMapDetails ? 'active' : ''} onClick={() => patch({ buildingOccludesMapDetails: false })}>Деталі поверх</button></div> : null}
                <div className="astris-map-building-options"><button type="button" className={settings.buildingAutoZoom ? 'active' : ''} onClick={() => patch({ buildingAutoZoom: !settings.buildingAutoZoom })}>Автонаведення {settings.buildingAutoZoom ? 'ON' : 'OFF'}</button><button type="button" onClick={() => mapRef.current?.ensureBuildingsVisible?.()}>Показати 3D</button><button type="button" onClick={() => patch({ buildingScale: 100, buildingOpacity: 92, buildingMinZoom: 14.6, buildingPalette: 'adaptive', buildingLighting: 'soft', buildingOccludesMapDetails: true, pitch3d: 56 })}>Рекомендований вигляд</button><button type="button" className="retry" onClick={() => mapRef.current?.retryBuildings?.()}>Перезавантажити 3D</button></div>
              </>}
            </div> : null}

            <div className="astris-map-marker-controls"><div className="astris-map-marker-control-head"><div><span aria-hidden="true">◎</span><span><b>Мітка спостерігача</b><small>Розміри нижче — базові; на карті маркер автоматично масштабується разом із zoom.</small></span></div><button type="button" onClick={() => patch({ observerCoreRadius: 9, observerHaloRadius: 24 })}>Скинути</button></div><div className="astris-map-marker-range-row"><RangeControl label="Основний круг" value={settings.observerCoreRadius} min={4} max={30} unit=" px" onChange={(value) => patch({ observerCoreRadius: value })} /><RangeControl label="Зовнішній ореол" value={settings.observerHaloRadius} min={0} max={64} unit=" px" onChange={(value) => patch({ observerHaloRadius: value })} /></div></div>
            {settings.terrain ? <RangeControl label="Рельєф" value={settings.terrainExaggeration} min={50} max={250} unit="%" onChange={(value) => patch({ terrainExaggeration: value })} /> : null}
            {(settings.buildings || settings.terrain) && !settings.globe ? <RangeControl label="Нахил камери" value={settings.pitch3d} min={0} max={78} unit="°" onChange={(value) => patch({ pitch3d: value })} /> : null}

            {settings.grid ? <div className="astris-map-graticule-settings"><div className="astris-map-graticule-row two"><label><span>Крок сітки</span><select value={settings.graticule.mode === 'auto' ? 'auto' : String(settings.graticule.step)} onChange={(event) => event.target.value === 'auto' ? patchGrid({ mode: 'auto' }) : patchGrid({ mode: 'manual', step: Number(event.target.value) })}><option value="auto">Автоматично за масштабом</option>{ASTRIS_GRATICULE_STEPS.map((step) => <option key={step} value={step}>{step}°</option>)}</select></label><label><span>Основна лінія</span><select value={settings.graticule.majorEvery} onChange={(event) => patchGrid({ majorEvery: Number(event.target.value) })}>{[2, 3, 4, 5, 6, 8, 10].map((value) => <option key={value} value={value}>кожна {value}-та</option>)}</select></label></div><div className="astris-map-graticule-row two"><label><span>Палітра</span><select value={settings.graticule.palette} onChange={(event) => patchGrid({ palette: event.target.value })}>{Object.entries(ASTRIS_GRATICULE_PALETTES).map(([key, value]) => <option key={key} value={key}>{value.label}</option>)}</select></label><button type="button" className={settings.graticule.labels ? 'active' : ''} onClick={() => patchGrid({ labels: !settings.graticule.labels })}>Координатні підписи {settings.graticule.labels ? 'ON' : 'OFF'}</button></div><RangeControl label="Прозорість тонких ліній" value={settings.graticule.opacity} min={8} max={100} unit="%" onChange={(value) => patchGrid({ opacity: value })} /><RangeControl label="Прозорість основних" value={settings.graticule.majorOpacity} min={15} max={100} unit="%" onChange={(value) => patchGrid({ majorOpacity: value })} /><RangeControl label="Товщина сітки" value={settings.graticule.lineWidth} min={.5} max={3} step={.1} unit=" px" onChange={(value) => patchGrid({ lineWidth: value })} /><RangeControl label="Товщина основних" value={settings.graticule.majorLineWidth} min={.8} max={4} step={.1} unit=" px" onChange={(value) => patchGrid({ majorLineWidth: value })} />{settings.graticule.labels ? <RangeControl label="Розмір координат" value={settings.graticule.labelSize} min={8} max={18} unit=" px" onChange={(value) => patchGrid({ labelSize: value })} /> : null}<p>Сітка WGS84: меридіани й паралелі привʼязані до реальних координат Землі.</p></div> : null}
          </Collapsible>

          <Collapsible className="astris-map-orbital-controls" title="Орбітальний шар" hint="SGP4 real-time • full orbit • coverage" open={settings.panelSections.orbital} onOpenChange={(open) => setSection('orbital', open)}>
            <div className="control-section-head is-master-only"><span>Renderer: {settings.globe ? 'GLOBE' : 'MERCATOR'} • native camera matrix • roll sync</span><button type="button" className={settings.orbitalOverlay.enabled ? 'master active' : 'master'} onClick={() => patchOrbital({ enabled: !settings.orbitalOverlay.enabled })}>{settings.orbitalOverlay.enabled ? 'ON' : 'OFF'}</button></div>
            <div className={`astris-map-orbital-mode-lock ${settings.globe ? 'is-globe-ready' : 'is-flat-ready'}`}><span>{settings.globe ? '🌍 GLOBE ORBIT' : '🗺️ 2D ORBIT'}</span><small>{settings.globe ? 'Піднята 3D-сцена: супутники, повні витки та лінії ASTRIS використовують camera matrix MapLibre.' : 'Mercator-огляд: повні витки стають коректними наземними трасами, а LOS — прямими відрізками.'}</small></div>
            <div className="astris-map-orbital-status"><span><b>{scene.visibleCount ?? 0}</b><small>над горизонтом</small></span><span><b>{scene.count ?? 0}</b><small>у сцені</small></span><span><b>{scene.tracks?.length || 0}</b><small>витків у кеші</small></span><span><b>{scene.latencyMs ?? '—'}</b><small>API latency ms</small></span><span><b>{runtime.orbitalRenderFps || 0}</b><small>render FPS</small></span><span><b>{scene.propagationStepMs ?? '—'}</b><small>SGP4 step ms</small></span></div>
            <SegmentedControl value={settings.orbitalOverlay.mode} ariaLabel="Фільтр орбітального шару" options={[{ value: 'visible', label: observer ? 'НАД ГОРИЗОНТОМ' : 'ГЛОБАЛЬНА СЦЕНА' }, { value: 'all', label: 'УСІ' }]} onChange={(mode) => patchOrbital({ mode })} />
            <div className="astris-map-orbital-options"><button type="button" className={settings.orbitalOverlay.labels ? 'active' : ''} onClick={() => patchOrbital({ labels: !settings.orbitalOverlay.labels })}>Підписи {settings.orbitalOverlay.labels ? 'ON' : 'OFF'}</button><button type="button" className={settings.orbitalOverlay.tracks ? 'active' : ''} onClick={() => patchOrbital({ tracks: !settings.orbitalOverlay.tracks, trackMode: 'full' })}>Повні орбіти {settings.orbitalOverlay.tracks ? 'ON' : 'OFF'}</button><button type="button" className={settings.orbitalOverlay.observerLinks ? 'active' : ''} onClick={() => patchOrbital({ observerLinks: !settings.orbitalOverlay.observerLinks })}>Лінії ASTRIS {settings.orbitalOverlay.observerLinks ? 'ON' : 'OFF'}</button><button type="button" className={settings.orbitalOverlay.coverage ? 'active' : ''} onClick={() => patchOrbital({ coverage: !settings.orbitalOverlay.coverage })}>Покриття {settings.orbitalOverlay.coverage ? 'ON' : 'OFF'}</button></div>
            {settings.orbitalOverlay.observerLinks ? <SegmentedControl value={settings.orbitalOverlay.observerLinkMode} ariaLabel="Режим LOS ліній ASTRIS" options={[{ value: 'physical', label: 'ФІЗИЧНИЙ LOS' }, { value: 'legacy-scale', label: 'СТАРИЙ ПРЯМИЙ' }]} onChange={(observerLinkMode) => patchOrbital({ observerLinkMode })} /> : null}
            <div className="astris-map-space-background-options"><button type="button" disabled={!settings.globe} className={settings.orbitalOverlay.spaceBackgroundMode === 'off' ? 'active' : ''} onClick={() => patchOrbital({ spaceBackgroundMode: 'off', spaceBackground: false })}>Космос OFF</button><button type="button" disabled={!settings.globe} className={settings.orbitalOverlay.spaceBackgroundMode === 'synthetic' ? 'active' : ''} onClick={() => patchOrbital({ spaceBackgroundMode: 'synthetic', spaceBackground: true })}>Симуляція</button></div>
            <small className="astris-map-space-attribution">Локальне небо ASTRIS • рухається разом із центром, нахилом і поворотом карти{Number.isFinite(Number(runtime.solarLongitudeDeg)) ? ` • Сонце UTC ${formatNumber(runtime.solarLatitudeDeg, 1)}°, ${formatNumber(runtime.solarLongitudeDeg, 1)}°` : ''}</small>
            <div className="astris-map-orbital-constellations">{FILTER_ORDER.map((key) => { const active = settings.orbitalOverlay.selected[key]; const meta = CONSTELLATION_META[key]; return <button key={key} type="button" className={active ? 'active' : 'inactive'} onClick={() => toggleConstellation(key)} style={{ '--constellation-color': meta.color }}><i /><span>{active ? '✓' : '○'} {meta.label}</span><b>{counts[key] || 0}</b></button>; })}</div>
            <div className="astris-map-orbital-filter-summary"><small>Відображаються системи</small><b>{enabled.length ? enabled.join(' · ') : 'ЖОДНА'}</b></div>
            {selected ? <div className="astris-map-orbital-selected-card" style={{ '--constellation-color': CONSTELLATION_META[selected.constellation]?.color || '#94a3b8' }}><div><small>Вибраний супутник</small><b>{selected.objectName}</b><span>{selected.constellation} • NORAD {selected.noradId}</span></div><dl><div><dt>Висота</dt><dd>{formatNumber(selected.altitudeKm, 0)} km</dd></div><div><dt>Азимут</dt><dd>{formatNumber(selected.azimuthDeg, 1)}°</dd></div><div><dt>Elevation</dt><dd>{formatNumber(selected.elevationDeg, 1)}°</dd></div><div><dt>Швидкість</dt><dd>{formatNumber(selected.velocityKmS, 2)} km/s</dd></div><div><dt>Дальність</dt><dd>{formatNumber(selected.rangeKm, 0)} km</dd></div><div><dt>LOS</dt><dd>{selectedAboveHorizon === true ? 'VISIBLE' : selectedAboveHorizon === false ? 'BELOW' : 'N/A'}</dd></div></dl><button type="button" className={settings.orbitalOverlay.selectedCoverage ? 'active' : ''} onClick={() => patchOrbital({ selectedCoverage: !settings.orbitalOverlay.selectedCoverage })}>Покриття вибраного {settings.orbitalOverlay.selectedCoverage ? 'ON' : 'OFF'}</button><button type="button" onClick={() => onSelect(null)}>Скинути вибір</button></div> : <div className="astris-map-orbital-pick-hint">Натисни на супутник або знайди його за назвою/NORAD ID — зʼявиться детальна картка, виділений виток і coverage.</div>}

            <RangeControl label={`Масштаб висоти — ${settings.orbitalOverlay.altitudeScale === 100 ? 'фізичний' : settings.orbitalOverlay.altitudeScale === 0 ? 'на поверхні' : 'компактний'}`} value={settings.orbitalOverlay.altitudeScale} min={0} max={100} unit="%" onChange={(value) => patchOrbital({ altitudeScale: value })} />
            <p className="astris-map-orbital-note is-los-note">{settings.orbitalOverlay.observerLinkMode === 'legacy-scale' ? 'Старий прямий режим веде відрізок до візуально стиснутої висоти.' : '100% — реальна висота; 0–99% — компактна сцена. Фізичний LOS рахується за WGS84 і реальною висотою.'}</p>

            <div className="astris-map-orbital-advanced">
              <div className="astris-map-subsection-title"><Menu size={13} /><span>Рух і оновлення</span></div>
              <RangeControl label="Частота рендера" value={settings.orbitalOverlay.renderFps} min={10} max={60} step={5} unit=" FPS" onChange={(value) => patchOrbital({ renderFps: value })} hint="Цільовий FPS клієнтського interpolation renderer. Для великого Starlink набору runtime може застосувати safety cap." />
              <RangeControl label="Згладжування руху" value={settings.orbitalOverlay.smoothingMs} min={0} max={250} step={5} unit=" ms" onChange={(value) => patchOrbital({ smoothingMs: value })} hint="У v0.1.6 це запас прогнозного keyframe для безшовного переходу. Позиція супутника більше не low-pass відстає від орбіти." />
              <RangeControl label="Оновлення SGP4 сцени" value={settings.orbitalOverlay.refreshMs} min={300} max={5000} step={100} unit=" ms" onChange={(value) => patchOrbital({ refreshMs: value })} />
              <RangeControl label="Крок keyframe" value={settings.orbitalOverlay.interpolationStepMs} min={100} max={5000} step={100} unit=" ms" onChange={(value) => patchOrbital({ interpolationStepMs: value })} />
              <RangeControl label="Оновлення орбіт" value={settings.orbitalOverlay.tracksRefreshMs} min={15000} max={180000} step={5000} unit=" ms" onChange={(value) => patchOrbital({ tracksRefreshMs: value })} />
              <SegmentedControl value={settings.orbitalOverlay.trackMode} ariaLabel="Режим орбітального треку" options={[{ value: 'full', label: 'ПОВНИЙ ВИТОК' }, { value: 'window', label: 'ЧАСОВЕ ВІКНО' }]} onChange={(trackMode) => patchOrbital({ trackMode })} />
              {settings.orbitalOverlay.trackMode === 'window' ? <RangeControl label="Вікно орбіти" value={settings.orbitalOverlay.trackMinutes} min={5} max={1440} step={5} unit=" хв" onChange={(value) => patchOrbital({ trackMinutes: value })} /> : null}
              <RangeControl label="Крок точок орбіти" value={settings.orbitalOverlay.trackStepMinutes} min={1} max={30} unit=" хв" onChange={(value) => patchOrbital({ trackStepMinutes: value })} />
              <RangeControl label="Кількість витків" value={settings.orbitalOverlay.trackLimit} min={1} max={250} unit="" onChange={(value) => patchOrbital({ trackLimit: value })} />
              <RangeControl label="Ліміт сцени" value={settings.orbitalOverlay.limit} min={250} max={20000} step={250} unit="" onChange={(value) => patchOrbital({ limit: value })} />
            </div>

            <RangeControl label="Мінімальна висота" value={settings.orbitalOverlay.horizonDeg} min={-10} max={30} unit="°" onChange={(value) => patchOrbital({ horizonDeg: value })} />
            {(settings.orbitalOverlay.coverage || settings.orbitalOverlay.selectedCoverage) ? <><RangeControl label="Мінімальний кут покриття" value={settings.orbitalOverlay.coverageMinElevationDeg} min={0} max={30} unit="°" onChange={(value) => patchOrbital({ coverageMinElevationDeg: value })} /><RangeControl label="Прозорість покриття" value={settings.orbitalOverlay.coverageOpacity} min={4} max={60} unit="%" onChange={(value) => patchOrbital({ coverageOpacity: value })} /><RangeControl label="Підняття coverage" value={settings.orbitalOverlay.coverageLiftKm} min={0} max={.25} step={.01} unit=" km" onChange={(value) => patchOrbital({ coverageLiftKm: value })} /></> : null}
            <RangeControl label="Розмір середини" value={settings.orbitalOverlay.pointRadius} min={3} max={18} unit=" px" onChange={(value) => patchOrbital({ pointRadius: value })} />
            <RangeControl label="Ширина обрамлення" value={settings.orbitalOverlay.signalRingWidth} min={1} max={8} unit=" px" onChange={(value) => patchOrbital({ signalRingWidth: value })} />
            <RangeControl label="Радіус glow" value={settings.orbitalOverlay.glowRadius} min={0} max={18} unit=" px" onChange={(value) => patchOrbital({ glowRadius: value })} />
            <RangeControl label="Яскравість glow" value={settings.orbitalOverlay.glowOpacity} min={0} max={80} unit="%" onChange={(value) => patchOrbital({ glowOpacity: value })} />
            <RangeControl label="Прозорість" value={settings.orbitalOverlay.opacity} min={20} max={100} unit="%" onChange={(value) => patchOrbital({ opacity: value })} />
            <div className="astris-map-orbital-reset-row"><button type="button" onClick={() => patchOrbital({ ...defaultOrbitalOverlaySettings(), selected: { ...settings.orbitalOverlay.selected } })}>Скинути orbital tuning</button></div>
            <p className="astris-map-orbital-note">Колір супутника і його підпису означає систему/каталог. Повні витки кешуються окремо від SGP4 keyframes. ASTRIS не переносить робототехнічні GSV/SNR, LiDAR чи сенсорні шари IRMAS.</p>
          </Collapsible>
        </aside>
      </div>
      <footer className="astris-map-native-meta">
        <span>{layer?.label || settings.layer} • {settings.globe ? 'GLOBE' : settings.buildings || settings.terrain ? '3D' : '2D'} • orbital {settings.orbitalOverlay.enabled ? `${scene.count || 0} / ${runtime.orbitalRenderFps || 0} FPS` : 'OFF'}</span>
        <span className={observer ? 'map-position-fix' : 'map-position-tentative'}>{observer ? `${observer.source === 'manual' ? 'MANUAL' : 'IP'} • ${formatNumber(observer.lat, 5)}°, ${formatNumber(observer.lon, 5)}°` : 'OBSERVER OFFLINE'}</span>
        <span>{scene.phase === 'error' ? `SCENE ERROR • ${scene.error || 'unknown'}` : `SGP4 ${scene.propagationStepMs ?? '—'} ms • API ${scene.latencyMs ?? '—'} ms • tracks ${scene.tracks?.length || 0}`}</span>
      </footer>
    </section>
  );
}
