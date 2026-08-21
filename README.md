# 🔥 hotspot-tool

A GitHub Action that looks at your git history and tells you which files are **actively rotting** — files that are changed constantly *and* are messy. Those are the files that slow your team down and breed bugs.

Everything runs inside your own CI runner. Your source code never leaves your infrastructure.

> **Status:** The git-history analysis works today on any repo. Static code complexity (Tree-sitter) and Martin's metrics are on the roadmap — the tool is useful without them.

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
3. Its complexity is above a minimum (default: 10) — *once static analysis is enabled*

The absolute floors (2 and 3) exist so a quiet, clean repo does not get nagged about its own relative "worst 10%."

---

## Quick start

```yaml
# .github/workflows/hotspot.yml
name: Hotspot
on: pull_request
permissions:
  contents: read
  pull-requests: write   # needed to post the PR comment
jobs:
  hotspot:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0         # REQUIRED — see note below
      - uses: your-org/hotspot-tool@v1
        with:
          enforcement-level: warn
```

> **Why `fetch-depth: 0`?** By default, `actions/checkout` only fetches the last commit (a "shallow clone"). This tool needs the full history to measure how often files change, who changes them, and whether commits are bug-fixes. Without full history, the results will be wrong or empty.

---

## What happens on each PR

1. **Full repo scan** — reads your git log for the configured window (default: 90 days) and builds metrics for every file.
2. **Hotspot ranking** — scores and ranks all files. Flags the worst ones as hotspots.
3. **PR gate** — checks which hotspot files this PR actually touched. You are never penalized for a hotspot you did not touch.
4. **PR comment** — posts a sticky comment on the PR showing what was found. The same comment is updated (not re-posted) on each new push.

---

## Enforcement levels

| Level | What it does | Fails CI? |
|---|---|---|
| `info` | Writes to the job summary only, no PR comment | No |
| `warn` | **(default)** Posts a PR comment, reports findings | No |
| `block` | Posts a PR comment AND fails the CI check if a hotspot is touched | Yes |

---

## Metrics explained

### Change frequency (behavioral)

Counts how many times each file was committed in the history window. Recent commits count more than old ones — a file touched 10 times last week scores higher than one touched 10 times three months ago.

The decay formula is: `weight = 0.5 ^ (age_in_days / half_life)`. A commit's weight halves every `window / 2` days. So in a 90-day window, a commit from 45 days ago is worth half a recent one.

### Bug-fix ratio (behavioral)

The fraction of commits to a file whose message matches bug-fix patterns (e.g. `fix`, `bug`, `revert`). A file with a 60% bug-fix ratio is one your team keeps going back to patch — a strong signal of hidden complexity.

### Change coupling (behavioral)

Files that are changed in the **same commit** repeatedly are probably more tightly coupled than your folder structure suggests. For example, if `auth.ts` and `session.ts` always appear together in commits, they are likely one logical module living in two places.

Coupling degree = `shared_commits(A, B) / commits(A or B)`. A degree of 0.8 means 80% of the time one changes, the other does too.

Large sweeping commits (more than 25 files) are excluded from this analysis because they create false pairs.

### Martin's Distance — D = |A + I − 1| (static, coming soon)

This metric measures how well-designed a module is according to a principle called the **main sequence**: *stable things should be abstract; unstable things should be concrete.*

Two inputs:

| Variable | What it measures | Range |
|---|---|---|
| **A** (Abstractness) | How abstract the module is — ratio of interfaces/abstract classes to total classes | 0 = fully concrete, 1 = fully abstract |
| **I** (Instability) | How much the module depends on others vs. others depending on it | 0 = everyone depends on it (stable), 1 = it depends on everyone (unstable) |

**D = \|A + I − 1\|** measures the distance from the ideal diagonal:

```
Abstractness (A)
1 ──●─────────────────────
    │ Zone of Uselessness │ abstract but nobody uses it
    │  (A≈1, I≈1)         │
    │          ╲           │
    │    ideal  ╲          │
    │    line    ╲  D=0    │
    │             ╲        │
    │              ╲       │
    │      Zone of  ╲      │
    │      Pain      ●─────1  Instability (I)
    │  (A≈0, I≈0)         │
    │  concrete, rigid     │
0 ──┴─────────────────────
```

- **D = 0** → ideal, perfectly balanced
- **D close to 1** → problematic: either too abstract with no dependents, or too concrete with too many dependents

You can set `distance-max` to fail the check when any touched file exceeds a D threshold. This is off by default.

---

## Inputs

| Input | Default | Description |
|---|---|---|
| `enforcement-level` | `warn` | `info` / `warn` / `block` — how hard to enforce |
| `history-window-days` | `90` | How many days of git history to analyze |
| `hotspot-threshold` | `90` | Percentile cutoff — 90 means top 10% most-changed files |
| `change-freq-min` | `5` | A file must have at least this many commits to be a hotspot |
| `complexity-min` | `10` | A file must have at least this complexity score to be a hotspot (static engine) |
| `distance-max` | off | Optional: fail if Martin's Distance D exceeds this value (0–1) |
| `bugfix-patterns` | `fix,bug,patch,hotfix,revert` | Comma/newline-separated patterns to identify bug-fix commits |
| `module-definition` | `directory` | Unit of analysis for Martin's metrics: `file` / `directory` / `workspace` |
| `comment` | `true` | Whether to post the sticky PR comment |
| `generate-map` | `true` | Whether to render the hotspot map image |
| `github-token` | auto | Token used to post the PR comment — defaults to the workflow token, no setup needed |

---

## Outputs

| Output | Description |
|---|---|
| `hotspot-count` | Total hotspot files found across the repo |
| `touched-hotspot-count` | How many of those this PR touched |
| `gate-status` | `pass`, `warn`, or `fail` |

---

## About the token

The tool needs a GitHub token to post the PR comment. By default it uses `${{ github.token }}`, which GitHub injects automatically into every workflow run — **no setup required**. The token only needs `pull-requests: write` permission, which is declared in the workflow's `permissions` block.

If you need broader access (e.g. for private repos with restricted defaults), you can pass your own:

```yaml
- uses: your-org/hotspot-tool@v1
  with:
    github-token: ${{ secrets.MY_PAT }}
```

---

## A note on heuristics

Change frequency, author count, and change coupling are exact — they come directly from git. Bug-fix detection is a heuristic (regex over commit messages) and can be tuned via `bugfix-patterns`. Martin's Distance is shown as a signal and is off by default as a gate — enable it with `distance-max` only once you have calibrated what a reasonable threshold is for your repo.

---

## Development

```bash
npm install
npm run typecheck
npm test
npm run build     # bundles src → dist/index.js (commit dist/ when releasing)
```

MIT licensed.
