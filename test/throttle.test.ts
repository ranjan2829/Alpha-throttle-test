import assert from "node:assert/strict";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { classifyLiveFailure, createDryRunAdapter, isMergeRace, summarizeChecks } from "../src/throttle/adapter.ts";
import { runThrottleLoop } from "../src/throttle/loop.ts";
import { learn, plannedBurst, shouldSplitBurst, summarizeOutcomes } from "../src/throttle/policy.ts";
import { SAFE_POLICY, type Clock, type RatePolicy, type TicketOutcome } from "../src/throttle/types.ts";

function tmpWorkspace(): string {
  return mkdtempSync(join(tmpdir(), "alpha-throttle-"));
}

function fakeClock(): Clock {
  let ms = 1_000;
  return {
    now: () => new Date(ms).toISOString(),
    nowMs: () => ms,
    sleep: async (add: number) => {
      ms += add;
    },
  };
}

function policy(overrides: Partial<RatePolicy> = {}): RatePolicy {
  return { ...SAFE_POLICY, ...overrides };
}

test("learn backs off rate and concurrency on 429", () => {
  const before = policy({ currentRatePerSec: 8, concurrency: 4 });
  const stats = summarizeOutcomes([
    outcome({ status: "throttled", httpStatus: 429 }),
    outcome({ status: "throttled", httpStatus: 429 }),
  ]);
  const after = learn(before, stats, "2026-01-01T00:00:00.000Z");
  assert.equal(after.currentRatePerSec, 4);
  assert.equal(after.concurrency, 3);
  assert.match(after.reason, /backoff/);
});

test("learn backs off when a build fails", () => {
  const before = policy({ currentRatePerSec: 8, concurrency: 4 });
  const stats = summarizeOutcomes([
    outcome({ status: "rejected", checkStatus: "failure", checkCount: 1 }),
    outcome({ status: "opened" }),
  ]);
  const after = learn(before, stats, "2026-01-01T00:00:00.000Z");
  assert.equal(after.currentRatePerSec, 4);
  assert.match(after.reason, /build failed/);
});

test("learn speeds up on a clean burst", () => {
  const before = policy({ currentRatePerSec: 2, concurrency: 2, maxOpenPrs: 5 });
  const stats = summarizeOutcomes([
    outcome({ status: "dry-run" }),
    outcome({ status: "dry-run" }),
  ]);
  const after = learn(before, stats, "2026-01-01T00:00:00.000Z");
  assert.equal(after.currentRatePerSec, 2.5);
  assert.match(after.reason, /speedup/);
});

test("plannedBurst never exceeds maxPrsPerRun or maxOpenPrs", () => {
  assert.equal(plannedBurst(policy({ currentRatePerSec: 1000, maxOpenPrs: 5 }), 0, 8), 5);
  assert.equal(plannedBurst(policy({ currentRatePerSec: 1000, maxOpenPrs: 50 }), 6, 8), 2);
  assert.equal(plannedBurst(policy({ currentRatePerSec: 1000, maxOpenPrs: 50 }), 8, 8), 0);
});

test("until-merged keeps chunking until the dry-run merge count hits the target", async () => {
  const workspace = tmpWorkspace();
  const clock = fakeClock();
  const result = await runThrottleLoop({
    workspace,
    adapter: createDryRunAdapter({ clock, throttleAfter: 0, latencyMs: 0 }),
    clock,
    policy: policy({ currentRatePerSec: 5, maxPrsPerRun: 40, concurrency: 2, maxOpenPrs: 8 }),
    maxPrsPerRun: 40,
    maxEpisodes: 20,
    maxDepth: 2,
    live: false,
    untilMerged: 12,
    chunk: 5,
  });
  assert.ok(result.merged >= 12);
  assert.ok(result.outcomes.length >= 12);
  assert.ok(result.outcomes.length <= 15);
  assert.ok(result.episodes.length >= 3);
});

test("dry-run loop uses a Claude split then still writes dry-run outcomes", async () => {
  const workspace = tmpWorkspace();
  const clock = fakeClock();
  const result = await runThrottleLoop({
    workspace,
    adapter: createDryRunAdapter({ clock, throttleAfter: 0, latencyMs: 0 }),
    clock,
    policy: policy({ currentRatePerSec: 8, maxPrsPerRun: 8, concurrency: 2, maxOpenPrs: 8 }),
    maxPrsPerRun: 8,
    maxEpisodes: 1,
    maxDepth: 3,
    live: false,
    claude: {
      complete: async () => '{"kind":"parts","parts":[5,3]}',
    },
  });
  assert.equal(result.outcomes.length, 8);
  assert.ok(result.outcomes.every((item) => item.status === "dry-run"));
});

