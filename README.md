# Alpha-throttle-test

Cursor Origin recursive agent. GitHub `ranjan2829/Alpha-throttle-test`. Origin host: `ranjan-rgb/Alpha-throttle-test`.

---

## Stats

23 Aug 2026 · Origin · CI none · 429s **0**

| | attempted | opened | merged | errors | wall |
| --- | ---: | ---: | ---: | ---: | ---: |
| **Proof** | 8 | 8 | **8** | **0** | 8.1 s |
| **Clean volume** | 1 200 | 1 200 | **1 019** | **0** | 9.6 min |
| **Live** | 5 200 | | **4 920 / 100 000** | | running |

| clean volume | / min |
| --- | ---: |
| open | **124.5** |
| merge | **105.7** |

Proof [#56](https://cursor.com/codebase/allocations/Alpha-throttle-test/pull/56)–[#63](https://cursor.com/codebase/allocations/Alpha-throttle-test/pull/63) · author Ranjan S `<ranjan@allocations.com>` · merge-commit, not squash

---

## How the agent works

```mermaid
flowchart TD
  G[user goal] --> P[root planner]
  P --> W1[worker]
  P --> W2[worker]
  P --> V[verifier]
  P --> S[subplanner]
  S -->|depth + 1| P2[same loop on a slice]
  W1 --> H[handoff.json]
  W2 --> H
  V --> H
  P2 --> H
  V -->|reject| R[respawn worker]
  R --> W1
  V -->|accept| D[done]
```

```mermaid
flowchart LR
  W[leaf worker] --> F["tickets/run/seq.md"]
  F --> PR[Origin PR]
  PR --> M[merge-commit]
  M --> L[learn]
  L -->|merged under target| W
```

| node | loop? | scope | output |
| --- | --- | --- | --- |
| planner | yes | whole goal | `plan.json` |
| subplanner | yes | one slice | handoff to parent |
| worker | no | one task | `handoffs/<name>.json` |
| verifier | no | one target | accept / reject |

| bound | default |
| --- | ---: |
| maxDepth | 3 |
| maxConcurrentChildren | 3 |
| maxResawnsPerTask | 2 |
