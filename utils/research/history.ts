import type { CaptureHistoryEntry } from './types';

export const HISTORY_KEY = 'fin_report_clipper_history';

export interface LocalStoragePort {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
}

export interface HistoryRepository {
  load(): Promise<CaptureHistoryEntry[]>;
  upsert(entry: CaptureHistoryEntry): Promise<void>;
}

function isSafeIdentityKey(value: string): boolean {
  return (
    /^bofa:metadata:[a-f0-9]{24}$/.test(value) ||
    /^bofa:id:[a-zA-Z0-9._ -]{1,80}$/.test(value)
  );
}

function isSafeArchivePath(value: string): boolean {
  return (
    value.startsWith('Fin-report-clipper Backup/BofA/') &&
    !value.includes('\\') &&
    !value.split('/').some((part) => part === '' || part === '.' || part === '..') &&
    !/[\u0000-\u001f\u007f:?*"<>|#[\]]/.test(value)
  );
}

function normalizeHistoryEntry(value: unknown): CaptureHistoryEntry | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const item = value as Record<string, unknown>;
  const { archivePath, capturedAt, contentHash, identityKey, status } = item;
  if (
    typeof identityKey !== 'string' ||
    !isSafeIdentityKey(identityKey) ||
    typeof contentHash !== 'string' ||
    !/^sha256:[a-f0-9]{64}$/.test(contentHash) ||
    typeof archivePath !== 'string' ||
    !isSafeArchivePath(archivePath) ||
    (status !== 'complete' && status !== 'partial') ||
    typeof capturedAt !== 'string' ||
    Number.isNaN(Date.parse(capturedAt))
  ) {
    return undefined;
  }
  return {
    identityKey,
    contentHash,
    archivePath,
    status,
    capturedAt,
  };
}

export function normalizeHistory(value: unknown): CaptureHistoryEntry[] {
  return Array.isArray(value)
    ? value.flatMap((item) => {
        const entry = normalizeHistoryEntry(item);
        return entry ? [entry] : [];
      })
    : [];
}

export function createHistoryRepository(
  storage: LocalStoragePort = chrome.storage.local,
): HistoryRepository {
  const load = async (): Promise<CaptureHistoryEntry[]> => {
    const result = await storage.get(HISTORY_KEY);
    return normalizeHistory(result[HISTORY_KEY]);
  };
  return {
    load,
    async upsert(entry) {
      const normalizedEntry = normalizeHistory([entry])[0];
      if (!normalizedEntry) throw new Error('Invalid capture history entry');
      const current = await load();
      const next = current.filter(
        (item) =>
          item.identityKey !== normalizedEntry.identityKey ||
          item.contentHash !== normalizedEntry.contentHash,
      );
      next.push(normalizedEntry);
      await storage.set({ [HISTORY_KEY]: next });
    },
  };
}
