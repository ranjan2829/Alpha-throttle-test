# Alpha-throttle-test

Bounded recursive-agent harness for **Cursor Origin / cloud agents**.

A root planner owns a user goal, writes `plan.json`, and a script runs the spawn → wait → handoff loop. Workers and verifiers never talk to each other. They report up through JSON handoffs on disk. The loop stops when the goal is met or a hard depth / concurrency / respawn cap is hit.

This is an `/orchestrate`-style **planner → worker → verifier** tree, not a single chat wrapper. Long-running agent transcripts drift; a script plus JSON state keeps its footing.

## Architecture

```
user goal
   │
   ▼
root planner          writes plan.json  (no coding)
   │
   ├── worker         isolated context, one scoped task, one handoff
   ├── worker
   ├── verifier       accept | reject  → reject respawns the target
   └── subplanner ↻   same loop on a slice, depth + 1
```

| Node        | Runs the loop? | Scope                 | Output                         |
| ----------- | -------------- | --------------------- | ------------------------------ |
| Planner     | yes            | Entire user goal      | `plan.json` + stop decision    |
| Subplanner  | yes            | One slice             | Aggregated handoff to parent   |
| Worker      | no             | One concrete task     | `handoffs/<name>.json`         |
| Verifier    | no             | One target's checks   | Verdict handoff (`accept`/`reject`) |

Workers do not see sibling tasks. Each child gets `nodes/<task>-aN/` with only `task.json` / `context.json` (parent goal, own acceptance, declared upstream handoffs). No shared sibling channel.

## Recursion bounds

Hard caps, not soft hints. Defaults:

| Bound                     | Default | Meaning                                              |
| ------------------------- | ------- | ---------------------------------------------------- |
| `maxDepth`                | `3`     | Root is depth 0. A node cannot spawn past this.      |
| `maxConcurrentChildren`   | `3`     | In-flight children of **one** planner.               |
| `maxResawnsPerTask`       | `2`     | Verifier rejects may respawn a target this many times. |

Hitting a cap writes `status: cap-hit` on the task and stops that branch. The run exits `1` with `stopped: cap-hit`.

## Run locally

Requires Node 20+.

```bash
npm install
npm run typecheck
npm test
npm run smoke
```

Point the harness at a goal:

```bash
npx tsx src/cli.ts run --goal "Write a hello artifact"
```

That command:

1. Decomposes the goal into worker + verifier tasks (`plan.json`).
2. Spawns each worker in an isolated node directory (`adapter=local` runs the leaf runner against only that context).
3. Collects `handoffs/*.json`.
4. Runs the verifier. `reject` respawns the worker (until the respawn cap).
5. Prints the tree and exits `0` only when every task handed off successfully.

Useful flags:

```bash
npx tsx src/cli.ts run --goal "Write alpha and then write beta" \
  --workspace .alpha/demo \
  --max-depth 2 \
  --max-concurrency 2 \
  --max-respawns 1 \
  --adapter local

npx tsx src/cli.ts plan --goal "Write a hello artifact" --workspace .alpha/demo
npx tsx src/cli.ts tree --workspace .alpha/demo
```

`npm run smoke` is the no-hang path: happy-path plan → spawn → handoff, plus a `[fail-first]` goal that rejects once and respawns.

Workspace layout after a run:

```
.alpha/<slug>/
  plan.json
  state.json
  attention.log
  handoffs/<task>.json
  nodes/<task>-a<attempt>/
    context.json
    task.json
    handoff.json
    artifacts/
```

## Origin / cloud-agent usage

On Cursor Origin or a cloud agent, treat this repo as the harness, not as a chat log.

**Root planner (you, if the user asked for a goal).** Read `prompts/root.md`. Own the goal. Do not implement the work yourself. Either:

```bash
npx tsx src/cli.ts run --goal "<the user's goal>" --workspace .alpha/<slug>
```

or write `plan.json` yourself (`npx tsx src/cli.ts plan ...` then edit tasks) and run the same command. Publish `verifier` tasks with `verifies: "<target>"`. If a slice still needs its own tree, publish a `subplanner`.

**Worker / verifier children.** Origin can spawn isolated child agents (Task / cloud agent) with `prompts/worker.md` or `prompts/verifier.md`. Each child reads only its `nodes/<task>-aN/context.json` and must write `handoff.json` in that directory. Then run the parent with `--adapter files` so the script waits for those files instead of spawning local processes:

```bash
npx tsx src/cli.ts run --goal "<goal>" --workspace .alpha/<slug> --adapter files
```

`--adapter files` times out if a child never writes a handoff (default 8s locally; raise it for live agents). `--adapter local` is the smoke path and does not hang: children are in-process node runners.

**Do not** let workers call each other, share a chat, or read sibling `nodes/` directories. Relay happens only through declared `dependsOn` handoffs that the parent pastes into the child context.

## Handoff shape

```json
{
  "schemaVersion": 1,
  "taskName": "do-1-write-a-hello-artifact",
  "type": "worker",
  "status": "success",
  "summary": "wrote artifacts/result.md with token write",
  "artifacts": ["artifacts/result.md"],
  "notes": [],
  "followUps": [],
  "attempt": 1
}
```

A verifier adds `"verdict": "accept" | "reject"` and, on reject, `"rejectReason"`. The orchestrator marks the target `rejected` and respawns it when attempts remain.

Machine-checkable acceptance used by the local runner: `contains:<token>` must appear as a `contains:<token>` line in the worker's artifact or summary.

## What this is not

- Not a wrapper that dumps the whole goal into one agent session.
- Not a copy of the Cursor `/orchestrate` plugin (no Slack, no `@cursor/sdk` cloud spawn). The loop, isolation, and verifier-respawn contract are the same idea, sized so Origin can run and review it here.
