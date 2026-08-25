# Workflow templates

Each file is a complete, copy-paste-ready workflow. Pick one, drop it in
`.github/workflows/`, done. Nothing is commented out.

| Template | Use it when |
|---|---|
| [`basic.yml`](basic.yml) | **Start here.** Comments on hotspots, never fails the build. |
| [`observe.yml`](observe.yml) | You want evidence before touching anyone's PRs. No comments at all. |
| [`strict.yml`](strict.yml) | You have tuned the thresholds and are ready to block merges. |
| [`architecture.yml`](architecture.yml) | You want to gate on Martin's Distance, not just churn. |
| [`monorepo.yml`](monorepo.yml) | Generated or vendored code is drowning out the signal. |
| [`tuned.yml`](tuned.yml) | Your commit conventions don't match the default bug-fix patterns. |
| [`scheduled-report.yml`](scheduled-report.yml) | You want a weekly repo-wide health report, not a PR gate. |

## Suggested path

Adopting this well is a sequence, not a config choice:

1. **`observe.yml`** for a week. Nothing appears on PRs. Read the job summary
   and see whether the files it ranks match your intuition about where the
   pain is. If they don't, the thresholds are wrong for your repo — fix that
   before anyone else sees it.
2. **`basic.yml`** for a few weeks. Findings now appear on PRs as comments the
   author can resolve. Watch for complaints about noise; each one is a
   threshold that needs raising.
3. **`strict.yml`** once the signal is trusted. Create the
   `hotspot-acknowledge` label first — people need a way through that isn't
   "delete the workflow."

Going straight to step 3 is how this kind of tool gets removed in week two.

## Two things every template needs

**`fetch-depth: 0` on checkout.** The default shallow clone has no history, so
there is nothing to measure. The action warns and the results are empty.

**`pull-requests: write`** in `permissions`, for anything that comments.
`observe.yml` and `scheduled-report.yml` don't need it — they only need
`contents: read`.

## Running more than one

The templates are separate jobs, so you can run several at once — for example
a blocking hotspot gate alongside a non-blocking architecture gate:

```yaml
jobs:
  hotspot:
    # ...from strict.yml
  architecture:
    # ...from architecture.yml, with enforcement-level: warn
```

Set `comment: "false"` on all but one, or each job posts its own comments and
you get duplicates on the same file.

Full input reference is in the [main README](../README.md#inputs).
