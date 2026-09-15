# NEXT — feat/116-herdr-coexist (herdr 위에서 herdr를 존중하는 확장)

> 브랜치 전용 boot sector. main `NEXT.md`는 건드리지 않는다. 머지 전에 이 파일을 지운다.
> 좌표(공개 SSOT)는 #116 본문이고, 이 레인의 측정·제안 원자료는 `.agent-reports/`(gitignore)다.
> 분기 SHA `0c8a42c`. 코디네이터 fable(`20260914T140615-b2e9e2`), 측정·제안 opus(`20260914T141356-6a5a8f`).

## 이 레인이 무엇인가 — 한 줄

**목표는 하나 — `herdr-entwurf`: herdr 위에서 도는 Entwurf.** 파일럿은 `pi | claude-code`이고,
**mux(tmux) 레일은 한 줄도 건드리지 않는다.** herdr 안에서 동작하는 세션이면 herdr를 존중하는 두 번째
레일을 옆에 세우는 일이다. 예쁜 작업대와 공구함은 herdr 것이고, 드라이버(garden id·공식 배달·영수증·
이름 붙은 거절)가 우리 것이다. `[#116 본문 = 공개 SSOT, 2026-09-14 수선본]`
`entwurf_v3` 완전 뺄셈은 이 레인이 아니다. 뺄셈 판단은 이 레인이 끝난 뒤 `0c8a42c` 베이스라인(오라클·thinkpad 동일)에 대고 따로 한다.
이 레인은 뮤턴트가 **는다**. 정상이다. 뺄셈 성적표와 섞지 않는다.

`[결정 GLG 2026-09-14]` 공존 구조. `[결정 코디네이터, GLG가 뒤집을 수 있음]` 공존 = **두 레일**(형제 모듈 신설).
한 레일의 두 backend가 아니다 — `mux-placement.ts:135-142`의 Placement는 추상 포트가 아니라 tmux 좌표 구조체라서 합치는 비용이 최소가 아니다.

# RAIL — 현재 좌표

