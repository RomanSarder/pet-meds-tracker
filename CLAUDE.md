# Claude Code Instructions

## Scope

Deliver what was asked, at the scope intended. Make routine judgment calls yourself, and check in
only when different readings of the request would lead to materially different work. If the
request seems mistaken or a better approach exists, say so in a sentence and continue with the
task as asked rather than quietly narrowing, widening, or transforming it. Finish the whole task,
and stop short of actions that are clearly beyond what was asked.

## Playwright / Browser Session Artifacts

Any files produced during Playwright MCP sessions (screenshots, traces, downloads, etc.)
must be saved under `.playwright-mcp/` at the repo root. This directory is gitignored.

Never save Playwright artifacts directly to the repo root or any other tracked directory.

## Reporting and Narration

Before the first tool call, say in one sentence what you are about to do. While working, give a
brief update only on an important find or a change of direction — not one per step.

When answering "what changed?", lead with the behavioral difference in plain prose — what the
system does now that it did not do before, or no longer does.

Do not open with commit hashes, file lists, or diff stats. Include those only when asked for them.

## Verification

Never conclude "clean" from a chained command. `a && b` short-circuits: if `a` fails, `b` never
runs, and a passing tail says nothing about the whole.

Run each check as a separate command and show each exit code. A fix is done only when lint AND
typecheck are both green in the same pass.

## Worktrees

Before any merge, run `git worktree list` and confirm the target branch is not checked out
elsewhere.

If git blocks the requested merge direction, stop and report it. Never substitute the reverse
merge.

## Commits

Commit messages are exactly one line. No body, no bullet list, no `Co-Authored-By` trailer or any
other co-authorship attribution.

Enforced by `.githooks/commit-msg`. In a fresh clone, run `git config core.hooksPath .githooks`
once to activate it.

## Length of Written Documents

For documents written to disk — reports, specs, plans, notes — match the length to what the task
needs: cover the substance, but do not pad with filler sections, redundant summaries, or
boilerplate.

This governs files, not sub-agent returns. Return shape is already constrained by each agent's own
definition in `.claude/agents/`.

## Length of Responses

Keep responses focused, brief, and concise. Keep disclaimers and caveats short, and spend most of
the response on the main answer. When asked to explain something, give a high-level summary unless
an in-depth explanation is specifically requested.
