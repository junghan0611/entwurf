# Codex Pattern A — `/compact` survival (our automated probe)

2026-05-14 KST. Fresh `LIVE=1 ./run.sh smoke-compaction-policy --step=04` run, capturing the evidence cell that 2026-05-13 had marked `(LIVE 04 stderr — needs capture)`.

## Environment

- `pi-shell-acp` HEAD = commit `d84164e` (fix(claude-overlay): preserve organic compact prompt handling)
- backend: `codex-acp` via pi-shell-acp bridge
- model: `pi-shell-acp/gpt-5.4`
- routing: `PI_ENTWURF_ACP_FOR_CODEX=1` (forces ACP path even though gpt-5.4's native entry is openai-codex)
- probe shape: 3-prompt entwurf (plant → /compact → recall)
- isolated cwd: `/tmp/ps-probe-codex-yHJ0OX` (cleaned up by smoke driver after the run)

## Outcome — pass

```
(a) plant ok — taskId=55e95c41 turns=1 reply=READY
(b) /compact ok — reply=Context compacted
    text classifier:  ack (ack pattern: compacted)
    usage classifier: no_evidence (pre=17964, last=11822 — 34% drop, below 50% threshold)
(c) recall ok — reply=token=GLG-COMPACT-mp4plbzl-nk4iwv
    sentinel preserved across /compact: yes

RESULT 04: pass — compact evidence + sentinel recalled
```

Full transcript: `run.log` next to this README.

## Interpretation — Codex A does not have Claude A's `hooks` trap

Reference comparison: on 2026-05-13, Claude A (explicit `/compact`) failed for a different reason — the pi-shell-acp overlay's `settings.json` had no `hooks` key, and Claude SDK's organic compact path responded with a meta-summary instead of the user's next prompt (`2026-05-13-claude-organic-fresh`). The fix was a one-line overlay shape repair (`hooks: {}`), verified in `2026-05-13-claude-hooks-empty`.

Codex A behaves correctly on the same probe shape without any equivalent overlay fix:

- the compact turn itself replies with `Context compacted` (clean ack, no prompt-sacrifice)
- the next user turn answers the question and includes the sentinel exactly as planted
- the bridge's persisted `pi:<sessionId>` mapping survives the compact (entwurf_resume succeeds, same `taskId=55e95c41` across all three turns)

GLG-side cross-check (2026-05-14, agent-shell + pi-shell-acp + codex-acp, free-form dialogue): the model directly reports receiving a summary block after `/compact` and is able to enumerate the items inside it (gogcli calendar call result, list_mcp_resources outcome, prior assistant replies). Both the automated probe and the human-greeted session agree.

## Honest caveats

- wire usage classifier is `no_evidence` here. Codex post-compact `used` dropped from 17964 to 11822 — about 34%, below the dual classifier's 50% drop threshold. text + sentinel recall is the load-bearing pair for Codex; wire alone is weak. This is a backend property (codex-rs `replace_compacted_history` retains a non-trivial slice of context), not a bridge regression.
- this run does NOT exercise organic auto-compact. It is Pattern A only.
  The two Pattern B cells were closed later on 2026-05-14:
  - `../2026-05-14-codex-B-threshold/` — lowered-threshold organic compact
    cheap stand-in.
  - `../2026-05-14-codex-B-saturation/` — real GPT-5.4 native-window
    saturation under the default codex-rs threshold.

## Next steps

- No Codex follow-up remains for the 0.5.0 compaction axis. The release
  blocker moved to Gemini's ACP context-pressure behavior.
