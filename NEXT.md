# NEXT.md — pi-shell-acp

> 다음에 할 일만 남긴다. 로그가 아니다.
> 완료된 릴리즈/조사 기록은 `CHANGELOG.md`, `VERIFY.md`, `BASELINE.md`,
> llmlog, GitHub issue, commit history로 보낸다.

## Reference paths

- **ACP backend source**: `~/repos/3rd/acp/`
  - `agent-client-protocol/`
  - `claude-agent-acp/`
  - `codex-acp/`
  - `gemini-cli/`
  - `agent-shell/`, `acp.el`, `zed/`, `obsidian-agent-client/`, `openclaw-acpx/`
- **repo**: `~/repos/gh/pi-shell-acp/`
- **consumer**: `~/repos/gh/agent-config/`
- **llmlog**: `~/org/llmlog/`

---

## Current Priority — 0.5.0 Release Doc Cleanup

Do **not** run `prepare-release` yet. The release content is functionally closed
enough, but the public-facing docs still need to be short, calibrated, and
non-repetitive.

Closed facts already moved out of NEXT:

- 0.5.0 compaction policy: bridge does not implement compaction; pi-side compact
  is blocked by default; backend-native context management is allowed; legacy
  `PI_SHELL_ACP_ALLOW_COMPACTION` is rejected.
- Three-backend context-pressure conclusion: Claude and Codex have release-grade
  continuation evidence; Gemini ACP is recorded as an honest asymmetry, not a
  fake pass.
- Model lock (#14): commit `88da9a2` landed. After a session is anchored,
  switches touching `pi-shell-acp` are reverted; native-to-native and pre-turn
  selection remain free; bridge-side `ModelSwitchLockedError` is fallback.

### Next Steps

1. **Trim public docs**
   - `README.md`: keep the 0.5.0 story short. No investigation tables.
   - `AGENTS.md`: keep invariants, not release narrative.
   - `CHANGELOG.md`: carry the detailed release record.
   - `VERIFY.md` / `BASELINE.md`: carry evidence tables and probe distinctions.

2. **Check release wording**
   - No Claude/Codex-only wording that silently implies Gemini.
   - No user-facing cross-backend `/compact` promise.
   - No claim that model-lock is transcript-clean.
   - No resurrection of `outcome=respawn` as current behavior.

3. **Verify after doc cleanup**
   - `git diff --check`
   - `pnpm typecheck`
   - `./run.sh check-model-lock`
   - deterministic compaction gate if code or release claims changed:
     `./run.sh smoke-compaction-policy`

4. **Commit doc cleanup**
   - Separate commit after GLG review.
   - After commit, stamp agenda and notify as usual.

5. **Only then consider `prepare-release`**
   - Run it after NEXT/README/AGENTS/CHANGELOG/VERIFY are aligned.

---

## Next Priority — 0.6.0 OpenClaw Native Support

Do not mix this into 0.5.0. The 0.6.0 target is direct OpenClaw backend
support through its native ACP server, not an `acpx` wrapper path.

Current evidence:

- `openclaw-acpx` records the built-in command as `openclaw -> openclaw acp`.
- `acpx` is useful as a reference client / comparison surface, but
  `pi-shell-acp` should launch `openclaw acp` directly if OpenClaw becomes a
  first-class backend.

### First Questions

1. **Backend contract**
   - Does `openclaw acp` implement the ACP server surface pi-shell-acp needs:
     `newSession`, `resumeSession` / `loadSession`, `prompt`, `cancel`,
     model selection, usage updates, and close semantics?
   - What does OpenClaw call its model IDs, and does it expose model switching
     over ACP or only through its own config?

2. **Bridge shape**
   - Add a fourth backend adapter only if it fits the same thin-bridge contract:
     no transcript hydration, no second harness, explicit MCP injection, typed
     ACP calls, observable bootstrap.
   - Decide model naming before code: likely still provider `pi-shell-acp`, with
     OpenClaw as a backend behind a curated `pi-shell-acp/...` model ID.
   - Keep model-lock semantics identical: once anchored, switching into/out of
     OpenClaw-backed `pi-shell-acp` models must not silently hand off context.

3. **Isolation / carrier**
   - Identify OpenClaw's highest identity carrier and config-home override.
   - Define an overlay whitelist before passing operator config through.
   - Verify whether skills/MCP are native ACP surfaces, OpenClaw-native config,
     or both.

4. **Verification**
   - Source probe first: compare `openclaw acp` against Claude/Codex/Gemini
     backend assumptions.
   - Runtime smoke second: one-turn prompt, resume/load continuity, MCP
     visibility/invocation, cancel, model lock, and process cleanup.
   - Only after that, update README/AGENTS/VERIFY claims.

### Non-goals

- Do not route through `acpx` as the production backend launcher unless direct
  `openclaw acp` proves impossible.
- Do not broaden 0.6.0 into a generic “any ACP backend” registry.
- Do not add OpenClaw-specific magic that violates the one-screwdriver bridge
  shape.

---

## Parked, Not Current

- **#11** remote SSH resume cwd alignment.
- **#10** broader ontology RFC (`peer handle`, `contact_peer`, registry). The
  cwd-authority part already landed in 0.4.17.
- **#8** ACP `entwurf_send` message visibility UX, after #10 is revisited.
- **#2** pi-first context meter, post-0.5.0.
- L5 long soak with repeated context-pressure events and sentinel recall,
  likely 0.6.x.
