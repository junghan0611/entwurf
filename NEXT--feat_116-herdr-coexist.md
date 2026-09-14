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
- [ ] **4. S2 · herdr fresh-call 형제 모듈** ← CURRENT: **S2-b 완료(코드 0줄), 다음은 S2-a 중립 leaf 커밋.** 이 레인의 무게 전부. `pane split` → `agent start --kind <k> --pane <id> -- <argv>`. 고아 pane 회수를 receipt에. 순서는 수선된 #116 본문 §Implementation rail 그대로 — **S2-b** identity 측정 셀(코드 0줄, 먼저) → **S2-a** 중립 leaf(순수 리팩터) → **S2-c** herdr 모듈 + 격리 게이트. *(측정이 먼저인 이유: 무엇이 진짜 공유 조각인지는 identity 프로토콜이 정하는데, leaf를 먼저 빼면 그 결정을 추출 순서로 미리 못박는다.)*
  - **계약 `[솔 큰 틀 검수 반영, 2026-09-14]`** — 착수 전에 닫힌 것 셋:
    - **B1 (Blocker였음): 고아 pane 회수는 조건부 close다.** herdr `close_pane`은 `PaneTarget{pane_id}`만 받고 pane id/agent name은 한 서버 scope다 — bare id로 닫으면 restart/handoff 뒤 남의 view를 닫을 권위가 없다. split 영수증의 `terminal_id`를 들고 `pane get` → `terminal_id` 일치 **그리고** `agent_session` 없음일 때만 close. receipt 어휘는 `closed`(검증한 terminal_id + 시각) / `orphan-unreclaimed`(불일치·get 실패·close 실패, 이유를 이름으로). get→close 사이 TOCTOU가 남는다는 것을 문서에 적는다. **`[S2-b 측정으로 확정, 2026-09-14]`** 이제 이것은 API 독해가 아니라 영수증이다 — 격리 샌드박스 서버에서 `server stop`→재기동 시 **같은 pane id 셋(`w1:p1`·`w1:p2`·`w1:p3`)이 전부 다른 terminal_id에 다시 묶였다**(`term_65b6d90e…` → `term_65b6d916…`). 따라서 **`terminal_id`도 세대를 넘지 못한다**: 계약 문구는 "terminal_id가 소유를 증명한다"가 아니라 **"한 서버 세대 안에서 증명한다"**여야 하고, 재기동 뒤 stale 영수증은 항상 불일치로 떨어져 `orphan-unreclaimed`가 정답이 된다(fail-closed 방향이라 안전).
    - **D1: `--kind`는 runtime 사전 증명이 아니다.** herdr는 enum을 bare executable 문자열로 바꿔 셸에 쓰고 detection을 기다린다(`src/app/agents.rs:145-231 @ c77af189`) — PATH를 사전 resolve하지 않는다. herdr 레일에서는 **pre-mutation runtime proof를 포기한다고 이름 붙여 적고**, 우리 프로세스 PATH의 `resolveRuntimeOnPath`는 "proxy(같은 env 보장 없음)"로만 쓴다. timeout/blocked/alias/PATH의 post-mutation 실패 매트릭스를 거절 이유로 갖춘다.
    - **D3: herdr 레일 지원 집합은 `pi | claude-code`로 닫는다.** `HERDR_ENV=1`에서 copilot/omp/codex fresh 요청은 pre-mutation named reject. tmux fallback 금지(Rule 5), herdr `--kind` enum이 크다는 것을 지원 증거로 읽지 않는다.
    - **D2 (착수 순서): 중립 leaf 먼저.** herdr 모듈은 `mux-*`를 import하지 않는다. `buildBackendArgs`/`buildFreshCallPrompt`/`mintNonce`를 중립 composition leaf로 추출하고 둘이 그걸 import한다. 구조 게이트: herdr→`mux-*` 0건, `entwurf-v2-*`→herdr 0건. 순수 리팩터 커밋 하나.
    - **identity — S2-b 측정 셀이 정한다(GLG 노트, 2026-09-14).** GLG의 llmlog `~/sync/org/llmlog/20260914T161103--herdr-entwurf-delivery-비교표…org` §「#116 별동대 가설 — birth witness」가 후보 계약을 준다: `herdr agent start`의 **direct `agent_started` 응답**이 실은 `agent_session`(nativeSessionId) → exact-one V3 레코드 검증(backend/cwd/source 대조) → garden callback envelope `{nonce, nativeSessionId, gardenId}`. **snapshot/`pane list`를 뒤져 조인했으니 nonce를 지운다는 결론은 금지**("fresh identity arrives only through its callback envelope, never a lookup"). 여섯 관측을 전부 재야 한다: (1) direct 응답의 `agent_session`이 `kind: id`(claude)/`path`(pi)로 오는가 (2) 그 id의 V3 레코드가 정확히 하나인가 (3) `source/agent` ↔ `backend/cwd` 일치 (4) snapshot 없이 direct 응답 → envelope 구성 가능 (5) 그 garden id로 `entwurf_v2` → 공식 rail receipt (6) pane move 뒤 garden id 유지, pane exit 뒤 다른 native session으로 조용히 재결속하지 않고 honest reject. **하나라도 실패하면 그 모양이 entwurf가 계속 소유할 계약의 이름이다.** 성립하면 model-mediated nonce의 일부를 direct native-start receipt로 바꿀 후보가 되고, 불성립이면 nonce 콜백은 v3에서 덜어낼 물건이 아니다. 두 프로토콜을 fallback chain으로 섞지 않는다.
    - **`[S2-b 측정 완료 2026-09-14 — 여섯 칸 전부 성립]`** `.agent-reports/116-s2b-birth-witness-20260914.md` · #116 코멘트 `issuecomment-5661519488`. 시민 둘(claude `20260914T175029-d7b623` / pi `20260914T175053-2ef8f6`)을 열고 닫았다. (1)(2)(3) direct 응답에 공식 삼중이 있고 exact-one 레코드로 풀리며 `source/agent`↔`backend`, `cwd`↔`cwd` 일치 — **pi는 경로 문자열 전체로 검색하면 0건**이라 파일명→uuid 변환이 선택이 아님이 대조로 증명됐다. (4) envelope 구성 가능: **레코드가 direct 응답보다 먼저 존재한다**(claude 레코드 08:50:29.514Z < 응답 08:50:31.053Z / pi 53.405Z < 54.943Z) → watcher·retry 없이 **1회 조회**로 충분. `[미검증 잔여]` 표본 2개 + 구조 논거일 뿐 herdr의 보장이 아니다 — "레코드가 아직 없음"을 **이름 붙인 거절**로 둘지 **상한 있는 1회 재읽기**로 둘지는 S2-c의 계약 결정이다. (5) claude mailbox `enqueued` → 실제 **읽음 영수증** `lastReadAt=08:51:28.718Z`(7초, 형제가 직접 드레인) / pi `control-socket → sent`. (6) **워크스페이스 이동에서 좌표가 `w7:p3`→`w8:p2`로 바뀌어도** `terminal_id`·`agent_session` 불변이고 현행 프로덕션 조인 leaf가 새 좌표를 정확히 따라갔다; 종료 뒤에는 해당 시민만 `none`(조용한 재결속 0). 한 세대 안에서 좌표 재사용 없음(`w7:p3` 해제 뒤 `w7:p5`→`w7:p6`). 조건부 close 4건 전부 MATCH→`closed`, `orphan-unreclaimed` 0건, 오퍼레이터 스냅샷 전후 IDENTICAL, 레코드 md5 불변.
    - **결론(섞지 않은 채로):** direct witness는 **성립한다**. 그러나 그것이 nonce를 은퇴시키지는 **않는다** — nonce가 소유하는 것은 형제의 **첫 모델 행동과 프레이밍**이고, direct witness가 소유하는 것은 **호출자 측 즉시 상관짓기**다. 다른 물건이라 한쪽을 다른 쪽의 fallback으로 엮으면 실패 모드가 합쳐진다. 어느 프로토콜로 herdr 레일을 낼지는 **GLG의 결정**이고, S2-b는 direct witness 칸을 전부 채웠을 뿐이다.
  - **증거 등급 `[S0 측정 + GLG 결정, 2026-09-14]`: placement·argv·회수·조인 전부 결정론(격리 private 서버 + 샌드박스 integration install) / 콜백 왕복만 LIVE.** 게이트가 샌드박스 `HOME`/`XDG` 안에서 `herdr integration install pi`(필요하면 claude도)를 직접 불러 `agent_session`이 채워지는 것까지 격리 서버에서 증명한다. S0이 잰 것: 헤드리스 서버·`workspace create`·`pane split`·`agent start`가 전부 클라이언트 attach 없이 돌고, `herdr integration status`가 샌드박스 HOME 경로를 그대로 따른다(설치가 샌드박스에 갇힌다). Hard Rule 17은 이 걸음을 막지 않는다 — 설치되는 것은 herdr 자기 바이트이고, 하네스 바이너리·구독·자격증명은 여전히 공급하지 않는다. tmux 대응: `check-mux-placement-tmux`(격리 서버) ↔ `smoke-mux-fresh-call-live`(LIVE)의 갈래와 같은 모양
