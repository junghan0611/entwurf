# VERIFY.md

How a live `entwurf` ACP session is verified, and what a maintainer runs before a release. Machine-checkable invariants live in gates; this file defines evidence strength, the manual judgements a gate cannot make, and release acceptance. Per-run counts, digests and release chronology belong in [BASELINE.md](./BASELINE.md), CHANGELOG and release artifacts.

VERIFY.md is the **agent-driven** surface; [BASELINE.md](./BASELINE.md) is the operator-driven one. A bridged model runs the checks and writes down what it sees. In §1B one subject verifies itself: its own description is L0, never a second identity's agreement (L1). A file, process or transcript it reads outside the bridge can reach L3 for the specific claim it corroborates. Nothing in a single session reaches L4 or L5. Verifier and subject share the same bridge, MCP servers and overlay, so a uniform corruption of those would not surface here.

**Who executes what.**

- **Part I — verifying a live session.** An ACP subject asked to verify itself reads **Part I only**, from the top to the `# Part II` heading (Evidence Levels, §1B, §1A, §0, Continuity notes, §2), and executes **§1B only**. §1A, §0 and §2 tell it what is being judged. It opens Part II only when a step points there.
- **Part II — the maintainer floor.** The subject does not read it up front and does not run any of it: §0A (where a check lives, the floors, release axes), §1 Setup, §3 release criteria, or any `LIVE=1` command. Where §1B and Part II seem to disagree on what to run, §1B.0 wins for the subject.
- **Appendix.** Troubleshooting, the old banner's dated numbers and history pointers.

> **Current surface.** `entwurf-bridge` exposes nine tools: `entwurf_v2`, `entwurf_peers`, `entwurf_fresh_call`, `entwurf_resume_call`, `entwurf_retire_call` (operator-requested target only), `entwurf_callback`, `entwurf_self`, `entwurf_inbox_read` and `entwurf_register_native`. A native pi citizen offers seven of them (two hidden), and the pi-durable contact offers eight. An ACP session's own count is measured from its schema (§1B.3). The supported ACP backend is Claude; Cortex ACP is disabled. Antigravity and Codex are native-push citizens outside ACP; Antigravity's native push is paused (#152).

---

# Part I — Verifying a live session

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

## 1B. ACP self-run walk — the subject verifies itself, with the operator driving

This is the section an ACP subject executes when the operator says "read VERIFY.md and run the checks yourself." The subject is the model in the operator's own resident session (on 2026-11-13: `entwurf/claude-opus-5-5` in GLG's `entwurf pi` session, run from a development checkout installed as the operating owner). It replaces the hand-run single-turn / multi-turn / scenario sections of the pi-shell-acp era (git `fc5e095`), keeping their shape — snapshot, turn map, inject → recall → update, real work, hygiene — and dropping their retired verbs, version counts and cross-process claims.

The walk runs inside **one** existing session. The operator sends every turn; the subject proposes the next prompt and records what it saw, but never opens another session to play the operator. BASELINE's question bank is the operator's blind pass and comes first; this walk comes after, so the subject has read the answers here and must earn each claim with a measurement rather than by repeating this document.

### 1B.0 Ground rules

