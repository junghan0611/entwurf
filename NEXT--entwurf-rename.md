# NEXT — `entwurf-rename` · rename `pi-shell-acp` → `entwurf` (pi 탈중심화)

> **상태:** 치환 **0건** · oracle 산출물 **재담금질 중**(2026-06-23 framing 정정). 분기점 `acp-on-v2` `a893318`(CP1 lock, 원격 봉인). operator 세트·영속 invariant SSOT = `ROADMAP.md`. GPT = 검수자 대기.
>
> **⚠️ framing 정정 (2026-06-23, GLG):**
> - **범위 = 이 repo 본체(`pi-shell-acp`→`entwurf`)만. 우리가 중심을 잡는다.** consumer 동기화는 **담당자(sibling) 위임** — 우리는 다른 repo를 직접 편집하지 않는다. 헛발질로 작업을 못 끝내는 걸 막는 핵심 규율.
> - **openclaw consumer는 허구다.** `plugins/openclaw`는 2026-06-10 deprecate·**디렉토리째 제거**(find 0건). repo 내 `openclaw` 언급은 전부 historical docs(README/CHANGELOG/ROADMAP/docs/run.sh 주석) — **코드 lockstep 0**. oracle이 docs 기록을 live 배포 consumer로 오인했던 §4-B는 **삭제**.
> - **rename이 먼저. npm publish는 최후행.** 순서 = **코드 rename(S1~S3) → repo/dir rename(GLG) → npm publish(GLG, 맨 마지막)**(§6 시퀀스). publish는 rename 트리거가 아니다. package.json `name` *문자열*은 S1 소스 치환 대상이지만 *registry publish*는 모든 rename 완료 후 별도. 설치 동기화 cut-choreography **폐기** — 쓰는 사람은 전문가, 내 방향 따라오거나 안 쓰면 그만. 범용 도구가 아니다.
> - **🔪 이건 호환성 작업이 아니라 절단(cutover)다 [GLG 핵심 교리].** 이전 세션·이전 이름과 **결별**한다 — 어떤 *런타임* 호환성도 두지 않는다. dual-read/alias/legacy-accept 0. 설치자는 새로 간다(호환 아니라 새 시작). state(meta-bridge·ACP cache)는 **이장(one-shot cutover)**이지 dual-read가 아님 — old를 new로 한 번 옮기고 런타임은 이후 new만 안다. **이건 정체성의 전환** — pi를 4번째 하네스로 내린다(ACP·소켓 대화하는 특별한 adapter지만), **entwurf가 본질**. 약하게 조이면 버그가 아니라 *정체성*이 샌다.
>
> **▶ 다음 세션 진입점 (실제 작업):** ⑤ **live S1 ✅ `07c2592`+`1e89c13`** → ⑥ **live S2 ✅ `e795a08`**(MCP bridge) → ⑦ **live S3 ✅ `148a8f8`**(env namespace, 46f 229/229, GPT GO) + **`64cb6b5` check-env-namespace 게이트**(cutover lock, pnpm check 등록, negative-test 검증). **★ 코드 cutover(S1·S2·S3) 전부 완료.** 남은: ⑧ **GLG 무인 후행**(state 이장 §6-④/⑤ · repo/dir rename §6-③ · npm §6-① — §5 quiesce 가드) + **usage-ok 운영절차**(GPT §6-A: S3 후 install-meta-bridge/state apply가 MCP entry env를 `ENTWURF_BRIDGE_*`로 재작성 + 사용자 shell export·`*_ENV_FILE` 새 이름 전환). + **rename 이후 본격 방향 ↓(§10)**.
>
> **▶▶ 2026-06-24 마감 — 0.12.0 문서/설치면 결계 pass (릴리즈 컷 아님):**
> - **완료/커밋 예정:** README/ROADMAP/package description을 #44 정신으로 `entwurf`-first 재구성(pi는 adapter, garden id는 guard, ACP는 plugin ingress). DELIVERY/BASELINE/VERIFY는 0.12.0 recipe-first로 압축, stale v1 smoke command drift를 실재 v2 surface로 교정. `docs/setup-clean-host.md`는 0.12.0 concise install 문서로 재작성, `demo/README.md` env stale(`ENTWURF_DEBUG`) 교정.
> - **설치면 lock-in:** `package.json#files`에 meta-bridge source skeleton을 포함하고 `run.sh check-pack`/`check-pack-install` required+forbidden을 강화(`pi/meta-bridge/.assembled/`는 forbidden). `pnpm typecheck` + `./run.sh check-pack` green(Opus c949e7).
> - **다음 리뷰(릴리즈 컷 전 필수):** ① full docs diff를 한 번 더 읽어 0.12.0 현재 표면/문장 충돌 확인 ② `LIVE=1 ./run.sh release-gate <scratch>` 재실행(MUST PASS/SKIP=0) ③ `smoke-acp-bundled-mcp-live` MUST/model-in-loop split ④ docs/assets 데모/hero 재생성 ⑤ 보류된 runtime cleanup(`PI_SHELL_ACP` env/code, phantom/compaction 용어)은 GLG 별도 승인 전 건드리지 않음 ⑥ branch NEXT 파일은 main merge 직전 삭제.
> - **아직 릴리즈 컷 아님:** tag/npm publish/old package deprecate는 GLG가 별도 지시할 때만.