- [ ] **5. S5 · herdr 플러그인 껍데기** — `herdr-plugin/herdr-plugin.toml` + 액션 하나. `[[startup]]` 미사용. S2가 뭔가 하게 된 뒤 포장
- [ ] **6. S4 · resume herdr placement** ← PAUSED: herdr native session restore(`resume_agents_on_restore` 기본 on, `session-state.mdx:52-70` @ c77af189) ↔ `entwurf_resume_call` 소유권 충돌 미측정. 이 랩 밖. herdr 서버 재시작이 우리 pi 시민을 되살렸을 때 garden id 거동은 레인 종료 전 1회 재야 한다. `[S2-b가 절반만 좁혔다]` 재기동 시 **pane id는 재사용되고 terminal_id는 새로 난다**는 것까지는 격리 서버에서 쟀지만, 그 실험에는 **에이전트가 없었다**(맨 셸 3개) — restore가 에이전트를 되살렸을 때 native session이 같은지 새로 나는지가 정확히 S4의 미측정 칸으로 남는다

현재 좌표: 0·1·2·3 완료(커밋 `d96a02f`·`469b3b5`) + **S2-b 측정 완료(코드 0줄, 커밋 없음)** → **4(S2) 진행: S2-a 다음** → 5 대기 → 6 보류

