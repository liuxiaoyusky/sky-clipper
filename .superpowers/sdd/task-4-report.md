# Task 4 Report: 安全归档路径、历史、去重与修订判定

## Status

Completed. This task adds planning and local-history boundaries only. It does not write files,
invoke the Downloads API, create an Offscreen document, or add a background queue.

## RED -> GREEN

1. Added `tests/research/archive-plan.test.ts` and `tests/research/history.test.ts` before the
   production modules existed.
2. Ran `npm test -- tests/research/archive-plan.test.ts tests/research/history.test.ts`.
   It failed as expected because `@/utils/research/path` and `@/utils/research/history` could not
   be resolved.
3. Added the minimum `path.ts` and `history.ts` implementations.
4. Re-ran the focused command: 2 test files, 7 tests passed.
5. Refactored shared write-plan construction while preserving the focused green result.

## Delivered files

- `utils/research/path.ts`
  - Fixed Downloads-relative backup root.
  - Safe path segment construction and capture timestamp validation.
  - Same identity/hash duplicate handling, partial retry reuse, and changed-content revisions.
  - Rejects unsafe source IDs, content hashes, and historical archive paths before they can affect a plan.
- `utils/research/history.ts`
  - Uses only `fin_report_clipper_history` through a small `chrome.storage.local` port.
  - Does not read or migrate any older key.
  - Drops malformed, non-relative, traversal, separator-injected, or URL-shaped history values.
- `tests/research/archive-plan.test.ts`
- `tests/research/history.test.ts`

## Verification

- `npm test -- tests/research/archive-plan.test.ts tests/research/history.test.ts` — PASS (2 files, 7 tests).
- `npm test` — PASS (7 files, 36 tests).
- `npm run compile` — PASS.
- `git diff --check` — PASS.

## Remaining boundary / concern

Actual Downloads API writes, archive transactions, PDF transfer, and queue orchestration remain
intentionally out of scope for later tasks. Callers must provide the complete content hash in the
history entry; this task preserves and compares it but does not create the persisted entry after a
write because no write transaction exists yet.