- [x] **0. F-0 측정** — herdr가 연 형제가 콜백 nonce 없이 garden id를 받고 `entwurf_v2`로 닿는가. claude 성립 / pi는 `-- --entwurf-control` 넣으면 성립. 오라클 베이스라인 thinkpad와 전 칸 일치. `.agent-reports/116-oracle-f0-measure-20260914.md`
- [x] **1. S0 · herdr 증거 등급 측정** — 측정 완료 2026-09-14. **결정론 가능**(placement 절반). 샌드박스 HOME/XDG에서 `herdr server`가 자기 소켓으로 뜨고, 클라이언트 attach 없이 `workspace create` → `pane split` → `pane read` → `pane close` → `server stop`이 전부 돈다. 오퍼레이터 서버 스냅샷 전후 IDENTICAL
- [x] **2. S1 · `entwurf_peers` placement 관측 축** — 커밋 `d96a02f` + 후속 `469b3b5`(솔 D5/O4). 레코드 무변경 확인. `pi-extensions/lib/herdr-placement.ts`(순수) + 한 listing당 1회 읽기 + `placement` 칸. 어휘 4개(`unobserved`/`none`/`ambiguous`/`herdr <pane>`). `docs/mux-launch-rail.md` §7 제3 exact evidence + §7-a 신설. 게이트 `check-herdr-placement` 17 assertions, 뮤턴트 lane `herdr-placement` 8개 전부 KILLED
- [x] **3. S3 · pi argv 안내(문서)** — `d96a02f`에 동승, 코드 0줄. `README.md` §Garden launcher에 **Opening pi inside herdr** 단락. 자리 이유: 그 절이 이미 "pi가 launch에서 어떻게 시민이 되는가"를 소유한다(`pi --entwurf-control`이 거기 있다). herdr는 하네스가 아니라 배치 소유자이므로 `docs/adding-a-harness.md`가 아니고, `docs/mux-launch-rail.md`는 tmux 레일로 남긴다. placement 칸은 §7-a로 링크만
- [x] **4. S2 · herdr fresh-call 형제 모듈** — 완료. S2-a 중립 leaf `06a60e9` → S2-c 레일 코어 `ece9cb0` → 샌드박스 게이트 `5c904a4` → CI 공급 `ec051fd` → 표면 준비 `e8df274` → 공개 배선 `2f97fc0`. 그 뒤 C4 LIVE가 찾아낸 결함 둘을 수선: `d8c85b2`(control socket async 절단 생존) · `5c1f68b`(herdr CLI 비동기화). 이 레인의 무게 전부. `pane split` → `agent start --kind <k> --pane <id> -- <argv>`. 고아 pane 회수를 receipt에. 순서는 수선된 #116 본문 §Implementation rail 그대로 — **S2-b** identity 측정 셀(코드 0줄, 먼저) → **S2-a** 중립 leaf(순수 리팩터) → **S2-c** herdr 모듈 + 격리 게이트. *(측정이 먼저인 이유: 무엇이 진짜 공유 조각인지는 identity 프로토콜이 정하는데, leaf를 먼저 빼면 그 결정을 추출 순서로 미리 못박는다.)*
  - **계약 `[솔 큰 틀 검수 반영, 2026-09-14]`** — 착수 전에 닫힌 것 셋:
    - **B1 (Blocker였음): 고아 pane 회수는 조건부 close다.** herdr `close_pane`은 `PaneTarget{pane_id}`만 받고 pane id/agent name은 한 서버 scope다 — bare id로 닫으면 restart/handoff 뒤 남의 view를 닫을 권위가 없다. split 영수증의 `terminal_id`를 들고 `pane get` → `terminal_id` 일치 **그리고** `agent_session` 없음일 때만 close. receipt 어휘는 `closed`(검증한 terminal_id + 시각) / `orphan-unreclaimed`(불일치·get 실패·close 실패, 이유를 이름으로). get→close 사이 TOCTOU가 남는다는 것을 문서에 적는다. **`[S2-b 측정으로 확정, 2026-09-14]`** 이제 이것은 API 독해가 아니라 영수증이다 — 격리 샌드박스 서버에서 `server stop`→재기동 시 **같은 pane id 셋(`w1:p1`·`w1:p2`·`w1:p3`)이 전부 다른 terminal_id에 다시 묶였다**(`term_65b6d90e…` → `term_65b6d916…`). 따라서 **`terminal_id`도 세대를 넘지 못한다**: 계약 문구는 "terminal_id가 소유를 증명한다"가 아니라 **"한 서버 세대 안에서 증명한다"**여야 하고, 재기동 뒤 stale 영수증은 항상 불일치로 떨어져 `orphan-unreclaimed`가 정답이 된다(fail-closed 방향이라 안전).
    - **D1: `--kind`는 runtime 사전 증명이 아니다.** herdr는 enum을 bare executable 문자열로 바꿔 셸에 쓰고 detection을 기다린다(`src/app/agents.rs:145-231 @ c77af189`) — PATH를 사전 resolve하지 않는다. herdr 레일에서는 **pre-mutation runtime proof를 포기한다고 이름 붙여 적고**, 우리 프로세스 PATH의 `resolveRuntimeOnPath`는 "proxy(같은 env 보장 없음)"로만 쓴다. timeout/blocked/alias/PATH의 post-mutation 실패 매트릭스를 거절 이유로 갖춘다.
    - **D3: herdr 레일 지원 집합은 `pi | claude-code`로 닫는다.** `HERDR_ENV=1`에서 copilot/omp/codex fresh 요청은 pre-mutation named reject. tmux fallback 금지(Rule 5), herdr `--kind` enum이 크다는 것을 지원 증거로 읽지 않는다.
    - **D2 (착수 순서): 중립 leaf 먼저.** herdr 모듈은 `mux-*`를 import하지 않는다. `buildBackendArgs`/`buildFreshCallPrompt`/`mintNonce`를 중립 composition leaf로 추출하고 둘이 그걸 import한다. 구조 게이트: herdr→`mux-*` 0건, `entwurf-v2-*`→herdr 0건. 순수 리팩터 커밋 하나.
    - **identity — S2-b 측정 셀이 정한다(GLG 노트, 2026-09-14).** GLG의 llmlog `~/sync/org/llmlog/20260914T161103--herdr-entwurf-delivery-비교표…org` §「#116 별동대 가설 — birth witness」가 후보 계약을 준다: `herdr agent start`의 **direct `agent_started` 응답**이 실은 `agent_session`(nativeSessionId) → exact-one V3 레코드 검증(backend/cwd/source 대조) → garden callback envelope `{nonce, nativeSessionId, gardenId}`. **snapshot/`pane list`를 뒤져 조인했으니 nonce를 지운다는 결론은 금지**("fresh identity arrives only through its callback envelope, never a lookup"). 여섯 관측을 전부 재야 한다: (1) direct 응답의 `agent_session`이 `kind: id`(claude)/`path`(pi)로 오는가 (2) 그 id의 V3 레코드가 정확히 하나인가 (3) `source/agent` ↔ `backend/cwd` 일치 (4) snapshot 없이 direct 응답 → envelope 구성 가능 (5) 그 garden id로 `entwurf_v2` → 공식 rail receipt (6) pane move 뒤 garden id 유지, pane exit 뒤 다른 native session으로 조용히 재결속하지 않고 honest reject. **하나라도 실패하면 그 모양이 entwurf가 계속 소유할 계약의 이름이다.** 성립하면 model-mediated nonce의 일부를 direct native-start receipt로 바꿀 후보가 되고, 불성립이면 nonce 콜백은 v3에서 덜어낼 물건이 아니다. 두 프로토콜을 fallback chain으로 섞지 않는다.
    - **`[S2-b 측정 완료 2026-09-14 — 여섯 칸 전부 성립]`** `.agent-reports/116-s2b-birth-witness-20260914.md` · #116 코멘트 `issuecomment-5661519488`. 시민 둘(claude `20260914T175029-d7b623` / pi `20260914T175053-2ef8f6`)을 열고 닫았다. (1)(2)(3) direct 응답에 공식 삼중이 있고 exact-one 레코드로 풀리며 `source/agent`↔`backend`, `cwd`↔`cwd` 일치 — **pi는 경로 문자열 전체로 검색하면 0건**이라 파일명→uuid 변환이 선택이 아님이 대조로 증명됐다. (4) envelope 구성 가능: **레코드가 direct 응답보다 먼저 존재한다**(claude 레코드 08:50:29.514Z < 응답 08:50:31.053Z / pi 53.405Z < 54.943Z) → watcher·retry 없이 **1회 조회**로 충분. `[미검증 잔여]` 표본 2개 + 구조 논거일 뿐 herdr의 보장이 아니다 — "레코드가 아직 없음"을 **이름 붙인 거절**로 둘지 **상한 있는 1회 재읽기**로 둘지는 S2-c의 계약 결정이다. (5) claude mailbox `enqueued` → 실제 **읽음 영수증** `lastReadAt=08:51:28.718Z`(7초, 형제가 직접 드레인) / pi `control-socket → sent`. (6) **워크스페이스 이동에서 좌표가 `w7:p3`→`w8:p2`로 바뀌어도** `terminal_id`·`agent_session` 불변이고 현행 프로덕션 조인 leaf가 새 좌표를 정확히 따라갔다; 종료 뒤에는 해당 시민만 `none`(조용한 재결속 0). 한 세대 안에서 좌표 재사용 없음(`w7:p3` 해제 뒤 `w7:p5`→`w7:p6`). 조건부 close 4건 전부 MATCH→`closed`, `orphan-unreclaimed` 0건, 오퍼레이터 스냅샷 전후 IDENTICAL, 레코드 md5 불변.
    - **결론(섞지 않은 채로):** direct witness는 **성립한다**. 그러나 그것이 nonce를 은퇴시키지는 **않는다** — nonce가 소유하는 것은 형제의 **첫 모델 행동과 프레이밍**이고, direct witness가 소유하는 것은 **호출자 측 즉시 상관짓기**다. 다른 물건이라 한쪽을 다른 쪽의 fallback으로 엮으면 실패 모드가 합쳐진다. 어느 프로토콜로 herdr 레일을 낼지는 **GLG의 결정**이고, S2-b는 direct witness 칸을 전부 채웠을 뿐이다.
  - **증거 등급 `[S0 측정 + GLG 결정, 2026-09-14]`: placement·argv·회수·조인 전부 결정론(격리 private 서버 + 샌드박스 integration install) / 콜백 왕복만 LIVE.** 게이트가 샌드박스 `HOME`/`XDG` 안에서 `herdr integration install pi`(필요하면 claude도)를 직접 불러 `agent_session`이 채워지는 것까지 격리 서버에서 증명한다. S0이 잰 것: 헤드리스 서버·`workspace create`·`pane split`·`agent start`가 전부 클라이언트 attach 없이 돌고, `herdr integration status`가 샌드박스 HOME 경로를 그대로 따른다(설치가 샌드박스에 갇힌다). Hard Rule 17은 이 걸음을 막지 않는다 — 설치되는 것은 herdr 자기 바이트이고, 하네스 바이너리·구독·자격증명은 여전히 공급하지 않는다. tmux 대응: `check-mux-placement-tmux`(격리 서버) ↔ `smoke-mux-fresh-call-live`(LIVE)의 갈래와 같은 모양
