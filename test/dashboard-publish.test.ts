import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import {
  DEFAULT_UI_REPO,
  RANJAN_RGB_UI_REPO,
  shouldPublishUi,
  stageDashboardFiles,
  tokenFromGitRemote,
  uiReadme,
  uiRemoteUrl,
} from "../src/dashboard-publish.ts";

test("tokenFromGitRemote reads the origin access token", () => {
  const token = tokenFromGitRemote("https://x-access-token:abc123@github.com/ranjan2829/Alpha-throttle-test");
  assert.equal(token, "abc123");
  assert.equal(tokenFromGitRemote("https://github.com/ranjan2829/Alpha-throttle-test.git"), null);
});

test("uiRemoteUrl defaults to the live ranjan2829 dashboard repo", () => {
  assert.equal(DEFAULT_UI_REPO, "ranjan2829/alpha-throttle-dashboard");
  assert.equal(RANJAN_RGB_UI_REPO, "ranjan-rgb/alpha-throttle-dashboard");
  assert.notEqual(DEFAULT_UI_REPO, RANJAN_RGB_UI_REPO);
  assert.equal(uiRemoteUrl(), "https://github.com/ranjan2829/alpha-throttle-dashboard.git");
  assert.match(uiRemoteUrl(DEFAULT_UI_REPO, "tok"), /x-access-token:tok@github.com/);
});

test("shouldPublishUi is --publish or --ui-repo", () => {
  assert.equal(shouldPublishUi({}), false);
  assert.equal(shouldPublishUi({ publish: true }), true);
  assert.equal(shouldPublishUi({ uiRepo: "ranjan2829/alpha-throttle-dashboard" }), true);
  assert.equal(shouldPublishUi({ publish: false, uiRepo: "" }), false);
});

test("stageDashboardFiles writes a standalone Vite app without the harness plugin", () => {
  const src = mkdtempSync(join(tmpdir(), "alpha-web-src-"));
  const dest = mkdtempSync(join(tmpdir(), "alpha-web-dest-"));
  writeFileSync(join(src, "package.json"), `${JSON.stringify({ name: "alpha-throttle-dashboard" })}\n`);
  writeFileSync(join(src, "index.html"), "<html></html>\n");
  mkdirSync(join(src, "src", "patches"), { recursive: true });
  writeFileSync(join(src, "src", "patches", "g1-type.css"), ".a{color:red}\n");
  writeFileSync(join(src, "src", "patches", "g2-header.css"), ".b{color:blue}\n");
  const files = stageDashboardFiles(src, dest);
  assert.ok(files >= 3);
  assert.equal(existsSync(join(dest, "vite.config.ts")), true);
  const vite = readFileSync(join(dest, "vite.config.ts"), "utf8");
  assert.equal(vite.includes("dashboard-improve"), false);
  assert.equal(existsSync(join(dest, "vercel.json")), true);
  const allCss = readFileSync(join(dest, "src", "patches", "all.css"), "utf8");
  assert.match(allCss, /\.a\{color:red\}/);
  assert.match(allCss, /\.b\{color:blue\}/);
  assert.equal(readFileSync(join(dest, "src", "patches.ts"), "utf8"), 'import "./patches/all.css";\n');
});

test("uiReadme names the live repo and how to move it to ranjan-rgb", () => {
  const text = uiReadme(DEFAULT_UI_REPO);
  assert.match(text, /ranjan2829\/alpha-throttle-dashboard/);
  assert.match(text, /transfer the repo in GitHub Settings/);
  assert.match(text, /DASHBOARD_UI_REPO/);
  assert.equal(text.includes("this repo is on ranjan-rgb"), false);
});
