import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  createChromeArchiveIo,
  eraseArchiveDownloadHistory,
} from '@/utils/research/chrome-archive-io';

interface SimulatedDownload {
  state: 'complete' | 'interrupted';
  mime?: string;
  error?: string;
}

function installDownloads(item: SimulatedDownload) {
  const download = vi.fn(async () => 42);
  const search = vi.fn(async () => [{ id: 42, ...item }]);
  const removeFile = vi.fn(async () => undefined);
  const erase = vi.fn(async () => [42]);
  vi.stubGlobal('chrome', {
    downloads: {
      download,
      search,
      removeFile,
      erase,
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
  });
});
