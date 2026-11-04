import { defineConfig } from 'vite';

export default defineConfig({
  base: './',
  build: {
    target: 'es2022',
    outDir: 'dist',
    assetsDir: 'assets',
    sourcemap: false,
    chunkSizeWarningLimit: 1500,
    // The project has no dynamic imports, so the modulepreload polyfill is dead
    // weight — and it is the only thing in the bundle that would issue a network
    // request at runtime. Disabling it keeps the "zero network calls" promise
    // literally true, which `scripts/selfcontained-check.mjs` then enforces.
    modulePreload: { polyfill: false },
    rollupOptions: {
      output: {
        manualChunks: {
          three: ['three'],
        },
      },
    },
  },
  server: {
    host: '127.0.0.1',
    port: 5173,
  },
  preview: {
    host: '127.0.0.1',
    port: 4173,
  },
});
