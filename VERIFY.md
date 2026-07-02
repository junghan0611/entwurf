# VERIFY.md

Agent-driven verification guide for `entwurf` (0.12.0 surface).

> **Current surface.** The live release surface is one bundled MCP server, `entwurf-bridge`, exposing four tools: `entwurf_v2`, `entwurf_peers`, `entwurf_self`, `entwurf_inbox_read`. The shipped ACP backend is **Claude**; Codex is pi-native by default (`ENTWURF_ACP_FOR_CODEX=1` opts a Codex target into ACP), and Gemini is a **non-goal/probe** on 0.12 — historical Gemini rows are kept for context, not as a current expectation. The 0.4.x `session-bridge` adapter, the 0.11.0 fat-bridge (`acp-bridge.ts` / `ensureBridgeSession`), and the v1 `entwurf` / `entwurf_resume` / `entwurf_send` verbs are **retired** — rows mentioning them survive in CHANGELOG/git as historical baseline, never as a runnable recipe.

This is a **working document, not a metrics document**. The deterministic and live gates carry the machine-checkable invariants; this file carries only what a gate cannot judge — the human/agent reading of *whether the bridge is honestly itself*. Where a former manual procedure is now a gate, it is named as a pointer rather than re-spelled as a runnable script.

VERIFY.md is the **agent-driven** surface; [BASELINE.md](./BASELINE.md) is the operator-driven one. One ACP-bridged model runs the checks against another and writes down what it sees — if the bridge is faithful, two replicants looking at the same mirror describe the mirror the same way. This is in-bridge cross-validation, not external evidence: verifier and subject share the same bridge, MCP servers, and overlay, so a uniform corruption of those would not surface here (that gap is what the L3+ rungs close).

## Evidence Levels

Every claim — and every History entry — sits on one of these rungs. Make the rung explicit so neither narrative nor reader overreaches.

> **Namespace note.** These `L0–L5` rungs measure *evidence quality* for bridge verification. Native async delivery has its own capability namespace `D0–D8` in [DELIVERY.md](./DELIVERY.md); operator-driven identity baseline uses `Q-L1..Q-L5` *surface-isolation layers* in [BASELINE.md](./BASELINE.md). Same letters, different axes — do not conflate "high-quality evidence" with "high delivery capability".

| Level | What it is | Closes | Does not close |
|---|---|---|---|
| **L0** | Narrative / self-report | Agent description of the system | Anything depending on actual behaviour |
| **L1** | Transcript cross-check | Two+ bridged identities agree on what they see | Echo-chamber risk (shared prompt/carrier) |
| **L2** | Objective MCP tool call | Real on-disk/on-socket payload through the bridge | Shared-implementation corruption |
| **L3** | On-disk/process/socket corroboration *outside* the bridge | Bridge claim ↔ `ls`/`pgrep`/`lsof`/session JSONL | Time-extended drift (auth, version, cache) |
| **L4** | Human or direct-native side-by-side | A person (or non-bridged direct path) reaches the same answer for matched prompts | Production-shape workload |
| **L5** | Long-haul soak | Bridge stays correct over hours-to-days incl. partial failure | Operational ceiling for now |

When you write a new entry, mark its rung. "L1 only" is honest; "L2 reached" is stronger but does not silently imply L3.

---

## 0A. Execution Policy — Transparent Mode

Verification here is not a benchmark. In production we exchange short turns and stop immediately to isolate a cause before resuming when something looks off. This document records **verification intent (what we look at) and pass criteria (how to judge)**; the execution shape is the agent's choice as long as the criteria are met.

### The canonical floor — two entry points