- **Allowed — a closed list.** Anything not on it, whether a command, a `run.sh` verb or an MCP call, needs the operator's instruction in this session. The list: reading files and source; read-only shell (`ls`, `cat`, `grep`, `git log/show/status`, `ps`, `readlink`, `jq`); `entwurf_self` and `entwurf_peers`; the read-only doctors and the deterministic gates named in §1B.2 and §1B.9; writing scratch files under a directory the operator names, outside the checkout.
- **Named examples of what is not on that list:**
  - Installing or building: `setup`; any `install-*`/`uninstall-*`/`takeover-*`/`wire-*`/`register-*`/`herdr-plugin-*`; `plugins/herdr/use-dev-checkout.sh`; `pnpm install`; `pnpm run build-bridge` or any build. On a host where this checkout is the operating owner, the gitignored `dist/` is the bytes live bridges load.
  - Rewriting the meta store: `meta-bridge-prune`, `meta-bridge-fresh-cut`.
  - Everything else: anything prefixed `LIVE=1`, `release-gate`, `pnpm run check:full`, `entwurf_fresh_call`, `entwurf_resume_call`, `entwurf_retire_call`, `entwurf_register_native`, `entwurf_callback`, `entwurf_inbox_read` (its garden id is caller-supplied and unverified, so another id drains that citizen's mail), an `entwurf_v2` send to anyone, a Cortex/agy/Codex call, `git commit`/`push`, editing any file in the checkout, the operator's profile, settings, hooks or overlay.
- **Never:** reading, printing or copying credentials (`auth.json`, `.env*`, tokens); killing or signalling a process; deleting records, transcripts or caches; another session's transcript or record beyond the facts `entwurf_peers` already returns.
- **Transparent mode:** verification here is not a benchmark. Use short turns. When something looks wrong, stop, say what was expected and what was seen, and wait for the operator. A failure is reported, not repaired.
- **Evidence rung on every line** (Evidence Levels above): your own description is L0; an MCP call's returned payload is L2 for that call only; a file, process or transcript read outside the bridge is L3 only for the specific claim it independently corroborates, and otherwise is just what you observed. The operator's own observation is theirs, and you report it as theirs. Do not promote a rung because several weak observations agree.

### 1B.1 Turn map

The operator sends these in order; one turn may cover several steps if they are short. Numbering is for the report, not a script.

| Turn | Step | Operator does |
|---|---|---|
| 1 | §1B.2 snapshot | "run the snapshot" |
| 2 | §1B.3 self-recognition, measured | "now check your claims against the files" |
| 3 | §1B.4 a code word to hold (inject) | gives a harmless code word and one fact |
| 4–5 | §1B.5 real read-only work on this repository | names a question about the code |
| 6 | §1B.4 recall, then update the fact | "what was the code word and fact?" then changes the fact |
| 7 | §1B.6 effort | changes the thinking level in pi's selector, then sends a short turn |
| 8 | §1B.7 abort | sends a turn that runs a while, presses ESC, then sends one more turn |
| 9 | §1B.4 recall after the abort | "the code word, and the latest fact?" |
| 10 | §1B.8 transcript axis and hygiene | "look at your own transcript and processes" |
| 11 | §1B.9 deterministic gates (optional) | names which gate, if any |
| 12 | §1B.10 report | "write the report" |

Turns 7 and 8 need the operator's hands, and the operator may skip them; a skipped step is reported as not measured, never as passed.

### 1B.2 Snapshot (L3)

Collect, and report each line with its command:

```bash
readlink -f "$(command -v entwurf)"                 # which install owns the bin
git -C <that checkout> log -1 --format='%h %s'      # source revision, when the owner is a checkout
git -C <that checkout> status --short | head        # clean or not
pi --version
jq -r .version <checkout>/node_modules/@agentclientprotocol/claude-agent-acp/package.json
jq -r .version <checkout>/node_modules/@agentclientprotocol/sdk/package.json
<checkout>/run.sh doctor-pi-package                 # who owns the Pi user-scope registration
<checkout>/run.sh doctor-pi-provider                # does the provider's bridge command boot
```

Then call `entwurf_self` and report `sessionId`, `origin`, `cwd`, and its rail fact: a pi session reports `socketState`, while `rail` appears only for a meta-session citizen. The meta record `~/.pi/agent/meta-sessions/<sessionId>.meta.json` gives `nativeSessionId`; your transcript is `~/.pi/agent/sessions/--<cwd with / as ->--/*_<nativeSessionId>.jsonl`. Find your own pi process and the ACP child under it, and report PIDs, parent PIDs and executable names only. Other processes' argv can carry other people's tasks, so do not print the host-wide argv list:

```bash
ps -o pid,ppid,etimes,comm -p "$PPID"                    # walk up from your own shell with -p <ppid> until pi
ps -o pid,ppid,etimes,comm --ppid <your pi pid>          # its direct children; the ACP child is one of them
```

For a PID on your own chain, or a direct child of your own pi process (for example the `entwurf-bridge` MCP server pi itself starts), you may read its argv (`ps -o args= -p <pid>`), because pi and the ACP child may both show `node` as their name. Without that, a chain you cannot walk with certainty is reported as unknown.

`doctor-meta-bridge` is the Claude Code native-citizen doctor; it is not about this ACP session. It is read-only toward the operator, but one of its checks delivers a test message inside a temporary world, so run it only when the operator asks.

Pass: every line answered from a command; a version or path you could not read is reported as unknown. Fail: a version or owner stated from this document or from memory.

### 1B.3 Self-recognition, measured

Answer first, then check each answer against a source outside yourself:

1. **Harness and backend:** you are a Claude model reached through Pi's `entwurf` provider over ACP (`claude-agent-acp`), not Claude Code started directly. Corroborate with the process tree from §1B.2.
2. **Native tools:** list the native tools your callable schema carries, then compare with `DEFAULT_CLAUDE_TOOLS` and `DEFAULT_CLAUDE_DISALLOWED_TOOLS` in `pi-extensions/lib/acp/tool-surface.ts` and the `Skill` rule in `pi-extensions/lib/acp/config.ts`. Report differences; your schema wins over the file.
3. **MCP:** list the MCP servers and tools your schema carries, verbatim (`mcp__entwurf-bridge__entwurf_v2` shape, §2.1). Compare the server names with `entwurfProvider.mcpServers` in `<cwd>/.pi/settings.json` and `~/.pi/agent/settings.json`, reading names only (`jq -r '.entwurfProvider.mcpServers // {} | keys[]'`); a server's `env` or args may hold secrets and are not printed. If names alone cannot be read, report the comparison as not measured. Report the count you see; it is not required to match another rail's count.
4. **Carriers (§1A.0):** say what came through the engraving slot and what came through the first-user augment. Compare the engraving with `pi-extensions/lib/acp/prompts/engraving.md` (or the file `ENTWURF_ACP_ENGRAVING_PATH` names), and the augment with `buildPiContextAugment` and `prependNewPromptAugment` in `pi-extensions/lib/acp/augment.ts` and with which AGENTS files exist for your cwd.
5. **Input:** the `entwurf` rows declare text-only input (`ACP_ROW_INPUT` in `pi-extensions/lib/acp/models.ts`). Say what that means: no path carries image bytes to the backend, and an image block pi does pass to the converter becomes `[image omitted: <mime>]` in the rebuilt or delta prompt (`context.ts`). Whether pi's UI passes an attachment on a text-only row at all is unmeasured; if the operator tries it, report only what you received.

Pass: answers match their sources, and "I cannot tell" where no source answers. Fail: a tool, server or carrier content that no source shows; the bridge-identity narrative attributed to the engraving.

### 1B.4 Continuity — bridge and semantic, kept apart

- **Inject (turn 3):** the operator gives a code word and one plain fact (Continuity notes, wording rule: animal, colour or place names, never anything that sounds like a secret). Repeat them once, exactly.
- **Recall (turn 6):** return the code word verbatim and the fact, then accept the operator's update to the fact.
- **After the abort (turn 9):** return the code word and the *updated* fact.
- **Bridge side:** read the `[acp: …]` notices pi stored in an assistant message in your transcript (§1B.8). You cannot see them otherwise: they are display-only and are not sent back to you. Read them for the *previous* turn, never the one you are generating, which is not yet settled in the file; the operator sees the current turn's notices on screen. A first-turn `preparing` notice is visible only if this session's file still holds that turn. Notices are bridge-side evidence, not an independent proof of the backend's own session state. In a resident session the first turn shows `[acp: preparing claude session]`, then `[acp: session ready model=<id>]`, and later turns show `[acp: reusing live session]` while the session lives. A sibling opened by `entwurf_fresh_call` runs the same resident lifecycle and showed the same shape (n=1, 2026-11-13). A changed effort does not by itself open a new session: on reuse the new level is set and read back on the live session. A new session (`preparing` again, transcript resent as text) follows only when the session was dropped: a refused or mismatched effort answer, a first-turn cancel, an escalation or pre-prompt abort, a child death, or a changed bridge configuration. The model is locked for an `entwurf` session (§Appendix, model guard).

Pass: semantic recall right on every recall turn, and the bridge reading explains any new session it shows. Fail: a recall that paraphrases the code word; a claim of reuse that the notices contradict.

### 1B.5 Real read-only work (Layer 1)

The operator names a question about this repository, for example: "where is the effort read-back notice produced, and which gate certifies it?" or "what does an ESC leave behind on a reuse turn, and where is that text?" Answer with `file:line` references you actually opened. Use `Bash` for search (`grep -rn`); there is no `Grep` tool on this surface.

Pass: every reference opens to what you said; no recursive `pi` and no MCP detour for a file read. Fail: a reference you did not open; an answer from memory.

### 1B.6 Effort (#142)

Claude ACP rows map pi's thinking levels onto the agent's `effort` option of the same name (`CLAUDE_ACP_EFFORT_VALUES`, `claudeAcpThinkingLevelMap` in `models.ts`). Which of `low`..`max` a row offers is decided by pi's registry for that model: `xhigh`/`max` appear only where the registry maps them, and `off`/`minimal` are never offered. The level is set and read back after set-model on a new session, and on a reused session only when it changed; the transcript then carries `[acp: effort <value> read back]` before `sending prompt` (`backend.ts`). A refused or mismatched answer fails the turn before the prompt with `acp-thinking-level-unsupported` or a readback error, and drops a reused session.

A session's first effort is the pi thinking level in force when it starts: `defaultThinkingLevel` in pi settings, unless the operator changed it in the selector before the first turn (those changes are `thinking_level_change` entries in the transcript). After the operator changes the level (turn 7), report the value read back from that turn's notice. Read it in turn 8 or later, once turn 7 has settled in the transcript; until then it is the operator's on-screen observation. Readback proves the agent accepted the setting. It is not evidence of applied reasoning depth or speed, so do not report on how hard you thought.

### 1B.7 Abort (#142)

ESC sends ACP `session/cancel`; the agent ends its own turn, and only after a bounded grace does process cleanup follow. After an ESC the turn carries one of two notices, defined as `ACP_CANCEL_KEPT_NOTICE` / `ACP_CANCEL_CLOSED_NOTICE` in `backend.ts`; `pushAcpLifecycleNotice` in `event-mapper.ts` wraps them as `[acp: …]` on screen:

- `stopped — changes already made stay; next message continues this session` — a reuse turn the agent closed on cancel;
- `stopped — changes already made stay; next message opens a new session` — a cancelled first turn, an escalation, or an abort before the prompt was sent.

When the next turn rebuilds the transcript, an aborted assistant turn is followed by `[turn status: aborted — actions this turn had started may already have taken effect; cancellation is not rollback]` (`context.ts`). The reuse delta carries no such line.

For turn 8 the operator should send something harmless that takes a few seconds, such as reading several files, never an edit, and should not change the effort level in the same turn: an ESC landing while a changed effort is being set is a pre-prompt abort and closes the session, which mixes two readings. After ESC, report which notice appeared, whether turn 8b reused or opened a session, and whether anything the cut turn started may have happened. Do not claim that a cut undid anything.

### 1B.8 Transcript axis and hygiene (L3)

```bash
F=$(ls ~/.pi/agent/sessions/--*--/*_<nativeSessionId>.jsonl)
jq -r '.message.role // .type' "$F" | sort | uniq -c
jq -r 'select(.message.role=="assistant") | .message.content[]? | select(.textSignature=="entwurf:lifecycle-notice-v1") | .text' "$F" | grep .   # notices only (a model's own "[acp: …]" carries no signature); grep . drops the blank lines each notice is wrapped in
```

- Pass: user and assistant turns accumulate in your own pi transcript. A message a sibling delivers through `entwurf_v2` is stored as `custom_message`, not `user`, so when an operator drives the walk by message the `user` count will not match the turn count. Under ACP the memory axis is still pi's file, and no second memory layer exists. There is no separate child pi transcript in a resident session.
- **Processes:** report the ACP children under your own pi process now. Use one alive child per live `(sessionKey, backend, modelId, bridgeConfigSignature)` as the expected bound (§2.3). Without a "before" count, the delta is unmeasured. A process name alone does not prove ownership or orphanhood. Look only, and never kill.

### 1B.9 Deterministic gates (optional, operator's pick)

Deterministic gates are designed to run offline with a sandboxed HOME, `PI_CODING_AGENT_DIR` and XDG roots (AGENTS.md Verification), but a subject should not take that as a blanket guarantee. Run one only when the operator names it in this session:

- `./run.sh check-acp-set-model-readback` covers model readback, effort and the cancel notices; `./run.sh check-acp-vendor-rejection` covers the reuse turn's cooperative cancel (`ACP-REUSE-COOPERATIVE-CANCEL`). Running it runs the fixture tests, not their mutants; mutant kill-power is a separate PARTIAL qualification (`scripts/mutants/acp-set-model-readback.json`), which is a maintainer action.
- `./run.sh check-acp-carrier-augment`, `check-acp-tool-surface` and `check-acp-config` cover the carriers, the tool surface and the MCP projection.
- `pnpm check` is the core tier, about a minute on the reference host.

A green gate certifies its fixture contract, not this live session, so report it beside the live observations, not as one of them. `pnpm run check:full` (about 16 minutes) and every `LIVE=1` gate belong to the maintainer floor (§3) and are not part of this walk.

### 1B.10 Report

The report is one table, then findings:

| Step | Observed | Evidence (command / `file:line` / transcript line) | Rung | Verdict |
|---|---|---|---|---|

- **Verdicts:** use `pass`, `fail`, `not measured` or `operator-judged` (the operator saw it; you did not).
- **Findings:** classify each one as **Blocker**, **Defect** or **Observation** (AGENTS.md Review Discipline). Name the source line that disagrees.
- **Evidence source:** a row whose Evidence column is empty, or whose only source is VERIFY.md itself, gets `not measured`. This document tells you what to look for, but it is not the evidence.
- **Boundary:** end with what this walk cannot show. Verifier and subject are one session on one bridge, so the walk stays below L4. It is n=1. Readback is not reasoning depth. There is no long-haul soak (L5).

Return the report to the operator in the session. Send it nowhere else unless the operator says so.

### 1B.11 When an examiner runs the walk on a sibling

The original protocol has an ACP examiner open a fresh ACP sibling and walk it through the core interview and §1B (2026-11-13: Opus examining Sonnet). A subject's answer is L0 until the examiner has re-measured it from outside the subject:

- **Process chain:** the examiner's own `ps` of the subject's pi, ACP child and `claude`.
- **Record:** the subject's meta record (`nativeSessionId`, `backend`) read by the examiner.
- **References:** a sample of the subject's `file:line` references, opened by the examiner.
- **Transcript:** role counts and signed notices from the subject's transcript once its turn has settled. A turn the examiner delivers by `entwurf_v2` is stored there as `custom_message`.

A fresh sibling's first message is its `entwurf_fresh_call` task, so that task carries the blind core interview. Keep it to the interview block plus one reply instruction, and grade the routing words as part of what arrived.

---

## 1A. Main Agent Evaluation — Is `entwurf` Claude strong enough?

Separate from continuity gates. Gates prove "sessions continue"; this questionnaire examines tool self-awareness / native tool usability / MCP-boundary awareness / long-turn focus / quality vs direct Claude Code. The current subject is whichever curated `entwurf/<model>` row the operator has opened in a resident `entwurf pi` session (on 2026-11-13 GLG's `entwurf/claude-opus-5-5`); turns accumulate in that one session as the operator sends them. A one-shot `pi --provider entwurf … -p` is turn-scoped (§0 criterion 1), so it cannot run Layer 3 and is not how this questionnaire is driven. §1B turns these layers into a step-by-step walk the subject runs on itself.

### 1A.0 Two carrier surfaces — engraving vs pi-context-augment (load-bearing)

`entwurf` delivers identity-relevant text through **two structurally distinct surfaces**. Collapsing them into "the system prompt" is the most common verifier-side mistake. (BASELINE Q-B0/Q-L1 grade the same separation operator-side.)

| Surface | Source | Delivery shape | Default content |
|---|---|---|---|
| **Engraving carrier** | `pi-extensions/lib/acp/prompts/engraving.md` (or `ENTWURF_ACP_ENGRAVING_PATH`) | Claude `_meta.systemPrompt` — full-replacement identity slot | Operator-authored, optional opt-out; tiny non-empty by default on Claude ACP (replaces the `claude_code` preset + strips its auto-memory advertisement). Emptying the file is the opt-out. |
| **pi-context-augment** | `pi-extensions/lib/acp/augment.ts` (`buildPiContextAugment`, prepended by `prependNewPromptAugment`) | First-user-message prepend (not the system slot) | Always carries (1) the bridge identity line and the tool-truth rule ("the actual callable schema is the source of truth"). Then, each only when the file exists and is non-empty: (2) `~/AGENTS.md`, (3) the cwd's `AGENTS.md` when it differs from the home one. The whole augment is cut at 50 KiB with a visible `[entwurf: context augment truncated …]` marker, so a long home file can push the cwd block out entirely, and a cwd block the prompt already carries is dropped from the augment rather than sent twice (`truncateAugment`, `prependNewPromptAugment`). |

Pass (carrier honesty): the subject distinguishes engraving from pi-context-augment by name or structure without prompting; on ACP targets says which augment components arrived, given which AGENTS files exist for its cwd (a missing component is a fail only when its file exists and is non-empty, the truncation marker is absent, and the prompt did not already carry that cwd block); may quote the engraving but must **not** attribute bridge identity / AGENTS / memory policy to it. Fail: attributes the bridge-identity narrative to the engraving carrier; claims the augment is empty on an ACP run; invents engraving content. Native pi exception: on native targets the bridge-identity line and `~/AGENTS.md` are not part of the augment — the PASS criterion is honesty about what arrived, not the three-component checklist.

### 1A.1 Layers

- **Layer 0 — self-awareness:** ask environment self-awareness / MCP visibility / upstream-instruction awareness, guessing prohibited. Pass: recognizes native tool family, says "I don't know" honestly, answers MCP visibility only as configured, describes upstream instruction type without reproducing internal prompts. Fail: claims a nonexistent tool, conflates pi-custom and native tools, hallucinates MCP visibility, or conflates the two carriers (§1A.0).
- **Layer 1 — native tool use:** throw file-reading / structure-analysis / regression-hunting tasks. The Claude ACP default native surface is `Read`/`Bash`/`Edit`/`Write`, plus `Skill` when skill plugins are configured (`DEFAULT_CLAUDE_TOOLS` in `pi-extensions/lib/acp/tool-surface.ts`, `config.ts`); there is no `Grep`/`Glob`, so search goes through `Bash`. The session's actual callable schema is the truth, not this sentence. Pass: tool selection is natural for that surface; no detour through MCP or recursive `pi`. Fail: strange detours for simple reads; speaks from memory without reading; claims a tool its schema does not carry.
- **Layer 2 — MCP boundary:** the ACP session sees exactly the MCP servers the operator declared in `entwurfProvider.mcpServers` (global and project settings merged per name; on this checkout the project declares `entwurf-bridge`), and the verbs that server lists. How many entwurf verbs the ACP projection shows is measured from the session's own callable schema; do not carry over the native-Pi (seven, two hidden) or pi-durable (eight) counts, which are other rails. Changing the declaration changes `bridgeConfigSignature`, so a live incompatible session is replaced rather than silently reused (`check-acp-config`, `smoke-acp-mcp-live`). A declared server with no callable tool in the schema is reported as exactly that; whether it is connected, and why it shows nothing, stays undetermined. Pass: names only servers and tools its schema carries; explains the native-vs-MCP boundary; treats `entwurf_register_native` as binding an already-running conversation (today Antigravity only, and paused by #152), never as fresh spawn. Fail: pretends to use an unseen tool; mimics entwurf via recursive `pi`.
- **Layer 3 — focus across turns:** inject a fact, then accumulate turns mixing retrieval/exploration. Pass (a heuristic carried over from the pi-shell-acp era, not a release threshold): after **8 turns** holds **3+ early facts** incl. **one verbatim string injected before turn 5**; no repeated exploration, no self-contradiction, no tool-strategy drift. Fail: forgets early reads; paraphrases instead of returning the verbatim string. Note: entwurf exposes no user-facing compaction; use the backend's `usage_update` footer as an overflow-risk signal (it follows the ACP backend's `used/size`, not pi's visible-transcript estimate).
- **Layer 4 — vs direct Claude Code (operator-only; the subject cannot run it alone):** requires a verifier holding **both** the `entwurf` and a direct path (human-in-loop, or both transport handles). Compare latency / native tool accuracy / detours / boundary confusion / quality around turns 10–15. Repeated tool confusion, long-turn forgetting, or boundary workarounds are a fail.

Interpretation: Layers 0–2 healthy → basic qualifications confirmed. Layer 3 weak → strengthen prompt shape + corroborate with bootstrap logs / process state / sentinel recall. Layer 4 much weaker than direct → revisit bridge handoff. This questionnaire does not replace gates.

---

## 0. Quality Criteria

The goal is not merely "invoke Claude Code." We want:

1. **Session continuity at the agent-shell level** — only a resident pi (`--entwurf-control`, which `entwurf pi` adds) is process-scoped and reuses one live ACP session, each later turn sending only the new user message; plain interactive `pi` and `pi -p` are turn-scoped and open a new ACP session every turn, carrying pi's transcript rendered as one text prompt (`context.ts`) — a text rendering, never a backend-native transcript hydration (`resolveLifecyclePolicy`, `pi-extensions/lib/acp/session-store.ts`; [docs/acp-backend-rail.md](./docs/acp-backend-rail.md)).
2. **Preservation of pi harness semantics** — pi session files / transcripts / memory pipeline stay a shared axis.
3. **restart-hygienic** — process-scoped reuse continues the same ACP session across turns inside a long-lived resident; persisted records are written/validated for the future resume-load lane, not the live continuity path today.
4. **Thin bridge** — no second harness built inside this repo.
5. **Explicit capability boundary** — pi custom tool / user MCP visibility is determined solely by `entwurfProvider.mcpServers`; no automatic `~/.mcp.json` loading.
6. **Operational hygiene** — no orphan subprocesses, no excess persisted session garbage.

## Continuity notes

### Wording — avoid safety-interpretation contamination

When injecting a fact for a continuity check, use **plaintext that does not trigger model safety interpretation**. Avoid `secret token`, `password`, `API key`, `credential`, and meta-directives like "do not leak" — such wording makes the model treat the prompt as an exfiltration attempt and refuse, which makes **continuity look broken even when it is alive** (this happened once with `test-token-123`, misdiagnosed as a delegation failure). Instead: `The code word is owl → reply in one word → owl`; code names / colors / animal names. Do not mix continuity and safety-behavior verification in one prompt.

### bridge continuity vs semantic continuity

- **bridge continuity:** same `sessionKey` / same `acpSessionId` through in-memory process-scoped reuse. Persisted session records are written for a future resume/load lane but are not consumed today.
- **semantic continuity:** a fact from a prior turn is retrievable in a later turn.

Either can be alive while the other looks dead (the wording case above is bridge-alive / semantic-looks-dead). When in doubt, change the wording and retry once, and read the turn's own lifecycle notices in the assistant text (`[acp: preparing …]` on a new session, `[acp: reusing live session]` on reuse). `smoke-acp-session-reuse-live` reads those notices as its reuse oracle and treats recall only as supporting evidence (`scripts/smoke-acp-session-reuse-live.ts`); it does not independently certify the backend's own native session.

---

## 2. Manual judgement checks — what the gates cannot fully judge

The invariants a gate certifies are listed in Part II ("Gate pointers for the live-session invariants"). A gate certifies its fixture contract, not this session. What follows is what a gate cannot fully judge.


### 2.1 MCP callable-identifier shape (verified property, gate-external)

The literal callable identifier differs per backend — probe by asking the agent to print it **verbatim** (do not ask "hyphen or underscore" — ambiguous between outer separator and inner server name):

| Backend | Literal identifier | Boundary |
|---|---|---|
| Claude | `mcp__entwurf-bridge__entwurf_v2` | native Claude tool surface + explicit MCP server |

Cortex ACP is disabled; its older callable-identifier observations are historical.

### 2.2 MCP injection visibility

Folded into §1A.1 Layer 2 and §1B.3 item 3.

### 2.3 Process / cache hygiene — the orphan bound (§gate-external judgement)

Apply per backend under test:

```
AFTER_<BACKEND> ≤ BEFORE_<BACKEND> + (distinct alive
  (sessionKey, backend, modelId, bridgeConfigSignature) tuples this run holds open)
```

An **upper bound**, not an equation: child reuse and idle reaping may keep the delta below it; a config-signature or `(provider, model)` switch may add one. `AFTER > BEFORE + alive_tuples` is actionable. Walk the backend process parent chain; any ACP child whose parent `pi` has exited is an orphan—preserve it as evidence.

### 2.4 pi session record as a shared memory axis

Pi session files stay the shared record source even under ACP: "Claude via ACP, memory via the pi axis (JSONL → Denote/andenken)", and the AI does not run its own memory layer. The check and its recipe are §1B.8.

---

# Part II — Maintainer floor (read for context; the subject does not run it)

## 0A. Execution Policy — Transparent Mode

Verification here is not a benchmark. In production we exchange short turns and stop immediately to isolate a cause before resuming when something looks off. This document records **verification intent (what we look at) and pass criteria (how to judge)**; the execution shape is the agent's choice as long as the criteria are met.

### Where a verification lives — two locations, and what decides

A new contract's test goes BESIDE the behaviour it certifies: `pi-extensions/**/*.test.ts` or
`plugins/herdr/**/*.test.mjs`. Nothing names those files. `check-tests-beside-behavior` expands
the two globs every run and hands the resulting paths to `run_vitest`, so landing a test edits no
list — and a failure is attributed from the JSON test TITLE (`run.sh:104-113`), never from the
code frame, which quotes an adjacent passing test's own title.

`scripts/check-*` is not a legacy pile; it is the home of what a vitest lane cannot hold. What
stays there, and why: LIVE lanes that need real accounts, models, tmux or a Docker daemon;
install and pack gates that consume a tarball; gates that spawn a subprocess or stand a server up;
gates that read product source as text; and the mutant EXECUTION COORDINATES described below. A
new hand-built gate needs a reason one of those five applies.

The maintainer demo lane (#138) is source-only Node strip-types/CLI and subprocess
fixtures, not an installed adapter contract. Its `demo/**/*.test.ts` uses `node:test`,
so `check-demo-reproducibility` discovers and runs it separately in the deterministic
floor, with sandboxed HOME/XDG and fake version-only Pi metadata. Do not add Node tests
to the Vitest include and call them reached. Take/renderer/helper TS stays out of the
package; the paired scripts type fence checks it. Fake-tool tests, private original
capture, a new opt-in LIVE take, published GIF approval and exact release/package
acceptance remain distinct axes; see [the source recipe](./demo/README.md).

**Four rules bind a migrated gate that carries mutants**, and each of them was measured rather
than assumed (#119 V3 slice 2):

1. **Every QK claim is its own `it` title.** Attribution reads the failed test title, so a QK
   that lives only in an assertion message leaves its mutant unattributable.
2. **The token appears exactly once in the file.** Putting it in the title AND the assertion
   label is refused by the manifest set-integrity contract — the title keeps the token, the
   assertion keeps the sentence.
3. **The `run.sh` case survives as a mutant execution coordinate, and keeps its `check:contracts`
   entry.** The case is not a discovery path: the door already finds the test. It exists because
   the qualification runner re-invokes a gate's argv once per mutant, and a gate argv calling
   vitest directly would skip the reporter attribution depends on. Its file filter is narrow,
   because a mutant pointed at the glob shim would re-run every beside-behaviour test once per
   mutant. It stays in `check:contracts` because `check-release-gate-outcomes` requires a gate a
   mutant names to run inside `check:full` — reachable only through qualification, its going red
   on a clean tree would be noticed by nothing but the mutant body.
4. **Attribution is containment, not exclusivity.** `assert.ok` aborted at the first broken claim,
   so exactly one label was ever reported; vitest runs every test, so one mutation surfaces
   several failed titles (measured: 1–15). A kill is attributed when the claim's token is AMONG
   them.

Migration moves lines BETWEEN the two axes `inventory-verification-surface.ts` counts, and only a
drop in the COMBINED number is subtraction. That is why the inventory reads both locations: a gate
that moved out of `scripts/` and into a file beside its subject would otherwise read as deleted.

### Gate pointers for the live-session invariants

The single-turn / multi-turn / cross-process / persistence-boundary / shutdown invariants that earlier editions hand-ran against the retired v1 verbs are now **deterministic or live gates**. Verify them through the gate, and reserve manual time for the human-judgement surfaces below.

| Invariant | Current gate (pointer) |
|---|---|
| Single-turn prompt extraction, SessionStart hook not mistaken for prompt | `smoke-acp-raw-turn-live` (a bare-vendor shape by design: no overlay and no session meta, so it is not the production session shape), `check-acp-prompt-builder` |
| Multi-turn continuity + recall (process-scoped reuse) | `smoke-acp-session-reuse-live`, `check-acp-session-reuse` |
| Cross-process continuity / cache before-after | `check-acp-session-store` (signature, decideBootstrap, persist/parse) |
| Lifecycle policy — turn-scoped is always new; process-scoped may reuse only the live in-memory session; persisted records are not a resume/load path today | `check-acp-session-store`, `check-acp-session-reuse` |
| Tool-call / event mapping | `check-acp-event-mapper`, `smoke-acp-provider-live` |
| Prompt lifecycle — no wall-clock cutoff on a running turn; abort ends it by ACP `session/cancel` with bounded cleanup; a child death is reported with exit status + stderr on new AND reuse turns; our prompt-phase error text is not classified transient by pi | `check-acp-prompt-lifecycle`, `check-probe-ordering` |
| Claude typed `incomplete_tool_call` prompt failure — real pi retry/overflow classifiers reject the fixed verdict, raw evidence stays in existing diagnostics, exactly one seal and drop on new/reuse; other failures retain the legacy stderr path, cancel stays separate. A deterministic receipt does not certify the target vendor runtime. No LIVE gate induces this rejection; the raw-turn and reuse smokes certify only their own rows above. | `check-acp-vendor-rejection` (four mutants) |
| Claude set-model answer read back before the prompt — an exact row, or the one alias row (value and name) measured for the requested id; a missing model option, another row or any other value/name pair refuses with non-transient text. Deterministic only: the answer shapes measured at 0.85.1, and unchanged at 0.90.0 with the production session meta (no prompt), are fixture literals, not a runtime certificate. | `check-acp-set-model-readback` (two set-model mutants), `check-probe-ordering` |
| Claude effort (#142) — curated rows offer pi's `low..max` through pi's own selector and clamp; the level is resolved before any spawn and set + read back as `effort` after set-model on a new session, and on reuse only when it changed (not in the reuse signature); no level, an unsupported level or a non-effort value refuses as `acp-thinking-level-unsupported`; a refused or mismatched answer fails before the prompt, our authored text non-transient (the appended stderr tail and a bootstrap timeout follow the existing pre-prompt path), and a reused session is dropped, so the next turn opens a new session and resends the transcript. Deterministic only: the effort shapes measured at 0.106.0 with no prompt are fixture literals; readback is not evidence of applied reasoning depth or speed. | `check-acp-set-model-readback` (five effort mutants) |
| What an abort leaves (#142) — after the turn settles, a reused turn the agent closed on `session/cancel` says the live session continues; a dropped session (cancelled first turn, escalation, pre-prompt abort) says the next message opens a new one; both say changes already made stay. A rebuilt (new-session) transcript follows an `aborted` assistant turn with one status line saying the turn was cut and a cut is not rollback, claiming nothing about what ran; the reuse delta carries no such line. An abort already raised, or arriving, while a reuse turn awaits a changed effort's answer settles on the abort, sends no prompt and drops the session. A reuse turn's stream opens only when its own prompt is sent, so an update arriving during its effort set is never shown or sealed as that turn's; inside the prompt window the wire carries no turn id and that part rests on the adapter. Deterministic only (scripted ACP partner and pure transcript rendering); the real-vendor n=1 cells are in #142, not a release certificate. | `check-acp-set-model-readback` (seven cancel mutants) |
| Pi's summary request (#163) — `/compact`, the threshold, overflow recovery and `/tree` summaries are admitted only on an empty tool surface WITH `cacheRetention: "none"` (an ordinary all-tools-excluded turn still refuses); the turn runs on a new, never-retained child with no tools, MCP servers, plugins, pre-approvals or setting sources, sends Pi's summarization instructions as the first prompt block and no augment, and emits no notice, so the stored summary is exactly the model's text; a `cancelled` stop Pi did not abort is sealed as an error, so Pi never keeps that partial text; `session_compact` closes the session's retained child unless its turn is in flight. Deterministic only: Pi's real `generateSummary` / `generateBranchSummary` drive the turn against a scripted ACP partner; the live `/compact` cell is in #163. | `check-acp-set-model-readback` (ten summary/compaction mutants), `check-acp-provider-surface` |
| Tool visibility (#163) — a title-only update names the running call on one display-only line (a beat in the same update prints alone, a repeated title prints nothing); a finished call previews at most 5 lines / 400 bytes of its output, head on success and tail on failure, nothing when the one-line summary already holds it, hidden with the tool stream, each line keeping its indentation; every notice and preview line is cleaned as Pi cleans tool output (ANSI/OSC sequences and C0 controls removed, compared against Pi's installed `stripAnsi`/`sanitizeBinaryOutput`), plus DEL and C1; the backend's own compaction shows trigger, tokens before and after, duration and failure on one lifecycle line, once. All three are signed, so they stay out of replay, the reuse signature and andenken `control-v1` embedding. Deterministic only: frames follow claude-agent-acp 0.107.0 as read, not a live capture. | `check-acp-set-model-readback` (thirteen mapper mutants) |
| Operator mcpServers / skills reach the live session | `smoke-acp-mcp-live`, `smoke-acp-skill-live`, `check-acp-config` |
| Overlay isolation + memory containment | `check-acp-overlay`, `smoke-acp-memory-containment-live`, `check-acp-tool-surface` |

### The canonical floor — two entry points

- **Deterministic floor — two tiers (#70):** `pnpm check` is the everyday CORE — toolchain (lint + typecheck), the vitest lanes, and the pure-unit / behavioral-contract / source-topology gates plus the cheap static coherence checks. It prints its own total wall time; acceptance is ≤60s on the reference host `oracle` (an operator measurement, never a hard wall-clock gate on arbitrary hosts). `pnpm run check:full` is the FULL deterministic floor — the core plus the hermetic-integration and package/install tiers — and is what the frozen-candidate protocol, push CI, release-gate, and `prepublishOnly` run. Exact membership is the named `check:*` group scripts in `package.json` (the executable SSOT — this document records meaning and principles, not the command list); a gate changes tier by semantic-class decision, never by getting faster or slower. One core member assumes a build output: the beside test `pi-extensions/entwurf-control.test.ts` (reached through `check-tests-beside-behavior`) registers the COMPILED bridge and refuses by name when it is absent. `prepare` normally builds it at install; after an `--ignore-scripts` install or a bridge source change, run `pnpm run build-bridge` (in the sandbox candidate when verifying one) before the core. The FULL tier carries the qualification HEAD (`check-gate-manifests`, through `check:hermetic`); the everyday core does not, and neither tier carries the separately scheduled mutant-executing body (`check-gate-qualification`).
- **Discriminating power of that floor:** `./run.sh check-gate-qualification` (scheduled, not ambient: the whole body runs only as the bare call — in the CI `check` job on the weekly `schedule` or a `workflow_dispatch -f qualify=true`, never on a push. It is a drift diagnostic, not a release axis (#144): no cut waits for it and the exact-SHA release oracle reads only the push run's four required jobs. Development runs no whole body (#133): a lane that changes a gate/mutant/matrix runs its affected exact-argv groups once, after review, as PARTIAL receipts — `./run.sh check-gate-qualification --group '<argv JSON>' --receipt <absolute path outside the repo>`, whose arguments reach the runner's parser unchanged and are refused there by name, before any body or snapshot, when malformed, missing or repeated. A receipt is a measurement of one group on its own candidate, never a qualification pass and never coverage of a release. Neither form is inside the default check chains; a semver TAG push triggers no CI at all) re-plants committed defect mutants (`scripts/mutants/*.json`, one per closed defect class) in an isolated snapshot repo and requires each to turn its gate red **bounded and at its claimed `[QK:<claim>]` signature** — a wrong-reason red fails, a baseline-red control voids the whole group, and the runner is negative-controlled on every run (zero-match/multi-match/survived/wrong-reason/hang/control-red/impurity). This measures whether the deterministic gates still *block* what they claim to block; it is **not a new evidence level** (L0–L5 are untouched) and never substitutes for LIVE evidence. Per-cut records cite claim IDs + killed mutant IDs — "N checks passed" alone is not evidence. `check-agy-permission-matrix` complements it with the enumerated permission contract space (literal cells + stated exclusion rules, oracle independent of the SUT). The gate's HEAD is separable and IS in the floor: `check-gate-manifests` runs the runner self-test, validates the committed manifest set against the origin index, and asserts the declared lane inventory, while executing zero COMMITTED mutants (the self-test runs only its synthetic fixture mutants, in tmp fixture repos) and never snapshotting the repo — three of the five reds qualification has ever produced in CI died in that head, in under five seconds.
  - **The snapshot is source-only (#125).** It replicates the git work surface and never copies an ignored artifact from the checkout. A gate that consumes an ignored build output — the compiled `entwurf-bridge` a pi citizen registers — declares it on each of its mutants (`"build": {"argv": [...], "output": "<dir>"}`, one declaration per gate group). For that group only, the runner builds the output from the snapshot's own bytes before the control, rebuilds it after every mutation and from the restored bytes before the post-control (which must reproduce the baseline digest), never counts a build red as a kill, voids a run whose gate writes into the output, and removes the output when the group ends. The runner self-test owns this as `[QK:QUALIFY-BUILD-*]`.
- **Live floor:** `LIVE=1 ./run.sh release-gate <scratch-project-dir> --cut` — `pnpm run check:full` + the v2-native live gates + the ACP plugin acceptance floor. It reports a **two-tier summary**:
  - **MUST tier** (release-blocking — owns the exit code; "green" applies only here): `pnpm run check:full`, `smoke-entwurf-v2-matrix-live`, `check-bridge`, `doctor-pi-provider` (#81 — `check-bridge` proves the launcher this checkout SHIPS; this proves the invocation the operator's pi provider actually EXECS, by booting it and requiring the entwurf verb set back, because `command -v` answers yes for a command that exits 127; wired as a step on 2026-08-19 after a relocated pnpm cmd-shim cost a cut sixteen LIVE steps before the same fact surfaced at `smoke-acp-bundled-mcp-live`), the resident-garden-guard zero-token half (record birth / record-keyed socket / attach-on-reopen), the `smoke-acp-*-live` ACP plugin smokes (socket-citizen / raw-turn / overlay / provider / session-reuse / carrier-augment / memory-containment / rgg / mcp / skill / bundled-mcp / v2-send), the axis wired in on 2026-07-31 that the aggregate had simply never listed (`smoke-claude-native-resume-live`), `smoke-entwurf-chain-live` — the cross-harness delivery chain (native Claude Code → pi GPT → pi ACP Sonnet → mailbox terminus) proving sender identity and replyability at every hop plus a real read receipt at the end — the integrated `smoke-mux-lifecycle-live` (its own note below), and the two OMP steps 0.16.0 wired: `smoke-omp-receive-live` (the addressed roundtrip into a live omp citizen; it reads the capability registry and decides its own outcome rather than passing by default) and `smoke-omp-fresh-live` (the clause 7 receipt the release stop now requires). (`smoke-session-id-name` is gone — #50 C3: its `--session-id`/`--name` substrate has no entwurf consumer anymore.)
  - **BEHAVIOR tier** (advisory, non-blocking): the resident-garden-guard positive (a model-in-loop `entwurf_self` turn). A BEHAVIOR FAIL is surfaced with its artifact path but **never blocks the cut**. The lane holds what the model *chooses*, never what our wiring fails to deliver — a gate that TELLS the model which tool to call stays MUST, because its failure is ours — measured 2026-07-24, when the tool turned out to be absent from the session schema in both observed failures (the bundled-MCP readiness gap recorded in `scripts/smoke-acp-v2-send-live.ts`).
  - **Every MUST step is invoked and reports its own outcome.** Prerequisite-bearing LIVE MUST steps ride the P1 STEP OUTCOME protocol (`scripts/lib/step-outcome.sh`): exit 0 = PASS, exit 97 = SKIP (a prerequisite the step does not have, printed as an `[entwurf:skip]` line), anything else = FAIL. The non-skippable static step (`pnpm run check:full`) is inline: 0 = PASS, nonzero = FAIL, no SKIP arm — it has no prerequisite to decline. A skip is never counted as a pass — that hole is what let a cortex-less host read as cortex acceptance. Without `--cut` this is the unattended diagnostic: SKIPs are reported and the run still exits 0. **`--cut` makes it acceptance and any MUST SKIP is red**, which is how "a real cut needs `LIVE=1` with `SKIP=0`" stopped being prose. A green MUST gate is **necessary, not sufficient** — GLG authorizes the cut.
  - **When cost-bearing MUST gates run (the F6/F7 lesson, 2026-07-23; timing since 2026-09-11 owned by AGENTS.md Scheduling):** a MUST-tier live gate covering a touched rail runs, and must be green, before that change lands. It is never left unrun because a human approved the change: deferring a wired gate to a human decision is what let F6/F7 ship reviewed-and-approved, and the wiring exists so the verdict never depends on who pressed enter. Where in the sequence it runs is AGENTS.md's call: interim checkpoint commits carry scoped review and focused checks with unmeasured boundaries recorded, and native/LIVE/release floors are mandatory before landing. LIVE is opt-in (AGENTS.md Verification): a model-bearing run needs the operator's go for that spend. Without it the gate stays unrun and the change does not land; a missing go blocks landing and never stands in for the gate. The 2026-07-23 wording, "before cross-review is requested", predates that sequence. "배선이 없어 못 한 것은 OK, 배선이 있는데 안 돌린 것은 우리가 남긴 구멍이다." Model-in-loop cost is spent via the subscription-backed `entwurf` provider where the gate allows it, a free-tier native model otherwise; cost is a reason to pick the cheap target, not to skip the gate.

> **The herdr rail is an on-demand axis until it has run.** `smoke-herdr-fresh-call-live` opens a real caller inside a real herdr pane, has it invoke the PUBLIC `entwurf_fresh_call`, and reads the child's nonce callback — the one axis no deterministic gate reaches, since the rail is selected from the caller's own process environment. **The release aggregate does not yet require the herdr rail**: herdr is optional (a cut on a host without it must not block), and first evidence precedes promotion — a rail whose first acceptance run is days old has not earned a place in the gate that blocks every cut. Run it directly with `LIVE=1 ./run.sh smoke-herdr-fresh-call-live` whenever a cut changes herdr rail code, and promote it to a MUST only after the axis has a run history to point at. Without `LIVE=1`, or without herdr/pi/claude on PATH, it reports protocol SKIP — never a pass.

> **The plugin's FIRST USER PATH is its own on-demand axis, and an npm acquisition receipt holds only for the ref it ran on (#118 홉 1).** Every other herdr gate proves the plugin against a source this repository controls: `check-herdr-plugin-build` drives a stub, and `smoke-herdr-plugin-build-live` redirects the product remote to a local bare clone with git `insteadOf` and asserts `identity.kind === "herdr-checkout"`. npm has been the production authority class since `dd84ac0`; the 0.30.0 follow-up re-pinned `@junghanacs/entwurf@0.30.0` with its published sha512 after the candidate windows rode `herdr-checkout` (`8b92e09`), and the 0.30.1 preparation rode that closed verification carrier again without inventing a registry integrity. The plugin snapshot `v2026.10.9-herdr.0.34.0` pinned the published `@junghanacs/entwurf@0.34.0` with its measured sha512 (#132); 0.31–0.33 were never pinned. The 0.34.1 preparation rode the closed `herdr-checkout` verification carrier again without inventing a registry integrity, and the snapshot `v2026.10.9-herdr.0.34.1` re-pins the published `@junghanacs/entwurf@0.34.1` with its measured sha512 (#135). The 0.34.2 preparation rode the same carrier, and the snapshot `v2026.10.11-herdr.0.34.2` re-pins the published `@junghanacs/entwurf@0.34.2` with its measured sha512 (#136). The source re-proof has separate dated npm rows: 2026-09-23 public `main=113ca53`, plugin 0.5.0, runtime 0.25.0 (CHANGELOG 0.25.1), and the 0.30.0 re-pin accepted at public `506c46f` in the [#126 thread](https://github.com/junghan0611/entwurf/issues/126). Neither certifies the 0.34.0 registry acquisition. That pin's real-npm swap / torn-swap recovery was measured locally on 2026-10-09 by driving the registry-shipped `scripts/herdr-runtime.mjs` (byte-equal to this checkout's) with its own npm acquisition: a 0.33.0 → 0.34.0 swap, and the same upgrade torn between its two renames then resumed, where the last-good 0.33.0 tree was restored before 0.34.0 was acquired again. Both ended `runtime-ready` at observed digest `sha256-e9d995ff…`, the accepted 0.34.0 artifact. That local receipt is recorded in the [#132 thread](https://github.com/junghan0611/entwurf/issues/132); it covers runtime recovery, not this smoke's cells. This smoke's public-ref acceptance of the 0.34.0 pin was measured locally at `--ref main`: PASS at resolved `b5d15d8` and again at the docs follow-up `8ed4d1a`, each acquiring `kind=npm @junghanacs/entwurf@0.34.0` — a main-ref receipt, not a tag-ref, native or full-Herdr claim. The 0.34.1 re-pin's npm-source rows — swap / torn-swap recovery, this smoke at a public ref, and the package consumer — are its own, recorded with that pin and never inherited from 0.34.0; checkout candidate evidence does not transfer. The 0.36.0 re-pin's public-ref row was measured on Herdr 0.9.4 at `--ref main`: PASS at resolved `9f33dd1`, acquiring `kind=npm @junghanacs/entwurf@0.36.0` at the accepted digest — a main-ref receipt, not a tag-ref claim. Its version-changing cross-ref reinstall (`herdr plugin install … --ref main` over the `v2026.10.13-herdr.0.35.1` installation) across a pinned Pi upgrade was a driver-level journey recorded in that snapshot's release notes, not a row of this smoke; `herdr plugin update` there was measured only as a same-ref already-up-to-date no-op. `LIVE=1 ./run.sh smoke-herdr-raw-install-live [--ref <REF>]` fills that row in a clean `node:24` container with no socket, config, cache or repo mounted, no `insteadOf`, the public remote spelled as a user would type it, and pi / herdr / Claude Code installed in the IMAGE BUILD as scaffolding (Hard Rule 17 — the product face begins at `herdr integration install pi`). herdr itself comes from `scripts/install-herdr-ci.sh` against `scripts/fixtures/herdr-supply.json`, so no version or digest lives here. `--ref` defaults to `main` rather than a pinned SHA because receipt (a) is defined as what a user gets today; the resolved commit is printed, so the receipt stays exact. It takes a REMOTE REF and not an arbitrary commit — measured on herdr 0.9.1, `--ref <sha>` fails as `couldn't find remote ref`, because the checkout fetches by name — so a candidate is addressed by its branch and pinned by the resolved commit the gate prints. **Its first question is a measurement, not an assumption:** herdr registers a plugin through a running server and falls back to `persist_plugin_offline` only on a connection error (`src/cli/plugin.rs:914-981,1016-1021` @ `c77af189`, 0.9.0 source), and a container has no server. The 2026-09-23 PASS installed with no server on the 0.9.1 binary `113ca53`'s `herdr-supply.json` pins, so that install path worked on 0.9.1 — inferred from the PASS, not a direct observation of the fallback branch; a later "no" on another herdr is #118 investigation output rather than a completion. `--yes` is always passed so a non-interactive exit 2 (`:189`) can never be misread as a missing server. **At a ref whose lock names `herdr-checkout` the acquisition axis reports a NAMED SKIP rather than a red, and the rest of the journey still runs.** That lock is the candidate carrier a cut legitimately sits on — 0.23.0 was tagged that way and `dd84ac0` pinned npm afterwards — so a red there would report a broken install when what is true is that the ref does not lock npm. What is asserted at BOTH lock kinds is that the runtime came from the source the ref locks, and the package name is read from the checkout manifest rather than the lock, because a `herdr-checkout` lock carries no `name` (`herdr-runtime.mjs:317-328`) and joining `undefined` throws instead of failing an assertion. **Cells [6]–[9] carry it past the install into the USE path (#118 H1-4/H1-5).** An install is not a use, so the same container then runs what those bytes became: the compiled bridge entry, the three `REQUIRED_BINS` as executables, and a real `entwurf check-bridge` printing the exact verb set the installed bridge declares (nine since 0.41.0; each earlier recorded PASS printed its own date's set, and none of them is a nine-verb LIVE receipt) — the installed-runtime row below, measured rather than inferred from the bootstrap's refusal to install without them. Then the pi that this plugin WIRED is started with no `-e` and no `--no-extensions`, because the subject is the wiring and not this checkout: one `get_state` in `--mode rpc` costs zero tokens and needs no provider argument (a bogus `--provider` exits 1 before session_start; omitting the pair lets pi resolve the default the extension itself registers), and while that session is alive the cell reads its V3 record, its gardenId-keyed control socket, and the installed `entwurf peer-facts` reporting it `alive`. The plugin's own status fan is then driven with NEITHER side stubbed, in both states a user can be in: with no herdr server it must name `herdr-agent-list-failed` and go red rather than draw an empty table, and under a headless `herdr server` — scaffolding for that second read only, stopped again before the teardown — it exits 0 and COUNTS the citizen as `unobserved` instead of dropping it. Last, the shipped `entwurf herdr-plugin-deactivate` runs from the installed bin, deletes the runtime it is executing from, and the plugin reinstalls onto the host it fully left — the deactivation row, on the npm source. **What these cells still do not close:** swap / torn-swap recovery on the npm source, the package-consumer proof, and the fan drawing a citizen as a ROW — that needs `placement.kind === "herdr-pane"`, so the pi session must live in a herdr pane a session reference joins, and a headless container has no panes. **This smoke carries no test beside behavior and no mutant**, and that is a property of its class rather than an omission: it is a real-live container journey whose oracle is the container's own end state, so there is no pure seam to assert against and nothing a source mutation could kill deterministically. Like the other two herdr LIVE lanes it is **on-demand and not an aggregate MUST** — herdr is optional, a cut on a host without it must not block, and first evidence precedes promotion. Without `LIVE=1`, or without a usable Docker daemon, it reports a named SKIP; `ENTWURF_REQUIRE_DOCKER=1` turns the Docker absence red. Neither skip is a pass.

> **The Herdr plugin's install-time build has two axes, and one of them needs the network (#116 M3-b3).** `check-herdr-plugin-build` is deterministic and rides `check:hermetic`: the listing reaches the runner through its own spawn seam (there is no fake `herdr` binary in this repo), and the one cell that drives the REAL binary reports a named SKIP on a host without it — `ENTWURF_REQUIRE_HERDR=1` makes that absence red. What it cannot have is the real acquisition: `npm pack git+https://github.com/junghan0611/entwurf.git#<full sha>` builds the bridge through `prepare`, which installs devDependencies from the registry. So `LIVE=1 ./run.sh smoke-herdr-plugin-build-live` owns that axis, and its cells are **two kinds of evidence, labelled as such**: three are the real Herdr journey — a real `herdr plugin install` driving the real `[[build]]`, with the UNCHANGED product remote redirected to a local bare clone by git `insteadOf` (the one substitution, which is what makes an unpushed candidate testable) — covering remote-commit available, the `{pi}` → `{pi, claude-code}` reinstall with OpenCode as a zero-write negative control and exactly ONE counted vendor MCP owner entry, and the post-build Herdr-commit gap (where the ledger has already rebound to the gap commit, so the honest assertion is that transition and not unchanged bytes). The fourth cell — remote-commit **unavailable** — calls the shipped runtime leaf directly with the fixed product argv and is therefore **acquisition-leaf evidence, not a journey**; routing it through Herdr would add a second explanation for one red. Its oracle is the honest one too: active runtime, ledger and harness bytes preserved, while the journal is left as the certified `installing` retry authority the transaction deliberately writes before acquiring, and a normal install afterwards is green. Its Claude cell is where the vendor question the deterministic gates refuse to claim gets answered — whether Claude Code accepts an ABSOLUTE executable as an MCP command — and it reports a named skip on a host without `claude`, never a pass. Like the herdr fresh-call rail, this smoke is **on-demand and not an aggregate MUST**. The release aggregate does not require the plugin build smoke: herdr is optional, a cut on a host without it must not block, and first evidence precedes promotion.

> **Switching the plugin's production acquisition source is a re-proof, not a configuration change (#116 M3-b3).** `runtime-lock.json` carries a closed `source` discriminant: `npm` (exact `name@version` plus the published sha512, compared against the tarball's own bytes) is the production authority, and `herdr-checkout` (the exact commit Herdr checked out, from the fixed remote) is a VERIFICATION-ONLY carrier that exists so a candidate needs no npm release. Evidence does not transfer between them. Before a release that moves the production source — to npm, or to a GitHub Release tarball plus its sha512 — the exact acquisition and integrity comparison, the installed runtime (name@version, compiled entry, three executable bins, a real `check-bridge`), the swap and torn-swap recovery, activation and deactivation, and the package-consumer proof must all be re-run against THAT source. A candidate proof green on the checkout carrier says nothing about a registry artifact, and the reverse is equally true. **Records from before this contract are refused, not migrated:** a v1 runtime journal or activation ledger fails certification by name, and the way forward on such a host is an explicit `entwurf herdr-plugin-deactivate` (or a hand-cleared runtime/ledger state) before the next install — there is no reader that accepts both schemas, because the older shape cannot say WHICH artifact it was.

> **Cortex ACP is disabled.** Retired Cortex model ids are not registered; Entwurf fresh/resume exact admission refuses them, and the ACP adapter refuses a Cortex id that reaches it before starting a child, without a Claude fallback. Pi's own direct `--model` fuzzy selection happens before the adapter; the result for a typed retired id has not been measured here. The former Cortex direct LIVE smoke now refuses by name rather than probing a vendor. Past Cortex receipts remain historical evidence, not proof of this disabled admission. The Claude and native-citizen LIVE floors, including Codex and mux, are unchanged.
>
> A cut that touches the prompt-lifecycle contract (no wall clock on a running turn) owes one long-turn acceptance the aggregate floor is too short to carry: `LIVE=1 ./run.sh smoke-acp-long-turn-live` drives a real turn whose tool work outlasts the retired 600s cutoff and requires exactly one cold ACP bootstrap in the transcript. It takes >12 minutes by construction and is on-demand, not part of `release-gate`.
>
> **The integrated mux lifecycle IS a release-gate MUST.** `LIVE=1 ./run.sh smoke-mux-lifecycle-live` enters through a real MCP `tools/call` on the shipped bridge launcher and follows one citizen the whole way. The native pi launch names `placement.tmuxSession` (#108): the harness asks tmux itself that the pane sits in a caller-distinct seat session on the same private server, that the caller's windows are unchanged, and that the close later removes only that window and leaves the seat's anchor standing. The steps are: fresh-call launch receipt, the sibling's own nonce callback whose SENDER ENVELOPE is the address, an `entwurf_v2` control-socket send that lands in the sibling's own transcript, `entwurf_resume_call` REFUSED while that citizen is live, a stable-handle close proving pane and socket gone with the record preserved, delivery to the dormant citizen refused honestly, then the public `entwurf_resume_call` — whose LAUNCH and OBSERVATION receipts stay apart — and finally an `entwurf_v2` send the resumed session answers with a fact it was told BEFORE the window closed. That last step is the point: a socket answering under the same garden id proves a process stood up at that address, and only the recall proves the same conversation came back. Both pi provider shapes are driven to it (native `openai-codex/gpt-6.1-sol:low` and recorded-ACP `entwurf/claude-sonnet-5-5`, the only shape that re-injects a bridge extension), and the Claude Code cell, whose sibling is still live at that point, has its resume refused as `target-live` with no window opened and no lock residue (the per-gid coordination lock is released). Claude Code's dormant same-id resume (#147 L2) is certified deterministically; its LIVE dormant→resume leg is not in this MUST yet. One test-owned retire→resume round trip outside this gate is recorded as dated n=1 evidence in [BASELINE](./docs/baseline-receipts.md#147-native-round-trip-2026-10-22-n1); it is not this MUST.
>
> One cell cannot be fully fenced, and that is recorded rather than glossed: the recorded-ACP pi cell runs under the operator's REAL home, because its provider spawns `claude` as a child that authenticates from there — measured, a fenced HOME kills that turn with `Authentication required` before the model is ever reached, and `CLAUDE_CONFIG_DIR` alone does not fix it. That is the same trade `smoke-acp-bundled-mcp-live` already makes. While that cell runs, its citizen's control socket and per-gid lock exist under the operator's own `~/.pi/entwurf-control` and `~/.pi/entwurf-v2-locks`; its meta store stays fixture, so no garden record is minted outside the fixture, and the run ends by proving all six real roots hold the entry sets they started with, with no fixture garden id and no leftover lock.
>
> Be honest about its cost, because it is a MUST: it spends real model turns on the operator's configured runtimes (two pi siblings, each resumed once, plus one Claude Code sibling), it READS the operator's real runtime config, and the siblings' native session transcripts stay in the real pi agent dir — they are not cleaned up, and they are part of the evidence a resume was real. The fence is per-axis rather than absolute: the four meta roots (records, mailbox, receivers, senders) are fixture for every cell, so no garden record is ever minted outside it; the native pi cell's control socket and v2 lock are fixture too; the ACP pi cell's are REAL and transient (see the paragraph above); and the Claude cell runs its runtime under the real HOME while its mailbox and meta stay fixture. The run ends by proving the operator's SIX real roots — the four meta roots plus `~/.pi/entwurf-control` and `~/.pi/entwurf-v2-locks` — hold the entry sets they started with, with no fixture garden id anywhere, and that proof now runs on the failure path as well as the green one. Missing prerequisites decline with the protocol SKIP (97), which `release-gate --cut` refuses rather than rounding up.
>
> **Fresh-call LIVE is on-demand, not part of `release-gate`.** `LIVE=1 ./run.sh smoke-mux-fresh-call-live` opens configured Pi and Claude Code siblings, spends four model turns (two in the caller's own session, two in a second SEAT session on the same private server — the #105 seat x cwd matrix), and preserves their native transcripts; run it directly whenever a cut changes mux fresh-call/launch behavior. Its private tmux servers and fixture-bound entwurf write axes make it deterministic about garden-record/socket residue, but those real native turns should not appear unexpectedly in every aggregate cut. **Both this smoke and `smoke-mux-lifecycle-live` enumerate `pi` and `claude-code` only — that exclusion is intentional.** Neither covers pi-durable same-id resume (#157 B3), and no LIVE or release gate does: its proof is the deterministic beside tests plus the local FULL/package floor, and its one public n=1 (Herdr, a pre-final candidate, synthetic callers) is a dated [BASELINE](./BASELINE.md) row, not a floor. The tmux path at the final candidate is unmeasured. Claude Code's same-id resume inside Herdr (#157 stage 4) is covered by no LIVE or release gate either: its proof is the deterministic beside tests plus the local FULL/package floor (a dated receipt, not a floor this text inherits: on 2026-11-02 the affected PARTIAL, six groups, and one frozen FULL of 1016 s passed at the stage-4 candidate, work surface `1075a5c8…` = HEAD `2734f524` plus the then-uncommitted changes; later edits leave that receipt valid for its snapshot but do not certify a later candidate, which owes its own), and its two test-owned n=1 runs on 2026-11-02 are a dated [BASELINE](./BASELINE.md) row, together with the operator vendor-data changes observed inside their windows — not a floor. A Copilot visible-fresh (step 9 clause 7) was accepted on 2026-08-25 as an operator-metered LIVE (receipts in `DELIVERY.md`'s Copilot matrix row and the issue #82 thread). It still spends Copilot premium quota, still needs its own grant to re-run, and is never folded into those loops or into the release-gate MUST tier.

> **A visible-fresh receipt outside the MUST tier is no longer the general rule — it is Copilot's preserved exception.** #87 measured what that wording permitted: because clause 7 sat outside every aggregate, a harness could be admitted as a full D6 citizen that `entwurf_fresh_call` cannot open, carry an honest "not a supported harness" sentence in the delivery matrix, and still pass the whole floor toward a cut. From OMP onward, the FIRST release of a harness admitted under the #82 contract owes its clause 7 receipt as a release-gate MUST step (`smoke-omp-fresh-live`), and the deterministic half of the same rule (`check-harness-admission-parity`, inside `check:full`) makes a citizen backend missing from `FRESH_CALL_BACKENDS` a red floor rather than a documented one. Forward-only by decision: Copilot's row is not reopened. The contract lives in `docs/adding-a-harness.md` step 9, "The release stop"; this note exists so the cost discipline above is not read as permission.
>
> agy native push is paused (#152). On the external send path entwurf measured, the agy language server refused the `agentapi` call with `Unauthenticated: missing CSRF token` (#128 on agy 1.2.16, again on agy 1.4.6). Whether a first-party own-tool shell holds a token entwurf could legitimately present is unmeasured; this pause does not claim it is impossible. So `entwurf_v2` refuses an agy target before any probe as `native-push-paused` (`observedLiveness: null`), an agy sender's `replyable` is false by name, and `entwurf_register_native` refuses before probing or minting a garden id. Existing agy records stay readable. The pause itself is proven by the deterministic `[QK:AGY-NATIVE-PUSH-PAUSED]` cell, which needs no agy conversation. Separately, an agy host's retained legacy identity surfaces can be checked by three fail-loud doctors plus a fresh-conversation identity check (birth, statusline, `entwurf_self`) after package install. While the pause holds, that check is an optional diagnostic run on request, not a cut requirement; a green one is neither send evidence nor a certification that the installed agy host works or can receive. `LIVE=1 AGY_CONVERSATION_ID=<id> ./run.sh smoke-agy-native-push-live` exits 2 with `[entwurf:paused]` before it reads the conversation id, and that is not a PASS. The deterministic paused refusal (`[QK:AGY-NATIVE-PUSH-PAUSED]`) and the install/sender gates are inside `pnpm run check:full`; do not misreport the aggregate gate as live agy evidence. **Cost fence:** the pause proof (criterion 7) needs no agy conversation, model or conversation id, and none is opened for `smoke-agy-native-push-live`. The optional retained-identity diagnostic does need one fresh agy conversation after package install; when it is asked for, open it on `gemini-3.6-flash` (free account) — never a Pro tier; entwurf never selects the model, and no assertion reads it (model display is not part of the agy contract). Lifting the pause would be a separate future change with its own positive acceptance; nothing here certifies one.
>
> Aggregate release-gate does not own a loaded Codex thread. Codex native-push remains an
> on-demand host axis. The first-admission acceptance passed on 2026-09-12 under the fixed `codex`
> home topology #95 D1 later retired; `DELIVERY.md` owns its 57-assertion receipt and digest as
> history. Re-runs follow the caller-seat topology instead: the operator-owned app-server sits in
> its own session A, the initial Pi and the Codex it opens both sit in a DIFFERENT session S, and
> the Codex-opened Pi must land in S. **A ≠ S is a precondition, not a preference** — the
> app-server's inherited `TMUX` names A, so an outbound Pi in S can only have come from the
> caller's own pane title, and the receipt must name `codex-title-anchor` as the rule that chose
> it. Exact `rust-v0.153.4` source still exposes no arbitrary request→attached-TUI-seat value, so
> placing a sibling beside a TUI whose thread nobody named stays unsupported and unclaimed.
>
> The A cell takes no inferred server or models:
> `LIVE=1 ENTWURF_CODEX_APP_SERVER_PID=<existing-app-server-pid>
> ENTWURF_CODEX_FRESH_MODEL=<codex-model>
> ENTWURF_CODEX_FRESH_PI_MODEL=<pi-model> ./run.sh smoke-codex-fresh-live`.
>
> Those three values are the step's operator-supplied prerequisite, and
> **`release-gate --cut` inherits that triple** — it is exported onto the aggregate invocation (the
> release skill's P5 carries it), never inferred by the gate, so the no-inference rule above holds
> unchanged inside the aggregate. **An ABSENT value is a protocol SKIP naming what was missing; a PRESENT but wrong one
> stays a FAIL.** That split is the honest reading of the step-outcome protocol — a step that never
> ran and a step that ran and broke are different facts — and it is what makes this MUST reproducible
> at every cut instead of inviting a standing exception: before 2026-09-23 all three were assertions, so their
> absence threw, and because the aggregate supplied none of them this step went red inside every
> cut on every host (0.25.0's candidate receipt, `MUST PASS=23 FAIL=1`, is that shape). A SKIP is
> **not** a softening: `--cut` refuses it as `cut: BLOCKED (MUST SKIP)`, so a cut without this
> receipt is still impossible — the operator supplies the triple and re-runs. A host with no Codex
> app-server therefore cannot take a cut, which is the intended cost of #87's release stop
> (「A visible-fresh receipt outside the MUST tier is no longer the general rule」above) rather than
> an accident. The installed-config preflights are deliberately NOT in that split and remain FAIL
> on absence — a missing Codex birth, user MCP/status/terminal-title config, runtime, bridge, tmux
> seat, or an unanswered launch directory is host state `setup` and the Codex doctors own, not a
> per-invocation input.
> **Both of THIS cell's live-spend defaults are `gpt-5.6-luna` from 2026-09-17**
> (`openai-codex/gpt-5.6-luna` on the pi side) — the Codex leg came down off `sol`. It is a tier
> choice and not a gate change; the receipt this cell is accepted on must be the one that actually
> ran, never a `sol` run inherited from before. This says nothing about other cells: `smoke-omp-
> fresh-live` keeps `openai-codex/gpt-5.6-sol`, the model its bootstrap callback was measured on.
>
> **This cell needs its launch directory ANSWERED, once, and that is a vendor fact rather than a
> gate setting.** Codex records a direct folder decision per exact directory on this rail, so the smoke
> launches in one stable path instead of a fresh `mkdtemp`, and it PRINTS that path as
> `launch-cwd <dir>` on every run. **Do not spell it `$TMPDIR/entwurf-codex-fresh-live`** — the
> smoke resolves it with `os.tmpdir()`, which is this host's `TMPDIR` when one is set and `/tmp`
> when it is not, so on a host with no `TMPDIR` that shell expansion names
> `/entwurf-codex-fresh-live` in the filesystem root: a different directory the vendor would ask
> about separately. Derive it exactly:
>
> ```bash
> node -e 'console.log(require("node:os").tmpdir() + "/entwurf-codex-fresh-live")'
> ```
>
> Open a plain `codex -C <that path>` once, answer the prompt, and every later run is unattended.
> Skip it and the smoke says so in its own assertion before anything is launched —
> `codex-launch-cwd-undecided` with the exact repair command, not a callback timeout twenty
> assertions later. **That precondition belongs to this gate, not to the product:** an ordinary
> `entwurf_fresh_call` only prints the same note and opens the window, because a human can answer
> the screen. Here nobody can, which is the whole reason the gate asserts it.
>
> The command name is not proof. The first leg must be a real record-backed visible Pi
> citizen in a session OTHER than the app-server's opening Codex; if a fixture or self-fetch receipt collector
> is what OPENS Codex, the gate does not satisfy the topology. A fixture that only COLLECTS
> receipts beside that real Pi leg is not the disqualifier — substituting for the leg is (see
> `docs/adding-a-harness.md`, the same wording). The receipt must separately name the initial
> Pi, app-server, fresh Codex, and outbound Pi coordinates.
>
> **Running the 37-minute qualification on a memory-pressured host.** `[측정 2026-09-16,
> thinkpad, 27 GiB]` `check-gate-qualification` took 37m37s and was killed three times by the
> HARNESS's low-memory watchdog — not by any gate, and not by the kernel OOM killer. Each kill
> left the checkout intact (the runner restores it) but discarded the run. Detaching it with
> `setsid` survived, at the cost of the harness no longer tracking it: completion raises no
> notification, so a separate waiter is needed for the signal. Record this as a host condition
> rather than a gate property — it says nothing about the candidate, and the same command on a
> less pressured host needs none of it.
>
> Authoritative per-cut counts and digests live in BASELINE/CHANGELOG, not inline
> here; embedding them in the protocol makes a correct guide stale after every cut.

### Release acceptance axes

Do not collapse source, package, fixture, and native-host evidence into one “green.”

**Remote pair (#107).** Each layer of evidence lives in its own place:

- **Deterministic.** The cells sit beside the behavior in `pi-extensions/lib/remote-pair-*.test.ts` and are found by `check-tests-beside-behavior`. Their mutants run through the narrow execution coordinate `check-remote-pair-beside` (rule 3, #149). T1 is executor-in. T2 is surface-in: the real bridge over MCP stdio, with a stand-in `ssh` on PATH that runs the other host's real `run.sh` under a separate HOME. It covers two hosts, and since #149 also three hosts whose one file carries several routes. Both are offline.
- **Installed bytes.** `./run.sh check-remote-pair-installed --tgz <abs>` is checkout-only and takes a caller-supplied candidate tarball. It installs a sandboxed copy, checks the compiled surface, and runs the T2 cells against the installed subject. It also audits that every module those processes load resolves inside the consumer prefix, with a checkout negative control. Its audit primitive is mutation-qualified as `check-remote-pair-installed-audit` inside `check:vitest`.
- **Real two-host exchange (T3).** This is opt-in operator LIVE evidence, recorded in [BASELINE](./BASELINE.md) and #107. It is not a release-gate MUST and not a fixture that needs a second machine online. A T1, T2 or installed green does not stand for it, and its record belongs to the commit it ran on; a later SHA does not inherit it. Re-run T3 when any of these change:
  - the SSH argv or quoting;
  - the receive entry's layout, stdout or exit codes;
  - the declaration schema or root resolution;
  - either host's Node or Pi.

**Native durable contact (#129, #130 carrier).** Three deterministic beside-test/mutant
coordinates in `check:contracts` split the durable contact by the file that carries each claim's QK
(#144): a carrier or native-module mutant runs its one file, the rest run four. `check-pi-durable-beside` holds the adapter, the installed
carrier/SDK-set verifier, the preflight and the owner join. `check-pi-durable-carrier` holds the
carrier's relocation grammar, resolver and maintainer emitter (its `--check` reads only the owned
in-repo source, #141; the overlay patch is retired, and `--origin <clone>` checks provenance only)
and the task footer and sandboxed children described below. `check-pi-durable-native-module` is the coordinate of
the bootstrap's explicit `--native-module` ingress
(#130 P2) with its paired `--native-module-dir` (#134). That ingress is driven through the packaged `main`'s own
seams: initialization before the TUI and the open, named refusals, the identity and directory
guards, the top-level `*.extension.mjs` filter and byte-wise order, cross-module name refusals, the
contact-first order by reference, and the bridge spawn *spec* (not the child's inheritance). In
`check-pi-durable-carrier`, the carrier's task footer (#134) is observed in ONE sandboxed child that loads the committed carrier
through its own resolver: the real carrier runtime opened and closed with no model (graph observed
for the session, `/tasks` toggling only the panel), then continued after one native background task
was committed into that session through the SDK's public `Conversation.commit` (the carrier's graph
holds that node and the badge counts it, `pending` while recovered), and the carrier TUI's badge and
`durableLayout` drawn by the published pi-tui renderer on a fake terminal across rows 1–8 × cols
1–12, count changes and resizes, against the pinned upstream screen for the zero-task case. Its
editor is a fixed stand-in: the real `CustomEditor`, overlays, emoji width and a consumer's own task
are the visible-terminal and consumer subjects. Another sandboxed child holds the active transcript the
TUI renders (#155 D1): the carrier runtime over a session seeded through the SDK's public API, through
an open with a commit between its read and its watch, appends, one commit past the window's 100, a
switch away and back, compaction-like and reset head markers, a read held across a switch, a refused
read and the close. Its oracles are the entry IDs the SDK returned and, after close, a non-participant
open's `Conversation.context().entries`; the SDK boundary is steered test-only at the Conversation
prototype the child and carrier share. The bootstrap child on the pinned set also observes `--resume`
reopening the chosen session, by what its screen shows, and cancelling to nothing (#143). Two more
sandboxed children reach the owned app's settings and prompt mapping: one drives the real bootstrap
against a loopback WebSocket Responses endpoint, whose received frames decide the forwarded transport
and its continuation and the SDK's compaction policy under those settings (the SDK's background summary beside the turn, held on the
wire while the turn answers; blocking and overflow kept, #146), each placed summary, manual ones
included, heading the screen's active transcript; the other renders the carrier prompt's skills section with no model, against a fixture
of both settings scopes, an absolute entry, a same-name pair and a wrong-base decoy.
`check-pi-runtime-version` asks the
same installed verifier (`check-pi-durable-beside`) whether this checkout resolves exactly the pinned SDK set (the native set; the PATH
host is setup's subject), and `check-pi-import-surface` asserts the carrier fence. The separate
`check-pi-durable-contact`, `check-pi-durable-send` and `check-pi-durable-receive` are
CHECKOUT-ONLY SDK/contact gates: they run the checkout's own carrier — verified first, refused by
name — and require a private compiled bridge emitted from this candidate
(`ENTWURF_PI_DURABLE_BRIDGE_ENTRY`). A missing bridge input reports SKIP 97, never PASS; a
refused carrier fails. Installed packages refuse these developer gates. Contact is
adapter-direct/harness-bypassed; send/receive exercise scripted loopback S plus actual native
harness H, not vendor V. `check-pi-durable-send` with `ENTWURF_PI_DURABLE_SEND_CELL=native-module`
runs the whole packaged `main` with the synthetic module (`test/fixtures/pi-durable-native-module/`):
its initialization lands before the host's first `@earendil-works`/`entwurf-pi-dist:` resolution
(one receipt file, observing resolve hook), and one scripted answer calls the module's tool, the
native `bash` (whose child sees the module's value) and the contact's `entwurf_self`. Their scoped
raw records, wire, native view and SQLite oracles do not certify every queue/crash window. `check-pack-install` proves the INSTALLED carrier on actual npm
consumers (Entwurf-only, aligned host, isolated global): the installed verifier, a consumer oracle
whose every resolved product file lies inside that consumer's own `node_modules` (with a
same-sandbox neighbour as the rejected control), every reachable physical SDK edge at the pinned
version and declared name, a mixed-version tree refused by name although it still imports, a
constructed depth-3 mismatch refused by the verifier and seen by the oracle, the public launch reaching the
app's own model refusal before any birth — also with one installed `--native-module` initialized
first, a reserved extension name refused before anything opens, one installed `--native-module-dir`
initializing only its top-level `*.extension.mjs` (#134) and a directory without a module refused
before anything opens — and the HOST kept a separate subject — a real pi 1.2.0
binary (below the supported range; a fixture version, not the pinned set's previous generation) beside the pinned native set is a named pi FAIL with zero Pi wiring while pi-durable still
PASSes — not native admission. The carrier's rebuild
equality is the owned source's emission (#141): the carrier claim `PI-DURABLE-CARRIER-EMIT-SOURCE-EQUAL`
on every floor, `emit-pi-durable-carrier --check` as its CLI. The emitter's exact Node is red in the CI
`check` job (`ENTWURF_REQUIRE_EMITTER_NODE=1`) and a named SKIP on a host running another Node, not
acceptance there. First-release visible fresh/callback and native
caller/target/cross-harness LIVE are owed by `smoke-pi-durable-fresh-live`, a release-gate MUST
(LIVE=1; vendor V on a real Pi and a real pi-durable host); SDK or package green does not waive it.

| Axis | Required proof | Limit |
|---|---|---|
| Source | `pnpm run check:full` in the prepared SHA's CI `check` job | Does not prove an installed consumer. Kill-power of the committed claims is not re-measured per release (#144); the release record says so and lists any earlier-candidate PARTIAL separately. |
| Packed install | `check-pack-install` | Real tarball, but checkout-visible. Every npm install it runs (the npm-managed root and second root, the four #130 pi-durable cells) and its pnpm consumer run with lifecycle scripts off (`--ignore-scripts`), so its executable, bridge and closure checks measure the tree as installed without the package's postinstall; that hook stays shipped as a registry-mode defense this gate does not exercise, and packed file modes remain the pack gate's evidence. |
| Linux artifact consumer | required `check-install-container` CI job against one preserved candidate | Fixtures prove package/oracle shape, not a real Claude lifecycle. |
| Exact release commit | the exact SHA's push run: all four required CI jobs green (the qualification body is not read, #144) | A different green SHA is not transferable evidence. |
| macOS Entwurf-only install | required `macos-install-surface` CI job at the exact release SHA | Shape-only, CERTIFIED (CI): certifies the Entwurf-only install path on macOS only — never Claude/Copilot/OMP/agy wiring, the pi rail, ACP or mux. Promoted from non-voting (`continue-on-error`) to required in 0.20.0 after its first CERTIFIED (CI) green on a GitHub Actions `macos-latest` runner (not a physical host): run 34303884286 @ `70eda03` (2026-09-09), 65s, all 10 steps success — the packed candidate installed clean, `entwurf --help` and `entwurf check-bridge` ran (the latter listing the seven `entwurf-bridge` MCP tools of that date; 0.41.0 declares nine, unmeasured on that runner), an all-harness-absent `entwurf setup` reached `result: green` across the five documented SKIP probes (`pi`/`claude`/`agy`/`copilot`/`omp`), and five checked paths (`.pi`, `settings.json`, `.gemini`, `.copilot`, `auth.json.bak`) plus a byte-identical `auth.json` proved zero harness/credential writes. A macOS runner failure now blocks every release cut, the same as any other required job. |
| Native-Windows carrier (carrier-bearing release, from 0.39.0) | one `windows-native-preview.yml` dispatch at the exact prepared SHA after its four `ci.yml` jobs are green: accepted build receipt (two byte-identical MSVC builds, exact import set), `pack` printing `present`, eight Windows addon/citizen cells on the installed tarball; that run's `win32-preview-tgz` is the release candidate, retrieved (never packed locally) with its `SHA256SUMS`, the Windows-printed install hash and the downloaded hash equal, then accepted by the Linux `check-install-container` unchanged (release skill M3w) | Experimental, shape-only, non-voting for `ci.yml`: no vendor turn, x64 runner only, named gaps in BASELINE. The four `ci.yml` jobs (incl. macOS) saw an addon-less pack, so the carrier-bearing tarball's macOS install is unmeasured. Artifacts expire after 14 days; the preserved copy is the durable one. |
| LIVE runtime | `LIVE=1 ./run.sh release-gate <scratch> --cut` plus any shipped on-demand backend axis | `--cut` enforces `SKIP=0`; a red wired gate blocks the cut. |
| Native Claude host | installed strict doctor against a new real session | Missing live join is `NOT CERTIFIED`, not a fixture PASS. |
| Native agy host | the deterministic pause cell plus the agy record, install and sender gates inside `check:full`; native push is paused (#152), so no round trip is claimed. The three doctors and a fresh-conversation identity check are an optional diagnostic, run on request | Aggregate release-gate does not own an agy conversation id. The paused LIVE smoke exits 2 `[entwurf:paused]`, not a PASS. |
| Native Codex host | caller-seat topology accepted 2026-09-16 (56 assertions, exit 0); caller-DIRECTORY axis accepted the same day (65 assertions, exit 0) | Operator-owned birth/MCP/statusline/terminal-title atoms and the on-demand four-coordinate chain are measured on Linux at Codex 0.153.4: the app-server alone in session A (`$30/@41/%45`, pid 737636), and initial Pi / omitted-placement fresh Codex / Codex-opened outbound Pi all in a different session S (`$2`, `@46`/`@47`/`@48`; `@58`/`@59`/`@61` in the lane C run); exact callbacks and addressed delivery both ways. A ≠ S is the load-bearing half — the app-server's inherited `TMUX` names A, so the outbound Pi landing in S can only have come from the caller's own pane title, and its receipt records `seat-source=codex-title-anchor`. **#95 lane C added the second axis to the same card: WHERE the sibling starts.** Hop 1 joins four authorities that cannot borrow from each other — the pane's `#{pane_current_path}`, the vendor rollout's `session_meta.cwd`, the Entwurf record and the requested scratch — and hop 1's leg requests a cwd while hop 2 requests NONE, so hop 2's directory can only come from the Codex caller's own record; both are asserted different from the app-server's live `/proc/<pid>/cwd`. 65 and 56 are different contracts, not a regression. The 2026-09-12 fixed-home chain is PAST CONTRACT (#95 D1); `DELIVERY.md` owns every receipt and digest. Placement beside a TUI whose thread nobody named is unsupported and unclaimed. |

The repo-local `entwurf-release` skill owns the `land → prepare → make → publish`
state machine. Each mode is a separate GLG authorization. A narrower host restriction may
block a mode; it never waives a release-acceptance axis below. Feature-branch CI is not a
substitute for a forbidden local/LIVE floor: keep make blocked until the named cut has the
required execution authority and evidence. Preserve one candidate
(for a carrier-bearing release, the one retrieved from the preview run, never a local
pack), accept and publish those exact bytes without repacking, and record its digest and
consumer image outside this standing protocol.

### Verifying the two capabilities a gate cannot fully judge

- **Garden-id delivery:** discover a target with `entwurf_peers`, then `entwurf_v2 fire-and-forget` — the intent axis is single-valued since the visible-first cut. It reaches a live pi target over its control socket, a deliverable self-fetch citizen through the mailbox, and a probe-alive native-push conversation by direct injection. A DORMANT in-domain citizen rejects as `dormant-fire-forget-unsupported` — delivery never wakes it; reopen it with the separate lifecycle verb `entwurf_resume_call {target}`, then dispatch again. A wrong target state is rejected, never auto-fixed and never launched into.
- **ACP continuity:** a direct `pi --provider entwurf --model claude-sonnet-5-5` turn, or the `smoke-acp-session-reuse-live` gate (process-scoped reuse + recall). Multi-turn reuse is proven by that gate, not by any v1 resume tool.
- **agy citizenship (optional diagnostic while #152 holds; run on request, not a cut requirement):** in a fresh agy conversation, the first `PreInvocation` must yield a garden id and `entwurf_self` must report `agentId=meta-session/antigravity`. While native push is paused (#152), `replyable` is `false` with a reason naming the pause, and a dispatch to that garden id returns `native-push-paused` with nothing probed or sent. A same-gid reply is not claimed. No mailbox/receiver-marker evidence counts on this rail.

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

### Choosing the affected set for an inner loop

The inner loop runs only affected gates, so the cost of that choice is a gap nobody sees until the
full floor runs. Two rules exist because both gaps were paid for on the #95 lane B candidate, with
every focused gate green at the time:

- **Mutant manifests are keyed by SUBJECT FILE, not by lane.** Edit a file and check every
  `scripts/mutants/*.json` whose `subject` names it, not only the lanes you wrote. `[측정
  2026-09-16]` renaming one local in `mcp/entwurf-bridge/src/index.ts` left
  `FRESHCALL-CODEX-PREMUTATION-MCP` in a manifest the lane never touched; qualification reported
  it `MUTANT-STALE` (find matched 0×). **A stale mutant is a claim nobody is testing** — its
  assertion keeps passing while the mutation that gives it meaning is never applied — which is why
  this is a red rather than a warning. `check-gate-manifests` also reads each subject and
  validates the joined `find` exactly once (`[QK:MUTANT-FIND-MATCHES-SUBJECT]`): #127's moved
  reuse-catch anchor was caught by this HEAD. It executes zero committed mutants. Only the
  qualification body proves that a matching corruption is killed at its claimed signature.
- **Any `mcp/entwurf-bridge/src/**` edit owes `pnpm run build-bridge` plus
  `./run.sh check-bridge-delivery` in the same inner loop.** `[측정 2026-09-16]` the same candidate
  reached `check:full` with a stale compiled entry and failed in 22 seconds on "artifact is not
  stale". The installed surfaces run compiled JS (Hard Rule 11), so an un-rebuilt `dist` means the
  focused gates proved the source while every package-shaped gate still judged the previous build.

---

## 1. Setup

> **An agent session never runs this section.** Install, re-install, takeover and uninstall rewrite operator-owned registration, so they are an operator action in a human shutdown window. On a host whose user scope another root already owns, a re-run `setup` is a zero-write refusal, not a repair; the owner-specific path, including `takeover-user-scope` and a Herdr developer checkout, is [setup-clean-host §1.1](./docs/setup-clean-host.md#11-user-scope-ownership-one-shared-registration-one-recorded-owner). An agent verifying an installed host reads doctors (§1B.2) and stops at "this looks broken", reporting instead of repairing.

**One install command to remember: `./run.sh setup <project>`.** It is idempotent: on a host whose registration this checkout owns, the operator re-runs the exact same command when something looks wrong. There is no second install surface to juggle: from a clone `setup` runs the whole floor in order.

1. `pnpm install` — installs the pinned development dependencies and builds the bridge (source-checkout bootstrap only; an installed package never runs npm/pnpm inside `node_modules`)
2. pi wiring → `<project>/.pi/settings.json` + user-scope registration — only when a `pi` inside the supported range (`>=1.5.2 <1.6`) is on PATH; absent pi is an explicit zero-state SKIP, a below-floor pi is a detected FAIL. The user-scope entry is owner-recorded (#86 C2): another root's live-or-missing ownership makes this step a zero-write refusal (setup: pi FAIL) that names `takeover-user-scope`; the install-states bind the exact managed settings path (a drifted/symlinked/corrupt target is a zero-write refusal) and the inverse removes only the recorded owner's exact entry; `doctor-pi-package` reports the verdict
3. Claude meta-bridge global plugin — only when `claude` is on PATH; otherwise skipped cleanly
4. source stable-bin exposure — including certified `entwurf` → this checkout's `run.sh`, the managed runtime Copilot fresh resolves; helper units are attempted independently and a foreign helper is a named FAIL
5. agy bridge + exact permission + statusline + `PreInvocation` hook — only when `agy` is on PATH; each adapter is idempotent and independently doctorable
6. Copilot four-unit composition (birth → MCP → receiver → visible footer) — only when `copilot` is on PATH (#86 C3b); the units run independently, each keeps its package-owned install-state and inverse, and a failed unit is a named component FAIL. The explicit `install-copilot-*`/`uninstall-copilot-*` surfaces remain the per-unit repair and inverse path
7. Codex composition — only when `codex` is on PATH: setup publishes all four operator-owned atoms (birth, MCP, status line, terminal title) and stays non-green until the vendor's trust receipt for the birth declaration exists; it never invokes sudo, never writes `[hooks.state]`, and never starts or seats the app-server. Its setup cells prove the exact `env_vars` boundary, independent component outcomes, idempotence, the non-green-until-trusted verdict with its named operator repair, and that setup never writes the receipt itself. First-admission qualification follows the separate caller-seat LIVE; unrestricted attached-TUI placement is outside the claim.
8. `entwurf-bridge` install smoke (`validate_entwurf_bridge`)
9. computed summary — per-component PASS/SKIP/FAIL; any detected-integration FAIL makes the whole command exit nonzero while valid components stay installed

```bash
git clone https://github.com/junghan0611/entwurf /path/to/entwurf && cd $_
./run.sh setup /path/to/consumer-project
# the owner of this registration may re-run the SAME command to repair it (§1 note above)
```

Expected tail on a fully green host: `DONE: entwurf setup — result: green (computed from the component outcomes above).` The summary above it lists every component as PASS/SKIP/FAIL; a detected harness that could not be completed is named FAIL and the command exits nonzero (`result: NON-GREEN (FAIL: …)`) while every valid component stays installed — re-running the same `setup` is the repair action. On a host with `claude`, verify `./run.sh doctor-meta-bridge`. On a host with `agy`, verify all three: `doctor-agy-bridge`, `doctor-agy-statusline`, and `doctor-agy-hooks`. After adding a backend to `META_BACKENDS`, re-run the sibling install then the doctor — a green checkout with a stale deployed plugin is a silent write-stop on that rail. Each harness doctor remains the fail-loud per-leaf acceptance surface.

The wiring / meta-bridge / smoke steps are internal building blocks of `setup` (`install_local_package`, `scripts/meta-bridge-install.sh`, `validate_entwurf_bridge`) — call `setup`, never the parts. Consumers who `npm install @junghanacs/entwurf` get the obvious npm surface; that path is not the developer concern here.

Installation portability and rail certification are separate axes (Hard Rule 17).
A harness-absent `setup` on the macOS CI runner reaching `result: green` is
CERTIFIED (CI) for the Entwurf-only install surface only. On a platform that is
not certified, a detected harness is named non-green (FAIL) whose wording is
not an install failure: the wiring WAS written, but the rail is NOT CERTIFIED —
pending physical host. That FAIL is the honest setup verdict, not a skip.

WSL2: a separate experimental workflow (`.github/workflows/wsl2-install-surface.yml`)
measures the Entwurf-only install and a zero-token Pi citizen inside a real WSL2 guest on
a GitHub-hosted Windows runner. The release oracle does not read it
(`verify-exact-ci.sh` selects only `ci.yml` runs), so it is not a release axis and a red
there blocks no cut. It runs when that workflow file changes on main, or by manual
dispatch. Recorded in [BASELINE.md](./BASELINE.md).

### 1.1 Variables (optional)

```bash
export REPO_DIR=/path/to/entwurf
export PROJECT_DIR=/path/to/consumer-project
cd "$REPO_DIR" && ./run.sh setup "$PROJECT_DIR"
```

### 1.2 Live acceptance (optional)

Put `PWD` in scratch so session artifacts do not land in the repo. LIVE gates inherit
the caller's environment: a pi or ACP session exports `PI_SESSION_ID` / `PI_AGENT_ID` /
`CLAUDE_CONFIG_DIR` into every child, which masquerades as the smoke's identity or
strips Claude hooks (`hooks: {}` overlay). Strip those carriers:

```bash
cd /path/to/scratch
env -u CLAUDE_CONFIG_DIR -u PI_SESSION_ID -u PI_AGENT_ID \
  LIVE=1 /path/to/entwurf/run.sh release-gate /path/to/scratch --cut
pi --provider entwurf --model claude-sonnet-5-5 -p "reply with ok only"   # one-turn smoke
```

The one-turn smoke is a **provider**-surface check (auth + model routing + a real
turn). It does not make that session addressable: without `--entwurf-control`
there is no routable control socket, so `PI_SESSION_ID` stays unset by design and
a bundled `entwurf_self` / `entwurf_v2` call fails loud. Garden citizenship and
addressable sends require `--entwurf-control` (measured 2026-07-24: the same
one-shot with that flag returns its own gid and delivers `entwurf_v2` to a peer
mailbox with `origin=pi-session`, `replyable=true`).

`setup` requires Node 24 and Python 3 (pnpm only on a source checkout — the dependency bootstrap is source-only, and installed mode needs no pnpm); harnesses including pi are optional-by-presence (absent → explicit zero-state SKIP, detected incomplete/below-floor → named FAIL + nonzero result). On a source checkout it runs the frozen `pnpm install` + presence-gated pi project/user wiring + detected Claude wiring + source stable-bin exposure + detected agy wiring + detected Copilot four-unit composition + the v2 install smoke. A green setup certifies that the source-owned `entwurf` symlink targets this checkout and wins PATH resolution; helper units are attempted independently and a foreign helper is a named bins FAIL (nonzero), with harness-specific doctors keeping the per-leaf verdict. A detected `copilot` composes all four native units (birth → MCP → receiver → visible footer) with independent per-unit verdicts (#86 C3b); setup does **not** replace any native-harness doctor. The full aggregate live floor is still `LIVE=1 ./run.sh release-gate <scratch> --cut` — without `--cut` it is a diagnostic pass, not acceptance — with agy accepted separately under criterion 7: its paused native push by the deterministic `[QK:AGY-NATIVE-PUSH-PAUSED]` cell and its record, install and sender gates, all inside `check:full`; the retained legacy identity check is an optional diagnostic while #152 holds, and no agy round trip is claimed.

### 1.4 Cross-install / cross-backend parity (optional, high-value)

Compare a fresh self-awareness report across axes: (1) same backend, different install path — answer must be path-invariant; (2) same backend, different machine — identical native tool list + MCP server/tool set; (3) different backend, same bridge — same garden capability but **different** native tool surface (a Claude session reporting another backend's native tools is a fail); (4) native pi routing vs ACP-bridged, same model — the native pi citizen reaches the compiled `entwurf-bridge` through Pi's built-in MCP (`mcp__entwurf_bridge__<verb>`, seven active tools and two hidden in the 0.41.0 source; installed/live offering requires its own receipt), while the ACP backend reaches that bridge through the explicit `entwurfProvider.mcpServers` projection in its own callable dialect (see §2.1). Compare the actual ingress provenance and backend-native tools, not an assumed absence of MCP on pi; receive to the pi citizen remains its record-addressed control address (a Unix socket; a named pipe on the experimental native-Windows Pi preview). Honest "I cannot tell" hedging is preferable to inventing provenance. This is the current #125 comparison criterion, not a newly measured parity receipt. agy is graded by its native-citizen checklist, not by pretending it has an ACP overlay.

Cortex ACP is disabled and is not a subject of this parity check.

---

## 3. Pass criteria — current release floor

The minimum passing bar:

1. **Deterministic floor green:** `pnpm run check:full` passes (the core tier plus the hermetic-integration and package/install tiers, incl. `check-pack`), in the exact-SHA CI push run of the same prepared candidate (criterion 2's run). The qualification body is not a criterion (#144).
2. **All four required CI jobs green on the exact release commit:** `check`, `install-surface`, the required Linux `artifact-consumer`, and `macos-install-surface` — promoted from non-voting to required in 0.20.0 (see the release acceptance axes table above for what its green run does and does not certify); preserve the Linux artifact-consumer's tarball digest and image identity. For a carrier-bearing release those CI tarballs are addon-less and are NOT the release candidate: the exact release bytes are the M3w-retrieved preview tarball, accepted separately by the eight Windows cells and the Linux container (axes row "Native-Windows carrier"). The four-job floor, macOS included, is unchanged. A macOS runner failure now blocks the cut like any other required job.
3. **Live floor MUST green:** `LIVE=1 ./run.sh release-gate <dir> --cut` exits 0 reporting `MUST PASS=N FAIL=0 SKIP=0`; with `--cut` a single SKIP is red, so the exit code itself now carries this condition. A BEHAVIOR FAIL is advisory, not blocking.
4. **Native-host doctor green where the Claude meta-bridge is claimed:** a new post-install Claude session exists, live evidence is present, and the installed `doctor-meta-bridge` exits 0. `NOT CERTIFIED` is a release failure for that host, not a skip.
5. **Honest self-recognition:** the bridged model identifies its actual harness/backend, lists exactly the MCP servers its session schema carries — on the operator's default configuration that is `entwurf-bridge` — with the verbs its loaded bridge actually lists, counted from that schema (the standalone bridge lists nine; a native pi citizen offers seven with two hidden and the pi-durable contact eight, but those are other rails' counts and the ACP projection's own count is measured, not assumed), and presents a backend-native (not normalized) tool surface.
6. **Carrier separation honored:** engraving vs pi-context-augment kept distinct (§1A.0); no bridge-identity narrative attributed to the engraving carrier.
7. **agy native push paused (#152); acceptance is deterministic while the pause holds.** Required for a cut: a dispatch to an agy target returns `native-push-paused` with zero probe, send, adapter or record activity, an agy sender's `replyable` is false by name, and `entwurf_register_native` refuses before probing — proven by the deterministic `[QK:AGY-NATIVE-PUSH-PAUSED]` cell, which needs no agy conversation and is not a live round trip — and the agy record schema and reader stay in place, with the agy install and sender gates green inside `check:full`. A same-gid reply is not claimed while the pause holds. Not required for a cut: the retained legacy identity check (all three agy doctors, plus automatic birth/statusline/sender identity in a fresh conversation, where `agentId=meta-session/antigravity` is correct and model display is not part of it). It is an optional diagnostic run when explicitly asked, it is not send evidence, and a release does not claim that the installed agy host is certified or can receive. An optional diagnostic is not a cut requirement, and neither is a native-push PASS. Lifting the pause needs a separate future change with its own positive acceptance. Same-pid concurrent conversation invocation is not claimed.
8. **Codex caller-seat topology accepted:** its birth/MCP/status-line/terminal-title doctors are green and the on-demand real visible `Pi → Codex → Pi` cell records four coordinates: the operator-owned app-server in its own session A; initial Pi, omitted-placement fresh Codex, and Codex-opened outbound Pi all in a DIFFERENT session S; exact callbacks and addressed delivery succeed both ways. A ≠ S is a precondition, not a preference — the app-server's inherited environment names A, so an outbound Pi in S can only have come from the caller's own pane title, and the receipt must name `codex-title-anchor` as the rule that chose it. 0 or 2+ matching panes, and a caller whose `[tui].terminal_title` lacks `thread-id`, reject without mutation. Entwurf neither creates nor supervises the app-server, infers attached-TUI panes, nor claims placement beside a TUI whose thread nobody named. (The 2026-09-12 fixed-`codex`-home acceptance this condition replaced stays recorded in `DELIVERY.md` as history; #95 D1 retired that room.) Codex remains outside ACP and has no resume claim.
9. **Boundary preservation across backends/machines:** for every shipped or explicitly probed backend, regardless of install path or host, no cross-backend tool-surface contamination and no confabulation about pi internals.
10. **Hygiene:** no orphan ACP children; no unexpected persisted session garbage (a turn-scoped `cwd:` fallback is never a persisted reuse).
11. **New-harness admission closed:** a release that introduces a native harness admitted under the #82 contract has that harness in `FRESH_CALL_BACKENDS` on all three public surfaces, with `check-harness-admission-parity` green and its clause 7 visible-fresh LIVE step green in the MUST tier. That release also owes the cross-harness leg the same release stop names — two dispatch receipts, an existing citizen's live turn delivered into the new citizen and the new citizen's live turn delivered into an existing one — recorded in `DELIVERY.md`; its deterministic half is an owed follow-up, so until that gate lands this half of the condition is prose and is judged by the recorded receipts. Partial evidence is a branch state; an `unsupported` note in `DELIVERY.md` never weakens this stop.

Passing establishes a **release verification floor**, not an 8-hour/day operational guarantee. The floor says: gates hold, the agent honestly recognizes its environment, no tool surface is normalized away, no identity leaks, no orphans. It does **not** say a real-day workload (50–100+ turns, tool bursts, partial MCP failures, auth/version drift) survives — that needs L3–L5 evidence (appendix).

---

## Appendix — troubleshooting & history

### Troubleshooting hooks

- **ACP turn evidence.** The ACP path writes no `[entwurf:*]` stderr markers, and `ENTWURF_CHILD_STDERR_LOG` is not an ACP observation surface (its mirror in `pi-extensions/lib/entwurf-core.ts` belongs to the retired child-pi spawn and has no caller). Read three things instead: the lifecycle notices the backend writes into the assistant text (`[acp: preparing …]` / `[acp: reusing live session]`), the turn's typed `stopReason` (an ACP `cancelled` ending maps to `aborted`, `pi-extensions/lib/acp/backend.ts:865-866`), and the identity (pid + starttime) of the launcher and of any process the turn started.
- **Retired dedicated smokes, live code invariants** (manual/troubleshooting only — *not* part of the release floor):
  - *ACP-boundary model guard* — a session using the `entwurf` provider keeps its starting model: `pi-extensions/model-lock.ts` reverts set/cycle transitions touching that provider (native-to-native switching is free). This is an after-event revert, not a transcript-clean refusal. Separately, `session-store.ts` `SessionModelLockedError` refuses a persisted-record model mismatch at `decideBootstrap`. Gate: `check-model-lock` (core tier); the dedicated live `smoke-model-switch` was retired in v2. This is not a lifetime model pin on every garden citizen.
  - *Cancel / abort cleanup* — an abort sends ACP `session/cancel` and lets the agent end its own turn (`awaitAcpPromptTurn` in `pi-extensions/lib/acp/backend.ts`); process-group teardown follows only after a bounded grace. A reuse turn the agent closed on `session/cancel` keeps its live session; a cancelled first turn, an escalation or a pre-prompt abort drops it, so the next turn bootstraps a new one (the "What an abort leaves" row in Gate pointers, §1B.7). Dedicated `smoke-cancel` retired; invariant in code.

### Evidence preservation when a problem occurs

```bash
pgrep -af 'claude-agent-acp|codex-acp' || true
ls ~/.pi/agent/cache/entwurf/sessions/ | tail   # persisted pi:<sessionId> mappings (docs/setup-clean-host.md "Session reuse and compaction"); names only, never other sessions' bodies
ls ~/.pi/agent/sessions/--*--/*_${SESSION_ID}.jsonl 2>/dev/null
# ACP: the turn's lifecycle notices and stopReason live in that pi session file
```

Also preserve: the exact calls used, full stdout/stderr, the session's own pi transcript path, cache-directory changes, and the expected-vs-actual difference.

### History (pointer)

The 48-assertion / MUST 24/0/0 / 475/475 numbers the old surface banner carried are the 0.21.0 cut's dated receipt, kept in [BASELINE.md](./BASELINE.md)'s Native Codex Linux home-topology row. A later candidate's acceptance is its own receipt in BASELINE/CHANGELOG. Retired v1 verbs and bridge implementations belong only in CHANGELOG/git.


The full R2R run history (2026-04-27 → 2026-05-29, pi-shell-acp era), the per-claim evidence ledger (load-bearing claims with level-reached / blind spot / next test, maintained through 0.5.x–0.8.x), and the experimental L3–L5 tracks (4-cell verifier×subject matrix with on-disk corroboration; long-haul soak; direct-native parity panel) live in **CHANGELOG.md and git history**. Evidence reached **L2** (cross-vendor + reverse-direction MCP calls); L3 is partially exercised by the process/session-file checks above; the honest gap is **L3 → L5**. The most recent recorded floor baseline is in [BASELINE.md](./BASELINE.md)'s HISTORY section.
