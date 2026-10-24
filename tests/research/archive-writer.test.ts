import { afterEach, describe, expect, it, vi } from 'vitest';
import { writeArchive, type ArchiveIo } from '@/utils/research/archive-writer';
import { createChromeArchiveIo } from '@/utils/research/chrome-archive-io';
import {
  isBofaCaptureSender,
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

afterEach(() => {
  vi.unstubAllGlobals();
});

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

  it('rejects forged BofA senders and polluted capture submissions', () => {
    const request = {
      target: 'background' as const,
      type: 'FIN_REPORT_CLIPPER_CAPTURE' as const,
      submission,
    };
    const trustedSender = {
      id: 'extension-id',
      frameId: 0,
      url: 'https://rsch.baml.com/r?q=private-report',
      tab: { url: 'https://rsch.baml.com/r?q=private-report' },
    } as chrome.runtime.MessageSender;

    expect(isCaptureRequest(request)).toBe(true);
    expect(isBofaCaptureSender(trustedSender, 'extension-id')).toBe(true);
    expect(isBofaCaptureSender({ ...trustedSender, frameId: 1 }, 'extension-id')).toBe(false);
    expect(
      isBofaCaptureSender(
        { ...trustedSender, tab: { url: 'https://example.com/r' } } as chrome.runtime.MessageSender,
        'extension-id',
      ),
    ).toBe(false);
    expect(
      isCaptureRequest({
        ...request,
        submission: { ...submission, rawUrl: 'https://rsch.baml.com/r?token=private-token' },
      }),
    ).toBe(false);
    expect(
      isCaptureRequest({
        ...request,
        submission: {
          ...submission,
          document: { ...submission.document, pdfUrl: 'https://rsch.baml.com/r?token=private-token' },
        },
      }),
    ).toBe(false);
    expect(
      isCaptureRequest({
        ...request,
        submission: { ...submission, transientPdfUrl: 'https://example.com/report.pdf' },
      }),
    ).toBe(false);
    expect(
      isCaptureRequest({
        ...request,
        submission: {
          ...submission,
          document: {
            ...submission.document,
            sanitizedSource: 'https://rsch.baml.com/r?token=private-token',
          },
        },
      }),
    ).toBe(false);
    for (const document of [
      {
        ...submission.document,
        title: 'https://rsch.baml.com/r?token=private-token',
      },
      {
        ...submission.document,
        authors: ['https://rsch.baml.com/r?token=private-token'],
      },
      {
        ...submission.document,
        observedMetadata: { source: 'https://example.com/r?token=private-token' },
      },
      {
        ...submission.document,
        observedMetadata: { authors: ['https://example.com/r?token=private-token'] },
      },
      {
        ...submission.document,
        originalMarkdown: `${submission.document.originalMarkdown}\nhttps://rsch.baml.com/r?token=private-token`,
      },
    ]) {
      expect(isCaptureRequest({ ...request, submission: { ...submission, document } })).toBe(false);
    }
    expect(
      isCaptureRequest({
        ...request,
        submission: {
          ...submission,
          document: {
            ...submission.document,
            title: 'Contact public.analyst@bofa.example for details',
            originalMarkdown: `${submission.document.originalMarkdown}\nPublic contact: public.analyst@bofa.example`,
          },
        },
      }),
    ).toBe(true);
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

  it('keeps a complete original capture when the rebuildable manifest fails', async () => {
    const { io, calls } = fakeIo();
    const manifestFailureIo: ArchiveIo = {
      ...io,
      async writeText(path, content, mime) {
        await io.writeText(path, content, mime);
        if (path === plan.manifestPath) {
          throw new Error(`manifest blocked ${submission.transientPdfUrl}`);
        }
      },
    };

    const result = await writeArchive(plan, submission, manifestFailureIo);

    expect(result.status).toBe('complete');
    expect(result.files).toEqual([plan.originalMarkdownPath, plan.originalPdfPath]);
    expect(result.warnings).toEqual([
      'Manifest download failed: manifest blocked [redacted-url]',
    ]);
    expect(calls.at(-1)?.path).toBe(plan.manifestPath);
  });

  it('rolls back a manifest whose exact download-history cleanup fails', async () => {
    const savedFiles = new Map<string, string>();
    const blobs = new Map<string, string>();
    const filenames = new Map<number, string>();
    const removedIds: number[] = [];
    let nextDownloadId = 1;
    let nextBlobId = 1;
    vi.stubGlobal('chrome', {
      downloads: {
        download: vi.fn(async ({ filename, url }) => {
          const id = nextDownloadId++;
          filenames.set(id, filename);
          savedFiles.set(filename, blobs.get(url) || 'PDF');
          return id;
        }),
        search: vi.fn(async ({ id }) => [
          {
            id,
            state: 'complete',
            filename: `/Downloads/${filenames.get(id)}`,
            mime: filenames.get(id)?.endsWith('.pdf') ? 'application/pdf' : 'text/markdown',
          },
        ]),
        removeFile: vi.fn(async (id) => {
          removedIds.push(id);
          const filename = filenames.get(id);
          if (filename) savedFiles.delete(filename);
        }),
        erase: vi.fn(async ({ id }) => {
          if (id === 4) throw new Error('Chrome cleanup failure: private-marker-url');
          return [id];
        }),
        onChanged: {
          addListener: vi.fn(),
          removeListener: vi.fn(),
        },
      },
      runtime: {
        ContextType: { OFFSCREEN_DOCUMENT: 'OFFSCREEN_DOCUMENT' },
        getURL: vi.fn(() => 'chrome-extension://test/offscreen.html'),
        getContexts: vi.fn(async () => []),
        sendMessage: vi.fn(async (request) => {
          if (request.type === 'FIN_REPORT_CLIPPER_CREATE_BLOB') {
            const url = `blob:archive-${nextBlobId++}`;
            blobs.set(url, request.content);
            return { ok: true, requestId: request.requestId, url };
          }
          blobs.delete(request.url);
          return { ok: true };
        }),
      },
      offscreen: {
        Reason: { BLOBS: 'BLOBS' },
        createDocument: vi.fn(async () => undefined),
        closeDocument: vi.fn(async () => undefined),
      },
    });

    const result = await writeArchive(plan, submission, createChromeArchiveIo());

    expect(result.status).toBe('complete');
    expect(result.warnings).toEqual([
      'Manifest download failed: Archive download cleanup failed',
    ]);
    expect(savedFiles.get(plan.originalPdfPath || '')).toBe('PDF');
    expect(savedFiles.has(plan.manifestPath)).toBe(false);
    expect(removedIds).toEqual([4]);
  });

  it('keeps complete originals when manifest Blob cleanup fails', async () => {
    const savedFiles = new Map<string, string>();
    const blobs = new Map<string, string>();
    const filenames = new Map<number, string>();
    const activeIds = new Set<number>();
    const removedIds: number[] = [];
    const operations: string[] = [];
    let nextDownloadId = 1;
    let nextBlobId = 1;
    vi.stubGlobal('chrome', {
      downloads: {
        download: vi.fn(async ({ filename, url }) => {
          const id = nextDownloadId++;
          filenames.set(id, filename);
          activeIds.add(id);
          savedFiles.set(filename, blobs.get(url) || 'PDF');
          operations.push(`download:${id}`);
          return id;
        }),
        search: vi.fn(async ({ id }) => [
          {
            id,
            state: 'complete',
            filename: `/Downloads/${filenames.get(id)}`,
            mime: filenames.get(id)?.endsWith('.pdf') ? 'application/pdf' : 'text/markdown',
          },
        ]),
        removeFile: vi.fn(async (id) => {
          removedIds.push(id);
          operations.push(`remove:${id}`);
          if (!activeIds.has(id)) return;
          const filename = filenames.get(id);
          if (filename) savedFiles.delete(filename);
        }),
        erase: vi.fn(async ({ id }) => {
          operations.push(`erase:${id}`);
          activeIds.delete(id);
          return [id];
        }),
        onChanged: {
          addListener: vi.fn(),
          removeListener: vi.fn(),
        },
      },
      runtime: {
        ContextType: { OFFSCREEN_DOCUMENT: 'OFFSCREEN_DOCUMENT' },
        getURL: vi.fn(() => 'chrome-extension://test/offscreen.html'),
        getContexts: vi.fn(async () => []),
        sendMessage: vi.fn(async (request) => {
          if (request.type === 'FIN_REPORT_CLIPPER_CREATE_BLOB') {
            const url = `blob:archive-${nextBlobId++}`;
            blobs.set(url, request.content);
            return { ok: true, requestId: request.requestId, url };
          }
          if (request.url === 'blob:archive-3') {
            throw new Error('revoke failed: private-blob-url');
          }
          blobs.delete(request.url);
          return { ok: true };
        }),
      },
      offscreen: {
        Reason: { BLOBS: 'BLOBS' },
        createDocument: vi.fn(async () => undefined),
        closeDocument: vi.fn(async () => {
          throw new Error('close failed: private-close-detail');
        }),
      },
    });

    const result = await writeArchive(plan, submission, createChromeArchiveIo());

    expect(result.status).toBe('complete');
    expect(result.warnings).toEqual([
      'Manifest download failed: Archive Blob cleanup failed',
    ]);
    expect(savedFiles.get(plan.originalPdfPath || '')).toBe('PDF');
    expect(savedFiles.has(plan.manifestPath)).toBe(false);
    expect(removedIds).toEqual([4]);
    expect(operations.indexOf('remove:4')).toBeLessThan(operations.indexOf('erase:4'));
    expect(removedIds).not.toContain(2);
  });
});
