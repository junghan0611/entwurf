# NEXT — #158 / Pi SDK 1.5.0 → 1.5.2 (branch `feat/158-pi-1.5.2`)

# RAIL — 현재 좌표

- [x] **HOP 0 · 좌표·역할·브랜치.** main `88268f9`에서 브랜치, 문서 checkpoint `0897d6d`.
- [x] **HOP 1 · R0 측정과 소비점 preflight (읽기 전용).** registry 10종 1.5.2의 tarball SHA-512/SRI·게시 시각·tarball 안 exact edge·carrier 24 `distTargets` 존재. 실제로 참여하는 caller의 등록(MCP/start.sh/extension/launcher)이 이 checkout의 source/dist를 가리키는지 확인한다.
  - 결과(R0 `REPORT.md` sha256 `d0c5baa1…f45f`, 실무코디가 verify.json 10행을 직접 읽음): 10/10 sha512=integrity·sha1=shasum, 게시 12:20:34Z–12:25:15Z. member edge 16개 모두 exact 1.5.2, install scripts 0. 1.5.0 대비 비-member 변경: pi-coding-agent의 `grok-mermaid` 0.2.3 → `lovely-mermaid` 0.3.3(2026-08-15 게시, 실무코디 측정), chord optional peer `react` 19.3.0 추가. distTargets 24/24 존재(export 시그니처는 미측정). Codex/Copilot/OMP/Claude Code/pi 등록 모두 global 0.51.0을 가리키고 checkout 경로 0(Antigravity 미조회).
- [x] **HOP 2 · coherent 1.5.2 구현.** 10종 exact bump·`minimumReleaseAgeExclude`에 정확 버전 `1.5.2` 추가·lock·Chord `Context` import 두 곳(`/context`)·공식 emitter로 carrier 재생성·`run.sh` pin/probe·mutant floor pin literal·SDK 버전을 말하는 문서. affected focused. 병행: 격리 sandbox에서 1.5.0/1.5.2 scheduler race 두 경우 비교.
  - scheduler 비교 결과(SCHED `RESULT.md` sha256 `351c3136…2423`, 실무코디가 logs 10개를 직접 셈): upstream #11892 repro 그대로 1.5.0 stuck 10/10 → 1.5.2 settle 10/10. 내부 hook(`Session.touch` 가로채기, upstream 테스트 방식) a/b도 1.5.0 0/10 → 1.5.2 10/10. 공개 API만 쓴 hop fixture는 양쪽 모두 settle해 1.5.0에서 재현되지 않았다(조정하지 않고 그대로 기록). 격리 npm sandbox, 6 member만 설치, 모델·인증 0. Entwurf 실 소비점·native SQLite·부하 스윕은 미측정.
  - SDK 소비점(SCHED `CONSUMERS.md` `8c04c3b5…88a0`, 정적): 소비 symbol 118개 모두 존재, StoreStorage 소비 0. carrier가 소비하는 pi-coding-agent dist 24개 중 7개 JS 변경. 1.5.2 SqliteStorage.commit 쓰기 경로 재작성.
  - native SQLite cross-version(SCHED `sqlite/RESULT.md` `79dc46b7…5ec4`, 실무코디가 MANIFEST 12/12와 단계 로그 error 0을 확인): 1.5.0 DB를 1.5.2가 읽기만 reopen하면 파일 바이트 불변·entries/context가 1.5.0 reopen과 일치. 1.5.2 append(병렬 tool 60개) + compaction 후 close/reopen 일관. `durable_schema.version`=2 불변. downgrade 1회 정보: 1.5.0이 1.5.2-append DB를 열었다(rollback 보장 아님). 운영 규모·SIGKILL 중간·WAL 미체크포인트·동시 접근은 미측정.
  - TERRA 구현 후보(`review-r1/candidate.diff` `687fdbc7…7c75`, base 669315c, 15파일, .md 0): typecheck·emitter --write/--check·focused 7개 exit0(check-dep-versions green은 문서 되돌리기 전 snapshot). run.sh `PUBLISHED_ARTIFACT`를 0.50.0/1.4.0→0.51.0/1.5.0으로 교체, 0.51 영수증 미첨부 → SOL C1 판단 대기. gate가 묶는 문서 줄 ~13곳은 문서 레인에서 반영.
