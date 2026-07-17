import { writeArchive, type ArchiveIo, type ArchiveWriteResult } from './archive-writer';
import type { HistoryRepository } from './history';
import { resolveArchivePlan } from './path';
import { redactError } from './privacy';
import type { ArchivePlan, CaptureResult, CaptureSubmission } from './types';

export interface CaptureServiceDependencies {
  history: HistoryRepository;
  createIo(): ArchiveIo;
  recovery?: CaptureStartupRecovery;
  write?: (
    plan: ArchivePlan,
    submission: CaptureSubmission,
    io: ArchiveIo,
  ) => Promise<ArchiveWriteResult>;
}

export const ACTIVE_CAPTURE_LEASE_KEY = 'fin_report_clipper_active_capture';

export interface SessionStoragePort {
  get(key: string): Promise<Record<string, unknown>>;
  set(items: Record<string, unknown>): Promise<void>;
  remove(key: string): Promise<void>;
}

export interface CaptureLease {
  acquire(): Promise<void>;
  release(): Promise<void>;
}

export interface CaptureStartupRecovery {
  ready(): Promise<void>;
  lease: CaptureLease;
}

export function createCaptureStartupRecovery(dependencies: {
  session: SessionStoragePort;
  sweep(): Promise<void>;
}): CaptureStartupRecovery {
  const ready = (async () => {
    const state = await dependencies.session.get(ACTIVE_CAPTURE_LEASE_KEY);
    await dependencies.sweep();
    if (state[ACTIVE_CAPTURE_LEASE_KEY] !== undefined) {
      await dependencies.session.remove(ACTIVE_CAPTURE_LEASE_KEY);
    }
  })();
  void ready.catch(() => {});

  return {
    ready: () => ready,
    lease: {
      async acquire() {
        await dependencies.session.set({
          [ACTIVE_CAPTURE_LEASE_KEY]: { startedAt: new Date().toISOString() },
        });
      },
      async release() {
        await dependencies.session.remove(ACTIVE_CAPTURE_LEASE_KEY);
      },
    },
  };
}

export interface CaptureService {
  submit(submission: CaptureSubmission): Promise<CaptureResult>;
}

export function createCaptureService(dependencies: CaptureServiceDependencies): CaptureService {
  let serial: Promise<void> = Promise.resolve();
  const write = dependencies.write || writeArchive;

  async function process(submission: CaptureSubmission): Promise<CaptureResult> {
    const recovery = dependencies.recovery;
    if (!recovery) return processArchive(submission);
    try {
      await recovery.ready();
      await recovery.lease.acquire();
    } catch (error) {
      return { status: 'failed', reason: `Capture recovery failed: ${redactError(error)}` };
    }

    const result = await processArchive(submission);
    try {
      await recovery.lease.release();
    } catch (error) {
      if (result.status === 'failed') return result;
      return {
        status: 'partial',
        archivePath: result.archivePath,
        warnings: [
          ...(result.status === 'partial' ? result.warnings : []),
          `Capture lease release failed: ${redactError(error)}`,
        ],
      };
    }
    return result;
  }

  async function processArchive(submission: CaptureSubmission): Promise<CaptureResult> {
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
