import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";

import { isMergeRace, mergeWithConflictRetry } from "../src/throttle/adapter.ts";
import {
  classifyConflictPath,
  emptyConflictMemory,
  rememberConflict,
  resolveWorkspaceConflicts,
  type ConflictMemoryEntry,
} from "../src/throttle/conflicts.ts";

function initRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "alpha-conflict-"));
  execFileSync("git", ["init", "-b", "main"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "Ranjan S"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "ranjan@allocations.com"], { cwd: dir });
  execFileSync("git", ["config", "merge.conflictStyle", "merge"], { cwd: dir });
  mkdirSync(join(dir, "tickets"), { recursive: true });
  writeFileSync(join(dir, "tickets", "README.md"), "tickets\n", "utf8");
  writeFileSync(join(dir, "README.md"), "# Alpha\n\nrecursive AI agent\n", "utf8");
  execFileSync("git", ["add", "."], { cwd: dir });
  execFileSync("git", ["commit", "-m", "base"], { cwd: dir });
  return dir;
}

function writeCommit(repo: string, relPath: string, body: string, message: string): void {
  mkdirSync(join(repo, dirname(relPath)), { recursive: true });
  writeFileSync(join(repo, relPath), body, "utf8");
  execFileSync("git", ["add", "--", relPath], { cwd: repo });
  execFileSync("git", ["commit", "-m", message], { cwd: repo });
}

test("unique-file conflict keeps ours", async () => {
  const repo = initRepo();
  writeCommit(repo, "tickets/0001.md", "ours ticket\n", "ours ticket");
  execFileSync("git", ["checkout", "-b", "worker"], { cwd: repo });
  execFileSync("git", ["checkout", "main"], { cwd: repo });
  writeCommit(repo, "tickets/0001.md", "main ticket\n", "main ticket");
  execFileSync("git", ["checkout", "worker"], { cwd: repo });

  const result = await resolveWorkspaceConflicts({
    repoDir: repo,
    baseBranch: "main",
    ownedPaths: ["tickets/0001.md"],
    now: () => "2026-08-24T00:00:00.000Z",
  });

  const file = result.files.find((row) => row.path === "tickets/0001.md");
  assert.ok(file);
  assert.equal(file.strategy, "ours");
  assert.equal(file.resolved, true);
  const body = readFileSync(join(repo, "tickets/0001.md"), "utf8");
  assert.equal(body, "ours ticket\n");
  assert.equal(classifyConflictPath("tickets/0001.md", { ownedPaths: ["tickets/0001.md"] }), "ours");
});

test("main-only file keeps theirs", async () => {
  const repo = initRepo();
  execFileSync("git", ["checkout", "-b", "worker"], { cwd: repo });
  writeCommit(repo, "tickets/0002.md", "worker unique\n", "worker unique");
  writeCommit(repo, "src/from-main.ts", "from worker\n", "worker also touched main file");
  execFileSync("git", ["checkout", "main"], { cwd: repo });
  writeCommit(repo, "src/from-main.ts", "from main\n", "main only file");
  execFileSync("git", ["checkout", "worker"], { cwd: repo });

  const result = await resolveWorkspaceConflicts({
    repoDir: repo,
    baseBranch: "main",
    ownedPaths: ["tickets/0002.md"],
    now: () => "2026-08-24T00:00:00.000Z",
  });

  const file = result.files.find((row) => row.path === "src/from-main.ts");
  assert.ok(file);
  assert.equal(file.strategy, "theirs");
  assert.equal(file.resolved, true);
  const body = readFileSync(join(repo, "src/from-main.ts"), "utf8");
  assert.equal(body, "from main\n");
  assert.equal(classifyConflictPath("src/from-main.ts", { ownedPaths: ["tickets/0002.md"] }), "theirs");
});

test("isMergeRace path triggers resolve + retry", async () => {
  const calls: string[] = [];
  let merges = 0;
  await mergeWithConflictRetry({
    async merge() {
      calls.push("merge");
      merges += 1;
      if (merges === 1) {
        throw new Error("ref updates rejected by git at prepare: refs/heads/main");
      }
    },
    async resolve(message) {
      calls.push("resolve");
      assert.equal(isMergeRace(message), true);
    },
  });
  assert.deepEqual(calls, ["merge", "resolve", "merge"]);
  assert.equal(isMergeRace("stack head conflicts with main"), true);
  assert.equal(isMergeRace("build failed"), false);
});

test("rememberConflict does not overwrite an already-resolved memory entry", () => {
  const first: ConflictMemoryEntry = {
    id: "README.md",
    path: "README.md",
    strategy: "union",
    kind: "merge",
    resolvedAt: "2026-08-24T00:00:00.000Z",
    notes: "keep recursive AI agent",
  };
  const second: ConflictMemoryEntry = {
    id: "README.md",
    path: "README.md",
    strategy: "theirs",
    kind: "origin-race",
    resolvedAt: "2026-08-25T00:00:00.000Z",
    notes: "would overwrite",
  };
  const once = rememberConflict(emptyConflictMemory(), first);
  const twice = rememberConflict(once, second);
  assert.equal(twice.entries.length, 1);
  assert.deepEqual(twice.entries[0], first);
  assert.notEqual(twice.entries[0]?.notes, second.notes);
});
