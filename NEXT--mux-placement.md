# NEXT — mux lane 닫힘; 다음은 검증 감산(subtraction) lane

> 이 파일은 `mux-placement` 브랜치 전용 boot sector다. merge 전 삭제하고, 살아남을 사실만 durable docs/source로 승격한다.

# RAIL — 현재 좌표

- [x] **1. T0-a — raw tmux placement 실측**
- [x] **2. T0-b — placement leaf** (`mux-placement.ts`) — commit `317387d`
- [x] **3. T1-a — visible Pi launch** (`mux-launch.ts`) — commit `c55a070`, push 안 함
- [x] **4. closure receipt rail — 폐기, 감산 커밋으로 닫음** (GPT 독립 검수 1 Blocker·4 Defect 한 묶음 반영). 검증 스케줄링은 AGENTS.md 규칙 + 경량 pre-commit이 소유한다
- [ ] **5. 검증 감산 lane — 현재 `pnpm check` chain 분류** ← CURRENT (next session)
- [ ] **6. T1-b automatic delegation** — PAUSED: fresh-token 계약·lookup seam 미설계, 설계 착수 자체가 GLG 승인 사항

# NOW — 2026-08-05 원점 재정비

- **closure receipt rail(+1,364줄)을 착지시키지 않고 폐기했다.** mux 제품 전체(643줄)의 2배가 되는 검증 인프라였다. 매 단계의 지적은 국소적으로 옳았지만 예산과 종료 조건이 없었다 — "메타도구를 고치는 일이 실제 위임보다 커지면 정지"를 검증 인프라에 적용한 첫 사례. 전체 diff는 `.agent-reports/20260805-closure-rail-abandoned.patch`(local-only handoff artifact, gitignored — clone에는 없다. base `c55a070`, SHA256 `cec631fa660818a127b685e2b4c2b535e3e417706a3c352f2d4d31a1ec5d95bc`)에 보존했다.
- **원래 통증의 최소 해법으로 교체했다.** `.husky/pre-commit`의 unconditional `pnpm check`(93개 직렬 floor 중복 실행)를 빠른 정적 검사(whitespace/lint/typecheck)로 줄였다. full floor 1회는 훅이 아니라 작업 프로토콜이 소유한다.
- **이번 lane에서 확정한 작업 룰을 AGENTS.md로 승격했다.** "Verification scheduling — when the floor runs"(inner loop / review before floor / qualification 조건부 / full floor 1회 / release 불변)와 "Review triage and lane discipline"(Blocker·Defect·Observation 3등급, 보정 묶음 1회, meta-infra lane 분리, stop signal, 증거만큼만 말하기, 위험 등급 분리).
- stale prose 교정: AGENTS.md의 "mux launch rail is not implemented yet" → 현재 출하 상태로, CONTRIBUTING.md·run.sh의 "pre-commit이 full check를 돈다" 서술 → 새 훅 동작으로.
- qualification의 default floor 분리는 이번에 하지 않았다 — 감산 lane(RAIL 5)에서 증거를 보고 결정한다.
- **GPT 독립 검수(1 Blocker·4 Defect·3 Observation)를 한 보정 묶음으로 반영하고 amend로 닫았다.** Blocker: meta-infra lane 분리 규칙을 기존 removal/repair rule(capability contract의 source-adjacent gate/mutant는 같은 변경에 산다)과 충돌하지 않게 "무관한 검증 기계"로 좁힘. Defect: qualification은 `pnpm check` 안에서 1회(별도 full pass 금지)로 교정, durable 파일(AGENTS·pre-commit 훅 주석)의 사건 고고학 제거, NEXT 좌표를 commit 후 상태로 갱신, commit body의 gitignored 경로를 local-only로 한정.

# EXACT NEXT — 검증 감산 lane (다음 세션)

1. 도구 없이 **Markdown 표 하나**로 현재 `pnpm check` chain의 모든 명령을 분류한다: default / gate 변경 시 / package·release acceptance / LIVE / 삭제 후보.
2. 그 표를 GLG에게 보이고 실제 감산 범위를 결정받는다.
3. 결정된 범위만 반영한다. selector/manifest/orchestrator 같은 새 메타도구를 만들지 않는다 — 표는 문서이지 도구가 아니다.

