---
name: behaviour-tester
description: >-
  Verifies a change by exercising the running artifact — starting the app,
  driving the real UI flow with browser automation, calling the endpoint, or
  running the suite — and reports pass/fail per acceptance step. Use after a
  build, before review. Never use it to verify by reading source; that is what
  it exists to replace. Uses the project's Playwright MCP server (declared in
  `.mcp.json`, gitignored — see `.mcp.json.example` and docs/TESTBED.md §4);
  browser tools come from that server, not from this file.
model: sonnet
effort: medium
tools: [Read, Bash, Grep, Glob, "mcp__playwright__*"]
---
