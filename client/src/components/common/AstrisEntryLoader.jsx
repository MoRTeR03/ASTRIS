import { useEffect, useRef, useState } from 'react';
import { Orbit } from 'lucide-react';

const MIN_VISIBLE_MS = 2850;
const MAX_VISIBLE_MS = 8400;
const EXIT_MS = 380;

export default function AstrisEntryLoader({ ready = false }) {
  const startedAtRef = useRef(Date.now());
  const [phase, setPhase] = useState('visible');

  useEffect(() => {
    if (phase !== 'visible') return undefined;
    const elapsed = Date.now() - startedAtRef.current;
    const wait = ready ? Math.max(0, MIN_VISIBLE_MS - elapsed) : Math.max(0, MAX_VISIBLE_MS - elapsed);
    const timer = window.setTimeout(() => setPhase('leaving'), wait);
    return () => window.clearTimeout(timer);
  }, [ready, phase]);

  useEffect(() => {
    if (phase !== 'leaving') return undefined;
    const timer = window.setTimeout(() => setPhase('gone'), EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);

  if (phase === 'gone') return null;

  return (
    <div className={`astris-entry-loader ${phase === 'leaving' ? 'is-leaving' : ''}`} role="status" aria-live="polite" aria-label="ASTRIS завантажується">
      <div className="astris-entry-loader__stars" aria-hidden="true" />
      <div className="astris-entry-loader__lockup">
        <div className="astris-entry-loader__glyph" aria-hidden="true">
          <span className="astris-entry-loader__orbit-ring" />
          <Orbit size={62} strokeWidth={1.65} />
          <i className="astris-entry-loader__satellite" />
        </div>
        <div className="astris-entry-loader__wordmark">ASTRIS</div>
        <div className="astris-entry-loader__subtitle">Advanced Satellite Tracking & Real-time Interactive System</div>
        <div className="astris-entry-loader__progress" aria-hidden="true"><i /></div>
        <small>Завантаження орбітальної сцени</small>
      </div>
    </div>
  );
}
