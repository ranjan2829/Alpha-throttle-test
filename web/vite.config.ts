import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { defineConfig, type Plugin, type ViteDevServer } from "vite";

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
    async configureServer(server: ViteDevServer) {
      const { applyDashboardImprovement, defaultWebSrc } = await import("../src/dashboard-improve.ts");
      server.middlewares.use((req, res, next) => {
        const url = req.url ?? "";
        if (url === "/api/improve" && req.method === "POST") {
          try {
            const result = applyDashboardImprovement({
              webSrc: defaultWebSrc(repoRoot),
              worker: "dashboard-ui",
              planner: "claude",
            });
            sendJson(res, 200, { ok: true, result });
          } catch (err) {
            const message = err instanceof Error ? err.message : "improve failed";
            sendJson(res, 500, { ok: false, error: message });
          }
          return;
        }
        next();
      });
    },
  };
}

export default defineConfig(({ command }) => ({
  plugins: command === "serve" ? [improveApi()] : [],
  server: {
    host: "127.0.0.1",
    port: 5173,
    strictPort: true,
  },
}));
