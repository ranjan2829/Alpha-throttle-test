#!/usr/bin/env tsx
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { PlanValidationError } from "./errors.ts";
import { renderTree, runOrchestrator } from "./orchestrator.ts";
import { decomposeGoal } from "./planner.ts";
import { ensureWorkspace, loadPlan, loadState, savePlan, workspacePaths } from "./store.ts";
import { DEFAULT_BOUNDS, type AdapterKind, type Bounds } from "./types.ts";

interface CliArgs {
  command: string;
  positionals: string[];
  flags: Map<string, string>;
  switches: Set<string>;
}

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

function intFlag(args: CliArgs, name: string, fallback: number): number {
  const raw = args.flags.get(name);
  if (raw === undefined) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value) || value < 0) {
    throw new PlanValidationError(`--${name} must be a non-negative integer`);
  }
  return value;
}

function requiredFlag(args: CliArgs, name: string): string | undefined {
  return args.flags.get(name);
}

function parseArgs(argv: string[]): CliArgs {
  const [command = "", ...rest] = argv;
  const flags = new Map<string, string>();
  const switches = new Set<string>();
  const positionals: string[] = [];
  for (let i = 0; i < rest.length; i += 1) {
    const token = rest[i];
    if (!token) continue;
    if (token.startsWith("--")) {
      const key = token.slice(2);
      const next = rest[i + 1];
      if (next === undefined || next.startsWith("--")) {
        switches.add(key);
      } else {
        flags.set(key, next);
        i += 1;
      }
    } else {
      positionals.push(token);
    }
  }
  return { command, positionals, flags, switches };
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

Adapters:
  local   run the leaf runner against isolated node directories (default; used by smoke)
  files   write node briefs and wait for each child to write handoff.json
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
