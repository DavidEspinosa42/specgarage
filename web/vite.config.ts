import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const here = dirname(fileURLToPath(import.meta.url));

// The built interface is served by `specgarage serve` from dist/web.
export default defineConfig({
  root: here,
  plugins: [react()],
  build: {
    outDir: resolve(here, '..', 'dist', 'web'),
    emptyOutDir: true,
    target: 'es2022',
  },
});
