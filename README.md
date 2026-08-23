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

```
user goal
   │
   ▼
Claude planner              writes plan.json
   │
   ├── worker               one scoped task, one handoff
   ├── worker
   ├── verifier             accept | reject  →  reject respawns the worker
   └── subplanner ↻         same loop on a slice, depth + 1
```

```mermaid
flowchart TB
  G[user goal] --> P[Claude planner]
  P --> W1[worker]
  P --> W2[worker]
  P --> V[verifier]
  P --> S[subplanner]
  S -->|same loop depth + 1| P
  V -->|reject| W1
  V -->|accept| D[done]
```

Same function, smaller slice, higher depth. Cap is `maxDepth = 3`. Workers do not see siblings.
