# NEXT — #158 / Pi SDK 1.5.0 → 1.5.2 (branch `feat/158-pi-1.5.2`)

# RAIL — 현재 좌표

- [x] **HOP 0 · 좌표·역할·브랜치.** main `88268f9`에서 브랜치, 문서 checkpoint `0897d6d`.
- [x] **HOP 1 · R0 측정과 소비점 preflight (읽기 전용).** registry 10종 1.5.2의 tarball SHA-512/SRI·게시 시각·tarball 안 exact edge·carrier 24 `distTargets` 존재. 실제로 참여하는 caller의 등록(MCP/start.sh/extension/launcher)이 이 checkout의 source/dist를 가리키는지 확인한다.
  - 결과(R0 `REPORT.md` sha256 `d0c5baa1…f45f`, 실무코디가 verify.json 10행을 직접 읽음): 10/10 sha512=integrity·sha1=shasum, 게시 12:20:34Z–12:25:15Z. member edge 16개 모두 exact 1.5.2, install scripts 0. 1.5.0 대비 비-member 변경: pi-coding-agent의 `grok-mermaid` 0.2.3 → `lovely-mermaid` 0.3.3(2026-08-15 게시, 실무코디 측정), chord optional peer `react` 19.3.0 추가. distTargets 24/24 존재(export 시그니처는 미측정). Codex/Copilot/OMP/Claude Code/pi 등록 모두 global 0.51.0을 가리키고 checkout 경로 0(Antigravity 미조회).
- [ ] **HOP 2 · coherent 1.5.2 구현.** 10종 exact bump·`minimumReleaseAgeExclude`에 정확 버전 `1.5.2` 추가·lock·Chord `Context` import 두 곳(`/context`)·공식 emitter로 carrier 재생성·`run.sh` pin/probe·mutant floor pin literal·SDK 버전을 말하는 문서. affected focused. 병행: 격리 sandbox에서 1.5.0/1.5.2 scheduler race 두 경우 비교.
  - scheduler 비교 결과(SCHED `RESULT.md` sha256 `351c3136…2423`, 실무코디가 logs 10개를 직접 셈): upstream #11892 repro 그대로 1.5.0 stuck 10/10 → 1.5.2 settle 10/10. 내부 hook(`Session.touch` 가로채기, upstream 테스트 방식) a/b도 1.5.0 0/10 → 1.5.2 10/10. 공개 API만 쓴 hop fixture는 양쪽 모두 settle해 1.5.0에서 재현되지 않았다(조정하지 않고 그대로 기록). 격리 npm sandbox, 6 member만 설치, 모델·인증 0. Entwurf 실 소비점·native SQLite·부하 스윕은 미측정.
