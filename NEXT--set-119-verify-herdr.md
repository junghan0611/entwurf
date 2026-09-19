# NEXT--set-119-verify-herdr — 검증면 정리 세트 (V) + Herdr 첫 사용자 경로 (H1)

> 브랜치 레인 핸드오프. 계약 정본은 GitHub #119(세트 첫 그림 + V 장부)와 #118(H1 장부)이며,
> 이 파일은 "지금 어디"만 적는다. 머지 전에 이 파일은 삭제한다.

# RAIL — 한 브랜치, 네 구간, 동결 창 1회

- [x] **V1. 인벤토리, 코드 0** — `scripts/inventory-verification-surface.ts` 재실행, 6-class 재분류, 표 한 장을 #119 스레드에.
- [x] **V2. 새 코드의 문** (80089a1→1991090, 정지 사진 2장 exit 1 영수증 #119) — terra 검수 진행 중 — include(`pi-extensions/**/*.test.ts`, `plugins/herdr/**/*.test.mjs`) + `check:vitest`에 glob 발견형 심 `check-tests-beside-behavior` + 타입 fence 결정 + 출하 제외(`check-pack`이 잰다) + AGENTS 한 줄 + **정지 사진 2장**(빨간 `.test.ts`·`.test.mjs`가 공개 `pnpm check`를 red로).
- [ ] **H1. Herdr 첫 사용자 경로 (#118)** — `smoke-herdr-raw-install-live`(clean node:24 컨테이너, 공개 remote, `--ref`, `--yes`, npm identity+sha512, `{pi}`→`{pi,claude-code}`) → `entwurf pi` 런처 + `check-pi-launch` + `--entwurf-control` 리터럴 대조 → README 8단계 + 플러그인 0.3.0(lock은 0.23.0 유지, 핀은 0.23.1 발행 뒤).
- [ ] **V3. v2 척추만 이동** — decider/send/mailbox/runner/peers/facts 부근 8~12파일, `#62` 방식(심→동등성→심 제거), 파일마다 이주표 + QK/mutant(signatureSource·gate argv) 동반 이동. mutant gate를 V2 glob 심에 걸지 말 것.
- [ ] **동결 창** — 후보 SHA 고정 → `check-gate-qualification` 1회 → `check:full` 1회 → 영수증 #119에 → main 머지 → (이 이슈 밖) 0.23.1 컷 → lock 0.23.1 + 0.3.0 후속 커밋.

# NOW — A1 착지 → H1 홉 2·3 연속 진행 (2026-09-19 15:2x)

- **좌표:** main `37b81e7` = v0.23.0 + 2. 브랜치 HEAD `1991090`(V2 끝). `pnpm check` 50→52s.
- **닫힘:** H1 홉 1 `smoke-herdr-raw-install-live` **PASS** (`f6d05ed`, #118 코멘트) — herdr 0.9.1 서버 없는 컨테이너에서 `plugin install --yes` exit 0, resolved `37b81e7`, npm 0.23.0 identity, `["pi"]`→`["pi","claude-code"]`. 발견: 하네스를 한 번 실행해야 `herdr integration install`이 받는다(README 단계 추가, 홉 3). V2 검수(terra, #119 코멘트): Blocker 0 · Defect 2 · Observation 2.
- **닫힘:** A1 `a1eeb81` — 심이 glob을 직접 전개, 빈 전개는 return(`--passWithNoTests` 제거), 정지 사진 3장(`selected 2`, `test/` 0), AGENTS.md:102 fence 문장 교체.
- **진행 중:** Opus = H1 홉 2(`entwurf pi` + `check-pi-launch` + `--entwurf-control` 리터럴 대조 + 뮤턴트) → 홉 3(README 9단계·0.3.0·smoke 재실행) 연속, 홉 3 끝에 보고.
- **동결 창 할 일(코디네이터):** NEXT 커밋 3개(`5062147`·`1d6532a`·`637befc`)의 Co-Authored-By 트레일러 제거 — NEXT-- 파일은 머지 전 삭제라 squash로 정리. 이후 커밋은 트레일러 없음(GLG 지침 09-19).
- **다음 한 수:** 홉 3 보고 수령 → H1 검수(다른 학교, `f6d05ed`+홉 2·3 커밋 열거 set) → amendment → V3(첫 커밋 = 인벤토리 분모에 행동 옆 테스트 축 추가, terra Observation 2)(mutant 0 순수 8개부터: decider·runner·socket-discovery·matrix·facts·send-fallback·release·resume-args; v2-production/v2-contract는 cross-lane이라 첫 슬라이스 제외).
- **게이트 — 이것만:** 커밋마다 `pnpm check`(명시 실행, elapsed 기록). 영향 focused `./run.sh check-<x>`. subject·signatureSource·gate argv·QK·inventory 중 하나라도 건드리면 `./run.sh check-gate-manifests`. MCP 소스면 `build-bridge` + `check-bridge-delivery`. H1 자기 LIVE `LIVE=1 ./run.sh smoke-herdr-raw-install-live`.
- **게이트 — 절대 안 됨(inner loop):** `pnpm run check:full` · `./run.sh check-gate-qualification` · `release-gate` · `entwurf-release` · 무관한 MUST LIVE. **한 시간짜리를 구간마다 돌리지 않는다.** 동결 창의 1회는 코디네이터 몫.
- **운영 경로 변경 창:** `run.sh`, `mcp/**`, `pi-extensions/**`(test 아닌 것), hook/launch/install 스크립트, `plugins/herdr/lib/**`는 파일을 쓰는 순간 GLG의 pi/Claude/MCP에 노출된다(이 체크아웃 = 운영자 런타임). 들어가기 전 코디네이터에 알리고, 운영자 호출 재개 전 파일군별 focused를 끝낸다.
- **형제 여럿, 실행자 1명:** 게이트 실행자는 한 시점에 1명. 측정 창에는 구현자가 파일/index/NEXT 수정을 멈춘다. qualification 중에는 전원 정지.
- **Do not:** 워크트리 분할 · 둘째 구현 형제 · `entwurf setup`/`install` 재실행 · `#62` Phase 4 · spawn/LIVE 66개 대량 이주 · H2 기능 · `herdr-checkout` fallback · `insteadOf` · 초록 사진을 정지 사진으로 · 실패 측정을 완료로.
- **역할:** 코디네이터 Fable(Claude Code, garden `20260919T122011-818171`) · 구현 Opus 1 · 검수 glm/grok/terra 구간마다 · 자문 gpt-6-astra 2회 완료(#119 코멘트).

# RECENT

- 2026-09-19 #119 본문 v6·#118 본문 v3(gpt-6 자문 2회 + V1 수치). 브랜치 생성. V1 표(Opus). V2 5커밋(Opus): 인벤토리 수리·발견의 문·fence(scripts)·출하 제외·AGENTS 한 줄.

# DURABLE LINKS

- #119 https://github.com/junghan0611/entwurf/issues/119 · #118 https://github.com/junghan0611/entwurf/issues/118
- #62 클로저(파일럿·심·6-class·serial vitest 설계) · VERIFY.md §Scheduling · AGENTS.md "Verification"
