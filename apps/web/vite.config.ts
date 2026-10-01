import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Served from your own Mac, so a ~200 KB gzipped main bundle is fine; charts load separately.
  build: { chunkSizeWarningLimit: 800 },
  server: {
    host: '127.0.0.1',
    port: 5173,
    proxy: { '/api': 'http://127.0.0.1:4318' },
  },
});
