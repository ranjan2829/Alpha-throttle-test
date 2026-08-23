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
  subgraph plan [1 Claude plans]
    A[Take a chunk of tickets] --> B[Claude Sonnet 5]
    B --> C[JSON split]
    C --> D{depth under 3?}
    D -->|yes| B
    D -->|no| E[Leaf]
  end

  subgraph work [2 Worker runs]
    E --> F[Write unique file]
    F --> G[Open Origin PR]
    G --> H[Merge commit]
    H --> I[Verifier accept or reject]
    I -->|reject| F
  end

  subgraph loop [3 Repeat]
    I -->|accept| J{Hit 10000 merges?}
    J -->|no| A
    J -->|yes| K[Stop]
  end
```
