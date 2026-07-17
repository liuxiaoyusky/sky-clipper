import { StableReadinessTracker } from './adapters/types';
import type { ReadinessEvidence } from './types';

export interface StablePageOptions {
  probe(): ReadinessEvidence;
  sleep(milliseconds: number): Promise<void>;
  shouldContinue(): boolean;
  maxAttempts?: number;
  intervalMs?: number;
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
