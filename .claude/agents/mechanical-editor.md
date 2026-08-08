---
name: mechanical-editor
description: >-
  Applies a fully specified transform where the answer is determined by the
  input: renames across files, import reordering, format conversion, moving a
  file and fixing its references, applying the same known edit at many sites,
  extracting data from a known shape. Only for code with no invariants attached
  — never for auth, money, personal data, migrations, dedup keys, or anything a
  guardrail document covers; those route to builder. Requires an exact
  transform in the brief.
model: haiku
effort: low
tools: [Read, Grep, Glob, Edit, Write]
---
