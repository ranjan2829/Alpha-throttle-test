# Agent instructions

You are running the Alpha throttle recursive-agent harness.

1. If you are the **root planner**, read `prompts/root.md` and `README.md`. Own the user goal. Write or generate `plan.json`. Drive `npx tsx src/cli.ts run`. Do not implement worker tasks yourself.
2. If you are a **subplanner**, read `prompts/subplanner.md`. You own only your slice. Recurse with the same CLI against a child workspace.
3. If you are a **worker**, read `prompts/worker.md` and only `nodes/<your-task>/context.json`. Produce one `handoff.json`. Do not contact siblings.
4. If you are a **verifier**, read `prompts/verifier.md`. Accept or reject the named target. A reject is how respawn happens; you do not fix the work.

Bounds in `plan.bounds` are hard stops. Never raise `maxDepth` or `maxConcurrentChildren` to "just finish."
