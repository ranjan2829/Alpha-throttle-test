import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { unpublishedRepairs } from "./dashboard-repairs.ts";
import type { DashboardDefect, DashboardMemory, MemoryEntry } from "./dashboard-types.ts";
import { isJsonObject, parseJsonObject, requireInt, requireString } from "./json.ts";

export const DEFAULT_MEMORY_FILE = join("web", "src", "memory.json");

export const OPENING_DEFECTS: readonly DashboardDefect[] = [
  {
    id: "type",
    title: "Unreadable type and broken colors",
    status: "open",
    notes: "Comic Sans, clashing yellow/magenta, no box-sizing.",
  },
  {
    id: "header",
    title: "Header overlaps and floats apart",
    status: "open",
    notes: "Brand, generation chip, and Improve button sit on top of each other.",
  },
  {
    id: "layout",
    title: "No page layout",
    status: "open",
    notes: "Shell is too wide, hero is rotated, KPIs float and overflow.",
  },
  {
    id: "cards",
    title: "Pipeline and widgets have no structure",
    status: "open",
    notes: "Steps and worker cards are raw blocks with no rhythm.",
  },
  {
    id: "tree",
    title: "Depth tree and memory are unusable",
    status: "open",
    notes: "Nested nodes collapse; memory of prior work is easy to miss.",
  },
  {
    id: "polish",
    title: "No quality pass or mobile layout",
    status: "open",
    notes: "No spacing system, no responsive stack, no visual hierarchy.",
  },
];

export function emptyMemory(): DashboardMemory {
  return {
    generation: 0,
    qualityBar: "highest",
    defects: OPENING_DEFECTS.map((defect) => ({ ...defect })),
    history: [],
    doNotRegress: [],
  };
}

export function defaultMemoryPath(repoRoot = process.cwd()): string {
  return join(repoRoot, DEFAULT_MEMORY_FILE);
}

export function loadMemory(memoryPath: string): DashboardMemory {
  if (!existsSync(memoryPath)) {
    return emptyMemory();
  }
  return parseMemory(readFileSync(memoryPath, "utf8"), memoryPath);
}

export function saveMemory(memoryPath: string, memory: DashboardMemory): void {
  mkdirSync(dirname(memoryPath), { recursive: true });
  writeFileSync(memoryPath, `${JSON.stringify(memory, null, 2)}\n`, "utf8");
}

export function nextOpenDefect(memory: DashboardMemory): DashboardDefect | null {
  return memory.defects.find((defect) => defect.status === "open") ?? null;
}

export function publishedRepairIds(memory: DashboardMemory): string[] {
  return uniqueStrings([...memory.defects.map((defect) => defect.id), ...memory.history.map((entry) => entry.defectId)]);
}

/** Open the next unpublished catalog repair so the agent keeps doing highest-quality work. */
export function openNextQualityBacklog(memory: DashboardMemory): DashboardMemory {
  const next = unpublishedRepairs(publishedRepairIds(memory))[0];
  if (!next) return memory;
  return {
    ...memory,
    qualityBar: "highest",
    defects: [
      ...memory.defects,
      {
        id: next.defectId,
        title: next.title,
        status: "open",
        notes: next.summary,
      },
    ],
  };
}

export function rememberRepair(
  memory: DashboardMemory,
  entry: MemoryEntry,
  extraDoNotRegress: readonly string[],
): DashboardMemory {
  const defects = memory.defects.map((defect) =>
    defect.id === entry.defectId ? { ...defect, status: "fixed" as const } : defect,
  );
  const doNotRegress = uniqueStrings([...memory.doNotRegress, ...extraDoNotRegress, entry.title]);
  return {
    generation: entry.generation,
    qualityBar: "highest",
    defects,
    history: [...memory.history, entry],
    doNotRegress,
  };
}

export function parseMemory(text: string, source: string): DashboardMemory {
  const obj = parseJsonObject(text, source);
  const qualityBar = requireString(obj, "qualityBar", "qualityBar");
  if (qualityBar !== "highest") {
    throw new Error(`${source} qualityBar must be highest`);
  }
  return {
    generation: requireInt(obj, "generation", 0),
    qualityBar,
    defects: requireDefects(obj.defects, source),
    history: requireHistory(obj.history, source),
    doNotRegress: requireStringList(obj.doNotRegress, `${source} doNotRegress`),
  };
}

function requireDefects(value: unknown, source: string): DashboardDefect[] {
  if (!Array.isArray(value)) {
    throw new Error(`${source} defects must be an array`);
  }
  return value.map((row, index) => {
    if (!isJsonObject(row)) {
      throw new Error(`${source} defects[${index}] must be an object`);
    }
    const status = requireString(row, "status", `defects[${index}].status`);
    if (status !== "open" && status !== "fixed") {
      throw new Error(`${source} defects[${index}].status must be open|fixed`);
    }
    return {
      id: requireString(row, "id", `defects[${index}].id`),
      title: requireString(row, "title", `defects[${index}].title`),
      status,
      notes: requireString(row, "notes", `defects[${index}].notes`),
    };
  });
}

function requireHistory(value: unknown, source: string): MemoryEntry[] {
  if (!Array.isArray(value)) {
    throw new Error(`${source} history must be an array`);
  }
  return value.map((row, index) => {
    if (!isJsonObject(row)) {
      throw new Error(`${source} history[${index}] must be an object`);
    }
    return {
      generation: requireInt(row, "generation", 1),
      defectId: requireString(row, "defectId", `history[${index}].defectId`),
      title: requireString(row, "title", `history[${index}].title`),
      summary: requireString(row, "summary", `history[${index}].summary`),
      files: requireStringList(row.files, `${source} history[${index}].files`),
      notes: requireString(row, "notes", `history[${index}].notes`),
      acceptedAt: requireString(row, "acceptedAt", `history[${index}].acceptedAt`),
      worker: requireString(row, "worker", `history[${index}].worker`),
    };
  });
}

function requireStringList(value: unknown, label: string): string[] {
  if (!Array.isArray(value)) {
    throw new Error(`${label} must be an array of strings`);
  }
  return value.map((item, index) => {
    if (typeof item !== "string" || item.length === 0) {
      throw new Error(`${label}[${index}] must be a non-empty string`);
    }
    return item;
  });
}

function uniqueStrings(values: readonly string[]): string[] {
  return [...new Set(values)];
}
