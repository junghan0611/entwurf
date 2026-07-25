# NEXT — fresh-cut 뺄셈 (cut/fresh-generation) 랜딩 대기

> NEXT는 부트 섹터다. 닫힌 역사는 CHANGELOG/git/이슈에, 장기 방향은 ROADMAP/이슈에 둔다.
> (#50 hard-cut merge까지의 옛 원장은 이 파일의 git history와 #50에 보존되어 있다.)

## NOW

- **[2026-07-25] fresh-cut 뺄셈 — 브랜치 `cut/fresh-generation`, 검수 대기 (GPT + 오푸스5).**
  GLG 지침의 코드화: *"이전 세션을 resume할 일은 없다. 완전 단절되고 새로 간다. 브릿지는
  에이전트 호출 전달부일 뿐, 기억층은 세션 임베딩(andenken)과 가든에 있다."*
  - **동결 정책 4문장** (README 「Generations」 절이 SSOT): ① active store는 v3-only,
    세대 간 주소/resume 연속성 없음 ② 읽지 못하는 record가 하나라도 있으면 install/runtime은
    쓰기 전에 REFUSE하고 명시적 fresh-cut을 요구 ③ fresh-cut = quiesce → 이전 세대 통째
    timestamp archive → 빈 세대 개방 ④ archive는 forensic 전용(runtime이 읽지 않고 restore
    동사 없음), transcript·andenken 축은 불가침.
  - **삭제**: `meta-migration.ts`(frozen v1/v2 reader) · `meta-bridge-migrate-v3.ts`(M1 3-verb
    migrator) · `check-meta-migrate-v3`(85단언) · `check-meta-migration-readers` ·
    `check-upgrade-gate.sh`(421줄) · `fixtures/`(동결 바이트 장치 일체) · meta-session의 legacy
    상수/수취증 이관 함수. 마이그레이션 어휘 전체가 코드·게이트·산문에서 은퇴.
  - **추가(소량)**: `meta-bridge-fresh-cut.ts`(단일 동사, quiesce 게이트 = live/indeterminate
    socket·live-owner marker 거부) · `check-fresh-cut-gate.sh`(45단언 슬림 게이트, 인라인 시딩) ·
    strict upsert(4 쓰기 진입점 — pi birth/Claude hook/agy imprint/register_native — 이 읽지
    못하는 store 위에 쓰기 전 fail-loud). verify는 새로 만들지 않고 기존 `store-doctor` 재사용.
  - **검증 — 3셀 전부 GREEN (2026-07-25, 이 브랜치 HEAD)**: ① SOURCE `pnpm check` EXIT=0
    (check-fresh-cut-gate 45/0 포함) ② PACKAGE `check-pack-install` EXIT=0 (installed
    fresh-cut 수명주기: REFUSE→cut→빈 세대→install PASS) ③ CONTAINER
    `ENTWURF_REQUIRE_DOCKER=1 check-install-container` exit=0 (generation matrix:
    v3-only PASS / prevgen REFUSE→fresh-cut→retry PASS / mixed REFUSE; archive 원본
    바이트 = rename 증명).
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

- **[2026-07-25] fresh-cut 뺄셈 착수** — 위 NOW. 남은 어휘 정리 후보: `MetaBackendV2` 계열
  심볼 rename(기계적, 16파일)은 검수 후 별도 커밋으로.
- **[2026-07-24] #50 hard-cut 브랜치 merge** — meta-record가 유일한 주소 권위(V3-only).
  상세는 #50 작업기, 증거 원장은 BASELINE HISTORY(`cbda097`)와 CHANGELOG/git.
- **[2026-07-13] evidence boundary:** 동일 agy pid 다중 conversation 동시 invocation 시 marker
  last-writer 덮임. process-per-session·직렬 invocation에 기댐.
- **수동 항목:** `smoke-meta-async-drift`는 외부 바이너리 pin 의존으로 CI 제외. 컷 체크리스트의
  수동 항목 (2026-07-14 green: claude 2.1.208 / codex 0.144.1 / agy 1.1.2).

## AFTER

1. **#50 닫기** — 이 브랜치 merge 후 (fresh-cut 뺄셈이 마지막 조각).
2. **#47 mux launch rail — 0.12.x.** 착수 전 `docs/mux-launch-rail.md`.
3. **#48 cortex — 0.13.0.** PR #40은 PARK. mux 기반과 backend adapter 검증이 선 뒤에만.
4. **Meta sender 모델 표기 — 비차단.** agentId는 계약대로, 모델 표시는 optional display field로.
5. **장기 항목 원장은 ROADMAP** — 「repair/v2-core-debt 승격분」과 「🔴 OPEN — readiness race」.
