export const TASK_NAME_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export type TaskType = "worker" | "subplanner" | "verifier";

export type TaskStatus =
  | "pending"
  | "running"
  | "handed-off"
  | "rejected"
  | "error"
  | "cancelled"
  | "pruned"
  | "cap-hit";

export type HandoffStatus = "success" | "partial" | "blocked" | "error";

export type Verdict = "accept" | "reject";

export type AdapterKind = "local" | "files";

export interface Bounds {
  maxDepth: number;
  maxConcurrentChildren: number;
  maxResawnsPerTask: number;
}

export interface PlanTask {
  name: string;
  type: TaskType;
  scopedGoal: string;
  acceptance: string[];
  dependsOn: string[];
  verifies?: string;
  maxAttempts?: number;
}

export interface Plan {
  version: 1;
  goal: string;
  summary: string;
  rootSlug: string;
  bounds: Bounds;
  tasks: PlanTask[];
  done: boolean;
}

export interface Handoff {
  schemaVersion: 1;
  taskName: string;
  type: TaskType;
  status: HandoffStatus;
  summary: string;
  artifacts: string[];
  notes: string[];
  followUps: string[];
  attempt: number;
  verdict?: Verdict;
  rejectReason?: string;
}

export interface TaskState {
  name: string;
  type: TaskType;
  status: TaskStatus;
  depth: number;
  attempt: number;
  isolationDir: string | null;
  handoffPath: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  parentName: string | null;
  note: string | null;
}

export interface RunEvent {
  at: string;
  kind: string;
  taskName: string | null;
  message: string;
}

export interface RunState {
  rootSlug: string;
  goal: string;
  bounds: Bounds;
  depth: number;
  adapter: AdapterKind;
  peakConcurrency: number;
  tasks: TaskState[];
  events: RunEvent[];
}

export interface IsolatedContext {
  task: PlanTask;
  depth: number;
  attempt: number;
  parentGoal: string;
  acceptance: string[];
  upstreamHandoffs: Handoff[];
  verifyTarget: Handoff | null;
}

export interface SpawnRecord {
  taskName: string;
  isolationDir: string;
  contextPath: string;
}

export const DEFAULT_BOUNDS: Bounds = {
  maxDepth: 3,
  maxConcurrentChildren: 3,
  maxResawnsPerTask: 2,
};
