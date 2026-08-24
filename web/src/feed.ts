import type { ImprovementItem } from "./types.ts";

const modules = import.meta.glob("./feed/*.json", { eager: true });

function isImprovementItem(value: unknown): value is ImprovementItem {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    typeof row.id === "string" &&
    typeof row.generation === "number" &&
    typeof row.title === "string" &&
    typeof row.summary === "string" &&
    typeof row.acceptedAt === "string" &&
    typeof row.worker === "string" &&
    typeof row.widget === "object" &&
    row.widget !== null
  );
}

export function loadBundledImprovements(): ImprovementItem[] {
  const items: ImprovementItem[] = [];
  for (const loaded of Object.values(modules)) {
    const value = (loaded as { default?: unknown }).default ?? loaded;
    if (isImprovementItem(value)) {
      items.push(value);
    }
  }
  return items.sort((a, b) => a.generation - b.generation || a.id.localeCompare(b.id));
}
