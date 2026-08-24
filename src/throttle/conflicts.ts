import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { isJsonObject, parseJsonObject, requireArray, requireInt, requireString } from "../json.ts";
import {
  commitResolution,
  detectMergeOperation,
  fetchBaseRef,
  hasStagedChanges,
  listDirtyFiles,
  listUnmergedFiles,
  mergeBaseRef,
  readConflictSide,
  rebaseOntoRef,
  writeAndStage,
  type MergeOperation,
} from "./git.ts";

export type ConflictKind = "merge" | "rebase" | "origin-race" | "dirty-unique";
export type ResolveStrategy = "ours" | "theirs" | "union" | "worker-retry";

export interface ConflictHunk {
  ours: string;
  theirs: string;
  start: number;
}

export interface ResolvedFile {
  path: string;
  strategy: ResolveStrategy;
  resolved: boolean;
  reason: string;
}

export interface WorkerRetryBrief {
  taskName: string;
  type: "worker";
  path: string;
  hunks: ConflictHunk[];
  scopedGoal: string;
  acceptance: string[];
  artifact: string;
}

export interface ConflictMemoryEntry {
  id: string;
  path: string;
  strategy: ResolveStrategy;
  kind: ConflictKind;
  resolvedAt: string;
  notes: string;
}

export interface ConflictMemory {
  version: 1;
  entries: ConflictMemoryEntry[];
}

export interface ResolveConflictsOptions {
  repoDir: string;
  remote?: string;
  baseBranch?: string;
  ownedPaths?: readonly string[];
  memoryPath?: string;
  now?: () => string;
  commit?: boolean;
  message?: string;
  preferRebase?: boolean;
}

export interface ResolveConflictsResult {
  kind: ConflictKind;
  files: ResolvedFile[];
  committed: boolean;
  commitSha: string | null;
  retries: WorkerRetryBrief[];
  memory: ConflictMemory;
}

const KINDS: readonly ConflictKind[] = ["merge", "rebase", "origin-race", "dirty-unique"];
const STRATEGIES: readonly ResolveStrategy[] = ["ours", "theirs", "union", "worker-retry"];

const FORBIDDEN_TICKETS = /400 tickets/i;
const AGENT_PHRASE = /recursive AI agent/i;
const DASHBOARD_SECTION = /self-improving dashboard/i;
const DASHBOARD_MEMORY = /memory\.json/i;
const BROKEN_GEN0 = /broken/i;

export function defaultConflictMemoryPath(root: string): string {
  return join(root, ".alpha", "conflict-memory.json");
}

export function defaultConflictRetryDir(root: string): string {
  return join(root, ".alpha", "conflict-retries");
}

export function isMergeRace(message: string): boolean {
  return /ref updates rejected|updated by another push|stack head conflicts|needs restack|stack parent/i.test(
    message,
  );
}

