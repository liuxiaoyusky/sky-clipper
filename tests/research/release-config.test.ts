import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { afterEach, describe, expect, it } from 'vitest';

function jobBlock(workflow: string, name: string): string {
  const marker = `  ${name}:\n`;
  const start = workflow.indexOf(marker);
  if (start < 0) throw new Error(`Missing ${name} job`);
  const remaining = workflow.slice(start + marker.length);
  const nextJob = remaining.search(/^  [a-z][a-z-]*:\n/m);
  return nextJob < 0 ? remaining : remaining.slice(0, nextJob);
}

function actionsIn(block: string): string[] {
  return [...block.matchAll(/^\s+uses: (\S+)$/gm)].map((match) => match[1]);
}

function stepBlock(job: string, name: string): string {
  const marker = `      - name: ${name}\n`;
  const start = job.indexOf(marker);
  if (start < 0) throw new Error(`Missing ${name} step`);
  const remaining = job.slice(start + marker.length);
  const nextStep = remaining.search(/^      - name: /m);
  return nextStep < 0 ? remaining : remaining.slice(0, nextStep);
}

function topLevelBlock(workflow: string, name: string): string {
  const marker = `${name}:\n`;
  const start = workflow.indexOf(marker);
  if (start < 0) throw new Error(`Missing ${name} block`);
  const remaining = workflow.slice(start + marker.length);
  const nextBlock = remaining.search(/^[a-z][a-z_-]*:\n/m);
  return nextBlock < 0 ? remaining : remaining.slice(0, nextBlock);
}

const fixtureRoots: string[] = [];

function fixtureRoot(manifest: Record<string, unknown>, scripts: Record<string, string | Buffer> = {}) {
  const root = mkdtempSync(join(tmpdir(), 'fin-report-config-'));
  fixtureRoots.push(root);
  writeFileSync(join(root, 'manifest.json'), JSON.stringify(manifest));
  for (const [path, contents] of Object.entries(scripts)) {
    const target = join(root, path);
    mkdirSync(join(target, '..'), { recursive: true });
    writeFileSync(target, contents);
  }
  return root;
}

function validManifest(overrides: Record<string, unknown> = {}) {
  return {
    manifest_version: 3,
    name: 'Fin-report-clipper',
    minimum_chrome_version: '116',
    permissions: ['downloads', 'offscreen', 'storage'],
    host_permissions: ['https://rsch.baml.com/*'],
    content_scripts: [
      {
        matches: ['https://rsch.baml.com/*'],
        js: ['content-scripts/content.js'],
      },
    ],
    ...overrides,
  };
}

function runCheck(script: string, root: string) {
  return spawnSync(process.execPath, [script, root], { encoding: 'utf8' });
}

