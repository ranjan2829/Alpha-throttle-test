/** Kingsley Advani, 22 Aug 2026 — product brief for this repo. */
export const BRIEF_FROM = "Kingsley Advani";
export const BRIEF_DATE = "2026-08-22";

export const KINGSLEY_BRIEF = [
  "Cursor origin",
  "Alpha throttle test",
  "Make a recursive agent on cursor origin",
] as const;

export function kingsleyBriefText(): string {
  return `${BRIEF_FROM} (${BRIEF_DATE})
- ${KINGSLEY_BRIEF[0]}
- ${KINGSLEY_BRIEF[1]}
- ${KINGSLEY_BRIEF[2]}
`;
}
