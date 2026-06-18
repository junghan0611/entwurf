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

- **Current**: `v2-only`에서 분기 완료. v2 substrate(컨트롤소켓 / 메타메일박스 두 레일) green + LIVE 확인된 clean base 위. **구현 0줄.**
- **Next = 설계 고민 단계 (아직 아무것도 정하지 말 것)**: ACP를 *어떻게* 설계/구현할지 **고민만**. **코드·폴더·파일 생성 금지.** 아래 behavior oracle + 설계 질문 6개 숙고가 먼저.
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
  5. fact 표면(#39) — ACP plugin이 core에 노출할 read-only fact: exists / live / socket·control path / replyable·addressable / delivery evidence. *그 이상(memory·planner) 금지.*
  6. **split-import 물리위치 (#15 벽 — 반만 해결)** — 채굴결과: v2가 검증한 crossing pattern *있음*(lib/* = root에서 exclude → `scripts/tsconfig`(allowImportingTsExtensions+noEmit) → strip-types 실행; emit-root는 non-literal dynamic import로 fence를 닿음). **단 미결**: `scripts/tsconfig` include = `../pi-extensions/lib/**/*.ts`라 **top-level `acp/*`는 fence에 자동 진입 안 됨**. 택1 → (a) `pi-extensions/lib/acp/...`로 기존 fence 탑승 / (b) top-level `acp/...` + 새 tsconfig include/exclude 경계 명시. + 0.11.0 ACP는 emit(`.js` import)였으니 **pi가 ACP entry를 strip-types로 로드하는지 1개 확인**. → #6 = "벽은 뚫림, ACP 모듈을 fence에 넣는 *위치*만 결정/검증".
- **Green-gate (나중 판정) — 2층 (S1만으론 ACP backend 건강 미증명)**:
  - **S1 socket-citizen**: ACP-model `--entwurf-control` pi 세션이 native 형제처럼 `entwurf_peers`에 뜨고 control RPC(`get_info`: cwd/model/idle)에 답함 + 메일박스 없음(overlay 활성). ← 시민권 증명(host 소켓이 공급).
  - **S2 backend turn**: 그 세션에서 실제 ACP Claude **1턴 성공** + overlay·도구축소·이벤트매핑(rawOutput=array) 안 깨짐. ← ACP backend 건강 증명.
  - + `pnpm check`/typecheck green.
- **Blocker**: none. commit/push/tag/merge = GLG.
- **Read**: 이 파일 + **AGENTS.md**(영속 경계) + botlog 앵커 + 이슈 **#38**(ACP=plugin)/**#39**(awareness=read-only fact)/**#15**(구조청사진+트러스트경계) + (착수 시) 0.11.0 ACP 코드.

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
- **H. provider no-auth sentinel (구현 때 놓치기 쉬움 — GPT)**: `registerProvider("pi-shell-acp", …)` 재등록 시 "credentials 제공/재판매/우회 아님"을 *등록 형태*로 지키는 장치(0.11.0 `index.ts`). 놓치면 `ANTHROPIC_API_KEY`류 오해/오작동 재발. 게이트 `check-auth-boundary`(index.ts/acp-bridge.ts에 legacy-ENV apiKey 리터럴 금지)가 박음 — **AGENTS §Operating boundaries(trust)의 코드-레벨 짝**.
- **핵심 발견**: 3544줄 fat의 큰 덩어리 = **3백엔드 방언 화해**. Claude-only면 **캐리어 1슬롯 · overlay 1종 · 이벤트 방언 1종**으로 붕괴 ⇒ *재구현이 port보다 얇다*(코드로 확인됨).

# 0.11.0 읽기 전 규율 (ACP 중심 회귀 방지)
1. 0.11.0 = **behavior oracle**이지 **architecture oracle 아님**. 2. `acp-bridge.ts` 동작은 배우되 **중심성은 이식 안 함**. 3. ACP는 v2 core *바깥*에서 socket citizen 공급. 4. awareness는 read-only fact로만. (상세·영속 경계: **AGENTS.md §ACP Plugin Boundary** + §Operating Boundaries)

# 따라온 이슈 — v2-only 상속 (substrate, ACP와 무관하게 살아있음 → 그대로 따라감)

- **URGENT README/install doc debt (oracle 2026-06-17)**: checkout/pull/branch-switch 후 `pnpm install`; meta-session canonical = `./run.sh install-meta-bridge`; 검증 `./run.sh doctor-meta-bridge` + `claude mcp get pi-tools-bridge`(중립 cwd `/tmp`도 USER scope Connected); 소스 갱신 후 `pnpm install && ./run.sh install-meta-bridge` 재실행. 수동 `~/.mcp.json`/project MCP는 plain external/debug용으로 격하.
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
- **지금은 고민 단계 — 코드/폴더/파일 생성 금지. ACP 설계 아무것도 확정 금지.**
- **드리프트 금지**: 옛 칼날("ACP 제거 / rename")로 돌아가지 말 것. ACP는 *데리고 간다*. 흔들리면 botlog 앵커 + 원본 프롬프트 3블록 재독.
- **경계 금지**: ACP가 다시 *중심 하네스*가 되지 말 것 — ACP는 v2 core 바깥 plugin(상세: AGENTS.md §ACP Plugin Boundary). plugin을 memory/planner/orchestrator/second harness/mailbox citizen으로 키우지 말 것.
- **`v2-only` 브랜치 불가침**: base/지도라 보존. 작업은 이 브랜치에서만.
- `core.hooksPath`/`.git-hooks-mode` 불변. commit/push/tag/publish/merge = GLG. `--no-verify` 금지.
- **0.11.0 = behavior oracle. 기계적 port 금지** — 행동만 이식, 구조는 새로.

# 참고
- base 지도: `NEXT--v2-only.md`(v2-only 브랜치에 보존) = 무엇이 최소 생존 셋인지의 정찰 기록.
- 0.11.0 ACP 코어(되살릴 reference, v2-only에서 삭제됨): `acp-bridge.ts`(3544) / `engraving.ts`(125) / `event-mapper.ts`(720) / `pi-context-augment.ts`(183) / `index.ts`(1263) + `prompts/engraving.md` + `scripts/resolve-acp-bridge.ts`. read-only로 `git show v0.11.0:<file>`.
- overlay 실측: `~/.pi/agent/claude-config-overlay/` — auth/skills/cache symlink passthrough, sessions/projects/settings 로컬 격리, `settings.json` `hooks:{}`(메일박스 부재 by design).
