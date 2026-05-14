# Codex Pattern B — threshold-induced organic auto-compact

2026-05-14 KST. Lowered-threshold probe to verify that codex-rs native pre-turn / mid-turn auto-compact survives the pi-shell-acp bridge without an explicit `/compact` user command.

## Environment

- `pi-shell-acp` HEAD = commit `d84164e` (fix(claude-overlay): preserve organic compact prompt handling)
- backend: `codex-acp` via pi-shell-acp bridge
- model: `pi-shell-acp/gpt-5.4`
- threshold knob: `CODEX_ACP_COMMAND="codex-acp -c model_auto_compact_token_limit=12000"` (default is unpinned at 0.5.0)
- routing: `PI_ENTWURF_ACP_FOR_CODEX=1`
- session JSONL: `/tmp/codex-B-qcHRoB/session.jsonl` (probe sandbox)
- piSessionId: `019e23c5-984c-770b-a65a-159c88b0cf92`
- acpSessionId: `019e23c5-9b4b-7563-94c0-64fb1cc6edac` (same across all three turns)

## Outcome — pass

| Turn | Prompt | Reply | Wire `used` | Bootstrap | Notes |
|---|---|---|---|---|---|
| (a) plant | "Store this token: GLG-COMPACT-B-…. Reply READY for this turn only." | `READY` | 17959 (already > 12000 threshold) | `new` | launchSource=`env:CODEX_ACP_COMMAND` confirmed |
| (b) trigger | "What is the capital of France? …" | `Context compacted` / `The capital of France is Paris.` | 18509 (recomputed post-compact + new turn) | `load`, same `acpSessionId`, `persistedAcpSessionId` reused | **organic pre-turn auto-compact fired**, then substantive answer in the SAME turn |
| (c) recall | "Reply with token=<value> …" | `Context compacted` / `token=GLG-COMPACT-B-1778716612-0ebb00` | (capture) | `load`, same `acpSessionId` | **second compact fired**, sentinel still preserved across both compacts |

Sentinel preserved across two consecutive threshold-induced compacts. taskId concept does not apply (this run used direct `pi --session` invocation, not entwurf spawn/resume), but session continuity is proven by `persistedAcpSessionId === acpSessionId` matching across all three turns at the bridge layer.

## Interpretation — Codex B is closed

This is the cell that 2026-05-13 marked as `Codex organic context-full — ✗ unverified`. With `model_auto_compact_token_limit=12000` (default 0.5.0 unpinned, here cheap-induced via `CODEX_ACP_COMMAND`):

1. **codex-rs native auto-compact path is reachable through the ACP bridge.** No bridge-side intervention, no synthesized `/compact` from the operator; the backend itself detected `used >= threshold` at turn start and ran `run_auto_compact(... CompactionPhase::PreTurn)`. Surface evidence: literal `Context compacted` text appearing at the start of the assistant reply, twice.

2. **`replace_compacted_history` preserves the planted sentinel.** Across two compact events (b and c), the sentinel string `GLG-COMPACT-B-1778716612-0ebb00` was recalled exactly — meaning codex-acp's compact summary retained the meaningful token from turn (a). Pattern A's "Codex doesn't have Claude's hooks trap" extends to Pattern B.

3. **Bridge persistence survives organic compact.** Every turn bootstraps as `path=load` with `persistedAcpSessionId === acpSessionId === 019e23c5-9b4b-7563-94c0-64fb1cc6edac`. The pi-shell-acp `pi:<sessionId>` mapping is never invalidated by the backend-native compact.

4. **The compact turn itself is productive.** Unlike Claude A's `hooks-absent` failure baseline (where the compact turn ended in a meta-summary and the original prompt was sacrificed), Codex emits `Context compacted` AND answers the user's question in the same turn. This is consistent with both (i) the 5/14 explicit-`/compact` probe (Pattern A) and (ii) the 5/14 agent-shell free-form dialogue GLG ran in parallel.

## Honest caveats

- **Wire `used` is not load-bearing for Codex compact detection.** Pattern B confirms what Pattern A already showed: codex-acp does NOT emit a wire-level `compact_boundary` (`used=0`) on compact. Instead, `used` is recomputed by codex-rs `client_session.reset_websocket_session()` after `replace_compacted_history`, so the post-compact `used` reflects (summary + new turn) — often as large as pre-compact `used`. The dual classifier's text path (`Context compacted` literal) is the reliable signal on Codex.
- **`CODEX_ACP_COMMAND` is the right injection surface.** Setting it at the parent shell propagated cleanly to the bridge child (`launchSource: env:CODEX_ACP_COMMAND` recorded in the bridge session log). This proves the bridge does not need a new knob — operators wanting to tune codex-rs native behaviors set codex-rs's own `-c` flags directly, exactly per the 0.5.0 declaration.
- **This was a cheap probe, not a native-window saturation test.** At the
  time it proved only that the codex-rs auto-compact code path was
  reachable end-to-end through the bridge. The real saturation cell was
  closed later the same day in `../2026-05-14-codex-B-saturation/`, where
  GPT-5.4 reached ~244k used tokens under the default codex-rs threshold,
  auto-compact fired, `used` dropped to ~84k, the compacting turn answered
  substantively, and the sentinel survived.

## Bridge log key lines (from turn-c.stderr; turn-a/b similar)

```
[pi-shell-acp:bootstrap] path=load backend=codex
  sessionKey=pi:019e23c5-984c-770b-a65a-159c88b0cf92
  acpSessionId=019e23c5-9b4b-7563-94c0-64fb1cc6edac
  persistedAcpSessionId=019e23c5-9b4b-7563-94c0-64fb1cc6edac
[pi-shell-acp] session {"backend":"codex","launchSource":"env:CODEX_ACP_COMMAND",
  "modelId":"gpt-5.4","capabilities":{"resumeSession":false,"loadSession":true,"closeSession":true}}
[pi-shell-acp:usage] meter=acpUsageUpdate source=backend backend=codex used=18509 size=258400
```

## Files

- `turn-{a,b,c}.stdout` — assistant replies as printed by `pi --print`
- `turn-{a,b,c}.stderr` — bridge debug log (`PI_SHELL_ACP_DEBUG=1`)
- `sentinel.txt` — exact sentinel string used in this run
- `env.txt` — sandbox session dir path
