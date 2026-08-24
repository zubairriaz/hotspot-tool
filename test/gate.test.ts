import { test } from "node:test";
import assert from "node:assert/strict";
import { evaluateGate } from "../src/gate";
import { rankHotspots } from "../src/hotspot";
import type { AnalysisResult, Config, FileHistory } from "../src/types";

// ── helpers ─────────────────────────────────────────────────────────────────

function makeConfig(overrides: Partial<Config> = {}): Config {
  return {
    enforcementLevel: "warn",
    historyWindowDays: 90,
    hotspotThreshold: 90,
    changeFreqMin: 5,
    complexityMin: 10,
    distanceMax: null,
    bugfixPatterns: [/fix/i],
    moduleDefinition: "directory",
    languages: "auto",
    excludes: [],
    noDefaultExcludes: true,
    comment: true,
    generateMap: true,
    generateArtifact: true,
    acknowledgeLabel: "hotspot-acknowledge",
    githubToken: "",
    ...overrides,
  };
}

function makeHistory(path: string, commits: number): FileHistory {
  return {
    path,
    commitCount: commits,
    weightedCommits: commits,
    authorCount: 2,
    bugfixCommits: 0,
    bugfixRatio: 0,
    lastChanged: new Date(),
  };
}

/** Build a realistic AnalysisResult with one clear hotspot and several quiet files. */
function buildAnalysis(config: Config): AnalysisResult {
  const histories = [
    makeHistory("hot.ts", 40),
    ...Array.from({ length: 19 }, (_, i) => makeHistory(`quiet${i}.ts`, 1)),
  ];
  return rankHotspots(histories, config);
}

// ── enforcement level behaviour ──────────────────────────────────────────────

test("gate passes when no hotspots are touched regardless of enforcement level", () => {
  const config = makeConfig({ enforcementLevel: "block" });
  const analysis = buildAnalysis(config);
  const result = evaluateGate(analysis, ["unrelated.ts"], config);
  assert.equal(result.status, "pass");
  assert.equal(result.touchedHotspots.length, 0);
});

test("warn enforcement: touching a hotspot yields warn, not fail", () => {
  const config = makeConfig({ enforcementLevel: "warn" });
  const analysis = buildAnalysis(config);
  const result = evaluateGate(analysis, ["hot.ts"], config);
  assert.equal(result.status, "warn");
  assert.equal(result.touchedHotspots.length, 1);
});

test("block enforcement: touching a hotspot yields fail", () => {
  const config = makeConfig({ enforcementLevel: "block" });
  const analysis = buildAnalysis(config);
  const result = evaluateGate(analysis, ["hot.ts"], config);
  assert.equal(result.status, "fail");
});

test("info enforcement: touching a hotspot yields warn (visible in summary), never fail", () => {
  const config = makeConfig({ enforcementLevel: "info" });
  const analysis = buildAnalysis(config);
  const result = evaluateGate(analysis, ["hot.ts"], config);
  // "info" shows findings but never blocks — status is "warn", not "fail"
  assert.equal(result.status, "warn");
  assert.equal(result.touchedHotspots.length, 1);
});

test("info enforcement: no violations still passes", () => {
  const config = makeConfig({ enforcementLevel: "info" });
  const analysis = buildAnalysis(config);
  const result = evaluateGate(analysis, ["quiet0.ts"], config);
  assert.equal(result.status, "pass");
});

// ── touched-file scoping ─────────────────────────────────────────────────────

test("gate only fires on files the PR actually touched", () => {
  const config = makeConfig({ enforcementLevel: "block" });
  const analysis = buildAnalysis(config);
  // PR touched only quiet files — hotspot exists in repo but PR didn't touch it
  const result = evaluateGate(analysis, ["quiet0.ts", "quiet1.ts"], config);
  assert.equal(result.status, "pass");
  assert.equal(result.touchedHotspots.length, 0);
});

test("touching multiple hotspots lists all of them", () => {
  // Build analysis with two clear hotspots
  const config = makeConfig();
  const histories = [
    makeHistory("hot1.ts", 50),
    makeHistory("hot2.ts", 45),
    ...Array.from({ length: 18 }, (_, i) => makeHistory(`quiet${i}.ts`, 1)),
  ];
  const analysis = rankHotspots(histories, config);
  const result = evaluateGate(analysis, ["hot1.ts", "hot2.ts", "quiet0.ts"], config);
  assert.equal(result.touchedHotspots.length, 2);
  const paths = result.touchedHotspots.map((h) => h.path);
  assert.ok(paths.includes("hot1.ts"));
  assert.ok(paths.includes("hot2.ts"));
});

