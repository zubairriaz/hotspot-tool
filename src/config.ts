import * as core from "@actions/core";
import type { Config, EnforcementLevel, ModuleDefinition } from "./types";

const ENFORCEMENT_LEVELS: EnforcementLevel[] = ["info", "warn", "block"];
const MODULE_DEFINITIONS: ModuleDefinition[] = ["file", "directory", "workspace"];

function parseList(raw: string): string[] {
  return raw
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function parseInt10(raw: string, fallback: number, name: string): number {
  const n = Number.parseInt(raw, 10);
  if (Number.isNaN(n)) {
    core.warning(`Invalid integer for '${name}': "${raw}" — falling back to ${fallback}.`);
    return fallback;
  }
  return n;
}

/**
 * Read the action inputs into a validated Config. In a GitHub Actions runner the
 * values come from @actions/core; outside CI they fall back to INPUT_* env vars,
 * which @actions/core reads transparently, so this works locally too.
 */
export function loadConfig(): Config {
  const rawLevel = (core.getInput("enforcement-level") || "warn").toLowerCase();
  const enforcementLevel = ENFORCEMENT_LEVELS.includes(rawLevel as EnforcementLevel)
    ? (rawLevel as EnforcementLevel)
    : "warn";
  if (enforcementLevel !== rawLevel) {
    core.warning(`Unknown enforcement-level "${rawLevel}" — defaulting to "warn".`);
  }

  const rawModule = (core.getInput("module-definition") || "directory").toLowerCase();
  const moduleDefinition = MODULE_DEFINITIONS.includes(rawModule as ModuleDefinition)
    ? (rawModule as ModuleDefinition)
    : "directory";

  const distanceRaw = core.getInput("distance-max").trim();
  let distanceMax: number | null = null;
  if (distanceRaw !== "") {
    const d = Number.parseFloat(distanceRaw);
    if (Number.isNaN(d) || d < 0 || d > 1) {
      core.warning(`distance-max must be between 0 and 1; got "${distanceRaw}" — ignoring.`);
    } else {
      distanceMax = d;
    }
  }

  const bugfixRaw = core.getInput("bugfix-patterns") || "fix,bug,patch,hotfix,revert";
  const bugfixPatterns = parseList(bugfixRaw).map((p) => {
    try {
      return new RegExp(p, "i");
    } catch {
      core.warning(`Invalid bugfix pattern "${p}" — skipping.`);
      return null;
    }
  }).filter((r): r is RegExp => r !== null);

  const languagesRaw = (core.getInput("languages") || "auto").trim();
  const languages = languagesRaw.toLowerCase() === "auto" ? "auto" : parseList(languagesRaw);

  return {
    enforcementLevel,
    historyWindowDays: parseInt10(core.getInput("history-window-days") || "90", 90, "history-window-days"),
    hotspotThreshold: parseInt10(core.getInput("hotspot-threshold") || "90", 90, "hotspot-threshold"),
    changeFreqMin: parseInt10(core.getInput("change-freq-min") || "5", 5, "change-freq-min"),
    complexityMin: parseInt10(core.getInput("complexity-min") || "10", 10, "complexity-min"),
    distanceMax,
    bugfixPatterns,
    moduleDefinition,
    languages,
    comment: (core.getInput("comment") || "true").toLowerCase() !== "false",
    generateMap: (core.getInput("generate-map") || "true").toLowerCase() !== "false",
    githubToken: core.getInput("github-token"),
  };
}
