import type { DashboardMemory } from "./dashboard-types.ts";

export interface VerifyIssue {
  code: string;
  message: string;
}

export type VerifyVerdict = { ok: true } | { ok: false; issues: VerifyIssue[] };

export function verifyDashboardGeneration(input: {
  patchCss: string;
  feedJson: string;
  memory: DashboardMemory;
}): VerifyVerdict {
  const issues: VerifyIssue[] = [];
  if (/comic sans/i.test(input.patchCss)) {
    issues.push({ code: "comic-sans", message: "patch restores Comic Sans" });
  }
  if (/papyrus/i.test(input.patchCss)) {
    issues.push({ code: "papyrus", message: "patch restores Papyrus" });
  }
  if (/\b400 tickets\b/i.test(input.feedJson) && !/no 400-ticket/i.test(input.feedJson)) {
    issues.push({ code: "tickets-400", message: "feed writes 400 tickets" });
  }
  if (/claude does not write/i.test(input.feedJson)) {
    issues.push({ code: "negative-claude", message: "feed uses the negative Claude line" });
  }
  if (input.memory.qualityBar !== "highest") {
    issues.push({ code: "quality-bar", message: "qualityBar must stay highest" });
  }
  if (input.memory.generation < 1) {
    issues.push({ code: "generation", message: "accepted generation must be >= 1" });
  }
  if (input.memory.generation >= 1 && input.memory.doNotRegress.length === 0) {
    issues.push({ code: "memory", message: "doNotRegress must grow after the first repair" });
  }
  if (input.memory.generation >= 1 && /transform:\s*rotate\s*\(/i.test(input.patchCss)) {
    issues.push({ code: "rotated-hero", message: "patch rotates the UI after gen 0" });
  }
  if (issues.length > 0) {
    return { ok: false, issues };
  }
  return { ok: true };
}
