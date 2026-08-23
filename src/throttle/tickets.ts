import type { TicketSpec } from "./types.ts";

const BRANCH_SUFFIX = "ec34";

export function makeTicket(seq: number, runId: string, at: string): TicketSpec {
  const padded = String(seq).padStart(4, "0");
  const ticketId = `${runId}-${padded}`;
  const branch = `cursor/throttle-${ticketId}-${BRANCH_SUFFIX}`;
  return {
    ticketId,
    seq,
    branch,
    path: `tickets/${padded}.md`,
    title: `throttle ticket ${padded}`,
    body: `throttle-ticket ${ticketId} ${at}\n`,
  };
}

export function makeRunId(nowMs: number): string {
  return nowMs.toString(36);
}
