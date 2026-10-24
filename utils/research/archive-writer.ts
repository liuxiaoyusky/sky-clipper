import { sha256Text } from './hash';
import { redactError } from './privacy';
import type { ArchivePlan, CaptureSubmission } from './types';

export interface ArchiveIo {
  writeText(path: string, content: string, mime: string): Promise<void>;
  downloadUrl(path: string, url: string, expectedMimePrefix?: string): Promise<void>;
  close(): Promise<void>;
}

export interface ArchiveWriteResult {
  status: 'complete' | 'partial';
  warnings: string[];
  files: string[];
}

function withCaptureStatus(markdown: string, status: ArchiveWriteResult['status']): string {
  const pattern = /^capture_status: (complete|partial)$/m;
  if (!pattern.test(markdown)) throw new Error('Markdown capture_status field is missing');
  return markdown.replace(pattern, `capture_status: ${status}`);
}

export async function writeArchive(
  plan: ArchivePlan,
  submission: CaptureSubmission,
  io: ArchiveIo,
): Promise<ArchiveWriteResult> {
  const markdown = submission.document.originalMarkdown;
  if (!markdown) throw new Error('HTML report has no original Markdown');

  const warnings: string[] = [];
  const expectsPdf = Boolean(plan.originalPdfPath);
  const files: Array<{
    path: string;
    role: 'original-markdown' | 'original-pdf';
    sha256?: string;
  }> = [];

  if (expectsPdf) {
    await io.writeText(
      plan.originalMarkdownPath,
      withCaptureStatus(markdown, 'partial'),
      'text/markdown;charset=utf-8',
    );
  }

  if (plan.originalPdfPath && submission.transientPdfUrl) {
    try {
      await io.downloadUrl(plan.originalPdfPath, submission.transientPdfUrl, 'application/pdf');
      files.push({ path: plan.originalPdfPath, role: 'original-pdf' });
    } catch (error) {
      warnings.push(`PDF download failed: ${redactError(error)}`);
    }
  } else if (plan.originalPdfPath) {
    warnings.push('PDF download failed: provider URL is unavailable');
  }

  const status = warnings.length ? 'partial' : 'complete';
  const finalMarkdown = withCaptureStatus(markdown, status);
  if (!expectsPdf || status === 'complete') {
    await io.writeText(
      plan.originalMarkdownPath,
      finalMarkdown,
      'text/markdown;charset=utf-8',
    );
  }

  files.unshift({
    path: plan.originalMarkdownPath,
    role: 'original-markdown',
    sha256: await sha256Text(finalMarkdown),
  });
  const manifest = {
    schema: 'fin-report-clipper/capture-v1',
    provider: submission.document.provider,
    ...(submission.document.sourceId ? { source_id: submission.document.sourceId } : {}),
    source_type: submission.document.sourceType,
    adapter_version: submission.adapterVersion,
    sanitized_source: submission.document.sanitizedSource,
    captured_at: submission.document.capturedAt,
    content_hash: submission.document.contentHash,
    capture_status: status,
    observed_metadata: submission.document.observedMetadata,
    files,
    warnings,
  };
  try {
    await io.writeText(
      plan.manifestPath,
      `${JSON.stringify(manifest, null, 2)}\n`,
      'application/json;charset=utf-8',
    );
  } catch (error) {
    // The archive skill can rebuild this index; do not invalidate irreplaceable originals.
    warnings.push(`Manifest download failed: ${redactError(error)}`);
  }
  return { status, warnings, files: files.map((file) => file.path) };
}