- **Deterministic floor:** `pnpm check` — the full `check-*` gate set (~60 gates). Run first; it is the cheap, machine-checkable layer.
- **Live floor:** `LIVE=1 ./run.sh release-gate <scratch-project-dir>` — `pnpm check` + the v2-native live gates + the ACP plugin acceptance floor. It reports a **two-tier summary**:
  - **MUST tier** (release-blocking — owns the exit code; "green" applies only here): `pnpm check`, `smoke-entwurf-v2-spawn-resume-live`, `smoke-entwurf-v2-matrix-live`, `check-bridge`, `smoke-session-id-name`, the resident-garden-guard negative/id-safety + `/gnew` zero-token half, and the `smoke-acp-*-live` ACP plugin smokes (socket-citizen / raw-turn / overlay / provider / session-reuse / carrier-augment / memory-containment / rgg / mcp / skill / bundled-mcp).
  - **BEHAVIOR tier** (advisory, non-blocking): the resident-garden-guard positive (a model-in-loop `entwurf_self` turn). A BEHAVIOR FAIL is surfaced with its artifact path but **never blocks the cut**.
  - LIVE-gated MUST steps honest-skip when `LIVE!=1`; a real cut needs `LIVE=1` with `SKIP=0`. A green MUST gate is **necessary, not sufficient** — GLG authorizes the cut.

> The authoritative per-cut counts live in BASELINE.md's HISTORY and CHANGELOG/git, not inline here (they drift against `run.sh`). Most recent recorded floor: **2026-06-27 — MUST 17/0/0 + BEHAVIOR 1/0**.

### Verifying the two capabilities a gate cannot fully judge

- **Garden-id delivery:** discover a target with `entwurf_peers`, then `entwurf_v2` with the correct intent — `fire-and-forget` for a live/replyable or meta-session target, `owned-outcome` only to wake a dormant record-backed pi citizen. Picking the wrong intent is rejected, never auto-fixed.
- **ACP continuity:** a direct `pi --provider entwurf --model claude-sonnet-5` turn, or the `smoke-acp-session-reuse-live` gate (process-scoped reuse + recall). Multi-turn reuse is proven by that gate, not by any v1 resume tool.

### What NOT to do — bypassing the operational path

These bypass the very delegation logic under test; passing them proves nothing about production health.

- ✗ Minting session files directly (`mktemp …jsonl`) and feeding them to `pi --session`.
- ✗ Faking multi-turn by passing the same session file twice.
- ✗ Using pty/tmux `send-keys` keystrokes or transcript scraping as delivery evidence.
- ✗ Mimicking entwurf by recursively calling `pi` via `bash`.

The manual `pi --session` path is used only when (a) the entwurf path itself is broken and an isolated debug bypass is needed, or (b) a boundary check must hit a bridge internal directly.

### Operational principles

- Execute one command at a time (no `;`-chaining). Preserve full stdout/stderr at each step.
- On anything wrong, **stop and hold** — preserve session/cache/process state before proceeding.

### Wording — avoid safety-interpretation contamination

When injecting a fact for a continuity check, use **plaintext that does not trigger model safety interpretation**. Avoid `secret token`, `password`, `API key`, `credential`, and meta-directives like "do not leak" — such wording makes the model treat the prompt as an exfiltration attempt and refuse, which makes **continuity look broken even when it is alive** (this happened once with `test-token-123`, misdiagnosed as a delegation failure). Instead: `The password is owl → reply in one word → owl`; code names / colors / animal names. Do not mix continuity and safety-behavior verification in one prompt.

### bridge continuity vs semantic continuity

- **bridge continuity:** same `sessionKey` / same `acpSessionId` via in-memory reuse or persisted resume/load (bootstrap `path=reuse|resume|load`).
- **semantic continuity:** a fact from a prior turn is retrievable in a later turn.

Either can be alive while the other looks dead (the wording case above is bridge-alive / semantic-looks-dead). When in doubt, change the wording and retry once, and check the `[entwurf:bootstrap]` lines in bridge stderr. No automated smoke separates these yet.

## 0. Quality Criteria

The goal is not merely "invoke Claude Code." We want:

1. **Session continuity at the agent-shell level** — through ACP session resume/load/new, not re-throwing a text blob.
2. **Preservation of pi harness semantics** — pi session files / transcripts / memory pipeline stay a shared axis.
3. **restart-hygienic** — process-scoped reuse continues the same ACP session across turns inside a long-lived resident; persisted records are written/validated for the future resume-load lane, not the live continuity path today.
4. **Thin bridge** — no second harness built inside this repo.
5. **Explicit capability boundary** — pi custom tool / user MCP visibility is determined solely by `entwurfProvider.mcpServers`; no automatic `~/.mcp.json` loading.
6. **Operational hygiene** — no orphan subprocesses, no excess persisted session garbage.

