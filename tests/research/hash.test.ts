// @vitest-environment node
import { describe, expect, it } from 'vitest';
import { buildContentHash, sha256Text, stableJson } from '@/utils/research/hash';

describe('research content hash', () => {
  it('implements SHA-256 with the required prefix', async () => {
    await expect(sha256Text('abc')).resolves.toBe(
      'sha256:ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
  });

  it('is stable across observed metadata key order', async () => {
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

  it('normalizes CRLF and LF string values before content hashing', async () => {
    const input = {
      provider: 'BofA Global Research',
      observedMetadata: { summary: 'Line one\r\nLine two' },
      bodyMarkdown: 'Heading\r\n\r\nBody',
    };
    const normalizedInput = {
      ...input,
      observedMetadata: { summary: 'Line one\nLine two' },
      bodyMarkdown: 'Heading\n\nBody',
    };

    await expect(buildContentHash(input)).resolves.toBe(await buildContentHash(normalizedInput));
  });

  it('sorts object keys by code unit order', () => {
    expect(stableJson({ ä: 'umlaut', z: 'zee' })).toBe('{"z":"zee","ä":"umlaut"}');
  });
});