- [ ] **5. S5 · herdr 플러그인 껍데기** — **M2로 이관, 미착수.** `[결정 GLG direct 2026-09-14 밤]` M2는 `herdr-plugin` 사용자면으로 확실히 간다: Herdr가 사용자면·배치·runtime 상태의 중심, Entwurf는 garden identity·공식 delivery·receipt. 방향은 **공장을 하나 더 짓는 것이 아니라 공방의 드라이버만 남기는 것**이다. GLG 실사용 뒤 착수 판단
- [ ] **6. S4 · resume herdr placement** ← PAUSED: herdr native session restore(`resume_agents_on_restore` 기본 on, `session-state.mdx:52-70` @ c77af189) ↔ `entwurf_resume_call` 소유권 충돌 미측정. 이 랩 밖. herdr 서버 재시작이 우리 pi 시민을 되살렸을 때 garden id 거동은 레인 종료 전 1회 재야 한다. `[S2-b가 절반만 좁혔다]` 재기동 시 **pane id는 재사용되고 terminal_id는 새로 난다**는 것까지는 격리 서버에서 쟀지만, 그 실험에는 **에이전트가 없었다**(맨 셸 3개) — restore가 에이전트를 되살렸을 때 native session이 같은지 새로 나는지가 정확히 S4의 미측정 칸으로 남는다

