# NEXT — Herdr 0.52.0 npm snapshot

# RAIL — 현재 좌표

- [x] **1. Core 0.52.0.** `v0.52.0`=c015477, Windows-carrier artifact·동일 파일 Linux 수용·인간 npm 게시와 registry consumer 확인.
- [x] **2. Herdr npm source.** 실 registry bytes/SRI, 격리 npm swap·수동 torn-state 복구와 fixture-listing build activation/deactivation 확인.
- [ ] **3. Snapshot 후보.** ← CURRENT: 최종 candidate seal·frozen FULL 확인 후 코디의 source/evidence 판정.
- [ ] **4. 공개.** ← PAUSED: main push·exact-SHA CI·public-ref proof·plugin tag/GitHub Release는 앞선 판정 뒤 진행.

# NOW

- **다음 한 행동:** 후보 전체 diff와 evidence 범위를 확인하고 frozen FULL의 동일 seal 결과를 받는다. 이후 코디의 승인 아래 exact-SHA CI와 public-ref proof를 각각 수집한다. 운영 host 설치·재시작은 별도 승인이다.
- **설치 인계:** 승인 대기 여부를 인계 맨 앞에 쓴다. 준비한 스크립트/재개 명령의 존재는 실행 증거가 아니다. 설치 exit0와 carrier/SDK 정합 확인 후에만 재개를 준비 완료로 안내한다. 자동 Enter·설치·takeover로 인간의 승인 창을 건너뛰지 않는다.
- **호스트 분리:** Oracle은 승인된 창에서 Pi SDK 1.5.2와 addon-less 0.52 validation TGZ `d72afb…`로 전환했고, 새 GR `be87bcf…`에서 운영 코디가 같은 ID로 복귀했다. 최종 공개 TGZ `d053860c…`로는 운영 재설치·재시작하지 않았다. ThinkPad의 0.52 전환은 미측정이다. #155의 당시 호스트 영수증은 `CHANGELOG.md`와 `docs/setup-clean-host.md`에 보존한다.

# 원자료 / 정리 원칙

- [#155 closed](https://github.com/junghan0611/entwurf/issues/155), [core Release](https://github.com/junghan0611/entwurf/releases/tag/v0.51.0), [core32 CI4](https://github.com/junghan0611/entwurf/actions/runs/41704213407), [Windows producer](https://github.com/junghan0611/entwurf/actions/runs/41706422290), [Herdr ce5 CI4](https://github.com/junghan0611/entwurf/actions/runs/41728277499). 출하 TGZ SHA256 `04fcce26d0a6dec8b8bb9a7f14a843eee0defb313aedafa34080600853d36e4d`,11710142B이며 registry 실물과 동일하다. Core tag/npm 바이트는 마감 문서 갱신으로 바뀌지 않는다.
- 재사용 가능한 기술·출하·후속 Herdr·설치 인계 기록은 `CHANGELOG.md`0.51.0 및 `docs/setup-clean-host.md`가 소유한다. 앞선6파일 후보의 local FULL963s/affected PARTIAL5/5와 뒤의 문서 bookkeeping/각 push CI를 구분한다. Whole qualification BODY를 재실행하거나 이전 후보 receipt를 새 SHA 수용으로 승계하지 않는다.
- Host-local 원본은 `~/.local/state/entwurf-releases/`와 `~/.local/state/entwurf-preparations/155/`에 보존한다. 청소·archive 검증·퇴근의 실제 경계/원실패/후속 보정은 후자의 `closeout/` 원영수증에서 읽는다. `/tmp/i155` 원 경로의 존재를 전제하지 않는다. 증거를 건넬 때 핵심 hash와 판정을 함께 붙인다.
- 기존 대화/records/native DB/일관 백업과 유일 accepted TGZ/U0는 삭제하지 않는다. 의존성 payload나 test scratch도 명시한 소유 목록과 holder를 확인하고, 기억을 포함하면 검증된 archive를 먼저 둔다. tar가 담지 못하는 죽은 UNIX socket의 정확한 metadata 예외는 별도 sidecar에 남기며 regular-file bytes를 제외하지 않는다. 보존 대상 readonly 증거의 권한은 바꾸지 않는다. 검증된 archive에 bytes와 원 mode를 보존한 뒤 회수하기로 명시한 test scratch는, 승인된 정확한 디렉터리에 한해 unlink에 필요한 owner-write를 허용한다. 이는 canonical 산물·운영 자료·archive의 권한 변경 허가가 아니다.
- `team.json`은 gitignored 인간용 책갈피다. 퇴근 후에도 항목을 남기며 garden/native ID·backend·cwd는 현재 owner facts가 우선한다. 명부에 생존 상태나 전송/재개/퇴근 권한을 저장하지 않는다. 이번 다섯 target의 사용자 요청과 단일 retire-call 결과는 private closeout 기록으로 보존한다.
- Offline는 private HOME/PI/XDG/runtime·TMPDIR=/tmp·verify-deps 두 설정error·noCI. 첫 예상 밖 실패는 원문 보존 STOP. blind retry/unsafe hook bypass/타 리포·운영 tmux·DB·credential 수선·임의 kill0. Quarantine 등 별도 보호 자료는 열거나 청소하지 않는다.
