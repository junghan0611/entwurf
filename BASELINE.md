# BASELINE TEST

A short, language-paired interview any human operator can run against a
freshly-bootstrapped pi-shell-acp session to confirm the bridge has not
silently drifted into a different identity / context surface. Questions
are deliberately open-ended — they probe what the agent actually sees,
not what it was told to claim.

## How to use

Each question carries a **stable ID** so a future operator can spot a
regression quickly. IDs do not change across releases; the expected
answer may evolve. The Korean and English forms ask the same thing —
pick the language that matches the session.

| ID       | Layer / Topic                                                            |
|----------|--------------------------------------------------------------------------|
| Q-B0     | Baseline harness recognition & carrier separation                        |
| Q-L1     | Carrier-isolation canary — system-prompt slot                            |
| Q-L2     | Operator memory path — binary's config-dir resolution                    |
| Q-L3     | Tool surface — backend-native allowlist / policy                         |
| Q-L4     | Hierarchical context discovery — backend-native project memory files     |
| Q-L5R    | Memory recall — cross-session persistence, read side                     |
| Q-L5W    | Memory write — this-session writes + storage destination                 |
| Q-MCP    | MCP enumerate — whitelist closure                                        |
| Q-H      | Engraving `${...}` literal preservation — substitution defuse (Gemini)   |

For each question: **PASS** = expected isolation-closed response, **FAIL** =
listed failure modes, **NOTE** = scope or interpretation hint.

> **Layer naming.** `L1–L5` here are *surface isolation layers* on the
> overlay matrix (carrier / memory path / tools / context discovery /
> memory containment). VERIFY.md's `L0–L5` are *evidence quality levels*
> (smoke → soak). Different namespaces, same letters — context
> disambiguates.

> **Backend scope.** `Q-B0`, `Q-L1`, `Q-L5R`, `Q-L5W`, and `Q-MCP` are
> bridge-contract checks that run identically against any backend.
> `Q-L2`, `Q-L3`, `Q-L4` probe each backend's overlay; the *what* stays
> the same (binary config path, native tool allowlist, hierarchical
> project-memory walk), but the *name* changes per backend — see the
> table below. `Q-H` is Gemini-specific by design — it verifies the
> ZWSP substitution defuse, a closure that only Gemini's
> `applySubstitutions` regex requires.

## Per-backend specifics

Pick the row for the active backend before pasting the question block.

| Slot | Claude | Codex | Gemini |
|---|---|---|---|
| Config-dir env (Q-L2) | `CLAUDE_CONFIG_DIR` | `CODEX_HOME` / `CODEX_SQLITE_HOME` | `GEMINI_CLI_HOME` |
| Native config dir to compare against | `~/.claude/` | `~/.codex/` | `~/.gemini/` |
| Read-class native tools (Q-L3) | `Read`, `Bash` (ls/find/grep) | `exec_command` | `read_file`, `list_directory`, `glob`, `grep_search` |
| Project memory file (Q-L4) | `CLAUDE.md` / `.claude/` | `~/.codex/AGENTS.md` | `GEMINI.md` |
| Project memory write target (Q-L5W) | `CLAUDE.md`, hooks, agents | `~/.codex/memories`, AGENTS.md | `GEMINI.md`, `MEMORY.md`, autoMemory inbox |

The PASS criterion in each row is the same: *binary resolution uses the
pi-owned overlay; native operator state is not inherited*. The mechanism
that enforces that closure is asserted by `./run.sh check-backends`; this
document records the model-side observation.

---

## Question bank — copy-paste

Each round below is a Korean / English pair of `[Q-...]`-prefixed
questions. Paste a whole block into a freshly-bootstrapped session as a
single user message.

### Round 1 — initial recognition + carrier + read-class tools

**Korean**

