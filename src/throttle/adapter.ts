import { spawn } from "node:child_process";

import { compareUrlFor, type ForgeRepo } from "./forge.ts";
import { commitAndPushUniqueFile, resolveStartSha, runProc, writeUniqueCommit } from "./git.ts";
import type { CheckStatus, Clock, TicketOutcome, TicketSpec, ThrottleAdapterKind } from "./types.ts";

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
          path: ticket.path,
          status: "throttled",
          prNumber: null,
          prUrl: null,
          httpStatus: 429,
          latencyMs,
          mergeMs: null,
          checkStatus: "none",
          checkCount: 0,
          error: "simulated 429 Too Many Requests",
        };
      }
      return {
          ticketId: ticket.ticketId,
          seq: ticket.seq,
          branch: ticket.branch,
          path: ticket.path,
          status: "dry-run",
        prNumber: null,
        prUrl: `dry-run://ticket/${ticket.ticketId}`,
        httpStatus: 200,
        latencyMs,
        mergeMs: options.latencyMs,
        checkStatus: "success",
        checkCount: 1,
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
  merge: boolean;
  /** Frozen main SHA for every open. Sibling PRs, no Origin stack. */
  startSha?: string;
}

export interface CheckRow {
  name?: string;
  status?: string;
  conclusion?: string;
}

export function summarizeChecks(rows: CheckRow[]): { checkStatus: CheckStatus; checkCount: number } {
  if (rows.length === 0) {
    return { checkStatus: "none", checkCount: 0 };
  }
  const blob = rows
    .map((row) => `${row.status ?? ""} ${row.conclusion ?? ""}`)
    .join(" ");
  if (/fail/i.test(blob)) {
    return { checkStatus: "failure", checkCount: rows.length };
  }
  if (/pending|queued|in_progress|running/i.test(blob)) {
    return { checkStatus: "pending", checkCount: rows.length };
  }
  return { checkStatus: "success", checkCount: rows.length };
}

