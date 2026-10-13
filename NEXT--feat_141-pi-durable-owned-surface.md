# NEXT — #141 / 0.36.0 / pi-durable 정본화·SDK1.2.0
Author: gpt-6.1-sol (pi-durable/session20261008T113104-801621, 2026-10-13) — GLG가 좌표 커밋 후 실무 진행 지시.

- Branch: `feat/141-pi-durable-owned-surface`; 시작 base `653becbe89657f38eaf3e47815b1db141bf04414`.
- 정본 계약: [docs/pi-durable-owned-surface-plan.md](./docs/pi-durable-owned-surface-plan.md), [#141 최신 thread](https://github.com/junghan0611/entwurf/issues/141).
- 코디: 계약/레일/독립검토/체크포인트; 기존 Opus `20261011T202615-521a11`: 단일 실무 writer. 새 형제 없음.

# RAIL — 현재 좌표
- [x] **1. 방향·설계·R0 확정** — 얇은 표면은 Entwurf 정본, 엔진은 upstream. R0 bytes/import feasibility 확인, 실무 계약 작성.
- [ ] **2. S0 정본·emit/type/pack 경계** ← CURRENT: GLG 승인 좌표 commit을 정상 hooks로 마친 뒤 Opus에 bounded S0 handoff. SDK1.1.0/carrier bytes 유지.
- [ ] **3. S1 coherent1.2.0·UI/도구/receiver 접점** — S0 검토·한 보완·영향 PARTIAL 후 코디가 다음 묶음 위임.
- [ ] **4. 격리/설치·동결 증명 + GLG 수동 재시작** —1.2 설치-ready 때 GLG께 시점 안내, 껐다 켠 뒤 서로 보임/대화 실제 확인.
- [ ] **5. 승인된 release·기존 queue 복귀** ← PAUSED: 해당 commit/push/cut/publish 및 LIVE 판정은 별도. #128/#78은 뒤.

현재 좌표: 1 완료 → **2 좌표 commit 후 S0 실무**. 구현/SDK bump/LIVE acceptance는 아직 없음.

# NOW
- **Next:** 좌표 docs/NEXT만 scoped commit(이번 GLG 승인, push 없음) → 정확한 SHA/계약으로 Opus에 S0 handoff → 완료 실제 알림을1회 읽고 source/focused receipts 독립검토. Opus compact 후에도 문서 정본으로 바로 재개 가능.
- **S0 계약:** owned6TS+LICENSE, dedicated strict fence(rootDirs/child exclude:[]), @types/proper-lockfile4.1.4 실제 devdep, pin v3 origin/source/generated/sdk 분리, patch+proof 은퇴, non-SKIP emit, CI exactNode/별도 identity receipt, JS-only pack. tui formatter만 일시off·lint6파일 유지, S1에서 복귀. 상세 subject/QK/argv/stop는 정본 plan.
- **R0 판정:**6 carrier/license byte identical;30imports→24 installed1.1 d.ts. Strict typecheck는 TS7016 proper-lockfile **RED1**, 설치 후 실제 green 필요.1.2 타입/production gates는 미측정.
- **권한:** S0 로컬 구현·필요 devdep/install·offline focused checks 진행; 체크포인트를 코디에 반환한 뒤 review→한 보완→영향 PARTIAL1회. 전체 BODY/FULL 반복, 추가 commit/push/release 자동 실행 없음. 코디-owned NEXT/issue 수정은 writer 범위 밖.

# OPERATOR — GLG가 확정한 보통의 재시작 절차
- 같은 checkout에서 새 버전을 작업·설치하고 GLG께 재시작 시점 안내 → GLG가 기존 세션을 껐다 켬 → mutual visibility/message/dialog 확인 → 릴리즈 계속.
- **별도 runtime 보호/0.35.1 이전/quiesce 선행 승인 대기는 철회.** 자동 세션 이전·새 supervisor·agent의 kill/restart 없음. Checkout live-coupling은 관찰이지 blocker가 아니다. 이전 DM511의 선택 요청도 해소됨; 재전송 없음.
- agent-config native module content→output 및 ordinary Pi host1.2.x는 S1 실무 호환 목록으로 조율, 별도 보호정책을 GLG께 재질문하지 않는다. 다른 repo writes를 S0에 몰래 섞지 않는다.

# READ / receipts
- Opus 설계374줄 SHA `e71f76c0d781ebdd099707baa21b201583a33f7e258ba6605761fcc6877a0395`; R0 96줄 SHA `c8ab5320079c60ab9b00eb5d90bf5bdaf225123e00c385d9bf6b80025b3fc01f`. `.tmp-verify/141-kickoff/{OPUS-EXECUTION-CONTRACT.md,OPUS-R0-PROBES.md,r0/}`. 원문/hash/핵심 receipt 읽음.
- 상세 bounded handoff `.tmp-verify/141-kickoff/S0-IMPLEMENTATION-HANDOFF.md`; 공개 정본 plan이 cross-host boot pointer. Inbox ea70fe consumed03:13:32.669Z; R0 review reply8dc802 접수. S0 위임은 좌표 commit 성공 후1회.
- inspect는 migration 안 함: 실제 scheduler 실행→persisted version oracle. Task downgrade 제한은 migrate 후. 원본 live store를 probe하지 않고 WAL snapshot content를 fixture로 증명.1.2 open마다 irreversible 주장 없음.

# PROTECTED / 마무리
- 원본 records/transcripts/DB/WAL/mailbox/credentials/회사 파일/cache/archive/vendor/stash/unknown-owned/original·failed media 보존. No reset/stash/force/hook bypass/clone/worktree/자동이전/reapply/recovery. Agent는 original live Harness/store open·kill/restart 하지 않음.
- Codex LIVE는 새 operator app-server/triple 필요(없으면 SKIP→cut BLOCKED).0.35.1 green/#140 FULL 예외 상속 없음. 현 시점 별도 vendor experiment 없음.
- Homepage drafts `content/blog/20260804T094556.ko.md`, `content/blog/20260804T094556.md` 보호. #128 deferred archive 전체 apply 금지.
- GLG는 회사에서 상시 관찰 불가: 준비된 재시작/완료/실제 판단 사건만 DM1회. Local commit은 agenda stamp 없음. Merge 전 결과를 owning docs/issue에 승격한 뒤 branch NEXT 제거.
