import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { BoundError } from "./errors.ts";
import { requiredToken } from "./planner.ts";
import type { Handoff, IsolatedContext } from "./types.ts";

export function executeIsolatedNode(context: IsolatedContext, isolationDir: string): Handoff {
  mkdirSync(join(isolationDir, "artifacts"), { recursive: true });
  switch (context.task.type) {
    case "worker":
      return executeWorker(context, isolationDir);
    case "verifier":
      return executeVerifier(context);
    case "subplanner":
      throw new Error("subplanner must be executed by the orchestrator, not the leaf runner");
  }
}

function executeWorker(context: IsolatedContext, isolationDir: string): Handoff {
  const token = requiredToken(context.task.scopedGoal);
  const failFirst = context.task.scopedGoal.includes("[fail-first]");
  const includeToken = !(failFirst && context.attempt === 1);
  const artifactRel = "artifacts/result.md";
  const body = [
    `# ${context.task.name}`,
    ``,
    `scopedGoal: ${context.task.scopedGoal}`,
    `attempt: ${context.attempt}`,
    includeToken ? `contains:${token}` : `contains:placeholder`,
    includeToken ? token : "pending",
    ``,
  ].join("\n");
  writeFileSync(join(isolationDir, artifactRel), body, "utf8");

  return {
    schemaVersion: 1,
    taskName: context.task.name,
    type: "worker",
    status: includeToken ? "success" : "partial",
    summary: includeToken
      ? `wrote ${artifactRel} with token ${token}`
      : `wrote ${artifactRel} without required token (attempt ${context.attempt})`,
    artifacts: [artifactRel],
    notes: includeToken ? [] : ["fail-first: token omitted so verifier can reject"],
    followUps: [],
    attempt: context.attempt,
  };
}

function executeVerifier(context: IsolatedContext): Handoff {
  const target = context.verifyTarget;
  if (!target) {
    return verdictHandoff(context, "reject", "no target handoff to verify");
  }
  const missing: string[] = [];
  for (const criterion of context.acceptance) {
    if (criterion === "artifact exists") {
      if (target.artifacts.length === 0) missing.push(criterion);
      continue;
    }
    if (criterion.startsWith("contains:")) {
      const token = criterion.slice("contains:".length);
      const marker = `contains:${token}`.toLowerCase();
      const haystack = `${target.summary}\n${readTargetBodies(context)}`.toLowerCase();
      if (!haystack.includes(marker)) {
        missing.push(criterion);
      }
      continue;
    }
  }
  if (missing.length > 0) {
    return verdictHandoff(context, "reject", `unmet: ${missing.join(", ")}`);
  }
  return verdictHandoff(context, "accept", `accepted ${target.taskName} attempt ${target.attempt}`);
}

function readTargetBodies(context: IsolatedContext): string {
  const chunks: string[] = [];
  for (const handoff of [context.verifyTarget, ...context.upstreamHandoffs]) {
    if (!handoff) continue;
    chunks.push(handoff.summary);
    chunks.push(handoff.notes.join("\n"));
    for (const artifact of handoff.artifacts) {
      try {
        chunks.push(readFileSync(artifact, "utf8"));
      } catch {
        // Artifact paths are isolation-relative; the orchestrator also
        // embeds the token in the handoff summary for local checks.
      }
    }
  }
  return chunks.join("\n");
}

function verdictHandoff(context: IsolatedContext, verdict: "accept" | "reject", reason: string): Handoff {
  return {
    schemaVersion: 1,
    taskName: context.task.name,
    type: "verifier",
    status: verdict === "accept" ? "success" : "blocked",
    summary: reason,
    artifacts: [],
    notes: [reason],
    followUps: verdict === "reject" ? [`respawn ${context.task.verifies ?? "target"}`] : [],
    attempt: context.attempt,
    verdict,
    ...(verdict === "reject" ? { rejectReason: reason } : {}),
  };
}

export function depthCapHandoff(context: IsolatedContext, maxDepth: number): Handoff {
  return {
    schemaVersion: 1,
    taskName: context.task.name,
    type: context.task.type,
    status: "error",
    summary: `depth cap: node depth ${context.depth} exceeds maxDepth ${maxDepth}`,
    artifacts: [],
    notes: ["planner must stop publishing children at this depth"],
    followUps: [],
    attempt: context.attempt,
  };
}

export function assertCanSpawn(depth: number, maxDepth: number, taskName: string): void {
  if (depth > maxDepth) {
    throw new BoundError("depth", `cannot spawn ${taskName} at depth ${depth} (maxDepth=${maxDepth})`);
  }
}
