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
  if (config.excludes.length > 0) {
    core.info(`Excludes (${config.excludes.length}): ${config.excludes.join(", ")}`);
  }
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

  // Gate scope: only files this PR touches.
  let touched: string[] = [];
  const pr = github.context.payload.pull_request;
  if (pr?.base?.sha && pr?.head?.sha) {
    touched = await changedFiles(pr.base.sha, pr.head.sha, cwd);
    core.info(`PR touches ${touched.length} file(s).`);
  }

  // Escape hatch: if the PR carries the acknowledge label, downgrade block → warn.
  let acknowledged = false;
  if (pr && config.acknowledgeLabel) {
    const labels: string[] = ((pr.labels as { name: string }[]) || []).map((l) => l.name);
    if (labels.includes(config.acknowledgeLabel)) {
      acknowledged = true;
      core.info(
        `PR has label "${config.acknowledgeLabel}" — block enforcement downgraded to warn. Remove the label once the hotspots are addressed.`,
      );
    }
  }

  const gateConfig =
    acknowledged && config.enforcementLevel === "block"
      ? { ...config, enforcementLevel: "warn" as const }
      : config;

  const gate = evaluateGate(analysis, touched, gateConfig, distanceByFile);

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

  // JSON artifact
  if (config.generateArtifact) {
    await writeArtifact(analysis, gate, config, cwd);
  }

  // PR comment — skipped in "info" mode and on non-PR events
  if (config.comment && pr && config.enforcementLevel !== "info") {
    const body = renderPrComment(analysis, gate, config, behavioralOnly, acknowledged);
    await upsertPrComment(body, config.githubToken);
  }

  // Log reasons
  if (gate.reasons.length > 0) {
    core.info("Gate findings:");
    for (const r of gate.reasons) core.info(`  • ${r}`);
  }

  // Inline PR diff annotations — one per violated file so developers see them in context
  if (gate.status !== "pass") {
    for (const h of gate.touchedHotspots) {
      const cxNote = h.complexity !== null ? `, complexity ${h.complexity}` : "";
      core.error(
        `Hotspot — ${h.percentile.toFixed(0)}th percentile, ${h.commitCount} commits${cxNote}. ` +
          `Reduce complexity or improve test coverage before merging. ` +
          `Add the "${config.acknowledgeLabel}" label to downgrade to warn while you plan the fix.`,
        { file: h.path, title: "🔥 Hotspot" },
      );
    }
    for (const v of gate.distanceViolations) {
      core.error(
        `Martin's Distance D=${v.distance.toFixed(2)} exceeds distance-max (${gateConfig.distanceMax}). ` +
          `Zone of Pain if stable+concrete: extract an interface. ` +
          `Zone of Uselessness if abstract+unstable: freeze the API.`,
        { file: v.path, title: "📐 Distance violation" },
      );
    }
  }

  if (gate.status === "fail") {
    core.setFailed(
      `Hotspot gate failed: this PR touches ${gate.touchedHotspots.length} hotspot file(s)` +
        (gate.distanceViolations.length ? ` and ${gate.distanceViolations.length} distance violation(s)` : "") +
        `. Improve them or add the "${config.acknowledgeLabel}" label to acknowledge and proceed.`,
    );
  }
}

run().catch((err) => {
  core.setFailed(`hotspot-tool crashed: ${err instanceof Error ? err.message : String(err)}`);
});
