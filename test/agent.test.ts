import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  decomposeGoalMaybeClaude,
  policyForAgentTarget,
  resolveAgentTarget,
  writeAgentTree,
} from "../src/agent.ts";
import { createGate, parseCreatedChange } from "../src/throttle/adapter.ts";
import { makeTicket } from "../src/throttle/tickets.ts";

test("500 per minute is the live target, not 500 per second", () => {
  const target = resolveAgentTarget({
    perMinute: 500,
    ratePerSec: 2,
    maxPrs: 3,
    concurrency: 2,
  });
  assert.equal(target.window, "minute");
  assert.equal(target.maxPrs, 500);
  assert.equal(target.ratePerSec, 500 / 60);
  assert.ok(target.concurrency >= 8);
  const policy = policyForAgentTarget(target, "2026-01-01T00:00:00.000Z", true, true);
  assert.equal(policy.maxPrsPerRun, 500);
  assert.equal(policy.maxOpenPrs, 500);
  assert.equal(policy.currentRatePerSec, 500);
  assert.equal(policy.targetRatePerSec, 500 / 60);
});

test("unique ticket files never share a path across a run", () => {
  const a = makeTicket(1, "run1", "2026-01-01T00:00:00.000Z");
  const b = makeTicket(2, "run1", "2026-01-01T00:00:00.000Z");
  assert.equal(a.path, "tickets/run1/0001.md");
  assert.equal(b.path, "tickets/run1/0002.md");
  assert.notEqual(a.path, b.path);
  assert.notEqual(a.branch, b.branch);
});

test("Claude planner turns slices into a recursive plan", async () => {
  const plan = await decomposeGoalMaybeClaude({
    goal: "Open Origin PRs",
    bounds: { maxDepth: 3, maxConcurrentChildren: 3, maxResawnsPerTask: 1 },
    depth: 0,
    parentName: null,
    claude: {
      complete: async () => '{"slices":["write alpha","write beta","write gamma"]}',
    },
  });
  assert.ok(plan.tasks.some((task) => task.type === "subplanner"));
});

test("createGate serializes the critical section", async () => {
  const gate = createGate(1);
  const order: number[] = [];
  await Promise.all([
    gate(async () => {
      order.push(1);
      await new Promise((resolve) => setTimeout(resolve, 20));
      order.push(2);
    }),
    gate(async () => {
      order.push(3);
    }),
  ]);
  assert.deepEqual(order, [1, 2, 3]);
});

test("parseCreatedChange reads Origin and GitHub URLs", () => {
  assert.deepEqual(
    parseCreatedChange("opened https://cursor.com/codebase/allocations/Alpha-throttle-test/pull/9"),
    {
      prNumber: 9,
      prUrl: "https://cursor.com/codebase/allocations/Alpha-throttle-test/pull/9",
    },
  );
});

test("writeAgentTree records the planner", () => {
  const dir = mkdtempSync(join(tmpdir(), "alpha-agent-"));
  const path = writeAgentTree(dir, {
    planner: "deterministic",
    depth: 0,
    maxDepth: 3,
    tickets: 8,
    note: "test",
  });
  const written = JSON.parse(readFileSync(path, "utf8")) as { planner: string; tickets: number };
  assert.equal(written.planner, "deterministic");
  assert.equal(written.tickets, 8);
});
