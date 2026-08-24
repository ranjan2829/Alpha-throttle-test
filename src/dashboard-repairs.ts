export interface DashboardRepair {
  defectId: string;
  title: string;
  summary: string;
  notes: string;
  doNotRegress: readonly string[];
  css: string;
}

export const DASHBOARD_REPAIRS: readonly DashboardRepair[] = [
  {
    defectId: "type",
    title: "Readable type and color system",
    summary: "Replaced the broken type with a real dark palette, box-sizing, and Instrument Sans.",
    notes: "Highest-quality base tokens. Later patches must keep contrast and box-sizing.",
    doNotRegress: ["box-sizing: border-box", "readable dark palette", "Instrument Sans"],
    css: `:root {
  color-scheme: dark;
  --bg: #07080c;
  --bg-2: #0d1017;
  --card: #121722;
  --line: #232a38;
  --text: #e8edf5;
  --muted: #8b95a8;
  --mint: #3dffc8;
  --amber: #ffc857;
  --violet: #9b8cff;
  --rose: #ff6b8a;
  --sky: #6ec6ff;
  font-family: "Instrument Sans", "Segoe UI", sans-serif;
  background: var(--bg);
  color: var(--text);
}
*, *::before, *::after { box-sizing: border-box; }
html, body { margin: 0; min-height: 100%; background: var(--bg); color: var(--text); }
body {
  font-family: "Instrument Sans", "Segoe UI", sans-serif;
  line-height: 1.45;
  background:
    radial-gradient(1200px 600px at 10% -10%, rgba(61, 255, 200, 0.08), transparent 50%),
    linear-gradient(180deg, #0a0c12 0%, var(--bg) 40%);
}
h1, h2, h3 { color: var(--text); line-height: 1.15; letter-spacing: -0.03em; }
p { color: #c2cad8; }
`,
  },
  {
    defectId: "header",
    title: "Header that actually lays out",
    summary: "Separated brand, generation memory, and the Improve action so they no longer overlap.",
    notes: "Chip and primary button stay on one row on desktop.",
    doNotRegress: ["header flex layout", "generation chip readable"],
    css: `.top { display: flex; flex-wrap: wrap; gap: 16px; align-items: center; justify-content: space-between; margin-bottom: 22px; }
.brand { display: flex; gap: 12px; align-items: center; }
.mark {
  width: 44px; height: 44px; border-radius: 12px;
  display: grid; place-items: center;
  background: linear-gradient(160deg, var(--mint), #149e7a);
  color: #04110c; font-weight: 700; font-size: 22px;
}
.brand-kicker { margin: 0; letter-spacing: 0.16em; text-transform: uppercase; font-size: 11px; color: var(--mint); }
.brand h1 { margin: 2px 0 0; font-size: 22px; font-weight: 650; }
.top-meta { display: flex; gap: 10px; flex-wrap: wrap; align-items: center; }
.gen {
  display: flex; gap: 8px; align-items: baseline;
  background: var(--card); border: 1px solid var(--line); border-radius: 999px;
  padding: 8px 14px;
}
.gen-label { font-size: 11px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); }
.gen-num { font-family: "IBM Plex Mono", monospace; font-size: 24px; font-weight: 600; color: var(--mint); }
.gen-ver { color: var(--muted); font-size: 13px; }
button { font: inherit; cursor: pointer; border: 0; }
.primary, .ghost { border-radius: 999px; padding: 10px 16px; font-weight: 600; }
.primary { background: var(--mint); color: #04110c; position: static; }
.primary:disabled, .ghost:disabled { opacity: 0.55; cursor: wait; }
.ghost { background: transparent; color: var(--text); border: 1px solid var(--line); }
.notice { margin: 12px 0 0; padding: 10px 14px; border-radius: 12px; background: #16382f; color: var(--mint); }
.broken-banner { transform: none; background: #2a1a12; color: var(--amber); border: 1px solid #5a3b1e; padding: 10px 14px; border-radius: 12px; margin-bottom: 16px; }
`,
  },
  {
    defectId: "layout",
    title: "Page width, hero, and KPI grid",
    summary: "Constrained the shell, un-rotated the hero, and put the 10k stats on a real grid.",
    notes: "Do not let KPIs float or the shell exceed the viewport.",
    doNotRegress: ["max-width shell", "KPI css grid", "hero not rotated"],
    css: `.shell { width: min(1200px, calc(100% - 32px)); margin: 0 auto; padding: 28px 0 72px; float: none; }
.hero {
  display: grid; gap: 20px; grid-template-columns: 1.4fr 0.8fr;
  background: linear-gradient(180deg, #141a26, var(--card));
  border: 1px solid var(--line); border-radius: 22px; padding: 24px;
  margin-bottom: 16px; transform: none;
}
.eyebrow { margin: 0 0 6px; font-size: 11px; letter-spacing: 0.14em; text-transform: uppercase; color: var(--muted); }
.hero h2 { margin: 0 0 8px; font-size: clamp(26px, 4vw, 38px); }
.lede { margin: 0; max-width: 60ch; }
.hero-facts { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; margin: 0; }
.hero-facts div { background: #0c1018; border: 1px solid var(--line); border-radius: 12px; padding: 10px 12px; }
.hero-facts dt { font-size: 11px; color: var(--muted); text-transform: uppercase; }
.hero-facts dd { margin: 4px 0 0; font-family: "IBM Plex Mono", monospace; font-size: 13px; }
.kpis, .speed { display: grid; gap: 12px; margin: 0 0 16px; }
.kpis { grid-template-columns: repeat(6, minmax(0, 1fr)); }
.speed { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.kpi, .speed-card {
  float: none; width: auto; background: var(--card);
  border: 1px solid var(--line); border-radius: 16px; padding: 14px;
}
.kpi-val, .speed-num { margin: 0; font-family: "IBM Plex Mono", monospace; font-size: 24px; font-weight: 600; }
.hint, .speed-sub { margin: 6px 0 0; color: var(--muted); font-size: 12px; }
.speed-card.accent { background: linear-gradient(180deg, #16382f, #121722); }
`,
  },
  {
    defectId: "cards",
    title: "Pipeline and widget cards",
    summary: "Gave planner / worker / verifier / merge and worker widgets a shared card language.",
    notes: "Tone stripes stay; no dotted magenta leftovers.",
    doNotRegress: ["pipeline 4-up cards", "widget card language"],
    css: `.pipeline, .widgets { display: grid; gap: 12px; margin: 0 0 16px; }
.pipeline { grid-template-columns: repeat(4, minmax(0, 1fr)); }
.widgets { grid-template-columns: repeat(3, minmax(0, 1fr)); }
.pipe, .widget, .panel {
  background: var(--card); border: 1px solid var(--line); border-radius: 16px; padding: 16px;
}
.pipe h3, .widget h3 { margin: 0 0 6px; font-size: 17px; }
.pipe p, .widget p { margin: 0; color: #b7c0d0; font-size: 14px; }
.pipe-idx { font-family: "IBM Plex Mono", monospace; font-size: 12px; color: var(--muted); }
.tone-mint { box-shadow: inset 3px 0 0 var(--mint); }
.tone-amber { box-shadow: inset 3px 0 0 var(--amber); }
.tone-violet { box-shadow: inset 3px 0 0 var(--violet); }
.tone-rose { box-shadow: inset 3px 0 0 var(--rose); }
.tone-sky { box-shadow: inset 3px 0 0 var(--sky); }
.widget-val { margin: 0 0 6px; font-family: "IBM Plex Mono", monospace; font-size: 26px; }
.spark { width: 100%; height: 36px; margin-top: 10px; }
.bars { display: flex; align-items: flex-end; gap: 4px; height: 64px; margin-top: 10px; }
.bars span { flex: 1; background: currentColor; opacity: 0.8; border-radius: 4px 4px 0 0; }
`,
  },
  {
    defectId: "tree",
    title: "Recursive tree and agent memory",
    summary: "Made the depth tree scannable and pinned the memory of every accepted repair.",
    notes: "Memory is the source of truth. Do not hide open defects.",
    doNotRegress: ["visible memory history", "depth tree indentation"],
    css: `.split { display: grid; grid-template-columns: 1.2fr 0.8fr; gap: 12px; margin-bottom: 16px; }
.panel { min-width: 0; }
.panel-head { display: flex; justify-content: space-between; gap: 12px; align-items: flex-start; margin-bottom: 12px; }
.legend { display: flex; flex-wrap: wrap; gap: 8px; font-size: 12px; color: var(--muted); }
.tree { overflow-x: auto; }
.node-card {
  position: relative; background: #0c1018; border: 1px solid var(--line);
  border-radius: 12px; padding: 10px 12px; margin-bottom: 8px;
}
.node-card .role { font-size: 10px; letter-spacing: 0.12em; text-transform: uppercase; color: var(--muted); }
.node-card strong { display: block; margin: 4px 0; }
.node-card .depth { position: absolute; top: 10px; right: 10px; font-family: "IBM Plex Mono", monospace; font-size: 11px; color: var(--muted); }
.kids { display: flex; gap: 10px; padding-left: 14px; border-left: 1px dashed #2a3344; }
.feed, .memory { list-style: none; margin: 0; padding: 0; display: grid; gap: 8px; }
.feed-item, .memory-item { padding: 12px; border-radius: 12px; border: 1px solid var(--line); background: #0c1018; }
.feed-item.selected, .memory-item.open { border-color: var(--amber); }
.feed-item.fixed, .memory-item.fixed { border-color: #245246; }
.pill { font-family: "IBM Plex Mono", monospace; color: var(--mint); font-size: 12px; }
`,
  },
  {
    defectId: "polish",
    title: "Quality pass and mobile stack",
    summary: "Tightened spacing, shadows, and a one-column mobile layout so the repaired UI holds up in a screenshot.",
    notes: "Last open defect. After this the agent has rebuilt the console from memory.",
    doNotRegress: ["mobile single column", "consistent 12/16/24 rhythm"],
    css: `.shell { padding-bottom: 80px; }
.hero, .panel { box-shadow: 0 20px 50px rgba(0, 0, 0, 0.28); }
@media (max-width: 980px) {
  .hero, .split { grid-template-columns: 1fr; }
  .kpis { grid-template-columns: repeat(3, minmax(0, 1fr)); }
  .speed, .pipeline, .widgets { grid-template-columns: 1fr 1fr; }
  .kids { flex-direction: column; }
}
@media (max-width: 640px) {
  .shell { width: calc(100% - 20px); padding-top: 16px; }
  .kpis, .speed, .pipeline, .widgets { grid-template-columns: 1fr; }
  .primary, .ghost { width: 100%; }
  .brand h1 { font-size: 18px; }
}
`,
  },
];

export function repairForDefect(defectId: string): DashboardRepair | null {
  return DASHBOARD_REPAIRS.find((repair) => repair.defectId === defectId) ?? null;
}
