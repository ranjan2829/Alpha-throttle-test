import { readFileSync } from "node:fs";

import type { PrAdapter } from "./throttle/adapter.ts";
import { createDryRunAdapter, createLiveAdapter, systemClock } from "./throttle/adapter.ts";
import type { ForgeRepo } from "./throttle/forge.ts";
import { originAuthStatus } from "./throttle/origin-cli.ts";
import type { Clock, TicketOutcome, TicketSpec } from "./throttle/types.ts";
import type { ApplyImprovementResult } from "./dashboard-improve.ts";
import type { ImprovementItem } from "./dashboard-types.ts";

export const HEAL_BRANCH_SUFFIX = "ec34";

export function healRepoPatchPath(item: ImprovementItem): string {
  return `web/src/patches/${item.id}.css`;
}

export function healBranchName(item: ImprovementItem): string {
  return `cursor/dashboard-heal-${item.id}-${HEAL_BRANCH_SUFFIX}`;
}

/** `--pr` or live-when-forged: a generation should open a unique-file PR. */
export function shouldOpenHealPr(input: { pr?: boolean; live?: boolean; forged?: boolean }): boolean {
  return Boolean(input.pr || input.live || input.forged);
}

export function useLiveHealAdapter(input: { forged?: boolean; dryRun?: boolean }): boolean {
  return Boolean(input.forged) && !input.dryRun;
}

export function detectForgeLogin(check: () => { ok: boolean } = originAuthStatus): boolean {
  try {
    return check().ok;
  } catch {
    return false;
  }
}

export function makeHealTicket(item: ImprovementItem, patchBody: string): TicketSpec {
  return {
    ticketId: item.id,
    seq: item.generation,
    branch: healBranchName(item),
    path: healRepoPatchPath(item),
    title: `dashboard heal gen ${item.generation}: ${item.title}`,
    body: patchBody,
  };
}

export async function openDashboardHealPr(
  result: ApplyImprovementResult,
  adapter: PrAdapter,
  options: { merge?: boolean } = {},
): Promise<TicketOutcome> {
  const patchBody = readFileSync(result.patchPath, "utf8");
  const ticket = makeHealTicket(result.item, patchBody);
  const opened = await adapter.openTicket(ticket);
  if (options.merge && (opened.status === "opened" || opened.status === "dry-run")) {
    return adapter.observe(opened);
  }
  return opened;
}

export interface ResolveHealAdapterOptions {
  pr?: boolean;
  live?: boolean;
  dryRun?: boolean;
  /** When true, live observe merge-commits (not squash). Default false: leave the PR open. */
  merge?: boolean;
  forged?: boolean;
  repoDir?: string;
  forgeRepo?: ForgeRepo;
  baseBranch?: string;
  clock?: Clock;
  adapter?: PrAdapter;
}

export function resolveHealAdapter(options: ResolveHealAdapterOptions): {
  adapter: PrAdapter | null;
  live: boolean;
  merge: boolean;
} {
  const forged = options.forged ?? false;
  const want: { pr?: boolean; live?: boolean; forged?: boolean } = { forged };
  if (options.pr === true) want.pr = true;
  if (options.live === true) want.live = true;
  if (!shouldOpenHealPr(want)) {
    return { adapter: null, live: false, merge: false };
  }
  if (options.adapter) {
    return { adapter: options.adapter, live: false, merge: Boolean(options.merge) };
  }
  const live = useLiveHealAdapter(
    options.dryRun === true ? { forged, dryRun: true } : { forged },
  );
  const clock = options.clock ?? systemClock();
  if (live) {
    if (!options.forgeRepo) {
      return {
        adapter: createDryRunAdapter({ clock, throttleAfter: 0, latencyMs: 0 }),
        live: false,
        merge: Boolean(options.merge),
      };
    }
    return {
      adapter: createLiveAdapter({
        clock,
        repoDir: options.repoDir ?? process.cwd(),
        forgeRepo: options.forgeRepo,
        baseBranch: options.baseBranch ?? "main",
        merge: Boolean(options.merge),
      }),
      live: true,
      merge: Boolean(options.merge),
    };
  }
  return {
    adapter: createDryRunAdapter({ clock, throttleAfter: 0, latencyMs: 0 }),
    live: false,
    merge: Boolean(options.merge),
  };
}

export function formatHealPrLine(outcome: TicketOutcome): string {
  if (outcome.prUrl) {
    return `pr ${outcome.status} ${outcome.prUrl}`;
  }
  return `pr ${outcome.status} (no url)`;
}
