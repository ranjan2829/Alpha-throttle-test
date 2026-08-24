import type { BurstPlanner } from "./claude.ts";

export type WidgetKind = "stat" | "chart" | "copy" | "spark" | "callout" | "gauge";
export type WidgetTone = "mint" | "amber" | "violet" | "rose" | "sky";

export interface DashboardWidget {
  id: string;
  kind: WidgetKind;
  title: string;
  body: string;
  value?: string;
  unit?: string;
  series?: number[];
  tone?: WidgetTone;
}

export interface ImprovementItem {
  id: string;
  generation: number;
  title: string;
  summary: string;
  acceptedAt: string;
  worker: string;
  widget: DashboardWidget;
}

export interface OriginLiveStats {
  measuredAt: string;
  status: "stopped" | "running";
  forge: string;
  repo: string;
  author: string;
  targetMerged: number;
  tried: number;
  opened: number;
  merged: number;
  sweptMerged: number;
  errors: number;
  throttled429: number;
  wallMin: number;
  openedPerSec: number;
  openedPerMin: number;
  mergedPerSec: number;
  mergedPerMin: number;
  latestMergedPr: number;
}

export interface AgentTreeNode {
  id: string;
  label: string;
  role: "root" | "planner" | "worker" | "verifier" | "merge";
  planner?: BurstPlanner;
  depth: number;
  status: "queued" | "running" | "done";
  detail: string;
  children: AgentTreeNode[];
}

export interface DashboardGeneration {
  generation: number;
  version: string;
  updatedAt: string;
  planner: BurstPlanner;
  itemCount: number;
}
