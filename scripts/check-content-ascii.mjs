import { readFileSync } from 'node:fs';

const outputRoot = '.output/chrome-mv3';
const manifest = JSON.parse(readFileSync(`${outputRoot}/manifest.json`, 'utf8'));
const contentScripts = manifest.content_scripts?.flatMap((script) => script.js || []) || [];
if (contentScripts.length === 0) throw new Error('Manifest declares no content-script JavaScript');

for (const contentScript of contentScripts) {
  const path = `${outputRoot}/${contentScript}`;
  const bytes = readFileSync(path);
  const index = bytes.findIndex((byte) => byte > 0x7f);
  if (index >= 0) {
    throw new Error(`${path} contains a non-ASCII byte at offset ${index}`);
  }
  console.log(`${path}: ASCII only`);
}
