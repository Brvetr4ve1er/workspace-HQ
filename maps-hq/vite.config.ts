import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// Served by WorkspaceHQ's local bridge under /world/ (dashboard/world-routes.js), so every asset path starts there.
export default defineConfig({
  base: '/world/',
  plugins: [react()],
  server: { port: 5178 },
  build: { chunkSizeWarningLimit: 1500 },
});
