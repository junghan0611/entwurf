# NEXT — 0.40.0 이후 / #147

core 0.40.0과 Herdr 0.40.0 snapshot의 출하 기록은 아래와 같다. [#107](https://github.com/junghan0611/entwurf/issues/107)은 첫 원격 한 쌍 범위로 2026-10-21에 닫혔다. 현재 기능 선로는 [#147](https://github.com/junghan0611/entwurf/issues/147)의 Pi·Claude Code 코디 출퇴근이며, 구현·증거·현재 승인 좌표는 해당 thread와 [branch handoff](./NEXT--feat_147-sibling-lifecycle.md)를 읽는다. 이 문서는 저장소 전체의 순서만 남기며 branch 세부 장부를 복제하지 않는다. 세션 기억 갱신은 별도 운영 유보다.

# RAIL — 현재 좌표

- [x] **1. core 0.40.0.** `v0.40.0` = `1f7020a`, GitHub Latest. exact CI 39351755714(4 job), Windows preview 39352739774, 후보 sha256 `4a6906ac…fa55`. npm `latest` 0.40.0은 운영자가 직접 발행했고(2026-10-20T01:49:33Z), registry tarball은 수용된 후보와 byte-equal이다. 수용 기록: [#107 6281283301](https://github.com/junghan0611/entwurf/issues/107#issuecomment-6281283301).
- [x] **2. Herdr 0.40.0 snapshot.** `v2026.10.20-herdr.0.40.0` = `036e268`, GitHub release `--latest=false`. exact CI 39357296878(4 job), runtime swap(C3) 22/22, public `main` ref raw install journey(C4) PASS at resolved `036e268`. 짝 맞춤 기록: [#107 6281902241](https://github.com/junghan0611/entwurf/issues/107#issuecomment-6281902241).
- [x] **3. 공개 면.** #107 본문 맨 위 "현재 상태" 절. homepage `22d994e` 배포 뒤 21 paths PASS. 담당자 노트에 0.40.0 보고.
- [x] **4. #107 첫 한 쌍 범위 마감.** [종료 결정](https://github.com/junghan0611/entwurf/issues/107#issuecomment-6305817042). 다음 출퇴근 질문은 #147로 분리했다.
- [ ] **5. #147 Pi·CC 출퇴근 레일.** ← CURRENT: feature branch의 구현·증거·문서 계약 마감. 아직 출하/네 칸 LIVE 완료가 아니다.

현재 좌표: 1–4 완료 → 5 #147 진행. #107 결정 대기를 다시 열지 않는다.

# NOW

- **기능 선로 (Next):** #147 thread와 branch handoff에서 복귀한다. 문서의 구현/검증/운영 배포 상태를 분리하고, exact-SHA CI·기존 release floor를 통과한 뒤에만 착륙/릴리즈한다. branch NEXT는 merge 전에 durable 결과를 승격한 뒤 지운다.
- **운영 유보 (기능 결정과 별개):** oracle replica 색인은 2026-10-19 기준 상태로 관측됐다. 이번 출하 세션의 증분은 실행하지 않았다. 최신성 재확인과 갱신은 index authority(thinkpad)가 돌아온 뒤 `memory-sync --global` 한 번이다. oracle에서는 돌리지 않는다(replica는 index를 쓰지 않는다).
- **host 자원:** 이 host는 디스크 여유가 적다. cut 밖에서도 gate나 sandbox 여정 하나가 끝날 때마다 release skill P9 서두의 순서로 정리한다. 자기 runtime 자식이 끝났는지 확인한다 → 고유 receipt·hash·후보·transcript·meta-record·모델 DB를 보존한다 → 다 쓴 그 gate의 재생성 scratch만 정확한 경로로 지운다. 운영자·시민 프로세스(editor, LSP, 컨테이너), 이전 lane 산출물, 소유가 증명되지 않은 경로, record·memory는 대상이 아니다. 손으로 하는 단계이고 sweeper나 자동 실행은 없다.

# GUARDRAILS

- npm publish·dist-tag 변경은 금지다. GLG가 2026-10-22 push/CI/tag/GitHub Release 판단을 위임했으나 기존 mode·정확-SHA·artifact·LIVE floor는 낮추지 않는다. 현재는 feature push/CI까지 진행하며, 아래 local FULL·새 모델 제한과 충돌하는 prepare/make는 named-cut 실행 범위가 명시될 때까지 blocked다. operator Herdr install·runtime·pane 변경과 임의 operator upgrade는 하지 않는다. 기존 core tag와 bytes는 고치지 않는다.
- local whole FULL·BODY, local Herdr build·sandbox, 노트북 SSH, A 쪽 traffic, 숨은 model 턴은 하지 않는다.
- 이 host의 모든 local pnpm·hook 실행 앞에 `pnpm_config_verify_deps_before_run=error`를 붙인다. deps가 stale이면 install하지 않고 멈춘다.
- 수용된 후보와 그 사본, LIVE·PARTIAL·CI·C4 receipt, transcript와 meta-record는 지우지 않는다. 일괄 /tmp 청소나 자동 whole-floor rerun은 도입하지 않는다.
