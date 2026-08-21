import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

/**
 * Run a git command and return stdout. Buffer is generous because `git log`
 * over a full history can be large. Errors bubble up with git's stderr attached.
 */
export async function git(args: string[], cwd = process.cwd()): Promise<string> {
  try {
    const { stdout } = await execFileAsync("git", args, {
      cwd,
      maxBuffer: 256 * 1024 * 1024, // 256 MB
      windowsHide: true,
    });
    return stdout;
  } catch (err) {
    const e = err as { stderr?: string; message?: string };
    throw new Error(`git ${args.join(" ")} failed: ${e.stderr || e.message || String(err)}`);
  }
}

/** True if `cwd` is inside a git work tree. */
export async function isGitRepo(cwd = process.cwd()): Promise<boolean> {
  try {
    const out = await git(["rev-parse", "--is-inside-work-tree"], cwd);
    return out.trim() === "true";
  } catch {
    return false;
  }
}

/** Number of commits reachable from HEAD — used to detect a shallow clone. */
export async function commitDepth(cwd = process.cwd()): Promise<number> {
  try {
    const out = await git(["rev-list", "--count", "HEAD"], cwd);
    return Number.parseInt(out.trim(), 10) || 0;
  } catch {
    return 0;
  }
}

/** True when the clone is shallow (fetch-depth not 0) — behavioral metrics need full history. */
export async function isShallow(cwd = process.cwd()): Promise<boolean> {
  try {
    const out = await git(["rev-parse", "--is-shallow-repository"], cwd);
    return out.trim() === "true";
  } catch {
    return false;
  }
}
