import { mergeOriginPr, parseCheckRows, summarizeChecks } from "./adapter.ts";
import type { CheckStatus } from "./types.ts";
import { spawn } from "node:child_process";

export interface FinishRow {
  number: number;
  title: string;
  status: string;
  checkStatus: CheckStatus;
  checkCount: number;
  merged: boolean;
  error: string | null;
}

export interface FinishResult {
  repo: string;
  attempted: number;
  checked: number;
  merged: number;
  buildFailed: number;
  errors: number;
  rows: FinishRow[];
}

interface ListedChange {
  number: number;
  title: string;
  status: string;
}

export async function finishOpenOriginChanges(options: {
  repoDir: string;
  repo: string;
  limit: number;
  concurrency: number;
}): Promise<FinishResult> {
  const listed = await runJson(options.repoDir, [
    "origin",
    "pr",
    "list",
    "-R",
    options.repo,
    "--state",
    "open",
    "-L",
    String(options.limit),
    "--json",
    "number,title,status",
  ]);
  const changes = parseListed(listed).filter((change) => /throttle ticket/i.test(change.title));
  const rows: FinishRow[] = [];
  const pending = [...changes];
  const running = new Map<number, Promise<void>>();

  const startNext = (): void => {
    while (running.size < options.concurrency && pending.length > 0) {
      const change = pending.shift();
      if (!change) break;
      const job = finishOne(options.repoDir, options.repo, change)
        .then((row) => {
          rows.push(row);
        })
        .finally(() => {
          running.delete(change.number);
        });
      running.set(change.number, job);
    }
  };

  startNext();
  while (running.size > 0) {
    await Promise.race(running.values());
    startNext();
  }

  rows.sort((a, b) => a.number - b.number);
  return {
    repo: options.repo,
    attempted: rows.length,
    checked: rows.filter((row) => row.checkStatus !== "error").length,
    merged: rows.filter((row) => row.merged).length,
    buildFailed: rows.filter((row) => row.checkStatus === "failure").length,
    errors: rows.filter((row) => row.error !== null).length,
    rows,
  };
}

async function finishOne(repoDir: string, repo: string, change: ListedChange): Promise<FinishRow> {
  try {
    const checked = await runText(repoDir, [
      "origin",
      "pr",
      "checks",
      String(change.number),
      "-R",
      repo,
      "--json",
      "id,name,status,conclusion,detailsUrl",
    ]);
    const summary = summarizeChecks(parseCheckRows(checked));
    if (summary.checkStatus === "failure") {
      return {
        number: change.number,
        title: change.title,
        status: change.status,
        checkStatus: summary.checkStatus,
        checkCount: summary.checkCount,
        merged: false,
        error: "build failed",
      };
    }
    await mergeOriginPr(repoDir, repo, String(change.number));
    return {
      number: change.number,
      title: change.title,
      status: "merged",
      checkStatus: summary.checkStatus,
      checkCount: summary.checkCount,
      merged: true,
      error: null,
    };
  } catch (err) {
    return {
      number: change.number,
      title: change.title,
      status: change.status,
      checkStatus: "error",
      checkCount: 0,
      merged: false,
      error: err instanceof Error ? err.message : "finish failed",
    };
  }
}

function parseListed(text: string): ListedChange[] {
  const parsed: unknown = JSON.parse(text);
  if (!Array.isArray(parsed)) {
    return [];
  }
  const rows: ListedChange[] = [];
  for (const item of parsed) {
    if (typeof item !== "object" || item === null) continue;
    const record = item as { number?: number; title?: string; status?: string };
    if (typeof record.number !== "number") continue;
    rows.push({
      number: record.number,
      title: typeof record.title === "string" ? record.title : `#${record.number}`,
      status: typeof record.status === "string" ? record.status : "open",
    });
  }
  return rows;
}

function runText(cwd: string, argv: string[]): Promise<string> {
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
      if (code === 0) resolve(stdout);
      else reject(new Error(`${argv.join(" ")} exited ${code}: ${stderr.trim() || stdout.trim()}`));
    });
  });
}

function runJson(cwd: string, argv: string[]): Promise<string> {
  return runText(cwd, argv);
}
