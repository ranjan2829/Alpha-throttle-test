import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { parseJsonObject } from "../src/json.ts";
import { runOrchestrator } from "../src/orchestrator.ts";
import { decomposeGoal } from "../src/planner.ts";
import type { Plan } from "../src/types.ts";

function tmpWorkspace(label: string): string {
  return mkdtempSync(join(tmpdir(), `alpha-orch-${label}-`));
}

test("smoke path: plan → spawn → handoff without hanging", async () => {
  const workspace = tmpWorkspace("smoke");
  const result = await runOrchestrator({
    goal: "Write a hello artifact",
    workspace,
    bounds: { maxDepth: 2, maxConcurrentChildren: 2, maxResawnsPerTask: 1 },
    adapter: "local",
  });
  assert.equal(result.stoppedReason, "done");
  assert.ok(result.handoffs.length >= 2, "expected worker and verifier handoffs");
  assert.ok(result.handoffs.some((item) => item.type === "worker" && item.status === "success"));
  assert.ok(result.handoffs.some((item) => item.type === "verifier" && item.verdict === "accept"));
  assert.ok(result.state.peakConcurrency >= 1);
  assert.ok(result.state.peakConcurrency <= 2);
});

test("verifier reject triggers a respawn that later accepts", async () => {
  const workspace = tmpWorkspace("retry");
  const result = await runOrchestrator({
    goal: "Write a hello artifact [fail-first]",
    workspace,
    bounds: { maxDepth: 2, maxConcurrentChildren: 2, maxResawnsPerTask: 2 },
    adapter: "local",
  });
  assert.equal(result.stoppedReason, "done");
  const worker = result.state.tasks.find((row) => row.type === "worker");
  assert.ok(worker);
  assert.ok(worker.attempt >= 2);
  assert.ok(result.handoffs.some((item) => item.verdict === "reject"));
  assert.ok(result.handoffs.some((item) => item.verdict === "accept"));
});

test("workers do not receive sibling task names in isolated context", async () => {
  const workspace = tmpWorkspace("iso");
  const plan: Plan = {
    version: 1,
    goal: "Write alpha and then write beta",
    summary: "iso",
    rootSlug: "iso",
    bounds: { maxDepth: 2, maxConcurrentChildren: 2, maxResawnsPerTask: 1 },
    done: false,
    tasks: [
      {
        name: "write-alpha",
        type: "worker",
        scopedGoal: "write alpha contains:alpha",
        acceptance: ["contains:alpha"],
        dependsOn: [],
      },
      {
        name: "write-beta",
        type: "worker",
        scopedGoal: "write beta contains:beta",
        acceptance: ["contains:beta"],
        dependsOn: [],
      },
      {
        name: "verify-write-alpha",
        type: "verifier",
        verifies: "write-alpha",
        scopedGoal: "verify alpha",
        acceptance: ["contains:alpha"],
        dependsOn: ["write-alpha"],
      },
      {
        name: "verify-write-beta",
        type: "verifier",
        verifies: "write-beta",
        scopedGoal: "verify beta",
        acceptance: ["contains:beta"],
        dependsOn: ["write-beta"],
      },
    ],
  };
  const result = await runOrchestrator({
    goal: plan.goal,
    workspace,
    bounds: plan.bounds,
    adapter: "local",
    plan,
  });
  assert.equal(result.stoppedReason, "done");
  const alpha = result.state.tasks.find((row) => row.name === "write-alpha");
  assert.ok(alpha?.isolationDir);
  const context = parseJsonObject(readFileSync(join(alpha.isolationDir, "context.json"), "utf8"), "context");
  const blob = JSON.stringify(context);
  assert.equal(parseJsonObject(JSON.stringify(context.task), "task").name, "write-alpha");
  assert.doesNotMatch(blob, /write-beta/);
  assert.doesNotMatch(blob, /verify-write-beta/);
});

test("hard depth cap stops subplanner recursion", async () => {
  const workspace = tmpWorkspace("depth");
  const plan: Plan = {
    version: 1,
    goal: "nested",
    summary: "nested",
    rootSlug: "nested",
    bounds: { maxDepth: 1, maxConcurrentChildren: 2, maxResawnsPerTask: 0 },
    done: false,
    tasks: [
      {
        name: "slice-one",
        type: "subplanner",
        scopedGoal: "Write a hello artifact",
        acceptance: ["contains:hello"],
        dependsOn: [],
      },
    ],
  };
  const result = await runOrchestrator({
    goal: plan.goal,
    workspace,
    bounds: plan.bounds,
    adapter: "local",
    plan,
  });
  assert.equal(result.stoppedReason, "cap-hit");
  assert.equal(result.state.tasks[0]?.status, "cap-hit");
});

test("concurrency gate never exceeds maxConcurrentChildren", async () => {
  const workspace = tmpWorkspace("conc");
  const plan = decomposeGoal({
    goal: "Write alpha and then write beta and then write gamma",
    bounds: { maxDepth: 2, maxConcurrentChildren: 1, maxResawnsPerTask: 1 },
    depth: 0,
    parentName: null,
  });
  const result = await runOrchestrator({
    goal: plan.goal,
    workspace,
    bounds: plan.bounds,
    adapter: "local",
    plan,
  });
  assert.equal(result.stoppedReason, "done");
  assert.ok(result.state.peakConcurrency <= 1);
});
