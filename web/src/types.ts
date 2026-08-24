export type PlannerKind = "claude" | "grok" | "deterministic";
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

export interface TreeNode {
  id: string;
  label: string;
  role: "root" | "planner" | "worker" | "verifier" | "merge";
  planner?: PlannerKind;
  depth: number;
  status: "queued" | "running" | "done";
  detail: string;
  children: TreeNode[];
}

export interface ImproveApiResponse {
  ok: boolean;
  error?: string;
  result?: {
    item?: ImprovementItem;
    generation?: { generation: number; version: string };
  };
}
