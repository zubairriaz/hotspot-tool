import type { AnalysisResult, Config, CouplingPair, FileHistory, ScoredFile } from "./types";

/** Assign 1-based ranks (1 = largest value). Ties share the average rank. */
function rankDescending<T>(items: T[], value: (t: T) => number): Map<T, number> {
  const sorted = [...items].sort((a, b) => value(b) - value(a));
  const ranks = new Map<T, number>();
  let i = 0;
  while (i < sorted.length) {
    let j = i;
    while (j + 1 < sorted.length && value(sorted[j + 1]!) === value(sorted[i]!)) j++;
    const avg = (i + j) / 2 + 1; // average 1-based rank across the tie group
    for (let k = i; k <= j; k++) ranks.set(sorted[k]!, avg);
    i = j + 1;
  }
  return ranks;
}

/**
 * Combine behavioral (activity) and — when available — static (complexity)
 * signals into a ranked hotspot list.
 *
 * Locked design (§4.3):
 *   score = rank-product(complexity_rank, change_frequency_rank)   [lower = worse]
 * Until the static engine lands, complexity is null and we fall back to the
 * activity rank alone, so the tool is useful behavioral-only from day one.
 *
 * A file is a hotspot only when it clears ALL of (§5):
 *   percentile >= hotspot-threshold  AND  commitCount >= change-freq-min
 *   AND (complexity >= complexity-min, when complexity is known)
 */
export function rankHotspots(
  histories: FileHistory[],
  config: Config,
  coupling: CouplingPair[] = [],
  complexityByFile: Map<string, number> = new Map(),
): AnalysisResult {
  const hasStatic = complexityByFile.size > 0;

  const freqRank = rankDescending(histories, (h) => h.weightedCommits);
  const cxRank = hasStatic
    ? rankDescending(histories, (h) => complexityByFile.get(h.path) ?? 0)
    : null;

  const scored: ScoredFile[] = histories.map((h) => {
    const complexity = complexityByFile.get(h.path) ?? null;
    const fRank = freqRank.get(h) ?? histories.length;
    const cRank = cxRank ? cxRank.get(h) ?? histories.length : null;
    // Rank-product when both signals exist; geometric mean keeps it on the
    // same scale as a single rank so the fallback is comparable.
    const score = cRank !== null ? Math.sqrt(fRank * cRank) : fRank;
    return {
      path: h.path,
      weightedCommits: h.weightedCommits,
      commitCount: h.commitCount,
      authorCount: h.authorCount,
      bugfixRatio: h.bugfixRatio,
      complexity,
      changeFreqRank: fRank,
      complexityRank: cRank,
      score,
      percentile: 0,
      isHotspot: false,
    };
  });

  // Percentile: fraction of files this one is worse-or-equal to (lower score = worse).
  const byScore = [...scored].sort((a, b) => a.score - b.score);
  const n = byScore.length;
  byScore.forEach((f, idx) => {
    f.percentile = n > 1 ? ((n - 1 - idx) / (n - 1)) * 100 : 100;
  });

  for (const f of scored) {
    const clearsPercentile = f.percentile >= config.hotspotThreshold;
    const clearsActivity = f.commitCount >= config.changeFreqMin;
    const clearsComplexity = f.complexity === null ? true : f.complexity >= config.complexityMin;
    f.isHotspot = clearsPercentile && clearsActivity && clearsComplexity;
  }

  const hotspots = scored
    .filter((f) => f.isHotspot)
    .sort((a, b) => a.score - b.score || b.weightedCommits - a.weightedCommits);

  return {
    scored,
    hotspots,
    coupling,
    totalFilesAnalyzed: histories.length,
    windowDays: config.historyWindowDays,
  };
}
