# NEXT — feat/116-herdr-coexist (herdr 위에서 herdr를 존중하는 확장)

> 브랜치 전용 boot sector. main `NEXT.md`는 건드리지 않는다. 머지 전에 이 파일을 지운다.
> 좌표(공개 SSOT)는 #116 본문이고, 이 레인의 측정·제안 원자료는 `.agent-reports/`(gitignore)다.
> 분기 SHA `0c8a42c`. 코디네이터 fable(`20260914T140615-b2e9e2`), 측정·제안 opus(`20260914T141356-6a5a8f`).

## 이 레인이 무엇인가 — 한 줄

**mux(tmux) 레일은 그대로 두고, herdr 안에서 동작하는 세션이면 herdr를 존중하는 두 번째 레일을 옆에 세운다.**
`entwurf_v3` 완전 뺄셈은 이 레인이 아니다. 뺄셈 판단은 이 레인이 끝난 뒤 `0c8a42c` 베이스라인(오라클·thinkpad 동일)에 대고 따로 한다.
이 레인은 뮤턴트가 **는다**. 정상이다. 뺄셈 성적표와 섞지 않는다.

`[결정 GLG 2026-09-14]` 공존 구조. `[결정 코디네이터, GLG가 뒤집을 수 있음]` 공존 = **두 레일**(형제 모듈 신설).
한 레일의 두 backend가 아니다 — `mux-placement.ts:135-142`의 Placement는 추상 포트가 아니라 tmux 좌표 구조체라서 합치는 비용이 최소가 아니다.

# RAIL — 현재 좌표

- [x] **0. F-0 측정** — herdr가 연 형제가 콜백 nonce 없이 garden id를 받고 `entwurf_v2`로 닿는가. claude 성립 / pi는 `-- --entwurf-control` 넣으면 성립. 오라클 베이스라인 thinkpad와 전 칸 일치. `.agent-reports/116-oracle-f0-measure-20260914.md`
- [x] **1. S0 · herdr 증거 등급 측정** — 측정 완료 2026-09-14. **결정론 가능**(placement 절반). 샌드박스 HOME/XDG에서 `herdr server`가 자기 소켓으로 뜨고, 클라이언트 attach 없이 `workspace create` → `pane split` → `pane read` → `pane close` → `server stop`이 전부 돈다. 오퍼레이터 서버 스냅샷 전후 IDENTICAL
- [x] **2. S1 · `entwurf_peers` placement 관측 축** — 후보 동결 2026-09-14(커밋 전). 레코드 무변경 확인. `pi-extensions/lib/herdr-placement.ts`(순수) + 한 listing당 1회 읽기 + `placement` 칸. 어휘 4개(`unobserved`/`none`/`ambiguous`/`herdr <pane>`). `docs/mux-launch-rail.md` §7 제3 exact evidence + §7-a 신설. 게이트 `check-herdr-placement` 17 assertions, 뮤턴트 lane `herdr-placement` 8개 전부 KILLED
- [x] **3. S3 · pi argv 안내(문서)** — 완료 2026-09-14, 코드 0줄. `README.md` §Garden launcher에 **Opening pi inside herdr** 단락. 자리 이유: 그 절이 이미 "pi가 launch에서 어떻게 시민이 되는가"를 소유한다(`pi --entwurf-control`이 거기 있다). herdr는 하네스가 아니라 배치 소유자이므로 `docs/adding-a-harness.md`가 아니고, `docs/mux-launch-rail.md`는 tmux 레일로 남긴다. placement 칸은 §7-a로 링크만
- [ ] **4. S2 · herdr fresh-call 형제 모듈** — 이 레인의 무게 전부. `pane split` → `agent start --kind <k> --pane <id> -- <argv>`. 콜백 nonce 유지. 고아 pane 회수를 receipt에
  - **증거 등급 `[S0 측정 + GLG 결정, 2026-09-14]`: placement·argv·회수·조인 전부 결정론(격리 private 서버 + 샌드박스 integration install) / 콜백 왕복만 LIVE.** 게이트가 샌드박스 `HOME`/`XDG` 안에서 `herdr integration install pi`(필요하면 claude도)를 직접 불러 `agent_session`이 채워지는 것까지 격리 서버에서 증명한다. S0이 잰 것: 헤드리스 서버·`workspace create`·`pane split`·`agent start`가 전부 클라이언트 attach 없이 돌고, `herdr integration status`가 샌드박스 HOME 경로를 그대로 따른다(설치가 샌드박스에 갇힌다). Hard Rule 17은 이 걸음을 막지 않는다 — 설치되는 것은 herdr 자기 바이트이고, 하네스 바이너리·구독·자격증명은 여전히 공급하지 않는다. tmux 대응: `check-mux-placement-tmux`(격리 서버) ↔ `smoke-mux-fresh-call-live`(LIVE)의 갈래와 같은 모양
