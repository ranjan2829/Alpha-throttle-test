import { existsSync, readFileSync } from "node:fs";

import { parseJsonObject, requireArray } from "./json.ts";

export const DEFAULT_CLAUDE_MODEL = "claude-sonnet-5";
export const CLAUDE_MODEL_FALLBACKS = [
  "claude-sonnet-5",
  "claude-sonnet-4-6",
  "claude-sonnet-4-5-20250929",
  "claude-haiku-4-5-20251001",
] as const;
export const ANTHROPIC_MESSAGES_URL = "https://api.anthropic.com/v1/messages";

export interface ClaudeClient {
  complete(system: string, prompt: string): Promise<string>;
}

export interface ClaudeCompleteOptions {
  apiKey: string;
  model?: string;
  system: string;
  prompt: string;
  maxTokens?: number;
  fetchImpl?: typeof fetch;
}

export type BurstPlanner = "claude" | "grok" | "deterministic";

export interface BurstSplit {
  kind: "leaf" | "parts";
  parts: number[];
  planner: BurstPlanner;
}

export function loadDotEnv(
  filePath = ".env",
  env: NodeJS.ProcessEnv = process.env,
): void {
  if (!existsSync(filePath)) return;
  const text = readFileSync(filePath, "utf8");
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.length === 0 || line.startsWith("#")) continue;
    const stripped = line.startsWith("export ") ? line.slice(7) : line;
    const eq = stripped.indexOf("=");
    if (eq <= 0) continue;
    const name = stripped.slice(0, eq).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(name)) continue;
    if (env[name] !== undefined && env[name] !== "") continue;
    let value = stripped.slice(eq + 1).trim();
    if (
      (value.startsWith("\"") && value.endsWith("\"")) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    env[name] = value;
  }
}

export function readClaudeApiKey(
  env: NodeJS.ProcessEnv = process.env,
): string | null {
  if (env === process.env) {
    loadDotEnv(".env", env);
  }
  const key = env.ANTHROPIC_API_KEY ?? env.CLAUDE_API_KEY;
  if (typeof key !== "string") return null;
  const trimmed = key.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function createClaudeClient(
  apiKey: string,
  options: { model?: string; fetchImpl?: typeof fetch } = {},
): ClaudeClient {
  return {
    complete(system, prompt) {
      return claudeComplete({
        apiKey,
        system,
        prompt,
        ...(options.model ? { model: options.model } : {}),
        ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      });
    },
  };
}

export function resolveClaudeModels(preferred?: string): string[] {
  const fromEnv = process.env.CLAUDE_MODEL?.trim();
  const first = preferred ?? (fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_CLAUDE_MODEL);
  const rest = CLAUDE_MODEL_FALLBACKS.filter((model) => model !== first);
  return [first, ...rest];
}

export async function claudeComplete(options: ClaudeCompleteOptions): Promise<string> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const models = options.model ? [options.model] : resolveClaudeModels();
  let lastError = "Claude request failed";
  for (const model of models) {
    const response = await fetchImpl(ANTHROPIC_MESSAGES_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": options.apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model,
        max_tokens: options.maxTokens ?? 1024,
        system: options.system,
        messages: [{ role: "user", content: options.prompt }],
      }),
    });
    const text = await response.text();
    if (response.ok) {
      return extractClaudeText(text);
    }
    lastError = `Claude HTTP ${response.status}: ${text.slice(0, 400)}`;
    if (response.status !== 404) {
      throw new Error(lastError);
    }
  }
  throw new Error(lastError);
}

export function extractClaudeText(body: string): string {
  const obj = parseJsonObject(body, "claude-response");
  const content = requireArray(obj, "content");
  const chunks: string[] = [];
  for (const item of content) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
    const block = item;
    if (block.type === "text" && typeof block.text === "string") {
      chunks.push(block.text);
    }
  }
  const joined = chunks.join("\n").trim();
  if (joined.length === 0) {
    throw new Error("Claude response had no text");
  }
  return joined;
}

export function stripJsonFence(text: string): string {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  return (fenced?.[1] ?? text).trim();
}

export function parseBurstSplit(text: string, ticketCount: number): BurstSplit {
  const obj = parseJsonObject(stripJsonFence(text), "claude-split");
  const kind = obj.kind;
  if (kind === "leaf") {
    return { kind: "leaf", parts: [ticketCount], planner: "claude" };
  }
  if (kind !== "parts") {
    throw new Error("claude-split kind must be leaf | parts");
  }
  const raw = requireArray(obj, "parts");
  const parts: number[] = [];
  for (const item of raw) {
    if (typeof item !== "number" || !Number.isInteger(item) || item <= 0) {
      throw new Error("claude-split parts must be positive integers");
    }
    parts.push(item);
  }
  if (parts.length < 2) {
    throw new Error("claude-split parts need at least two groups");
  }
  const sum = parts.reduce((acc, n) => acc + n, 0);
  if (sum !== ticketCount) {
    throw new Error(`claude-split parts sum ${sum} != ticketCount ${ticketCount}`);
  }
  return { kind: "parts", parts, planner: "claude" };
}

export function deterministicBurstSplit(
  ticketCount: number,
  depth: number,
  maxDepth: number,
): BurstSplit {
  if (ticketCount < 4 || depth + 1 >= maxDepth) {
    return { kind: "leaf", parts: [ticketCount], planner: "deterministic" };
  }
  const mid = Math.ceil(ticketCount / 2);
  return { kind: "parts", parts: [mid, ticketCount - mid], planner: "deterministic" };
}

export async function planBurstSplit(options: {
  claude: ClaudeClient | null;
  ticketCount: number;
  depth: number;
  maxDepth: number;
  plannerName?: BurstPlanner;
}): Promise<BurstSplit> {
  const fallback = deterministicBurstSplit(options.ticketCount, options.depth, options.maxDepth);
  const plannerName = options.plannerName ?? (options.claude ? "claude" : "deterministic");
  if (!options.claude || fallback.kind === "leaf") {
    return fallback;
  }
  try {
    const text = await options.claude.complete(
      "You are the root planner of a recursive Origin throttle agent. Reply with JSON only.",
      [
        `Split ${options.ticketCount} isolated PRs into two or more groups.`,
        `depth=${options.depth} maxDepth=${options.maxDepth}`,
        "Each leaf worker opens one unique-file PR, checks the build, then merges.",
        'Return {"kind":"parts","parts":[n,n,...]} and the integers must sum to the ticket count.',
        'If you should not split, return {"kind":"leaf"}.',
      ].join("\n"),
    );
    const tagged: BurstPlanner = plannerName === "deterministic" ? "claude" : plannerName;
    return { ...parseBurstSplit(text, options.ticketCount), planner: tagged };
  } catch {
    return fallback;
  }
}

export function parseClaudeGoalSlices(text: string): string[] {
  const obj = parseJsonObject(stripJsonFence(text), "claude-goal");
  const raw = requireArray(obj, "slices");
  const slices: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string" || item.trim().length === 0) {
      throw new Error("claude-goal slices must be non-empty strings");
    }
    slices.push(item.trim());
  }
  if (slices.length === 0) {
    throw new Error("claude-goal slices must not be empty");
  }
  return slices;
}
