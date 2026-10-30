# NEXT — #153: 다이어트 검증 완료, 확장 입구 논의로 복귀

# RAIL — 현재 좌표

- [x] **1. 방향과 팀 형성.** 동일 기능을 유지하면서 확장 인터페이스를 먼저 마련한다. main/Astra/Opus가 함께 논의했다.
- [x] **2. 작은 추출안 철회·다이어트 구현.** 두 명령 위에 adapter/loader를 더하는 안은 접고 pure dev arm148개의 반복을 제거했다.
- [x] **3. Focused·독립 검수·수정 묶음.** 환경 함수 admission/target coverage/양성 실행 oracle을 보강했고 Astra159913이 D1–D3 폐쇄를 보고했다.
- [x] **4. 해당 PARTIAL·동결 FULL.** PARTIAL9/9, FULL922초 exit0, 전후 작업트리/index/dist 지문 동일. 이 체크포인트는 GLG의 요청으로 구현과 검증 결과를 함께 보존한다.
- [ ] **5. 확장 입구의 계약 논의.** ← CURRENT: 다이어트와 별개로 코어·선택적 확장의 경계를 논의한다. 새 구현/푸시/릴리즈 승인은 없다.

# NOW

GLG가 2026-10-30 『커밋하고 다음 논의 하자』고 요청했다. 커밋은 하되 **push는 요청하지 않았다**. 다이어트를 확장 그릇 구현이라고 부르거나 #153 전체를 닫지 않는다. 다음은 **확장이 무엇을 요청하고 코어가 무엇을 보장하는가**를 기존 계약에 대조하는 대화다. 코드보다 먼저 경계를 정한다.

## 유지할 제품 방향

- 코어는 명세의 핵심만 작고 견고하고 일관성 있게 유지한다. Cloudflare 연결·쿼터·자원 기반 선택은 향후 선택적 확장의 예이며 지금 구현할 목록이 아니다.
- 새 기능을 쌓기 전에 기존 기능이 인터페이스 뒤에서 같은 의미로 동작해야 한다. 파일 분할/주석 이동을 코드 단순화로 세지 않는다.
- CLI는 사람과 에이전트의 입구가 될 수 있지만, CLI registry가 곧 확장 계약은 아니다. 기존 run_ts와 domain seam을 먼저 이용하고 새로운 층의 삭제 효과와 비용을 함께 본다.
- main 직접 READ한 fresh-call-dispatch.ts는 명시적인 backend/model 검증과 현재 프로세스의 tmux/Herdr rail 선택을 소유한다. 쿼터 기반 후보 선택을 이 root 안에 넣어야 한다는 결론은 아직 없다. 정책 추천과 core 실행·권한 계약은 구별한다.
- 언어/framework/외부 plugin SDK·loader/자동발견/새설정/PATH expose는 아직 채택하지 않았다. #153 최신 GLG 댓글6391806564의 명령 진입로·tmux/Herdr 대칭 방향은 유지한다. Herdr pi-durable은 별도 검토다.

# RECENT — 다이어트의 변경과 증거

- main 직접 diff 집계: run.sh +18/−447(**429줄 감소**), check-install-surface.ts +165/−6, qualification tally +1, 새 mutant manifest109줄. 제품·검사4파일 합계 **160줄 순감소**이며 이 NEXT는 제외한다.
- operator/명시 dev arm/함수 본문/run_ts/usage를 유지했다. 함수명→개발 명령의 규약을 이용하되 실제 현재 source provenance를 조회 subshell에서 확인해 상속된 Bash 함수의 새 노출을 막는다. 전역 shopt/trap/registry/재source는 없다.
- Opus26f589/4682be: 기존148개 도달집합과 old/new 격리 byte 비교30/30, 수정 후 각 focused 명령의 실제 exit0. Astra2f8a97/159913: 삭제 범위와 D1–D3의 소스 독립 검수. main은 핵심 diff와 실패 로그·영수증을 직접 읽었다. 각자의 측정과 상속 보고를 섞지 않는다.
- main PARTIAL40741: exact argv `["bash","run.sh","check-install-surface"]`, **9/9 killed/control 전후 GREEN**. 전체1254 중1245는 실행하지 않았다. receipt `/tmp/entwurf-153-diet.ZHps1u/qualification.json`, origin headc0c432f/workSurface48fd2287bdf0c3936b1c652136859515cd338a7e829a7ad7f20e4c1c580c400e. 전체qualification/릴리즈 증거가 아니다.
- main FULL40835: **922초 exit0**(nativebackground15분23초). 명시적 격리 HOME/PI_CODING_AGENT_DIR/XDG/env에 TZDIR=/etc/zoneinfo를 포함했다. `full-retry-before.txt`와 `full-retry-after.txt`가 byte 동일하다. 로그 `/home/junghan/.pi/durable-background/1793361509482-94c2eee4.log`, 판독 `/tmp/entwurf-153-diet.ZHps1u/FULL-GREEN.md`.
- 검증 제품 해시: run.sh `89d693f01dc1728494dd49491a0dbed39cd98f4cb67a059f75fc05afabdbf05c`, gate `b8d243af6f58da8fa99edb147831574cb0dfea6848192dc1fd73fd062e679447`.
- 첫 FULL40774 exit1/283초는 main의 env-i에서 TZDIR를 누락해 date UTC/Node KST가9시간 갈린 fixture 실패다. 소스·시간 폭을 고치지 않고 GLG의 go로 환경만 보충했다. 실패는 FULL-RED.md와 원래 로그에 보존한다. r3의 무조건 echo rc0은 증거에서 폐기했고 단독 호출 exit로 대체했다.
- LIVE/실제 vendor 대화/cross-platform 운영 인증/새 릴리즈는 실행하거나 주장하지 않는다. 기존0.45.0 출하물·기록·운영 설정은 그대로다.

# 형제와 라우팅

- main `20261014T212756-68bd94`: 설계·검증 조율, 기기 oracle.
- Astra `20261030T185730-567753`: 설계·독립 검수. 자기보고 Pi/gpt-6-astra, exact callback dc032f.
- Opus `20261030T190810-915040`: 구현·focused. 자기보고 Claude Code/claude-opus-5-5, exact callback1f2cd4.
- 두 형제는 현재 추가 편집/검사 없이 대기한다. 현재 liveness는 필요할 때 rail에서 다시 확인하며 기록만으로 재개하지 않는다. 별도 peer 조율 lane/새 형제/임의 퇴근 없음.

# GUARDRAILS

이 checkout의 브랜치만 사용하고 worktree/개발 clone/운영 설치·인증 변경은 하지 않는다. record 주소 권위·live-fact·receipt·거절·lifecycle 요청 범위·exec/PID/argv/stream/source-installed 의미를 보존한다. 첫 RED/deps/wrapper 오류는 증거 보존 후 STOP, 명시 GO 전 자동 수선·재실행 없음. pnpm verify_deps=error, install --ignore-scripts. 검증은 host secrets를 복제하지 않는 sandbox 환경으로 하고 Nix 시간대에는 TZDIR도 명시한다. 커밋 본문에 실제 기기와 이미 참여한 garden IDs를 남기되 명부를 새로 찾지 않는다. push/release는 별도 요청 때만 한다. branch NEXT는 durable 결과를 승격한 뒤 merge 전에 삭제한다.
