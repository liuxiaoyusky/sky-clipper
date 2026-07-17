import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('product identity', () => {
  it('uses the independent Fin-report-clipper package identity', () => {
    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
      name: string;
      displayName: string;
      version: string;
      scripts: Record<string, string>;
    };
    expect(pkg.name).toBe('fin-report-clipper');
    expect(pkg.displayName).toBe('Fin-report-clipper');
    expect(pkg.version).toBe('0.1.0');
    expect(Object.keys(pkg.scripts)).not.toContain('build:edge');
    expect(Object.keys(pkg.scripts)).not.toContain('build:firefox');
  });

  it('uses only the Chrome research permissions and BofA host', () => {
    const config = readFileSync('wxt.config.ts', 'utf8');
    expect(config).toContain("name: 'Fin-report-clipper'");
    expect(config).toContain("minimum_chrome_version: '116'");
    expect(config).toContain("'downloads'");
    expect(config).toContain("'offscreen'");
    expect(config).toContain("'storage'");
    expect(config).toContain("'https://rsch.baml.com/*'");
    expect(config).not.toContain("'<all_urls>'");
    expect(config).not.toContain("'activeTab'");
    expect(config).not.toContain("'identity'");
    expect(config).not.toContain("'contextMenus'");
    expect(config).not.toContain('commands:');
  });
});
