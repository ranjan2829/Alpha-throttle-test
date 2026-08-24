import { readFileSync } from "node:fs";

import {
  applyDashboardImprovement,
  type ApplyImprovementOptions,
  type ApplyImprovementResult,
} from "./dashboard-improve.ts";
import { DEFAULT_UI_REPO, publishDashboardToMain, type PublishDashboardResult } from "./dashboard-publish.ts";
import { openDashboardUiPr, shouldOpenUiPr, type UiPrResult } from "./dashboard-ui-pr.ts";
import { verifyDashboardGeneration, type VerifyVerdict } from "./dashboard-verify.ts";
import type { BurstPlanner } from "./claude.ts";

export interface DashboardAgentOptions {
  repoRoot: string;
  generations?: number;
  stop?: boolean;
  publish?: boolean;
  pr?: boolean;
  uiRepo?: string;
  dryRun?: boolean;
  webSrc?: string;
  feedDir?: string;
  worker?: string;
  planner?: BurstPlanner;
  now?: () => string;
  improve?: (options: ApplyImprovementOptions) => ApplyImprovementResult;
  publishToMain?: typeof publishDashboardToMain;
  openPr?: typeof openDashboardUiPr;
  verify?: typeof verifyDashboardGeneration;
}

export interface DashboardAgentStep {
  generation: number;
  title: string;
  patchPath: string;
  verified: boolean;
  published: boolean;
  publishRepo: string;
  publishSha: string | null;
  publishError: string | null;
  prOpened: boolean;
  prUrl: string | null;
  prError: string | null;
}

export interface DashboardAgentResult {
  repo: string;
  steps: DashboardAgentStep[];
  memoryGen: number;
}

export async function runDashboardAgent(options: DashboardAgentOptions): Promise<DashboardAgentResult> {
  const generations = options.generations ?? 1;
  const repo = options.uiRepo ?? process.env.DASHBOARD_UI_REPO ?? DEFAULT_UI_REPO;
  const improve = options.improve ?? applyDashboardImprovement;
  const publish = options.publishToMain ?? publishDashboardToMain;
  const verify = options.verify ?? verifyDashboardGeneration;
  const steps: DashboardAgentStep[] = [];

  for (let step = 0; step < generations; step += 1) {
    const improveOptions: ApplyImprovementOptions = {
      worker: options.worker ?? "dashboard-agent",
      planner: options.planner ?? "claude",
    };
    if (options.webSrc) improveOptions.webSrc = options.webSrc;
    if (options.feedDir) improveOptions.feedDir = options.feedDir;
    if (options.stop) improveOptions.stop = options.stop;
    if (options.now) improveOptions.now = options.now;
    const result = improve(improveOptions);
    const verdict = verifyGeneration(verify, result);
    if (!verdict.ok) {
      const detail = verdict.issues.map((issue) => issue.message).join("; ");
      throw new Error(`verifier rejected gen ${result.generation.generation}: ${detail}`);
    }
    const published = await maybePublish(publish, options, repo, result);
    const pr = await maybeOpenPr(options, repo, result);
    steps.push({
      generation: result.generation.generation,
      title: result.item.title,
      patchPath: result.patchPath,
      verified: true,
      published: published.committed,
      publishRepo: repo,
      publishSha: published.sha,
      publishError: published.error,
      prOpened: pr.opened,
      prUrl: pr.url,
      prError: pr.error,
    });
  }

  return {
    repo,
    steps,
    memoryGen: steps.at(-1)?.generation ?? 0,
  };
}

function verifyGeneration(
  verify: typeof verifyDashboardGeneration,
  result: ApplyImprovementResult,
): VerifyVerdict {
  return verify({
    patchCss: readFileSync(result.patchPath, "utf8"),
    feedJson: readFileSync(result.path, "utf8"),
    memory: result.memory,
  });
}

async function maybePublish(
  publish: typeof publishDashboardToMain,
  options: DashboardAgentOptions,
  repo: string,
  result: ApplyImprovementResult,
): Promise<{ committed: boolean; sha: string | null; error: string | null }> {
  if (!options.publish) {
    return { committed: false, sha: null, error: null };
  }
  try {
    const published: PublishDashboardResult = await publish({
      repoRoot: options.repoRoot,
      repo,
      generation: result.generation.generation,
      title: result.item.title,
      dryRun: options.dryRun === true,
    });
    return { committed: published.committed, sha: published.sha, error: null };
  } catch (err) {
    const message = err instanceof Error ? err.message : "publish failed";
    return { committed: false, sha: null, error: message };
  }
}

async function maybeOpenPr(
  options: DashboardAgentOptions,
  repo: string,
  result: ApplyImprovementResult,
): Promise<UiPrResult> {
  const skipped: UiPrResult = {
    opened: false,
    number: null,
    url: null,
    branch: "",
    path: "",
    sha: null,
    error: null,
  };
  const prFlag: { pr?: boolean; dryRun?: boolean } = {};
  if (options.pr === true) prFlag.pr = true;
  if (options.dryRun === true) prFlag.dryRun = true;
  if (!shouldOpenUiPr(prFlag)) {
    return skipped;
  }
  const open = options.openPr ?? openDashboardUiPr;
  try {
    return await open(result, { repo, dryRun: options.dryRun === true });
  } catch (err) {
    const message = err instanceof Error ? err.message : "open UI PR failed";
    return { ...skipped, error: message };
  }
}
