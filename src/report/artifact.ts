import { writeFile } from "node:fs/promises";
import * as path from "node:path";
import * as core from "@actions/core";
import type { AnalysisResult, Config } from "../types";
import type { GateResult } from "../gate";

export interface HotspotReport {
  generatedAt: string;
  windowDays: number;
  enforcementLevel: string;
  totalFilesAnalyzed: number;
  gateStatus: string;
  hotspots: Array<{
    path: string;
    percentile: number;
    commitCount: number;
    authorCount: number;
    bugfixRatio: number;
    complexity: number | null;
    score: number;
  }>;
  touchedHotspots: string[];
  coupling: Array<{
    a: string;
    b: string;
    sharedCommits: number;
    degree: number;
  }>;
  distanceViolations: Array<{
    path: string;
    distance: number;
  }>;
}

export async function writeArtifact(
  analysis: AnalysisResult,
  gate: GateResult,
  config: Config,
  cwd: string,
): Promise<void> {
  const report: HotspotReport = {
    generatedAt: new Date().toISOString(),
    windowDays: analysis.windowDays,
    enforcementLevel: config.enforcementLevel,
    totalFilesAnalyzed: analysis.totalFilesAnalyzed,
    gateStatus: gate.status,
    hotspots: analysis.hotspots.map((h) => ({
      path: h.path,
      percentile: Math.round(h.percentile * 10) / 10,
      commitCount: h.commitCount,
      authorCount: h.authorCount,
      bugfixRatio: Math.round(h.bugfixRatio * 1000) / 1000,
      complexity: h.complexity,
      score: Math.round(h.score * 100) / 100,
    })),
    touchedHotspots: gate.touchedHotspots.map((h) => h.path),
    coupling: analysis.coupling.map((c) => ({
      a: c.a,
      b: c.b,
      sharedCommits: c.sharedCommits,
      degree: Math.round(c.degree * 1000) / 1000,
    })),
    distanceViolations: gate.distanceViolations,
  };

  const outPath = path.join(cwd, "hotspot-report.json");
  try {
    await writeFile(outPath, JSON.stringify(report, null, 2), "utf-8");
    core.info(`Hotspot report written to ${outPath}`);
  } catch (err) {
    core.warning(`Could not write hotspot-report.json: ${err instanceof Error ? err.message : String(err)}`);
  }
}
