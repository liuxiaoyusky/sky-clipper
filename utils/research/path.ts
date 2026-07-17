import { sha256Text, stableJson } from './hash';
import type {
  ArchivePlan,
  CaptureHistoryEntry,
  CapturedDocument,
} from './types';

export const BACKUP_ROOT = 'Fin-report-clipper Backup';

export type ArchiveResolution =
  | { kind: 'duplicate'; entry: CaptureHistoryEntry }
  | { kind: 'write'; plan: ArchivePlan };

const HASH_PREFIX = 'sha256:';
const SAFE_ARCHIVE_PREFIX = `${BACKUP_ROOT}/BofA/`;

export function safePathSegment(value: string, fallback = 'untitled'): string {
  const clean = value
    .normalize('NFKC')
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/[\\/:*?"<>|#\[\]]/g, ' ')
    .replace(/\s+/g, ' ')
    .replace(/^\.+/, '')
    .replace(/[. ]+$/, '')
    .trim()
    .slice(0, 80);
  return clean || fallback;
}

function isSafeSourceId(value: string): boolean {
  return (
    value.length > 0 &&
    value.length <= 80 &&
    !/[\\/:?#[\]\u0000-\u001f\u007f]/.test(value) &&
    !value.includes('..')
  );
}

function isContentHash(value: string): boolean {
  return new RegExp(`^${HASH_PREFIX}[a-f0-9]{64}$`).test(value);
}

function isSafeArchiveDir(value: string): boolean {
  return (
    value.startsWith(SAFE_ARCHIVE_PREFIX) &&
    !value.includes('\\') &&
    !value.split('/').some((part) => part === '' || part === '.' || part === '..') &&
    !/[\u0000-\u001f\u007f:?*"<>|#[\]]/.test(value)
  );
}

function isValidCapturedAt(value: string): boolean {
  const date = /^\d{4}-\d{2}-\d{2}/.exec(value)?.[0];
  if (!date || Number.isNaN(Date.parse(value))) return false;
  return new Date(`${date}T00:00:00.000Z`).toISOString().slice(0, 10) === date;
}

function captureDate(value: string): string {
  if (!isValidCapturedAt(value)) throw new Error('Invalid capturedAt timestamp');
  return value.slice(0, 10);
}

export async function buildIdentityKey(document: CapturedDocument): Promise<string> {
  if (document.sourceId) {
    if (!isSafeSourceId(document.sourceId)) throw new Error('Invalid sourceId');
    return `bofa:id:${document.sourceId}`;
  }
  const metadataHash = await sha256Text(
    stableJson({
      provider: document.provider,
      title: document.title,
      publishedAt: document.publishedAt,
      authors: document.authors,
    }),
  );
  return `bofa:metadata:${metadataHash.slice(HASH_PREFIX.length, HASH_PREFIX.length + 24)}`;
}

function pathFor(archiveDir: string, filename: string): string {
  return `${archiveDir}/${filename}`;
}

function writePlan(
  document: CapturedDocument,
  identityKey: string,
  archiveDir: string,
  revision: boolean,
  retryPartial: boolean,
): ArchiveResolution {
  return {
    kind: 'write',
    plan: {
      identityKey,
      archiveDir,
      originalMarkdownPath: pathFor(archiveDir, 'original.md'),
      ...(document.sourceType === 'html+pdf'
        ? { originalPdfPath: pathFor(archiveDir, 'original.pdf') }
        : {}),
      manifestPath: pathFor(archiveDir, '.fin-report-clipper/capture.json'),
      revision,
      retryPartial,
    },
  };
}

export async function resolveArchivePlan(
  document: CapturedDocument,
  history: CaptureHistoryEntry[],
): Promise<ArchiveResolution> {
  if (!isContentHash(document.contentHash)) throw new Error('Invalid contentHash');

  const identityKey = await buildIdentityKey(document);
  const sameIdentity = history.filter(
    (entry) => entry.identityKey === identityKey && isSafeArchiveDir(entry.archivePath),
  );
  const sameHash = sameIdentity.find((entry) => entry.contentHash === document.contentHash);
  if (sameHash?.status === 'complete') return { kind: 'duplicate', entry: sameHash };

  if (sameHash?.status === 'partial') {
    return writePlan(document, identityKey, sameHash.archivePath, false, true);
  }

  const date = captureDate(document.capturedAt);
  const year = date.slice(0, 4);
  const title = safePathSegment(document.title || 'untitled-report');
  const shortId = safePathSegment(
    document.sourceId || document.contentHash.slice(HASH_PREFIX.length, HASH_PREFIX.length + 8),
  ).slice(0, 16);
  const revision = sameIdentity.length > 0;
  const hashSuffix = document.contentHash.slice(HASH_PREFIX.length, HASH_PREFIX.length + 16);
  const versionSuffix = revision ? `-rev-${hashSuffix}` : `-${hashSuffix}`;
  const archiveDir = `${BACKUP_ROOT}/BofA/${year}/${date}-${title}-${shortId}${versionSuffix}`;

  return writePlan(document, identityKey, archiveDir, revision, false);
}
