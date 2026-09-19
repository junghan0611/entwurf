# Entwurf FAQ

Short answers for people meeting Entwurf from a different agent-harness tradition.

## Is Entwurf an agent factory or a subagent framework?

No. Entwurf is closer to a workshop than a factory: it connects independently owned, visible sibling sessions without turning them into workers of a new central runtime. A harness may run its own subagents or teams, but that remains the harness's responsibility.

## What does Entwurf do?

It gives an existing session a stable **garden id** and routes a message, reply, or visible sibling launch through the rail that session actually supports. It does not reconstruct prompts, hydrate transcripts, manage credentials, or emulate another harness.

## What is a garden id?

A garden id is the stable address of one visible, record-backed session. Think of it as an invitation to a shared workshop table, not a worker name, a pane id, a transcript id, or a worktree lease.

## How are session state and project state separated?

Entwurf does not merge or isolate either one. Each harness keeps its own authentication, tools, transcript, and workspace policy. Git branches, worktrees, file locks, task allocation, and any coordination around a shared checkout belong to the operator and the harnesses involved; a garden id is never a file-isolation claim.

## What happens to a harness's internal subagents?

The visible top-level session is the garden principal. Internal children remain inside that harness and do not receive a second garden id, separate delivery authority, or an Entwurf-managed access-control layer.

## Does sending a message start a process?

No. [`entwurf_v2`](./README.md#entwurf_v2--canonical-dispatch-verb) only addresses an existing garden citizen and selects its supported delivery rail. `entwurf_fresh_call` opens a new visible sibling; `entwurf_resume_call` reopens a dormant pi citizen under the same id.

## Where do visible siblings open?

Inside Herdr, Entwurf opens a new unfocused tab in the caller's workspace and currently admits pi and Claude Code. Outside Herdr, it opens one of the fixed pi, Claude Code, Copilot, OMP, or Codex runtimes in a visible tmux window. The runtime keeps its own model, tools, authentication, and transcript.

## Does Entwurf replace Herdr or tmux?

No. Herdr and tmux provide visible seats. Entwurf provides identity, delivery, and receipts across independent harness sessions. A pane or tmux session is a location for a sibling, never its address or liveness proof.

## How do I install it?

Use the [direct installation route](./README.md#install) for the broader harness surface. In an existing Herdr workbench, use the [Herdr integration guide](./plugins/herdr/README.md); it activates only Herdr-integrated pi and Claude Code and leaves the rest to the direct route.

## How do I start pi as a citizen?

After the direct install, run `entwurf pi`; it starts pi with Entwurf's control surface. The Herdr integration does not put `entwurf` on `PATH`, so its documented command remains `pi --entwurf-control`.

## Where is the precise contract?

[AGENTS.md](./AGENTS.md) owns the project invariants. [DELIVERY.md](./DELIVERY.md), [VERIFY.md](./VERIFY.md), and [docs/adding-a-harness.md](./docs/adding-a-harness.md) own capability, evidence, and admission details.
