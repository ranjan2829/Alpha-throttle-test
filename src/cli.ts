#!/usr/bin/env tsx
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { decomposeGoalMaybeClaude, policyForAgentTarget, resolveAgentTarget, writeAgentTree } from "./agent.ts";
import { floatFlag, intFlag, parseArgs, type CliArgs } from "./args.ts";
import { createClaudeClient, loadDotEnv, readClaudeApiKey } from "./claude.ts";
import { PlanValidationError } from "./errors.ts";
import { renderTree, runOrchestrator } from "./orchestrator.ts";
import { decomposeGoal } from "./planner.ts";
import { ensureWorkspace, loadPlan, loadState, savePlan, workspacePaths } from "./store.ts";
import { createDryRunAdapter, createLiveAdapter, systemClock } from "./throttle/adapter.ts";
import { DEFAULT_GITHUB_MIRROR, DEFAULT_ORIGIN_REPO, parseForgeFlag, parseRepoSlug } from "./throttle/forge.ts";
import { runOriginHost } from "./throttle/host.ts";
import { runThrottleLoop } from "./throttle/loop.ts";
import { finishOpenOriginChanges } from "./throttle/finish.ts";
import { addCursorOriginRemote, originAuthStatus, originSetupText } from "./throttle/origin-cli.ts";
import { EXTREME_UNTIL_MERGED, LIVE_DEFAULT_MAX, SAFE_POLICY } from "./throttle/types.ts";
import { DEFAULT_BOUNDS, type AdapterKind, type Bounds } from "./types.ts";

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
  loadDotEnv();
  const args = parseArgs(argv);
  switch (args.command) {
    case "run":
      return commandRun(args);
    case "plan":
      return commandPlan(args);
    case "status":
      return commandStatus(args);
    case "tree":
      return commandTree(args);
    case "smoke":
      return commandSmoke(args);
    case "throttle":
      return commandThrottle(args);
    case "agent":
      return commandAgent(args);
    case "origin-setup":
      return commandOriginSetup(args);
    case "origin-finish":
      return commandOriginFinish(args);
    case "help":
    case "--help":
    case "-h":
    case "":
      printHelp();
      return 0;
    default:
      console.error(`unknown command: ${args.command}`);
      printHelp();
      return 2;
  }
}

async function commandRun(args: CliArgs): Promise<number> {
  const goal = requiredFlag(args, "goal") ?? args.positionals[0];
  if (!goal) {
    throw new PlanValidationError("run requires --goal");
  }
  const bounds = boundsFromArgs(args);
  const workspace = args.flags.get("workspace") ?? defaultWorkspace(goal);
  const adapter = (args.flags.get("adapter") ?? "local") as AdapterKind;
  if (adapter !== "local" && adapter !== "files") {
    throw new PlanValidationError("--adapter must be local | files");
  }
  const depth = intFlag(args, "depth", 0);
  const claude = claudeFromArgs(args);
  const plan = await decomposeGoalMaybeClaude({
    goal,
    bounds,
    depth,
    parentName: null,
    claude,
  });
  const result = await runOrchestrator({
    goal,
    workspace,
    bounds,
    adapter,
    depth,
    plan,
  });
  process.stdout.write(renderTree(result.state));
  process.stdout.write(`stopped: ${result.stoppedReason}\nworkspace: ${workspace}\n`);
  return result.stoppedReason === "done" ? 0 : 1;
}

function commandPlan(args: CliArgs): number {
  const goal = requiredFlag(args, "goal") ?? args.positionals[0];
  if (!goal) {
    throw new PlanValidationError("plan requires --goal");
  }
  const bounds = boundsFromArgs(args);
  const workspace = args.flags.get("workspace") ?? defaultWorkspace(goal);
  const paths = ensureWorkspace(workspace);
  const plan = decomposeGoal({
    goal,
    bounds,
    depth: intFlag(args, "depth", 0),
    parentName: null,
  });
  savePlan(paths, plan);
  process.stdout.write(`${JSON.stringify(plan, null, 2)}\n`);
  process.stdout.write(`wrote ${paths.plan}\n`);
  return 0;
}

