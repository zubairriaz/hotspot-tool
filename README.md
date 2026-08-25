# 🔥 hotspot-tool

A GitHub Action that looks at your git history and tells you which files are **actively rotting** — files that are changed constantly *and* are messy. Those are the files that slow your team down and breed bugs.

Everything runs inside your own CI runner. Your source code never leaves your infrastructure.

---

## The core idea

Not all messy files are a problem. A complex file that nobody touches is harmless — it just sits there. The expensive files are the ones that are **complex AND touched constantly**, because every change risks introducing a bug and every developer has to re-understand the mess each time.

This tool finds that intersection:

```
              high complexity
                    │
          harmless  │  ← HOTSPOT (this is what we flag)
          (nobody   │
          touches   │
          it)       │
──────────────────────────────── change frequency
                    │
          safe      │  simple but busy
                    │  (not a problem)
              low complexity
```

A file only becomes a hotspot when it clears **all three bars**:

1. It is in the top percentile for change frequency (default: top 10%)
2. It has been changed at least N times in the window (default: 5 commits)
3. Its cyclomatic complexity is at or above a minimum (default: 10)

The absolute floors (2 and 3) exist so a quiet, clean repo does not get nagged about its own relative "worst 10%."

> Files in a language the static engine does not support have no complexity score, and **pass bar 3 automatically** — they are ranked on change frequency alone. A busy `.yaml` or `.sql` file can therefore surface as a hotspot without any complexity signal behind it.

---

## Quick start

Copy [`examples/basic.yml`](examples/basic.yml) into `.github/workflows/` and you are done:

```yaml
# .github/workflows/hotspot.yml
name: Hotspot
on: pull_request

permissions:
  contents: read
  pull-requests: write   # required — the action posts inline review comments

jobs:
  hotspot:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0        # REQUIRED — see note below
      - uses: zubairriaz/hotspot-tool@v1
        with:
          enforcement-level: warn
```

> **Why `fetch-depth: 0`?** By default, `actions/checkout` fetches only the last commit (a "shallow clone"). This tool needs full history to measure how often files change, who changes them, and whether commits are bug-fixes. Without it the action warns and the results will be wrong or empty.

### Workflow templates

Seven complete, copy-paste-ready workflows in [`examples/`](examples/) — nothing commented out, pick one and drop it in:

| Template | Use it when |
|---|---|
| [`basic.yml`](examples/basic.yml) | **Start here.** Comments on hotspots, never fails the build. |
| [`observe.yml`](examples/observe.yml) | You want evidence before touching anyone's PRs. No comments at all. |
| [`strict.yml`](examples/strict.yml) | You have tuned the thresholds and are ready to block merges. |
| [`architecture.yml`](examples/architecture.yml) | You want to gate on Martin's Distance, not just churn. |
| [`monorepo.yml`](examples/monorepo.yml) | Generated or vendored code is drowning out the signal. |
| [`tuned.yml`](examples/tuned.yml) | Your commit conventions don't match the default bug-fix patterns. |
| [`scheduled-report.yml`](examples/scheduled-report.yml) | You want a weekly repo-wide health report, not a PR gate. |

**Adopt in that order.** Run `observe` for a week and check the ranking matches your intuition about where the pain is; move to `basic` for a few weeks and watch for noise complaints; only then `strict`. Going straight to blocking is how this kind of tool gets deleted in week two. See [`examples/README.md`](examples/README.md) for the full rationale.

---

## What happens on each PR

1. **Full repo scan** — reads your git log for the configured window (default: 90 days) and builds behavioral metrics for every tracked file.
2. **Static analysis** — computes cyclomatic complexity and Martin's metrics for every file in a supported language.
3. **Hotspot ranking** — scores and ranks all files, flagging the worst as hotspots.
4. **PR gate** — checks which flagged files this PR actually touched. You are never penalized for a hotspot you did not touch.
5. **Inline review comments** — posts one comment per violated file in the **Files changed** tab, each with a native GitHub **Resolve** button. Comments from the previous run are deleted first, so the thread never accumulates duplicates.

There is no summary comment in the PR conversation thread — all feedback is attached to the files it concerns.

### Running outside a pull request

On a `schedule`, `push` or `workflow_dispatch` event there is no PR to scope against, so nothing is gated and no comments are posted. You still get the full repo-wide ranking in the **job summary** and in `hotspot-report.json`. That makes it useful as a recurring health report — see [`examples/scheduled-report.yml`](examples/scheduled-report.yml).

---

## Enforcement levels

