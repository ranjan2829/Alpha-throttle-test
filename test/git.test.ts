import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { resolveGitIdentity, writeUniqueCommit } from "../src/throttle/git.ts";

function initRepo(): string {
  const dir = mkdtempSync(join(tmpdir(), "alpha-git-"));
  execFileSync("git", ["init", "-b", "main"], { cwd: dir });
  execFileSync("git", ["config", "user.name", "alpha"], { cwd: dir });
  execFileSync("git", ["config", "user.email", "alpha@local"], { cwd: dir });
  mkdirSync(join(dir, "tickets"), { recursive: true });
  writeFileSync(join(dir, "tickets", "README.md"), "tickets\n", "utf8");
  execFileSync("git", ["add", "."], { cwd: dir });
  execFileSync("git", ["commit", "-m", "base"], { cwd: dir });
  return dir;
}

test("resolveGitIdentity defaults to ranjan@allocations.com", () => {
  assert.deepEqual(resolveGitIdentity({}), {
    name: "Ranjan S",
    email: "ranjan@allocations.com",
  });
  assert.deepEqual(
    resolveGitIdentity({ ALPHA_GIT_NAME: "Other", ALPHA_GIT_EMAIL: "other@example.com" }),
    { name: "Other", email: "other@example.com" },
  );
});

test("writeUniqueCommit stamps the allocations email", async () => {
  const repo = initRepo();
  const parent = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
  const commit = await writeUniqueCommit({
    repoDir: repo,
    parentSha: parent,
    path: "tickets/run/email.md",
    body: "email\n",
    message: "email",
  });
  const author = execFileSync("git", ["log", "-1", "--format=%an <%ae>", commit], {
    cwd: repo,
    encoding: "utf8",
  }).trim();
  assert.equal(author, "Ranjan S <ranjan@allocations.com>");
});

test("writeUniqueCommit is safe under concurrency", async () => {
  const repo = initRepo();
  const parent = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
  const commits = await Promise.all(
    [1, 2, 3, 4].map((n) =>
      writeUniqueCommit({
        repoDir: repo,
        parentSha: parent,
        path: `tickets/run/000${n}.md`,
        body: `n${n}\n`,
        message: `t${n}`,
      }),
    ),
  );
  assert.equal(new Set(commits).size, 4);
  for (const commit of commits) {
    assert.match(commit, /^[0-9a-f]{40,64}$/i);
  }
});

test("writeUniqueCommit adds one file on a frozen parent", async () => {
  const repo = initRepo();
  const parent = execFileSync("git", ["rev-parse", "HEAD"], { cwd: repo, encoding: "utf8" }).trim();
  const first = await writeUniqueCommit({
    repoDir: repo,
    parentSha: parent,
    path: "tickets/run/0001.md",
    body: "one\n",
    message: "t1",
  });
  const second = await writeUniqueCommit({
    repoDir: repo,
    parentSha: parent,
    path: "tickets/run/0002.md",
    body: "two\n",
    message: "t2",
  });
  assert.notEqual(first, second);
  const firstParent = execFileSync("git", ["rev-parse", `${first}^`], { cwd: repo, encoding: "utf8" }).trim();
  const secondParent = execFileSync("git", ["rev-parse", `${second}^`], { cwd: repo, encoding: "utf8" }).trim();
  assert.equal(firstParent, parent);
  assert.equal(secondParent, parent);
  const file1 = execFileSync("git", ["show", `${first}:tickets/run/0001.md`], {
    cwd: repo,
    encoding: "utf8",
  });
  const file2 = execFileSync("git", ["show", `${second}:tickets/run/0002.md`], {
    cwd: repo,
    encoding: "utf8",
  });
  assert.equal(file1, "one\n");
  assert.equal(file2, "two\n");
});
