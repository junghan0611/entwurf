# Codex Pattern B — real native-window saturation

2026-05-14 KST. File-reading + heavy-analytic saturation probe that drove a GPT-5.4 codex-acp session up to its native organic auto-compact threshold and observed the **codex-rs default `auto_compact_token_limit` firing on the bridge wire**. Same probe shape as Claude `019e206a` 2026-05-13 organic-fresh, scaled to Codex's much higher threshold.

## Environment

- `pi-shell-acp` HEAD = commit `d84164e` plus the 0.5.0 maintainer cleanup (smoke step 01 + check-backends assert + backend-specific docs removed)
- backend: `codex-acp` via pi-shell-acp bridge
- model: `pi-shell-acp/gpt-5.4`
- routing: `PI_ENTWURF_ACP_FOR_CODEX=1`
- **no threshold knob lowered** — `CODEX_ACP_COMMAND` not set, so codex-rs ships its default `auto_compact_token_limit` for this model.
- session JSONL: `/tmp/codex-Bsat-2JPOdm/session.jsonl`
- piSessionId: `019e23e1-3684-7583-a4d8-c4823f8c1b19`
- acpSessionId: `019e23e1-3a43-7903-a669-7fd305394e77` (same across all 13 turns)
- launchSource: `PATH:codex-acp` (default, no `CODEX_ACP_COMMAND` override)
- sentinel: `GLG-CODEX-SAT-1778718415-c251bd`

## Outcome — pass

**organic auto-compact fired at turn (l)** under the codex-rs default threshold, surfaced on **all three** classifier channels:

1. **text classifier — ack**: the assistant reply for turn (l) begins with the verbatim string `Context compacted`.
2. **wire classifier — usage_drop**: bridge `meter=acpUsageUpdate` line for turn (l) shows `used` dropping from 244,089 (post-recall (k)) to 84,549. That is a **65% drop**, well above the smoke driver's 50% threshold for `usage_drop`. This is a separate, independent confirmation of compaction; Pattern A and Pattern B-threshold (cheap stand-in) showed text-ack only without crossing the wire threshold — this real saturation shape crosses both.
3. **sentinel preservation — yes**: turn (m), run *after* the compact event, replies with the exact one-line `token=GLG-CODEX-SAT-1778718415-c251bd`. The compact rotation kept the planted token across the boundary.

Bridge mapping is intact across all 13 turns. `bridgeConfigSignature` was stable; every turn after (a) bootstrapped as `path=load` with `persistedAcpSessionId === acpSessionId`. The compact event did not invalidate the pi mapping.

### Turn-by-turn

| Turn | What | wire `used` | Notes |
|---|---|---|---|
| (a) plant | sentinel + READY-this-turn-only | 17,961 | `READY` |
| (b) +4 pi-shell-acp large files | summary x4 | 56,772 | acp-bridge, CHANGELOG, VERIFY, README |
| (c) +4 more pi-shell-acp files | summary x4 | 93,060 | entwurf-control, entwurf, smoke, AGENTS |
| (d) +4 3rd-party ACP files | summary x4 | 161,382 | claude/gemini ACP + schema.mdx + rust-sdk-v1 |
| (e) +4 RFD docs | summary x4 | 187,682 | NES, transport, elicitation, proxy-chains |
| (f) +2 smaller | summary x2 | 201,433 | entwurf-core, prompt-turn |
| (g) +2 more RFDs | summary x2 | 210,042 | message-id, additional-directories |
| (h) +4 protocol docs | summary x4 | 222,036 | tool-calls, config-options, session-setup x2 |
| (i) draft session-setup + reflection (truncated) | summary x4 | 226,492 | model trimmed reflection |
| (j) thread.rs partial-read + deep analytic | 600+w analysis | **244,337** (≈94.5%) | substantive structural read, multiple `Read thread.rs` with line ranges |
| (k) recall | `token=GLG-CODEX-SAT-…` | 244,089 (-248) | sentinel preserved at near-saturation, no compact yet |
| **(l) heavy 700+w cross-backend analytic** | **`Context compacted` + 982-word substantive answer with 8+ line refs** | **84,549** (compact rotation, -65% from 244k) | codex-rs `run_auto_compact(... CompactionPhase::Mid|PreTurn)` fired; assistant produced the requested 700+w analysis in the same turn |
| (m) post-compact recall | `token=GLG-CODEX-SAT-…` | 83,683 | sentinel preserved across compact |

