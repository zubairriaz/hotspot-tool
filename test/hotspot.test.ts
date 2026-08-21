import { test } from "node:test";
import assert from "node:assert/strict";
import { rankHotspots } from "../src/hotspot";
import type { Config, FileHistory } from "../src/types";

const baseConfig: Config = {
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
  comment: true,
  generateMap: true,
  generateArtifact: true,
  githubToken: "",
};

function fh(path: string, commits: number, weighted = commits): FileHistory {
  return {
    path,
    commitCount: commits,
    weightedCommits: weighted,
    authorCount: 1,
    bugfixCommits: 0,
    bugfixRatio: 0,
    lastChanged: new Date(),
  };
}

test("flags a busy file as a hotspot and ignores a quiet one", () => {
  const histories = [
    fh("busy.ts", 40),
    fh("quiet.ts", 1),
    ...Array.from({ length: 18 }, (_, i) => fh(`mid${i}.ts`, 2)),
  ];
  const result = rankHotspots(histories, baseConfig);
  const paths = result.hotspots.map((h) => h.path);
  assert.ok(paths.includes("busy.ts"), "busy.ts should be a hotspot");
  assert.ok(!paths.includes("quiet.ts"), "quiet.ts is below the change-freq floor");
});

test("absolute floor prevents flagging a clean repo's relative worst", () => {
  // Every file has only 1-2 commits: nothing clears change-freq-min (5).
  const histories = Array.from({ length: 20 }, (_, i) => fh(`f${i}.ts`, (i % 2) + 1));
  const result = rankHotspots(histories, baseConfig);
  assert.equal(result.hotspots.length, 0, "no file should be a hotspot in a low-activity repo");
});

test("rank-product uses complexity when the static engine provides it", () => {
  const histories = [
    fh("hot.ts", 30),
    fh("churny-but-simple.ts", 30),
    ...Array.from({ length: 18 }, (_, i) => fh(`m${i}.ts`, 6)),
  ];
  const complexity = new Map<string, number>([
    ["hot.ts", 50],
    ["churny-but-simple.ts", 1],
    ...histories.slice(2).map((h) => [h.path, 5] as [string, number]),
  ]);
  const result = rankHotspots(histories, baseConfig, [], complexity);
  const top = result.hotspots[0];
  assert.equal(top?.path, "hot.ts", "high churn AND high complexity should rank worst");
});