# NOW

- Current: 브랜치 `feat/116-herdr-coexist` = `0c8a42c` + `d96a02f`(S1+S3) + `469b3b5`(S1 후속) + `9ca4685`(핸드오프) + 이 문서 체크포인트. 푸시 없음. **S2-b 측정 끝(코드 0줄)** — 다음 세션은 여기서 **S2-a**로 들어간다.
- Next: (1) **S2-a** — `buildBackendArgs`(`mux-fresh-call.ts:280-304`)·`buildFreshCallPrompt`(358-381)·`mintNonce`(453)를 중립 leaf(새 파일, node 표준만, `mux-*`·`entwurf-*` import 0)로 추출. 동작 무변경, 기존 mux 게이트·뮤턴트 초록 그대로. **`[S2-b 권고]`** 프롬프트 첫 줄 `"…in the operator's tmux session"`은 **레일 문구**라 leaf로 그대로 들고 가면 안 된다 — 명시적 레일 입력(파라미터)으로 받고 tmux 쪽 바이트는 그대로 유지한다. placement·seat·runtime 사전 증명·`mux-fresh-call.ts:527-531` 순서 논증·receipt 타입은 **옮기지 않는다**. 다섯 backend 전부를 옮기려다 codex/omp/copilot preflight나 placement 권위가 leaf로 끌려오면 **넓히기 전에 멈추고 가장 작은 seam을 보고한다**. `check-mux-launch`류 구조 게이트에 "herdr→`mux-*` 0건, `entwurf-v2-*`→herdr 0건" 자리를 미리 판다. 커밋 1개 → (2) **S2-c** — herdr 모듈 + 순수 게이트 + 격리 서버 게이트(샌드박스 HOME/XDG + `herdr integration install pi` + **entwurf pi 패키지 등록**(`~/.pi/agent/settings.json` `packages[]`가 샌드박스엔 없다 — 첫 측정, 막히면 보고)). 착수 시 `HP-PLACEMENT-NOT-DISPATCH` dispatch 모듈 목록 재검토.
- **게이트 시간 규율 `[GLG 2026-09-14]`: 한 시간짜리 게이트를 기다리지 않는다.** 체크포인트 커밋의 floor = `pnpm run check:full`(~8.5분) + 바뀐 lane의 뮤턴트를 매니페스트대로 개별 심기/뽑기(수동 검증이라 적는다). `check-gate-qualification` 전량(485+, 55분)은 **레인 종료 시 1회 또는 CI**에서만. 근본 해법은 노트 N절 **L1(레인 단위 선택)** — `check-gate-qualification.ts`에는 지금 `--manifests-only`/`--attribution-self-test`만 있고 lane 필터가 없다. L1은 #116과 독립된 게이트 인프라 변경이라 **별도 커밋(가능하면 main 별도 이슈)**으로, 이 레인에 태우지 않는다. 다음 세션 첫 판단: L1을 S2-a 앞에 둘지 GLG에게 묻는다.
- Verify(S2-b, 완료 · 코드 0줄이라 게이트 아님): 여섯 칸 전부 성립 ✅ / 정지 조건 미발동 ✅ / 오퍼레이터 herdr 스냅샷 전후 IDENTICAL ✅ / 내가 연 pane 4개 전부 조건부 close MATCH→`closed`, `orphan-unreclaimed` 0건 ✅ / 측정 워크스페이스·샌드박스 서버 회수 ✅ / 시민 레코드 2건 보존·md5 불변 ✅ / 추적 파일 변경 0 ✅.
- Verify(S1, 완료): affected 게이트 4개 PASS ✅ / 뮤턴트 8개 전부 KILLED(claimed signature 기준) ✅ / `pnpm run check:full` **exit 0, 508s** ✅ / LIVE 셀 `w2:p1 ↔ 9706ccd4… → 20260914T084325-14d357` 조인 ✅, herdr env 없는 프로세스는 citizen 전부 `unobserved` ✅ / 레코드 무변경: 대상 레코드 md5 불변 + placement 축에 writer 0건(`herdr-placement.ts`·`entwurf-peer-observe.ts`에 write/upsert 없음) ✅. (작업 중 store가 1122→1123이 되었는데 이 변경과 무관하다 — 병렬로 태어난 pi 시민 `20260914T151425-d63979`다.)
- Verify(S0, 완료): 오퍼레이터 소켓이 아닌 다른 소켓의 서버가 응답 ✅ / 그 `pane list`에 오퍼레이터 pane 0건 ✅ / 종료 후 오퍼레이터 스냅샷 전후 IDENTICAL ✅.
- Blocker: none (환경: 오라클, herdr 0.9.0, socket protocol 22).
- Read: #116 본문 + 코멘트 → `.agent-reports/116-big-picture-review-sol-20260914.md`(B1/D1~D6, 갈림 4개) → `.agent-reports/116-s2-design-20260914.md`(§2는 정정 전 판단이라 머리에 명시됨) → GLG llmlog 비교표(위 RAIL 4 identity 참조; D9 provenance·D10 handle ownership·D12 read-only history는 entwurf의 gap) → `.agent-reports/116-herdr-plugin-packaging-terra-20260914.md`(S5용, A안) → `.agent-reports/116-oracle-f0-measure-20260914.md` → `docs/mux-launch-rail.md` §7·§7-a·§11 → `AGENTS.md` Hard Rule 2·4·5·7·16·17.
- Do not touch:
  - `entwurf_v2` 배달 경로(`entwurf-v2-contract.ts` / `entwurf-v2-production.ts`) — herdr import 0건. S2 착수 시 이 부재를 게이트로 박는다(Rule 16 herdr판).
  - meta-record 스키마 / writer parity / store 세대 — placement는 레코드에 저장하지 않는다(`docs/mux-launch-rail.md` §7).
  - tmux 레일 — 한 줄도 지우지 않는다(복귀 시험).
  - codex 축 — Δ=0(`v3-baseline-measure.sh` `[불변]` 행이 검산기).
  - `~/.claude/settings.json`의 `hooks.*` — entwurf가 소유하지 않는다. 그게 공존의 근거다.
  - fake herdr fixture — `check-mux-placement.ts:6-9` "no fake tmux, on purpose"와 같은 이유로 만들지 않는다. 결정론은 argv/파싱/거절문법, 실바이너리는 격리 private 서버.
  - `HERDR_ENV=1`로 `--entwurf-control` 자동 활성 — env를 두 번째 활성 축으로 만들지 않는다(`entwurf-control.ts:992-995, 1036`).

