import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

/**
 * Vite config for the OnCall AI dashboard (SPEC §2/§6).
 *
 * `envPrefix` exposes `PUBLIC_*` env vars to the client (SPEC §6/§14:
 * `PUBLIC_BASE_URL`, default `http://localhost:3001`) alongside Vite's `VITE_*`.
 *
 * Dev server runs on 5173 and **proxies `/api` to the platform** (`PUBLIC_BASE_URL`,
 * default `http://localhost:3001`). Proxying keeps the browser same-origin, so both
 * fetch and — crucially — the SSE streams (`/logs/stream`, and C13's feed/chat) work
 * without CORS: the platform's hijacked SSE responses don't emit CORS headers, so a
 * same-origin proxy is the clean dev path. A production build calls `PUBLIC_BASE_URL`
 * directly (serve the dashboard same-origin with the platform, or add CORS there).
 */
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), ['PUBLIC_', 'VITE_']);
  const target = env.PUBLIC_BASE_URL || 'http://localhost:3001';
  return {
    plugins: [react()],
    envPrefix: ['VITE_', 'PUBLIC_'],
    server: {
      port: 5173,
      strictPort: false,
      proxy: {
        '/api': {
          target,
          changeOrigin: true,
        },
      },
    },
    build: {
      target: 'es2022',
      sourcemap: true,
    },
  };
});
