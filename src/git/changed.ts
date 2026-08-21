import * as core from "@actions/core";
import { git } from "./exec";

/**
 * Files changed between two commits (base...head). Uses the three-dot form so we
 * compare against the merge base — i.e. what the PR actually introduces, not
 * unrelated commits that landed on the base branch meanwhile.
 */
export async function changedFiles(base: string, head: string, cwd = process.cwd()): Promise<string[]> {
  try {
    const out = await git(["diff", "--name-only", `${base}...${head}`], cwd);
    return out.split("\n").map((l) => l.trim()).filter(Boolean);
  } catch (err) {
    core.info(`Three-dot diff failed (${(err as Error).message}) — falling back to two-dot diff. Results may include unrelated base-branch changes.`);
    const out = await git(["diff", "--name-only", base, head], cwd);
    return out.split("\n").map((l) => l.trim()).filter(Boolean);
  }
}