# 단계 계약 (S1·S2 요약 — 상세는 제안서)

**S1 placement 관측 축**
- 모양: `entwurf-facts.ts:57-90`의 receiver/transcript처럼 주입식 observer 하나 더. 세 번째 인스턴스이지 새 개념이 아니다.
- 조인 키: claude `agent_session.kind=id` 문자열 동등 / pi `kind=path` → JSONL 파일명에서 uuid 파싱(벤더 포맷 의존, 이름 붙여 적는다).
- **§7 개정을 S1 안에서 같이 한다(D1).** `docs/mux-launch-rail.md:490-496`은 exact placement evidence를 "둘뿐"(launch receipt / peer self-report)으로 닫아 두었다. herdr 조인은 그 둘이 아니라 제3의 형태 — 배치 소유자(herdr)가 우리가 독립 소유한 유일 키(`nativeSessionId`, Rule 7)로 내놓는 정확한 보고 — 다. 추측 금지 목록(title·cwd·시각)에는 안 걸리지만 목록이 닫혀 있으므로 §7에 셋째 항목을 이유와 함께 더하지 않으면 문서를 거스르며 착지한다. 같은 커밋에서 §7의 빈칸 어휘 `unknown`(488행)을 `unobserved`/`none`으로 맞춘다(D2, `entwurf-facts.ts:85` UNOBSERVED_PEER와 나란히). 그리고 재시도 상한·포기 규칙을 §7에 같이 적어 watcher가 자라는 것을 막는다(O1, §7:487 "시각 근접 = discovery watcher" 금지).
- 증거 셀: pure(herdr 없음 → `unobserved`, 거절 없음) · LIVE(pane ↔ garden id 행 붙음) · 불변 검산(레코드 mtime/내용 무변경) · §7 개정이 같은 커밋에 있음.
- 뮤턴트 Δ 예상 +3~6 `[추정]`.