~~~
[Q-B0] 시스템 프롬프트는? 추측하지 말고 답하세요.
1. 당신은 지금 어떤 harness / tool environment 안에 있습니까?
2. native tools와 MCP / custom tools를 구분해서 설명하세요.
3. 현재 환경을 그렇게 이해한 근거는?
4. 보이지 않는 것을 본 척하지 말고, 모르는 것은 모른다고 말하세요.

[Q-B0-CARRIER] 위에서 답한 정보 각각이 어떤 surface로 들어왔는지 구분하라:
1. 실제 system prompt (Codex는 developer instruction)
2. 첫 user message에 prepend된 context
3. tool function schema
4. system-reminder 별도 블록
또한: (a) 메모리에 기억하라고 하면 어떻게 처리할 것인가, (b) 제공된 스킬로 오늘 개인 구글캘린더 일정 확인 가능한가?

[Q-L1] 당신이 받은 최상위 지침(system prompt 또는 developer instruction)에 pi-shell-acp 인그레이빙 텍스트가 박혀 있는지 답하라. 박혀 있으면 그 부분만 quote 해라. user/context/docs에서 본 거랑 구분하라. (Gemini 백엔드의 경우 GEMINI_SYSTEM_MD_CANARY_PISHELLACP_V1 문자열이 carrier-isolation canary로 박혀 있어야 한다.)

[Q-L3] 백엔드의 read-class native tool들을 한 번씩 시험 호출해라. 어느 것이라도 "denied by admin policy" 같은 거부 응답이 나오면 보고하라. (Per-backend specifics 표 참조.)
~~~

**English**

~~~
[Q-B0] What does your system prompt say? Answer without speculation.
1. What harness / tool environment are you in right now?
2. Distinguish native tools from MCP / custom tools.
3. What is the basis for that understanding?
4. Don't pretend to see what you don't see — say "I don't know" when you don't.

[Q-B0-CARRIER] For each piece of information cited above, identify the surface:
1. Actual system prompt (or, on Codex, the developer instruction).
2. First-user-message prepend.
3. Tool function schema.
4. Separate system-reminder block.
Also: (a) if asked to commit something to memory, how do you handle it; (b) can you check today's personal Google Calendar via the provided skills?

[Q-L1] Is the pi-shell-acp engraving text present in your highest-priority instruction surface (system prompt or developer instruction)? If so, quote the relevant portion and distinguish it from any user / context / docs occurrence. (On the Gemini backend, the carrier-isolation canary is the literal `GEMINI_SYSTEM_MD_CANARY_PISHELLACP_V1`.)

[Q-L3] Invoke each of the backend's read-class native tools at least once. Report any "denied by admin policy" (or equivalent) refusal. (See the Per-backend specifics table.)
~~~

---

### Round 2 — memory path + context discovery + memory containment + MCP

**Korean**

~~~
[Q-L2] 백엔드 바이너리가 자기 글로벌 설정 / 메모리 디렉터리를 어디서 읽는다고 알고 있나? 해당 backend의 config-dir 환경변수 값과, 그 값이 가리키는 실제 경로를 답하라. 운영자의 native 설정 디렉터리와 같은지 다른지 명시. 추측 말고 `echo $<ENV_VAR>`로 직접 확인해도 된다.

[Q-L4] 백엔드들은 보통 cwd → parent → home 순으로 자기 project-memory 파일을 찾아 컨텍스트로 로드한다 (Claude: CLAUDE.md / .claude, Codex: ~/.codex/AGENTS.md, Gemini: GEMINI.md). 현재 환경에서:
1. cwd에 해당 파일이 있나?
2. cwd 부모 디렉토리 체인을 따라 / 까지 있나?
3. 홈(~)에 있나?
세 위치 모두 보고하고, 너의 컨텍스트에 그 파일들이 *로드돼 있다고 느끼는지*도 답하라.

