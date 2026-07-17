import { describe, expect, it } from 'vitest';
import {
  createCaptureService,
  createCaptureStartupRecovery,
} from '@/utils/research/capture-service';
import type { CaptureSubmission } from '@/utils/research/types';

function submission(sourceId: string, hashChar: string): CaptureSubmission {
  return {
    adapterVersion: 'bofa-html-v1',
    document: {
      schema: 'fin-report-clipper/capture-v1',
      provider: 'BofA Global Research',
      sourceType: 'html',
      sourceId,
      title: sourceId,
      observedMetadata: {},
      originalMarkdown: `# ${sourceId}\n`,
      sanitizedSource: 'https://rsch.baml.com/r',
      capturedAt: '2026-07-17T16:30:00+09:00',
      contentHash: `sha256:${hashChar.repeat(64)}`,
      captureStatus: 'complete',
    },
  };
}

describe('capture service', () => {
  it('returns duplicate without constructing archive IO', async () => {
    const existing = submission('BOFA-1', 'a');
    let ioCreated = false;
    const history = {
      async load() {
        return [
          {
            identityKey: 'bofa:id:BOFA-1',
            contentHash: existing.document.contentHash,
            archivePath: 'Fin-report-clipper Backup/BofA/2026/existing',
            status: 'complete' as const,
            capturedAt: existing.document.capturedAt,
          },
        ];
      },
      async upsert() {},
    };
    const service = createCaptureService({
      history,
      createIo() {
        ioCreated = true;
        throw new Error('must not create IO');
      },
    });
    await expect(service.submit(existing)).resolves.toEqual({
      status: 'duplicate',
      archivePath: 'Fin-report-clipper Backup/BofA/2026/existing',
    });
    expect(ioCreated).toBe(false);
  });

  it('does not overlap two capture writes', async () => {
    const events: string[] = [];
    const entries: any[] = [];
    let releaseFirst!: () => void;
    let markFirstStarted!: () => void;
    const firstBlocked = new Promise<void>((resolve) => {
      releaseFirst = resolve;
    });
    const firstStarted = new Promise<void>((resolve) => {
      markFirstStarted = resolve;
    });
    const service = createCaptureService({
      history: {
        async load() {
          return entries;
        },
        async upsert(entry) {
          entries.push(entry);
        },
      },
      createIo() {
        return { async writeText() {}, async downloadUrl() {}, async close() {} };
      },
      async write(plan, item) {
        events.push(`start:${item.document.sourceId}`);
        if (item.document.sourceId === 'BOFA-1') {
          markFirstStarted();
          await firstBlocked;
        }
        events.push(`end:${item.document.sourceId}`);
        return { status: 'complete' as const, warnings: [], files: [plan.originalMarkdownPath] };
      },
    });
    const first = service.submit(submission('BOFA-1', 'a'));
    const second = service.submit(submission('BOFA-2', 'b'));
    await firstStarted;
    expect(events).toEqual(['start:BOFA-1']);
    releaseFirst();
    await Promise.all([first, second]);
    expect(events).toEqual(['start:BOFA-1', 'end:BOFA-1', 'start:BOFA-2', 'end:BOFA-2']);
  });

  it('reports partial after files are saved but local history cannot be updated', async () => {
    const service = createCaptureService({
      history: {
        async load() {
          return [];
        },
        async upsert() {
          throw new Error('quota error https://rsch.baml.com/r?q=fake-secret');
        },
      },
      createIo() {
        return { async writeText() {}, async downloadUrl() {}, async close() {} };
      },
      async write(plan) {
        return { status: 'complete', warnings: [], files: [plan.originalMarkdownPath] };
      },
    });
    const result = await service.submit(submission('BOFA-1', 'a'));
    expect(result.status).toBe('partial');
    if (result.status === 'partial') {
      expect(result.warnings[0]).toContain('History update failed');
      expect(result.warnings[0]).not.toContain('rsch.baml.com');
    }
  });

  it('reconciles an abandoned session lease before starting a new capture', async () => {
    const events: string[] = [];
    let releaseSweep!: () => void;
    let markSweepStarted!: () => void;
    const sweepBlocked = new Promise<void>((resolve) => {
      releaseSweep = resolve;
    });
    const sweepStarted = new Promise<void>((resolve) => {
      markSweepStarted = resolve;
    });
    const recovery = createCaptureStartupRecovery({
      session: {
        async get() {
          events.push('get');
          return { fin_report_clipper_active_capture: { startedAt: '2026-07-17T16:30:00Z' } };
        },
        async set() {
          events.push('set');
        },
        async remove() {
          events.push('remove');
        },
      },
      async settle() {
        events.push('settle');
      },
      async sweep() {
        events.push('sweep');
        markSweepStarted();
        await sweepBlocked;
      },
    });
    const service = createCaptureService({
      recovery,
      history: {
        async load() {
          return [];
        },
        async upsert() {},
      },
      createIo() {
        return { async writeText() {}, async downloadUrl() {}, async close() {} };
      },
      async write(plan) {
        events.push('write');
        return { status: 'complete' as const, warnings: [], files: [plan.originalMarkdownPath] };
      },
    });

    await sweepStarted;
    const result = service.submit(submission('BOFA-1', 'a'));
    await Promise.resolve();
    expect(events).toEqual(['get', 'settle', 'sweep']);
    releaseSweep();
    await expect(result).resolves.toMatchObject({ status: 'saved' });
    expect(events).toEqual(['get', 'settle', 'sweep', 'remove', 'set', 'write', 'remove']);
  });

  it('returns a redacted recovery failure without starting archive IO', async () => {
    const recovery = createCaptureStartupRecovery({
      session: {
        async get() {
          return {};
        },
        async set() {},
        async remove() {},
      },
      async settle() {
        throw new Error('settle failed at https://rsch.baml.com/r?token=private-token');
      },
      async sweep() {
        throw new Error('must not sweep');
      },
    });
    let ioCreated = false;
    const service = createCaptureService({
      recovery,
      history: {
        async load() {
          return [];
        },
        async upsert() {},
      },
      createIo() {
        ioCreated = true;
        throw new Error('must not create IO');
      },
    });

    const result = await service.submit(submission('BOFA-1', 'a'));
    expect(result.status).toBe('failed');
    if (result.status === 'failed') {
      expect(result.reason).toBe('Capture recovery failed');
      expect(result.reason).not.toContain('rsch.baml.com');
    }
    expect(ioCreated).toBe(false);
  });
});
