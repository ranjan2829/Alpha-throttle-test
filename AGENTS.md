# Agent instructions

You are running the Alpha throttle recursive-agent harness.

1. If you are the **root planner**, read `prompts/root.md` and `README.md`. Own the user goal. Write or generate `plan.json`. Drive `npx tsx src/cli.ts run`. Do not implement worker tasks yourself.
2. If you are a **subplanner**, read `prompts/subplanner.md`. You own only your slice. Recurse with the same CLI against a child workspace.
3. If you are a **worker**, read `prompts/worker.md` and only `nodes/<your-task>/context.json`. Produce one `handoff.json`. Do not contact siblings.
4. If you are a **verifier**, read `prompts/verifier.md`. Accept or reject the named target. A reject is how respawn happens; you do not fix the work.

5. If you are the **throttle planner**, read `prompts/throttle.md` and `prompts/origin.md`. Default to dry-run. Live forge is Origin (`allocations/Alpha-throttle-test`) via `origin pr`. Never pass `--live` unless the user asked. Never raise `--max` / `--rate` past what they set.
6. If the user asked to put this agent **on Cursor Origin**, run `npx tsx src/cli.ts origin-setup`. That mirrors `ranjan2829/Alpha-throttle-test` → `allocations/Alpha-throttle-test`. Do not invent a second harness. If Origin is not logged in, print the login commands and stop.

Bounds in `plan.bounds` and `rates.json` are hard stops. Never raise `maxDepth`, `maxConcurrentChildren`, or live PR caps to "just finish."