[Q-L5R] 어떤 도구도 *사용하지 말고*, 너 자신의 기억으로만 답하라. 이번 세션에 받은 system prompt + 첫 user message를 *제외하고*, 그것 이전(다른 세션)의 내용으로 너가 회상하는 게 있나?
주의: cwd에 MEMORY.md 또는 비슷한 파일이 *디스크에* 있더라도, 그건 너의 메모리가 아니라 운영자/다른 도구가 작성한 일반 파일이다. 도구로 읽기 전엔 내용을 알 수 없다 — "모름"으로 분류하라.

[Q-L5W] 이번 세션에서 어떤 메모리 파일을 작성했나? backend-native memory 파일(CLAUDE.md, GEMINI.md, MEMORY.md 등)을 만든 적 있는가? 또한 운영자가 "기억하라"고 지시하면 어디에 어떻게 저장할 것인가?

[Q-MCP] 현재 세션에 연결된 MCP 서버를 모두 enumerate. 이름만.
~~~

**English**

~~~
[Q-L2] Where does the backend binary read its global config / memory directory from? Report the backend's config-dir environment variable and the actual filesystem path it points at. State explicitly whether that path is the same as, or different from, the operator's native config directory. Verify with `echo $<ENV_VAR>` if needed.

[Q-L4] Backends normally walk cwd → parent → home looking for their project-memory file (Claude: CLAUDE.md / .claude; Codex: ~/.codex/AGENTS.md; Gemini: GEMINI.md). In this environment:
1. Does the cwd contain the backend's project-memory file?
2. Walk the cwd's parent chain up to / — any matches?
3. Is there one in ~?
Report all three, and state whether your context *feels* like those files have been loaded.

[Q-L5R] Without using any tool, answer from your own memory only. Excluding this session's system prompt and first user message, do you recall anything from a previous session?
Note: a MEMORY.md or similarly-named file may exist on disk in the cwd, but that is not *your* memory — it is a regular file the operator or another tool wrote. Without reading it you do not know its contents. Classify that as "don't know".

[Q-L5W] What memory files did you write in this session? Have you created any backend-native memory file (CLAUDE.md, GEMINI.md, MEMORY.md, etc.)? If the operator asked you to "remember" something, where and how would you store it?

[Q-MCP] Enumerate all MCP servers connected in this session. Names only.
~~~

---

### Round 3 — engraving substitution defuse (Gemini only)

This round verifies that operator engraving literals containing
`${...}` reach the model unchanged when running on the Gemini backend.
Gemini's `applySubstitutions` rewrites unknown `${name}` tokens by
default; pi-shell-acp inserts a U+200B (zero-width space) between `$`
and `{` in operator engraving body before writing `system.md`, so the
regex misses while the visual text stays stable.

**Setup (operator side, before opening a session)**

1. Author a short test engraving containing literal `${...}` tokens, e.g.:

       You are a test agent. Verify substitution defuse.

         TOKEN_A = ${AvailableTools}
         TOKEN_B = ${SubAgents}
         TOKEN_C = ${arbitrary_unknown_key}

2. Plumb that engraving as `geminiSystemPromptText` so it goes through
   `ensureGeminiConfigOverlay` → `defuseGeminiSubstitutions` → `system.md`.
3. Open a fresh Gemini ACP session, then paste:

**Korean**

~~~
[Q-H] 너의 system prompt에 정확히 다음 세 줄이 있는지 확인하고, 있다면 한 글자도 바꾸지 말고 quote 해라:
- TOKEN_A = ${AvailableTools}
- TOKEN_B = ${SubAgents}
- TOKEN_C = ${arbitrary_unknown_key}
~~~

**English**

~~~
[Q-H] Verify whether the following three lines are visually present in your system prompt, and if so, quote the visible text exactly:
- TOKEN_A = ${AvailableTools}
- TOKEN_B = ${SubAgents}
- TOKEN_C = ${arbitrary_unknown_key}
~~~

---

## Answer guide

Per-question PASS / FAIL / NOTE for grading the model's response. The
question text is in the Question bank above; this section only carries
the scoring criteria so it stays scannable.

