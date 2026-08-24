import type { ImprovementItem, OriginLiveStats, TreeNode, WidgetTone } from "./types.ts";
import { PIPELINE } from "./seed.ts";

export function formatInt(n: number): string {
  return new Intl.NumberFormat("en-US").format(n);
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

export function renderApp(options: {
  stats: OriginLiveStats;
  tree: TreeNode;
  items: ImprovementItem[];
  selectedId: string | null;
  busy: boolean;
  notice: string | null;
}): string {
  const generation = options.items.reduce((max, item) => Math.max(max, item.generation), 0);
  const widgets = options.items.map((item) => item.widget);
  return `
    <div class="shell">
      ${renderHeader(generation, options.items.length, options.busy, options.notice)}
      ${renderHero(options.stats, generation)}
      <section class="kpis" aria-label="Origin 10k stats">
        ${kpi("Tried", formatInt(options.stats.tried), "tickets")}
        ${kpi("Opened", formatInt(options.stats.opened), "PRs")}
        ${kpi("Merged", formatInt(options.stats.merged), "target hit")}
        ${kpi("Errors", formatInt(options.stats.errors), "retries / races")}
        ${kpi("429s", formatInt(options.stats.throttled429), "rate ceiling")}
        ${kpi("Wall", `${options.stats.wallMin} min`, "stopped run")}
      </section>
      <section class="speed" aria-label="Measured pace">
        <article class="speed-card">
          <p class="eyebrow">PRs opened</p>
          <p class="speed-num">${options.stats.openedPerSec}<span>/s</span></p>
          <p class="speed-sub">${options.stats.openedPerMin} / min</p>
        </article>
        <article class="speed-card accent">
          <p class="eyebrow">Merged</p>
          <p class="speed-num">${options.stats.mergedPerSec}<span>/s</span></p>
          <p class="speed-sub">${options.stats.mergedPerMin} / min</p>
        </article>
        <article class="speed-card">
          <p class="eyebrow">Latest merged PR</p>
          <p class="speed-num">#${options.stats.latestMergedPr}</p>
          <p class="speed-sub">${options.stats.repo}</p>
        </article>
        <article class="speed-card">
          <p class="eyebrow">Sweep merges</p>
          <p class="speed-num">${formatInt(options.stats.sweptMerged)}</p>
          <p class="speed-sub">leftover opens closed</p>
        </article>
      </section>
      <section class="pipeline" aria-label="Planner worker verifier">
        ${PIPELINE.map(
          (step, index) => `
          <article class="pipe tone-${step.tone}">
            <span class="pipe-idx">0${index + 1}</span>
            <h3>${escapeHtml(step.title)}</h3>
            <p>${escapeHtml(step.body)}</p>
          </article>`,
        ).join("")}
      </section>
      <div class="split">
        <section class="panel tree-panel" aria-label="Recursive depth tree">
          <header class="panel-head">
            <div>
              <p class="eyebrow">Recursive depth tree</p>
              <h2>Planner splits until maxDepth</h2>
            </div>
            <div class="legend">
              <span class="dot planner">planner</span>
              <span class="dot worker">worker</span>
              <span class="dot verifier">verifier</span>
              <span class="dot merge">merge</span>
            </div>
          </header>
          <div class="tree">${renderTree(options.tree)}</div>
        </section>
        <section class="panel feed-panel" aria-label="Improvement feed">
          <header class="panel-head">
            <div>
              <p class="eyebrow">Accepted handoffs</p>
              <h2>Generation feed</h2>
            </div>
            <button class="ghost" data-action="improve" ${options.busy ? "disabled" : ""}>Accept next worker</button>
          </header>
          <ol class="feed">
            ${options.items
              .slice()
              .reverse()
              .map((item) => renderFeedItem(item, options.selectedId === item.id))
              .join("")}
          </ol>
        </section>
      </div>
      <section class="widgets" aria-label="Worker widgets">
        ${widgets.map(renderWidget).join("")}
      </section>
    </div>
  `;
}

function renderHeader(generation: number, itemCount: number, busy: boolean, notice: string | null): string {
  return `
    <header class="top">
      <div class="brand">
        <span class="mark">α</span>
        <div>
          <p class="brand-kicker">Alpha Throttle</p>
          <h1>Self-improving agent console</h1>
        </div>
      </div>
      <div class="top-meta">
        <div class="gen" data-testid="generation">
          <span class="gen-label">generation</span>
          <span class="gen-num">${generation}</span>
          <span class="gen-ver">v0.${generation}.0 · ${itemCount} handoffs</span>
        </div>
        <button class="primary" data-action="improve" ${busy ? "disabled" : ""}>
          ${busy ? "Applying…" : "Improve dashboard"}
        </button>
      </div>
      ${notice ? `<p class="notice" role="status">${escapeHtml(notice)}</p>` : ""}
    </header>
  `;
}

function renderHero(stats: OriginLiveStats, generation: number): string {
  return `
    <section class="hero">
      <div>
        <p class="eyebrow">Continuously improving</p>
        <h2>A dashboard the recursive agent can patch.</h2>
        <p class="lede">
          Claude is the planner. Grok 4.6 is an optional planner with the same JSON split.
          Each accepted worker handoff writes a unique widget and bumps generation
          <strong>${generation}</strong>. Seeded from the live Origin 10k run so the demo
          works offline.
        </p>
      </div>
      <dl class="hero-facts">
        <div><dt>Status</dt><dd>${escapeHtml(stats.status)}</dd></div>
        <div><dt>Forge</dt><dd>${escapeHtml(stats.forge)}</dd></div>
        <div><dt>Measured</dt><dd>23 Aug 2026</dd></div>
        <div><dt>Author</dt><dd>Ranjan S</dd></div>
      </dl>
    </section>
  `;
}

function kpi(label: string, value: string, hint: string): string {
  return `<article class="kpi"><p class="eyebrow">${escapeHtml(label)}</p><p class="kpi-val">${escapeHtml(value)}</p><p class="hint">${escapeHtml(hint)}</p></article>`;
}

export function renderTree(node: TreeNode): string {
  const planner = node.planner ? ` planner-${node.planner}` : "";
  return `
    <div class="node role-${node.role}${planner} status-${node.status}" data-depth="${node.depth}" data-node="${escapeHtml(node.id)}">
      <div class="node-card">
        <span class="role">${escapeHtml(node.role)}</span>
        <strong>${escapeHtml(node.label)}</strong>
        <p>${escapeHtml(node.detail)}</p>
        <span class="depth">d${node.depth}</span>
      </div>
      ${
        node.children.length > 0
          ? `<div class="kids">${node.children.map(renderTree).join("")}</div>`
          : ""
      }
    </div>
  `;
}

function renderFeedItem(item: ImprovementItem, selected: boolean): string {
  return `
    <li class="feed-item ${selected ? "selected" : ""}" data-item="${escapeHtml(item.id)}">
      <div class="feed-meta">
        <span class="pill">gen ${item.generation}</span>
        <time datetime="${escapeHtml(item.acceptedAt)}">${escapeHtml(item.acceptedAt.slice(0, 19).replace("T", " "))}Z</time>
      </div>
      <h3>${escapeHtml(item.title)}</h3>
      <p>${escapeHtml(item.summary)}</p>
      <p class="worker">worker ${escapeHtml(item.worker)}</p>
    </li>
  `;
}

function renderWidget(widget: ImprovementItem["widget"]): string {
  const tone: WidgetTone = widget.tone ?? "mint";
  const series = widget.series ?? [];
  const spark = series.length > 0 ? renderSpark(series) : "";
  const bars = widget.kind === "chart" && series.length > 0 ? renderBars(series) : "";
  return `
    <article class="widget tone-${tone} kind-${widget.kind}" data-widget="${escapeHtml(widget.id)}">
      <p class="eyebrow">${escapeHtml(widget.kind)}</p>
      <h3>${escapeHtml(widget.title)}</h3>
      ${widget.value ? `<p class="widget-val">${escapeHtml(widget.value)}${widget.unit ? `<span>${escapeHtml(widget.unit)}</span>` : ""}</p>` : ""}
      <p>${escapeHtml(widget.body)}</p>
      ${spark}
      ${bars}
    </article>
  `;
}

function renderSpark(series: number[]): string {
  const max = Math.max(...series, 1);
  const w = 160;
  const h = 36;
  const step = series.length > 1 ? w / (series.length - 1) : w;
  const points = series
    .map((n, i) => {
      const x = i * step;
      const y = h - (n / max) * (h - 4) - 2;
      return `${x},${y}`;
    })
    .join(" ");
  return `<svg class="spark" viewBox="0 0 ${w} ${h}" aria-hidden="true"><polyline fill="none" stroke="currentColor" stroke-width="2" points="${points}"/></svg>`;
}

function renderBars(series: number[]): string {
  const max = Math.max(...series, 1);
  return `<div class="bars">${series
    .map((n) => `<span style="height:${Math.max(8, Math.round((n / max) * 64))}px"></span>`)
    .join("")}</div>`;
}
