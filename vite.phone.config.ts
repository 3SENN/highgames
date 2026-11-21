// The phone controller page, built into pack/app/phone: the folder Atelier's web server for the game serves to phones
// (atelier.server.start({ root: 'app/phone' }) in src/tv/net.ts). Its addresses sit under the server's token, so
// everything is relative, and three.js and the companion runtime come from the kit the server serves beside it.
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { fromKit } from './vite.kit';

const here = (file: string) => fileURLToPath(new URL(file, import.meta.url));

export default defineConfig({
  root: here('./src/phone'),
  base: './',
  publicDir: false,
  build: {
    outDir: here('./pack/app/phone'),
    emptyOutDir: true,
    target: 'es2022',
    rollupOptions: { external: fromKit },
  },
});
