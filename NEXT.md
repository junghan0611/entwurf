# NEXT — 최우선 #141 / 목표0.36.0
Author: gpt-6.1-sol (pi-durable/session20261008T113104-801621, 2026-10-13) — GLG 승인 좌표 checkpoint; 상세는 branch NEXT/정본 plan.

# RAIL — 현재 좌표
- [x] **1. #141 방향·Opus 설계·R0 확정** — 얇은 TUI/application은 Entwurf 정본, 엔진은 upstream SDK.
- [ ] **2. branch에서 S0 → S1 → 검증** ← CURRENT: 좌표 commit 후 기존 Opus 단일 writer로 S0 실무. 별도 runtime 보호/자동 이전 prerequisite는 GLG가 철회.
- [ ] **3. GLG 수동 재시작·normal release** ← PAUSED:1.2 설치-ready 알림 → 껐다 켜기 → 서로 보임/대화 실제 확인 → 해당 승인 release gates 계속.
- [ ] **4. #128/#78 등 queue 복귀** ← PAUSED: #141 priority00; 옛 patch 전체 재개 금지.

# NOW — 상세 좌표는 branch
- **Next:** [NEXT--feat_141-pi-durable-owned-surface.md](./NEXT--feat_141-pi-durable-owned-surface.md).
- **정본 계약:** [docs/pi-durable-owned-surface-plan.md](./docs/pi-durable-owned-surface-plan.md), https://github.com/junghan0611/entwurf/issues/141 최신 body/thread.
- **현재 권한:** GLG가 좌표 commit 후 실무 진행 지시. 이번 commit은 docs/NEXT만, SDK/source/carrier/LIVE acceptance 아님; push 없음. 구현은 S0부터, 추가 commit/push/release는 해당 승인 때만.
- **Operator:** 같은 checkout에서 작업·새 버전 설치, 코디가 시점 안내, GLG가 수동 재시작. 자동 이전/별도 runtime 격리/supervisor 없음. 코디가 routine 호환·검증을 조율하고 실제 결정 사건만 DM.
- **Merge 전:** owning docs/issue에 결과 승격 후 disposable branch NEXT 제거. 이전 main NEXT는 `.tmp-verify/141-kickoff/main-next.before-branch.md`에 보존.

# RECENT / 보존
- R0:6 carrier/license bytes 동일,30 relative imports→24 installed1.1 d.ts; strict source check는 proper-lockfile 타입 미설치 RED1.1.2 호환은 아직 미측정.
- 0.35.1 종료 보고 및 exact-SHA CI success는 이전 cut 증거. #141에 상속하지 않음; #140 local FULL 예외도 상속하지 않음.
- Original records/transcripts/DB/WAL/credentials/company files/stash/unknown-owned/media 보존. No force/reset/stash/hook bypass/new clone/worktree/agent kill·restart·자동이전·reapply/recovery.
- 다음 Codex LIVE는 operator app-server와 fresh triple 필요; absent SKIP→cut BLOCKED. Operator visibility/dialog만으로 전체 LIVE acceptance를 주장하지 않음.
- Homepage drafts `content/blog/20260804T094556.ko.md`, `content/blog/20260804T094556.md` 보호. #128 archive 전체 apply 금지. Local-only commit은 agenda stamp/DM 중계 없음.
