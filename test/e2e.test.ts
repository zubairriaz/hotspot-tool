import { describe, test, before, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile, mkdir, readFile } from "node:fs/promises";
import * as path from "node:path";
import { tmpdir } from "node:os";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { analyzeHistory, trackedFiles } from "../src/git/history";
import { analyzeCoupling } from "../src/git/coupling";
import { rankHotspots } from "../src/hotspot";
import { evaluateGate } from "../src/gate";
import { runStaticEngine } from "../src/static/engine";
import { writeArtifact } from "../src/report/artifact";
import type { Config } from "../src/types";

const exec = promisify(execFile);

// TypeScript file with known structure:
//   abstractCount = 2 (interface + abstract class)
//   concreteCount = 1 (StringProcessor)
//   complexity >= 6 (if/if/for/if/else-if/while)
const COMPLEX_TS = `
interface IProcessor {
  process(input: string): string;
}
abstract class BaseProcessor implements IProcessor {
  abstract process(input: string): string;
}
class StringProcessor extends BaseProcessor {
  process(input: string): string {
    if (!input) return "";
    if (input.length < 3) return input;
    let result = "";
    for (let i = 0; i < input.length; i++) {
      if (input[i] === " ") result += "_";
      else if (input[i] === input[i]?.toUpperCase()) result += input[i]?.toLowerCase() ?? "";
      else result += input[i] ?? "";
    }
    while (result.endsWith("_")) result = result.slice(0, -1);
    return result;
  }
}
`;

// ── git helpers ──────────────────────────────────────────────────────────────

async function g(args: string[], cwd: string): Promise<string> {
  const env = {
    ...process.env,
    GIT_AUTHOR_NAME: "CI",
    GIT_AUTHOR_EMAIL: "ci@test.com",
    GIT_COMMITTER_NAME: "CI",
    GIT_COMMITTER_EMAIL: "ci@test.com",
    GIT_CONFIG_NOSYSTEM: "1",
  };
  const { stdout } = await exec("git", args, { cwd, env });
  return stdout.trim();
}

async function touch(dir: string, filePath: string, content: string): Promise<void> {
  const full = path.join(dir, filePath);
  await mkdir(path.dirname(full), { recursive: true });
  await writeFile(full, content, "utf-8");
}

async function commit(dir: string, msg: string, changes: Record<string, string>): Promise<void> {
  for (const [fp, content] of Object.entries(changes)) {
    await touch(dir, fp, content);
    await g(["add", fp], dir);
  }
  await g(["commit", "--no-gpg-sign", "-m", msg], dir);
}

// ── config factory ───────────────────────────────────────────────────────────

function cfg(overrides: Partial<Config> = {}): Config {
  return {
    enforcementLevel: "warn",
    historyWindowDays: 365,
    hotspotThreshold: 75,   // top 25% — easier to hit with test data
    changeFreqMin: 2,
    complexityMin: 1,
    distanceMax: null,
    bugfixPatterns: [/fix/i, /bug/i],
    moduleDefinition: "file",
    languages: "auto",
    excludes: [],
    noDefaultExcludes: true,
    comment: false,
    generateMap: false,
    generateArtifact: false,
    acknowledgeLabel: "hotspot-acknowledge",
    githubToken: "",
    ...overrides,
  };
}

// ── test suite ───────────────────────────────────────────────────────────────