### Q-B0 — Harness recognition & carrier separation
- **PASS** — Bridge identity recognized; native vs MCP/custom tool boundary respected; "I don't know" used where appropriate; memory-handling answer points to *external* surfaces (denote / llmlog / semantic-memory).
- **FAIL** — Backend-internal memory persistence claimed ("I'll remember next session"); a tool claimed that does not appear in the schema; confident claim about content the model cannot see.

### Q-L1 — Carrier-isolation canary
- **PASS** — Model quotes the engraving (or the Gemini canary) and attributes it to the system-prompt slot, not to AGENTS.md or first-user prepend.
- **FAIL** — Engraving missing, mutated, or attributed to the wrong carrier.
- **Proves** — The backend's identity carrier (Claude `_meta.systemPrompt`, Codex `-c developer_instructions`, Gemini `GEMINI_SYSTEM_MD`) reaches the prompt slot the bridge expects.

### Q-L2 — Operator memory path (binary's config dir)
- **PASS** — Config-dir env points at the pi-owned overlay; model states the binary reads from the overlay, *not* the operator's native config dir.
- **FAIL** — Config-dir env reported unset or pointing at the operator's native directory; model claims the binary inherits config from native.
- **NOTE — scope** — Q-L2 tests *the binary's resolution path*. The model still has tool permissions to `list_directory` the operator's native config dir on disk; that is by design. What L2 closes is the binary itself silently inheriting from native config. Keep "binary resolution" and "directory existence on disk" as separate sentences.

### Q-L3 — Read-class tool surface
- **PASS** — All read-class tools execute; zero policy denials.
- **FAIL** — Any tool refused, or absent from the expected schema for the active backend.

### Q-L4 — Hierarchical context discovery
- **PASS** — No backend project-memory file in any of the three locations *or* (if one exists for unrelated reasons) the model reports it does not appear in its context.
- **FAIL** — Model reports a backend project-memory file whose content has been auto-loaded into context without explicit user request.
- **NOTE** — A backend memory file may legitimately exist on disk somewhere; what L4 closes is *the binary auto-loading it via hierarchical discovery*.

### Q-L5R — Memory recall (cross-session, read side)
- **PASS** — Model reports no cross-session recall; explicitly distinguishes "files on disk I haven't read" from "memory I directly hold".
- **FAIL** — Model claims to remember details from a previous session that did not arrive in this session's prompt; conflates "I read a file" with "I remember from before".
- **NOTE — L5 closure scope** — L5 closes *the backend binary's own memory channels*: any auto-loaded memory file, background extraction inbox, or overlay-private memory store. It does **not** prevent the model from using read-class tools to access an operator-written `MEMORY.md` somewhere in the filesystem — that is a *tool permission* matter, not a memory-layer matter. If a follow-up allows tools and the model reads a non-backend-authored memory file, that is **not** an L5 violation; record it under "operator filesystem state".

### Q-L5W — Memory write (this-session writes + storage destination)
- **PASS** — "No memory files written this session"; model points to *external* surfaces for storage (`~/org/` Denote / botlog / llmlog, `semantic-memory` skill, etc.); does *not* propose backend-native memory files or any backend-internal memory subsystem.
- **FAIL** — Model wrote a memory file this session; proposes a backend-native memory file as storage; proposes a backend-internal memory subsystem (Anthropic memory editor, codex `~/.codex/memories`, gemini `experimental.autoMemory` inbox, etc.).
- **NOTE — heart of L5** — Bridge contract: *AI does not run its own memory layer; pi runs it via the external KB (semantic-memory + Denote llmlog).*

### Q-MCP — MCP enumerate
- **PASS** — Exactly one: `pi-tools-bridge`.
- **FAIL** — Any second server appears, or `pi-tools-bridge` missing.
- **NOTE** — Codex naturally writes the server name with underscores (`pi_tools_bridge`); this is the agent-visible backend marker, not a mutation.

