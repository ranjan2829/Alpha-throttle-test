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

## How Claude works

Claude only splits the burst. Workers open and merge the PRs.

```mermaid
flowchart TD
  tickets[400 tickets] --> claude[Claude Sonnet 5]
  claude -->|split 100 100 100 100| p1[planner]
  claude --> p2[planner]
  claude --> p3[planner]
  claude --> p4[planner]
  p1 -->|split 25 25 25 25| leaf[leaf workers]
  p2 --> leaf
  p3 --> leaf
  p4 --> leaf
  leaf --> work[unique file then open PR then merge]
```

```mermaid
flowchart TD
  worker[worker] --> file[unique file]
  file --> pr[open PR]
  pr --> merge[merge]
  merge --> done{hit 10000 merges?}
  done -->|no| claude[Claude splits next chunk]
  claude --> worker
  done -->|yes| stop[stop]
```
