import assert from "node:assert/strict";
import { test } from "node:test";

import { compareUrlFor, parseForgeFlag, parseRepoSlug } from "../src/throttle/forge.ts";

test("parses Origin clone URL and slug", () => {
  const fromUrl = parseRepoSlug("https://origin.cursor.com/ranjan-rgb/Alpha-throttle-test", "origin");
  assert.equal(fromUrl.slug, "ranjan-rgb/Alpha-throttle-test");
  assert.equal(fromUrl.httpsUrl, "https://origin.cursor.com/ranjan-rgb/Alpha-throttle-test");
  assert.equal(fromUrl.remote, "cursor-origin");
  const fromSlug = parseRepoSlug("ranjan-rgb/Alpha-throttle-test", "origin");
  assert.deepEqual(fromUrl, fromSlug);
});

test("parses GitHub repo for --forge github", () => {
  const repo = parseRepoSlug("https://github.com/ranjan2829/Alpha-throttle-test", "github");
  assert.equal(repo.forge, "github");
  assert.equal(repo.slug, "ranjan2829/Alpha-throttle-test");
  assert.equal(repo.remote, "origin");
});

test("Origin compare URLs stay on origin.cursor.com", () => {
  const repo = parseRepoSlug("ranjan-rgb/Alpha-throttle-test", "origin");
  assert.equal(
    compareUrlFor(repo, "main", "cursor/throttle-t1-ec34"),
    "https://origin.cursor.com/ranjan-rgb/Alpha-throttle-test/compare/main...cursor/throttle-t1-ec34",
  );
});

test("parseForgeFlag defaults to origin", () => {
  assert.equal(parseForgeFlag(undefined), "origin");
  assert.equal(parseForgeFlag("github"), "github");
  assert.throws(() => parseForgeFlag("gitlab"));
});