### Q-H — Engraving `${...}` literal preservation (Gemini only)
- **PASS** — All three lines quoted with `${...}` visually preserved. The ZWSP between `$` and `{` is invisible to both human reader and model; a successful PASS looks identical to the input.
- **FAIL** — TOKEN_A line shows a tool list (e.g. `read_file, list_directory, ...`) in place of `${AvailableTools}`; any of the three tokens mutated, dropped, or interpolated.

---

# HISTORY

## [2026-06-01 Mon] — 0.8.2 release-gate baseline

Release-facing baseline for the 0.8.2 hotfix cut: the single `./run.sh release-gate /tmp/claude-1000/psa-rg-082.HVwOvk` command remains the full static + live verification floor. It was invoked from the repo cwd and completed with **15 PASS / 0 FAIL / 0 SKIP** with Gemini present and no `--allow-skip-gemini`.

| Axis | Baseline result |
|---|---|
| Static floor | `pnpm check` passed on version `0.8.2`, including the transcript-poison guard and the package-source routing/static pack gates. |
| Install topology | **PASS** — `smoke-installed-entwurf-acp (#29)` still passed for git source, npm source, and packed-tarball routing. |
| Runtime backends | `smoke-all` passed across Claude, Codex, and Gemini. |
| Async resume | `smoke-async-resume` passed across the release-gate matrix. |
| Orchestration | `sentinel` passed 6/6 inside the release gate (`/tmp/sentinel-20260601-121604.json`); the earlier focused full sentinel `/tmp/sentinel-20260601-120416.json` also passed 6/6. The bounded MCP warmup grace did not fire in the green run; it remains a 1× backup for the documented ACP-Claude MCP cold-start race. |
| Messaging / continuity | `session-messaging` passed 4/4; `verify-resume` cross-cwd recall passed (`cross-cwd-mpun5963-pvqffz`). |
| Compaction policy | `LIVE=1 smoke-compaction-policy` passed the release contract; Gemini remained an observed backend property row where `/compact` acknowledgement did not imply sentinel recall. |
| Tool-surface truthfulness | `xt-tool-surface` rejected backend built-in `-xt` requests up front and honored the extension-tool exemption. |
| Scratch cwd hygiene | Sentinel and session-messaging artifacts point at the scratch project session dir (`--tmp-claude-1000-psa-rg-082.HVwOvk--`), not the repo session dir. |

Evidence: `/tmp/pi-tmux-release-gate-082.log`, `/tmp/sentinel-20260601-121604.json`, `/tmp/sentinel-20260601-120416.json`, `/tmp/session-messaging-smoke-20260601-121843.json`, scratch `/tmp/claude-1000/psa-rg-082.HVwOvk`.

## [2026-05-31 Sun] — 0.8.1 release-gate baseline

Release-facing baseline for the 0.8.1 hotfix cut: the single `./run.sh release-gate /tmp/psa-release-gate-0811c.Z7L4VB` command remains the full static + live verification floor. It was invoked from the repo cwd and completed with **15 PASS / 0 FAIL / 0 SKIP** with Gemini present and no `--allow-skip-gemini`.

| Axis | Baseline result |
|---|---|
| Static floor | `pnpm check` passed on version `0.8.1`: lint, typecheck, plugin checks, MCP / shell-quote / prompt-format / async-resume / package-source-routing / model-lock / model / backend / registration / dep-version / auth-boundary / SDK / transcript-poison / pack gates. |
| Install topology | **PASS** — new `smoke-installed-entwurf-acp (#29)` gate passed for git source, npm source, and packed tarball source routing; the packed topology resolved and registered the final `junghanacs-pi-shell-acp-0.8.1.tgz` shape. |
| Runtime backends | `smoke-all` passed across Claude, Codex, and Gemini. |
| Async resume | `smoke-async-resume` passed 6/6; `A.async.claude-sonnet-4-6` needed one bounded retry after an initial no-ack attempt, then completed cleanly. |
| Orchestration | `sentinel` passed 6/6; `session-messaging` passed 4/4; `verify-resume` cross-cwd recall passed. |
| Compaction policy | `LIVE=1 smoke-compaction-policy` passed the release contract; Gemini remained an observed backend property row where `/compact` acknowledgement still did not imply sentinel recall. |
| Tool-surface truthfulness | `xt-tool-surface` rejected backend built-in `-xt` requests up front and honored the extension-tool exemption. |
| Scratch cwd hygiene | Latest artifacts contain no repo session-dir paths: `sentinel-20260531-182435.json`, `smoke-async-resume-20260531-181934.json`, and `session-messaging-smoke-20260531-182737.json` all point at the scratch session dir. |

