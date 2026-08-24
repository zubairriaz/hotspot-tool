# Changelog

All notable changes to hotspot-tool are documented here.
Versions follow [Semantic Versioning](https://semver.org/).

The `v1` tag always points at the latest `1.x` release; pin a specific `vX.Y.Z` tag for reproducibility.

---

## v1.4.5 — 2026-08-24

- merge: pull v1.4.4 release commit (6ffb9db)

## v1.4.4 — 2026-08-24

- fix: comment on actual diff line by parsing PR hunk headers (1f29d42)

## v1.4.3 — 2026-08-24

- fix: prefer line-1 inline comment over file-level for better visibility (d4fb8ca)

## v1.4.2 — 2026-08-24

- chore: resolve merge conflict in generated sourcemap (48f9cec)

## v1.4.1 — 2026-08-24

- feat: inline resolvable review comments per violated file (v1.4.0) (9e8337e)

## v1.3.3 — 2026-08-24

- chore: merge release auto-bump, keep new dist (4f62f52)

## v1.3.2 — 2026-08-24

- feat: extend to Kotlin/Swift/PHP/Ruby/C++/Scala + default excludes + DX improvements (v1.3.1) (210aae3)

## v1.2.3 — 2026-08-24

- fix: use node20 runtime in action.yml (node24 not yet recognised by runners) (291ce5f)

## v1.2.2 — 2026-08-24

- test: add end-to-end tests covering all analysis flows (76 tests) (52e6152)

## v1.2.1 — 2026-08-21

- feat: excludes input, Rust/C# support, JSON artifact output (v1.2.0) (1d5f22a)

## [1.2.0] — 2026-08-22

### Added

- **`excludes` input** — glob-based file exclusion (`dist/**`, `vendor/**`, `**/*.generated.ts`).
  Excluded files are stripped from `git ls-files` before any analysis runs, so they
  never appear in hotspot scores, coupling pairs, or static metrics.
  Patterns support `*` (within a segment), `**` (across segments), and `?` (single char).

- **Rust and C# language support** in the static engine.
  - Rust: `trait` → abstract; `struct` / `enum` → concrete; `if/while/for/loop/match/=>` for complexity; relative `use crate::` / `super::` / `self::` imports tracked.
  - C#: `interface` / `abstract class` → abstract; `class` / `struct` / `record` / `enum` → concrete; `if/foreach/switch-case/catch` for complexity.

- **`hotspot-report.json` artifact** — written to `$GITHUB_WORKSPACE` on every run
  (disable with `generate-artifact: false`). Contains `generatedAt`, `gateStatus`,
  all hotspots with scores, touched hotspots, coupling pairs, and distance violations.
  Designed for downstream jobs, dashboards, and trend tracking.

- **`generate-artifact` action input** (default `true`) to control artifact writing.

### Tests

- `test/glob.test.ts` — 14 tests covering `*`, `**`, `**/`, `?`, multiple patterns,
  real-world patterns (`node_modules/**`, `*.d.ts`, `**/__tests__/**`).
- `test/static.test.ts` — 6 new tests for Rust and C# extraction and complexity.
- All config fixtures updated with `excludes: []` and `generateArtifact: true`.

---

## v1.1.2 — 2026-08-21

- fix: correct info/warn behaviour, improve degradation logging, add gate tests (4d69ad8)

## [1.1.1] — 2026-08-21

_Auto-generated commits in this release:_
- Merge branch 'main' of https://github.com/zubairriaz/hotspot-tool (01d23b2)

### Fixed

- **`info` enforcement level now skips the PR comment** (`src/main.ts`).
  Previously `info` and `warn` were identical — both posted a sticky PR comment.
  `info` now writes to the job summary only, matching the documented "report only" behaviour.

- **`info` gate status now reflects actual findings** (`src/gate.ts`).
  When violations exist under `info` enforcement, the gate now returns `"warn"` (⚠️ badge
  in the job summary) instead of `"pass"` (✅). The check still never fails CI.
  The status logic was simplified from a confusing two-step overwrite into a clean
  three-branch conditional.

- **Three-dot diff fallback is now logged** (`src/git/changed.ts`).
  The silent `catch {}` on the `base...head` diff is replaced with a `core.info` message
  that names the original error and warns that the two-dot fallback may include
  unrelated base-branch changes. Useful when debugging shallow-clone behaviour.

- **Static engine degradation is now a warning** (`src/static/engine.ts`).
  If every file read fails (e.g. bad `GITHUB_WORKSPACE` permissions), the engine
  previously logged "complexity for 0 file(s)" with no explanation. It now emits a
  `core.warning` explaining the fallback and what to check.

- **Crash handler uses safe error serialisation** (`src/main.ts`).
  `(err as Error).message` replaced with `err instanceof Error ? err.message : String(err)`
  so non-Error throws (strings, numbers) don't silently produce `undefined` in the failure
  message.

- **Config logged at startup** (`src/main.ts`).
  Effective configuration is now printed to the CI log on every run, making it easier
  to verify that action inputs were parsed correctly.

### Tests

- Added `test/gate.test.ts` — 16 new tests covering all enforcement levels, PR-scope
  isolation, Martin's Distance gate edge cases (null/boundary/untouched files), reason
  string content, and combined hotspot + distance violations.

---

## [1.1.0] — 2026-08-21

### Added

- **M2 static analysis engine** (`src/static/`).
  Regex-based static engine across TypeScript, JavaScript, Python, Go, and Java.
  Computes cyclomatic complexity and Martin's Distance D = |A + I − 1| per file.
  Both `complexityByFile` and `distanceByFile` maps — previously empty placeholders —
  are now fully populated on every run.

  - `src/static/detect.ts` — language detection from file extension
  - `src/static/extract.ts` — per-language import and abstractness extraction
  - `src/static/complexity.ts` — cyclomatic complexity via branch counting
  - `src/static/martin.ts` — Martin's A, I, D with inter-module dependency graph;
    supports `file`, `directory`, and `workspace` module definitions
  - `src/static/engine.ts` — main entry: reads files in parallel, returns
    `{ complexityByFile, distanceByFile }`

- **16 static engine tests** (`test/static.test.ts`).

### Changed

- `src/main.ts` — wires `runStaticEngine` into the main pipeline; `trackedFiles`
  called once and shared across history analysis and the static engine.

- **README updated** — added plain-English explanations of all metrics including
  Martin's Distance formula, the two failure zones (Zone of Pain / Zone of Uselessness),
  and a full description of the token flow.

---

## [1.0.2] — prior release

Initial public release with behavioral engine (git history analysis):
change frequency, recency weighting, author count, bug-fix ratio,
change coupling, and PR-scoped gating.
