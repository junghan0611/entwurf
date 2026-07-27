# NEXT — ACP Claude rail 먼저, 0.12.10으로 수선 컷 (Cortex는 그 뒤)

> NEXT는 부트 섹터다. 이슈는 설계 SSOT가 아니라 과거 가설과 증거의 묶음이다.
> 다음 세션은 이슈를 구현하지 말고 **현재 main·현재 upstream·현재 live surface를 먼저 검수**한다.

> **2026-07-27 축 전환 (GLG 지시).** 이전 NEXT는 `#48 Cortex → 0.13.0`이었다. 뒤집혔다:
> *"claude acp 쪽에서 다 검수가 완벽하게 되고 레일문서가 더 수정할게 없을정도로 문제가 없어지면
> 그때 cortex 작업 들어갈거야. 순서가 cortex가 아니야. 기본도 안되는데 cortex를 품을 수는 없어."*
> 이어서: *"0.13.0 안가고 지금 수선하면 0.12.10으로 acp 수정 및 rail 문서 업데이트만 들어가도 좋겠다."*
> → **0.13.0은 지금 가지 않는다.** 이번 컷은 **0.12.10 = acp 0.62.0 핀 업 + rail 문서**로 좁힌다.
> readiness 인과 규명은 그 뒤에 이어지고, #48 Cortex는 rail이 정리된 다음에 연다.

## NOW — 0.12.10 수선 컷 (acp 핀 + rail 문서), 그리고 rail의 남은 질문

- **계기:** GLG가 실사용에서 ACP Claude가 entwurf를 못 쓰는 걸 봤다. 문서상 shipped인데 실제로는
  형제에게 닿지 못하는 상태였다. 번들 `entwurf-bridge` MCP 도구가 세션 tool schema에서 빠지는 증상.
- **Current:** v0.12.9가 tag/GitHub/npm `latest`로 출하됐다. #52·#54·#49는 닫혔고 #55는 비차단
  subtraction finding 수집함으로 연다. pi 0.82.1 = upstream latest.
- **읽을 곳:** `AGENTS.md` → `docs/acp-backend-rail.md` **§11** → `ROADMAP.md` "번들 MCP readiness race"
  → `pi-extensions/lib/acp/backend.ts`(turn loop) → `scripts/smoke-acp-v2-send-live.ts` 헤더.
  §11이 §1–§10보다 최신이며 우선한다.
- **A. dep 핀 업 — 완료(2026-07-27).** `claude-agent-acp` 0.61.0 → **0.62.0**. ROADMAP "Dep bump" 트랙
  절차대로 `check-acp-sdk-surface`를 0.62.0 / claude-agent-sdk 0.3.219로 옮기고 green 확인.
  **성격은 dependency refresh다** — upstream `dist/`는 0.61.0과 바이트 동일이고 explicit readiness wait를
  추가하지 않는다. **핀 업을 readiness 수정으로 읽지 마라.** transitive SDK(0.3.217→0.3.219)는 움직였으니
  MCP startup timing이 동일하다고는 주장하지 않는다 — 새 fence가 없다는 것만 확정이다.
- **B. citizen 스모크 3종 재측정 — 완료(2026-07-27 10:24–10:25, 3/3 PASS).** socket-citizen 10 checks ·
  bundled-mcp 14 checks · v2-send 15 assertions, pi 0.82.1 + acp 0.62.0 + claude 2.1.220, 조용한 머신 24초.
  **그러나 이 표본은 상관 조건을 재현하지 않았다** — 실패 3표본은 전부 무거운 시퀀스(동시 `pnpm check`,
  라이브 턴 10여 개 뒤 aggregate, 17스텝 release-gate 후반)에서 나왔고, 24초 3종 순차는 이미 4/4 PASS였던
  **격리 재실행과 같은 조건**이다. 격리 누적을 5/5로 올릴 뿐 "무거운 시퀀스" 상관에는 아무 말도 못 한다.
  green을 안심으로 읽지 마라.