- [ ] **5. S5 · herdr 플러그인 껍데기** — `herdr-plugin/herdr-plugin.toml` + 액션 하나. `[[startup]]` 미사용. S2가 뭔가 하게 된 뒤 포장
- [ ] **6. S4 · resume herdr placement** ← PAUSED: herdr native session restore(`resume_agents_on_restore` 기본 on, `session-state.mdx:52-70` @ c77af189) ↔ `entwurf_resume_call` 소유권 충돌 미측정. 이 랩 밖. herdr 서버 재시작이 우리 pi 시민을 되살렸을 때 garden id 거동은 레인 종료 전 1회 재야 한다

현재 좌표: 0·1·2·3 완료(S1+S3 후보 동결, 커밋 승인 대기) → 4(S2) 다음 → 5 대기 → 6 보류

# NOW

- Current: S0·S1·S3 완료. **S1+S3 후보가 워크트리에 얼어 있다 — 커밋 안 함.** 새 파일 3개는 게이트 매니페스트가 origin index에 있기를 요구해 `git add -N`(intent-to-add)만 했고 스테이징 내용은 없다. 커밋 승인은 GLG.
- Next: GLG 커밋 승인 → S2(herdr fresh-call 형제 모듈, RAIL 4의 증거 등급대로 격리 서버 + 샌드박스 integration install). S2 착수 시 `HP-PLACEMENT-NOT-DISPATCH`의 dispatch 모듈 목록을 다시 봐라(새 모듈이 들어온다).
- Verify(S1, 완료): affected 게이트 4개 PASS ✅ / 뮤턴트 8개 전부 KILLED(claimed signature 기준) ✅ / `pnpm run check:full` **exit 0, 508s** ✅ / LIVE 셀 `w2:p1 ↔ 9706ccd4… → 20260914T084325-14d357` 조인 ✅, herdr env 없는 프로세스는 citizen 전부 `unobserved` ✅ / 레코드 무변경: 대상 레코드 md5 불변 + placement 축에 writer 0건(`herdr-placement.ts`·`entwurf-peer-observe.ts`에 write/upsert 없음) ✅. (작업 중 store가 1122→1123이 되었는데 이 변경과 무관하다 — 병렬로 태어난 pi 시민 `20260914T151425-d63979`다.)
- Verify(S0, 완료): 오퍼레이터 소켓이 아닌 다른 소켓의 서버가 응답 ✅ / 그 `pane list`에 오퍼레이터 pane 0건 ✅ / 종료 후 오퍼레이터 스냅샷 전후 IDENTICAL ✅.
- Blocker: none (환경: 오라클, herdr 0.9.0, socket protocol 22).
- Read: #116 본문 → `.agent-reports/116-oracle-f0-measure-20260914.md`(판정 한 줄 + C4) → `.agent-reports/116-coexist-rail-proposal-20260914.md`(S1·S2 절) → `docs/mux-launch-rail.md` §7·§11 → `AGENTS.md` Hard Rule 2·4·7·16.
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
- 깨지는 불변 하나: herdr는 두 걸음이라 "Nothing above can leave a window behind"(`mux-fresh-call.ts:527-531`)가 성립하지 않는다. `agent start` 실패 시 `pane close`로 회수하고 결과(`closed`/`already-gone`)를 receipt에 담는다. runtime 사전 증명은 herdr `--kind` enum으로 넘어간다 — 문서에 적는다.
- 신원 누출: `--env PI_SESSION_ID= --env PI_AGENT_ID=`로 스크럽을 명시 전달(실측: 빈 값도 주입됨). 서버 env 상속에 베팅하지 않는다.
- receipt: nonce 발행 사실 · 요청 backend/model/cwd · pane id(**view**) · 회수 결과. 담지 않는 것: garden id, 화면 텍스트, `agent_status`, `interactive_ready`(herdr 화면 판정).
- 공유 표면: `mcp/entwurf-bridge/src/index.ts:711-732`, `entwurf-control.ts:1543,1592,1632` backend enum. F-0의 "공유 표면 20 뮤턴트"가 정확히 여기다.
- 문서: `docs/mux-launch-rail.md`는 tmux 레일로 유지, herdr 레일은 별 문서.
- 뮤턴트 Δ 예상 +25~45 `[추정]`.