---

## 1. Setup

**One install command to remember: `./run.sh setup <project>`.** It is idempotent — re-run the exact same command whenever anything looks wrong. There is no second install surface to juggle: from a clone `setup` runs the whole floor in order.

1. `pnpm install` — bundles pi (a dev/peer dependency; no separate `pi install` step) and builds the bridge
2. project wiring → `<project>/.pi/settings.json` `entwurfProvider.mcpServers.entwurf-bridge`
3. meta-bridge global plugin — only when a native harness (`claude`) is on PATH; a pi-only host skips it cleanly
4. `entwurf-bridge` install smoke (`validate_entwurf_bridge`)

```bash
git clone https://github.com/junghan0611/entwurf /path/to/entwurf && cd $_
./run.sh setup /path/to/consumer-project
# re-run the SAME command any time to repair a broken install
```

Expected tail: `DONE: entwurf setup (pi package + meta-bridge + v2 install smoke) green.` On a host with `claude`, verify the native wiring with `./run.sh doctor-meta-bridge`.

The wiring / meta-bridge / smoke steps are internal building blocks of `setup` (`install_local_package`, `scripts/meta-bridge-install.sh`, `validate_entwurf_bridge`) — call `setup`, never the parts. Consumers who `npm install @junghanacs/entwurf` get the obvious npm surface; that path is not the developer concern here.

### 1.1 Variables (optional)

```bash
export REPO_DIR=/path/to/entwurf
export PROJECT_DIR=/path/to/consumer-project
cd "$REPO_DIR" && ./run.sh setup "$PROJECT_DIR"
```

### 1.2 Live acceptance (optional)

```bash
LIVE=1 ./run.sh release-gate /path/to/consumer-project
pi --provider entwurf --model claude-sonnet-5 -p "reply with ok only"   # one-turn smoke
```

`setup` runs `pnpm install` + `install` + meta-bridge (native harness) + the v2 install smoke; a green `setup` implies the settings.json wiring and install surface are healthy. The full live floor is still `LIVE=1 ./run.sh release-gate`.

### 1.4 Cross-install / cross-backend parity (optional, high-value)

