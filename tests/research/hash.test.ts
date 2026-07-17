// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildContentHash, sha256Text } from '@/utils/research/hash';

describe('research content hash', () => {
  it('implements SHA-256 with the required prefix', async () => {
    await expect(sha256Text('abc')).resolves.toBe(
      'sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('is stable across object key order and excludes capture time', async () => {
    const left = await buildContentHash({
      provider: 'BofA Global Research',
      sourceId: 'BOFA-1',
      title: 'Semiconductor update',
      publishedAt: '2026-07-16',
      authors: ['Analyst A'],
      observedMetadata: { subtitle: 'Update', language: 'English' },
      bodyMarkdown: '## Thesis\n\nBody',
    });
    const right = await buildContentHash({
      provider: 'BofA Global Research',
      sourceId: 'BOFA-1',
      title: 'Semiconductor update',
      publishedAt: '2026-07-16',
      authors: ['Analyst A'],
      observedMetadata: { language: 'English', subtitle: 'Update' },
      bodyMarkdown: '## Thesis\n\nBody',
    });
    expect(left).toBe(right);
  });
});
