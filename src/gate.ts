import type { AnalysisResult, Config, GateStatus, ScoredFile } from "./types";

export interface GateResult {
  status: GateStatus;
  touchedHotspots: ScoredFile[];
  distanceViolations: { path: string; distance: number }[];
  reasons: string[];
}

/**
 * Apply the gate over the PR's touched files (§5).
 *
 * Scope: the repo is analyzed whole, but the gate acts only on
 * `touched ∩ hotspots` — a PR is never failed over a hotspot it didn't touch.
 *
 * Two independent conditions can fail a `block` run:
 *   1. The PR touches a hotspot file.
 *   2. (opt-in) A touched file's Martin's D exceeds `distance-max`.
 *
 * `info` never fails; `warn` reports but returns non-failing; `block` fails.
 */
export function evaluateGate(
  analysis: AnalysisResult,
  touchedFiles: string[],
  config: Config,
  distanceByFile: Map<string, number> = new Map(),
): GateResult {
  const touched = new Set(touchedFiles);
  const touchedHotspots = analysis.hotspots.filter((h) => touched.has(h.path));

  const distanceViolations: { path: string; distance: number }[] = [];
  if (config.distanceMax !== null) {
    for (const path of touchedFiles) {
      const d = distanceByFile.get(path);
      if (d !== undefined && d > config.distanceMax) distanceViolations.push({ path, distance: d });
    }
  }

  const reasons: string[] = [];
  for (const h of touchedHotspots) {
    const cx = h.complexity !== null ? `, complexity ${h.complexity}` : "";
    reasons.push(
      `${h.path}: hotspot (${h.percentile.toFixed(0)}th percentile, ${h.commitCount} commits${cx}, ${h.authorCount} authors)`,
    );
  }
  for (const v of distanceViolations) {
    reasons.push(`${v.path}: Martin's Distance ${v.distance.toFixed(2)} > distance-max ${config.distanceMax}`);
  }

  const violates = touchedHotspots.length > 0 || distanceViolations.length > 0;

  // "info" surfaces findings in the job summary without affecting the gate badge.
  // "warn" shows ⚠️ in the PR comment but never fails CI.
  // "block" fails CI when violations exist.
  let status: GateStatus;
  if (!violates) {
    status = "pass";
  } else if (config.enforcementLevel === "block") {
    status = "fail";
  } else {
    status = "warn"; // both "info" and "warn" enforcement show warn, never fail
  }

  return { status, touchedHotspots, distanceViolations, reasons };
}