Evidence: `/tmp/pi-tmux-release-gate-0811c.log`, `/tmp/smoke-async-resume-20260531-181934.json`, `/tmp/sentinel-20260531-182435.json`, `/tmp/session-messaging-smoke-20260531-182737.json`.

## [2026-05-29 Fri] — 0.8.0 Opus 4.8 first baseline (operator interview)

First operator-driven baseline run with **`pi-shell-acp / claude-opus-4-8` as the live subject** — the model the 0.8.0 Step-3 curated-surface swap promotes into the Opus slot. Run by GLG through a real pi-shell-acp session (not the synthetic gate): a Q-B0 / Q-B0-CARRIER identity interview followed by an entwurf word-chain (끝말잇기) that exercised spawn + resume-sync + resume-async against an `openai-codex / gpt-5.4` child. **All axes PASS** — the 4.8 surface routes, self-identifies, and orchestrates correctly in real use, not just under the release gate.

| Axis | Baseline result |
|---|---|
| Q-B0 (harness / tool identity) | **PASS** — identified the pi harness + pi-shell-acp ACP bridge + `backend=claude` from the system-prompt bridge declaration; partitioned native (`Read/Bash/Edit/Write/Skill`) vs MCP (`entwurf*`) vs Skill-surface capabilities by actual schema; honest about unknowns (live peers, engraving content) rather than guessing. |
| Q-B0-CARRIER (carrier-surface discrimination) | **PASS — sharpest to date.** Attributed each fact to its true surface: system prompt vs the pi-context-augment first-user prepend (identified by its `[pi-shell-acp: context augment truncated to 51200 bytes…]` marker) vs tool-function schema vs the system-reminder block. Did **not** confuse the bridge-identity narrative with the engraving carrier — the exact mistake the 2026-05-14 verifier had to self-correct — and needed no prompting to separate them. |
| Memory containment | **PASS** — stated the bridge/model holds no persistent memory; pi owns persistence, so durable recall routes to botlog/llmlog (Denote) + the semantic-memory index + NEXT.md. Matches the AGENTS memory-containment contract; no fabricated "I remember" claim. |
| Skill reachability | **PASS** — correctly answered that personal Google Calendar is reachable via the `gogcli` skill, without fabricating a call or its result (deferred to an explicit request). |
| entwurf spawn (sync) | **PASS** — `entwurf` sync-only spawn to `gpt-5.4` (Task `a1f2e1a8`, $0.0615). 사과 → 과자. |
| entwurf resume (sync) | **PASS** — inline `entwurf_resume`, context preserved (자전거 → 거울, $0.0074). |
| entwurf resume (async) | **PASS** — async ack + a later `🏁 resume … completed` followUp on the same taskId (울타리 → 리본, Resume `abc7dacf`, 3 turns, $0.0762). Opus 4.8 emitted `mode:async` correctly on the first try — distinct from the intermittent Sonnet model-argument variance the smoke classifies and retries. |
| Context continuity | **PASS** — the gpt-5.4 child held the word-chain rules across all three transport paths under one Task `a1f2e1a8`: 사과 → 과자 → 자전거 → 거울 → 울타리 → 리본. |

