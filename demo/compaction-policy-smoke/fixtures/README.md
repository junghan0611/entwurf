# fixtures — preserved pi sessions for compaction-policy verification

Real pi session JSONLs captured **right before** a backend auto-compact
would have fired. Preserved out of the volatile `~/.pi/agent/sessions/`
store so they survive session pruning and can be replayed against
compaction-policy code as it evolves.

These are **operator captures**, not synthetic. Treat them as evidence.

## Index

| File | Source session | Backend | Context | Captured | Note |
|---|---|---|---|---|---|
| `pre-backend-compact--019e19e0--org-sonnet-97pct.jsonl` | `019e19e0-349e-711b-b6b1-67d6f4bb6d00` | `claude-sonnet-4-6` (high) | **97.4 % / 200k** | 2026-05-12 10:49–12:14 KST | cwd `~/sync/org`, real morning sweep (denotecli bug, KK rename, fleeting purge, NEXT lean). Closed without a backend `/compact` actually firing — the next pi-shell-acp work session was the one that surfaced the 0.5.0 compaction-policy split (`15abd44`). |

## Why preserve

- A live pre-compact session is the exact input shape that 0.5.0's
  policy claim talks about ("ACP backends compact natively; the pi
  session survives that"). Synthetic fixtures cannot reproduce the
  density and tool-trace pattern of a real near-saturation session.
- Sessions in `~/.pi/agent/sessions/` may be pruned, mutated by resume,
  or shadowed by other captures. A copy out of that path is the
  preservation contract.
- Filenames here are stable; the source `cwd-encoded/<uuid>.jsonl`
  layout is a pi-internal convention and may move.

## Provenance rule

- **Do not edit** these files. They are captures.
- **Do not resume from these paths.** If a replay is needed, copy the
  file back into a session dir first; resuming directly from
  `fixtures/` would also write into `fixtures/` and break the capture
  contract.
- Adding a new fixture: copy from `~/.pi/agent/sessions/.../<uuid>.jsonl`,
  rename to `pre-backend-compact--<uuid-prefix>--<cwd>-<backend>-<pct>.jsonl`,
  and add a row to the index above.

## Sensitivity

These are real operator transcripts. Conversation content includes
notes/files/commands from the live garden. They are personal but not
secret. Decision on **committing** them to the public repo lives with
GLG — by default the directory is placed untracked.

## Reproducing the Claude organic-compact probe (2026-05-13 15:48 KST)

The `pre-backend-compact--019e19e0--org-sonnet-97pct.jsonl` fixture was
used to close the Claude `Axis 1 last column` + `Axis 3` cells of
`NEXT.md`'s three-backend continuity table. Minimal recipe:

```bash
# 1. Copy fixture into the active pi session dir (NEVER resume directly
#    from fixtures/ — see provenance rule above).
ACTIVE=~/.pi/agent/sessions/--home-junghan-sync-org--/2026-05-12T01-49-44-478Z_019e19e0-349e-711b-b6b1-67d6f4bb6d00.jsonl
cp pre-backend-compact--019e19e0--org-sonnet-97pct.jsonl "$ACTIVE"

# 2. Resume with the GLG operator alias shape. The --emacs-agent-socket
#    flag is part of bridgeConfigSignature; omitting it triggers
#    `incompatible_config` and a fresh `new` session (97 % context lost).
cd ~/sync/org && \
  PI_SHELL_ACP_DEBUG=1 pi \
    --model pi-shell-acp/claude-sonnet-4-6 \
    --entwurf-control \
    --emacs-agent-socket server \
    --session "$ACTIVE" \
    -p "READY?" \
    > probe.stdout 2> probe.stderr

# 3. Verify three signals.
#    Wire: 97 % → ~7 % `used` drop (bridge stderr).
grep '\[pi-shell-acp:usage\]' probe.stderr
#    Bootstrap: path=resume (NOT new), persistedAcpSessionId === acpSessionId.
grep '\[pi-shell-acp:bootstrap' probe.stderr
#    Text: leading "Compacting...\n\nCompacting completed." in pi stdout.
head -c 100 probe.stdout

# 4. Restore active to fixture SSOT once you are done. The probe appends
#    a turn to the active jsonl; the fixture stays clean.
cp pre-backend-compact--019e19e0--org-sonnet-97pct.jsonl "$ACTIVE"
```

Reproducibility note: the persisted mapping must already point at the
original `acpSessionId` (the fixture was captured against
`a01cb05f-786a-4f9d-89c8-139a95506440`). If the mapping has been
invalidated by an `incompatible_config` event since the capture, the
recipe above will land on a fresh `new` session and the probe records
nothing useful — restore the mapping JSON next to the fixture restore.
