import { writeArchive, type ArchiveIo, type ArchiveWriteResult } from './archive-writer';
import type { HistoryRepository } from './history';
import { resolveArchivePlan } from './path';
import { redactError } from './privacy';
import type { ArchivePlan, CaptureResult, CaptureSubmission } from './types';

export interface CaptureServiceDependencies {
  history: HistoryRepository;
  createIo(): ArchiveIo;
  write?: (
    plan: ArchivePlan,
    submission: CaptureSubmission,
    io: ArchiveIo,
  ) => Promise<ArchiveWriteResult>;
}

export interface CaptureService {
  submit(submission: CaptureSubmission): Promise<CaptureResult>;
}

export function createCaptureService(dependencies: CaptureServiceDependencies): CaptureService {
  let serial: Promise<void> = Promise.resolve();
  const write = dependencies.write || writeArchive;

  async function process(submission: CaptureSubmission): Promise<CaptureResult> {
    try {
      const history = await dependencies.history.load();
      const resolution = await resolveArchivePlan(submission.document, history);
      if (resolution.kind === 'duplicate') {
        return { status: 'duplicate', archivePath: resolution.entry.archivePath };
      }

      const io = dependencies.createIo();
      let result: ArchiveWriteResult;
      try {
        result = await write(resolution.plan, submission, io);
      } finally {
        await io.close().catch(() => {});
      }
      try {
        await dependencies.history.upsert({
          identityKey: resolution.plan.identityKey,
          contentHash: submission.document.contentHash,
          archivePath: resolution.plan.archiveDir,
          status: result.status,
          capturedAt: submission.document.capturedAt,
        });
      } catch (error) {
        return {
          status: 'partial',
          archivePath: resolution.plan.archiveDir,
          warnings: [...result.warnings, `History update failed: ${redactError(error)}`],
        };
      }
      return result.status === 'complete'
        ? { status: 'saved', archivePath: resolution.plan.archiveDir }
        : {
            status: 'partial',
            archivePath: resolution.plan.archiveDir,
            warnings: result.warnings,
          };
    } catch (error) {
      return { status: 'failed', reason: redactError(error) };
    }
  }

  return {
    submit(submission) {
      const task = serial.then(() => process(submission));
      serial = task.then(
        () => undefined,
        () => undefined,
      );
      return task;
    },
  };
}
