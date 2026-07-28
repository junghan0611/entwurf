# NEXT — ACP rail 검증 우선: §11-7 측정이 아직 owed (Cortex는 그 뒤)

> NEXT는 부트 섹터다. 이슈는 설계 SSOT가 아니라 과거 가설과 증거의 묶음이다.
> 다음 세션은 이슈를 구현하지 말고 **현재 main·현재 upstream·현재 live surface를 먼저 검수**한다.

> **2026-07-27 축 전환 (GLG 지시).** 이전 NEXT는 `#48 Cortex → 0.13.0`이었다. 뒤집혔다:
> *"claude acp 쪽에서 다 검수가 완벽하게 되고 레일문서가 더 수정할게 없을정도로 문제가 없어지면
> 그때 cortex 작업 들어갈거야. 순서가 cortex가 아니야. 기본도 안되는데 cortex를 품을 수는 없어."*
> 이어서: *"0.13.0 안가고 지금 수선하면 0.12.10으로 acp 수정 및 rail 문서 업데이트만 들어가도 좋겠다."*
> → **0.13.0은 지금 가지 않는다.** readiness 인과 규명은 그 뒤에 이어지고, #48 Cortex는 rail이 정리된 다음에 연다.

## NOW — §11-7 probe는 섰다, 측정이 아직 판정 불가

> **2026-07-28 (GLG 지시).** *"0.12.11 갈 필요 없거든. 이거 이번에 잘 막았으면 다음 작업 준비하면 되거든.
> 검증 미진한 것을 기록해둬야 이어서 검증부터 하고 구멍 막고 다음 작업할 거야."*
> → 릴리즈 컷이 아니라 **검증 미결을 보존하는 마침표**다. 다음 세션은 새 작업을 열기 전에 아래 미결부터 닫는다.

- **Current:** §11-7 ordering probe가 게이트와 함께 main에 있다 — `4a629be`, push 완료.
  `pnpm check` EXIT=0, gate-qualification **35/35 killed**(lane `probe-ordering` 19).
  계약 아래 첫 LIVE pair도 돌았고 **malformed 0**이지만 **verdict는 `inconclusive`** — 계측기는 admissible,
  측정은 아직 owed다. 수치·근거는 `docs/acp-backend-rail.md` **§11-7-b**에 있다. 여기서 반복하지 않는다.
- **Next:** (1) 모델이 지연 창 안에서 **호출을 시도하도록** 프롬프트/전략을 바꿔 LIVE pair 재실행 →
  (2) D1에서 측정된 id를 지목하는 런타임 `No such tool`이 뜨는지로 delta-B 재판정 →
  (3) 그때만 원인·처방을 논한다. probe 1회는 결론이 아니다.
- **검증 미결 — 다음 세션이 먼저 닫을 것:**
  - **판정 불가 자체가 미결이다.** A(대기 가설)는 이 서버·이 경로에서 반박 *방향*이지만 승격 가능한 증거는
    없다. `inconclusive`를 "문제 없음"으로 읽지 마라.
  - **중복 마커 정책이 열려 있다.** `deriveRunFacts`는 `events.find()`로 **첫 마커만** 읽는다.
    `tools_list_response_forwarded`는 first-wins가 옳지만(클라이언트가 tools/list를 여러 번 부를 수 있고
    wire availability는 최초 forward다), **한 run에 phase end가 두 번 나오면 두 번째가 조용히 무시된다.**
    parser가 아니라 **classifier 정책**이고 §11-7 문서 측 합의가 필요하다 — 임의로 닫지 마라.
  - **D1 evidence 문자열이 ran-ahead를 노출하지 않는다.** 분류는 계약대로 inconclusive가 맞지만, artifact만
    읽어서는 "턴이 wire보다 앞섰다"는 관측이 안 보인다. 판정 결함이 아니라 진단 가능성 결함이다.
  - **계약 이전 artifact 2개는 재파싱하면 INVALIDATED다**(ts/tsMs 1 ms straddle 실측 2건). 포렌식 기록으로만
    쓰고 승격 근거로 재사용하지 마라.
- **Blocker:** 없음. LIVE 재실행은 실 API를 쓰므로 GLG 승인 사안이다.
- **읽을 곳:** `docs/acp-backend-rail.md` §11-7 → §11-7-a(as built) → **§11-7-b(첫 측정)** →
  `scripts/check-probe-ordering.ts` 헤더(5축 + review-pinned 목록) → `scripts/lib/probe-event-log.ts` 문 계약.
- **Do not touch:** 이 증거로 product turn loop(`backend.ts`)·rail 처방·릴리즈 노트를 바꾸지 마라.
  classifier/verdict 의미는 §11-7 문서 합의 없이 손대지 않는다. **LIVE 재판정 없이 0.12.11을 컷하지 마라.**

## LEDGER — 0.12.10 컷 (닫힘, 2026-07-27 출하)

> 아래 A–I·G는 **닫힌 컷의 사고 이력**이다. 결과는 `CHANGELOG.md` 0.12.10에, 설계는
> `docs/acp-backend-rail.md` §11에, kill-proof는 `scripts/mutants/*.json`에 승격돼 있다.
> 되묻기 전에 거기부터 읽어라. 0.12.10 스코프는 acp 0.62.0 핀 + rail 문서 + pi 특별대우 잔재 제거 +
> AGENTS 예산 게이트 넷이었고, 넷 다 닫혔다.

- **계기:** GLG가 실사용에서 ACP Claude가 entwurf를 못 쓰는 걸 봤다. 문서상 shipped인데 실제로는
  형제에게 닿지 못하는 상태였다. 번들 `entwurf-bridge` MCP 도구가 세션 tool schema에서 빠지는 증상.
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
  C의 확정 수준에 맞춰 유지한다. §11-1의 `pi (substrate) →`는 **implementation dependency order**로
  교정됐다 — citizen rank가 아니다.