Compare a fresh self-awareness report across axes: (1) same backend, different install path — answer must be path-invariant; (2) same backend, different machine — identical native tool list + MCP server/tool set; (3) different backend, same bridge — same harness id (`entwurf`) and MCP surface but **different** native tool surface (a Claude session reporting `apply_patch` as native, or normalized cross-backend tools, is a fail); (4) native pi routing vs ACP-bridged, same model — the native target reports **no `entwurf-bridge` MCP** (capability via pi's extension surface) while the ACP target reports it as the single MCP server. Honest "native: I cannot tell" hedging is PASS on the native side. Status: Claude axes 1–4 closed; Gemini is probe-only on 0.12.

---

## 1A. Main Agent Evaluation — Is `entwurf` Claude strong enough?

Separate from continuity gates. Gates prove "sessions continue"; this questionnaire examines tool self-awareness / native tool usability / MCP-boundary awareness / long-turn focus / quality vs direct Claude Code. Run it against `entwurf/claude-sonnet-5` via a direct `pi --provider entwurf` turn (or a live ACP session); accumulate turns by re-prompting the same target.

### 1A.0 Two carrier surfaces — engraving vs pi-context-augment (load-bearing)

`entwurf` delivers identity-relevant text through **two structurally distinct surfaces**. Collapsing them into "the system prompt" is the most common verifier-side mistake. (BASELINE Q-B0/Q-L1 grade the same separation operator-side.)

| Surface | Source | Delivery shape | Default content |
|---|---|---|---|
| **Engraving carrier** | `pi-extensions/lib/acp/prompts/engraving.md` (or `ENTWURF_ACP_ENGRAVING_PATH`) | Claude `_meta.systemPrompt` — full-replacement identity slot | Operator-authored, optional opt-out; tiny non-empty by default on Claude ACP (replaces the `claude_code` preset + strips its auto-memory advertisement). Emptying the file is the opt-out. |
| **pi-context-augment** | `pi-extensions/lib/acp/augment.ts` (`enrichTaskWithProjectContext`) | First-user-message prepend (not the system slot) | Always populated on ACP-routed targets: (1) the bridge identity line, (2) `~/AGENTS.md` body, (3) the cwd repo's `AGENTS.md` in a `<project-context path="…">` block. |

Pass (carrier honesty): the subject distinguishes engraving from pi-context-augment by name or structure without prompting; on ACP targets confirms all three augment components arrived; may quote the engraving but must **not** attribute bridge identity / AGENTS / memory policy to it. Fail: attributes the bridge-identity narrative to the engraving carrier; claims the augment is empty on an ACP run; invents engraving content. Native pi exception: on native targets the bridge-identity line and `~/AGENTS.md` are not part of the augment — the PASS criterion is honesty about what arrived, not the three-component checklist.

### 1A.1 Layers

- **Layer 0 — self-awareness:** ask environment self-awareness / MCP visibility / upstream-instruction awareness, guessing prohibited. Pass: recognizes native tool family, says "I don't know" honestly, answers MCP visibility only as configured, describes upstream instruction type without reproducing internal prompts. Fail: claims a nonexistent tool, conflates pi-custom and native tools, hallucinates MCP visibility, or conflates the two carriers (§1A.0).
- **Layer 1 — native tool use:** throw file-reading / structure-analysis / regression-hunting tasks. Pass: Read/Edit/Bash/Grep/Glob selection is natural; no detour through MCP or recursive `pi`. Fail: strange detours for simple reads; speaks from memory without reading.
- **Layer 2 — MCP boundary:** by default the four v2 MCP tools are not visible (they appear only when `entwurf-bridge` is registered). Pass: says invisible tools are not visible; explains the native-vs-MCP boundary. Fail: pretends to use an unseen tool; mimics entwurf via recursive `pi`.
- **Layer 3 — focus across turns:** inject a fact, then accumulate turns mixing retrieval/exploration. Pass (post-0.4.1): after **8 turns** holds **3+ early facts** incl. **one verbatim string injected before turn 5**; no repeated exploration, no self-contradiction, no tool-strategy drift. Fail: forgets early reads; paraphrases instead of returning the verbatim string. Note: entwurf exposes no user-facing compaction; use the backend's `usage_update` footer as an overflow-risk signal (it follows the ACP backend's `used/size`, not pi's visible-transcript estimate).
- **Layer 4 — vs direct Claude Code:** requires a verifier holding **both** the `entwurf` and a direct path (human-in-loop, or both transport handles). Compare latency / native tool accuracy / detours / boundary confusion / quality around turns 10–15. Repeated tool confusion, long-turn forgetting, or boundary workarounds are a fail.

Interpretation: Layers 0–2 healthy → basic qualifications confirmed. Layer 3 weak → strengthen prompt shape + corroborate with bootstrap logs / process state / sentinel recall. Layer 4 much weaker than direct → revisit bridge handoff. This questionnaire does not replace gates.

---

## 2. Manual judgement checks — what the gates cannot fully judge

The single-turn / multi-turn / cross-process / persistence-boundary / shutdown invariants that earlier editions hand-ran against the retired v1 verbs are now **deterministic or live gates**. Verify them through the gate, and reserve manual time for the human-judgement surfaces below.

| Invariant | Current gate (pointer) |
|---|---|
| Single-turn prompt extraction, SessionStart hook not mistaken for prompt | `smoke-acp-raw-turn-live`, `check-acp-prompt-builder` |
| Multi-turn continuity + recall (process-scoped reuse) | `smoke-acp-session-reuse-live`, `check-acp-session-reuse` |
| Cross-process continuity / cache before-after | `check-acp-session-store` (signature, decideBootstrap, persist/parse) |
| Lifecycle policy — a turn-scoped `cwd:` fallback is never a persisted resume/load path; process-scoped records are hashed-`sessionKey` records | `check-acp-session-store` (`resolveLifecyclePolicy` turn-scoped→always-new, `decideBootstrap`, sha256 `SessionRecord` build/parse/roundtrip) — the former inline `acp-bridge.ts` repro is retired with the fat-bridge |
| Tool-call / event mapping | `check-acp-event-mapper`, `smoke-acp-provider-live` |
| Operator mcpServers / skills reach the live session | `smoke-acp-mcp-live`, `smoke-acp-skill-live`, `check-acp-config` |
| Overlay isolation + memory containment | `check-acp-overlay`, `smoke-acp-memory-containment-live`, `check-acp-tool-surface` |

### 2.1 MCP callable-identifier shape (verified property, gate-external)

The literal callable identifier differs per backend — probe by asking the agent to print it **verbatim** (do not ask "hyphen or underscore" — ambiguous between outer separator and inner server name):

| Backend | Literal identifier | Outer sep | Inner server name |
|---|---|---|---|
| Claude | `mcp__entwurf-bridge__entwurf_v2` | `__` | `entwurf-bridge` (hyphen) |
| Codex | `mcp__entwurf_bridge__.entwurf_v2` | `__` | `entwurf_bridge` (underscore) + **literal dot** |
| Gemini *(probe)* | `mcp_entwurf-bridge_entwurf_v2` | `_` (single) | `entwurf-bridge`, no dot |

A Claude session reporting the underscore form, or any cross-shape leak, is a backend-identification leak. Shipped 0.12 baseline is Claude; the Codex/Gemini rows are reference for the probe lanes.

### 2.2 MCP injection visibility — equal across resume/load/new

The sole MCP responsibility of `entwurf` is to inject `entwurfProvider.mcpServers` equally into `newSession` / `resumeSession` / `loadSession`. Ask "list the visible MCP server names": the registered `entwurf-bridge` appears, unregistered MCPs do not (no automatic `~/.mcp.json` loading); the list is identical every turn; changing `entwurfProvider.mcpServers` changes `bridgeConfigSignature` and forces a new session. `check-acp-config` + `smoke-acp-mcp-live` pin this; the manual check is an honesty corroboration.

### 2.3 Process / cache hygiene — the orphan bound (§gate-external judgement)

Apply per backend under test:

```
AFTER_<BACKEND> ≤ BEFORE_<BACKEND> + (distinct alive
  (sessionKey, backend, modelId, bridgeConfigSignature) tuples this run holds open)
```

An **upper bound**, not an equation: child reuse (one `entwurf` + N resumes share one child → delta 0 is expected) and idle reaping push `AFTER` below it; a config-signature or `(provider, model)` switch pushes it up by 1. `AFTER > BEFORE + alive_tuples` is the actionable signal — an unexpected child appeared. Walk the parent chain (`pgrep -af 'claude-agent-acp|codex-acp'` → `ps -o ppid=`); any ACP child whose parent `pi` has exited is an **orphan** — flag and preserve as evidence.

### 2.4 pi session record as a shared memory axis

The key invariant: **pi session files stay the shared record source even under ACP**. After a reuse pair finishes, locate the child pi session JSONL and confirm turns accumulated:

```bash
ls ~/.pi/agent/sessions/--*--/*_<SESSION_ID>.jsonl   # path pattern, not a naive grep (which also hits the parent)
jq -r '.message.role // .type' "$F" | sort | uniq -c  # role lives at .message.role
```

Pass: user/assistant turns accumulate normally; the transcript is not broken/empty because ACP was used. We preserve "Claude via ACP, memory via the pi axis (JSONL → Denote/andenken)" — the AI does not run its own memory layer.

---

## 3. Pass criteria — the 0.12 release floor

The minimum passing bar:

1. **Deterministic floor green:** `pnpm check` passes (lint + typecheck + the `check-*` gate set + `check-pack`).
2. **Live floor MUST green:** `LIVE=1 ./run.sh release-gate <dir>` reports `MUST PASS=N FAIL=0 SKIP=0`; a BEHAVIOR FAIL is advisory, not blocking.
3. **Honest self-recognition:** the bridged model identifies the harness as `entwurf`, names its backend, lists `entwurf-bridge` as the single MCP server with its four v2 tools, and presents a **backend-native** (not normalized) tool surface.
4. **Carrier separation honored:** engraving vs pi-context-augment kept distinct (§1A.0); no bridge-identity narrative attributed to the engraving carrier.
5. **Boundary preservation across backends/machines:** for every shipped or explicitly probed backend, regardless of install path or host, no cross-backend tool-surface contamination and no confabulation about pi internals.
6. **Hygiene:** no orphan ACP children; no unexpected persisted session garbage (a turn-scoped `cwd:` fallback is never a persisted reuse).

Passing establishes a **release verification floor**, not an 8-hour/day operational guarantee. The floor says: gates hold, the agent honestly recognizes its environment, no tool surface is normalized away, no identity leaks, no orphans. It does **not** say a real-day workload (50–100+ turns, tool bursts, partial MCP failures, auth/version drift) survives — that needs L3–L5 evidence (appendix).

---

## Appendix — troubleshooting & history

### Troubleshooting hooks

- **`ENTWURF_CHILD_STDERR_LOG`** mirrors child stderr to a file for bootstrap-path visibility — but it must be present at **bridge-process spawn time**; `export` from a shell already bound to a running bridge does not propagate. Restart the parent session with it exported, then `grep -E '\[entwurf:(bootstrap|model-switch|cancel|shutdown)\]' "$ENTWURF_CHILD_STDERR_LOG"`.
- **Retired dedicated smokes, live code invariants** (manual/troubleshooting only — *not* part of the release floor):
  - *Model-switch lock* — entwurf sessions are locked to their starting model. Gate: `check-model-lock` (in `pnpm check`). The dedicated live `smoke-model-switch` was retired in v2; the invariant lives in `pi-extensions/model-lock.ts` (extension guard) + `session-store.ts` `SessionModelLockedError` (the `decideBootstrap` fail-loud model lock).
  - *Cancel / abort cleanup* — `onAbort` → `cancelActivePrompt()` (session stays reusable); the stream catch closes the bridge only on `stopReason === "error"`. Dedicated `smoke-cancel` retired; invariant in code.
  - *Transcript-poison invalidation (#12)* — **historical (0.11):** a poisoned backend transcript (empty text block ± `cache_control`) returned the same Anthropic 400 forever, handled by a dedicated classifier + `verify-transcript-poison` smoke. Both were retired in the 0.12 cutover; there is **no dedicated classifier or gate on the current surface** — recorded only so the failure mode is not forgotten.

### Evidence preservation when a problem occurs

```bash
pgrep -af 'claude-agent-acp|codex-acp' || true
find "$CACHE_DIR" -maxdepth 1 -type f | sort
ls ~/.pi/agent/sessions/--*--/*_${SESSION_ID}.jsonl 2>/dev/null
[ -n "$ENTWURF_CHILD_STDERR_LOG" ] && grep -E '\[entwurf:(bootstrap|model-switch|cancel|shutdown)\]' "$ENTWURF_CHILD_STDERR_LOG"
```

Also preserve: the exact calls used, full stdout/stderr, the child pi session file path, cache-directory changes, and the expected-vs-actual difference.

### History (pointer)

The full R2R run history (2026-04-27 → 2026-05-29, pi-shell-acp era), the per-claim evidence ledger (load-bearing claims with level-reached / blind spot / next test, maintained through 0.5.x–0.8.x), and the experimental L3–L5 tracks (4-cell verifier×subject matrix with on-disk corroboration; long-haul soak; direct-native parity panel) live in **CHANGELOG.md and git history**. Evidence reached **L2** (cross-vendor + reverse-direction MCP calls); L3 is partially exercised by the process/session-file checks above; the honest gap is **L3 → L5**. The most recent recorded floor baseline is in [BASELINE.md](./BASELINE.md)'s HISTORY section.
