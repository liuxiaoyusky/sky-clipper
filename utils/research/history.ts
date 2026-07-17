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

function isHistoryEntry(value: unknown): value is CaptureHistoryEntry {
  if (!value || typeof value !== 'object') return false;
  const item = value as Record<string, unknown>;
  return (
    typeof item.identityKey === 'string' &&
    isSafeIdentityKey(item.identityKey) &&
    typeof item.contentHash === 'string' &&
    /^sha256:[a-f0-9]{64}$/.test(item.contentHash) &&
    typeof item.archivePath === 'string' &&
    isSafeArchivePath(item.archivePath) &&
    (item.status === 'complete' || item.status === 'partial') &&
    typeof item.capturedAt === 'string' &&
    !Number.isNaN(Date.parse(item.capturedAt))
  );
}

export function normalizeHistory(value: unknown): CaptureHistoryEntry[] {
  return Array.isArray(value) ? value.filter(isHistoryEntry) : [];
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
      if (!isHistoryEntry(entry)) throw new Error('Invalid capture history entry');
      const current = await load();
      const next = current.filter(
        (item) =>
          item.identityKey !== entry.identityKey || item.contentHash !== entry.contentHash,
      );
      next.push(entry);
      await storage.set({ [HISTORY_KEY]: next });
    },
  };
}
