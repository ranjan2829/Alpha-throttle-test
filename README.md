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

Claude only splits. Workers open and merge.

```mermaid
flowchart TB
  T[400 tickets] --> C[Claude Sonnet 5 Anthropic API]
  C -->|JSON split 400 to 100 100 100 100| P1[planner depth 1]
  C --> P2[planner depth 1]
  C --> P3[planner depth 1]
  C --> P4[planner depth 1]
  P1 -->|Claude again 100 to 25 25 25 25| L1[leaf workers]
  P2 --> L2[leaf workers]
  P3 --> L3[leaf workers]
  P4 --> L4[leaf workers]
  L1 --> W[unique file then open PR then merge]
  L2 --> W
  L3 --> W
  L4 --> W
```

```mermaid
flowchart LR
  W[worker] --> F[tickets/run/seq.md] --> P[open PR] --> M[merge] --> Q{merged 10000?}
  Q -->|no| C[Claude splits the next chunk] --> W
  Q -->|yes| S[stop]
```
