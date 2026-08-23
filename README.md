# Alpha-throttle-test

Recursive agent on Cursor Origin. Repo: `ranjan2829/Alpha-throttle-test`.

---

## Stats

Live Origin run · 23 Aug 2026 · **stopped** · target was 10 000

| tried | PRs opened | merged | errors | 429s | time |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 10 000 | 10 000 | **10 000** | 472 | **0** | 68 min |

| speed | per second | per minute |
| --- | ---: | ---: |
| PRs opened | **2.35** | **141** |
| merged | **2.38** | **143** |

Latest merged PR: [#11517](https://cursor.com/codebase/allocations/Alpha-throttle-test/pull/11517)

Author: Ranjan S `<ranjan@allocations.com>`

---

## Flow

Same function, smaller slice, `depth + 1`. Stops at `maxDepth = 3`. Workers do not see siblings. Reject respawns that worker only.

```
user goal
 │
 ▼
depth 0 · Claude planner
 ├── worker
 ├── worker
 ├── verifier
 └── subplanner ──────────────┐
                              ▼
                     depth 1 · Claude planner
                      ├── worker
                      ├── worker
                      ├── verifier
                      └── subplanner ────────┐
                                             ▼
                                    depth 2 · Claude planner
                                     ├── worker
                                     ├── worker
                                     ├── verifier
                                     └── subplanner ────┐
                                                        ▼
                                               depth 3 · Claude planner
                                                ├── worker
                                                ├── worker
                                                └── verifier
                                                    (leaf · no more children)
```

```mermaid
flowchart TB
  G[user goal]

  subgraph D0["depth 0"]
    P0["Claude planner"]
    W0a[worker]
    W0b[worker]
    V0[verifier]
    S0[subplanner]
    P0 --> W0a
    P0 --> W0b
    P0 --> V0
    P0 --> S0
  end

  subgraph D1["depth 1"]
    P1["Claude planner"]
    W1a[worker]
    W1b[worker]
    V1[verifier]
    S1[subplanner]
    P1 --> W1a
    P1 --> W1b
    P1 --> V1
    P1 --> S1
  end

  subgraph D2["depth 2"]
    P2["Claude planner"]
    W2a[worker]
    W2b[worker]
    V2[verifier]
    S2[subplanner]
    P2 --> W2a
    P2 --> W2b
    P2 --> V2
    P2 --> S2
  end

  subgraph D3["depth 3 · leaf"]
    P3["Claude planner"]
    W3a[worker]
    W3b[worker]
    V3[verifier]
    P3 --> W3a
    P3 --> W3b
    P3 --> V3
  end

  G --> P0
  S0 -->|"depth + 1"| P1
  S1 -->|"depth + 1"| P2
  S2 -->|"depth + 1"| P3
  V0 -->|reject · respawn| W0a
  V1 -->|reject · respawn| W1a
  V2 -->|reject · respawn| W2a
  V3 -->|reject · respawn| W3a
```
