import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import type { Clock, TicketOutcome, TicketSpec, ThrottleAdapterKind } from "./types.ts";

export interface PrAdapter {
  readonly kind: ThrottleAdapterKind;
  openTicket(ticket: TicketSpec): Promise<TicketOutcome>;
  observe(outcome: TicketOutcome): Promise<TicketOutcome>;
}

export interface DryRunOptions {
  clock: Clock;
  /** After this many successful opens, subsequent opens return HTTP 429. 0 = never. */
  throttleAfter: number;
  latencyMs: number;
}

export function createDryRunAdapter(options: DryRunOptions): PrAdapter {
  let opened = 0;
  return {
    kind: "dry-run",
    async openTicket(ticket: TicketSpec): Promise<TicketOutcome> {
      const started = options.clock.nowMs();
      await options.clock.sleep(options.latencyMs);
      opened += 1;
      const latencyMs = options.clock.nowMs() - started;
      if (options.throttleAfter > 0 && opened > options.throttleAfter) {
        return {
          ticketId: ticket.ticketId,
          seq: ticket.seq,
          branch: ticket.branch,
          status: "throttled",
          prNumber: null,
          prUrl: null,
          httpStatus: 429,
          latencyMs,
          mergeMs: null,
          error: "simulated 429 Too Many Requests",
        };
      }
      return {
        ticketId: ticket.ticketId,
        seq: ticket.seq,
        branch: ticket.branch,
        status: "dry-run",
        prNumber: null,
        prUrl: `dry-run://ticket/${ticket.ticketId}`,
        httpStatus: 200,
        latencyMs,
        mergeMs: options.latencyMs,
        error: null,
      };
    },
    async observe(outcome: TicketOutcome): Promise<TicketOutcome> {
      if (outcome.status === "dry-run") {
        return { ...outcome, status: "dry-run", mergeMs: outcome.mergeMs ?? options.latencyMs };
      }
      return outcome;
    },
  };
}

export interface LiveAdapterOptions {
  clock: Clock;
  repoDir: string;
  owner: string;
  repo: string;
  baseBranch: string;
}

export function createLiveAdapter(options: LiveAdapterOptions): PrAdapter {
  return {
    kind: "live",
    async openTicket(ticket: TicketSpec): Promise<TicketOutcome> {
      const started = options.clock.nowMs();
      try {
        const work = join(options.repoDir, ".alpha", "worktrees", ticket.ticketId);
        mkdirSync(join(options.repoDir, ".alpha", "worktrees"), { recursive: true });
        await run(options.repoDir, ["git", "fetch", "origin", options.baseBranch]);
        await run(options.repoDir, [
          "git",
          "worktree",
          "add",
          "-B",
          ticket.branch,
          work,
          `origin/${options.baseBranch}`,
        ]);
        mkdirSync(join(work, "tickets"), { recursive: true });
        writeFileSync(join(work, ticket.path), ticket.body, "utf8");
        await run(work, ["git", "add", ticket.path]);
        await run(work, ["git", "commit", "-m", ticket.title]);
        await run(work, ["git", "push", "-u", "origin", ticket.branch]);
        const created = await run(work, [
          "gh",
          "pr",
          "create",
          "--base",
          options.baseBranch,
          "--head",
          ticket.branch,
          "--title",
          ticket.title,
          "--body",
          `Throttle ticket ${ticket.ticketId}. Tiny one-line payload for the Alpha saturation harness.\n`,
        ]);
        const urlMatch = created.stdout.match(/https:\/\/github\.com\/\S+/);
        const numberMatch = created.stdout.match(/\/pull\/(\d+)/);
        return {
          ticketId: ticket.ticketId,
          seq: ticket.seq,
          branch: ticket.branch,
          status: "opened",
          prNumber: numberMatch?.[1] ? Number(numberMatch[1]) : null,
          prUrl: urlMatch?.[0] ?? null,
          httpStatus: 201,
          latencyMs: options.clock.nowMs() - started,
          mergeMs: null,
          error: null,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : "live open failed";
        const throttled = /429|rate limit|secondary rate/i.test(message);
        return {
          ticketId: ticket.ticketId,
          seq: ticket.seq,
          branch: ticket.branch,
          status: throttled ? "throttled" : "error",
          prNumber: null,
          prUrl: null,
          httpStatus: throttled ? 429 : 500,
          latencyMs: options.clock.nowMs() - started,
          mergeMs: null,
          error: message,
        };
      }
    },
    async observe(outcome: TicketOutcome): Promise<TicketOutcome> {
      if (!outcome.prNumber) return outcome;
      try {
        const viewed = await run(options.repoDir, [
          "gh",
          "pr",
          "view",
          String(outcome.prNumber),
          "--json",
          "state,mergedAt,url",
        ]);
        const parsed = JSON.parse(viewed.stdout) as {
          state?: string;
          mergedAt?: string | null;
          url?: string;
        };
        if (parsed.state === "MERGED") {
          return { ...outcome, status: "merged", prUrl: parsed.url ?? outcome.prUrl };
        }
        if (parsed.state === "CLOSED") {
          return { ...outcome, status: "rejected", prUrl: parsed.url ?? outcome.prUrl };
        }
        return { ...outcome, status: "opened", prUrl: parsed.url ?? outcome.prUrl };
      } catch (err) {
        const message = err instanceof Error ? err.message : "observe failed";
        return { ...outcome, error: message };
      }
    },
  };
}

interface ProcResult {
  stdout: string;
  stderr: string;
}

function run(cwd: string, argv: string[]): Promise<ProcResult> {
  return new Promise((resolve, reject) => {
    const [cmd, ...args] = argv;
    if (!cmd) {
      reject(new Error("empty command"));
      return;
    }
    const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${argv.join(" ")} exited ${code}: ${stderr.trim() || stdout.trim()}`));
    });
  });
}

export function systemClock(): Clock {
  return {
    now: () => new Date().toISOString(),
    nowMs: () => Date.now(),
    sleep: (ms: number) =>
      new Promise((resolve) => {
        setTimeout(resolve, ms);
      }),
  };
}
