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
    notes: "Gen-0 quality pass. Later catalog items keep raising the bar; do not flatten the stack.",
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
  {
    defectId: "type-scale",
    title: "Modular type scale",
    summary: "Locked a 12/14/16/22/28/38 scale so titles, kicker, and body stay in one family.",
    notes: "Keep Instrument Sans. Never restore Comic Sans or Papyrus after gen 0.",
    doNotRegress: ["modular type scale", "no Comic Sans after gen 0"],
    css: `:root {
  --fs-kicker: 0.6875rem;
  --fs-caption: 0.75rem;
  --fs-body: 0.9375rem;
  --fs-title: 1.125rem;
  --fs-display: clamp(1.625rem, 3vw, 2.375rem);
  --lh-tight: 1.18;
  --lh-body: 1.5;
}
html, body, button { font-family: "Instrument Sans", "Segoe UI", sans-serif; }
.brand-kicker, .eyebrow, .gen-label, .node-card .role {
  font-size: var(--fs-kicker);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  line-height: 1.3;
}
.brand h1 { font-size: 1.375rem; font-weight: 650; line-height: var(--lh-tight); letter-spacing: -0.03em; }
.hero h2, .panel-head h2 { font-size: var(--fs-display); font-weight: 650; letter-spacing: -0.035em; line-height: var(--lh-tight); }
.pipe h3, .widget h3, .memory-item h3, .feed-item h3 { font-size: var(--fs-title); font-weight: 620; letter-spacing: -0.02em; }
.lede, .pipe p, .widget p, .memory-item p, .feed-item p { font-size: var(--fs-body); line-height: var(--lh-body); }
.hint, .speed-sub, .worker, .pill { font-size: var(--fs-caption); }
`,
  },
  {
    defectId: "spacing",
    title: "Spacing rhythm",
    summary: "Replaced ad-hoc gaps with a 4px rhythm so cards, panels, and the shell share one beat.",
    notes: "4 / 8 / 12 / 16 / 24 / 32. Do not invent random pixel gaps.",
    doNotRegress: ["4px spacing rhythm"],
    css: `:root {
  --space-1: 4px;
  --space-2: 8px;
  --space-3: 12px;
  --space-4: 16px;
  --space-5: 24px;
  --space-6: 32px;
}
.shell { padding: var(--space-5) 0 80px; }
.top { gap: var(--space-4); margin-bottom: var(--space-5); }
.hero, .panel, .pipe, .widget, .kpi, .speed-card { padding: var(--space-4); }
.kpis, .speed, .pipeline, .widgets, .split { gap: var(--space-3); margin-bottom: var(--space-4); }
.panel-head { margin-bottom: var(--space-3); gap: var(--space-3); }
.feed, .memory { gap: var(--space-2); }
.node-card { padding: 10px var(--space-3); margin-bottom: var(--space-2); }
`,
  },
  {
    defectId: "focus",
    title: "Visible focus states",
    summary: "Gave buttons, memory rows, and the Improve action a mint focus ring that survives dark UI.",
    notes: "Keyboard users must see where they are. Do not remove outlines.",
    doNotRegress: ["visible mint focus ring"],
    css: `:focus { outline: none; }
:focus-visible {
  outline: 2px solid var(--mint);
  outline-offset: 3px;
}
.primary:focus-visible { outline-color: #04110c; outline-offset: 3px; box-shadow: 0 0 0 4px rgba(61, 255, 200, 0.45); }
.ghost:focus-visible, .feed-item:focus-visible, .memory-item:focus-visible {
  outline: 2px solid var(--mint);
  outline-offset: 2px;
}
.feed-item, .memory-item { cursor: pointer; }
.feed-item:hover, .memory-item:hover { border-color: #3a4558; }
button.primary:hover { filter: brightness(1.04); }
button.ghost:hover { background: #171d28; }
`,
  },
  {
    defectId: "contrast",
    title: "Contrast and muted text",
    summary: "Raised muted copy and borders so captions stay AA against the dark cards.",
    notes: "Muted is #9aa3b5 minimum. Do not drop body text below #c2cad8.",
    doNotRegress: ["AA muted contrast", "body text #c2cad8"],
    css: `:root {
  --text: #eef2f8;
  --muted: #9aa3b5;
  --line: #2b3344;
}
p, .lede, .pipe p, .widget p { color: #c8d0de; }
.hint, .speed-sub, .worker, .gen-label, .eyebrow, .pipe-idx { color: var(--muted); }
.broken-banner { color: #ffd089; background: #2a1d12; border-color: #6a4a24; }
.notice { color: #9ff6dc; }
.memory-item.open h3, .feed-item.selected h3 { color: var(--text); }
`,
  },
  {
    defectId: "tree-polish",
    title: "Depth tree polish",
    summary: "Role dots, status edges, and hanging gutters make the recursive tree scannable at a glance.",
    notes: "Keep left-rail kids and depth badges. Do not collapse nested nodes.",
    doNotRegress: ["role legend dots", "tree status edges"],
    css: `.legend { align-items: center; gap: 10px; }
.legend .dot {
  display: inline-flex; align-items: center; gap: 6px;
  text-transform: lowercase;
}
.legend .dot::before {
  content: ""; width: 8px; height: 8px; border-radius: 99px; background: var(--muted);
}
.legend .dot.planner::before { background: var(--violet); }
.legend .dot.worker::before { background: var(--mint); }
.legend .dot.verifier::before { background: var(--amber); }
.legend .dot.merge::before { background: var(--sky); }
.node { min-width: 0; }
.node-card { padding-right: 42px; }
.node.role-planner > .node-card { box-shadow: inset 3px 0 0 var(--violet); }
.node.role-worker > .node-card { box-shadow: inset 3px 0 0 var(--mint); }
.node.role-verifier > .node-card { box-shadow: inset 3px 0 0 var(--amber); }
.node.role-merge > .node-card { box-shadow: inset 3px 0 0 var(--sky); }
.node.status-running > .node-card { border-color: #3d6a5c; }
.node.status-done > .node-card { border-color: #245246; }
.node.status-queued > .node-card { opacity: 0.86; }
.kids { display: flex; flex-direction: column; gap: 8px; margin: 4px 0 4px 8px; padding-left: 14px; border-left: 1px dashed #334055; }
`,
  },
  {
    defectId: "kpi-hierarchy",
    title: "KPI visual hierarchy",
    summary: "Made merged the hero metric and put supporting 10k stats on a quieter scale.",
    notes: "Merged stays loud. Do not equalize every KPI or restore 400-ticket labels.",
    doNotRegress: ["merged KPI emphasis", "no 400-ticket labels"],
    css: `.kpis .kpi,
.speed-card {
  float: none;
  width: auto;
  min-height: 0;
  background: var(--card);
  color: var(--text);
  border: 1px solid var(--line);
}
.kpis .kpi:nth-child(3) {
  background: linear-gradient(180deg, #16382f, var(--card));
  border-color: #2a5a4c;
}
.kpis .kpi:nth-child(3) .kpi-val { color: var(--mint); font-size: 28px; }
.kpi-val, .speed-num {
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.03em;
  line-height: 1.1;
}
.speed-num span { font-size: 0.55em; color: var(--muted); font-weight: 500; margin-left: 2px; }
.speed-card.accent .speed-num { color: var(--mint); }
.kpi .eyebrow, .speed-card .eyebrow { margin-bottom: 8px; }
`,
  },
  {
    defectId: "motion",
    title: "Subtle motion",
    summary: "Added short, low-amplitude transitions on hover and paint so the UI feels finished, not jumpy.",
    notes: "150–180ms, opacity and border only. No bounce, no spin.",
    doNotRegress: ["subtle 160ms transitions"],
    css: `.kpi, .speed-card, .pipe, .widget, .panel, .node-card, .feed-item, .memory-item, .primary, .ghost {
  transition: border-color 160ms ease, background-color 160ms ease, box-shadow 160ms ease, filter 160ms ease;
}
.hero { transition: box-shadow 180ms ease; }
.feed-item.selected, .memory-item.open {
  box-shadow: inset 0 0 0 1px rgba(255, 200, 87, 0.35);
}
`,
  },
  {
    defectId: "memory-read",
    title: "Memory panel readability",
    summary: "Separated open defects from accepted history and gave each row a clearer meta line.",
    notes: "Memory remains the source of truth. Do not hide history.",
    doNotRegress: ["defect / history separation", "readable memory meta"],
    css: `.feed-panel .memory { margin-bottom: 14px; padding-bottom: 14px; border-bottom: 1px solid var(--line); }
.feed-meta {
  display: flex; align-items: baseline; justify-content: space-between; gap: 8px;
  margin-bottom: 6px; color: var(--muted); font-size: 12px;
}
.memory-item h3, .feed-item h3 { margin: 0 0 4px; }
.memory-item p, .feed-item p { margin: 0; }
.memory-item.fixed .pill { color: #8fd9c4; }
.memory-item.open .pill { color: var(--amber); }
.feed-item .worker, .memory-item .worker { margin-top: 8px; color: var(--muted); font-family: "IBM Plex Mono", monospace; }
.feed-item time { font-variant-numeric: tabular-nums; }
`,
  },
  {
    defectId: "a11y",
    title: "Accessibility landmarks",
    summary: "Reduced motion, skip target, and hit-area fixes so the console is usable with keyboard and AT.",
    notes: "Honor prefers-reduced-motion. Keep 44px targets on primary actions.",
    doNotRegress: ["prefers-reduced-motion", "44px action targets"],
    css: `.primary, .ghost { min-height: 44px; min-width: 44px; }
.shell { scroll-margin-top: 16px; }
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation: none !important;
    transition: none !important;
    scroll-behavior: auto !important;
  }
}
.node-card .role { font-weight: 650; }
.broken-banner, .notice { font-weight: 550; }
@media (forced-colors: active) {
  .primary, .ghost, .kpi, .pipe, .widget, .panel, .node-card {
    border: 1px solid ButtonText;
    box-shadow: none;
  }
}
`,
  },
  {
    defectId: "mobile-density",
    title: "Mobile density",
    summary: "Tightened phone layout: smaller type, stacked actions, and cards that do not waste vertical space.",
    notes: "Phone is a first-class surface. Keep one column under 640px.",
    doNotRegress: ["compact 640px density"],
    css: `@media (max-width: 640px) {
  .shell { width: calc(100% - 16px); padding: 12px 0 56px; }
  .top { margin-bottom: 14px; }
  .brand { gap: 10px; }
  .mark { width: 36px; height: 36px; font-size: 18px; border-radius: 10px; }
  .hero, .panel, .pipe, .widget, .kpi, .speed-card { padding: 12px; border-radius: 14px; }
  .hero h2 { font-size: 1.45rem; }
  .kpi-val, .speed-num { font-size: 20px; }
  .gen { width: 100%; justify-content: space-between; }
  .top-meta { width: 100%; }
  .feed-item, .memory-item, .node-card { padding: 10px; }
}
`,
  },
  {
    defectId: "buttons",
    title: "Button states",
    summary: "Primary and ghost now have hover, active, and disabled treatments that match the mint system.",
    notes: "Disabled is wait, not invisible. Keep the mint fill.",
    doNotRegress: ["primary mint fill", "ghost border button"],
    css: `.primary, .ghost {
  display: inline-flex; align-items: center; justify-content: center; gap: 8px;
  letter-spacing: -0.01em;
}
.primary { box-shadow: 0 1px 0 rgba(255, 255, 255, 0.18) inset, 0 8px 18px rgba(61, 255, 200, 0.12); }
.primary:active { transform: translateY(1px); }
.ghost:active { background: #121722; }
.primary:disabled, .ghost:disabled { transform: none; filter: none; }
`,
  },
  {
    defectId: "elevation",
    title: "Layered elevation",
    summary: "Hero and panels sit above the page wash; inner cards stay flatter so depth reads as hierarchy.",
    notes: "One shadow language. No neon glow.",
    doNotRegress: ["layered card elevation"],
    css: `.shell {
  background: transparent;
}
.hero {
  box-shadow: 0 24px 60px rgba(0, 0, 0, 0.32), inset 0 1px 0 rgba(255, 255, 255, 0.04);
}
.panel {
  box-shadow: 0 16px 40px rgba(0, 0, 0, 0.24);
}
.kpi, .speed-card, .pipe, .widget, .feed-item, .memory-item, .node-card {
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.03);
}
`,
  },
  {
    defectId: "tabular",
    title: "Tabular numbers",
    summary: "Generation chip, KPIs, and tree depth use IBM Plex Mono tabular figures so columns do not jitter.",
    notes: "Mono is for numbers only. Body copy stays Instrument Sans.",
    doNotRegress: ["tabular mono numbers"],
    css: `.gen-num, .kpi-val, .speed-num, .widget-val, .pipe-idx, .node-card .depth, .pill {
  font-family: "IBM Plex Mono", ui-monospace, monospace;
  font-variant-numeric: tabular-nums;
}
.hero-facts dd { font-variant-numeric: tabular-nums; }
`,
  },
  {
    defectId: "scroll",
    title: "Quiet scrollbars",
    summary: "Tree and memory panes get thin, dark scrollbars so overflow does not flash OS chrome.",
    notes: "Keep overflow-x on the tree. Do not clip node labels.",
    doNotRegress: ["thin dark scrollbars"],
    css: `.tree, .feed-panel .feed, .feed-panel .memory {
  scrollbar-width: thin;
  scrollbar-color: #3a4558 transparent;
}
.tree::-webkit-scrollbar, .feed::-webkit-scrollbar, .memory::-webkit-scrollbar { height: 8px; width: 8px; }
.tree::-webkit-scrollbar-thumb, .feed::-webkit-scrollbar-thumb, .memory::-webkit-scrollbar-thumb {
  background: #3a4558; border-radius: 99px;
}
.feed-panel .feed, .feed-panel .memory { max-height: none; }
.tree { overflow-x: auto; padding-bottom: 4px; }
`,
  },
  {
    defectId: "status-color",
    title: "Status color semantics",
    summary: "Open / fixed / selected states now share one amber-mint language across banner, pills, and rows.",
    notes: "Amber means open work. Mint means accepted. Do not reintroduce yellow/magenta gen-0 clash.",
    doNotRegress: ["amber open / mint fixed"],
    css: `.memory-item.open { border-color: #7a5a2a; background: #16120c; }
.memory-item.fixed { border-color: #245246; background: #0c1412; }
.feed-item.selected { border-color: var(--amber); }
.broken-banner { letter-spacing: -0.01em; }
.pill { letter-spacing: 0.04em; }
`,
  },
  {
    defectId: "hero-type",
    title: "Hero measure and leading",
    summary: "Constrained the lede to 58ch and calmed the generation eyebrow so the hero reads as one block.",
    notes: "Hero stays un-rotated. Lede stays readable.",
    doNotRegress: ["58ch hero measure"],
    css: `.hero { align-items: start; }
.hero .eyebrow { margin-bottom: 8px; color: var(--mint); }
.lede { max-width: 58ch; color: #c8d0de; }
.hero-facts { align-self: stretch; }
.hero-facts div { min-height: 64px; }
`,
  },
  {
    defectId: "panel-head",
    title: "Panel header alignment",
    summary: "Eyebrow, title, and legend sit on one optical baseline so the split does not look handmade.",
    notes: "Legend hugs the right edge on desktop.",
    doNotRegress: ["panel header baseline"],
    css: `.panel-head { align-items: flex-end; }
.panel-head h2 { margin: 0; }
.panel-head .eyebrow { margin: 0 0 4px; }
.legend { justify-content: flex-end; }
@media (max-width: 980px) {
  .panel-head { align-items: flex-start; flex-direction: column; }
  .legend { justify-content: flex-start; }
}
`,
  },
  {
    defectId: "selection",
    title: "Selection and caret",
    summary: "Mint selection and a quieter caret so highlighting copy does not flash the gen-0 yellow.",
    notes: "Selection uses mint-on-dark. Never yellow-on-blue.",
    doNotRegress: ["mint text selection"],
    css: `::selection { background: rgba(61, 255, 200, 0.28); color: var(--text); }
input, textarea, button { caret-color: var(--mint); }
`,
  },
  {
    defectId: "hairlines",
    title: "Optical hairlines",
    summary: "Softened borders to a 1px line at 16% white so cards separate without a heavy grid.",
    notes: "One border weight. No dotted magenta leftovers.",
    doNotRegress: ["1px hairline borders"],
    css: `:root { --line: color-mix(in srgb, #ffffff 16%, #121722); }
.hero, .panel, .kpi, .speed-card, .pipe, .widget, .node-card, .feed-item, .memory-item, .gen, .ghost {
  border-width: 1px;
  border-style: solid;
}
`,
  },
  {
    defectId: "widget-opt",
    title: "Widget optical polish",
    summary: "Tone stripes, spark stroke, and value sizing so worker widgets match the pipeline cards.",
    notes: "Keep the 3px tone inset. No red float leftovers.",
    doNotRegress: ["3px tone inset", "spark stroke 1.75"],
    css: `.widget { overflow: hidden; }
.widget .eyebrow { margin: 0 0 6px; }
.widget-val span { margin-left: 4px; color: var(--muted); font-size: 0.55em; }
.spark { color: var(--mint); }
.spark polyline { stroke-width: 1.75; stroke-linejoin: round; stroke-linecap: round; }
.bars span { opacity: 0.72; }
.widget.tone-mint { color: inherit; }
`,
  },
  {
    defectId: "banner",
    title: "Status banner composure",
    summary: "Stopped the banner from shouting — same radius and padding as notices, no rotation.",
    notes: "Banner is status, not decoration. Keep it level.",
    doNotRegress: ["level status banner"],
    css: `.broken-banner {
  transform: none;
  font-size: 13px;
  line-height: 1.4;
  padding: 10px 14px;
  border-radius: 12px;
  margin: 0 0 16px;
}
.notice { margin-top: 12px; }
`,
  },
  {
    defectId: "link-affordance",
    title: "Interactive affordance",
    summary: "Memory rows and Improve look clickable without turning the page into a button farm.",
    notes: "Pointer and hover only. No underline soup.",
    doNotRegress: ["clickable memory rows"],
    css: `.feed-item, .memory-item { cursor: pointer; }
.feed-item:hover, .memory-item:hover { background: #10151f; }
.primary, .ghost { cursor: pointer; }
.primary:disabled, .ghost:disabled { cursor: wait; }
`,
  },
];

