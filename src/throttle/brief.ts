export const PRODUCT_BRIEF = [
  "Cursor origin",
  "Alpha throttle test",
  "Make a recursive agent on cursor origin",
] as const;

export function productBriefText(): string {
  return `${PRODUCT_BRIEF[0]}
${PRODUCT_BRIEF[1]}
${PRODUCT_BRIEF[2]}
`;
}
