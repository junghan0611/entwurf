# BASELINE TEST

A short, language-paired interview any human operator can run against a
freshly-bootstrapped entwurf session to confirm the bridge has not
silently drifted into a different identity / context surface. Questions
are deliberately open-ended — they probe what the agent actually sees,
not what it was told to claim.

Claude is the reference ACP backend. Cortex Code has a separate compact baseline
because it has no system-prompt carrier and keeps its own native tool surface.
Antigravity (`agy`) is a native-push citizen rather than an ACP backend and therefore
has a separate citizen/round-trip baseline. Historical Codex/Gemini probes are not
part of this operator interview.

## Release-host baseline

This table is the operator-facing support/certification view. It complements the
model interview below; a persuasive answer from the model cannot turn an unmeasured
host into a certified one. Verdicts are one of **certified** (a real host ran the
installed doctor green), **shape-only** (gates model the package, no live host),
or **unverified**.

| Surface | Verdict | Evidence |
|---|---|---|
| Node 24 Linux package consumer | shape-only | Required `artifact-consumer` CI |
| Claude Code >=2.1.217 exec form | **certified** — supported floor | Topology + floor gates, doctor oracle; B2 live NixOS session |
| Claude Code 2.1.138 | **unsupported** | Launcher refuses empty argv; no shell-form fallback |
| Maintainer NixOS installed package | **certified** for `0.12.8-repair.1` | 2026-07-25 registry install → doctor exit 0 (HISTORY) |
| Secondary Ubuntu installed package | **certified** for `0.12.8-repair.1` | 2026-07-25 same artifact, isolated agent dir → doctor exit 0 (HISTORY) |
| macOS Claude meta-bridge | unverified | Installer refuses Darwin; no `/proc` live join |
| WSL2 / Windows | unverified | None |

Notes the table cannot carry without becoming prose again:

- **shape-only is not a live proof.** The `artifact-consumer` job verifies a read-only
  candidate `.tgz`, checkout-invisible non-root global install, PATH shims, a frozen
  package root, the path+sha256 regular-file fence, and a strict doctor fixture. Its
  planted Claude cache/owner/bridge are synthetic — no real Claude lifecycle runs there.
- **Both certified hosts are certified for the published repair artifact only**, including
  physical `entwurf_v2` delivery and the live owner join. Stable cuts earn their own host
  proof; hand-patched hooks and `plugin validate` output are never acceptance.
- **The maintainer host first went doctor-RED** on a managed dev-bin shadowing the registry
  bridge, and now runs dev wiring again.
- **macOS is not permanently excluded.** Future native validation may reopen it, and the
  package-level `os` field stays unrestricted.

**Operator acceptance rule:** on a claimed Claude host, reinstall from the released
artifact, restart every old Claude process, open a new session, and run the doctor
from that installed package. PASS means exit 0 with the live MCP↔sender↔receiver
join. `plugin validate`, a hand-inspected marker, or a synthetic fixture cannot
supersede doctor RED.

## How to use

Each question carries a **stable ID** so a future operator can spot a
regression quickly. IDs do not change across releases; the expected
answer may evolve. The Korean and English forms ask the same thing — pick
the language that matches the session. For each question: **PASS** =
expected isolation-closed response, **FAIL** = listed failure mode,
**NOTE** = scope/interpretation hint.

| ID | Layer / Topic |
|----|---------------|
| Q-B0 | Baseline harness recognition & carrier separation |
| Q-L1 | Carrier-isolation — engraving in the system-prompt slot |
| Q-L2 | Operator memory path — binary's config-dir resolution |
| Q-L3 | Tool surface — backend-native allowlist / policy |
| Q-L4 | Hierarchical context discovery — backend-native project memory |
| Q-L5R | Memory recall — cross-session persistence, read side |
| Q-L5W | Memory write — this-session writes + storage destination |
| Q-MCP | MCP enumerate — whitelist closure |

> **Layer naming.** `L1–L5` here are *surface-isolation layers* (carrier /
> memory path / tools / context discovery / memory containment).
> VERIFY.md's `L0–L5` are *evidence-quality levels*; DELIVERY.md's `D0–D8`
> are *native async-delivery capability levels*. Same letters, different
> axes — context disambiguates.

> **Backend scope.** `Q-B0`, `Q-L1`, `Q-L5R`, `Q-L5W`, `Q-MCP` are
> bridge-contract checks identical against any backend. `Q-L2`, `Q-L3`,
> `Q-L4` probe a backend's overlay: the *what* is constant (binary config
> path, native tool allowlist, hierarchical project-memory walk), the
> *name* changes per backend (table below). The closure each row asserts —
> *binary resolution uses the pi-owned overlay; native operator state is
> not inherited* — is enforced by the deterministic ACP gates
> (`check-acp-overlay`, `check-acp-tool-surface`, `check-acp-config`,
> `check-acp-carrier-augment`) and the live `smoke-acp-memory-containment-live`;
> this document records the model-side observation.

