import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { parseJsonObject } from "../json.ts";
import { ensureWorkspace, saveHandoff, savePlan, type WorkspacePaths } from "../store.ts";
import type { Handoff, Plan } from "../types.ts";
import { parsePolicy } from "./policy.ts";
import { SAFE_POLICY, type Episode, type RatePolicy, type TicketOutcome } from "./types.ts";

export interface ThrottlePaths extends WorkspacePaths {
  rates: string;
  episodes: string;
  tickets: string;
  outcomes: string;
}

export function throttlePaths(root: string): ThrottlePaths {
  const base = ensureWorkspace(root);
  return {
    ...base,
    rates: join(root, "rates.json"),
    episodes: join(root, "episodes.jsonl"),
    tickets: join(root, "tickets"),
    outcomes: join(root, "outcomes"),
  };
}

export function ensureThrottleWorkspace(root: string): ThrottlePaths {
  const paths = throttlePaths(root);
  mkdirSync(paths.tickets, { recursive: true });
  mkdirSync(paths.outcomes, { recursive: true });
  return paths;
}

export function loadPolicy(paths: ThrottlePaths): RatePolicy {
  if (!existsSync(paths.rates)) {
    return { ...SAFE_POLICY };
  }
  return parsePolicy(parseJsonObject(readFileSync(paths.rates, "utf8"), paths.rates), paths.rates);
}

export function savePolicy(paths: ThrottlePaths, policy: RatePolicy): void {
  writeFileSync(paths.rates, `${JSON.stringify(policy, null, 2)}\n`, "utf8");
}

export function appendEpisode(paths: ThrottlePaths, episode: Episode): void {
  appendFileSync(paths.episodes, `${JSON.stringify(episode)}\n`, "utf8");
}

export function writeOutcome(paths: ThrottlePaths, outcome: TicketOutcome): void {
  writeFileSync(
    join(paths.outcomes, `${outcome.ticketId}.json`),
    `${JSON.stringify(outcome, null, 2)}\n`,
    "utf8",
  );
}

export function writeTicketArtifact(paths: ThrottlePaths, relPath: string, body: string): string {
  const abs = join(paths.tickets, relPath.replace(/^tickets\//, ""));
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, body, "utf8");
  return abs;
}

export function persistPlanAndHandoffs(paths: ThrottlePaths, plan: Plan, handoffs: Handoff[]): void {
  savePlan(paths, plan);
  for (const handoff of handoffs) {
    saveHandoff(paths, handoff);
  }
}