- [x] **7. M1-b · 배치 정책 교체 (split → 같은 workspace의 새 tab)** — `[GLG direct 승인 2026-09-15]` 구현 + **교차검수 amendment 1회 + C4 LIVE PASS**를 checkpoint로 묶었다. 측정 → source → focused gate/mutant → docs → C4 → 이 문서. qualification/`check:full`은 GLG 스케줄로 checkpoint 뒤 별도 후속. 상세는 아래 NOW의 「M1-b」 절.

현재 좌표: 0·1·2·3·4 완료 → **M1 complete; corrected C4 LIVE PASS** → **7(M1-b 배치 교체) checkpoint 완료** → qualification/`check:full` 후속 → 5(M2 plugin) 미착수 → 6 보류

# NOW

**상태명(정확히 이대로 쓴다): M1 complete; corrected C4 LIVE PASS.**
`[close 승인: 코디네이터 sol, 2026-09-15 — Blocker 0]` C4 PASS는 **이 opt-in 수용의 판정**이다. release aggregate 통과도, 전량 qualification도 뜻하지 않는다 — C4는 여전히 `check:full` 밖이고 aggregate 밖이다(VERIFY.md 문장). #116은 M2를 위해 **OPEN으로 유지**한다.

- Landed: 브랜치 `feat/116-herdr-coexist` = `2f97fc0`(공개 배선) + **`d8c85b2`** + **`5c1f68b`** + **`6684c41`**(C4 acceptance artifact) + **`8e5857d`**(레일별 C4 oracle 수선) + **`8f6c4fb`**(착지한 계획의 미래시제 산문 수선) + 이 문서. `LIVE=1 ./run.sh smoke-herdr-fresh-call-live`는 `8e5857d`에서 **exit 0, 29 assertions ok, 1m49s**, 영수증 `/tmp/herdr-fresh-call-live-exr8fL/receipts.md`. 전부 푸시됨.
- **CURRENT: M1-b checkpoint의 qualification/`check:full`을 별도 후속한다.** #116에는 C4 PASS와 미실행 floor를 함께 기록하며, M2 `herdr-plugin`은 조사 메모를 토대로 별도 착수 판단한다.