> **▶▶ 2026-06-25 ★ ACP 백엔드 어댑터 레일 결정 (0.12.0 핵심 — GLG 교리 "표준궤를 깔아야 기차가 달린다"):**
> - **발견:** PR #40(hvkiefer, Snowflake Cortex Code 백엔드)은 0.12.0에서 **삭제된** `acp-bridge.ts`/`index.ts`(0.11.0 fat-bridge) 위에 작성됨 — 단순 conflict가 아니라 그 아키텍처가 사라짐. 0.11.0엔 `AcpBackendAdapter` 어댑터 패턴(`type AcpBackend`=claude|codex|gemini, `ACP_BACKEND_ADAPTERS` Record, `resolveAcpBackendAdapter`)이 있었고 PR #40은 거기에 cortex를 4번째로 깔끔히 끼웠음(기여자 표현: "slots into the existing AcpBackendAdapter pattern the same way Gemini does"). 그러나 0.12.0 cutover가 fat-bridge를 통째 버리고 Claude-first로 새로 빌드 → 현재 `lib/acp/`엔 백엔드 추상화 **0건**, `config.ts:374`가 non-claude를 **throw**로 차단.
> - **판정 ("이전보다 깔끔한가?" = 두 축):** (1) 단일 claude 코드 = 0.12.0이 더 깔끔(11모듈 분해, v2 위 thin plugin). (2) **백엔드 추가 레일 = 후퇴**(0.11.0 표준궤를 걷어냄). 확장 의도는 주석에만 선언됨(`models.ts:9-12` "Cortex would EXTEND this set — does not change the pattern"), 실제 seam은 미구현.
> - **결정(GLG):** 0.12.0에 `AcpBackendAdapter` 인터페이스를 plugin 구조 위에 **재도입**, claude를 그 *첫 구현*으로 리팩터. cortex가 2번째 백엔드 = 추상화 정당화 첫 실수요("2개부터 패턴이 산다"). **GLG가 레일을 깔고**, 기여자에겐 "이 인터페이스에 cortex 어댑터를 얹어라(PR #40 → 0.12.0 `lib/acp/` 포팅)"는 좁은 지침. 위임 전제 = GLG가 거의 다 해보고 인터페이스가 0.11.0보다 깔끔할 것.
> - **7 seam (PR #40 cortex가 0.11.0에서 실증한 명세):** `resolveLaunch` · `ensureOverlay`(auth passthrough+state hiding) · `buildSessionMeta`(carrier; cortex=undefined→first-user augment) · curated models+prefix 라우팅(`inferBackendFromModel`) · model enforcement(claude=`session/set_config_option` / cortex=launch-time `-m` pin, per-turn switch 금지) · settings+`bridgeConfigSignature` · gates(`check-backends`/`check-models`/`smoke-cortex`).
> - **설계 SSOT:** `docs/acp-backend-rail.md`. **GPT(`20260625T155537-341a87`) 합의로 §9 규격 확정(2026-06-25)** — 단일 provider+modelId prefix registry(non-claude=`cortex-*` 필수, 0/2 매칭 throw fail-fast) · `AcpBackendAdapter`↔`AcpTurnDeps` 분리+`defaultDeps(adapter)` · `routeModel`(owns+strip) · `buildSessionMeta` undefined→`_meta` omit · `ensureOverlay→{envOverrides}` · `enforceModel` 단일 메서드 · codex/gemini=non-goal. 다음 = claude 리팩터 스캐폴딩 → 기여자 지침.
> - **구현 (2026-06-25):** Step A(`backend-adapter.ts` = 인터페이스+claudeAdapter+fail-fast registry) + Step B(backend.ts turn loop를 어댑터 경유로 배선 — `AcpTurnDeps`에서 resolveLaunch/ensureOverlay 제거, spawnChild extraEnv, configSig nativeModelId/extra, runNewTurn에 adapter param 전달, `allCuratedModels` route/duplicate fail-fast, private resolveLaunch 삭제) 완료. **`pnpm check`/typecheck 3-config 전체 green, GPT Step A·B 승인.** turn loop/acp-client/event-mapper/session-store에 백엔드 분기 0 — 차이는 전부 `AcpBackendAdapter` 7 메서드 뒤. 다음 = LIVE smoke(raw-turn/overlay/session-reuse/provider, Claude credit, GLG 승인) → cortex 포팅 지침. GPT future note: `extra` flat/sorted primitive, config.ts 가드 cortex 정리(§docs/acp-backend-rail.md §9).
> - **★ 다들 기억:** 이건 0.12.0의 핵심 가치. 레일 규격(표준궤)을 하나로 못박는 게 곧 0.12.0에 담을 내용. 분신들 공유.

> **▶▶ 2026-06-25 릴리즈 전 문서/CHANGELOG 재검토:**
> - 완료: issue #44 기준으로 `CHANGELOG.md` Unreleased를 0.12.0 entwurf-first cutover 현상으로 재작성. stale 문구("package name pi-shell-acp kept / no rename", old ACP deps 0.39/0.22)를 제거하고, 2026-06-25 release-gate MUST `17/0/0` + BEHAVIOR `/gnew` T3 advisory flake를 기록.
> - 완료: README install 첫 문장을 `thin ACP bridge`에서 `thin garden-citizen bridge with Claude-first ACP plugin`으로 정정. `docs/setup-clean-host.md`는 npm을 publish 후 경로로 한정. `VERIFY.md`는 v1 `entwurf`/`entwurf_resume` 실행 shape와 `PI_ENTWURF_CHILD_STDERR_LOG` 잔재를 현재 v2/`ENTWURF_CHILD_STDERR_LOG`로 교정. `ROADMAP.md` close checklist에 재검증 결과 반영.
> - 검증: `pnpm check` ✅, `./run.sh check-pack` ✅, `pnpm run check-pack-install` ✅, `LIVE=1 ./run.sh release-gate <scratch>` MUST `PASS=17 FAIL=0 SKIP=0`, BEHAVIOR `FAIL=1`(advisory model-in-loop `entwurf_self` flake, cut blocker 아님).
> - 남은 릴리즈 전 꼬리: demo gif / hero 재생성, bundled-mcp deterministic split은 taxonomy hardening follow-up(이번 cut에서는 MUST pass), GLG push/tag/npm/old-package deprecate.
>
> **▶▶ 2026-06-25 설치면 담금질 + pi 런타임 버전 통제 [별개 lane, 같은 브랜치]:**
> - **배경:** oracle 작업분을 thinkpad로 가져와 현재 버전(0.12.0) 재설치. `pnpm install`로 의존성 갱신 — `@agentclientprotocol/claude-agent-acp` 0.39.0→**0.50.0**, `@agentclientprotocol/sdk` 0.22.1→**0.29.0**, `@earendil-works/pi-*`(dev) 0.79.8→**0.80.2**. `run.sh check-bridge` ✅, `check-dep-versions` 11 ok.
> - **글로벌 pi 런타임 0.79.6→0.80.2로 끌어올림 (드리프트 발견):** 글로벌 pnpm 스토어가 두 개로 갈라져 있었음 — bin shim `~/.local/share/pnpm/bin/pi`가 **stale v11/e4a19 (0.79.6)** 을 가리켜 `pi update self`도 "managed 아님"으로 거부. 정규 위치는 **global/5**. 조치 = `pnpm add -g @earendil-works/pi-coding-agent@0.80.2`(global/5 갱신) + stale `bin/pi` shim 제거 → pnpm이 `~/.local/share/pnpm/pi`에 0.80.2 가리키는 shim 재생성. `pi --version`→**0.80.2**, `pi list` 정상, `run.sh check-pi-runtime-version`→`ok 0.80.2 >= FLOOR 0.80.2`.
> - **★ 버전 통제 = repo가 SSOT (GLG 교리, 수동 글로벌 @latest 금지):** 핀의 단일 출처 = `package.json` devDep `@earendil-works/pi-* = 0.80.2`(정확 핀) + `run.sh:1343` `FLOOR='0.80.2'`. 게이트 = `check-pi-runtime-version`(글로벌 pi ≥ FLOOR) + `check-dep-versions`. **앞으로 버전 bump 절차:** ① repo에서 먼저 devDep 핀 + FLOOR 동시 bump → ② `pnpm add -g @earendil-works/pi-coding-agent@<핀버전>`(절대 `@latest` 아님) → ③ `run.sh check-pi-runtime-version`로 글로벌이 repo 핀과 일치 검증. 이전엔 GLG가 글로벌을 임의 업데이트했으나 이제 repo가 통제한다.
> - **TODO — 더 깔끔한 설치 과정 (설치면 아직 다듬는 중):** 글로벌 pi 런타임 버전을 repo 핀에서 자동 동기화하는 한 줄(예: `run.sh sync-pi-runtime` = devDep 핀 읽어 `pnpm add -g`까지) 검토. 두 글로벌 스토어(global/5 vs v11) 드리프트가 다시 생기지 않도록 doctor/install이 stale shim 감지·보고하는지 확인. 깔끔한 설치 = clean-host 문서(`docs/setup-clean-host.md`)와 `run.sh install` 흐름에 이 버전-통제 절차를 명시적으로 엮기.

> **▶▶ 2026-06-24 ACP client migration (후속 J) — done + bundled-mcp flake 후속 [rename과 별개 lane, 같은 브랜치]:**
> - **완료:** deprecated `ClientSideConnection` → 단일 `connectAcpClient` 어댑터(`pi-extensions/lib/acp/acp-client.ts`). backend=`client().connect()`(persistent — reuse 구조라 `connectWith` 아님), retained success는 close 안 함 / non-retained·error·reuse-error·abandoned만 `connection.close?.()`+teardown. 어댑터 `close` **best-effort swallow**(teardown close가 원 에러 mask하거나 teardownChild/finishError skip하는 것 차단). `check-acp-sdk-surface` 심볼 swap(`client`·`ndJsonStream`·`PROTOCOL_VERSION`·`AGENT_METHODS`·`CLIENT_METHODS`). `acp-child-cleanup.ts` `destroyChildStdio` 전 return 경로 배선(post-PASS event-loop pin = hang 해소). 9파일(신규 1+수정 8). 커밋 `029f285` (local, push=GLG; agenda stamp는 push 후).
> - **검증:** 정적 `pnpm check`/typecheck/lint/check-pack-install EXIT=0. LIVE smoke 5(raw/overlay/session-reuse/memory/provider) EXIT=0+orphan0. **LIVE release-gate MUST 17/0/0 orphan0.** Codex 독립 재실행도 MUST 17/0/0 GO. (raw hang blocker = Codex가 잡음, teardown 패치로 해소 — adapter best-effort close는 Opus가 보강.)
> - **⚠️ flake 관찰 (정직 표현 — "green 한 번=끝" 금지):** Codex 1차 full release-gate에서 `smoke-acp-bundled-mcp-live`(**MUST**)가 1회 실패 — 원인 = **model-in-loop tool-call flake**(`No such tool available: mcp__entwurf-bridge__entwurf_self`; agent_start/turn_end/agent_end 정상·willRetry:false → 서비스 죽음 아님). 단독 재시도 + 2차 full gate green. 동류 = rgg-positive T3 BEHAVIOR(`selfEnvelopeSessionIds:[]`). 둘 다 non-code, 모델 자율 MCP tool-call 신뢰성 의존.
> - **구조적 불일치 (코드 확인됨):** `smoke-acp-bundled-mcp-live.ts:210-239`는 모델에게 `mcp__entwurf-bridge__entwurf_self` 호출+envelope verbatim echo를 시켜 통과 판정 = model-in-loop. 그런데 `run.sh:2392-2395` MUST 정당화 주석은 "이 LIVE들은 programmatic transport/provider/backend invariant이지 model-in-loop autonomous tool-selection 아님이라 MUST"라고 명시 → **bundled-mcp만 그 정당화 불성립.**
> - **후속 (GPT에게 split 지시안 relay됨, 별도 chore):** `smoke-acp-bundled-mcp-live` **split** — MUST=bundled entwurf-bridge가 live ACP 세션에 wired되어 `entwurf_self`가 callable surface로 resolve됨을 **모델 턴 없이** deterministic 증명(flake root 직접 차단) / BEHAVIOR=모델 자율 호출+echo. `run.sh:2392-2395` 주석도 분리 반영. **★ tag/cut 직전 필수 재검토** — flake 반복 시 bundled-mcp의 MUST 위치 재조정.
> - **다음 Opus 진입점:** migration commit 닫힘(push=GLG 대기). GPT가 split 지시안 받음 → **다음 Opus가 GPT 회신 받아 split 리뷰/구현/검증/commit 이어감.** (이 ACP J migration 자체는 종료.)

> **▶▶ 2026-06-23 저녁 마감 — doc-cutover tail + phantom cleanup (origin 반영, push 완료):**
> - **`28d64d9`** docs(identity): live 문서 naming `pi-tools-bridge`→`entwurf-bridge` (AGENTS/VERIFY/BASELINE/CONTRIBUTING current 표면; history/evidence row는 옛 이름 보존; tool-count 7→4 교정).
> - **`623a4ea`** docs(cutover): README/VERIFY **phantom 컴팩션 표면 제거** — `session_before_compact {cancel:true}`/`ALLOW_(PI_)COMPACTION` 노브/`smoke-compaction-policy` 게이트 전부 코드 0건이었음. 고아 `demo/compaction-policy-smoke/` 삭제 + `package.json#files`에서 제거(tarball 미출하). README:55 Codex를 "기본 pi-native + `ENTWURF_ACP_FOR_CODEX=1` ACP opt-in"으로 **한정**(GPT의 "Claude-only 정정"은 under-claim 오류 — opt-in은 tested 실재, `entwurf-core.ts:23-30`).
> - 옛 ACP 캐시 `~/.pi/agent/cache/pi-shell-acp/`(130개, 4MB) 삭제 — 하위호환 불필요(GLG). 새 `entwurf/sessions`는 intact.
> - 둘 다 pre-commit `pnpm check` 전체 게이트 통과(`check-pack` 180 files invariants pass) + push(origin/entwurf-rename, global hook 통과) + agenda stamp. GPT 형제 수렴·검토 사이클 완료.
>
> **▶ 내일 진입점 (GLG가 NEXT 재담금질 예정):**
> 1. README **frame reframe** — entwurf-first 헤드라인 + shipped(pi·Claude Code·ACP Claude)/probe(Codex·Antigravity) **정직 매트릭스**. "pi=4번째 하네스" 방향성은 AGENTS/ROADMAP에 (GLG frame 결정 대기 — "4 harnesses 구호 대신 정직 매트릭스" 해석 ACK 필요).
> 2. CONTRIBUTING #7 최종 문구 pick (a 현재안 / b 강화안 "shipped=release-blocking, probe=라벨필수" / c 원복).
> 3. ROADMAP identity 재구성 (GPT 담당, frame 따라감).
> 4. **데모 gif 재생성**.
> 5. **Gemini/Antigravity(agy) 지원 검토** (~2h 예상).
> 6. release cut (tag/npm publish/old-pkg `@junghanacs/pi-shell-acp`·`@junghan0611/openclaw-pi-shell-acp` deprecate).
> - 태그 전 **README 수동 `rg` 1패스**(`PI_SHELL_ACP_`·기능주장) — 새 doc-게이트는 안 만듦(=오염). doc은 `check-env-namespace` 사각이라 수동 패스가 닫는다.

---

## 0 · 미션 & 교리

**미션:** `pi-shell-acp` repo를 `entwurf`로 rename. 단순 패키지명 교체가 아니다 — pi-중심 네이밍을 걷어내고 `entwurf`를 주어로 세운다. *"pi는 4번째 하네스일 뿐, entwurf capability는 하네스 무관."* **이 작업이 끝나야 entwurf 기능 정리 → 릴리즈로 나아갈 수 있다.**

**원칙:** "pi"는 *pi 하네스 adapter / pi-runtime / upstream 계약*일 때만 남긴다. 이 repo가 소유한 *garden citizen · identity · dispatch · bridge capability*는 **entwurf가 주어**. → "pi 제거"가 아니라 **"pi를 adapter로 격하, entwurf를 capability 주어로."**

**교리 — 일격필살 (담금질 후 한 방):** S1은 **한 atomic commit, green-first-try, 중간 거짓상태 0**. 네이밍이 핵심이라 한 번에 정확히. 그 전까지 나열(담금질)을 충분히 조인다.

**범위 교리 — "중심만 잡는다":** 우리는 **이 repo 본체**만 친다. agent-config 등 다른 내 repo는 rename 후 담당자가 맞춘다. consumer를 우리가 직접 좇으면 헛발질로 작업을 못 끝낸다. NEXT에 남기는 consumer 정보는 *편집 대상*이 아니라 *담당자에게 넘길 핸드오프 명세*(§4).

**cutover 교리 — 결별, 호환성 0 (GLG 핵심):** 이전 이름·이전 세션과 **결별**. 런타임 dual-read/alias/legacy-accept **0**. state는 one-shot 이장(§6-④/⑤). 이건 패키지명 교체가 아니라 **정체성 전환**이라, 약하게 조이면 버그가 아니라 정체성이 샌다. → 미래 구현자가 "호환성 한 줄만 두자"는 유혹 **금지**. migration 도구조차 제품 코드에 안 남긴다(old 이름이 코드에 남으면 cutover 위반, §6-5).

**실행 법칙 — "정확히 나열 후 치환":**
- 모든 토큰·변종·엣지케이스를 빠짐없이 *나열*하고 exhaustive 확인 **후에야** 결정적 일괄 치환.
- **blind `s/pi-/entwurf-/` 금지** — full-token exact only (KEEP군 오염 방지).
- 각 stage 후 **양방향 검증**: 잔존 `rg`(RENAME군 0이어야) + KEEP allowlist `rg`(남아야 정상).
- **게이트 = rename과 같은 commit** (결합 규칙, silent red 금지).
- 방법 = grep token matrix + 검수 + 게이트. AST codemod 단독 부적합(대부분 문자열 계약).

---

## 1 · 불변 원칙 (담금질 산물 — 미래 구현자가 깨기 쉬운 지점)

**① hard-cut = 런타임 절단(cutover), 호환성 0.**
- repo = 살아있는 라우팅 정체성 → **hard-cut, permanent alias/legacy-accept 금지**(AGENTS Hard Rule 1). old provider id를 런타임이 받아주는 일 **없다**.
- **과거 데이터 호환(dual-accept)은 우리 repo 강제사항 아님 [cutover 정렬, GLG].** old provider string을 읽던 reader는 전부 consumer 측(agent-config)이고 그건 담당자 영역(§4). **GLG 철학 = 호환성 0, 이전 세션과 결별이 기본** — 담당자가 cutover(결별)하든 dual-accept하든 *그쪽 정책*. 우리는 과거 호환을 강제도 보장도 안 한다. (이전 NEXT의 "MUST dual-accept" 강제는 cutover 철학과 충돌 → 철회.)
- **실제 recall 끊김 위험은 작다:** garden-id 기반(§1-③) + content-only 임베드(§4)라 provider string과 무관하게 rename-safe. provider-string으로 *필터*하는 reader만 영향받고 그건 담당자 결정 — 우리 책임 아님.
- **이 repo 내부 historical-reader = 공집합**(§2 실증) → 우리 코드엔 dual-accept 대상 자체가 없다.
- **AGENTS 반영 문구 (§6-② GLG 승인 후, 우리 repo AGENTS만):**
  > *This is a cutover, not a compatibility layer. The runtime hard-cuts to `entwurf`: no permanent alias, no legacy provider-id accept, no dual-read of old state. Old install/cache state is migrated once (one-shot cutover) and thereafter the runtime reads only the new name. Whether downstream consumers keep reading immutable historical `pi-shell-acp` transcripts is the consumer's own policy, not a guarantee this repo provides.*

**② 3축 분류 — 직교한다.** 단어 *출처*(capability=RENAME / adapter=KEEP) × *env taxonomy*(§3) × *의미방향*(positive/negative).
- **의미방향이 핵심:** 토큰을 코드가 *positive*(있어야/같아야)로 검사하면 어긋날 때 게이트 **RED=loud**; *negative*(없어야/forbidden)로 검사하면 치환 시 **green인 채 inert=silent**. silent 부류만 위험.
- **실증 de-risk:** silent negative-guard 클래스는 **repo 내부 공집합**(§2 KEEP-old). rename 표면은 압도적 loud-lockstep.

**③ identity = garden-id-keyed → rename-immune (설계가 곧 안전판).** meta-records/mailbox는 `<pi-agent-dir>/meta-{sessions,mailbox}/<gardenId>`(패키지명 무관). 비대칭공존 설계(denote식, DB 없이 패키지명에 의미 안 실음)가 rename으로부터 정체성을 보호. orphan 위험 = ACP reuse 캐시 **1경로**뿐 — **단 디렉토리 mv만으론 부족**(GPT 검수 RED1, 실증).
- `session-store.ts:46` `SESSION_RECORD_PROVIDER="pi-shell-acp"` + `:358` `parseSessionRecord`가 `r.provider !== SESSION_RECORD_PROVIDER`이면 invalid → `:395` `readSessionRecord`가 **레코드 delete**. S1에서 const를 `entwurf`로 바꾸고 디렉토리만 mv하면 기존 body `provider:"pi-shell-acp"`가 `!== "entwurf"`라 **전부 삭제(cold-start, migration 아님)**.
- **→ [GLG 확정 §6-④: (A) body rewrite] §5(c)는 mv + JSON body `provider` 필드 rewrite 둘 다.** resume 연속성(전체 replay 회피)을 살린다 — rewrite 비용 ≈0(필드 1개)이라 drop보다 안전·동등 단순.

---

## 2 · 나열 — 토큰 매트릭스

> **✅ fresh rg 전수 실측 (2026-06-23, repo 내부, 치환 0건):**
> - **RENAME 코드 hits:** `pi-shell-acp` 72파일/396 · `piShellAcp` 11/38 · `PiShellAcp` 2/3 · `PI_SHELL_ACP_` 25/109 · `pi-tools-bridge` 37/136 · `mcp__pi-tools-bridge__` 5/9. 분포: `scripts/` 43(게이트 기대값 집중) · `pi-extensions/lib` 13(런타임) · root 4 · pi/·mcp/·demo/ 소수.
> - **env 고유 이름 실측:** `PI_SHELL_ACP_*` **20** + `PI_ENTWURF_*` **5**(ACP_FOR_CODEX·CHILD_STDERR_LOG·DIR·PREFIX_ROOTS·TARGETS_PATH) + `PI_META_*` **5** + `PI_TOOLS_BRIDGE_*` **3** = **33 RENAME env**. (§3 "27" 정정.) `PI_SHELL_ACP_ALLOW_PI_COMPACTION` = **코드 부재 확정**(§3 doc-drift 일관).
> - **정정 ①** snake `pi_shell_acp` = **코드 0건**. `VERIFY.md:969` reason `pi_shell_acp_session_locked_*`은 코드에 실재 안 함 → **VERIFY drift = §7 PR-polish**(RENAME 대상 아님).
> - **정정 ②** `pi-acp`(svkozak) = 코드 0건 → KEEP 매트릭스에서 의미 없음(주석만).
> - **MOVE-lockstep 전부 실재 확정:** `run.sh:30 PROVIDER_ID` · Symbol `acp-provider.ts:23` · no-auth sentinel 3-site(`models.ts:29`+`check-acp-provider-surface.ts:49`+`run.sh:1314/1319`) · **repo URL = `check-package-source-routing.ts:99/147/163/182` 게이트 기대값**(package.json:12/14/16과 lockstep) · model prefix `pi-shell-acp/claude-{sonnet-4-6,opus-4-8}`(+fixture suffix 다수).
> - **3계층 분류 (docs 16):** live-instruction(결합) = README·VERIFY·AGENTS·CONTRIBUTING·demo/README·.pi/prompts/{make,prepare}-release·SKILL.md · historical(allowlist 잔존) = CHANGELOG·BASELINE·docs/setup-clean-host(openclaw)·ROADMAP · 작업문서 = NEXT*.
> - **결론:** 매트릭스 구조 유효, 수치만 위로 갱신. S1 dry-run 진입 OK.

### RENAME → entwurf (정체성 / 하네스 무관 capability)
| 토큰 (변종) | → |
|---|---|
| `pi-shell-acp` (kebab) | `entwurf` |
| `piShellAcp…` (camel, =`piShellAcpProvider`) | `entwurfProvider` |
| `PiShellAcp` (Pascal) | `Entwurf` |
| `PI_SHELL_ACP_*` (SCREAMING env, **실측 20개**) | §3 taxonomy 참조 |
| `pi_shell_acp` (snake) — **코드 0건**(VERIFY.md drift만, §7) | — |
| `pi-tools-bridge` (MCP dir/서버명) | `entwurf-bridge` |
| `mcp__pi-tools-bridge__*` (tool id/allow) | `mcp__entwurf-bridge__*` |
| `PI_TOOLS_BRIDGE_*` (3) · `PI_ENTWURF_*` · `PI_META_*` | §3 |
| Symbol `"pi-shell-acp.acp-provider.registered"` | `"entwurf.…"` |
| repo URL `github.com/junghan0611/pi-shell-acp` | `…/entwurf` |
| npm `@junghanacs/pi-shell-acp` (package.json `name` *문자열*) | `@junghanacs/entwurf` — **S1 소스 치환**. registry publish는 §6 최후행, 별개 |
| compound `pi-shell-acp-{demo,smoke,hero,no-auth,doomemacs,release-gate}` | `entwurf-…` |
| model prefix `pi-shell-acp/claude-…` | `entwurf/claude-…` |

### KEEP pi (남아야 정상 — adapter / runtime / upstream)
`pi-native` · `pi-session` · `PI_SESSION_ID` · `PI_AGENT_ID` · `pi-coding-agent` · `PI_CODING_AGENT_DIR` · `pi-core`/`pi-mono`/`pi-tui` · `PI_SETTINGS_PATH` · `PI_EMACS_AGENT_SOCKET` · `pi-extensions/` · `pi-context-augment` · `--entwurf-control`(pi-core flag) · `pi-acp`(svkozak 외부).

### MOVE-lockstep (positive 기대값 — 값 + *검사처*를 같은 commit에, 어긋나면 RED=loud)
- `getRegistryRouting`/extension-spec: `entwurf-core.ts:1060` `if (target.provider !== "pi-shell-acp")` + `:1070` `resolveExplicitExtensionSpec("pi-shell-acp")` → 미치환 시 `Unknown provider`로 **즉사**(#29).
- **no-auth sentinel 값 `"pi-shell-acp-no-auth"` = 3-site 하드코딩:** `models.ts:29`(const) + `check-acp-provider-surface.ts:49`(drift assert) + `run.sh:1314/1319`(source-scan).
- `run.sh:30 PROVIDER_ID` · `run.sh:24 PACKAGE_NAME="@junghanacs/pi-shell-acp"` · `Symbol.for("pi-shell-acp.acp-provider.registered")` · 게이트 기대값(`check-package-source-routing`·`-model-lock`·`-entwurf-session-identity`·`-event-mapper`·`-entwurf-resume-args`) · smoke tmpdir/clientInfo/`PI_AGENT_ID`.
- **★ `check-pack-install` 하드코딩 surface (GPT 검수 RED2, 실증 — name rename과 same-commit 필수):** `run.sh:1604` `tgz_name="junghanacs-pi-shell-acp-${version}.tgz"`(npm pack 파일명 규칙) · `:1708` `import('@junghanacs/pi-shell-acp/package.json')` · `:1733` `node_modules/@junghanacs/pi-shell-acp` + `--list-models pi-shell-acp` · `:1738` `grep -q "pi-shell-acp"` loader assert. 미치환 시 tarball/import/loader가 옛 이름 못 찾아 게이트 **RED=loud**.

### KEEP-old (negative — 옛 이름 유지, 치환하면 silent break) — **repo 내부 = 공집합 (실증)**
- compaction 가드는 *코드에 없음*(docs-only, 아래 §3 정정) · anti-spoof는 값-상대(`meta-session.ts:1310/1431` `liveKey !== marker.ownerStartKey`, 리터럴 없음).
- **historical dual-accept가 필요한 reader는 전부 consumer 측(agent-config) → §4 위임 명세.** repo 본체엔 없다.

### historical docs (openclaw 등 — rename 결합 아님, 대부분 보존)
- `plugins/openclaw`는 2026-06-10 제거 완료. repo 내 `openclaw` = README/CHANGELOG/ROADMAP/`docs/setup-clean-host.md`/`run.sh:21` 주석의 **historical 기록**뿐. live lockstep 0. rename과 결합하지 않음(역사 기록은 그대로 두거나 §7 PR-polish에서만 손댐).

---

## 3 · Env taxonomy (`PI_` 접두 제거 ≠ pi 단어 전부 제거)

> **✅ fresh rg 실측(2026-06-23): `PI_SHELL_ACP_*` 20개**(27 아님) + `PI_ENTWURF_*` 5 + `PI_META_*` 5 + `PI_TOOLS_BRIDGE_*` 3 = **33 RENAME env**. S3 직전 재확인 후 의미별 배정·치환. **비자명 선결:** `PI_SHELL_ACP_LIVE_{MODEL,PROVIDER,TARGET}`·`_RGG_TARGET`·`_S1_MODEL` + `PI_ENTWURF_ACP_FOR_CODEX`/`_PREFIX_ROOTS`/`_CHILD_STDERR_LOG`(신규 실측). 자명: `*_CONTEXT`/`*_MODEL`/`*_SENTINEL`/`*_ENGRAVING_PATH`/`*_MEMORY_*`/`*_OVERLAY_*`/`*_RAW_TURN_*`→ACP, `*_DEBUG`→core, `PI_META_*`→meta. ※`PI_SHELL_ACP_ALLOW_PI_COMPACTION`은 **코드 부재**(아래 정정 일관).

- **Core/substrate:** `PI_ENTWURF_TARGETS_PATH`→`ENTWURF_TARGETS_PATH`, `PI_ENTWURF_DIR`→`ENTWURF_DIR`, `PI_SHELL_ACP_V2_RESUME_RESIDENT_SESSION_ID`→`ENTWURF_V2_RESUME_RESIDENT_SESSION_ID`.
- **ACP plugin:** `PI_SHELL_ACP_PROVIDER_MODEL`→`ENTWURF_ACP_PROVIDER_MODEL`, `*_CLAUDE_CONTEXT`/`*_ENGRAVING_PATH`/`*_MEMORY_*`/`*_OVERLAY_*`/`*_RAW_TURN_*`→`ENTWURF_ACP_*`.
- **MCP bridge:** `PI_TOOLS_BRIDGE_*`→`ENTWURF_BRIDGE_*`.
- **Meta bridge:** `PI_META_*`→`ENTWURF_META_*`.
- **Pi adapter target:** `PI_SHELL_ACP_ALLOW_PI_COMPACTION`→**`ENTWURF_ALLOW_PI_COMPACTION` (확정)** — `ALLOW_` 동사-접두가 코드베이스 관용(`_ALLOWED` 선례 0), `PI`=object(압축 대상=pi-side transcript).
- **정정 (compaction 가드는 코드에 없다, grep 실측):** `ALLOW_COMPACTION`/`before_compact`가 `.ts`/`.sh`(tests 포함) 0건 read. `assertLegacyCompactionKnobUnset`는 5개 문서에만 존재(v2서 빠짐) → live trap 아님, **doc-drift=PR-polish**.

---

## 4 · 담당자 위임 핸드오프 명세 (consumer — **우리가 편집하지 않음**)

> ⚠️ **우리는 이 repo 본체만 친다.** 아래는 rename이 깨뜨리는 **인터페이스 계약**을 담당자(agent-config sibling)에게 넘기기 위한 명세일 뿐 — *우리의 편집 대상이 아니다*. live S1 후 GLG가 담당자를 불러 맞춘다. (oracle의 openclaw 배포군 §4-B는 허구라 삭제됨; agent-config가 유일한 실제 functional consumer.)
>
> ⚠️ **(f) physical-path coupling:** agent-config는 `../../repos/gh/pi-shell-acp` 절대/상대 경로와 npm install spec을 들고 있다. → repo+dir+npm rename 후 담당자가 갱신. **우리 commit에 묶지 않는다.**

**담당자에게 넘길 계약 목록 (rename이 바꾸는 표면):**
- **provider identity:** `pi/settings*.json`의 `"piShellAcpProvider"` 키 → `entwurfProvider` · `pi/claude-plugin.json` description · model prefix `pi-shell-acp/…` → `entwurf/…`.
  - **transitional 주의(GPT):** `entwurfProvider` 블록 내부 `mcpServers.pi-tools-bridge`는 S2까지 옛 서버명 유지가 정상(거짓말 아님). provider key와 bridge명은 다른 beat.
- **MCP bridge:** allow `"mcp__pi-tools-bridge__*"` · 서버명 `pi-tools-bridge` → `entwurf-bridge` (S2 beat).
- **env:** `run.sh`의 `PI_SHELL_ACP_*` → `ENTWURF_*` (§3 taxonomy).
- **physical-path:** `../../repos/gh/pi-shell-acp` 경로·`PI_SHELL_ACP_INSTALL_SPEC`(GitHub URL)·`meta-bridge-local` source.path(`…/pi-shell-acp/pi/meta-bridge/.assembled`).
- **historical-reader 정책 = 담당자 결정 (우리는 강제·보장 안 함, cutover 정렬):** agent-config의 history-reader가 옛 provider string을 끊을지(결별), historical reader만 dual-accept할지는 **consumer 담당자 정책**(§1-①). 이 repo는 보장도 강제도 안 한다 — GLG 철학상 호환성 0이 기본이고, recall 끊김은 결별의 비용으로 감수 가능. 담당자에게 "이건 cutover다, 과거 호환은 너희 선택"으로 전달. (oracle가 짚은 `session-recap.py`/`entwurf-peek.py`/`test-discovery.py` = 담당자 영역.)

**영속저장소 = clear ✅ (우리 패스 완료):** andenken/semantic-memory는 filename grammar(`SESSION_ID_RE`)+source-path로 인덱스, provider-string 필터 0 → provider는 content로만 임베드(rename-safe). agenda/botlog도 content-only. **silent-break 위험 없음.** ← 담당자 위임 불필요, 사실로 확정.

---

## 5 · 액션 플랜 (sequenced — 각 stage = 일괄치환 + 게이트 same-commit + `pnpm check` green + commit, bisectable. **전부 이 repo 내부만.**)

- **S0** docs map 고정 ✅
- **S0.5** SSOT 정렬(AGENTS no-rename 제거 · ROADMAP/NEXT hard-cut · env taxonomy) ✅

### ▶ S1 진입 readiness gate — **일격 전 이게 다 닫혀야**
- **(a) fresh `rg` 전수 (repo 내부만)** — 토큰 매트릭스(§2) + 33 RENAME env(§3: PI_SHELL_ACP_* 20 + PI_ENTWURF_* 5 + PI_META_* 5 + PI_TOOLS_BRIDGE_* 3) + negative-guard 패스(`!==`/`!includes`·sentinel·drift assert·docs-only) S1 직전 재실행. *consumer는 grep 안 함 — 담당자 영역.* **✅ 2026-06-23 완료(§2 실측 박스).**
  - **★ "RENAME군 0" 정의 계층화 (GPT Amber + 3R docs 정책):** 검증 기준 = **runtime/code군 0** (`.py`/`.cjs`/`.husky` 포함 content-driven, 게이트·loader·package metadata·state-manager — **S1 본 commit 대상**) · **live-instruction docs = S1 *직후* 별도 `S1-doc` commit으로 분리** (VERIFY/README/AGENTS/CONTRIBUTING의 *실행 가능* `pi-shell-acp/`·`--list-models`·install 명령 — 같은 beat지만 별 commit이라 runtime diff 격리·검증 단순; GPT 택1 중 **옵션2 채택**) · **historical/docs allowlist 잔존 허용** (CHANGELOG·BASELINE·`docs/setup-clean-host.md` openclaw·deprecate = §7 PR-polish/보존). dry-run이 docs 제외한 것 = 이 정책과 정합.
- **(c) cache migration 리허설 [GLG 확정 §6-④: (A) body rewrite, future-lane hygiene]** — `mv ~/.pi/agent/cache/pi-shell-acp/sessions → cache/entwurf/sessions` **+ 각 레코드 JSON `provider` 필드 rewrite**. **알고리즘 엣지 (GPT 2R):** ① lock 잡고 pi/ACP resident 끈 상태 실행(동시 write 방지) · ② old有new無 → `entwurf/sessions.tmp`로 복사 → 각 JSON atomic rewrite(tmpfile+rename) → 전부 validate 후 final `sessions`로 rename, 실패 시 tmp 남기고 fail-loud · ③ old有new有 → fail-loud(자동 merge 금지) · ④ old無new有 → "ok"로 끝내지 말고 scan: `provider:"entwurf"`면 ok, `pi-shell-acp` 잔존 시 partial이라 rewrite+validate · ⑤ **fixture root에서만 리허설(아래 live 금지)** · ⑥ 보존 필드 = `sessionKey`/`acpSessionId`/`cwd`/`modelId`/`bridgeConfigSignature`/`contextMessageSignatures`(provider만 교체). `bridgeConfigSignature`는 provider/package명 미포함이라 rewrite로 stale 안 됨(S2 mcpServersHash 변경은 정상 invalidation).
  - **⚠️ live `~/.pi` 절대 금지 (GLG+GPT 확정) — 에이전트들 작업 중.** dry-run/연습은 **fixture root(임시 dir 복제본)에서만** migration 로직 검증. 실제 `~/.pi/agent/cache`는 *건드리지 않는다* — 현재 live code가 old path(`cache/pi-shell-acp/sessions`)를 쓸 수 있어 미리 옮기면 old/new가 갈라짐. live 적용은 *live S1 직전/직후* resident 끄고 backup 잡은 뒤 one-shot, 그 전엔 scan-only도 금지. ※ persisted read OFF라 *지금* live 검증 불가 — hygiene 차원.
- **(g) npm name 게이트 무해 확인 (문구 정밀화)** — package.json `name`→`@junghanacs/entwurf` + §2 `check-pack-install` 하드코딩 surface를 same-commit 치환하면, `check-pack`(`npm pack --dry-run`)·`check-pack-install`이 **새 `@junghanacs/entwurf` registry publish에 의존하지 않고 green**임을 dry-run worktree서 실증. ※ "registry 미접촉"은 정확히는 *우리 패키지 publish 불필요*라는 뜻 — peer deps(`@earendil-works/…`·typebox)는 캐시 없으면 npm resolve가 일어날 수 있음(정상).
- **AGENTS cutover 문구** — §1-① **cutover 문구**(호환성 아니라 절단)를 **우리 repo AGENTS에** (§6-② GLG 승인). agent-config AGENTS는 담당자.
- **(d) GLG 비준 + (f) repo/dir rename 타이밍(§6-③) 확정 = 트리거.** *npm publish는 트리거 아님 — rename 완료 후 최후행(§6-①).*

### ▶ S1 — package/repo/provider identity (**원자, 쪼개지 말 것**)
중간상태 "package=entwurf인데 provider=pi-shell-acp" 금지 → 통째로:
- 패키지명(`@junghanacs/entwurf`) + provider id(`acp-provider.ts` baseUrl/api) + model prefix + `piShellAcpProvider`→`entwurfProvider` + `PiShellAcp*`/`piShellAcp*`/`pi_shell_acp` + Symbol + repo URL.
- **MOVE-lockstep(§2) 동시 이동** — getRegistryRouting `!==` + no-auth sentinel 3-site + PROVIDER_ID(shell).
- **게이트 same-commit:** `check-package-source-routing`·`check-model-lock`·`check-entwurf-session-identity`·`check-auth-boundary` + **`check-pack-install`(GPT 2R — `pnpm check` 밖이라 명시 호출 필수; package name rename 실제 회귀 gate, §2 하드코딩 surface 검증).**
- **★ 파일 선택 = content-driven** (`git grep -Il -e 'pi-shell-acp' …`, 확장자 무관 — `.py`/`.cjs`/`.husky` 포함; whitelist 금지, dry-run blind spot 재발 방지) → perl 치환 → **`biome check --write` 1회**(format reflow 해소) → 게이트. live S1 레시피 = 이 4-step.
- **bridge명은 건드리지 않음**(S2). → `pnpm check` EXIT0 + RENAME군 0/KEEP 잔존 양방향.
- **먼저 버린 worktree에서 dry-run**(physical rename 없이 가능 — dir명은 fs path지 alias 아님), green 확인 후 live.
  - **★ dry-run 가드 (GPT 확정):** ① **S1 범위만** 치환 — `pi-tools-bridge`(S2)·`PI_*` env namespace(S3)는 **건드리지 말 것**(섞으면 검증 의미 흐려짐). ② live `~/.pi` 금지(§5-c). ③ **산출물 필수 형태:** worktree path · replacement script/명령 · `git diff --stat` · residual rg 요약(runtime/code RENAME **0** / KEEP pi 잔존 / historical·docs allowlist 잔존) · `pnpm check` · `pnpm run check-pack-install` · 실패 시 첫 failure log.
- *consumer(agent-config)는 이 commit에 없다 — 담당자가 별도 beat로 맞춘다.*

#### ▶▶ live S1 실행 시퀀스 (GPT 4R 확정, dry-run green 후):
1. 본 트리 clean 확인 + 현재 HEAD 기록. 2. content-driven 선택으로 **S1만** 치환(S2 bridge·S3 env 보존). 3. `biome check --write`. 4. residual `git grep`(확장자 무관): S1 0 / S2·S3·KEEP 잔존. 5. 게이트 = **본 트리 전체 `pnpm check`** + `check-pack-install`(필수, pnpm check 밖) + `smoke-meta-install-state` + `smoke-meta-keyset-guard` + 핵심 게이트 재확인. 6. **commit skill 경유 S1 runtime/package/state identity commit.** 7. **직후 S1-doc commit**(live-instruction docs만, runtime diff와 분리). 8. **user state cutover = commit과 별개 운영 단계** — meta-bridge state(§6-5 A) + ACP cache(§6-④ A) one-shot 이장은 *운영 절차*(제품 코드 밖, fixture 검증·backup 후, 실행 후 버림). live `~/.pi`/`~/.claude`는 resident/Claude Code 상태 확인 후. **push/repo-rename/npm = GLG.**
- **★ S1 commit GO ≠ "사용상 무문제" GO (분리):** S1/S1-doc commit이 green이어도 *usage-ok*는 아니다. usage-ok 선언 = ⑥ meta-bridge state cutover + ACP cache(우선순위 낮음, persisted OFF) + **no-token doctor/loader 확인**까지 끝난 뒤. 그 전엔 "코드 cutover 완료"지 "사용 가능"이 아니다.
- **★ quiesce 운영 가드 (GLG — 누가 언제 퇴근하나):** 단계별 위험이 다르다. **(1) S1 code + S1-doc commit = 에이전트 살아있는 채로 가능**(git 파일 작업뿐, live 세션 무관 — 실행 세션만 작업). **(2) repo/dir physical rename = 모든 세션의 cwd를 stale로 깸 → 진짜 quiesce 지점.** 이 순간 *실행 세션(이 ACP Claude) 자신도 cwd가 `pi-shell-acp`라 함께 깨지므로* "너희 빼고"가 아니라 **나 포함 전 세션 퇴근 → 무인 상태에서 GLG가 state 이장(backup)+dir rename+npm 수행**. (meta-bridge state는 doctor/uninstall 동시 실행만 피하면 backup+atomic으로 안전; ACP cache는 persisted OFF라 거의 무관.) **(3) 재기동 후 no-token doctor/loader로 usage-ok.** 즉 물리 단계는 무인.

### ▶ S2 — MCP bridge ✅ 완료 (`e795a08`, 2026-06-23)
`mcp/pi-tools-bridge`→`mcp/entwurf-bridge`(dir+서버명) + tool id `mcp__pi-tools-bridge__*`→`mcp__entwurf-bridge__*` 전수 + install/remove/prune settings + 게이트 rename `check-pi-tools-bridge-boot`→`check-entwurf-bridge-boot`. (consumer mcpServers·노트 C 경로 = 담당자.)
- **실행:** 39 files 167/158, dir 3 + gate 1 rename. content-driven `git grep -Il`(39f) → perl kebab `s/pi-tools-bridge/entwurf-bridge/g` + perl snake `s/pi_tools_bridge/entwurf_bridge/g`(함수명 5곳, kebab가 놓친 것) → dir/gate git mv → biome(reflow 0).
- **cutover prune (GLG 교리 — stale 설정으로 애매하게 동작 0):** installer one-shot으로 옛 `pi-tools-bridge` 엔트리 제거 — run.sh `LEGACY_BUNDLED` reason-map + remove 튜플 + `meta-bridge-install.sh` USER-scope `claude mcp remove pi-tools-bridge -s user`. 남은 `pi-tools-bridge` literal 5줄 = **전부 one-shot migration prune 대상**(runtime alias 0). residual whitelist 이 5줄만.
- **S3 env `PI_TOOLS_BRIDGE_`(SCREAMING) 의도 보존** — case-sensitivity로 자동 분리.
- **게이트 GREEN:** tsc·lint·check-entwurf-bridge-boot 14·check-entwurf-v2-surface 42·check-acp-config·check-acp-session-reuse·smoke-meta-keyset-guard·smoke-meta-install-state + pre-commit check-pack(182 files). GPT(`20260623T104220-35aa15`) 2R Amber→GO(수동 prune smoke 포함).

### ▶ S3 — env namespace ✅ 완료 (`148a8f8` + 게이트 `64cb6b5`, 2026-06-23)
taxonomy(§3)대로 `PI_SHELL_ACP_*` 20개 의미별 분해 + `PI_TOOLS_BRIDGE_*`(3)→`ENTWURF_BRIDGE_*` + `PI_ENTWURF_*`(5)→`ENTWURF_*` + `PI_META_*`(5)→`ENTWURF_META_*` + env명 assert 게이트. **영구 alias 금지**, installer one-shot migration만.
- **실행:** 46 files 229/229. content-driven `git grep -Il`(4 env prefix) → **per-name `\b` 앵커 perl**(blind prefix 금지 — `PROVIDER` vs `PROVIDER_MODEL` 충돌 방지; uniform 3군은 prefix) → biome(reflow 0).
- **taxonomy 확정(GLG flat):** `ENTWURF_ACP_`=pi 닿는 백엔드 plugin config 11(PROVIDER_MODEL·PROVIDER_TIMEOUT_MS·CLAUDE_CONTEXT·ENGRAVING_PATH·MEMORY_*·OVERLAY_*·RAW_TURN_*·NO_AUTH_SENTINEL const) · flat `ENTWURF_` 9(V2_RESUME·DEBUG·LIVE_{T,P,M}·RGG_TARGET·S1_MODEL·SPAWN_RESUME·PROVIDER const). PI_ENTWURF_ACP_FOR_CODEX→ENTWURF_ACP_FOR_CODEX.
- **const 2개**(NO_AUTH_SENTINEL export/import, PROVIDER) cross-file 치환 — tsc root+mcp+scripts 3타겟 EXIT0로 정합 확인. KEEP pi env(PI_SESSION_ID 등) 불변.
- **cutover prune 0(GPT §6-A 확인):** env는 process.env/내부값이라 runtime prune 불필요. consumer 영속 env(MCP entry `-e`)는 **S3 후 install-meta-bridge/state apply가 `ENTWURF_BRIDGE_*`로 재작성** → stale 정리. 단 이건 usage-ok 운영절차(코드 아님). 사용자 shell export·`*_ENV_FILE`도 새 이름 전환 필요.
- **게이트:** `check-env-namespace` 신설(`64cb6b5`) — source-scan으로 옛 prefix 잔존 0 잠금, `[_]` char-class로 self-match 회피, pnpm check 등록, negative-test(가짜 토큰 심으면 FAIL) 검증. + 기존 게이트 전부 GREEN(provider-surface·model-lock 18·acp-config·carrier-augment·package-source-routing·session-identity·v2-surface 42·meta smokes·check-pack 182). GPT GO.

### ▶ S4 deferred (구조개편, 텍스트치환 아님)
`pi/entwurf-targets.json` 경로 재검토 · `pi-extensions/`→`adapters/pi/extensions/` · `pi/meta-bridge/.assembled` 산출물 경로.

---

## 6 · 🔴 GLG 결정 & 시퀀스 — **GLG 확정 (2026-06-23)**

**전체 시퀀스 (rename 먼저, publish 최후):**
`코드 rename S1→S2→S3` (우리, commit) **→ 게이트 전부 green + 사용상 무문제 확인 →** `repo+dir rename` (GLG 오퍼) **→** `담당자 consumer 갱신` **→** `npm publish` (GLG, **맨 마지막**).

**일격 트리거 결정 (S1 진입용):**
2. **AGENTS cutover 문구 적용 = 우리 repo만.** §1-① **cutover 문구**(호환성 아니라 절단; alias·legacy-accept·dual-read 0; state는 one-shot 이장)를 `entwurf` repo AGENTS에만. agent-config AGENTS는 담당자 몫(우리는 안 건드림). **[GLG 확정]**
3. **repo + dir rename 타이밍 = 코드 rename 전부 통과 + 사용상 무문제 후.** S1~S3 commit이 다 들어가고 게이트 green + 실사용 검증 끝난 뒤에야 GitHub repo+로컬 dir rename(GLG 오퍼). rename은 코드 작업의 *후속 이벤트*지 동시 아님. 이후 담당자가 consumer physical-path 갱신.
   - **"사용상 무문제" 검증 기준 (GPT 2R 제안):** ① `pnpm check` + `pnpm run check-pack-install`(후자는 pnpm check 밖, package rename 실제 gate) · ② no-token loader `pi -e "$PWD" --list-models entwurf` 통과 · ③ **path rehearsal** — 복제본을 실제 `…/entwurf` 경로명에 두고 `pnpm check`(+check-pack-install)로 source가 old path에 안 기댐 확인 · ④ live ACP `LIVE=1 ./run.sh smoke-acp-provider-live`(1턴)+`smoke-acp-session-reuse-live`(2턴 reuse), 최종 `LIVE=1 ./run.sh release-gate <scratch>` MUST PASS/SKIP=0. repo rename 직후엔 no-token loader+`pnpm check` 1회 재확인.
   - cwd 축(§6-④): repo/dir rename으로 record `cwd` prefix 변경 = 별도 cold-start 축, future lane에서 cwd one-shot rewrite 또는 cold-start 허용. **[GLG 확정]**
4. **ACP reuse 캐시 = (A) body `provider` rewrite (살린다).** `decideReusePath:307`이 캐시로 resume(replay 회피)을 고름 → drop하면 new로 떨어져 맥락 끊김. rewrite는 JSON `provider` 1필드 교체(비용≈0)라 **빨라지고+살리는 비용 단순 → (A)**. **[GLG 확정]**
   - **⚠️ framing 정밀화 (GPT 2R, 실증):** `readSessionRecord` production 호출 **0건** · `backend.ts:591` "persisted resume/load is OFF" — 현재 live reuse는 **in-memory candidate** 기반이라 persisted record는 *지금 안 읽힘*. 따라서 (A) rewrite는 *지금 live resume을 살리는 게 아니라* **future-lane(persisted ON) 위한 record hygiene**. 그래도 비용≈0이라 S1에 넣어 깨끗이 가져간다(미래에 ON 시 즉시 resume). **[GLG 확정 — 무조건 포함]:** persisted resume을 *켜는 방향으로 개선*할 의도이므로(side-effect 없음 확인 전제) cache (A)는 그 선결조건. drop 옵션 폐기.
   - **★ cwd 축 (GPT 2R 새 발견 — 별개):** compat은 `session-store.ts:254` `candidate.cwd === params.cwd`도 봄. **dir rename으로 record `cwd` prefix(`…/pi-shell-acp`→`…/entwurf`)가 바뀌면 또 다른 incompat=cold-start.** persisted OFF라 지금 무영향이나, future lane에선 repo/dir rename 이벤트(§6-③) 때 **cwd prefix one-shot rewrite 별도** 또는 그 순간 cold-start 허용을 명시해야. provider rewrite(S1)와 다른 축.

5. **meta-bridge install-state = (A) one-shot cutover [GLG 비준 — 의미 = 호환성 아니라 이장(移葬)].** `~/.claude/pi-shell-acp.install-state.json` → `entwurf.install-state.json`. **ACP cache(§6-④)보다 중요** — ACP는 persisted read OFF(future hygiene)지만 meta-bridge state는 **doctor/uninstall/preflight가 실제 읽는 state authority**. 못 찾으면 uninstall fail 또는 새 install이 managed state를 "original"로 오기록해 원복 의미 상실.
   - **★ migration 도구를 제품 코드에 넣지 않는다 (GPT 4R 정정 — residual 0 보존):** repo에 `migrate-…` subcommand를 두면 `pi-shell-acp.install-state.json` 문자열이 코드에 *영구히* 남아 **S1 residual 0이 흐려진다**(런타임이 old 이름을 계속 품는 꼴 = cutover 위반). → **one-shot은 운영 절차로 수행** — NEXT/임시 artifact에 명령을 두고 **실행 후 버린다**(실행 로그만 남김). **S1 runtime code엔 old 이름 0.**
   - **알고리즘 (cutover, dual-read 없음):** old有new無→backup→validate(schema/owner old)→owner `entwurf meta-bridge` rewrite(repo/assembled path 보존, path rewrite는 repo/dir rename 이벤트 때 별도)→atomic write new→old는 `.bak`/archive(**런타임 입력 아님**) · old有new有→**fail-loud**(자동 merge 금지) · old無new有→validate ok · old無new無→ok. live는 §5-c처럼 fixture 먼저·backup 후. *대안 documented break는 GLG 택1.*

**후행 결정 (rename 전부 끝난 뒤 — S1 트리거 아님):**
1. **npm publish = 최후행 (나중).** `@junghanacs/pi-shell-acp`→`@junghanacs/entwurf`. npm in-place rename 미지원 → 새 이름 publish + 옛것 deprecate 마킹. *설치자 동기화 cut-choreography 없음.* package.json `name` 문자열 치환은 S1에 이미 포함; 여기서 정하는 건 *registry 행위 + deprecate 문구*뿐, 시점은 "모든 rename·검증 완료 후"로 고정. **[GLG 확정 — 나중]**

---

## 7 · PR-polish (rename과 별개, S1~S3 중/후)

README/VERIFY/CHANGELOG stale(backend overclaim·packaged docs·persisted continuity·config passthrough · **compaction 가드 docs-only — 5개 문서가 없는 가드 주장** · openclaw deprecate 기록 정합) + ROADMAP "legacy verbs maintained" historical. `AGENTS.md`는 S0.5서 정책 정렬했고 이후 잔여 문자열만 결합 갱신.

## 8 · 넘으면 안 되는 선

- **치환 시작 = §5 readiness gate 전부 닫힘 + GLG 비준 후.** 지금까지 0건 유지.
- **다른 repo는 직접 편집 금지** — consumer는 담당자 위임. 우리는 이 repo 본체에만 집중.
- commit = commit skill, **push / tag / publish / repo-rename = GLG**. `--no-verify` 금지, `core.hooksPath`/`.git-hooks-mode` 무단 변경 금지.
- operator 세트(GPT=pi-native host / ACP Claude=socket-citizen / Claude Code=meta mailbox-citizen) = ROADMAP SSOT, rename 중 불변.

## 9 · 맥락 / 선행

- 분기점 `a893318`(CP1 lock) 원격 봉인, stamp `<2026-06-22 19:18>`.
- 이 NEXT = oracle 산출물(`f573d06`)의 **2026-06-23 framing 정정본** — openclaw 허구 삭제 · consumer 위임 격하 · npm 단순화 · 범위를 repo 본체로 수축. **GPT 검수 대기.**
- 형제 교차검수 이력: GPT `20260622T191739-19b503`(gpt-5.5, oracle framing 기준 GO) + 비봇 GO.
- **GPT 검수 (`20260623T075242-7f3777`, 2026-06-23, 2라운드):**
  - **1R 조건부 GO** → RED2(ACP cache cold-start §1-③·§5-c·§6-④ / `check-pack-install` 하드코딩 §2·§5) + Amber(RENAME-0 3계층화 §5-a) 반영.
  - **2R = GO for S1 dry-run 진입** (큰 RED 없음). 새 발견 3건 실증 반영: ① `readSessionRecord` production 0건·`backend.ts:591` persisted OFF → cache migration은 *future-lane hygiene*(지금 live 무영향) ② rewrite 알고리즘 엣지(lock·temp atomic·partial scan §5-c) ③ cwd가 별도 compat 축(`session-store.ts:254`) → dir rename 시 cwd cold-start(§6-③·④). Amber 문구 2: S1 게이트에 `check-pack-install` 명시 + entry point 정밀화 = 반영.
  - **3R = 정확한 RED** — content-driven blind spot(.py/.cjs/.husky 4파일). 보정 후 재-dry-run GREEN.
  - **4R = live S1 GO (조건부)** — 코드 diff GO. 조건 = **§6-5 meta-bridge state를 (A) one-shot으로 잠그고 live S1 후 usage-ok 선언 전 운영계획 수행/기록.** live S1 시퀀스 8단계(§5 S1) 확정.
- **🔪 cutover 재정렬 (2026-06-23, GLG+GPT):** 이 작업 = 호환성 아니라 **절단/결별**. 이전 세션·이름과 cutover, 런타임 호환성 0. §1-① "MUST dual-accept" 강제 **철회**(과거 호환은 담당자 정책) · §6-5 migration 도구를 **제품 코드에 안 넣음**(old 이름 코드 잔존 = cutover 위반, 운영 절차로 실행 후 버림) · state = one-shot **이장** · S1 commit GO ≠ usage-ok GO 분리(§5). 정체성 전환이라 약하게 조이면 정체성이 샌다.
- **✅ S1 dry-run GREEN (2026-06-23, worktree `/tmp/entwurf-s1-dryrun` detached `28a4588`):**
  - **★ 파일 선택 = content-driven 필수 (GPT 3R RED, 실증):** 1차 시도가 확장자 whitelist(`.ts/.sh/.json/.toml/.mjs/.js`)라 **`.py`/`.cjs`/`.husky`를 빠뜨림** — `scripts/meta-bridge-state.py`(9, OWNER·state file명·managed-key SSOT) · `check-keyset-overlap.py`(3) · `postinstall-chmod.cjs`(3) · `.husky/pre-commit`(2) 잔존했었음. **교정 레시피 = `git grep -Il -e 'pi-shell-acp' -e 'piShellAcp' -e 'PiShellAcp' -- ':!*.md' ':!NEXT*' ':!docs/**' ':!*.org'` 로 선택**(확장자 무관, docs 제외) → perl 치환 → `biome --write` → residual rg(역시 `git grep`).
  - **보정 후 GREEN:** diffstat **77 files 458/469** · residual S1 RENAME **0** · S2 `pi-tools-bridge`/S3 `PI_SHELL_ACP_` 보존. **게이트:** typecheck EXIT0 · lint 0err(12 pre-existing warn) · check-pack-install EXIT0(`junghanacs-entwurf-0.12.0.tgz`→pi loader `entwurf` 등록; package version bump 후 현재 기준) · check-{package-source-routing,model-lock,entwurf-session-identity,auth-boundary} EXIT0 · **smoke-meta-install-state·smoke-meta-keyset-guard EXIT0**(meta-bridge .py 커버). **발견:** 치환→biome reflow 2건→`--write`. *전체 `pnpm check` 체인은 socket/`~/.pi` substrate 의존이라 worktree 부적합 — rename 회귀 핵심만 선별.*
- 추가 구현 = rename 끝난 *다음 세션* 본질(ROADMAP deferred: persisted resume/load 1b-2c · Claude↔Claude live transport 등). **이 작업이 끝나야 entwurf 기능 정리 → 릴리즈.**

---

## 10 · rename 이후 본격 방향 — 하네스 무관 / ACP 옵션화 / doctor (GLG, 2026-06-23)

> 왜 이름을 바꾸는가의 본질. `pi-shell-acp`는 **pi 쓰는 파워유저용**이라 설치가 어려워도 "알아서들 하겠지"였다. `entwurf`는 **아예 다른 대상** — pi/acp를 *안 쓰는* 사용자가 많을 것(Claude Code · Codex · agy만 연결). codex/agy는 아직 여기 미작업이나 **검증은 끝났고 금방 붙는다.**

- **설치는 쉬워야 한다. ACP는 옵션 — 거의 plugin으로 본다.** ACP 지원은 overlay 구성 등 일반 케이스 대비 복잡하다. **강제 금지.**
- **설치 = `entwurf` 설치.** 나머지(Claude Code/Codex/agy)는 **설치돼 있으면 설정해준다.**
- **doctor = 하네스 감지 → 있으면 entwurf 설정**(YOLO·도구세트 축소), **없으면 담아준다(plug-in).**
- 이 방향은 **rename 완료 후 본격 착수.** S4(구조개편 §5)·릴리즈 정리와 같은 lane.

---

## 11 · 재배치 재설치 재현성 갭 — installer fail-loud 강화 (2026-06-23, GLG "확실하게 글로벌 + 재현 불가능하면 수정 사항")

> GitHub remote rename(`junghan0611/entwurf`) 후 새 위치(`~/repos/gh/entwurf/`)에서 재설치한 첫 실사례.
> **NEXT.md(main) 2갈래 runbook(`install .` + `install-meta-bridge`)만으론 한 방에 GREEN이 안 됐다.** §10
> "설치는 쉬워야 한다 / doctor 하네스 감지"의 첫 실증 — 재설치가 *결정적으로 재현*되지 않으면 그게 수정 대상.

**증상 체인 (한 방에 안 된 이유):**
- **`pnpm install` 누락이 핵심.** 디렉토리를 move/clone 하면 pnpm symlink-store(`node_modules/@earendil-works/pi-ai` 등)가
  옛 경로를 가리켜 깨진다(또는 clone 직후엔 아예 없음). → `check-entwurf-v2-surface`가
  `ERR_MODULE_NOT_FOUND: @earendil-works/pi-ai`로 터지고, **글로벌 `entwurf-bridge` MCP가 `✘ Failed to connect`**
  (USER-scope 수신 도구가 죽음 = "확실하게 글로벌" 실패) → `doctor-meta-bridge` 두 줄 FAIL.
- **어떤 installer 단계도 `pnpm install`을 안 한다.** `./run.sh install .` 은 settings 배선만, `install-meta-bridge` 는 Claude
  Code 배선만. `./run.sh setup .` 이 `pnpm install`+`install .` 을 함께 하지만 NEXT runbook은 `install`만 적었고,
  `install-meta-bridge` 는 setup에도 없는 별개 beat다.

**이번에 수동 복구한 순서 (= 재현 절차의 실제 모습):**
1. `./run.sh setup:links --force` — stale `entwurf-targets` 심링크(옛 `…/pi-shell-acp/pi/entwurf-targets.json`)를
   canonical로 relink. ※ 이건 `install .` 이 **fail-loud로 멈추며 정확히 안내**했다 = 가드 작동(재현 OK, 갭 아님).
2. `pnpm install` — node_modules 복구(캐시 hit 1.8s). **← 진짜 갭. 절차에도 코드에도 없었다.**
3. `./run.sh install .` + `./run.sh install-meta-bridge` — 2갈래 배선.
4. dangling `pi-tools-bridge` 제거: `~/.mcp.json`(홈→전 프로젝트 상속, 삭제된 `pi-shell-acp` 경로) 비움.
   `~/.claude/settings.local.json` 의 `disabledMcpjsonServers["pi-tools-bridge"]` 는 **agent-config repo 심링크(별도 lane)**
   라 손대지 않음 — `.mcp.json` 비운 뒤엔 막을 대상 없는 무해한 참조.

**복구 후 GREEN (= "확실하게 글로벌" 달성):** `doctor-meta-bridge` PASS · `check-entwurf-v2-surface` 42/42 ·
`entwurf-bridge: ✔ Connected` (USER scope) · upstream `entwurf-rename → origin/entwurf-rename` 재연결(rename 시 끊겨 있었음).

**→ 수정 완료 (2026-06-23, GLG 비준 + GPT 검수 GO):**
- ✅ **`run.sh install` preflight (커밋 `0e40c43`)** — `install_local_package` 진입부에서 runtime hard dep 8개
  (deps 5 + peerDep pi-* 3)를 `fs.accessSync(node_modules/PKG/package.json)`로 검사(pnpm symlink follow + exports-map
  면역). 부재/깨짐 시 settings write 전 fail-loud + "pnpm install" 안내. `check-install-preflight` 게이트(positive +
  missing + dangling, settings 미작성·wrong-reason 검증)를 pnpm check에 same-commit 결합(§8). ※ probe는 module import가
  아닌 manifest access — sdk root / pi-ai package.json subpath가 각각 exports로 막혀 import-resolve가 불가. 더 깊은
  dist/transitive 손상은 doctor/check-pi-runtime-version 몫(GPT).
- ✅ **setup 단일 SSOT (같은 커밋)** — `setup_all`이 pnpm install→install→meta-bridge(claude 감지 시)→v2 smoke 단일
  진입점. pi-only host는 meta-bridge를 깨끗이 skip(§10 "있으면 설정, 없으면 담아준다"). **확실한 명령 하나 = `./run.sh setup .`**.
- ✅ **rename-tail release-gate green (커밋 `bc63611`)** — repo가 `entwurf`라 cwd slug "entwurf"가 garden-guard
  substring grep을 false-positive 시켜 release-gate MUST FAIL=3이던 것 해결. `smoke-resident-garden-guard.sh` 2곳을
  tag-position regex(`__([a-z0-9-]+_)*entwurf(_[a-z0-9-]+)*"`)로 정밀화 — **production `buildGardenSessionName` 무변경**
  (title slug entwurf는 합법, resume marker는 tag 위치만; parseSessionName 불변식). `smoke-acp-rgg-live`는 같은 스크립트
  호출이라 동시 해결. + `smoke-acp-session-reuse-live.ts`가 emit 트리에 빠뜨린 `engraving.md`를 copyFileSync.
  **LIVE release-gate: MUST PASS=17 FAIL=0 SKIP=0** (was 14/3, 2026-06-16 baseline 회복). BEHAVIOR T3
  (selfEnvelopeSessionIds:[])는 release-gate1에도 있던 pre-existing advisory(model-in-loop 자율 entwurf_self), non-blocker.
- polish 후보(GPT, 비블로킹): smoke가 Node `parseSessionName`를 직접 호출하면 완전 drift-zero(현재 regex unit 5/5로 충분).
- **남은 것: push / tag / npm = GLG.** 두 커밋(`0e40c43` + `bc63611`) ahead 2 on origin/entwurf-rename.
