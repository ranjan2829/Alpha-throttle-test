import assert from "node:assert/strict";
import { test } from "node:test";

import {
  formatGitStamp,
  gitCommitArgv,
  gitCommitEnv,
  tokenFromGitRemote,
  UI_COMMIT_EMAIL,
  UI_COMMIT_NAME,
  UI_COMMIT_STAMP,
  uiCommitIdentity,
} from "../src/dashboard-identity.ts";
import { parseRepoRef } from "../src/dashboard-github.ts";
import {
  formatUiPrLine,
  shouldOpenUiPr,
  uiHealBranchName,
  uiHealPatchPath,
  uiHealPrBody,
  uiHealPrTitle,
} from "../src/dashboard-ui-pr.ts";

test("ui identity is ranjan-rgb <ranjan@allocations.com>", () => {
  assert.equal(UI_COMMIT_NAME, "ranjan-rgb");
  assert.equal(UI_COMMIT_EMAIL, "ranjan@allocations.com");
  assert.equal(UI_COMMIT_STAMP, "ranjan-rgb <ranjan@allocations.com>");
  assert.deepEqual(uiCommitIdentity({}), {
    name: "ranjan-rgb",
    email: "ranjan@allocations.com",
  });
  assert.equal(formatGitStamp(uiCommitIdentity({})), UI_COMMIT_STAMP);
});

test("git commit argv and env stamp both author and committer", () => {
  const user = uiCommitIdentity({});
  assert.deepEqual(gitCommitArgv(user, "msg"), [
    "git",
    "-c",
    "user.name=ranjan-rgb",
    "-c",
    "user.email=ranjan@allocations.com",
    "commit",
    "-m",
    "msg",
  ]);
  const env = gitCommitEnv(user, { PATH: "/bin" });
  assert.equal(env.GIT_AUTHOR_NAME, "ranjan-rgb");
  assert.equal(env.GIT_AUTHOR_EMAIL, "ranjan@allocations.com");
  assert.equal(env.GIT_COMMITTER_NAME, "ranjan-rgb");
  assert.equal(env.GIT_COMMITTER_EMAIL, "ranjan@allocations.com");
});

test("tokenFromGitRemote and parseRepoRef", () => {
  assert.equal(tokenFromGitRemote("https://x-access-token:abc@github.com/acme/r"), "abc");
  assert.deepEqual(parseRepoRef("ranjan-rgb/Recursive-Agent-Dashboard"), {
    owner: "ranjan-rgb",
    repo: "Recursive-Agent-Dashboard",
  });
});

test("unique-file UI PRs are on cursor/dashboard-heal-*-ec34", () => {
  const item = {
    id: "g42-quality-abcd1234",
    generation: 42,
    title: "Quality",
    summary: "tighten spacing",
    acceptedAt: "2026-08-24T12:00:00.000Z",
    worker: "test",
    widget: { id: "w", kind: "copy" as const, title: "Quality", body: "notes" },
  };
  assert.equal(shouldOpenUiPr({}), false);
  assert.equal(shouldOpenUiPr({ pr: true }), true);
  assert.equal(uiHealBranchName(item), "cursor/dashboard-heal-g42-quality-abcd1234-ec34");
  assert.equal(uiHealPatchPath(item), "src/patches/g42-quality-abcd1234.css");
  assert.match(uiHealPrTitle(item), /gen 42/);
  assert.match(uiHealPrBody(item, "src/patches/g42-quality-abcd1234.css"), /ranjan-rgb <ranjan@allocations.com>/);
  assert.match(
    formatUiPrLine({
      opened: true,
      number: 1,
      url: "https://github.com/ranjan-rgb/Recursive-Agent-Dashboard/pull/1",
      branch: uiHealBranchName(item),
      path: uiHealPatchPath(item),
      sha: "abc",
      error: null,
    }),
    /opened/,
  );
});
