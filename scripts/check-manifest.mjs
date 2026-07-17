import { readFileSync } from 'node:fs';

const path = '.output/chrome-mv3/manifest.json';
const manifest = JSON.parse(readFileSync(path, 'utf8'));
const expectedPermissions = ['downloads', 'offscreen', 'storage'].sort();
const actualPermissions = [...(manifest.permissions || [])].sort();

if (manifest.name !== 'Fin-report-clipper') throw new Error('Unexpected extension name');
if (manifest.minimum_chrome_version !== '116') throw new Error('Unexpected Chrome floor');
if (JSON.stringify(actualPermissions) !== JSON.stringify(expectedPermissions)) {
  throw new Error(`Unexpected permissions: ${actualPermissions.join(',')}`);
}
if (JSON.stringify(manifest.host_permissions) !== JSON.stringify(['https://rsch.baml.com/*'])) {
  throw new Error('Unexpected host permissions');
}
const matches = manifest.content_scripts?.flatMap((script) => script.matches || []) || [];
if (JSON.stringify(matches) !== JSON.stringify(['https://rsch.baml.com/*'])) {
  throw new Error(`Unexpected content-script matches: ${matches.join(',')}`);
}
const serialized = JSON.stringify(manifest);
for (const forbidden of [
  '<all_urls>',
  'identity',
  'contextMenus',
  'icons',
  'options_page',
  'options_ui',
  'commands',
]) {
  if (serialized.includes(forbidden)) throw new Error(`Forbidden manifest capability: ${forbidden}`);
}
console.log(`${path}: Fin-report-clipper Chrome manifest verified`);
