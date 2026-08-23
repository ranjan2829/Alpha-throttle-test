import assert from "node:assert/strict";
import { test } from "node:test";

import {
  createClaudeClient,
  deterministicBurstSplit,
  extractClaudeText,
  parseBurstSplit,
  parseClaudeGoalSlices,
  planBurstSplit,
  readClaudeApiKey,
  stripJsonFence,
} from "../src/claude.ts";
import { sliceTickets } from "../src/throttle/loop.ts";

test("readClaudeApiKey prefers ANTHROPIC_API_KEY", () => {
  assert.equal(readClaudeApiKey({}), null);
  assert.equal(readClaudeApiKey({ CLAUDE_API_KEY: "sk-claude" }), "sk-claude");
  assert.equal(readClaudeApiKey({ ANTHROPIC_API_KEY: "sk-ant", CLAUDE_API_KEY: "sk-claude" }), "sk-ant");
  assert.equal(readClaudeApiKey({ ANTHROPIC_API_KEY: "   " }), null);
});

test("deterministicBurstSplit is the recursive cut", () => {
  assert.deepEqual(deterministicBurstSplit(8, 0, 3), { kind: "parts", parts: [4, 4] });
  assert.deepEqual(deterministicBurstSplit(5, 0, 3), { kind: "parts", parts: [3, 2] });
  assert.deepEqual(deterministicBurstSplit(3, 0, 3), { kind: "leaf", parts: [3] });
  assert.deepEqual(deterministicBurstSplit(8, 2, 3), { kind: "leaf", parts: [8] });
});

test("parseBurstSplit reads Claude JSON and rejects bad sums", () => {
  assert.deepEqual(parseBurstSplit('{"kind":"parts","parts":[3,2]}', 5), { kind: "parts", parts: [3, 2] });
  assert.deepEqual(parseBurstSplit("```json\n{\"kind\":\"leaf\"}\n```", 4), { kind: "leaf", parts: [4] });
  assert.throws(() => parseBurstSplit('{"kind":"parts","parts":[1,1]}', 5), /sum/);
});

test("planBurstSplit uses Claude then falls back", async () => {
  const claude = {
    complete: async () => '{"kind":"parts","parts":[6,2]}',
  };
  const split = await planBurstSplit({ claude, ticketCount: 8, depth: 0, maxDepth: 3 });
  assert.deepEqual(split, { kind: "parts", parts: [6, 2] });

  const broken = {
    complete: async () => "not json",
  };
  const fallback = await planBurstSplit({ claude: broken, ticketCount: 8, depth: 0, maxDepth: 3 });
  assert.deepEqual(fallback, { kind: "parts", parts: [4, 4] });
});

test("sliceTickets follows Claude parts", () => {
  assert.deepEqual(sliceTickets(["a", "b", "c", "d"], [1, 3]), [["a"], ["b", "c", "d"]]);
});

test("extractClaudeText reads the messages payload", () => {
  const text = extractClaudeText(
    JSON.stringify({
      content: [
        { type: "text", text: '{"slices":["one","two"]}' },
      ],
    }),
  );
  assert.deepEqual(parseClaudeGoalSlices(text), ["one", "two"]);
  assert.equal(stripJsonFence("```json\n{\"a\":1}\n```"), '{"a":1}');
});

test("createClaudeClient posts to Anthropic", async () => {
  const seen: string[] = [];
  const client = createClaudeClient("sk-test", {
    fetchImpl: async (input, init) => {
      seen.push(String(input));
      const headers = init?.headers as Record<string, string>;
      assert.equal(headers["x-api-key"], "sk-test");
      return new Response(
        JSON.stringify({ content: [{ type: "text", text: "ok" }] }),
        { status: 200 },
      );
    },
  });
  assert.equal(await client.complete("sys", "hi"), "ok");
  assert.match(seen[0] ?? "", /api\.anthropic\.com/);
});
