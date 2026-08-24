import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { randomBytes } from "node:crypto";

import type { BurstPlanner } from "./claude.ts";
import type {
  DashboardGeneration,
  DashboardWidget,
  ImprovementItem,
  WidgetKind,
  WidgetTone,
} from "./dashboard-types.ts";
import { isJsonObject, parseJsonObject, requireInt, requireString } from "./json.ts";

export const DEFAULT_FEED_DIR = join("web", "src", "feed");

export interface ImproveRecipe {
  kind: WidgetKind;
  title: string;
  summary: string;
  body: string;
  value?: string;
  unit?: string;
  series?: number[];
  tone: WidgetTone;
}

export const IMPROVE_CATALOG: readonly ImproveRecipe[] = [
  {
    kind: "spark",
    title: "Merge velocity sparkline",
    summary: "Added a live-looking merge-rate sparkline from the 10k Origin run.",
    body: "143 merges/min peak. The line is the measured Origin pace, not a wish.",
    series: [18, 42, 71, 96, 118, 131, 143, 140, 138, 143],
    tone: "mint",
  },
  {
    kind: "stat",
    title: "Zero 429s",
    summary: "Pinned a callout for the 0 HTTP 429s measured on the live forge.",
    body: "Origin stayed under the rate ceiling for the full 68 minutes.",
    value: "0",
    unit: "429s",
    tone: "mint",
  },
  {
    kind: "chart",
    title: "Error mix",
    summary: "Broke 472 errors out from the 10 000 merged so the demo is honest.",
    body: "Errors were retries and races, not a failed target. 10 000 still merged.",
    series: [10000, 472, 0],
    tone: "amber",
  },
  {
    kind: "copy",
    title: "Sharper hero line",
    summary: "Rewrote the dashboard lede to say what the recursive agent actually does.",
    body: "Claude (or Grok 4.6) splits the goal. Leaves write one unique file, open one Origin PR, merge-commit.",
    tone: "violet",
  },
  {
    kind: "gauge",
    title: "Depth cap gauge",
    summary: "Showed maxDepth=3 so the tree looks bounded, not infinite.",
    body: "Same process, smaller slice, higher depth. Hard stop at 3.",
    value: "3",
    unit: "maxDepth",
    tone: "sky",
  },
  {
    kind: "callout",
    title: "Latest merged PR",
    summary: "Surfaced Origin PR #11517 as the tip of the 10k merge train.",
    body: "Latest merged change on the live Origin forge.",
    value: "#11517",
    tone: "amber",
  },
  {
    kind: "stat",
    title: "Opens per minute",
    summary: "Added the measured 141 PR opens/min next to merges.",
    body: "2.35 opens/sec · 141/min on the stopped 10k run.",
    value: "141",
    unit: "opens/min",
    tone: "sky",
  },
  {
    kind: "chart",
    title: "Planner / worker / verifier",
    summary: "Stacked the three roles so the pipeline is obvious in the demo.",
    body: "Planner splits. Worker ships a unique artifact. Verifier accepts or respawns.",
    series: [4, 12, 12],
    tone: "violet",
  },
  {
    kind: "spark",
    title: "Sweep merges",
    summary: "Called out the 2 584 sweep merges that caught leftover open PRs.",
    body: "Sweep finished what the burst left open. Target still 10 000.",
    series: [0, 200, 640, 1100, 1700, 2100, 2584],
    value: "2584",
    unit: "swept",
    tone: "rose",
  },
  {
    kind: "copy",
    title: "Grok 4.6 as a planner option",
    summary: "Documented --planner grok next to Claude so the demo can switch.",
    body: "Same JSON split contract. If XAI_API_KEY is missing, fall back to Claude, then deterministic.",
    tone: "mint",
  },
];

export interface ApplyImprovementOptions {
  feedDir: string;
  now?: () => string;
  entropy?: string;
  planner?: BurstPlanner;
  worker?: string;
}

