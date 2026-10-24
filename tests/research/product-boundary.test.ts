import { existsSync, readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

describe('research-only product boundary', () => {
  it('has no options page or legacy feature modules', () => {
    const forbidden = [
      'entrypoints/options',
      'utils/extract-core.ts',
      'utils/extractors',
      'utils/feishu-api.ts',
      'utils/feishu',
      'utils/filename.ts',
      'utils/frontmatter.ts',
      'utils/highlighter.ts',
      'utils/hosts.ts',
      'utils/images.ts',
      'utils/messaging.ts',
      'utils/obsidian.ts',
      'utils/rest.ts',
      'utils/storage.ts',
      'utils/strings.ts',
      'utils/types.ts',
      'public/logo.png',
      'public/icon',
      '.github/assets/social-preview.png',
      '.github/assets/social-preview.svg',
    ];
    for (const path of forbidden) expect(existsSync(path), path).toBe(false);
  });

  it('ships a research-only popup and no legacy runtime messages or Defuddle', () => {
    const popupSource = readFileSync('entrypoints/popup/App.tsx', 'utf8');
    expect(popupSource).toContain('FIN_REPORT_CLIPPER_GET_PAGE_STATUS');
    expect(popupSource).toContain('自动捕获');
    expect(popupSource).toContain('BofA Global Research');
    expect(popupSource).toContain('研报 → Fin-report-clipper Backup/');
    expect(popupSource).toContain('X → Sky-Clipper Backup/X/');
    expect(popupSource).not.toMatch(/ZHAOJI_CLIPPER|Obsidian|飞书|高亮|选区|普通网页剪藏/);

    const runtimeSource = [
      readFileSync('entrypoints/background.ts', 'utf8'),
      readFileSync('entrypoints/content.ts', 'utf8'),
      popupSource,
    ].join('\n');
    expect(runtimeSource).not.toMatch(/ZHAOJI_CLIPPER|Obsidian|飞书|高亮|普通网页剪藏/);

    const pkg = JSON.parse(readFileSync('package.json', 'utf8')) as {
      dependencies: Record<string, string>;
    };
    expect(pkg.dependencies).not.toHaveProperty('defuddle');
  });
});
