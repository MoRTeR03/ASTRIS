import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const clientPort = Number(process.env.ASTRIS_CLIENT_PORT || 5174);
const apiPort = Number(process.env.ASTRIS_PORT || 3101);
const apiTarget = process.env.ASTRIS_API_TARGET || `http://127.0.0.1:${apiPort}`;

export default defineConfig({
  plugins: [react()],
  server: {
    port: clientPort,
    strictPort: true,
    host: '0.0.0.0',
    proxy: {
      '/api': {
        target: apiTarget,
        changeOrigin: true,
      },
    },
  },
});
