export const CONSTELLATION_META = Object.freeze({
  GPS: { label: 'GPS', color: '#60a5fa' },
  GLONASS: { label: 'GLONASS', color: '#fb923c' },
  GALILEO: { label: 'Galileo', color: '#34d399' },
  BEIDOU: { label: 'BeiDou', color: '#facc15' },
  QZSS: { label: 'QZSS', color: '#c084fc' },
  SBAS: { label: 'SBAS', color: '#f472b6' },
  STARLINK: { label: 'Starlink', color: '#22d3ee' },
  OTHER: { label: 'Other', color: '#94a3b8' },
});

export function colorFor(row) {
  return CONSTELLATION_META[row?.constellation]?.color || CONSTELLATION_META.OTHER.color;
}
