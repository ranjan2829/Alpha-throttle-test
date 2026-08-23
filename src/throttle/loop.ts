import { writeFileSync } from "node:fs";
import { join } from "node:path";

import type { ClaudeClient } from "../claude.ts";
import { deterministicBurstSplit, planBurstSplit } from "../claude.ts";
import type { Handoff, Plan, PlanTask } from "../types.ts";
import { DEFAULT_BOUNDS } from "../types.ts";
import type { PrAdapter } from "./adapter.ts";
import { learn, plannedBurst, summarizeOutcomes } from "./policy.ts";
import {
  appendEpisode,
  ensureThrottleWorkspace,
  loadPolicy,
  persistPlanAndHandoffs,
  savePolicy,
  writeOutcome,
  writeTicketArtifact,
  type ThrottlePaths,
} from "./store.ts";
import { makeRunId, makeTicket } from "./tickets.ts";
import {
  SAFE_POLICY,
  type Clock,
  type Episode,
  type RatePolicy,
  type TicketOutcome,
  type TicketSpec,
} from "./types.ts";

export interface ThrottleRunOptions {
  workspace: string;
  adapter: PrAdapter;
  clock: Clock;
  policy?: RatePolicy;
  maxPrsPerRun: number;
  maxEpisodes: number;
  maxDepth: number;
  live: boolean;
  claude?: ClaudeClient | null;
}

export interface ThrottleRunResult {
  policy: RatePolicy;
  episodes: Episode[];
  outcomes: TicketOutcome[];
  openedOrDry: number;
}

export async function runThrottleLoop(options: ThrottleRunOptions): Promise<ThrottleRunResult> {
  const paths = ensureThrottleWorkspace(options.workspace);
  let policy = options.policy ?? loadPolicy(paths);
  savePolicy(paths, policy);
  const clock = options.clock;
  const runId = makeRunId(clock.nowMs());
  const episodes: Episode[] = [];
  const allOutcomes: TicketOutcome[] = [];
  let seq = 0;

  for (let episodeIndex = 0; episodeIndex < options.maxEpisodes; episodeIndex += 1) {
    const remaining = options.maxPrsPerRun - allOutcomes.length;
    if (remaining <= 0) break;
    const burst = plannedBurst(policy, allOutcomes.length, options.maxPrsPerRun);
    if (burst <= 0) break;

    const tickets: TicketSpec[] = [];
    for (let i = 0; i < burst; i += 1) {
      seq += 1;
      tickets.push(makeTicket(seq, runId, clock.now()));
    }

    const startedAt = clock.now();
    const outcomes = await runBurst({
      tickets,
      adapter: options.adapter,
      clock,
      concurrency: policy.concurrency,
      depth: 0,
      maxDepth: options.maxDepth,
      paths,
      claude: options.claude ?? null,
    });
    const stats = summarizeOutcomes(outcomes);
    const next = learn(policy, stats, clock.now());
    const handoffs = outcomes.flatMap((outcome) => [
      workerHandoff(outcome),
      verifierHandoff(outcome),
    ]);
    const plan = burstPlan(tickets, policy);
    persistPlanAndHandoffs(paths, plan, handoffs);
    const episode: Episode = {
      id: `ep-${episodeIndex + 1}`,
      depth: 0,
      startedAt,
      finishedAt: clock.now(),
      adapter: options.adapter.kind,
      plannedBurst: burst,
      outcomes,
      stats,
      policyBefore: policy,
      policyAfter: next,
      handoffs,
    };
    appendEpisode(paths, episode);
    episodes.push(episode);
    allOutcomes.push(...outcomes);
    policy = next;
    savePolicy(paths, policy);
    writeFileSync(join(paths.root, "last-episode.json"), `${JSON.stringify(episode, null, 2)}\n`);
    if (stats.throttled429 > 0 && options.live) {
      break;
    }
  }

  return {
    policy,
    episodes,
    outcomes: allOutcomes,
    openedOrDry: allOutcomes.filter((item) => item.status === "dry-run" || item.status === "opened" || item.status === "merged").length,
  };
}

