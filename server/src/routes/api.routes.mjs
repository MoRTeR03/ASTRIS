import express from 'express';
import { parseCatalogRefreshQuery, parseSceneQuery, parseSearchQuery, RequestValidationError } from './query-validation.mjs';

function safeServiceMessage(error, fallback = 'Service temporarily unavailable') {
  const raw = String(error?.message || error || '').trim();
  if (!raw) return fallback;
  const text = raw
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style\b[^>]*>[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;|&#160;/gi, ' ')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .replace(/&amp;/gi, '&')
    .replace(/\s+/g, ' ')
    .trim();
  return (text || fallback).slice(0, 420);
}

function sendRouteError(res, error, serviceError, catalogService) {
  if (error instanceof RequestValidationError) {
    res.status(400).json({ ok: false, error: 'INVALID_REQUEST', message: error?.message || String(error) });
    return;
  }
  const retryAfterMs = Math.max(0, Number(error?.retryAfterMs) || 0);
  if (retryAfterMs > 0) res.setHeader('Retry-After', String(Math.max(1, Math.ceil(retryAfterMs / 1000))));
  res.status(503).json({
    ok: false,
    error: serviceError,
    message: safeServiceMessage(error),
    catalog: error?.catalog || null,
    upstreamStatus: Number.isFinite(Number(error?.upstreamStatus)) ? Number(error.upstreamStatus) : null,
    retryAfterMs,
    catalogs: catalogService?.status?.(),
  });
}

export function createApiRouter({ catalogService, ipLocationService, profileService }) {
  const router = express.Router();

  router.get('/api/health', (_req, res) => {
    res.json({ ok: true, product: 'ASTRIS', version: '0.2.0', now: new Date().toISOString() });
  });


  router.get('/api/profiles', async (_req, res) => {
    try { res.json({ ok: true, profiles: await profileService.list() }); }
    catch (error) { res.status(500).json({ ok: false, error: 'PROFILE_LIST_FAILED', message: error?.message || String(error) }); }
  });

  router.get('/api/profiles/export', async (_req, res) => {
    try {
      const store = await profileService.exportStore();
      res.setHeader('Content-Disposition', 'attachment; filename="astris-profiles.json"');
      res.json(store);
    } catch (error) { res.status(500).json({ ok: false, error: 'PROFILE_EXPORT_FAILED', message: error?.message || String(error) }); }
  });

  router.get('/api/profiles/:name', async (req, res) => {
    try {
      const profile = await profileService.get(req.params.name);
      if (!profile) { res.status(404).json({ ok: false, error: 'PROFILE_NOT_FOUND' }); return; }
      res.json({ ok: true, profile });
    } catch (error) { res.status(400).json({ ok: false, error: 'INVALID_PROFILE', message: error?.message || String(error) }); }
  });

  router.put('/api/profiles/:name', async (req, res) => {
    try {
      const profile = await profileService.save(req.params.name, req.body || {});
      res.json({ ok: true, profile });
    } catch (error) { res.status(400).json({ ok: false, error: 'PROFILE_SAVE_FAILED', message: error?.message || String(error) }); }
  });

  router.delete('/api/profiles/:name', async (req, res) => {
    try {
      const removed = await profileService.remove(req.params.name);
      res.status(removed ? 200 : 404).json({ ok: removed, removed });
    } catch (error) { res.status(400).json({ ok: false, error: 'PROFILE_DELETE_FAILED', message: error?.message || String(error) }); }
  });

  router.get('/api/location', async (req, res) => {
    try {
      res.json({ ok: true, location: await ipLocationService.resolve(req) });
    } catch (error) {
      res.status(503).json({ ok: false, error: 'IP_LOCATION_UNAVAILABLE', message: error?.message || String(error) });
    }
  });

  router.get('/api/catalog/status', (_req, res) => {
    res.json({ ok: true, catalogs: catalogService.status() });
  });

  router.post('/api/catalog/refresh', async (req, res) => {
    try {
      const requested = parseCatalogRefreshQuery(req.query);
      res.json({ ok: true, catalogs: await catalogService.refreshCatalogs(requested) });
    } catch (error) {
      sendRouteError(res, error, 'CATALOG_REFRESH_FAILED', catalogService);
    }
  });


  router.get('/api/orbits/search', async (req, res) => {
    try {
      const query = parseSearchQuery(req.query);
      res.json({ ok: true, rows: await catalogService.search(query) });
    } catch (error) {
      sendRouteError(res, error, 'ORBITAL_SEARCH_FAILED', catalogService);
    }
  });

  router.get('/api/orbits/scene', async (req, res) => {
    try {
      const result = await catalogService.scene(parseSceneQuery(req.query));
      res.json({ ok: true, ...result });
    } catch (error) {
      sendRouteError(res, error, 'ORBITAL_SCENE_FAILED', catalogService);
    }
  });

  return router;
}