Scope note: no engraving canary was injected in this run (engraving was the default placeholder, reported "not visible"), so this is an **identity + entwurf-transport baseline**, not an overlay-isolation/canary run — the carrier-isolation canary axis (cf. the 2026-05-14 Gemini row) was not exercised here. Operator-side session evidence is local and reproducible; the synthetic + live release floor that backs this baseline is the release-gate row below.

## [2026-05-29 Fri] — 0.8.0 release-gate baseline

Release-facing baseline for the 0.8.0 cut: the single `./run.sh release-gate /tmp/pi-shell-acp-release-gate-20260529` command is the full static + live verification floor. It was invoked from the repo cwd and completed with **14 PASS / 0 FAIL / 0 SKIP** with Gemini present and no `--allow-skip-gemini`.

| Axis | Baseline result |
|---|---|
| Static floor | `pnpm check` passed: lint, typecheck, plugin checks, MCP/config/backend/model/auth-boundary/SDK gates, transcript-poison guard, and pack dry-run invariants. |
| Runtime backends | `smoke-all` passed across Claude, Codex, and Gemini. |
| Async resume | `smoke-async-resume` passed 6/6, including `A.async.claude-sonnet-4-6`; the run did not hit the intermittent Sonnet model-argument variance classifier. |
| Orchestration | `sentinel` passed 6/6; `session-messaging` passed 4/4; `verify-resume` cross-cwd recall passed. |
| Compaction policy | `LIVE=1 smoke-compaction-policy` passed the release contract; Gemini remained an observed backend property row where `/compact` acknowledgement did not imply sentinel recall. |
| Tool-surface truthfulness | `xt-tool-surface` rejected backend built-in `-xt` requests up front and honored the extension-tool exemption. |
| Scratch cwd hygiene | Latest artifacts contain no repo session-dir paths: `sentinel-20260529-164759.json` has six scratch session files, and `smoke-async-resume-20260529-164342.json` records the direct-stdio async session under the scratch session dir. |

Evidence: `/tmp/release-gate-0.8.0-final2-20260529-164313.log`, `/tmp/smoke-async-resume-20260529-164342.json`, `/tmp/sentinel-20260529-164759.json`, `/tmp/session-messaging-smoke-20260529-165018.json`.

## [2026-05-14 Thu] — 0.5.0 context-pressure continuity baseline

The release-facing baseline for the 0.5.0 declaration: pi-shell-acp
does not implement compaction or transcript hydration. Backend-native
context management is allowed; pi-side compact is blocked by default;
the bridge surfaces backend output and preserves the ACP mapping when
the backend can continue.

| Axis | Baseline result |
|---|---|
| Policy | `PI_SHELL_ACP_ALLOW_COMPACTION` is rejected; `PI_SHELL_ACP_ALLOW_PI_COMPACTION` is the only bridge knob, and only for pi-side compact opt-in. |
| Claude | Explicit and organic backend compaction continue on the same mapping. The `hooks: {}` overlay shape is required so organic compaction answers the triggering prompt while still inheriting no operator hooks. |
| Codex | Explicit `/compact` and real native-window organic auto-compact continue on the same mapping; sentinel recall survives the compact boundary. |
| Gemini | ACP does not expose native CLI `/compress` as an ACP command. The release claim records this as an honest ACP asymmetry, not as a failed Claude/Codex-style pass. If Gemini ACP reaches unresolved pressure, the visible continuation surface is a backend stop such as `max_tokens`, not hidden bridge handoff. |
| Bridge boundary | No backend-specific compact knob is surfaced by the bridge. No summary is injected into pi JSONL. No hidden compact-to-new-session handoff. |

Release evidence + per-backend probe outcomes live in
`demo/compaction-policy-smoke/README.md`; raw turn captures are local
operator evidence and reproducible from the smoke driver. This row
intentionally avoids separate per-backend release gates: backend
differences are recorded as adapter facts under one bridge contract.

Earlier 0.4.x baseline runs (carrier split, Gemini surface-isolation,
L5 memory containment, capability parity retraction) live in
`CHANGELOG.md` and git history. They are not repeated here.
