# NEXT — 0.50.0 make → GLG npm publish → 운영 반영

# RAIL — 현재 좌표

- [x] **1. #153 통합 입구·#157 대칭성 구현/문서.** d189ff3 checkpoint·요청 push·exact CI 완료.
- [x] **2. main landing.** 6f4dc72, exact push CI41427433295 required4jobs 성공.
- [x] **3. 0.50.0 prepare·독립 검수.** dcdfb05 수선 / 07d0ec0 준비, 정상 훅·clean. Fable와 notebook 각각 한 보정까지 종결. 원 P5-R3 MUST24/0/0·BEHAVIOR1/0/0·FULL1008초.
- [ ] **4. make·정확 배포물·태그·운영.** ← CURRENT: GLG가 push/태그/GitHub Release 승인, npm publish만 직접 한다. Sol 문서 보정과 handoff commit → main FF → 해당 최종 SHA의 M0 FULL → 일반 push/도장·exact4CI → M3w Windows tarball·동일 파일 Linux 수용 → 태그/GitHub Release → GLG 게시 좌표.
- [x] **5. fresh Pi Sol 목적 감수.** 20261102T232934-2b69db가 인간 원문을 직접 읽음. root README는 목적 전달 적합, Herdr 안내의 설치/placement 혼합 표 한 보정. 새 기능·코드 검수로 바꾸지 않았다.

# NOW

- **다음 한 걸음:** Sol 단일 문구 보정 폐쇄 확인 후 작은 handoff commit으로 branch NEXT를 승격·삭제하고 main에 FF한다. Opus915040가 준비한 `/tmp/e157h/release-050/m0/full.sh <최종40자리SHA>`를 **main/clean/동결 후보에서 한 번** 실행한다. 최종 FULL 이전에는 push/태그하지 않는다. make 권한은 있으나 실패한 증거 축을 넘어가지 않는다.
- **최신 직접 승인:** GLG “다음진행해 푸시태그까지하고 npm publish 좌표 남겨줘.” npm publish는 에이전트 금지. `.claude/skills/entwurf-release/SKILL.md`의 make 절차와 mandatory M3w를 따른다. 최종 tarball은 Windows preview run에서 받아야 하며 Linux에서 새로 pack하지 않는다.
- **Sol 근거:** #153 인간 직접 댓글6391806564(“힣 직접씀”), #157의 GLG 인용은 에이전트가 옮긴 인용으로 구별. `plugins/herdr/README.md`에서 plugin 활성화 Pi/CC와 caller-context rail(Herdr Pi/CC/PD, tmux6)을 분리하고 서문의 tmux-only 설명을 고쳤다. 그 외 root README 방향·SDK·기능·검사 범위 변화 없음. callback nonce `mux-fresh-call-f43874521da1b44833f26751`과 sender로 fresh 주소를 확인했다.
- **역할:** main68bd94가 commit/push/CI/artifact/tag/GHRelease/인계, 기존 Opus915040가 정확 SHA의 M0 FULL 실행. Terra a20739/Fable dff8a1/notebook b22677 검수 완료. Sol2b69db는 마지막 인간 목적 감수와 그 단일 문구 폐쇄만. 새 worker/리뷰어/병렬 조율 lane 없음.
- **읽을 원근거:** [준비 종결6579522838](https://github.com/junghan0611/entwurf/issues/157#issuecomment-6579522838), [최종 로컬 floor6579130897](https://github.com/junghan0611/entwurf/issues/157#issuecomment-6579130897), [당시 exact working patch6578835045](https://github.com/junghan0611/entwurf/issues/157#issuecomment-6578835045). [#153](https://github.com/junghan0611/entwurf/issues/153)/[#157](https://github.com/junghan0611/entwurf/issues/157) thread가 live contract다.
- **로컬 고유 receipt 보존:** gitignored `.probe-artifacts/release-0.50.0-handoff/`에 선택된 text 약1MiB와 SHA manifest, raw R3 log·snapshot·99file dist SHA·vendor 전후·review/commit 기록. `/tmp/e157h/release-050/`도 보존. 이 hostlocal 경로를 원격 읽기 근거로 대신 쓰지 않는다.

# 출하 판정과 분리할 것

- R3는 HEAD6f4dc72+working patch020a024c의 1325초 aggregate 원 PASS다. 마지막 evidence/upgrade/Sol 문구 이전의 subject이며 최종 prepared SHA CI나 Windows artifact로 승계하지 않는다. 최종 make SHA의 M0와 exact push CI는 이제 측정한다. kill-power body는 실행하지 않았다(1497/94 manifest검증만); 앞선37 PARTIAL은 각 후보 기록이다.
- P4 npm lock 불일치 RED / P5 20/4/0 / P5-R2 23/1/0 / prose7 vacuity RED / x02 우발 실행을 지우지 않는다. Codex0.162.1 queue수락/turn 미노출 원인 UNKNOWN은 0.166 성공으로 확정하지 않는다. H2 launcher는 승인 복구했고 옛 Claude312 소실의 writer/무해함/실사용은 미측정이다.
- 운영 업데이트는 source/compiled99file output·SDK / copied hook·CC assembled plugin / npm / Herdr pin / 이미 loaded reader를 구분한다. 일반 Pi/PD는 build→accepted output/SDK→새 process, copied unit은 owning installer→새 vendor session. 동작 중 형제의 종료/동일id reopen은 그 대상에 대한 운영자 결정이고 자동으로 하지 않는다. 이번 참여 reader의 새 PID·bridgechild시작시각·ownerjoin·garden id·file-set/SHA를 확인해야 rollout 완료다.
- OMP birth/receive의 소유 매칭 재설치/doctor/실제 LIVE는 완료됐으나 기존 loaded 시민 전원 갱신은 증명하지 않았다. 새 배포물·registry·운영 재시작은 이 green에 포함되지 않는다. npm 게시 후 별도 Herdr npm0.50 pin snapshot/소스별 재증명도 남는다.
- P9는 prefix-blind 읽기 전용 census 두 번, 누적 sandbox4prefix545/396/396/396·17MiB 관측(이번 단독 누수량 아님), R3 world92K/log596K/ignoredCodex476K 보존·삭제0. `/tmp/agent-emacs-init`1개는 운영/editor 범위라 종료하지 않았다. unsupported 관측만으로 born11 전부 종료를 주장하지 않는다. 원 R3 test-owned appserver3643415/defaultsocket 부재는 main이 확인했다.

# 금지선

- Pi1.5.0/#155는 별도 Opus에게 **준비만** 맡긴 일이다. 이번 Pi1.4 SDK source/package/support 범위에 섞지 않는다. notebook은 GLG의 최신 검수 지시로 온라인 확인/검수 종결, 임의 새 실험/SSH 재개는 하지 않는다.
- 이 checkout의 branch에서만 개발, worktree/개발 clone 금지. 정상 hooks/scanner, offline env-i/private HOME·PI·XDG5/verifydeps2error/noCI, managed dist build/보존. M0 동안 HEAD/index/tree/dist 동결. whole qualification/root74·새 검증기·matrix·watcher 없음.
- 실패는 raw/관측 exit로 STOP. SQL/NativeDB전수scan/lock repair/기록·memory삭제/광역/tmpcleanup/임의 pkill/working시민retire 금지. 기존백업314/316은 `/tmp/e157h/release-050/vendor-backup/bin/`에 보존하고 tmp-clearing 재부팅 전 명시적으로 보호한다. quarantine `g3-pd-birth-r1/raw/s06-ss-all.tmp`는 읽지 않는다. Astra567753/PiOpus150a5e 연락·resume·retire 금지.
