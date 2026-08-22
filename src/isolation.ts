import { mkdirSync } from "node:fs";
import { join } from "node:path";

import type { IsolatedContext, PlanTask, SpawnRecord } from "./types.ts";
import { writeJson, type WorkspacePaths } from "./store.ts";

export function isolationDir(paths: WorkspacePaths, taskName: string, attempt: number): string {
  return join(paths.nodes, `${taskName}-a${attempt}`);
}

export function writeIsolatedContext(
  paths: WorkspacePaths,
  context: IsolatedContext,
): SpawnRecord {
  const dir = isolationDir(paths, context.task.name, context.attempt);
  mkdirSync(join(dir, "artifacts"), { recursive: true });
  const contextPath = join(dir, "context.json");
  writeJson(join(dir, "task.json"), context);
  writeJson(contextPath, context);
  return {
    taskName: context.task.name,
    isolationDir: dir,
    contextPath,
  };
}

export function buildContext(args: {
  task: PlanTask;
  depth: number;
  attempt: number;
  parentGoal: string;
  upstreamHandoffs: IsolatedContext["upstreamHandoffs"];
  verifyTarget: IsolatedContext["verifyTarget"];
}): IsolatedContext {
  return {
    task: args.task,
    depth: args.depth,
    attempt: args.attempt,
    parentGoal: args.parentGoal,
    acceptance: args.task.acceptance,
    upstreamHandoffs: args.upstreamHandoffs,
    verifyTarget: args.verifyTarget,
  };
}
