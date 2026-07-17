import { describe, expect, it } from 'vitest';
import {
  bofaRunKey,
  bofaDomIdentity,
  createNavigationCaptureScheduler,
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

  it('holds a query-only navigation until the DOM identity changes, then starts one recapture', async () => {
    const scheduler = createNavigationCaptureScheduler();
    const firstUrl = 'https://rsch.baml.com/r?q=first-report';
    const nextUrl = 'https://rsch.baml.com/r?q=second-report';
    const firstIdentity = bofaDomIdentity(firstUrl, ready);
    const firstKey = bofaRunKey(firstUrl, 'BOFA-1');
    const first = scheduler.begin(firstUrl, firstIdentity, firstKey);
    const sends: string[] = [];

    expect(scheduler.sync(nextUrl, firstIdentity, firstKey)).toBeUndefined();
    await Promise.resolve();
    if (scheduler.isCurrent(first.generation, first.runKey)) sends.push(first.runKey);
    expect(sends).toEqual([]);
    expect(scheduler.sync(nextUrl, firstIdentity, firstKey)).toBeUndefined();

    const nextIdentity = bofaDomIdentity(nextUrl, { ...ready, sourceId: 'BOFA-2' });
    const nextKey = bofaRunKey(nextUrl, 'BOFA-2');
    const recapture = scheduler.sync(nextUrl, nextIdentity, nextKey);
    expect(recapture).toBeDefined();
    if (recapture && scheduler.isCurrent(recapture.generation, recapture.runKey)) {
      sends.push(recapture.runKey);
    }
    expect(sends).toEqual([nextKey]);
    expect(scheduler.sync(nextUrl, nextIdentity, nextKey)).toBeUndefined();
  });

  it('starts immediately when navigation arrives after the DOM identity already changed', async () => {
    const scheduler = createNavigationCaptureScheduler();
    const firstUrl = 'https://rsch.baml.com/r?q=first-report';
    const nextUrl = 'https://rsch.baml.com/r?q=second-report';
    const firstIdentity = bofaDomIdentity(firstUrl, ready);
    const first = scheduler.begin(firstUrl, firstIdentity, bofaRunKey(firstUrl, 'BOFA-1'));
    const nextIdentity = bofaDomIdentity(nextUrl, { ...ready, sourceId: 'BOFA-2' });
    const nextKey = bofaRunKey(nextUrl, 'BOFA-2');

    await Promise.resolve();
    const recapture = scheduler.sync(nextUrl, nextIdentity, nextKey);
    expect(scheduler.isCurrent(first.generation, first.runKey)).toBe(false);
    expect(recapture).toMatchObject({ runKey: nextKey });
  });

  it('refreshes the stable identity baseline without starting another capture', () => {
    const scheduler = createNavigationCaptureScheduler();
    const firstUrl = 'https://rsch.baml.com/r?q=first-report';
    const nextUrl = 'https://rsch.baml.com/r?q=second-report';
    const firstKey = bofaRunKey(firstUrl, 'BOFA-1');
    const firstIdentity = bofaDomIdentity(firstUrl, ready);
    const updatedOldIdentity = bofaDomIdentity(firstUrl, {
      ...ready,
      bodyTextLength: 600,
    });

    const first = scheduler.begin(firstUrl, firstIdentity, firstKey);
    expect(scheduler.sync(firstUrl, updatedOldIdentity, firstKey)).toBeUndefined();
    expect(scheduler.isCurrent(first.generation, first.runKey)).toBe(true);
    expect(scheduler.sync(nextUrl, updatedOldIdentity, firstKey)).toBeUndefined();
    expect(scheduler.isCurrent(first.generation, first.runKey)).toBe(false);
  });

  it('keeps a settings restart pending until the new DOM identity appears', () => {
    const scheduler = createNavigationCaptureScheduler();
    const firstUrl = 'https://rsch.baml.com/r?q=first-report';
    const nextUrl = 'https://rsch.baml.com/r?q=second-report';
    const firstKey = bofaRunKey(firstUrl, 'BOFA-1');
    const firstIdentity = bofaDomIdentity(firstUrl, ready);
    const first = scheduler.begin(firstUrl, firstIdentity, firstKey);

    expect(scheduler.sync(nextUrl, firstIdentity, firstKey)).toBeUndefined();
    expect(scheduler.restart(nextUrl, firstIdentity, firstKey)).toBeUndefined();
    expect(scheduler.isCurrent(first.generation, first.runKey)).toBe(false);
    expect(scheduler.sync(nextUrl, firstIdentity, firstKey)).toBeUndefined();

    const nextIdentity = bofaDomIdentity(nextUrl, { ...ready, sourceId: 'BOFA-2' });
    const nextKey = bofaRunKey(nextUrl, 'BOFA-2');
    expect(scheduler.sync(nextUrl, nextIdentity, nextKey)).toMatchObject({ runKey: nextKey });
  });
});
