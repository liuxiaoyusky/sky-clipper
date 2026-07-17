import { StableReadinessTracker } from './adapters/types';
import { canonicalizeBofaUrl, sanitizeTextContent } from './privacy';
import type { ReadinessEvidence } from './types';

export interface StablePageOptions {
  probe(): ReadinessEvidence;
  sleep(milliseconds: number): Promise<void>;
  shouldContinue(): boolean;
  maxAttempts?: number;
  intervalMs?: number;
}

export interface RunController {
  start(key: string): number;
  invalidate(): void;
  isCurrent(generation: number, key: string): boolean;
}

export function bofaRunKey(rawUrl: string, sourceId?: string): string {
  const canonical = canonicalizeBofaUrl(rawUrl).sanitized;
  const safeSourceId = sourceId ? sanitizeTextContent(sourceId, rawUrl).slice(0, 256) : '';
  return `bofa:${canonical}|${safeSourceId}`;
}

export function createRunController(): RunController {
  let generation = 0;
  let key = '';
  return {
    start(nextKey) {
      key = nextKey;
      generation += 1;
      return generation;
    },
    invalidate() {
      generation += 1;
    },
    isCurrent(runGeneration, runKey) {
      return generation === runGeneration && key === runKey;
    },
  };
}

export interface ScheduledCapture {
  generation: number;
  runKey: string;
}

export interface NavigationCaptureScheduler {
  begin(locationHref: string, domIdentity: string, runKey: string): ScheduledCapture;
  restart(
    locationHref: string,
    domIdentity: string,
    runKey: string,
  ): ScheduledCapture | undefined;
  sync(locationHref: string, domIdentity: string, runKey: string): ScheduledCapture | undefined;
  isCurrent(generation: number, runKey: string): boolean;
}

export function bofaDomIdentity(rawUrl: string, evidence: ReadinessEvidence): string {
  const sourceId = evidence.sourceId
    ? sanitizeTextContent(evidence.sourceId, rawUrl).slice(0, 256)
    : '';
  const fingerprint = /^fnv1a64:[0-9a-f]{16}$/.test(evidence.tailText)
    ? evidence.tailText
    : '';
  return `${sourceId}|${evidence.pdfState}|${evidence.bodyTextLength}|${evidence.tableCount}|${fingerprint}`;
}

export function createNavigationCaptureScheduler(): NavigationCaptureScheduler {
  const runs = createRunController();
  let previousLocation = '';
  let previousIdentity = '';
  let previousRunKey = '';
  let waitingForIdentityChange = false;
  const start = (runKey: string): ScheduledCapture => {
    previousRunKey = runKey;
    return { generation: runs.start(runKey), runKey };
  };

  return {
    begin(locationHref, domIdentity, runKey) {
      previousLocation = locationHref;
      previousIdentity = domIdentity;
      waitingForIdentityChange = false;
      return start(runKey);
    },
    restart(locationHref, domIdentity, runKey) {
      if (waitingForIdentityChange && locationHref === previousLocation) {
        runs.invalidate();
        if (domIdentity === previousIdentity) return undefined;
        previousIdentity = domIdentity;
        waitingForIdentityChange = false;
        return start(runKey);
      }
      previousLocation = locationHref;
      previousIdentity = domIdentity;
      waitingForIdentityChange = false;
      return start(runKey);
    },
    sync(locationHref, domIdentity, runKey) {
      if (locationHref !== previousLocation) {
        previousLocation = locationHref;
        runs.invalidate();
        if (domIdentity === previousIdentity) {
          waitingForIdentityChange = true;
          return undefined;
        }
        previousIdentity = domIdentity;
        waitingForIdentityChange = false;
        return start(runKey);
      }
      if (waitingForIdentityChange && domIdentity !== previousIdentity) {
        previousIdentity = domIdentity;
        waitingForIdentityChange = false;
        return start(runKey);
      }
      if (!waitingForIdentityChange && runKey !== previousRunKey) {
        previousIdentity = domIdentity;
        return start(runKey);
      }
      previousIdentity = domIdentity;
      return undefined;
    },
    isCurrent(generation, runKey) {
      return runs.isCurrent(generation, runKey);
    },
  };
}

export async function waitForStablePage(
  options: StablePageOptions,
): Promise<'ready' | 'auth-required' | 'timeout' | 'cancelled'> {
  const tracker = new StableReadinessTracker(3);
  const maxAttempts = options.maxAttempts ?? 30;
  const intervalMs = options.intervalMs ?? 1000;
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (!options.shouldContinue()) return 'cancelled';
    const evidence = options.probe();
    if (evidence.kind === 'auth-required') return 'auth-required';
    const stable = tracker.observe(evidence);
    if (stable && evidence.pdfState === 'available') return 'ready';
    const finalAttempt = attempt === maxAttempts - 1;
    if (finalAttempt) {
      return stable && evidence.pdfState === 'absent-confirmed' ? 'ready' : 'timeout';
    }
    await options.sleep(intervalMs);
  }
  return 'timeout';
}