async function runBurst(args: {
  tickets: TicketSpec[];
  adapter: PrAdapter;
  clock: Clock;
  concurrency: number;
  depth: number;
  maxDepth: number;
  paths: ThrottlePaths;
  claude: ClaudeClient | null;
}): Promise<TicketOutcome[]> {
  const split = args.claude
    ? await planBurstSplit({
        claude: args.claude,
        ticketCount: args.tickets.length,
        depth: args.depth,
        maxDepth: args.maxDepth,
      })
    : deterministicBurstSplit(args.tickets.length, args.depth, args.maxDepth);
  if (split.kind === "parts") {
    const slices = sliceTickets(args.tickets, split.parts);
    const childOutcomes = await Promise.all(
      slices.map((slice) => runBurst({ ...args, tickets: slice, depth: args.depth + 1 })),
    );
    return childOutcomes.flat();
  }

  const outcomes: TicketOutcome[] = [];
  const pending = [...args.tickets];
  const running = new Map<string, Promise<void>>();

  const startNext = (): void => {
    while (running.size < args.concurrency && pending.length > 0) {
      const ticket = pending.shift();
      if (!ticket) break;
      writeTicketArtifact(args.paths, ticket.path, ticket.body);
      const job = (async () => {
        const opened = await args.adapter.openTicket(ticket);
        const observed = await args.adapter.observe(opened);
        writeOutcome(args.paths, observed);
        outcomes.push(observed);
      })().finally(() => {
        running.delete(ticket.ticketId);
      });
      running.set(ticket.ticketId, job);
    }
  };

  startNext();
  while (running.size > 0) {
    await Promise.race(running.values());
    startNext();
  }
  return outcomes.sort((a, b) => a.seq - b.seq);
}

function workerHandoff(outcome: TicketOutcome): Handoff {
  return {
    schemaVersion: 1,
    taskName: `ticket-${String(outcome.seq).padStart(4, "0")}`,
    type: "worker",
    status: outcome.status === "error" || outcome.status === "throttled" ? "error" : "success",
    summary: `${outcome.status} ${outcome.ticketId} latencyMs=${outcome.latencyMs}`,
    artifacts: [`tickets/${String(outcome.seq).padStart(4, "0")}.md`],
    notes: [
      `status=${outcome.status}`,
      `httpStatus=${outcome.httpStatus ?? "none"}`,
      `pr=${outcome.prUrl ?? "none"}`,
      `checks=${outcome.checkStatus}/${outcome.checkCount}`,
      `mergeMs=${outcome.mergeMs ?? "none"}`,
    ],
    followUps: [],
    attempt: 1,
  };
}

function verifierHandoff(outcome: TicketOutcome): Handoff {
  const ok = outcome.status === "dry-run" || outcome.status === "opened" || outcome.status === "merged";
  return {
    schemaVersion: 1,
    taskName: `verify-ticket-${String(outcome.seq).padStart(4, "0")}`,
    type: "verifier",
    status: ok ? "success" : "blocked",
    summary: ok ? `accepted ${outcome.ticketId}` : `rejected ${outcome.ticketId}: ${outcome.error ?? outcome.status}`,
    artifacts: [],
    notes: [`observe ${outcome.status}`, `checks=${outcome.checkStatus}`],
    followUps: outcome.status === "throttled" ? ["backoff rate"] : [],
    attempt: 1,
    verdict: ok ? "accept" : "reject",
    ...(ok ? {} : { rejectReason: outcome.error ?? outcome.status }),
  };
}

function burstPlan(tickets: TicketSpec[], policy: RatePolicy): Plan {
  const tasks: PlanTask[] = [];
  for (const ticket of tickets) {
    const name = `ticket-${String(ticket.seq).padStart(4, "0")}`;
    tasks.push({
      name,
      type: "worker",
      scopedGoal: `Open isolated PR for ${ticket.ticketId}`,
      acceptance: ["ticket file exists"],
      dependsOn: [],
    });
    tasks.push({
      name: `verify-${name}`,
      type: "verifier",
      verifies: name,
      scopedGoal: `Observe PR/throttle outcome for ${ticket.ticketId}`,
      acceptance: ["verdict recorded"],
      dependsOn: [name],
    });
  }
  return {
    version: 1,
    goal: "throttle learn burst",
    summary: `burst ${tickets.length} at rate ${policy.currentRatePerSec}/s`,
    rootSlug: "throttle",
    bounds: { ...DEFAULT_BOUNDS, maxConcurrentChildren: policy.concurrency },
    tasks,
    done: false,
  };
}

export function defaultPolicy(): RatePolicy {
  return { ...SAFE_POLICY };
}

export function sliceTickets<T>(items: T[], parts: number[]): T[][] {
  const slices: T[][] = [];
  let cursor = 0;
  for (const size of parts) {
    slices.push(items.slice(cursor, cursor + size));
    cursor += size;
  }
  return slices.filter((slice) => slice.length > 0);
}
