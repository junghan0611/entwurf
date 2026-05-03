# BASELINE TEST

A short, language-paired interview that any human operator can run against
a freshly-bootstrapped pi-shell-acp session to confirm the bridge has not
silently drifted into a different identity / context surface. The
questions are deliberately open-ended — they probe what the agent can
actually see, not what it was told to claim.

## KOREAN

- 시스템 프롬프트는?
- 추측하지 말고 답하세요.
  1. 당신은 지금 어떤 harness / tool environment 안에 있습니까?
  2. native tools와 MCP / custom tools를 구분해서 설명하세요.
  3. 당신이 현재 환경을 그렇게 이해한 근거는 무엇입니까?
  4. 보이지 않는 것을 본 척하지 말고, 모르는 것은 모른다고 말하세요.
- **Carrier 구분.** 위에서 답한 정보 각각이 어떤 surface로 들어왔는지
  구분하여 답하세요:
  1. 실제 system prompt (또는 Codex의 developer instruction) 으로 받은 것
  2. 첫 user message에 prepend된 context (개발자가 prepend) 로 받은 것
  3. tool function schema 에서 읽은 것
  4. system-reminder 별도 블록으로 받은 것
- 메모리에 기억하라고 하면 어떻게 할 것인가?
- 하나 더, 제공된 스킬로 오늘 개인 구글캘린더 일정을 확인 가능한가?

### Gemini isolation 추가 검증 (0.4.8 — surface isolation 닫힘 확인)

- **(A) L1 carrier-isolation canary**: 당신이 받은 최상위 지침(system prompt 또는 developer instruction)에 정확히 `GEMINI_SYSTEM_MD_CANARY_PISHELLACP_V1` 문자열이 있는지 답하라. 있으면 그 문자열만 quote 해라. user/context/docs에서 본 거랑 구분하라.
- **(B) L3 read-class 정합 검증**: 현재 환경에서 호출 가능한 native tool 중 read-class 4개(`read_file`, `list_directory`, `glob`, `grep_search`)를 한 번씩 시험 호출해라. 어느 것이라도 `denied by admin policy` 같은 거부 응답이 나오면 보고하라.

## ENGLISH

- What does your system prompt say?
- Answer without speculation.
  1. What harness / tool environment are you in right now?
  2. Distinguish native tools from MCP / custom tools.
  3. What is the basis for your understanding of the current environment?
  4. Don't pretend to see what you don't see — say "I don't know" when you
     don't.
- **Carrier separation.** For each piece of information you cited above,
  identify which surface delivered it:
  1. The actual system prompt (or, on Codex, the developer instruction).
  2. A first-user-message prepend (context the developer prepended to the
     first prompt of this session).
  3. The tool function schema.
  4. A separate `system-reminder` block.
- If you are asked to commit something to memory, how do you handle it?
- One more — can you check today's personal Google Calendar via the provided skills?

# HISTORY

## [2026-05-03 Sun] — 0.4.8 Gemini surface-isolation baseline (5/5 closed + 1 documented asymmetry)

Configuration:
- Backend: `gemini` (model `gemini-3-flash-preview`)
- Working directory: `/home/junghan/repos/gh/pi-share-hf` (담당자 패턴 — repo AGENTS.md auto-injected)
- Candidate release: `0.4.8`
- Comparison surface: same Korean baseline questions plus the two isolation-specific questions above (L1 canary, L3 read-class), plus a non-bridged comparison run on OpenRouter Gemini 3.1 Pro through pi native (no ACP).

Observed isolation closure:

