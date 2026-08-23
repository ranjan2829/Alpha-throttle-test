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

Recursive AI agent. Claude is the planner. Same function calls itself on each slice until `maxDepth`.

```mermaid
flowchart TB
  G[user goal] --> R[Claude planner depth 0]
  R --> W1[worker]
  R --> W2[worker]
  R --> V[verifier]
  R --> S1[subplanner depth 1]
  S1 --> R2[Claude planner depth 1]
  R2 --> W3[worker]
  R2 --> W4[worker]
  R2 --> V2[verifier]
  R2 --> S2[subplanner depth 2]
  S2 --> R3[Claude planner depth 2]
  R3 --> W5[worker]
  R3 --> V3[verifier]
  W1 --> H[handoff.json]
  W2 --> H
  W3 --> H
  W4 --> H
  W5 --> H
  V -->|reject| W1
  V2 -->|reject| W3
  V3 -->|reject| W5
  V -->|accept| D[done]
  V2 -->|accept| D
  V3 -->|accept| D
```

Hard stop: depth 3. Workers never see siblings. Leaves do one scoped task and write a handoff.
