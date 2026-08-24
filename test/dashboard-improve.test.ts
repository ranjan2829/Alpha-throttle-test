import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  applyDashboardImprovement,
  currentGeneration,
  loadImprovements,
  loadMemory,
  uniqueImprovementId,
} from "../src/dashboard-improve.ts";
import { emptyMemory, saveMemory } from "../src/dashboard-memory.ts";
import { DASHBOARD_REPAIRS } from "../src/dashboard-repairs.ts";

function tempWebSrc(): string {
  const root = mkdtempSync(join(tmpdir(), "alpha-dash-"));
  const webSrc = join(root, "src");
  mkdirSync(join(webSrc, "feed"), { recursive: true });
  mkdirSync(join(webSrc, "patches"), { recursive: true });
  saveMemory(join(webSrc, "memory.json"), emptyMemory());
  return webSrc;
}

test("uniqueImprovementId never collides across workers", () => {
  const a = uniqueImprovementId(2, "type", "aa11");
  const b = uniqueImprovementId(2, "type", "bb22");
  assert.notEqual(a, b);
  assert.match(a, /^g2-type-aa11$/);
});

test("applyDashboardImprovement repairs the next open defect and remembers it", () => {
  const webSrc = tempWebSrc();
  const first = applyDashboardImprovement({
    webSrc,
    now: () => "2026-08-24T08:00:00.000Z",
    entropy: "aaaa",
    worker: "worker-a",
  });
  assert.equal(first.generation.generation, 1);
  assert.equal(first.item.title, DASHBOARD_REPAIRS[0]?.title);
  assert.equal(existsSync(first.patchPath), true);
  assert.match(first.patchPath, /g1-type-aaaa\.css$/);
  assert.equal(first.memory.generation, 1);
  assert.equal(first.memory.defects[0]?.status, "fixed");
  assert.equal(first.memory.history.length, 1);
  assert.ok(first.memory.doNotRegress.includes("readable dark palette"));

  const second = applyDashboardImprovement({
    webSrc,
    now: () => "2026-08-24T08:00:01.000Z",
    entropy: "bbbb",
    worker: "worker-b",
  });
  assert.equal(second.generation.generation, 2);
  assert.notEqual(second.item.id, first.item.id);
  assert.equal(second.item.title, DASHBOARD_REPAIRS[1]?.title);
  assert.equal(second.memory.defects[0]?.status, "fixed");
  assert.equal(second.memory.defects[1]?.status, "fixed");
  assert.equal(second.memory.history[0]?.defectId, "type");
  assert.equal(second.memory.history[1]?.defectId, "header");

  const memory = loadMemory(join(webSrc, "memory.json"));
  assert.equal(memory.generation, 2);
  assert.equal(loadImprovements(join(webSrc, "feed")).length, 2);
  assert.equal(currentGeneration(loadImprovements(join(webSrc, "feed"))), 2);
  const index = readFileSync(join(webSrc, "patches.ts"), "utf8");
  assert.match(index, /g1-type-aaaa\.css/);
  assert.match(index, /g2-header-bbbb\.css/);
});

test("memory stops the agent when every defect is fixed", () => {
  const webSrc = tempWebSrc();
  for (let i = 0; i < DASHBOARD_REPAIRS.length; i += 1) {
    applyDashboardImprovement({ webSrc, entropy: `e${i}` });
  }
  const memory = loadMemory(join(webSrc, "memory.json"));
  assert.equal(memory.defects.every((defect) => defect.status === "fixed"), true);
  assert.throws(
    () => applyDashboardImprovement({ webSrc, entropy: "extra" }),
    /no open defects/,
  );
});
