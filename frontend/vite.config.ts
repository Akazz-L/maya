import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// In dev, proxy the backend API routes to the FastAPI server. It listens on
// :8000 unless BACKEND_PORT says otherwise, which is how a second checkout runs
// alongside the first without either claiming the other's port.
const API_ROUTES = ['/auth', '/me', '/agents', '/projects', '/static'];
const BACKEND = `http://localhost:${process.env.BACKEND_PORT ?? 8000}`;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { outDir: 'dist' },
  server: {
    proxy: Object.fromEntries(API_ROUTES.map((route) => [route, BACKEND])),
  },
  test: {
    environment: 'jsdom',
    // A concrete origin (not the opaque about:blank default) so localStorage
    // is available to tests that exercise the token store.
    environmentOptions: { jsdom: { url: 'http://localhost' } },
    // Node 25+ ships its own global localStorage, which shadows jsdom's and
    // warns on every access unless given a backing file. Tests want jsdom's.
    execArgv: ['--no-experimental-webstorage'],
    globals: true,
    setupFiles: './src/test/setup.ts',
  },
});
