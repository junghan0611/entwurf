# NEXT — `acp-on-v2` 브랜치 (ACP plugin on v2 core, B 방향)

> 부트섹터: **지금 어디 · 다음 한 걸음 · 넘으면 안 되는 선**만.
> base = `v2-only`(clean floor / 지도, **불가침 보존**). 이 브랜치에서 v2 core 위에 ACP를 다시 심는다.
> 영속 invariant(ACP=plugin 경계, 트러스트 경계)는 **AGENTS.md가 SSOT**. 이 파일 = *현 방향 + 구현 reference*(소모성).
> 흔들릴 때 앵커: botlog `20260522T092950…__…mitsein_pi.org` heading `* [2026-06-18] ACP도 데리고 간다` + 그 안의 **GLG 원본 프롬프트 3블록**(요약 금지).

## 목표 (한 줄)

**v2 core + ACP overlay-ingress plugin.** v1은 끝. ACP는 데리고 간다 —
0.11.0을 *기계적으로 port하지 않고*, **구조는 새로 / 행동은 0.11.0(behavior oracle)에서 이식**.
**rename 안 함**(`pi-shell-acp` 이름 유지 — ACP가 살아있으니 이름이 정합).

# NOW

- **Current**: **S0 + S1 DONE (2026-06-18).**
  - **S0 loader/fence**(커밋 `4afa58e`): `pi-extensions/acp-provider.ts`(thin entry) + `lib/acp/{models,backend-stub}.ts`, `pi.extensions` 맨 앞 등록. 큐레이트 Claude(sonnet-4-6 + opus-4-8 anchor), no-auth sentinel, **fail-loud streamSimple stub**(backend·native fallback·bash/env 우회 전부 없음). 게이트: `check-auth-boundary`(retarget) + `check-acp-provider-surface`(temp `tsc` emit → 컴파일 entry fake-pi 실행 캡처). pack stale(#4) RED→GREEN. `pnpm check`/`check-pack-install` green + 라이브 `pi --list-models`.
  - **S1 socket-citizen**(이 세션): **라이브 증명 완료** — `pi --entwurf-control --provider pi-shell-acp --model claude-opus-4-8 --mode rpc` resident가 production `entwurf_peers`에 `liveness=alive model=pi-shell-acp/claude-opus-4-8 idle=yes`로 떠서 native Codex 형제 옆 1급 시민. get_info(cwd/model/idle) 응답. **QM1**(model-lock가 ACP 모델 런치를 안 되돌림 — in-session switch에만 발화) + **QM2**(fail-loud stub은 턴에서만, 런치는 turn-free라 안 죽음) 둘 다 라이브 차단. 아티팩트: `scripts/smoke-acp-socket-citizen-live.ts` + `./run.sh smoke-acp-socket-citizen-live`(LIVE-gated, OUT of pnpm check, 10 checks PASS — GPT 검수 후 peers-visible(`scanSocketProbes`) + 소켓 잔여-0 hygiene check 추가). **턴 0회 — citizenship만 증명, backend turn은 S2.** **pushed**(`fe20436` + GPT 후속 보정).
- **S2-scout DONE + GPT PASS (2026-06-18)**: 3핀 정찰 read-only 완료 → GPT(`…be0e35`) 검수 PASS. 확정값 = §S2-scout 핀(하드제약).
- **S2a-1 DONE (2026-06-18)**: dep pin(`@agentclientprotocol/sdk@0.22.1` + `claude-agent-acp@0.39.0`) + **peer-resolution pin `@anthropic-ai/sdk@0.100.1`**(GPT 옵션A 승인 — claude-agent-sdk 0.3.156의 `>=0.93.0` peer 충족용, source 미사용). surface gate `check-acp-sdk-surface`(**5 layer**: exact pins / lock peer-resolution / **runtime peer-resolution probe**(claude-agent-sdk context에서 anthropic-sdk→0.100.1 실제 resolve) / wire-SDK value-export / no-client-use[side-effect·export-from·dynamic 확대]) + `pnpm check` 등록. **GPT 상세검토 PASS + 후속 보강 반영**. typecheck/게이트 green. 커밋 `cc6aee2`(+보강 커밋). GPT anchor rotate: `…be0e35`→`…441eab`.
- **S2a-2 DONE (2026-06-18)**: raw ACP 1턴 라이브 증명. `smoke-acp-raw-turn-live`(LIVE-gated, OUT of pnpm check): claude-agent-acp를 **package bin**에서 spawn → `ndJsonStream`+`ClientSideConnection`으로 initialize(protocolVersion=1)→newSession(scratch cwd, mcpServers:[], **`_meta` 부재**)→`unstable_setSessionModel(claude-sonnet-4-6)`→prompt("say OK") → 라이브 **"OK"** + **raw NDJSON 25755 bytes** 캡처. permission/file-op 0. PATH fallback=acceptance FAIL(debug override만). **provider/overlay/streamSimple 0줄** — backend-stub fail-loud 유지. GPT 보강3: `ndJsonStream`을 export gate에 추가. **S2a(dep+raw) 완결.**
- **Next = S2b (overlay + 도구축소)**: `claude-config-overlay`(settings.json `hooks:{}`=메일박스 부재 by design, auth/skills symlink) + 도구축소 + `assertExcludeToolsHonored`. 여기서부터 overlay 활성·메일박스 부재 증명 가능(S1/S2a는 backend turn/overlay 전이라 불가). streamSimple 교체(S2c)/session·engraving(S2d) 앞당김 금지. 상세 = §S2-scout 핀 + §구현 순서 + §홉 계획.
- **잠긴 방향 (굳음)**:
  - ACP backend = overlay 격리 **소켓-시민**, 메일박스 **설계상 부재**(overlay `settings.json` `hooks:{}` → meta-bridge hook 없음 → 메일박스 없음; *같은* minimal 설정이 기본도구만 = 가벼움. 한 결정이 둘을 만듦).
  - **차별 없음 = 시민 층위**(entwurf_peers 가시 / garden id 주소화 / entwurf_v2 도달 / 응답), *레일 동일성 아님*. 메일박스 부재 = right-sizing(라이브라 "나중에 닿기" 불필요).
  - **ACP plugin = pi 세션의 model/provider로 들어감.** socket-citizenship은 host `--entwurf-control` pi 세션이 **공급**(plugin이 새로 안 만듦). plugin 책임 = provider/model 등록 → backend spawn → overlay → streamSimple. **새 socket/peers/citizen protocol 금지(=과설계 실패모드).** Cortex=`SNOWFLAKE_HOME` overlay = 같은 패턴.
  - **스코프**: Claude 먼저(테스트 리그 + 크레딧 헤지) / Codex 스킵(native direct-inject로 이미 시민) / Cortex·기업용=payoff(벤더락=native 불가, hvkiefer PR #40 재오픈까지 완전검증 대기) / 메이저툴=native.
- **설계 질문 6개 (정하지 말고 들고만 있기)**:
  1. overlay 재현 — `settings.json` minimal(`hooks:{}`+autoMemory off) + auth/skills/cache symlink passthrough + sessions/projects/settings 로컬 격리.
  2. v1 **model-side** 배선 이식성 — **채굴결과(06-18): 새 소켓 안 만듦.** `socket-discovery`는 model-agnostic이라 host `--entwurf-control` 세션이 시민권을 공급(소켓 파일명=gardenId, RPC로 cwd/model/idle enrich). → v1의 *model/provider* 배선만 v2 기판으로 이식; 소켓/peers 레이어는 상속.
  3. repo 구조 — **#15 청사진**: `acp/backends/claude.ts` · `acp/overlays/*` · `acp/session-store.ts` · `acp/model-lock.ts` · `acp/compaction-policy.ts` (+ 얇은 facade, **#38 보정**: 중심 아닌 plugin 하나). #15가 extraction으로 못 닿은 shape를 *fresh build*로. **단 물리위치는 #6과 연동 미결**: top-level `acp/*` vs `pi-extensions/lib/acp/*`.
  4. Cortex 검증 한계 — 로컬 완전검증 불가(계정 없음), Claude만 지금 가능.
  5. fact 표면(#39) — **socket/liveness/addressability(exists / live / socket·control path / replyable·addressable)는 host `--entwurf-control` 세션이 socket-discovery로 공급**(plugin이 만드는 게 아님 — Q1 결론). ACP plugin 자신의 fact = **backend health / turn evidence**뿐. *그 이상(memory·planner) 금지.*
  6. **ACP entry/fence/pack 위치 (#15 벽 — 반만 해결, GPT 보정)** — pi extension은 **jiti로 TS 로드**(Node strip-types 아님). → 질문은 "strip-types로 로드되나"가 아니라 **"provider entry를 어디 두고, entry+내부모듈이 어떤 typecheck/runtime/pack fence를 타나"**. v2 crossing pattern은 *있음*(lib/* = root exclude → `scripts/tsconfig` allowImportingTsExtensions+noEmit; emit-root는 non-literal dynamic import로 닿음), 단 `scripts/tsconfig` include=`../pi-extensions/lib/**/*.ts`라 **top-level `acp/*`는 자동 진입 안 됨**. **택1(GPT lean=①)**: ① `pi-extensions/acp-provider.ts` entry(`package.json` `pi.extensions` 추가) + 내부 `pi-extensions/lib/acp/*`(기존 fence 탑승) / ② top-level `index.ts` 부활(v0.11 유사 — **중심성 회귀 위험**) + 새 tsconfig 경계. → **S0에서 고정**.

# S2-scout 핀 — 확정값 (read-only 정찰 + GPT PASS 2026-06-18, 하드제약)

> S2 코드 진입 전 디버깅 지옥 방지용. 이 3핀은 S2a~S2d 내내 불변.
> **틀: 이건 재구현이지 port가 아니다.** 0.11.0은 동작하지만 v1 + 무거움 → behavior oracle만 이식, 구조는 새로. **pi는 4번째 하네스(Claude Code·Codex·Antigravity·pi)일 뿐, ACP는 그 pi에 붙는 plugin 하나**(중심/2번째 하네스 금지).

**핀1 billing carrier (oracle A, 최고위험)** — 0.11.0 `engraving.ts` 실측:
- `_meta.systemPrompt`가 SDK-default 모양서 material하게 멀어지면 → 구독(OAuth 정액제) billing이 metered 분류 → 잔액없는 구독자 HTTP400(캐리어 커지는 순간).
- ⇒ 캐리어(engraving)=SHORT/empty. 리치컨텍스트(AGENTS/pi base/bridge identity/tool surface)는 `pi-context-augment.ts`가 **첫 user message에 prepend**. 캐리어 rendered=(template-on-disk, backend, mcpServerNames) **순수함수**(clock/random/env 금지 → 아니면 `bridgeConfigSignature` drift → 매턴 rebuild). Claude-only면 캐리어 1슬롯 붕괴.

**핀2 ACP SDK surface** — 0.11.0 deps + registry(2026-06-18):
- pin = `@agentclientprotocol/sdk@0.22.1` + `@agentclientprotocol/claude-agent-acp@0.39.0` (둘 다 0.11.0값). latest는 0.26.0/0.47.0(claude-agent-acp 8 minor drift) — **upstream 업그레이드는 raw turn+overlay+event mapping green 뒤 별도 lane**.
- 사일런트 rename 없음(`@agentclientprotocol/*` 유지, pin registry 생존). spawn: `require.resolve("@agentclientprotocol/claude-agent-acp/package.json")`→bin→fallback `PATH:claude-agent-acp`.
- **`@anthropic-ai/sdk` 직접 dep 금지** — 0.11.0 소스에 직접 import/`new Anthropic()` 0건(API client 아님). 실제는 `@anthropic-ai/claude-agent-sdk`(+platform-native) cli.js/native binary를 `require.resolve` probe→로컬 인증 claude spawn. runtime resolve 실패시 조사 대상 = `@anthropic-ai/claude-agent-sdk`(SDK API client 아님). 우선 claude-agent-acp가 transitive로 끌고 오는 걸로 충분한지 게이트 확인.
- `@zed-industries/codex-acp` scope-out(native가 Codex 도달).

**핀3 local Claude ACP auth** — 실측:
- `claude 2.1.181` PATH ✅ / `~/.claude/.credentials.json` ✅. overlay `~/.pi/agent/claude-config-overlay/`: credentials/skills/cache/debug/session-env **symlink passthrough** + projects/sessions **로컬 격리**.
- overlay `settings.json` = `{"permissions":{"defaultMode":"default"},"autoMemoryEnabled":false,"hooks":{}}` → `hooks:{}`=메일박스 부재 by design 실측 + autoMemory off. **claude-agent-acp 바이너리 미설치**(S2a가 dep 설치). auth=claude 바이너리가 자체 process FS에서 읽음(repo가 안 옮김 → invariant 정합).

**GPT 명문 하드제약 3문장 (영속)**:
1. First S2 implementation pins ACP deps to 0.11.0 versions; upstream upgrade is a later lane.
2. ~~No direct `@anthropic-ai/sdk` dependency unless source imports it~~ **REVISED (2026-06-18, S2a-1 실측 + GPT 옵션A 승인)**: `@anthropic-ai/sdk` direct dep is allowed ONLY as an exact peer-resolution pin (`0.100.1`) for `@anthropic-ai/claude-agent-sdk@0.3.156`'s `>=0.93.0` peer; source-level import / API-client / credential use remains forbidden. 근거: drop하면 stale `0.91.1`로 resolve → peer unmet → raw-turn-time break. 0.11.0 lockfile이 동일 구조 증명. 게이트 `check-acp-sdk-surface`가 강제(pin 일치 + lock peer-resolution + wire-SDK export + no source import/`new Anthropic()`).
3. S2a proves bytes/one raw turn only; no overlay, no provider streamSimple replacement, no session reuse/signature, no rich carrier/augment.

**S2a 경계 (GPT 확정)**: dep pin + SDK surface gate + stdio JSON-RPC ACP raw 1턴까지만. LIVE-gated · scratch cwd · `_meta.systemPrompt` 안 키우는 minimal payload(S2a에서 리치 컨텍스트/AGENTS prepend/engraving 실험 금지).

**Continuity**: GPT anchor `20260618T080922-be0e35`가 이 S2-scout PASS를 끝으로 퇴근(rotate). 위 §검수 trail이 review-state. 다음 GPT는 새로 mint — 이 §S2-scout 핀 + 본 NEXT가 sync 기준.

# 구현 순서 (S0 → S1 → S2 — GPT)

> **첫 slice는 backend가 아니다.** 0.11.0은 behavior oracle이지 architecture oracle 아님. socket/peers/entwurf_v2/v2 core 손대기 금지, v1 부활 금지.

- ~~**S0 loader/fence slice (첫 coding)**: ACP provider extension entry 위치 결정 + `pi.extensions` 연결 + typecheck fence + `check-pack`/`check-pack-install` required 정렬 + `pi --list-models`에 curated Claude anchor.~~ **DONE 2026-06-18** (위 NOW 참조). GPT lean ① 채택(`pi-extensions/acp-provider.ts` entry + `lib/acp/*` 내부, `.js` import로 root fence 자동 탑승 — 새 tsconfig 없음). fail-loud stub + 게이트 2개 + pack stale 정리까지.
- ~~**S1 socket-citizen**~~ **DONE (2026-06-18)**: ACP-model `--entwurf-control` 세션이 `entwurf_peers`에 1급 시민으로 뜨고 `get_info`에 답함 — 라이브 증명 + `smoke-acp-socket-citizen-live`(8 checks). QM1/QM2 라이브 차단. **메일박스 부재·overlay 활성 증명은 S2로**(S1은 backend turn 전이라 불가 — GPT).
- **S2 backend turn**: 그 세션에서 실제 ACP Claude **1턴 성공** + overlay 활성(`settings.json` `hooks:{}` = 메일박스 부재 by design)·도구축소·이벤트매핑(rawOutput=array) 안 깨짐. ← ACP backend 건강 + overlay 증명(S1만으론 미증명).
- 각 단계 `pnpm check`/typecheck green. **주의: `pnpm check` green ≠ publish 가능** — 아래 §따라온 이슈 pack-install 참조.
- **Blocker**: none. commit/push/tag/merge = GLG.
- **Read**: 이 파일 + **AGENTS.md**(영속 경계) + botlog 앵커 + 이슈 **#38**(ACP=plugin)/**#39**(awareness=read-only fact)/**#15**(구조청사진+트러스트경계) + (착수 시) 0.11.0 ACP 코드.

# 홉 계획 + Continuity (계획이지 예언 아님 — Opus/GPT 합의 2026-06-18)

> ⚠️ 이건 **끊는 흐름**을 위한 계획이지 고정 예언이 아니다. 숫자는 감각치(절대화 금지), S2 내부 설계 세부·새 파일명은 여기서 확정하지 않는다(그건 oracle A~H + 착수 시 코드가 SSOT).

**3층 골격**: S1=구조 확정층 / S2=실제 backend 구현층 / PR-polish=공개·merge 준비층.

- **S1 (작게 — 1 Opus + 1 GPT)**: backend turn 없이 "ACP-model `--entwurf-control` 세션이 `entwurf_peers`+`get_info`에 잡히나"만. socket-discovery가 model-agnostic이라 코드-라이트일 가능성 큼.
  - 사전 물음표 2개(진입 첫 동작으로 차단): ① `model-lock.ts`가 ACP 모델 선택을 되돌리나 ② `pi --entwurf-control --model pi-shell-acp/…` 런치가 stub 때문에 *시작* 시 죽나(런치+peers+get_info는 턴 없음 → 안 죽어야 정상).
- ~~**S2-scout (S2a 앞단에 흡수 — 코드 전 핀)**~~ **DONE + GPT PASS (2026-06-18)**: 3핀 실측 + 확정값 = §S2-scout 핀. (billing carrier oracle A / ACP SDK surface / local Claude auth 전부 read-only 정찰 완료.)
- **S2 컷 (≈4~5 Opus + 2~3 GPT)** — 순서가 안전장치:
  - **S2a** dep 핀 + stdio JSON-RPC ACP client + **raw 1턴**(overlay/augment 없이 바이트 회수).
  - **S2b** overlay + 도구축소 + `assertExcludeToolsHonored`.
  - **S2c** 이벤트매핑 + `streamSimple` 실 backend 교체(stub 제거). *(S2b/S2c는 합쳐질 수 있음)*
  - **S2d** session store/signature/reuse + billing carrier(engraving) + first-user augment. **⛔ 앞당기지 말 것 — raw pipe(S2a)가 먼저 살아야 안전.**
  - **S2e** live smoke + 게이트 + RGG.
- **PR-polish (1~2 Opus + 1 GPT)**: README/ROADMAP/CHANGELOG/live gate.
- **감각치(절대화 금지)**: usable+merge까지 대략 6~8 Opus 왕복 / 4~5 GPT 리뷰.

**Continuity rule (꼭 지킬 것)**:
> Do not rotate Opus and GPT at the same time. The GPT/Codex session is the review/continuity anchor; Opus can be re-minted from NEXT + AGENTS + botlog + the latest GPT review. If GPT must rotate, first write a short review-state into NEXT or botlog.

- 즉 **어느 컷에서도 Opus·GPT 둘 다 동시에 새로 가지 않는다.** 기본: GPT 세션(현 `20260618T080922-be0e35`)을 anchor로 살려두고 Opus만 re-mint. (이번 S0가 그 키트로 깨끗이 re-mint된 게 증거.) 깨지는 경우 = 둘 다 새로 갈 때 → GPT 닫기 전 review-trail을 NEXT/botlog에 남길 것.

# 0.11.0 behavior oracle — 구현 reference (소모성)

> ⚠️ 다른 문서로 새지 말 것 — 여기가 **유일 사본**. 구현 끝나면 코드/CHANGELOG로 승격 후 이 섹션 삭제.
> 원칙: **behavior는 배우고, architecture/중심성은 안 가져온다.**

- **A. 빌링 캐리어 규칙 (가장 비싼 hard-won)**: `_meta.systemPrompt`(Claude 캐리어)가 SDK-default 모양에서 멀어지면 Anthropic 구독 빌링이 **metered로 분류 → 구독자 HTTP 400**(operator 실측). ⇒ 캐리어(`engraving`)는 작게, 리치 컨텍스트(bridge 정체성+`~/AGENTS.md`+pi intro+tool surface)는 **첫 user message에 prepend**(긴 user 메시지와 구조 동일 → 빌링 무관). 50KB 상한, 날짜 day 단위. *모르고 재구현하면 400 재발.*
- **B. 정체성 캐리어 비대칭**: Claude=`_meta.systemPrompt` 문자열치환 / Codex=`-c developer_instructions`(spawn, pinned, 바꾸려면 respawn) / Gemini=overlay `system.md`(`GEMINI_SYSTEM_MD`). **Claude-only면 1슬롯으로 붕괴.**
- **C. 안정성 서명 → 세션 재사용**: `bridgeConfigSignature=hash(systemPromptAppend+mcpServers)`. 캐리어가 턴마다 drift하면 **매 턴 세션 rebuild**(비쌈) ⇒ 캐리어 입력은 **순수함수**(clock/random/env-time 금지, 날짜 day 단위). bootstrapPath=reuse|resume|load|new, record=`~/.pi/agent/cache/pi-shell-acp/sessions`, `isSessionCompatible`가 캐리어 검사. piAgentId는 서명 *이후* spawn 시 주입(stale 방지).
- **D. overlay = 설정격리 + 도구축소 + 캐리어 물질화 (백엔드별)**: Claude=`claude-config-overlay`(settings.json `hooks:{}`=메일박스 부재, auth/skills symlink, 기본도구만=가벼움) / Codex=`CODEX_HOME`(memories gate, `web_search=disabled`) / Gemini=`admin.toml` deny-all admin-policy.
- **E. 모델 강제 + 도구 정직성**: 커레이트 모델만(전체 pi-ai 레지스트리 아님), `unstable_setSessionModel`로 강제(=set_model 아날로그). `assertExcludeToolsHonored`=선언(pi)≠실제(backend)면 **fail-fast**(모델에게 거짓말 금지). 확장도구(entwurf*)는 pi-side라 자유 제외.
- **F. 이벤트 매핑(3방언) + 권한 자동응답**: ACP `session_notification`→pi stream(message_chunk→text / thought→thinking / tool_call→notice / usage→토큰·비용). 3백엔드가 tool 결과 다르게 노출(Claude rawOutput=array / Codex=CallToolResult객체 / Gemini=없음→content[]). entwurf_send→`[entwurf sent →]` 박스(3단 args 복구), `sanitizeNoticeFragment`로 한 줄 notice 보호. 권한 자동응답(YOLO). **Claude-only면 방언 1종.**
- **G. 기타 이식 대상**: stdio NDJSON JSON-RPC reader / MCP server normalize·validate / `sendPrompt` project-context **de-dup**(entwurf-spawn 시 AGENTS.md 중복 방지) / `assertLegacyCompactionKnobUnset`(compaction off by design).
- **H. provider no-auth sentinel (구현 때 놓치기 쉬움 — GPT)**: `registerProvider("pi-shell-acp", …)` 재등록 시 "credentials 제공/재판매/우회 아님"을 *등록 형태*로 지키는 장치. 놓치면 `ANTHROPIC_API_KEY`류 오해/오작동 재발. **S0에서 구현됨**: `pi-extensions/lib/acp/models.ts`의 `PI_SHELL_ACP_NO_AUTH_SENTINEL="pi-shell-acp-no-auth"`(lowercase+hyphen → ENV ref 아님). 게이트 `check-auth-boundary`는 **신규 `acp-provider.ts` + `lib/acp/*` retarget**(legacy-ENV ALLCAPS apiKey 리터럴 금지 + sentinel 존재) — **AGENTS §Operating boundaries(trust)의 코드-레벨 짝**. (옛 `index.ts`/`acp-bridge.ts` 기준 아님.)
- **핵심 발견**: 3544줄 fat의 큰 덩어리 = **3백엔드 방언 화해**. Claude-only면 **캐리어 1슬롯 · overlay 1종 · 이벤트 방언 1종**으로 붕괴 ⇒ *재구현이 port보다 얇다*(코드로 확인됨).

# 0.11.0 읽기 전 규율 (ACP 중심 회귀 방지)
1. 0.11.0 = **behavior oracle**이지 **architecture oracle 아님**. 2. `acp-bridge.ts` 동작은 배우되 **중심성은 이식 안 함**. 3. ACP는 v2 core *바깥*에서 socket citizen 공급. 4. awareness는 read-only fact로만. (상세·영속 경계: **AGENTS.md §ACP Plugin Boundary** + §Operating Boundaries)

# 따라온 이슈 — v2-only 상속 (substrate, ACP와 무관하게 살아있음 → 그대로 따라감)

- **URGENT README/install doc debt (oracle 2026-06-17)**: checkout/pull/branch-switch 후 `pnpm install`; meta-session canonical = `./run.sh install-meta-bridge`; 검증 `./run.sh doctor-meta-bridge` + `claude mcp get pi-tools-bridge`(중립 cwd `/tmp`도 USER scope Connected); 소스 갱신 후 `pnpm install && ./run.sh install-meta-bridge` 재실행. 수동 `~/.mcp.json`/project MCP는 plain external/debug용으로 격하.
- ~~**pack-install gate stale (GPT, publish ≠ `pnpm check`)**~~: **RESOLVED S0 (2026-06-18).** `check_pack_install` tar_required에서 옛 ACP 6파일(`index.ts`/`acp-bridge.ts`/`event-mapper.ts`/`engraving.ts`/`pi-context-augment.ts`/`pi-extensions/entwurf.ts`) 제거 → 신규 `acp-provider.ts`+`lib/acp/*` 추가. `check-pack-install` 직전 RED였음(삭제파일 required) → 이제 GREEN. **주의 유지: `pnpm check`는 `check-pack`까지만 → publish 전 반드시 `check-pack-install` 별도 실행.**
- **meta-store hygiene (GLG 숙고, 미결)**:
  - *재현성*: thinkpad만 v1 정리됨, oracle 등은 v1/orphan 누적 잔존. cleanup verb(`prune --apply` / TTL 자동 / `migrate-v1` 일괄) vs 수동 janitor+문서화. 주의: prune 1.0.0 정책 = **listing-only**(보수적, store는 native→garden lookup 권위) → `--apply`는 정책 변경이라 가볍게 추가 말 것.
  - *store 성장 근원*: 매 Claude 세션 1 record mint + 자동 prune 없음 → 부풀음("지저분" 근원). retention/aging 정책 정할지 결정.
  - *v1 reader 제거 타이밍*: dual-read v1 경로(`parseMetaRecordV1`/`normalizeMetaIdentity` v1 분기) 제거는 **전역 마이그레이션 완료에 게이트** — thinkpad 하나로 당기지 말 것.
  - *model=null (cosmetic)*: 새 record `model` null(Claude hook envelope에 model 없음). 동작 무관, 별도 후속.

# 재triage 필요 — B가 옛 전제를 뒤집음 (⚠️ 그대로 쓰지 말 것)

> v2-only NEXT의 "Phase B 잔여"는 **rename + ACP 제거** 전제였다. B는 둘 다 뒤집는다. 옛 메모를 그대로 실행하면 드리프트다.

- **model-lock (반전 주의)**: 옛 메모 = "ACP 제거로 막을 provider 없어 vestigial". **B에선 ACP가 돌아오므로 `native↔pi-shell-acp provider` 전환이 다시 의미를 가질 수 있음.** *삭제로 드리프트 금지* — ACP 재구현 설계와 함께 재정의.
- **provider 하드코드 / resolve-acp-bridge**: rename 안 하므로 `getRegistryRouting`의 `provider:"pi-shell-acp"`는 *유지*. `scripts/resolve-acp-bridge.ts`(v2-only에서 orphan)는 ACP 복귀로 *되살아날 수 있음* — 새 구조에서 재설계.
- **README 재작성**: 여전히 필요하나 프레임 변경 — "ACP 제거"가 아니라 "**v2 core + ACP plugin**". install-meta-bridge 정식 경로 + 실패 해석은 유지.
- **dead export / sentinel / session-messaging**: `runEntwurfSync`/`runEntwurfResumeSync`(호출처 0), sentinel(LEGACY), session-messaging — 옛 메모는 "rename 직전 절삭". B에선 새 구조 정리 시 재판단. 지금 LEGACY fail-loud 보존.

# 다음 SSOT 정렬

> **AGENTS.md 보정 = 이번에 완료**(ACP=plugin 경계 + 트러스트 invariant 반영, v2-only 절삭 프레임 제거). 남은 것:
- **ROADMAP.md**: "ACP plugin on v2 core" lane 추가 — ACP 설계 굳은 뒤.
- **README 재작성**: "v2 core + ACP plugin" 프레임 — 구현 후(위 재triage 참조).

# 넘으면 안 되는 선
- **다음 coding = S2a — S0·S1·S2-scout DONE(GPT PASS).** §S2-scout 핀이 하드제약. S2a = dep pin(0.11.0값: sdk 0.22.1 / claude-agent-acp 0.39.0) + SDK surface gate + raw 1턴까지만. `@anthropic-ai/sdk` 직접 dep 금지. S2d(billing/session reuse) 앞당김 금지 — raw pipe(S2a)가 먼저. **S2c 전엔 fail-loud stub 유지**. socket/peers/`entwurf_v2`/v2 core 손대기 금지. **v1 `entwurf`/`entwurf_send`/`entwurf_resume` 절대 부활 금지.**
- **드리프트 금지**: 옛 칼날("ACP 제거 / rename")로 돌아가지 말 것. ACP는 *데리고 간다*. 흔들리면 botlog 앵커 + 원본 프롬프트 3블록 재독.
- **경계 금지**: ACP가 다시 *중심 하네스*가 되지 말 것 — ACP는 v2 core 바깥 plugin(상세: AGENTS.md §ACP Plugin Boundary). plugin을 memory/planner/orchestrator/second harness/mailbox citizen으로 키우지 말 것.
- **`v2-only` 브랜치 불가침**: base/지도라 보존. 작업은 이 브랜치에서만.
- `core.hooksPath`/`.git-hooks-mode` 불변. commit/push/tag/publish/merge = GLG. `--no-verify` 금지.
- **0.11.0 = behavior oracle. 기계적 port 금지** — 행동만 이식, 구조는 새로.

# 참고
- base 지도: `NEXT--v2-only.md`(v2-only 브랜치에 보존) = 무엇이 최소 생존 셋인지의 정찰 기록.
- 0.11.0 ACP 코어(되살릴 reference, v2-only에서 삭제됨): `acp-bridge.ts`(3544) / `engraving.ts`(125) / `event-mapper.ts`(720) / `pi-context-augment.ts`(183) / `index.ts`(1263) + `prompts/engraving.md` + `scripts/resolve-acp-bridge.ts`. read-only로 `git show v0.11.0:<file>`.
- overlay 실측: `~/.pi/agent/claude-config-overlay/` — auth/skills/cache symlink passthrough, sessions/projects/settings 로컬 격리, `settings.json` `hooks:{}`(메일박스 부재 by design).
