# Task 6 Report: 串行捕获服务与 BofA 页面自动检测

## Status

Completed. The background service now serializes report capture work globally, and the sole content
script automatically observes eligible BofA report pages. This task does not add UI work, a URL
queue, entry discovery, browser control, or any change to archive transaction primitives.

## RED -> GREEN

1. Added the three requested focused test files before the service, observer, or status modules
   existed.
2. Ran:

   ```sh
   npm test -- tests/research/capture-service.test.ts tests/research/observe.test.ts tests/research/status.test.ts
   ```

   RED occurred as expected: all three suites failed at import resolution because the three new
   modules did not exist.
3. Added the minimal serial capture service, bounded three-probe observer, and status presentation
   mapper. Replaced the old general-purpose background and content entrypoints with the specified
   BofA-only flow.
4. Re-ran the focused command: PASS, 3 files and 6 tests.
5. Refactoring was limited to the shared serial-promise continuation and the content-script local
   status helpers; no additional workflow was introduced.

## Delivered files

- `utils/research/capture-service.ts` — global concurrency-one submit queue, duplicate short
  circuit before archive IO, archive result/history handling, and redacted errors.
- `utils/research/observe.ts` — bounded stable-readiness polling with cancellation, timeout, and
  immediate auth handling.
- `utils/research/status.ts` — internal page status to user-facing label/tone mapping.
- `entrypoints/background.ts` — startup download-history sweep and guarded capture-message route.
- `entrypoints/content.ts` — BofA-only automatic page observation, settings re-evaluation, guarded
  status response, extraction, and background submission.
- `tests/research/capture-service.test.ts`
- `tests/research/observe.test.ts`
- `tests/research/status.test.ts`

## Verification

- Focused tests — PASS: 3 files, 6 tests.
- `npm test` — PASS: 12 files, 62 tests.
- `npm run compile` — PASS.
- `npm run build` — PASS.
- Built manifest declares one content-script match only: `https://rsch.baml.com/*`.
- `LC_ALL=C grep -n '[^ -~]' .output/chrome-mv3/content-scripts/content.js` returned no matches
  (the expected non-match exit status), confirming the built content script is ASCII-only.
- `git diff --check` — PASS.

## Self-review and remaining boundary

- All capture requests pass the Task 5 request guard; unknown messages receive no asynchronous
  response. Raw page/PDF URLs remain only in the request and unfinished archive operation; history,
  status, and externally returned errors use archive paths or redacted text.
- Complete history is written only after a complete archive result. Partial archive results persist
  partial history for retry; if history persistence itself fails after files save, the user receives
  a redacted partial result rather than a false complete result.
- The content script neither calls tab-closing APIs nor runs outside the BofA host match.
- Real BofA pages, Chrome Downloads, and Offscreen documents were not contacted during verification;
  tests use synthetic ports and DOM-independent evidence only.

## Review 1 follow-up: RED -> GREEN

### RED

Added focused regression coverage before changing production code:

- forged non-top-frame/non-BofA senders, unknown submission properties, uncanonical persisted
  source, and a non-BofA transient PDF URL are rejected by the message guard;
- an abandoned `storage.session` capture lease blocks a new write until startup sweep and lease
  removal finish; a sweep failure returns a redacted recovery failure and does not construct IO;
- a canonical BofA URL/sourceId run key cancels the old generation and accepts a distinct report
  after same-document navigation.

Command:

```sh
npm test -- tests/research/capture-service.test.ts tests/research/observe.test.ts tests/research/status.test.ts tests/research/archive-writer.test.ts
```

Result: FAIL as expected — 4 new assertions failed because there was no sender validator, startup
recovery/lease implementation, or run-key controller.

### GREEN

- `isCaptureRequest()` now has an exact top-level/submission/document allowlist and validates the
  BofA schema, canonical persisted source, timestamp/hash shapes, metadata values, and optional
  transient BofA HTTPS PDF URL. `isBofaCaptureSender()` requires this extension, frame `0`, and a
  BofA HTTPS tab/page sender.
- Startup recovery now sweeps before capture processing starts, clears a stale session lease after
  sweep, and wraps every actual serial capture in a session lease. Recovery/lease errors are
  redacted and never reported as a silent complete result.