export function parseCheckRows(text: string): CheckRow[] {
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed)) {
    return [];
  }
  return parsed.filter((row): row is CheckRow => typeof row === "object" && row !== null);
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
  let frozenSha = options.startSha ?? null;
  const payloads = new Map<string, string>();
  const mergeGate = createGate(1);
  const ready = (async () => {
    await ensureRemote(options.repoDir, options.forgeRepo);
    if (!frozenSha) {
      frozenSha = await resolveStartSha(options.repoDir, options.forgeRepo.remote, options.baseBranch);
    }
    return frozenSha;
  })();

  return {
    kind: "live",
    async openTicket(ticket: TicketSpec): Promise<TicketOutcome> {
      const started = options.clock.nowMs();
      let pushed = false;
      payloads.set(ticket.ticketId, ticket.body);
      try {
        const startSha = await ready;
        if (!startSha) {
          throw new Error("could not freeze main SHA");
        }
        await commitAndPushUniqueFile({
          repoDir: options.repoDir,
          remote: options.forgeRepo.remote,
          startSha,
          branch: ticket.branch,
          path: ticket.path,
          body: ticket.body,
          message: ticket.title,
        });
        pushed = true;
        const created = await createChange(options.repoDir, options.forgeRepo, options.baseBranch, ticket);
        const parsed = parseCreatedChange(created.stdout);
        if (parsed.prNumber && options.forgeRepo.forge === "origin") {
          await clearOriginStack(options.repoDir, options.forgeRepo.slug, String(parsed.prNumber));
        }
        return {
          ticketId: ticket.ticketId,
          seq: ticket.seq,
          branch: ticket.branch,
          path: ticket.path,
          status: "opened",
          prNumber: parsed.prNumber,
          prUrl: parsed.prUrl,
          httpStatus: 201,
          latencyMs: options.clock.nowMs() - started,
          mergeMs: null,
          checkStatus: "none",
          checkCount: 0,
          error: null,
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : "live open failed";
        const classified = classifyLiveFailure(message, pushed);
        return {
          ticketId: ticket.ticketId,
          seq: ticket.seq,
          branch: ticket.branch,
          path: ticket.path,
          status: classified.status,
          prNumber: null,
          prUrl: pushed
            ? compareUrlFor(options.forgeRepo, options.baseBranch, ticket.branch)
            : null,
          httpStatus: classified.httpStatus,
          latencyMs: options.clock.nowMs() - started,
          mergeMs: null,
          checkStatus: "none",
          checkCount: 0,
          error:
            classified.status === "opened"
              ? "branch pushed; PR create forbidden for this token — open via origin pr create or Cursor"
              : message,
        };
      }
    },
    async observe(outcome: TicketOutcome): Promise<TicketOutcome> {
      if (outcome.status === "throttled" || outcome.status === "error") {
        return outcome;
      }
      if (!outcome.prNumber && !outcome.branch) return outcome;
      try {
        const checks = await readChecks(options.repoDir, options.forgeRepo, outcome);
        const next: TicketOutcome = { ...outcome, ...checks };
        if (checks.checkStatus === "failure") {
          return { ...next, status: "rejected", error: "build failed" };
        }
        if (options.merge && next.status === "opened") {
          const mergeStarted = options.clock.nowMs();
          await mergeGate(() =>
            mergeIndependentChange({
              repoDir: options.repoDir,
              forgeRepo: options.forgeRepo,
              baseBranch: options.baseBranch,
              outcome: next,
              body: payloads.get(next.ticketId) ?? next.path,
            }),
          );
          const viewed = await observeChange(options.repoDir, options.forgeRepo, next);
          if (viewed.state === "MERGED" || viewed.state === "merged") {
            return {
              ...next,
              status: "merged",
              prUrl: viewed.url ?? next.prUrl,
              mergeMs: options.clock.nowMs() - mergeStarted,
            };
          }
          return {
            ...next,
            status: "error",
            prUrl: viewed.url ?? next.prUrl,
            mergeMs: options.clock.nowMs() - mergeStarted,
            error: `merge did not complete: ${viewed.state ?? "unknown"}`,
          };
        }
        const viewed = await observeChange(options.repoDir, options.forgeRepo, next);
        if (viewed.state === "MERGED" || viewed.state === "merged") {
          return { ...next, status: "merged", prUrl: viewed.url ?? next.prUrl };
        }
        if (viewed.state === "CLOSED" || viewed.state === "closed") {
          return { ...next, status: "rejected", prUrl: viewed.url ?? next.prUrl };
        }
        return { ...next, status: "opened", prUrl: viewed.url ?? next.prUrl };
      } catch (err) {
        const message = err instanceof Error ? err.message : "observe failed";
        return { ...outcome, error: message };
      }
    },
  };
}

export function parseCreatedChange(text: string): { prNumber: number | null; prUrl: string | null } {
  const urlMatch = text.match(/https:\/\/(?:cursor\.com\/codebase|origin\.cursor\.com|github\.com)\/\S+/);
  const numberMatch = text.match(/\/(?:pull|change|changes)\/(\d+)/);
  return {
    prNumber: numberMatch?.[1] ? Number(numberMatch[1]) : null,
    prUrl: urlMatch?.[0] ?? null,
  };
}

