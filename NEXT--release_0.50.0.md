# NEXT — 0.50.0 준비 완료 증거 → 독립 검수·원자 커밋

# RAIL — 현재 좌표

- [x] **1. main landing.** 6f4dc72 정상 push·도장, exact-SHA CI41427433295 required4jobs 성공.
- [x] **2. Opus/Terra 준비·Fable 최종 검수·로컬 최종 floor.** Fable B0/D1/O11 → 한 보정 확인 종결. P5-R3 FULL1008초·MUST24/0/0·BEHAVIOR1/0/0·cut OK.
- [x] **3. 노트북 독립 검수·한 보정 → 원자 정리.** b22677 B0/D1 → upgrade build/SDK/새 process 문구 보정, 4e0dab로 종결. 검증 수선4파일은 로컬 `dcdfb05` 정상 hooks로 commit. 준비 metadata는 별도 commit한다.
- [ ] **4. 출하·운영 반영·재시작.** ← CURRENT: `/skill:entwurf-release make 0.50.0` 명시 승인 대기. 준비 SHA의 CI, Win32 정확 배포물 수용, make/tag/운영 대상·권한과 reader 증거가 남음. **npm publish는 GLG 직접, 에이전트 금지.**
- [ ] **5. 새 Pi Sol 문서/목적 감수.** ← PAUSED: 합의한 마무리 시점에 fresh. #153/#157의 인간 고민이 표현됐는가를 보며 구현 검수의 반복이 아니다. 아직 생성 안 함.

# NOW