test("empty touched list always passes", () => {
  const config = makeConfig({ enforcementLevel: "block" });
  const analysis = buildAnalysis(config);
  const result = evaluateGate(analysis, [], config);
  assert.equal(result.status, "pass");
  assert.equal(result.touchedHotspots.length, 0);
  assert.equal(result.reasons.length, 0);
});

// ── Martin's Distance gate ───────────────────────────────────────────────────

test("distance gate: no violations when distanceMax is null (off by default)", () => {
  const config = makeConfig({ distanceMax: null });
  const analysis = buildAnalysis(config);
  const distanceByFile = new Map([["hot.ts", 0.99]]);
  const result = evaluateGate(analysis, ["hot.ts"], config, distanceByFile);
  assert.equal(result.distanceViolations.length, 0);
});

test("distance gate: flags a file exceeding distanceMax", () => {
  const config = makeConfig({ enforcementLevel: "block", distanceMax: 0.5 });
  const analysis = buildAnalysis(config);
  // "clean-but-distant.ts" is not a hotspot but its D exceeds the gate
  const distanceByFile = new Map([["clean-but-distant.ts", 0.8]]);
  const result = evaluateGate(analysis, ["clean-but-distant.ts"], config, distanceByFile);
  assert.equal(result.distanceViolations.length, 1);
  assert.equal(result.distanceViolations[0]!.path, "clean-but-distant.ts");
  assert.equal(result.status, "fail");
});

test("distance gate: file exactly at distanceMax is not a violation", () => {
  const config = makeConfig({ distanceMax: 0.5 });
  const analysis = buildAnalysis(config);
  const distanceByFile = new Map([["borderline.ts", 0.5]]);
  const result = evaluateGate(analysis, ["borderline.ts"], config, distanceByFile);
  assert.equal(result.distanceViolations.length, 0);
});

test("distance gate: only flags touched files, not the whole repo", () => {
  const config = makeConfig({ distanceMax: 0.3 });
  const analysis = buildAnalysis(config);
  const distanceByFile = new Map([
    ["touched.ts", 0.9],
    ["untouched.ts", 0.9],
  ]);
  const result = evaluateGate(analysis, ["touched.ts"], config, distanceByFile);
  assert.equal(result.distanceViolations.length, 1);
  assert.equal(result.distanceViolations[0]!.path, "touched.ts");
});

// ── reasons / human output ───────────────────────────────────────────────────

test("reasons list is empty when gate passes", () => {
  const config = makeConfig();
  const analysis = buildAnalysis(config);
  const result = evaluateGate(analysis, [], config);
  assert.equal(result.reasons.length, 0);
});

test("reason string includes path, percentile, commit count and author count", () => {
  const config = makeConfig();
  const analysis = buildAnalysis(config);
  const result = evaluateGate(analysis, ["hot.ts"], config);
  assert.equal(result.reasons.length, 1);
  const reason = result.reasons[0]!;
  assert.ok(reason.includes("hot.ts"), "should name the file");
  assert.ok(reason.includes("percentile"), "should mention percentile");
  assert.ok(reason.includes("commits"), "should mention commit count");
  assert.ok(reason.includes("authors"), "should mention author count");
});

test("distance violation reason includes the D value and configured max", () => {
  const config = makeConfig({ distanceMax: 0.4 });
  const analysis = buildAnalysis(config);
  const distanceByFile = new Map([["risky.ts", 0.75]]);
  const result = evaluateGate(analysis, ["risky.ts"], config, distanceByFile);
  const reason = result.reasons[0]!;
  assert.ok(reason.includes("risky.ts"));
  assert.ok(reason.includes("0.75"));
  assert.ok(reason.includes("0.4"));
});

// ── combined hotspot + distance violations ───────────────────────────────────

test("both hotspot and distance violations can trigger simultaneously", () => {
  const config = makeConfig({ enforcementLevel: "block", distanceMax: 0.3 });
  const analysis = buildAnalysis(config);
  const distanceByFile = new Map([["hot.ts", 0.9]]);
  const result = evaluateGate(analysis, ["hot.ts"], config, distanceByFile);
  assert.equal(result.touchedHotspots.length, 1);
  assert.equal(result.distanceViolations.length, 1);
  assert.equal(result.status, "fail");
  assert.equal(result.reasons.length, 2);
});
