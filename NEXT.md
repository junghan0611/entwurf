# NEXT — 최우선 #141 / 목표0.36.0
Author: gpt-6.1-sol (pi-durable/session20261008T113104-801621, 2026-10-13) — not GLG direct.

# RAIL — 현재 좌표
- [x] **1. #141 설계·planning checkpoint** — thin Entwurf application/TUI; engine은 upstream.
- [x] **2. S0/S1 구현·review·보완·영향 PARTIAL** — scoped proof 완료, frozen/release acceptance 아님.
- [x] **3. 외부 ABI/ordinaryPi 정렬·GLG 수동 재시작** — 세 peer 실제 왕복·native BG 시작/완료 출력 PASS.
- [ ] **4. checkpoint commit → 새 Grok 검수 → Opus 반영·publish 직전 준비** ← CURRENT: GLG 직접승인, checkpoint86d4b65 완료, 코디HEAD/clean/stat 실측. 새Grok xai/grok-4.7 실제callback9930e0/nonce일치·garden20261013T193609-cc9307 확인, Grok013355 reportSHA84cf353b…3dab 검토완료, Opus04d032 prose/comment/help amendment 반환·코디full/currentdiff검토, Grok b7ffb2 recheck7Defects닫힘·코디full/SHA검토, repairedv2manifest15OK 독립확인·원본오류보존. Opus scopedlocal amendmentcommit→최종검증/릴리즈권한경계. npm publish 금지; push/tag/GHrelease 모드 권한 별도확인.
- [ ] **5. #128 ACP/#78 등 queue 복귀** ← PAUSED: #141 priority00. 옛 archive 전체 apply 금지.

현재 좌표: 1–3 scoped 완료 → 4 체크포인트커밋/검수/최종검증 및 릴리즈 모드 경계. 0.36.0 target은 acceptance가 아님.

# NOW — 상세 실무 좌표는 branch
- **Next:** [NEXT--feat_141-pi-durable-owned-surface.md](./NEXT--feat_141-pi-durable-owned-surface.md). 외부 관찰 prose/README stale정정 직접검토 완료. GLG 요청대로 Opus 체크포인트커밋 반환→코디 새Grok 정합성/문서 검수→검토한수정bundle Opus반영→최종검증/릴리즈준비. npm publish 전 정지. Main에는 branch 상세 ledger를 중복하지 않음.
- **계약:** [docs/pi-durable-owned-surface-plan.md](./docs/pi-durable-owned-surface-plan.md), [#141 최신 thread](https://github.com/junghan0611/entwurf/issues/141), `VERIFY.md`.
- **권한:** GLG 요청 checkpoint HEAD `86d4b65` 완료, no push. Frozen/release acceptance는아님. GLG가이번turn 로컬#141 scoped commit·새Grok검수·Opus후속반영 직접요청. Normalhooks/commit skill 필수; checkpoint는 frozen acceptance아님. Push/tag/GHrelease는 commit에서추론하지않고 Release skill `land/prepare/make/publish` 모드 경계에서확인. npm publish 금지.
- **검증:** development FULL/whole qualification BODY 반복 금지. 최종 frozen FULL과 prepared exact-SHA CI BODY/native LIVE/정확한 artifact acceptance는 별개.
- **환경:** Codex LIVE는 fresh operator app-server + 명시한 triple 필요. 없으면 SKIP→cut BLOCKED; restart/dialogue/consumer graph를 대체 증거로 삼지 않음.
- **Operator:** 같은 checkout에서 작업·normal install→ready 안내→GLG 수동 stop/start→실제 왕복. 완료; 자동 이전/격리/supervisor/agent kill·restart 없음.
- **Merge 전:** owning docs/issue에 결과 승격 후 disposable branch NEXT 제거.

# RECENT / 보존
- 코디 실제 inbox drain `lastReadAt=2026-10-13T10:18:27.957Z`: Entwurf Opus/Fable/agent-config Opus 세 nonce 일치·실제 회신 수신. Self/continuity/error-none는 각 peer receipt, enqueue만으로 PASS하지 않음.
- Native BG17099 start+automatic completion exactmarker model-visible, exited0/1s. Scoped post-restart dialogue/BG PASS, 전체 LIVE 아님. 증거 `.tmp-verify/141-kickoff/coordinator-b3-review/POST-RESTART-LIVE.md`.
- 마지막 영향 PARTIAL 82/969 KILLED·887 unrun; excluded `.vite` cache drift/실패 receipts 보존. Consumer는 graph/load, kept tarball0.35.1 metadata. 과거0.35.1 CI/#140 FULL 예외 상속 없음.
- 원본 records/transcripts/DB/WAL/credentials/company files/stash/cache/vendor/unknown-owned/media 보존. No reset/force/hook bypass/clone/worktree/store probe·recovery/자동 migration.
- Protected drafts `content/blog/20260804T094556.ko.md`, `content/blog/20260804T094556.md`; GLG가 만드는 agent-config extension issues를 들여다보지 않음.
- 이전 긴 main ledger `.tmp-verify/141-kickoff/coordinator-b3-review/MAIN-NEXT-PRE-DIALOG-CLOSE.md`; 기존 receipts 모두 보존. Local-only commit은 agenda stamp 없음. 완료/판단 사건만 DM1회, progress/중복 DM 없음.
