# NEXT--178-hc-launch-poc — workbench rails (branch lane)

Branch `178-hc-launch-poc`. Delete this file before any merge. The direction and the table of claims are in [docs/workbench-rails.md](./docs/workbench-rails.md); this file holds only who does what, the active stage and the next gap. Checkpoint history is in issue #178 and the lab ledger. The earlier body of this file (Herdr Core start hazards, the v0.1.20 source reading, the test citizens) is at `git show c286382a:NEXT--178-hc-launch-poc.md`.

## Roles (routable garden ids)

- Single branch writer: `20261128T113335-bf156a`. Edits, tests and freezes; does not commit.
- Practical coordinator: `20261126T081804-885314`. Routes reviews, runs PARTIAL and FULL, commits and pushes the branch.
- Ops coordinator: `20261014T212756-68bd94`. Carries GLG's decisions.
- Reviewers, read-only: `20261128T115136-29f14e`, `20261128T121810-b48126`, ASTRA `20261021T184815-46e595`.
- Operating siblings are never test targets and are never retired.

## Active stage

Target 0.70.0; backends Pi, pi-durable and Claude Code only. Checkpoint 12 is `c286382a` (FULL green there, inherited from 885314). Checkpoint 13 is docs only: the direction page and its links. Not main, not a release preparation, and no "release ready" call.

## Next executable gap

1. **Placement rows on the branch tip (no decision needed).** From a tmux shell, run `entwurf peer-facts` for one Claude Code and one pi-durable citizen that are their pane's direct process, then again with `ENTWURF_HC_PLACEMENT_SOCKET` set for one target in a Herdr Core terminal. Test citizens only. This moves the Table 2 cells from an earlier candidate to the tip.
2. **Core status handshake, on a test core only.** One `events.subscribe` while a scratch pi-durable runs idle → working → done, aborts to idle, and exits to clear. Any hc call can start a core: use the isolation in the earlier body of this file, never the operating core.

Waiting for GLG, nothing to start meanwhile:
- G1: one current lister, MCP against CLI for the same rows.
- G2: where the opt-in variable is deployed, and whether `HC_TERMINAL_SOCKET` may be borrowed.
- G3: a bounded `get_info` for the Pi owner pid, and its per-listing cost.
- Whether pi-durable must report `blocked` and a session name as Pi does.
- What "every sibling appears" means for the MCP view.

## Push windows

2026-11-29 00:00, 03:00 and 06:00 KST. A verified checkpoint only, this branch only.

## Do not touch

Operating citizens, the operating core and its App sessions, the operator's profile, Home Manager, SSH config and keys, `entwurf_v2` delivery, #156, #170. No tag, release or main. Tokens and whole environments are never printed: variable names only.
