import { git } from "./exec";
import type { Config, FileHistory } from "../types";

const FIELD = "\x1f"; // unit separator between fields
const MARK = "__HOTSPOT_COMMIT__"; // begins each commit record

interface Commit {
  hash: string;
  author: string;
  date: Date;
  subject: string;
  files: string[];
}

/** Files git currently tracks — used to drop history for deleted/moved paths. */
export async function trackedFiles(cwd = process.cwd()): Promise<Set<string>> {
  const out = await git(["ls-files"], cwd);
  return new Set(out.split("\n").map((l) => l.trim()).filter(Boolean));
}

/**
 * Parse `git log` over the configured window into structured commits.
 * Merge commits are excluded so a merge doesn't inflate every file's churn.
 */
export async function readCommits(config: Config, cwd = process.cwd()): Promise<Commit[]> {
  const pretty = `${MARK}%H${FIELD}%an${FIELD}%aI${FIELD}%s`;
  const out = await git(
    [
      "log",
      `--since=${config.historyWindowDays} days ago`,
      "--no-merges",
      "--name-only",
      `--pretty=format:${pretty}`,
    ],
    cwd,
  );

  const commits: Commit[] = [];
  let current: Commit | null = null;

  for (const line of out.split("\n")) {
    if (line.startsWith(MARK)) {
      if (current) commits.push(current);
      const [hash, author, iso, subject] = line.slice(MARK.length).split(FIELD);
      current = {
        hash: hash ?? "",
        author: author ?? "",
        date: new Date(iso ?? Date.now()),
        subject: subject ?? "",
        files: [],
      };
    } else if (current && line.trim() !== "") {
      current.files.push(line.trim());
    }
  }
  if (current) commits.push(current);
  return commits;
}

/** 0.5^(age/halfLife): a commit's weight halves every (window/2) days. */
function recencyWeight(date: Date, now: number, halfLifeDays: number): number {
  const ageDays = Math.max(0, (now - date.getTime()) / 86_400_000);
  return Math.pow(0.5, ageDays / halfLifeDays);
}

function isBugfix(subject: string, patterns: RegExp[]): boolean {
  return patterns.some((re) => re.test(subject));
}

/**
 * Aggregate commits into per-file behavioral metrics, restricted to files git
 * still tracks. Change frequency is recency-weighted so last month's churn
 * outweighs churn from the edge of the window.
 */
export async function analyzeHistory(config: Config, cwd = process.cwd()): Promise<FileHistory[]> {
  const [commits, tracked] = await Promise.all([readCommits(config, cwd), trackedFiles(cwd)]);
  const now = Date.now();
  const halfLife = Math.max(1, config.historyWindowDays / 2);

  const map = new Map<
    string,
    { count: number; weighted: number; authors: Set<string>; bugfixes: number; last: number }
  >();

  for (const commit of commits) {
    const weight = recencyWeight(commit.date, now, halfLife);
    const bug = isBugfix(commit.subject, config.bugfixPatterns);
    for (const file of commit.files) {
      if (!tracked.has(file)) continue;
      let entry = map.get(file);
      if (!entry) {
        entry = { count: 0, weighted: 0, authors: new Set(), bugfixes: 0, last: 0 };
        map.set(file, entry);
      }
      entry.count += 1;
      entry.weighted += weight;
      entry.authors.add(commit.author);
      if (bug) entry.bugfixes += 1;
      entry.last = Math.max(entry.last, commit.date.getTime());
    }
  }

  const result: FileHistory[] = [];
  for (const [path, e] of map) {
    result.push({
      path,
      commitCount: e.count,
      weightedCommits: e.weighted,
      authorCount: e.authors.size,
      bugfixCommits: e.bugfixes,
      bugfixRatio: e.count > 0 ? e.bugfixes / e.count : 0,
      lastChanged: e.last > 0 ? new Date(e.last) : null,
    });
  }
  return result;
}
