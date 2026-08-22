import { PlanValidationError } from "./errors.ts";
import {
  isJsonObject,
  optionalNullableString,
  optionalString,
  requireArray,
  requireInt,
  requireObject,
  requireString,
  requireStringArray,
  type JsonObject,
  type JsonValue,
} from "./json.ts";
import {
  DEFAULT_BOUNDS,
  TASK_NAME_RE,
  type AdapterKind,
  type Bounds,
  type Handoff,
  type HandoffStatus,
  type Plan,
  type PlanTask,
  type RunEvent,
  type RunState,
  type TaskState,
  type TaskStatus,
  type TaskType,
  type Verdict,
} from "./types.ts";

const TASK_TYPES: ReadonlySet<string> = new Set(["worker", "subplanner", "verifier"]);
const HANDOFF_STATUSES: ReadonlySet<string> = new Set([
  "success",
  "partial",
  "blocked",
  "error",
]);
const VERDICTS: ReadonlySet<string> = new Set(["accept", "reject"]);
const TASK_STATUSES: ReadonlySet<string> = new Set([
  "pending",
  "running",
  "handed-off",
  "rejected",
  "error",
  "cancelled",
  "pruned",
  "cap-hit",
]);
const ADAPTERS: ReadonlySet<string> = new Set(["local", "files"]);

export function parseBounds(value: JsonObject | undefined): Bounds {
  if (value === undefined) return { ...DEFAULT_BOUNDS };
  return {
    maxDepth: requireInt(value, "maxDepth", 1, DEFAULT_BOUNDS.maxDepth),
    maxConcurrentChildren: requireInt(
      value,
      "maxConcurrentChildren",
      1,
      DEFAULT_BOUNDS.maxConcurrentChildren,
    ),
    maxResawnsPerTask: requireInt(
      value,
      "maxResawnsPerTask",
      0,
      DEFAULT_BOUNDS.maxResawnsPerTask,
    ),
  };
}

export function parseTaskType(value: string, label: string): TaskType {
  if (!TASK_TYPES.has(value)) {
    throw new PlanValidationError(`${label} must be worker | subplanner | verifier`);
  }
  return value as TaskType;
}

export function parsePlanTask(value: JsonObject, index: number): PlanTask {
  const name = requireString(value, "name", `tasks[${index}].name`);
  if (!TASK_NAME_RE.test(name)) {
    throw new PlanValidationError(`tasks[${index}].name must be kebab-case ascii`);
  }
  const type = parseTaskType(requireString(value, "type", `tasks[${index}].type`), `tasks[${index}].type`);
  const task: PlanTask = {
    name,
    type,
    scopedGoal: requireString(value, "scopedGoal", `tasks[${index}].scopedGoal`),
    acceptance: requireStringArray(value, "acceptance"),
    dependsOn: requireStringArray(value, "dependsOn"),
  };
  if (type === "verifier") {
    const verifies = requireString(value, "verifies", `tasks[${index}].verifies`);
    if (!TASK_NAME_RE.test(verifies)) {
      throw new PlanValidationError(`tasks[${index}].verifies must be kebab-case`);
    }
    task.verifies = verifies;
  } else if (value.verifies !== undefined) {
    throw new PlanValidationError(`tasks[${index}].verifies is only valid on verifier tasks`);
  }
  if (value.maxAttempts !== undefined) {
    task.maxAttempts = requireInt(value, "maxAttempts", 1);
  }
  return task;
}

export function parsePlan(value: JsonObject, source: string): Plan {
  const version = requireInt(value, "version", 1, 1);
  if (version !== 1) {
    throw new PlanValidationError(`${source} version must be 1`);
  }
  const tasks = requireArray(value, "tasks").map((task, index) => {
    if (!isJsonObject(task)) {
      throw new PlanValidationError(`tasks[${index}] must be an object`);
    }
    return parsePlanTask(task, index);
  });
  const goal = requireString(value, "goal");
  const summary = optionalString(value, "summary");
  const rootSlug = optionalString(value, "rootSlug") ?? slugify(goal);
  const plan: Plan = {
    version: 1,
    goal,
    summary: summary && summary.length > 0 ? summary : goal,
    rootSlug,
    bounds: parseBounds(requireObject(value, "bounds")),
    tasks,
    done: value.done === true,
  };
  if (!TASK_NAME_RE.test(plan.rootSlug)) {
    throw new PlanValidationError("rootSlug must be kebab-case ascii");
  }
  validateTaskGraph(plan.tasks);
  return plan;
}

export function validateTaskGraph(tasks: PlanTask[]): void {
  if (tasks.length === 0) {
    throw new PlanValidationError("tasks must be a non-empty array");
  }
  const names = new Set<string>();
  for (const task of tasks) {
    if (names.has(task.name)) {
      throw new PlanValidationError(`duplicate task name: ${task.name}`);
    }
    names.add(task.name);
  }
  const byName = new Map(tasks.map((task) => [task.name, task]));
  for (const task of tasks) {
    if (task.type === "verifier") {
      if (task.verifies === task.name) {
        throw new PlanValidationError(`${task.name} cannot verify itself`);
      }
      if (task.verifies && !byName.has(task.verifies)) {
        throw new PlanValidationError(`${task.name} verifies unknown task: ${task.verifies}`);
      }
    }
    for (const dep of normalizedDependsOn(task)) {
      if (!names.has(dep)) {
        throw new PlanValidationError(`${task.name} dependsOn unknown task: ${dep}`);
      }
      if (dep === task.name) {
        throw new PlanValidationError(`${task.name} dependsOn itself`);
      }
    }
  }
  detectCycles(tasks);
}