afterEach(() => {
  for (const root of fixtureRoots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe('Chrome-only automation', () => {
  it('runs the full verification command in CI without Edge or Firefox', () => {
    const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
    expect(ci).toContain('npm run verify');
    expect(ci).not.toMatch(/build:edge|build:firefox|edge-mv3|firefox/);
  });

  it('publishes the exact Chrome archive names', () => {
    const release = readFileSync('.github/workflows/release.yml', 'utf8');
    expect(release).toContain('fin-report-clipper-${PACKAGE_VERSION}-chrome.zip');
    expect(release).toContain('fin-report-clipper-chrome.zip');
    expect(release).not.toContain('zhaoji-clipper');
    expect(release).not.toMatch(/zip:edge|edge\.zip/);
  });

  it('rejects options and icons from the generated manifest', () => {
    const check = readFileSync('scripts/check-manifest.mjs', 'utf8');
    expect(check).toContain("'options_ui'");
    expect(check).toContain("'icons'");
  });

  it('separates a read-only Chrome package job from the publishing job', () => {
    const release = readFileSync('.github/workflows/release.yml', 'utf8');
    const build = jobBlock(release, 'build');
    const publish = jobBlock(release, 'release');

    expect(release).toMatch(/^on:\n  push:\n    tags:\n      - 'v\*\.\*\.\*'\n/m);
    expect(release).toMatch(/^permissions:\n  contents: read\n/m);
    expect(build).toMatch(/^    permissions:\n      contents: read\n/m);
    expect(build).toContain('persist-credentials: false');
    expect(build).toContain('TAG_VERSION="${GITHUB_REF_NAME#v}"');
    expect(build).toContain("require('./package.json').version");
    expect(build).toContain('npm run verify');
    expect(build).toContain('npm run zip');
    expect(build).toContain('actions/upload-artifact@');
    expect(publish).toMatch(/^    needs: build\n/m);
    expect(publish).toMatch(/^    permissions:\n      contents: write\n/m);
    expect(publish).toContain('actions/download-artifact@');
    expect(publish).not.toMatch(/npm ci|npm run verify|npm run zip|actions\/checkout/);
    expect(actionsIn(`${build}\n${publish}`)).toSatisfy((actions) =>
      actions.every((action: string) => /@[a-f0-9]{40}$/.test(action)),
    );

  });

  it('checks the complete Chrome MV3 manifest and every declared content script', () => {
    const manifestCheck = readFileSync('scripts/check-manifest.mjs', 'utf8');
    const asciiCheck = readFileSync('scripts/check-content-ascii.mjs', 'utf8');

    expect(manifestCheck).toContain('manifest.manifest_version !== 3');
    expect(manifestCheck).toContain('optional_permissions');
    expect(manifestCheck).toContain('optional_host_permissions');
    expect(manifestCheck).toContain("['content-scripts/content.js']");
    expect(asciiCheck).toContain('manifest.content_scripts');
    expect(asciiCheck).not.toContain("'content-scripts/content.js'");
  });

  it('wires exactly two staged Chrome assets through the release jobs', () => {
    const release = readFileSync('.github/workflows/release.yml', 'utf8');
    const build = jobBlock(release, 'build');
    const publish = jobBlock(release, 'release');
    const trigger = topLevelBlock(release, 'on');
    const jobs = topLevelBlock(release, 'jobs');
    const version = stepBlock(build, 'Verify tag matches package version');
    const stage = stepBlock(build, 'Stage Chrome release assets');
    const upload = stepBlock(build, 'Upload verified Chrome release assets');
    const download = stepBlock(publish, 'Download verified Chrome release assets');

    expect(trigger).toBe("  push:\n    tags:\n      - 'v*.*.*'\n\n");
    expect([...jobs.matchAll(/^  ([a-z][a-z-]*):$/gm)].map((match) => match[1])).toEqual([
      'build',
      'release',
    ]);
    expect(build).toContain('outputs:\n      version: ${{ steps.version.outputs.version }}');
    expect(version).toContain('id: version');
    expect(version).toContain('echo "version=$PACKAGE_VERSION" >> "$GITHUB_OUTPUT"');
    expect(stage).toContain('PACKAGE_VERSION: ${{ steps.version.outputs.version }}');
    expect(stage).toContain('mkdir -p release-assets');
    const copies = [...stage.matchAll(/cp "([^"]+)" \\\n+\s+"([^"]+)"/g)].map((match) =>
      match.slice(1),
    );
    expect(copies).toEqual([
      [
        '.output/fin-report-clipper-${PACKAGE_VERSION}-chrome.zip',
        'release-assets/fin-report-clipper-${PACKAGE_VERSION}-chrome.zip',
      ],
      [
        'release-assets/fin-report-clipper-${PACKAGE_VERSION}-chrome.zip',
        'release-assets/fin-report-clipper-chrome.zip',
      ],
    ]);

    const uploadPaths = upload.match(/path: \|\n([\s\S]*?)\n\s+if-no-files-found:/)?.[1];
    expect(upload).toContain('name: fin-report-clipper-chrome-release');
    expect(uploadPaths?.split('\n').map((line) => line.trim())).toEqual([
      'release-assets/fin-report-clipper-${{ steps.version.outputs.version }}-chrome.zip',
      'release-assets/fin-report-clipper-chrome.zip',
    ]);
    expect(download).toContain('name: fin-report-clipper-chrome-release');
    expect(download).toContain('path: release-assets');
    expect(publish).toContain('RELEASE_VERSION: ${{ needs.build.outputs.version }}');
    expect(publish).not.toMatch(/NOTES_FILE|--notes-file/);
    expect(publish).toContain('--generate-notes');

    const assets = publish.match(/ASSETS=\(\n([\s\S]*?)\n\s*\)/)?.[1];
    expect([...assets!.matchAll(/"([^"]+)"/g)].map((match) => match[1])).toEqual([
      'release-assets/fin-report-clipper-${RELEASE_VERSION}-chrome.zip',
      'release-assets/fin-report-clipper-chrome.zip',
    ]);
  });

  it.each([
    ['MV2', { manifest_version: 2 }, 'Unexpected manifest version'],
    ['optional permissions', { optional_permissions: ['tabs'] }, 'optional_permissions'],
    [
      'optional hosts',
      { optional_host_permissions: ['https://example.com/*'] },
      'optional_host_permissions',
    ],
    [
      'extra content JavaScript',
      {
        content_scripts: [
          {
            matches: ['https://rsch.baml.com/*'],
            js: ['content-scripts/content.js', 'content-scripts/extra.js'],
          },
        ],
      },
      'Unexpected content-script JavaScript',
    ],
  ])('fails the manifest fixture closed for %s', (_label, overrides, error) => {
    const root = fixtureRoot(validManifest(overrides));
    const result = runCheck('scripts/check-manifest.mjs', root);

    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain(error);
  });

  it('checks a second declared content script for non-ASCII bytes', () => {
    const manifest = validManifest({
      content_scripts: [
        {
          matches: ['https://rsch.baml.com/*'],
          js: ['content-scripts/content.js', 'content-scripts/second.js'],
        },
      ],
    });
    const root = fixtureRoot(manifest, {
      'content-scripts/content.js': 'console.log("ascii");',
      'content-scripts/second.js': Buffer.from([0x61, 0x80]),
    });

    const result = runCheck('scripts/check-content-ascii.mjs', root);
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('content-scripts/second.js contains a non-ASCII byte');
  });
});
