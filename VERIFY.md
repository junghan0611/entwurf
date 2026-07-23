# VERIFY.md

Agent-driven verification guide for the current `entwurf` 0.12.x surface.

> **Current surface.** The bundled MCP server, `entwurf-bridge`, exposes five tools: `entwurf_v2`, `entwurf_peers`, `entwurf_self`, `entwurf_inbox_read`, and `entwurf_register_native` (an explicit/manual fallback for binding an already-running native conversation). The shipped ACP backend is **Claude**. Antigravity (`agy`) is a separate shipped **native-push citizen** lane, not an ACP backend: automatic `PreInvocation` birth + sender identity + live probe/direct injection. Codex is pi-native by default and has native delivery probe evidence; Gemini is a non-goal/historical ACP probe on 0.12. The 0.4.x `session-bridge` adapter, the 0.11.0 fat-bridge (`acp-bridge.ts` / `ensureBridgeSession`), and the v1 `entwurf` / `entwurf_resume` / `entwurf_send` verbs are **retired** — rows mentioning them survive in CHANGELOG/git as historical baseline, never as a runnable recipe.

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
  - **MUST tier** (release-blocking — owns the exit code; "green" applies only here): `pnpm check`, `smoke-entwurf-v2-spawn-resume-live`, `smoke-entwurf-v2-matrix-live`, `check-bridge`, the resident-garden-guard zero-token half (record birth / record-keyed socket / attach-on-reopen), and the `smoke-acp-*-live` ACP plugin smokes (socket-citizen / raw-turn / overlay / provider / session-reuse / carrier-augment / memory-containment / rgg / mcp / skill / bundled-mcp). (`smoke-session-id-name` is gone — #50 C3: its `--session-id`/`--name` substrate has no entwurf consumer anymore.)
  - **BEHAVIOR tier** (advisory, non-blocking): the resident-garden-guard positive (a model-in-loop `entwurf_self` turn). A BEHAVIOR FAIL is surfaced with its artifact path but **never blocks the cut**.
  - LIVE-gated MUST steps honest-skip when `LIVE!=1`; a real cut needs `LIVE=1` with `SKIP=0`. A green MUST gate is **necessary, not sufficient** — GLG authorizes the cut.
  - **When cost-bearing MUST gates run (fixed 2026-07-23, the F6/F7 lesson):** a commit that touches a rail a MUST-tier live gate covers runs that gate **before cross-review is requested** — never parked behind "run it at approval time". Deferring a wired gate to a human decision is what let F6/F7 ship reviewed-and-approved; the wiring exists so the verdict never depends on who pressed enter. "배선이 없어 못 한 것은 OK, 배선이 있는데 안 돌린 것은 우리가 남긴 구멍이다." Model-in-loop cost is spent via the subscription-backed `entwurf` provider where the gate allows it, a free-tier native model otherwise; cost is a reason to pick the cheap target, not to skip the gate.

> The aggregate release gate does not own a live agy conversation id, so agy's real native-push round trip is a separate acceptance axis: three fail-loud doctors plus `LIVE=1 AGY_CONVERSATION_ID=<id> ./run.sh smoke-agy-native-push-live`, followed by a fresh-conversation sender/reply check after package install. Its deterministic install/sender gates are already inside `pnpm check`; do not misreport the aggregate gate as live agy evidence.
>
> The authoritative per-cut counts live in BASELINE.md's HISTORY and CHANGELOG/git, not inline here (they drift against `run.sh`). Most recent recorded aggregate floor: **2026-07-24 — MUST 16/0/0 + BEHAVIOR 1/0** (record-era first aggregate; the step count moved 17→16 with the v2-cutover smoke retirements).

### Artifact / host certification matrix — #51 repair cut

Do not collapse package evidence, fixture evidence, and a certified native host into
one word such as “green.” They answer different questions.

| Axis | Current evidence | Level / limit | Release reading |
|---|---|---|---|
| Source checkout | `pnpm check` on Node 24 Linux | Deterministic source floor; not an installed artifact | Necessary; cannot certify a consumer install. |
| Project-local tarball | `check-pack-install` | Real `.tgz`, but checkout-visible, operator-owned, project-local | Installed-shape evidence; still maintainer-shaped. |
| Linux artifact consumer | `check-install-container` in the required `artifact-consumer` CI job | **L3 package evidence:** one read-only candidate `.tgz`; checkout/repo `node_modules` invisible; non-root `npm install -g`; PATH shims; frozen package root; regular-file path+sha256 fence; canonical artifact path+sha256 and Node 24 image identity printed. Default CI packs once; `ENTWURF_CANDIDATE_TGZ` consumes a preserved caller artifact without re-pack. | Certifies the Linux package-consumer shape. Its fake Claude, planted plugin cache, stand-in owner, and `/proc` bridge are explicitly **fixtures**: they do not prove Claude installed the cache or that a real native Claude session woke. |
| Direct Claude negative (B) | Claude Code 2.1.138 actual session | **L4 direct-native**, one NixOS host: fixture loaded (shell canary), `args` dropped, hook reported `exit_code: 0, outcome: success` | Justifies entwurf-side fail-loud and no old-version fallback. It did not run the final production argv shape. |
| Direct Claude positive (B2) | Claude Code 2.1.217 actual session | **L4 direct-native**, one NixOS host: per-element args, literal `${HOME}`, direct parent join, FileChanged exit 2 → idle wake | Justifies the proven floor and exec-form contract. It is not a second-OS acceptance run. |
| Linux installed host | `doctor-meta-bridge` after package install, a **new** Claude session, and a live MCP child | **L3 host corroboration:** installed artifact + live `/proc` owner join | Exit 0 is certification. Missing live evidence is `NOT CERTIFIED` and nonzero; static/synthetic success never substitutes. Maintainer and secondary Linux-host acceptance remains post-release work. |
| macOS Claude meta-bridge | New install is refused: strict live-owner certification cannot yet discover the MCP process without `/proc` | **Not yet verified/certified for this repair cut**; doctor nonzero | Linux is the only current certified axis. Darwin uninstall remains the honest inverse for older installs; the neutral package has no `os` restriction. This is not a permanent impossibility claim—future native validation may reopen macOS. |
| WSL2 / Windows | No release lane | Unverified | Not supported by this repair cut. |

The artifact-consumer run prints both the tarball sha256 and container image
identity. Preserve those in the cut record. A synthetic doctor PASS proves the
oracle can recognize a fully supplied fixture; only the installed doctor against a
new native session proves that a real host supplied those layers.

### Repair-cut order (current execution; authority is mode-specific)

The repo-local `entwurf-release` skill is a checkpointed state machine. Each mode
is a separate authorization; one mode never implies the next.

`0.12.8-repair.0` completed this whole state machine and was published under the
`repair` dist-tag on 2026-07-22, but field evidence then proved its installed MCP
bundle could not deliver: the dist omitted `entwurf-capabilities.json`, so every
`entwurf_v2` send died ENOENT while tools/list and the old shape-only doctor stayed
green. npm versions are immutable; the repaired cut is therefore
`0.12.8-repair.1`. A pre-version CI pack still carries the old package version as
a disposable gate artifact; it must never be preserved as the release candidate
or published.

1. Finish and review the delivery-bundle repair, all four consumer cells, the
   cross-harness sender-identity isolation, and the release-contract documentation.
2. `land 0.12.8-repair.1` pushes only that clean **pre-version landing HEAD** and
   requires a push-triggered `ci.yml` run whose `headSha` is exactly that commit.
   All three jobs must be green: `check`, `install-surface`, and
   `artifact-consumer`. This first run is an isolation/provenance checkpoint; the
   later version-HEAD run also contains the production changes.
3. `prepare 0.12.8-repair.1` promotes a new changelog section, sets the package
   version, reruns the deterministic and LIVE gates, and creates the release-prep
   commit. It never pushes. Evidence from repair.0 is historical and cannot be
   reused for this HEAD.
4. `make 0.12.8-repair.1` pushes that clean prepared HEAD and requires the same
   three jobs on that exact version commit. Only after the second exact-SHA CI is
   green does it preserve and accept one candidate without repacking:

   ```bash
   ARTIFACT_DIR=$(mktemp -d /tmp/entwurf-release-candidate-0.12.8-repair.1.XXXXXX)
   bash scripts/with-dist-lock.sh npm pack --dry-run=false --pack-destination "$ARTIFACT_DIR"
   CANDIDATE="$(realpath "$ARTIFACT_DIR/junghanacs-entwurf-0.12.8-repair.1.tgz")"
   sha256sum "$CANDIDATE"
   ENTWURF_REQUIRE_DOCKER=1 ENTWURF_CANDIDATE_TGZ="$CANDIDATE" \
     ./run.sh check-install-container | tee "$ARTIFACT_DIR/acceptance.log"
   ```

   The gate must print `candidate mode: caller-preserved exact artifact (no repack)`,
   the same canonical path, the same SHA-256, and the image identity. `make` then
   tags that exact prepared SHA and creates the GitHub release. Keep the candidate
   and acceptance log; do not let a later step silently repack different bytes.
5. Only an explicit `publish 0.12.8-repair.1 <absolute-candidate> repair`
   invocation may run `npm publish "$CANDIDATE" --tag repair`. It verifies
   `repair=0.12.8-repair.1`, `latest=0.12.7`, and a registry-installed smoke.
   This cut moves only `repair`; `latest` promotion is outside this mode.
6. Only after publication, clean-reinstall the maintainer and secondary Linux host.
   Restart all old Claude sessions, open a new session, then require the
   **installed** `doctor-meta-bridge` to exit 0. A validate result or manual marker
   observation cannot override doctor RED. After both hosts prove delivery GREEN,
   GLG may separately authorize a stable `0.12.8` cut and move `latest`.

Invoking `land`, `prepare`, `make`, or `publish` grants only that named mode's
authority. Host reinstall remains a separate GLG authorization.

### Verifying the two capabilities a gate cannot fully judge

- **Garden-id delivery:** discover a target with `entwurf_peers`, then `entwurf_v2` with the correct intent — `fire-and-forget` for live pi, mailbox-backed meta, or native-push targets; `owned-outcome` only to wake a dormant record-backed pi citizen. Picking the wrong intent is rejected, never auto-fixed.
- **ACP continuity:** a direct `pi --provider entwurf --model claude-sonnet-5` turn, or the `smoke-acp-session-reuse-live` gate (process-scoped reuse + recall). Multi-turn reuse is proven by that gate, not by any v1 resume tool.
- **agy citizenship:** in a fresh agy conversation, the first `PreInvocation` must yield a garden id, `entwurf_self` must report `agentId=meta-session/antigravity` and `replyable:true` only while the native probe is alive, and a reply to that same garden id must direct-inject into the same conversation. No mailbox/receiver-marker evidence counts on this rail.

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
3. Claude meta-bridge global plugin — only when `claude` is on PATH; otherwise skipped cleanly
4. agy bridge + exact permission + statusline + `PreInvocation` hook — only when `agy` is on PATH; each adapter is idempotent and independently doctorable
5. `entwurf-bridge` install smoke (`validate_entwurf_bridge`)

```bash
git clone https://github.com/junghan0611/entwurf /path/to/entwurf && cd $_
./run.sh setup /path/to/consumer-project
# re-run the SAME command any time to repair a broken install
```

Expected tail: `DONE: entwurf setup (pi adapter + detected native bridges + v2 install smoke) green.` On a host with `claude`, verify `./run.sh doctor-meta-bridge`. On a host with `agy`, verify all three: `doctor-agy-bridge`, `doctor-agy-statusline`, and `doctor-agy-hooks`. Setup keeps optional-harness failures non-fatal so pi/Claude hosts are not bricked; the doctors are the fail-loud acceptance surface.

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

`setup` runs `pnpm install` + project/user-scope install + detected native-harness wiring (Claude and/or agy) + the v2 install smoke. A green setup proves the required core path and reports optional-harness degradation; it does **not** replace the native-harness doctors. The full aggregate live floor is still `LIVE=1 ./run.sh release-gate`, with agy's conversation-id-gated round trip verified separately.

### 1.4 Cross-install / cross-backend parity (optional, high-value)

Compare a fresh self-awareness report across axes: (1) same backend, different install path — answer must be path-invariant; (2) same backend, different machine — identical native tool list + MCP server/tool set; (3) different backend, same bridge — same garden capability but **different** native tool surface (a Claude session reporting another backend's native tools is a fail); (4) native pi routing vs ACP-bridged, same model — the native target reports no `entwurf-bridge` MCP (capability via pi's extension surface), while the ACP target reports it as the single MCP server. Honest "native: I cannot tell" hedging is PASS on the native side. Claude axes 1–4 are closed. agy is graded by the separate native-citizen checklist above, not by pretending it has Claude's ACP overlay. Gemini remains probe-only on 0.12.

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
- **Layer 2 — MCP boundary:** by default the five entwurf MCP tools are not visible (they appear only when `entwurf-bridge` is registered). Pass: says invisible tools are not visible; explains the native-vs-MCP boundary; treats `entwurf_register_native` as binding an already-running conversation, never as fresh spawn. Fail: pretends to use an unseen tool; mimics entwurf via recursive `pi`.
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
2. **All three CI jobs green on the exact release commit:** `check`, `install-surface`, and the required Linux `artifact-consumer`; preserve the latter's tarball digest and image identity.
3. **Live floor MUST green:** `LIVE=1 ./run.sh release-gate <dir>` reports `MUST PASS=N FAIL=0 SKIP=0`; a BEHAVIOR FAIL is advisory, not blocking.
4. **Native-host doctor green where the Claude meta-bridge is claimed:** a new post-install Claude session exists, live evidence is present, and the installed `doctor-meta-bridge` exits 0. `NOT CERTIFIED` is a release failure for that host, not a skip.
5. **Honest self-recognition:** the bridged model identifies its actual harness/backend, lists `entwurf-bridge` as the single MCP server with its five current tools, and presents a backend-native (not normalized) tool surface.
6. **Carrier separation honored:** engraving vs pi-context-augment kept distinct (§1A.0); no bridge-identity narrative attributed to the engraving carrier.
7. **agy shipped lane accepted:** all three agy doctors are green; automatic birth/statusline/sender identity and same-gid native-push reply are confirmed in a fresh conversation. `agentId=meta-session/antigravity` is correct; model display is not part of that contract. Same-pid concurrent conversation invocation is not claimed.
8. **Boundary preservation across backends/machines:** for every shipped or explicitly probed backend, regardless of install path or host, no cross-backend tool-surface contamination and no confabulation about pi internals.
9. **Hygiene:** no orphan ACP children; no unexpected persisted session garbage (a turn-scoped `cwd:` fallback is never a persisted reuse).

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