| Level | Inline comments | Fails CI? |
|---|---|---|
| `info` | No | No |
| `warn` | Yes | No |
| `block` | Yes | **Yes**, when a touched file violates |

`info` still writes the job summary and the JSON artifact, so you can adopt the tool in observe-only mode and see what it would have flagged before turning enforcement on.

### The acknowledge label

When `block` is too blunt — you know the file is a hotspot and have a plan — add the `hotspot-acknowledge` label to the PR. The gate downgrades `block → warn` for that run, the findings still appear, and the merge is not blocked. Remove the label once addressed. Rename it with `acknowledge-label`.

---

## Metrics explained

### Change frequency (behavioral)

Counts how many times each file was committed in the history window. Recent commits count more than old ones — a file touched 10 times last week scores higher than one touched 10 times three months ago.

The decay formula is `weight = 0.5 ^ (age_in_days / half_life)`, where the half-life is `window / 2` days. In a 90-day window, a commit from 45 days ago is worth half a recent one.

### Bug-fix ratio (behavioral)

The fraction of commits to a file whose message matches the bug-fix patterns. A file with a 60% bug-fix ratio is one your team keeps going back to patch — a strong signal of hidden complexity.

This is a regex heuristic over commit messages. Tune it with `bugfix-patterns`.

### Change coupling (behavioral)

Files changed in the **same commit** repeatedly are probably more tightly coupled than your folder structure suggests. If `auth.ts` and `session.ts` always appear together, they are likely one logical module living in two places.

Coupling degree = `shared_commits(A, B) / commits(A or B)`. A degree of 0.8 means 80% of the time one changes, the other does too. Sweeping commits (more than 25 files) are excluded because they create false pairs.

Coupling appears in the job summary and the JSON artifact. It does not gate.

### Cyclomatic complexity (static)

Counts decision points in a file: `if`, `while`, `for`, `case`, `catch`, `&&`, `||`, `??`, and ternaries — plus one. Strings and comments are stripped first so a `//` inside a URL literal does not skew the count.

It is an integer **≥ 1**, not a 0–1 ratio. A file scoring 1 has no branching at all. Above ~10 per file is worth attention; the tool marks 🟡 at 15 and 🔴 at 30.

### Martin's Distance — D = |A + I − 1| (static)

Measures how well a module sits on the **main sequence**: *stable things should be abstract; unstable things should be concrete.*

| Variable | What it measures | Range |
|---|---|---|
| **A** (Abstractness) | Interfaces, abstract classes, traits, protocols and type aliases as a share of all types | 0 = fully concrete, 1 = fully abstract |
| **I** (Instability) | `Ce / (Ce + Ca)` — outgoing dependencies over total | 0 = everyone depends on it (stable), 1 = it depends on everyone (unstable) |

**D = \|A + I − 1\|** is the distance from the ideal diagonal:

- **D ≈ 0** — on the main sequence, healthy
- **A ≈ 0, I ≈ 0, D ≈ 1** — **Zone of Pain**: concrete and heavily depended upon, so it is rigid and expensive to change. Fix by extracting an interface.
- **A ≈ 1, I ≈ 1, D ≈ 1** — **Zone of Uselessness**: abstract but nothing depends on it. Fix by freezing the API or deleting the abstraction.

`A` and `I` are computed per **module**, where a module is a file, a directory, or the whole workspace depending on `module-definition` (default `directory`). Import resolution is per-language and only resolves to files tracked in the repo — third-party and standard-library imports are ignored.

> **Modules with no coupling are skipped.** If a module has no resolvable imports in either direction, `Ce + Ca` is 0 and instability is *undefined* (0/0), not zero. Such modules are omitted from distance reporting entirely rather than scored against a fabricated `I = 0`. Without this, every unimported leaf file with a concrete class would be reported as Zone of Pain purely because nothing referenced it. The run logs how many modules were skipped.

The distance gate is **off by default**. Enable it with `distance-max` once you have calibrated a threshold for your repo. It gates independently of the hotspot score: a file with a clean change history still fails if its D exceeds the limit.

---

## Language support

Complexity and Martin's metrics are computed for these languages. Files in any other language are still tracked for behavioral metrics.

| Language | Extensions |
|---|---|
| TypeScript | `.ts` `.tsx` `.mts` `.cts` |
| JavaScript | `.js` `.jsx` `.mjs` `.cjs` |
| Python | `.py` |
| Go | `.go` |
| Java | `.java` |
| Rust | `.rs` |
| C# | `.cs` |
| Kotlin | `.kt` `.kts` |
| Swift | `.swift` |
| PHP | `.php` `.phtml` |
| Ruby | `.rb` |
| C / C++ | `.c` `.cc` `.cpp` `.cxx` `.h` `.hpp` `.hxx` |
| Scala | `.scala` `.sc` |

