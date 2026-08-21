import * as core from "@actions/core";
import * as github from "@actions/github";
import { loadConfig } from "./config";
import { isGitRepo, isShallow } from "./git/exec";
import { analyzeHistory, trackedFiles } from "./git/history";
import { analyzeCoupling } from "./git/coupling";
import { changedFiles } from "./git/changed";
import { rankHotspots } from "./hotspot";
import { evaluateGate } from "./gate";
import { renderPrComment, renderJobSummary } from "./report/markdown";
import { upsertPrComment } from "./report/pr-comment";
import { writeArtifact } from "./report/artifact";
import { runStaticEngine } from "./static/engine";

async function run(): Promise<void> {
  const config = loadConfig();
  core.info(
    `hotspot-tool config: enforcement=${config.enforcementLevel}, window=${config.historyWindowDays}d, threshold=${config.hotspotThreshold}th-pct, change-freq-min=${config.changeFreqMin}, complexity-min=${config.complexityMin}, module=${config.moduleDefinition}, languages=${Array.isArray(config.languages) ? config.languages.join(",") : config.languages}`,
  );
  // On a runner GITHUB_WORKSPACE is the checked-out repo root; fall back to cwd.
  const cwd = process.env.GITHUB_WORKSPACE || process.cwd();

  if (!(await isGitRepo(cwd))) {
    core.setFailed("Not a git repository. hotspot-tool needs git history — check out the repo before this step.");
    return;
  }
  if (await isShallow(cwd)) {
    core.warning(
      "Shallow clone detected. Behavioral metrics need full history — set `fetch-depth: 0` on actions/checkout for accurate results.",
    );
  }

  core.info("Analyzing git history (whole repo)...");
  const [histories, coupling, tracked] = await Promise.all([
    analyzeHistory(config, cwd),
    analyzeCoupling(config, {}, cwd),
    trackedFiles(cwd, config.excludes),
  ]);

  const { complexityByFile, distanceByFile } = await runStaticEngine(tracked, config, cwd);
  const behavioralOnly = complexityByFile.size === 0;

  const analysis = rankHotspots(histories, config, coupling, complexityByFile);
  core.info(`Found ${analysis.hotspots.length} hotspot(s) across ${analysis.totalFilesAnalyzed} files.`);

  // Gate scope: only files this PR touches. On non-PR events the touched set is
  // empty, so the run reports repo-wide hotspots without gating anything.
  let touched: string[] = [];
  const pr = github.context.payload.pull_request;
  if (pr?.base?.sha && pr?.head?.sha) {
    touched = await changedFiles(pr.base.sha, pr.head.sha, cwd);
    core.info(`PR touches ${touched.length} file(s).`);
  }

  const gate = evaluateGate(analysis, touched, config, distanceByFile);

  // Outputs
  core.setOutput("hotspot-count", analysis.hotspots.length);
  core.setOutput("touched-hotspot-count", gate.touchedHotspots.length);
  core.setOutput("gate-status", gate.status);

  // Job summary (always)
  try {
    await core.summary.addRaw(renderJobSummary(analysis, gate, config)).write();
  } catch (err) {
    core.warning(`Could not write job summary: ${(err as Error).message}`);
  }

  // JSON artifact (always, unless opted out)
  if (config.generateArtifact) {
    await writeArtifact(analysis, gate, config, cwd);
  }

  // PR comment — skipped in "info" mode (job summary only) and on non-PR events
  if (config.comment && pr && config.enforcementLevel !== "info") {
    const body = renderPrComment(analysis, gate, config, behavioralOnly);
    await upsertPrComment(body, config.githubToken);
  }

  // Report reasons in the log
  if (gate.reasons.length > 0) {
    core.info("Gate findings:");
    for (const r of gate.reasons) core.info(`  • ${r}`);
  }

  if (gate.status === "fail") {
    core.setFailed(
      `Hotspot gate failed: this PR touches ${gate.touchedHotspots.length} hotspot file(s)` +
        (gate.distanceViolations.length ? ` and ${gate.distanceViolations.length} distance violation(s)` : "") +
        ". Improve them or lower enforcement-level to `warn`.",
    );
  }
}

run().catch((err) => {
  core.setFailed(`hotspot-tool crashed: ${err instanceof Error ? err.message : String(err)}`);
});
