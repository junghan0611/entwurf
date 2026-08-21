# NEXT — #82 Copilot garden id 시민화 (branch lane)

> **이 주제의 산문은 이 파일 하나다.** 머지 전 삭제하는 disposable이다.
> 서사와 영수증은 이슈 스레드가 정본이다 — 특히
> [#82 comment 5363685118](https://github.com/junghan0611/entwurf/issues/82#issuecomment-5363685118)
> (인수·산출물·사고·남은 일). 여기는 **다음 한 걸음**만 든다.

레인: **Copilot이 garden id를 가진 가든 시민이 된다.** 근거는 GLG가 #82에 직접 쓴
코멘트 `5352330620` (2026-08-20T06:37:33Z) — GitHub 쪽을 맡기고 `auto`를 비용 레버로 쓴다.

2026-08-21 GLG가 레인의 종착점을 다시 세웠다: **"entwurf를 클로드코드에서 가능한 것과
같은 수준으로 끌어올린다."** 출생은 끝났고, 남은 것은 **손(MCP)** 과 **알림**이다.

---

# RAIL — 현재 좌표

- [x] **1. 측정 · 신뢰 규약** — Copilot 1.0.80 번들/훅 실측, 증거 태그 규약 수립
- [x] **2. 출생 구현** — 레지스트리 · 훅 유닛 · 설치/닥터 · 게이트
- [x] **3. §6 인수** — 실제 Copilot 세션이 시민이 됐고 footer에 자기 id를 찍는다
- [x] **4. 설치면 재현·역방향** — `91986c2`. install/uninstall/doctor + 15-check smoke
- [ ] **4b. adopt 멱등성** — 우리 것과 똑같이 생긴 **수동** 설정을 adopt할 때 preimage를 뭘로 잡나
- [x] **5. MCP 손 (outbound)** — `f1f26ce`. **LIVE 인수 통과** (아래 RECENT)
- [ ] **5b. sender identity** ← **CURRENT.** 읽기는 열렸고 **보내기가 막혀 있다**
- [ ] **6. 알림 (`agentStop`)** — 봉투·출력 계약 확정됨. **LIVE 1턴만 남음(GLG 승인)**
- [ ] **7. 등급 정정** — `DELIVERY.md`의 D0과 capability registry가 오늘의 사실과 다르다
- [ ] **8. 유휴 깨우기 (D4)** — **우리 몫이 아니다.** 번들에 메커니즘이 없다(아래 펜스)

현재 좌표: 5 완료 → **5b 진행**(sol에게 인계) · 4b는 형제 셋을 따라 (a)로 결론(RECENT) ·
6은 GLG의 LIVE 1턴 승인 대기 · 7은 5b·6 결과를 받아 마지막에 · 8은 벤더 대기

## 파리티 표 — "클로드코드 수준"이 정확히 무엇인가

`[코드]` 등급의 정본은 `pi/entwurf-capabilities.json`이다. Copilot만 `D0`, 나머지 넷은 `D6`.

| 축 | Claude Code | Copilot 오늘 | 우리가 할 수 있나 |
|---|---|---|---|
| 출생 (garden id) | ✓ | ✓ `20260821T091514-fb50b4` | 끝 |
| statusbar에 garden id | ✓ | ✓ `91986c2` | 끝 |
| `entwurf_*` 도구를 **부를 수 있음** | ✓ `~/.claude/settings.json` mcpServers | ✗ **`~/.copilot/mcp-config.json` 부재** | **가능 — RAIL 5** |
| 턴 끝 "편지 왔다" 알림 | ✓ `FileChanged`(`doorbell.sh`) | ✗ | **미측정 — RAIL 6** |
| 유휴 세션 깨우기 (D4) | ✓ `asyncRewake` | ✗ | **불가 — 번들에 없음** |
| `fresh_call` 대상 | ✓ `FRESH_CALL_BACKENDS` | ✗ | 8 이후 |

핵심: **`D0 → D6`의 거리는 하나가 아니라 셋이고, 셋 중 둘은 오늘 우리 손에 있다.**

# NOW

- **Current — RAIL 5b. 읽기는 열렸고 보내기가 막혀 있다.**
  `[측정]` Copilot이 `entwurf_peers`를 실제로 호출해 명단을 읽었다. `entwurf_v2`/`entwurf_self`는
  거절된다 — **그리고 그것은 설계된 동작이다.**

  **먼저 읽어라: `docs/external-mcp-host.md:9-10`.** 오늘 이 레인이 세 턴을 태워 재도출한 내용이
  거기 이미 쓰여 있었다:
  > *plain external MCP host*: no garden meta-record / sender marker. It can call the read
  > surfaces (`entwurf_peers`, `entwurf_inbox_read`), but `entwurf_v2` sends are **refused by
  > default** (#50 C4). / *garden-native native session*: a trusted lifecycle hook minted a
  > garden id and sender marker — `SessionStart` for Claude Code, `PreInvocation` for agy.

  **Copilot은 지금 첫 칸에 있다.** `[측정]` 그 문서는 copilot을 한 번도 언급하지 않는다(grep 0건).
  `[제안]` 실패한 것은 문서의 내용이 아니라 **도달 가능성**이다 — `AGENTS.md`도 이 파일도 그것을
  가리키지 않았다. **GLG 판단 대기: 지울 것인가, 가리키게 할 것인가.** 지우면 external vs
  garden-native 의미론과 익명 해치가 적힌 유일한 자리가 사라진다.

  **근인은 양쪽이 다 비어 있는 것이다.**
  - **쓰는 쪽** — `[코드]` `pi-extensions/meta-bridge-hook-copilot.ts:12-17`이 sender marker를
    의도적으로 안 쓴다. 그런데 그 근거가 *"도어벨이 없으니 receiver marker가 보증할 것이 없다"* 이고,
    **그 논리가 sender marker에 그대로 적용됐다.** 둘은 다른 것이다:
    `[코드]` `pi-extensions/lib/meta-sender-identity.ts:4-7` — sender marker가 요구하는 것은
    *"hook writes a marker keyed by ITS parent pid; the child looks it up under its own parent.
    **That shared ancestor is the join key**"* 뿐이다. **도어벨과 무관하다.**
  - **읽는 쪽** — `[코드]` `meta-sender-identity.ts:50`
    `META_SENDER_BACKENDS = ["claude-code", "antigravity"]`. copilot 없음.
    지금은 쓰는 쪽이 없으니 거짓은 아니지만, **둘 다 열어야 뚫린다.**

  **아직 안 잰 전제 하나 — 이것이 첫 수다.**
  `[코드]` `meta-sender-identity.ts:9` — *"Measured 2026-07-13 on **both backends**:
  hook.ppid == bridge.ppid == the native host pid"*. claude와 agy다.
  **Copilot에서는 한 번도 안 쟀다.** Copilot 훅은 `exec` 문자열로 뜨고 MCP 서버는 rust `rmcp`
  클라이언트가 띄운다. 둘의 부모가 같은 Copilot 프로세스인지가 join의 **유일한** 근거인데
  미측정이다. **이것이 거짓이면 marker를 써도 안 붙는다. 짓기 전에 재라.**

  **선택지 둘 — 오늘의 `replyable`은 둘 다 false로 같다.**

  | | `entwurf_v2` | 신원 | replyable | 드는 것 |
  |---|---|---|---|---|
  | **A. 해치** `ENTWURF_BRIDGE_ALLOW_ANONYMOUS_SENDER=1` | 열림 | 익명 `external-mcp` | false | mcp-config `env` 한 키. **새 코드 0줄** |
  | **B. sender marker** | 열림 | **garden id** | false (RAIL 6까지) | 훅 + `META_SENDER_BACKENDS` + 게이트 |

  `[코드]` **marker를 붙여도 replyable은 안 열린다** — `mcp/entwurf-bridge/src/index.ts:255-272`:
  `nativePushSupported(copilot)`가 false라 **self-fetch 도메인**으로 떨어지고,
  `readMetaReceiverMarker`를 요구하는데 Copilot은 (도어벨이 없어 정당하게) 안 쓴다 → `replyable:false`.
  → **sender marker는 "누가 보냈나"를 주지 "답장할 수 있나"를 주지 않는다.** 왕복은 RAIL 6이 있어야 한다.
  차이는 받는 형제가 *누가 보냈는지 아느냐* 하나다. 그 차이가 값어치가 있는지는 `[제안]` 영역이다.

- **Next 1 — RAIL 5, MCP 손. 계약이 확정됐다.**
  `[번들]` 유저 파일은 `~/.copilot/mcp-config.json`이고 **래퍼는 항상 `mcpServers`** 다 —
  writer가 `JSON.stringify({...t, mcpServers: t.mcpServers ?? {}})`로 직렬화한다(`app.js` `Ud.write`).
  `[번들]` stdio 한 개의 shape는 **CLI `copilot mcp add`가 쓰는 것**이 정본이다:
  `{ type: "local", command, args, tools, env?, timeout? }`. `command`만 필수.
  - **`type`은 `"local"`이지 `"stdio"`가 아니다.** `schemas/api.schema.json`의
    `McpServerConfigStdio`에는 `type` 필드가 아예 없다(`additionalProperties:false`) — 그건
    **API wire**이지 파일 writer가 아니다. 세 계층(파일 writer / API wire / SDK `types.d.ts`)이
    서로 다르니 **파일에 쓸 때는 CLI writer만 따라라.**
  - `[번들]` 원격만 `type:"http"|"sse"` + `url`. stdio는 `command`로 판별한다.
  - `[번들]` VS Code식 `servers` 키는 **제거됐다**(`"incomplete support for .vscode/mcp.json has been removed"`).
  - `[번들]` `mcp-oauth-config`는 **원격 HTTP OAuth 토큰 스토어**다. stdio add 경로는 읽지 않는다. **건드리지 마라.**
  - `[번들]` 스코프 5종: user(`~/.copilot/mcp-config.json`) · workspace(`.mcp.json` / `.github/mcp.json`) ·
    plugin · builtin · session(`--additional-mcp-config`).
    `[측정]` session flag는 `copilot mcp list`에 **안 보인다** → 설치 계약이 아니다. **유저 파일을 쓴다.**
  - `[번들]` 기동은 세션 로드 시점이다 — 턴 진입에서 `ensureLoadedForTurn()` →
    `waitForMcpToLoadIfRequired()`가 로드를 기다린다. 첫 도구 호출 lazy가 아니다.
  - **`[모름]` `command`의 `$HOME`/`~` 확장 여부.** statusLine.command는 벤더가 명시하지만
    MCP 쪽엔 그 문장이 없다. **statusLine과 같다고 가정하지 마라** —
    bin은 절대경로이거나 `PATH`에서 풀리는 bare 이름으로 써서 이 미지수를 아예 피한다.
  - 선례 그대로 포팅: `scripts/agy-bridge-config.py` + `scripts/agy-bridge.sh` (`run.sh:206`).
    adopt / create / **REFUSE symlink** / preimage 1회 / 정직한 닥터.
    verb 3종 + smoke: `install|uninstall|doctor-copilot-mcp`, `smoke-copilot-mcp-state`.
    검증 leaf는 이미 있다 — `run.sh probe-bridge-command`.

- **Next 2 — RAIL 6, 알림. 봉투는 쟀고, 한 가지가 남았다.**
  `[번들]` 런타임 호출은 이것이다(`app.js` ~2580231):
  `nativeHookProcessor.event("agentStop", {transcriptPath, stopReason:"end_turn", stop_hook_active}, agentId ?? sessionId)`
  이고 `event(e,n,r)`가 `{...n, sessionId: r}`로 병합한다. **봉투에 `sessionId`는 있다.**
  - **`cwd`가 없다.** `[코드]` 출생 파서 `readBirthEnvelope`
    (`pi-extensions/meta-bridge-hook-copilot.ts:100-169`)는 `sessionId`/`session_id` **+ `cwd`** 를 요구한다.
    → **출생 파서를 재사용하면 `cwd missing`으로 거절된다. 알림은 별 봉투다.**
  - `[번들]` 출력 계약은 `{ decision?: "block", reason?: string }`이고, block이면 `reason`이
    **follow-up 유저 메시지로 enqueue**된다(`sessionPlanAgentStopJson` → `enqueueUserMessage`).
    Claude식 오퍼레이터 피드백 패널이 **아니다.**
  - **이것이 파리티의 핵심이다.** enqueue는 오퍼레이터의 눈이 아니라 **모델의 컨텍스트**에 들어간다.
    즉 RAIL 6은 "GLG가 편지를 본다"가 아니라 **"모델이 편지 왔다는 말을 듣는다"** 이고,
    그 모델이 손(RAIL 5의 `entwurf_inbox_read`)을 갖고 있으면 **스스로 꺼내 읽는다.**
    → **RAIL 5와 6은 합쳐져야 self-fetch가 된다. 하나씩으로는 아무것도 아니다.**
    이것이 claude-code의 D6 루프와 같은 모양이며, 다른 점은 **유휴 깨우기가 없다는 것 하나뿐**이다.
  - **`[모름]` 남은 하나 — native가 선언형 `hooks.json`의 `agentStop` 키를 받는가.**
    `[번들]` `app.js`에 `"hooks.json"` 문자열이 **0회**다. JS는 플러그인 디렉터리만
    native로 넘기고(`getNativePluginHookInputs` → `h.hookSessionReplacePlugins`),
    훅 이름 파서는 **native 안에** 있다. 그래서 JS를 아무리 읽어도 답이 안 나온다.
    `[측정]` 우리 유닛의 `sessionStart`/`userPromptSubmitted`는 이미 발화했고 그 키는
    HookType camelCase다. `[번들]` 런타임이 선언 훅을 도는 `event()` 파이프는 `userPromptSubmitted`와
    **동일**하다. → 가능성은 크지만 **`[제안]`이지 측정이 아니다. LIVE Copilot 턴 1회가 필요하고 GLG 승인 사안이다.**
  - `[번들]` `notification` 훅은 **우리 자리가 아니다.** `SessionHooks`에 `onNotification`이 없고
    `this.event("notification"` 호출이 0회다. 알림 축은 `agentStop`이다.

- **Next 3 — RAIL 7, 등급 정정.** 아래 "지금 거짓인 문장" 절.

- **Blocker.** 없음. 형제 전원 퇴근. 워크트리 clean, 브랜치 `issue-82-copilot-citizen` = `79a77ea`, **푸시 안 함**.
- **Read.** 이 파일 → #82 스레드 **전문**(본문은 2026-08-19 스냅샷이고 스스로 그렇게 말한다;
  본문과 스레드가 어긋나면 **스레드가 이긴다**) → `scripts/agy-bridge-config.py` + `scripts/agy-bridge.sh`.
- **Do not touch.** 아래 전용 절.

# 지금 거짓인 문장 — RAIL 7이 고칠 것

문서가 오늘의 측정보다 뒤에 있다. 고치기 전에는 인용하지 마라.

| 위치 | 지금 쓰여 있는 것 | 오늘의 사실 |
|---|---|---|
| `DELIVERY.md:85` | *"**LIVE birth unproven** … No record has yet been minted by a real Copilot session"* | `[측정]` 2026-08-21 09:15 실제 Copilot 세션이 `20260821T091514-fb50b4`를 발행했다. **입증됨** |
| `DELIVERY.md:85` | *"No doorbell exists in the bundle (`FileChanged`, `asyncRewake`, `watchPaths` all absent)"* | 그 셋은 여전히 없다 ✓. 그러나 이 문장이 **`agentStop`의 존재를 가린다.** 없는 것은 **유휴 깨우기**이지 훅 전부가 아니다 |
| `pi/entwurf-capabilities.json` | `copilot: { wakeMode: "direct-inject", deliveryLevel: "D0" }` | `direct-inject`는 **주입할 통로가 없는데** 그렇게 적혀 있다. RAIL 5·6의 결과에 따라 등급과 wakeMode를 같이 정한다 |
| `run.sh:201` · `scripts/copilot-bridge-install.sh:174` | *"NO MCP wiring — this backend has no doorbell and no delivery"* | 배달이 없는 것과 **MCP 손이 없는 것은 다른 사실이다.** RAIL 5가 닫히면 앞 절반만 참이 된다 |

# 증거 규약

`AGENTS.md:131`이 정본이다(*"Carry evidence state on every factual sentence that crosses to someone else"*).
이 레인이 2026-08-19~20에 세 번 엎어진 원인이 **판단이 아니라 전달**이었고, 그래서 생겼다.
운영용 태그표만 여기 둔다:

| 태그 | 뜻 | 받은 쪽이 할 일 |
|---|---|---|
| `[측정]` | 직접 실행/관측. **영수증 이름이 같이 적힌다** | 영수증을 연다 |
| `[코드]` | 이 리포에서 `file:line`으로 읽음 | 그 줄을 연다 |
| `[번들]` | 외부 산출물(Copilot 번들 등)에서 읽음. 경로가 적힌다 | 경로를 연다 |
| `[미검증]` | 물려받은 **사실 주장**, 미확인. 출처를 밝힌다 | **인용 전에 직접 잰다** |
| `[제안]` | 사실이 아니라 **설계 판단**. 낸 사람을 밝힌다 | 재는 게 아니라 **채택하거나 다르게 결정한다** |

`[미검증]`과 `[제안]`을 섞지 마라. 미검증 사실은 재면 올라가지만, 설계 제안은 재서 올라가는 게 아니다.

# 살아남은 측정 — 펜스의 근거

게이트가 덮는 사실은 게이트가 정본이므로 여기서 뺐다. 아래는 **게이트가 없고 펜스를 지탱하는** 것들이다.

**`[번들]` 유휴 깨우기가 없다.** claude-code의 D4를 성립시키는 셋
(`FileChanged` + `asyncRewake` + `watchPaths`)이 Copilot 1.0.80 번들에 **없다**.
그 문자열들은 `TerminalCwdChangedAction`/`WorkspaceFileChangedData`이지 훅 이름이 아니다.
→ **Copilot은 잠든 채로 깨어날 수 없다.** RAIL 8이 벤더 대기인 이유이자 배달 어댑터 금지의 근거.
**이 펜스의 범위는 D4까지다** — `agentStop`(턴 끝 알림)은 이 문장이 부정하는 대상이 아니다(RAIL 6).

**`[측정]` `sessionStart`는 첫 프롬프트에 지연 발화한다.** TUI를 열면 세션은 등록되지만 훅은 0발이다
(등록 11:17:19.920Z, 3분 유휴, 훅 줄 0, `Session: 0 AIC used`). 첫 프롬프트에서
`userPromptSubmitted`(11:20:29.476Z) → `sessionStart`(11:20:32.102Z) → `agentStop`.
벤더 스키마 설명(*"when a session starts or resumes"*)과 **관측이 다르다.**
→ **Copilot 시민은 창을 열 때가 아니라 첫 프롬프트에 태어난다.** 상태바가 출생 전에 `?`를 찍는 근거.

**`[번들]` statusline 계약면은 두 줄이 전부다.** stdin JSON에 `session_id`가 있고,
stdout 한 줄이 슬롯에 들어가며 **exit 0이어야 한다**. nonzero면 Copilot이 슬롯을
**조용히 빈 문자열로** 만들고 오퍼레이터에게 아무것도 안 보여준다(`app.js` `Hxi`/`Gxi`/`YPn`).
→ 렌더러가 봉투의 다른 키를 읽지 않는 이유(버전 방어), 그리고 fail-quiet 가드 두 개가 있는 이유.

**`[번들]` `exec`는 string이어야 하고 `args` 키가 없다.** 배열 `exec`는 프롬프트 전 플러그인
로드 시점에 거절된다. 그래서 Copilot 훅은 **항상 argc=0**이고, 전용 런처는 argv를 요구하지 않는다.

**`[번들]` MCP 설정 자리는 `~/.copilot/mcp-config.json`이다.** `--mcp-config` 도움말이
*"augments config from ~/.copilot/mcp-config.json for this session"*이라 말하고,
설정 이름 목록 `WMi`에 `mcp-config`가 `config.json`·`permissions-config`·`hooks`와 나란히 있다.
`preMcpToolCall` 훅 타입이 따로 있는 것도 MCP가 1급 표면이라는 방증이다.
→ RAIL 5의 좌표.

**`[번들]` MCP 파일 계약은 세 계층이 어긋난다.** 파일 writer(`Ud.write` + `copilot mcp add`)는
`{mcpServers:{name:{type:"local",command,args,tools,env?,timeout?}}}`를 쓰고,
API wire 스키마(`McpServerConfigStdio`)엔 `type` 필드가 아예 없으며,
SDK `types.d.ts`는 `type?: "local"|"stdio"`에 `workingDirectory`(스키마의 `cwd`와 이름이 다름)를 쓴다.
→ **파일에 쓸 때 따라야 할 것은 CLI writer 하나다.** 나머지 둘을 근거로 쓰면 틀린다.

**`[번들]` `agentStop`의 출력은 오퍼레이터가 아니라 모델에게 간다.** 계약은
`{decision?:"block", reason?:string}`이고 block이면 `reason`이 follow-up 유저 메시지로
enqueue된다. Claude의 Stop-hook feedback 패널 같은 것은 이 번들에서 찾지 못했다.
→ **알림 설계를 "GLG가 본다"로 짜지 마라.** 받는 쪽은 모델이고, 그래서 RAIL 5의 손이 함께 있어야 한다.

**`[번들]` 선언형 훅 이름 집합은 JS에 없다.** `app.js`에 `"hooks.json"` 문자열이 0회다.
JS는 플러그인 디렉터리만 native로 넘긴다(`getNativePluginHookInputs` → `h.hookSessionReplacePlugins`).
→ **app.js를 더 읽어도 `agentStop` 수용 여부는 안 나온다.** 남은 길은 LIVE 1회뿐이다.
어제 은퇴한 *"api.schema.json 17개 = 선언형 어휘"* 와 같은 함정이니 계층을 적어라.

# 은퇴한 주장 — 되살리지 마라

사람이 아니라 주장을 적는다. 오른쪽이 은퇴시킨 영수증이다.

| 은퇴한 문장 | 은퇴 근거 |
|---|---|
| ~~"훅이 한 번도 안 돌았다 / 어휘 불일치가 원인"~~ | `[측정]` Copilot 로그가 우리 플러그인을 호명하고 `Hook command failed with code 1` |
| ~~"`args` 하나가 문제"~~ | `[측정]` argv만 떨어짐. **stdin 봉투는 도착** |
| ~~"codex가 시민화 선례"~~ | `[측정]` codex도 레코드 0건 |
| ~~"`api.schema.json` 17개가 선언형 훅 어휘"~~ | `[번들]` 계층이 다르다. 선언형 settings 스키마는 15개 |
| ~~"레코드의 `model`을 statusline 봉투로 채울 수 있다"~~ | `[코드]` 훅 봉투에 model이 없다(`meta-bridge-hook-copilot.ts:100-169`). statusline 봉투는 **다른 봉투**다. `null`이 정직하다 |
| ~~"오늘 사고는 게이트 구멍이다"~~ | `[측정]` `doctor-meta-bridge`가 원인과 처방을 정확히 말하고 있었다. 빈 곳은 **절차**였다 |
| ~~"MCP 파일 최상위 키가 `servers`일 수 있다(VS Code식)"~~ | `[번들]` writer가 항상 `mcpServers` 래퍼를 붙인다(`Ud.write`). `.vscode/mcp.json` 지원은 제거됐다 |
| ~~"stdio 엔트리 `type`은 `\"stdio\"`"~~ | `[번들]` 파일에 쓰는 값은 `"local"`이다. `"stdio"`는 CLI transport 선택지이고, API wire 스키마엔 `type` 필드가 없다 |
| ~~"Copilot에는 도어벨이 아예 없다"~~ | `[번들]` 없는 것은 **유휴 깨우기**(`FileChanged`/`asyncRewake`/`watchPaths`)다. `HookType`에 `agentStop`·`postResult`·`notification`이 있고 `agentStop`은 발화가 관측됐다. 범위를 D4로 좁혀 다시 쓴다 |

# Do not touch

- **ACP 재개** — `copilot --acp`, `copilotAdapter`, `AcpBackendAdapter`. 폐기됨.
  `[코드]` `ROADMAP.md:21`이 중복 구현 금지를 명문화했고 `#56`이 그 이유로 CLOSED.
- **`--ui-server` / loopback / `~/.copilot/run/ws.*`** — 거절 유지.
- **배달 어댑터 · watcher · `FRESH_CALL_BACKENDS` 항목** — 유휴 깨우기가 없다.
  출생과 배달을 한 입학으로 묶지 마라. **RAIL 5(MCP 손)는 여기 해당하지 않는다** —
  그건 Copilot이 *나가서* 부르는 손이지, 우리가 *들어가서* 깨우는 통로가 아니다.
- **형제 레일 파일 편집** — `scripts/meta-bridge-statusline.sh`(Claude 닥터가 그 출력을 판정한다,
  `scripts/meta-bridge-doctor.sh:566`) · `scripts/agy-statusline*.sh` · `scripts/agy-statusline-config.py` ·
  `scripts/agy-bridge-config.py` · `scripts/agy-bridge.sh`.
  **읽고 베끼되 고치지 마라.** 2026-08-21에 형제 레일이 실제로 한 번 멈췄다.
- **`META_BACKENDS`를 건드린 뒤 형제 재배포를 건너뛰기** — 그것이 그 사고였다.
  `AGENTS.md` Hard Rule 7과 `VERIFY.md` setup 절이 이제 그렇게 말한다(`79a77ea`).
- **`[QK:]` 뮤턴트를 statusline에 붙이기** — `[측정]` `smoke-agy-statusline-state.sh`에 QK 0개.
  형제에 없는 걸 Copilot에만 붙이면 특별 취급이다.
- **`check-gate-qualification`을 개발 루프에서 돌리기** — 22분. CI가 push마다 돈다.
  루프는 `pnpm run check`(40s) + 건드린 주제의 focused 게이트.
- **Copilot LIVE 모델 턴 추가** — GLG 승인 사안.
- **`scripts/raw-async-delivery/copilot-ui-server-probe.mjs` 삭제·실행** — 보존만.
- **CHANGELOG 수정** — 발행 기록이다.

# RECENT — 2026-08-21

**`[측정]` §6 인수 통과.** 레코드 `20260821T091514-fb50b4` · `backend:"copilot"` · v3 ·
`nativeSessionId c35a92d0-…`. `entwurf_peers`에 시민(`liveness=unsupported`).
footer에 `🪛 20260821T091514-fb50b4 cop` 렌더. **0.26 AIC**(auto → MAI-Code-1.1-Flash) —
측정 턴이 8.9354 AIC였으니 GLG가 노린 비용 레버가 실제로 걸렸다.

**`[측정]` 사고 1건 — 백엔드 등록이 형제 레일에 배포 의무를 만들었다.**
Copilot 시민이 태어난 직후 **Claude Code 레일이 meta-record를 못 쓰게 됐다.**
배포된 Claude 플러그인의 `META_BACKENDS`가 `claude-code|antigravity|codex`로 낡아
copilot 레코드를 인증 못 했고, Claude 훅은 쓰기 전에 store **전체**를 인증하므로
자기 레코드까지 거절했다. 파괴는 없다(쓰기 거절만). 파급은 **한 레일** —
pi(`00:21:09`)·copilot(`00:19:46`)은 계속 썼고 claude-code만 `00:10:31`에서 멈췄다.
`./run.sh install-meta-bridge` 재배포로 수리, `00:27:22` 정상 복귀 확인, 양쪽 닥터 PASS.
거절문이 주던 틀린 처방(*"fresh-cut 하라"* → 멀쩡한 418건을 아카이브할 뻔했다)은
`79a77ea`가 고쳤고, `check-meta-session`이 unknown-backend 이웃으로 그것을 박았다.

**`[측정]` 착지한 커밋** — `4651d99`(게이트 `[QK:]` 시그니처 수리) · `0aed67d`(footer 드라이버) ·
`91986c2`(statusline 설치면 · 15-check smoke) · `79a77ea`(stale reader 거절문 · 게이트 · 문서).
앞 둘은 푸시됨. **뒤 둘은 로컬**.

**`[측정]` 게이트** — `pnpm run check` 44s exit 0 · `smoke-copilot-statusline-state` 15 checks ·
`check-meta-session` 25 assertions · `check-copilot-statusline` 22 assertions. 전부 초록.

## RECENT 추가 — 2026-08-21 오후

**`[측정]` RAIL 5 LIVE 인수 통과.** 사슬 전체:
`probe-bridge-command entwurf-bridge` → 7 tools · `install-copilot-mcp` → `created-new`,
`configExistedBefore:false`, `preimage:null` · `copilot mcp get` → *Status: Enabled · Type: local ·
Tools: * (all) · Source: User* · Copilot 로그 → `Service initialized as client`,
`Implementation { name:"entwurf-bridge", version:"0.1.0" }` · **모델 턴** →
`● entwurf_peers (MCP: entwurf-bridge)` 32행 중 copilot 5행. 별도로 세어 5건 일치 확인.

**`[측정]` headless `-p`도 시민을 낳는다.** `-p` 3회가 각각 레코드를 발행했다
(`115045-f687b4` / `114954-1fbf28` / `114910-b78b0e`, cwd=이 리포). 출생 훅은 headless에서도 발화한다.

**`[측정]` Copilot은 MCP보다 스킬을 먼저 고른다.** 첫 LIVE 턴이 `entwurf-peek` **스킬**로 새서
shell 권한에서 죽었다(2.21 AIC 소모). MCP로 보내려면 도구를 이름으로 못박고
(`entwurf-bridge(entwurf_peers)`) `--deny-tool='shell'`을 걸어야 한다. 오늘 LIVE 총 3턴 7.83 AIC.

**`[측정]` 4b 결론 — 형제 셋이 이미 (a)다.** `agy-bridge-config.py:279` ·
`agy-statusline-config.py:118` · `copilot-statusline-config.py:105-110` 전부 preimage를
**디스크의 현재 값**에서 뜬다. 우리 것과 같아도 그대로. NEXT 후보 ③(특별 취급 금지)이 이 레인의
규칙이므로 **(a)를 따른다.** (b) "없었음"은 Copilot에만 생기는 새 의미라 만들지 않는다.
grok이 `file:line`으로 확인했고 MCP 어댑터도 같은 (a)로 심었다.

**`[측정]` 오늘 낡은 미러가 셋이었다.** ① 배포된 Claude 플러그인 `META_BACKENDS`(아침 사고,
`doctor-meta-bridge`가 잡음) ② 조립본 `.assembled`(같은 닥터) ③ **`entwurf-peek.py:1097`
`META_CITIZEN_BACKENDS`** — copilot 없음, 오늘 copilot 레코드 6건이 통째로 "store defects"로
빠진다. `entwurf_peers`는 정상 인식하므로 **두 도구가 서로 다른 세상을 보여준다.**
③의 정본은 `agent-config/skills/entwurf-peek/scripts/entwurf-peek.py`이고 배포본 3개와 바이트 동일.
**GLG 지시로 agent-config에서 따로 수선한다 — 이 레인은 건드리지 않는다.**
남는 교훈: ③은 **다른 리포에 살아서 entwurf의 어떤 게이트도 닿지 못한다.** 절차 구멍이 아니라
**소유권 이음매가 문서화 안 된 것**이고, entwurf `AGENTS.md`는 entwurf-peek을 아예 모른다(grep 0건).

# LEDGER

- 서사·영수증 정본: [#82 스레드](https://github.com/junghan0611/entwurf/issues/82) —
  특히 comment `5363685118`.
- 출생 구현의 결정 근거(유닛 분리 · hooks 형식 · 런처 · 봉투 · `wakeMode` · `deliveryLevel` ·
  설치/닥터 분리)는 **코드와 게이트가 정본**이다:
  `pi/meta-bridge-copilot/` · `pi-extensions/meta-bridge-hook-copilot.ts` ·
  `scripts/copilot-bridge-install.sh` · `scripts/copilot-bridge-doctor.sh` ·
  `scripts/check-copilot-birth-hook.ts` · `scripts/check-copilot-statusline.ts` ·
  `scripts/mutants/copilot-birth.json`.
- 설치면(RAIL 4)의 정본: `scripts/copilot-statusline-bridge.sh` ·
  `scripts/copilot-statusline-config.py` · `scripts/smoke-copilot-statusline-state.sh`.
- RAIL 5가 베낄 선례: `scripts/agy-bridge-config.py` · `scripts/agy-bridge.sh` · `run.sh:206`.
- 백엔드 등급의 정본: `pi/entwurf-capabilities.json` (게이트 `check-entwurf-capabilities`).
- 이 레인의 전체 로그는 `~/.local/share/entwurf-salvage/`에 있고 **호스트 로컬**이다. git에 없다.
  다른 기기에서는 그 인용을 `[미검증]`으로 강등하고, 이 파일에 박힌 원문만 `[측정]`으로 취급하라.
