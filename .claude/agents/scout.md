---
name: scout
description: >-
  Cheap read-only reconnaissance. Use when the orchestrator must decide how to
  route a unit of work but cannot judge the surface without looking — "how big
  is this, what does it touch, what invariants live here". Returns a short shape
  description, never a plan and never a diff. Also use to locate where something
  lives before dispatching the agent that will change it.
model: haiku
effort: low
disallowedTools: [Edit, Write, NotebookEdit]
---
