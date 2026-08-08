---
name: builder
description: >-
  Implements a feature or refactor against a written spec on a bounded surface,
  and writes the tests for it — the single write-capable agent for judged work,
  including changes crossing invariants and anything a guardrail document
  covers. Use when the frame is already decided: the design exists, the
  acceptance criteria are stated, and what remains is building it correctly.
  Not for deciding an approach, and not for a surface nobody has scoped yet.
  Use mechanical-editor instead only when the transform is fully determined by
  the input and touches no invariants. Requires a spec with a completion
  criterion — a builder given a goal without one will return when it runs out
  of obvious work, which is not the same thing.
model: sonnet
effort: high
---