# RECENT

- [2026-09-14] S3 완료(opus, 코드 0줄). `README.md` §Garden launcher에 herdr 안에서 pi 열 때 `-- --entwurf-control`이 필요하다는 단락. claude 축은 추가 조치 불필요(레코드는 meta-bridge 플러그인 자기 훅이 민팅). README를 읽는 게이트 4개 재실행 PASS.
- [2026-09-14] S1 후보 동결(opus). 새 파일: `pi-extensions/lib/herdr-placement.ts`(순수 조인 코어) · `scripts/check-herdr-placement.ts`(17 assertions, herdr 바이너리 불필요) · `scripts/mutants/herdr-placement.json`(8개, 전부 KILLED). 수정: `entwurf-facts.ts`(3번째 관측 축) · `entwurf-peer-observe.ts`(bounded 1회 읽기, `HERDR_ENV=1`+`HERDR_BIN_PATH`만 보고 시작) · `entwurf-fact-provider.ts`(주입식 `readPlacementIndex`) · `entwurf-peers-render.ts`(행 끝 칸) · `docs/mux-launch-rail.md`(§7 제3 evidence + §7-a 어휘·무재시도) · 3개 기존 게이트 fixture · `tsconfig.json` fence · `run.sh`/`package.json` 등록 · lane inventory. 레코드 스키마·writer parity·store 세대 무변경.
- [2026-09-14] GLG 결정: S2 게이트는 격리 서버로 가고 **조인 축까지 결정론으로 내린다** — 샌드박스 안에서 `herdr integration install pi`를 게이트가 직접 부른다. LIVE 전용으로 남기지 않는다. Hard Rule 17은 이 걸음을 막지 않는 것으로 읽는다(herdr 자기 바이트, 샌드박스에 갇힘).
- [2026-09-14] S0 측정(opus, 오라클). herdr 격리 서버는 **결정론 게이트로 쓸 수 있다** — `HOME`/`XDG_CONFIG_HOME` 샌드박스에서 `herdr server`가 `<sandbox>/.config/herdr/herdr.sock`으로 뜨고(클라이언트 attach 불필요), `workspace create`→`pane split`→`pane read`(실 PTY 셸 프롬프트 보임)→`pane close`→`server stop` 왕복 성공, 소켓 회수됨, 잔여 프로세스 0. 오퍼레이터 서버(w1:p1·w2:p1) 스냅샷 전후 **IDENTICAL**. 단 샌드박스엔 herdr integration이 없어 `agent start`는 되지만 `agent_session=null` → **조인·콜백 왕복은 LIVE 전용**. 상세는 RAIL 4번 증거 등급.
- [2026-09-14] F-0 측정(opus, 오라클). herdr가 연 claude → 2초 내 레코드 `20260914T141518-2b4e3b`, `entwurf_v2` mailbox delivered·읽음 영수증. pi 기본 argv → 레코드 없음(`entwurf-control.ts:1108`), `-- --entwurf-control` → 레코드·alive·control-socket·왕복 성립. herdr는 `agent_session` 확정을 밀어주지 않는다(`pane.updated`는 플러그인 `[[events]]`에서 unknown, `events.subscribe`는 3종뿐, `pane.agent_detected`는 조인 키보다 먼저 옴) → push-triggered pull. claude 축 hooks 파일 공유 충돌 없음(entwurf는 `hooks.*` 미소유, `check-keyset-overlap` disjoint). `herdr plugin link`는 git 서브디렉토리 가능, 액션 id에 점 불가.
- [2026-09-14] NEXT 교차 검토(opus): Blocker 0 / Defect 4(§7 닫힌 목록·빈칸 어휘 이중·fresh-call 줄번호·RAIL 오타) / Observation 3 — 전부 반영.
- [2026-09-14] 공존 단계 제안(opus). S1 대안 B(런타임 조인) / S3 문서만 / S2 형제 모듈 / S4 제외 / S5 마지막 / S0 신설. 측정 pane w2:p2~p8 닫음. 브랜치 생성.
