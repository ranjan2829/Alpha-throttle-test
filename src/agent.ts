import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { BurstPlanner, ClaudeClient } from "./claude.ts";
import { parseClaudeGoalSlices } from "./claude.ts";
import { decomposeGoal, type PlanOptions } from "./planner.ts";
import { SAFE_POLICY, type RatePolicy } from "./throttle/types.ts";
import type { Plan } from "./types.ts";

export interface AgentTarget {
  maxPrs: number;
  ratePerSec: number;
  concurrency: number;
  window: "second" | "minute";
}

/**
 * 500 PRs/sec is the measurement wish. Origin HTTP cannot do that.
 * 500 PRs/min (~8.3/s) is the live target this harness actually aims at.
 */
export function resolveAgentTarget(options: {
  perMinute: number | null;
  ratePerSec: number;
  maxPrs: number;
  concurrency: number;
}): AgentTarget {
  if (options.perMinute !== null && options.perMinute > 0) {
    return {
      maxPrs: Math.max(options.maxPrs, options.perMinute),
      ratePerSec: options.perMinute / 60,
      concurrency: Math.max(options.concurrency, 8),
      window: "minute",
    };
  }
  return {
    maxPrs: options.maxPrs,
    ratePerSec: options.ratePerSec,
    concurrency: options.concurrency,
    window: "second",
  };
}

export function policyForAgentTarget(
  target: AgentTarget,
  at: string,
  live: boolean,
  burstAll = false,
): RatePolicy {
  const burst = burstAll ? target.maxPrs : target.ratePerSec;
  return {
    ...SAFE_POLICY,
    targetRatePerSec: target.ratePerSec,
    currentRatePerSec: burst,
    concurrency: target.concurrency,
    maxPrsPerRun: target.maxPrs,
    maxOpenPrs: Math.max(SAFE_POLICY.maxOpenPrs, target.maxPrs, target.concurrency),
    maxRatePerSec: Math.max(SAFE_POLICY.maxRatePerSec, target.ratePerSec, burst),
    lastUpdated: at,
    reason: live ? "recursive agent --live" : "recursive agent dry-run",
  };
}

export async function decomposeGoalMaybeClaude(
  options: PlanOptions & { claude: ClaudeClient | null },
): Promise<Plan> {
  if (!options.claude) {
    return decomposeGoal(options);
  }
  try {
    const text = await options.claude.complete(
      "You are the root planner of a recursive agent. Reply with JSON only.",
      [
        `Goal: ${options.goal}`,
        `depth=${options.depth} maxDepth=${options.bounds.maxDepth}`,
        "Split the goal into independent slices a child planner or worker can own.",
        'Return {"slices":["...","..."]}. Prefer 2-6 slices. Do not invent extra product scope.',
      ].join("\n"),
    );
    const slices = parseClaudeGoalSlices(text);
    const numbered = slices.map((slice, index) => `${index + 1}. ${slice}`).join("\n");
    return decomposeGoal({ ...options, goal: numbered });
  } catch {
    return decomposeGoal(options);
  }
}

export function writeAgentTree(
  workspace: string,
  tree: {
    planner: BurstPlanner;
    depth: number;
    maxDepth: number;
    tickets: number;
    note: string;
  },
): string {
  mkdirSync(workspace, { recursive: true });
  const path = join(workspace, "agent-tree.json");
  writeFileSync(path, `${JSON.stringify(tree, null, 2)}\n`, "utf8");
  return path;
}
