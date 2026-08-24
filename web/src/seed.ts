import type { OriginLiveStats, TreeNode } from "./types.ts";

export const ORIGIN_STATS: OriginLiveStats = {
  measuredAt: "2026-08-23T20:22:44.734Z",
  status: "stopped",
  forge: "origin",
  repo: "allocations/Alpha-throttle-test",
  author: "ranjan-rgb <ranjan@allocations.com>",
  targetMerged: 10000,
  tried: 10000,
  opened: 10000,
  merged: 10000,
  sweptMerged: 2584,
  errors: 472,
  throttled429: 0,
  wallMin: 68,
  openedPerSec: 2.35,
  openedPerMin: 141,
  mergedPerSec: 2.38,
  mergedPerMin: 143,
  latestMergedPr: 11517,
};

export const AGENT_TREE: TreeNode = {
  id: "root",
  label: "recursive AI agent",
  role: "root",
  depth: 0,
  status: "done",
  detail: "Same process. Smaller slice. Higher depth. Caps: maxDepth=3 · 3 children · 2 respawns.",
  children: [
    {
      id: "planner-claude",
      label: "Claude Sonnet 5",
      role: "planner",
      planner: "claude",
      depth: 0,
      status: "done",
      detail: "JSON split · depth + 1. Claude is the planner when ANTHROPIC_API_KEY is set.",
      children: [
        plannerSlice("p1", 1, "claude", ["write unique ticket file", "open Origin PR", "merge-commit"]),
        plannerSlice("p2", 1, "claude", ["write unique ticket file", "open Origin PR", "merge-commit"]),
      ],
    },
    {
      id: "planner-grok",
      label: "Grok 4.6",
      role: "planner",
      planner: "grok",
      depth: 0,
      status: "queued",
      detail: "Optional --planner grok. Same JSON contract. Falls back if XAI_API_KEY is unset.",
      children: [
        plannerSlice("p3", 1, "grok", ["write unique ticket file", "open Origin PR", "merge-commit"]),
        plannerSlice("p4", 1, "grok", ["write unique ticket file", "open Origin PR", "merge-commit"]),
      ],
    },
  ],
};

function plannerSlice(id: string, depth: number, planner: "claude" | "grok", leaves: string[]): TreeNode {
  return {
    id,
    label: `planner depth ${depth}`,
    role: "planner",
    planner,
    depth,
    status: "done",
    detail: "Smaller slice. Recurse until maxDepth.",
    children: [
      {
        id: `${id}-leaf`,
        label: "leaf workers",
        role: "worker",
        depth: depth + 1,
        status: "done",
        detail: leaves.join(" · "),
        children: [
          {
            id: `${id}-verify`,
            label: "verifier",
            role: "verifier",
            depth: depth + 1,
            status: "done",
            detail: "Accept or reject. Reject respawns the worker.",
            children: [
              {
                id: `${id}-merge`,
                label: "merge",
                role: "merge",
                depth: depth + 1,
                status: "done",
                detail: "One unique file · one Origin PR · merge-commit",
                children: [],
              },
            ],
          },
        ],
      },
    ],
  };
}

export const PIPELINE = [
  { id: "plan", title: "Planner", body: "Claude or Grok 4.6 splits the goal into independent slices.", tone: "violet" },
  { id: "work", title: "Worker", body: "Each leaf writes one unique file. No sibling contact.", tone: "mint" },
  { id: "verify", title: "Verifier", body: "Accept or reject. A reject is how respawn happens.", tone: "amber" },
  { id: "merge", title: "Merge", body: "Origin PR, merge-commit — not squash. Caps stay hard.", tone: "sky" },
] as const;
