# 🔥 hotspot-tool

> Find where your codebase is actively rotting — the intersection of **messy** code and **frequently-changed** code — and leave those files better than you found them.

A GitHub Action that ranks **hotspots** (mess × activity), not raw complexity. A complex file nobody touches is harmless; a complex file six people fight with every week is expensive. This tool ranks the *intersection*.

Everything runs **inside your own runner** — source code never leaves your CI, nothing is stored, nothing is transmitted.

> **Status:** v1 in progress. The **behavioral engine (git history)** is implemented and works on any repo today. The **static engine (Tree-sitter complexity, Martin's metrics)** is on the roadmap — until then, ranking uses change frequency.

## Quick start

```yaml
# .github/workflows/hotspot.yml
name: Hotspot
on: pull_request
permissions:
  contents: read
  pull-requests: write        # to post the PR comment
jobs:
  hotspot:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0       # REQUIRED — behavioral metrics need full history
      - uses: your-org/hotspot-tool@v1
        with:
          enforcement-level: warn
```

> **`fetch-depth: 0` is mandatory.** The default shallow checkout hides the history the tool measures.

## How it works

1. **Analyze the whole repo** — git history gives change frequency (recency-weighted), author count, bug-fix ratio, and change coupling.
2. **Rank hotspots** — `score = rank-product(complexity, change-frequency)`. A file is a hotspot only when it clears **all** of: top percentile **AND** a minimum commit count **AND** (once static analysis is on) a minimum complexity. The absolute floors stop a clean repo from being nagged about its own relative "worst 10%".
3. **Gate the PR** — the repo is analyzed whole, but a PR is judged only on `touched files ∩ hotspots`. You're never failed over a hotspot you didn't touch.

## Enforcement

| Level | Behavior | Exit |
|---|---|---|
| `info` | Report only | 0 |
| `warn` | **(default)** PR comment + summary, non-blocking | 0 |
| `block` | Fail the check when the PR touches a hotspot | non-zero |

## Inputs

| Input | Default | Description |
|---|---|---|
| `enforcement-level` | `warn` | `info` \| `warn` \| `block` |
| `history-window-days` | `90` | History window for behavioral metrics |
| `hotspot-threshold` | `90` | Percentile cutoff (90 = top 10%) |
| `change-freq-min` | `5` | Absolute floor: min commits in window |
| `complexity-min` | `10` | Absolute floor: min complexity (static engine) |
| `distance-max` | _(off)_ | **Opt-in** hard gate on Martin's Distance (0–1) |
| `bugfix-patterns` | `fix,bug,patch,hotfix,revert` | Regexes for bug-fix commits |
| `module-definition` | `directory` | Martin's unit: `file` \| `directory` \| `workspace` |
| `comment` | `true` | Post/update the PR comment |

## Outputs

`hotspot-count`, `touched-hotspot-count`, `gate-status` (`pass` \| `warn` \| `fail`).

## A note on the metrics

The behavioral metrics (churn, authors, coupling) are exact. Several others are **heuristics** and labeled as such: bug-fix detection is regex over commit messages; the Maintainability Index and Martin's Distance are shown for context and are **report-only by default** (D can be turned into a hard gate via `distance-max` if your team trusts it). Cycle-time is reported as a *correlated signal*, never relabeled as "engineer-hours."

## Support

This is a showcase project. Issues are answered when time allows. MIT licensed, free forever.

## Development

```bash
npm install
npm run typecheck
npm test
npm run build     # bundles src -> dist/index.js (commit dist/ when releasing)
```