export function createGate(concurrency: number): <T>(job: () => Promise<T>) => Promise<T> {
  let active = 0;
  const waiting: Array<() => void> = [];
  const acquire = (): Promise<void> => {
    if (active < concurrency) {
      active += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      waiting.push(resolve);
    });
  };
  const release = (): void => {
    const next = waiting.shift();
    if (next) next();
    else active = Math.max(0, active - 1);
  };
  return async <T>(job: () => Promise<T>): Promise<T> => {
    await acquire();
    try {
      return await job();
    } finally {
      release();
    }
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

async function readChecks(
  repoDir: string,
  forgeRepo: ForgeRepo,
  outcome: TicketOutcome,
): Promise<{ checkStatus: CheckStatus; checkCount: number }> {
  const target = outcome.prNumber ? String(outcome.prNumber) : outcome.branch;
  try {
    if (forgeRepo.forge === "origin") {
      const checked = await run(repoDir, [
        "origin",
        "pr",
        "checks",
        target,
        "-R",
        forgeRepo.slug,
        "--json",
        "id,name,status,conclusion,detailsUrl",
      ]);
      return summarizeChecks(parseCheckRows(checked.stdout));
    }
    if (!outcome.prNumber) {
      return { checkStatus: "none", checkCount: 0 };
    }
    const checked = await run(repoDir, [
      "gh",
      "pr",
      "checks",
      String(outcome.prNumber),
      "--json",
      "name,state,conclusion",
    ]);
    return summarizeChecks(parseCheckRows(checked.stdout));
  } catch (err) {
    const message = err instanceof Error ? err.message : "checks failed";
    if (/no checks|not found|without checks/i.test(message)) {
      return { checkStatus: "none", checkCount: 0 };
    }
    return { checkStatus: "error", checkCount: 0 };
  }
}

export function isMergeRace(message: string): boolean {
  return /ref updates rejected|updated by another push|stack head conflicts|needs restack|stack parent/i.test(
    message,
  );
}

export async function clearOriginStack(repoDir: string, repo: string, target: string): Promise<void> {
  try {
    await run(repoDir, ["origin", "pr", "edit", target, "-R", repo, "--clear-stack"]);
  } catch {
    // already a sibling change, or the hidden flag is a no-op
  }
}

export async function mergeIndependentChange(options: {
  repoDir: string;
  forgeRepo: ForgeRepo;
  baseBranch: string;
  outcome: TicketOutcome;
  body: string;
}): Promise<void> {
  let lastError = "merge failed";
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    try {
      if (options.forgeRepo.forge === "origin" && options.outcome.prNumber) {
        await clearOriginStack(options.repoDir, options.forgeRepo.slug, String(options.outcome.prNumber));
      }
      await mergeChange(options.repoDir, options.forgeRepo, options.outcome);
      return;
    } catch (err) {
      lastError = err instanceof Error ? err.message : "merge failed";
      if (!isMergeRace(lastError) || attempt === 8) {
        throw err;
      }
      await restackOntoMain(options);
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 80 * attempt);
      });
    }
  }
  throw new Error(lastError);
}

async function restackOntoMain(options: {
  repoDir: string;
  forgeRepo: ForgeRepo;
  baseBranch: string;
  outcome: TicketOutcome;
  body: string;
}): Promise<void> {
  const latest = await resolveStartSha(options.repoDir, options.forgeRepo.remote, options.baseBranch);
  const commit = await writeUniqueCommit({
    repoDir: options.repoDir,
    parentSha: latest,
    path: options.outcome.path,
    body: options.body,
    message: `throttle ticket ${String(options.outcome.seq).padStart(4, "0")} restack`,
  });
  await runProc(options.repoDir, [
    "git",
    "push",
    "--force-with-lease",
    options.forgeRepo.remote,
    `${commit}:refs/heads/${options.outcome.branch}`,
  ]);
  if (options.forgeRepo.forge !== "origin") return;
  const target = options.outcome.prNumber ? String(options.outcome.prNumber) : options.outcome.branch;
  try {
    await run(options.repoDir, ["origin", "pr", "refresh", target, "-R", options.forgeRepo.slug]);
  } catch {
    // refresh is best-effort; merge retry still runs
  }
  await clearOriginStack(options.repoDir, options.forgeRepo.slug, target);
}

export async function mergeOriginPr(repoDir: string, repo: string, target: string): Promise<void> {
  await runWithMergeRetry(repoDir, ["origin", "pr", "merge", target, "-R", repo, "--squash"]);
}

async function mergeChange(repoDir: string, forgeRepo: ForgeRepo, outcome: TicketOutcome): Promise<void> {
  const target = outcome.prNumber ? String(outcome.prNumber) : outcome.branch;
  const argv =
    forgeRepo.forge === "origin"
      ? ["origin", "pr", "merge", target, "-R", forgeRepo.slug, "--squash"]
      : outcome.prNumber
        ? ["gh", "pr", "merge", String(outcome.prNumber), "--squash"]
        : null;
  if (!argv) {
    throw new Error("cannot merge GitHub PR without a number");
  }
  await runWithMergeRetry(repoDir, argv);
}

async function runWithMergeRetry(cwd: string, argv: string[]): Promise<ProcResult> {
  let lastError = "merge failed";
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    try {
      return await run(cwd, argv);
    } catch (err) {
      lastError = err instanceof Error ? err.message : "merge failed";
      if (!isMergeRace(lastError) || attempt === 8) {
        throw err;
      }
      await new Promise<void>((resolve) => {
        setTimeout(resolve, 150 * attempt);
      });
    }
  }
  throw new Error(lastError);
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