- **다음 한 걸음:** 노트북 D1 문구 폐쇄(4e0dab)와 수선 commit `dcdfb05491ed20706b13b020fab40e379cc6a9a2` 정상 hooks/exit0 확인. 별도 준비 commit 완료/clean 상태부터 확인한 뒤 GLG의 make 승인으로 넘어간다. 아직 push/tag/GitHub Release/npm publish/운영 변경을 새로 실행하지 않았다. 검토한 source patch는 HEAD6f4dc726 위 **020a024c978cd5700f5e76fb60d59af55eb8c00bd1cd59357b9ed4f75042293a**. 현재 git 상태부터 확인하고 무단 push/tag/publication은 하지 않는다.
- **최종 원근거:** [P5-R3 수용6579130897](https://github.com/junghan0611/entwurf/issues/157#issuecomment-6579130897), [노트북용 동일후보 전체 patch6578835045](https://github.com/junghan0611/entwurf/issues/157#issuecomment-6578835045), [Fable 종결6578591572](https://github.com/junghan0611/entwurf/issues/157#issuecomment-6578591572). Oracle local은 `/tmp/e157h/release-050/`.
- **사용자 최신 지시:** GLG는 귀가·취침하며 꼼꼼한 정리/인계를 요청했다. 이번주 출하 가능하니 서두르지 않는다. npm 출판은 직접 한다. Pi1.5.0/#155는 쉬는 Opus에게 별도 준비만 맡겼으므로 이번 Pi1.4 SDK 후보에 섞지 않는다. 이후 “노트북팀도 이제 대기중, 한번 검수”로 기존 오프라인 연락 금지는 그 팀 검수에 한해 대체됐다.
- **노트북:** 기존 `20261007T132839-b22677`이 thinkpad/pi-durable/entwurf cwd·self-fetch replyable을 직접 확인. 선언된 remote rail로 검수 요청 수락, 직접 원문/hash/base를 읽은 B0/D1 보고(357a24)와 단일 문구 보정 확인(4e0dab)으로 검수 종결. Oracle/tmp만 주지 않고 patch·해시·결정적 영수증을 공유했다. read-only, 새 모델/clone/설치/worker/소스 수정 없음. main으로만 결과 라우팅.
- **Source fix 4파일:** `run.sh`의 Claude-floor SITES 1행 README→기존 docs 문장 rebind; OMP fresh/receive와 PD fresh의 meta-facts 5읽기에 기존64MiB 상한. min1·SITES5·prose하한8·동등성/timeout/오라클은 불변. docs 기존문장에 “Claude Code”만 명시해 스캐너와 독자의 주체를 일치시켰다. 별도 OMP/Codex 격리·독립 진단은 GLG가 금지했고 만들지 않았다.
- **준비 metadata/docs:** package0.50.0, 기존 closed `herdr-checkout` 검증 source, CHANGELOG, README의 수동 published 숫자 제거와 owner docs 이동. 기존 npm0.45 pairing은 snapshot 태그에 보존. 새 npm integrity나 SDK upgrade를 만들지 않음. README는 제품가치·대표흐름·링크, 역사적 도입 버전은 필요시 가능.

# 최종 로컬 판정 — 출하/운영 수용과 다르다

- 22:37:28→22:59:33 KST, **1325초**, gate/shell exit0. 같은 aggregate에서 FULL1008초/0, MUST24PASS/0FAIL/0SKIP, BEHAVIOR1PASS/0FAIL/0SKIP, cut OK. manifest1497/94 검증·실변이 실행0, pack666. main이 원결과·summary·snapshot/distshape/99파일 SHA manifest를 직접 읽고 cmp했다.
- 원 log SHA **c66729b4bf26a36091e43697d1a9056b56dc2b659c472fb222d6e449accba086**, snapshot **ffd9e238354e24e949e965ff4a896605b9efa40736ae87a47b8cda6d5d91c0e1**. `/tmp/entwurf-release-gate-0.50.0-r3.CMLPOf/release-gate.log`, `p5r3/P5R3-GREEN.md`.
- Codex0.166 새 test-owned PID3643415/start75473211·listener 소유, A=$208≠S=$200. 모델 gpt-6-luna / openai-codex/gpt-6.1-terra, OpenRouter0. Claude314/316·launcher 전후 name/size/mode/mtime/SHA 동일, 백업 보존. main은 사후 해당 PID·defaultsocket 부재 확인. 전체 HOME/auth 불변은 증명하지 않았다.
- **P9 관측:** main은 23:09 prefix-blind 읽기 전용 census 수행. sandbox prefix `herdr-resume-call`545 / `mux-resume-call-pd`396 / `herdr-resume-pd-pkg`396 / `herdr-resume-pd-nolauncher`396 roots, 합계17MiB; 소유 source는 `herdr-resume-call.test.ts:58,629,632`, `mux-resume-call.test.ts:48`. 누적 이전 lane과 이번 run을 구분하지 않은 관측이므로 이번 run 단독 누수량으로 쓰지 않는다. reparented `/tmp/agent-emacs-init`1개는 에디터/운영 범위라 손대지 않았다. 삭제0. R3 정확 소유 world92K/log596K/ignored Codex evidence476K·점유0 보존. 광역 cleanup/새 gate 수선은 하지 않는다.
- OMP birth/receiver 두 단위는 소유 state 검사 후 갱신, doctor와 이번 LIVE로 측정됐다. 기존 loaded 프로세스가 모두 바뀌었다는 증명은 아니다. born11의 unsupported 필드는 죽음 판정 아님; owner에게 정확한 runtime cleanup/P9 보존 범위를 보완 요청했다. 기록 삭제/retire0, 광역 cleanup 없음.
- 이 NEXT는 run 종료 뒤 갱신했다. 위 floor는 해당 당시 snapshot의 증거, 최종 prepared commit의 exact CI·Win32 artifact/consumer·registry·운영 rollout/restart/reader coherence는 별도다. Win32 carrier는 **필수로 결정됨**; 미정인 것은 수용 결과지 제외 여부가 아니다.

# 보존·권한

- 원 P4 RED568초, P5 RED20/4/0, P5-R2 RED23/1/0, 문서 rebind 뒤 prose7 RED, x02 우발 vendor 실행은 각 후보 기록 그대로. Codex0.162.1 queue수락/활성turn 미노출 UNKNOWN도 0.166 성공으로 원인 확정하지 않는다. H2 launcher 복구와 old312 소실은 BASELINE에 보존, 무해함/312의 실제 사용유무 미측정.
- 운영 반영은 checkout / assembled CC / published npm / Herdr pin / 이미 loaded MCP를 구분한다. 실제 설치와 새 프로세스·ownerjoin·시작시각·dist file-set/SHA·참여 reader coherence를 확인해야 완료. source green이나 OMP 단위 갱신을 전체 rollout으로 부르지 않는다. 필요 재시작은 대상·복귀 좌표를 먼저 보존한다.
- main68bd94 조율/commit, Opus915040 실행, Terraa20739 대조, Fabledff8a1 최종 검수 종결. notebook b22677 독립 검수 중. #155 Opus를 임의로 건드리거나 새 coordinator lane을 열지 않는다. Sol은 마지막 사용자 의도 감수, 다른 검수를 대신 시키지 않는다.
- 이 checkout의 branch만 사용. 정상 hooks/scanner, 예기치 않은 오류는 raw/관측 exit로 STOP. 새 검증기·matrix·watcher·whole qualification/root74 반복 없음. record/Native DB/receipt/백업/quarantine 삭제·SQL 읽기/lock repair·무차별 pkill 금지. Astra567753/PiOpus150a5e 연락·resume·retire 금지. merge 전 이 branch NEXT를 지우되 durable 근거를 먼저 승격한다.