- [ ] **HOP 3 · 독립 리뷰·문서 감사 → amendment 한 묶음 → affected PARTIAL → frozen FULL.** 코드 리뷰는 구현과 다른 학교, 문서 감사는 SOL. 같은 파일 writer는 한 명.
- [ ] **HOP 4 · 운영 창과 Native/출하 수용.** 검수 TGZ·명명된 owner 정상 종료·전체 일관 백업(WAL/SHM)·설치 exit0/SDK 정합·같은 id 복귀·실제 turn/왕복·Native LIVE. 이어 release land/prepare/make는 `entwurf-release`의 각 권한 경계. 운영 창은 shipment 뒤로 고정하지 않는다(#155 선례: 검수 TGZ로 운영 창 → P5 → 출하).

# NOW

- **다음 한 행동:** HOP 2 — Terra 구현, Sonnet scheduler 비교(격리 sandbox).
- **정본:** [#158 본문](https://github.com/junghan0611/entwurf/issues/158)과 [최신 댓글 6781935626](https://github.com/junghan0611/entwurf/issues/158#issuecomment-6781935626). 반복 절차는 [setup: Default radius](docs/setup-clean-host.md#default-radius-for-a-requested-pi-sdk-upgrade)와 [Applying new source to a running host](docs/setup-clean-host.md#applying-new-source-to-a-running-host). #155는 완료된 1.5.0 출하 기록이며 그 영수증을 1.5.2로 승계하지 않는다.
- **운영 분리 관측 (2026-11-11 09:5x KST, 읽기만):** 떠 있는 pi-durable 운영 프로세스와 MCP bridge는 global pnpm store의 entwurf 0.51.0 GR `208e8c8d…`에서 로드한다(bridge 1개는 0.50.0). Claude Code user-scope `entwurf-bridge`는 global bin. 실행 중 프로세스 argv에 이 checkout 경로 0. ps/argv 관측이며 전이적 module 부재 증명은 아니다. 그래서 개발은 checkout 안 install/emit/build만 하고, global add/update·setup·install-meta·takeover·운영 dist 덮기·agent-config 모듈 변경은 하지 않는다. shared CA store를 이유로 무영향을 선언하지 않는다.

# GLG 직접 결정 — 2026-11-11 Oracle

- **release age 예외:** 1.5.2는 patch 버전이므로 예외를 두고 진행한다(게시 2026-11-10 12:20–12:25Z, 결정 시점 약 12h). setup 문서의 "자동으로 예외를 두지 않는다"에 대한 사람의 명시 결정이다. 정확 버전만 추가하고 광역 패턴·정책 비활성화는 하지 않는다.
- **진행 방식:** 이 브랜치와 브랜치 NEXT의 RAIL. 별도 todo 기능 없음. 실무코디가 이 브랜치에 집중하고, 운영코디에는 변곡점·실제 판단거리만 올린다. GLG DM은 운영코디가 한 사건 한 통.
- **구성:** 구현은 Terra(pi `openai-codex/gpt-6.1-terra:medium`, 아쉬우면 high). R0·scheduler 비교·코드 리뷰는 Sonnet(Claude Code). SOL은 실무자문. 문서까지 구멍 없이 정리하는 것이 목표이며, 구현 워커가 놓치는 문서 구멍·낡은 서술은 별도 눈이 맡는다.
- **미포함:** push·tag·npm publish·운영 창 실행·다른 시민 retire. 각각 별도 결정.

# 역할 — 공유 checkout, 파일 writer 한 명

| 이름 | backend | 맡는 것 |
|---|---|---|
| 운영코디 | pi-durable | GLG 대화·전체 맥락·DM·운영 창 협의. 실무 왕복은 받지 않는다. |
| 실무코디 | claude-code | 이 브랜치의 홉·워커 초빙·파일 경계·증거 대조·checkpoint commit·NEXT writer. |
| SOL | pi | 실무자문: 문서 구멍 감사(읽기), 최종 수용/보류 판정 2차 검토. |
| TERRA-158 `20261111T100029-c180ab` | pi gpt-6.1-terra:medium | 구현 writer: package/lock/workspace·pi-durable source·carrier·pin·run.sh·mutants·1.5.2가 깨는 test/gate. 리뷰 뒤 amendment. |
| SCHED-158 `20261111T100045-a047a0` | Claude Code sonnet | scheduler 비교(완료) → SDK 소비점 대조 → Terra diff의 독립 코드 리뷰. |
| R0 `20261111T095806-a36530` | Claude Code sonnet | R0(완료) → 문서 inventory(A 현재/B 역사/C 판단) → Terra 코드 동결 뒤 문서 writer. |

GLG: 워커는 일회용 턴이 아니라 이번 작업을 위해 초빙한 형제다. 끝날 때까지 퇴근 없이 함께 간다.

워커 기록(모델·effort·턴·리뷰 지적·재작업)은 홉마다 아래에 한 줄씩 남겨 추론 설정 판단 자료로 쓴다.

# 경계

- Offline: private HOME/PI/XDG/runtime, `TMPDIR=/tmp`, `pnpm_config_verify_deps_before_run=error`와 `npm_config_verify_deps_before_run=error`, ambient CI 없음. 운영 DB·auth·기존 시민 0.
- 개발은 이 checkout의 이 브랜치에서만. worktree/tmp 개발 clone 0. FULL 동안 tree/index 변경 0.
- `pi-durable` 공개 resume는 bridge-only라 원래 `--native-module`을 복원하지 않는다(#155 RETURN). 운영 재개는 원래 CLI+module을 그대로 준비한다.
- 첫 예상 밖 실패는 원문 보존 STOP. blind retry·gate 완화 0. 옛 영수증·옛 TGZ·옛 스크립트를 그대로 실행하지 않는다.

# 워커 기록

| 홉 | 이름 | 모델·effort | 턴 | 리뷰 지적 | 재작업 | 메모 |
|---|---|---|---|---|---|---|
| 2 | TERRA-158 `20261111T100029-c180ab` | pi gpt-6.1-terra · medium | 진행 중 | — | 설치 1회 STOP(다른 store-dir → modules purge 거절, 원인 확인 후 기존 store 명시로 재개) | 구현·유일 writer |
| 2 | SCHED-158 `20261111T100045-a047a0` | Claude Code sonnet · 자기보고 low | ~25 | 0 | 0 | 격리 scheduler 비교. 설치 전 `npm view`를 sandbox 밖 HOME으로 실행(~/.npm 캐시 읽기 조회 가능성 자기보고) |
| 1 | R0 `20261111T095806-a36530` | Claude Code sonnet · 기본 effort | ~15 | 0 | 0 | 읽기 측정, 2분 내 완료. issue 본문에 없던 비-member 변경을 찾아냄 |