- [x] **HOP 3 · 독립 리뷰·문서 감사 → amendment 한 묶음 → affected PARTIAL → frozen FULL.** 코드 리뷰는 구현과 다른 학교, 문서 감사는 SOL. 같은 파일 writer는 한 명.
  - 코드 리뷰 r1(SCHED `review-r1/REVIEW-SCHED.md` `dd99447e…6532`): B0/D1/O5. D1 = 두 workflow의 `PI_INTEGRITY`가 1.5.0 SRI로 남음(실무코디 확인) → Terra 교정. r2(`review-r2/REVIEW-SCHED.md` `99801836…52a3`, 후보 `c81a4974…42b7`): B0/D0/O3. SCHED가 sandbox `npm pack @junghanacs/entwurf@0.51.0`으로 출처 주석의 두 해시를 독립 재현했다. mutant 1513개 find 1회·불일치 0, published 영역 6개 모두 gate 제한 안.
  - 문서: R0 inventory(`docs/INVENTORY.md` `f8ddc2af…c2c9`, A18/B17/C14) → SOL 의미 감사(`docs/AUDIT-SOL.md` `a26e9247…ddff6`) → R0 반영(*.md 10개) → SOL readback(`docs/READBACK-SOL.md`): r1 B0/D3/O4, r2에서 모두 닫히고 D4(published 영역 안의 옛 "0.83.x pi host" 문단; 공개 0.51.0 TGZ의 run.sh를 읽어 Entwurf가 PATH Pi를 올리지 않음을 확인) 4줄 교체 반영.
  - C1 결정: 단일 `PUBLISHED_ARTIFACT`를 공개 0.51.0 / SDK 1.5.0 10종으로 전진(교체). 옛 0.50 live marker는 평문 역사+링크. 출처 주석은 보존 release TGZ SHA256 `04fcce26…36e4d`와 raw `package/package.json` SHA256 `b5043ba8…96120`(SOL 계산, Terra·SCHED 독립 재계산 일치). 운영 GR `208e8c8d…`는 근거로 쓰지 않는다.
  - Terra 재측정(`amend-r1/`, 실무코디가 exit 9개 확인): check-dep-versions(14 range/2 exact/3 prose/published 6)·pack-pin-matcher·pi-import-surface·pi-runtime-version·pi-durable beside 111/carrier 77/native-module 14·sdk14-migration 9·storage-migration 11 모두 exit0. 이후 문서 D1–D4 변경이 있어 check-dep-versions는 PARTIAL 직전에 다시 잰다.
  - affected PARTIAL 그룹(Terra 선정, 실무코디가 변경 줄과 mutant find 위치를 독립 대조해 일치): `["bash","run.sh","check-dep-versions"]`(PI-CORE-PIN-TRACKS-FLOOR, PI-FLOOR-PUBLISHED-SCOPE/SINGLE-SOURCE/SDK-PRODUCTION-SET), `["bash","run.sh","check-pack-pin-matcher"]`(PACK-INSTALL-PIN-MATCHER-BOUNDED/COVERS-CLOSURE). carrier mutant의 find는 변경 줄과 겹치지 않는다.
  - PARTIAL(`partial-r1/`, 실무코디가 receipt 필드를 직접 읽음): dep-versions 5/5, pack-pin-matcher 2/2 KILLED, 둘 다 passed/control ok/treeClean/porcelainClean, candidate HEAD `669315cc` + workSurface `3bceca54…83d6`. 이번 SHA의 나머지 kill-power는 재측정하지 않았다(#144).
  - FULL: r1은 283초 exit1로 보존(`full-r1/`). `--ignore-scripts` 설치 뒤 build-bridge를 돌리지 않아 dist entry(11-04)가 `pi-extensions/meta-bridge-pi-durable.ts`보다 낡았다는 것을 `check-bridge-delivery`가 잡았다. 제품 결함 아님. `pnpm run build-bridge` exit0(빌드 전후 동결 4값 동일) → r2 `pnpm run check:full` **971초 exit0**(`full-r2/`). 동결 before(HEAD `669315cc`, index `800cce5f`, diff `e006e803…`, status `dd878564…`) = r2 after(실무코디 `cmp` 확인). 이 NEXT 갱신은 FULL 뒤 bookkeeping이며, 그 이후 tree 전체의 FULL로 승계하지 않는다.
- [ ] **HOP 4 · 운영 창과 Native/출하 수용.** ← CURRENT 검수 TGZ·명명된 owner 정상 종료·전체 일관 백업(WAL/SHM)·설치 exit0/SDK 정합·같은 id 복귀·실제 turn/왕복·Native LIVE. 이어 release land/prepare/make는 `entwurf-release`의 각 권한 경계. 운영 창은 shipment 뒤로 고정하지 않는다(#155 선례: 검수 TGZ로 운영 창 → P5 → 출하).

# NOW

- **다음 한 행동:** checkpoint를 push하고 exact-SHA CI(4 required jobs)를 확인한다. push는 GLG 승인 사항이다. 그다음 HOP 4는 GLG와 운영코디가 운영 창의 시점과 대상을 정한다. 그 창을 위해 검수 TGZ·container 수용·격리 전환 리허설을 준비한다(#155 선례). 아직 측정하지 않은 것: Native/LIVE, interactive TUI·50+ active 표시, Windows carrier, 운영 규모 DB·SIGKILL 중간 상태, workflow 실제 실행.
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
| 2–3 | TERRA-158 `20261111T100029-c180ab` | pi gpt-6.1-terra · medium | ~5 지시 turn | r1 D1(workflow SRI 누락) | 설치 1회 STOP(다른 store-dir → modules purge 거절, 원인 확인 후 기존 store 명시로 재개), 문서 범위 정정 1회 | 구현·유일 코드 writer. medium으로 충분했고 high 상향 필요 없었다 |
| 3 | R0 (문서 writer) | Claude Code sonnet | ~35 누적 | SOL readback D3+O4, D4 | 2회 보정 | inventory → SOL 문안 반영 |
| 3 | SCHED-158 (리뷰) | Claude Code sonnet · 자기보고 low | ~70 누적 | — | 0 | SQLite cross-version fixture, 코드 리뷰 r1/r2 |
| 3 | SOL `20261003T164401-a30dda` | pi gpt-6.1-sol | 4회 요청 | — | — | C1 구조 판단·공개 TGZ 직접 읽기·readback 2회 |
| 2 | SCHED-158 `20261111T100045-a047a0` | Claude Code sonnet · 자기보고 low | ~25 | 0 | 0 | 격리 scheduler 비교. 설치 전 `npm view`를 sandbox 밖 HOME으로 실행(~/.npm 캐시 읽기 조회 가능성 자기보고) |
| 1 | R0 `20261111T095806-a36530` | Claude Code sonnet · 기본 effort | ~15 | 0 | 0 | 읽기 측정, 2분 내 완료. issue 본문에 없던 비-member 변경을 찾아냄 |
