# NEXT — entwurf post-0.12.6: ① agy delivery → ② mux

> 나침반이지 DB가 아니다: **현재 위치 · 다음 한 걸음 · 넘으면 안 되는 선**만 둔다.
> 현재+미래 방향과 설계 SSOT = **`ROADMAP.md`**. 닫힌 변경 핵심 = **`CHANGELOG.md`**. 세션별 process history = git log.

## DONE — 0.12.6 released (설치 경계 봉쇄)

- **0.12.3 released** — 소넷5 전환+1M 캡 해제(`claude-sonnet-5` 전역 스왑, Sonnet 200K 캡 제거 → "compact 없이 가는" 기반), deps 정렬(wire SDK 1.1.0 메이저 포함, pi floor **0.80.3**), workflow 스칼라 2종 메타브리지 관리 추가, GPT 검수 반영(live smoke stale-timer 등). 상세 CHANGELOG. **`6d06ad0` fix(targets):** `entwurf/gpt-5.4|5.5` ACP-routed 엔트리 제거 — "ACP Codex is not on this surface until the ACP backend is implemented" → §③ mux 레인의 동기이자 완료판정.
- **0.12.6 released** — tag `v0.12.6` + npm `@junghanacs/entwurf@0.12.6` publish 완료(2026-07-04 오라클 실측: `git tag`·`npm view` 확인). 설치 경계 봉쇄를 코드/검증/라이브 배선까지 닫음. dev·npm 모두 live marketplace source를 `$XDG_DATA_HOME/entwurf/meta-bridge/.assembled`에 조립하고 repo/node_modules는 source origin으로만 남김. uninstall/doctor/check는 install-state의 recorded `assembledMarketplacePath`를 SSOT로 쓰며, missing/empty/bad-basename/corrupt path는 side-effect 전 fail-loud. `smoke-meta-install-state`가 install→XDG, recorded A 제거/env B 보존, corrupt path side-effect 0, state+settings both-corrupt FAIL, checkout-internal `.assembled` 미생성을 검증. `smoke-user-scope-citizen`으로 user-scope pi package registration도 고정.
- **0.12.4 hotfix 완료** — 일반설치 floor(`node_modules`)에서 `doctor-meta-bridge`가 raw `.ts` helper를 strip-types 실행해 가짜 FAIL 내던 버그 수정. hejdev6 실측: pre-fix `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` 재현, patched tarball 설치 후 compiled store-doctor plain-node scan + v2-surface defer 통과. tag/GitHub release/npm publish 완료.
- **0.12.2/0.12.1** — 이전 릴리즈(메타브리지 install 이식성 + `check-meta-manifest-schema`, 오라클 설치검증). 상세는 CHANGELOG.

## NOW — ① agy delivery lane: 코드 ②~⑧ 착지 완료 → 남은 것 = 설치면 소유 이관 + ⑨ LIVE