- **E. pi 특별대우 잔재 제거 + AGENTS 예산 게이트 — 완료. §F가 그 뒤 두 라운드의 수선 이력이다.**
  - **판정(GPT + Claude Code 교차검수).** `LIVENESS_DOMAIN_BACKENDS=["pi"]`와 control-socket
    lock/probe/spawn 분기는 **정당한 transport capability 차이라 유지**한다. 지우면 안 된다.
    `entwurf-self-address.ts` 머리의 *"pi-native answer that from env presence alone"*은 **stale 주석**이었고
    과거형 + record-derived carrier로 교정했다. **PI_SESSION_ID는 record birth가 세운 garden id의
    child carrier일 뿐 주소 권위가 아니다** — `meta-record가 유일한 garden address` invariant는 pi에도 그대로다.
  - **심볼 개명:** `isNonPiGardenIdSocketConflict` → `isOutOfSocketDomainGardenIdConflict`,
    `piGids` → `socketDomainGids`. source·tests·`run.sh` 메시지까지 따라갔다.
  - **`meta-session.ts` 헤더**를 "native용 bib card"에서 "모듈명은 역사, live V3 schema는 pi 포함
    모든 citizen의 one authority"로 교정. marker native-3은 pid-hook rail 차이라 **유지**.
    "pi dormant→resume→mailbox, really BIMODAL"은 현재 v2와 어긋나 제거하고, **spawn-bg는 mailbox가
    아닌 별 transport**로 명시했다.
  - **AGENTS.md 54,256 B → ≈16.6KB (약 70% 감축).** 21KB짜리 Hard Rule 사건 연대기를 invariant로 압축하고 상세는
    CHANGELOG/issues/source/gates가 받는다. North Star 한국어 문단은 보존됐고
    `AGENTS.md:11`이 pi 동급화를 문서 최상단에 박았다.
  - **회귀 게이트 신설:** `check-acp-carrier-augment` 9번 블록 — 실제 repo AGENTS.md + 12KB global
    baseline이 50KB cap에서 truncation 없이 말미 `Current working directory`까지 보존되는지 검사.
    **이건 실측 결함의 회귀 방어다:** 2026-07-27 이전 상태는 augment 총량 64,535 B로 **13,445 B가
    tail-cut**됐고, `AGENTS.md:211-285`(Typecheck Boundary·Runtime Dependencies·Working Style 등)과
    `Current date`/`cwd` 두 줄이 ACP 형제에게 **구조적으로 안 보였다**. 현재 여유는 약 22KB.
  - **남긴 것:** `scripts/smoke-pi-attach.ts:312,321`의 `"the pi rail"`은 계약 문구가 아니라 스모크
    payload nonce이고 320행이 이미 `control-socket rail`로 정확히 라벨한다. LIVE 스모크라 오프라인
    검증이 안 되므로 **건드리지 않았다.** CHANGELOG historical tombstone도 손대지 않는다 — history는
    쓰인 당시 숫자를 유지한다(`check-claude-floor-coherence`가 CHANGELOG/NEXT를 sweep에서 제외하는 이유).
  - **retired-v1 prose sweep — GPT#2 검토 후 소진(2026-07-27).** 0.12 cutover에서 제거된
    `entwurf`/`entwurf_resume`/`entwurf_send`를 **현재형으로** 살아있다고 주장하던 자리를 전부 과거형으로
    고쳤다: `entwurf-v2-contract.ts`(4곳: "still live"/"is untouched"/"keeps it"/"still covers"),
    `entwurf-v2-lock.ts`(v2/legacy residual gap은 **verb 제거로 닫혔다** — lock이 넓어져서가 아니다),
    `entwurf-resume-args.ts`+`check-entwurf-resume-args.ts`+`run.sh`(legacy launcher `entwurf-async.ts`
    부재), `tsconfig.json:79`(개명 전 심볼 `isNonPiGardenIdSocketConflict` 잔존).
    `entwurf-v2-contract-schema.ts:40`도 같은 문구를 갖고 있어 교정했다. **다만 이 파일은 shipped tool
    schema가 아니다** — import graph 실측 결과 `check-entwurf-v2-contract`만 읽는 **gate-only
    representation**이고, 헤더의 "Consumers: the pi MCP-tool param surface"가 낡은 서술이었다.
    (Claude Code가 한때 이걸 "모델이 읽는 schema"로 보고했는데 **오판이었고 GPT#2가 잡았다.** 파일 헤더에
    "모델용 description은 저기서 고쳐라"를 박아 같은 오판을 막았다.)
  - **spawn-bg는 별개 relaunch transport다 — 그러나 별개 domain은 아니다.**
    `entwurf-v2-spawn-production.ts`의 거부 문구를 "control-socket rail이 아니라 host-adapter relaunch
    capability"로 고쳤고, `AGENTS.md`·`VERIFY.md`도 같은 강도로 맞췄다.
    **Claude Code가 처음 쓴 "독립 spawn-resume domain / 미래 backend가 하나만 가질 수 있다"는 코드보다
    강했고 GPT#2가 철회시켰다** — 실측: `DISPATCH_TABLE["owned-outcome"].dormant`는 dispatch liveness
    **하나로** `spawn-bg`를 내고, 별도 spawn-domain predicate가 **없으며**, backend 권한은
    `resolveResumeLaunchIdentity`가 뒤늦게 검사한다. **별도 predicate가 생기기 전까지 독립 domain으로
    서술하지 마라** — 그건 core refactor이고 0.12.10 범위 밖이다.
  - **모델이 실제로 읽는 두 surface를 수선했다 — 여기가 진짜 결함이었다.**
    `pi-extensions/entwurf-control.ts`(TypeBox + 긴 description)와 `mcp/entwurf-bridge/src/index.ts`(Zod)
    **둘 다 shipped `native-push` rail을 routing/intent 설명에서 누락**하고 있었고, *"For a meta-session
    (liveness=unsupported) replies are ALSO fire-and-forget (→ mailbox)"*라고 단언했다. **Antigravity에는
    거짓이다** — native-push는 mailbox mini-table **앞에서** 가로채져 live conversation에 direct injection
    되고 mailbox가 아예 없다(`entwurf-v2-contract.ts:280`). 모델이 그 문장을 읽고 없는 mailbox 의미론을
    골랐을 자리다. 네 rail을 다 적고 "unsupported라고 전부 mailbox가 아니다"를 명시했다.
    **`check-entwurf-v2-surface`에 rail-completeness assertion 2개를 신설**해 다시 빠지면 red가 된다.
  - **`ResumeArgsVariant`의 `"legacy"` variant 제거(GPT#2 판정).** 프로덕션 소비자 0이었고, 바로 그
    dead branch가 이번 false-live prose 3건을 낳았다. Claude Code는 #47이 되살릴 수 있다며 보류를
    제안했으나 GPT#2 판정을 받았다 — #47은 git history에서 **재측정**하라고 하지 옛 interface를 복사하라고
    하지 않으며, dead exported branch를 미래 가능성 때문에 두는 쪽이 재오독·우발 호출 위험이 크다.
    A1 대조는 v2 단일 게이트가 `--entwurf-control` 존재 + `--no-extensions` 부재를 직접 핀해 보존된다.
  - **sweep 잔여:** 아래 F가 소진 대상이다.

- **F. blocker 7건 + 재검수 1차 finding 10건 — 전부 수선 완료(Claude Code `…-11766e`, 2026-07-27 14:2x).**

  **상태:** `pnpm check` EXIT=0(파이프 없이 로그파일 + `EXIT=$?` 분리) · `git diff --check` PASS ·
  `build-bridge`는 소스 편집 후 실행 · 커밋/푸시 없음. 게이트 수: `check-entwurf-v2-surface` 71 → **121**,
  `check-entwurf-self-address` 31 → **42**.

  1. **F-1 완료.** `entwurf_self`의 `origin === "meta-session"` 무조건 mailboxPath를 rail별로 갈랐다.
     새 타입 `AuthoritativeSelf { envelope, metaDeliveryDomain? }` — rail은 **와이어 envelope 밖**에
     실린다(AGENTS가 핀한 `{sessionId,agentId,cwd,timestamp,origin?,replyable?}`를 넓히지 않았고
     `buildSendSenderEnvelope`는 `meta.envelope`만 넘긴다). self-fetch → mailboxPath, native-push →
     "no inbox to drain", rail 미해결 → fail-closed. 에러 문구 2곳 + tool description을 양쪽
     hook(SessionStart / PreInvocation)으로 교정.
  2. **F-2 완료.** 코드 실측: lock claim은 control-socket-domain 분기에만(live send **와** dormant
     spawn-bg 둘 다), mailbox·native-push는 `lock: null` · `mode` 필드는 `ExecutionPlan` 변종 중
     `control-socket` **하나뿐** · `resolveDispatch`가 unsupported f&f를 `mailbox-undeliverable`로 강등
     (codex 레코드는 `wakeMode !== "self-fetch"`로 거부). 세 문장 모두 양쪽 surface에 반영.
  3. **F-3 완료 + 자체 repo 전체 sweep.** `run.sh`(legacy async worker 공유 주장) ·
     `entwurf-core.ts`(consumer 목록을 import graph 실측으로 **direct importers**로 교체 — MCP bridge는
     **direct import는 없고 spawn-bg 경로의 transitive consumer**다, 재검수 finding H로 정정) · `entwurf-control.ts`(Layer A 2곳 + `registerSessionTool` 포인터 +
     **dangling TS2589 주석을 실제 설명으로 복원**) · `entwurf-deliverability.ts`/`check-`(v1 enqueue site
     2쌍) · `acp/overlay.ts:14` · `check-shell-quote.ts:9` · `demo/demo.sh` 헤더 archived 배너.
  4. **F-4 완료.** `<sessionId>.sock` → `<gardenId>.sock` · `README:658` pi-as-memory-authority 제거 ·
     trusted meta-session = 전부 replyable(2곳) → rail이 결정하는 fact · `setup-clean-host` mailbox 보편성 ·
     README lock 서술 2곳 identity-rank → capability-domain 명명.
  5. **F-5 완료.** rail `:362`의 spawn-resume domain 주장 철회 + "spawn-domain predicate는 없다" 명시 ·
     0.12.10 스코프 서술 2곳을 **4항목**으로.
  6. **F-6 완료.** MCP `v2Block`의 `after === -1 ? undefined` 제거 + real-end-boundary assertion 선행
     (peers/inbox_read slice에도 동일) · **parameter 마커 부재** 음성 assertion 신설(containment
     disjointness만으로는 over-wide slice를 못 잡는다 — round 5가 그 사례).
  7. **F-7 완료 — describe를 골랐고 GPT가 승인했다(아래 QUEUE 1).**

  **음성 대조 — 게이트가 실제로 막는 것을 따로 측정했다(§G ⑷ 대응).** 소스를 결함 상태로 되돌려 red 확인:
  ⒜ MCP long desc "socket paths per-target lock" 복원 → EXIT=1 / ⒝ pi-native mode param을 "Delivery mode
  for a live send"로 복원 → EXIT=1 / ⒞ `entwurf_v2` 이후 `server.tool(` 4개 개명(boundary 소멸) → EXIT=1 /
  ⒟ inbox_read "your own" 복원 + SCOPE 문단 삭제 → EXIT=1. 각각 restore 후 EXIT=0. 게이트 내부에도 합성
  음성 대조 2종(정확한 거짓문 / 누락)을 넣어 F-1 predicate를 스스로 시험한다.

  **런타임 실측(소스 핀이 아니라 동작):** bridge를 직접 띄워 `entwurf_self` 호출 → self-fetch rail이
  `rail: self-fetch` + mailboxPath를 렌더하고 JSON에 `metaDeliveryDomain:"self-fetch"`가 실렸다. F-1 에러
  문구도 런타임 확인.

  **native-push rail도 실측됐다(2026-07-27 14:40~14:43, GLG가 agy 세션을 띄워줘 처음 가능해졌다).**
  이전 문장은 "스토어에 antigravity 레코드가 0이라 못 쟀다"였는데 그 조건이 사라졌다. 레코드
  `20260727T144001-f56d17`(backend=antigravity, model=gemini-3.1-pro-low, cwd=entwurf), 마커
  `meta-senders/antigravity/1577195.json`, ownerPid `agy` alive. 잰 것 넷:
  ⑴ **mailbox 디렉토리가 존재하지 않는다** — `meta-mailbox/…-f56d17/`가 없다. "native-push에는 inbox가
  없다"가 서술이 아니라 파일시스템 상태다. ⑵ `entwurf_v2` fire-and-forget → **`native-push → delivered`**.
  decider가 mailbox가 아니라 직접 주입을 골랐다. ⑶ 그 세션이 **자기 쪽에서** `entwurf_self`를 호출한 렌더가
  `rail: native-push` + `mailbox: none — native-push has no inbox; a reply direct-injects only while the
  adapter probe is alive` + JSON `metaDeliveryDomain:"native-push"`이고 **mailboxPath 필드가 없다**.
  peer의 붙여넣기를 근거로 쓰지 않았다 — `mcp/entwurf-bridge/src/index.ts:502`의 소스 문자열과 대조했다(§G ⓓ).
  ⑷ 회신에 붙은 sender 헤더에 rail이 **없다** — `metaDeliveryDomain`이 wire envelope을 넓히지 않는다는
  F-1 설계(`index.ts:198-201`, `:256-266`)의 런타임 확인이다. 덤으로 `replyable:true`가
  `probeNativeSenderAlive`를 실제로 통과해 나왔으므로 finding I의 probe 조건부 경로도 밟혔다.

  **범위를 넘겨 읽지 마라.** 이건 프로덕션 surface를 통한 **기회적 host 측정**이지
  `smoke-agy-native-push-live`(=`AGY_CONVERSATION_ID` 필요) 게이트를 돌린 것이 아니다. 결정적 게이트
  커버리지는 여전히 소스 핀 + 회귀 차단이고, LIVE 게이트 축은 미실행 상태 그대로다.

  **게이트 slice 정규화 신설:** `modelText()` — pi는 template literal 줄바꿈, MCP는 `+` concat이라 같은
  문장이 한쪽에서만 매치되어 assertion이 의미가 아니라 **줄바꿈 방식**을 재고 있었다.

  **GPT 재검수 1차(14:10~14:17) — 판정 2건 + finding 10건(A~J), 전부 수선 완료.**

  판정: ⑴ **F-7 describe 선택 승인** — 문서화된 external-host inbox read 보장과 marker 만료 경로 때문에
  0.12.10에서 identity 강제는 행동 변경이고, gardenId equality만으로 풀 문제가 아니다(보안 hardening은 별도
  capability/token 설계). ⑵ **`entwurf-mailbox-guard.ts` 삭제** — production importer 0인데 production-shaped
  gate가 별도 구현만 green으로 만드는 건 false assurance. `ResumeArgs legacy`와 같은 원칙. **실행 완료**:
  source + gate + `package.json` check chain + `run.sh` usage/function/case + `tsconfig.json` fence entry +
  prose 동시 제거(tarball 277 → 275). shipped seam은 v2 decider/production/mailbox 게이트가 소유한다.

  **내 작업의 결함 4건(F·G·H·I) — cross-review가 잡았다:**
  - **F(게이트 증명 과장).** `metaRailRenderIsHonest()`가 mailbox가 self-fetch guard **뒤**에 있는지만 봤고
    **안**에 있는지는 안 봤다. `if (rail === "self-fetch") { }` + 무조건 mailbox 빌드가 통과했다 — 순서는
    containment이 아니다. brace-balanced branch body 추출로 교체하고 그 형태를 **3번째** synthetic negative로
    박았다. 실제 소스에 그 형태를 주입해 red 확인(NEG E).
  - **G(핀 과장).** inbox 게이트의 `readMetaInbox({ gardenId })`는 pass-through를 증명하지 않는다(identity
    guard를 앞에 넣어도 green). identity 해결 부재를 negative로 요구하도록 바꾸고, 실제로 own-inbox guard를
    주입해 red 확인(NEG F).
  - **H(내 F-3 수정이 과했다).** `entwurf-core.ts`에 "MCP bridge는 이 모듈을 아예 import하지 않는다"고 썼는데
    **transitive consumer**다: `index.ts → entwurf-v2-surface → entwurf-v2-production →
    entwurf-v2-spawn-production → entwurf-core`. "direct importers" 명명 + transitive 경로 명시로 교정.
  - **I(내 F-1 문구가 과했다).** native-push render가 probe dead여도 "into this live conversation"이라 했다 —
    없는 rail을 발명하지 않는 게 F-1의 핵심인데 dead rail에 live conversation을 발명했다. probe 조건부로
    고치고 게이트가 그 조건까지 핀한다.

  **나머지 finding:** **J** native-push probe는 3값인데 두 값으로 접혀 indeterminate를 dead로 거짓 표기 →
  양쪽 surface long+intent와 peers에 `dead → native-push-target-dead` / `indeterminate →
  native-push-probe-indeterminate` 분리, 게이트는 이름 존재뿐 아니라 **liveness↔reason 인접성**을 요구(mapping
  뒤집기 red 확인, NEG H). **A** `smoke-entwurf-v2-matrix-live.ts:69` "keyed by session id" → record gardenId.
  **B** `README:730` "wants_reply는 non-replyable external sender에서만 거부" → v2는 replyability로 gate하지
  않는다(등가 문구 제거). **C** `entwurf_self` "when a replyable identity exists" → authoritative identity
  (inactive rail도 identity는 보존, replyable:false). **D** 2-rail truth table 요약 누락 3곳(gate 헤더,
  `run.sh` usage/function). **E** `README:535` inbox를 "fact surface"라 불렀다 → read surface, peers=fact /
  inbox=mutating drain.

  **게이트 수 최종:** `check-entwurf-v2-surface` 71 → **121**, `check-entwurf-self-address` 31 → **42**.
  음성 대조 누적 8종(A~H) 전부 red 확인 후 restore green.

  **미착수:** **#37 FAQ live-stale** — 모든 citizen이 inbox를 갖는다고 하고 제거된 `entwurf_send`를 이름으로
  부른다. repo 파일이 아니라 이슈 코멘트이고 GitHub 쓰기는 GLG 승인 사안이라 안 건드렸다.

  **GPT 3차가 독립 확인한 것(재검증 불필요):** slice probe 값 · `check-acp-carrier-augment` PASS ·
  **실제 host augment 27,636 B, truncation 없음, cwd 말미 보존** · 편집/커밋/푸시 없음.
  (`check-entwurf-v2-surface` 71 PASS는 이제 112로 이동했다.)

  **이슈 sweep(GPT 3차):** #56의 `pi (+ ACP) → control-socket/spawn-bg`는 정당한 capability matrix다.
  #30·#38은 historical plan. #48의 낡은 registry/allowlist 전제는 이미 NEXT·rail이 격리했고 새 증거가 아니다.


- **H. agy 권한 rule을 도구 집합으로 — GO 이후 추가분(2026-07-27 14:4x, GLG 지시).**
  **계기는 또 실사용이다.** GLG가 agy 세션을 띄워 실측을 도와주던 중, 그 세션이 `entwurf_self`를 부를 때마다
  y/n을 물었다. 설치기가 심는 allow rule이 `mcp(entwurf-bridge/entwurf_v2)` **하나뿐**이어서
  `entwurf_peers`·`entwurf_self`는 영원히 프롬프트했다. **§F가 고친 것과 같은 결함 계층이다** — 문서상
  shipped인데 실제로는 표면의 3분의 2가 못 쓰이고, doctor는 green이었다(entwurf_v2만 봤으니까).
  - **범위: 정상 경로 도구만.** `entwurf_v2`·`entwurf_peers`·`entwurf_self` 셋. **"model-facing"이라
    부르지 마라 — MCP 5개 전부 모델에 보인다(검수 finding 5).** 자동 승인하는 쪽이 더 작은 집합이고
    그게 의도다. `entwurf_inbox_read`는
    **제외** — native-push에 inbox가 없다(위에서 실측). `entwurf_register_native`도 제외 — explicit/manual
    fallback이고 정상 birth 경로가 아니다(`DELIVERY.md:114`). 안 쓰는 권한은 안 받는다. Q-AGY-OWNERSHIP의
    "narrowest rule" 원칙은 유지된다 — 좁은 rule 셋이지 `mcp(*)`가 아니다.
  - **provenance는 rule마다 따로.** agy의 "always allow" 프롬프트는 한 번에 하나씩 persist하므로, 운영자가
    `entwurf_self`만 갖고 있고 나머지는 우리가 심는 **혼합 소유**가 정상 상태다. 집합 단위 플래그였다면
    uninstall이 남의 rule을 뺏거나 우리 rule을 영원히 남긴다. `rulesExistedBefore`가 rule별로 답한다.
  - **state schemaVersion 1 → 2.** v1(`rule`/`ruleExistedBefore`)은 install이 제자리 이관하고 uninstall이
    양쪽 shape을 읽는다. 옛 state로 uninstall해도 그 install이 심은 것만 정확히 걷어간다.
  - **doctor에 `partially-configured` 신설.** 일부만 승인된 호스트를 green으로 부르지 않는다 — 처음 시도한
    도구가 마침 승인돼 있었다는 이유로 표면 전체를 승인됨으로 반올림하는 게 바로 이번 결함이었다.
  - **rule 목록의 SSOT는 하나.** 셸과 smoke가 문자열을 다시 타이핑하지 않고
    `agy-bridge-config.py permission-rules`에서 읽는다. 다음에 도구를 하나 더 배포할 때 조용히 안 심기는
    경로를 닫았다.
  - **GPT `…-1e4959` 검수 1차 → NO-GO, finding 5건 전부 수선 완료.** 둘은 내가 이 lane에서 만든 결함이다.
    - **⑴ 게이트 oracle이 자기참조였다.** smoke가 SUT의 `permission-rules` 출력을 그대로 기대값으로 써서,
      `inbox_read` 추가나 `peers` 치환 같은 **과승인이 통과했다.** 운영 SSOT는 하나여도 gate oracle은
      독립이어야 한다 — exact ordered set을 smoke에 리터럴로 박고, 금지 도구 2종 부재를 따로 요구한다.
    - **⑵ v1→v2 이관이 prose에만 있었다.** 수동으로 PASS를 봤다는 건 release contract가 아니다.
      실제 v1 fixture로 (a) 제자리 이관 (b) 3자 provenance(옛 v2=ours / 운영자 peers=theirs /
      새 self=ours) (c) 미이관 v1 상태에서의 직접 uninstall을 게이트가 소유한다.
    - **⑶ 내 결함 — 상수 하나가 두 state를 찍었다.** `STATE_SCHEMA_VERSION=2`가 일반 MCP install-state
      까지 올려버렸다. shape이 바뀐 건 permission-state뿐인데. 상수를 분리했고(`STATE_SCHEMA_VERSION=1` /
      `PERMISSION_STATE_SCHEMA_VERSION=2`), **permission state 파서를 fail-loud로** 바꿨다 —
      `rulesExistedBefore: {}` 하나로 **운영자 rule 전체가 삭제되는 경로**가 있었다.
      unknown/malformed schema는 이제 거부한다. uninstall 거부는 복구 가능하지만 남의 grant 삭제는 아니다.
    - **⑷ 내 결함 — doctor의 exact shadow 진단이 거짓이었다.** `ask=[mcp(entwurf-bridge/entwurf_self)]`는
      그 도구 하나만 막는데 "EVERY entwurf tool call이 막힌다"고 출력했다. 운영자를 없는 wildcard 찾으러
      보내는 문구다. doctor 토큰에 scope를 실어(`shadowed-by-<list> <broad|exact> <rule>`) 범위를 정직하게
      렌더한다. **verdict가 red인 것 자체는 원래 맞았다.**
    - **⑸ stale count/명명 sweep.** `README:665`·`run.sh:130` 120 → 159, `DELIVERY:216` 140 → 159.
      `model-facing` 명명을 normal-path로 교정(5개 전부 모델에 보이므로 부정확했다).
  - **GPT `…-1e4959` 검수 2차 → 또 NO-GO, 실제 구멍 3건 + prose 잔재.** 159 smoke는 PASS였는데 GPT가
    smoke **밖에서** fixture를 직접 돌려 재현했다. **strict를 선언하고 strict가 아니었다** — 1차 수선의
    핵심 주장 자체가 구멍이었으니, 게이트 통과가 계약 충족이 아니라는 §G의 재발이다.
    - **⑴ install이 malformed prior를 거부하지 않고 provenance를 재캡처했다.** 내가 install에 얕은 검사
      (dict? values bool?)를 따로 짰는데 **빈 맵이 `all()`을 통과한다** — `all()` of nothing is true.
      RC=0으로 state가 all-true로 덮였다. state 파일이 존재하는 이유가 바로 그 재캡처 방지인데.
      → **파서를 하나로 합쳤다**(`_parse_permission_state`). strict 규칙의 두 번째 사본은 규칙이 없는 것과 같다.
    - **⑵ malformed + settings absent에서 uninstall이 state를 먼저 지우고 나서 throw했다.** 검증이
      settings-exists 분기 안에 있어서, 파일이 없는 호스트에선 **`os.remove(state_path)` 뒤** 출력 계산에서
      처음 불렸다. 거부한다면서 우리가 뭘 빚졌는지 적힌 유일한 기록을 안전장치가 파괴했다.
      → `ours = _owned_rules(state)`를 **모든 mutation 앞으로** 옮겼다.
    - **⑶ doctor가 path-correct malformed state를 green으로 반올림했다.** 독립 state 검사가
      `managedSettingsPath`만 읽었다. 런타임은 완벽한데(세 rule 다 있고 프롬프트 없음) 우리 grant와
      운영자 grant를 구분하는 기록이 못 읽는 상태 → **hard rule 13의 두 축이 붙어버렸다.**
      → 같은 파서를 쓰는 `permission-state-doctor` 신설, `CORRUPT (permission)` + nonzero.
    - **⑷ broad 우선이 list 안에서만 돌았다.** `deny=[exact self]` + `ask=[mcp(entwurf-bridge)]`이면
      전부 막히는데 deny를 먼저 훑어 exact로 보고했다 — "다른 grant는 동작한다"는 거짓 진단.
      → 전체 list를 broad 한 번, exact 한 번 두 pass로 훑는다.
    - **⑸ prose 잔재:** smoke의 `ONE NARROW STRING PER MODEL-FACING TOOL`·`we own one string`,
      config.py의 `our tool`/`same three rules cover entwurf_v2` 단수 서술 정리.
  - **음성 대조 11종 red 확인 후 restore green(§G ⓓ).** 1차분 ⒜~⒡ 6종 +
    ⒢ schema 상수 재병합 + ⒣ install을 얕은 검사로 회귀(v1 이관은 유지해 격리) +
    ⒤ 검증을 mutation 뒤로 되돌림 + ⒥ doctor를 path 검사에서 멈춤 + ⒦ broad 우선을 list 내부로 회귀.
    **⒢은 처음 측정에서 EXIT=0으로 안 막혔다** — 상수는 분리해놓고 재병합 방어를 안 넣었다.
    게이트를 추가하고 다시 재서 red를 확인했다. **⒣은 첫 시도에서 v1 분기까지 날려 다른 assertion이
    먼저 터졌다** — 격리가 흐린 음성 대조는 증거가 약하므로 패치를 좁혀 다시 쟀다.
  - **상태:** `smoke-agy-install-state` 139 → **167 checks PASS** · `pnpm check` EXIT=0(파이프 없이
    로그파일 + `EXIT=$?`) · `git diff --check` PASS · tarball **275 유지** · 라이브 호스트 doctor
    EXIT=0이고 v1 permission-state는 새 파서로 `ok 1`. 문서 표면도 같이 맞췄다:
    `README:634,665` · `DELIVERY:216,219` · `BASELINE.md` Q-AGY-OWNERSHIP ·
    `docs/setup-clean-host.md:294` · `run.sh:130` setup WARN.
    **`CHANGELOG:99`은 historical tombstone이라 손대지 않았다.**
  - **미실행:** GLG의 라이브 호스트에 `install-agy-bridge`를 돌리지 않았다. 그 파일엔 이미 셋이 다 있고
    (GLG가 agy 프롬프트에서 persist), 재설치는 state를 v1→v2로 이관하는 쓰기라 운영자 승인 사안이다.
  - **릴리즈 영향:** 이건 GPT `…-01deb3`의 라운드 2 GO **이후** 추가된 델타다. GO는 이 변경을 덮지 않으므로
    **재검수가 필요하다.**

- **I. 검증 게이트 적격성 체계(kill-proof) — 구현 완료(Claude Code `…-99f19a`, 2026-07-27 16:3x, GLG+GPT 설계 합의 GO).**
  `452fe29` 이후 델타이므로 **GPT 재검수 대상**이다. 커밋/푸시 없음.
  - **runner:** `scripts/lib/mutation-qualify.ts` + `scripts/check-gate-qualification.ts`. committed mutant
    manifest는 `scripts/mutants/*.json` 5 lane **16 mutants** — 이번 컷의 수동 음성 대조(§F ⒜~⒟·NEG,
    §H ⒢⒣⒤⒥⒦)와 7/26 O_NONBLOCK "verified by mutation" 산문의 committed화다. 격리 snapshot repo
    (tracked+untracked 복제 + temp git baseline + node_modules 공유 dependency symlink(선정 gate는 read-only로 취급); **실 checkout 무접촉**,
    HEAD+work-surface 내용 해시 전후 동일 assert), unique gate마다 CONTROL-PRE → mutants(적용→실행→복원→sha 대조) →
    CONTROL-POST, verdict는 pure classifier {KILLED, SURVIVED, WRONG-REASON, HANG, MUTANT-STALE,
    MULTI-MATCH, CONTROL-RED, IMPURE} 진리표 소진. signature는 `[QK:<claim>]` 토큰이 **failure line**에
    있어야 KILLED — ok 라인의 토큰은 무시되고, 엉뚱한 assertion red는 WRONG-REASON으로 거부된다.
    runner 자체가 매 실행 synthetic fixture로 음성 대조된다(malformed manifest/duplicate claim/path
    escape/untracked subject/zero-match/multi-match/survived/wrong-reason/hang+**pgroup grandchild 실사살**/
    control-red(가짜 KILLED 차단)/state-poison(CONTROL-POST red)/stray write(tree-manifest impurity)/
    stale snapshot sweep).
  - **16/16 KILLED, 전체 ~81s.** 실측이 합의 임계(~120s) 미만이라 **tier 분리 없이 전체가 pnpm check
    상주**(합의문 조건 그대로; 초과하게 되면 fast/full 재개봉). 대상 게이트 5종의 해당 assertion 라벨에
    `[QK:]` 토큰을 심었다 — 라벨/토큰이 사라지면 manifest 검증이 loud하게 깨진다(의도된 마찰).
    킬 목록: AGY-EXACT-RULE-SET · AGY-INSTALL-MALFORMED-PRIOR · AGY-UNINSTALL-VALIDATE-FIRST ·
    AGY-DOCTOR-OWNERSHIP-AXIS · AGY-CROSS-LIST-BROAD-FIRST · AGY-SCHEMA-VERSIONS-APART ·
    V2SURF-MCP-LOCK-DOMAIN · V2SURF-PI-MODE-SCOPE · V2SURF-INBOX-SCOPE-HONESTY · V2SURF-MERGED-REJECT ·
    SELFADDR-RAIL-RENDER · SELFADDR-NO-HARDCODED-REPLYABLE · SELFADDR-RAIL-FACT-LEAK(behavioral) ·
    AUGMENT-BUDGET-FITS · AUGMENT-TRUNC-MARKER · META-FIFO-NONBLOCK(10.1s bounded).
  - **AGY permission matrix:** `scripts/check-agy-permission-matrix.py` — contract space를 리터럴 테이블
    **55 cells**로 소진(install 13 / uninstall 15 / doctor 19 / state-doctor 8) + 제외 규칙 R2·R4~R7을
    출력에 명시(빈 칸은 침묵이 아니라 결정). oracle은 전부 손기입 리터럴, `permission-rules` 되먹임 0.
    음성 대조 완료: within-list broad-first 결함을 temp 사본 SUT에 재식 → **정확히 D16에서** red.
  - **배선:** package.json check 체인(smoke-agy 뒤 matrix, 말미 qualification) · run.sh usage/case ·
    AGENTS Verification 규율 1줄("assertion 수는 증거가 아니다") · VERIFY §0A 문단(evidence level
    L0–L5 무변경 — 판별력 측정이지 새 등급이 아님을 명시).
  - **runner 결함 1건 자체 발견·수선:** 최초 버전이 TMPDIR까지 invocation 디렉터리로 펜싱해 unix socket
    sun_path 108바이트 한계를 넘겼고 check-meta-identity-consumers CONTROL-PRE가 red였다(runner-side
    원인). TMPDIR은 상속으로 되돌림 — 게이트들의 자체 mkdtemp+cleanup 규율이 그 축을 이미 소유한다.
    CONTROL 계약이 이 결함을 잡았다: control 없이는 이게 가짜 KILLED로 샜을 자리다.
  - **GPT 재검수 1차(#57, 16:46) → 차단 4 + 과장 2, 전부 수선 완료(16:5x).**
    ⑴ P0-1 snapshot 탈출: tracked SYMLINK subject면 read/write가 링크를 따라 snapshot 밖을 변형할 수
    있었다. origin 검증(lstat regular non-symlink + realpath containment, subject와 signatureSource
    양쪽) **그리고** mutation 직전 runtime guard(validateManifestSet를 우회하는 self-test 주입 경로까지
    커버) 이중으로 막고, 실제 tracked symlink → 외부 파일 fixture로 end-to-end 거부 + 외부 바이트
    불변을 self-negative로 증명했다. signatureSource는 index가 아니라 **work surface**(tracked ∪
    untracked-non-ignored = snapshot 복제 집합) 기준 — 첫 커밋 전의 새 게이트 파일이 자기 claim을
    들 수 있어야 해서다.
    ⑵ P0-2 classifier false KILLED: exit=null(non-timeout signal crash)이 KILLED로 반올림됐다 →
    WRONG-REASON으로 분류, 진리표 행 추가.
    ⑶ P0-3 matrix 자체가 committed kill-proof가 아니었다(내 보고의 "temp 재식→D16 red"는 1회성 수동
    이었다) → AGY-CROSS-LIST-BROAD-FIRST mutant의 gate를 smoke에서 `check-agy-permission-matrix`로
    재지정(16 상한 유지), D16 cell id에 `[QK:AGY-CROSS-LIST-BROAD-FIRST]` 토큰, smoke의 중복 토큰 제거
    → 이제 매 pnpm check가 CONTROL→mutant(1.1s KILLED)→CONTROL로 증명한다.
    ⑷ P0-4 matrix oracle 조임: nonzero cell은 hand-written `stderr_token` 없으면 table-integrity
    red(구조 강제) + 13개 cell에 손기입 stderr 토큰 · 성공 install state는 **exact keyset + 전 안정
    필드 + installedAt UTC 형식**(`state_exact`, I01~I07) · 총 55에 더해 operation별 {13,15,19,8} +
    ID 시퀀스(I01..S08)를 결정적으로 assert.
    ⑸ P1-5 origin tripwire: porcelain 텍스트 해시는 이미-M인 파일의 바이트 변화를 못 본다 →
    work-surface **내용 해시**(path/type/mode/content sha)로 교체, "수정→해시 이동, 같은 M에서 바이트만
    재변경→또 이동, 복원→원위치"를 fixture로 증명.
    ⑹ P1-6 stale prose(runGateBounded "TMPDIR fenced") 교정.
    수선 후: self-test 54→**66 checks**, **16/16 KILLED 유지(~81s)**, matrix 단독 EXIT=0,
    smoke 167 유지, `git diff --check` PASS.
  - **#57 완결성 감사 2차(Claude Code `…-8ef417`, 2026-07-27 17:1x) — GAP 3건 발견·수선.**
    ⑴ #57 본문이 요구하는 "exhaustive truth-table behavior"가 대표 9행 샘플뿐이었고 산문은 "소진"을
    주장했다(과장) → 144행 전수 소진(2 control × 3 match × 2 timeout × 3 exit × 2 signature ×
    2 restore)을 독립 서술 oracle + **KILLED iff 7-way conjunction** 단독 assert로 추가.
    ⑵ runner의 `String.replace(find, string)`이 치환 패턴(`$&`/`$'`/`` $` ``/`$$`)을 해석해, 그런
    문자를 가진 미래 mutant가 선언과 **다른 바이트**를 심을 수 있었다(현 16개는 무해) → function
    replacement로 리터럴化 + `$&` 리터럴 착지를 KILLED로 증명하는 SELFTEST-DOLLAR fixture.
    ⑶ mutants/ 디렉터리가 비거나 manifest가 merge에서 유실되면 "0/0 killed" **vacuous green** →
    lane 인벤토리 리터럴 핀(acp-augment 2 / agy-permission 6 / meta-identity 1 / self-address 3 /
    v2-surface 4 = 16; matrix EXPECTED_CELLS와 같은 규율).
    감사 후: self-test 66→**68 checks**, **16/16 KILLED 유지**(phase-2 실측 합 ~76s), matrix 55 단독
    EXIT=0, origin HEAD+work-surface 해시 전후 동일, `git diff --check` PASS.
    ⑷ docs gap→fixed(GPT 지시, docs-only): AGENTS Verification에 "When changing a contract/gate"
    체크리스트 · README Smoke commands에 source-maintainer 게이트 2종 소개 + "(N checks)" 개수 서술을
    capability 서술로 교체 · README Verification surfaces에 VERIFY의 kill-proof protocol 소유 명시 ·
    VERIFY deterministic floor의 "~60 gates"/"cheap" 제거(package.json check가 SSOT) · run.sh usage의
    bare regression 개수 3건 제거. 기능/게이트/manifest 무변경, `pnpm check` 재실행 없음(직전 EXIT=0 유효).

- **G. 검증 규율 — 이 컷에서 반복된 실패는 한 종류다.**
  **"만들었다"와 "작동한다"를 구분하지 않은 것.** 실제 사고:
  ⑴ GPT#1이 focused 게이트 6개 PASS를 full PASS로 보고 → `check-entwurf-v2-spawn-production`이 red였다
  (테스트 기대값만 옮기고 프로덕션 메시지를 안 고침).
  ⑵ Claude Code가 `pnpm check | tail`로 돌려 **`tail`의 종료 코드**를 읽고 실패를 green으로 보고했다.
  → 파이프 금지. 로그 파일 + `EXIT=$?` 분리.
  ⑶ Claude Code가 파일 헤더의 낡은 `Consumers:` 한 줄을 믿고 gate-only 파일을
  "모델이 읽는 schema"로 오판했다. **반증이 자기 컨텍스트 안에 이미 있었다.** → import graph를 직접 봐라.
  ⑷ Claude Code가 "상호 마스킹을 닫았다"고 보고했으나 slice start marker가 `description:`이라 첫 매치가
  `target` **파라미터**였고 효과가 0이었다. 음성 대조를 *exact sentence* 한 종류만 돌려서 못 봤다.
  → **게이트를 추가한 것과 그 게이트가 막는 것은 다른 주장이다. 음성 대조는 최소 2종(정확한 거짓문 +
  누락)으로 돌려라.**
  ⑸ "fail-loud로 설계했다"고 쓴 경계 둘이 실제로는 fail-open이었다(`=== -1 ? undefined :`,
  `slice(0, -1)`). → 경계 존재를 slice **이전에** assertion으로 요구하라.
  ⓐ `pnpm check`를 파이프로 받지 마라. ⓑ focused만 돌리고 끝내지 마라.
  ⓒ `pi-extensions/` 소스를 고쳤으면 `pnpm run build-bridge`를 먼저 돌려라(안 하면 `check-bridge-delivery` red).
  ⓓ 자기 요약을 근거로 쓰지 마라 — 값을 다시 재라.
- **Do not touch:** ACP를 citizen layer로 승격 · common layer 대공사(0.12.10 수선 컷 범위를 넘고 Cortex를
  더 늦춘다) · Snowflake credential copy/parse · PR contributor commit squash/credit 삭제.

## QUEUE — 순서는 고정, 각 lane은 다시 검수

1. **0.12.10 — 닫힘(2026-07-27 출하).** acp 0.62.0 핀 + rail 문서 + pi 잔재 제거 + AGENTS 예산 게이트
   넷 다 들어갔고, 검증 게이트 적격성(kill-proof) 체계도 같이 섰다. 아래 소절은 그 컷의 판정 기록이며
   **다시 실행할 작업이 아니다** — 결과는 `CHANGELOG.md` 0.12.10을 읽어라.

   **판정 완료된 2건 — 되묻지 마라:**
   - **F-7은 describe로 확정(GPT 승인).** own-inbox 강제는 `README.md:530`·`:616`·
     `docs/setup-clean-host.md:261`이 보장한 external-host 능력을 제거하는 행동 변경이고, gardenId equality
     만으로 풀 문제가 아니다. 보안 hardening을 하려면 별도 capability/token 설계로 열어라. 현재는 게이트가
     "identity 해결 부재"를 negative로 요구하므로, 나중에 강제하면 게이트가 red가 되어 서술도 함께 고치게 된다.
   - **`entwurf-mailbox-guard.ts`는 삭제됐다(GPT 판정).** production importer 0이었고, production-shaped
     gate가 별도 구현만 green으로 만드는 건 false assurance였다. 되살리지 마라.

   **협업 배선 — 이 규칙은 계속 산다.** GLG가 검수를 GPT 세션에, 구현을 Claude 세션에 맡긴다.
   두 하네스 모두 컨텍스트 한계로 세션이 소진되므로(0.12.10 컷에서 GPT 셋, 07-28에 구현·검수 페어가
   동시에) **NEXT.md가 인수인계면이다** — 메시지가 아니라 이 파일에 남겨라. 검수 요청은 `entwurf_v2`로
   살아 있는 세션에 보내고, 판정이 오면 여기에 반영한다.
   **17스텝 release-gate aggregate는 readiness race 표본 3을 낳은 바로 그 조건이다** — 다음 릴리즈에서
   green이든 red든 상관 조건의 표본이 하나 더 나온다. 그건 부산물이고, red가 나와도 §11-7 측정 없이
   인과 판정은 하지 않는다.
   **검증 규율(이번 컷에서 두 번 샜다):** ⓐ `pnpm check`를 파이프로 받지 마라 —
   `pnpm check | tail`은 `tail`의 종료 코드를 반환해 실패를 green으로 보고한다. 로그 파일 + `EXIT=$?`로
   분리한다. ⓑ focused 게이트만 돌리고 끝내지 마라 — GPT의 focused 6개 PASS 뒤에도
   `check-entwurf-v2-spawn-production`이 red였다(테스트 기대값만 옮기고 프로덕션 메시지를 안 고친 것).
   ⓒ `pi-extensions/` 소스를 고쳤으면 `pnpm run build-bridge`를 먼저 돌려라 — 안 하면
   `check-bridge-delivery`가 stale dist로 red다.
2. **readiness — §11-7 ordering probe: 구현 완료(`4a629be`), 측정 미결.** probe·게이트·mutant 19종은
   main에 있다. 남은 것은 **판정 가능한 LIVE 측정**이다 — 계약 아래 첫 pair는 `inconclusive`(§11-7-b).
   ordering 결과를 A/B/C/D로 **분류**하고, causal attribution에 무엇이 더 필요한지 정한 뒤에만 처방을
   논한다. probe 1회는 결론이 아니다. 위 NOW의 "검증 미결" 4건이 이 lane의 실제 다음 작업이다.
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

## RECENT — §11-7 probe landing (2026-07-28)

- `4a629be` push 완료(`a3f74e2..4a629be`). 12파일 +2999/-13: probe 드라이버·공유 로그·순수 분류기·
  fixture 계측·결정론 게이트·LIVE 계측기·mutant 19종. 오늘 커밋은 이것 하나다.
- pre-commit 훅이 `pnpm check` 전체를 돌므로 커밋에 수 분 걸린다. 파이프로 받지 말고 로그 파일 +
  `EXIT=$?`로 분리해라(§G 규율 ⓐ와 같은 함정을 오늘 또 밟았다).
- GPT 검수 3라운드가 접혀 있다: ⑴ B 승격 사다리(ranAhead·측정 id·same-ms) ⑵ event-log **envelope** 계약
  ⑶ event-log **payload** 계약. 3라운드 도중 자격심사가 실제 회귀를 잡았다 — payload 규칙이 envelope
  claim을 대신 증명해 `PROBE-LOG-ENVELOPE-SCHEMA` mutant가 SURVIVED. 테스트 라인을 payload 규칙 없는
  `run_start`로 옮겨 격리를 복구했다. **mutant는 자기 코드로 죽어야 한다.**
- 0.12.11은 컷하지 않는다(GLG). CHANGELOG `## Unreleased`에 이 커밋 하나가 있다.

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