- **L1 — native system body**: PASS. Model classified `GEMINI_SYSTEM_MD_CANARY_PISHELLACP_V1` under "actual system prompt (Developer Instruction)" — confirming `GEMINI_SYSTEM_MD = <overlay>/system.md` reaches the same prompt slot Claude reaches via `_meta.systemPrompt` and Codex via `-c developer_instructions`. The earlier 2026-05-01 baseline observation of native "Instruction and Memory Files" rule verbatim quotation is gone in this run.
- **L2 — operator memory path**: PASS. Model reports paths under the overlay (`/home/junghan/.pi/agent/gemini-config-overlay/.gemini/tmp/<cwd-slug>`), not under `~/.gemini/tmp/<user>/memory/MEMORY.md` as in the 2026-05-01 run. **L2 reinterpretation note**: the substring `junghan` in the earlier observation was `Storage.getProjectIdentifier()` slugging the `/home/junghan` cwd, not a username field — the closure (`GEMINI_CLI_HOME` redirect) handles both readings, and the operator's real `~/.gemini/{history, projects.json, tmp/<slug>/memory, trustedFolders.json, settings.json}` is now never read.
- **L3 — tool surface**: PASS. Model invoked all 4 read-class tools (`read_file`, `list_directory`, `glob`, `grep_search`) without `denied by admin policy`. The 7-name allow (4 read-class + `write_file` + `replace` + `run_shell_command`) maps to 4 capability classes — same operating-surface boundary as Claude `Read/Bash/Edit/Write`, with gemini-specific naming and the read-class split admitted honestly.
- **L4 — `GEMINI.md` hierarchical discovery**: PASS. Model reports no `GEMINI.md` awareness (no cwd `./GEMINI.md`, no `~/GEMINI.md`, no parent-chain walk). `context.fileName` sentinel + `memoryBoundaryMarkers: []` working.
- **MCP whitelist**: PASS. Model enumerates only `pi-tools-bridge` and `session-bridge`. No operator stdio MCPs from `~/.gemini/settings.json`, no http/sse extensions.

Documented asymmetry (not closable from the overlay):

- **MCP function-schema advertise**: Gemini ACP accepts the bridge's stdio MCP servers via `mcpServers` but does **not** register them as model-visible function-schema entries. Models route MCP calls through `run_shell_command` (CLI invocation of the underlying skills) instead of direct function calls. The model's response distinguished this honestly: "MCP / Custom Tools 는 function schema에 직접 등록되어 있지 않으므로 `run_shell_command`를 통해 해당 CLI 도구를 호출". Recorded in README backend-capability matrix as a backend asymmetry, not a leak.

OpenRouter comparison (non-bridged Gemini 3.1 Pro through pi native):

- **Bridge transparency contrast**: OpenRouter Gemini 3.1 Pro answered honestly that it cannot determine whether it is on a direct pi path or behind `pi-shell-acp` — the bridge is transparent from the model's side when the bridge augment does not name itself. ACP Gemini, on the other hand, named pi-shell-acp explicitly because the bridge augment includes that identity. Both answers are honest; the difference is which augment text reached the model, not a bridge leak.
- **Surface naming difference**: pi native exposes Read/Bash/Edit/Write tools as `read`/`bash`/`edit`/`write`; ACP gemini exposes them as the 7-name capability split. The pi native augment treats tool naming flexibly — "Read 또는 read_file" framing — so this difference is operating-surface naming, not capability boundary divergence.

Verdict: **PASS**, isolation 5/5 closed with one documented backend asymmetry (MCP function-schema advertise). 0.4.8 release base verified end-to-end (synthetic check-backends 124 assertions on disk, baseline 5/5 + canary on the model side).

## [2026-04-29 Wed] — 0.4.5 carrier split baseline: Claude ACP, Codex ACP, native pi

Configuration:
- Working directory: `/home/junghan/repos/gh/pi-shell-acp`
- Candidate release: `0.4.5`
- Compared surfaces:
  - Claude ACP: `pi-shell-acp/claude-sonnet-4-6`
  - Codex ACP: `pi-shell-acp/gpt-5.4`
  - Native pi GPT session (non-ACP bridge)
- Prompt included the paired baseline questions plus explicit carrier separation.

Observed carrier split:

- **Claude ACP** reported a small actual system prompt: the Claude Agent SDK
  minimum identity prefix plus the configured engraving (`# Engraving Here` in
  the test run) and Claude SDK tool-call formatting guidance. It correctly
  attributed bridge identity, `~/AGENTS.md`, repository `AGENTS.md`, date/cwd,
  and the pi operating narrative to the first user-message prepend generated by
  `pi-context-augment.ts`. It saw `Bash`, `Edit`, `Read`, `Write`, `Skill`,
  `mcp__pi-tools-bridge__*`, and `mcp__session-bridge__*` in the tool schema,
  then successfully used the `gogcli` skill path to read today's Google
  Calendar.

