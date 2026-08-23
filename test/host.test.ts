import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { test } from "node:test";

import { originHostPlan, originHostText, runOriginHost, type CommandRunner } from "../src/throttle/host.ts";

function initTempRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "origin-host-"));
  spawnSync("git", ["init", "-b", "main"], { cwd: dir, encoding: "utf8" });
  spawnSync("git", ["config", "user.email", "agent@example.com"], { cwd: dir, encoding: "utf8" });
  spawnSync("git", ["config", "user.name", "Alpha Agent"], { cwd: dir, encoding: "utf8" });
  return dir;
}

test("host plan mirrors GitHub Alpha-throttle-test under allocations", () => {
  const plan = originHostPlan();
  assert.equal(plan.originSlug, "allocations/Alpha-throttle-test");
  assert.equal(plan.githubSlug, "ranjan2829/Alpha-throttle-test");
  assert.deepEqual(plan.createMirrored, [
    "origin",
    "repo",
    "create-mirrored",
    "ranjan2829/Alpha-throttle-test",
    "--namespace",
    "allocations",
  ]);
  const text = originHostText(plan);
  assert.match(text, /Kingsley Advani/);
  assert.match(text, /Make a recursive agent on cursor origin/);
  assert.match(text, /create-mirrored/);
});

test("runOriginHost stops at login when Origin is not authenticated", () => {
  const dir = initTempRepo();
  const called: string[][] = [];
  const runner: CommandRunner = (argv) => {
    called.push([...argv]);
    return { status: 0, stdout: "should not run", stderr: "" };
  };
  try {
    const result = runOriginHost({
      repoDir: dir,
      push: true,
      runner,
      authStatus: { ok: false, detail: "Not logged in. Run `origin auth login`." },
    });
    assert.equal(result.ok, false);
    assert.equal(result.hosted, false);
    assert.equal(called.length, 0);
    assert.equal(result.steps.some((row) => row.step === "create-mirrored"), false);
    assert.match(result.text, /hosted: no/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runOriginHost mirrors GitHub when the Origin repo is missing", () => {
  const dir = initTempRepo();
  const called: string[][] = [];
  const runner: CommandRunner = (argv) => {
    called.push([...argv]);
    if (argv[1] === "repo" && argv[2] === "view") {
      return { status: 1, stdout: "", stderr: "not found" };
    }
    return { status: 0, stdout: `${argv.join(" ")} ok`, stderr: "" };
  };
  try {
    const result = runOriginHost({
      repoDir: dir,
      push: true,
      runner,
      authStatus: { ok: true, detail: "logged in" },
    });
    assert.equal(result.ok, true);
    assert.equal(result.hosted, true);
    assert.deepEqual(
      called.find((argv) => argv[2] === "create-mirrored"),
      [
        "origin",
        "repo",
        "create-mirrored",
        "ranjan2829/Alpha-throttle-test",
        "--namespace",
        "allocations",
      ],
    );
    assert.deepEqual(
      called.find((argv) => argv[0] === "git" && argv[1] === "push"),
      ["git", "push", "-u", "cursor-origin", "HEAD"],
    );
    assert.equal(called.some((argv) => argv[2] === "create" && argv[1] === "repo"), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("runOriginHost creates an empty Origin repo if mirroring fails", () => {
  const dir = initTempRepo();
  const runner: CommandRunner = (argv) => {
    if (argv[1] === "repo" && argv[2] === "view") {
      return { status: 1, stdout: "", stderr: "not found" };
    }
    if (argv[2] === "create-mirrored") {
      return { status: 1, stdout: "", stderr: "mirror denied" };
    }
    return { status: 0, stdout: "ok", stderr: "" };
  };
  try {
    const result = runOriginHost({
      repoDir: dir,
      push: false,
      runner,
      authStatus: { ok: true, detail: "logged in" },
    });
    assert.equal(result.ok, true);
    assert.equal(result.hosted, true);
    assert.equal(result.steps.some((row) => row.step === "create" && row.ok), true);
    assert.equal(result.steps.some((row) => row.step === "push"), false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
