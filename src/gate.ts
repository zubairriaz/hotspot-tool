import type { AnalysisResult, Config, GateStatus, ScoredFile } from "./types";
import type { MartinMetrics } from "./static/martin";

export interface DistanceViolation {
  path: string;
  abstractness: number;
  instability: number;
  distance: number;
}

export interface GateResult {
  status: GateStatus;
  touchedHotspots: ScoredFile[];
  distanceViolations: DistanceViolation[];
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
  distanceByFile: Map<string, MartinMetrics> = new Map(),
): GateResult {
  const touched = new Set(touchedFiles);
  const touchedHotspots = analysis.hotspots.filter((h) => touched.has(h.path));

  const distanceViolations: DistanceViolation[] = [];
  if (config.distanceMax !== null) {
    for (const p of touchedFiles) {
      const m = distanceByFile.get(p);
      if (m !== undefined && m.distance > config.distanceMax) {
        distanceViolations.push({ path: p, abstractness: m.abstractness, instability: m.instability, distance: m.distance });
      }
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
    reasons.push(`${v.path}: Martin's Distance ${v.distance.toFixed(2)} > distance-max ${config.distanceMax} (A=${v.abstractness.toFixed(2)}, I=${v.instability.toFixed(2)})`);
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
