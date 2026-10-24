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
    expect(pkg.displayName).toBe('自动保存版本');
    expect(pkg.version).toBe('0.4.2');
    expect(Object.keys(pkg.scripts)).not.toContain('build:edge');
    expect(Object.keys(pkg.scripts)).not.toContain('build:firefox');
  });

  it('uses only the Chrome research permissions and BofA host', () => {
    const config = readFileSync('wxt.config.ts', 'utf8');
    expect(config).toContain("name: '自动保存版本'");
    expect(config).toContain("minimum_chrome_version: '116'");
    expect(config).toContain("'alarms'");
    expect(config).toContain("'downloads'");
    expect(config).toContain("'offscreen'");
    expect(config).toContain("'storage'");
    expect(config).toContain("'https://rsch.baml.com/*'");
    expect(config).toContain("'https://markets.ml.com/*'");
    expect(config).not.toContain("'<all_urls>'");
    expect(config).not.toContain("'activeTab'");
    expect(config).not.toContain("'identity'");
    expect(config).not.toContain("'contextMenus'");
    expect(config).not.toContain('commands:');
  });

  it('opens only the stable BofA Markets Advanced Search entry in the dedicated runner', () => {
    const config = readFileSync('web-ext.config.ts', 'utf8');
    expect(config).toContain(
      "'https://markets.ml.com/researchlibrary/advancedsearch'",
    );
    expect(config).toContain('startUrls: [marketsTodayEntryUrl]');
    expect(config).not.toMatch(/advancedsearch[?#]/);
    expect(config).toContain("process.env.NODE_ENV === 'development'");
    expect(config).toContain('developer_mode: true');
    expect(config).toContain('keepProfileChanges: true');
  });
});
