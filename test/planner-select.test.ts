import assert from "node:assert/strict";
import { test } from "node:test";

import { parsePlannerRequest, resolvePlanner } from "../src/planner-select.ts";

test("parsePlannerRequest reads flag and switches", () => {
  assert.equal(parsePlannerRequest(undefined, new Set()), "auto");
  assert.equal(parsePlannerRequest("grok", new Set()), "grok");
  assert.equal(parsePlannerRequest(undefined, new Set(["grok"])), "grok");
  assert.equal(parsePlannerRequest(undefined, new Set(["claude"])), "claude");
  assert.throws(() => parsePlannerRequest("nope", new Set()), /auto \| claude \| grok/);
});

test("resolvePlanner falls back from grok when no XAI key", () => {
  const fake = { complete: async () => "ok" };
  const grokMissing = resolvePlanner({
    requested: "grok",
    env: { ANTHROPIC_API_KEY: "sk-ant" },
    claudeFactory: () => fake,
    grokFactory: () => fake,
  });
  assert.equal(grokMissing.kind, "claude");
  assert.equal(grokMissing.fallback, true);
  assert.match(grokMissing.reason, /no XAI_API_KEY/);

  const bothMissing = resolvePlanner({
    requested: "grok",
    env: {},
    claudeFactory: () => fake,
    grokFactory: () => fake,
  });
  assert.equal(bothMissing.kind, "deterministic");
  assert.equal(bothMissing.client, null);
  assert.equal(bothMissing.fallback, true);
});

test("resolvePlanner uses Grok when XAI_API_KEY is set", () => {
  const fake = { complete: async () => "ok" };
  const resolved = resolvePlanner({
    requested: "grok",
    env: { XAI_API_KEY: "xai-live" },
    claudeFactory: () => fake,
    grokFactory: () => fake,
  });
  assert.equal(resolved.kind, "grok");
  assert.equal(resolved.fallback, false);
  assert.ok(resolved.client);
});

test("auto prefers Claude then Grok then deterministic", () => {
  const fake = { complete: async () => "ok" };
  assert.equal(
    resolvePlanner({
      requested: "auto",
      env: { ANTHROPIC_API_KEY: "sk", XAI_API_KEY: "xai" },
      claudeFactory: () => fake,
      grokFactory: () => fake,
    }).kind,
    "claude",
  );
  assert.equal(
    resolvePlanner({
      requested: "auto",
      env: { XAI_API_KEY: "xai" },
      claudeFactory: () => fake,
      grokFactory: () => fake,
    }).kind,
    "grok",
  );
  assert.equal(resolvePlanner({ requested: "auto", env: {} }).kind, "deterministic");
});