function commandStatus(args: CliArgs): number {
  const workspace = args.flags.get("workspace") ?? args.positionals[0];
  if (!workspace) {
    throw new PlanValidationError("status requires --workspace");
  }
  const paths = workspacePaths(workspace);
  const plan = loadPlan(paths.plan);
  const state = loadState(paths.state);
  process.stdout.write(`${plan.summary}\n`);
  process.stdout.write(renderTree(state));
  return 0;
}

function commandTree(args: CliArgs): number {
  return commandStatus(args);
}

async function commandSmoke(args: CliArgs): Promise<number> {
  const root = args.flags.get("workspace") ?? join(process.cwd(), ".alpha", "smoke");
  const keep = args.switches.has("keep");
  mkdirSync(root, { recursive: true });

  const happyDir = join(root, "happy");
  const happy = await runOrchestrator({
    goal: "Write a hello artifact",
    workspace: happyDir,
    bounds: { maxDepth: 2, maxConcurrentChildren: 2, maxResawnsPerTask: 1 },
    adapter: "local",
    depth: 0,
  });

  const retryDir = join(root, "retry");
  const retry = await runOrchestrator({
    goal: "Write a hello artifact [fail-first]",
    workspace: retryDir,
    bounds: { maxDepth: 2, maxConcurrentChildren: 2, maxResawnsPerTask: 2 },
    adapter: "local",
    depth: 0,
  });

  const report = {
    happy: {
      stopped: happy.stoppedReason,
      tasks: happy.state.tasks.map((row) => ({ name: row.name, status: row.status, attempt: row.attempt })),
      handoffs: happy.handoffs.map((item) => item.taskName),
      peakConcurrency: happy.state.peakConcurrency,
    },
    retry: {
      stopped: retry.stoppedReason,
      tasks: retry.state.tasks.map((row) => ({ name: row.name, status: row.status, attempt: row.attempt })),
      handoffs: retry.handoffs.map((item) => item.taskName),
      peakConcurrency: retry.state.peakConcurrency,
    },
  };
  writeFileSync(join(root, "smoke-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);

  const happyOk = happy.stoppedReason === "done" && happy.handoffs.length >= 2;
  const retryWorker = retry.state.tasks.find((row) => row.type === "worker");
  const retryOk =
    retry.stoppedReason === "done" &&
    (retryWorker?.attempt ?? 0) >= 2 &&
    retry.handoffs.some((item) => item.verdict === "reject") &&
    retry.handoffs.some((item) => item.verdict === "accept");

  if (!keep) {
    process.stdout.write(`smoke workspace: ${root}\n`);
  }
  if (!happyOk || !retryOk) {
    process.stderr.write("smoke failed\n");
    return 1;
  }
  process.stdout.write("smoke ok: plan → spawn → handoff → verify (plus reject/respawn)\n");
  return 0;
}

async function commandAgent(args: CliArgs): Promise<number> {
  return commandThrottle(args, { agent: true });
}

async function commandThrottle(args: CliArgs, mode: { agent: boolean } = { agent: false }): Promise<number> {
  const live = args.switches.has("live");
  const fast = args.switches.has("fast");
  const workspace =
    args.flags.get("workspace") ?? join(process.cwd(), ".alpha", mode.agent ? "agent" : "throttle");
  const maxDefault = live ? LIVE_DEFAULT_MAX : SAFE_POLICY.maxPrsPerRun;
  const maxPrsPerRun = args.flags.has("max") ? intFlag(args, "max", maxDefault) : maxDefault;
  const rate = args.flags.has("rate")
    ? floatFlag(args, "rate", SAFE_POLICY.currentRatePerSec)
    : SAFE_POLICY.currentRatePerSec;
  const perMinute = args.flags.has("per-minute") ? intFlag(args, "per-minute", 0) : null;
  const untilMerged = args.flags.has("until-merged") ? intFlag(args, "until-merged", 0) : null;
  const extreme = untilMerged !== null && untilMerged >= 10_000;
  const concurrency = args.flags.has("concurrency")
    ? intFlag(args, "concurrency", SAFE_POLICY.concurrency)
    : mode.agent && live && extreme
      ? 32
      : SAFE_POLICY.concurrency;
  const chunk = args.flags.has("chunk")
    ? intFlag(args, "chunk", 200)
    : untilMerged !== null && untilMerged > 0
      ? extreme
        ? 400
        : 200
      : 0;
  const target = resolveAgentTarget({
    perMinute,
    ratePerSec: rate,
    maxPrs:
      untilMerged !== null && untilMerged > 0
        ? Math.max(maxPrsPerRun, untilMerged * 3)
        : maxPrsPerRun,
    concurrency,
  });
  const maxEpisodes = args.flags.has("episodes")
    ? intFlag(args, "episodes", live ? 1 : 3)
    : untilMerged !== null && untilMerged > 0
      ? Math.max(50, Math.ceil((untilMerged * 3) / Math.max(chunk, 1)))
      : live
        ? 1
        : 3;
  const clock = systemClock();
  const burstAll = (mode.agent || perMinute !== null) && (untilMerged === null || untilMerged <= 0);
  const policy = policyForAgentTarget(target, clock.now(), live, burstAll);
  if (untilMerged !== null && untilMerged > 0 && chunk > 0) {
    policy.currentRatePerSec = chunk;
    policy.maxOpenPrs = Math.max(policy.maxOpenPrs, chunk, target.concurrency);
    policy.maxPrsPerRun = target.maxPrs;
    policy.reason = live ? "until-merged live" : "until-merged dry-run";
  }
  const forge = parseForgeFlag(args.flags.get("forge"));
  const repoFlag = args.flags.get("repo") ?? process.env.ALPHA_THROTTLE_REPO ?? DEFAULT_ORIGIN_REPO;
  const forgeRepo = parseRepoSlug(repoFlag, forge);
  if (live && forgeRepo.forge === "origin") {
    addCursorOriginRemote(process.cwd(), forgeRepo);
    const auth = originAuthStatus();
    if (!auth.ok) {
      process.stderr.write(`${auth.detail}\n\n${originSetupText(forgeRepo.slug)}`);
      return 2;
    }
  }
  const merge = live && !args.switches.has("no-merge");
  const skipChecks = fast || args.switches.has("skip-checks") || (live && forgeRepo.forge === "origin");
  const trustMerge = fast || args.switches.has("trust-merge") || (live && forgeRepo.forge === "origin");
  const mergeConcurrency = intFlag(
    args,
    "merge-concurrency",
    mode.agent && live ? Math.max(8, target.concurrency) : 1,
  );
  const sweep =
    live && merge && untilMerged !== null && untilMerged > 0
      ? async () => {
          const finished = await finishOpenOriginChanges({
            repoDir: process.cwd(),
            repo: forgeRepo.slug,
            limit: Math.max(chunk * 2, 200),
            concurrency: Math.max(8, Math.min(24, mergeConcurrency)),
            skipChecks,
          });
          return finished.merged;
        }
      : undefined;
  const adapter = live
    ? createLiveAdapter({
        clock,
        repoDir: process.cwd(),
        forgeRepo,
        baseBranch: args.flags.get("base") ?? "main",
        merge,
        mergeConcurrency,
        skipChecks,
        trustMerge,
      })
    : createDryRunAdapter({
        clock,
        throttleAfter: intFlag(args, "throttle-after", 0),
        latencyMs: intFlag(args, "latency-ms", 0),
      });

  const claude = fast ? null : claudeFromArgs(args);
  if (mode.agent && live && !fast && !claude) {
    process.stderr.write("live agent requires ANTHROPIC_API_KEY (or pass --fast)\n");
    return 2;
  }
  const planner = claude ? "claude" : "deterministic";
  if (mode.agent) {
    writeAgentTree(workspace, {
      planner,
      depth: 0,
      maxDepth: intFlag(args, "max-depth", 3),
      tickets: target.maxPrs,
      note: claude
        ? "Claude splits each burst; leaf workers open unique Origin PRs and merge."
        : fast
          ? "--fast: deterministic split, no Claude."
          : "No ANTHROPIC_API_KEY yet. Same recursive split, deterministic planner. Paste the key and rerun.",
    });
  }

  const label = mode.agent ? "recursive agent" : "throttle";
  if (live) {
    process.stdout.write(
      `LIVE ${label} (${forgeRepo.forge} ${forgeRepo.slug}): planner=${planner} max=${target.maxPrs} untilMerged=${untilMerged ?? "off"} chunk=${chunk || "off"} rate=${target.ratePerSec}/s concurrency=${target.concurrency} mergeConcurrency=${mergeConcurrency} window=${target.window}\n`,
    );
  } else {
    process.stdout.write(
      `dry-run ${label}: planner=${planner} max=${target.maxPrs} rate=${target.ratePerSec}/s concurrency=${target.concurrency}\n`,
    );
  }

  const result = await runThrottleLoop({
    workspace,
    adapter,
    clock,
    policy,
    maxPrsPerRun: target.maxPrs,
    maxEpisodes,
    maxDepth: intFlag(args, "max-depth", 3),
    live,
    claude,
    ...(untilMerged !== null && untilMerged > 0 ? { untilMerged } : {}),
    ...(chunk > 0 ? { chunk } : {}),
    ...(sweep ? { sweep } : {}),
    compact: fast || extreme,
  });
  const compact = result.outcomes.length >= 100;
  const report = {
    adapter: adapter.kind,
    forge: live ? forgeRepo : { forge: "dry-run", slug: forgeRepo.slug },
    untilMerged,
    merged: result.merged,
    sweptMerged: result.sweptMerged,
    openedOrDry: result.openedOrDry,
    attempted: result.outcomes.length,
    episodes: result.episodes.map((episode) => ({
      id: episode.id,
      burst: episode.plannedBurst,
      stats: episode.stats,
      rateBefore: episode.policyBefore.currentRatePerSec,
      rateAfter: episode.policyAfter.currentRatePerSec,
      reason: episode.policyAfter.reason,
    })),
    policy: result.policy,
    outcomes: compact
      ? undefined
      : result.outcomes.map((item) => ({
          ticketId: item.ticketId,
          status: item.status,
          httpStatus: item.httpStatus,
          prUrl: item.prUrl,
          latencyMs: item.latencyMs,
          mergeMs: item.mergeMs,
          checkStatus: item.checkStatus,
          checkCount: item.checkCount,
        })),
    statusCounts: {
      merged: result.outcomes.filter((item) => item.status === "merged").length,
      opened: result.outcomes.filter((item) => item.status === "opened").length,
      dryRun: result.outcomes.filter((item) => item.status === "dry-run").length,
      error: result.outcomes.filter((item) => item.status === "error").length,
      throttled: result.outcomes.filter((item) => item.status === "throttled").length,
      rejected: result.outcomes.filter((item) => item.status === "rejected").length,
    },
  };
  writeFileSync(join(workspace, "throttle-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`workspace: ${workspace}\n`);
  return untilMerged !== null && untilMerged > 0 && result.merged < untilMerged ? 1 : 0;
}

async function commandOriginFinish(args: CliArgs): Promise<number> {
  const repo = args.flags.get("repo") ?? process.env.ALPHA_THROTTLE_REPO ?? "allocations/Alpha-throttle-test";
  const result = await finishOpenOriginChanges({
    repoDir: process.cwd(),
    repo,
    limit: intFlag(args, "limit", 100),
    concurrency: intFlag(args, "concurrency", 10),
  });
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  return result.errors > 0 || result.buildFailed > 0 ? 1 : 0;
}

function commandOriginSetup(args: CliArgs): number {
  const originSlug = args.flags.get("repo") ?? DEFAULT_ORIGIN_REPO;
  const githubSlug = args.flags.get("github") ?? DEFAULT_GITHUB_MIRROR;
  const push = !args.switches.has("no-push");
  const result = runOriginHost({
    repoDir: process.cwd(),
    originSlug,
    githubSlug,
    push,
  });
  process.stdout.write(result.text);
  return result.ok ? 0 : 2;
}

function boundsFromArgs(args: CliArgs): Bounds {
  return {
    maxDepth: intFlag(args, "max-depth", DEFAULT_BOUNDS.maxDepth),
    maxConcurrentChildren: intFlag(args, "max-concurrency", DEFAULT_BOUNDS.maxConcurrentChildren),
    maxResawnsPerTask: intFlag(args, "max-respawns", DEFAULT_BOUNDS.maxResawnsPerTask),
  };
}

function defaultWorkspace(goal: string): string {
  const slug = goal.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 32) || "goal";
  return join(process.cwd(), ".alpha", slug);
}

function requiredFlag(args: CliArgs, name: string): string | undefined {
  return args.flags.get(name);
}

function claudeFromArgs(args: CliArgs) {
  const key = args.flags.get("api-key") ?? readClaudeApiKey();
  if (args.switches.has("claude") && !key) {
    throw new PlanValidationError("set ANTHROPIC_API_KEY or pass --api-key");
  }
  if (!key) return null;
  return createClaudeClient(key);
}

function printHelp(): void {
  process.stdout.write(`alpha-orch — recursive planner → worker → verifier agent

Usage:
  npx tsx src/cli.ts run --goal "<goal>" [--workspace .alpha/my-goal]
      [--max-depth 3] [--max-concurrency 3] [--max-respawns 2]
      [--adapter local|files] [--claude]
  npx tsx src/cli.ts plan --goal "<goal>" --workspace .alpha/my-goal
  npx tsx src/cli.ts tree --workspace .alpha/my-goal
  npx tsx src/cli.ts smoke
  npx tsx src/cli.ts agent [--live] [--fast] [--per-minute 500] [--max 500]
      [--until-merged 100000] [--chunk 400]
      [--concurrency 32] [--forge origin]
      [--repo allocations/Alpha-throttle-test]
  npx tsx src/cli.ts throttle [--workspace .alpha/throttle]
      [--rate 2] [--max 8] [--concurrency 2] [--episodes 3]
      [--throttle-after 0]
  npx tsx src/cli.ts origin-setup [--repo ranjan-rgb/Alpha-throttle-test]
      [--github ranjan2829/Alpha-throttle-test] [--no-push]
  npx tsx src/cli.ts origin-finish [--repo allocations/Alpha-throttle-test]
      [--limit 100] [--concurrency 10]
  npx tsx src/cli.ts throttle --live --max 3 --rate 1 --forge origin
      [--repo allocations/Alpha-throttle-test] [--no-merge]

Recursive agent (Origin throttle test):
  export ANTHROPIC_API_KEY=sk-...
  npx tsx src/cli.ts agent --live --until-merged ${EXTREME_UNTIL_MERGED} --chunk 400 \\
      --concurrency 32 --forge origin --repo allocations/Alpha-throttle-test

Claude is the planner when ANTHROPIC_API_KEY is set. Live agent requires
the key unless you pass --fast (deterministic split only). Each split is
appended to claude-splits.jsonl. Leaves open one unique-file PR then
merge-commit (not squash). 500/sec is not possible over Origin HTTP.
--until-merged ${EXTREME_UNTIL_MERGED} keeps chunking until that many PRs merge.
A rerun of the same --workspace resumes from progress.json.

Throttle defaults are SAFE (dry-run). --live opens real Origin changes
and caps --max at 3 unless you pass --max or --per-minute.

Adapters:
  local   run the leaf runner against isolated node directories (default; used by smoke)
  files   write node briefs and wait for each child to write handoff.json
  dry-run throttle adapter (default) never opens PRs
  live    throttle adapter requires --live
`);
}

const executedDirectly = process.argv[1]?.endsWith("cli.ts") === true;
if (executedDirectly) {
  main().then(
    (code) => {
      process.exitCode = code;
    },
    (err) => {
      const message = err instanceof Error ? err.message : "cli failed";
      process.stderr.write(`${message}\n`);
      process.exitCode = 1;
    },
  );
}
