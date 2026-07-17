import type {
  CaptureSubmission,
  PageKind,
  ReadinessEvidence,
} from '../types';

export interface ResearchSiteAdapter {
  id: 'bofa';
  classifyPage(document: Document, url: URL): PageKind;
  readinessEvidence(document: Document, url: URL): ReadinessEvidence;
  extractOriginal(
    document: Document,
    rawUrl: string,
    capturedAt: string,
  ): Promise<CaptureSubmission>;
  findOriginalPdf(document: Document): string | null;
  getSourceId(document: Document): string | null;
}

function evidenceSignature(evidence: ReadinessEvidence): string {
  return JSON.stringify([
    evidence.kind,
    evidence.sourceId,
    evidence.title,
    evidence.bodyTextLength,
    evidence.tableCount,
    evidence.tailText,
  ]);
}

export class StableReadinessTracker {
  private previous = '';
  private stableCount = 0;

  constructor(private readonly requiredPasses = 3) {}

  observe(evidence: ReadinessEvidence): boolean {
    if (
      evidence.kind !== 'report-html' ||
      !evidence.sourceId ||
      !evidence.title ||
      evidence.bodyTextLength < 200
    ) {
      this.previous = '';
      this.stableCount = 0;
      return false;
    }
    const current = evidenceSignature(evidence);
    this.stableCount = current === this.previous ? this.stableCount + 1 : 1;
    this.previous = current;
    return this.stableCount >= this.requiredPasses;
  }
}
