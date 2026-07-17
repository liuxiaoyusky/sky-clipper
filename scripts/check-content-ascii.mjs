import { readFileSync } from 'node:fs';

const path = '.output/chrome-mv3/content-scripts/content.js';
const bytes = readFileSync(path);
const index = bytes.findIndex((byte) => byte > 0x7f);
if (index >= 0) {
  throw new Error(`${path} contains a non-ASCII byte at offset ${index}`);
}
console.log(`${path}: ASCII only`);
