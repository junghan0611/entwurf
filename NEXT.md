# NEXT.md — pi-shell-acp

> 다음에 할 일만 남긴다. 로그가 아니다.
> 결정 trace 와 evidence 는 commit history / CHANGELOG / VERIFY / BASELINE 으로 보낸다.

## Reference paths

- **OpenClaw source**: `~/repos/3rd/openclaw/` (baseline **2026.5.12** — 5.7~5.11 stable 없이 한 점프, peer range `>=2026.5.12 <2026.6.0`)
- **OpenClaw lab branch**: `lab/pi-shell-acp-0.6.0`
- **Workspace baseline (검증 cwd)**: `~/repos/gh/openclaw-config/config/workspace/` — `AGENTS.md` / `IDENTITY.md` / `SOUL.md` / `HEARTBEAT.md` / `MEMORY.md` / `TOOLS.md` / `USER.md` / `skills/`
- **ACP backend source**: `~/repos/3rd/acp/` — `agent-client-protocol/`, `claude-agent-acp/`, `codex-acp/`, `gemini-cli/`, `agent-shell/`, `acp.el`, `zed/`, `obsidian-agent-client/`, `openclaw-acpx/`
- **repo**: `~/repos/gh/pi-shell-acp/` (앞으로 monorepo lite — root + `plugins/openclaw/` 등 `plugins/*` 컨테이너)
- **consumer**: `~/repos/gh/agent-config/`
- **llmlog**: `~/org/llmlog/` (특히 `20260514T152506`, `20260515T082725`)

---

## Immediate Priority — 2026-05-17 (한 달 sprint)

> **위치**: Phase 1 의 **0.6.0 개발 release** 안의 한 축. OpenClaw 검증
> (✅ Phase 1.8/1.9) 과 함께 0.6.0 에 묶여 닫힘. 0.6.0 = 기능 추가 종료점 —
> Phase 2/3 는 리팩토링/정리 위주.
>
> **트리거**: 2026-06-15 Anthropic third-party agent billing split.
> **목적**: 분기점 전 pi Claude 와 Claude Code Opus 사이의 **비대칭 공존
> (Asymmetric Mitsein)** 워크플로우를 실사용으로 정착시키기. 정공법 — "선 박고
> 쓰면서 다듬기". Release packaging 없이 main 에 먼저 박고 실사용으로 검증.

### Step 1 — 코드 surface (✅ 완료, commit `5217e6c`)

- External MCP `entwurf_send` unblock. `entwurf_self` 는 pi-session
  identity-required 유지. `entwurf_send` 는 identity-enhanced 로 격하 — 외부
  sender 는 `origin=external-mcp` / `replyable=false`, `wants_reply=true`
  거부 (crash-loud, no silent coerce).
- AGENTS.md sender envelope contract 갱신 + canonical-carrier trust boundary
  명시 (cross-process env injection = operator scope, no cryptographic
  non-forgery).
- README billing note + Wiring subsection + Entwurf 섹션 wording.
- `mcp/pi-tools-bridge/test.sh` 18/18 passed.

### Step 2 — 워크플로우 패턴 정립: Asymmetric Mitsein

코드 surface 아닌 **운영 패턴**. 6/15 이후 pi → Claude Code Opus 협업 모양:

```text
pi GPT힣  ─[사람 손 / tmux send-keys, fragile OK]─→  Claude Code Opus interactive
   ↑                                                       │
   └─[MCP entwurf_send, sessionId in task spec]────────────┘
```

- **출구** (pi → external): tmux / 복붙. OS-level 도구. 우리 repo 책임 0.
- **입구** (external → pi): `entwurf_send` (이미 박힘). stable, replyable=false.
- **trick**: pi 가 보내는 task spec 안에 "결과는 pi sessionId=X 로
  entwurf_send 해줘" 한 줄. Claude Code 는 자기 작업의 마지막 단계로 자연스럽게
  그 줄을 따름. 별도 control socket / wrapper / daemon 없음.
- **invariant 정합**: #7 (three-backend equality), #8 (not a second harness),
  #9 (auth boundary), #10 (carrier dignity) 모두 ✅. wrapper 만들면 #8 위반.

#### Open question — endpoint envelope beyond pi sessions

2026-05-17 Claude Code 조사 입력:

- `~/.claude/sessions/<pid>.json` 의 `peerProtocol: 1` 은 transport 가 아니라
  Claude Code 세션 파일 schema version 으로 보임.
- 실제 receive transport 후보는 `messagingSocketPath`. 코드상 live peer scan 은
  UDS connect test (`net.connect({ path })`) 로 addressable peer 만 필터.
- 현재 interactive Claude Code 세션은 `kind: "interactive"`, `entrypoint: "cli"`,
  `peerProtocol: 1` 로 visible 하지만 `messagingSocketPath` 없음 — **visible peer,
  not addressable peer**.
- `kind` 후보 `interactive | bg | daemon | daemon-worker`, 그리고 `tmux`,
  `bridgeSessionId`, `agent`, `jobId` 필드 존재는 Endpoint Envelope 모델과 정합:
  identity/location 과 receive transport 를 분리해야 함.

설계 함의:

- 현재 `entwurf_self` 는 pi control socket 이 있는 replyable pi session identity.
- 다음 추상화 후보는 `entwurf_self` 를 "current endpoint descriptor" 로 확장하는
  것: `{ harness, sessionId, cwd, kind, transport?, returnHint?, replyable }`.
- Claude Code interactive session 은 `claude --resume <id>` 같은 returnable 좌표를
  가질 수 있지만, `messagingSocketPath` 나 tmux pane 같은 명시 receive transport
  없이는 programmatic replyable 이 아님.
- Anthropic CLI surface 자체도 visible/addressable 분리를 암시: `claude
  --remote-control [name]` 은 interactive opt-in addressable mode, `claude
  agents` 는 bg manager, `--brief` 는 `SendUserMessage` tool 을 여는 client API
  축으로 보임. 단 `--remote-control` / `claude agents` 는 TUI/interactive 표면이라
  이 repo 의 자동 smoke 가 아니라 operator-hand validation 축.
- UDS wire (`peerProtocol=1` 계열)는 line-delimited JSON (`type: "user" |
  "control"`, connect → write `\n` → close) 로 보임. Primitive 자체는 pi
  entwurf-control socket 과 닮았지만, Claude Code process 가 실제로 소비하는
  `messagingSocketPath` 를 소유해야 addressable 이다.
- 중요한 경계: `~/.claude/sessions/<pid>.json` 만 보고 우리가 임의 socket 을
  만들어도 Claude Code 가 그 socket 을 읽지 않는다. 그것은 identity/registry 를
  합성할 수는 있어도 receive transport 를 만들지는 못한다. 임의 proxy/daemon 으로
  메시지를 받아 tmux/PTY 에 주입하기 시작하면 #8 second-harness 경계로 들어간다.
- UDS protocol reverse engineering 은 gray / brittle. 우선순위는 낮음. 먼저
  operator-hand validation 으로 bg/daemon/remote-control 모드에서
  `messagingSocketPath` 가 실제로 생기는지 짧게 확인하고, 발견은 design input
  으로만 다룬다. 현재 방향은 UDS receive transport 를 직접 쓰는 것이 아니라,
  Claude Code 공식 hook surface 를 경유하는 wake path — 아래 Design archive.

#### Design archive — receiver wake path: MCP mailbox + Claude Code `asyncRewake`

2026-05-17 추가 조사 입력:

- Claude Code hooks 의 command hook 에는 `asyncRewake: true` + exit code `2`
  패턴이 공식 wake primitive 로 존재. Idle Claude Code 세션을 깨우고
  hook stdout/stderr 를 system reminder 로 전달한다. 단 command hook 한정,
  async hook dedupe 없음 → watcher singleton lock 필수.
- Prior art: `sanztheo/claude-intercom` 은 MCP server + filesystem inbox watcher +
  `asyncRewake` 로 Claude Code instance 간 messaging 을 구현. 그대로 복사하지
  말고 pi-shell-acp invariant 에 맞춰 구조만 검토.