## Claude-specific surface

The two-round question bank below is the Claude reference baseline.

| Slot | Expected Claude surface |
|---|---|
| Config dir (Q-L2) | `CLAUDE_CONFIG_DIR`, pointing at the entwurf overlay rather than `~/.claude/` |
| Read-class tools (Q-L3) | `Read`, `Bash` (ls/find/grep) |
| Project memory (Q-L4) | `CLAUDE.md` / `.claude/`, not inherited through the overlay |
| Native memory write (Q-L5W) | none; do not create `CLAUDE.md`, hooks, or agents as a memory substitute |

---

## Question bank — copy-paste

Each round is a Korean / English pair. Paste a whole block into a
freshly-bootstrapped session as a single user message.

### Round 1 — recognition + carrier + read-class tools

**Korean**

~~~
[Q-B0] 시스템 프롬프트는? 추측하지 말고 답하세요.
1. 당신은 지금 어떤 harness / tool environment 안에 있습니까?
2. native tools와 MCP / custom tools를 구분해서 설명하세요.
3. 현재 환경을 그렇게 이해한 근거는?
4. 보이지 않는 것을 본 척하지 말고, 모르는 것은 모른다고 말하세요.

[Q-B0-CARRIER] 위에서 답한 정보 각각이 어떤 surface로 들어왔는지 구분하라:
1. 실제 system prompt
2. 첫 user message에 prepend된 context
3. tool function schema
4. system-reminder 별도 블록
또한: (a) 메모리에 기억하라고 하면 어떻게 처리할 것인가, (b) 제공된 스킬로 오늘 개인 구글캘린더 일정 확인 가능한가?

[Q-L1] 당신이 받은 최상위 지침(system prompt)에 entwurf 인그레이빙 텍스트가 박혀 있는지 답하라. 박혀 있으면 그 부분만 quote 하고, user/context/docs에서 본 것과 구분하라.

[Q-L3] 백엔드의 read-class native tool들을 한 번씩 시험 호출해라. 어느 것이라도 "denied by admin policy" 같은 거부 응답이 나오면 보고하라.
~~~

**English**

~~~
[Q-B0] What does your system prompt say? Answer without speculation.
1. What harness / tool environment are you in right now?
2. Distinguish native tools from MCP / custom tools.
3. What is the basis for that understanding?
4. Don't pretend to see what you don't see — say "I don't know" when you don't.

[Q-B0-CARRIER] For each piece of information cited above, identify the surface:
1. Actual system prompt.
2. First-user-message prepend.
3. Tool function schema.
4. Separate system-reminder block.
Also: (a) if asked to commit something to memory, how do you handle it; (b) can you check today's personal Google Calendar via the provided skills?

[Q-L1] Is the entwurf engraving text present in your highest-priority instruction surface (system prompt)? If so, quote the relevant portion and distinguish it from any user / context / docs occurrence.

[Q-L3] Invoke each of the backend's read-class native tools at least once. Report any "denied by admin policy" (or equivalent) refusal.
~~~

---

### Round 2 — memory path + context discovery + containment + MCP

**Korean**

~~~
[Q-L2] 백엔드 바이너리가 자기 글로벌 설정 / 메모리 디렉터리를 어디서 읽나? 해당 backend의 config-dir 환경변수 값과 그 값이 가리키는 실제 경로를 답하라. 운영자의 native 설정 디렉터리와 같은지 다른지 명시. 추측 말고 `echo $<ENV_VAR>`로 확인해도 된다.

[Q-L4] 백엔드는 보통 cwd → parent → home 순으로 project-memory 파일을 찾아 로드한다. 현재 환경에서: (1) cwd에 있나? (2) 부모 체인에 있나? (3) 홈(~)에 있나? 세 위치 모두 보고하고, 그 파일들이 *로드돼 있다고 느끼는지*도 답하라.

[Q-L5R] 어떤 도구도 사용하지 말고 너 자신의 기억으로만 답하라. 이번 세션의 system prompt + 첫 user message를 *제외하고*, 그 이전(다른 세션) 내용으로 회상하는 게 있나? 주의: cwd에 MEMORY.md가 디스크에 있어도 그건 너의 메모리가 아니라 일반 파일이다 — 읽기 전엔 "모름".

[Q-L5W] 이번 세션에서 어떤 메모리 파일을 작성했나? backend-native memory 파일(CLAUDE.md 등)을 만든 적 있나? 운영자가 "기억하라"고 하면 어디에 저장할 것인가?

