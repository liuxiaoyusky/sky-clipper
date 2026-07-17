# Task 8 Report: Chrome-only CI、manifest 断言与发布包命名

## Status

Completed. This task changes local verification, GitHub automation configuration, the pull-request
template, and Dependabot policy only. It does not publish, upload, push, create a GitHub release,
or alter `LICENSE`.

## RED -> GREEN

### RED

Added `tests/research/release-config.test.ts` before changing automation. The initial focused run:

```sh
npm test -- tests/research/release-config.test.ts
```

failed as expected: CI had no `npm run verify` and still referenced `build:edge`; release had the
old `zhaoji-clipper` archive names and Edge assets.

Added a second boundary assertion requiring the generated-manifest check to reject both options and
icons. It failed as expected because the initial check did not list `icons` as forbidden.

### GREEN

- Added `check:ascii`, `check:manifest`, and the single `verify` command. The manifest checker
  asserts exact Fin-report-clipper identity, Chrome 116 floor, the three allowed permissions, the
  sole BofA host/content-script match, and rejects options, icons, and legacy capabilities.
- CI now calls only `npm run verify`. Release verifies first, makes one Chrome archive with
  `npm run zip`, and publishes only the versioned Chrome archive plus the exact stable alias
  `fin-report-clipper-chrome.zip` when the release workflow is intentionally triggered.
- Removed Edge and legacy brand paths from CI/release/PR configuration. Dependabot retains only
  the requested WXT/ASCII safety major-version exclusions and monthly GitHub Actions updates.

The focused config test passes after each change:

```sh
npm test -- tests/research/release-config.test.ts
# PASS: 1 file, 3 tests
```

## Verification

```sh
npm run verify
# PASS: 15 files, 81 tests
# PASS: TypeScript compile
# PASS: Chrome build
# PASS: content script ASCII check
# PASS: exact Chrome manifest check

npm run zip
# PASS: .output/fin-report-clipper-0.1.0-chrome.zip
```

The zip inventory contains only the Chrome MV3 build files. A scan over `package.json`, `.github`,
and `scripts` found no Edge, Firefox, or `zhaoji` workflow/command/brand references. Workflow
inspection confirms only the versioned Chrome archive and `fin-report-clipper-chrome.zip` alias.
`git diff --check` passes.

## Self-review and remaining boundary

The only generated artifact was a local zip for inspection; it was not uploaded or released. The
release workflow was reviewed as text but intentionally not executed, so tag-triggered GitHub
permissions, audit availability, and release-asset upload remain CI/release-environment checks for
Task 9's candidate process. No Firefox/Edge artifact, command, job, or user-facing workflow text
remains in the configured automation surface.

## Review 1 follow-up: release least privilege and generated-output coverage

### RED

Added structural regression checks before changing automation:

- exact tag-only trigger; separate read-only `build` and `contents: write` `release` jobs; build
  checkout credentials disabled; version/package check; SHA-pinned actions; verified artifact
  transfer; versioned source for the alias; and exactly two publish assets;
- manifest version 3, absent-or-empty optional permissions/hosts, exact generated content-script JS
  set, and ASCII traversal driven by every JavaScript file declared in the manifest.

```sh
npm test -- tests/research/release-config.test.ts
```

Result: FAIL as expected — the old workflow had no `build` job, and the existing manifest/ASCII
scripts did not contain the new capability or generated-file constraints. A follow-up RED caught
the inherited top-level `contents: write` permission. The test helper's first EOF parsing mistake
was corrected before evaluating workflow behavior.

### GREEN

- Release now has a read-only `build` job that disables checkout credentials, verifies the tag and
  package version, runs `npm run verify`, zips Chrome, creates the stable alias from the versioned
  archive, then uploads exactly those two files through a SHA-pinned artifact action.
- The `release` job depends on `build`, has the only `contents: write` permission, downloads the
  verified artifact through a SHA-pinned action, and only creates the GitHub release with the two
  downloaded Chrome assets. It does not checkout, install dependencies, build, or package.
- `check-manifest` now asserts MV3, absent-or-empty optional permission fields, and the exact
  content-script JavaScript set. `check-content-ascii` loads the generated manifest and checks each
  declared content script rather than a hardcoded path.

Final verification:

```sh
npm test -- tests/research/release-config.test.ts
# PASS: 1 file, 5 tests
npm run verify
# PASS: 15 files, 83 tests; compile, Chrome build, manifest, and ASCII checks
npm run zip
# PASS: .output/fin-report-clipper-0.1.0-chrome.zip
```

The local stable alias was copied from that versioned archive and both SHA-256 values were
`ebe32bac1be7d245da9d6fb1c65c73a2e4038615b5b5cb00817cfd3afb7cccd6`. Action scans show only
40-character SHA pins; old browser/brand scans return no workflow/config hits; `git diff --check`
passes.

