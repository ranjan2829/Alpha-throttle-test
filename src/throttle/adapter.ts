import { spawn } from "node:child_process";
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { compareUrlFor, type ForgeRepo } from "./forge.ts";
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
  forgeRepo: ForgeRepo;
  baseBranch: string;
}

export function compareUrl(owner: string, repo: string, base: string, head: string): string {
  return `https://github.com/${owner}/${repo}/compare/${base}...${head}`;
}

export function classifyLiveFailure(message: string, pushed: boolean): {
  status: TicketOutcome["status"];
  httpStatus: number;
} {
  if (/429|rate limit|secondary rate/i.test(message)) {
    return { status: "throttled", httpStatus: 429 };
  }
  if (pushed && /not accessible by integration|HTTP 403|Resource not accessible/i.test(message)) {
    return { status: "opened", httpStatus: 201 };
  }
  return { status: "error", httpStatus: 500 };
}

export function createLiveAdapter(options: LiveAdapterOptions): PrAdapter {
  return {
    kind: "live",
    async openTicket(ticket: TicketSpec): Promise<TicketOutcome> {
      const started = options.clock.nowMs();
      let pushed = false;
      try {
        const work = join(options.repoDir, ".alpha", "worktrees", ticket.ticketId);
        mkdirSync(join(options.repoDir, ".alpha", "worktrees"), { recursive: true });
        await ensureRemote(options.repoDir, options.forgeRepo);
        const startPoint = await resolveStartPoint(options.repoDir, options.forgeRepo, options.baseBranch);
        await run(options.repoDir, [
          "git",
          "worktree",
          "add",
          "-B",
          ticket.branch,
          work,
          startPoint,
        ]);
        mkdirSync(join(work, "tickets"), { recursive: true });
        writeFileSync(join(work, ticket.path), ticket.body, "utf8");
        await run(work, ["git", "add", ticket.path]);
        await run(work, ["git", "commit", "-m", ticket.title]);
        await run(work, ["git", "push", "-u", options.forgeRepo.remote, ticket.branch]);
        pushed = true;
        const created = await createChange(work, options.forgeRepo, options.baseBranch, ticket);
        const urlMatch = created.stdout.match(/https:\/\/(?:origin\.cursor\.com|github\.com)\/\S+/);
        const numberMatch = created.stdout.match(/\/(?:pull|change|changes)\/(\d+)/);
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
        const classified = classifyLiveFailure(message, pushed);
        return {
          ticketId: ticket.ticketId,
          seq: ticket.seq,
          branch: ticket.branch,
          status: classified.status,
          prNumber: null,
          prUrl: pushed
            ? compareUrlFor(options.forgeRepo, options.baseBranch, ticket.branch)
            : null,
          httpStatus: classified.httpStatus,
          latencyMs: options.clock.nowMs() - started,
          mergeMs: null,
          error:
            classified.status === "opened"
              ? "branch pushed; PR create forbidden for this token — open via origin pr create or Cursor"
              : message,
        };
      }
    },
    async observe(outcome: TicketOutcome): Promise<TicketOutcome> {
      if (!outcome.prNumber && !outcome.branch) return outcome;
      try {
        const viewed = await observeChange(options.repoDir, options.forgeRepo, outcome);
        if (viewed.state === "MERGED" || viewed.state === "merged") {
          return { ...outcome, status: "merged", prUrl: viewed.url ?? outcome.prUrl };
        }
        if (viewed.state === "CLOSED" || viewed.state === "closed") {
          return { ...outcome, status: "rejected", prUrl: viewed.url ?? outcome.prUrl };
        }
        return { ...outcome, status: "opened", prUrl: viewed.url ?? outcome.prUrl };
      } catch (err) {
        const message = err instanceof Error ? err.message : "observe failed";
        return { ...outcome, error: message };
      }
    },
  };
}

async function ensureRemote(repoDir: string, forgeRepo: ForgeRepo): Promise<void> {
  const remotes = await run(repoDir, ["git", "remote"]);
  const names = remotes.stdout.split(/\s+/).filter((name) => name.length > 0);
  if (!names.includes(forgeRepo.remote)) {
    await run(repoDir, ["git", "remote", "add", forgeRepo.remote, forgeRepo.httpsUrl]);
    return;
  }
  await run(repoDir, ["git", "remote", "set-url", forgeRepo.remote, forgeRepo.httpsUrl]);
}

async function resolveStartPoint(repoDir: string, forgeRepo: ForgeRepo, baseBranch: string): Promise<string> {
  try {
    await run(repoDir, ["git", "fetch", forgeRepo.remote, baseBranch]);
    return `${forgeRepo.remote}/${baseBranch}`;
  } catch {
    await run(repoDir, ["git", "fetch", "origin", baseBranch]);
    return `origin/${baseBranch}`;
  }
}

async function createChange(
  work: string,
  forgeRepo: ForgeRepo,
  baseBranch: string,
  ticket: TicketSpec,
): Promise<ProcResult> {
  const body = `Throttle ticket ${ticket.ticketId}. Tiny one-line payload for the Alpha saturation harness.\n`;
  if (forgeRepo.forge === "origin") {
    return run(work, [
      "origin",
      "pr",
      "create",
      "-R",
      forgeRepo.slug,
      "--title",
      ticket.title,
      "--body",
      body,
      "--head",
      ticket.branch,
      "--base",
      baseBranch,
      "--status",
      "open",
      "--push",
      "--remote",
      forgeRepo.remote,
    ]);
  }
  return run(work, [
    "gh",
    "pr",
    "create",
    "--base",
    baseBranch,
    "--head",
    ticket.branch,
    "--title",
    ticket.title,
    "--body",
    body,
  ]);
}

interface ObservedChange {
  state: string | undefined;
  url: string | undefined;
}

async function observeChange(
  repoDir: string,
  forgeRepo: ForgeRepo,
  outcome: TicketOutcome,
): Promise<ObservedChange> {
  if (forgeRepo.forge === "origin") {
    const target = outcome.prNumber ? String(outcome.prNumber) : outcome.branch;
    const viewed = await run(repoDir, [
      "origin",
      "pr",
      "view",
      target,
      "-R",
      forgeRepo.slug,
      "--json",
      "number,status,url",
    ]);
    const parsed = JSON.parse(viewed.stdout) as { status?: string; url?: string };
    return { state: parsed.status, url: parsed.url };
  }
  const viewed = await run(repoDir, [
    "gh",
    "pr",
    "view",
    String(outcome.prNumber),
    "--json",
    "state,mergedAt,url",
  ]);
  const parsed = JSON.parse(viewed.stdout) as { state?: string; url?: string };
  return { state: parsed.state, url: parsed.url };
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