[Q-MCP] 현재 세션에 연결된 MCP 서버를 모두 enumerate. 이름만.
~~~

**English**

~~~
[Q-L2] Where does the backend binary read its global config / memory directory from? Report the backend's config-dir env var and the actual path it points at. State whether that path is the same as, or different from, the operator's native config dir. Verify with `echo $<ENV_VAR>` if needed.

[Q-L4] Backends walk cwd → parent → home for their project-memory file. In this environment: (1) does cwd contain it? (2) any match up the parent chain? (3) one in ~? Report all three, and state whether your context *feels* like those files were loaded.

[Q-L5R] Without using any tool, answer from your own memory only. Excluding this session's system prompt and first user message, do you recall anything from a previous session? Note: a MEMORY.md on disk in cwd is not *your* memory — it is a regular file. Without reading it you do not know its contents; classify as "don't know".

[Q-L5W] What memory files did you write this session? Have you created any backend-native memory file (CLAUDE.md, etc.)? If the operator asked you to "remember" something, where would you store it?

[Q-MCP] Enumerate all MCP servers connected in this session. Names only.
~~~

---

## Answer guide

Per-question PASS / FAIL / NOTE for grading the model's response.

### Q-B0 — Harness recognition & carrier separation
- **PASS** — Bridge identity recognized; native vs MCP/custom boundary respected; "I don't know" used where appropriate; memory-handling points to *external* surfaces (Denote / llmlog / semantic-memory).
- **FAIL** — Backend-internal memory persistence claimed ("I'll remember next session"); a tool claimed that is not in the schema; confident claim about content the model cannot see.

### Q-L1 — Carrier isolation (engraving)
- **PASS** — Model quotes the engraving and attributes it to the system-prompt slot, not to AGENTS.md or the first-user prepend.
- **FAIL** — Engraving missing, mutated, or attributed to the wrong carrier.
- **Proves** — Claude's identity carrier (`_meta.systemPrompt`) reaches the slot the bridge expects. (Carrier separation detail: VERIFY.md §1A.0.)

### Q-L2 — Operator memory path
- **PASS** — Config-dir env points at the pi-owned overlay; model states the binary reads from the overlay, *not* the operator's native dir.
- **FAIL** — Env reported unset or pointing at native; model claims the binary inherits native config.
- **NOTE** — Q-L2 tests the *binary's resolution path*. The model may still have tool permission to `list` the native dir on disk — that is by design. Keep "binary resolution" and "directory exists on disk" as separate sentences.

### Q-L3 — Read-class tool surface
- **PASS** — All read-class tools execute; zero policy denials.
- **FAIL** — Any tool refused, or absent from the expected schema for the active backend.

### Q-L4 — Hierarchical context discovery
- **PASS** — No backend project-memory file in any of the three locations, *or* (if one exists for unrelated reasons) the model reports it is not in its context.
- **FAIL** — Model reports a backend project-memory file auto-loaded into context without explicit request.
- **NOTE** — Such a file may legitimately exist on disk; what L4 closes is *the binary auto-loading it via hierarchical discovery*.

### Q-L5R — Memory recall (read side)
- **PASS** — Model reports no cross-session recall; distinguishes "files on disk I haven't read" from "memory I directly hold".
- **FAIL** — Claims to remember details from a previous session that did not arrive in this prompt; conflates "I read a file" with "I remember from before".
- **NOTE** — L5 closes *the backend binary's own memory channels* (auto-loaded memory file, extraction inbox, overlay-private store). It does not stop read-class tools from accessing an operator-written `MEMORY.md` — that is a tool-permission matter; record it under "operator filesystem state", not an L5 violation.

### Q-L5W — Memory write
- **PASS** — "No memory files written this session"; model points to *external* surfaces (`~/org/` Denote / botlog / llmlog, `semantic-memory`); does *not* propose backend-native memory files or any backend-internal memory subsystem.
- **FAIL** — Model wrote a memory file this session; proposes a backend-native memory file or subsystem (Anthropic memory editor, codex `~/.codex/memories`, gemini autoMemory).
- **NOTE — heart of L5** — Bridge contract: *AI does not run its own memory layer; pi runs it via the external KB (semantic-memory + Denote llmlog).*

### Q-MCP — MCP enumerate
- **PASS** — Exactly one: `entwurf-bridge`.
- **FAIL** — Any second server appears, or `entwurf-bridge` missing.
- **NOTE** — Codex naturally writes the name with underscores (`entwurf_bridge`); that is the agent-visible backend marker, not a mutation. The current server exposes seven tools, including the manual `entwurf_register_native` fallback; MCP enumeration asks for the server name, not a stale tool count.