## M1-b — 배치 정책 교체 (split → 같은 workspace의 새 tab) `[checkpoint]`

`[결정 GLG direct 2026-09-15]` 새 형제 기본 배치를 **caller와 같은 workspace의 새 tab + `--no-focus`**로 바꾼다. `[GLG 직접 관측 2026-09-15]` split도 실제로 잘 됐지만 쓰기에는 새 tab이 편했다. **새 공개 placement/layout 선택축은 만들지 않았다** — 정책은 여전히 하나뿐이다. tmux 레일과 `entwurf_v2` delivery는 한 줄도 건드리지 않았다.

**측정 먼저 (격리 private Herdr server, herdr 0.9.0, oracle, 2026-09-15).** 오퍼레이터 서버/pane 무접촉 — 측정 전후 `pane list`/`tab list`/`workspace list` 스냅샷 동일, private 서버 둘 다 teardown, 소켓 회수. 원자료 `.agent-reports/116-m1b-tab-placement-measure-20260915-round1.txt`(1차) · `…-round2.txt`(2차) — gitignore라 호스트 로컬이므로, **결정적인 줄은 전부 `docs/herdr-launch-rail.md` §5·§7에 옮겨 적었다**(다른 호스트의 형제는 그 문서만 읽으면 된다).

- `tab create` 응답은 `{"result":{"root_pane":{…},"tab":{…},"type":"tab_created"}}` — **새 tab과 그 initial pane을 한 번에** 준다. `pane list` diff 불필요.
- `--no-focus` 지켜짐(`root_pane.focused`/`tab.focused` 둘 다 `false`, 기존 focus 유지).
- **`--workspace` 생략은 조용한 재배치다** — 생략해도 성공하고 focus된 workspace에 만든다. 그래서 caller pane을 `pane get`으로 물어 그 응답의 `workspace_id`를 명시로 싣고, 못 읽으면 **거절한다**(`herdr-caller-pane-get-failed`/`-unparsable`/`herdr-caller-workspace-missing`). pane id 파싱 0건. 모르는 workspace는 `workspace_not_found`로 pre-mutation 거절.
- **신원 스크럽이 상속을 이긴다** — 서버 env의 `PI_SESSION_ID`를 일부러 오염시킨 상태에서 새 tab의 프로세스는 `/proc/<pid>/environ`에서 `PI_SESSION_ID=''`/`PI_AGENT_ID=''`. 화면 증거 0.
- `--cwd`가 없는 디렉토리면 herdr는 **실패하지 않고 서버 cwd로 조용히 떨어진다** → 기존 존재 검사 셋이 이 verb에서 더 필요해졌다(유지).
- **`tab close`는 채택하지 않았다.** bare `tab_id`만 받고, `[측정]` **에이전트가 돌고 있는 tab도 그대로 닫았다**(`{"result":{"type":"ok"}}`) — 우리가 가진 것보다 큰 권위다. 대신 `[측정]` tab의 **유일한 pane**을 `pane close` 하면 tab이 함께 사라지고(빈 tab 잔여 0), pane이 둘이면 **우리 것만** 닫히고 tab과 남의 pane은 산다. 그래서 **기존 terminal_id 한 세대 조건부 close 계약은 한 줄도 바꾸지 않았다** — 바뀐 것은 그것이 무엇을 회수하는지에 대한 측정된 설명뿐이다.

