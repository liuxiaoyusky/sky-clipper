export type ProviderId = 'bofa';
export type MetadataValue = string | number | boolean | string[] | number[];
export type PageKind =
  | 'report-html'
  | 'auth-required'
  | 'unsupported';

export interface CanonicalResearchUrl {
  provider: ProviderId;
  sanitized: string;
}

export interface CapturedDocument {
  schema: 'fin-report-clipper/capture-v1';
  provider: 'BofA Global Research';
  sourceType: 'html' | 'html+pdf';
  sourceId?: string;
  title?: string;
  publishedAt?: string;
  authors?: string[];
  companies?: string[];
  tickers?: string[];
  observedMetadata: Record<string, MetadataValue>;
  originalMarkdown: string;
  sanitizedSource: string;
  capturedAt: string;
  contentHash: string;
  captureStatus: 'complete' | 'partial';
}

export interface CaptureSubmission {
  adapterVersion: 'bofa-html-v1';
  document: CapturedDocument;
  /** 只在未完成事务中使用；禁止写入存储、界面、日志或归档。 */
  transientPdfUrl?: string;
}

export interface ReadinessEvidence {
  kind: PageKind;
  sourceId?: string;
  title?: string;
  bodyTextLength: number;
  tableCount: number;
  tailText: string;
}

export type CaptureResult =
  | { status: 'saved'; archivePath: string }
  | { status: 'duplicate'; archivePath: string }
  | { status: 'partial'; archivePath: string; warnings: string[] }
  | { status: 'failed'; reason: string };

export type PageStatusCode =
  | 'observing'
  | 'waiting-ready'
  | 'extracting'
  | 'saving'
  | 'saved'
  | 'duplicate'
  | 'partial'
  | 'needs-action'
  | 'failed'
  | 'disabled'
  | 'unsupported';

export interface PageStatus {
  code: PageStatusCode;
  message: string;
  title?: string;
  archivePath?: string;
  updatedAt: string;
}

export interface CaptureHistoryEntry {
  identityKey: string;
  contentHash: string;
  archivePath: string;
  status: 'complete' | 'partial';
  capturedAt: string;
}

export interface ArchivePlan {
  identityKey: string;
  archiveDir: string;
  originalMarkdownPath: string;
  originalPdfPath?: string;
  manifestPath: string;
  revision: boolean;
  retryPartial: boolean;
}
