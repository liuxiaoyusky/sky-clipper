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

## Review 1 follow-up: RED -> GREEN

### RED

Added five review-regression tests before changing production code:

- loaded history entries and entries passed to `upsert()` must be recreated as exactly the five
  `CaptureHistoryEntry` fields, dropping synthetic `rawUrl` and `pdfUrl` extras;
- a complete history entry must win over a same-hash partial in either array order;
- a partial retry following a different complete hash must retain its folder and be marked as a
  revision;
- a URL-shaped title containing synthetic report, email, and signature values must not place them
  in the resulting plan paths;
- an unsafe `safePathSegment()` fallback must be normalized before return.

Command:

```sh
npm test -- tests/research/archive-plan.test.ts tests/research/history.test.ts
```

Result: FAIL as expected — 5 failures across the new 12-test focused suite. They showed original
extra URL fields returned by history, partial winning due to order-dependent `.find()`, a false
partial-retry revision flag, private title values in planned paths, and an unchanged unsafe fallback.

### GREEN

- History now validates then constructs a new allowlisted five-field entry on both load and upsert.
- Archive resolution searches complete same-hash entries before partial entries; partial retries
  calculate `revision` from the presence of any different content hash for the identity.
- Report titles pass through `sanitizeTextContent()` before becoming a path segment.
- `safePathSegment()` applies its same cleaner to its fallback, then uses a fixed safe last resort.

The first full compile after the behavior changes exposed TypeScript's inability to carry narrowing
through a combined boolean expression in the new history normalizer. The normalizer was rewritten
to narrow local fields directly; no behavior or test expectation changed.

Final commands and results:

```sh
npm test -- tests/research/archive-plan.test.ts tests/research/history.test.ts
# PASS: 2 files, 12 tests
npm test
# PASS: 7 files, 41 tests
npm run compile
# PASS
git diff --check
# PASS
```

## Review 1 self-review

All four review findings are covered by tests and their corresponding implementation boundaries.
The code still does not add a Downloads write, archive transaction, PDF transfer, Offscreen document,
or queue. URL-like values are not kept in history extras and title values are sanitized before a path
is planned.