export function unpublishedRepairs(publishedIds: Iterable<string>): DashboardRepair[] {
  const used = new Set(publishedIds);
  return DASHBOARD_REPAIRS.filter((repair) => !used.has(repair.defectId));
}

export function synthesizeQualityRepair(pass: number): DashboardRepair {
  const n = Math.max(1, Math.floor(pass));
  const defectId = `gen-quality-${n}`;
  const pad = 64 + (n % 24);
  return {
    defectId,
    title: `Quality pass ${n}`,
    summary: `Next highest-quality polish pass ${n}. Unique CSS, no gen-0 regressions.`,
    notes: "Keep going. Do not restore the gen-0 broken type or a rotated hero.",
    doNotRegress: [`quality pass ${n}`, "no Comic Sans after gen 0"],
    css: `:root { --agent-quality-pass: ${n}; }
.shell { padding-bottom: ${pad}px; }
.panel, .widget, .kpi { border-radius: ${16 + (n % 4)}px; }
`,
  };
}

export function repairForDefect(defectId: string): DashboardRepair | null {
  const catalog = DASHBOARD_REPAIRS.find((repair) => repair.defectId === defectId);
  if (catalog) return catalog;
  const match = /^gen-quality-(\d+)$/.exec(defectId);
  if (!match?.[1]) return null;
  return synthesizeQualityRepair(Number(match[1]));
}