**나침반(issue #45):** 설치면=본질, 문제는 `?`로 즉시 드러나야 함, "디테일에 휘둘리지 말고 본질". agy 지원 = 설치면 가드레일 검증면(GLG 2026-07-03, mux보다 먼저). 계약의 심장 한 줄: **antigravity는 `backend-liveness-unsupported`가 아니고 pi liveness domain도 아니다 — native-push domain이다.**

**현재 위치(2026-07-04 저녁):**
- **구현 ②~⑧ 완료** — 오푸스, `b8dc731..cc98ece` 11커밋(main, **미푸시 ahead 11+**). 각 커밋 pre-commit 전체 `pnpm check` green + 페블 독립 재실행 green. 설계는 페블 Q1–Q8 ↔ GPT 판정 + Q9–Q11로 봉인(물음표 0, 아래 봉인 9항 = 구현 계약). GPT 코드리뷰 R1~R9 전 축 PASS — 수정요구 Q12(agentapi timeout, 31cc023)·페블 N1(doctor state-drift FAIL)·N2(live honest-label)(14654b8)·Q13(축 분리 source guard) 전부 반영. matrix에 antigravity row 불추가(tripwire 유지)가 정답 판정.
- **라이브 선행 증거(GPT 수동 실측, production MCP bridge surface 경유): L1~L5 PASS** — 실 agy 1.0.8 conversation에 `entwurf_register_native` create/attach 멱등 → `entwurf_v2` native-push delivered ×2 → 수신·Gemini 3.1 Pro 연속성(**D0~D6 실증**, D7 partial=수동 tmux 관찰, D8 live 미실증), dead fire→`native-push-target-dead (observed: dead)`·owned→`native-push-no-resume-authority` 정직 reject, mailbox/marker/pi-domain 침범 관찰 0.
- **가드레일 실전 작동(L6):** 오라클 agy 배선(agent-config `mcp_config.server.json` → 죽은 pi-store 경로)을 `doctor-agy-bridge`가 정확히 static FAIL로 잡음 — #45의 `?` 실물. agent-config 실측 교차확인: dangling 맞음, 라이브 bridge 3프로세스·pi settings는 전부 repo 직결, **오직 agy config만 옛 경로**.
- 페블 정정 2건: "오라클 배선 수선 완료" 관측(19시경)은 agent-config working-tree 일시 편집이었고 **원복됨**(agent-config 원칙: 남의 지침 없이 자기 repo 임시수정 안 남김). "npm 글로벌 0.12.6"도 오류 — 실측 **0.12.4**였고 agent-config가 잉여 판정으로 제거함(레지스트리 최신은 0.12.6).

**GLG 공식 지침(2026-07-04, agent-config 세션 경유): 설치면을 entwurf가 멱등 소유하라.** agent-config는 전 하네스 entwurf-bridge 배선에서 손 뗀다. 오라클 응급 수선 없음 — 봉인 7 adapter 소유로 근본 이관. **이행 막힘 3건이 다음 한 걸음이다:**
1. **setup 멱등 편입** — `install-agy-bridge`가 수동 커맨드로만 존재. `./run.sh setup`이 멱등 자동 호출하도록 편입(멱등 보장이 지침의 핵심). 미검출 환경(agy 없음)에서의 동작(skip? state?) 설계 포함.
2. **dev stable bin PATH 노출** — adapter 기본 command `entwurf-bridge`(bare name)가 현재 오라클 PATH에 **없음**(잉여 0.12.4 글로벌+stale bin은 agent-config가 제거; 소비자는 npm bin으로 해결되지만 **개발 머신은 dev repo가 stable bin을 노출해야** — setup dev 모드 책임. 현재 dev repo에 `node_modules/.bin/entwurf-bridge` 부재 확인됨). 이거 안 채우면 doctor가 정직하게 dangling FAIL 낸다.
3. **agent-config 심링크 놓기(1회, 외부 협조)** — agy mcp_config가 agent-config 심링크인 동안 adapter는 설계대로 REFUSE. agent-config 쪽이 GLG 승인 하에 링크 로직(run.sh:792-797)+`antigravity/mcp_config*.json` 제거 → 이후 `install-agy-bridge`가 regular file 생성(adopt 경로 정상화). *agent-config는 이것 외 관여 안 함.*

**그 다음:** ④ **⑨ LIVE smoke**(GLG "돌려" 신호) — `smoke-agy-native-push-live` 작성+실행. GPT V5 형상 수령: `LIVE=1`(+`AGY_CONVERSATION_ID` optional — 없으면 smoke가 tmux로 agy 기동·cheap token으로 conversationId 추출, `AGY_BIN`, `AGY_SMOKE_CWD` scratch 권장); steps = doctor-static preflight(dangling=FAIL) → launch/attach → metadata route 검증 → register create/attach 멱등 → fire delivered → 수신 단언 → owned reject(alive) → smoke-소유 tmux만 kill → fire dead reject → doctor 재실행(SKIP+static PASS). smoke의 meta-record 잔여 방침(남기고 gardenId 출력 vs test-전용 store env) 설계 포함. route-trace env(`ENTWURF_NATIVE_PUSH_TRACE=1` — pgrep/ss count+선택 route만, V2 지적) 검토. **완료판정 = `DELIVERY.md` agy verified-probe→shipped 갱신(D7/D8 partial 정직 표기).** ⑤ **push 승인**(GLG). ⑥ 라이브 테스트 잔여 meta-record `20260704T201811-071ba8` 정리 방침(GLG). 잔여 선택(blocker 아님): Q14 tsconfig 이중 포함은 문서화로 갈음.

**범위/보정(여전히 유효):**
- **범위 한정:** agy *delivery + install adapter*만 여기(①), agy *fresh spawn/launch*는 ③ mux 뒤.
- **보정② 잔여(소유 이관으로 재정의):** 디바이스 변형 2종(thinkpad=`mcp_config.json` repo 직결 / oracle=`mcp_config.server.json` dangling)은 심링크 놓기(위 3.)와 함께 소멸 예정. adapter의 심링크 REFUSE·dangling FAIL·honest SKIP은 `smoke-agy-install-state` 28 checks로 고정됨. "config에 git/해시/스토어 경로를 박으면 죽는다" → install은 stable bin만 기록(이미 구현).

**봉인 9항 (2026-07-04 확정 — 구현 계약. 어기면 reject, 재해석 금지):**
1. **계약 형상(Q1):** `ENTWURF_V2_TRANSPORTS`(`entwurf-v2-contract.ts:186`)에 `"native-push"` 추가. `DispatchVerdict` send arm transport = `"control-socket"|"meta-mailbox"|"native-push"`(ownership `ack-only` 유지). 신규 **`NATIVE_PUSH_DISPATCH_TABLE`은 intent-only가 아니라 intent × NativePushLiveness** 키. reject reason 확정: fire+dead→`native-push-target-dead`, fire+indeterminate→`native-push-probe-indeterminate`, owned+*(상태 무관 단일)→`native-push-no-resume-authority`. **`backend-liveness-unsupported` 재사용 금지**(agy에겐 이제 거짓 이름). 셋 다 **post-probe** — `PRE_PROBE_REJECT_REASONS` 불참, `observedLiveness` non-null(probe 결과 스탬프).
2. **liveness 축(Q2):** NativePushLiveness = **FactLiveness 3값 재사용**(`alive|dead|indeterminate`, 주석만 socket-전용 오독 정정). `entwurf_peers` 사실면은 **현행 유지**(agy=`unsupported` 표기 — "pi socket liveness domain 밖"의 뜻, unreachable 아님) — probe는 decider 내부 전용, peers 표면 확장은 별도 결정.
3. **어댑터(Q3):** 신규 leaf `pi-extensions/lib/native-push/adapter.ts`(`acp/backend-adapter.ts:115` ADAPTERS/resolve 패턴 미러, injectable runner, `entwurf-core` import 금지). `NativePushAdapter{ id:"antigravity"; probe(nativeSessionId)→{status:"alive",route}|{status:"dead"|"indeterminate",reason}; send(route,nativeSessionId,content) }`. probe = **전 pid/LS port 스캔** + `get-conversation-metadata`(raw-agy-send.sh:16 `head -1` 단일-pid 가정 교정). route = volatile — 저장 금지, 같은 dispatch 안에서만 사용. **send 실패 시 1회 re-probe→re-send는 executor hand 소유**(decider 순수성 — control-socket send-fallback 패턴 미러), 재실패는 fail-loud.
4. **decider rail(Q10) + lock(Q9):** 분기 순서 = identity null/conflict → **`nativePushSupported(identity.backend)` → adapter probe → NATIVE_PUSH 테이블** → `!isLivenessSupported` → mailbox 미니테이블 → pi in-domain(`entwurf-v2-decider.ts:302-321` 분기 앞에 삽입). native-push branch는 **lock-free**(pi in-domain lock은 socket TOCTOU 전용 — volatile probe route엔 lock 의미 없음; 중복 send idempotency는 D8 future).
5. **register(Q4):** 신규 MCP 툴 **`entwurf_register_native`**("register an already-running native conversation; does **not** spawn" — v2 fresh mint와 혼동 방지). 입력 `{backend:"antigravity", nativeSessionId, cwd(required — metadata로 확증 불가하므로 caller 명시)}`. **antigravity만 open, codex는 별도 레인.** 흐름 = adapter.probe 성공 → **`upsertMetaSession` 재사용**(`meta-session.ts:1458+` scan-by-nativeId→create/attach) → gardenId 응답. 재등록 = upsert attach(gardenId 유지·cwd refresh); 같은 nativeSessionId 다른 backend = identity drift throw 유지. **receiver marker 절대 안 씀** — `META_RECEIVER_ARM_PROVENANCES` 불참(보정①), 게이트 단언 "register does not write receiver marker". register provenance 전용 slot은 future.
6. **deliverability(Q5):** `entwurf-deliverability.ts` **같은 파일**에 `nativePushDeliverable(facts) = recordBacked ∧ probeAlive` 별도 export. `computeMetaReceiverActive`(watchArmed 포함 = mailbox 전용 원자) 재사용 금지 — 축 분리를 파일 상단 주석으로 고정(stale 주석 :15/:106 정정과 같은 커밋).
7. **install(Q6):** 별도 커맨드 3종 **`install-agy-bridge`/`uninstall-agy-bridge`/`doctor-agy-bridge`**(claude marketplace 일반화 금지 — 공통화는 runner/reporting만). install이 까는 것 = **agy MCP config에 entwurf-bridge server 등록 단 1건**. **심링크 → refuse+report**(남의 SSOT), 일반 파일 → adopt(merge + install-state + honest-inverse uninstall). install-state = `$XDG_DATA_HOME/entwurf/agy-bridge/install-state.json`(0.12.6 checkout-밖 원칙: managed path·preimage·added key·command path·detect mode·timestamps). config에 기록하는 command = **안정 bin**(`entwurf-bridge`) — repo/git 해시 경로 금지(오라클 dangling 실물 교훈). **doctor 2단**: static = documented(`~/.gemini/antigravity-cli/`)+observed(`~/.gemini/config/`) 둘 다 실경로 해석·JSON·command 실존+exec 검사("configured candidate"까지만 증명) / live = agy 프로세스 존재 시에만 runtime-effective 증명, 부재 시 **honest SKIP**(PASS 둔갑 금지).
8. **검증(Q7):** `check-native-push-adapter`(fake runner — 전-pid 스캔·route 재발견·저장 금지·send argv·1회 retry 단언) + `smoke-agy-install-state`(격리 HOME+XDG, fake agy·fake ss — install→doctor→uninstall, 심링크 refuse, dangling FAIL, checkout impurity 0 = ⓪ 규율 day-one) + `smoke-agy-native-push-live`(`LIVE=1` + `AGY_CONVERSATION_ID` env — **register→entwurf_v2→token 원샷**). 도메인 분리 게이트 단언: `LIVENESS_DOMAIN_BACKENDS==["pi"]` 유지 + `NATIVE_PUSH_BACKENDS==["antigravity"]` + **교집합 ∅ 단언** + peers unsupported 유지 + decider가 peers liveness 아닌 identity.backend+probe로만 route함을 단언(착지 위치 정밀화 — GPT 리뷰 R1: 교집합 ∅·round-trip은 `check-entwurf-v2-contract`, `["pi"]` 하드 단언·peers unsupported는 `check-entwurf-facts`). 완료판정 = `DELIVERY.md` agy verified-probe→**shipped** 갱신.
9. **scope 봉인(Q8) + 동시 확장(Q11):** agy→garden **발신 replyable sender envelope는 defer**(anonymous `external-mcp` replyable:false 현행 유지 — register 응답 gardenId 인용까지만 이번 레인). enum 확장 시 **동시에**: `entwurf-v2-contract-schema.ts` success transport / `ExecutionPlan` union / runner outcome union·surface render(`entwurf-v2-runner.ts`·`entwurf-v2-surface.ts`) / `check-entwurf-v2-contract` drift 게이트 — 놓치면 타입 갈라짐. **해석 확정(2026-07-04 페블 검수, 오푸스 ③ 판단 승인): "동시"는 도달가능성 기준** — enum/verdict/테이블/contract-schema/drift 게이트는 ③에서 닫고, `ExecutionPlan`·runner outcome·surface render·production executor는 native-push plan이 실제 생산되기 시작하는 **⑥(decider rail)과 같은 스텝에서 일괄 착지(부분 금지)**. 그 사이 어떤 프로덕션 경로도 native-push plan을 생성하지 않는다(tmux-live 선례 — 페블 실측: d59943f 시점 decider/runner/surface에 native-push 참조 0건).


## ② (① agy 뒤 착수) fresh spawn도 mux-visible로 통일

v2에 spawn이 "없는" 게 아니다. `entwurf_v2 owned-outcome`은 **기존 dormant pi citizen**을 `spawn-bg resume`으로 깨우는 production path가 있고 `smoke-entwurf-v2-spawn-resume-live`가 실 child+turn을 검증한다. 빠진 것은 v1 `entwurf`가 하던 **무에서 새 sibling을 만드는 fresh spawn/mint**.

**정렬:** fresh launch를 **mux-visible surface로 먼저 통일**한다. pi-native GPT도 bg/detached `pi -p`로 숨기지 않고 투명하게 pane/session으로 보이며 같은 launch 관문을 통과 → pi를 Claude Code/Codex/Antigravity와 같은 급의 "4번째 하네스"로 세운다. pi 전용 headless/bg 최적화는 GLG가 나중에 명시할 때 별도 레인.

- v1 본체: `pi-extensions/lib/entwurf-core.ts` `runEntwurfSync`(:1940) = fresh-mint 본체 — registry gate `resolveEntwurfTarget`(미등록 reject) + session-id/name/cwd-enrich. resume는 `runEntwurfResumeSync`(:1772, registry 우회). launch arg SSOT `entwurf-resume-args.ts`. 주: fresh-mint는 현재 `--no-extensions` one-shot worker이지 `-p`/control 경로 아님.
- **레지스트리 현황(6d06ad0 이후):** `entwurf/claude-sonnet-5`·`entwurf/claude-opus-4-8`(ACP claude), `openai-codex/gpt-5.4|5.5`(native), `entwurf/gemini-3.1-pro-preview`(ACP gemini, explicitOnly). **ACP Codex 엔트리는 삭제됨** — 즉 "Claude Code에서 새 GPT 불러줘"는 레지스트리가 하드 차단. mux 레인이 서야 되살릴 수 있음.

## ③ (①agy 뒤 착수) mux-agnostic spawn/launch surface

네이티브 백엔드(Claude Code)는 인터랙티브 TTY 필수 → headless 불가 → **multiplexer가 곧 launch surface**. pi-native GPT도 같은 mux-visible surface로 올린다. **tmux 전용 금지** — mux driver 인터페이스 뒤에서 `tmuxDriver`/`zmxDriver`가 동급. zmx는 후순위 장식이 아니라 경량 1급 후보(driver 한 개 갈아끼우는 일이 되도록).

**코드 실측(2026-07-01 재확인, drift 없음):**
- transport enum `ENTWURF_V2_TRANSPORTS`(`entwurf-v2-contract.ts:186`) = `["control-socket","spawn-bg","tmux-live","meta-mailbox"]`. `tmux-live`는 enum 한 값일 뿐.
- **프로덕션 launch 코드에 tmux 직접 호출 0개**(grep empty). tmux 4동작은 `scripts/raw-async-delivery/repro-{plugin-idle-wake,addressed-routing}.sh`에만 존재 → **spawn launch는 프로덕션 빈칸**. 이 빈칸을 mux 추상화로 채우는 게 이번 레인.
- `tmuxTarget`은 **프로덕션/스키마 필드가 아님** — fixture 2줄뿐(`check-entwurf-capabilities.ts:110`, `check-meta-record-v2.ts:188`, 둘 다 `"psa:3.1"`). 즉 "네이밍 중립화"는 cosmetic이고, 진짜 `muxTarget`/`paneTarget` 필드는 프로덕션 spawn이 생길 때 **새로 정의**하는 것(기존 prod 필드 rename 아님).

**repro 4동작 → driver 메서드 매핑 (tmuxDriver 이식 대상):**

| repro (tmux) | driver 메서드 | 세부 |
|---|---|---|
| `tmux new-session -d -s <n> -x 200 -y 50` + `set-option @entwurf_garden_id/@entwurf_parent_garden_id` | `launch(spec)` | detached, geometry는 spec. **namespace 각인** → tmux server가 lineage 레지스트리(형 통찰). driver는 opaque 문자열만 새김(의미 모름) |
| `tmux send-keys -t <n> -l "<text>"` | `pasteText(target,text)` | literal 주입만. `-l`/paste-buffer 여지(arbitrary prompt 안전) |
| `tmux send-keys -t <n> Enter` | `sendKey(target,key)` | 단일 키 |
| (조합) `pasteText→sendKey(Enter)→sleep(1)→sendKey(Enter)` | **driver 아님 → launch-profile(claude-code, ①-7)** | 더블-Enter 제출은 mux 차이 아니라 CC TUI submit policy. driver에 박으면 pi-native/타 TUI 오염 |
| `tmux capture-pane -t <n> -p` | `capture(target)` | raw pane text만. 폴링(`grep -qE '●\s*READY'`)은 호출측 책임 |
| `tmux list-sessions -F …` | `list(): MuxSessionView[]` | ★ 활성 파악 + 각인 읽어 lineage. **view, not fact** — authority(socket/meta-record/probe) 아님, 교차검증·진단 전용. 미각인은 optional 부재(throw 아님) |
| `tmux kill-session -t <n>` | `kill(target)` | idempotent — `\|\|true` 셸 대신 runner `okExitCodes` |
| (암묵 `has-session`) | `isAlive(target)?` | 선택 |

**동형 레퍼런스(그대로 미러):** `pi-extensions/lib/acp/backend-adapter.ts` — `interface AcpBackendAdapter`(:115), `claudeAdapter`(:194), `const ADAPTERS = [claudeAdapter]`(:275), `resolveAcpBackendAdapter(modelId)`(:287). driver 1개 = mux 1개 = siblings-not-workers의 mux 레이어 반복.

**설계 3겹 불변식 (2026-07-01 opus4.8 ↔ gpt-5.5 3라운드 확정 — 어기면 tmux가 코드를 삼킨다):**
1. **driver 불변식 = `$TMUX` 비의존.** caller가 tmux 밖이어도 `tmux new-session -d`로 detached 생성. "mux가 launch surface"이지 "caller도 mux 안"은 아님. → `check-mux-driver` fake-runner가 강제(fake엔 `$TMUX` 개념 없음).
2. **관찰 규율 = mux-visible launch가 default, 유령 분신 금지.** caller가 tmux 안이면 같은 server에 떠서 `tmux ls`+`switch-client`로 즉시 adopt. 강제 아니라 권장 posture(`opens siblings, not disposable workers`의 tmux 판). → manual observe smoke.
3. **경계 불변식 = mint ≠ transport.** spawn/mint(garden-id 발급·registry·name/cwd/model)는 **mux를 모른다**; driver는 **mint를 모른다**. mint/core 파일군의 `lib/mux/*` import 금지를 `scripts/check-mux-boundary.ts`(TS compiler API로 `ImportDeclaration`+dynamic import string literal 검사, **allowlist 방식** — launch-profile/orchestrator만 허용)가 강제(①-7). "강제하면 코드가 tmux를 따라간다"의 실물 방어.

**테스트 3층 (GPT 제안 채택):**
- `check-mux-driver` — fake runner deterministic. argv/순서/kill idempotency(`okExitCodes`)만 단언. tmux 바이너리 불요.
- `LIVE=1` smoke — 진짜 tmux로 detached 생성/캡처/kill. `$TMUX` 비의존 증명.
- manual observe smoke — "parent inside tmux 권장" + `$TMUX` 감지 시 `switch-client -t <handle>` 힌트. attach/switch는 core driver 아님 → 후속 `openMuxTarget` manual 레이어.

**착수 플랜(순서대로):**
1. **mux driver 인터페이스 먼저 (leaf module)** — 새 파일 `pi-extensions/lib/mux/driver.ts`. `entwurf-core`를 import하지 않는 순수 transport leaf(tmux argv + injectable runner). GPT 검수 반영 shape:
   ```ts
   export interface MuxDriver {
     readonly id: "tmux" | "zmx";                 // bare id — transport 문자열은 호출측이 {tmux:"tmux-live",zmx:"zmx-live"}로 파생
     launch(spec: MuxLaunchSpec): Promise<MuxTarget>;
     pasteText(t: MuxTarget, text: string): Promise<void>;  // literal 주입만 (send-keys -l 여지)
     sendKey(t: MuxTarget, key: string): Promise<void>;     // 단일 키 (Enter 등)
     capture(t: MuxTarget): Promise<string>;                // raw pane text (호출측 폴링)
     kill(t: MuxTarget): Promise<void>;                     // idempotent
     list(): Promise<MuxSessionView[]>;                     // 진단용 관찰 스냅샷 — authority 아님(view, not fact)
     isAlive?(t: MuxTarget): Promise<boolean>;
   }
   export type MuxLaunchSpec = {
     gardenId: string; parentGardenId?: string;   // → @entwurf_garden_id / @entwurf_parent_garden_id 각인(namespace)
     command: string[]; env?: Record<string, string>;
     geometry?: { cols: number; rows: number };    // default 200×50
     cwd?: string;
   };
   // MuxTarget = launch/resolve된 실행 핸들. branded → list 결과(MuxSessionView)를 send/kill에 실수로 못 넣게
   export type MuxTarget = { readonly __brand: unique symbol; driverId: "tmux" | "zmx"; gardenId: string; handle: string; driverData?: unknown };
   // MuxSessionView = tmux ls 관찰 스냅샷. dispatch authority 아님(socket/meta-record/probe가 authority). conflict는 diagnostic bucket
   export type MuxSessionView = { driverId: "tmux" | "zmx"; handle: string; gardenId?: string; parentGardenId?: string; observedAt: number; raw?: string };
   export function createTmuxDriver(deps: { runner: MuxRunner; sleep?: (ms: number) => Promise<void> }): MuxDriver; // argv 순수부/부수효과 분리
   export const tmuxDriver: MuxDriver;              // createTmuxDriver({ runner: realRunner })
   export const DRIVERS: readonly MuxDriver[] = [tmuxDriver /*, zmxDriver */];
   export function resolveMuxDriver(id: string): MuxDriver; // resolveAcpBackendAdapter 미러 fail-fast
   ```
   - submit quirk(더블-Enter)는 **여기 없음** — claude-code launch-profile(①-7)이 소유. `pi-native-gpt`는 자기 submit policy.
   - `driver.ts`는 leaf: `entwurf-core`/mint import 금지. 역방향(mint→`lib/mux`) 금지는 ①-7 import-boundary 게이트.
2. **`tmuxDriver` 구현** — repro 동작 이식하되 각 메서드는 `plan*(): string[][]`(argv) 계산 → injectable runner 실행. geometry/`@garden_id`/`@parent_session_id`는 spec. 더블-Enter는 **여기 아님**(①-7). repro 스크립트는 그대로 두되 프로덕션 경로가 driver를 쓰게.
3. **deterministic 게이트 `check-mux-driver.ts`** — 실제 tmux 없이 fake runner로 tmuxDriver 구동: primitive별 argv/순서 단언, `@garden_id` 각인 단언, kill idempotency(`okExitCodes`), `resolveMuxDriver` fail-fast. `check-acp-*` 스타일. `pnpm check` 체인 + `run.sh` dispatch 배선.
4. **`zmxDriver` 스텁** — 같은 interface로 `DRIVERS=[tmux,zmx]`가 컴파일되게. 미구현 op는 fail-loud.
5. **enum 공존** — `ENTWURF_V2_TRANSPORTS`(:186)에 `zmx-live` 추가(`tmux-live`와 공존). schema↔types 게이트 갱신 **+ `DispatchVerdict`의 resume union도 같이 확장(GPT 지적 — 놓치면 타입 갈라짐)**. mux 종류를 별도 필드로 빼는 추상화는 금지(enum 나열 > 추상화 두께).
6. **네이밍 중립화(cosmetic)** — fixture `tmuxTarget`(위 2줄) → `muxTarget`. 프로덕션 필드가 아니므로 리스크 낮음.
7. **fresh pi-native GPT launch profile(더 큰 후속)** — `runEntwurfSync`(:1940)의 registry/session-id/name/cwd-enrich 자산 재사용하되, `--no-extensions` detached one-shot 복구가 아니라 mux-visible `pi-native-gpt` launch profile로 설계(`claude-code`/`codex`/`agy`도 같은 launch/observe/capture/kill 규율). **완료판정:** mux launch가 서면 `6d06ad0`이 지운 `entwurf/gpt-5.x` ACP 타깃을 레지스트리에 되살릴 수 있음.
8. **agy(Antigravity) spawn** — spawn surface 통일 **후** 그 위에 얹기(기반 먼저 안 서면 launch seam이 갈림). *주: agy **delivery/설치 어댑터**는 ①에서 mux보다 먼저 감 — 갈라진 건 launch면뿐.*

## ④ (수동·대기) PR #40 cortex 어댑터 재안착 — 공은 hvkiefer

- 우리 쪽 준비 끝: 레일 doc(`docs/acp-backend-rail.md`) + PR 개발 가이드 댓글. 레일 green.
- hvkiefer: `cortexAdapter` 1개 신규(`pi-extensions/lib/acp/backend-adapter.ts`) + `ADAPTERS` 등록 + curated cortex 모델 + `SNOWFLAKE_HOME` overlay + `check-acp-*` cortex 단언 + `smoke-acp-cortex-live`. 공통 turn loop 무수정.
- **미정 1건:** carrier 부재 백엔드(cortex)의 operator engraving이 first-user augment(`augment.ts`)에 합류하는 방식 — 현재 augment는 engraving 미탑재. cortex PR이 그 경로 정의.
- 들어오면 `check-acp-*` 6종 + `smoke-acp-cortex-live` 기준 리뷰, 공통층 무수정 불변식 확인.

## Follow-up (blocker 아님)

- **Post-publish global meta-bridge invariant:** package upgrade alone does not refresh Claude's plugin bundle/cache. Future publish checklist: `pnpm add -g @junghanacs/entwurf@<version>` → `entwurf install-meta-bridge` → `entwurf doctor-meta-bridge` from the same installed surface, then restart open Claude Code sessions. With the main follow-up, installed statusLine/MCP use stable bins and marketplace source uses a stable data dir; reinstall remains the explicit bundle refresh, not a dead-link repair.
- **C2** `check-pack-install` 확장: fake `claude` CLI + temp `HOME`/`CLAUDE_CONFIG_DIR`로 installed `entwurf install-meta-bridge` 실행 → `~/.claude.json` command가 해시 store 경로 아니라 안정적 `entwurf-bridge`인지 검증.
- **C3** support-floor: 실제 최저버전(2.1.97 오라클) validate/install/doctor를 컷 체크리스트 또는 remote gate로.
- **user-scope 등록 역연산 부재 (페블 GO 판정 명명 팔로업, 2026-07-03):** `install_local_package`는 `register_user_scope_citizen`으로 `~/.pi/agent/settings.json`에 쓰지만 `run.sh remove`는 project scope만 지움 — 소비자가 패키지 삭제 시 user-scope packages[]에 dangling 경로가 남아 모든 cwd의 pi 기동에 파급 가능(honest-inverse 위반). SSOT(`register-pi-package.py --remove`)는 이미 있으니 인버스 노출 지점만 결정(remove가 user-scope도 내리거나 별도 커맨드). 경미 nit 동반: register-pi-package.py `write_text` 비원자(tmp+rename 없음) — user-scope는 글로벌 파일.
- **멀티하네스(Codex/Antigravity):** claude marketplace 일반화 금지. 하네스별 adapter contract(manifest shape, MCP 등록면, version floor, doctor evidence). 공통화는 runner/reporting만.
- `smoke-acp-skill-live` "secret probe code" → "probe code/project marker" 낮추기(injection-refusal 선제 cleanup, GPT 제안 이월).
- **pnpm 10→11 이관 + 단일 설치면(setup) 재검증** — *배경*: npm `codex` 중복(같은 바이너리가 `~/.local/share/pnpm/bin`과 부모 dir에 2개)에서 출발 → 원인은 pnpm **자기관리 shim(11.5)↔nix pnpm(10.33)** 이 디렉토리별 버전 스위칭하며 글로벌 스토어를 `global/5`(pnpm10)+`global/v11`(pnpm11) 둘로 쪼갠 것. 머신 정리: nix 단일 pnpm **11.9.0** + `~/.config/pnpm/rc`(home-manager) `manage-package-manager-versions=false`+`global-bin-dir` 고정 → 자기관리 pnpm/`.tools`/`global/5` 제거. **패키지 소유권 3층**: nix store(선언) / `external-packages.sh`(npm글로벌·벤더·go, 목록SSOT) / per-repo devShell(특정버전 필요 시). **entwurf 쪽 config**: `packageManager: pnpm@10.33.0` 핀 제거(전역 nix pnpm 따라감), `.npmrc`(pnpm11이 무시하는 죽은 파일) 삭제 → `pnpm-workspace.yaml`(autoInstallPeers:false + allowBuilds `@google/genai`·protobufjs false)이 SSOT, CI `pnpm/action-setup` 10.33→11.9. **설치면**: `./run.sh setup <project>` **단일**로 정리 + `pi install` 제거(중복 확정 — project-scope `.pi/settings.json` `packages[]`만으로 provider/ACP 로드됨을 `pi --list-models entwurf`로 실증; pi 바이너리는 필요, pi install 커맨드는 불필요). *재검증(다음 세션/클린 호스트)*: ① `which -a pnpm` 1개·전역/entwurf 모두 11.9.0 ② 11.9.0에서 `pnpm check` **전체** green(이번엔 dep-versions/문법만 확인함) ③ `./run.sh setup <scratch>` 한 방 green ④ `pi install` 없이 provider 로드 ⑤ `doctor-meta-bridge` PASS. 소비자(npm)엔 무영향(tarball=package.json+files만; `.npmrc`/`pnpm-workspace.yaml`/lock 제외).

## 넘으면 안 되는 선

- Work on `main`; 이 레인용 브랜치 만들지 않음.
- **source origin ≠ live artifact** — live marketplace source는 항상 `$XDG_DATA_HOME/entwurf/meta-bridge/.assembled`(repo/npm 조립 입력만 다름). 어떤 install/doctor/uninstall/check도 `$REPO/pi/meta-bridge/.assembled`를 만들거나 참조하지 말 것. check/smoke는 실제 `~/.claude`/`~/.claude.json`/`~/.pi`·실제 XDG artifact도 만지지 않는다 — 파괴 검증은 전부 격리 HOME+XDG_DATA_HOME에서. uninstall의 honest-inverse rm은 XDG에서 유지(약화 금지).
- **live artifact는 checkout 밖(XDG)** — `./run.sh install-meta-bridge`/`setup`이 곧 XDG 이관 절차다(더는 `pnpm check`가 배선을 자르지 않음). repo 안에 `.assembled`를 되살리지 말 것.
- **agy는 native-push domain** — pi socket domain(`LIVENESS_DOMAIN_BACKENDS`)에도 mailbox self-fetch 게이트에도 밀어넣지 않는다. receiver marker/watchArmed는 mailbox 전용 원자 — native-push replyable에 재사용 금지. reject reason에 `backend-liveness-unsupported`를 agy에 재사용하지 않는다.
- **mux launch는 driver 인터페이스 뒤에서만** — 프로덕션 코드에 `tmux` 직접 호출 금지(repro 예외). tmux 전용 가정/타입/필드명 새로 심지 말 것. zmx는 경량 1급 driver 후보.
- **mint는 mux를 모르고 driver는 mint를 모른다** — spawn/mint 로직에 `lib/mux` import 금지, `driver.ts`는 `entwurf-core` 무의존 leaf. 더블-Enter submit은 driver 아니라 launch-profile. `$TMUX` 전제(caller도 tmux 안이어야)를 driver/게이트에 심지 말 것 — 관찰가능 launch는 강제 아닌 default posture.
- **fresh pi-native GPT도 먼저 mux-visible** — v1식 detached/bg `pi -p` 복구를 기본값으로 되살리지 않는다. headless/bg pi 최적화는 GLG 명시 시 별도 레인.
- pi floor는 이제 **0.80.3**, entwurf sonnet은 **`claude-sonnet-5`(1M)** — 되돌리지 말 것.
- `core.hooksPath` 안 건드림. `--no-verify` 금지.
- GLG 명시 승인 + green preflight 없이 publish/tag/push 금지.
- live release gate 요청 시 scratch cwd + `LIVE=1`.

## 참조

- 설계 SSOT: `ROADMAP.md` · 닫힌 변경: `CHANGELOG.md`
- 검증 calibration: `VERIFY.md`, `BASELINE.md`, `DELIVERY.md`
- repo baseline: `AGENTS.md` · ACP 레일: `docs/acp-backend-rail.md`
- clean-host 설치: `docs/setup-clean-host.md`
- mux repro 원본: `scripts/raw-async-delivery/repro-{plugin-idle-wake,addressed-routing}.sh`
- 동형 패턴: `pi-extensions/lib/acp/backend-adapter.ts`