Restrict analysis with `languages` (e.g. `typescript,go`). The value is the language name from the left column, lowercased — not the file extension.

---

## Inputs

Every input is optional.

| Input | Default | Description |
|---|---|---|
| `enforcement-level` | `warn` | `info` / `warn` / `block`. An unrecognized value warns and falls back to `warn`. |
| `history-window-days` | `90` | Days of git history to analyze. |
| `hotspot-threshold` | `90` | Percentile cutoff. `90` means the top 10% most-changed files. |
| `change-freq-min` | `5` | Absolute floor: minimum commits in the window to qualify as a hotspot. |
| `complexity-min` | `10` | Absolute floor: minimum cyclomatic complexity to qualify as a hotspot. |
| `distance-max` | *(off)* | Fail when a touched file's Martin's Distance exceeds this. Must be `0`–`1`; anything else warns and is ignored. Empty means the gate is off. |
| `bugfix-patterns` | `fix,bug,patch,hotfix,revert` | Comma/newline-separated regexes identifying bug-fix commits. Matched case-insensitively. An invalid regex warns and is skipped. |
| `module-definition` | `directory` | Unit for Martin's metrics: `file` / `directory` / `workspace`. Unrecognized values fall back to `directory`. |
| `languages` | `auto` | `auto`, or a comma/newline-separated list of language names to restrict analysis to. |
| `excludes` | *(empty)* | Comma/newline-separated globs to exclude, **added on top of** the built-in defaults. |
| `no-default-excludes` | `false` | Set `true` to drop the built-in excludes and use only your `excludes`. |
| `comment` | `true` | Set `false` to skip inline review comments. Findings still reach the job summary, artifact and outputs. |
| `generate-artifact` | `true` | Write `hotspot-report.json` into the workspace. |
| `acknowledge-label` | `hotspot-acknowledge` | PR label that downgrades `block` → `warn` for that run. |
| `github-token` | `${{ github.token }}` | Token used to post comments. No setup needed by default. |

Booleans are compared case-insensitively against the string `"false"` / `"true"`; any other value takes the documented default.

### Default excludes

Applied unless `no-default-excludes: true`:

```
dist/**   build/**   out/**   .next/**   vendor/**
node_modules/**   coverage/**
**/*.min.js   **/*.min.css   **/*.bundle.js
```

The matcher supports `*` (within a segment), `**` (across segments), and `?`. It is intentionally small — no `minimatch` dependency — so exotic glob syntax such as brace expansion is not supported.

---

## Outputs

| Output | Description |
|---|---|
| `hotspot-count` | Total hotspot files found across the repo |
| `touched-hotspot-count` | How many of those this PR touched |
| `gate-status` | `pass`, `warn`, or `fail` |

Use them to branch later steps:

```yaml
- uses: zubairriaz/hotspot-tool@v1
  id: hotspot
- if: steps.hotspot.outputs.gate-status == 'fail'
  run: echo "Touched ${{ steps.hotspot.outputs.touched-hotspot-count }} hotspot(s)"
```

### JSON artifact

With `generate-artifact: true`, `hotspot-report.json` is written to the workspace root for trend tracking or downstream jobs. Upload it with `actions/upload-artifact`.

---

## About the token

The tool needs a GitHub token to post review comments. By default it uses `${{ github.token }}`, injected automatically into every workflow run — **no setup required**. It needs `pull-requests: write`, declared in the workflow's `permissions` block.

If your repo restricts the default token, pass your own:

```yaml
- uses: zubairriaz/hotspot-tool@v1
  with:
    github-token: ${{ secrets.MY_PAT }}
```

Without a token the action logs a warning and skips commenting; the gate still runs.

---

## A note on heuristics

Change frequency, author count, and change coupling are exact — they come straight from git. Bug-fix detection is a regex heuristic and is tunable. Complexity is a structural count, not a judgement of readability. Martin's metrics depend on import resolution, so they are only as good as the imports the tool can resolve to tracked files — which is why uncoupled modules are skipped rather than guessed at.

Start with `warn`, look at what it flags for a week, tune the thresholds, then move to `block`.

---

## Development

```bash
npm install
npm run typecheck
npm test
npm run build     # bundles src → dist/index.js (commit dist/ when releasing)
```

MIT licensed.
