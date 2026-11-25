# NEXT — 0.63.0 prepare: #173·#174·#175가 main에 있다

**현재 (2026-11-25 21:5x KST):** #175는 main `df7075d1`(merge, 트리는 브랜치 끝 `2d0b70d1`과 같은 `d88bbcdb`)에 들어갔다. 다음은 13 prepare 0.63.0이다. 0.63.0은 #173·#174·#175를 묶는다. 0.63.1은 만들지 않는다. npm publish는 GLG가 직접 한다. 역할: 운영코디 `20261014T212756-68bd94`(pi-durable), 실무코디·main writer·릴리스 `20261113T043350-ff08d4`. #175 실무진: A/B 구현 Opus `20261125T121018-b4f4e3`, C 구현 Astra `20261125T124619-b8c1c0`, 코드 리뷰 Sonnet `20261125T121028-d0ea26`, 사실·대칭 Sol `20261125T123927-0f3787`. 옛 writer Pi ACP Fable `20261124T210459-6f4ebe`는 retire하지 않았다.

# RAIL — 현재 좌표

- [x] **1–8. 0.61.0·0.62.0 cut과 Herdr re-pin.** 증거는 CHANGELOG 0.61.0·0.62.0 Release evidence와 Herdr snapshot 항목에 있다.
- [x] **9. 0.62.0 뒷정리.** 수정은 CHANGELOG `## Unreleased`에 있다. 남아 있던 PARTIAL은 뒤 후보에서 측정했다: set-model-readback 212/212 @`4e6045e5`(acp-step8 mutant 포함), visible-resume 137/137 @`d379a6f0`(herdr·mux resume 테스트 포함), mux-resume-call @`52c95685`.
- [x] **10. #173 resume CLI.** main `e2cb4709`. C1–C4, P1(owner pid가 없으면 ps 생략, peer-facts 약 9s→0.72s), P2(peers·선택기에서 북마크·live·activity 우선, test room과 넘친 행은 수만), mutant 정정 `d379a6f0`, smoke-pi-attach 격리 `e2cb4709`. PARTIAL 8 group green(`~/.local/share/entwurf-lab/173/receipts/`). 동결 FULL `e2cb4709` 1177s exit 0. A7 LIVE는 #173 댓글 7147835601에 있다.
- [x] **11. #174 resumed Fable alias.** main `4e6045e5`. Sol GO(Blocker 0, Defect 0). PARTIAL set-model-readback 212/212, probe-ordering 1/1 @`4e6045e5`(receipts `~/.local/share/entwurf-lab/174/receipts/`). 나머지 13 group은 바뀐 subject에서 find 불일치 0건이라 돌리지 않았다. 동결 FULL `4e6045e5` 1173s exit 0(dist는 같은 SHA에서 빌드). 제품 LIVE pi-smoke Fable: after-compaction과 reopen 모두 `resuming → session ready model=claude-fable-5-2 → sending prompt`, acpSessionId 하나, 14/15(`174/green/`). 수정 전 RED는 #174 댓글 7147841663. 대조군 agy Gemini 4 pi-smoke: compaction→resume에서 readback 거부가 없었다(n=1, `174/control-agy/`). value 비교 삭제 mutant는 정적으로는 잡히지만 측정하지 않았다(Sol).
- [x] **12. 형제 재시작 확인.** 6f4ebe를 GLG가 다시 열었고, 첫 턴이 `session ready model=claude-fable-5-2`로 통과했다(11:30 KST). 다른 형제는 재시작이 필요 없었다. 11:57 tmux 서버 SIGSEGV(원인 미확인) 뒤 GLG가 `entwurf` 세션을 새로 만들었다.
- [x] **12a. #175.** main `df7075d1`. B1 `dcd126f1`(quit이 lease 해제를 끝까지 기다린다), A1 `039699c5`(Pi compaction 뒤 같은 vendor 세션에 `/compact` 한 번), C `887a821d`(length anchor를 Pi가 뺀 답은 새 검증 입력을 기다린다). 영향 PARTIAL 11 group 447/447 killed, control ok, 모두 head `2d0b70d1` surface `a59ba979`(`~/.local/share/entwurf-lab/175/accept/receipts/`). set-model-readback 1차는 끝 구간 부하로 60s bound HANG 8개, group-RED 246/254였다(`accept/run1/NOTE.md`). bound를 올리지 않고 같은 후보에서 다시 재서 254/254였다. 동결 FULL `2d0b70d1` 1212s exit 0. 제품 LIVE(sandbox, n=1)는 `accept/live/RESULT.md`에 있다. genuine ACP `max_tokens`는 두 rail 모두 관측하지 못했고, C는 합성 증거뿐이다.
- [ ] **13. prepare 0.63.0.** ← CURRENT. `/entwurf-release prepare 0.63.0`. CHANGELOG #175 항목의 "Vendor compaction through a LIVE product turn and the 1M window are not measured" 문장을 `accept/live/RESULT.md`의 결과로 고친다(수동 compact GREEN: Fable·Sonnet, threshold GREEN: Sonnet·agy, agy 수동 compact는 80k 규칙 미달, Fable threshold·1M window 미측정). Earlier-candidate PARTIAL 줄에는 run1 group-RED도 그 영수증대로 적는다. P5 Codex는 운영 managed daemon(Codex 0.172.0, 시작 시점의 pid를 그때 기록)을 쓴다. GLG가 2026-11-25에 A안으로 결정했다. 모델은 `gpt-6.1-terra`, pi 쪽은 `openai-codex/gpt-6.1-terra`. 전용 app-server는 daemon과 같은 control socket을 쓰므로(`scripts/codex-app-server-launch.sh:8`) daemon을 멈추지 않고는 띄울 수 없다. Earlier-candidate PARTIAL은 영수증 하나에 한 줄씩 적는다.
- [ ] **14. make 0.63.0.** exact-SHA CI 4/4, candidate, tag, GitHub release, stamp. publish는 하지 않는다. 끝나면 GLG에게 DM 한 번.
- [ ] **15. GLG publish 뒤.** GLG의 새 노트북에는 0.63.0 registry(소비자) 버전만 설치한다. 그것이 installed-consumer LIVE(Pi 1.6.0)의 첫 측정이다. 형제 재시작: 새 버전이 필요한 것은 ACP 세션을 이어 가는 형제뿐이다. 일괄 재시작은 하지 않는다. 0.62.x writer는 `vendorCompaction` 칸을 다시 쓸 때 지우므로, 그 세션을 이어 가기 전에 ACP writer를 먼저 올린다.

