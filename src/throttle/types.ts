import type { Handoff } from "../types.ts";

export type ThrottleAdapterKind = "dry-run" | "live";

export type TicketStatus = "dry-run" | "opened" | "merged" | "rejected" | "throttled" | "error";

export type CheckStatus = "none" | "success" | "failure" | "pending" | "error";

export interface RatePolicy {
  version: 1;
  /** Saturation goal to measure against, not a promise. */
  targetRatePerSec: number;
  /** Planned start rate for the next burst. */
  currentRatePerSec: number;
  concurrency: number;
  maxOpenPrs: number;
  maxPrsPerRun: number;
  backoffMultiplier: number;
  speedupMultiplier: number;
  minRatePerSec: number;
  maxRatePerSec: number;
  lastUpdated: string;
  reason: string;
}

export interface TicketSpec {
  ticketId: string;
  seq: number;
  branch: string;
  path: string;
  body: string;
  title: string;
}

export interface TicketOutcome {
  ticketId: string;
  seq: number;
  branch: string;
  path: string;
  status: TicketStatus;
  prNumber: number | null;
  prUrl: string | null;
  httpStatus: number | null;
  latencyMs: number;
  mergeMs: number | null;
  checkStatus: CheckStatus;
  checkCount: number;
  error: string | null;
}

export interface EpisodeStats {
  attempted: number;
  opened: number;
  dryRun: number;
  merged: number;
  accepted: number;
  rejected: number;
  throttled429: number;
  errors: number;
  checkFailures: number;
  avgLatencyMs: number;
  avgMergeMs: number | null;
}

export interface Episode {
  id: string;
  depth: number;
  startedAt: string;
  finishedAt: string;
  adapter: ThrottleAdapterKind;
  plannedBurst: number;
  outcomes: TicketOutcome[];
  stats: EpisodeStats;
  policyBefore: RatePolicy;
  policyAfter: RatePolicy;
  handoffs: Handoff[];
}

export interface Clock {
  now(): string;
  nowMs(): number;
  sleep(ms: number): Promise<void>;
}

export const SAFE_POLICY: RatePolicy = {
  version: 1,
  targetRatePerSec: 1000,
  currentRatePerSec: 2,
  concurrency: 2,
  maxOpenPrs: 5,
  maxPrsPerRun: 8,
  backoffMultiplier: 0.5,
  speedupMultiplier: 1.25,
  minRatePerSec: 0.25,
  maxRatePerSec: 1000,
  lastUpdated: "1970-01-01T00:00:00.000Z",
  reason: "safe defaults: dry-run, low rate, small caps",
};

export const LIVE_DEFAULT_MAX = 3;