describe("end-to-end", () => {
  let dir: string;

  before(async () => {
    dir = await mkdtemp(path.join(tmpdir(), "hotspot-e2e-"));
    await g(["init"], dir);
    await g(["config", "commit.gpgsign", "false"], dir);
    await g(["config", "user.email", "ci@test.com"], dir);
    await g(["config", "user.name", "CI Test"], dir);

    // ── initial commit — create every file ──────────────────────────────────
    await commit(dir, "chore: init", {
      "src/hot.ts":     "export const v = 0;",
      "src/quiet.ts":   "export const quiet = true;",
      "src/auth.ts":    "export function auth() {}",
      "src/session.ts": "export function session() {}",
      "dist/bundle.js": "// bundled",
      "src/complex.ts": COMPLEX_TS,
    });

    // ── src/hot.ts — 9 feature + 3 bugfix = 12 commits ──────────────────────
    for (let i = 1; i <= 9; i++)
      await commit(dir, `feat: hot ${i}`, { "src/hot.ts": `export const v = ${i};` });
    for (let i = 1; i <= 3; i++)
      await commit(dir, `fix: hot bug ${i}`, { "src/hot.ts": `export const v = -${i};` });

    // ── auth.ts + session.ts — 4 shared, 2 solo each ────────────────────────
    // shared_commits = 4, union = (1+4+2)+(1+4+2)-4 = 10, degree = 4/10 = 0.4
    for (let i = 1; i <= 4; i++)
      await commit(dir, `feat: auth+session ${i}`, {
        "src/auth.ts":    `export function auth() { return ${i}; }`,
        "src/session.ts": `import { auth } from "./auth";\nexport function session() { return auth() + ${i}; }`,
      });
    for (let i = 1; i <= 2; i++)
      await commit(dir, `feat: auth only ${i}`, { "src/auth.ts": `export function auth() { return "v${i}"; }` });
    for (let i = 1; i <= 2; i++)
      await commit(dir, `feat: session only ${i}`, { "src/session.ts": `import { auth } from "./auth";\nexport function session() { return auth() + "v${i}"; }` });

    // ── dist/bundle.js — 8 more commits (9 total) ───────────────────────────
    for (let i = 1; i <= 8; i++)
      await commit(dir, `build: bundle ${i}`, { "dist/bundle.js": `// v${i}` });

    // Final state (without excludes):
    //   src/hot.ts     — 12 commits  (highest → 100th percentile)
    //   dist/bundle.js —  9 commits  (2nd)
    //   src/auth.ts    —  7 commits  (3rd, tied-ish with session)
    //   src/session.ts —  7 commits
    //   src/complex.ts —  1 commit   (only initial → below changeFreqMin)
    //   src/quiet.ts   —  1 commit
  });

  after(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  // ── behavioral: history ──────────────────────────────────────────────────

  test("hot.ts is ranked as a hotspot (highest change frequency)", async () => {
    const c = cfg();
    const histories = await analyzeHistory(c, dir);
    const analysis = rankHotspots(histories, c);
    assert.ok(
      analysis.hotspots.some((h) => h.path === "src/hot.ts"),
      `hotspots: ${analysis.hotspots.map((h) => h.path).join(", ")}`,
    );
  });

  test("quiet.ts is not a hotspot (1 commit — below changeFreqMin=2)", async () => {
    const c = cfg();
    const histories = await analyzeHistory(c, dir);
    const analysis = rankHotspots(histories, c);
    assert.ok(!analysis.hotspots.some((h) => h.path === "src/quiet.ts"));
  });

  test("hot.ts commit count is 13 and has 3 bugfix commits", async () => {
    const c = cfg();
    const histories = await analyzeHistory(c, dir);
    const hot = histories.find((h) => h.path === "src/hot.ts");
    assert.ok(hot, "hot.ts should have history");
    assert.equal(hot!.commitCount, 13); // init + 9 feat + 3 fix
    assert.equal(hot!.bugfixCommits, 3);
    assert.ok(hot!.bugfixRatio > 0 && hot!.bugfixRatio < 1, `bugfixRatio should be in (0,1), got ${hot!.bugfixRatio}`);
  });

  test("author count is tracked for all files", async () => {
    const c = cfg();
    const histories = await analyzeHistory(c, dir);
    for (const h of histories) {
      assert.ok(h.authorCount >= 1, `${h.path}: authorCount should be ≥ 1`);
    }
  });

  test("recency-weighted commits are ≤ raw commit count", async () => {
    const c = cfg();
    const histories = await analyzeHistory(c, dir);
    for (const h of histories) {
      assert.ok(
        h.weightedCommits <= h.commitCount + 0.001,
        `${h.path}: weightedCommits (${h.weightedCommits.toFixed(3)}) > commitCount (${h.commitCount})`,
      );
    }
  });

  // ── change coupling ──────────────────────────────────────────────────────

  test("auth.ts and session.ts detected as a coupling pair", async () => {
    const c = cfg();
    const coupling = await analyzeCoupling(c, {}, dir);
    const pair = coupling.find(
      (p) =>
        (p.a === "src/auth.ts" && p.b === "src/session.ts") ||
        (p.a === "src/session.ts" && p.b === "src/auth.ts"),
    );
    assert.ok(pair, `auth+session pair not found. pairs: ${coupling.map((p) => `${p.a}↔${p.b}`).join(", ")}`);
    assert.equal(pair!.sharedCommits, 5); // init + 4 explicit shared commits
    assert.ok(pair!.degree > 0.3, `degree ${pair!.degree.toFixed(2)} should be > 0.3`);
  });

  test("coupling pair below minSharedCommits is excluded", async () => {
    const c = cfg();
    const coupling = await analyzeCoupling(c, { minSharedCommits: 10 }, dir);
    const pair = coupling.find((p) => p.a.includes("auth") || p.b.includes("auth"));
    assert.ok(!pair, "auth+session (4 shared) should be excluded when minSharedCommits=10");
  });

  // ── excludes ─────────────────────────────────────────────────────────────

  test("dist/** excluded — dist/bundle.js absent from history", async () => {
    const c = cfg({ excludes: ["dist/**"] });
    const histories = await analyzeHistory(c, dir);
    assert.ok(!histories.some((h) => h.path.startsWith("dist/")));
  });

  test("without excludes — dist/bundle.js present in history", async () => {
    const c = cfg();
    const histories = await analyzeHistory(c, dir);
    assert.ok(histories.some((h) => h.path === "dist/bundle.js"));
  });

  test("excludes propagate to coupling analysis", async () => {
    const c = cfg({ excludes: ["dist/**"] });
    const coupling = await analyzeCoupling(c, {}, dir);
    assert.ok(!coupling.some((p) => p.a.startsWith("dist/") || p.b.startsWith("dist/")));
  });

  test("multiple excludes patterns work together", async () => {
    const c = cfg({ excludes: ["dist/**", "src/quiet.ts"] });
    const histories = await analyzeHistory(c, dir);
    assert.ok(!histories.some((h) => h.path.startsWith("dist/")));
    assert.ok(!histories.some((h) => h.path === "src/quiet.ts"));
  });

  // ── gate: enforcement levels ─────────────────────────────────────────────

  test("gate info + hotspot touched → warn (visible), never fail", async () => {
    const c = cfg({ enforcementLevel: "info" });
    const histories = await analyzeHistory(c, dir);
    const analysis = rankHotspots(histories, c);
    const gate = evaluateGate(analysis, ["src/hot.ts"], c);
    assert.equal(gate.status, "warn");
    assert.ok(gate.touchedHotspots.length > 0);
  });

  test("gate warn + hotspot touched → warn status", async () => {
    const c = cfg({ enforcementLevel: "warn" });
    const histories = await analyzeHistory(c, dir);
    const analysis = rankHotspots(histories, c);
    const gate = evaluateGate(analysis, ["src/hot.ts"], c);
    assert.equal(gate.status, "warn");
  });

  test("gate block + hotspot touched → fail status", async () => {
    const c = cfg({ enforcementLevel: "block" });
    const histories = await analyzeHistory(c, dir);
    const analysis = rankHotspots(histories, c);
    const gate = evaluateGate(analysis, ["src/hot.ts"], c);
    assert.equal(gate.status, "fail");
  });

  test("gate block + only quiet files touched → pass", async () => {
    const c = cfg({ enforcementLevel: "block" });
    const histories = await analyzeHistory(c, dir);
    const analysis = rankHotspots(histories, c);
    const gate = evaluateGate(analysis, ["src/quiet.ts"], c);
    assert.equal(gate.status, "pass");
    assert.equal(gate.touchedHotspots.length, 0);
  });

  test("gate block + empty touched list → pass", async () => {
    const c = cfg({ enforcementLevel: "block" });
    const histories = await analyzeHistory(c, dir);
    const analysis = rankHotspots(histories, c);
    const gate = evaluateGate(analysis, [], c);
    assert.equal(gate.status, "pass");
  });

  test("gate distance violation fails independently of hotspot status", async () => {
    const c = cfg({ enforcementLevel: "block", distanceMax: 0.01 });
    const histories = await analyzeHistory(c, dir);
    const analysis = rankHotspots(histories, c);
    // quiet.ts is not a hotspot, but D=0.99 exceeds distanceMax
    const distanceByFile = new Map([["src/quiet.ts", { distance: 0.99, abstractness: 0, instability: 0 }]]);
    const gate = evaluateGate(analysis, ["src/quiet.ts"], c, distanceByFile);
    assert.equal(gate.distanceViolations.length, 1);
    assert.equal(gate.distanceViolations[0]!.path, "src/quiet.ts");
    assert.equal(gate.status, "fail");
  });

  // ── static engine ─────────────────────────────────────────────────────────

  test("static engine: complex.ts has complexity > 1", async () => {
    const c = cfg();
    const tracked = await trackedFiles(dir, c.excludes);
    const { complexityByFile } = await runStaticEngine(tracked, c, dir);
    const cx = complexityByFile.get("src/complex.ts");
    assert.ok(cx !== undefined, "complex.ts should have a complexity score");
    assert.ok(cx! > 1, `expected complexity > 1, got ${cx}`);
  });

  test("static engine: Martin's Distance is in [0, 1] for all files", async () => {
    const c = cfg();
    const tracked = await trackedFiles(dir, c.excludes);
    const { distanceByFile } = await runStaticEngine(tracked, c, dir);
    // session.ts imports auth.ts, so both are coupled and get scored.
    assert.ok(distanceByFile.has("src/session.ts"), "coupled importer should be scored");
    assert.ok(distanceByFile.has("src/auth.ts"), "coupled import target should be scored");
    // quiet.ts has no imports in or out — instability is undefined, so it is omitted
    // rather than scored with a fabricated I = 0.
    assert.equal(distanceByFile.get("src/quiet.ts"), undefined, "isolated file must not be scored");

    for (const [file, m] of distanceByFile) {
      assert.ok(m.distance >= 0 && m.distance <= 1, `${file}: D=${m.distance.toFixed(3)} is not in [0,1]`);
      assert.ok(m.abstractness >= 0 && m.abstractness <= 1, `${file}: A=${m.abstractness.toFixed(3)} is not in [0,1]`);
      assert.ok(m.instability >= 0 && m.instability <= 1, `${file}: I=${m.instability.toFixed(3)} is not in [0,1]`);
    }
  });

  test("static engine: excludes filter applied — dist/bundle.js absent", async () => {
    const c = cfg({ excludes: ["dist/**"] });
    const tracked = await trackedFiles(dir, c.excludes);
    const { complexityByFile } = await runStaticEngine(tracked, c, dir);
    assert.ok(!complexityByFile.has("dist/bundle.js"));
  });

  // ── JSON artifact ─────────────────────────────────────────────────────────

  test("writeArtifact creates hotspot-report.json with valid shape", async () => {
    const c = cfg();
    const histories = await analyzeHistory(c, dir);
    const analysis = rankHotspots(histories, c);
    const gate = evaluateGate(analysis, ["src/hot.ts"], c);
    await writeArtifact(analysis, gate, c, dir);

    const raw = await readFile(path.join(dir, "hotspot-report.json"), "utf-8");
    const report = JSON.parse(raw);

    assert.ok(typeof report.generatedAt === "string", "should have generatedAt");
    assert.ok(typeof report.totalFilesAnalyzed === "number" && report.totalFilesAnalyzed > 0);
    assert.ok(typeof report.windowDays === "number");
    assert.ok(["pass", "warn", "fail"].includes(report.gateStatus));
    assert.ok(Array.isArray(report.hotspots));
    assert.ok(Array.isArray(report.touchedHotspots));
    assert.ok(Array.isArray(report.coupling));
    assert.ok(Array.isArray(report.distanceViolations));
  });

  test("artifact hotspot entries have all required fields", async () => {
    const c = cfg();
    const histories = await analyzeHistory(c, dir);
    const analysis = rankHotspots(histories, c);
    const gate = evaluateGate(analysis, ["src/hot.ts"], c);
    await writeArtifact(analysis, gate, c, dir);

    const report = JSON.parse(await readFile(path.join(dir, "hotspot-report.json"), "utf-8"));
    assert.ok(report.hotspots.length > 0, "should have at least one hotspot");
    const h = report.hotspots[0];
    assert.ok(typeof h.path === "string");
    assert.ok(typeof h.percentile === "number");
    assert.ok(typeof h.commitCount === "number");
    assert.ok(typeof h.authorCount === "number");
    assert.ok(typeof h.bugfixRatio === "number");
    assert.ok(typeof h.score === "number");
  });

  test("artifact touchedHotspots matches gate.touchedHotspots", async () => {
    const c = cfg();
    const histories = await analyzeHistory(c, dir);
    const analysis = rankHotspots(histories, c);
    const gate = evaluateGate(analysis, ["src/hot.ts"], c);
    await writeArtifact(analysis, gate, c, dir);

    const report = JSON.parse(await readFile(path.join(dir, "hotspot-report.json"), "utf-8"));
    assert.deepEqual(report.touchedHotspots, gate.touchedHotspots.map((h) => h.path));
  });

  // ── full pipeline ─────────────────────────────────────────────────────────

  test("full pipeline: excludes + static engine + block gate, end-to-end", async () => {
    const c = cfg({ excludes: ["dist/**"], enforcementLevel: "block" });

    const [histories, coupling, tracked] = await Promise.all([
      analyzeHistory(c, dir),
      analyzeCoupling(c, {}, dir),
      trackedFiles(dir, c.excludes),
    ]);
    const { complexityByFile, distanceByFile } = await runStaticEngine(tracked, c, dir);
    const analysis = rankHotspots(histories, c, coupling, complexityByFile);
    const gate = evaluateGate(analysis, ["src/hot.ts", "src/quiet.ts"], c, distanceByFile);

    // dist must not appear anywhere
    assert.ok(!histories.some((h) => h.path.startsWith("dist/")));
    assert.ok(!analysis.hotspots.some((h) => h.path.startsWith("dist/")));
    assert.ok(!coupling.some((p) => p.a.startsWith("dist/") || p.b.startsWith("dist/")));
    assert.ok(!complexityByFile.has("dist/bundle.js"));

    // hot.ts should be flagged, gate should fail
    assert.ok(gate.touchedHotspots.some((h) => h.path === "src/hot.ts"));
    assert.equal(gate.status, "fail");

    // Artifact should reflect the same state
    await writeArtifact(analysis, gate, c, dir);
    const report = JSON.parse(await readFile(path.join(dir, "hotspot-report.json"), "utf-8"));
    assert.equal(report.gateStatus, "fail");
    assert.ok(report.touchedHotspots.includes("src/hot.ts"));
  });
});