- The content script uses a sanitized canonical URL/sourceId key and a generation controller. It
  invalidates old work before probes, extraction, sending, and result application; history API and
  browser navigation events start a new report run.

Final verification:

```sh
npm test -- tests/research/capture-service.test.ts tests/research/observe.test.ts tests/research/status.test.ts tests/research/archive-writer.test.ts
# PASS: 4 files, 16 tests
npm test
# PASS: 12 files, 66 tests
npm run compile
# PASS
npm run build
# PASS
git diff --check
# PASS
```

The built manifest still has only `https://rsch.baml.com/*` as a content-script match. The ASCII
scan of the built content script returned no matches (expected non-match exit status).

## Review 1 self-review

Only Task 6 flow files and the necessary message-contract test/module changed. The implementation
does not add URL discovery/queues, browser control, or tab closing. The session marker contains
only a generated timestamp, raw sender/page/PDF URLs remain transient, and no external error,
status, storage record, or log receives them. Startup recovery is intentionally scoped to the
single service-worker lifecycle and Chrome's `storage.session` lifetime.

## Review 2 follow-up: RED -> GREEN

### RED

Added regressions before implementation for:

- a query-only navigation that keeps the old source ID temporarily, then receives the new source
  ID and must cancel both old generations before recapture;
- startup recovery ordering (`session.get` -> settle archive downloads -> sweep -> clear lease),
  authoritative in-progress archive download polling, and bounded timeout blocking;
- recursive persisted/display string validation for title, lists, metadata strings/string lists,
  and original Markdown, while retaining a public contact email in the original body.

Focused command:

```sh
npm test -- tests/research/capture-service.test.ts tests/research/observe.test.ts tests/research/status.test.ts tests/research/archive-writer.test.ts tests/research/chrome-archive-io.test.ts
```

Result: FAIL as expected — the original code neither waited for in-progress archive downloads nor
validated nested persisted strings, and query-only navigation could retain the old generation.
A final one-test RED then tightened recovery output from a dynamic redacted detail to the fixed
`Capture recovery failed` string.

### GREEN

- History API, `popstate`, and `hashchange` now force a fresh generation even if the sanitized key
  is unchanged. A bounded `MutationObserver` identity check restarts capture when the BofA source ID
  changes; generation/run-key checks remain before probing, extraction, sending, and result apply.
- Startup reconciliation calls `chrome.downloads.search` with the fixed archive-root filename regex
  and `state: 'in_progress'`, polling at most 20 times at 250 ms intervals. Only after it observes
  no active archive downloads does it sweep history and clear a recovered session lease. Timeout or
  search failure leaves the rejected startup promise in place, so capture remains blocked and
  returns the fixed recovery error. The lease retains only `startedAt`; download IDs and URLs are
  not persisted.
- Capture-message validation now requires `sanitizeTextContent(value, sanitizedSource) === value`
  for every persisted/display string recursively, but leaves public contact emails unchanged.

This uses the existing Chrome type contract: `chrome.downloads.search({ filenameRegex, state })`
returns archive `DownloadItem` records, and only their in-progress state/count controls the bounded
barrier. No URL is read into a lease or surfaced in a status/error.

Final verification:

```sh
npm test -- tests/research/capture-service.test.ts tests/research/observe.test.ts tests/research/status.test.ts tests/research/archive-writer.test.ts tests/research/chrome-archive-io.test.ts
# PASS: 5 files, 28 tests
npm test
# PASS: 12 files, 69 tests
npm run compile
# PASS
npm run build
# PASS
git diff --check
# PASS
```

The built manifest remains BofA-only and the built content-script ASCII scan has no matches.

## Review 2 self-review

The new recovery polling is intentionally a fixed-root, fixed-time barrier, not a URL queue. It
does not cancel or manipulate an active Chrome download; it waits for Chrome to settle it before
cleanup. No tab is closed and no browser automation is added. Real download restart behavior is
still not exercised against a live Chrome profile; synthetic download ports cover the supported
type-level search contract and timeout behavior.