### Bridge log invariants (consistent across all 13 turns)

```
backend=codex
sessionKey=pi:019e23e1-3684-7583-a4d8-c4823f8c1b19
acpSessionId=019e23e1-3a43-7903-a669-7fd305394e77
persistedAcpSessionId=019e23e1-3a43-7903-a669-7fd305394e77
launchSource=PATH:codex-acp
bootstrapPath = new (a)  → load (b..m)
```

## Interpretation

### Codex GPT-5.4's codex-rs default `auto_compact_token_limit` ≈ 245k

The yesterday-sibling investigation (NEXT.md cross-validation, 5/13) recorded that codex-rs reads `model_info.auto_compact_token_limit().unwrap_or(i64::MAX)`. This saturation probe pins the runtime value for GPT-5.4: organic auto-compact did **not** fire as `used` climbed 17k → 244k across 11 turns (a..k), but **did** fire at the start of turn (l) when the model went to take a turn at `used=244,089` and the planned response would have pushed it across some internal threshold. The post-compact `used` of 84,549 reflects codex-rs's `replace_compacted_history` rotation — system prompt + summary + the just-completed turn — confirmed by the 65% wire drop. The exact threshold value is somewhere near 245k for this model under codex-acp's current build; pinning the literal number would need a read of the codex-rs `model_info` registry (external repo).

### Symmetry with Claude — same thesis, different native defaults

| Aspect | Claude (`claude-agent-acp` + Sonnet 4.6, 5/13 `019e206a`) | Codex (`codex-acp` + GPT-5.4, this probe) |
|---|---|---|
| Window | 200k | 258k |
| Default organic auto-compact threshold | ~60% fill (≈120k) | ~94% fill (≈245k) |
| What fires the compact | natural conversation that pushes used past the SDK's internal threshold | natural conversation that pushes used past codex-rs's internal threshold |
| Compact turn shape | wire `compact_boundary` + textual `Compacting…` / `Compacting completed.` + substantive answer (after `hooks: {}` overlay fix) | text `Context compacted` + substantive 982-word analytic answer in the same turn (no overlay fix needed) |
| Wire signal | `used=0` synthetic boundary | sharp `used` drop (244k → 84k = 65%) |
| Sentinel preserved | yes | yes |
| Bridge mapping survives | yes (mapping not invalidated, `bootstrapPath=load` continues) | yes (mapping not invalidated, `bootstrapPath=load` continues) |
| Bridge intervention | none, only the `hooks: {}` overlay-shape fix | none |

The asymmetry is real and is preserved honestly — Claude SDK compacts much earlier (~60% fill), codex-rs compacts much later (~94% fill). Both backends remain inside the 0.5.0 thesis: pi-shell-acp does not implement compaction; the backend does its own thing; the pi session lives. The classifier shape in `compaction-policy-smoke.ts` correctly fires on each backend's native signal (Claude wire-boundary, Codex text + late wire-drop) without forcing a fake symmetry.

### Why this is "B closed" in the strong sense

Earlier framing marked the path as proven (via the cheap stand-in `model_auto_compact_token_limit=12000` in `probes/2026-05-14-codex-B-threshold/`) but the real-saturation cell was open. This probe closes it on the same surfaces Claude was closed on:

- The compact fires in the assistant turn that crosses the threshold, not in a separately-injected `/compact` message.
- The bridge does not synthesize, intercept, or rewrite the compact event — it forwards backend output, then observes the next turn's `used` drop on the wire.
- The persisted `pi:<sessionId>` → `acpSessionId` mapping survives the compact (no `incompatible_config` invalidation), as required by Hard Rule #2 (`resume > load > new` continues to land on `load`).
- The planted sentinel is recalled verbatim post-compact, confirming codex-rs's `replace_compacted_history` preserved the meaningful user-asserted token through the summary rotation.

This is the real-world behavior the 0.5.0 release claim rests on for the Codex axis. Cheap stand-in proved the path is reachable when forced; saturation proves it fires under default operator conditions when context is actually full.

## Files

- `turn-{a..m}.{stdout,stderr}` — full per-turn capture (stdout = assistant reply as printed by `pi --print`, stderr = bridge debug log with `PI_SHELL_ACP_DEBUG=1`).
- `sentinel.txt` — `GLG-CODEX-SAT-1778718415-c251bd`.
- `env.txt` — sandbox session dir + sentinel for reproducibility.
