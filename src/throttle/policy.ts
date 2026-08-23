import {
  optionalString,
  requireInt,
  type JsonObject,
} from "../json.ts";
import { PlanValidationError } from "../errors.ts";
import {
  SAFE_POLICY,
  type EpisodeStats,
  type RatePolicy,
  type TicketOutcome,
} from "./types.ts";

export function parsePolicy(value: JsonObject, source: string): RatePolicy {
  const version = requireInt(value, "version", 1, 1);
  if (version !== 1) {
    throw new PlanValidationError(`${source} version must be 1`);
  }
  return {
    version: 1,
    targetRatePerSec: requirePositiveNumber(value, "targetRatePerSec", SAFE_POLICY.targetRatePerSec),
    currentRatePerSec: requirePositiveNumber(value, "currentRatePerSec", SAFE_POLICY.currentRatePerSec),
    concurrency: requireInt(value, "concurrency", 1, SAFE_POLICY.concurrency),
    maxOpenPrs: requireInt(value, "maxOpenPrs", 1, SAFE_POLICY.maxOpenPrs),
    maxPrsPerRun: requireInt(value, "maxPrsPerRun", 1, SAFE_POLICY.maxPrsPerRun),
    backoffMultiplier: requirePositiveNumber(value, "backoffMultiplier", SAFE_POLICY.backoffMultiplier),
    speedupMultiplier: requirePositiveNumber(value, "speedupMultiplier", SAFE_POLICY.speedupMultiplier),
    minRatePerSec: requirePositiveNumber(value, "minRatePerSec", SAFE_POLICY.minRatePerSec),
    maxRatePerSec: requirePositiveNumber(value, "maxRatePerSec", SAFE_POLICY.maxRatePerSec),
    lastUpdated: optionalString(value, "lastUpdated") ?? SAFE_POLICY.lastUpdated,
    reason: optionalString(value, "reason") ?? SAFE_POLICY.reason,
  };
}

function requirePositiveNumber(obj: JsonObject, key: string, fallback: number): number {
  const value = obj[key];
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new PlanValidationError(`${key} must be a positive number`);
  }
  return value;
}

export function clonePolicy(policy: RatePolicy): RatePolicy {
  return { ...policy };
}

export function plannedBurst(policy: RatePolicy, alreadyOpened: number, maxPrsPerRun: number): number {
  const remaining = Math.max(0, maxPrsPerRun - alreadyOpened);
  const rateBurst = Math.max(1, Math.floor(policy.currentRatePerSec));
  return Math.min(rateBurst, remaining, policy.maxOpenPrs);
}

export function summarizeOutcomes(outcomes: TicketOutcome[]): EpisodeStats {
  const attempted = outcomes.length;
  const opened = outcomes.filter((item) => item.status === "opened" || item.status === "merged").length;
  const dryRun = outcomes.filter((item) => item.status === "dry-run").length;
  const merged = outcomes.filter((item) => item.status === "merged").length;
  const accepted = outcomes.filter((item) =>
    item.status === "dry-run" || item.status === "opened" || item.status === "merged",
  ).length;
  const rejected = outcomes.filter((item) => item.status === "rejected").length;
  const throttled429 = outcomes.filter((item) => item.status === "throttled" || item.httpStatus === 429).length;
  const errors = outcomes.filter((item) => item.status === "error").length;
  const latencies = outcomes.map((item) => item.latencyMs);
  const merges = outcomes
    .map((item) => item.mergeMs)
    .filter((item): item is number => typeof item === "number");
  return {
    attempted,
    opened,
    dryRun,
    merged,
    accepted,
    rejected,
    throttled429,
    errors,
    avgLatencyMs: average(latencies),
    avgMergeMs: merges.length > 0 ? average(merges) : null,
  };
}

export function learn(policy: RatePolicy, stats: EpisodeStats, at: string): RatePolicy {
  const next = clonePolicy(policy);
  next.lastUpdated = at;
  const attempts = Math.max(1, stats.attempted);
  const errorRatio = (stats.errors + stats.throttled429) / attempts;

  if (stats.throttled429 > 0 || errorRatio > 0.3) {
    next.currentRatePerSec = clamp(
      policy.currentRatePerSec * policy.backoffMultiplier,
      policy.minRatePerSec,
      policy.maxRatePerSec,
    );
    next.concurrency = Math.max(1, policy.concurrency - 1);
    next.reason = stats.throttled429 > 0 ? "backoff: 429/throttle" : "backoff: error ratio";
    return next;
  }

  if (stats.attempted > 0 && stats.throttled429 === 0 && stats.errors === 0) {
    next.currentRatePerSec = clamp(
      policy.currentRatePerSec * policy.speedupMultiplier,
      policy.minRatePerSec,
      policy.maxRatePerSec,
    );
    if (next.currentRatePerSec >= policy.concurrency * 2 && policy.concurrency < policy.maxOpenPrs) {
      next.concurrency = Math.min(policy.maxOpenPrs, policy.concurrency + 1);
    }
    next.reason = "speedup: clean burst";
    return next;
  }

  next.reason = "hold";
  return next;
}

export function shouldSplitBurst(burst: number, depth: number, maxDepth: number): boolean {
  return burst >= 4 && depth + 1 < maxDepth;
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, round4(value)));
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}
