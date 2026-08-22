import { BoundError } from "./errors.ts";
import type { Bounds, Plan, PlanTask } from "./types.ts";
import { slugify } from "./validate.ts";

export interface PlanOptions {
  goal: string;
  bounds: Bounds;
  depth: number;
  parentName: string | null;
}

/**
 * Deterministic planner. Origin / cloud planners can replace the resulting
 * plan.json; this default is enough for smoke and for a first decomposition.
 *
 * Clause split:
 *  - numbered lines (`1. foo`)
 *  - `and` / `;` separated outcomes
 * Depth:
 *  - remaining depth > 1 and 3+ clauses → one subplanner per remaining group
 *  - otherwise leaf workers, each with a verifier
 */
export function decomposeGoal(options: PlanOptions): Plan {
  const clauses = splitGoal(options.goal);
  const rootSlug = slugify(options.goal);
  const remaining = options.bounds.maxDepth - options.depth;
  if (remaining <= 0) {
    throw new BoundError("depth", `cannot plan at depth ${options.depth} (maxDepth=${options.bounds.maxDepth})`);
  }

  const useSubplanners = remaining > 1 && clauses.length >= 3;
  const tasks: PlanTask[] = useSubplanners
    ? planWithSubplanners(clauses, options)
    : planWorkers(clauses);

  return {
    version: 1,
    goal: options.goal,
    summary: options.parentName
      ? `subplan of ${options.parentName} (${tasks.length} tasks, depth ${options.depth})`
      : `plan for ${rootSlug} (${tasks.length} tasks, depth ${options.depth})`,
    rootSlug,
    bounds: options.bounds,
    tasks,
    done: false,
  };
}

export function splitGoal(goal: string): string[] {
  const numbered = [...goal.matchAll(/^\s*\d+[.)]\s+(.+)$/gm)].map((match) => match[1]?.trim() ?? "");
  if (numbered.length >= 2) {
    return numbered.filter((clause) => clause.length > 0);
  }
  const parts = goal
    .split(/\s+;\s+|\s+and then\s+|\s+then\s+|,\s+and\s+/i)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
  return parts.length > 0 ? parts : [goal];
}

function planWorkers(clauses: string[]): PlanTask[] {
  const tasks: PlanTask[] = [];
  for (const [index, clause] of clauses.entries()) {
    const name = uniqueName("do", index, clause);
    tasks.push({
      name,
      type: "worker",
      scopedGoal: clause,
      acceptance: acceptanceFor(clause),
      dependsOn: [],
    });
    tasks.push(verifierFor(name, clause));
  }
  return tasks;
}

function planWithSubplanners(clauses: string[], options: PlanOptions): PlanTask[] {
  const midpoint = Math.ceil(clauses.length / 2);
  const groups = [clauses.slice(0, midpoint), clauses.slice(midpoint)].filter((group) => group.length > 0);
  return groups.map((group, index) => {
    const name = uniqueName("slice", index, group[0] ?? "slice");
    return {
      name,
      type: "subplanner" as const,
      scopedGoal: group.join("; "),
      acceptance: group.flatMap(acceptanceFor),
      dependsOn: [],
    };
  });
}

export function verifierFor(target: string, clause: string): PlanTask {
  return {
    name: `verify-${target}`,
    type: "verifier",
    verifies: target,
    scopedGoal: `Verify ${target} meets acceptance.`,
    acceptance: acceptanceFor(clause),
    dependsOn: [target],
  };
}

export function acceptanceFor(clause: string): string[] {
  const token = requiredToken(clause);
  return [`artifact exists`, `contains:${token}`];
}

export function requiredToken(clause: string): string {
  const match = clause.match(/contains:([a-z0-9-]+)/i);
  if (match?.[1]) return match[1].toLowerCase();
  const words = clause
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, " ")
    .split(/\s+/)
    .filter((word) => word.length >= 4);
  return words[0] ?? "done";
}

function uniqueName(prefix: string, index: number, clause: string): string {
  const base = slugify(clause);
  return `${prefix}-${index + 1}-${base}`.replace(/-+/g, "-").slice(0, 48).replace(/-$/, "");
}
