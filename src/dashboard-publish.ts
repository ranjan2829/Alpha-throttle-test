import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { gitText, runProc } from "./throttle/git.ts";

export const DEFAULT_UI_REPO = "ranjan-rgb/Recursive-Agent-Dashboard";

export interface PublishDashboardOptions {
  repoRoot: string;
  repo?: string;
  remoteUrl?: string;
  now?: () => string;
  generation?: number;
  title?: string;
  dryRun?: boolean;
}

export interface PublishDashboardResult {
  repo: string;
  remoteUrl: string;
  committed: boolean;
  sha: string | null;
  files: number;
}

const COPY_ENTRIES = [
  "index.html",
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "src",
] as const;

export function uiRemoteUrl(repo = DEFAULT_UI_REPO, token?: string): string {
  if (token) {
    return `https://x-access-token:${token}@github.com/${repo}.git`;
  }
  return `https://github.com/${repo}.git`;
}

export function tokenFromGitRemote(url: string): string | null {
  const match = url.match(/x-access-token:([^@]+)@/i);
  return match?.[1] ?? null;
}

export function standaloneViteConfig(): string {
  return `import { defineConfig } from "vite";

export default defineConfig({
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },
});
`;
}

export function standaloneVercelJson(): string {
  return `${JSON.stringify(
    {
      $schema: "https://openapi.vercel.sh/vercel.json",
      framework: "vite",
      buildCommand: "npm run build",
      outputDirectory: "dist",
      rewrites: [{ source: "/(.*)", destination: "/index.html" }],
    },
    null,
    2,
  )}\n`;
}

export function uiRepoReadme(repo = DEFAULT_UI_REPO): string {
  return `# Recursive Agent Dashboard

UI-only Vite app. Cloud agents **read and update this \`main\`**.

This repo is the dashboard — not the Origin harness. No planner, no ticket loop, no \`src/cli.ts\`.

Gen 0 starts broken on purpose. Each generation is one CSS repair + memory + a commit on \`main\`.

\`\`\`bash
npm install
npm run dev
# http://127.0.0.1:5173
npm run build
\`\`\`

Vercel: import **\`${repo}\`**, framework Vite, root \`/\`, production branch \`main\`, output \`dist\`.
`;
}

export function uiRepoAgentsMd(): string {
  return `# Recursive Agent Dashboard

UI-only repo. You are the cloud agent that keeps \`main\` current.

## Loop

1. Read \`src/memory.json\` and \`src/styles.css\`.
2. Apply the next highest-quality CSS/UI repair that is not in \`doNotRegress\`.
3. Write a unique file \`src/patches/g{n}-{slug}-{entropy}.css\` and import it from \`src/patches.ts\`.
4. Record the repair in \`src/memory.json\` (generation++, history, defect status, \`doNotRegress\`).
5. Add a feed row under \`src/feed/\` when the UI lists generations.
6. Commit as Ranjan S \`<ranjan@allocations.com>\` and **push \`main\`**.

Do not stop after the original six gen-0 defects. Open the next quality backlog item and keep going.

## Do not

- Add the Alpha-throttle-test harness, CLI, Origin throttle, or ticket files here.
- Restore Comic Sans, magenta/yellow clash, or a rotated hero after gen 0.
- Write "400 tickets" or "Claude does not write the tickets".
- Squash-merge in a way that rewrites the author.

## Vercel

Production branch is \`main\`. Static snapshot only; Improve in production is a no-op without the local harness API.
`;
}

export function standalonePackageJson(raw: string): string {
  try {
    const parsed = JSON.parse(raw) as { name?: string; [key: string]: unknown };
    return `${JSON.stringify({ ...parsed, name: "recursive-agent-dashboard" }, null, 2)}\n`;
  } catch {
    return raw;
  }
}

export function stageDashboardFiles(webDir: string, destDir: string): number {
  mkdirSync(destDir, { recursive: true });
  let files = 0;
  for (const name of COPY_ENTRIES) {
    const from = join(webDir, name);
    if (!existsSync(from)) continue;
    cpSync(from, join(destDir, name), { recursive: true });
    files += 1;
  }
  const pkgPath = join(destDir, "package.json");
  if (existsSync(pkgPath)) {
    writeFileSync(pkgPath, standalonePackageJson(readFileSync(pkgPath, "utf8")), "utf8");
  }
  writeFileSync(join(destDir, "vite.config.ts"), standaloneViteConfig(), "utf8");
  writeFileSync(join(destDir, "vercel.json"), standaloneVercelJson(), "utf8");
  writeFileSync(join(destDir, ".gitignore"), "node_modules\ndist\n.DS_Store\n", "utf8");
  writeFileSync(join(destDir, "README.md"), uiRepoReadme(), "utf8");
  writeFileSync(join(destDir, "AGENTS.md"), uiRepoAgentsMd(), "utf8");
  files += 5;
  return files;
}

