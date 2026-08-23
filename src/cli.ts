#!/usr/bin/env tsx
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { floatFlag, intFlag, parseArgs, type CliArgs } from "./args.ts";
import { PlanValidationError } from "./errors.ts";
import { renderTree, runOrchestrator } from "./orchestrator.ts";
import { decomposeGoal } from "./planner.ts";
import { ensureWorkspace, loadPlan, loadState, savePlan, workspacePaths } from "./store.ts";
import { createDryRunAdapter, createLiveAdapter, systemClock } from "./throttle/adapter.ts";
import { DEFAULT_GITHUB_MIRROR, DEFAULT_ORIGIN_REPO, parseForgeFlag, parseRepoSlug } from "./throttle/forge.ts";
import { runOriginHost } from "./throttle/host.ts";
import { runThrottleLoop } from "./throttle/loop.ts";
import { addCursorOriginRemote, originAuthStatus, originSetupText } from "./throttle/origin-cli.ts";
import { LIVE_DEFAULT_MAX, SAFE_POLICY } from "./throttle/types.ts";
import { DEFAULT_BOUNDS, type AdapterKind, type Bounds } from "./types.ts";

export async function main(argv: string[] = process.argv.slice(2)): Promise<number> {
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
    case "origin-setup":
      return commandOriginSetup(args);
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
  const result = await runOrchestrator({
    goal,
    workspace,
    bounds,
    adapter,
    depth: intFlag(args, "depth", 0),
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

async function commandThrottle(args: CliArgs): Promise<number> {
  const live = args.switches.has("live");
  const workspace = args.flags.get("workspace") ?? join(process.cwd(), ".alpha", "throttle");
  const maxDefault = live ? LIVE_DEFAULT_MAX : SAFE_POLICY.maxPrsPerRun;
  const maxPrsPerRun = args.flags.has("max") ? intFlag(args, "max", maxDefault) : maxDefault;
  const rate = args.flags.has("rate")
    ? floatFlag(args, "rate", SAFE_POLICY.currentRatePerSec)
    : SAFE_POLICY.currentRatePerSec;
  const concurrency = args.flags.has("concurrency")
    ? intFlag(args, "concurrency", SAFE_POLICY.concurrency)
    : SAFE_POLICY.concurrency;
  const maxEpisodes = args.flags.has("episodes")
    ? intFlag(args, "episodes", live ? 1 : 3)
    : live
      ? 1
      : 3;
  const clock = systemClock();
  const policy = {
    ...SAFE_POLICY,
    currentRatePerSec: rate,
    concurrency,
    maxPrsPerRun,
    maxOpenPrs: Math.max(SAFE_POLICY.maxOpenPrs, maxPrsPerRun, concurrency),
    lastUpdated: clock.now(),
    reason: live ? "cli --live" : "cli dry-run",
  };
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
  const adapter = live
    ? createLiveAdapter({
        clock,
        repoDir: process.cwd(),
        forgeRepo,
        baseBranch: args.flags.get("base") ?? "main",
      })
    : createDryRunAdapter({
        clock,
        throttleAfter: intFlag(args, "throttle-after", 0),
        latencyMs: intFlag(args, "latency-ms", 0),
      });

  if (live) {
    process.stdout.write(
      `LIVE throttle (${forgeRepo.forge} ${forgeRepo.slug}): max=${maxPrsPerRun} rate=${rate}/s concurrency=${concurrency} (safe default max is ${LIVE_DEFAULT_MAX} unless --max is set)\n`,
    );
  } else {
    process.stdout.write(`dry-run throttle: max=${maxPrsPerRun} rate=${rate}/s concurrency=${concurrency}\n`);
  }

  const result = await runThrottleLoop({
    workspace,
    adapter,
    clock,
    policy,
    maxPrsPerRun,
    maxEpisodes,
    maxDepth: intFlag(args, "max-depth", 3),
    live,
  });
  const report = {
    adapter: adapter.kind,
    forge: live ? forgeRepo : { forge: "dry-run", slug: forgeRepo.slug },
    openedOrDry: result.openedOrDry,
    episodes: result.episodes.map((episode) => ({
      id: episode.id,
      burst: episode.plannedBurst,
      stats: episode.stats,
      rateBefore: episode.policyBefore.currentRatePerSec,
      rateAfter: episode.policyAfter.currentRatePerSec,
      reason: episode.policyAfter.reason,
    })),
    policy: result.policy,
    outcomes: result.outcomes.map((item) => ({
      ticketId: item.ticketId,
      status: item.status,
      httpStatus: item.httpStatus,
      prUrl: item.prUrl,
      latencyMs: item.latencyMs,
    })),
  };
  writeFileSync(join(workspace, "throttle-report.json"), `${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  process.stdout.write(`workspace: ${workspace}\n`);
  return 0;
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

function printHelp(): void {
  process.stdout.write(`alpha-orch — bounded planner → worker → verifier harness

Usage:
  npx tsx src/cli.ts run --goal "<goal>" [--workspace .alpha/my-goal]
      [--max-depth 3] [--max-concurrency 3] [--max-respawns 2]
      [--adapter local|files]
  npx tsx src/cli.ts plan --goal "<goal>" --workspace .alpha/my-goal
  npx tsx src/cli.ts tree --workspace .alpha/my-goal
  npx tsx src/cli.ts smoke
  npx tsx src/cli.ts throttle [--workspace .alpha/throttle]
      [--rate 2] [--max 8] [--concurrency 2] [--episodes 3]
      [--throttle-after 0]
  npx tsx src/cli.ts origin-setup [--repo ranjan-rgb/Alpha-throttle-test]
      [--github ranjan2829/Alpha-throttle-test] [--no-push]
  npx tsx src/cli.ts throttle --live --max 3 --rate 1 --forge origin
      [--repo ranjan-rgb/Alpha-throttle-test]

Throttle defaults are SAFE (dry-run). --live opens real Origin changes
(--forge origin, default) and caps --max at 3 unless you pass --max.
  npx tsx src/cli.ts throttle --live --rate 1000 --max 50 --concurrency 10 --forge origin

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
