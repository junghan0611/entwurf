# NEXT — #130 /0.32.0 설치면

# RAIL — 현재 좌표

- [x] **1. 기준선** —0.31.0 종료, branch `feat/130-install-surface`, base main0450bd6.
- [x] **2. 설계·격리 실측·독립 리뷰** —E1/E1b/E1g 종료, 원본/실패/정정 영수증 보존.
- [x] **3. GLG 방향·규칙·핸드오프** —Pi1.0.4 설치 간소화 +완전 목업 native 모듈 실증. 실제 env-loader는 릴리즈 후 agent-config.
- [ ] **4. 새 실무자 형성 →1.0.4 공급 구현** ← CURRENT: 좌표 커밋(no push) 뒤 fresh Claude Code Opus; 기존 Opus 재사용 금지.
- [ ] **5. 목업 모듈·영향 검증·0.32 수용** ← PAUSED: 설치 consumer 경로 뒤 목업 ingress 실증, qualification/full/LIVE/release gate 별도.

# NOW

- **State:** 제품0.31.0/Pi1.0.2/source cd32f77 그대로. 이 checkpoint는 docs only: Hard6/17 공급·명시적 module 방향 개정, owning doc/NEXT 정리. carrier emit/SDK pin/config/dist/code/version 변경 없음. 구현/1.0.4 인증 완료 아님.
- **Next:** coordinator가 요청된 좌표 커밋을 만든 뒤 새 Opus를 한 번 형성한다. nonce callback으로 garden id 확정; formation-only read/report에는 편집/테스트/구현/위임 없음. 인간의 직접 role grant와 coordinator의 bounded scope routing은 별도. 기존 Opus `20261007T121904-27ebf3`는 GLG가 퇴근시켰다.
- **First implementation leaf:**1.0.4 upstream/metadata를 확인하고 coherent SDK +빠진 native app/TUI emit/import relocation +좁은 installed resolver의 production subject/independent consumer oracle/affected QK를 명명. source/HOME/XDG-checkout 비가시성 positive runtime/TUI load와 named absence/mismatch/drift refusal부터. 전체 verifier framework/즉시 full floor 재시작 없음.
- **Mock leaf after supply:** explicit external module 한 개, synthetic HOME/cwd/env만 사용. 초기화가 runtime/provider 전에 완료됨, native registration/contact 공존, child inheritance, invalid module/export refusal, installed consumer에서의 로드까지 실증. mock을 운영자에게 자동설치하지 않음. real dotenv/env-loader/agent-config 변경 없음.
- **Contract:** [live #130 thread](https://github.com/junghan0611/entwurf/issues/130), `docs/durable-native-support.md`의0.32 contract, `AGENTS.md` Hard6/9/17, `VERIFY.md`. actual host CLI version과 native physical SDK graph 검사는 다른 subject. same-version sharing 허용; intentionally mixed1.0.2/1.0.4 local FAIL로 global-only 지원을 강제하지 않음.
- **Authority:** GLG가 이번 좌표 commit +fresh Opus 형성을 요청했다. 이후 구현 commit/push/release는 별도 gate. push하지 않으며 local-only commit에는 agenda 도장 없음.

# RECENT — 측정 / 제안 경계

- **Measured E1/E1b:** hostPi1.0.4 bundled host-map/unbundled aliases가 actual Pi-side imports의 host value/TUI identity 유지. SDK route factories3/3, CLI route2/3 관찰; model-lock 미관찰을 실패로 승격하지 않음.
- **Measured E1b RED:** full9 exact native1.0.2에서도 shared local root unique-name pi-durable hoist→host1.0.4 chord/pi-ai binding. solo tree는 일관됨. logical npm tree/placement는 physical edge coherence를 대신하지 않음.
- **Measured E1g:** isolated npm global prefix9 members/25 edges 모두1.0.2, one pi-ai/chord, host1.0.4 unchanged. operator-global/pnpm/Bun/SEA/carrier/native admission 및 aligned1.0.4 install의 증거 아님.
- **Read / direction:** env-loader는 classic session_start/UI API를 쓴다. env 준비와 native registry 설치를 구분하고1.0.4 초기화 순서를 확인한다. actual dotenv 정책은 릴리즈 후 agent-config가 구현. 기억/검색은 skills/CLI로 이미 충족; andenken port/ACP/provider switching은 제외.
- **0.31 immutable:** tag a2c1aad/승인 tar/archive 불변. public tarSHA7a03bbe0…5c9f와 sandbox580 files 일치(`registry-byte-install-observed.json`); 새 pin 인증으로 상속하지 않음.

# SOURCES / GUARDS

- `.tmp-verify/032-prep/issue130-mock-body.md`, issue readback/coordinate commit receipt, fresh launch/callback/formation receipt. issue thread는 host-independent contract; local evidence paths는 재측정 단서이지 cross-host authority 아님.
- `.tmp-verify/032-prep/opus/e1-report.md`+137 raw, `e1b-report.md`+170 raw, `e1g-report.md`+40 raw; `fable/e1{,b,g}-review.md`와 coordinator digest checks. reports/raw/digests 불변; 정정은 별도 precision note.
- E1 Fable/Opus research lane는 종료. 새 실무자 checkpoints/blockers/review는 coordinator로만. role/launch/callback/turn/model실행 증거를 섞지 않음.
- operator auth/settings/records/transcripts/SQLite/Emacs/old fixtures 보호. Original branch만, worktree/tmp development clone 금지. fixture/raw는 증거. manager/updater/downloader/credential mediation/foreign API shim 금지.
- scoped implementation→affected focused gates→independent review→one amendment bundle→changed qualification→frozen full/LIVE/release. main NEXT를 건드리지 않고 merge 전 branch NEXT 삭제.
- DM433 discussion-ready 사건은 이미1회 전달(rc0); 중복 DM 없음. 향후 장기 작업 완료는 별개 사건일 때만 dm skill.
