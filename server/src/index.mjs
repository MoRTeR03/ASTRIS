import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';
import cors from 'cors';
import { createCatalogService } from './services/catalog-service.mjs';
import { createIpLocationService } from './services/ip-location-service.mjs';
import { createProfileService } from './services/profile-service.mjs';
import { createApiRouter } from './routes/api.routes.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const PORT = Number(process.env.ASTRIS_PORT || 3101);
const HOST = process.env.ASTRIS_HOST || '0.0.0.0';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(cors({ origin: true }));
app.use(express.json({ limit: '64kb' }));

function defaultPersistentCacheDir() {
  if (process.env.ASTRIS_CACHE_DIR) return path.resolve(process.env.ASTRIS_CACHE_DIR);
  if (process.platform === 'win32') {
    return path.join(process.env.LOCALAPPDATA || os.homedir(), 'ASTRIS', 'cache');
  }
  if (process.platform === 'darwin') return path.join(os.homedir(), 'Library', 'Caches', 'ASTRIS');
  return path.join(os.homedir(), '.cache', 'astris');
}

const persistentCacheDir = defaultPersistentCacheDir();
const serverRoot = path.resolve(__dirname, '..');
const projectCacheDir = path.join(serverRoot, 'cache');
const catalogService = createCatalogService({
  cacheDir: persistentCacheDir,
  fallbackCacheDirs: [projectCacheDir],
});
const ipLocationService = createIpLocationService({ cacheDir: persistentCacheDir });
const profileService = createProfileService({ dataDir: path.join(serverRoot, 'data') });
app.use(createApiRouter({ catalogService, ipLocationService, profileService }));

app.use((error, _req, res, _next) => {
  console.error('[ASTRIS]', error);
  res.status(500).json({ ok: false, error: 'INTERNAL_ERROR', message: 'Unexpected server error' });
});

const httpServer = app.listen(PORT, HOST, () => {
  console.log(`ASTRIS server: http://localhost:${PORT}`);
  console.log('Catalogs: CelesTrak OMM/JSON → Satvisor mirror fallback → persistent cache + failure backoff');
  console.log(`Catalog cache: ${persistentCacheDir}`);
  console.log('Observer: approximate IP geolocation via ipapi.co; manual override available in UI');
  console.log(`Profiles: ${profileService.filePath}`);
});

httpServer.on('error', (error) => {
  if (error?.code === 'EADDRINUSE') {
    console.error(`[ASTRIS] Port ${PORT} is already in use. Stop the conflicting service or set ASTRIS_PORT to another free port.`);
  } else {
    console.error('[ASTRIS] HTTP server failed:', error);
  }
  process.exitCode = 1;
});
