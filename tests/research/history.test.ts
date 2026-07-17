import { describe, expect, it } from 'vitest';
import {
  HISTORY_KEY,
  createHistoryRepository,
  normalizeHistory,
} from '@/utils/research/history';
import type { CaptureHistoryEntry } from '@/utils/research/types';

describe('capture history', () => {
  it('drops malformed history entries', () => {
    expect(
      normalizeHistory([
        { identityKey: 'x' },
        {
          identityKey: 'bofa:id:BOFA-1',
          contentHash: `sha256:${'a'.repeat(64)}`,
          archivePath: '../outside-downloads',
          status: 'complete',
          capturedAt: '2026-07-17T16:30:00Z',
        },
        null,
        'legacy',
      ]),
    ).toEqual([]);
  });

  it('returns a fresh allowlisted history entry when loaded data has URL extras', async () => {
    const entry: CaptureHistoryEntry = {
      identityKey: 'bofa:id:BOFA-TEST-001',
      contentHash: `sha256:${'a'.repeat(64)}`,
      archivePath: 'Fin-report-clipper Backup/BofA/2026/report',
      status: 'complete',
      capturedAt: '2026-07-17T16:30:00+09:00',
    };
    const storage = {
      async get(key: string) {
        return {
          [key]: [
            {
              ...entry,
              rawUrl:
                'https://rsch.baml.com/r?q=private-report&e=private%40example.com&h=private-signature',
              pdfUrl: 'https://rsch.baml.com/r?token=private-pdf-token',
            },
          ],
        };
      },
      async set() {},
    };

    await expect(createHistoryRepository(storage).load()).resolves.toEqual([entry]);
  });

  it('upserts by identity and content hash under one independent local key', async () => {
    const state: Record<string, unknown> = {};
    const storage = {
      async get(key: string) {
        return { [key]: state[key] };
      },
      async set(items: Record<string, unknown>) {
        Object.assign(state, items);
      },
    };
    const repository = createHistoryRepository(storage);
    const entry: CaptureHistoryEntry = {
      identityKey: 'bofa:id:BOFA-TEST-001',
      contentHash: `sha256:${'a'.repeat(64)}`,
      archivePath: 'Fin-report-clipper Backup/BofA/2026/report',
      status: 'partial',
      capturedAt: '2026-07-17T16:30:00+09:00',
    };
    const entryWithUrlExtras = {
      ...entry,
      rawUrl:
        'https://rsch.baml.com/r?q=private-report&e=private%40example.com&h=private-signature',
      pdfUrl: 'https://rsch.baml.com/r?token=private-pdf-token',
    };
    await repository.upsert(entryWithUrlExtras);
    await repository.upsert({ ...entry, status: 'complete' });
    expect(await repository.load()).toEqual([{ ...entry, status: 'complete' }]);
    expect(JSON.stringify(state)).not.toContain('private-report');
    expect(JSON.stringify(state)).not.toContain('private-pdf-token');
    expect(Object.keys(state)).toEqual([HISTORY_KEY]);
    expect(HISTORY_KEY).toBe('fin_report_clipper_history');
  });
});