**S2 herdr fresh-call 형제 모듈**
- 공유하는 것: `buildBackendArgs`(`mux-fresh-call.ts:280-304`) + `buildFreshCallPrompt`(358-381) + `mintNonce`(453)만. placement는 공유하지 않는다. (제안서의 307-345는 오기 — 그 범위는 `FreshCallComposition`/OMP bootstrap이다.)
- 깨지는 불변 하나: herdr는 두 걸음이라 "Nothing above can leave a window behind"(`mux-fresh-call.ts:527-531`)가 성립하지 않는다. `agent start` 실패 시 **조건부** `pane close`(RAIL 4 B1)로 회수하고 `closed`/`orphan-unreclaimed`를 receipt에 담는다. runtime 사전 증명은 herdr로 넘어가는 게 아니라 **사라진다**(RAIL 4 D1) — 포기라고 적는다.
- 신원 누출: `--env PI_SESSION_ID= --env PI_AGENT_ID=`로 스크럽을 명시 전달(실측: 빈 값도 주입됨). 서버 env 상속에 베팅하지 않는다.
- receipt: nonce 발행 사실 · 요청 backend/model/cwd · pane id(**view**) · 회수 결과. 담지 않는 것: garden id, 화면 텍스트, `agent_status`, `interactive_ready`(herdr 화면 판정).
- 공유 표면: `mcp/entwurf-bridge/src/index.ts:711-732`, `entwurf-control.ts:1543,1592,1632` backend enum. F-0의 "공유 표면 20 뮤턴트"가 정확히 여기다.
- 문서: `docs/mux-launch-rail.md`는 tmux 레일로 유지, herdr 레일은 별 문서.
- 뮤턴트 Δ 예상 +25~45 `[추정]`.

