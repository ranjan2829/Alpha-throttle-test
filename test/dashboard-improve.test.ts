import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  applyDashboardImprovement,
  currentGeneration,
  IMPROVE_CATALOG,
  loadImprovements,
  uniqueImprovementId,
} from "../src/dashboard-improve.ts";

test("uniqueImprovementId never collides across workers", () => {
  const a = uniqueImprovementId(2, "spark", "aa11");
  const b = uniqueImprovementId(2, "spark", "bb22");
  assert.notEqual(a, b);
  assert.match(a, /^g2-spark-aa11$/);
});

test("applyDashboardImprovement writes a unique widget and bumps generation", () => {
  const feedDir = mkdtempSync(join(tmpdir(), "alpha-dash-"));
  const first = applyDashboardImprovement({
    feedDir,
    now: () => "2026-08-24T08:00:00.000Z",
    entropy: "aaaa",
    worker: "worker-a",
  });
  assert.equal(first.generation.generation, 1);
  assert.equal(first.item.generation, 1);
  assert.equal(first.item.title, IMPROVE_CATALOG[0]?.title);
  assert.equal(existsSync(first.path), true);
  assert.match(first.path, /g1-spark-aaaa\.json$/);

  const second = applyDashboardImprovement({
    feedDir,
    now: () => "2026-08-24T08:00:01.000Z",
    entropy: "bbbb",
    worker: "worker-b",
  });
  assert.equal(second.generation.generation, 2);
  assert.notEqual(second.item.id, first.item.id);
  assert.notEqual(second.path, first.path);
  assert.equal(second.item.title, IMPROVE_CATALOG[1]?.title);

  const items = loadImprovements(feedDir);
  assert.equal(items.length, 2);
  assert.equal(currentGeneration(items), 2);
  assert.equal(readdirSync(feedDir).length, 2);
});

test("parallel-style unique files do not overwrite", () => {
  const feedDir = mkdtempSync(join(tmpdir(), "alpha-dash-par-"));
  const a = applyDashboardImprovement({ feedDir, entropy: "w1", now: () => "2026-08-24T08:00:00.000Z" });
  const b = applyDashboardImprovement({ feedDir, entropy: "w2", now: () => "2026-08-24T08:00:00.000Z" });
  assert.notEqual(a.path, b.path);
  const rawA = readFileSync(a.path, "utf8");
  const rawB = readFileSync(b.path, "utf8");
  assert.match(rawA, /"generation": 1/);
  assert.match(rawB, /"generation": 2/);
});
