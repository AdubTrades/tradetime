import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  // Error reports name the deployed commit (Vercel sets VERCEL_GIT_COMMIT_SHA during the build).
  define: { 'import.meta.env.VITE_RELEASE': JSON.stringify(process.env.VERCEL_GIT_COMMIT_SHA?.slice(0, 12) ?? '') },
  // A ~230 KB gzipped main bundle is fine; charts load separately.
  build: { chunkSizeWarningLimit: 800 },
  server: {
    host: '127.0.0.1',
    port: 5173,
    // Keep the browser's Host header: with sign-in on, the API only accepts changes whose Origin matches it.
    proxy: { '/api': { target: 'http://127.0.0.1:4318', changeOrigin: false } },
  },
});