# RECENT

- [2026-09-14 저녁] **S2-b 직접 birth-witness 측정 완료**(claude-code/opus `20260914T174741-2e9ba9`, 오라클, 코드 0줄). 여섯 칸 전부 성립. 설계를 바꾼 새 사실 둘: (1) **서버 세대를 넘으면 pane id가 재사용되고 terminal_id는 보존되지 않는다** → B1 조건부 close가 영수증으로 확정되고, 소유 증명은 "한 세대 안에서만" 참이다. (2) **워크스페이스 이동에서 pane 좌표 자체가 바뀐다**(`w7:p3`→`w8:p2`) → receipt에 좌표를 담으면 즉시 낡고, 매 listing 재계산인 현행 조인은 이동을 정확히 따라갔다. identity는 **두 제안으로 남겼다** — direct witness 성립이 nonce 은퇴를 뜻하지 않는다(각각 호출자 상관짓기 / 형제의 첫 모델 행동을 소유). 공개 코멘트 `issuecomment-5661519488`, 리포트 `.agent-reports/116-s2b-birth-witness-20260914.md`. 이 레인 순서도 수선된 본문에 맞춰 정정(측정 먼저 → 중립 leaf).
- [2026-09-14 저녁] 코디네이터(fable) 정리. 형제 전원 퇴근(opus `20260914T141356-6a5a8f`·terra·sol). 커밋 2개 `d96a02f`·`469b3b5`. 솔 큰 틀 검수(Blocker 1→S2 계약으로 닫음 / Defect 6 / Observation 9): 경계 맞음, 두 레일은 strangler seam으로만, S2는 B1/D1/D2/D3 닫은 뒤. 테라 배포면: A안(같은 리포 `herdr-plugin/`, `[[build]]`가 exact npm을 플러그인 로컬 `.runtime`에) 권고, 준비 체크리스트에서 빠진 셋(build의 격리 HOME 계약·`HERDR_PLUGIN_STATE_DIR`↔install-state 관계·액션에서 `setup` 호출 금지). GLG llmlog 비교표(D0~D12)가 identity 갈림의 측정 셀을 줬다(RAIL 4). GLG 게이트 시간 규율 신설(NOW). #116 공개 본문의 stale 두 문장(resume 소유·alt-screen, 솔 D4/D6)은 코멘트로 표시했고 본문 수정은 GLG 결정 대기.

