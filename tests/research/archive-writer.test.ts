import { describe, expect, it } from 'vitest';
import { writeArchive, type ArchiveIo } from '@/utils/research/archive-writer';
import {
  isCaptureRequest,
  isGetPageStatusRequest,
} from '@/utils/research/messages';
import type { ArchivePlan, CaptureSubmission } from '@/utils/research/types';

const plan: ArchivePlan = {
  identityKey: 'bofa:id:BOFA-TEST-001',
  archiveDir: 'Fin-report-clipper Backup/BofA/2026/report',
  originalMarkdownPath: 'Fin-report-clipper Backup/BofA/2026/report/original.md',
  originalPdfPath: 'Fin-report-clipper Backup/BofA/2026/report/original.pdf',
  manifestPath:
    'Fin-report-clipper Backup/BofA/2026/report/.fin-report-clipper/capture.json',
  revision: false,
  retryPartial: false,
};

const submission: CaptureSubmission = {
  adapterVersion: 'bofa-html-v1',
  transientPdfUrl:
    'https://rsch.baml.com/r?q=fake-report&e=analyst%40example.com&h=fake-signature',
  document: {
    schema: 'fin-report-clipper/capture-v1',
    provider: 'BofA Global Research',
    sourceType: 'html+pdf',
    sourceId: 'BOFA-TEST-001',
    title: 'Semiconductor update',
    observedMetadata: { subtitle: 'Quarterly update' },
    originalMarkdown:
      '---\nschema: fin-report-clipper/capture-v1\ncapture_status: complete\n---\n\n# Semiconductor update\n\nBody\n',
    sanitizedSource: 'https://rsch.baml.com/r',
    capturedAt: '2026-07-17T16:30:00+09:00',
    contentHash: `sha256:${'a'.repeat(64)}`,
    captureStatus: 'complete',
  },
};

function fakeIo(failPdf = false) {
  const calls: Array<{ kind: 'text' | 'url'; path: string; content?: string }> = [];
  const io: ArchiveIo = {
    async writeText(path, content) {
      calls.push({ kind: 'text', path, content });
    },
    async downloadUrl(path) {
      calls.push({ kind: 'url', path });
      if (failPdf) throw new Error(`SERVER_FORBIDDEN ${submission.transientPdfUrl}`);
    },
    async close() {},
  };
  return { io, calls };
}

describe('archive writer', () => {
  it('accepts only the two declared message routing contracts', () => {
    expect(
      isCaptureRequest({
        target: 'background',
        type: 'FIN_REPORT_CLIPPER_CAPTURE',
        submission,
      }),
    ).toBe(true);
    expect(isCaptureRequest({ target: 'background', type: 'FIN_REPORT_CLIPPER_CAPTURE' })).toBe(
      false,
    );
    expect(
      isGetPageStatusRequest({
        target: 'content',
        type: 'FIN_REPORT_CLIPPER_GET_PAGE_STATUS',
      }),
    ).toBe(true);
    expect(isGetPageStatusRequest({ target: 'background' })).toBe(false);
  });

  it('writes a Markdown safety snapshot, saves PDF, promotes Markdown, then writes capture.json', async () => {
    const { io, calls } = fakeIo();
    const result = await writeArchive(plan, submission, io);
    expect(calls.map((call) => call.path)).toEqual([
      plan.originalMarkdownPath,
      plan.originalPdfPath,
      plan.originalMarkdownPath,
      plan.manifestPath,
    ]);
    expect(result.status).toBe('complete');
    expect(calls[0].content).toContain('capture_status: partial');
    expect(calls[2].content).toContain('capture_status: complete');
    const manifest = calls.at(-1)?.content || '';
    expect(manifest).toContain('"capture_status": "complete"');
    expect(manifest).not.toContain('analyst@example.com');
    expect(manifest).not.toContain('fake-signature');
    expect(manifest).not.toContain('transientPdfUrl');
  });

  it('keeps Markdown and writes a partial manifest when PDF fails', async () => {
    const { io, calls } = fakeIo(true);
    const result = await writeArchive(plan, submission, io);
    expect(result.status).toBe('partial');
    expect(result.warnings[0]).toContain('SERVER_FORBIDDEN');
    expect(result.warnings[0]).not.toContain('rsch.baml.com');
    expect(calls.map((call) => call.path)).toEqual([
      plan.originalMarkdownPath,
      plan.originalPdfPath,
      plan.manifestPath,
    ]);
    const markdown = calls.find((call) => call.path === plan.originalMarkdownPath)?.content;
    expect(markdown).toContain('capture_status: partial');
    expect(calls.at(-1)?.content).toContain('"capture_status": "partial"');
  });

  it('writes an HTML-only report once and marks it complete', async () => {
    const { originalPdfPath: _pdfPath, ...htmlPlan } = plan;
    const { transientPdfUrl: _pdfUrl, ...submissionWithoutPdf } = submission;
    const htmlSubmission: CaptureSubmission = {
      ...submissionWithoutPdf,
      document: { ...submission.document, sourceType: 'html' },
    };
    const { io, calls } = fakeIo();
    const result = await writeArchive(htmlPlan, htmlSubmission, io);
    expect(result.status).toBe('complete');
    expect(calls.map((call) => call.path)).toEqual([
      plan.originalMarkdownPath,
      plan.manifestPath,
    ]);
    expect(calls[0].content).toContain('capture_status: complete');
  });
});
