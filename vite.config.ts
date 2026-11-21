// The big screen: the Atelier app's page (pack/app, the app's `root` in atelier-pack.json). vite.phone.config.ts builds
// the controller page into pack/app/phone; scripts/atelier/build.mjs runs both and writes the pack around them.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { fromKit } from './vite.kit';

const here = (file: string) => fileURLToPath(new URL(file, import.meta.url));

export default defineConfig({
  // Relative addresses: the app works wherever Atelier serves it, and in the dev emulator.
  base: './',
  publicDir: 'public',
  build: {
    outDir: here('./pack/app'),
    // The phone build writes into pack/app/phone; scripts/atelier/build.mjs empties pack/ before a full build.
    emptyOutDir: false,
    target: 'es2022',
    // three.js comes from the Atelier kit, so what's left is the game's own code: one chunk that Atelier reads from disk
    // and compiles once (its atelier-pack scheme has V8's code cache).
    chunkSizeWarningLimit: 4096,
    rollupOptions: {
      input: { tv: here('./index.html') },
      external: fromKit,
    },
  },
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
  },
});
