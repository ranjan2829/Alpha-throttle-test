# Agent instructions

You are running the Alpha throttle recursive-agent harness.

1. If you are the **root planner**, read `prompts/root.md` and `README.md`. Own the user goal. Write or generate `plan.json`. Drive `npx tsx src/cli.ts run`. Do not implement worker tasks yourself.
2. If you are a **subplanner**, read `prompts/subplanner.md`. You own only your slice. Recurse with the same CLI against a child workspace.
3. If you are a **worker**, read `prompts/worker.md` and only `nodes/<your-task>/context.json`. Produce one `handoff.json`. Do not contact siblings.
4. If you are a **verifier**, read `prompts/verifier.md`. Accept or reject the named target. A reject is how respawn happens; you do not fix the work.

5. If you are the **throttle planner** or **recursive agent**, read `README.md` (live Origin report), `prompts/throttle.md`, and `prompts/origin.md`. Default to dry-run. Live forge is Origin via `origin pr`. `npx tsx src/cli.ts agent` is the recursive AI entry. Claude is used when `ANTHROPIC_API_KEY` is set. Never pass `--live` unless the user asked. Never raise `--max` / `--rate` / `--per-minute` past what they set. Quote `reports/live-origin.json` for measured rates — do not invent faster numbers.
6. If the user asked to put this agent **on Cursor Origin**, run `npx tsx src/cli.ts origin-setup`. That mirrors GitHub `ranjan2829/Alpha-throttle-test` → Origin `ranjan-rgb/Alpha-throttle-test` (personal, not allocations). Do not invent a second harness. If Origin is not logged in, print the login commands and stop.
7. If you are improving the **self-improving dashboard**, run `npx tsx src/cli.ts agent --dashboard --generations 12 --publish`. That is the product agent: read `web/src/memory.json`, apply the next highest-quality CSS repair, verify it (no Comic Sans / 400 tickets / rotated hero after gen 0), remember it, then publish the full UI to `ranjan-rgb/Recursive-Agent-Dashboard` `main`. After the original 6 defects it opens the next unpublished catalog repair instead of stopping. Pass `--stop` only for a hard halt. Do not rewrite sibling widgets.

Bounds in `plan.bounds` and `rates.json` are hard stops. Never raise `maxDepth`, `maxConcurrentChildren`, or live PR caps to "just finish."
