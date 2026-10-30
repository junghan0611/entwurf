# NEXT — #153: 기능을 늘리기 전에 입구를 단순하게

# RAIL — 현재 좌표

- [x] **1. 현재 계약·관련 소스 확인과 팀 형성.** main `c9b3c4b`에서 이 브랜치를 만들었다. Astra와 Opus의 exact callback을 확인했다.
- [x] **2. 작은 추출안 재검토.** 두 명령 위에 등록·로더를 더하는 안은 내려놓았다. 구현 편집은 0건이라는 Opus 보고를 받았다.
- [ ] **3. Opus와 전체 입구의 설계 합의.** ← CURRENT: 삭제할 중복과 새 복잡도를 비교하고 기존 동작 보존을 설명한다. 납득되는 안을 main과 합의한 뒤 구현한다.
- [ ] **4. 구현·영향 검증·독립 검수.** 설계가 기존 기능만 다루는 범위에 한정한다. 출하 검증과 commit/push는 각 권한을 구별한다.

# NOW

GLG의 최신 요청(2026-10-30 19:33): 설계 체크포인트를 커밋하고, 더 물을 제품 결정이 없다면 Opus와 논의해 납득한 뒤 구현을 맡긴다. **커밋 요청은 push 승인이 아니다.** 이전 작은 추출안의 구현 GO는 철회 상태다. 새 안의 기술적 합의가 있기 전 코드·테스트 실행을 재개하지 않는다.

다음 행동은 Opus에게 아래 조사 결과를 전달하고, 입구 전체의 명령 정의·안내·실행 연결에서 무엇을 실제로 대체할지 논의하는 것이다. 작은 추출안을 다시 살리거나, 일반 플러그인 플랫폼을 먼저 구현하지 않는다. 새 제품 동작·권한·운영 설치 변경이 필요하면 GLG에게 돌아간다.

## 유지할 제품 방향

- 코어는 명세의 핵심을 작고 견고하고 일관성 있게 유지한다. 확장은 Herdr만이 아니라 Cloudflare 연결, 쿼터·자원 기반 후보 선택 같은 선택적 책임도 담을 수 있어야 한다.
- **기능 추가 전에, 같은 기능이 인터페이스를 통해 동작하게 한다.** 향후 예시들은 이번 기능 구현 목록이 아니다.
- CLI 언어·framework·공개 plugin SDK·외부 로더·자동발견·새 설정·PATH 노출은 아직 채택하지 않았다. 파일을 나누거나 주석을 옮기는 것만으로 단순해졌다고 세지 않는다.
- #153의 본문은 제안이고 최신 GLG 댓글6391806564가 방향을 소유한다. tmux/Herdr 대칭을 향하되 하네스 지원 폭을 무작정 넓히지 않는다. Herdr pi-durable은 별도 검토다.

## 읽고 논의한 결과 — 근거 상태

- main 직접 READ: `package.json:213–214`의 entwurf는 `run.sh`다. `run.sh:70–86`의 run_ts가 source TS/installed JS 경계를 이미 소유한다. usage/case/개발 검증이 한 파일에 혼재한다.
- main 직접 READ: `scripts/check-install-surface.ts:79–179`의 S1/S2는 run.sh의 함수·case에서 TS 대상을 복원한다. 호출을 새 파일로 옮기고 이 검사를 그대로 두면 대상이 빠졌는데도 GREEN일 수 있다. 증명을 약화해 줄인 코드는 단순화 이익으로 계산하지 않는다.
- main 직접 READ: `scripts/check-peer-facts.ts:315–328`은 기존 case/run_ts/help 위치·build include·pack 경로를 고정한다. `package.json:41–95`는 scripts/를 배포하지만 plugins/herdr/는 배포하지 않는다.
- Opus 직접 READ 보고 `c96efb`: 기존 Herdr build/activation gate는 mjs를 직접 실행하고 peer gate도 TS를 직접 실행한다. 이 PASS를 CLI 입구 동등성 증거로 대체할 수 없다.
- Astra 직접 READ·집계 보고 `cfd748`(main 미재집계): 낮은 변경 위험의 동형 후보 네 개는 omp-receive-facts/meta-bridge-prune/meta-facts/peer-facts. case46줄은 주석30+label/terminator8+실행문8이며 help4줄이다. 실행문6줄 절감만으로 새 명령 reader/분기/help 연결·증명을 정당화하기 어렵고 기존 S2 reader도 사라지지 않는다.
- Astra `4308a6/cfd748`와 main: 앞선 두-leaf 등록/로더안은 내려놓는다. 현상 유지는 그 작은 추출안에 대한 결론이지 확장 입구 목표 자체의 기각이 아니다. 전체 명령 모델은 아직 설계하지 않았다.
- Astra 정정 `94bc6b`: doctor-pi-provider는 독립 usage 행이 없다. 이전 표의310은 doctor-agy-bridge다. 후보 네 개의 집계에는 영향 없다.
- Opus 정지 보고 `716294`: 편집0, git diff 비어 있음, 실행 중 작업·테스트·빌드·설치 없음. main도 체크포인트 전 git status/diff에서 이 NEXT 이외 변경이 없음을 확인했다.

## 현재 형제와 인계

- main: `20261014T212756-68bd94` — 설계·계약·검증 라우팅. 현재 작업 기기 oracle.
- Astra: `20261030T185730-567753` — 설계 논의. callback `dc032f`, 자기보고 Pi/gpt-6-astra. 설계 조사만 했으며 별도 실행 lane 없음.
- Opus: `20261030T190810-915040` — 실무. callback `1f2cd4`, 자기보고 Claude Code/claude-opus-5-5. 작은 추출안은 중단했고 새 설계 논의를 기다린다.
- 이전안의 상세 로컬 기록은 `.tmp-verify/153-operator-entrance/DESIGN-AND-SCOPE.md`에 **보류된 안**으로 보존한다. 현재 구현 지시로 쓰지 않는다.
- 참여자 간 별도 조율 lane을 열지 않고 main으로 모은다. 생성·논의는 임의 퇴근 권한이 아니다.

# GUARDRAILS

- 이 checkout의 브랜치만 사용한다. worktree/개발 clone/운영 PATH·설정·설치·인증 변경 없음. records/native transcript/DB·기존 증거는 보존한다.
- record 주소 권위, 현재 사실 재검사, receipt/거절의 의미, delivery와 lifecycle 분리, operator 요청 범위를 바꾸지 않는다. exec/PID/argv/streams/exit/source-installed 경계를 무심코 정규화하지 않는다.
- 같은 사실의 중복을 대체하되, 선언에서 검사 기대값까지 전부 생성하는 자기검증은 만들지 않는다. 새 등록/선택/로드 상태가 정말 필요한지 먼저 묻는다.
- 구현 합의 뒤에도 영향 focused → 독립 검수 → 한 amendment → 해당 PARTIAL → 동결 FULL의 순서를 지킨다. 첫 RED/deps/wrapper 실패는 영수증을 보존하고 STOP한다. 자동 수선·재실행·unsafe override 없음.
- pnpm에는 `pnpm_config_verify_deps_before_run=error`, install에는 `--ignore-scripts`. 필요 없는 dist build/설치/FULL/LIVE는 돌리지 않는다. fixture는 sandbox HOME/PI_CODING_AGENT_DIR/XDG와 명시적 환경만 쓰며 host secrets를 로그에 복제하지 않는다.
- 커밋 body는 실제 기기와 이미 아는 참여 garden IDs만 남긴다. push/release는 별도 명시 요청 때만 한다. branch NEXT는 durable 결과를 승격한 뒤 merge 전에 삭제한다.
