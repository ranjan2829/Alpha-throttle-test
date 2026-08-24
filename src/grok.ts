import type { ClaudeClient } from "./claude.ts";
import { parseJsonObject } from "./json.ts";

export const DEFAULT_GROK_MODEL = "grok-4.6";
export const GROK_MODEL_FALLBACKS = ["grok-4.6", "grok-4", "grok-3"] as const;
export const XAI_CHAT_COMPLETIONS_URL = "https://api.x.ai/v1/chat/completions";

export interface GrokCompleteOptions {
  apiKey: string;
  model?: string;
  system: string;
  prompt: string;
  maxTokens?: number;
  fetchImpl?: typeof fetch;
}

export function readGrokApiKey(env: NodeJS.ProcessEnv = process.env): string | null {
  const key = env.XAI_API_KEY ?? env.GROK_API_KEY;
  if (typeof key !== "string") return null;
  const trimmed = key.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function createGrokClient(
  apiKey: string,
  options: { model?: string; fetchImpl?: typeof fetch } = {},
): ClaudeClient {
  return {
    complete(system, prompt) {
      return grokComplete({
        apiKey,
        system,
        prompt,
        ...(options.model ? { model: options.model } : {}),
        ...(options.fetchImpl ? { fetchImpl: options.fetchImpl } : {}),
      });
    },
  };
}

export function resolveGrokModels(preferred?: string): string[] {
  const fromEnv = process.env.GROK_MODEL?.trim();
  const first = preferred ?? (fromEnv && fromEnv.length > 0 ? fromEnv : DEFAULT_GROK_MODEL);
  const rest = GROK_MODEL_FALLBACKS.filter((model) => model !== first);
  return [first, ...rest];
}

export async function grokComplete(options: GrokCompleteOptions): Promise<string> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const models = options.model ? [options.model] : resolveGrokModels();
  let lastError = "Grok request failed";
  for (const model of models) {
    const response = await fetchImpl(XAI_CHAT_COMPLETIONS_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${options.apiKey}`,
      },
      body: JSON.stringify({
        model,
        max_tokens: options.maxTokens ?? 1024,
        messages: [
          { role: "system", content: options.system },
          { role: "user", content: options.prompt },
        ],
      }),
    });
    const text = await response.text();
    if (response.ok) {
      return extractGrokText(text);
    }
    lastError = `Grok HTTP ${response.status}: ${text.slice(0, 400)}`;
    if (response.status !== 404) {
      throw new Error(lastError);
    }
  }
  throw new Error(lastError);
}

export function extractGrokText(body: string): string {
  const obj = parseJsonObject(body, "grok-response");
  const choices = obj.choices;
  if (!Array.isArray(choices) || choices.length === 0) {
    throw new Error("Grok response had no choices");
  }
  const chunks: string[] = [];
  for (const item of choices) {
    if (typeof item !== "object" || item === null || Array.isArray(item)) continue;
    const message = item.message;
    if (typeof message !== "object" || message === null || Array.isArray(message)) continue;
    const content = message.content;
    if (typeof content === "string" && content.trim().length > 0) {
      chunks.push(content);
    }
  }
  const joined = chunks.join("\n").trim();
  if (joined.length === 0) {
    throw new Error("Grok response had no text");
  }
  return joined;
}
