/** Shared domain types for the hotspot tool. */

export type EnforcementLevel = "info" | "warn" | "block";
export type ModuleDefinition = "file" | "directory" | "workspace";
export type GateStatus = "pass" | "warn" | "fail";

export interface Config {
  enforcementLevel: EnforcementLevel;
  historyWindowDays: number;
  hotspotThreshold: number; // percentile, e.g. 90 = top 10%
  changeFreqMin: number; // absolute floor on commit count
  complexityMin: number; // absolute floor on cyclomatic complexity
  distanceMax: number | null; // optional hard gate on Martin's D; null = off
  bugfixPatterns: RegExp[];
  moduleDefinition: ModuleDefinition;
  languages: string[] | "auto";
  excludes: string[];
  comment: boolean;
  generateMap: boolean;
  generateArtifact: boolean;
  githubToken: string;
}

/** Behavioral metrics for a single file, derived from git history. */
export interface FileHistory {
  path: string;
  commitCount: number; // raw commits in window
  weightedCommits: number; // recency-weighted change frequency
  authorCount: number; // distinct authors in window
  bugfixCommits: number; // commits matching bugfix patterns
  bugfixRatio: number; // bugfixCommits / commitCount
  lastChanged: Date | null;
}

/** A pair of files that change together (change coupling). */
export interface CouplingPair {
  a: string;
  b: string;
  sharedCommits: number;
  degree: number; // sharedCommits / commits(a OR b)
}

/**
 * A file scored for hotspot ranking. Static fields are optional until the
 * Tree-sitter engine (M2) lands; the score falls back to activity-only ranking.
 */
export interface ScoredFile {
  path: string;
  weightedCommits: number;
  commitCount: number;
  authorCount: number;
  bugfixRatio: number;
  complexity: number | null; // null until static engine runs
  changeFreqRank: number; // 1 = most frequently changed
  complexityRank: number | null;
  score: number; // rank-product (lower = worse) or activity rank
  percentile: number; // 0-100, higher = worse
  isHotspot: boolean;
}

export interface AnalysisResult {
  scored: ScoredFile[];
  hotspots: ScoredFile[];
  coupling: CouplingPair[];
  totalFilesAnalyzed: number;
  windowDays: number;
}