**바뀐 파일.** `pi-extensions/lib/herdr-fresh-call.ts`(레일 코어) · `scripts/check-herdr-fresh-call.ts` · `scripts/check-herdr-sandbox.ts` · `scripts/check-fresh-call-dispatch.ts` · `scripts/smoke-herdr-fresh-call-live.ts`(오라클 2칸) · `scripts/mutants/herdr-fresh-call.json` · `scripts/check-gate-qualification.ts`(레인 인벤토리 24→28) · `docs/herdr-launch-rail.md` · `run.sh`(게이트 설명 2개) · `README.md`(herdr 배치 문장 2개) · 이 문서. **레코드 스키마·writer parity·store 세대·tmux 레일·`entwurf_v2` 배달 경로 무변경.**

**어휘 변화(이 레일 고유, 공유 5낱말 불변).** `herdr-parent-pane-missing` → `herdr-caller-pane-missing`, 신설 `herdr-caller-pane-get-failed`·`herdr-caller-pane-unparsable`·`herdr-caller-pane-drift`·`herdr-caller-workspace-missing`. `herdr-split-*` → `herdr-tab-create-failed`·`herdr-tab-create-unparsable`·`herdr-tab-root-pane-occupied`. receipt의 `herdrWorkspaceId`/`herdrTabId`가 **선택 → 필수**. 거절 문장 `No pane was created.` → `No tab and no pane were created.`

**Verify(M1-b, focused only) — 등급을 정직하게 분리한다.** `[GLG 스케줄 결정 2026-09-15]` amendment 뒤 구현자는 **focused gates까지만** 돌리고, qualification 본체와 `check:full`은 **checkpoint commit + #116 댓글 뒤에 코디네이터가 별도 후속으로** 실행한다. C4 LIVE는 짧은 acceptance라 amendment 검수 뒤 코디네이터가 먼저 실행한다.

- **돌린 것(focused, 이 바이트에서):** `check-herdr-fresh-call` **35** ✅ / `check-herdr-sandbox` **11** ✅(실바이너리 private 서버) / `check-fresh-call-dispatch` 12 ✅ / `check-herdr-placement` 22 ✅ / `check-gate-manifests` **547** mutants·48 lanes ✅ / `check-release-gate-outcomes` ✅ / `check-entwurf-control-rpc` 32 ✅ / `npx tsc --noEmit -p tsconfig.json` exit 0 ✅ / `npx biome check .` 에러 0(경고 7·info 6 = HEAD 동일, stash 대조) ✅.
- **뮤턴트 lane `herdr-fresh-call` 28/28 KILLED** — 단 이것은 qualification 본체가 아니라 **손으로 돌린 focused kill 확인**이다(`/tmp/mutant-lane-check.sh`: 백업 → in-place 변이 → focused gate → 복원, 끝에 md5 동일). 등급이 다르다.
- **C4 LIVE PASS `[측정 oracle 2026-09-15, coordinator]`:** `LIVE=1 ./run.sh smoke-herdr-fresh-call-live` **exit 0, 29 assertions ok, 1m34s**. pi→pi와 claude→claude 모두 새 tab + initial pane 좌표, exact callback, caller 지속, named reject를 실제 레일로 통과했다. private 서버·소켓은 회수됐고 operator panes는 byte-identical. 영수증 `/tmp/herdr-fresh-call-live-xnHeIp/receipts.md`.
- **checkpoint commit 시 qualification / `check:full` pending by GLG schedule.** 이 줄이 이 레인의 검증 등급 문장이다 — 커밋은 focused + C4 등급이지 floor 등급이 아니다.

**아직 안 한 것(의도).** `pnpm run check:full` 미실행 · `check-gate-qualification` 본체 미실행 · push 없음 · M2 구현 미착수 · idle/running 투영 미착수.

**교차검수 amendment 1회 `[코디네이터 sol, 2026-09-15 — Blocker 2 + Defect 1]`.** 셋 다 소스에 대고 재현했고 셋 다 실재하는 결함이었다.