export function listUiRepoFiles(root: string): string[] {
  const out: string[] = [];
  const walk = (dir: string, prefix: string): void => {
    for (const name of readdirSync(dir, { withFileTypes: true })) {
      if (name.name === "node_modules" || name.name === "dist") continue;
      const rel = prefix ? `${prefix}/${name.name}` : name.name;
      const full = join(dir, name.name);
      if (name.isDirectory()) walk(full, rel);
      else out.push(rel);
    }
  };
  walk(root, "");
  return out.sort();
}

export async function publishDashboardToMain(
  options: PublishDashboardOptions,
): Promise<PublishDashboardResult> {
  const repo = options.repo ?? process.env.DASHBOARD_UI_REPO ?? DEFAULT_UI_REPO;
  const originUrl = await gitText(options.repoRoot, ["remote", "get-url", "origin"]).catch(() => "");
  const token = process.env.GITHUB_TOKEN ?? tokenFromGitRemote(originUrl) ?? undefined;
  const remoteUrl = options.remoteUrl ?? uiRemoteUrl(repo, token);
  const webDir = join(options.repoRoot, "web");
  if (!existsSync(join(webDir, "package.json"))) {
    throw new Error(`web/ dashboard missing under ${options.repoRoot}`);
  }
  if (options.dryRun) {
    return { repo, remoteUrl: uiRemoteUrl(repo), committed: false, sha: null, files: COPY_ENTRIES.length + 5 };
  }

  const work = mkdtempSync(join(tmpdir(), "alpha-ui-"));
  try {
    const dest = await cloneOrInitUiRepo(work, remoteUrl);
    const tracked = (await gitText(dest, ["ls-files"])).split("\n").filter((row) => row.length > 0);
    for (const path of tracked) {
      rmSync(join(dest, path), { force: true, recursive: true });
    }
    const files = stageDashboardFiles(webDir, dest);
    await runProc(dest, ["git", "add", "-A"]);
    const dirty = await gitText(dest, ["status", "--porcelain"]);
    if (!dirty) {
      const sha = await gitText(dest, ["rev-parse", "HEAD"]).catch(() => null);
      return { repo, remoteUrl: uiRemoteUrl(repo), committed: false, sha, files };
    }
    const generation = options.generation ?? 0;
    const title = options.title ?? "full UI snapshot";
    const message = `Agent update gen ${generation}: ${title}`;
    await runProc(
      dest,
      ["git", "-c", "user.name=Ranjan S", "-c", "user.email=ranjan@allocations.com", "commit", "-m", message],
      {
        ...process.env,
        GIT_AUTHOR_NAME: "Ranjan S",
        GIT_AUTHOR_EMAIL: "ranjan@allocations.com",
        GIT_COMMITTER_NAME: "Ranjan S",
        GIT_COMMITTER_EMAIL: "ranjan@allocations.com",
      },
    );
    await runProc(dest, ["git", "push", "origin", "HEAD:main"]);
    const sha = await gitText(dest, ["rev-parse", "HEAD"]);
    return { repo, remoteUrl: uiRemoteUrl(repo), committed: true, sha, files };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

async function cloneOrInitUiRepo(work: string, remoteUrl: string): Promise<string> {
  const dest = join(work, "repo");
  try {
    await runProc(work, ["git", "clone", "--depth", "1", remoteUrl, "repo"]);
  } catch {
    mkdirSync(dest, { recursive: true });
    await runProc(dest, ["git", "init", "-b", "main"]);
    await runProc(dest, ["git", "remote", "add", "origin", remoteUrl]);
    return dest;
  }
  const head = await gitText(dest, ["rev-parse", "--verify", "HEAD"]).catch(() => "");
  if (!head) {
    await runProc(dest, ["git", "checkout", "-B", "main"]).catch(async () => {
      await runProc(dest, ["git", "symbolic-ref", "HEAD", "refs/heads/main"]);
    });
  }
  return dest;
}
