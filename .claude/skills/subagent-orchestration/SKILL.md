---
name: subagent-orchestration
description: >
  Orchestration discipline for multi-step agentic work: the main agent stays a
  pure orchestrator, delegates every unit of work — building, testing,
  reviewing, researching, reading large files — to sub-agents so their verbose
  output never pollutes the main context window, and routes each unit to the
  cheapest model tier that can hold the necessary invariants. Use this whenever
  a task has more than one or two steps, follows a build → test → review shape,
  requires running or inspecting a UI, spans many files, or benefits from
  several agents giving independent viewpoints. Trigger it whenever the user
  mentions orchestrator, sub-agents, delegating, "agents for different points",
  model routing, escalating to a bigger model, agents inventing inputs or
  guessing their way through, keeping context clean, or not polluting the main
  context — and also when the user just describes a large multi-part build,
  review, or analysis task without naming orchestration explicitly. Requires an
  environment with sub-agents (e.g. Claude Code); if none exist, say so rather
  than pretending to delegate.
---

# Sub-agent orchestration

## The one rule
**The main agent is an orchestrator. It plans, delegates, gates, and synthesises — nothing else.**

It does not write implementation code, run tests, drive a browser, or read large files into its own context. Every unit of real work above the inline floor goes to a sub-agent, whose verbose output (file contents, build logs, browser traces, search dumps) stays in *that* agent's context and never enters the orchestrator's. The payoff is a main context that stays small enough to reason about the whole task end to end.

## The inline floor
Delegation has a fixed overhead: writing the brief, spinning the agent, parsing the envelope. Below a certain size that overhead exceeds the work, and the delegation is theatre.

Do a unit inline when **all three** hold:
- the material involved is smaller than the brief-plus-envelope would be (reading one short file, checking one line, a one-site edit);
- it touches no invariants and nothing a guardrail covers;
- its answer is needed to plan the very next dispatch anyway.

If any of the three fails, delegate. The floor is an economics rule, not a loophole — "I'll just read it myself" applied to a whole document set is the number-one anti-pattern, not the floor.

## The spawn cap
Never launch more than **6** sub-agents in a single phase. If one sub-agent can complete the unit, use one rather than several. Exceeding the cap means the phase was decomposed wrong — re-plan it, do not raise the cap.

The cap is per phase, and it resets at phase boundaries along with everything else.

## Operating principles
Four, and they are ordered — each one is only meaningful if the one above it was done.

1. **Define completion criteria before execution.** What would make this done, stated as something checkable, written before any agent is dispatched.
2. **Decompose into agent-sized units.** One unit is what a single agent can hold, complete, and report on without needing to negotiate.
3. **Route each unit to a tier by how much of the system it must hold.** Not by how large the diff looks.
4. **Measure with deterministic checks, and stay suspicious of the checks.** A green suite proves the code passes the tests, not that the tests would have caught anything.

## What the orchestrator does
- **Plan** the task as a set of delegable units and their dependencies.
- **Route** each unit to a tier.
- **Delegate** each unit to a sub-agent with a self-contained brief.
- **Gate** transitions between phases.
- **Synthesise** sub-agents' structured returns into the deliverable.
- **Reset at phase boundaries.**

## Verification is a separate phase
Every builder sub-agent must emit its exact verification commands, each with the exit code it expects. A separate verifier sub-agent re-runs every one of those commands as its own invocation — never chained — and reports the exit code it actually observed for each. Any claim the verifier cannot reproduce is marked UNVERIFIED, and UNVERIFIED is not passing.

## Applicability
This pattern needs real sub-agents (e.g. Claude Code). In an environment without them, don't simulate delegation — do the task directly and say the orchestration pattern doesn't apply here. If the environment has sub-agents but no tier selection, keep the routing section as a costing guide and say the routing is advisory.
