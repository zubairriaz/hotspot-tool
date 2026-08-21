import { readCommits, trackedFiles } from "./history";
import type { Config, CouplingPair } from "../types";

/**
 * Change coupling: files that repeatedly change in the same commit reveal hidden
 * architectural coupling. degree = shared_commits(A,B) / commits(A OR B).
 *
 * The pair space is O(files^2) in the worst case, so we cap the fan-out per
 * commit (huge sweeping commits are excluded) and only keep pairs above a
 * minimum support to stop the result exploding on large repos.
 */
export async function analyzeCoupling(
  config: Config,
  opts: { maxFilesPerCommit?: number; minSharedCommits?: number; top?: number } = {},
  cwd = process.cwd(),
): Promise<CouplingPair[]> {
  const maxFilesPerCommit = opts.maxFilesPerCommit ?? 25;
  const minSharedCommits = opts.minSharedCommits ?? 3;
  const top = opts.top ?? 25;

  const [commits, tracked] = await Promise.all([readCommits(config, cwd), trackedFiles(cwd)]);

  const fileCommits = new Map<string, number>(); // commits touching each file
  const pairCommits = new Map<string, number>(); // "a\x00b" -> shared commits

  for (const commit of commits) {
    const files = commit.files.filter((f) => tracked.has(f));
    if (files.length < 2 || files.length > maxFilesPerCommit) {
      for (const f of files) fileCommits.set(f, (fileCommits.get(f) ?? 0) + 1);
      continue;
    }
    const sorted = [...new Set(files)].sort();
    for (const f of sorted) fileCommits.set(f, (fileCommits.get(f) ?? 0) + 1);
    for (let i = 0; i < sorted.length; i++) {
      for (let j = i + 1; j < sorted.length; j++) {
        const key = `${sorted[i]}\x00${sorted[j]}`;
        pairCommits.set(key, (pairCommits.get(key) ?? 0) + 1);
      }
    }
  }

  const pairs: CouplingPair[] = [];
  for (const [key, shared] of pairCommits) {
    if (shared < minSharedCommits) continue;
    const [a, b] = key.split("\x00");
    if (!a || !b) continue;
    const union = (fileCommits.get(a) ?? 0) + (fileCommits.get(b) ?? 0) - shared;
    const degree = union > 0 ? shared / union : 0;
    pairs.push({ a, b, sharedCommits: shared, degree });
  }

  pairs.sort((x, y) => y.degree - x.degree || y.sharedCommits - x.sharedCommits);
  return pairs.slice(0, top);
}
