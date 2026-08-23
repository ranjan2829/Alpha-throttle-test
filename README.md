# Alpha-throttle-test

Recursive planner → worker → verifier agent for **Cursor Origin**.

GitHub: `ranjan2829/Alpha-throttle-test`  
Origin (live): [`allocations/Alpha-throttle-test`](https://cursor.com/codebase/allocations/Alpha-throttle-test)

Claude splits each burst. The same function calls itself on each slice until `maxDepth`. Leaves open one unique-file PR, then merge-commit. Ticket author: **Ranjan S `<ranjan@allocations.com>`**.

Machine-readable copy: [`reports/live-origin.json`](reports/live-origin.json). Measured **23 Aug 2026**. CI on this repo: **none**. HTTP 429s across every live run below: **0**.

---

## Cleanest results

### 8 / 8 — zero defects

| | |
| --- | ---: |
| Attempted / opened / merged | **8 / 8 / 8** |
| Errors / 429s / build failures | **0 / 0 / 0** |
| Wall | **8.1 s** |
| Avg open | 1 415 ms |
| Avg merge | 3 399 ms |
| PRs | [#56](https://cursor.com/codebase/allocations/Alpha-throttle-test/pull/56)–[#63](https://cursor.com/codebase/allocations/Alpha-throttle-test/pull/63) |

This is the clean proof: every ticket became a merged Origin PR.

### 1,200 attempts — still zero errors

Six 200-ticket episodes, 19:15–19:25 UTC. No empty SHAs. No 429s.

| | |
| --- | ---: |
| Wall | **9.6 min** (578.5 s) |
| Attempted | **1 200** |
| Opened | **1 200** (100%) |
| Merged in-loop | 982 |
| Swept | +37 |
| **Merged** | **1 019** |
| Errors / 429s | **0 / 0** |

| | per minute |
| --- | ---: |
| Attempted / opened | **124.5** |
| Merged (with sweep) | **105.7** |

That is the clean high-volume ceiling on this host: about **125 opens / min**, **106 merges / min**. Not 500/s. Not 500/min.

### Live — Claude planner, still running

Same workspace, now with Claude cutting each 400-ticket burst. Target **100 000** merges. Snapshot after the last finished episode:

| | |
| --- | ---: |
| Merged | **3 779** / 100 000 |
| Attempted | 4 000 |
| Swept | 890 |
| 429s | **0** |
| Planner | Claude Sonnet 5 |

First Claude cut of 400 tickets: **`[100, 100, 100, 100]`** — not the deterministic `[200, 200]`. Depth-1 cuts included `[34, 33, 33]`, `[25, 25, 25, 25]`, and ten 10s. Leaves at `maxDepth` stay deterministic. Cuts are appended to `claude-splits.jsonl`.

---

## How the recursion works

```
Claude planner                         depth 0
        ├── planner                    depth 1
        │     └── worker → unique file → Origin PR → merge
        └── planner                    depth 1
              └── worker
```

Hard stop: `maxDepth`. One process, not 500 cloud agents. Every ticket is `tickets/<run>/<seq>.md` on a frozen `main` SHA, so PRs are siblings. Merges use `--merge`, not squash, so the allocations email survives on the ticket commit.

---

## Run

```bash
npm install
npm test

# dry-run — no PRs
npx tsx src/cli.ts agent --max 16 --concurrency 8

# live — Claude plans; keep going until 100k merges
npx tsx src/cli.ts agent --live --until-merged 100000 --chunk 400 --concurrency 32 \
  --forge origin --repo allocations/Alpha-throttle-test
```

Copy `.env.example` to `.env`. Never commit the key. Live agent requires `ANTHROPIC_API_KEY` unless you pass `--fast`.

`--live` without `--max` / `--per-minute` / `--until-merged` caps at 3 PRs.

| Bound | Default | Meaning |
| --- | ---: | --- |
| `maxDepth` | 3 | Root is 0. No spawn past this. |
| `maxConcurrentChildren` | 3 | In-flight children of one planner |
| `maxResawnsPerTask` | 2 | Verifier rejects may respawn this many times |

A rerun of the same `--workspace` resumes from `progress.json`.
