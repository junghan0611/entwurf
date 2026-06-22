# NEXT — pi-shell-acp 0.11.0 나침반

> 나침반이지 DB가 아니다: **현재 위치 · 다음 한 걸음 · 넘으면 안 되는 선**만 여기 둔다.
> 현재+미래 방향과 설계 SSOT(동결 결정·검증 원장·아키텍처·backlog) = **`ROADMAP.md`**.
> 게시되는 닫힌-변경 핵심 = **`CHANGELOG.md`**. 세션별 process history = git 커밋 log.
>
> **2026-06-16 대정리:** 0.11 작업의 닫힌 ledger(SE-1/2/3 · 세션 #12/#14 · model-in-loop triage 사가 ·
> Stage 0 step 설계 · 동결 결정 · 검증 원장 · backlog)를 `ROADMAP.md`로 이주하고 NEXT를 compass로 축소했다.
> 그 전 2133줄 ledger 전문은 git history(이 커밋 직전 NEXT.md)에 보존됨.

## NOW — 활성 lane은 `acp-on-v2` 브랜치 (2026-06-22 갱신)

> **0.11.0은 이미 cut된 과거 태그.** 아래 "0.11.0 컷 준비" 블록은 *역사 기록*이다(superseded).
> 현재 활성 개발 = 브랜치 **`acp-on-v2`** (pi-native v2 core + ACP plugin), 다음 방향 = **`pi-shell-acp`→`entwurf`
> 인플레이스 rename(패키지+repo) + 추가 구현**. 체크포인트 분리·세트 north-star·rename 준비 체크리스트는
> **`ROADMAP.md` 「현재」** + **`NEXT--acp-on-v2.md`** 가 SSOT. 메인 lane은 그 컷이 끝나야 다시 열린다.

---

### (역사) 2026-06-16 — 0.11.0 컷 준비 완료

**①②③④ + affordance fix 전부 DONE (Opus#3, GPT `87388d` 동행), 커밋 `2ca818f`:**

- **② pi floor `>=0.79.4`** (package.json peer/devDep + lockfile + run.sh:3420 FLOOR + run.sh:3796
  check-pack-install = 6곳, `pnpm check` EXIT0). deterministic 회귀 없음 → 안전.
- **① release-gate two-tier** — MUST(차단·exit authority, "green"은 여기만) / BEHAVIOR(advisory·비차단:
  sentinel·RGG-positive). S7 Bash-우회는 BEHAVIOR lane 안 hard-FAIL이되 컷 비차단.
- **④ fresh LIVE release-gate** (0.79.4+two-tier, log `…20260616T141023`) = **`MUST PASS=17 FAIL=0 SKIP=0`**
  (necessary 충족) **+ `BEHAVIOR PASS=1 FAIL=1`** (sentinel S7 advisory; RGG-positive 직전 FAIL→이번 PASS
  flip로 flaky 입증). VERIFY/CHANGELOG 기록 완료.
- **affordance fix (voscli 사건):** garden-id delivery canonical = `entwurf_v2`, `entwurf_send` 격하
  (tool description MCP+native 4곳 · README tool list에 v2/inbox_read 추가 + "send/reply→v2, create→v1" ·
  CHANGELOG). description+docs only(런타임 무변경, LIVE 유효).

> v1/v2 분리 결론·되는것/안되는것·triage 최종 진단은 **`ROADMAP.md` 「현재 — 0.11.0」**에 정리됨.

## 다음 한 걸음

1. **doc-cleanup 커밋** (working tree 미커밋): README Gemini 추천경로 제거(2026-06-18 deprecated→Antigravity) +
   `ROADMAP.md` 신설 + `NEXT.md` compass 축소. → commit skill 경유.
2. **push = GLG.** push 후 agenda stamp(로컬-온리 커밋은 stamp 안 함).
3. **컷 = GLG.** "컷 가자" 시 `## Unreleased` → `## 0.11.0` promote + tag (tag-release Make 또는
   `/prepare-release 0.11.0` → `/make-release`).
4. **컷 후 = 새 `entwurf` repo로 v2 인터페이스 분리** (ROADMAP 「큰 방향」). entwurf-core 추출이 첫 몸.

## 넘으면 안 되는 선

- `core.hooksPath` 건드리지 않음. **push / tag / npm publish = GLG 결정 전 금지.** `--no-verify` 금지.
- CHANGELOG는 게시됨(npm tarball, 이미 225KB) — 내부 process detail 덤프 금지, 핵심만. 내부 ledger는 ROADMAP.
- agent는 `CHANGELOG.md` + `NEXT.md` + (요청 시) `ROADMAP.md`만 편집. AGENTS.md 무단 수정 금지.

## 참조

- **현재+미래 방향 · 설계 SSOT:** `ROADMAP.md`
- **닫힌 변경 핵심(게시):** `CHANGELOG.md`
- **검증 calibration:** `VERIFY.md` · **전달 capability levels:** `DELIVERY.md` · **repo baseline:** `AGENTS.md`
- 본체 `~/repos/gh/pi-shell-acp/` · consumer `~/repos/gh/agent-config/`
