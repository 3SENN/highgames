#!/usr/bin/env node
// npm run dev: builds the pack and keeps building it as files change, and runs it in the Atelier emulator, which reloads
// the big screen after each build (phones reconnect by themselves). The same pack/ folder works in Atelier itself:
// Packs › Add › Load a folder… › pack/ runs it straight from disk and reloads it the same way.
import { buildPack } from './build.mjs';
import { startEmulator } from './emulator.mjs';

await buildPack({ watch: true, quiet: true });
const emulator = await startEmulator({
  watch: true,
  port: Number(process.env.PORT) || 8443,
  phonePort: Number(process.env.PHONE_PORT) || undefined,
});
console.info('  Watching src/: the big screen reloads after each build. In Atelier: Packs › Add › Load a folder… › pack/\n');
const stop = () => void emulator.close().then(() => process.exit(0));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