- **C. 계약 공백 문장 + probe 설계 — 완료. 다음 한 걸음은 그 probe 구현이다.**
  확정: ⑴ tool-schema 부재 증상 3회, ⑵ client/common turn loop에 readiness fence 부재,
  ⑶ **현재 claude-agent-acp가 노출하는 ACP surface에 관측 경로가 없음** — 0.62.0이 방출하는 `sessionUpdate`
  10종에 MCP 상태를 알리는 것이 하나도 없다(실측; ACP 프로토콜 일반이 아니라 이 서버의 현재 표면에 대한 진술).
  미확정: 그 부재가 원인이라는 것, Cortex가 race를 상속한다는 것.
  → **ordering probe(`docs/acp-backend-rail.md` §11-7)**: `scripts/fixtures/probe-mcp-server.ts`에
  `PROBE_MCP_STARTUP_DELAY_MS`를 넣는다.
  **probe 단위는 단발 delayed run이 아니라 paired run이다** — ⑴ 동일 pin/config/fixture에서 `delay=0` control
  (기대 도구가 visible **그리고** callable), ⑵ newSession·set-model 두 30초 경계보다 충분히 작은 `D` intervention,
  ⑶ **A 판정에는 nonzero D가 최소 2개(`D1`,`D2`) 필수** — "latency가 D를 따라 이동"이 판별자인데 점 하나로는
  scaling을 못 본다. D 하나면 ordering 관측까지만이고 wait 판정은 **유보**. B·C·D는 첫 intervention에서 읽어도 된다.
  ⑷ 모든 이벤트에 `runId`.
  단발 run으로는 아무것도 못 말한다: A처럼 보여도 newSession의 다른 작업이 더 걸린 것일 수 있고, B처럼 보여도
  `delay=0`에서도 실패했을 수 있으며, D는 우리 timeout을 잰 것일 수 있다 — 턴에는 30초 경계가 **셋**이다
  (`INITIALIZE_TIMEOUT_MS`·`NEW_SESSION_TIMEOUT_MS`·`SET_MODEL_TIMEOUT_MS`, `acp/backend.ts:81-83`) + prompt 600초.
  **production sequence의 중간 단계를 빠뜨리지 마라:** 실제는 `newSession → enforceModel(setSessionConfigOption)
  → prompt`다. 지연된 MCP가 `enforceModel` 동안 해소되거나 거기서 fail-loud할 수 있어서, newSession/prompt만
  마킹하면 그 둘을 C나 D로 오독한다. 최소 ACP-side 마커 =
  `newSession start/end → setSessionConfigOption(model) start/end → prompt start/end`.
  **판정 공간 밖의 run-invalidating state가 둘 있다. 어느 것도 D가 아니다** — **P0(INVALID BASELINE)**:
  `delay=0` control이 실패(거기서의 `initialize` 실패 포함). **I0(INVALID RUN)**: control은 통과했는데
  *intervention* run이 `initialize`에서 실패 — injected delay가 그 phase에 닿을 수 없으므로 환경 drift다.
  intervention 판정 중지, artifact 보존, 같은 pair **1회 재실행**. 재발하면 더 돌리지 말고 environment·initialize
  원인 규명으로 전환한다. (P0는 원인명이 아니라 "control이 판정 가능한 baseline이 아니다"라는 **상태명**이므로
  artifact에 `reason=initialize|tool-unavailable|…`를 남긴다.)
  **먼저 id를 실측하라 — hardcode 금지.** provider-bound tool id는 source MCP 이름과 다르다: 이 repo 실측이
  source `entwurf_v2` → runtime `mcp__entwurf-bridge__entwurf_v2`다. delayed run에서 모델이 bare `probe_nonce`를
  추측 호출해 `No such tool`을 받아도 실제 provider-bound id는 schema에 있었을 수 있고, 그건 alias·model 오류이지
  absence가 아니다.
  **두 layer는 request-id namespace를 공유하지 않으므로 내가 통제하는 argument로 correlate한다.** ACP
  `tool_call`의 `toolCallId`는 Claude tool-use id이고(`acp-agent.js`가 `toolUse.id`/`tool_use_id`/`message.uuid`로
  만든다), fixture가 보는 JSON-RPC id는 MCP client가 따로 민 것이다 — `acp-agent.js`에는 `jsonrpc`가 **0회**
  등장하므로 둘이 같다는 보장이 아예 없다. "request id로 join"은 측정이 아니라 가정이다. 대신:
  ⓐ probe fixture tool에 **필수 correlation field**(`probeRunId`)를 둔다 → ⓑ prompt가 이번 run의 unique
  `probeRunId`를 **정확한 argument로** 넣어 호출하게 한다 → ⓒ control의 ACP `tool_call`(provider-bound tool name +
  `rawInput.probeRunId`)과 fixture `tools/call.params.arguments.probeRunId`를 **`runId` + `probeRunId`**로 join한다
  → ⓓ 그 ACP 이벤트에서 관측한 provider-bound tool name을 **`expectedProviderToolId`**로 저장(실측, hardcode 금지).
  ACP `toolCallId`와 MCP JSON-RPC id는 artifact에 보존하되 **cross-layer equality·join key로 쓰지 않는다.**
  아래 모든 absence 주장은 그 실측값과 비교한다.
  **P0 승격은 서사가 아니라 마커로 판정한다.** "과거 표본과 같아 보인다"는 판정 술어가 아니며, 그 추론이야말로
  이 probe가 대체하려는 것이다: ⑴ `tools_list_response_forwarded` 없음 → MCP handshake/fixture/config 후보,
  **승격 금지** / ⑵ 기대 도구의 `tools/call`이 fixture에 도달했으나 실패 → dispatch는 이미 성립했고 실행 실패,
  schema absence 아님, **금지** / ⑶ `tools_list_response_forwarded` **그리고** 명시적 호출 프롬프트 전송
  **그리고** fixture `tools/call` 마커 **없음** **그리고** 런타임 `No such tool available: <id>`의
  `<id> === expectedProviderToolId` → **직접 schema-absence 증거**, pre-turn assertion·config 유효 시
  **승격 가능** / ⑷ 같은 조건인데 `<id>`가 bare 이름이나 다른 alias → model·alias mismatch, **금지** /
  ⑸ call marker 없음 + 직접 런타임 에러 없음 + 모델이 "도구가 없다"고 말만 함 → model-compliance·증거불충분,
  **모델 발화 단독 승격 금지** / ⑹ **같은 `runId`·같은 prompt request에 귀속된** provider-bound schema snapshot을
  `tools_list_response_forwarded` **이후**에 떠서 `expectedProviderToolId` 부재 확인 → ⑶과 동급.
  (`forwarded < snapshot` 순서를 닫아야 한다 — prompt 이후 임의 시점 캡처는 dynamic update 때문에 다른 주장이다.
  가능하면 snapshot은 provider가 모델 요청에 실제로 넘긴 tool-definition set이어야 한다.)
  나열되지 않은 조합은 기본값 **P0/inconclusive**.
  ②/③의 경계는 에러 문구가 아니라 **fixture `tools/call` 마커의 유무**로 갈린다.
  순서는 ⓐ `P0` 사실로 artifact 보존·기록 → ⓑ setup/pin/config/fixture/model-compliance 분류 →
  ⓒ 위 표에서 승격 가능한 행일 때만 원장에 표본으로 **승격**. control 실패를 B나 D에 섞는 것도 금지. /
  A: ordering 유지 **그리고** newSession latency가 `D1`,`D2`를 따라 이동(이 서버·이 경로의 wait 증거) /
  B: control은 callable PASS인데 delayed run이 wire-availability보다 앞서고 absence(창의 **충분성**) /
  C: control PASS, delayed run이 앞서지만 이후 direct tool-call 성공(fence 없이 late·dynamic readiness) /
  D: 경계보다 충분히 작은 D인데 error·timeout — **반드시 phase 이름을 붙이고, delay가 실제로 닿는 phase만
  D다**: `D-newSession` / `D-enforceModel` / `D-prompt`(600초 경계, 도구 부재와 별도 분류).
  `INITIALIZE_TIMEOUT_MS`도 기록은 하되 거기서의 실패는 위 P0·I0이지 **D가 아니다**.
  **B가 나와도 2026-07-24 3표본의 원인 확정은 아니다** — causal sufficiency ≠ incident attribution.
  도구 present 1회로는 A와 C를 구분 못 해 반증도 안 된다.
  **마커 정의 — 이걸 "ready"라고 부르지 마라.** `server.connect()`도 initialize 수신도 아니고, **fixture
  handler의 return도 아니다**(직렬화·write 시간만큼 앞당겨진다). 구현 가능한 한 점으로 고정한다:
  **`tools_list_response_forwarded`** = MCP-side wire proxy가 기대 도구가 담긴 `tools/list` 응답 프레임 **전체**를
  downstream stdio에 `write()`하고 **write callback을 받은 시점**. 이것은 **wire-availability proxy**이지
  readiness가 아니다 — 바이트를 넘겼다는 뜻이지 client가 파싱·설치했다는 뜻이 아니며, 모든 기술에서 계속
  wire-availability로 부른다. **실제 callability는 오직** 기대 도구에 대한 `tools/call` 요청이 fixture에 도달한
  별도 마커로만 확정한다. 최소 비교는 한 타임라인 위의
  `tools_list_response_forwarded ↔ newSession end ↔ prompt request start`이며, 모든 프로세스가 하나의
  append-only NDJSON event log(`runId` + 공유 wall-clock + pid + monotonic counter)에 쓴다.
  런타임 `No such tool`은 absence 증거로 별도 유지한다.
  **client seam을 명시해야 실행 가능하다** — 제품 turn loop를 안 고치므로 ⓐ ACP stdio wire proxy(실 경로를
  건드리지 않고 JSON-RPC 프레임에 타임스탬프) 또는 ⓑ probe 전용 raw client(대신 production sequence와 동일
  args/order임을 게이트로 묶어야 함) 중 하나를 골라야 한다. `session ready` 텍스트로 추정하는 건 금지.
  **probe가 답하는 질문은 좁다:** "이 서버는 지연된 MCP를 기다리는가, prompt가 먼저 열리는가, fail-loud인가."
  이건 인과 질문의 **입력**이지 결론이 아니다. probe는 backend 무관이라 `cortex acp serve`에도 겨눌 수 있다.
  **처방·adapter member·turn loop 수정은 이 probe 결과 전에는 착수 금지.**
