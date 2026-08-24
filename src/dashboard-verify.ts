import type { DashboardMemory } from "./dashboard-types.ts";

export interface VerifyIssue {
  code: string;
  message: string;
}

export type VerifyVerdict = { ok: true } | { ok: false; issues: VerifyIssue[] };

const FORBIDDEN = [
  { code: "comic-sans", pattern: /comic sans/i, message: "patch restores Comic Sans" },
  { code: "papyrus", pattern: /papyrus/i, message: "patch restores Papyrus" },
  { code: "tickets-400", pattern: /400 tickets/i, message: "patch or feed writes 400 tickets" },
  {
    code: "negative-claude",
    pattern: /claude does not write/i,
    message: "patch or feed uses the negative Claude line",
  },
] as const;

export function verifyDashboardGeneration(input: {
  patchCss: string;
  feedJson: string;
  memory: DashboardMemory;
}): VerifyVerdict {
  const issues: VerifyIssue[] = [];
  const blob = `${input.patchCss}\n${input.feedJson}`;
  for (const rule of FORBIDDEN) {
    if (rule.pattern.test(blob)) {
      issues.push({ code: rule.code, message: rule.message });
    }
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
