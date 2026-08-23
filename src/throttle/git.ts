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

export async function writeUniqueCommit(options: {
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
    const blob = await hashBlob(options.repoDir, options.body);
    await runProc(
      options.repoDir,
      ["git", "update-index", "--add", "--cacheinfo", `100644,${blob},${options.path}`],
      env,
    );
    const tree = (await runProc(options.repoDir, ["git", "write-tree"], env)).stdout.trim();
    const identity = await gitIdentity(options.repoDir);
    const commitEnv = {
      ...env,
      GIT_AUTHOR_NAME: identity.name,
      GIT_AUTHOR_EMAIL: identity.email,
      GIT_COMMITTER_NAME: identity.name,
      GIT_COMMITTER_EMAIL: identity.email,
    };
    const commit = (
      await runProc(
        options.repoDir,
        ["git", "commit-tree", tree, "-p", options.parentSha, "-m", options.message],
        commitEnv,
      )
    ).stdout.trim();
    return commit;
  } finally {
    rmSync(indexDir, { recursive: true, force: true });
  }
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

async function gitIdentity(repoDir: string): Promise<{ name: string; email: string }> {
  try {
    const name = await gitText(repoDir, ["config", "user.name"]);
    const email = await gitText(repoDir, ["config", "user.email"]);
    if (name && email) return { name, email };
  } catch {
    // fall through
  }
  return { name: "alpha-throttle", email: "alpha-throttle@local" };
}