- **D. rail 문서 마감.** GLG 기준은 "더 수정할 게 없을 정도". §11이 §11-1~§11-7로 섰고, 문장 강도를
  C의 확정 수준에 맞춰 유지한다.
- **Do not touch:** ACP를 citizen layer로 승격 · common layer 대공사(0.12.10 수선 컷 범위를 넘고 Cortex를
  더 늦춘다) · Snowflake credential copy/parse · PR contributor commit squash/credit 삭제.

## QUEUE — 순서는 고정, 각 lane은 다시 검수

1. **0.12.10 — acp 0.62.0 핀 + rail 문서 수선 컷.** 위 NOW의 A·D. 지금 컷.
2. **readiness — §11-7 ordering probe 구현.** 0.12.10 뒤. ordering 결과를 A/B/C/D로 **분류**하고,
   causal attribution에 무엇이 더 필요한지 정한 뒤에만 처방을 논한다. probe 1회는 결론이 아니다.
3. **#48 — Cortex ACP support.** reference adapter가 모델을 outbound sibling dispatch까지 데려간다는 것을
   증명한 뒤에 두 번째 backend를 태운다.
   - PR #40은 OPEN·`DIRTY`, head `3dd6f5fa530c2f91e436abc3b4d79dbc2adc4d53` — #48이 인용한 `d8baf79`와 다르고,
     이슈 전제였던 `pi/entwurf-targets.json` spawn allowlist는 #50에서 삭제됐다. 로컬 Cortex는 **v1.1.47**
     (#48의 overlay 실측 v1.1.8은 낡음).
   - **충돌 실측(`git merge-tree --write-tree main pr40`):** conflict 4개 —
     `CHANGELOG.md` · `docs/acp-backend-rail.md` · `package.json` · `run.sh`. 어댑터 코어
     (`backend-adapter.ts` · `augment.ts` · `overlay.ts` · `models.ts` · `check-acp-cortex.ts`)는 무충돌 —
     rail이 설계대로 작동한 증거다. (로컬 rail 문서 편집이 #40과 같은 구역이라 그 conflict는 조금 넓어진다.)
   - **PR #40의 미완 deliverable:** #40 CHANGELOG가 `scripts/smoke-acp-cortex-live.ts`를 "pending
     deliverable, the target fails loud until it lands"라고 스스로 적었고 그 파일은 PR에도 main에도 없다.
     쓸지, 타깃을 빼고 낼지 먼저 정한다.
   - **미측정:** `cortex acp serve`의 ACP protocol 호환성, hook 발화 여부(§11-6 — 번들 hook이
     `SNOWFLAKE_HOME` 오버레이 밖에 있다).
4. **#56 — Codex native citizen.** #48 뒤 착수. 로컬 Codex는 현재 0.145.0으로 이슈의 fresh evidence와
   같지만, app-server-backed launch / default UDS / native hooks / `thread/loaded/list` / call-ticket 설계는
   다시 실측한다. Codex는 ACP backend가 아니며 existing `native-push` leaf를 재사용한다는 경계도 코드와
   upstream을 대조한 뒤 채택한다. standalone TUI를 deliverable로 과장하지 않는다.
5. **#47 — mux driver.** Codex 뒤 착수. `docs/mux-launch-rail.md`와 이슈는 0.12 이전 가정이 많으므로
   인터페이스부터 복사하지 않는다. 현재 호스트는 tmux 3.6a, zmx는 PATH에 없다. current production의
   fresh-mint 빈칸과 실제 repro/demo 소비자를 다시 inventory한 뒤 tmux/zmx primitive 경계를 정한다.
   mux는 identity/lineage/dispatch authority가 아니다.

## RECENT — 0.12.9 closure (2026-07-26~27)

- release SHA/tag `9e9124a`, GitHub release `v0.12.9`; prepared exact-SHA CI
  [30187405405](https://github.com/junghan0611/entwurf/actions/runs/30187405405) 3잡 success.
- npm: `latest=0.12.9`, `repair=0.12.8-repair.1` 보존. Preserved candidate sha256
  `1d63a951aaaea78d76864ce0df52e14e2ccf578073bf6a1c3895752c1c47b78d`; registry U3 PASS.
- #52 close ledger: https://github.com/junghan0611/entwurf/issues/52#issuecomment-5086211025
- #54 close ledger: https://github.com/junghan0611/entwurf/issues/54#issuecomment-5086212012
- #49는 완료된 A/B와 superseded C, 미착수 E를 분리해 닫았다. 옛 plan을 실행하지 않는다:
  https://github.com/junghan0611/entwurf/issues/49#issuecomment-5086222120
- #55는 OPEN. 발견된 legacy resume-builder arm/run.sh prose residue는 비차단 finding으로 기록했다:
  https://github.com/junghan0611/entwurf/issues/55#issuecomment-5086220516

## RELEASE / HOST INVARIANTS

Claude Code `>=2.1.217` · Linux desktop/workstation 유일 certified axis · Node 24+ · pi 0.82.1
(`>=0.82.1 <0.83`) · active store v3-only · meta-record가 유일한 garden address · v2는 기존 citizen
대상이고 fresh creation은 별 능력 · auth/credentials는 각 native backend 소유.
