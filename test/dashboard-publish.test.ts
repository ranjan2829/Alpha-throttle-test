import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  DEFAULT_UI_REPO,
  listUiRepoFiles,
  stageDashboardFiles,
  standalonePackageJson,
  tokenFromGitRemote,
  uiRemoteUrl,
} from "../src/dashboard-publish.ts";

test("tokenFromGitRemote reads the origin access token", () => {
  const token = tokenFromGitRemote("https://x-access-token:abc123@github.com/ranjan2829/Alpha-throttle-test");
  assert.equal(token, "abc123");
  assert.equal(tokenFromGitRemote("https://github.com/ranjan2829/Alpha-throttle-test.git"), null);
});

test("uiRemoteUrl defaults to ranjan-rgb/Recursive-Agent-Dashboard", () => {
  assert.equal(uiRemoteUrl(), "https://github.com/ranjan-rgb/Recursive-Agent-Dashboard.git");
  assert.equal(DEFAULT_UI_REPO, "ranjan-rgb/Recursive-Agent-Dashboard");
  assert.match(uiRemoteUrl(DEFAULT_UI_REPO, "tok"), /x-access-token:tok@github.com/);
});

test("standalonePackageJson is the UI package name only", () => {
  assert.match(standalonePackageJson('{"name":"alpha-throttle-dashboard"}'), /recursive-agent-dashboard/);
});

test("stageDashboardFiles writes a full standalone Vite UI repo", () => {
  const src = mkdtempSync(join(tmpdir(), "alpha-web-src-"));
  const dest = mkdtempSync(join(tmpdir(), "alpha-web-dest-"));
  writeFileSync(join(src, "package.json"), `${JSON.stringify({ name: "alpha-throttle-dashboard" })}\n`);
  writeFileSync(join(src, "index.html"), "<html></html>\n");
  mkdirSync(join(src, "src", "patches"), { recursive: true });
  writeFileSync(join(src, "src", "patches.ts"), 'import "./patches/g1-type.css";\n');
  writeFileSync(join(src, "src", "patches", "g1-type.css"), "body{font:16px sans-serif}\n");
  writeFileSync(join(src, "src", "app.ts"), "export const ok = true;\n");
  const files = stageDashboardFiles(src, dest);
  assert.ok(files >= 5);
  assert.equal(existsSync(join(dest, "vite.config.ts")), true);
  const vite = readFileSync(join(dest, "vite.config.ts"), "utf8");
  assert.equal(vite.includes("dashboard-improve"), false);
  assert.equal(existsSync(join(dest, "vercel.json")), true);
  assert.equal(existsSync(join(dest, "AGENTS.md")), true);
  assert.match(readFileSync(join(dest, "package.json"), "utf8"), /recursive-agent-dashboard/);
  assert.match(readFileSync(join(dest, "src", "patches.ts"), "utf8"), /g1-type/);
  const listed = listUiRepoFiles(dest);
  assert.ok(listed.includes("AGENTS.md"));
  assert.ok(listed.includes("src/app.ts"));
  assert.ok(listed.includes("src/patches/g1-type.css"));
});
