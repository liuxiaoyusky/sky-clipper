import { readFileSync } from 'node:fs';

const outputRoot = process.argv[2] || '.output/chrome-mv3';
const path = `${outputRoot}/manifest.json`;
const manifest = JSON.parse(readFileSync(path, 'utf8'));
const expectedPermissions = ['alarms', 'downloads', 'offscreen', 'storage'].sort();
const actualPermissions = [...(manifest.permissions || [])].sort();
const expectedHosts = ['https://rsch.baml.com/*', 'https://markets.ml.com/*', 'https://x.com/*', 'https://twitter.com/*', 'https://pbs.twimg.com/*', 'https://mp.weixin.qq.com/*', 'https://mmbiz.qpic.cn/*', 'https://mmbiz.qlogo.cn/*', 'https://www.bilibili.com/*', 'https://api.bilibili.com/*', 'https://aisubtitle.hdslb.com/*', 'https://i0.hdslb.com/*', 'https://i1.hdslb.com/*', 'https://i2.hdslb.com/*'];
const expectedContentScriptMatches = [
  'https://rsch.baml.com/*',
  'https://markets.ml.com/researchlibrary/advancedsearch*',
  'https://x.com/*',
  'https://twitter.com/*',
  'https://mp.weixin.qq.com/s*',
  'https://www.bilibili.com/video/*',
];
const expectedContentScriptJs = [
  'content-scripts/content.js',
  'content-scripts/markets-today.js',
  'content-scripts/x.js',
  'content-scripts/wechat.js',
  'content-scripts/bilibili.js',
].sort();

if (manifest.manifest_version !== 3) throw new Error('Unexpected manifest version');
if (manifest.name !== '自动保存版本') throw new Error('Unexpected extension name');
if (manifest.minimum_chrome_version !== '116') throw new Error('Unexpected Chrome floor');
if (JSON.stringify(actualPermissions) !== JSON.stringify(expectedPermissions)) {
  throw new Error(`Unexpected permissions: ${actualPermissions.join(',')}`);
}
if (JSON.stringify(manifest.host_permissions) !== JSON.stringify(expectedHosts)) {
  throw new Error('Unexpected host permissions');
}
const matches = manifest.content_scripts?.flatMap((script) => script.matches || []) || [];
if (JSON.stringify([...matches].sort()) !== JSON.stringify([...expectedContentScriptMatches].sort())) {
  throw new Error(`Unexpected content-script matches: ${matches.join(',')}`);
}
const contentScriptJs = manifest.content_scripts?.flatMap((script) => script.js || []).sort() || [];
if (JSON.stringify(contentScriptJs) !== JSON.stringify(expectedContentScriptJs)) {
  throw new Error(`Unexpected content-script JavaScript: ${contentScriptJs.join(',')}`);
}
for (const key of ['optional_permissions', 'optional_host_permissions']) {
  const value = manifest[key];
  if (value !== undefined && (!Array.isArray(value) || value.length !== 0)) {
    throw new Error(`Unexpected optional capability: ${key}`);
  }
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