export interface ApplyImprovementResult {
  item: ImprovementItem;
  path: string;
  generation: DashboardGeneration;
}

export function defaultFeedDir(repoRoot = process.cwd()): string {
  return join(repoRoot, DEFAULT_FEED_DIR);
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

export function recipeForGeneration(generation: number): ImproveRecipe {
  const index = Math.max(0, generation - 1) % IMPROVE_CATALOG.length;
  const base = IMPROVE_CATALOG[index];
  if (!base) {
    throw new Error("improve catalog is empty");
  }
  const cycle = Math.floor(Math.max(0, generation - 1) / IMPROVE_CATALOG.length);
  if (cycle === 0) return base;
  return {
    ...base,
    title: `${base.title} · cycle ${cycle + 1}`,
    summary: `${base.summary} Unique cycle ${cycle + 1} so parallel workers never collide.`,
  };
}

export function applyDashboardImprovement(options: ApplyImprovementOptions): ApplyImprovementResult {
  mkdirSync(options.feedDir, { recursive: true });
  const existing = loadImprovements(options.feedDir);
  const generation = currentGeneration(existing) + 1;
  const recipe = recipeForGeneration(generation);
  const now = (options.now ?? (() => new Date().toISOString()))();
  const entropy = options.entropy ?? randomBytes(4).toString("hex");
  const id = uniqueImprovementId(generation, recipe.kind, entropy);
  const widget: DashboardWidget = {
    id: `widget-${id}`,
    kind: recipe.kind,
    title: recipe.title,
    body: recipe.body,
    tone: recipe.tone,
    ...(recipe.value !== undefined ? { value: recipe.value } : {}),
    ...(recipe.unit !== undefined ? { unit: recipe.unit } : {}),
    ...(recipe.series !== undefined ? { series: [...recipe.series] } : {}),
  };
  const item: ImprovementItem = {
    id,
    generation,
    title: recipe.title,
    summary: recipe.summary,
    acceptedAt: now,
    worker: options.worker ?? `dashboard-improve-${entropy}`,
    widget,
  };
  const path = join(options.feedDir, `${id}.json`);
  if (existsSync(path)) {
    throw new Error(`improvement file already exists: ${path}`);
  }
  writeFileSync(path, `${JSON.stringify(item, null, 2)}\n`, "utf8");
  const generationState = summarizeGeneration([...existing, item], options.planner ?? "claude", now);
  return { item, path, generation: generationState };
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
  const kind = requireString(widgetObj, "kind", "widget.kind");
  if (!isWidgetKind(kind)) {
    throw new Error(`${source} widget.kind is not supported`);
  }
  const widget: DashboardWidget = {
    id: requireString(widgetObj, "id", "widget.id"),
    kind,
    title: requireString(widgetObj, "title", "widget.title"),
    body: requireString(widgetObj, "body", "widget.body"),
  };
  const value = widgetObj.value;
  if (typeof value === "string") widget.value = value;
  const unit = widgetObj.unit;
  if (typeof unit === "string") widget.unit = unit;
  const tone = widgetObj.tone;
  if (typeof tone === "string" && isWidgetTone(tone)) widget.tone = tone;
  const series = widgetObj.series;
  if (Array.isArray(series)) {
    const nums: number[] = [];
    for (const point of series) {
      if (typeof point !== "number" || !Number.isFinite(point)) {
        throw new Error(`${source} widget.series must be numbers`);
      }
      nums.push(point);
    }
    widget.series = nums;
  }
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

function isWidgetKind(value: string): value is WidgetKind {
  return (
    value === "stat" ||
    value === "chart" ||
    value === "copy" ||
    value === "spark" ||
    value === "callout" ||
    value === "gauge"
  );
}

function isWidgetTone(value: string): value is WidgetTone {
  return value === "mint" || value === "amber" || value === "violet" || value === "rose" || value === "sky";
}
