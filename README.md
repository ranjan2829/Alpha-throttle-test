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
 user goal ──► ┌ depth 0 ┐ ──► ┌ depth 1 ┐ ──► ┌ depth 2 ┐ ──► ┌ depth 3 leaf ┐
               │  Claude │     │  Claude │     │  Claude │     │  Claude      │
               │    │    │     │    │    │     │    │    │     │    │         │
               │ ┌──┼──┐ │     │ ┌──┼──┐ │     │ ┌──┼──┐ │     │ ┌──┼──┐      │
               │ w  w  V │     │ w  w  V │     │ w  w  V │     │ w  w  V      │
               │       │ │     │       │ │     │       │ │     │              │
               │      sub┼────►│      sub┼────►│      sub┼────►│   stop       │
               └─────────┘     └─────────┘     └─────────┘     └──────────────┘
```

```mermaid
flowchart LR
  G[user goal]

  subgraph D0["depth 0"]
    direction TB
    P0[Claude]
    P0 --> W0[worker]
    P0 --> W0b[worker]
    P0 --> V0[verifier]
  end

  subgraph D1["depth 1"]
    direction TB
    P1[Claude]
    P1 --> W1[worker]
    P1 --> W1b[worker]
    P1 --> V1[verifier]
  end

  subgraph D2["depth 2"]
    direction TB
    P2[Claude]
    P2 --> W2[worker]
    P2 --> W2b[worker]
    P2 --> V2[verifier]
  end

  subgraph D3["depth 3 · leaf"]
    direction TB
    P3[Claude]
    P3 --> W3[worker]
    P3 --> W3b[worker]
    P3 --> V3[verifier]
  end

  G --> P0
  P0 -->|depth + 1| P1
  P1 -->|depth + 1| P2
  P2 -->|depth + 1| P3
```
