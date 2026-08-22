import assert from "node:assert/strict";
import { test } from "node:test";

import { PlanValidationError } from "../src/errors.ts";
import { parseJsonObject } from "../src/json.ts";
import { parsePlan, validateTaskGraph } from "../src/validate.ts";
import type { PlanTask } from "../src/types.ts";

function planValue(value: object) {
  return parseJsonObject(JSON.stringify(value), "mem");
}

test("rejects duplicate names and cycles", () => {
  const tasks: PlanTask[] = [
    { name: "a", type: "worker", scopedGoal: "a", acceptance: [], dependsOn: ["b"] },
    { name: "b", type: "worker", scopedGoal: "b", acceptance: [], dependsOn: ["a"] },
  ];
  assert.throws(() => validateTaskGraph(tasks), PlanValidationError);
});

test("verifier must name a real target", () => {
  assert.throws(
    () =>
      parsePlan(
        planValue({
          version: 1,
          goal: "g",
          rootSlug: "g",
          tasks: [
            {
              name: "v",
              type: "verifier",
              scopedGoal: "v",
              verifies: "missing",
              acceptance: [],
              dependsOn: [],
            },
          ],
        }),
        "mem",
      ),
    /verifies unknown task/,
  );
});

test("parses a worker plus verifier plan", () => {
  const plan = parsePlan(
    planValue({
      version: 1,
      goal: "Write a hello artifact",
      rootSlug: "hello",
      bounds: { maxDepth: 2, maxConcurrentChildren: 2, maxResawnsPerTask: 1 },
      tasks: [
        {
          name: "write-hello",
          type: "worker",
          scopedGoal: "Write a hello artifact",
          acceptance: ["contains:hello"],
          dependsOn: [],
        },
        {
          name: "verify-write-hello",
          type: "verifier",
          verifies: "write-hello",
          scopedGoal: "check hello",
          acceptance: ["contains:hello"],
          dependsOn: ["write-hello"],
        },
      ],
    }),
    "mem",
  );
  assert.equal(plan.tasks.length, 2);
  assert.equal(plan.tasks[1]?.verifies, "write-hello");
});
