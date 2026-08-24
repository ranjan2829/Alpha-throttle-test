import assert from "node:assert/strict";
import { test } from "node:test";

import { deterministicBurstSplit, parseBurstSplit, planBurstSplit } from "../src/claude.ts";
import {
  createGrokClient,
  DEFAULT_GROK_MODEL,
  extractGrokText,
  readGrokApiKey,
  resolveGrokModels,
} from "../src/grok.ts";

test("readGrokApiKey prefers XAI_API_KEY", () => {
  assert.equal(readGrokApiKey({}), null);
  assert.equal(readGrokApiKey({ GROK_API_KEY: "xai-grok" }), "xai-grok");
  assert.equal(readGrokApiKey({ XAI_API_KEY: "xai-primary", GROK_API_KEY: "xai-grok" }), "xai-primary");
  assert.equal(readGrokApiKey({ XAI_API_KEY: "   " }), null);
});

test("resolveGrokModels puts grok-4.6 first", () => {
  assert.equal(resolveGrokModels()[0], DEFAULT_GROK_MODEL);
  assert.equal(resolveGrokModels("grok-4")[0], "grok-4");
});

test("extractGrokText reads chat completions", () => {
  const text = extractGrokText(
    JSON.stringify({
      choices: [{ message: { content: '{"kind":"parts","parts":[3,2]}' } }],
    }),
  );
  assert.deepEqual(parseBurstSplit(text, 5), {
    kind: "parts",
    parts: [3, 2],
    planner: "claude",
  });
});

test("createGrokClient posts to api.x.ai", async () => {
  const seen: string[] = [];
  const client = createGrokClient("xai-test", {
    fetchImpl: async (input, init) => {
      seen.push(String(input));
      const headers = init?.headers as Record<string, string>;
      assert.equal(headers.authorization, "Bearer xai-test");
      return new Response(
        JSON.stringify({ choices: [{ message: { content: "ok" } }] }),
        { status: 200 },
      );
    },
  });
  assert.equal(await client.complete("sys", "hi"), "ok");
  assert.match(seen[0] ?? "", /api\.x\.ai/);
});

test("planBurstSplit tags grok planner", async () => {
  const grok = {
    complete: async () => '{"kind":"parts","parts":[5,3]}',
  };
  const split = await planBurstSplit({
    claude: grok,
    ticketCount: 8,
    depth: 0,
    maxDepth: 3,
    plannerName: "grok",
  });
  assert.deepEqual(split, { kind: "parts", parts: [5, 3], planner: "grok" });
  assert.deepEqual(deterministicBurstSplit(8, 0, 3).planner, "deterministic");
});
