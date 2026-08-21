import * as core from "@actions/core";
import * as github from "@actions/github";
import { COMMENT_MARKER } from "./markdown";

/**
 * Post or update the PR comment (sticky: one comment per PR, updated in place so
 * pushes don't spam the thread). No-ops gracefully when not on a pull_request or
 * when no token is available.
 */
export async function upsertPrComment(body: string, token: string): Promise<void> {
  const ctx = github.context;
  const pr = ctx.payload.pull_request;
  if (!pr) {
    core.info("Not a pull_request event — skipping PR comment.");
    return;
  }
  if (!token) {
    core.warning("No github-token provided — cannot post PR comment.");
    return;
  }

  const octokit = github.getOctokit(token);
  const { owner, repo } = ctx.repo;
  const issue_number = pr.number;

  try {
    const existing = await octokit.paginate(octokit.rest.issues.listComments, {
      owner,
      repo,
      issue_number,
      per_page: 100,
    });
    const mine = existing.find((c) => c.body?.includes(COMMENT_MARKER));

    if (mine) {
      await octokit.rest.issues.updateComment({ owner, repo, comment_id: mine.id, body });
      core.info(`Updated existing hotspot comment (#${mine.id}).`);
    } else {
      await octokit.rest.issues.createComment({ owner, repo, issue_number, body });
      core.info("Posted new hotspot comment.");
    }
  } catch (err) {
    core.warning(`Failed to post PR comment: ${(err as Error).message}`);
  }
}
