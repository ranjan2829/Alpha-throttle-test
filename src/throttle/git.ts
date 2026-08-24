import { spawn } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export interface ProcResult {
  stdout: string;
  stderr: string;
}

export function runProc(cwd: string, argv: string[], env?: NodeJS.ProcessEnv): Promise<ProcResult> {
  return new Promise((resolve, reject) => {
    const [cmd, ...args] = argv;
    if (!cmd) {
      reject(new Error("empty command"));
      return;
    }
    const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"], env });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${argv.join(" ")} exited ${code}: ${stderr.trim() || stdout.trim()}`));
    });
  });
}

export async function gitText(cwd: string, args: string[]): Promise<string> {
  const result = await runProc(cwd, ["git", ...args]);
  return result.stdout.trim();
}

export async function resolveStartSha(
  repoDir: string,
  remote: string,
  baseBranch: string,
): Promise<string> {
  try {
    await runProc(repoDir, ["git", "fetch", remote, baseBranch]);
    return await gitText(repoDir, ["rev-parse", `${remote}/${baseBranch}`]);
  } catch {
    await runProc(repoDir, ["git", "fetch", "origin", baseBranch]);
    return await gitText(repoDir, ["rev-parse", `origin/${baseBranch}`]);
  }
}

export async function commitAndPushUniqueFile(options: {
  repoDir: string;
  remote: string;
  startSha: string;
  branch: string;
  path: string;
  body: string;
  message: string;
}): Promise<string> {
  const commit = await writeUniqueCommit({
    repoDir: options.repoDir,
    parentSha: options.startSha,
    path: options.path,
    body: options.body,
    message: options.message,
  });
  await runProc(options.repoDir, [
    "git",
    "push",
    "--force-with-lease",
    options.remote,
    `${commit}:refs/heads/${options.branch}`,
  ]);
  return commit;
}

/** Isolated GIT_INDEX_FILE per write; a small gate still avoids object-store stampedes. */
const GIT_WRITE_CONCURRENCY = 8;
let activeWrites = 0;
const writeWaiters: Array<() => void> = [];

function withGitWrite<T>(job: () => Promise<T>): Promise<T> {
  const acquire = (): Promise<void> => {
    if (activeWrites < GIT_WRITE_CONCURRENCY) {
      activeWrites += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      writeWaiters.push(resolve);
    });
  };
  const release = (): void => {
    const next = writeWaiters.shift();
    if (next) next();
    else activeWrites = Math.max(0, activeWrites - 1);
  };
  return acquire()
    .then(job)
    .finally(release);
}

export async function writeUniqueCommit(options: {
  repoDir: string;
  parentSha: string;
  path: string;
  body: string;
  message: string;
}): Promise<string> {
  return withGitWrite(() => writeUniqueCommitUnlocked(options));
}

async function writeUniqueCommitUnlocked(options: {
  repoDir: string;
  parentSha: string;
  path: string;
  body: string;
  message: string;
}): Promise<string> {
  const indexDir = mkdtempSync(join(tmpdir(), "alpha-idx-"));
  const indexFile = join(indexDir, "index");
  const env = { ...process.env, GIT_INDEX_FILE: indexFile };
  try {
    await runProc(options.repoDir, ["git", "read-tree", options.parentSha], env);
    const blob = await retrySha("hash-object", () => hashBlob(options.repoDir, options.body));
    await runProc(
      options.repoDir,
      ["git", "update-index", "--add", "--cacheinfo", "100644", blob, options.path],
      env,
    );
    const tree = await retrySha(
      "write-tree",
      async () => (await runProc(options.repoDir, ["git", "write-tree"], env)).stdout.trim(),
    );
    const identity = await gitIdentity(options.repoDir);
    const commitEnv = {
      ...env,
      GIT_AUTHOR_NAME: identity.name,
      GIT_AUTHOR_EMAIL: identity.email,
      GIT_COMMITTER_NAME: identity.name,
      GIT_COMMITTER_EMAIL: identity.email,
    };
    const commit = await retrySha(
      "commit-tree",
      async () =>
        (
          await runProc(
            options.repoDir,
            ["git", "commit-tree", tree, "-p", options.parentSha, "-m", options.message],
            commitEnv,
          )
        ).stdout.trim(),
    );
    return commit;
  } finally {
    rmSync(indexDir, { recursive: true, force: true });
  }
}

async function retrySha(label: string, fn: () => Promise<string>): Promise<string> {
  let last = "";
  for (let attempt = 1; attempt <= 4; attempt += 1) {
    last = (await fn()).trim();
    if (/^[0-9a-f]{40,64}$/i.test(last)) return last;
    await new Promise<void>((resolve) => {
      setTimeout(resolve, 20 * attempt);
    });
  }
  throw new Error(`git ${label} returned invalid sha '${last}'`);
}

async function hashBlob(repoDir: string, body: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn("git", ["hash-object", "-w", "--stdin"], {
      cwd: repoDir,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", reject);
    child.on("exit", (code) => {
      if (code === 0) resolve(stdout.trim());
      else reject(new Error(`git hash-object exited ${code}: ${stderr.trim()}`));
    });
    child.stdin.end(body, "utf8");
  });
}

export const DEFAULT_COMMIT_NAME = "ranjan-rgb";
export const DEFAULT_COMMIT_EMAIL = "ranjan@allocations.com";

export function resolveGitIdentity(
  env: NodeJS.ProcessEnv = process.env,
): { name: string; email: string } {
  const name = env.ALPHA_GIT_NAME?.trim() || DEFAULT_COMMIT_NAME;
  const email = env.ALPHA_GIT_EMAIL?.trim() || DEFAULT_COMMIT_EMAIL;
  return { name, email };
}

async function gitIdentity(_repoDir: string): Promise<{ name: string; email: string }> {
  return resolveGitIdentity();
}

