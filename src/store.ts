import { mkdirSync, readFileSync, readdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { HandoffError, PlanValidationError } from "./errors.ts";
import { parseJsonObject, type JsonObject } from "./json.ts";
import type { Handoff, IsolatedContext, Plan, RunEvent, RunState } from "./types.ts";
import { parseHandoff, parsePlan, parseState } from "./validate.ts";

export interface WorkspacePaths {
  root: string;
  plan: string;
  state: string;
  handoffs: string;
  nodes: string;
  attention: string;
}

export function workspacePaths(root: string): WorkspacePaths {
  return {
    root,
    plan: join(root, "plan.json"),
    state: join(root, "state.json"),
    handoffs: join(root, "handoffs"),
    nodes: join(root, "nodes"),
    attention: join(root, "attention.log"),
  };
}

export function ensureWorkspace(root: string): WorkspacePaths {
  const paths = workspacePaths(root);
  mkdirSync(paths.handoffs, { recursive: true });
  mkdirSync(paths.nodes, { recursive: true });
  return paths;
}

export function writeJson(path: string, value: Plan | RunState | Handoff | IsolatedContext): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

export function readJsonFile(path: string): JsonObject {
  let text: string;
  try {
    text = readFileSync(path, "utf8");
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new PlanValidationError(`cannot read ${path}: ${message}`);
  }
  return parseJsonObject(text, path);
}

export function loadPlan(path: string): Plan {
  return parsePlan(readJsonFile(path), path);
}

export function savePlan(paths: WorkspacePaths, plan: Plan): void {
  writeJson(paths.plan, plan);
}

export function loadState(path: string): RunState {
  return parseState(readJsonFile(path), path);
}

export function saveState(paths: WorkspacePaths, state: RunState): void {
  writeJson(paths.state, state);
}

export function handoffFile(paths: WorkspacePaths, taskName: string, attempt: number): string {
  const suffix = attempt > 1 ? `.attempt-${attempt}` : "";
  return join(paths.handoffs, `${taskName}${suffix}.json`);
}

export function saveHandoff(paths: WorkspacePaths, handoff: Handoff): string {
  const path = handoffFile(paths, handoff.taskName, handoff.attempt);
  writeJson(path, handoff);
  return path;
}

export function loadHandoffFile(path: string): Handoff {
  return parseHandoff(readJsonFile(path), path);
}

export function listHandoffs(paths: WorkspacePaths): Handoff[] {
  const names = readdirSync(paths.handoffs).filter((name) => name.endsWith(".json"));
  return names.map((name) => loadHandoffFile(join(paths.handoffs, name)));
}

export function appendAttention(paths: WorkspacePaths, event: RunEvent): void {
  const line = `${event.at} [${event.kind}] ${event.taskName ?? "-"} ${event.message}\n`;
  writeFileSync(paths.attention, line, { flag: "a" });
}

export function requireHandoff(paths: WorkspacePaths, taskName: string, attempt: number): Handoff {
  try {
    return loadHandoffFile(handoffFile(paths, taskName, attempt));
  } catch {
    throw new HandoffError(`missing handoff for ${taskName} attempt ${attempt}`);
  }
}
