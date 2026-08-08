# Claude Code Instructions

## Playwright / Browser Session Artifacts

Any files produced during Playwright MCP sessions (screenshots, traces, downloads, etc.)
must be saved under `.playwright-mcp/` at the repo root. This directory is gitignored.

Never save Playwright artifacts directly to the repo root or any other tracked directory.

## Reporting What Changed

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
