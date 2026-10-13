# NEXT — #141 / 0.36.0 / pi-durable 정본화·SDK1.2.0
Author: gpt-6.1-sol (pi-durable/session20261008T113104-801621, 2026-10-13) — not GLG direct.

- Branch `feat/141-pi-durable-owned-surface`; HEAD `86d4b6559c4931d140c727a10b9f960689e5bf09` (GLG-requested #141 checkpoint, parent planning d8cfc21; no push).
- 계약: [정본 plan](./docs/pi-durable-owned-surface-plan.md), [#141 최신 thread](https://github.com/junghan0611/entwurf/issues/141).
- 코디는 계약/독립검토/레일; Entwurf Opus `20261011T202615-521a11` 단일 implementation writer. 새 형제/별도 coordination lane 없음.

# RAIL — 현재 좌표
- [x] **1. 설계·계약·planning commit** — 얇은 Entwurf app/TUI, 엔진은 upstream.
- [x] **2. S0 정본·emit/type/pack** — focused/review/amendment/PARTIAL 완료; frozen acceptance 아님.
- [x] **3. S1 coherent1.2·UX/receiver·transition/consumer** — 보완과 단일 영향 PARTIAL 검토 완료; consumer는 graph/load만.
- [x] **4. 외부 ABI/ordinaryPi 정렬·GLG 수동 재시작** — 세 peer 실제 nonce 왕복 및 native BG 시작/완료 출력 PASS.
- [ ] **5. GLG 요청 checkpoint commit → 새 Grok 검수 → Opus 반영·publish 직전 준비** ← CURRENT: Opus checkpoint86d4b65 완료·코디HEAD/clean/stat 실측. 새Grok xai/grok-4.7 launch @1063/nonce mux-fresh-call-47fa1274e20db2399fc0326e; callback9930e0 실제수신·nonce정확일치·sendergarden20261013T193609-cc9307/xai-grok/cwdEntwurf/replyable 확인; Grok013355/fullreportSHA84cf353b…3dab 검토완료, inspectedBlocker없음·8prosefindings. Opus04d032 amendment13files+58/-47 반환, 코디full/currentdiff 일치검토. Grok b7ffb2 recheckSHA3b34404f…3d21 full검토·7Defects닫힘/새Defect없음. V2 receipts SHA09ebc3a8…3d92/all15OK 코디검증·원본실패보존. NEXT-ready→Opus scopedlocal amendmentcommit; Source/test/gate 변화없음. Push/tag/GHrelease 모드 경계 별도 확인, npm publish 금지.

현재 좌표: 1–4 scoped 완료 → 5 체크포인트 커밋·새검수·최종 검증/릴리즈 권한 경계. #128 ACP/#78 등 기존 queue는 뒤.

# NOW
- **Next:** 외부 prose5b264d+README148 정정5ecb40 직접 diff검토/gitdiffcheck PASS, 문서정렬 완료. Owner reports GLG직접요청으로 external6files commit2fe26624/no push; 후속 README1line은 worktree만. 외부승인은 Entwurf에 전이하지 않음. GLG 직접 '일단우리커밋→새Grok 정합성/문서검수→수정검토/반영→npm publish전까지, Opus맡김' 승인. checkpoint86d4b65→새Grok 실제report 검토완료→Opus1a3d50 최소prose/comment/help bundle반영→focusedreport/코디review→NEXT-ready후scopedcommit→최종candidate frozenFULL/nativeLIVE. Gate/mutant/matrix 변경없으면 prose만으로82PARTIAL/CPI 재실행하지않음. Development FULL/whole BODY 반복 금지; npm publish하지 않음.
- **Permission:** 이번GLG요청은 로컬 #141 scoped checkpoint staging/commit 및 새Grok검수/Opus후속반영 권한. Normalhooks/commit skill 필수, checkpoint는 acceptance아님. Push/tag/GHrelease는 commit에서 추론하지 않고 release skill의 `land → prepare → make → publish` 모드 경계에서확인. 0.36.0 target이나 수동 restart는 승인 대체물이 아님.
- **Environment:** native Codex LIVE는 fresh operator app-server + 명시한 `ENTWURF_CODEX_*` triple 필요. 없으면 SKIP→cut BLOCKED; PID 검색/추론/waiver 금지.
- **Verify:** 최종 FULL receipt는 고정 candidate의 결과만. Prepared exact-SHA CI qualification BODY와 native LIVE/정확한 release artifact는 별개. 현재 82 PARTIAL/consumer/실제 대화를 그 증거로 승격하지 않음.
- **Read:** `VERIFY.md`, `.claude/skills/entwurf-release/SKILL.md`, `.tmp-verify/141-kickoff/coordinator-b3-review/{FINAL-B3-B4-REVIEW.md,POST-RESTART-LIVE.md}`.

# RECENT — 실측 및 peer receipts
- GLG 직접 재시작 확인: coordinator/Entwurf Opus/Fable, 이어 agent-config Opus도 다시 켰다고 통보. Agent가 kill/restart하지 않음.
- 코디 self 19:12:45 KST: 동일 garden `20261008T113104-801621`, cwd Entwurf, self-fetch/replyable.
- 실제 native BG17099: 시작 출력과 자동 completion 모두 model-visible, exited0/1s, marker `ENTWURF-141-RESTART-BG-OUTPUT-20261013T1913`. Polling 없음.
- Inbox 1회 drain `lastReadAt=2026-10-13T10:18:27.957Z`: Fable `ca27b7`/Entwurf Opus `64b493`/agent-config Opus `8eb312`, 각각 정확한 nonce와 sender garden/cwd 일치. 실제 읽음→회신→코디 읽음 PASS, enqueue만으로 판정하지 않음.
- 세 peer의 self/retained-context/error-none는 각 peer receipt. Source/hash 불변에 대한 peer 보고를 코디 raw 재측정처럼 서술하지 않음. Restart/dialogue/BG scoped PASS이며 전체 native LIVE가 아님.
- 외부 PI-DURABLE.md743–757 관찰 기록·출처 SHA46df6d1f 직접 확인. README148 stale 대기문 한정 정정9c598f 허용; code/install/test/gate/issueboard/commit/push 요청 없음. 외부 HEAD2fe26624 위 README1file/+1/-1 직접검토, GLG commit경위는 owner5ecb40 receipt. 과거 dirty diffsha를 현재 검증했다고 주장하지 않음. `EXTERNAL-POST-RESTART-DOC-REVIEW.md` 참조.

# EVIDENCE — 이미 검토한 경계
- S0 최초 PARTIAL pack CONTROL-RED `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY` 보존. Pure pack oracle repair 후 R2: 70/961 KILLED, 891 unrun. `.vite` excluded-cache drift를 waiver하지 않음.
- B3 실제 app probe16596은 lateFailedCalls0 결함. One amendment + throwing-registration supplement 완료. 독립16667: late1/early failed attach retirement/normal close/input refusal/threshold-background compaction retained failure(notices[]) PASS. 16667는 supplement 이전 bytes의 receipt로 보존.
- B4: fresh old fixture copy에서 actual1.2 scheduler가 safe task13 v2/running/model persisted; physical1.1 downgrade blocked/task_too_old/0calls. Recovery pending도 v2 유지. Pristine DB/SHM/WAL 3 hashes 불변, 원본 fixture open 금지.
- 마지막 단일 영향 PARTIAL `S1B3-PARTIAL-REPORT.md` SHA `0285c83dbab01572691343d628b433aa3d60d2cfec80db6ae39acda1d7872379`: dep4→pin2→beside76, 82/969 KILLED/887 unrun. 실제 controls/logs/canonical digests/purity/stable seals/모든82 current subject hashes 검토. Node coherence 미실행, 제외 `.vite` drift 보존. Review 후 freeze 종료.
- B5 `S1B5-CONSUMER-CHECKPOINT.md` SHA `eba540529319f384c786161b42fc68fa8f72062621804b61c71260c765762aae`: normal prepack+Entwurf-only fresh consumer+CPI, 6 carrier pin=shipped=checkout/9SDK1.2/24 genuine targets PASS. Graph/load만. Kept tarball SHA `405c9886e35e520767212bb1b33926f3f548aedf771fc34c0c5f6071b35cba62`, metadata0.35.1; release artifact 아님. npm allowScripts postinstall 미실행은 관찰, 0755/reachability로 실행을 주장하지 않음.
- External agent-config actualSDK1.2/faux44/44 및 prewrong-key/stub reds 검토, Fable noBlocker/noDefect. Native Harness `output`은 retained `api.output()` text가 있으면 optional; 이 BG helper는 retained text가 없어 `output` 필요. OrdinaryPi/MCP/InputSubmissionDraft `content`는 변경하지 않음.
- Global ordinary Pi는 승인된 bare Nix pnpm normal pinned1.2 install 완료; 실제 PATH shim/physical coding-agent+ai/core/tui/codemode/mcp1.2 독립 확인. Ordinary7/durable9 구분. Global version/graph는 ordinaryPi interactive LIVE 아님.

# GUARDRAILS
- Same checkout만; clone/worktree/relocation/old-installed isolation lane 없음. Runtime 보호/quiesce 선행 승인은 GLG가 철회한 요구. 자동 migration/supervisor/kill/restart 금지.
- 원본 records/transcripts/DB/WAL/credentials, 회사 files/cache/archive/vendor/stash/unknown assets/failed media 보존. 원본 store probe/recovery/reset 금지; 정상 자기 mailbox/tool 사용과 구분.
- 체크포인트 stage 전 index는 새8파일만, hash `03b3bc6b17102220c514d4ffc799032944f31bc185f7e8307f00d6b59cc0a926`; staged bytes는 이전 준비 상태, accepted source artifact 아님. 이전 staged상태는 checkpoint86d4b65로종료. 48files+3177/-1073/normalhooks는 Opus b4c3f1 receipt; 코디 HEAD/clean/stat 직접확인. 현재 NEXT는 postcommit coordination update, frozen상태아님.
- Protected drafts `content/blog/20260804T094556.ko.md`, `content/blog/20260804T094556.md`; #128 deferred archive 전체 apply 금지. GLG가 만드는 agent-config useful-extension issues를 들여다보지 않음.
- Upstream owns execution/scheduler/queues/storage/transcript/compaction/cancel/recovery/providers/auth. No second engine. Public subscribeClose/reports만; private failure getter/casts 금지. 실패 UX는 outstanding tool의 즉시 종료를 거짓 보장하지 않음.
- 완료 사건/판단 필요 사건만 DM1회; progress DM/중복 notice 소비 없음. Merge 전 durable docs/issue 승격 후 branch NEXT 제거.

이전 긴 checkpoint ledger: `.tmp-verify/141-kickoff/coordinator-b3-review/BRANCH-NEXT-PRE-DIALOG-CLOSE.md`. 보고서와 실패 receipts는 `.tmp-verify/141-kickoff/`에 그대로 보존.
