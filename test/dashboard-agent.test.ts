import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { runDashboardAgent } from "../src/dashboard-agent.ts";
import { applyDashboardImprovement } from "../src/dashboard-improve.ts";
import { emptyMemory, saveMemory } from "../src/dashboard-memory.ts";
import { DEFAULT_UI_REPO } from "../src/dashboard-publish.ts";
import { verifyDashboardGeneration } from "../src/dashboard-verify.ts";

function tempWebSrc(): string {
  const root = mkdtempSync(join(tmpdir(), "alpha-agent-"));
  const webSrc = join(root, "src");
  mkdirSync(join(webSrc, "feed"), { recursive: true });
  mkdirSync(join(webSrc, "patches"), { recursive: true });
  saveMemory(join(webSrc, "memory.json"), emptyMemory());
  return webSrc;
}

test("verifier rejects Comic Sans and 400-ticket copy", () => {
  const memory = emptyMemory();
  memory.generation = 1;
  memory.doNotRegress = ["Instrument Sans"];
  const bad = verifyDashboardGeneration({
    patchCss: "body { font-family: 'Comic Sans MS'; }",
    feedJson: '{"title":"ship 400 tickets"}',
    memory,
  });
  assert.equal(bad.ok, false);
  if (bad.ok) return;
  assert.ok(bad.issues.some((issue) => issue.code === "comic-sans"));
  assert.ok(bad.issues.some((issue) => issue.code === "tickets-400"));
});

test("runDashboardAgent applies, verifies, and dry-publishes to ranjan-rgb", async () => {
  const webSrc = tempWebSrc();
  const publishes: string[] = [];
  const result = await runDashboardAgent({
    repoRoot: mkdtempSync(join(tmpdir(), "alpha-root-")),
    webSrc,
    generations: 2,
    publish: true,
    dryRun: true,
    uiRepo: DEFAULT_UI_REPO,
    worker: "test-agent",
    now: () => "2026-08-24T10:00:00.000Z",
    publishToMain: async (options) => {
      publishes.push(options.repo ?? DEFAULT_UI_REPO);
      return {
        repo: options.repo ?? DEFAULT_UI_REPO,
        remoteUrl: `https://github.com/${options.repo ?? DEFAULT_UI_REPO}.git`,
        committed: false,
        sha: null,
        files: 8,
      };
    },
  });
  assert.equal(result.repo, "ranjan-rgb/Recursive-Agent-Dashboard");
  assert.equal(result.steps.length, 2);
  assert.equal(result.memoryGen, 2);
  assert.equal(result.steps[0]?.verified, true);
  assert.equal(result.steps[1]?.verified, true);
  assert.deepEqual(publishes, [
    "ranjan-rgb/Recursive-Agent-Dashboard",
    "ranjan-rgb/Recursive-Agent-Dashboard",
  ]);
});

test("runDashboardAgent keeps a publish failure and continues", async () => {
  const webSrc = tempWebSrc();
  applyDashboardImprovement({ webSrc, entropy: "seed1" });
  const result = await runDashboardAgent({
    repoRoot: mkdtempSync(join(tmpdir(), "alpha-root-")),
    webSrc,
    generations: 1,
    publish: true,
    worker: "test-agent",
    publishToMain: async () => {
      throw new Error("Permission denied to ranjan-rgb/Recursive-Agent-Dashboard");
    },
  });
  assert.equal(result.steps.length, 1);
  assert.equal(result.steps[0]?.published, false);
  assert.match(result.steps[0]?.publishError ?? "", /Permission denied/);
});

test("verifier accepts a catalog repair", () => {
  const webSrc = tempWebSrc();
  const applied = applyDashboardImprovement({ webSrc, entropy: "ok01" });
  const verdict = verifyDashboardGeneration({
    patchCss: "body { font-family: Instrument Sans; }",
    feedJson: JSON.stringify({ title: applied.item.title }),
    memory: applied.memory,
  });
  assert.equal(verdict.ok, true);
  writeFileSync(join(webSrc, "ok"), "1");
});
