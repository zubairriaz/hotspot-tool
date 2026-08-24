import type { AnalysisResult, Config, GateStatus, ScoredFile } from "../types";
import type { GateResult } from "../gate";

export const COMMENT_MARKER = "<!-- hotspot-tool:pr-comment -->";

const STATUS_BADGE: Record<GateStatus, string> = {
  pass: "✅ **Pass**",
  warn: "⚠️ **Warn**",
  fail: "❌ **Fail**",
};

function pct(n: number): string {
  return `${n.toFixed(0)}%`;
}

function complexityCell(h: ScoredFile): string {
  if (h.complexity === null) return "—";
  if (h.complexity >= 30) return `**${h.complexity}** 🔴`;
  if (h.complexity >= 15) return `**${h.complexity}** 🟡`;
  return `${h.complexity}`;
}

function whatToDo(hotspots: ScoredFile[], distanceViolations: { path: string; distance: number }[], distanceMax: number | null, acknowledged: boolean): string[] {
  const lines: string[] = [];
  lines.push("<details><summary>🛠 What should I do?</summary>");
  lines.push("");

  if (acknowledged) {
    lines.push("> ⚠️ **Acknowledged** — the `hotspot-acknowledge` label is present, so the block gate is downgraded to warn. Remove the label once you have a plan to address these files.");
    lines.push("");
  }

  for (const h of hotspots) {
    lines.push(`**\`${h.path}\`**`);

    const tips: string[] = [];

    if (h.complexity !== null && h.complexity >= 15) {
      tips.push(
        `Cyclomatic complexity is **${h.complexity}** — aim for < 10 per file. Extract large functions into smaller, named helpers. Look for nested \`if\` chains and \`switch\` blocks as the first candidates.`,
      );
    }

    if (h.bugfixRatio > 0.3) {
      tips.push(
        `Bug-fix ratio is **${pct(h.bugfixRatio * 100)}** — this file breaks often. Add regression tests for the scenarios that triggered past fixes before adding new behaviour.`,
      );
    }

    if (h.authorCount === 1 && h.commitCount > 8) {
      tips.push(
        `Only **1 author** has touched this file despite ${h.commitCount} commits — consider a pairing session or code review pass to spread knowledge and catch hidden complexity.`,
      );
    }

    if (tips.length === 0) {
      tips.push(
        `This file is changed frequently (${h.commitCount} commits, ${pct(h.percentile)} percentile). Apply the **Boy Scout Rule**: leave it a little cleaner than you found it — rename a confusing variable, extract one function, or add one missing test.`,
      );
    }

    for (const tip of tips) lines.push(`- ${tip}`);
    lines.push("");
  }

  if (distanceViolations.length > 0) {
    lines.push("**Martin's Distance violations — architectural guidance**");
    lines.push("");
    lines.push(
      "Martin's Distance D = |Abstractness + Instability − 1|. A value near 1 means the file sits in a danger zone:",
    );
    lines.push("- **Zone of Pain** (D≈1, stable + concrete): many files depend on this one, but it has no abstractions. Every change here ripples everywhere. Fix: extract an interface or trait that dependents rely on instead of the concrete implementation.");
    lines.push("- **Zone of Uselessness** (D≈1, unstable + abstract): lots of abstractions that keep changing. Fix: stabilise the API — freeze the interface and push volatility into implementations.");
    lines.push("");
    for (const v of distanceViolations) {
      lines.push(`- \`${v.path}\` — D \`${v.distance.toFixed(2)}\` > \`distance-max ${distanceMax}\`. Introduce an abstraction layer or reduce the number of direct dependents.`);
    }
    lines.push("");
  }

  lines.push("**Need more time?** Add the `hotspot-acknowledge` label to this PR to downgrade `block` → `warn` while you plan the cleanup. Remove the label once addressed.");
  lines.push("");
  lines.push("</details>");
  return lines;
}