# 열린 관찰 (일을 열지 않음)

- **PARTIAL 러너 (2026-11-25, #175 인수).** 러너 self-test는 동시에 돌리면 안전하지 않다. `cloneDirs()`가 전역 tmpdir을 세므로, 두 group을 동시에 시작하면 `QK:ORACLE-RUNS-TARGET-BYTES`가 mutant 실행 전에 실패한다. bound 60s mutant의 여유는 약 1.7배다(대조 실행 36.7s, 중간 kill 34s). 부하가 쌓인 끝 구간에서는 대조 실행이 50.7s가 되고, 8개가 bound를 넘었다(`accept/run1/NOTE.md`).
- **Pi summary 비용은 한계로만 둔다.** GLG는 pi에 PR을 하지 않는다. CHANGELOG #175 항목의 "Pi summary generation still has a cost"가 그 기록이다.
- **#174 실패 경로 정리.** resume 뒤 enforce가 던지는 경로에서는 quit 뒤에도 lease와 claude child(ppid 1)가 남았다. 측정 run이 끝날 때는 sweep clean이었다(#174 댓글 7147841663).
- **#174 후속 미측정.** Fable 5.1과 agy Gemini 4의 resume readback. 더 새 Fable이 나오면 드라이버는 5.2를 full id로 두고, 그 답은 canonical 경로가 받는다(코드 읽음).
- **resume 거부 문구.** 거부 문구가 agent 호출자를 전제로 쓰여 있다(`entwurf_resume_call rejected`, `send to it with entwurf_v2`). C4에서는 한 hint만 사람용으로 고쳤다.
- **team.json 이름.** GLG는 운영 `team.json`을 "entwurf.json"이라 부른다. 기술적 필요는 없고, hard cut이면 옛 이름을 읽는 경로가 사라진다(Hard Rule 1). ff08d4는 지금 이름을 유지하자고 권했다. GLG 답을 기다린다.
- **0.62.0 뒷정리에서 넘어온 관찰.** GLG 대화 관측(2026-11-23, agy 1.5.14, n=1): pi를 다시 연 뒤 둘째 turn이 기록된 agy 세션을 resume했다. LIVE에서 잰 agy 버전은 1.5.13이다. `pi-durable-owner-fence.test.ts`는 floor를 두 번 돌리는 동안 `pdf-*` 하나를 남겼다(원인 미확인).
- **시험 형제.** `20261125T084440-d8233a`(#173 A7 LIVE)는 dormant로 남겨 두었다. retire는 GLG가 요청할 때만 한다.

**0.62.0 cut 관찰:** U3 registry 설치에서 npm 11.16.0이 `allow-scripts` 정책으로 entwurf `postinstall`(chmod)을 돌리지 않았다. tarball이 이미 실행 비트를 갖고 있어 영향은 없었다.

**0.61.0 cut 관찰:** 턴 중에 창을 닫은 LIVE 실행 두 번이 operator HOME에 fixture holder lease를 남겼다(`~/.pi/agent/entwurf-acp-holders/claude/` `e505…`·`f531…`, 지우지 않음; `e505…`는 pidNs 없는 옛 형식이라 재부팅 전까지 인계되지 않는다). 두 P5가 각각 `/tmp/entwurf-s2b-overlay-*` 한 개를 남겼다(P9에서 회수). (2026-11-25 정정) PARTIAL은 mutant를 공유 checkout이 아니라 임시 snapshot에 심는다(`mutation-qualify.ts:14-17`, `:875`). 다만 시작과 끝에 원본 HEAD와 작업 표면 해시가 같은지 단언하므로, 도는 동안 트리를 바꾸지 않는다. 같은 host의 부하는 bound를 넘기게 할 수 있다(위 PARTIAL 러너 관찰).

**0.60.0 cut 관찰:** `pi-extensions/lib/acp/agy-adapter.test.ts:320`이 `/tmp/acp-agy-thinking-*` sandbox를 지우지 않는다(P9에서 112개). prepare 체크리스트에서 Herdr lock 전환과 `docs/setup-clean-host.md`·`docs/durable-native-support.md` 버전 문구가 빠지기 쉽다(이번에 둘 다 놓침; 후자는 `PI-FLOOR-PUBLISHED-SCOPE` mutant 앵커와 묶여 있다).

# #164 Orca 증거 (노트북 lane에서 승격, oracle은 Orca를 설치하지 않는다)

- 측정 요약: #164 댓글 6906503079 — orcad v1.4.259 + 페어링된 GUI 클라이언트에서 `entwurf claude`·GUI가 띄운 plain Claude Code·`entwurf pi` 왕복 각 n=1 성공. Claude Code는 메일을 자동으로 읽되 실행은 pane 사람 승인 뒤, Pi는 즉시 회신.
- 소비자 수용: #164 댓글 6907955407 — README만 받은 새 Sonnet이 sandbox HOME에 npm 0.55.0 설치 → setup green → Orca 터미널 시민 출생.
- 영수증 원본은 노트북 host-local(`~/.local/share/entwurf-lab/164/*/receipts`)이다. 시험 자원은 회수했다.
- GLG 결정: 코어는 npm pin 설치, Orca 플러그인은 npm 패키징하지 않고 안내 문서만 둔다(점검 스크립트 없음). 대상 하네스는 pi·claude-code, opencode는 범위 밖.
- 0.55.0 소비자 관측(노트북): pi 첫 record·상태줄 모델이 `claude-fable-5-1`이었다(턴 실패 여부 미측정). 시작 화면에 `Extension issues … peerDependencies` 경고가 뜨지만 동작에는 지장이 없다(아래 U3 경고와 같은 것).

# NOW

- **역할:** 맨 위 "현재" 줄을 따른다.
- **운영 관찰:**
  - oracle의 pi는 이 checkout을 package로 로드한다(`pi.extensions`가 `.ts` 소스). 새로 뜨는 pi는 미커밋 작업트리를 그대로 쓰고, 편집 중간 상태에서 뜨면 entwurf provider 전체가 등록에 실패할 수 있다. MCP bridge는 dist라 `build-bridge` 전까지 src/dist가 어긋난다(#167 리뷰 895788 관찰, #165 맥락).
  - 새 backend를 store에 처음 쓰기 전에는 installed writer 전부(`doctor-codex-birth`는 helper bytes staleness를 보지 않으므로 `install-state.json`의 unit 버전도), omp·copilot doctor를 확인한다. 0.55.0 cut에서 Codex birth helper(0.41.1)·OMP·Copilot receive가 `openclaw` record를 보고 store 쓰기를 거절했다.
  - `doctor-omp-receive`는 receive 로그에 남은 `arm-gave-up` 줄을 평생 센다. 한 번의 실패가 영구 RED가 된다(0.55.0 cut에서 로그를 보존용 이름으로 바꿔 넘김).
  - Codex vendor managed daemon은 seat pane이 죽어 있으면 `smoke-codex-fresh-live`가 A 좌표를 해석하지 못한다. cut은 `entwurf codex-app-server`를 전용 tmux에서 띄워 측정한다. daemon 복원은 GLG가 결정한다.
  - `check-acp-backend-preflight`가 thinking level 없이 backend를 부른다(b3 O1).
  - `*resume-call.test.ts`가 `/tmp`에 디렉터리를 남긴다(P9).
  - U3 registry 설치 경고: host-provided pi 패키지는 `"*"` peerDependencies여야 한다는 pi 경고. 기록만 했다.
  - OpenClaw 플러그인은 oracle checkout `plugins/openclaw/dist/index.js`에 link되어 있다. checkout 브랜치를 바꾸지 않는다.
- **범위 제외 (GLG 2026-11-14, 유지):** 정지 동사 노출. 정지 수단은 로컬 ESC다. (같은 결정의 steer 절반은 0.55.0 S7로 출하됐다.)
- **PAUSED:** durable ACP 통합.
- **Do not touch:** 출하된 tag/release/npm bytes, push(GLG 승인 시만), `--no-verify`, worktree, 운영 profile·overlay·hook, credential, 자동 compaction 기준 논의(S8은 기록만 하고 기준은 바꾸지 않는다), andenken 리포.

# 이월 (다음 레일과 결정 대기)

- **#163 Observation (0.53.1, 기록만):** 계약 문서 `docs/acp-backend-rail.md` §11-10·§11-11. O3 요약 오라클이 pi `sdk`/`modelRuntime` 구간을 덮지 않음, O5 `/new`·fork 뒤 `session_compact` 키 어긋남 no-op 미확인, M2b fence 꼴 유지, O-2 미리보기 Markdown 해석, O-3 fence 뒤 `'`, O-4 code point 경계 자르기, O-5 title 변경마다 running 줄; 제어문자 정리는 pi 범위에 DEL·C1 제거를 더한 것.
- **사용감 기록 (a30dda 제안, 결재 조건 아님):** 평소 일 한 건을 ACP로 끝낸 뒤 GLG에게 묻는다 — 기다리는 동안 무엇을 하는지 알았나, ESC 뒤 이어서 말할 수 있었나, compact 뒤 최신 결정·남은 일·끝난 일이 구분됐나. 불편은 "하려던 일 / 화면 / 관측 / 수습" 네 칸.
- **0.53.1 CHANGELOG kill-power 줄:** `none (all committed claims not re-proved, #144)`에 claim 개수 N이 빠졌다. 0.53.0은 1532였다. 2026-11-14 PARTIAL receipt(`563b9334` 위)에는 committed mutant가 1547개(5개 실행 + 1542개 미실행)로 나온다. 이미 태그된 섹션이라 고치지 않았다(ff08d4 2026-11-14).
- **D1(다음 레일):** AGENTS.md Rule 11의 "run_ts is the sole TS crossing"과 `mcp/entwurf-bridge/start.sh:47-68`이 어긋난다. start.sh는 소스 체크아웃에서 src를 strip-types로 실행한다. 문안은 GLG가 정한다. 같은 owner 체크아웃에서 ACP 쪽 bridge는 src를 쓰고 Pi 내장은 dist를 써서, dist가 낡으면 둘이 갈라질 수 있다(미측정).
- **O3(다음 레일):** R2R에서 summary에는 옛 사실만 있었고, 갱신된 사실은 kept tail이 운반했다. 다음 VERIFY 다이어트 후보는 §1A Layers 1–4다.
- **run.sh:7787 주석:** "VERIFY.md:61"은 낡았다. 다만 check-install-surface S9h가 검토된 dispatch case를 바이트로 비교하므로, 고칠 때는 S9h의 reviewed 바이트와 함께 고친다.
- **GLG 결정 대기:**
  - #161 판단.
  - 형제 262958과 b3e007 처리.
  - O4: b3e007 summary에 gog·scope·calendar 단어가 있다. andenken이 summary를 그대로 임베딩하므로 그 세션 파일을 memory-sync에서 뺄지.

# 원자료

- #163 thread, #161, `docs/acp-backend-rail.md`, VERIFY.md Part I, BASELINE.md, `docs/baseline-receipts.md`.
- 출하 영수증은 `CHANGELOG.md`에 있다(0.53.1, Herdr snapshot 항목, 0.53.0). host-local 원본은 `~/.local/state/entwurf-releases/`에 있다.
