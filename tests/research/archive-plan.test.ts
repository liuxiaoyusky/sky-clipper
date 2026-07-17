import { describe, expect, it } from 'vitest';
import { resolveArchivePlan, safePathSegment } from '@/utils/research/path';
import type { CaptureHistoryEntry, CapturedDocument } from '@/utils/research/types';

const document: CapturedDocument = {
  schema: 'fin-report-clipper/capture-v1',
  provider: 'BofA Global Research',
  sourceType: 'html+pdf',
  sourceId: 'BOFA-TEST-001',
  title: 'Taiwan Semiconductor Manufacturing Co.',
  observedMetadata: {},
  originalMarkdown: '# Report\n',
  sanitizedSource: 'https://rsch.baml.com/r',
  capturedAt: '2026-07-17T16:30:00+09:00',
  contentHash: `sha256:${'a'.repeat(64)}`,
  captureStatus: 'complete',
};

describe('archive planning', () => {
  it('creates the fixed Downloads-relative path for a first capture', async () => {
    const resolution = await resolveArchivePlan(document, []);
    expect(resolution).toEqual({
      kind: 'write',
      plan: {
        identityKey: 'bofa:id:BOFA-TEST-001',
        archiveDir:
          'Fin-report-clipper Backup/BofA/2026/2026-07-17-Taiwan Semiconductor Manufacturing Co-BOFA-TEST-001-aaaaaaaaaaaaaaaa',
        originalMarkdownPath:
          'Fin-report-clipper Backup/BofA/2026/2026-07-17-Taiwan Semiconductor Manufacturing Co-BOFA-TEST-001-aaaaaaaaaaaaaaaa/original.md',
        originalPdfPath:
          'Fin-report-clipper Backup/BofA/2026/2026-07-17-Taiwan Semiconductor Manufacturing Co-BOFA-TEST-001-aaaaaaaaaaaaaaaa/original.pdf',
        manifestPath:
          'Fin-report-clipper Backup/BofA/2026/2026-07-17-Taiwan Semiconductor Manufacturing Co-BOFA-TEST-001-aaaaaaaaaaaaaaaa/.fin-report-clipper/capture.json',
        revision: false,
        retryPartial: false,
      },
    });
  });

  it('returns duplicate for the same identity and content hash after a complete save', async () => {
    const entry: CaptureHistoryEntry = {
      identityKey: 'bofa:id:BOFA-TEST-001',
      contentHash: document.contentHash,
      archivePath: 'Fin-report-clipper Backup/BofA/2026/existing',
      status: 'complete',
      capturedAt: document.capturedAt,
    };
    await expect(resolveArchivePlan(document, [entry])).resolves.toEqual({
      kind: 'duplicate',
      entry,
    });
  });

  it('prefers a complete save over a partial entry for the same report in either order', async () => {
    const complete: CaptureHistoryEntry = {
      identityKey: 'bofa:id:BOFA-TEST-001',
      contentHash: document.contentHash,
      archivePath: 'Fin-report-clipper Backup/BofA/2026/complete-report',
      status: 'complete',
      capturedAt: document.capturedAt,
    };
    const partial: CaptureHistoryEntry = {
      ...complete,
      archivePath: 'Fin-report-clipper Backup/BofA/2026/partial-report',
      status: 'partial',
    };

    for (const history of [[partial, complete], [complete, partial]]) {
      await expect(resolveArchivePlan(document, history)).resolves.toEqual({
        kind: 'duplicate',
        entry: complete,
      });
    }
  });

  it('reuses the same folder when retrying an identical partial capture', async () => {
    const partial: CaptureHistoryEntry = {
      identityKey: 'bofa:id:BOFA-TEST-001',
      contentHash: document.contentHash,
      archivePath: 'Fin-report-clipper Backup/BofA/2026/partial-report',
      status: 'partial',
      capturedAt: document.capturedAt,
    };
    const resolution = await resolveArchivePlan(document, [partial]);
    expect(resolution.kind).toBe('write');
    if (resolution.kind === 'write') {
      expect(resolution.plan.archiveDir).toBe(partial.archivePath);
      expect(resolution.plan.retryPartial).toBe(true);
    }
  });

  it('marks a partial retry as a revision when another content hash was already complete', async () => {
    const oldComplete: CaptureHistoryEntry = {
      identityKey: 'bofa:id:BOFA-TEST-001',
      contentHash: `sha256:${'b'.repeat(64)}`,
      archivePath: 'Fin-report-clipper Backup/BofA/2026/old-report',
      status: 'complete',
      capturedAt: '2026-07-16T16:30:00+09:00',
    };
    const partial: CaptureHistoryEntry = {
      identityKey: 'bofa:id:BOFA-TEST-001',
      contentHash: document.contentHash,
      archivePath: 'Fin-report-clipper Backup/BofA/2026/new-partial-report',
      status: 'partial',
      capturedAt: document.capturedAt,
    };

    const resolution = await resolveArchivePlan(document, [oldComplete, partial]);
    expect(resolution.kind).toBe('write');
    if (resolution.kind === 'write') {
      expect(resolution.plan.archiveDir).toBe(partial.archivePath);
      expect(resolution.plan.revision).toBe(true);
      expect(resolution.plan.retryPartial).toBe(true);
    }
  });

  it('keeps a changed report as a revision instead of overwriting it', async () => {
    const previous: CaptureHistoryEntry = {
      identityKey: 'bofa:id:BOFA-TEST-001',
      contentHash: `sha256:${'b'.repeat(64)}`,
      archivePath: 'Fin-report-clipper Backup/BofA/2026/old-report',
      status: 'complete',
      capturedAt: '2026-07-16T16:30:00+09:00',
    };
    const resolution = await resolveArchivePlan(document, [previous]);
    expect(resolution.kind).toBe('write');
    if (resolution.kind === 'write') {
      expect(resolution.plan.revision).toBe(true);
      expect(resolution.plan.archiveDir).toMatch(/-rev-aaaaaaaaaaaaaaaa$/);
    }
  });

  it('rejects an invalid capture timestamp instead of creating a misleading path', async () => {
    await expect(
      resolveArchivePlan({ ...document, capturedAt: '2026-99-99' }, []),
    ).rejects.toThrow('Invalid capturedAt timestamp');
  });

  it('removes private URL values from a URL-shaped title before planning a path', async () => {
    const privateTitle =
      'https://rsch.baml.com/r?q=private-report-token&e=private.title%40example.com&h=private-signature';
    const resolution = await resolveArchivePlan({ ...document, title: privateTitle }, []);
    expect(resolution.kind).toBe('write');
    if (resolution.kind === 'write') {
      const paths = JSON.stringify(resolution.plan);
      expect(paths).not.toContain('private-report-token');
      expect(paths).not.toContain('private.title@example.com');
      expect(paths).not.toContain('private-signature');
    }
  });

  it('normalizes an unsafe fallback before returning it as a path segment', () => {
    expect(safePathSegment('..', '../unsafe\\folder')).toBe('unsafe folder');
  });
});
