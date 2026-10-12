import { defineConfig } from 'vite';

export default defineConfig({
  root: 'client',
  publicDir: false,
  build: {
    outDir: '../dist/client',
    emptyOutDir: true,
    chunkSizeWarningLimit: 1200,
    // Models are fetched by the loaders, and the CSP's connect-src blocks data: URLs: never inline them.
    assetsInlineLimit: (file) => (/\.(glb|hdr|webp)$/.test(file) ? false : undefined),
  },
  server: {
    host: '127.0.0.1',
    proxy: { '/ws': { target: 'ws://127.0.0.1:3000', ws: true } },
  },
});
