import { readFileSync } from "node:fs";
import { basename } from "node:path";

import {
  commitFilesAs,
  createBranchFrom,
  githubToken,
  openPullRequestAs,
  parseRepoRef,
  resolveBranchHead,
} from "./dashboard-github.ts";
import { UI_COMMIT_STAMP, uiCommitIdentity } from "./dashboard-identity.ts";
import type { ApplyImprovementResult } from "./dashboard-improve.ts";
import { DEFAULT_UI_REPO } from "./dashboard-publish.ts";
import type { ImprovementItem } from "./dashboard-types.ts";

export const UI_HEAL_BRANCH_SUFFIX = "ec34";

export interface UiPrResult {
  opened: boolean;
  number: number | null;
  url: string | null;
  branch: string;
  path: string;
  sha: string | null;
  error: string | null;
}

export function uiHealBranchName(item: ImprovementItem): string {
  return `cursor/dashboard-heal-${item.id}-${UI_HEAL_BRANCH_SUFFIX}`;
}

export function uiHealPatchPath(item: ImprovementItem): string {
  return `src/patches/${item.id}.css`;
}

export function uiHealPrTitle(item: ImprovementItem): string {
  return `dashboard heal gen ${item.generation}: ${item.title}`;
}

export function uiHealPrBody(item: ImprovementItem, patchPath: string): string {
  return [
    `Unique-file repair for generation ${item.generation}.`,
    "",
    `- File: \`${patchPath}\``,
    `- Committer: ${UI_COMMIT_STAMP}`,
    `- PR maker: ranjan-rgb`,
    "",
    item.summary,
  ].join("\n");
}

export function shouldOpenUiPr(input: { pr?: boolean; dryRun?: boolean }): boolean {
  return input.pr === true;
}

export async function openDashboardUiPr(
  result: ApplyImprovementResult,
  options: {
    repo?: string;
    token?: string | null;
    dryRun?: boolean;
    originUrl?: string;
  } = {},
): Promise<UiPrResult> {
  const item = result.item;
  const branch = uiHealBranchName(item);
  const path = uiHealPatchPath(item);
  const empty: UiPrResult = {
    opened: false,
    number: null,
    url: null,
    branch,
    path,
    sha: null,
    error: null,
  };
  if (options.dryRun) {
    return { ...empty, url: `dry-run://ui-pr/${item.id}` };
  }
  const token = options.token ?? githubToken(process.env, options.originUrl ?? "");
  if (!token) {
    return { ...empty, error: "no GitHub token to open UI repo PRs as ranjan-rgb" };
  }
  try {
    const repo = parseRepoRef(options.repo ?? process.env.DASHBOARD_UI_REPO ?? DEFAULT_UI_REPO);
    const identity = uiCommitIdentity();
    const main = await resolveBranchHead(token, repo, "main");
    await createBranchFrom(token, repo, branch, main.sha);
    const patchBody = readFileSync(result.patchPath, "utf8");
    const sha = await commitFilesAs(token, repo, {
      branch,
      message: uiHealPrTitle(item),
      files: [{ path, content: patchBody }],
      identity,
      parentSha: main.sha,
      baseTree: main.tree,
    });
    const pr = await openPullRequestAs(token, repo, {
      title: uiHealPrTitle(item),
      body: uiHealPrBody(item, path),
      head: branch,
      base: "main",
    });
    return {
      opened: true,
      number: pr.number,
      url: pr.url,
      branch,
      path,
      sha,
      error: null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "open UI PR failed";
    return { ...empty, error: message };
  }
}

export function formatUiPrLine(pr: UiPrResult): string {
  if (pr.error) return `pr-failed ${pr.branch} ${pr.error}`;
  if (pr.url) return `pr ${pr.opened ? "opened" : "dry-run"} ${pr.url}`;
  return `pr skipped ${basename(pr.path)}`;
}