export function normalizedDependsOn(task: PlanTask): string[] {
  const deps = [...task.dependsOn];
  if (task.type === "verifier" && task.verifies && !deps.includes(task.verifies)) {
    deps.unshift(task.verifies);
  }
  return deps;
}

function detectCycles(tasks: PlanTask[]): void {
  const byName = new Map(tasks.map((task) => [task.name, task]));
  const color = new Map<string, "white" | "gray" | "black">(
    tasks.map((task) => [task.name, "white"]),
  );
  const visit = (name: string, path: string[]): void => {
    const current = color.get(name);
    if (current === "gray") {
      const cycle = [...path.slice(path.indexOf(name)), name];
      throw new PlanValidationError(`dependsOn cycle: ${cycle.join(" -> ")}`);
    }
    if (current === "black") return;
    color.set(name, "gray");
    const task = byName.get(name);
    if (task) {
      for (const dep of normalizedDependsOn(task)) {
        if (byName.has(dep)) visit(dep, [...path, name]);
      }
    }
    color.set(name, "black");
  };
  for (const task of tasks) visit(task.name, []);
}

export function parseHandoff(value: JsonObject, source: string): Handoff {
  const statusRaw = requireString(value, "status");
  if (!HANDOFF_STATUSES.has(statusRaw)) {
    throw new PlanValidationError(`${source} status must be success | partial | blocked | error`);
  }
  const handoff: Handoff = {
    schemaVersion: 1,
    taskName: requireString(value, "taskName"),
    type: parseTaskType(requireString(value, "type"), "type"),
    status: statusRaw as HandoffStatus,
    summary: requireString(value, "summary"),
    artifacts: requireStringArray(value, "artifacts"),
    notes: requireStringArray(value, "notes"),
    followUps: requireStringArray(value, "followUps"),
    attempt: requireInt(value, "attempt", 1, 1),
  };
  const verdict = optionalString(value, "verdict");
  if (verdict !== undefined) {
    if (!VERDICTS.has(verdict)) {
      throw new PlanValidationError(`${source} verdict must be accept | reject`);
    }
    handoff.verdict = verdict as Verdict;
  }
  const rejectReason = optionalString(value, "rejectReason");
  if (rejectReason !== undefined) {
    handoff.rejectReason = rejectReason;
  }
  return handoff;
}

export function slugify(text: string): string {
  const slug = text
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 40);
  return TASK_NAME_RE.test(slug) ? slug : "goal";
}

export function parseState(value: JsonObject, source: string): RunState {
  const adapter = requireString(value, "adapter");
  if (!ADAPTERS.has(adapter)) {
    throw new PlanValidationError(`${source} adapter must be local | files`);
  }
  const tasks = requireArray(value, "tasks").map((task, index) => parseTaskState(task, `${source}.tasks[${index}]`));
  const events = requireArray(value, "events").map((event, index) => parseEvent(event, `${source}.events[${index}]`));
  return {
    rootSlug: requireString(value, "rootSlug"),
    goal: requireString(value, "goal"),
    bounds: parseBounds(requireObject(value, "bounds")),
    depth: requireInt(value, "depth", 0),
    adapter: adapter as AdapterKind,
    peakConcurrency: requireInt(value, "peakConcurrency", 0),
    tasks,
    events,
  };
}

function parseTaskState(value: JsonValue, label: string): TaskState {
  if (!isJsonObject(value)) {
    throw new PlanValidationError(`${label} must be an object`);
  }
  const status = requireString(value, "status");
  if (!TASK_STATUSES.has(status)) {
    throw new PlanValidationError(`${label}.status is not a known TaskStatus`);
  }
  const type = parseTaskType(requireString(value, "type"), `${label}.type`);
  return {
    name: requireString(value, "name"),
    type,
    status: status as TaskStatus,
    depth: requireInt(value, "depth", 0),
    attempt: requireInt(value, "attempt", 1),
    isolationDir: optionalNullableString(value, "isolationDir") ?? null,
    handoffPath: optionalNullableString(value, "handoffPath") ?? null,
    startedAt: optionalNullableString(value, "startedAt") ?? null,
    finishedAt: optionalNullableString(value, "finishedAt") ?? null,
    parentName: optionalNullableString(value, "parentName") ?? null,
    note: optionalNullableString(value, "note") ?? null,
  };
}

function parseEvent(value: JsonValue, label: string): RunEvent {
  if (!isJsonObject(value)) {
    throw new PlanValidationError(`${label} must be an object`);
  }
  return {
    at: requireString(value, "at"),
    kind: requireString(value, "kind"),
    taskName: optionalNullableString(value, "taskName") ?? null,
    message: requireString(value, "message"),
  };
}