감산 표에 실을 Observation (이번 bundle에서 열지 않은 것):

- 두 floor-coherence 게이트의 prose corpus가 `NEXT.md`만 제외하고 `NEXT--<branch>.md`는 포함한다 — 버전 floor 선언(`>=` 비교)을 쓰는 branch NEXT가 나오면 붉어진다. 지금은 green, 규칙 신설도 run.sh 수정도 하지 않았다.
- qualification의 default floor 잔류 여부.
- pre-commit의 `pnpm typecheck` 비용(3-config tsc).

그 뒤 (순서는 GLG 결정):

- **operator dashboard detour — `entwurf-peek` 수선** (`agent-config` 소유). 2026-08-04 native Claude Code session을 직접 지정했는데도 `state: unknown`·메시지 0건·mtime 기반 `done` 오판. Return: direct-session path에서 model/state/recent messages가 나오고, process liveness를 증명하지 못하면 mtime 추정을 사실처럼 말하지 않는다. heuristic dashboard 품질이며 placement SSOT로 승격하지 않는다.
- **operator-owned baseline** (repo 밖, GLG 소유 script/skill): T1-a로 window+pi를 열고, 새 시민의 identity를 사람 손으로 확인해 `entwurf_v2`를 반복 호출한다. "N개 launch와 N개 identity를 사람이 상관짓는 일"이 실제 병목인지 먼저 측정한다.
- 통증이 관측된 뒤에야 T1-b(fresh-token 계약 + strict lookup seam) 설계를 GLG에게 별도 상신한다.

# STOP LINE

GLG 별도 승인 전에는 하지 않는다.

- T1-b identity/dispatch 구현, fresh-token 계약 / lookup seam / 예약 authority의 설계 착수
- T1-a production consumer 연결, launch shape 확장(focus/switch, window 이름, resume, 다중 동시 launch)
- peer-placement 저장·추측, 새 public situation-map surface, public spawn verb, `entwurf_v2` 확장
- record watcher, timeout/retry, unknown-id discovery, task queue, worker pool, role/quota 판단
- 검증 메타도구 신설 — receipt/cache/selector 부활 포함. 감산 lane도 표 분류를 넘는 도구를 만들지 않는다
- push, release

# RECENT

- 2026-08-05: 원점 재정비 — closure rail 폐기, pre-commit 경량화, 작업 룰 AGENTS.md 승격. 페블 진단(검증 44.9k줄 vs 제품 17.6k줄)과 GPT 검수 합의에 따라 GLG가 방향 결정.
- 2026-08-05: GPT 독립 검수 1 Blocker·4 Defect 한 묶음 반영, amend로 닫음. bootstrap 순서 오류 1회 기록: 새 규칙을 착지시키는 첫 커밋에서 full floor를 독립 검수보다 먼저 돌렸다 — 규칙은 유지하고 오류만 기록한다.
- 2026-08-04: T1-a visible launch 구현·독립 검수 보정 → `c55a070` 커밋. qualification 158/158 KILLED. pi `0.83.0` identity 판정(동기 반환 불성립, 사전 주입 성립)으로 T1-b 병목이 upstream에서 entwurf 쪽 fresh-token 계약+lookup seam으로 이동.
- 2026-08-04: GLG가 목표를 "내 위치 확인 → existing peer면 전달 → 없으면 옆 window에 visible Pi launch"라는 수동 판단의 재현으로 고정. Gas Town 경고로 T1 자동 진행 중단.
- 2026-08-02: placement 없이 별도 tmux session을 만들던 generic driver 폐기.

# 읽을 곳

- `docs/mux-launch-rail.md` — mux SSOT: situation map §4, T1 분리 §5, identity 판정 §6, evidence seam §7, 만들지 않을 것 §8, 소유권·금지선 §11, receipt 절단선 §12
- AGENTS.md "Verification scheduling" / "Review triage and lane discipline" — 이번 lane에서 확정한 작업 룰
- `.agent-reports/20260805-closure-rail-abandoned.patch` — 폐기된 closure rail 전체 diff (증거, gitignored)
