import { describe, expect, it } from 'vitest';
import {
  bofaRunKey,
  createRunController,
  waitForStablePage,
} from '@/utils/research/observe';
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

  it('cancels a stale report run and accepts recapture after same-document navigation', () => {
    const controller = createRunController();
    const firstKey = bofaRunKey(
      'https://rsch.baml.com/r?q=private-report&e=private%40example.com',
      'BOFA-1',
    );
    const firstGeneration = controller.start(firstKey);
    const secondKey = bofaRunKey('https://rsch.baml.com/r?q=next-report', 'BOFA-2');
    const secondGeneration = controller.start(secondKey);

    expect(firstKey).not.toContain('private-report');
    expect(firstKey).not.toContain('private@example.com');
    expect(controller.isCurrent(firstGeneration, firstKey)).toBe(false);
    expect(controller.isCurrent(secondGeneration, secondKey)).toBe(true);
  });

  it('invalidates a query-only navigation before the new source ID is observed', () => {
    const controller = createRunController();
    const staleKey = bofaRunKey('https://rsch.baml.com/r?q=first-report', 'BOFA-1');
    const staleGeneration = controller.start(staleKey);
    const navigationGeneration = controller.start(staleKey);
    const recaptureKey = bofaRunKey('https://rsch.baml.com/r?q=second-report', 'BOFA-2');
    const recaptureGeneration = controller.start(recaptureKey);

    expect(controller.isCurrent(staleGeneration, staleKey)).toBe(false);
    expect(controller.isCurrent(navigationGeneration, staleKey)).toBe(false);
    expect(controller.isCurrent(recaptureGeneration, recaptureKey)).toBe(true);
  });
});
