import { describe, expect, it } from 'vitest';
import { waitForStablePage } from '@/utils/research/observe';
import type { ReadinessEvidence } from '@/utils/research/types';

const ready: ReadinessEvidence = {
  kind: 'report-html',
  sourceId: 'BOFA-1',
  title: 'Report',
  bodyTextLength: 500,
  tableCount: 1,
  tailText: 'stable tail',
};

describe('page observation', () => {
  it('returns ready after three stable probes', async () => {
    let probes = 0;
    await expect(
      waitForStablePage({
        probe: () => {
          probes += 1;
          return ready;
        },
        sleep: async () => {},
        shouldContinue: () => true,
        maxAttempts: 5,
      }),
    ).resolves.toBe('ready');
    expect(probes).toBe(3);
  });

  it('stops immediately on auth evidence', async () => {
    await expect(
      waitForStablePage({
        probe: () => ({ ...ready, kind: 'auth-required' }),
        sleep: async () => {},
        shouldContinue: () => true,
        maxAttempts: 5,
      }),
    ).resolves.toBe('auth-required');
  });
});
