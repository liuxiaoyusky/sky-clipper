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
    isCurrent(runGeneration, runKey) {
      return generation === runGeneration && key === runKey;
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
    if (tracker.observe(evidence)) return 'ready';
    await options.sleep(intervalMs);
  }
  return 'timeout';
}
