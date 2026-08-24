import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { randomBytes } from "node:crypto";

import type { BurstPlanner } from "./claude.ts";
import { repairForDefect } from "./dashboard-repairs.ts";
import {
  defaultMemoryPath,
  emptyMemory,
  loadMemory,
  nextOpenDefect,
  openNextQualityBacklog,
  rememberRepair,
  saveMemory,
} from "./dashboard-memory.ts";
import type {
  DashboardGeneration,
  DashboardMemory,
  DashboardWidget,
  ImprovementItem,
  MemoryEntry,
} from "./dashboard-types.ts";
import { isJsonObject, parseJsonObject, requireInt, requireString } from "./json.ts";

export const DEFAULT_FEED_DIR = join("web", "src", "feed");
export const DEFAULT_WEB_SRC = join("web", "src");

export interface ApplyImprovementOptions {
  feedDir?: string;
  webSrc?: string;
  now?: () => string;
  entropy?: string;
  planner?: BurstPlanner;
  worker?: string;
  /** Operator halt. Only this flag may stop the loop when no defects are open. */
  stop?: boolean;
}

export interface ApplyImprovementResult {
  item: ImprovementItem;
  path: string;
  patchPath: string;
  generation: DashboardGeneration;
  memory: DashboardMemory;
}

export function defaultFeedDir(repoRoot = process.cwd()): string {
  return join(repoRoot, DEFAULT_FEED_DIR);
}

export function defaultWebSrc(repoRoot = process.cwd()): string {
  return join(repoRoot, DEFAULT_WEB_SRC);
}

export function resolveWebSrc(options: ApplyImprovementOptions, repoRoot = process.cwd()): string {
  if (options.webSrc) return options.webSrc;
  if (options.feedDir) return dirname(options.feedDir);
  return defaultWebSrc(repoRoot);
}

export function listImprovementFiles(feedDir: string): string[] {
  if (!existsSync(feedDir)) return [];
  return readdirSync(feedDir)
    .filter((name) => name.endsWith(".json"))
    .sort();
}

export function loadImprovements(feedDir: string): ImprovementItem[] {
  const items: ImprovementItem[] = [];
  for (const name of listImprovementFiles(feedDir)) {
    const raw = readFileSync(join(feedDir, name), "utf8");
    items.push(parseImprovementItem(raw, name));
  }
  return items.sort((a, b) => a.generation - b.generation || a.id.localeCompare(b.id));
}

export function currentGeneration(items: ImprovementItem[]): number {
  if (items.length === 0) return 0;
  return items.reduce((max, item) => Math.max(max, item.generation), 0);
}

export function summarizeGeneration(
  items: ImprovementItem[],
  planner: BurstPlanner = "claude",
  now = new Date().toISOString(),
): DashboardGeneration {
  const generation = currentGeneration(items);
  return {
    generation,
    version: `0.${generation}.0`,
    updatedAt: items.at(-1)?.acceptedAt ?? now,
    planner,
    itemCount: items.length,
  };
}

export function applyDashboardImprovement(options: ApplyImprovementOptions): ApplyImprovementResult {
  const webSrc = resolveWebSrc(options);
  const feedDir = options.feedDir ?? join(webSrc, "feed");
  const memoryPath = join(webSrc, "memory.json");
  const patchesDir = join(webSrc, "patches");
  const patchesIndex = join(webSrc, "patches.ts");
  mkdirSync(feedDir, { recursive: true });
  mkdirSync(patchesDir, { recursive: true });

  let memory = existsSync(memoryPath) ? loadMemory(memoryPath) : emptyMemory();
  let defect = nextOpenDefect(memory);
  if (!defect) {
    if (options.stop) {
      throw new Error("dashboard memory has no open defects — operator requested stop");
    }
    memory = openNextQualityBacklog(memory);
    defect = nextOpenDefect(memory);
    if (!defect) {
      throw new Error("dashboard quality catalog is exhausted — pass --stop to halt");
    }
  }
  const repair = repairForDefect(defect.id);
  if (!repair) {
    throw new Error(`no highest-quality repair registered for defect ${defect.id}`);
  }

  const generation = memory.generation + 1;
  const now = (options.now ?? (() => new Date().toISOString()))();
  const entropy = options.entropy ?? randomBytes(4).toString("hex");
  const id = uniqueImprovementId(generation, defect.id, entropy);
  const patchName = `${id}.css`;
  const patchPath = join(patchesDir, patchName);
  if (existsSync(patchPath)) {
    throw new Error(`repair file already exists: ${patchPath}`);
  }
  writeFileSync(patchPath, `${repair.css.trim()}\n`, "utf8");

  const entry: MemoryEntry = {
    generation,
    defectId: defect.id,
    title: repair.title,
    summary: repair.summary,
    files: [`patches/${patchName}`, "memory.json"],
    notes: repair.notes,
    acceptedAt: now,
    worker: options.worker ?? `dashboard-improve-${entropy}`,
  };
  const nextMemory = rememberRepair(memory, entry, repair.doNotRegress);
  saveMemory(memoryPath, nextMemory);
  writePatchesIndex(patchesIndex, listPatchFiles(patchesDir));

  const widget: DashboardWidget = {
    id: `widget-${id}`,
    kind: "copy",
    title: repair.title,
    body: repair.notes,
    tone: "mint",
  };
  const item: ImprovementItem = {
    id,
    generation,
    title: repair.title,
    summary: repair.summary,
    acceptedAt: now,
    worker: entry.worker,
    widget,
  };
  const path = join(feedDir, `${id}.json`);
  writeFileSync(path, `${JSON.stringify(item, null, 2)}\n`, "utf8");
  return {
    item,
    path,
    patchPath,
    generation: summarizeGeneration([...loadImprovements(feedDir)], options.planner ?? "claude", now),
    memory: nextMemory,
  };
}

export function uniqueImprovementId(generation: number, kind: string, entropy: string): string {
  const slug = kind.replace(/[^a-z0-9]+/g, "-");
  const token = entropy.replace(/[^a-z0-9]+/gi, "").toLowerCase() || "x";
  return `g${generation}-${slug}-${token}`;
}

export function parseImprovementItem(text: string, source: string): ImprovementItem {
  const obj = parseJsonObject(text, source);
  const widgetObj = obj.widget;
  if (!isJsonObject(widgetObj)) {
    throw new Error(`${source} widget must be an object`);
  }
  const widget: DashboardWidget = {
    id: requireString(widgetObj, "id", "widget.id"),
    kind: "copy",
    title: requireString(widgetObj, "title", "widget.title"),
    body: requireString(widgetObj, "body", "widget.body"),
  };
  return {
    id: requireString(obj, "id"),
    generation: requireInt(obj, "generation", 1),
    title: requireString(obj, "title"),
    summary: requireString(obj, "summary"),
    acceptedAt: requireString(obj, "acceptedAt"),
    worker: requireString(obj, "worker"),
    widget,
  };
}

function listPatchFiles(patchesDir: string): string[] {
  if (!existsSync(patchesDir)) return [];
  return readdirSync(patchesDir)
    .filter((name) => name.endsWith(".css"))
    .sort();
}

function writePatchesIndex(indexPath: string, files: string[]): void {
  const body =
    files.length === 0
      ? "export {};\n"
      : `${files.map((name) => `import "./patches/${name}";`).join("\n")}\n`;
  writeFileSync(indexPath, `/* generated by dashboard-improve — agent memory of CSS repairs */\n${body}`);
}

export { defaultMemoryPath, emptyMemory, loadMemory, nextOpenDefect, openNextQualityBacklog };