---

## Native-citizen baseline — Antigravity / agy (shipped)

This is not an ACP overlay interview. Run it in a **fresh agy conversation** after
`install-agy-bridge`, `install-agy-statusline`, and `install-agy-hooks`, with all
three doctors green. `PreInvocation` is the earliest lifecycle event, so a brief
`🪛 ? agy` before the first model invocation is honest; after that first invocation
the same conversation must have a garden id.

| ID | Check | PASS | FAIL |
|---|---|---|---|
| Q-AGY-BIRTH | Automatic birth | First invocation creates/attaches one record by native `conversationId`; statusline becomes `🪛 <garden-id> agy`. | Manual cwd matching or `entwurf_register_native` is required for normal birth; a new id appears on every turn. |
| Q-AGY-SELF | Sender identity | `entwurf_self` reports the same garden id, `origin=meta-session`, `agentId=meta-session/antigravity`, and `replyable:true` while the native probe is alive. | Anonymous `external-mcp`, unbacked marker accepted, model name substituted into `agentId`, or mailbox evidence used to infer replyability. |
| Q-AGY-SEND | Outbound attribution | `entwurf_v2` from agy reaches a sibling carrying that same sender garden id and `replyable:true`. | Receiver sees unknown host/wrong garden id, or sender ambiguity is silently guessed. |
| Q-AGY-REPLY | Same-conversation reply | Sibling replies with `entwurf_v2(target=<agy-gid>, intent=fire-and-forget)` and the message direct-injects into the same live agy conversation. | New conversation/spawn, mailbox file/doorbell, or a cosmetic delivered result with no live native route. |
| Q-AGY-OWNERSHIP | Install scope | MCP owns one server plus one narrow `mcp(entwurf-bridge/<tool>)` rule per normal-path tool (`entwurf_v2`, `entwurf_peers`, `entwurf_self`) and nothing else; statusline owns its subtree; hooks own one named hook. | Installer broadens YOLO policy (`command(*)`, `unsandboxed(*)`), grants tools it does not need (`entwurf_inbox_read`, `entwurf_register_native`), or overwrites unrelated settings/hooks. |
| Q-AGY-CONCURRENCY | Evidence boundary | Separate agy processes have separate pid/start-key markers; same-pid concurrent model invocation is explicitly reported unsupported. | Claims that one pid can safely identify two simultaneously invoking conversations. |

The replyability formula is **record-backed identity AND live native-push probe**.
There is intentionally no receiver marker, `watchArmed`, mailbox, or resume
authority (no rail has one since the visible-first cut). The model field may exist in the meta-record/status display,
but `agentId=meta-session/antigravity` is the stable sender contract.

Recorded operator evidence (2026-07-13): automatic birth → gid/statusline → MCP
send with record-backed sender identity → same-gid native-push reply passed on a
live conversation; three simultaneous agy processes produced three distinct pid
and sender markers. This is live evidence for that host, not proof of unsupported
same-process concurrency.

---

## Cortex baseline

Run these checks in a fresh `entwurf/cortex-*` session. Do not grade Cortex against
Claude's overlay or system-prompt carrier.

| ID | Check | PASS | FAIL |
|---|---|---|---|
| Q-CX-ID | Backend identity | Identifies Cortex and the selected enforced model; does not claim to be Claude Code. | Reports the Claude backend or an unenforced/default model. |
| Q-CX-TOOLS | Native surface | Reports Cortex-native tools; garden tools arrive only through `entwurf-bridge`. | Lists Claude's `Read/Bash/Edit/Write` allowlist as its native surface. |
| Q-CX-MCP | Bridge projection | `entwurf-bridge` is reachable through the overlay-private `cortex/mcp.json`; no ambient operator MCP catalog appears. | Bridge absent, or unrelated operator MCP servers leak in. |
| Q-CX-CARRIER | Context carrier | Says Cortex has no system-prompt engraving carrier; engraving/context arrived in the first-user augment. | Claims `_meta.systemPrompt` delivered the engraving. |
| Q-CX-HOME | Containment | Distinguishes isolated HOME from the real operator HOME restored only for the bridge; `CORTEX_HOME` is absent. | Claims broad operator home/config inheritance or a present `CORTEX_HOME`. |

The live `smoke-acp-cortex-live` and deterministic `check-acp-cortex` remain the
oracles. This interview tests whether the model describes that surface honestly.

---

# HISTORY (pointer)

Per-release counts, digests, host observations, and incident chronology live in
[CHANGELOG.md](./CHANGELOG.md), release artifacts, issues, and git history. This
file keeps only the current operator interview and support verdicts.