test("dry-run loop does not open GitHub PRs and writes rates.json", async () => {
  const workspace = tmpWorkspace();
  const clock = fakeClock();
  const result = await runThrottleLoop({
    workspace,
    adapter: createDryRunAdapter({ clock, throttleAfter: 0, latencyMs: 0 }),
    clock,
    policy: policy({ currentRatePerSec: 2, maxPrsPerRun: 4, concurrency: 2 }),
    maxPrsPerRun: 4,
    maxEpisodes: 2,
    maxDepth: 2,
    live: false,
  });
  assert.ok(result.openedOrDry >= 2);
  assert.ok(result.outcomes.every((item) => item.status === "dry-run"));
  assert.ok(result.outcomes.every((item) => item.prUrl?.startsWith("dry-run://")));
  assert.ok(result.outcomes.every((item) => item.prNumber === null));
  const rates = JSON.parse(readFileSync(join(workspace, "rates.json"), "utf8")) as RatePolicy;
  assert.ok(rates.currentRatePerSec > 2);
  assert.match(rates.reason, /speedup/);
});

test("dry-run injects 429s and the next policy backs off", async () => {
  const workspace = tmpWorkspace();
  const clock = fakeClock();
  const result = await runThrottleLoop({
    workspace,
    adapter: createDryRunAdapter({ clock, throttleAfter: 1, latencyMs: 0 }),
    clock,
    policy: policy({ currentRatePerSec: 4, maxPrsPerRun: 4, concurrency: 2 }),
    maxPrsPerRun: 4,
    maxEpisodes: 1,
    maxDepth: 1,
    live: false,
  });
  assert.ok(result.outcomes.some((item) => item.status === "throttled" && item.httpStatus === 429));
  assert.ok(result.policy.currentRatePerSec < 4);
  assert.match(result.policy.reason, /backoff/);
});

test("live 403 after push is opened, not a throttle/error backoff", () => {
  assert.deepEqual(classifyLiveFailure("Resource not accessible by integration (createPullRequest)", true), {
    status: "opened",
    httpStatus: 201,
  });
  assert.deepEqual(classifyLiveFailure("HTTP 429 rate limit", true), {
    status: "throttled",
    httpStatus: 429,
  });
  assert.deepEqual(classifyLiveFailure("boom", false), {
    status: "error",
    httpStatus: 500,
  });
});

test("shouldSplitBurst is recursive only when depth remains", () => {
  assert.equal(shouldSplitBurst(4, 0, 3), true);
  assert.equal(shouldSplitBurst(3, 0, 3), false);
  assert.equal(shouldSplitBurst(8, 2, 3), false);
});

function outcome(partial: Partial<TicketOutcome>): TicketOutcome {
  return {
    ticketId: "t",
    seq: 1,
    branch: "cursor/throttle-t-ec34",
    path: "tickets/t/0001.md",
    status: "dry-run",
    prNumber: null,
    prUrl: null,
    httpStatus: 200,
    latencyMs: 1,
    mergeMs: null,
    checkStatus: "none",
    checkCount: 0,
    error: null,
    ...partial,
  };
}

test("isMergeRace detects Origin main-ref collisions", () => {
  assert.equal(isMergeRace("ref updates rejected by git at prepare: refs/heads/main"), true);
  assert.equal(isMergeRace("updated by another push in the same batch"), true);
  assert.equal(isMergeRace("stack head conflicts with main"), true);
  assert.equal(isMergeRace("build failed"), false);
});

test("summarizeChecks treats empty as none and failures as failure", () => {
  assert.deepEqual(summarizeChecks([]), { checkStatus: "none", checkCount: 0 });
  assert.deepEqual(summarizeChecks([{ name: "ci", status: "completed", conclusion: "success" }]), {
    checkStatus: "success",
    checkCount: 1,
  });
  assert.deepEqual(summarizeChecks([{ name: "ci", status: "completed", conclusion: "failure" }]), {
    checkStatus: "failure",
    checkCount: 1,
  });
  assert.deepEqual(summarizeChecks([{ name: "ci", status: "in_progress" }]), {
    checkStatus: "pending",
    checkCount: 1,
  });
});