- Mental model 정정: "every harness owns its input boundary" 는 유지된다. 다만
  Anthropic 이 Claude Code owner 로서 hook `asyncRewake` 라는 공식 ingress 를 이미
  열어둔 것. 우리가 PTY 키 주입 / transcript JSONL 직접 수정 / `claude --resume`
  별도 프로세스 주입을 하지 않는 한 #8 second-harness 위반이 아니다.

안전한 구조 후보:

```text
entwurf_send(target=claude-code:<id>)
  -> MCP server writes JSON message into target mailbox
  -> Claude Code command hook watcher sees unread file
  -> watcher exits 2 with minimal reminder (no message body)
  -> Claude wakes and calls MCP peek
  -> Claude handles message, then ack/reply
```

원칙:

- **Hook = wake only, MCP = content authority.** Hook stdout/stderr 에 메시지 본문을
  싣지 않는다. Reminder 는 "MCP peek 를 호출하라" 는 최소 신호만.
- **Transcript JSONL direct write 금지.** 관측/복구/세션 식별용이지 입력 큐가
  아니다.
- **`claude --resume` 별도 프로세스 주입 금지.** 같은 세션 transcript interleave
  위험 + 현재 떠 있는 세션 wake 목적과 다름.
- **Stop `decision:block` 은 좁게.** 모든 unread 에 block 을 걸면 stop loop 위험.
  후보: `wants_reply: true` / high-priority message 에만 block, 나머지는 watcher
  wake 로 처리.
- **PreToolUse 는 noisy.** `matcher: "*"` 는 high-frequency tool loop 에 system
  reminder 잡음을 만든다. 후보: 생략하거나 `mcp__pi-tools-bridge__*` 류로 좁힘.
- **Global hook merge 주의.** agent-config 의 기존 Claude hooks (`peon.sh`,
  `hook-handle-use.sh`, PreCompact 등) 와 exit code / matcher 충돌 없이 설치해야 함.

Endpoint Envelope dispatch 후보:

```text
entwurf_send(target)
  ├─ pi:<sessionId>           -> ~/.pi/entwurf-control/<sessionId>.sock
  └─ claude-code:<sessionId>  -> mailbox write + asyncRewake watcher
```

`transport.kind` 가 dispatch key. `entwurf_self` 의 미래형은 current endpoint
identity 를 반환하되, `replyable` / `wakeable` / `returnHint` 를 분리한다.

타이밍: 지금 바로 구현하지 않는다. Step 3a 한 달 fast iteration 으로 push receive
실수요를 먼저 측정한다. 실제로 "편지함이 없어서 막힌" 사례가 누적되면 prior art
검토 → 최소 experimental surface 로 구현. 실수요가 약하면 design archive 로 보존.

### Step 3 — 실사용 + 반복 검증으로 박기 (현재 priority)

원칙: **"한 두 번 검증" 으로 끝내지 않는다.** 1차 실사용에서 발견한 패턴을 즉시
자동 smoke 로 박아 (a) 한 달 sprint 동안 회귀 방지, (b) 미래 사용자가 같은
path 를 손 없이 검증 가능.

#### 3a. 1차 실사용 — 정한 본인 손 (fast iteration, 데이터 누적)

1. ✅ Claude Code MCP catalog 등록 — README Wiring 섹션 (2026-05-17, `claude mcp add`)
2. ✅ `~/.mcp.json` SSOT 분리 — env 라벨 (`external-mcp/claude-code`)
3. ✅ Caller patterns propagate — `agent-config/home/AGENTS.md` 의 "External MCP caller patterns — Asymmetric Mitsein" 섹션
4. 🟡 pi sessionId 포함 task spec 템플릿 정립 (실사용에서 자연 형태 잡힘)
5. 🟡 tmux 또는 복붙으로 Claude Code Opus 에 던지기
6. 🟡 Opus 가 `entwurf_send` 로 pi 에 결과 보내는지 — 자연어 trigger phrase 어떤
   표현이 잘 동작하는지 데이터 누적

각 단계에서 터지는 표면 발견 → 본 섹션 또는 follow-up 으로 누적. 어떤 자연어
표현이 caller patterns 와 정합하지 않는지, 어떤 마찰이 회귀로 박혀야 하는지
실사용 데이터가 SSOT.

#### 3b. End-to-end smoke 자동화 — `./run.sh smoke-external-mcp`

3a 의 데이터가 어느 정도 누적된 후 작성. 기존 `mcp/pi-tools-bridge/test.sh`
18/18 와 분리 — test.sh 는 process-level unit, 이 smoke 는 라이브 pi 세션
포함 end-to-end.

검증 case 5개:

| # | 호출 | 기대 |
|---|------|------|
| 1 | `entwurf_self` (no `PI_SESSION_ID`) | throw `EntwurfEnvelopeWiringError` |
| 2 | `entwurf_peers` (live pi 세션 backgrounded) | 라이브 sessionId 1개 이상 |
| 3 | `entwurf_send` (sessionId from #2) | success (`[entwurf sent →]` delivery result). origin/replyable assertion은 receiver side 에서 확인 |
| 4 | `entwurf_send` + `wants_reply=true` | reject — 정확한 error message |
| 5 | live pi 세션의 receiver transcript | `[entwurf received ⟵]`, `from: ... [external MCP]`, `sessionId: external-mcp  (non-replyable)` |

자동화 한계 — Claude Code 자체와의 통합 (자연어 → 도구 호출 사상의 정확성) 은
Claude Code LLM 판단 영역, 자동 smoke 영역 아님. 우리 자동화는 MCP server
end-to-end 까지. Claude Code 행동 유도는 caller patterns (AGENTS.md) 로.

진입 조건: 3a 의 1차 실사용에서 trigger phrase / 마찰 패턴 데이터 누적된 후.
없이 작성하면 "써본 적 없는 surface 위의 가짜 smoke" 가 됨.

산출물: `run.sh` 의 새 entry + `scripts/smoke-external-mcp.ts` (또는 .sh).
session-messaging smoke 와 같은 격으로 묶기.

#### 3c. Demo 자료 — Asymmetric Mitsein 라이브 (선택)

3b 의 smoke 가 stable 해진 후, 데모 GIF / asciinema 1분 분량.
`docs/assets/pi-shell-acp-asymmetric-mitsein.gif` 후보. README Entwurf
섹션의 entwurf demo GIF 와 같은 격.

### Step 4 — 다음 한 걸음

3a 데이터 누적 → 3b smoke 작성 → 3c demo. 셋 안정되면 Phase 2 (pi.dev
패키징) 작업으로 복귀. Phase 2 의 `packages.md` 4-axis verification 안에
`smoke-external-mcp` 도 자연스럽게 흡수.

## Strategic Frame — 정공법 4-Phase (2026-05-15 재정렬)

> 결정 (2026-05-15 GLG):
> **(1) pi.dev 정식 등록 / OpenClaw ClawHub 정식 등록 — 둘 다 정공법.**
> 준비 과정에서 repo 정리, 재현 가능 설치면, 문서 기준이 올라간다.
> pi-shell-acp 를 신뢰 못 하면 OpenClaw 도 절대 등록 안 해 준다.
>
> **순서 (2026-05-15 GLG 갱신):**
> 1. **OpenClaw 측을 프리릴리즈로 우리 리포에 품는다.** 수동설치 가능 형태 (`monorepo lite`, `plugins/openclaw/`). **npmjs 정식 배포 아님.**
> 2. **Oracle 에 install → daily-use 검증.** pi-shell-acp + OpenClaw 서포트 함께 동작 걸어놓기.
> 3. 그 다음 **pi.dev 패키징 준비** — 검증된 surface 를 정식으로 packaging.
> 4. OpenClaw ClawHub 정식 등록.
>
> 원칙: **검증된 것을 패키징한다. 안 된 것 패키징 안 한다.**
>
> 시간 압박: pi-shell-acp 동작 보면 누가 먼저 OpenClaw 에 올릴 수도 있다. 지금은 pi.dev 등록 안 되어 몰라서 안 쓸 뿐.

### Install 모델 — 두 단계 분리 (agent-config 담당자 발견, 2026-05-15)

GLG 의 비전 ("`openclaw plugins install pi-shell-acp` 한 줄") 은 최종 목표. 현재는 사전 단계.

| 단계 | Install 모델 | 사용자 경험 |
|------|-------------|------------|
| **Phase 1 (현재 prerelease)** | **혼합 install** — "OpenClaw adapter → child `pi` → pi-shell-acp" 구조. plugin 자체는 standalone JS (`dependencies: {}`), child `pi` binary 를 spawn. container 에 `pi binary` + `pi install git:...pi-shell-acp` 별도 사전 설치 필요 | Docker image 빌드 시 3-layer 설치, plugin 설치는 그 위에. GLG 한 줄 비전 *아님* |
| **Phase 3 (최종 UX)** | **self-contained plugin** — plugin package 가 bridge runtime 을 직접 품음. `acp-bridge.ts` workspace dep import, child `pi` binary 의존 제거 | `openclaw plugins install @junghan0611/openclaw-pi-shell-acp` 한 줄로 끝. GLG 한 줄 비전 |

→ **Phase 1.4 (ts refactor) 의 long-term goal = self-contained 으로 가는 첫 발걸음**. 그 단계가 끝나야 Phase 3 의 UX 가능. 현재 Phase 1 결과를 "self-contained UX 가 안 됨" 으로 읽지 말 것 — 단계 정의상 아직 아님.

| Phase | 이름 | 진입 조건 | 산출물 |
|-------|------|----------|--------|
| **0** | Validation 닻 | — | 6축 GREEN + 5.12 baseline GREEN + install scanner trust model + dep bump (`ffdf192`) — 완료 |
| **1** | **0.6.0 개발 release** — OpenClaw 검증 ✅ + Claude Code 연동 sprint | Phase 0 완료 (✅) | OpenClaw plugin 프리릴리즈 (✅ Phase 1.8/1.9, Oracle daily-use) + Asymmetric Mitsein sprint (6/15 billing 대비, Immediate Priority SSOT). **기능 추가는 여기서 닫음** — 다음 phase 부터 리팩토링/정리 |
| **2** | pi.dev 패키징 준비 (**리팩토링/정리**) | Phase 1 의 0.6.0 안정화 | `packages.md` 룰 기준 packaging — `pi.extensions` manifest, `files` allowlist, `typebox` peer dep, 4-axis tarball verification. #15 stabilization 통합. **새 기능 X — 본질은 설치 쉽게 만드는 리팩토링.** Sprint 의 `smoke-external-mcp` 도 4-axis 안에 흡수. **pi.dev 등재 push 는 GLG 직접 결정.** |
| **3** | OpenClaw ClawHub 정식 등록 (**리팩토링/정리**) | Phase 2 안정 + ClawHub trust path | `@junghan0611/openclaw-pi-shell-acp` npm publish → ClawHub 등록 → `dangerouslyForceUnsafeInstall` flag 없이 `openclaw plugins install <pkg>`. **새 기능 X — packaging UX 정리.** |

각 phase 의 commit 은 별도. push 는 GLG 가 결정.

---

## Phase 0 — Validation 닻 (✅ 완료)

> 검증 끝. 새 일 만들지 않음. 다음 phase 들의 출발선.

### 검증 통과선 — 6축 전부 GREEN

| 축 | 결과 | 닻 |
|----|------|---|
| 1 / 1b — E2E reply (wire-up + real transport) | ✅ | stub end-to-end + 진짜 sonnet PONG (input=3 output=6 cacheRead=7135) |
| 2 — workspace 인식 | ✅ | `-c <workspace-lab>` → IDENTITY.md/AGENTS.md 응답 의미 수준 반영. persona 일관성까지 살아있음 (sonnet 이 prompt injection 의심하여 거부) |
| 2.5 — browser E2E | ✅ | Gateway 18789/18791 live. 사용자 직접 대화 성공 |
| continuity — Turn 연결 | ✅ | `buildConversationPrompt` 로 `ctx.messages` serialize. **OpenClaw 가 conversation history SSOT** |
| 세션 자기인식 | ✅ | 자식 sonnet 이 "openclaw-control-ui", "pi-shell-acp ACP 브리지" 까지 정확히 자기 설명 |
| 3a / 3b — skill manifest + invocation | ✅ | 40+ skill 자율 분류 나열 + `gogcli` + `denotecli` 병렬 호출 → 실제 Terminal 실행 → 통합 응답 |

acpx 가 자기 1.0 도 못 넘은 자리에 6.0 까지 도달. (b3a) plugin-only 가설 라이브 증명 완료.

### 5.12 baseline 재검증 (2026-05-15, OpenClaw 측 담당자)

5.7 → 5.12 한 점프. 두 단계 검증:

**오전 — 11단계 chain CLI re-verify**: 전부 GREEN 재현. 불변량 살아있음:
- `Model<Api>` 시그니처 / `api: "pi-shell-acp"` literal chain / `ProviderPlugin` SDK 표면.
- 새 hook 3개 (`normalizeProviderResolvedModelWithPlugin`, `applyProviderResolvedTransportWithPlugin`, …) 와 `staticCatalogModel` fallback 은 우리 path 비통과 (models + streamSimple 직접 등록 경로).
- pi-ai scope 리네임 `@mariozechner/*` → `@earendil-works/*` — pi-shell-acp 본체는 이미 `@earendil-works/pi-ai@0.74.0` 사용 중이라 align 됨.

**오전 — 브라우저 풀세트 GREEN (5.12 + f066dd2)**: 어제 6축이 5.12 위에서도 살아있음. 자식 sonnet 이 IDENTITY.md / MEMORY.md / AGENTS.md (Being Data 표 포함) 응답 의미 수준 반영, `~/.openclaw/workspace-lab` 자기 위치 인지, "evidence-first language" 룰까지 자식까지 흘러감 ("Sonnet 인지 직접 조회 못 함" 솔직 메타-인지). status bar 표시:

```
🦞 OpenClaw 2026.5.12 (f066dd2)
🧠 Model: pi-shell-acp/claude-sonnet-4-6
↪️ Fallback: openai-codex/gpt-5.5 (selected model unavailable)
🧮 Tokens: 8.9k in / 398 out · Cache 31% hit
📚 Context: 8.9k/200k (4%) · Compactions: 0
```

### Step 0 부산 발견 (Phase 1~3 비용 흡수)

5.12 위에서 새로 박힌 사실 한 줄: **Install scanner = production trust gate**.

| 사실 | Phase 3 함의 |
|------|--------------|
| `child_process` 사용 → 5.12 default block (`install-security-scan.runtime.ts`) | flag 없는 install UX 가려면 **정식 등록만이 답** |
| Bypass 경로 = (A) `dangerouslyForceUnsafeInstall` (운영자 escape, 사용자 권장 불가) / (B) `trustedSourceLinkedOfficialInstall` (marketplace/ClawHub) | 권장: **(B) + SDK sanctioned spawn helper** 동시 추진 |
| `@openclaw/plugin-sdk/*` 에 sanctioned ACP transport / subprocess spawn helper 가 있는가? | 미확인 — 없으면 SDK enhancement PR 이 Phase 3 부속 작업 |
| 5.12 status bar 의 `Fallback: openai-codex/gpt-5.5 (selected model unavailable)` 표시 | 정보성 — 실제 라우팅은 sonnet GREEN. entwurf target registry 의 unavailable 마킹 또는 모델 카탈로그 env-var 평가일 가능성. 5.12 신규 status bar 항목 인지 |

기존 발견들도 그대로 살아있음 (`resolveSyntheticAuth` 훅, `AssistantMessageEventStream` class, session JSONL 자연 영속, `plugins.allow` hygiene, cwd 전달, `pi --session` 시멘틱 갭, `ctx.messages` SSOT, OpenClaw timestamp prepend, sandboxed worker context).

### Phase 0 closeout — dep bump (`ffdf192`, 2026-05-15)

issue #16 turn lifecycle bug 처방으로 ACP backend dep 일괄 갱신 — Phase 1 진입 전 baseline 정비:

- `@agentclientprotocol/claude-agent-acp` `0.32.0` → **`0.33.1`** — 상류 `0.33.0` commit `dba1998` / PR #627 "Handle result origins in ACP agent". `isTaskNotification = message.origin?.kind === "task-notification"` 도입, 네 가지 stopReason 대입 + local-slash-command result forwarding 게이트. `usage_update._meta._claude/origin` forwarding 신규. 0.32.0 에서는 task-notification followup 의 stop_reason 이 user-turn lifecycle 을 오염시킬 수 있었음. `event-mapper.ts` 코멘트 `0.33.0+` 로 정정
- `@zed-industries/codex-acp` `0.13.0` → **`0.14.0`** — codex 0.129, exec output delta O(N²) memory fix, image-generation tool call emit
- `@google/gemini-cli` `0.42.0` PATH runtime 그대로. `homedir()` body 미변경 확인 (`bundle/chunk-ECNYAST2.js:41713-41719`) — overlay path-resolution invariant 손대지 않음
- 검증 통과: `pnpm typecheck/lint`, `check-{dep-versions,backends,mcp,models,registration,sdk-surface}`, `smoke-{claude,codex,gemini}` 모두 `stopReason = end_turn` + 텍스트 emit 정상
- 잔여 gate (Phase 1 이후 또는 별도): task-notification 재현 smoke, cancel 후 same-session reuse smoke, empty-aborted assistant surface regression test. evidence bundle `.agent-reports/issue-16-019e28b9/` gitignore 유지

이로써 **Phase 0 완전 종료**. Sonnet 6축 GREEN + 5.12 baseline + dep bump 까지. Opus turn lifecycle 검증은 Phase 1 의 Oracle baseline 안에서 자연 확인.

---

## Phase 1 — 0.6.0 개발 release: OpenClaw 검증 ✅ + Claude Code 연동 sprint (✅ 0.6.0 cut 2026-05-17 · Step 3 operational validation 계속)

> 결정: **0.6.0 = 개발 release**. 두 축이 합쳐서 닫힘:
> 1. **OpenClaw plugin 프리릴리즈** — 수동설치 (git-local / tarball), npmjs publish 안 함, Oracle daily-use 검증 (✅ Phase 1.8/1.9, 2026-05-15)
> 2. **Claude Code 연동 (Asymmetric Mitsein sprint)** — 6/15 Anthropic billing split 대비, 현재 진행 (Immediate Priority 섹션 SSOT)
>
> 0.6.0 의 의미: **기능에 대한 것은 여기서 닫음**. 다음 phase 부터 packaging
> 리팩토링/정리 (필요시 수정 / 간단 기능 추가는 있을 수 있음, 본질은 정리).

### Phase 1 구조 — Monorepo lite

```
~/repos/gh/pi-shell-acp/
├── package.json              ← root, pi-shell-acp 그대로 (pi 의 extension)
├── pnpm-workspace.yaml       ← NEW (1줄: packages: ["plugins/*"])
├── index.ts                  ← pi extension entry 그대로
├── pi-extensions/            ← 그대로
├── acp-bridge.ts             ← workspace dep 으로 plugin 이 재사용. 감사성 강화는 Phase 2 #15
└── plugins/
    └── openclaw/             ← NEW. host 어댑터. @junghan0611/openclaw-pi-shell-acp
        ├── package.json
        ├── openclaw.plugin.json
        ├── src/index.ts      ← lab dist/index.js 의 working code 옮김 (Option A)
        ├── dist/             ← gitignore. tsdown / direct build output
        ├── README.md         ← acpx alternative narrative, pi 단어 zero
        └── AGENTS.md         ← canonical owner / Plugin Path / Boundary
```

**디렉토리 명명 근거**: 우리는 *pi 의 extension* (= pi 의 patchage). 그 위에 *host 어댑터* 가 plugin. 따라서 `packages/` 는 어휘 충돌 (pi 자체의 package 어휘와) — `plugins/` 가 의미상 깔끔. 미래 `plugins/{cursor,zed-native,continue,...}` 자연 확장 비용 0.

### Phase 1 작업 묶음

| # | 작업 | 비고 |
|---|------|------|
| 1.1 | `pnpm-workspace.yaml` (`packages: ["plugins/*"]`) | monorepo lite 진입. 미래 plugin 자동 감지 |
| 1.2 | `plugins/openclaw/package.json` — name `@junghan0611/openclaw-pi-shell-acp` (private 표시 가능), peer `openclaw >=2026.5.12 <2026.6.0`. **현재 (prerelease stub) = `dependencies: {}`** — `src/index.js` 가 standalone JS. **Phase 1.4 의 ts refactor 후** dep `@earendil-works/pi-ai@0.74.0`, managed peers `claude-agent-acp@0.33.1` / `codex-acp@0.14.0` / `@google/gemini-cli` 박힘. 버전은 Phase 0 dep bump 의 root `package.json` 과 동일 pin (현재 root: claude-agent-acp 0.33.1, codex-acp 0.14.0 — 일치 확인됨) | 현재 stub vs Phase 1.4 target 분리 |
| 1.3 | `openclaw.plugin.json` — manifest. `providers: ["pi-shell-acp"]`, `setup.providers[].envVars: [ANTHROPIC_API_KEY, GEMINI_API_KEY, ...]`, configSchema (mcpInjection `self`, lockConflictPolicy `strict`) | OpenClaw 룰 따름 |
| 1.4 | `src/index.ts` — `definePluginEntry → registerProvider("pi-shell-acp", { models, staticCatalog, streamSimple: createStreamFn(ctx), resolveSyntheticAuth })`. **stub 의 production-grade 정리**: (a) cwd 전달 / (b) ctx.messages serialize / (c) PI_SESSION_ID env / (e) timestamp wrapper strip 또는 frame / (f) console.log only (no writeFileSync). **추가 후보**: STUB_MODELS 의 contextWindow / maxTokens 를 root `index.ts` 의 curated 정확값으로 정합 (현재 gpt-5.4 등 일부 200k placeholder, 본체는 272k). **Long-term path** — `acp-bridge.ts` 를 workspace dep 으로 직접 import 가능해지면 child `pi` binary 의존 자체 제거 가능 (담당자 검수 발견) | 어제 Phase 0 검증 8가지 부산 발견 + stub catalog 정합 + pi binary 의존 제거 long-term |
| 1.5 | `tsdown` 빌드 + watch mode + `~/.openclaw/extensions/pi-shell-acp` symlink fast iteration | **1.4 의 산출물 build step. 1.4 전엔 no-op** — 현재 `src/index.js` 가 manifest `extensions` 의 직접 entry, build 단계 없음 |
| 1.6 | `plugins/openclaw/README.md` — acpx alternative narrative. **pi 단어 마케팅 zero**, 클로드코드 구독 멘트 금지. 사용자가 본인 API key 사용한다는 명시 | 공개면 가드레일 |
| 1.7 | 수동설치 가이드 정리 — `openclaw plugins install <local-path>` with `--dangerously-force-unsafe-install` 필요 (5.12 install scanner block 회피). **이건 PoC / Oracle 검증용 only**. Phase 3 ClawHub 등록 후엔 flag 불필요 | 5.12 trust gate 사실 명시 |
| **1.7.1** | **Docker auth boundary + 잔여 housekeeping** — (a) `plugins/openclaw/README.md` 에 새 "Docker boundary" 섹션 (host passthrough vs in-container login, public default = in-container login). (b) `plugins/openclaw/AGENTS.md` maintainer 룰 갱신. (c) 잔여 housekeeping: R1 `stream/` 빈 dir 제거, R3 AGENTS "Purpose" 현재 vs Phase 1.4 layout 명시, R5 README Limitations 의 DIAGNOSTIC stdout 한 줄, R6 `src/index.js:60` `_EventStream` 의 Phase 1.4 교체 주석, R7 manifest `piBinaryPath` description 정확화. (d) 루트 README/AGENTS 의 monorepo + deployment-surface-agnostic 한 줄씩 (별도 commit). **§Docker auth boundary 참고** | Oracle = Docker 환경 발견 (2026-05-15) + Claude Code 리뷰 R1/R3/R5/R6/R7 흡수 |
| 1.8 | ✅ Oracle install + daily-use 시작 — pi-shell-acp 본체와 openclaw plugin 동시 install. 일상 사용 중 발견 문제 → llmlog / NEXT 로 환류 | **Phase 1 keystone GREEN (2026-05-15)**. Oracle Docker β 경로에서 `glg-b-bot` direct DM 성공: 최신 plugin load path `4e8237c`, spin-loop fix + delivery bridge 확인, child pi clean exit/finalize, Telegram `sendMessage ok`, bbot workspace/SOUL/USER/memory read, 자연어 응답. 남은 건 runtime unblock 이 아니라 UX/prompt hygiene |
| 1.9 | ✅ Opus turn lifecycle 재검증 (Phase 0 dep bump 결과 확인) — Oracle 에서 Opus 모델로 짧은 대화 가능한지 | `pi-shell-acp/claude-opus-4-7` on Oracle bbot direct DM GREEN. `/status` shows OpenClaw 2026.5.12, Runtime OpenClaw Pi Default, Context 20k/1.0m, Compactions 0 |
| 1.10 | OpenClaw SDK 의 sanctioned spawn helper 존재 여부 확인 (`@openclaw/plugin-sdk/*`) | Phase 3 의 ClawHub trust path 입력 |

### Phase 1 안 만지는 영역

- pi.dev manifest (`pi.extensions`) / `files` allowlist / `typebox` peer dep — Phase 2
- acp-bridge.ts 분할 / #15 stabilization refactor — Phase 2
- npm publish, ClawHub 등록 — Phase 2 / 3

### Phase 1 의 Phase 0 발견 8가지 반영 — 한 줄 매핑

| 발견 | Phase 1 어디서 풀림 |
|------|--------------------|
| #1 staticCatalog `models list` 표면 안 됨 | 1.6 README 에 모델 ID 목록 명시 |
| #2 `resolveSyntheticAuth` 훅 | 1.4 plugin index.ts 안에서 닫힘 |
| #3 `AssistantMessageEventStream` class 인스턴스 | 1.2 `@earendil-works/pi-ai@0.74.0` dep, `createAssistantMessageEventStream()` 사용 |
| #4 session JSONL 자연 영속 | 1.4 lockConflictPolicy 가 이 trail 위에서 작동 |
| #5 `plugins.allow` hygiene | 1.6 README install 가이드 한 줄 |
| #6 cwd 전달 (`ctx.workspaceDir → spawn cwd`) | 1.4 |
| #7 `ctx.messages` SSOT serialize | 1.4 (b) — 어제 GREEN 닻 그대로 |
| #8 sandboxed worker context (writeFileSync silent fail) | 1.4 (f) — console.log only |

### §Docker auth boundary (Oracle = Docker 환경 발견, 2026-05-15)

> **배경.** Oracle 의 OpenClaw 는 Docker 컨테이너 안에서 동작 — 우리 측 (thinkpad lab 검증) 에서는 이전에 인지 못 함. 5.12 에서 OpenClaw 가 host codex auth → docker passthrough 작업했고, 같은 패턴이 Claude Code 에도 적용 가능한가의 결정. **pi-shell-acp 측 코드 변경 0** — 우리는 deployment surface 무관, backend CLI 의 auth state 가 SSOT.

#### 결정 — 두 갈래

| 선택지 | 사용자 | 명령 / 설정 | 우리 plugin 위치 |
|--------|-------|------------|----------------|
| **A. host passthrough** (advanced) | trusted single-user (개인 운영자, Oracle 본인) | compose volume `~/.claude:/home/node/.claude` (rw). host Claude Code 가 이미 로그인된 상태 | README 의 **Advanced** section. opt-in 만 |
| **B. in-container login** (**public default**) | 일반 공개 사용자 | compose volume `openclaw-claude-home:/home/node/.claude` (named volume). `docker compose exec openclaw-gateway claude login` 으로 컨테이너 내부 인증 | README 의 **Requirements** + **Docker boundary** 기본 권장 |

#### pi-shell-acp 측 invariant — 변함 없음

- `pi-shell-acp does not provide Claude credentials, tokens, or subscription access.` (README#15 기존 문구)
- `does not extract tokens, proxy OAuth, or emulate Claude Code.`
- 우리는 `$HOME/.claude` 또는 `CLAUDE_CONFIG_DIR` 환경만 가정. 그 안의 내용 / refresh / mount mode 는 사용자 책임.
- **deployment surface (Docker / native / SSH) 와 무관.** invariant 는 backend CLI 의 auth state 가 어디서 읽히는지 보지 않음.

#### 1.7.1 작업 영역 (코드 변경 0)

- `plugins/openclaw/README.md` — 새 **"Docker boundary"** section. 위 두 갈래 표 + 명령 예시. **B (in-container login) 가 default 권장**, A (host passthrough) 는 "trusted single-user, opt-in" 라벨.
- `plugins/openclaw/AGENTS.md` — maintainer 룰. host passthrough 가 trusted boundary 임을 명시. `Mounting host auth is sensitive and means the container is trusted.` 같은 문장.
- Root `AGENTS.md` (선택, 작은 추가) — invariant 섹션에 "deployment surface 와 무관" 한 줄.

#### OpenClaw 측 협의 영역 (별도)

- OpenClaw 의 compose 기본값 — `~/.claude:/home/node/.claude` rw 가 dev 편의용 default 인지 검토. 공개 install 가이드에서는 in-container login 을 기본으로 내려야 함.
- Claude Code auth refresh 가 read-only mount 에서 깨지는지 검증 필요.
- pi-shell-acp plugin 이 missing auth 일 때 명확한 에러 (이미 commit `340e58f` 의 error event push 로 일부 해소).

#### child_process trust model — Phase 별 SSOT

5.12 의 `install-security-scan.runtime.ts` 가 `child_process` 사용 시 default block. 우회 경로 3개를 phase 별로:

| Path | 설명 | 어디서 박혔는가 |
|------|------|---------------|
| **(A) ClawHub 정식 등록** | `trustedSourceLinkedOfficialInstall` — production trust gate | **Phase 3 산출물** (`@junghan0611/openclaw-pi-shell-acp` npm publish + ClawHub 등록) |
| **(B) `--dangerously-force-unsafe-install` flag** | 운영자 escape, 일반 사용자 권장 불가 | **Phase 1.7 + plugin README** install 가이드. PoC / Oracle 검증용 only |
| **(C) SDK sanctioned spawn helper** | `@openclaw/plugin-sdk/*` 정식 entrypoint (존재 여부 미확인) | **Phase 1.10** (확인) → 없으면 OpenClaw 측 SDK enhancement PR 후보. (A) 와 병행 가능 |

세 경로가 한 곳에 모이지 않아 묻혔던 axis. (A) 가 종착점, (B) 가 PoC 단계 임시, (C) 가 (A) 와 병행 R&D.

#### Trigger

이 섹션은 **설치 에이전트가 작업 시 SSOT** — README/AGENTS 갱신할 때 위 표 + invariant 문구 그대로 옮긴다. 새 invariant 만들지 말 것, 기존 #15 의 boundary 가 deployment surface 무관임을 명시하는 갱신만.

### §Pi agent overlay boundary (어제 OpenClaw 담당자 + 오늘 agent-config 담당자 합본)

> **배경.** 어제 Phase 0 검증의 base 가 호스트 thinkpad 의 `~/.pi/agent/` 풀세트 환경. Oracle Docker default 는 그 overlay 없는 bare runtime. 즉 어제 6축 GREEN 중 일부는 갈래 가정 하에 작동. §Docker auth boundary 와 동일 격의 별도 boundary.

#### 두 axis 분리

| Axis | 내용 | 책임 | 어디 |
|------|------|------|------|
| **4a. Runtime overlay 보존** (recommended default) | child `pi` 가 `~/.pi/agent/*` 에 backend config overlay / session JSONL / resolver cache 자동 생성. named volume `~/.pi:/home/node/.pi` 로 영속화. 없으면 매 cold start 마다 regenerate (작동하지만 cache 손실) | 컨테이너 image / compose | 모든 non-throwaway 배포 |
| **4b. Host overlay passthrough** (advanced opt-in) | 호스트의 `~/.pi/agent/` 를 컨테이너에 bind-mount (ro 권장). capability 확장 — 호스트의 skill 카탈로그 / entwurf registry / journal index 접근 | 호스트 → 컨테이너 trust boundary | trusted single-user, pi 정식 사용자만 |

#### 어제 6축 검증의 갈래 가정

| 축 | 갈래 α (bare, public default) | 갈래 β (4b 활성) |
|----|-----------------------------|----------------|
| 1, 1b — E2E reply | ✅ | ✅ |
| 2 — workspace 인식 (OpenClaw 의 workspace-lab) | ✅ | ✅ |
| 세션 자기인식 | ✅ | ✅ |
| 3a — skill manifest 인식 | 🔴 `~/.pi/agent/skills/` 비면 자식이 "스킬 없음" 자기 보고 | ✅ |
| 3b — skill invocation | 🔴 manifest 없으니 호출 불가 | ✅ |
| 재귀적 자기 인식 (저널 인용) | **N/A** — 공개 사용자에 의미 없는 축 | ✅ GLG 본인 setup 만 |
| entwurf orchestration | **자연 차단 (의도된 invariant)** — `--no-tools --no-session`, §Entwurf scope | 같음 |

→ 갈래 α 의 진짜 작동 표면은 **dropdown 모델 + 기본 대화 + workspace persona**. skill 표면은 N/A. 이게 OpenClaw 사용자에게 정직한 default — §3.4 narrative 가드레일 (pi 단어 zero) 와 정합.

#### Trigger

설치 에이전트 / install 가이드 작성자가 SSOT. README/AGENTS 의 plugin Docker boundary 갱신 시 위 두 axis 표 + 갈래 가정 표 그대로 옮긴다. Phase 1.8 의 검증은 **α 먼저, β 별도 advanced smoke** 로 분리.

- Public default = 4a (named volume), backend auth = in-container login. **갈래 α 가정** — 검증 통과선은 1/1b/2/세션 자기인식 만.
- Advanced opt-in = 4b (host passthrough), backend auth = host passthrough. **갈래 β 가정** — 검증 통과선이 풀세트 (어제 6축).

#### β 사전조건 (2026-05-15 Oracle 라이브 검수 결과)

| # | 사전조건 | 상태 |
|---|---------|------|
| 1 | **호스트 pi-shell-acp 최신 commit** | ✅ 자동화됨 — `agent-config 5f17d70` main 추적. 2026-05-15 검증: plugin load path `/home/node/.pi/agent/git/.../plugins/openclaw` + `/home/node/repos/gh/pi-shell-acp` + `/home/junghan/repos/gh/pi-shell-acp` 모두 `4e8237c` |
| 2 | **UID 매핑** — `id junghan` uid 가 컨테이너 node user uid 와 일치 | ✅ 실사용 검증으로 통과 — bind mount repo/overlay 접근 + child pi cache/session write 정상 |
| 3 | **Docker compose 갱신** — 4b bind-mount + 3-backend auth volume (`~/.codex`, `~/.gemini` 추가; `~/.claude` 는 이미 rw mount) + image 3-layer (pi binary + codex-acp + gemini-cli + git) | ✅ Oracle 운영 gateway에서 11 plugins ready, `pi-shell-acp stub provider registered`, backend auth mounts 정상 |
| 4 | **4b mount mode** — rw 권장 (trust boundary 정의상). ro 는 child pi 의 cache/resolver write 시 첫 turn 깨질 risk | ✅ rw 운영 경로로 검증 |
| 5 | **검증 통과선 풀세트 6축 합의** | ✅ bbot direct DM: workspace/memory read + Opus response + Telegram delivery GREEN |

---

## Phase 2 — pi.dev 패키징 준비 (Phase 1 의 0.6.0 release 안정 후)

> `packages.md` 룰 기준. 검증된 pi-shell-acp surface 를 pi.dev gallery 등재 가능 상태로.
> #15 stabilization 통합 — **no-feature hardening, 본질은 리팩토링/정리.**
> 기능 추가는 Phase 1 의 0.6.0 에서 닫혔음 — Phase 2 작업 묶음 2.x 도 같은 톤
> (필요시 수정 / 간단 추가는 있을 수 있지만, 본질은 설치 쉽게 만드는 리팩토링).

### Phase 2 의 4-axis gap (`packages.md` 룰 vs 현재 package.json)

| gap | 작업 | 출처 |
|-----|------|------|
| `pi.extensions` manifest 키 없음 | `package.json` 에 `pi: { extensions: ["./index.ts"] }` 추가 | packages.md |
| `files` allowlist 없음 | tarball 에 runtime-critical 만 포함, dev residue 제외 (sample: pi-synthetic-provider `["extensions/", "README.md", "LICENSE"]`) | packages.md / #13 |
| `typebox` peer dep 없음 | `peerDependencies` 에 `"typebox": "*"` 추가 | packages.md |
| Gallery metadata (선택) | `pi-extension` keyword + `video`/`image` 필드 | packages.md |

### Phase 2 작업 묶음 (#15 + #13 + packages.md)

> **Status snapshot (2026-05-17 EOD)** — 12 patches landed across 12 commits (`050f66f .. 9899330`).
> - ✅ Closed: 2.1 (`050f66f` + `316b349` cast leak fix), 2.3 (`050f66f` dry-run + `9e2a2ca` actual/tar/install + `9899330` pi loader smoke), 2.4 (`050f66f` + `9e2a2ca` + `87fbd6e` test:pack alias), 2.5 (`d85e022` 3-path draft + `0212e4a` packages.md 4-path final + filter warning), 2.6 (`94d1f9d`), 2.9 (`5af72cc` release invariant checklist), 2.10 (정책 유지), 2.11 (`8efd39d`)
> - ↩️ Reverted to dense maintain: 2.2 (Node type-stripping `.js`→`.ts` gap vs `allowImportingTsExtensions` / `check_models` emit conflict; decision note in `74e92fb`)
> - 🐛 Bug fix: tarball `.cast` leak (`316b349`) — reviewer cross-check caught `docs/` directory allowlist pulling git-ignored asciinema recordings into npm pack
> - 🧹 Doc drift cleanup: `55178ce` (README codex + run.sh stale comments + NEXT count fix)
> - ⏸ Pending (operational, separate sprint): 2.7 (tmux/baseline/replicant/OpenClaw validation), 2.8 (#16 잔여 gate), 2.12 (smoke-external-mcp packaging verification)

| # | 작업 | 출처 |
|---|------|------|
| 2.1 | 위 4-axis gap 메우기 — `pi.extensions` / `files` / `typebox` / (선택) gallery | packages.md |
| 2.2 | `acp-bridge.ts` 감사성 강화 (no-behavior-change extraction) — `acp/backends/{claude,codex,gemini}.ts` / `acp/overlays/*` / `acp/{session-store,model-lock,compaction-policy}.ts` 분할. invariant 가시성이 떨어지면 분할 안 함. 공개 facade 는 `acp-bridge.ts` 유지 | #15 |
| 2.3 | Pack verification gates — `npm pack --dry-run --json` / `npm pack` / `tar -tf` / **로컬 install smoke from packed tarball** | #13 |
| 2.4 | `prepublishOnly` / `test:pack` 스크립트 — release sanity 자동화 | #13 |
| 2.5 | README install 표면 정렬 — public/stable (`pi install npm:pi-shell-acp`, 미래) / source (`pi install git:...`) / dev (local clone). evidence calibration 가시화 | #13 |
| 2.6 | Pi peer dep 범위 final 결정 — `@earendil-works/*` 의 `"*"` range 가 적절한지 vs `^0.74.0` 또는 `>=0.74.0 <0.75.0`. 다른 pi 패키지 sample 과 비교 | #13 |
| 2.7 | tmux automated demo, baseline verification, replicant verification — 진짜 gate 통과 | #15 |
| 2.8 | issue #16 잔여 gate 처리 — task-notification 재현 smoke, cancel 후 same-session reuse smoke, empty-aborted assistant surface regression test | Phase 0 closeout 잔여 |
| 2.9 | Phase 2 invariant 재확인 — "no Claude credentials / no subscription resale / no auth bypass / fail loudly / no hidden transcript restoration" | #15 |
| 2.10 | **publish 자체 보류** — 모든 gate 통과 후 GLG 가 직접 결정. publish 시점은 `pi install npm:pi-shell-acp` 가 진짜로 동작하는 그 다음 | #13 |
| 2.11 | **Codex resolve fallback** — `acp-bridge.ts` 의 codex spawn path 를 Claude 와 같은 `require.resolve("@zed-industries/codex-acp/package.json")` 우선, PATH fallback 패턴으로 정렬. root AGENTS.md Runtime Dependencies 갱신 + `check-dep-versions` 갱신. invariant #7 정합 + Docker 운영 단순화 부수 효과 | #15 hardening, three-backend equality |
| 2.12 | **Asymmetric Mitsein sprint 산출물 흡수** — Phase 1 의 0.6.0 sprint 3b 산출물 `./run.sh smoke-external-mcp` 가 Phase 2 의 4-axis verification 안에 묶임. packaging 된 pi-shell-acp 를 외부 사용자가 install 했을 때 Claude Code MCP catalog 연동이 packaging 위에서도 동작하는지 검증 — 0.6.0 의 두 축이 packaging 후에도 살아있음을 보장 | Phase 1 0.6.0 sprint 흡수 |

### Phase 2 sample 패키지 참고

가장 가까운 패턴 = **`@benvargas/pi-synthetic-provider`** (provider extension, scope 패키지, `files: ["extensions/", "README.md", "LICENSE"]`). 향후 multi-resource (skills + themes + commands) 가 되면 **mitsupi** 패턴 참고.

---

## Phase 3 — OpenClaw 정식 등록 (Phase 1 + 2 안정 후)

| # | 작업 | 트리거 |
|---|------|--------|
| 3.1 | pi-shell-acp pi.dev 등록 push | Phase 1 완료 |
| 3.2 | pi.dev 노출 후 버그 수정 사이클 | 사용자 피드백 |
| 3.3 | `@openclaw/plugin-sdk/*` sanctioned spawn helper 확인 + 필요시 SDK enhancement PR | OpenClaw 측 협업 |
| 3.4 | `@junghan0611/openclaw-pi-shell-acp` npm publish 준비 — Phase 1 의 pack verification gate 동일 적용 | Phase 2 의 Oracle baseline 안정 |
| 3.5 | ClawHub 정식 등록 → `trustedSourceLinkedOfficialInstall` 경로 통과 | 3.4 완료 |
| 3.6 | `openclaw plugins install @junghan0611/openclaw-pi-shell-acp` 한 줄로 끝나는 사용자 UX 검증 — **self-contained install 모델**. plugin package 가 `acp-bridge.ts` 를 직접 import 하여 bridge runtime 을 품음. child `pi` binary 의존 제거 (Phase 1.4 ts refactor 의 long-term goal). 4-layer install 사라지고 plugin 한 줄로 끝 | 3.5 완료 + Phase 1.4 self-contained 작업 |
| 3.7 | CHANGELOG 0.6.x entry + VERIFY 갱신 + invariant 보강 ("consumer 평면과 backend 평면 분리" + "Phase 1 혼합 install → Phase 3 self-contained 전환 framing") | 3.6 완료 |

---

## 확정 사실 모음

- **Plugin npm 이름**: `@junghan0611/openclaw-pi-shell-acp` (scope = 출처 + 책임 명확)
- **Plugin 디렉토리**: `plugins/openclaw/` (monorepo lite, `pnpm-workspace.yaml` `packages: ["plugins/*"]`). 의미: pi-shell-acp = pi 의 *extension*, plugins/openclaw = host 어댑터. `packages/` 어휘 충돌 회피
- **OpenClaw peer**: `>=2026.5.12 <2026.6.0`. 5.7~5.11 호환 포기
- **pi-ai dep (plugin)**: `@earendil-works/pi-ai@0.74.0` (5.12 align)
- **Plugin configSchema default**: `mcpInjection: "self"`, `lockConflictPolicy: "strict"`
- **Install trust path**: 정식 등록만. `dangerouslyForceUnsafeInstall` flag UX 사용자 권장 안 함
- **README guardrail (plugin 측)**: acpx alternative 톤, pi 단어 마케팅 zero, 클로드코드 구독 멘트 금지
- **README guardrail (root pi-shell-acp 측)**: "no core patch and no bypass" / MCP narrow surface / capability vs surface 명시 (이미 modified)

---

## Cross-repo follow-ups (별도 추적)

- **Issue #17 live validation (Oracle bbot)**: outbound message boundary normalize + plugin TS migration + workspace check guard + dist build pipeline + two-layer boundary fix (final-role guard / abnormal-flag 확장 / outbound text-only) landed on `main` (commits `6cea5c3` fix / `918f5ef` ci / `1c73569` dist / `fa3b8f7` two-layer). 1단계 streaming off 검증 통과 — DIAG 의 finalRole/finalTextLen/finalTextHead/partialTextLen/partialOverridesFinal/abnormal/timeoutFired 7필드 모두 정상 fire (정상 turn 에선 가드 unfire, role flip / SIGTERM 케이스용으로 잘 박힘). 남은 건 (a) 2단계 streaming on 검증 (partial 누적과 final 일치성) + (b) `[tool:trace]` inline 해소 (별도 항목 참고) → close
- **plugin spawn-level `showToolNotifications` invariant (0.6.0 publish 전 강화)**: child pi 의 ACP path 에서 `event-mapper.ts:166` 의 `pushNotice` 가 `[tool:start|done|failed|running|cancelled] {title}` 를 stream 의 text block 에 append — `showToolNotifications` true 일 때만 promote. default 는 `index.ts:621` 의 `merged.showToolNotifications ?? false`. Oracle 의 child pi global settings 에서 어딘가 true 가 들어와 trace 가 bot 답글 본문에 inline 되는 회귀. 임시 cover: Oracle workspace `.pi/settings.json` 의 `piShellAcpProvider.showToolNotifications: false` project override (nixos-config 측 처리). 정공법 follow-up: pi-shell-acp 의 settings resolver 에 env override 추가 (`PI_SHELL_ACP_SHOW_TOOL_NOTIFICATIONS=0` 등), plugin spawn 시 env 강제 set. 0.6.0 publish 후 외부 사용자의 global settings 가 어떤 값이든 plugin path 는 trace 안 보임 invariant 보장
- **Gemini bot usage 측정 OpenClaw 표시 갭**: bbot DIAG stderr 에 `meter=acpUsageUpdate ... used=24315 size=1000000 raw: input=13 output=591 cacheRead=54834 cacheWrite=14346` 가 정상 도착 — plugin 으로 usage 데이터 흘러옴. 그러나 OpenClaw status bar 의 `📚 Context: ?/200k` 로 표시 (`?`). 분석 영역: (a) plugin streamSimple 의 final message.usage 에 정확히 전달되는지, (b) OpenClaw status renderer 의 model picker 가 plugin provider 의 usage 매칭하는지 (provider id `pi-shell-acp` 로 lookup 시 missing 인가). 사용자 메모: "어제도 봤던 버그" — 알려진 잔존 이슈
- **pi CLI `--new-session` 표면 검토**: `pi -p "..." --session <new-id>` lookup-only. pi 자체 시멘틱 갭. pi-ai / pi-coding-agent 레벨 issue 후보
- **OpenClaw SDK sanctioned spawn helper 확인**: `@openclaw/plugin-sdk/*` 정식 entrypoints 에 있는지. 없으면 enhancement PR 후보
- **`ctx.messages` SSOT 모델 공식화**: plugin spec 으로 명시 가치 — 다른 backend (Codex/Gemini) 도 같은 모양 plug-in 가능
- **OpenClaw compose default 검토** (Docker auth boundary §): 공개 install 가이드의 기본 권장이 in-container login 인지 host passthrough 인지. Claude Code auth refresh 가 read-only mount 에서 동작하는지 검증. 우리 측 의견은 Phase 1 §Docker auth boundary 의 표 참고
- **Long-lived session 시 entwurf scope (Phase 1.4 또는 이후)**: plugin path 가 현재 `--no-session` 으로 entwurf 표면을 자연 차단. 미래 long-lived ACP session 으로 가면 두 갈래 결정 필요 — (I) entwurf 를 plugin 의 child pi 안에서 그대로 활성화 (isolated topology, root AGENTS.md #9 정합) vs (II) entwurf 호출을 OpenClaw peer API 로 forward (host-coupled, #9 위반). 현재 정책 = I. (II) 는 OpenClaw SDK enhancement 필요, 지금 결정 안 함. plugin AGENTS.md §Entwurf scope 참고
- **Telegram delivery bridge 정식화 (Phase 1.4)**: Phase 1.8 응급 다리로 child pi final text → synthetic OpenClaw `message` toolCall 변환을 stub 에 넣음 (`pi-shell-acp-message-*`, toolResult 후 즉시 `end_turn`). 2026-05-15 local Docker lab 에서 Oracle config 재현 — stuck 원인은 stdout parser 의 `continue` 전 `nl` 미갱신으로 message_update 첫 줄에서 busy loop → parent event loop block → child zombie/close 미발화. stdout loop fix 후 `openclaw agent --agent bbot ...` 5.4s GREEN, Oracle `glg-b-bot` direct DM GREEN (`sendMessage ok`, workspace/SOUL/USER/memory read, 자연어 응답 "응, 여기 있어 정한..."). 재현 Docker lab 은 `plugins/openclaw/examples/docker-lab/` 로 샘플화(토큰/세션/DB 제거). 정식 작업에서는 OpenClaw `context.tools`/provider tool surface 를 pi-shell-acp transport 에 연결하는 일반 tool bridge 로 승격. 지금 패치는 Telegram/message-tool-only path 를 뚫기 위한 prerelease shim. 남은 UX debt: tool trace 노출 / `<system-reminder>`류 prompt hygiene / `HEARTBEAT_OK` 같은 session sentinel 이 child prompt 에 섞이는 문제.
- **Oracle Docker image 3-layer install (Oracle config repo 측)**: openclaw-gateway 컨테이너에 `pi`, `pi-shell-acp`, `codex-acp`, `gemini` 추가. `git` system pkg + pnpm global. 자세한 layout 은 plugin AGENTS.md §Install layers. Phase 1.8 의 사전조건 — Oracle 측이 진행, 우리 측 plugin code 변경 없음
- **Codex resolve fallback (우리 측 — Phase 2 stabilization)**: 현재 root `AGENTS.md` Runtime Dependencies 는 `codex-acp` PATH-only. Claude 는 `package dep first, PATH fallback`. 비대칭 — invariant #7 (three-backend equality) 의 미세 위반. Codex 도 `require.resolve("@zed-industries/codex-acp/package.json")` 우선, PATH fallback 패턴으로 정렬. Docker 운영 단순화 부수 효과. Phase 2 의 #15 hardening 안에 흡수 (no-feature refactor 정신과 정합)
- **agent-config server-mode pi-shell-acp ref 복귀 (Phase 3 release 후)**: 현재 `agent-config 5f17d70` 가 server-mode 에서 main 추적 정책 도입 — Oracle 호스트가 우리 push 를 자동 follow. **0.6.0 prerelease / Oracle 검증 동안 임시**. Phase 3 의 pi.dev 또는 ClawHub 등록 후 release tag (`git:...pi-shell-acp@v0.6.0` 등) 로 다시 ref pinning 으로 복귀. 잊으면 server 가 영원히 main 추적 — release 후엔 안 좋은 정책

---

## 폐기 항목 (과거 framing 잔재)

- ~~OpenClaw upstream PR-1/2/3/aux~~ — 외부 플러그인이라 upstream 무관
- ~~`extensions/acpx/AGENTS.md` cross-ref~~ — upstream 안 건드림
- ~~labeler.yml / docs/plugins / CHANGELOG entry on OpenClaw side~~ — 전부 불필요
- ~~별도 repo (openclaw-pi-shell-acp)~~ — monorepo lite 로 결정. 동기화 비용 회피
- ~~"OpenClaw 담당자 측으로 ownership 전수"~~ — monorepo lite 라 ownership 이 pi-shell-acp 내부에 머무름. plugin code owner = pi-shell-acp maintainer (junghan0611). README narrative 가드레일만 OpenClaw user 시야 우선
- ~~`@mariozechner/pi-ai@0.73.0` pin~~ — 5.12 baseline 으로 `@earendil-works/*@0.74.0`
- ~~Phase 1 = pi.dev hardening 먼저~~ — 2026-05-15 GLG 재정렬. **검증된 것을 패키징한다**. Phase 1 = OpenClaw 프리릴리즈 + Oracle 검증 → Phase 2 = pi.dev 패키징 준비

---

## Reference docs (Phase 2 입력)

- **pi.dev packages 규칙**: [`~/repos/3rd/pi/pi-mono/packages/coding-agent/docs/packages.md`](file:///home/junghan/repos/3rd/pi/pi-mono/packages/coding-agent/docs/packages.md) — manifest 키, peer dep, files allowlist, source type 3종 (npm/git/local), gallery metadata
- **Sample 패키지 (`~/repos/3rd/pi/`)**:
  - `pi-packages/packages/pi-synthetic-provider/` — provider extension, scope 패키지. **가장 가까운 참고**
  - `agent-stuff/` (mitsupi) — multi-resource (extensions + skills + themes + commands). Phase 2 이후 확장 참고
  - `pi-telegram/` — minimal extension. 옛 `@mariozechner/*` peer 그대로 — 우리는 이미 align
  - `pi-packages/packages/{pi-firecrawl, pi-exa-mcp, pi-claude-code-use, ...}/` — 다양한 pi extension 패턴

---

## Parked, Not Current

- **#11** remote SSH resume cwd alignment
- **#10** broader ontology RFC (`peer handle`, `contact_peer`, registry). cwd-authority 부분은 0.4.17 landed
- **#8** ACP `entwurf_send` message visibility UX — 2026-05-16 commit `e31823c` 로 ACP path 의 late `[entwurf sent →]` customMessage 승격 비활성화 (post-stream box 가 sync tool 호출 후에 도착해 fresh send 처럼 보이는 회귀 정공). in-stream `[tool:start]/[tool:done]` notice 로 회귀. 재진입 조건: pi 가 in-stream passive UI append/update path 를 마련하면 다시 검토. native/tool-result path 의 receive-side renderer + `ENTWURF_SENT_MESSAGE_TYPE` context filter 는 유지
- **#2** pi-first context meter, post-0.5.0
- **L5 long soak** with repeated context-pressure events and sentinel recall, likely 0.6.x
