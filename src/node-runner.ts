#!/usr/bin/env tsx
import { writeFileSync } from "node:fs";
import { join } from "node:path";

import { executeIsolatedNode } from "./executors.ts";
import { isJsonObject, requireStringArray, type JsonObject, type JsonValue } from "./json.ts";
import { readJsonFile } from "./store.ts";
import type { Handoff, IsolatedContext, PlanTask } from "./types.ts";
import { parseHandoff, parsePlanTask } from "./validate.ts";

function parseHandoffList(value: JsonValue | undefined, label: string): Handoff[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array`);
  }
  return value.map((item, index) => {
    if (!isJsonObject(item)) {
      throw new Error(`${label}[${index}] must be an object`);
    }
    return parseHandoff(item, `${label}[${index}]`);
  });
}

function parseOptionalHandoff(value: JsonValue | undefined, label: string): Handoff | null {
  if (value === undefined || value === null) return null;
  if (!isJsonObject(value)) {
    throw new Error(`${label} must be an object or null`);
  }
  return parseHandoff(value, label);
}

export function parseIsolatedContext(raw: JsonObject): IsolatedContext {
  if (!isJsonObject(raw.task)) {
    throw new Error("context.json is missing task");
  }
  const task: PlanTask = parsePlanTask(raw.task, 0);
  if (typeof raw.depth !== "number" || typeof raw.attempt !== "number") {
    throw new Error("context.json is missing depth/attempt");
  }
  if (typeof raw.parentGoal !== "string") {
    throw new Error("context.json is missing parentGoal");
  }
  return {
    task,
    depth: raw.depth,
    attempt: raw.attempt,
    parentGoal: raw.parentGoal,
    acceptance: raw.acceptance === undefined ? task.acceptance : requireStringArray(raw, "acceptance"),
    upstreamHandoffs: parseHandoffList(raw.upstreamHandoffs, "upstreamHandoffs"),
    verifyTarget: parseOptionalHandoff(raw.verifyTarget, "verifyTarget"),
  };
}

function main(): void {
  const dirFlag = process.argv.indexOf("--dir");
  const dir = dirFlag >= 0 ? process.argv[dirFlag + 1] : process.cwd();
  if (!dir) {
    throw new Error("missing --dir");
  }
  const context = parseIsolatedContext(readJsonFile(join(dir, "context.json")));
  if (context.task.type === "subplanner") {
    throw new Error("node-runner cannot execute subplanners");
  }
  const handoff = executeIsolatedNode(context, dir);
  writeFileSync(join(dir, "handoff.json"), `${JSON.stringify(handoff, null, 2)}\n`, "utf8");
}

const executedDirectly = process.argv[1]?.endsWith("node-runner.ts") === true;
if (executedDirectly) {
  main();
}
