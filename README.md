# Alpha-throttle-test

Recursive planner → worker → verifier agent for **Cursor Origin**.

Cursor origin · Alpha throttle test · make a recursive agent on cursor origin.

GitHub: `ranjan2829/Alpha-throttle-test`  
Origin (live): [`allocations/Alpha-throttle-test`](https://cursor.com/codebase/allocations/Alpha-throttle-test)

The planner splits a goal and **calls itself** on each slice until a depth cap. Leaves open one isolated PR, check the build, then merge. Claude is the planner when `ANTHROPIC_API_KEY` is set (gitignored `.env`). Without a key the same tree runs deterministically.

---

## Live Origin report

Measured **23 Aug 2026**. Planner: **Claude Sonnet 5**. Forge: Origin. CI on this repo: **none** (checks always `none`).

Target asked: **500 PRs / minute** (open + check + merge).  
**500 PRs / second is not possible** over Origin HTTP.

### Headline — 500-ticket burst

| | |
| --- | ---: |
| Wall clock | **147 s** (2 min 27 s) |
| Attempted | **500** |
| Opened | **369** (73.8%) |
| Merged in-loop | **292** (58.4% of attempted, 79.1% of opened) |
| Swept after | **+13** |
| **Merged total** | **305** (61.0%) |
| Left open | 77 |
| Errors | 131 |
| HTTP 429 | **0** |
| Build failures | **0** |

Machine-readable copy: [`reports/live-origin.json`](reports/live-origin.json).

### Throughput

| | per second | per minute |
| --- | ---: | ---: |
| Attempted | 3.40 | **204** |
| Opened | 2.51 | **151** |
| Merged | 1.99 | **119** |

That is the measured Origin ceiling on this run: about **200 attempts / min**, **120 merges / min**. Not 500/s. Not a clean 500/min.

### Latency (ms)

| Stage | n | avg | p50 | p95 |
| --- | ---: | ---: | ---: | ---: |
| Open (includes queue wait at concurrency 16) | 500 | 52 766 | 54 301 | 95 108 |
| Merge | 292 | 6 569 | 5 981 | 10 660 |

Open p50 ~54 s is queueing, not Origin create time. A quiet 8-ticket run opened in **1.4 s** avg.

### Errors (500 burst)

All 131 errors were empty git SHAs under load. Zero Origin 429s.

| Cause | Count |
| --- | ---: |
| `git commit-tree` empty | 56 |
| `git hash-object` empty | 44 |
| `git write-tree` empty | 31 |
| **Total** | **131** |

Retries for blank SHAs shipped after this run.

PRs with a URL on this burst: **336** (numbers **#64–#432**).

### Proof run — 8/8 clean

| | |
| --- | ---: |
| Attempted / merged | **8 / 8** |
| Errors / 429s | **0 / 0** |
| Wall | 8.7 s |
| Avg open | 1 415 ms |
| Avg merge | 3 399 ms |
| PRs | [#56](https://cursor.com/codebase/allocations/Alpha-throttle-test/pull/56)–[#63](https://cursor.com/codebase/allocations/Alpha-throttle-test/pull/63) |

### Earlier baselines

| Run | Attempted | Opened | Merged | 429 | Errors | Wall | Notes |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| Origin probe | 2 | 2 | — | 0 | 0 | — | avg open 1 260 ms |
| Origin sat (open only) | 50 | 43 | — | 0 | 7 | 37.0 s | 1.16 opens / s |
| Origin merge | 10 | 9 | 6 | 0 | 1 | — | leftover stack heads |
| GitHub sat | 5 | 0 real PRs | — | 0 | 1 | 2.8 s | `gh pr create` 403; 4 compare URLs |

Origin is the live forge. GitHub integration tokens cannot create PRs here.

---

## How the recursion works

One planner owns the goal. If the burst is still large and depth remains, it splits and **calls itself** on each half. Leaves are workers.

```
Claude planner                         depth 0
        ├── planner                    depth 1
        │     └── worker → unique file → Origin PR → checks → merge
        └── planner                    depth 1
              └── worker
```

Hard stop: `maxDepth`. Not agents chatting. Same function, smaller slice, higher depth.

Conflict rule: every ticket is `tickets/<run>/<seq>.md` on a **frozen** `main` SHA. PRs are siblings, not a stack. Origin stack parents are cleared. Merges restack onto latest `main` if Origin races.

---

## Run

Node 20+.

```bash
npm install
npm test
npm run smoke
```

### Recursive agent (Origin throttle)

```bash
# dry-run — no PRs
npx tsx src/cli.ts agent --max 16 --concurrency 8

# live — keep going until 100k PRs merge (chunked, resume-safe)
npx tsx src/cli.ts agent --live --fast --until-merged 100000 --chunk 400 --concurrency 32 \
  --forge origin --repo allocations/Alpha-throttle-test
```

Copy `.env.example` to `.env`. Never commit the key.

Ticket commits are **Ranjan S `<ranjan@allocations.com>`**. PRs are opened as the `origin auth` login (`ranjan@allocations.com`). Merges use a **merge commit**, not squash — Origin squash was rewriting the author to a Cursor noreply. Override commit identity with `ALPHA_GIT_NAME` / `ALPHA_GIT_EMAIL`.

`--live` without `--max` / `--per-minute` caps at 3 PRs.

### Goal harness

```bash
npx tsx src/cli.ts run --goal "Write a hello artifact"
npx tsx src/cli.ts plan --goal "Write a hello artifact" --workspace .alpha/demo
npx tsx src/cli.ts tree --workspace .alpha/demo
```

### Origin host

```bash
npx tsx src/cli.ts origin-setup
npx tsx src/cli.ts origin-finish --repo allocations/Alpha-throttle-test
```

```bash
curl -fsSL https://downloads.cursor.com/origin/install.sh | sh
origin auth login
```

---

## Architecture

```
user goal
   │
   ▼
root planner          plan.json
   ├── worker         isolated context, one handoff
   ├── verifier       accept | reject → reject respawns
   └── subplanner ↻   same loop, depth + 1
```

| Bound | Default | Meaning |
| --- | ---: | --- |
| `maxDepth` | 3 | Root is 0. No spawn past this. |
| `maxConcurrentChildren` | 3 | In-flight children of one planner |
| `maxResawnsPerTask` | 2 | Verifier rejects may respawn this many times |

Workers never see siblings. Relay is JSON handoffs on disk only.

Throttle learn: 429 or error ratio > 30% or a failed build → rate `× 0.5`. Clean burst → rate `× 1.25`.

---

## What this is not

- Not one chat wrapping the whole goal.
- Not 500 cloud agents. One process, a bounded tree.
- Not a promise of 500 PRs / second. That number is the measurement wish. The table above is what Origin actually did.
