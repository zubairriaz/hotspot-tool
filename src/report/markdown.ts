import type { AnalysisResult, Config, GateStatus, ScoredFile } from "../types";
import type { GateResult, DistanceViolation } from "../gate";

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

function zoneLabel(v: DistanceViolation): { badge: string; zone: string } {
  if (v.abstractness < 0.5 && v.instability < 0.5) return { badge: "🔥 Zone of Pain", zone: "pain" };
  if (v.abstractness >= 0.5 && v.instability >= 0.5) return { badge: "🌫️ Zone of Uselessness", zone: "useless" };
  return { badge: "⚠️ Off Main Sequence", zone: "other" };
}

function whatToDo(hotspots: ScoredFile[], distanceViolations: DistanceViolation[], distanceMax: number | null, acknowledged: boolean): string[] {
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
    lines.push("D = |A + I − 1|. Healthy modules sit on the Main Sequence where A + I ≈ 1.");
    lines.push("");
    for (const v of distanceViolations) {
      const { badge, zone } = zoneLabel(v);
      const fix = zone === "pain"
        ? `Stable (I=${v.instability.toFixed(2)}) but fully concrete (A=${v.abstractness.toFixed(2)}). Extract an interface so callers depend on the abstraction, not this implementation.`
        : zone === "useless"
        ? `Abstract (A=${v.abstractness.toFixed(2)}) but unstable (I=${v.instability.toFixed(2)}). Freeze the API contract; push volatile behaviour into concrete implementations.`
        : `A=${v.abstractness.toFixed(2)}, I=${v.instability.toFixed(2)}: add abstractions or reduce coupling to bring A + I closer to 1.`;
      lines.push(`- \`${v.path}\` — ${badge}, D \`${v.distance.toFixed(2)}\` > \`${distanceMax}\`. ${fix}`);
    }
    lines.push("");
  }

  lines.push("**Need more time?** Add the `hotspot-acknowledge` label to this PR to downgrade `block` → `warn` while you plan the cleanup. Remove the label once addressed.");
  lines.push("");
  lines.push("</details>");
  return lines;
}

/** Inline review comment body for a hotspot violation (shown in Files Changed, resolvable). */
export function renderHotspotInline(h: ScoredFile, config: Config): string {
  const lines: string[] = [];
  lines.push(`### 🔥 Hotspot — ${h.percentile.toFixed(0)}th percentile`);
  lines.push("");
  lines.push("| Metric | Value |");
  lines.push("|---|---|");
  lines.push(`| Commits (${config.historyWindowDays}d window) | **${h.commitCount}** |`);
  lines.push(`| Authors | ${h.authorCount} |`);
  lines.push(`| Bug-fix ratio | ${pct(h.bugfixRatio * 100)} |`);
  if (h.complexity !== null) {
    lines.push(`| Complexity | ${complexityCell(h)} |`);
  }
  lines.push("");

  const tips: string[] = [];
  if (h.complexity !== null && h.complexity >= 15) {
    tips.push(`Complexity **${h.complexity}** — aim for < 10. Extract large methods into smaller, named helpers.`);
  }
  if (h.bugfixRatio > 0.3) {
    tips.push(`Bug-fix ratio **${pct(h.bugfixRatio * 100)}** — add regression tests before adding new behaviour.`);
  }
  if (h.authorCount === 1 && h.commitCount > 8) {
    tips.push(`Only **1 author** despite ${h.commitCount} commits — pair on this file to spread knowledge and catch hidden complexity.`);
  }
  if (tips.length === 0) {
    tips.push(`Changed frequently (${h.commitCount} commits). Leave it a little cleaner than you found it — rename a confusing variable, extract one function, or add one missing test.`);
  }
  for (const t of tips) lines.push(`**Tip:** ${t}`);
  lines.push("");
  lines.push(`> **Need more time?** Add the \`${config.acknowledgeLabel}\` label to this PR to downgrade \`block → warn\` while you plan the cleanup. Resolve this comment once addressed.`);
  return lines.join("\n");
}

/** Inline review comment body for a Martin's Distance violation. */
export function renderDistanceInline(v: DistanceViolation, config: Config): string {
  const lines: string[] = [];
  const { badge, zone } = zoneLabel(v);
  lines.push(`### 📐 ${badge} — D=${v.distance.toFixed(2)}`);
  lines.push("");
  lines.push("| Metric | Value |");
  lines.push("|---|---|");
  lines.push(`| Abstractness (A) | ${v.abstractness.toFixed(2)} |`);
  lines.push(`| Instability (I) | ${v.instability.toFixed(2)} |`);
  lines.push(`| Distance (D) | **${v.distance.toFixed(2)}** |`);
  lines.push(`| Threshold | \`${config.distanceMax}\` |`);
  lines.push("");
  const fix =
    zone === "pain"
      ? `**Zone of Pain** — stable and concrete (A≈0, I≈0). Extract an interface so callers depend on the abstraction, not this implementation. Resolve this comment once the interface is extracted.`
      : zone === "useless"
      ? `**Zone of Uselessness** — abstract but unstable (A≈1, I≈1). Freeze the API contract and push volatile behaviour into concrete implementations. Resolve once the API is stable.`
      : `**Off the Main Sequence** — add abstractions or reduce coupling to bring A + I closer to 1. Resolve once D is within the \`${config.distanceMax}\` threshold.`;
  lines.push(fix);
  return lines.join("\n");
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
      lines.push("| File | A | I | D | Zone | Threshold |");
      lines.push("|---|---|---|---|---|---|");
      for (const v of gate.distanceViolations) {
        const { badge } = zoneLabel(v);
        lines.push(`| \`${v.path}\` | ${v.abstractness.toFixed(2)} | ${v.instability.toFixed(2)} | \`${v.distance.toFixed(2)}\` | ${badge} | \`${config.distanceMax}\` |`);
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
    lines.push("| File | A | I | D | Zone | Threshold |");
    lines.push("|---|---|---|---|---|---|");
    for (const v of gate.distanceViolations) {
      const { badge } = zoneLabel(v);
      lines.push(`| \`${v.path}\` | ${v.abstractness.toFixed(2)} | ${v.instability.toFixed(2)} | \`${v.distance.toFixed(2)}\` | ${badge} | \`${config.distanceMax}\` |`);
    }
    lines.push("");
  }

  return lines.join("\n");
}
