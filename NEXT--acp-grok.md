# NEXT — `acp-grok` 레인: Grok CLI을 세 번째 ACP backend adapter로

> 이 파일은 **브랜치 레인 부트 섹터**다. main의 `NEXT.md`는 `0.13.1` prepared 상태를 지고 있고
> 이 레인은 그것과 **독립**이다. main NEXT를 이 레인의 사실로 고쳐 쓰지 말 것.
>
> 계약 SSOT: `docs/acp-backend-rail.md`("Adapter contract" · "Shipped adapters").
> 실측 정찰(E1–E10)과 G0 원본: **이슈 #58** + 그 두 코멘트.
> 이 파일은 **그 위에 소스 대조로 확정된 배선**만 싣는다 — 정찰을 여기 복사하지 않는다.

# NOW

- **Stem.** Grok CLI(`grok 0.2.117`)을 claude=reference, cortex=2nd에 이은 **3번째 어댑터**로
  표준 ACP 레일에 얹는다. 네이티브 citizen 레인(#56 Codex급)은 **하지 않는다** — 이슈 #58 §4.
- **Next.** **G0-7 실측 한 건.** carrier가 `_meta.rules`(append)인지 `_meta.systemPrompt
  Override`(전체 교체)인지 — 격리 `GROK_HOME`에서 실제 세션에 반영/미반영을 재고, 두 경로의
  behavior·billing 차이를 기록한다. **이게 지금 유일한 blocker다**(아래 "왜 G0-7이 먼저인가").
- **Blocker.** 없음(환경). oracle에 `grok 0.2.117` 설치돼 있고 계정 쿼터는 이슈 코멘트 시점
  기준 살아 있었다. 실측 전 `grok models`로 재확인할 것.
- **Read.** 이슈 #58 → 이 파일 "레인 계약" → `pi-extensions/lib/acp/backend-adapter.ts`
  (cortexAdapter가 참조 구현) → `docs/acp-backend-rail.md`.
- **Do not touch.** main의 `NEXT.md` · `CHANGELOG.md` · `package.json` version.
  0.13.1은 main이 `make` authority로 닫는다.

## 왜 이 레인이 브랜치인가

main HEAD는 `3b2bac1 chore(release): prepare v0.13.1`이고 `make` authority 대기 중이다.
main에서 구현 커밋을 시작하면 **prepared HEAD가 오염된다.** 그리고 Codex 레인이 표준 레일 없이
main에서 굴러 산으로 간 전례가 있다(GLG 판단으로 폐기). 이 레인은 처음부터 브랜치다.

---

# 레인 계약 — 소스 대조로 확정된 것 (2026-08-01, oracle)

이슈 #58은 "adapter 1개 + 게이트 1~2개"로 봤다. **소스 기준으로는 공통 층에 구멍이 셋 있다.**
아래는 실제 파일을 읽고 SDK를 덤프해서 확정한 값이다.

## A. 공통 seam 3건 — 어댑터 안에서 못 고친다

### A1. `setModel` seam 부재 (하드)

`AcpConnectionLike`(`pi-extensions/lib/acp/acp-client.ts:24-50`)가 노출하는 모델 권위는
`setSessionConfigOption` 하나뿐이고, claude·cortex 둘 다 `session/set_config_option`을 쓴다.
Grok은 **`session/set_model`** — 다른 메서드다.

그리고 이건 단순 추가가 아니다. **SDK 1.3.0의 `AGENT_METHODS`를 직접 덤프했다:**

```
initialize, authenticate, providers_*, session_new, session_load, session_set_mode,
session_set_config_option, session_prompt, session_cancel, mcp_message, session_list,
session_delete, session_fork, session_resume, session_close, logout, nes_*, document_*
```

**`session_set_model`은 없다** — ACP 표준 테이블 밖의 **grok 확장 메서드**다.
다행히 `ClientContext.request`에 `request<Response, Params>(method: string, params?, options?)`
오버로드가 있어(SDK 1.3.0 `dist/acp.d.ts`) 리터럴 `"session/set_model"`로 보낼 수 있다 — 해킹 아님.
**계약 문서와 소스 주석이 "이 rail의 모델 권위는 off-table extension method"임을 져야 한다.**
게이트 fake 연결들도 새 seam을 알아야 한다.

### A2. `authenticate` 축 부재 (이슈 G0-9)

`pi-extensions/` 전체 grep — **`authenticate` 호출 0건**, 산문 언급만 있다. 이슈 코멘트가 맞다.
`AGENT_METHODS.authenticate`는 **SDK에 이미 있다**(표준). 우리가 안 쓸 뿐이다.

**권고 형태: 어댑터 옵셔널 메서드** `authenticate?(params): Promise<void>`.
claude/cortex는 `undefined`, grok만 구현. 공통 루프는 "있으면 `initialize`와 `newSession` 사이에서
**30초 바운드**로 호출"만 안다 — backend-invariant를 유지한다.

**대가:** bootstrap 3단계 계약이 **4단계**가 된다. `check-probe-ordering`의 production
exact-match 핀(B축이 방금 `initialize/newSession/set-model` 셋으로 좁혀놓은 그 핀)이 같이 움직인다.
이걸 모르고 손대면 게이트가 붉게 뜬 뒤에야 알게 된다.

### A3. `_x.ai/*` 알림 seam — `retry_state`를 progress로

이슈 코멘트가 본문 §3을 정정했다: `_x.ai/session_notification`의 `sessionUpdate: "retry_state"`는
계약이 요구하는 **진행 신호**이지 버릴 잡음이 아니다("의심스러운 정체는 죽이는 타이머가 아니라
진행 노출로 다룬다"). 그런데 `event-mapper.ts`는 지금 **backend 분기가 0**이다. x.ai 전용 알림을
공통 매퍼에 조건부로 심으면 rail이 오염된다.

SDK를 확인했다 — `onNotification<Params>(method: string, params: ParamsParser<Params>, handler)`
**확장 오버로드가 있다**(SDK 1.3.0 `dist/acp.d.ts`, "Pass a parser … to register custom extension
notifications"). 그래서 깨끗한 형태가 가능하다:

> 어댑터에 `mapBackendNotification?(method, params) → ProgressEvent | null`.

이러면 `_x.ai/*` 무시가 **조용한 drop이 아니라 어댑터가 명시적으로 null을 반환한 것**이 되어,
이슈가 요구한 "무시했다는 사실이 계약이어야 한다"를 **소스가 진다.**

**이 축은 main NEXT의 열린 빚과 만난다** — "⚠ 이 컷이 이행하지 않은 절반 — 관측". B축은 죽이지
않는 쪽만 닫았고, 진행 표시는 열려 있다. Grok이 그 첫 실체 재료를 준다. 단 **backend-invariant
fence의 근거로는 쓸 수 없다**(x.ai 전용) — 관측 재료일 뿐이다.

### A0. 좋은 소식 — cancel은 이미 맞다

`acp-client.ts:90`이 `agent.notify(AGENT_METHODS.session_cancel)`다. 이슈 E6가 요구한
**notification 형태**를 우리가 이미 쓰고 있다. request로 보내는 어댑터가 abort를 조용히 잃는
그 함정에 우리는 빠지지 않는다. **작업 0.**

## B. 이슈가 아직 안 짚은 것 셋

### B1. `augment.ts`의 provenance frame이 2-way다 — grok은 **제3의 rail**

`augment.ts:49`의 `CARRIER_LESS_BACKENDS`와 `:140-156`의 frame은 두 갈래뿐이다:

| rail | 현재 문장 |
|---|---|
| carrier-less (cortex) | "이 rail은 system-prompt carrier가 **아예 없다**" |
| claude | "이 rail은 `_meta.systemPrompt` carrier가 **있고** operator engraving만 싣는다" |

Grok은 carrier가 **있는데** `_meta.systemPrompt`가 아니다(이슈: `_meta.rules` append 권고 —
**G0-7 미측정**). **두 문장 중 어느 쪽을 써도 grok에서 거짓이 된다.**

→ **세 번째 rail 문장 + `CARRIER-RAIL-DIFF-IS-SOURCE-PINNED` 게이트 확장**이 필요하다.
A축이 방금 닫은 계약이라 여기서 거짓 문장을 만들면 **그 축이 도로 열린다.**
그래서 G0-7이 코딩 전 blocker다 — carrier 형태가 정해져야 이 문장을 쓸 수 있다.

### B2. grok은 **HOME 격리 + wire MCP를 동시에** 하는 첫 백엔드

| 백엔드 | HOME | MCP | D10(bridge가 실제 HOME을 봄) |
|---|---|---|---|
| claude | 격리 안 함 (`CLAUDE_CONFIG_DIR`만) | wire | 문제 없음 |
| cortex | 격리함 (dual HOME) | `mcp.json` 투사 | `projectCortexMcpJson(servers, realHome)` |
| **grok** | **격리 필요** | **wire 존중(E4)** | **해당 자리가 없다 — 새로 세워야 함** |

즉 **wire 선언의 `entwurf-bridge` 항목 env에 실제 HOME을 직접 실어야 한다**(D10의 wire 버전).
`overlay.ts`에 대응 함수가 없다.

**containment 권고: `[compat.*]` 셀 끄기 + HOME 격리 둘 다.**
셀만 끄는 건 화이트리스트가 아니라 **블랙리스트**다 — 기본 true인 셀이 6개
(`skills·rules·agents·mcps·hooks·sessions`)고 grok 버전이 오르면 늘 수 있다. HOME 격리는 셀
이름을 몰라도 막는다. 부수효과로 **G0-3 잔여(양성 차단 증명)가 쉬워진다** — 격리 HOME 안에
`~/.claude`가 아예 없으니 게이트가 그것을 직접 본다.

### B3. 큐레이트 행 수가 여섯 곳에 리터럴로 박혀 있다

```
run.sh:2289                          "claude 2 + cortex 4"
run.sh:2985                          "expected exactly 6 curated ids (claude 2 + cortex 4)"
run.sh:2997                          "exact 6-row curated set: claude 2 + cortex 4"
scripts/check-acp-provider-surface.ts:148  "must total 6 rows (claude 2 + cortex 4)"
scripts/check-acp-provider-surface.ts:153  [QK:CORTEX-PROVIDER-SIX-ROW-SURFACE]
scripts/check-acp-provider-surface.ts:200  "EXACT curated set of both adapters"
```

grok 1행이면 **7 (claude 2 + cortex 4 + grok 1)** 로 여섯 곳이 동시에 움직인다.
`check-pack-install`도 포함이다 — **그건 `pnpm check`에 없다.** 따로 돌려야 한다.

**라우팅 형태도 세 번째다:**

| 어댑터 | prefix | strip |
|---|---|---|
| claude | 없음 | 없음 |
| cortex | `cortex-` 예약 | **있음** |
| **grok** | `grok-` (네이티브가 이미 그 이름) | **없음** |

`routeModel`은 claude와 **같은 모양인데 이유가 다르다** — 주석이 그 이유를 져야 한다.
그리고 실측 큐레이션은 **`grok-4.5` 1행**이다(E9/코멘트): 구독은 쿼터를 사는 것이지 모델 행을
늘리지 않는다. 문서 예시의 `grok-build` / `grok-code-fast-1`은 **stale — `-32602`로 죽는다.**

---

# 착지 순서

각 단계는 이전 단계 없이 성립하지 않는다. **순서를 바꾸면 되돌아온다.**

| # | 단계 | 완료 판정 |
|---|---|---|
| P0 | **G0-7 실측** — carrier 형태(`rules` vs `systemPromptOverride`) | 두 경로의 실제 반영/미반영 + behavior·billing 차이가 이 파일 "검증 실측"에 기록됨 |
| P1 | **G0-6 실측** — wire MCP가 spawn이 아니라 **callable**인가 (`entwurf-bridge`) | 격리 HOME에서 bridge 호출 성공/실패가 실측됨 → B2의 realHome 주입 형태 확정 |
| P2 | **공통 seam 3건 착지** (A1·A2·A3) — grokAdapter **없이** | claude·cortex 회귀 **0**(전부 옵셔널). `pnpm check` EXIT=0 + qualification 유지 |
| P3 | **`grokAdapter` + overlay + models 1행** | `resolveAcpBackendAdapter("grok-4.5")`가 단독 소유 |
| P4 | **게이트** — `check-acp-grok` + mutant lane + B3의 여섯 곳 + probe-ordering 핀 + carrier-augment 3rd rail | qualification exact-once 통과, `pnpm check` EXIT=0, **`check-pack-install` 별도 실행** |
| P5 | **`smoke-acp-grok-live`** — on-demand, Claude release floor **밖** (cortex와 같은 취급) | 쿼터 살아있는 호스트에서 PASS |

**P2가 이 레인의 진짜 값이다.** `authenticate`와 notification seam은 rail이 세 번째 백엔드를
만나서 드러난 **진짜 결손**이고, 지금 세워두면 네 번째 백엔드는 공짜다. cortex 랜딩이 4커밋
(`f4b20bb`→`c2b6530`)이었으니 이 레인은 **그와 같은 급**이지 더 작지 않다.

---

# G0 재분류 (이슈 원본 대비)

**코딩 전 필수 — 설계를 바꾸기 때문에:**

- **G0-7** carrier 형태 → B1의 세 번째 rail 문장이 여기 달려 있다. **현재 blocker.**
- **G0-6** wire MCP callable → B2의 realHome 주입이 여기서 실제로 터진다.
- **G0-9** authenticate → 토큰 만료 재현이 어려우면, "authMethods를 광고하는 백엔드에서
  authenticate 없이 newSession이 실패하면 **loud하게** 죽는다"는 계약으로 대체 가능.

**게이트가 흡수 — 구현 중/후:**

- **G0-2** stopReason 집합 — `mapPromptStopReason`이 이미 닫힌 집합 밖을 error로 봉인하므로
  미지 문자열은 **안전하게 실패**한다. 실측은 `check-acp-grok` 셀로.
- **G0-5** `--no-leader` 실효 — overlay 게이트가 진다.
- **G0-3 잔여** compat off 양성 차단 — B2의 HOME 격리로 증명이 쉬워진다.
- **G0-1** — **이슈 코멘트에서 이미 닫혔다.** 조용한 무한 턴은 없다(즉시 JSON-RPC error /
  `retry_state` 알림 / 정상 `end_turn`). 본문 E8은 재시도 관측의 오독이었다.
  **파생 위험은 살아 있다:** grok 오류 원문(`Internal error`, `API error (status 400 …)`)이 pi의
  `RETRYABLE_PROVIDER_ERROR_PATTERN`에 transient로 걸린다 → **어댑터가 prompt-phase 실패 문구를
  반드시 다시 쓴다.** 그록이 이미 15회 재시도한 **위에** pi의 cold replay가 얹히면 안 된다.

**이번 범위 밖:**

- **G0-8 `session/load`** — persisted ACP resume/load는 rail의 open work 전체를 여는 별도 축이다.
  `loadSession: true`가 매력적이라고 이 레인에서 열지 말 것.

---

# GLG 결정 대기

1. **버전 슬롯.** `0.14.0`은 CODEX 예약(main NEXT). 세 번째 어댑터는 minor가 자연스러운데
   슬롯이 비어 있지 않다. grok은 어디로 가는가.
2. **permission 정책.** grok은 `_meta.yoloMode` / `_meta.autoMode` / `--always-approve`로 세션
   단위 permission mode를 **어댑터가 명시적으로 정해야** 한다(오퍼레이터 글로벌 상속이 아니다).
   claude/cortex 레일이 지금 무엇을 하고 있는지와 맞춰야 한다. — 이슈 #58 §2.
3. **머지 시점.** 0.13.1 make/publish 이후인가, 그 전 rebase인가.

---

# DO NOT

- **main `NEXT.md`를 이 레인의 사실로 고치지 말 것.** 0.13.1 prepared 상태는 main이 진다.
- **`CHANGELOG.md` / `package.json` version을 이 레인에서 건드리지 말 것.**
- **`_x.ai/*` 알림을 공통 `event-mapper`에 조건부로 심지 말 것** — A3의 어댑터 seam으로 간다.
  rail의 backend-invariant를 x.ai 전용 문자열로 깨지 않는다.
- **`retry_state`를 backend-invariant readiness/progress fence의 근거로 쓰지 말 것** — x.ai
  전용 관측 재료다. §11-7 축은 #55/rail 소유다.
- **`session/set_model`을 `AGENT_METHODS`에 있는 것처럼 쓰지 말 것** — SDK 1.3.0에 없다.
  extension method임을 소스가 명시한다.
- **큐레이트 행을 실측 없이 늘리지 말 것.** `grok-build` / `grok-build-plan` /
  `grok-code-fast-1`은 문서 예시가 stale한 것이고 실제로는 `-32602`다.
- **launch-time `-m` 핀을 쓰지 말 것** — 모델 권위는 per-turn `session/set_model` 하나다
  (cortex D7과 같은 축).
- **grok 오류 원문을 그대로 실패 메시지에 싣지 말 것** — pi가 transient로 읽고 cold replay한다.
- **행 수를 고친 컷은 `check-pack-install`을 따로 돌릴 것** — `pnpm check`에 없다.
- **`pnpm format`을 부분 수정에 쓰지 말 것** — 고친 파일만 `npx biome check --write <file>`.
- **`.ts` 수정 뒤 `pnpm run build-bridge`를 빼먹지 말 것.**
- **머지 전 이 파일을 삭제할 것.** main은 브랜치 레인 NEXT를 지지 않는다.

---

# RECENT

- **[2026-08-01] 레인 개설.** main `3b2bac1`(0.13.1 prepared)에서 분기. 이슈 #58의 실측
  정찰(E1–E10 + G0 1차)을 **소스에 대조**해 공통 seam 3건(A1–A3)과 미포착 3건(B1–B3)을 확정했다.
  SDK 1.3.0 `AGENT_METHODS` 덤프로 `session_set_model` 부재와 `authenticate` 존재를 실측,
  `ClientContext.request(method: string, …)` / `onNotification(method: string, parser, …)`
  확장 오버로드로 둘 다 해킹 없이 가능함을 확인했다. **구현 커밋 0** — P0(G0-7)이 열려 있다.

# 검증 실측

> P0부터 여기에 쌓는다. 이슈 코멘트에 이미 있는 것을 복사하지 말고, **이 레인에서 새로 잰 것**만.