## Review 1 self-review

The release workflow remains unexecuted by design: this work neither uploaded an artifact to GitHub
nor created, updated, or pushed a release. The local alias copy is restricted to ignored `.output`.
The remaining boundary is GitHub-hosted artifact transfer and release permissions under a real tag,
which belongs to Task 9's candidate validation rather than this local hardening task.

## Review 2 follow-up: non-hidden artifact handoff and fixture checks

### RED

Added regressions before implementation for:

- an exact tag-only trigger, exactly `build` and `release` jobs, validated package-version step/job
  output wiring, two shell-staged files under non-hidden `release-assets/`, identical upload/download
  artifact names and paths, and exactly two published downloaded assets;
- temporary output-root fixtures that must reject MV2, non-empty optional permissions, non-empty
  optional hosts, extra content-script JavaScript, and a non-ASCII second declared content script;
- removal of the unreachable custom release-notes branch.

```sh
npm test -- tests/research/release-config.test.ts
```

Result: FAIL as expected — the workflow had no staging step, its upload paths were hidden and used
unexpanded Bash syntax, and both checker scripts ignored every supplied fixture path. Six new cases
failed for those reasons.

### GREEN

- The validated package version is now a step output and read-only build-job output. A shell step
  copies the WXT versioned zip into `release-assets/`, then copies that staged file to the exact
  stable alias. Upload lists exactly those two non-hidden files.
- The write-permission job downloads the same named artifact into the same `release-assets/` path,
  receives the validated version through `needs.build.outputs.version`, and passes exactly those two
  downloaded files to `gh release create`.
- The release command now uses only `--generate-notes`; the unreachable file-notes branch is gone.
- Both checker CLIs accept an optional output-root argument while preserving the production default,
  enabling real temporary-fixture execution rather than textual script inspection alone.

Final verification:

```sh
npm test -- tests/research/release-config.test.ts
# PASS: 1 file, 11 tests
npm run verify
# PASS: 15 files, 89 tests; compile, Chrome build, manifest, and ASCII checks
npm run zip
# PASS: .output/fin-report-clipper-0.1.0-chrome.zip
```

Local workflow-equivalent staging produced exactly
`release-assets/fin-report-clipper-0.1.0-chrome.zip` and
`release-assets/fin-report-clipper-chrome.zip`. The source and both staged files share SHA-256
`31e29c9010578d7e6f651b3e40732eac416ed90b77fa02a1fa709bc735a765e6`. Trigger/notes scans,
non-SHA action scans, old browser/brand scans, and `git diff --check` all pass.

## Review 2 self-review

The staging directory contains only ignored local zip artifacts created for validation; no GitHub
artifact upload, release, or push was executed. The structure test rejects extra top-level triggers
and mismatched artifact wiring, while fixture tests execute both CLI scripts against isolated temp
trees. A real GitHub artifact round-trip and tag permission check remain Task 9 acceptance work.

## Review 3 follow-up: explicit GitHub repository and non-vacuous structure checks

### RED

Strengthened the workflow parser before changing release automation:

- `uses:` parsing now accepts trailing version comments, then asserts the exact four-action set,
  exact count, and a 40-hex SHA for every action;
- job IDs accept digits, underscores, and hyphens, with an injected `extra_job2` proving the parser
  cannot hide a legal extra job;
- upload/download artifact fields are extracted and compared by exact values, with `-broken` name
  and path mutations proving mismatches are observed;
- the release step must expose an explicit GitHub repository context.

```sh
npm test -- tests/research/release-config.test.ts
```

Result: FAIL as expected — the corrected action and artifact parsers passed their positive and
negative assertions, while the real workflow failed because its release step had no `GH_REPO`.

### GREEN

Added `GH_REPO: ${{ github.repository }}` to the release step environment. Both `gh release view`
and `gh release create` now resolve the intended repository without a checkout or git remote. No
additional permissions, commands, triggers, or assets were introduced.

Final verification:

```sh
npm test -- tests/research/release-config.test.ts
# PASS: 1 file, 11 tests
npm run verify
# PASS: 15 files, 89 tests; compile, Chrome build, manifest, and ASCII checks
npm run zip
# PASS: .output/fin-report-clipper-0.1.0-chrome.zip
```

Local staging again contains exactly the versioned zip and stable alias. The source and both staged
files share SHA-256
`d6cee196c6564a03395b3b17748edb49205194f52680c540506cca4b7c41d569`. Action scans show the
expected SHA-pinned lines, repository/wiring scans match the release step, and `git diff --check`
passes.

## Review 3 self-review

The production change is one environment entry; the larger test diff removes vacuous assertions
and proves its mutation guards. No release, push, or remote artifact upload was executed. A live
tag-triggered GitHub run remains Task 9's acceptance boundary.