- **Blocker 1 — caller pane 응답이 요청한 pane에 결속되지 않았다.** `pane get <HERDR_PANE_ID>` 응답의 workspace만 읽고 `paneId`가 우리가 물은 그 pane인지 검사하지 않았다. 읽을 수 있는데 **다른 pane**을 답하면 그 workspace를 믿고 엉뚱한 곳에 tab을 만들며 초록 영수증을 낸다 — 이 변경이 막으려던 silent relocation이 argv가 아니라 읽기를 통해 들어온다. 수선: `herdr-caller-pane-drift` pre-mutation 거절 신설(`unparsable`로 뭉개지 않음) + 자기 QK `HFC-CALLER-PANE-BOUND` + 자기 뮤턴트 + docs §5.
- **Blocker 2 — tab/create 두 절반의 결속이 부분적이었다.** `rootPane.tabId`는 **있을 때만** 대조했고 `rootPane.workspaceId`는 아예 대조하지 않았는데, 소스와 문서는 필수 일치라고 선언하고 있었다. 모순된 응답에서 initial pane과 receipt의 tab/workspace를 조합해 초록을 만든다. 수선: 둘 다 **필수 + 정확 일치**(없으면 불일치로 취급) + 자기 QK `HFC-TAB-HALVES-AGREE` + 자기 뮤턴트 + docs §5.
- **Defect 1 — create 실패 렌더가 자기 힌트와 모순됐다.** 힌트는 "nothing was created", 헤더는 "failed after the tab was created", recovery는 `orphan-unreclaimed:pane-get-failed`(시도한 적도 없는 `pane get`)였다. 게다가 `createHerdrRunner`는 **자기 timeout/kill도 herdr 실패와 같은 nonzero status**로 돌려주므로 "아무것도 안 생겼다"는 단정 자체가 과장이었다. 수선: stderr에 **herdr 자신의 error 봉투가 있으면** `none`(herdr가 만들기 전에 거절), **없으면** `unknown`(우리 bound가 끊었다 — tab이 있을 수 있다), 못 읽은 status-0 응답도 `unknown`. `HerdrRecovery`에 `none`/`unknown` 두 값을 더해 빈 pane id와 거짓 reason을 없앴고(기존 recovery 타입 억지 재사용 안 함), 헤더도 recovery가 아는 것 이상을 말하지 않는다. 자기 QK `HFC-CREATE-OUTCOME-HONEST` + 자기 뮤턴트 + docs §7 + dispatch gate `FCD-RECOVERY-VISIBLE` 확장.

**열린 위험 / 다음 검수 지점.**
1. `[닫힘 — C4 LIVE PASS]` 배치 교체의 실제 수용은 위 29 assertions로 통과했다.
2. **launch당 herdr CLI 왕복이 2 → 3**(`pane get` 추가). 거절 목록 맨 뒤라 "거절은 아무것도 남기지 않는다"는 성립한다.
3. **qualification 본체 / `check:full` 미실행.** 레인 인벤토리가 24→28로 늘었다(신설 4: `HFC-CALLER-WORKSPACE`·`HFC-CALLER-PANE-BOUND`·`HFC-TAB-HALVES-AGREE`·`HFC-CREATE-OUTCOME-HONEST`). GLG 스케줄에 따라 checkpoint commit 뒤 코디네이터 후속.
4. `[닫힘 — Defect 1로 수선됨]` 이전 보고의 Observation 2(`HerdrOrphanReason`이 "아무것도 안 생김"을 거짓 reason으로 찍던 문제)는 이번 amendment에서 `none`/`unknown` 도입으로 닫혔다. 남은 `HerdrOrphanReason` 여섯 값은 이제 전부 **실제로 시도한 회수**만 설명한다.

`[닫힘]` 작업 중 operator herdr의 pi·claude 시민 둘이 사라진 것은 **`[GLG direct 2026-09-15]` GLG 본인이 끈 것**이다. 이 레인이 만든 변화가 아니고, 측정은 전부 샌드박스 private 서버였으며 `HS-OPERATOR-UNTOUCHED`는 두 실행 모두 통과했고 측정 잔여 프로세스는 0이었다.
