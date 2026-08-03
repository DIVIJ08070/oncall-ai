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
  // Force IPv4: Node 18+ resolves `localhost` to IPv6 `::1` first, but the platform
  // binds IPv4 (0.0.0.0), so a `localhost` proxy target fails with ECONNREFUSED ::1.
  const target = (env.PUBLIC_BASE_URL || 'http://localhost:3001').replace('localhost', '127.0.0.1');
  return {
    plugins: [react()],
    envPrefix: ['VITE_', 'PUBLIC_'],
    server: {
      port: 5173,
      strictPort: false,
      // Allow sharing the dev server over VS Code dev tunnels / ngrok (any
      // `*.devtunnels.ms` subdomain). Vite 5.4 otherwise blocks non-localhost
      // Host headers with "This host is not allowed".
      allowedHosts: ['.devtunnels.ms'],
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
