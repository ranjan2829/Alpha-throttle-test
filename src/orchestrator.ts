import { existsSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { BoundError } from "./errors.ts";
import { executeIsolatedNode } from "./executors.ts";
import { buildContext, writeIsolatedContext } from "./isolation.ts";
import { decomposeGoal } from "./planner.ts";
import {
  appendAttention,
  ensureWorkspace,
  loadHandoffFile,
  saveHandoff,
  savePlan,
  saveState,
  type WorkspacePaths,
} from "./store.ts";
import type {
  AdapterKind,
  Bounds,
  Handoff,
  IsolatedContext,
  Plan,
  PlanTask,
  RunEvent,
  RunState,
  TaskState,
} from "./types.ts";
import { DEFAULT_BOUNDS } from "./types.ts";
import { normalizedDependsOn } from "./validate.ts";

const DEFAULT_FILE_WAIT_MS = 8_000;
const POLL_MS = 25;

export interface RunOptions {
  goal: string;
  workspace: string;
  bounds?: Bounds;
  depth?: number;
  adapter?: AdapterKind;
  plan?: Plan;
  fileWaitMs?: number;
  now?: () => string;
}

export interface RunResult {
  plan: Plan;
  state: RunState;
  handoffs: Handoff[];
  stoppedReason: "done" | "cap-hit" | "blocked" | "error";
}

export async function runOrchestrator(options: RunOptions): Promise<RunResult> {
  const bounds = options.bounds ?? DEFAULT_BOUNDS;
  const depth = options.depth ?? 0;
  const adapter = options.adapter ?? "local";
  const now = options.now ?? (() => new Date().toISOString());
  const paths = ensureWorkspace(options.workspace);

  if (depth > bounds.maxDepth) {
    throw new BoundError("depth", `orchestrator depth ${depth} exceeds maxDepth ${bounds.maxDepth}`);
  }

  const plan =
    options.plan ??
    decomposeGoal({
      goal: options.goal,
      bounds,
      depth,
      parentName: null,
    });
  plan.bounds = bounds;
  savePlan(paths, plan);

  const state = emptyState(plan, depth, adapter, bounds);
  record(paths, state, now, "plan", null, `published ${plan.tasks.length} tasks`);

  const byName = new Map(plan.tasks.map((task) => [task.name, task]));
  for (const task of plan.tasks) {
    state.tasks.push(emptyTaskState(task, depth + 1));
  }

  const maxTicks = Math.max(8, state.tasks.length * (bounds.maxResawnsPerTask + 3) * 4);
  const running = new Map<string, Promise<void>>();
  const collected: Handoff[] = [];

  for (let tick = 0; tick < maxTicks; tick += 1) {
    maybeRespawn(paths, state, plan, bounds, now);

    const ready = readyTasks(state, plan).filter((row) => {
      if (running.has(row.name)) return false;
      return row.status === "pending";
    });

    for (const row of ready) {
      if (running.size >= bounds.maxConcurrentChildren) {
        record(paths, state, now, "bound", row.name, "concurrency gate; waiting for a slot");
        break;
      }
      if (row.depth > bounds.maxDepth) {
        row.status = "cap-hit";
        row.note = `depth ${row.depth} > maxDepth ${bounds.maxDepth}`;
        row.finishedAt = now();
        record(paths, state, now, "cap-hit", row.name, row.note);
        continue;
      }
      const task = byName.get(row.name);
      if (!task) continue;
      running.set(
        row.name,
        spawnOne({
          adapter,
          bounds,
          collected,
          fileWaitMs: options.fileWaitMs ?? DEFAULT_FILE_WAIT_MS,
          now,
          paths,
          plan,
          row,
          state,
          task,
        }).finally(() => {
          running.delete(row.name);
        }),
      );
      state.peakConcurrency = Math.max(state.peakConcurrency, running.size);
    }

    saveState(paths, state);
    if (running.size > 0) {
      await Promise.race(running.values());
      continue;
    }

    if (ready.length === 0) {
      break;
    }
  }

  const stoppedReason = conclude(state);
  plan.done = stoppedReason === "done";
  savePlan(paths, plan);
  saveState(paths, state);
  record(paths, state, now, "stop", null, stoppedReason);
  return { plan, state, handoffs: collected, stoppedReason };
}

async function spawnOne(args: {
  adapter: AdapterKind;
  bounds: Bounds;
  collected: Handoff[];
  fileWaitMs: number;
  now: () => string;
  paths: WorkspacePaths;
  plan: Plan;
  row: TaskState;
  state: RunState;
  task: PlanTask;
}): Promise<void> {
  const { adapter, bounds, collected, fileWaitMs, now, paths, plan, row, state, task } = args;
  row.status = "running";
  row.startedAt = now();
  row.note = null;

  const upstream = upstreamHandoffs(state, plan, task);
  const verifyTarget =
    task.type === "verifier" && task.verifies ? latestHandoff(state, task.verifies) : null;
  const context = buildContext({
    task,
    depth: row.depth,
    attempt: row.attempt,
    parentGoal: plan.goal,
    upstreamHandoffs: upstream,
    verifyTarget,
  });
  const spawn = writeIsolatedContext(paths, context);
  row.isolationDir = spawn.isolationDir;
  record(paths, state, now, "spawn", task.name, `${task.type} attempt ${row.attempt} dir=${spawn.isolationDir}`);
  saveState(paths, state);

  try {
    const handoff = await runNode({
      adapter,
      bounds,
      context,
      isolationDir: spawn.isolationDir,
      fileWaitMs,
      plan,
    });
    const stored = persistHandoff(paths, spawn.isolationDir, handoff);
    collected.push(stored);
    applyHandoff(row, stored, now());
    record(paths, state, now, "handoff", task.name, `${stored.status}${stored.verdict ? `/${stored.verdict}` : ""}`);
    if (stored.verdict === "reject" && task.verifies) {
      const target = state.tasks.find((item) => item.name === task.verifies);
      if (target) {
        target.status = "rejected";
        target.note = stored.rejectReason ?? "verifier rejected";
        record(paths, state, now, "reject", target.name, target.note);
      }
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    row.status = err instanceof BoundError ? "cap-hit" : "error";
    row.finishedAt = now();
    row.note = message;
    record(paths, state, now, row.status, task.name, message);
  }
}

async function runNode(args: {
  adapter: AdapterKind;
  bounds: Bounds;
  context: IsolatedContext;
  isolationDir: string;
  fileWaitMs: number;
  plan: Plan;
}): Promise<Handoff> {
  const { adapter, bounds, context, isolationDir, fileWaitMs, plan } = args;
  if (context.task.type === "subplanner") {
    return runSubplanner(context, isolationDir, bounds, plan, adapter);
  }
  if (adapter === "files") {
    return waitForFileHandoff(isolationDir, fileWaitMs);
  }
  if (adapter === "local") {
    return runLocalChild(context, isolationDir);
  }
  return executeIsolatedNode(context, isolationDir);
}

async function runLocalChild(context: IsolatedContext, isolationDir: string): Promise<Handoff> {
  const handoff = executeIsolatedNode(context, isolationDir);
  writeFileSync(join(isolationDir, "handoff.json"), `${JSON.stringify(handoff, null, 2)}\n`, "utf8");
  return handoff;
}

async function runSubplanner(
  context: IsolatedContext,
  isolationDir: string,
  bounds: Bounds,
  parentPlan: Plan,
  adapter: AdapterKind,
): Promise<Handoff> {
  const childDepth = context.depth;
  if (childDepth >= bounds.maxDepth) {
    throw new BoundError(
      "depth",
      `subplanner ${context.task.name} has no remaining depth (depth=${childDepth}, maxDepth=${bounds.maxDepth})`,
    );
  }
  const childWorkspace = join(isolationDir, "subtree");
  const result = await runOrchestrator({
    goal: context.task.scopedGoal,
    workspace: childWorkspace,
    bounds,
    depth: childDepth,
    adapter,
    fileWaitMs: 1_000,
  });
  const childHandoffs = result.handoffs.filter((item) => item.type !== "verifier");
  return {
    schemaVersion: 1,
    taskName: context.task.name,
    type: "subplanner",
    status: result.stoppedReason === "done" ? "success" : "partial",
    summary: `subtree ${result.stoppedReason}: ${childHandoffs.map((item) => item.taskName).join(", ") || "empty"}`,
    artifacts: childHandoffs.flatMap((item) => item.artifacts),
    notes: [`parentGoal=${parentPlan.goal}`, `stopped=${result.stoppedReason}`],
    followUps: [],
    attempt: context.attempt,
  };
}

async function waitForFileHandoff(isolationDir: string, timeoutMs: number): Promise<Handoff> {
  const path = join(isolationDir, "handoff.json");
  const start = Date.now();
  while (Date.now() - start < timeoutMs) {
    if (existsSync(path)) {
      return loadHandoffFile(path);
    }
    await sleep(POLL_MS);
  }
  throw new Error(`timed out waiting for ${path} (${timeoutMs}ms)`);
}

function persistHandoff(paths: WorkspacePaths, isolationDir: string, handoff: Handoff): Handoff {
  const resolved: Handoff = {
    ...handoff,
    artifacts: handoff.artifacts.map((artifact) =>
      artifact.startsWith("/") ? artifact : join(isolationDir, artifact),
    ),
  };
  saveHandoff(paths, resolved);
  return resolved;
}

function applyHandoff(row: TaskState, handoff: Handoff, at: string): void {
  row.finishedAt = at;
  row.handoffPath = `${handoff.taskName}${handoff.attempt > 1 ? `.attempt-${handoff.attempt}` : ""}.json`;
  if (handoff.status === "error") {
    row.status = "error";
    row.note = handoff.summary;
    return;
  }
  row.status = "handed-off";
  row.note = handoff.summary;
}

function maybeRespawn(
  paths: WorkspacePaths,
  state: RunState,
  plan: Plan,
  bounds: Bounds,
  now: () => string,
): void {
  for (const row of state.tasks) {
    if (row.status !== "rejected") continue;
    const task = plan.tasks.find((item) => item.name === row.name);
    if (!task || task.type === "verifier") continue;
    const maxAttempts = task.maxAttempts ?? bounds.maxResawnsPerTask + 1;
    if (row.attempt >= maxAttempts) {
      row.status = "cap-hit";
      row.note = `respawn cap: attempt ${row.attempt} >= ${maxAttempts}`;
      record(paths, state, now, "cap-hit", row.name, row.note);
      continue;
    }
    row.attempt += 1;
    row.status = "pending";
    row.startedAt = null;
    row.finishedAt = null;
    row.handoffPath = null;
    row.isolationDir = null;
    row.note = `respawn attempt ${row.attempt}`;
    record(paths, state, now, "respawn", row.name, row.note);
    for (const verifier of plan.tasks.filter((item) => item.verifies === row.name)) {
      const vRow = state.tasks.find((item) => item.name === verifier.name);
      if (!vRow) continue;
      vRow.attempt += 1;
      vRow.status = "pending";
      vRow.startedAt = null;
      vRow.finishedAt = null;
      vRow.handoffPath = null;
      vRow.isolationDir = null;
      vRow.note = `waiting for respawn of ${row.name}`;
    }
  }
}

function readyTasks(state: RunState, plan: Plan): TaskState[] {
  const byName = new Map(state.tasks.map((row) => [row.name, row]));
  return state.tasks.filter((row) => {
    if (row.status !== "pending") return false;
    const task = plan.tasks.find((item) => item.name === row.name);
    if (!task) return false;
    return normalizedDependsOn(task).every((dep) => byName.get(dep)?.status === "handed-off");
  });
}

function upstreamHandoffs(state: RunState, plan: Plan, task: PlanTask): Handoff[] {
  const deps = normalizedDependsOn(task);
  return deps
    .map((name) => latestHandoff(state, name))
    .filter((item): item is Handoff => item !== null);
}

function latestHandoff(state: RunState, taskName: string): Handoff | null {
  const row = state.tasks.find((item) => item.name === taskName);
  if (!row?.isolationDir) return null;
  const attemptPath = join(row.isolationDir, "handoff.json");
  if (!existsSync(attemptPath)) return null;
  const handoff = loadHandoffFile(attemptPath);
  return {
    ...handoff,
    artifacts: handoff.artifacts.map((artifact) =>
      artifact.startsWith("/") ? artifact : join(row.isolationDir ?? "", artifact),
    ),
  };
}

function conclude(state: RunState): RunResult["stoppedReason"] {
  if (state.tasks.some((row) => row.status === "error")) return "error";
  if (state.tasks.some((row) => row.status === "cap-hit")) return "cap-hit";
  if (state.tasks.some((row) => row.status === "rejected")) {
    return "blocked";
  }
  const unfinished = state.tasks.filter(
    (row) => row.status === "pending" || row.status === "running",
  );
  if (unfinished.length > 0) return "blocked";
  const failed = state.tasks.filter((row) => row.status !== "handed-off");
  if (failed.length > 0) return "blocked";
  return "done";
}

function emptyState(plan: Plan, depth: number, adapter: AdapterKind, bounds: Bounds): RunState {
  return {
    rootSlug: plan.rootSlug,
    goal: plan.goal,
    bounds,
    depth,
    adapter,
    peakConcurrency: 0,
    tasks: [],
    events: [],
  };
}

function emptyTaskState(task: PlanTask, depth: number): TaskState {
  return {
    name: task.name,
    type: task.type,
    status: "pending",
    depth,
    attempt: 1,
    isolationDir: null,
    handoffPath: null,
    startedAt: null,
    finishedAt: null,
    parentName: null,
    note: null,
  };
}

function record(
  paths: WorkspacePaths,
  state: RunState,
  now: () => string,
  kind: string,
  taskName: string | null,
  message: string,
): void {
  const event: RunEvent = { at: now(), kind, taskName, message };
  state.events.push(event);
  appendAttention(paths, event);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

export function renderTree(state: RunState): string {
  const lines = [
    `goal: ${state.goal}`,
    `depth: ${state.depth}  maxDepth: ${state.bounds.maxDepth}  maxConcurrent: ${state.bounds.maxConcurrentChildren}`,
    `peakConcurrency: ${state.peakConcurrency}`,
    `tasks:`,
  ];
  for (const row of state.tasks) {
    lines.push(
      `  - ${row.name} [${row.type}] ${row.status} depth=${row.depth} attempt=${row.attempt}${row.note ? ` — ${row.note}` : ""}`,
    );
  }
  return `${lines.join("\n")}\n`;
}