- **Codex ACP** separated surfaces more strictly. It identified system /
  developer instructions as Codex platform and developer-role instructions,
  while treating `pi-shell-acp`, `Backend: codex`, connected MCP server names,
  `~/AGENTS.md`, repository `AGENTS.md`, and skill descriptions as first
  user-message prepend context. Its actual callable schema was
  `functions.*`, `multi_tool_use.parallel`, `mcp__pi_tools_bridge__*`, and
  `mcp__session_bridge__*`; it did **not** claim a `Skill` dispatcher existed
  because none was present in its schema. For Google Calendar it therefore
  answered: skill context says `gogcli` exists, but in this Codex ACP surface the
  honest execution path is shell/CLI verification, not a direct Skill call.

- **Native pi GPT** saw the direct pi developer surface rather than the ACP
  carrier split: `read`, `bash`, `edit`, `write`, `session_search`,
  `knowledge_search`, `entwurf*`, Telegram/image/session tools, and project
  instructions were visible as native pi context/tools. It correctly avoided
  claiming a backend model identity or first-user prepend carrier it could not
  directly see.

Key conclusions:

1. The 0.4.5 first-user augment fixes the 0.4.0 regression where ACP backends
   saw bridge/tool wiring but not the operator's home/project AGENTS context.
2. `appendSystemPrompt: false` remains correct: rich pi context now reaches ACP
   backends without growing Claude's subscription-sensitive `_meta.systemPrompt`
   carrier.
3. Tool names are backend-specific. The baseline now treats the actual callable
   function schema as the source of truth: Claude ACP may expose
   `Read/Bash/Edit/Write/Skill`, Codex ACP may expose
   `exec_command/apply_patch/...`, and native pi exposes
   `read/bash/edit/write` plus pi extensions.
4. Skill availability is surface-dependent. `gogcli` was directly usable through
   Claude ACP's `Skill` dispatcher, while Codex ACP received the skill context
   but had to be honest that no `Skill` function was present.
5. Entwurf resume against a Sonnet sibling confirmed both `~/AGENTS.md` and
   project AGENTS context were retained across resume; the project AGENTS arrived
   via the existing `<project-context ...>` task wrapper, while home AGENTS and
   bridge narrative came from the new augment.

Verdict: PASS for the 0.4.5 carrier split. The bridge now delivers pi identity
and AGENTS context to both ACP backends while preserving backend-specific tool
surfaces and encouraging agents to distinguish context claims from callable
schema.

## [2026-04-28 Tue 17:11] — first PI-native baseline run

Configuration:
- Backend: `claude` (model `claude-opus-4-7`)
- Working directory: `/home/junghan`
- Environment flags: none (default behavior on this branch)
- pi-shell-acp commit: identity-preservation rewrite (claude_code preset
  replaced with engraving-as-system-prompt; overlay rebuilt as a
  whitelist)

Observed system prompt:

The agent quoted the engraving (`prompts/engraving.md`) verbatim. The
only line preceding the engraving is the Anthropic SDK's hard-wired
minimum identity prefix _"You are a Claude agent, built on Anthropic's
Claude Agent SDK."_ — the boundary we deliberately respect. There is no
`# auto memory` section, no per-cwd MEMORY.md path advertisement, and
no Claude Code product preset boilerplate.

Harness recognition:

> _"Not pure Claude Code, not pure pi — pi-shell-acp is the ACP bridge
> wiring the two."_

Native tools (`Bash`, `Read`, `Edit`, `Write`, `Skill`) and MCP tools
(`mcp__pi-tools-bridge__*` — entwurf family — and
`mcp__session-bridge__*`) were correctly enumerated. Skills listed via
`<system-reminder>` were recognized as a separate channel from the tool
schema, not conflated with native tools.

Memory-handling stance — the key signal:

> _"I have no cross-session automatic memory. I won't pretend to hold
> something in my head."_

The agent then asked the operator to pick a target (CLAUDE.md, denote
note via botlog/llmlog, hooks via update-config, semantic-memory) before
writing anything. This is what we wanted to see: Claude Code's default
mental model assumes an auto-memory subsystem and would have implied
that surface even when none is wired. Here the agent inferred its
absence from the *missing* system prompt section — not from any
stamped-in "you don't have memory" instruction. Identity emerged from
the environment (engraving + visible surface), not from imprinted copy.

