import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

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
});
