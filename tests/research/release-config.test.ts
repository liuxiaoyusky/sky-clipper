import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

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

describe('Chrome-only automation', () => {
  it('runs the full verification command in CI without Edge or Firefox', () => {
    const ci = readFileSync('.github/workflows/ci.yml', 'utf8');
    expect(ci).toContain('npm run verify');
    expect(ci).not.toMatch(/build:edge|build:firefox|edge-mv3|firefox/);
  });

  it('publishes the exact Chrome archive names', () => {
    const release = readFileSync('.github/workflows/release.yml', 'utf8');
    expect(release).toContain('fin-report-clipper-${GITHUB_REF_NAME#v}-chrome.zip');
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
    const aliasCopy = build.match(/cp "([^"]+)" \\\n+\s+"([^"]+)"/);
    expect(aliasCopy?.slice(1)).toEqual([
      '.output/fin-report-clipper-${GITHUB_REF_NAME#v}-chrome.zip',
      '.output/fin-report-clipper-chrome.zip',
    ]);
    expect(build).toContain('actions/upload-artifact@');
    expect(publish).toMatch(/^    needs: build\n/m);
    expect(publish).toMatch(/^    permissions:\n      contents: write\n/m);
    expect(publish).toContain('actions/download-artifact@');
    expect(publish).not.toMatch(/npm ci|npm run verify|npm run zip|actions\/checkout/);
    expect(actionsIn(`${build}\n${publish}`)).toSatisfy((actions) =>
      actions.every((action: string) => /@[a-f0-9]{40}$/.test(action)),
    );

    const assets = publish.match(/ASSETS=\(\n([\s\S]*?)\n\s*\)/)?.[1];
    expect([...assets!.matchAll(/"([^"]+)"/g)].map((match) => match[1])).toEqual([
      '.output/fin-report-clipper-${GITHUB_REF_NAME#v}-chrome.zip',
      '.output/fin-report-clipper-chrome.zip',
    ]);
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
});
