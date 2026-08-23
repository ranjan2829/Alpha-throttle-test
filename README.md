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

```mermaid
flowchart TD
  A[1 chunk of tickets] --> B[2 Claude Sonnet 5]
  B --> C[3 JSON split]
  C --> D[4 child planners]
  D --> E{5 depth under 3?}
  E -->|yes| B
  E -->|no| F[6 leaf worker]
  F --> G[7 write unique file]
  G --> H[8 open Origin PR]
  H --> I[9 merge]
  I --> J{10 hit 10000 merges?}
  J -->|no| A
  J -->|yes| K[11 stop]
```
