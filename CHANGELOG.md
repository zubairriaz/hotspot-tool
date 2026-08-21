# Changelog

All notable versions of hotspot-tool. This file is the maintained **package version list** — the release workflow prepends a new entry on every push to `main`.

The `v1` tag always points at the latest `1.x` release; pin a specific `vX.Y.Z` tag for reproducibility.

## v1.0.3 — 2026-08-21

- Merge branch 'main' of https://github.com/zubairriaz/hotspot-tool (a63f782)

## v1.0.2 — 2026-08-21

- chore: use node24 action runtime (node20 deprecated) (b699684)

## v1.0.1 — 2026-08-21

- ci: add release automation + version list (publishes on every push to main) (c0d604c)

## v1.0.0 — 2026-08-21

Initial release (Milestones 0 + 1).

- Whole-repo behavioral engine from git history: recency-weighted change frequency, author count, bug-fix ratio, change coupling.
- Rank-product hotspot scoring with percentile cutoff + absolute floors.
- Enforcement `info` / `warn` / `block`, gating on `touched ∩ hotspots`; opt-in `distance-max` gate.
- Sticky PR comment + job summary.
- Static engine (complexity / Martin's metrics) not yet implemented — ranking is behavioral-only.
