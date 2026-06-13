import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

// In dev, proxy the backend API routes to the FastAPI server on :8000.
const API_ROUTES = ['/auth', '/projects', '/static'];

export default defineConfig({
  plugins: [react(), tailwindcss()],
  build: { outDir: 'dist' },
  server: {
    proxy: Object.fromEntries(API_ROUTES.map((route) => [route, 'http://localhost:8000'])),
  },
  test: {
    environment: 'jsdom',
    // A concrete origin (not the opaque about:blank default) so localStorage
    // is available to tests that exercise the token store.
    environmentOptions: { jsdom: { url: 'http://localhost' } },
    globals: true,
    setupFiles: './src/test/setup.ts',
  },
});
