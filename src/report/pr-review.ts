import * as core from "@actions/core";
import * as github from "@actions/github";

export const INLINE_MARKER = "<!-- hotspot-tool:inline -->";

export interface InlineComment {
  path: string;
  body: string;
}

/**
 * Post one resolvable inline review comment per violated file on the PR's
 * Files Changed tab. On each push, stale comments from the previous run are
 * deleted first so the thread stays clean.
 *
 * Tries `subject_type:"file"` (no line needed) first; falls back to line 1
 * if the API rejects it.
 */
export async function upsertInlineComments(
  comments: InlineComment[],
  token: string,
): Promise<void> {
  const ctx = github.context;
  const pr = ctx.payload.pull_request;
  if (!pr) {
    core.info("Not a pull_request event — skipping inline review comments.");
    return;
  }
  if (!token) {
    core.warning("No github-token provided — cannot post inline review comments.");
    return;
  }

  const octokit = github.getOctokit(token);
  const { owner, repo } = ctx.repo;
  const pull_number = pr.number as number;
  const commit_id = (pr.head as { sha: string }).sha;

  // Remove stale inline comments from previous runs
  try {
    const existing = await octokit.paginate(octokit.rest.pulls.listReviewComments, {
      owner,
      repo,
      pull_number,
      per_page: 100,
    });
    const stale = existing.filter((c) => c.body?.includes(INLINE_MARKER));
    await Promise.all(
      stale.map((c) => octokit.rest.pulls.deleteReviewComment({ owner, repo, comment_id: c.id })),
    );
    if (stale.length > 0) core.info(`Removed ${stale.length} stale inline comment(s).`);
  } catch (err) {
    core.warning(`Could not clean up stale inline comments: ${(err as Error).message}`);
  }

  if (comments.length === 0) return;

  // Post one resolvable comment per violated file
  let posted = 0;
  for (const c of comments) {
    const body = `${INLINE_MARKER}\n${c.body}`;
    let ok = false;

    // Prefer line 1 — appears inline with the code in the diff, easy to spot and resolve
    try {
      await octokit.rest.pulls.createReviewComment({
        owner,
        repo,
        pull_number,
        commit_id,
        path: c.path,
        line: 1,
        side: "RIGHT",
        body,
      });
      ok = true;
    } catch {
      // line 1 not in diff — fall back to file-level comment (appears at file header)
    }

    if (!ok) {
      try {
        await octokit.request("POST /repos/{owner}/{repo}/pulls/{pull_number}/comments", {
          owner,
          repo,
          pull_number,
          commit_id,
          path: c.path,
          subject_type: "file",
          body,
        });
        ok = true;
      } catch (err) {
        core.warning(`Could not post inline comment on ${c.path}: ${(err as Error).message}`);
      }
    }

    if (ok) posted++;
  }

  if (posted > 0) core.info(`Posted ${posted} inline review comment(s).`);
}
