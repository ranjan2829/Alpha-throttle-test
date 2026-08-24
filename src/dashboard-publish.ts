import { cpSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { gitText, runProc } from "./throttle/git.ts";

/** Live UI repo this login can update. Agent pushes `main`; Vercel deploys from `main`. */
export const DEFAULT_UI_REPO = "ranjan2829/alpha-throttle-dashboard";

/**
 * Desired personal home for the UI. `ranjan-rgb` is a user, not an org.
 * This login (`ranjan2829`) cannot create or transfer repos onto it.
 * Set `DASHBOARD_UI_REPO` after transferring DEFAULT_UI_REPO or creating this slug.
 */
export const RANJAN_RGB_UI_REPO = "ranjan-rgb/alpha-throttle-dashboard";

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

export function shouldPublishUi(input: { publish?: boolean; uiRepo?: string }): boolean {
  return Boolean(input.publish || input.uiRepo);
}

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

export function uiReadme(repo: string): string {
  return `# Alpha Throttle dashboard

Self-improving UI. The recursive agent in \`ranjan2829/Alpha-throttle-test\` repairs \`web/\` and **pushes this \`main\`**.

Vercel: import **\`${repo}\`**, framework Vite, root \`/\`, production branch \`main\`.

To move it to \`ranjan-rgb\`, transfer the repo in GitHub Settings while logged in as ranjan2829, or create \`ranjan-rgb/alpha-throttle-dashboard\` as that user and set \`DASHBOARD_UI_REPO\`.

\`\`\`bash
npm install
npm run dev
\`\`\`
`;
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
  writeFileSync(join(destDir, "vite.config.ts"), standaloneViteConfig(), "utf8");
  writeFileSync(join(destDir, "vercel.json"), standaloneVercelJson(), "utf8");
  writeFileSync(join(destDir, ".gitignore"), "node_modules\ndist\n.DS_Store\n", "utf8");
  const patchDir = join(destDir, "src", "patches");
  if (existsSync(patchDir)) {
    const css = readdirSync(patchDir)
      .filter((name) => name.endsWith(".css") && name !== "all.css")
      .sort()
      .map((name) => readFileSync(join(patchDir, name), "utf8"))
      .join("\n");
    writeFileSync(join(patchDir, "all.css"), css, "utf8");
    writeFileSync(join(destDir, "src", "patches.ts"), 'import "./patches/all.css";\n', "utf8");
  }
  files += 3;
  return files;
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
    return { repo, remoteUrl: uiRemoteUrl(repo), committed: false, sha: null, files: COPY_ENTRIES.length + 3 };
  }

  const work = mkdtempSync(join(tmpdir(), "alpha-ui-"));
  try {
    const dest = await cloneOrInitUiRepo(work, remoteUrl);
    const tracked = (await gitText(dest, ["ls-files"])).split("\n").filter((row) => row.length > 0);
    for (const path of tracked) {
      if (path === "README.md") continue;
      rmSync(join(dest, path), { force: true, recursive: true });
    }
    const files = stageDashboardFiles(webDir, dest);
    writeFileSync(join(dest, "README.md"), uiReadme(repo), "utf8");
    await runProc(dest, ["git", "add", "-A"]);
    const dirty = await gitText(dest, ["status", "--porcelain"]);
    if (!dirty) {
      const sha = await gitText(dest, ["rev-parse", "HEAD"]);
      return { repo, remoteUrl: uiRemoteUrl(repo), committed: false, sha, files };
    }
    const generation = options.generation ?? 0;
    const title = options.title ?? "dashboard snapshot";
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