export function isGitConflict(message: string): boolean {
  return /CONFLICT \(|Automatic merge failed|unmerged paths|fix conflicts|needs merge|could not apply|rebase.*conflict|would be overwritten|dirty work tree|index\.lock/i.test(
    message,
  );
}

export function isConflictOrRace(message: string): boolean {
  return isMergeRace(message) || isGitConflict(message);
}

export function detectConflictKind(message: string, operation: MergeOperation = "none"): ConflictKind {
  if (operation === "rebase" || (/rebase/i.test(message) && /conflict/i.test(message))) {
    return "rebase";
  }
  if (isMergeRace(message)) return "origin-race";
  if (operation === "merge" || /CONFLICT \(|Automatic merge failed|unmerged paths/i.test(message)) {
    return "merge";
  }
  if (/dirty|would be overwritten|unique/i.test(message)) return "dirty-unique";
  if (isGitConflict(message)) return "merge";
  return "origin-race";
}

export function isUniqueWorkerFile(path: string): boolean {
  const normalized = normalizePath(path);
  if (normalized === "tickets/README.md") return false;
  if (/^tickets\/.+\.md$/.test(normalized)) return true;
  if (/^web\/src\/feed\/.+\.json$/.test(normalized)) return true;
  if (/^web\/src\/patches\/.+\.css$/.test(normalized)) return true;
  return false;
}

export function isSharedResolvePath(path: string): boolean {
  const normalized = normalizePath(path);
  return (
    normalized === "README.md" ||
    normalized === "tickets/README.md" ||
    normalized === "AGENTS.md" ||
    normalized === "package.json"
  );
}

export function classifyConflictPath(
  path: string,
  options: { ownedPaths: readonly string[] },
): ResolveStrategy {
  const normalized = normalizePath(path);
  const owned = options.ownedPaths.map(normalizePath);
  if (owned.includes(normalized)) return "ours";
  if (isUniqueWorkerFile(normalized)) {
    return owned.length === 0 ? "ours" : "theirs";
  }
  if (isSharedResolvePath(normalized)) return "union";
  return "theirs";
}

export function hasConflictMarkers(text: string): boolean {
  return /^(<<<<<<<|=======|>>>>>>>)/m.test(text);
}

export function parseConflictHunks(text: string): ConflictHunk[] {
  const hunks: ConflictHunk[] = [];
  const re = /<<<<<<<[^\n]*\n([\s\S]*?)=======\n([\s\S]*?)>>>>>>>[^\n]*\n?/g;
  let match = re.exec(text);
  while (match) {
    hunks.push({
      ours: match[1] ?? "",
      theirs: match[2] ?? "",
      start: match.index,
    });
    match = re.exec(text);
  }
  return hunks;
}

export function dropForbiddenTicketLines(text: string): string {
  return text
    .split("\n")
    .filter((line) => !FORBIDDEN_TICKETS.test(line))
    .join("\n");
}

export function unionReadme(ours: string, theirs: string): string {
  const cleanedOurs = dropForbiddenTicketLines(ours);
  const cleanedTheirs = dropForbiddenTicketLines(theirs);
  if (!cleanedOurs.trim()) return cleanedTheirs;
  if (!cleanedTheirs.trim()) return cleanedOurs;
  const oursScore = readmeScore(cleanedOurs);
  const theirsScore = readmeScore(cleanedTheirs);
  let text = oursScore >= theirsScore ? cleanedOurs : cleanedTheirs;
  const other = oursScore >= theirsScore ? cleanedTheirs : cleanedOurs;
  if (!AGENT_PHRASE.test(text) && AGENT_PHRASE.test(other)) {
    text = appendMissingBlock(text, other, AGENT_PHRASE);
  }
  if (!DASHBOARD_SECTION.test(text) && DASHBOARD_SECTION.test(other)) {
    text = appendMissingBlock(text, other, DASHBOARD_SECTION);
  }
  if (!DASHBOARD_MEMORY.test(text) && DASHBOARD_MEMORY.test(other)) {
    text = appendMissingBlock(text, other, DASHBOARD_MEMORY);
  }
  return dropForbiddenTicketLines(text);
}

export function unionSharedText(ours: string, theirs: string, path: string): string {
  if (normalizePath(path) === "README.md" || normalizePath(path) === "tickets/README.md") {
    return unionReadme(ours, theirs);
  }
  if (ours === theirs) return dropForbiddenTicketLines(ours);
  if (!ours.trim()) return dropForbiddenTicketLines(theirs);
  if (!theirs.trim()) return dropForbiddenTicketLines(ours);
  if (hasConflictMarkers(ours) || hasConflictMarkers(theirs)) {
    const marked = hasConflictMarkers(ours) ? ours : theirs;
    return marked.replace(
      /<<<<<<<[^\n]*\n([\s\S]*?)=======\n([\s\S]*?)>>>>>>>[^\n]*\n?/g,
      (_all, left: string, right: string) => unionSharedText(left, right, path),
    );
  }
  const prefer = readmeScore(ours) >= readmeScore(theirs) ? ours : theirs;
  return dropForbiddenTicketLines(prefer);
}

export function applyStrategy(
  strategy: ResolveStrategy,
  input: { path: string; workerText: string; baseText: string },
): { ok: boolean; text: string; reason: string } {
  if (strategy === "ours") {
    return { ok: true, text: input.workerText, reason: "keep worker-owned unique file" };
  }
  if (strategy === "theirs") {
    return { ok: true, text: input.baseText, reason: "keep unrelated file from main" };
  }
  if (strategy === "union") {
    const text = unionSharedText(input.workerText, input.baseText, input.path);
    if (hasConflictMarkers(text)) {
      return { ok: false, text, reason: "union left conflict markers" };
    }
    return { ok: true, text, reason: "safe union of shared file" };
  }
  return { ok: false, text: input.workerText, reason: "cannot auto-resolve" };
}

export function applyFocusedHunkRetry(
  workerText: string,
  baseText: string,
  path: string,
): { text: string; ok: boolean } {
  const source = hasConflictMarkers(workerText)
    ? workerText
    : `<<<<<<< ours\n${workerText}=======\n${baseText}>>>>>>> theirs\n`;
  const text = source.replace(
    /<<<<<<<[^\n]*\n([\s\S]*?)=======\n([\s\S]*?)>>>>>>>[^\n]*\n?/g,
    (_all, ours: string, theirs: string) => unionSharedText(ours, theirs, path),
  );
  return { text, ok: !hasConflictMarkers(text) };
}

export function emptyConflictMemory(): ConflictMemory {
  return { version: 1, entries: [] };
}

export function loadConflictMemory(memoryPath: string): ConflictMemory {
  if (!existsSync(memoryPath)) return emptyConflictMemory();
  return parseConflictMemory(readFileSync(memoryPath, "utf8"), memoryPath);
}

export function saveConflictMemory(memoryPath: string, memory: ConflictMemory): void {
  mkdirSync(dirname(memoryPath), { recursive: true });
  writeFileSync(memoryPath, `${JSON.stringify(memory, null, 2)}\n`, "utf8");
}

export function rememberConflict(memory: ConflictMemory, entry: ConflictMemoryEntry): ConflictMemory {
  if (memory.entries.some((row) => row.id === entry.id)) {
    return memory;
  }
  return { version: 1, entries: [...memory.entries, entry] };
}

export function parseConflictMemory(text: string, source: string): ConflictMemory {
  const obj = parseJsonObject(text, source);
  const version = requireInt(obj, "version", 1, 1);
  if (version !== 1) {
    throw new Error(`${source} version must be 1`);
  }
  const raw = requireArray(obj, "entries");
  const entries: ConflictMemoryEntry[] = [];
  for (let index = 0; index < raw.length; index += 1) {
    const row = raw[index];
    if (!isJsonObject(row)) {
      throw new Error(`${source} entries[${index}] must be an object`);
    }
    entries.push({
      id: requireString(row, "id", `entries[${index}].id`),
      path: requireString(row, "path", `entries[${index}].path`),
      strategy: requireStrategy(requireString(row, "strategy", `entries[${index}].strategy`)),
      kind: requireKind(requireString(row, "kind", `entries[${index}].kind`)),
      resolvedAt: requireString(row, "resolvedAt", `entries[${index}].resolvedAt`),
      notes: requireString(row, "notes", `entries[${index}].notes`),
    });
  }
  return { version: 1, entries };
}

export function writeWorkerRetry(retryDir: string, brief: WorkerRetryBrief): string {
  mkdirSync(retryDir, { recursive: true });
  const artifact = brief.artifact || join(retryDir, `${slugPath(brief.path)}.json`);
  const payload: WorkerRetryBrief = { ...brief, artifact };
  writeFileSync(artifact, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
  return artifact;
}

export function makeWorkerRetry(path: string, workerText: string, baseText: string, retryDir: string): WorkerRetryBrief {
  const source = hasConflictMarkers(workerText)
    ? workerText
    : `<<<<<<< ours\n${workerText}=======\n${baseText}>>>>>>> theirs\n`;
  return {
    taskName: `resolve-${slugPath(path)}`,
    type: "worker",
    path,
    hunks: parseConflictHunks(source),
    scopedGoal: `Edit only the conflicted hunks in ${path}. Do not touch unrelated files.`,
    acceptance: ["no conflict markers", "owned unique files kept", "main-only files kept from base"],
    artifact: join(retryDir, `${slugPath(path)}.json`),
  };
}

export async function resolveWorkspaceConflicts(
  options: ResolveConflictsOptions,
): Promise<ResolveConflictsResult> {
  const repoDir = options.repoDir;
  const baseBranch = options.baseBranch ?? "main";
  const ownedPaths = options.ownedPaths ?? [];
  const now = options.now ?? (() => new Date().toISOString());
  const shouldCommit = options.commit !== false;
  const memoryPath = options.memoryPath ?? defaultConflictMemoryPath(repoDir);
  const retryDir = defaultConflictRetryDir(repoDir);
  const message = options.message ?? "";

  const baseRef = await fetchBaseRef(
    repoDir,
    options.remote,
    baseBranch,
  );
  let operation = await detectMergeOperation(repoDir);
  if (operation === "none") {
    try {
      if (options.preferRebase === true) {
        await rebaseOntoRef(repoDir, baseRef);
      } else {
        await mergeBaseRef(repoDir, baseRef);
      }
    } catch (err) {
      const failed = err instanceof Error ? err.message : "merge failed";
      operation = await detectMergeOperation(repoDir);
      const unmerged = await listUnmergedFiles(repoDir);
      if (unmerged.length === 0 && !isConflictOrRace(failed) && !/CONFLICT/i.test(failed)) {
        throw err;
      }
    }
  }

  operation = await detectMergeOperation(repoDir);
  const kind = detectConflictKind(message, operation);
  const conflicted = await listUnmergedFiles(repoDir);
  const dirty = (await listDirtyFiles(repoDir)).filter(
    (path) => isUniqueWorkerFile(path) && (ownedPaths.length === 0 || ownedPaths.map(normalizePath).includes(normalizePath(path))),
  );
  const targets = uniquePaths([...conflicted, ...dirty]);

  const files: ResolvedFile[] = [];
  const retries: WorkerRetryBrief[] = [];

  for (const path of targets) {
    const strategy = classifyConflictPath(path, { ownedPaths });
    const workerText = await readConflictSide(repoDir, path, "worker", operation === "none" ? "merge" : operation);
    const baseText = await readConflictSide(repoDir, path, "base", operation === "none" ? "merge" : operation);
    const applied = applyStrategy(strategy, { path, workerText, baseText });
    if (applied.ok) {
      await writeAndStage(repoDir, path, applied.text);
      files.push({ path, strategy, resolved: true, reason: applied.reason });
      continue;
    }
    const brief = makeWorkerRetry(path, workerText || applied.text, baseText, retryDir);
    writeWorkerRetry(retryDir, brief);
    retries.push(brief);
    const retried = applyFocusedHunkRetry(workerText || applied.text, baseText, path);
    if (retried.ok) {
      await writeAndStage(repoDir, path, retried.text);
      files.push({ path, strategy: "worker-retry", resolved: true, reason: "focused hunk retry" });
    } else {
      files.push({ path, strategy: "worker-retry", resolved: false, reason: applied.reason });
    }
  }

  let commitSha: string | null = null;
  let committed = false;
  const stillUnmerged = await listUnmergedFiles(repoDir);
  if (shouldCommit && stillUnmerged.length === 0 && (await hasStagedChanges(repoDir))) {
    commitSha = await commitResolution(repoDir, "Resolve merge conflicts (agent)");
    committed = true;
  }

  let memory = loadConflictMemory(memoryPath);
  for (const file of files) {
    memory = rememberConflict(memory, {
      id: file.path,
      path: file.path,
      strategy: file.strategy,
      kind,
      resolvedAt: now(),
      notes: file.reason,
    });
  }
  if (files.length > 0) {
    saveConflictMemory(memoryPath, memory);
  }

  return { kind, files, committed, commitSha, retries, memory };
}

function readmeScore(text: string): number {
  let score = 0;
  if (AGENT_PHRASE.test(text)) score += 3;
  if (DASHBOARD_SECTION.test(text)) score += 2;
  if (DASHBOARD_MEMORY.test(text)) score += 1;
  if (BROKEN_GEN0.test(text) && /gen(?:eration)?\s*0/i.test(text)) score += 2;
  if (FORBIDDEN_TICKETS.test(text)) score -= 4;
  score += Math.min(text.length, 4000) / 4000;
  return score;
}

function appendMissingBlock(base: string, donor: string, needle: RegExp): string {
  const lines = donor.split("\n");
  const hit = lines.findIndex((line) => needle.test(line));
  if (hit < 0) return `${base.trimEnd()}\n`;
  const chunk: string[] = [];
  const start = Math.max(0, hit - 1);
  for (let i = start; i < lines.length && chunk.length < 24; i += 1) {
    const line = lines[i];
    if (line === undefined) break;
    if (i > hit && line.startsWith("## ") && chunk.length > 2) break;
    chunk.push(line);
  }
  return `${base.trimEnd()}\n\n${chunk.join("\n").trim()}\n`;
}

function requireStrategy(value: string): ResolveStrategy {
  if (isResolveStrategy(value)) return value;
  throw new Error(`strategy must be ours|theirs|union|worker-retry`);
}

function requireKind(value: string): ConflictKind {
  if (isConflictKind(value)) return value;
  throw new Error(`kind must be merge|rebase|origin-race|dirty-unique`);
}

function isResolveStrategy(value: string): value is ResolveStrategy {
  for (const item of STRATEGIES) {
    if (item === value) return true;
  }
  return false;
}

function isConflictKind(value: string): value is ConflictKind {
  for (const item of KINDS) {
    if (item === value) return true;
  }
  return false;
}

function normalizePath(path: string): string {
  return path.replace(/^\.\//, "").replace(/\\/g, "/");
}

function uniquePaths(paths: readonly string[]): string[] {
  return [...new Set(paths.map(normalizePath))];
}

function slugPath(path: string): string {
  return normalizePath(path).replace(/[^a-zA-Z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "file";
}
