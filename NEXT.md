# NEXT — fresh-cut 뺄셈 (cut/fresh-generation) push됨 — 새 세션 팀의 재검수 대기

> NEXT는 부트 섹터다. 닫힌 역사는 CHANGELOG/git/이슈에, 장기 방향은 ROADMAP/이슈에 둔다.
> (#50 hard-cut merge까지의 옛 원장은 이 파일의 git history와 #50에 보존되어 있다.)

## NOW

- **[2026-07-25] fresh-cut 뺄셈 — 구현·3자 검수 완료, merge 후보. GLG의 commit/merge 결정만 남음.**
  GLG 지침의 코드화: *"이전 세션을 resume할 일은 없다. 완전 단절되고 새로 간다. 브릿지는
  에이전트 호출 전달부일 뿐, 기억층은 세션 임베딩(andenken)과 가든에 있다."* 형상: 페블 커밋
  `7f10eaf` + 그 위 오푸스5의 GPT-3라운드 blocker 수선(uncommitted 29파일, +1191/−360) —
  main 대비 73파일, net −1,100줄. GPT가 exact worktree에서 최종 수용 판정(코드 blocker 없음),
  페블이 maintainer 통독 + 스팟 재검증까지 마침.
  - **동결 정책 4문장** (README 「Generations」 절이 SSOT): ① active store는 v3-only,
    세대 간 주소/resume 연속성 없음 ② certification에 실패하는 entry가 하나라도 있으면
    install·citizen birth/registration은 쓰기 전에 REFUSE하고 명시적 fresh-cut을 요구
    ③ fresh-cut은 quiescence를 스스로 검증(live 또는 unprovable 둘 다 거부) 후 이전 세대
    통째 timestamp archive → 빈 세대 개방 ④ archive는 forensic 전용(restore 동사 없음),
    transcript·andenken 축은 불가침.
  - **삭제**: `meta-migration.ts` · `meta-bridge-migrate-v3.ts`(M1 3-verb) · 게이트 2개(85단언
    +allowlist) · `check-upgrade-gate.sh`(421줄) · `fixtures/` 동결 바이트 장치 · legacy 상수/
    수취증 이관 · `scanIdentityByNativeId`(좁은 스캔 → 전면 certification으로 대체). 마이그레이션
    어휘 전체가 코드·게이트·산문에서 은퇴.
  - **핵심 계약(오푸스 수선으로 완결)**: ① `certifyActiveStore` — doctor와 4 identity writer가
    공유하는 단일 active-store 계약(regular file·live schema·body/filename 일치·nativeSessionId
    전역 유일) ② 파괴적 quiesce는 LIVE/DEAD/UNCERTAIN 3분류 — dead는 증명(`classifyMarkerOwner`
    + `probePidExistence`; "" start-key는 unknown이지 gone이 아님, cross-scheme 비교 불가)
    ③ archive move plan 전체 preflight — collision 거부는 진짜 no-op ④ mux lineage 산문 →
    `callerGardenId`(호출 사건 ≠ 계보).
  - **검증 — 3셀 전부 GREEN (2026-07-25, exact worktree, GPT 직접 재획득 + 페블 스팟 재확인)**:
    ① SOURCE `pnpm check` EXIT=0 (check-fresh-cut-gate **95/0**, receiver-marker 46,
    identity-consumers 26) ② PACKAGE `check-pack-install` EXIT=0 ③ CONTAINER
    `ENTWURF_REQUIRE_DOCKER=1 check-install-container` exit=0 (artifact sha256 `0c3c0ea5…cfaf2e`).
    mutation 증거 5축 기대 RED 확인. 주의: 이 container 증거는 워킹트리 수용 증거이지
    release-preserved tgz가 아님 — release make/publish 때 exact candidate를 다시 보존·결속.
  - **형상 확정**: 페블 `7f10eaf`(뺄셈 본체) + 오푸스 수선/NEXT 정리 커밋(이 브랜치 HEAD,
    `fix(fresh-cut): certify the whole store once, and prove death before cutting`). push됨.
- **▶ 다음 걸음 — 새 세션 팀의 fresh-eyes 재검수 (GLG 지시).** 이번 구현·검수 3자(페블·오푸스·
  지피티)는 세션 수명을 다했다 — 어딘가 구멍이 있기 마련이라는 전제로, 이 축적 없이 새로 보라.
  - **검수 좌표**: `git diff main...cut/fresh-generation` (73파일, net −1,100줄) + #50의
    fresh-cut 작업기 코멘트. 산문 SSOT는 README 「Generations」 절과 AGENTS 불변 #5.
  - **재현 명령**: ① `pnpm check` ② `./run.sh check-pack-install`
    ③ `ENTWURF_REQUIRE_DOCKER=1 ./run.sh check-install-container` — 셋 다 EXIT=0이어야 한다.
  - **의심해볼 곳(이전 팀이 이미 판 곳 말고)**: certification과 mailbox/송신 읽기 경로의 경계
    (쓰기만 지키는 범위 결정이 맞는가) · fresh-cut quiesce가 못 보는 표면이 남았는가(agy
    native-push 쪽 process state 등) · 게이트가 단언하지 않는 실호스트 시나리오 · 산문과 동작의
    불일치.
  - **판정 규칙**: 구멍 발견 → 수선 커밋 후 재검증. 무결 → 문서 최종 정리 → merge → #50 close
    → 다음 작업(#47 mux launch rail)으로.
- **⚠️ 이 컷을 pull하는 pre-cut 개발 PC 런북(간소화됨)**: 그 호스트 세션 quiesce → pull →
  `entwurf meta-bridge-fresh-cut`(quiesce 게이트가 지켜줌) → `setup` → 재개. 이전 세대는
  `meta-sessions.archive-<ts>`로 남고 아무도 읽지 않는다.
- **🔴 release 차단 관측 — 번들 MCP readiness race (변동 없음).** 인과가 서기 전에는 고치지
  않는다(GLG 결정). SSOT는 **ROADMAP 「🔴 OPEN — 번들 MCP readiness race」** — 재발 시 그곳에
  표본 누적.
- **release lane (0.12.8-repair.1, 방아쇠는 GLG):** `land` → `prepare`(CHANGELOG 재승격 —
  fresh-cut 뺄셈 포함) → `make`(LIVE 재획득) → `publish`(`repair` dist-tag만; `latest=0.12.7`
  유지 확정). merge ≠ release.
- **컷 불변(재론 금지):** Claude floor `>=2.1.217` · Linux 유일 certified axis · Node 24+ 단일
  지원축.

## BLOCKED RETURN — #49

1. **E — floor purity.** 설계 SSOT는 **#41의 두 코멘트**. 첫 전체 floor 실행은 green이 목표가
   아니라 churn 카탈로그를 뽑는 관측 실행이고, RED는 데이터다.

## RECENT

- **[2026-07-25] fresh-cut 뺄셈 착수** — 위 NOW. `MetaBackendV2` → `MetaCitizenBackend`
  심볼 rename은 이 브랜치에서 **이미 완료**됐다(잔재 0 — grep으로 확인).
- **[2026-07-24] #50 hard-cut 브랜치 merge** — meta-record가 유일한 주소 권위(V3-only).
  상세는 #50 작업기, 증거 원장은 BASELINE HISTORY(`cbda097`)와 CHANGELOG/git.
- **[2026-07-13] evidence boundary:** 동일 agy pid 다중 conversation 동시 invocation 시 marker
  last-writer 덮임. process-per-session·직렬 invocation에 기댐.
- **수동 항목:** `smoke-meta-async-drift`는 외부 바이너리 pin 의존으로 CI 제외. 컷 체크리스트의
  수동 항목 (2026-07-14 green: claude 2.1.208 / codex 0.144.1 / agy 1.1.2).

## AFTER

1. **#50 닫기** — 이 브랜치 merge 후 (fresh-cut 뺄셈이 마지막 조각).
2. **후속·별건 (구현과 섞지 않음):** ⓐ 오푸스가 #50에 남긴 readiness upstream 인과 확정
   코멘트 정정 — 별건, GLG 승인 후 오푸스에게 ⓑ BASELINE fresh-cut HISTORY 기록 여부는
   release prepare 때 판단 ⓒ LIVE readiness race는 변동 없음, 별도 release blocker.
3. **#47 mux launch rail — 0.12.x.** 착수 전 `docs/mux-launch-rail.md`.
4. **#48 cortex — 0.13.0.** PR #40은 PARK. mux 기반과 backend adapter 검증이 선 뒤에만.
5. **Meta sender 모델 표기 — 비차단.** agentId는 계약대로, 모델 표시는 optional display field로.
6. **장기 항목 원장은 ROADMAP** — 「repair/v2-core-debt 승격분」과 「🔴 OPEN — readiness race」.