## Review 3 follow-up: SPA navigation race — RED -> GREEN

### RED

Added the navigation scheduler tests before production code. They require a query-only navigation
to invalidate the old generation without sending its still-visible report, defer recapture until a
safe DOM identity changes, and start immediately when the navigation event observes the new DOM.

```sh
npm test -- tests/research/observe.test.ts
```

Result: FAIL as expected — both new regressions failed because
`createNavigationCaptureScheduler` did not exist.

### GREEN

- Added a small, DOM-independent navigation scheduler. It invalidates on every location change,
  but waits when the bounded identity is still the old one. A later identity change starts exactly
  one new generation; an event that arrives after the DOM update starts it immediately.
- Identity is the sanitized, 256-character-bounded BofA source ID plus body length, table count,
  and the fixed `fnv1a64` body fingerprint. It does not retain report body text.
- The content script now calls the scheduler before every probe/extract/send/result-apply guard.
  History events only synchronize/invalidate; they never force a capture against the old DOM.
  A 250 ms location watcher covers main-world `pushState`/`replaceState` calls that bypass the
  isolated-world history wrapper. Raw `location.href` is only compared in scheduler closure state;
  it is never used as a key, stored, logged, or placed in status.

Final verification:

```sh
npm test -- tests/research/capture-service.test.ts tests/research/observe.test.ts tests/research/status.test.ts tests/research/archive-writer.test.ts tests/research/chrome-archive-io.test.ts
# PASS: 5 files, 29 tests
npm test
# PASS: 12 files, 70 tests
npm run compile
# PASS
npm run build
# PASS
git diff --check
# PASS
```

The built manifest still has exactly one content-script match,
`https://rsch.baml.com/*`. The production content-script ASCII scan returned no matches (expected
non-match exit status); the manifest intentionally includes its pre-existing Chinese description.

## Review 3 self-review

The scheduler is deliberately limited to capture-generation scheduling; it does not add a URL
queue, persistent navigation state, browser control, or tab closing. Existing readiness probing,
extraction, submission, and result-application guards remain in place. The remaining verification
boundary is a real BofA SPA transition in Chrome: synthetic scheduler tests prove the ordering, but
they do not exercise the target site's rendering timing. The 250 ms watcher is bounded transient
work and provides a fallback for main-world history mutations.

## Review 4 follow-up: identity baseline and settings race — RED -> GREEN

### RED

Added two scheduler regressions before implementation:

- a same-location/same-run synchronization changes the old document identity, then a query-only
  navigation with that still-old identity must remain pending rather than start a capture;
- a settings restart during that pending navigation must invalidate old work but keep waiting until
  the new document identity appears.

```sh
npm test -- tests/research/observe.test.ts
```

Result: FAIL as expected — the old scheduler retained a stale identity baseline and `restart()`
cleared its pending wait and returned a new capture.

### GREEN

- Stable same-location/same-run synchronization now refreshes `previousIdentity` without creating
  another generation. A later navigation therefore compares against the actual last old DOM.
- A settings restart while navigation is pending invalidates the current generation and returns no
  capture while its identity is unchanged. If the new identity is already visible it starts at once;
  otherwise the existing identity synchronization starts exactly one generation after it appears.
  The content script now handles the intentionally optional capture result.

Final verification:

```sh
npm test -- tests/research/capture-service.test.ts tests/research/observe.test.ts tests/research/status.test.ts tests/research/archive-writer.test.ts tests/research/chrome-archive-io.test.ts
# PASS: 5 files, 31 tests
npm test
# PASS: 12 files, 72 tests
npm run compile
# PASS
npm run build
# PASS
git diff --check
# PASS
```

The built manifest still declares the sole BofA content-script match
`https://rsch.baml.com/*`; the generated content script ASCII scan returned no matches (expected
non-match exit status).

## Review 4 self-review

This follow-up changes only scheduler state transitions, the settings-change call site, and their
regressions. It retains the existing transient-only location comparison and does not add storage,
keys, logs, queues, browser control, or tab closing. Synthetic tests cover the scheduler ordering;
a real BofA SPA/settings-toggle timing sequence remains the manual-browser verification boundary.
