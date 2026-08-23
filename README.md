# Alpha-throttle-test

Recursive agent on Cursor Origin. Repo: `ranjan2829/Alpha-throttle-test`.

---

## Stats

Live Origin run · 23 Aug 2026 · target **10 000** merged · still going

| tried | opened | merged | errors | 429s | time | merged / min |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 6 800 | 6 542 | **6 457** | 258 | **0** | 45 min | **143** |

Latest merged PR: [#6964](https://cursor.com/codebase/allocations/Alpha-throttle-test/pull/6964)

Author: Ranjan S `<ranjan@allocations.com>`

---

## How the agent works

```mermaid
flowchart TD
  G[goal] --> P[Claude planner]
  P -->|split| P2[planner]
  P -->|split| P3[planner]
  P2 --> W1[worker]
  P3 --> W2[worker]
  W1 --> V[verifier]
  W2 --> V
  V -->|accept| D[merged]
  V -->|reject| W1
```

```mermaid
flowchart LR
  W[worker] --> F[one unique file]
  F --> PR[open Origin PR]
  PR --> M[merge]
  M --> L{merged 10000?}
  L -->|no| W
  L -->|yes| S[stop]
```
