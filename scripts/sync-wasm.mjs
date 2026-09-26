// Copies the pinned manifold-3d WASM binary into public/ so the worker can
// instantiate it with { wasmBinary } regardless of bundler asset resolution.
import { copyFileSync, mkdirSync, statSync } from 'node:fs';

mkdirSync('public', { recursive: true });
copyFileSync('node_modules/manifold-3d/manifold.wasm', 'public/manifold.wasm');
const kb = Math.round(statSync('public/manifold.wasm').size / 1024);
console.log(`[sync-wasm] public/manifold.wasm updated (${kb} KB)`);
