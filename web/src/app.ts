import { renderApp } from "./render.ts";
import { loadBundledImprovements } from "./feed.ts";
import memorySeed from "./memory.json";
import { AGENT_TREE, ORIGIN_STATS } from "./seed.ts";
import type { DashboardMemory, ImproveApiResponse, ImprovementItem } from "./types.ts";

export interface DashboardState {
  items: ImprovementItem[];
  memory: DashboardMemory;
  selectedId: string | null;
  busy: boolean;
  notice: string | null;
}

export function initialState(): DashboardState {
  const items = loadBundledImprovements();
  const memory = memorySeed as DashboardMemory;
  return {
    items,
    memory,
    selectedId: items.at(-1)?.id ?? null,
    busy: false,
    notice:
      memory.generation === 0
        ? "Gen 0 is broken on purpose. Repair next defect writes CSS and remembers it."
        : null,
  };
}

export function mount(root: HTMLElement): void {
  let state = initialState();

  const paint = (): void => {
    root.innerHTML = renderApp({
      stats: ORIGIN_STATS,
      tree: AGENT_TREE,
      items: state.items,
      memory: state.memory,
      selectedId: state.selectedId,
      busy: state.busy,
      notice: state.notice,
    });
    bind(root);
  };

  const bind = (el: HTMLElement): void => {
    for (const button of el.querySelectorAll<HTMLButtonElement>("[data-action='improve']")) {
      button.addEventListener("click", () => {
        void improve();
      });
    }
    for (const row of el.querySelectorAll<HTMLElement>("[data-item]")) {
      row.addEventListener("click", () => {
        const id = row.dataset.item;
        if (!id) return;
        state = { ...state, selectedId: id };
        paint();
      });
    }
  };

  const improve = async (): Promise<void> => {
    if (state.busy) return;
    state = { ...state, busy: true, notice: "Agent reading memory and applying the next highest-quality repair…" };
    paint();
    try {
      const response = await fetch("/api/improve", { method: "POST" });
      const payload = (await response.json()) as ImproveApiResponse;
      if (!payload.ok) {
        state = {
          ...state,
          busy: false,
          notice: payload.error ?? "Improve API failed. Use npx tsx src/cli.ts dashboard-improve",
        };
        paint();
        return;
      }
      window.location.reload();
    } catch {
      state = {
        ...state,
        busy: false,
        notice: "Dev server API unavailable. From the repo root run: npx tsx src/cli.ts dashboard-improve",
      };
      paint();
    }
  };

  paint();
}
