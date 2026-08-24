import { createClaudeClient, readClaudeApiKey, type BurstPlanner, type ClaudeClient } from "./claude.ts";
import { createGrokClient, readGrokApiKey } from "./grok.ts";

export type PlannerRequest = "auto" | "claude" | "grok" | "deterministic";

export interface ResolvedPlanner {
  kind: BurstPlanner;
  client: ClaudeClient | null;
  requested: PlannerRequest;
  fallback: boolean;
  reason: string;
}

export function parsePlannerRequest(raw: string | undefined, switches: Set<string>): PlannerRequest {
  if (raw === "claude" || raw === "grok" || raw === "auto" || raw === "deterministic") {
    return raw;
  }
  if (switches.has("grok")) return "grok";
  if (switches.has("claude")) return "claude";
  if (raw !== undefined) {
    throw new Error("--planner must be auto | claude | grok | deterministic");
  }
  return "auto";
}

export function resolvePlanner(options: {
  requested: PlannerRequest;
  env?: NodeJS.ProcessEnv;
  claudeFactory?: (key: string) => ClaudeClient;
  grokFactory?: (key: string) => ClaudeClient;
}): ResolvedPlanner {
  const env = options.env ?? process.env;
  const claudeKey = readClaudeApiKey(env);
  const grokKey = readGrokApiKey(env);
  const makeClaude = options.claudeFactory ?? createClaudeClient;
  const makeGrok = options.grokFactory ?? createGrokClient;

  if (options.requested === "deterministic") {
    return {
      kind: "deterministic",
      client: null,
      requested: options.requested,
      fallback: false,
      reason: "deterministic planner requested",
    };
  }

  if (options.requested === "grok") {
    if (grokKey) {
      return {
        kind: "grok",
        client: makeGrok(grokKey),
        requested: options.requested,
        fallback: false,
        reason: "Grok 4.6 planner (XAI_API_KEY)",
      };
    }
    if (claudeKey) {
      return {
        kind: "claude",
        client: makeClaude(claudeKey),
        requested: options.requested,
        fallback: true,
        reason: "Grok requested but no XAI_API_KEY; using Claude",
      };
    }
    return {
      kind: "deterministic",
      client: null,
      requested: options.requested,
      fallback: true,
      reason: "Grok requested but no XAI_API_KEY; deterministic split",
    };
  }

  if (options.requested === "claude") {
    if (claudeKey) {
      return {
        kind: "claude",
        client: makeClaude(claudeKey),
        requested: options.requested,
        fallback: false,
        reason: "Claude is the planner",
      };
    }
    return {
      kind: "deterministic",
      client: null,
      requested: options.requested,
      fallback: true,
      reason: "Claude requested but no ANTHROPIC_API_KEY; deterministic split",
    };
  }

  if (claudeKey) {
    return {
      kind: "claude",
      client: makeClaude(claudeKey),
      requested: options.requested,
      fallback: false,
      reason: "Claude is the planner",
    };
  }
  if (grokKey) {
    return {
      kind: "grok",
      client: makeGrok(grokKey),
      requested: options.requested,
      fallback: false,
      reason: "No Anthropic key; Grok 4.6 is the planner",
    };
  }
  return {
    kind: "deterministic",
    client: null,
    requested: options.requested,
    fallback: false,
    reason: "No planner key set; deterministic split",
  };
}
