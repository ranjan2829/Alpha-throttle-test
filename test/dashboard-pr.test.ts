import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import { applyDashboardImprovement } from "../src/dashboard-improve.ts";
import { emptyMemory, saveMemory } from "../src/dashboard-memory.ts";
import {
  formatHealPrLine,
  healBranchName,
  healRepoPatchPath,
  makeHealTicket,
  openDashboardHealPr,
  resolveHealAdapter,
  shouldOpenHealPr,
  useLiveHealAdapter,
} from "../src/dashboard-pr.ts";
import { originMergeArgv, type PrAdapter } from "../src/throttle/adapter.ts";
import type { TicketOutcome, TicketSpec } from "../src/throttle/types.ts";

function tempWebSrc(): string {
  const root = mkdtempSync(join(tmpdir(), "alpha-heal-"));
  const webSrc = join(root, "src");
  mkdirSync(join(webSrc, "feed"), { recursive: true });
  mkdirSync(join(webSrc, "patches"), { recursive: true });
  saveMemory(join(webSrc, "memory.json"), emptyMemory());
  return webSrc;
}

function mockAdapter(opened: TicketSpec[]): PrAdapter {
  return {
    kind: "dry-run",
    async openTicket(ticket) {
      opened.push(ticket);
      return {
        ticketId: ticket.ticketId,
        seq: ticket.seq,
        branch: ticket.branch,
        path: ticket.path,
        status: "dry-run",
        prNumber: null,
        prUrl: `dry-run://ticket/${ticket.ticketId}`,
        httpStatus: 200,
        latencyMs: 0,
        mergeMs: null,
        checkStatus: "success",
        checkCount: 1,
        error: null,
      };
    },
    async observe(outcome) {
      return { ...outcome, status: "merged", mergeMs: 1 };
    },
  };
}

test("shouldOpenHealPr is --pr or live-when-forged", () => {
  assert.equal(shouldOpenHealPr({}), false);
  assert.equal(shouldOpenHealPr({ pr: true }), true);
  assert.equal(shouldOpenHealPr({ live: true }), true);
  assert.equal(shouldOpenHealPr({ forged: true }), true);
  assert.equal(shouldOpenHealPr({ pr: false, live: false, forged: false }), false);
});

test("useLiveHealAdapter only when forged and not --dry-run", () => {
  assert.equal(useLiveHealAdapter({ forged: true }), true);
  assert.equal(useLiveHealAdapter({ forged: true, dryRun: true }), false);
  assert.equal(useLiveHealAdapter({ forged: false }), false);
});

test("makeHealTicket is one unique patch file on a heal branch", () => {
  const item = {
    id: "g3-layout-abcd",
    generation: 3,
    title: "Layout",
    summary: "fix layout",
    acceptedAt: "2026-08-24T09:00:00.000Z",
    worker: "test",
    widget: { id: "w", kind: "copy" as const, title: "Layout", body: "notes" },
  };
  const ticket = makeHealTicket(item, ".shell{display:grid}\n");
  assert.equal(ticket.path, "web/src/patches/g3-layout-abcd.css");
  assert.equal(ticket.path, healRepoPatchPath(item));
  assert.equal(ticket.branch, "cursor/dashboard-heal-g3-layout-abcd-ec34");
  assert.equal(ticket.branch, healBranchName(item));
  assert.equal(ticket.body, ".shell{display:grid}\n");
  assert.match(ticket.title, /dashboard heal gen 3/);
});

test("a generation opens one unique-file PR through a mock adapter", async () => {
  const webSrc = tempWebSrc();
  const opened: TicketSpec[] = [];
  const result = applyDashboardImprovement({
    webSrc,
    now: () => "2026-08-24T09:00:00.000Z",
    entropy: "pr01",
    worker: "heal-test",
  });
  const outcome = await openDashboardHealPr(result, mockAdapter(opened));
  assert.equal(opened.length, 1);
  assert.equal(opened[0]?.path, `web/src/patches/${result.item.id}.css`);
  assert.equal(opened[0]?.body, readFileSync(result.patchPath, "utf8"));
  assert.doesNotMatch(opened[0]?.path ?? "", /memory\.json/);
  assert.equal(outcome.status, "dry-run");
  assert.equal(outcome.prUrl, `dry-run://ticket/${result.item.id}`);
  assert.equal(formatHealPrLine(outcome), `pr dry-run dry-run://ticket/${result.item.id}`);
});

test("merge observe is opt-in and uses --merge not squash", async () => {
  const webSrc = tempWebSrc();
  const opened: TicketSpec[] = [];
  const result = applyDashboardImprovement({ webSrc, entropy: "pr02" });
  const merged = await openDashboardHealPr(result, mockAdapter(opened), { merge: true });
  assert.equal(merged.status, "merged");
  assert.deepEqual(originMergeArgv("ranjan-rgb/Alpha-throttle-test", "12"), [
    "origin",
    "pr",
    "merge",
    "12",
    "-R",
    "ranjan-rgb/Alpha-throttle-test",
    "--merge",
  ]);
  assert.ok(!originMergeArgv("ranjan-rgb/Alpha-throttle-test", "12").includes("--squash"));
});

test("resolveHealAdapter uses mock when --pr and no forge creds", () => {
  const resolved = resolveHealAdapter({ pr: true, forged: false });
  assert.ok(resolved.adapter);
  assert.equal(resolved.live, false);
  assert.equal(resolved.adapter?.kind, "dry-run");
});

test("resolveHealAdapter stays off without --pr or forge", () => {
  const resolved = resolveHealAdapter({});
  assert.equal(resolved.adapter, null);
});

test("formatHealPrLine never invents a URL", () => {
  const outcome: TicketOutcome = {
    ticketId: "g1",
    seq: 1,
    branch: "cursor/dashboard-heal-g1-ec34",
    path: "web/src/patches/g1.css",
    status: "error",
    prNumber: null,
    prUrl: null,
    httpStatus: 500,
    latencyMs: 0,
    mergeMs: null,
    checkStatus: "none",
    checkCount: 0,
    error: "no forge",
  };
  assert.equal(formatHealPrLine(outcome), "pr error (no url)");
});
