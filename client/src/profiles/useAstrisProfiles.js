import { useCallback, useEffect, useState } from 'react';

async function readJson(response) {
  const payload = await response.json();
  if (!response.ok || payload?.ok === false) throw new Error(payload?.message || payload?.error || `HTTP ${response.status}`);
  return payload;
}

export function useAstrisProfiles() {
  const [profiles, setProfiles] = useState([]);
  const [phase, setPhase] = useState('idle');
  const [error, setError] = useState('');

  const refresh = useCallback(async () => {
    setPhase('loading'); setError('');
    try {
      const payload = await readJson(await fetch('/api/profiles', { cache: 'no-store' }));
      setProfiles(Array.isArray(payload.profiles) ? payload.profiles : []);
      setPhase('ready');
      return payload.profiles || [];
    } catch (reason) {
      setPhase('error'); setError(reason?.message || String(reason));
      return [];
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);

  const load = useCallback(async (name) => {
    const payload = await readJson(await fetch(`/api/profiles/${encodeURIComponent(name)}`, { cache: 'no-store' }));
    return payload.profile;
  }, []);

  const save = useCallback(async (name, snapshot) => {
    setPhase('saving'); setError('');
    try {
      const payload = await readJson(await fetch(`/api/profiles/${encodeURIComponent(name)}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(snapshot),
      }));
      await refresh();
      setPhase('ready');
      return payload.profile;
    } catch (reason) {
      setPhase('error'); setError(reason?.message || String(reason));
      throw reason;
    }
  }, [refresh]);

  const remove = useCallback(async (name) => {
    setPhase('saving'); setError('');
    try {
      await readJson(await fetch(`/api/profiles/${encodeURIComponent(name)}`, { method: 'DELETE' }));
      await refresh();
      setPhase('ready');
    } catch (reason) {
      setPhase('error'); setError(reason?.message || String(reason));
      throw reason;
    }
  }, [refresh]);

  return { profiles, phase, error, refresh, load, save, remove };
}
