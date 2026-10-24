import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createChromeArchiveIo,
  registerArchiveDownloadFilenames,
  eraseArchiveDownloadHistory,
  waitForArchiveDownloadsToSettle,
} from '@/utils/research/chrome-archive-io';

interface SimulatedDownload {
  state: 'complete' | 'interrupted';
  mime?: string;
  filename?: string;
  error?: string;
}

function installDownloads(item: SimulatedDownload) {
  let requestedPath = '';
  const download = vi.fn(async (options: chrome.downloads.DownloadOptions) => {
    requestedPath = options.filename || '';
    return 42;
  });
  const search = vi.fn(async () => [{ id: 42, filename: `/Downloads/${requestedPath}`, ...item }]);
  const removeFile = vi.fn(async () => undefined);
  const erase = vi.fn(async (_query: chrome.downloads.DownloadQuery) => [42]);
  vi.stubGlobal('chrome', {
    runtime: { id: 'our-extension' },
    downloads: {
      download,
      search,
      removeFile,
      erase,
      onDeterminingFilename: { addListener: vi.fn() },
      onChanged: {
        addListener: vi.fn(),
        removeListener: vi.fn(),
      },
    },
  });
  return { download, removeFile, erase };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('Chrome archive downloads', () => {
  it('accepts only the dedicated WeChat directory and verifies image MIME', async () => {
    const mocks = installDownloads({ state: 'complete', mime: 'image/png' });
    await createChromeArchiveIo().downloadUrl('Sky-Clipper Backup/WeChat/short-fixture/hash/images/001.png', 'https://mmbiz.qpic.cn/fixture/640?wx_fmt=png', 'image/');
    expect(mocks.removeFile).not.toHaveBeenCalled();
    await expect(createChromeArchiveIo().downloadUrl('Sky-Clipper Backup/WeChat/../manual.txt', 'https://mmbiz.qpic.cn/fixture/640', 'image/')).rejects.toThrow('Unsafe');
  });
  it('rejects a completed download saved under the wrong filename', async () => {
    const mocks = installDownloads({ state: 'complete', mime: 'image/jpeg', filename: '/Downloads/random.jpeg' });
    await expect(createChromeArchiveIo().downloadUrl(
      'Sky-Clipper Backup/X/123/hash/images/001.jpg', 'https://pbs.twimg.com/media/test', 'image/',
    )).rejects.toThrow('Archive download filename changed');
    expect(mocks.removeFile).toHaveBeenCalledWith(42);
    expect(mocks.erase).toHaveBeenCalledWith({ id: 42 });
  });

  it('suggests names only for its own active downloads, then forgets the URL', async () => {
    const mocks = installDownloads({ state: 'complete', mime: 'image/jpeg' });
    registerArchiveDownloadFilenames();
    const listener = vi.mocked(chrome.downloads.onDeterminingFilename.addListener).mock.calls[0][0];
    const url = 'https://pbs.twimg.com/media/test';
    const filename = 'Sky-Clipper Backup/X/123/hash/images/001.jpg';
    const original = mocks.download.getMockImplementation()!;
    mocks.download.mockImplementationOnce(async (options) => {
      const suggest = vi.fn();
      listener({ url, byExtensionId: 'our-extension' } as chrome.downloads.DownloadItem, suggest);
      expect(suggest).toHaveBeenCalledExactlyOnceWith({ filename, conflictAction: 'overwrite' });
      const other = vi.fn();
      listener({ url, byExtensionId: 'other-extension' } as chrome.downloads.DownloadItem, other);
      expect(other).toHaveBeenCalledExactlyOnceWith();
      const unknown = vi.fn();
      listener({ url: 'https://example.com/unrelated', byExtensionId: 'our-extension' } as chrome.downloads.DownloadItem, unknown);
      expect(unknown).toHaveBeenCalledExactlyOnceWith();
      return original(options);
    });
    await createChromeArchiveIo().downloadUrl(filename, url, 'image/');
    const stale = vi.fn();
    listener({ url, byExtensionId: 'our-extension' } as chrome.downloads.DownloadItem, stale);
    expect(stale).toHaveBeenCalledExactlyOnceWith();
  });

  it('keeps a valid PDF file but erases its signed download-history entry', async () => {
    const mocks = installDownloads({ state: 'complete', mime: 'application/pdf' });
    await createChromeArchiveIo().downloadUrl(
      'Fin-report-clipper Backup/BofA/2026/report/original.pdf',
      'https://rsch.baml.com/r?q=fake&e=fake%40example.com&h=fake-signature',
      'application/pdf',
    );
    expect(mocks.removeFile).not.toHaveBeenCalled();
    expect(mocks.erase).toHaveBeenCalledWith({ id: 42 });
  });

  it('reports a sanitized cleanup failure when a valid PDF history entry cannot be erased', async () => {
    const mocks = installDownloads({ state: 'complete', mime: 'application/pdf' });
    mocks.erase.mockRejectedValueOnce(
      new Error('Chrome error at https://rsch.baml.com/r?token=private-token'),
    );

    const result = createChromeArchiveIo().downloadUrl(
      'Fin-report-clipper Backup/BofA/2026/report/original.pdf',
      'https://rsch.baml.com/r?q=fake',
      'application/pdf',
    );

    await expect(result).rejects.toThrow('Archive download cleanup failed');
    await expect(result).rejects.not.toThrow('private-token');
    expect(mocks.removeFile).not.toHaveBeenCalled();
    expect(mocks.erase).toHaveBeenCalledWith({ id: 42 });
  });

  it('removes a non-PDF response and still erases its history entry', async () => {
    const mocks = installDownloads({ state: 'complete', mime: 'text/html' });
    await expect(
      createChromeArchiveIo().downloadUrl(
        'Fin-report-clipper Backup/BofA/2026/report/original.pdf',
        'https://rsch.baml.com/r?q=fake',
        'application/pdf',
      ),
    ).rejects.toThrow('Unexpected download MIME');
    expect(mocks.removeFile).toHaveBeenCalledWith(42);
    expect(mocks.erase).toHaveBeenCalledWith({ id: 42 });
  });

  it('reports a sanitized cleanup failure after an invalid download cannot be removed or erased', async () => {
    const mocks = installDownloads({ state: 'complete', mime: 'text/html' });
    mocks.removeFile.mockRejectedValueOnce(new Error('remove denied: private-token'));
    mocks.erase.mockRejectedValueOnce(new Error('erase denied: private-signature'));

    const result = createChromeArchiveIo().downloadUrl(
      'Fin-report-clipper Backup/BofA/2026/report/original.pdf',
      'https://rsch.baml.com/r?q=fake',
      'application/pdf',
    );

    await expect(result).rejects.toThrow('Archive download cleanup failed');
    await expect(result).rejects.not.toThrow('private-token');
    await expect(result).rejects.not.toThrow('private-signature');
    expect(mocks.removeFile).toHaveBeenCalledWith(42);
    expect(mocks.erase).toHaveBeenCalledWith({ id: 42 });
  });

  it('removes an interrupted partial file and erases its history entry', async () => {
    const mocks = installDownloads({
      state: 'interrupted',
      error: 'SERVER_FORBIDDEN',
    });
    await expect(
      createChromeArchiveIo().downloadUrl(
        'Fin-report-clipper Backup/BofA/2026/report/original.pdf',
        'https://rsch.baml.com/r?q=fake',
        'application/pdf',
      ),
    ).rejects.toThrow('SERVER_FORBIDDEN');
    expect(mocks.removeFile).toHaveBeenCalledWith(42);
    expect(mocks.erase).toHaveBeenCalledWith({ id: 42 });
  });

  it('rejects a filename outside the archive root before it reaches Chrome Downloads', async () => {
    const mocks = installDownloads({ state: 'complete', mime: 'application/pdf' });
    await expect(
      createChromeArchiveIo().downloadUrl(
        '../outside.pdf',
        'https://rsch.baml.com/r?q=fake',
        'application/pdf',
      ),
    ).rejects.toThrow('Unsafe archive download filename');
    expect(mocks.download).not.toHaveBeenCalled();
  });

  it('sweeps stale archive download history on background startup', async () => {
    const mocks = installDownloads({ state: 'complete', mime: 'application/pdf' });
    await eraseArchiveDownloadHistory();
    expect(mocks.erase).toHaveBeenCalledWith({
      filenameRegex: expect.stringContaining('Fin-report-clipper Backup'),
    });
    const regex = new RegExp(mocks.erase.mock.calls[0][0].filenameRegex!);
    expect(regex.test('/Downloads/Fin-report-clipper Backup/BofA/report.pdf')).toBe(true);
    expect(regex.test('/Downloads/Sky-Clipper Backup/X/123/original.md')).toBe(true);
    expect(regex.test('/Downloads/Sky-Clipper Backup/WeChat/short-fixture/original.md')).toBe(true);
    expect(regex.test('/Downloads/Sky-Clipper Backup/WeChat-other/manual.txt')).toBe(false);
    expect(regex.test(String.raw`C:\Downloads\Sky-Clipper Backup\X\123\original.md`)).toBe(true);
    expect(regex.test('/Downloads/notes/Fin-report-clipper Backup planning.pdf')).toBe(false);
    expect(regex.test('/Downloads/Sky-Clipper Backup/other-folder/manual.txt')).toBe(false);

  });

  it('waits for in-progress archive downloads to settle before recovery', async () => {
    const search = vi
      .fn()
      .mockResolvedValueOnce([{ id: 9, state: 'in_progress' }])
      .mockResolvedValueOnce([]);
    let sleeps = 0;

    await waitForArchiveDownloadsToSettle({
      downloads: { search },
      sleep: async () => {
        sleeps += 1;
      },
      maxAttempts: 2,
    });

    expect(search).toHaveBeenCalledWith({
      filenameRegex: expect.stringContaining('Fin-report-clipper Backup'),
      state: 'in_progress',
    });
    expect(sleeps).toBe(1);
  });

  it('waits past twenty active polls by default until downloads actually settle', async () => {
    let polls = 0;
    let sleeps = 0;

    await waitForArchiveDownloadsToSettle({
      downloads: {
        async search() {
          polls += 1;
          return polls <= 21 ? [{ id: 9, state: 'in_progress' }] : [];
        },
      },
      sleep: async () => {
        sleeps += 1;
      },
    });

    expect(polls).toBe(22);
    expect(sleeps).toBe(21);
  });

  it('keeps recovery blocked when archive downloads do not settle in time', async () => {
    await expect(
      waitForArchiveDownloadsToSettle({
        downloads: { search: async () => [{ id: 9, state: 'in_progress' }] },
        sleep: async () => {},
        maxAttempts: 2,
      }),
    ).rejects.toThrow('Archive download recovery timed out');
  });

  it('treats a successful offscreen close as a released Blob when revoke fails', async () => {
    const mocks = installDownloads({ state: 'complete', mime: 'text/markdown' });
    const closeDocument = vi.fn(async () => undefined);
    vi.stubGlobal('chrome', {
      downloads: {
        ...chrome.downloads,
      },
      runtime: {
        ContextType: { OFFSCREEN_DOCUMENT: 'OFFSCREEN_DOCUMENT' },
        getURL: vi.fn(() => 'chrome-extension://test/offscreen.html'),
        getContexts: vi.fn(async () => []),
        sendMessage: vi
          .fn()
          .mockImplementationOnce(async (request) => ({
            ok: true,
            requestId: request.requestId,
            url: 'blob:private-markdown-url',
          }))
          .mockRejectedValueOnce(new Error('Blob release failed: private-markdown-content')),
      },
      offscreen: {
        Reason: { BLOBS: 'BLOBS' },
        createDocument: vi.fn(async () => undefined),
        closeDocument,
      },
    });

    const result = createChromeArchiveIo().writeText(
      'Fin-report-clipper Backup/BofA/2026/report/original.md',
      'private-markdown-content',
      'text/markdown;charset=utf-8',
    );

    await expect(result).resolves.toBeUndefined();
    expect(closeDocument).toHaveBeenCalledTimes(1);
    expect(mocks.erase).toHaveBeenCalledWith({ id: 42 });
  });

  it('reports a sanitized error only when Blob revoke and offscreen close both fail', async () => {
    const mocks = installDownloads({ state: 'complete', mime: 'text/markdown' });
    const closeDocument = vi.fn(async () => {
      throw new Error('close failed: private-blob-url');
    });
    vi.stubGlobal('chrome', {
      downloads: {
        ...chrome.downloads,
      },
      runtime: {
        ContextType: { OFFSCREEN_DOCUMENT: 'OFFSCREEN_DOCUMENT' },
        getURL: vi.fn(() => 'chrome-extension://test/offscreen.html'),
        getContexts: vi.fn(async () => []),
        sendMessage: vi
          .fn()
          .mockImplementationOnce(async (request) => ({
            ok: true,
            requestId: request.requestId,
            url: 'blob:private-markdown-url',
          }))
          .mockRejectedValueOnce(new Error('Blob release failed: private-markdown-content')),
      },
      offscreen: {
        Reason: { BLOBS: 'BLOBS' },
        createDocument: vi.fn(async () => undefined),
        closeDocument,
      },
    });

    const result = createChromeArchiveIo().writeText(
      'Fin-report-clipper Backup/BofA/2026/report/original.md',
      'private-markdown-content',
      'text/markdown;charset=utf-8',
    );

    await expect(result).rejects.toThrow('Archive Blob cleanup failed');
    await expect(result).rejects.not.toThrow('private-markdown-content');
    await expect(result).rejects.not.toThrow('private-blob-url');
    expect(closeDocument).toHaveBeenCalledTimes(1);
    expect(mocks.erase).toHaveBeenCalledWith({ id: 42 });
  });
});