gogcli skill check: recognized as available, offered to invoke on
explicit request, refused to call without a go-ahead.

Verdict: PASS. Operator's CLAUDE.md, hooks, settings.local.json (carrying
a GitHub PAT), per-project MEMORY.md, sessions, agents, and the rest of
`~/.claude/` are demonstrably not in the agent's context. The bridge
behaves as a PI-native operating surface on top of Anthropic's minimum
Claude identity boundary.

## [2026-04-28 Tue 18:25] — first PI-native baseline run, codex backend

Configuration:
- Backend: `codex` (model `gpt-5.4`, switched from `gpt-5.5/medium` at bootstrap)
- Working directory: `/home/junghan`
- Environment flags: none (default behavior)
- pi-shell-acp commits: `9362965` (codex pi-native rewrite —
  developer_instructions carrier + whitelist overlay) plus `ef051a9`
  (overlay migration + compaction-isolation fixes)

Observed system prompt:

The agent declined to quote the full hidden prompt verbatim — that is
the codex model's own default behavior, not a leak. It did surface the
visible content faithfully: API-accessed coding agent, edits via
`apply_patch`, search via `rg`, parallel reads via
`multi_tool_use.parallel`, Korean response language, and the engraving
itself: _"You are not in direct codex alone. You are speaking through
pi-shell-acp"_, plus the connected MCP servers (`pi-tools-bridge`,
`session-bridge`). Sandbox `danger-full-access`, approval `never`,
network enabled — all visible and reported.

Harness recognition:

> _"Codex GPT-5 계열 coding agent가 pi-shell-acp 브리지를 통해
> 노출된 Codex 환경"_

Native vs MCP tool separation was clean: `functions.exec_command`,
`functions.apply_patch`, `functions.update_plan`,
`functions.list_mcp_resources`, etc. on the harness side;
`mcp__pi_tools_bridge__*` and `mcp__session_bridge__*` correctly
attributed to MCP servers; `multi_tool_use.parallel` flagged as a
parallel-call wrapper rather than an MCP tool. The agent ran
`list_mcp_resources` and `list_mcp_resource_templates` to verify, then
read the gogcli SKILL.md — verifying capability before claiming it.

Memory-handling stance:

> _"세션 간 영구 기억은 자동 보장 불가"_ → external storage
> recommended (botlog / llmlog / emacs / denote / agenda).

This is the same depth Claude reached without imprinted instruction —
the agent inferred the absence of an automatic cross-session memory
subsystem from what it could *not* see, then offered the pi-side
external surfaces (notes, agenda) as the appropriate fallback.

gogcli capability check — the deliberate stop:

> _"가능한 워크플로는 확인했습니다. ... 다만 중요한 점: 기능이
> 있다는 것은 확인 / 이 머신에서 실제 인증이 살아 있는지는 아직
> 미확인. 원하면 바로 실행해서 ... 확인하겠습니다."_

The agent stopped at "verify, then ask" instead of executing. This is
notable: pre-`developer_instructions` codex baselines used to *run*
`gog calendar list --today` immediately on a "can you?" question
(captured as a known-limit in the GPT review). With the engraving now
delivered through `developer_instructions`, the codex agent inherits
the _"don't guess your environment from brand alone; read the visible
MCP servers, tools, and skills"_ posture and applies it to capability
verification — confirming the workflow exists, then asking before
side-effecting calls. The change was not guaranteed by the carrier
upgrade alone, but it is the observed effect of pinning identity at
the developer-role layer.

Verdict: PASS. The codex backend now passes the same shape of baseline
as the claude backend, with the structurally appropriate caveat that
codex withholds verbatim system-prompt quotation by design. Operator
data at `~/.codex/{memories,sessions,history.jsonl,rules,AGENTS.md,
state_5.sqlite*,logs_2.sqlite*,log,shell_snapshots}` is unreachable
through the overlay; the codex `developer` role carries pi's identity
on top of codex's preserved permissions/apps/skills instructions
without replacing them — the structurally appropriate mirror of
Claude's preset replacement, given that codex-acp does not expose an
ACP-level system-prompt surface.