- [2026-09-14] S1 후속(opus, 솔 검수 D5/O4). 조인이 **공식 삼중**(`source`+`agent`+`kind`)을 검사한다 — herdr는 third-party integration 보고도 받으므로 `kind/value`만 읽으면 "배치 소유자가 보고했다"는 §7 3항의 전제가 코드에 없었다. 레코드 backend 대조 추가(pi 보고 pane을 claude-code citizen에게 주지 않는다). **사양한 보고가 하나라도 있으면 non-join은 `none`이 아니라 `unobserved`** — 못 읽은 그것이 이 citizen이었을 수 있다. §7 3항을 "공식 보고 + 유일 키"로 고치고 **pi 축은 유일 키 동등이 아니라 pi 0.85.1 strict path→id 변환(vendor floor)**임을 이름 붙였다. §7-a에 O4 한 문장(placement는 현재 관측자 서버에 상대적, 저장·비교 금지). 게이트 22 assertions, 뮤턴트 lane 8→11 전부 KILLED.
- [2026-09-14] S3 완료(opus, 코드 0줄). `README.md` §Garden launcher에 herdr 안에서 pi 열 때 `-- --entwurf-control`이 필요하다는 단락. claude 축은 추가 조치 불필요(레코드는 meta-bridge 플러그인 자기 훅이 민팅). README를 읽는 게이트 4개 재실행 PASS.
- [2026-09-14] S1 후보 동결(opus). 새 파일: `pi-extensions/lib/herdr-placement.ts`(순수 조인 코어) · `scripts/check-herdr-placement.ts`(17 assertions, herdr 바이너리 불필요) · `scripts/mutants/herdr-placement.json`(8개, 전부 KILLED). 수정: `entwurf-facts.ts`(3번째 관측 축) · `entwurf-peer-observe.ts`(bounded 1회 읽기, `HERDR_ENV=1`+`HERDR_BIN_PATH`만 보고 시작) · `entwurf-fact-provider.ts`(주입식 `readPlacementIndex`) · `entwurf-peers-render.ts`(행 끝 칸) · `docs/mux-launch-rail.md`(§7 제3 evidence + §7-a 어휘·무재시도) · 3개 기존 게이트 fixture · `tsconfig.json` fence · `run.sh`/`package.json` 등록 · lane inventory. 레코드 스키마·writer parity·store 세대 무변경.
- [2026-09-14] GLG 결정: S2 게이트는 격리 서버로 가고 **조인 축까지 결정론으로 내린다** — 샌드박스 안에서 `herdr integration install pi`를 게이트가 직접 부른다. LIVE 전용으로 남기지 않는다. Hard Rule 17은 이 걸음을 막지 않는 것으로 읽는다(herdr 자기 바이트, 샌드박스에 갇힘).
- [2026-09-14] S0 측정(opus, 오라클). herdr 격리 서버는 **결정론 게이트로 쓸 수 있다** — `HOME`/`XDG_CONFIG_HOME` 샌드박스에서 `herdr server`가 `<sandbox>/.config/herdr/herdr.sock`으로 뜨고(클라이언트 attach 불필요), `workspace create`→`pane split`→`pane read`(실 PTY 셸 프롬프트 보임)→`pane close`→`server stop` 왕복 성공, 소켓 회수됨, 잔여 프로세스 0. 오퍼레이터 서버(w1:p1·w2:p1) 스냅샷 전후 **IDENTICAL**. 단 샌드박스엔 herdr integration이 없어 `agent start`는 되지만 `agent_session=null` → **조인·콜백 왕복은 LIVE 전용**. 상세는 RAIL 4번 증거 등급.
- [2026-09-14] F-0 측정(opus, 오라클). herdr가 연 claude → 2초 내 레코드 `20260914T141518-2b4e3b`, `entwurf_v2` mailbox delivered·읽음 영수증. pi 기본 argv → 레코드 없음(`entwurf-control.ts:1108`), `-- --entwurf-control` → 레코드·alive·control-socket·왕복 성립. herdr는 `agent_session` 확정을 밀어주지 않는다(`pane.updated`는 플러그인 `[[events]]`에서 unknown, `events.subscribe`는 3종뿐, `pane.agent_detected`는 조인 키보다 먼저 옴) → push-triggered pull. claude 축 hooks 파일 공유 충돌 없음(entwurf는 `hooks.*` 미소유, `check-keyset-overlap` disjoint). `herdr plugin link`는 git 서브디렉토리 가능, 액션 id에 점 불가.
- [2026-09-14] NEXT 교차 검토(opus): Blocker 0 / Defect 4(§7 닫힌 목록·빈칸 어휘 이중·fresh-call 줄번호·RAIL 오타) / Observation 3 — 전부 반영.
- [2026-09-14] 공존 단계 제안(opus). S1 대안 B(런타임 조인) / S3 문서만 / S2 형제 모듈 / S4 제외 / S5 마지막 / S0 신설. 측정 pane w2:p2~p8 닫음. 브랜치 생성.
