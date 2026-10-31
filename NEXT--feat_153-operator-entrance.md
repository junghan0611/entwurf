# NEXT — #153 operator-first help

# RAIL — 현재 좌표

- [x] **1. CLI 기반·operator entrance.** 11f922d → c90ff8b → 46fcbfd, 각 push/CI 완료.
- [x] **2. 읽을 수 있는 root 화면.** 45줄/15명령과 help all 분리, 영향·실제 consumer 검사 및 독립 검수 완료.
- [ ] **3. 로컬 checkpoint → 최종 검증.** ← CURRENT: 정상 checkpoint commit 뒤 동일 후보의39 PARTIAL·frozen FULL을 닫는다. 새 push 승인 없음.

# NOW

- **Next:** main이 아래 UI+proof를 정상 훅 checkpoint C1으로 저장한다(아직 없으면 먼저 commit). 이후 main의 한정 GO로 exact `["bash","run.sh","check-install-surface"]` 39-mutant PARTIAL 한 번 → raw receipt 검수 → 별도 GO의 frozen FULL 한 번. 이 순서 동안 source/index/NEXT는 고정한다. 자기 SHA는 `git log -1`로 확인한다.
- **승인:** GLG가 실제 Herdr에서 긴 기본 help를 보고 pi --help 같은 정리를 요청했고, 다시 취침하며 의미 있는 중간 commit과 짧은 완료 DM을 요청했다. 새 작업은 local checkpoint commit까지 승인됐으며 **push/merge/release/운영전환/LIVE는 미승인**이다. checkpoint는 qualification/FULL/CI 합격을 대신하지 않는다.
- **범위:** root overview / `help all` documented catalog / 기존 command page. 새 실행명령·하네스/SDK/모델·auth·설치·manager/loader 없음. 192개 긴 설명과89개 debt, 기존 실행 case/독립 legacy oracle 보존. 전체 산문 정확성·기능대칭·Herdr pi-durable 지원을 인증하지 않는다.
- **소통:** Opus915040 구현/측정, Astra567753 source/proof 독립검수, main68bd94 범위/NEXT/commit/DM. 노트북b22677 외부 UX 검수는 cbf6d2로1회 종료했고 추가 연락/새 형제 호출은 하지 않는다. 새 계약/막힘/완료 bundle만 main 경유로 짧게 공유한다.
- **복귀:** 최종 검증 뒤 사용자에게 `entwurf` → `entwurf help <command>` → 필요하면 `entwurf help all`로 실제 가독성을 다시 보게 한다. 설치/PATH를 바꾸거나 새 terminal 실험을 늘리지 않는다. GLG가 말한 불편이 줄었는지가 줄기다.

# RECENT — 현재 subject/proof

- **실제 관측:** GLG가 Oracle Herdr를 직접 열어 command-v 결과 ~/.local/bin/entwurf를 붙였다. main은 fs-read로 현재 checkout/run.sh를 확인했다. 이후 GLG가 ‘텍스트가 너무 많아 무엇을 볼지 모르겠다’고 직접 수정 요청했다. 과거의 미지정 terminal 탐색은 종료했다.
- **UI/authority:** schema3의 root가 기존 catalog entry 이름을 참조해 synopsis를 재사용한다. renderer는 module-relative JSON + node builtins만 읽고 모든 view를 검증한 뒤 출력한다. `help all`은 예약된 read-only view, dispatch 등록이 아니다. vendor passthrough/거절/Unknown/EPIPE 유지.
- **독립 oracle:** main이 먼저 고른 `test/fixtures/cli-help/root-compact-153.txt` SHA `30176fa0a2e8598a2ffca98c0e2c4ac773f57dc3428042e15286c87e2b8832ae`. 기존 ce92 fixture/sha/literal amendments/case pin은 바뀌지 않고 catalog로 관측점을 명시 이동했다. command-page 내용은 catalog/details fixture에 묶인다.
- **Focused main 직접 읽음:** `/tmp/e153h/root-help-r1/code/21-install-surface.log` 전체 S8/S9 PASS, 16-json-fixtures.log의 canonical/legacy usage 동일/세fixture SHA, syntax·surface·manifest·lint·typecheck·consumer 8exit 모두0. manifest1327/92는 committed mutants0실행이다. 기존lint27warnings/6infos 유지.
- **실제 consumer:** 25-pack-install.log/exit0를 main이 전체 읽었다. 같은 tarball/npm tree의 root/help all bytes parity, root.title 변경/renderer 제거 negative와 원본복원, 기존 #153 operator roundtrip 유지. help all에는 별도 origin-negative를 실행했다고 주장하지 않는다. source status 전후 동일은 Opus 보고다.
- **검수:** Astra4bc945 source/consumer checkpoint closure(0Blocker/Defect). main도7파일diff·renderer·실제45줄stdout을 읽었다. AGENTS20의 새 view 설명만04ce95로 추가하고 main이 직접 읽었다. 외부cbf6d2는 화면만 보고 다음 명령/상세·전체 발견에 오류 없음, 설치/기능 검증 아님.
- **Proof 상태:** CLI lane31, 전체1327/92. 신규 ROOT-COMPACT/ALL-ROUTE/ROOT-NAMES-REAL, 기존 ROOT-BYTES는 ALL-BYTES로명시이동. exact install-surface group은 **39개(이lane30+dev-dispatch9)**다. 변경 없는 PRUNE-HELP-POINTER는 다른 smoke group에 있으며 이번 affected group에 없다. kill-power/FULL/새 CI는 아직 미측정. 이전36group937초 근거 약20분 예산, 전체body 실행 금지.

# 보존 / 경계

- 첫 RED는 `root-help-r1/code/18-install-surface.log` exit1/S8 네 FAIL이다. 옛 Usage-prefix가 새 compact 첫줄과 불일치했다. main 원자료/소스 읽기 뒤 df3b6c로 독립 literal 첫줄+LF/두 prefix 조건만 수선 GO,21 PASS. 원RED를 지우거나 제품dispatch 실패로 합치지 않는다.
- 이전 긴 NEXT는 `/tmp/e153h/root-help-r1/NEXT-before-C1.md`, 46fcbfd frozen NEXT는 `/tmp/e153h/laptop-amend/NEXT-frozen-46fcbfd.md`. 이전 Meta/CLI probe 오류와 과거 seal drift/manifest RED/무승인 재개 등은 그 ledger/원자료에 보존했다.
- 46fcbfd의 FULL948초·PARTIAL25·CI41205248028은 그때 후보의 증거다. 새 UI 후보의 합격으로 재사용하지 않는다. #153 공개기록은 issuecomment6544060803까지이며 새 UI는 아직 로컬 checkpoint다.
- 첫 예상 밖 오류는 원자료·개별 exit를 보존하고 STOP. named GO 전 수선/재시도 없음. 검증 중 source/index/NEXT 수정 금지. 새 의존 설치/일반cleanup/기록 삭제/임의 sibling 생성·resume·retire 없음. Org/글/homepage/autholog는 건드리지 않는다. DM은 main만, 의미 있는 사건마다1회.
- 이 checkout/`feat/153-operator-entrance`만 사용. worktree/개발 clone 없음. 정상 hooks/공유scanner만, unsafe/no-verify/force 금지. 새 push 승인 전 agenda 도장도 추가하지 않는다. merge 전 branch NEXT는 durable 승격 후 제거한다.