/** Build the PR comment body. */
export function renderPrComment(
  analysis: AnalysisResult,
  gate: GateResult,
  config: Config,
  behavioralOnly: boolean,
  acknowledged = false,
): string {
  const lines: string[] = [];
  lines.push(COMMENT_MARKER);
  lines.push("## 🔥 Hotspot report");
  lines.push("");

  const acknowledgedNote = acknowledged ? " · _gate acknowledged_" : "";
  lines.push(
    `${STATUS_BADGE[gate.status]} — analyzed ${analysis.totalFilesAnalyzed} files over the last ${analysis.windowDays} days · enforcement: \`${config.enforcementLevel}\`${acknowledgedNote}`,
  );
  lines.push("");

  if (gate.touchedHotspots.length === 0 && gate.distanceViolations.length === 0) {
    lines.push("No hotspots touched by this PR. Nice — nothing rotting here. 🌱");
  } else {
    if (gate.touchedHotspots.length > 0) {
      lines.push(`### This PR touches ${gate.touchedHotspots.length} hotspot file(s)`);
      lines.push("");
      lines.push("| File | Percentile | Commits | Authors | Bug-fix ratio | Complexity |");
      lines.push("|---|---|---|---|---|---|");
      for (const h of gate.touchedHotspots) {
        lines.push(
          `| \`${h.path}\` | ${pct(h.percentile)} | ${h.commitCount} | ${h.authorCount} | ${pct(h.bugfixRatio * 100)} | ${complexityCell(h)} |`,
        );
      }
      lines.push("");
    }

    if (gate.distanceViolations.length > 0) {
      lines.push("### Martin's Distance violations");
      lines.push("");
      lines.push("| File | D score | Threshold |");
      lines.push("|---|---|---|");
      for (const v of gate.distanceViolations) {
        lines.push(`| \`${v.path}\` | \`${v.distance.toFixed(2)}\` | \`${config.distanceMax}\` |`);
      }
      lines.push("");
    }

    lines.push(...whatToDo(gate.touchedHotspots, gate.distanceViolations, config.distanceMax, acknowledged));
  }

  lines.push("");
  lines.push("<details><summary>Top hotspots across the whole repo</summary>");
  lines.push("");
  lines.push("| Rank | File | Percentile | Commits | Authors | Complexity |");
  lines.push("|---|---|---|---|---|---|");
  analysis.hotspots.slice(0, 10).forEach((h, i) => {
    lines.push(`| ${i + 1} | \`${h.path}\` | ${pct(h.percentile)} | ${h.commitCount} | ${h.authorCount} | ${complexityCell(h)} |`);
  });
  if (analysis.hotspots.length === 0) lines.push("| — | _none above thresholds_ | | | | |");
  lines.push("");
  lines.push("</details>");

  if (behavioralOnly) {
    lines.push("");
    lines.push(
      "_Behavioral-only run: ranking uses change frequency. Complexity & Martin's metrics activate once the static engine is enabled for this repo's languages._",
    );
  }

  lines.push("");
  lines.push("<sub>🔥 Generated by hotspot-tool — mess × activity, measured in your own runner.</sub>");
  return lines.join("\n");
}

/** Build the full job summary. */
export function renderJobSummary(analysis: AnalysisResult, gate: GateResult, config: Config): string {
  const lines: string[] = [];
  lines.push("# 🔥 Hotspot analysis");
  lines.push("");
  lines.push(`- **Status:** ${gate.status}`);
  lines.push(`- **Files analyzed:** ${analysis.totalFilesAnalyzed}`);
  lines.push(`- **Window:** ${analysis.windowDays} days`);
  lines.push(`- **Hotspots (repo-wide):** ${analysis.hotspots.length}`);
  lines.push(`- **Hotspots touched by PR:** ${gate.touchedHotspots.length}`);
  lines.push("");

  if (analysis.hotspots.length > 0) {
    lines.push("## Repo hotspots");
    lines.push("| Rank | File | Percentile | Commits | Authors | Bug-fix ratio | Complexity |");
    lines.push("|---|---|---|---|---|---|---|");
    analysis.hotspots.slice(0, 25).forEach((h, i) => {
      lines.push(
        `| ${i + 1} | \`${h.path}\` | ${pct(h.percentile)} | ${h.commitCount} | ${h.authorCount} | ${pct(h.bugfixRatio * 100)} | ${complexityCell(h)} |`,
      );
    });
    lines.push("");
  }

  if (analysis.coupling.length > 0) {
    lines.push("## Change coupling (files that change together)");
    lines.push("| File A | File B | Shared commits | Degree |");
    lines.push("|---|---|---|---|");
    for (const c of analysis.coupling.slice(0, 15)) {
      lines.push(`| \`${c.a}\` | \`${c.b}\` | ${c.sharedCommits} | ${pct(c.degree * 100)} |`);
    }
    lines.push("");
  }

  if (gate.distanceViolations.length > 0) {
    lines.push("## Martin's Distance violations");
    lines.push("| File | D score | Threshold |");
    lines.push("|---|---|---|");
    for (const v of gate.distanceViolations) {
      lines.push(`| \`${v.path}\` | \`${v.distance.toFixed(2)}\` | \`${config.distanceMax}\` |`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
