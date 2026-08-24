import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { defineConfig, type Plugin, type ViteDevServer } from "vite";

import { applyDashboardImprovement, defaultWebSrc } from "../src/dashboard-improve.ts";
import { detectForgeLogin, openDashboardHealPr, resolveHealAdapter } from "../src/dashboard-pr.ts";
import { DEFAULT_UI_REPO, publishDashboardToMain } from "../src/dashboard-publish.ts";
import { DEFAULT_ORIGIN_REPO, parseRepoSlug } from "../src/throttle/forge.ts";

const webRoot = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(webRoot, "..");

function sendJson(
  res: { statusCode: number; setHeader: (k: string, v: string) => void; end: (b: string) => void },
  status: number,
  body: unknown,
): void {
  res.statusCode = status;
  res.setHeader("content-type", "application/json");
  res.end(`${JSON.stringify(body)}\n`);
}

function improveApi(): Plugin {
  return {
    name: "dashboard-improve-api",
    configureServer(server: ViteDevServer) {
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? "";
        if (url === "/api/improve" && req.method === "POST") {
          void (async () => {
            try {
              const result = applyDashboardImprovement({
                webSrc: defaultWebSrc(repoRoot),
                worker: "dashboard-ui",
                planner: "claude",
              });
              const forged = detectForgeLogin();
              const { adapter, merge } = resolveHealAdapter({
                pr: true,
                forged,
                repoDir: repoRoot,
                forgeRepo: parseRepoSlug(DEFAULT_ORIGIN_REPO, "origin"),
                baseBranch: "main",
              });
              const pr = adapter ? await openDashboardHealPr(result, adapter, { merge }) : null;
              let publish: { repo: string; committed: boolean; sha: string | null; error?: string } | null = null;
              try {
                const published = await publishDashboardToMain({
                  repoRoot,
                  repo: process.env.DASHBOARD_UI_REPO ?? DEFAULT_UI_REPO,
                  generation: result.generation.generation,
                  title: result.item.title,
                });
                publish = {
                  repo: published.repo,
                  committed: published.committed,
                  sha: published.sha,
                };
              } catch (err) {
                publish = {
                  repo: process.env.DASHBOARD_UI_REPO ?? DEFAULT_UI_REPO,
                  committed: false,
                  sha: null,
                  error: err instanceof Error ? err.message : "publish failed",
                };
              }
              sendJson(res, 200, {
                ok: true,
                result,
                pr: pr
                  ? { status: pr.status, prNumber: pr.prNumber, prUrl: pr.prUrl }
                  : null,
                publish,
              });
            } catch (err) {
              const message = err instanceof Error ? err.message : "improve failed";
              sendJson(res, 500, { ok: false, error: message });
            }
          })();
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig({
  plugins: [improveApi()],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },
});
