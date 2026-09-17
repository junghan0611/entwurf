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
- [x] **5. S5 · herdr 플러그인 껍데기 (M2)** — **M2-a·M2-b 착지, aggregate floor와 GLG operator acceptance 완료.** `[결정 GLG direct 2026-09-14 밤]` M2는 herdr 플러그인 사용자면으로 간다: Herdr가 사용자면·배치·runtime 상태의 중심, Entwurf는 garden identity·공식 delivery·receipt. 방향은 **공장을 하나 더 짓는 것이 아니라 공방의 드라이버만 남기는 것**이다.
  - `[조사 완료 2026-09-15, 별동대 opus + 코디네이터 독립 독해]` 후보 A(리포 루트가 플러그인) / B(같은 리포 서브디렉터리) / C(별도 리포) 중 **B 채택**. `[결정 GLG direct 2026-09-15]` 플러그인 루트는 `plugins/herdr/`. 순서는 **M2-a(core `peer-facts`) → M2-b(`plugins/herdr/` 렌더러)**. 근거 셋: herdr의 `owner/repo/subdir` install이 공식 문법이고(`src/cli/plugin.rs:726-777 @ c77af189`), `plugin link`는 build를 돌리지 않아 체크아웃 개발/패키지 아티팩트/사용자 설치가 한 디렉터리에서 갈리며, B만이 `[[build]]` 0개를 실제 선택지로 만든다 — herdr는 build에서 `HERDR_*`만 스크럽하고 **HOME은 격리하지 않는다**(`src/cli/plugin.rs:1511-1529`).
  - **M2-a `[착지, f9cea1d]`** — core read-only `peer-facts` verb. M2-b가 shell로 placement 조인을 다시 구현하는 것(= 벤더 바닥의 decaying copy)을 막는 것이 이 걸음의 전부다. 상세는 아래 NOW의 「M2-a」 절.
  - **M2-b `[착지, 07c7cbc]`** — `plugins/herdr/`의 `herdr-plugin.toml` + overlay pane 렌더러. 상세는 아래 NOW의 「M2-b」 절.
- [ ] **6. S4 · resume herdr placement** ← PAUSED: herdr native session restore(`resume_agents_on_restore` 기본 on, `session-state.mdx:52-70` @ c77af189) ↔ `entwurf_resume_call` 소유권 충돌 미측정. 이 랩 밖. herdr 서버 재시작이 우리 pi 시민을 되살렸을 때 garden id 거동은 레인 종료 전 1회 재야 한다. `[S2-b가 절반만 좁혔다]` 재기동 시 **pane id는 재사용되고 terminal_id는 새로 난다**는 것까지는 격리 서버에서 쟀지만, 그 실험에는 **에이전트가 없었다**(맨 셸 3개) — restore가 에이전트를 되살렸을 때 native session이 같은지 새로 나는지가 정확히 S4의 미측정 칸으로 남는다

- [x] **7. M1-b · 배치 정책 교체 (split → 같은 workspace의 새 tab)** — `[GLG direct 승인 2026-09-15]` 구현 + **교차검수 amendment 1회 + C4 LIVE PASS**를 checkpoint로 묶고, 예정했던 qualification **547/547**과 `check:full` **exit 0**까지 후속 완료했다. 상세는 아래 NOW의 「M1-b」 절.

- [x] **8. M3 · clean-host activation** — M3-a(`9813717`)·M3-b1/b2(`28d1324`)·M3-b3(`ee535a1` + 후속 `cd30388`·`1c77710`·`6339cd2`·`7b16298`) 착지. `[GLG 직접, 날것 PC gq-6aab44, herdr 0.9.1, 2026-09-17 14:14]` `herdr plugin install` 한 번으로 pi·claude-code 배선, **claude → pi fresh call + nonce 콜백 + 답장 왕복 성공**. 상세는 아래 NOW.
- [ ] **9. 브랜치 CI green + herdr rail 첫 프롬프트 수선** ← CURRENT: 아래 NOW 「좌표 2026-09-17 15시」 1→2→3→4 순서. 수용 기준은 날것 PC에서 **pi → claude-code(sonnet) 콜백 성공**(GLG 직접).
- [ ] **10. main 안착** ← 9 뒤. **0.22.0 컷 완료(2026-09-17 21:17, tag `v0.22.0` @ `ea28e56`, GitHub release 공개)** — npm publish만 GLG 몫. main 다음 수는 #117. merge 순서는 NOW 「main 안착」.

현재 좌표: 0~5·7·8 완료 → **9 진행(CI red 2건 + sonnet 거절 수선)** → 10 대기(main 0.22.0 컷과 병렬) → 6 보류

# NOW

## 좌표 2026-09-17 15시 — 코디네이터 판 `[fable, oracle]`

**상태명: 날것 PC에서 pi는 됐고 claude-code(sonnet)는 첫 프롬프트를 injection으로 거절했다. 브랜치 CI는 뮤턴트 2개로 red. main은 0.22.0 prepare 상태이고 그 CI도 red다. 둘 다 작다.**

측정 receipt (전부 GitHub CI 로그·소스 `file:line`, 2026-09-17 12시 KST):

- 브랜치 `7b16298` CI `check` **red** — qualification 648/650. `HSUP-MANIFEST-SSOT` SURVIVED, `HSUP-DIGEST-SHAPE` MUTANT-STALE. 원인: `cd30388`이 `scripts/fixtures/herdr-supply.json`을 herdr 0.9.0→0.9.1로 올리면서 `scripts/mutants/herdr-supply.json`의 find(옛 sha `4fa1a011…`)와 삽입 상수 `"0.9.0"`을 안 따라 올렸다. 게이트 `check-herdr-supply.ts:85-91`은 `"0.9.1"`만 검사하므로 `"0.9.0"` 삽입이 산다.
- main `4158b79`(0.22.0 prepare) CI `check` **red** — qualification 518/520. `CODEX-LAUNCH-CWD-ANCESTOR-PLAIN-PATHS-ONLY`·`FRESHCALL-CODEX-LAUNCH-CWD-NOTES-NEVER-REFUSES` SURVIVED, 둘 다 `attribution=vitest-failed-titles(0)`. 후속 `c4afe92`의 green은 qualification 스텝 **skipped**(docs-only 판정)이라 영수증이 아니다. tag/npm 없음.
- merge-tree origin/main × 브랜치: conflict **11파일**. 실작업은 `pi-extensions/lib/mux-fresh-call.ts` 한 곳(558줄 — main의 codex-launch-cwd leaf × 브랜치의 herdr composition). 나머지: 산문 3(`README.md`·`.claude/skills/entwurf-dev/SKILL.md`·`entwurf-control.ts` 주석) = origin/main 기준 + herdr 문장 복원, `mutants/*.json`·`package.json` check chain·`check-gate-qualification.ts` inventory = 합집합.

`[GLG 직접, 날것 PC, herdr 0.9.1, 저널 2026-09-17 14:14]` 세 시험:

| 시험 | 결과 | 원인 (`file:line`) | 성격 |
|---|---|---|---|
| claude → pi (`openai-codex/gpt-5.6-terra`) | **성공** — nonce 콜백 + "형제 호출 성공" 왕복 | — | #116 수용 영수증 |
| pi → claude-code (`claude-sonnet-5`) | 탭 열림·MCP 붙음·**Sonnet이 첫 프롬프트를 injection으로 거절**, 두 번째 요청도 거절 | herdr rail만 `HERDR_DECODE_INSTRUCTION`(`herdr-fresh-call.ts:81`) "Decode the following JSON string literal…" 래퍼로 감싸고, 공통 composition `fresh-call-composition.ts:269` "Do not inspect environment variables, do not call entwurf_self"가 겹침. tmux rail은 같은 본문을 평문 argv로 줘 Opus/Fable에서 통과했을 뿐 | **#116 마지막 실결함**. 안전성 높은 모델일수록 거절 → 사용자 설치 경로에서 재현 확률 높음 |
| pi → `entwurf/claude-sonnet-5` (ACP) | 실패 `Could not start dynamically linked executable … claude-agent-sdk-linux-x64/claude` | NixOS + nix-ld 부재. oracle은 `nixos-config/machines/shared.nix:109` `programs.nix-ld.enable = true` | entwurf 결함 아님. 플러그인 README 전제 한 줄 |

Sonnet이 덧붙인 관측 둘은 기록만: (a) 첫 답에서 "entwurf-bridge MCP 없음"이라 했다가 다음 턴에 tool description을 읽었다 — lazy load. (b) `entwurf_v2` description의 긴 서술문을 "tool poisoning 정황"으로 읽었다. 지금 고칠 것은 아니고 description 길이는 Observation.

### 순서 — 실무 Opus, 이 순서대로 (1 뒤에 main lane으로 갔다가 돌아와도 된다)

1. **HSUP 뮤턴트 2개 갱신** — `scripts/mutants/herdr-supply.json`의 `HSUP-DIGEST-SHAPE` find를 0.9.1 sha(`2a02fed1…`)로, `HSUP-MANIFEST-SSOT` 삽입 상수를 `"0.9.1"`로. focused `check-gate-qualification` lane `herdr-supply` KILLED 확인 → push → CI `check` green이 영수증. 코드 변경 0.
2. **herdr rail 첫 프롬프트 수선.** 측정 먼저: herdr `agent start`가 개행 포함 prompt를 어떤 경로로 받는가(래퍼가 생긴 이유가 pane shell에 argv를 쓰는 것이라면 개행 없는 조인이나 파일 경유가 대안인지 격리 서버에서 잰다). 그다음 composition 문장을 투명하게 — 누가(호출자 garden id) 왜 열었고 nonce가 무엇인지 말하고, 부정 지시("보지 마라") 대신 순서만 정한다. 공통 leaf라 tmux rail도 같이 바뀌고 `mux-fresh-call`·`herdr-fresh-call` 뮤턴트가 따라간다. **수용 기준 = 날것 PC에서 pi → claude-code sonnet 콜백 성공(GLG 직접).** Opus/Fable로 통과시켜 놓고 끝내지 않는다.
3. **플러그인 README 전제 두 줄 + 설치 후 안내(6339cd2)에 모델명 예시** — NixOS는 nix-ld 필요(ACP claude 바이너리), 모델 예시 `claude-sonnet-5` / `openai-codex/gpt-5.6-terra`. GLG "정확한 모델명을 모른다"가 근거.
4. **#116 checkpoint 코멘트**에 오늘 GLG 영수증(herdr 0.9.1, claude→pi ✓, pi→claude-code sonnet ✗→수선 후 ✓)과 1~3의 SHA 기록. 그 뒤 이 파일 삭제(머지 전 규칙), durable한 것은 `docs/herdr-launch-rail.md`.

`[minor, GLG 개인취향 — 넣을지 GLG가 정한다]` statusline의 device 라벨: `scripts/meta-bridge-statusline.sh:25,67-72`·`scripts/agy-statusline.sh:31,80-83`이 `~/.current-device`가 없으면 `UNKNOWN`을 찍는다. 그 파일은 GLG nixos-config 관례라 사용자 설치 호스트엔 없다 → line1 첫 칸이 항상 `UNKNOWN`. 후보: 파일 없으면 칸 자체를 비운다(hostname 대체는 새 정보축이라 비추천). 이슈 상한(현재 12 > 10)이라 별도 이슈 대신 여기 두고, 3번과 같은 커밋에 실어도 되고 빼도 된다.

#118(`entwurf pi` 런처)은 이 브랜치에 얹지 않는다 — merge 뒤 main에서 짧은 브랜치.

### main 안착 — 9 뒤

`[갱신 2026-09-17 21:30, 코디네이터 fable]` **0.22.0은 나갔다.** 영수증(Opus `20260917T144714-0459ec` 측정, 코디네이터가 tag/release/artifact 대조): exact-SHA CI `ea28e56` run `35215263800`(qualification body 520/520) · LIVE `release-gate --cut` MUST 24/0/0 `cut: OK`(`/tmp/entwurf-release-gate-0.22.0.royX2L`) · candidate `/tmp/entwurf-release-candidate-0.22.0.GAQERG/junghanacs-entwurf-0.22.0.tgz` sha256 `e1e2868a…fd0ccf` 12,855,699 bytes(리팩 없음) · main NEXT.md `0b0a575`. **남은 것: GLG의 `npm publish`(그 tgz 그대로, `latest`) + 레지스트리 integrity 대조.** 그 뒤 main 다음 수는 #117이고, 이 브랜치 merge는 그 다음이다 — 아래 순서 그대로.

`[이번 컷이 #116에 준 교훈 — 9-2 설계 입력]` chain 스모크의 hop A(Sonnet 5)는 **페이로드 안의 권한 문장을 인젝션 표식으로 지목**했고(1차 실패), **권한을 채널로 옮기자**(게이트가 민팅한 world의 `AGENTS.md`/`CLAUDE.md`, GLG 전역 규칙 "nearest AGENTS.md") 통과했다(`f5d6e10`). herdr rail의 Sonnet 거절도 같은 축이다 — 프롬프트 문구 튜닝으로 넘기려 하지 마라. 다만 fresh_call의 cwd는 사용자 프로젝트라 그 채널을 못 쓴다. 후보: 콜백 nonce를 sibling이 `entwurf_self`/MCP 서버 쪽에서 검증 가능한 형태로 만들거나(권한이 도구 쪽에 있음), 첫 프롬프트를 "부른 사람의 garden id + 이 호출이 entwurf_fresh_call 영수증에 있다"는 **검증 가능한 사실**로만 구성. 측정 먼저.

`[컷 중 호스트 조작 기록]` oracle `~/.codex/hooks.json`은 herdr 그룹을 `.herdr-bak`으로 옮겨 잰 뒤 `herdr integration install codex`로 복원했다(doctor-codex-birth RED 복귀 = #117 상태, 정상). app-server pid 2777024(`codex-appserver` $208)는 살아 있음. worktree `~/repos/wt/entwurf/main`(detached)은 Opus 퇴근 뒤 `git worktree remove`.


- **main lane이 먼저**(별도 실무자, herdr와 병렬 가능): `4158b79` SURVIVED 2 수리 → `workflow_dispatch`의 force 입력으로 qualification 본체 exact-SHA green → `entwurf-release make` 0.22.0 → GLG npm publish. 풀 floor는 CI가 진다(체크아웃 `check:full` 5~9분 + CI qualification 40~55분 + LIVE `release-gate --cut`). 짧게 가는 길은 없고 실무자가 거부하는 것이 맞다 — 앞선 컷들과 같은 증거 등급이어야 0.22.0이다.
- 그 다음 **브랜치에 origin/main(=v0.22.0 tag) merge** → 위 11파일 해소 → CI(stale 뮤턴트 반드시 나옴, 그것도 고친다) → main fast-forward → push(GLG) → 0.23.0 prepare/make → npm publish → `plugins/herdr/runtime-lock.json` `source: npm` 0.23.0 핀 커밋(사용자 설치 문 확정; 0.22.0은 `scripts/herdr-*.mjs`가 없어 핀 불가) → 플러그인 `version` 0.2.0.
- 이슈: #95 close(`d0f2a86`), #116 close(merge SHA), #117은 main lane 다음 수. open ≤ 10.

## M3-b3 raw-PC 1차 시도 — 실패 원인 확정·수리 `[2026-09-17]`

**상태명: 날것 PC 설치가 우리 `prepare` 때문에 깨졌고, 원인은 재현으로 확정됐다. 수리는 한 줄. 남은 것은 full floor와 GLG의 재시도다.**

`[GLG 실관측, 날것 PC, herdr 0.9.1]` `herdr plugin install junghan0611/entwurf/plugins/herdr --ref feat/116-herdr-coexist`
(commit `ee535a17`)가 build에서 죽었다:
`runtime-checkout-source-unavailable: npm pack --json was unreadable: Unexpected token '.', ".git can't"...`.

`[측정 2026-09-17, oracle, npm 11.16.0 / node 24.18.1]` 같은 커밋을 두 remote로 pack해 원인을 갈랐다.
스펙 하나만 다르고 나머지는 전부 같다.

| pack spec | stdout 선두 | 판정 |
|---|---|---|
| `git+https://github.com/junghan0611/entwurf.git#ee535a17` | `` .git can't be found.git can't be found[ `` | `JSON.parse` 실패 = GLG가 본 그 에러 |
| `git+file:///tmp/…/entwurf.git#ee535a17` | `[` | 깨끗, exit 0 |

둘 다 **exit 0**이고 tarball은 13,017,411 bytes로 동일하다 — 획득은 성공했고 읽는 쪽만 깨졌다.
사슬: `package.json:prepare`가 `husky 2>/dev/null || true`였는데 **husky v9는 stdout에 쓴다**
(`husky/bin.js`의 `p.stdout.write`), `.git`이 없으면 `.git can't be found`(`husky/index.js:11`).
GitHub git spec을 pack할 때 prepare가 도는 트리에는 `.git`이 없다(codeload tarball). npm은 lifecycle
stdout을 `--json` 스트림에 합치므로 JSON 앞에 그 줄이 붙는다. `readPackedArtifact`의 이름 붙은 거절은
**정확히 계약대로 동작했다** — 결함은 우리가 채널을 오염시킨 것이다.

**두 검증축이 모두 못 본 이유가 이 건의 본체다.**
- 결정론: `check-herdr-runtime-bootstrap` 25번 셀의 가짜 npm이 `echo "[]"`를 낸다. lifecycle 접두사가 붙은 stdout을 한 번도 모델링하지 않았다.
- LIVE: `smoke-herdr-plugin-build-live.ts`가 제품 remote를 `insteadOf`로 로컬 bare mirror에 돌린다. `file://`는 **진짜 clone**이라 prepare cwd에 `.git`이 있고 husky는 침묵한다. **치환이 시험 대상 조건 자체를 제거했다.**

**수리 (이 커밋):** `"prepare": "husky 1>&2 || true; npm run --silent build-bridge 1>&2"`.
진단은 stderr로 남고(2026-04-27 pi-shell-acp 전례가 경고한 것) npm이 파싱하는 stdout만 비운다.
게이트 셀 `[QK:HRB-PREPARE-STDOUT-CLEAN]` 신설 — `prepare`의 모든 명령이 stdout을 stderr로 돌리는지
우리 `package.json`을 읽어 판정한다. 뮤턴트 1개(옛 줄로 되돌리기) 추가, lane `herdr-runtime-bootstrap`
30→**31**, 인벤토리 643→**644**.

**herdr 0.9.1 정렬 (같은 커밋).** `[측정 2026-09-17]` digest로 받은 0.9.1 aarch64
(`f4ccf4de…8d9e`, 릴리즈 API digest와 일치)를 temp에서 실행해 쟀다 — **오퍼레이터 설치본은 건드리지 않았다.**
- `check-herdr-sandbox` **11 assertions green** (`ENTWURF_REQUIRE_HERDR=1`, `HS-OPERATOR-UNTOUCHED` 포함)
- `herdr status client` → `protocol: 22` — 0.9.0과 동일
- `integration status` → **17행 → 18행**, 추가분은 `letta (experimental)` 하나뿐이고 나머지 17행은 바이트 동일
- 공급 핀 `scripts/fixtures/herdr-supply.json` → 0.9.1 / `v0.9.1` / tagCommit `065ef9d6…`
- `min_herdr_version`은 **0.9.0 그대로 둔다** — 0.9.1을 요구할 측정된 이유가 없고, floor를 올리면 0.9.0 호스트를 이유 없이 배제한다

**⚠️ 오라클 로컬 플로어가 지금 빨갛다.** 공급 핀은 0.9.1인데 `~/.local/bin/herdr`는 0.9.0이라
`check-herdr-sandbox`의 `HS-VERSION-BOUNDARY`가 드리프트를 정확히 잡는다(그게 그 셀의 목적이다).
`herdr update`로 오퍼레이터 herdr를 0.9.1로 올리면 풀린다. **GLG 권위** — 0.9.0 서버가 떠 있는 동안
에이전트가 바이너리를 갈아끼우지 않았다.

**초록 (exact 워킹트리, 2026-09-17):** `check-herdr-runtime-bootstrap` **31** · `check-herdr-supply` **11** ·
`check-herdr-plugin-profile` **14** · `check-herdr-plugin-build` **10** · `check-herdr-plugin` **32** ·
`check-herdr-activation` **24** · `check-gate-manifests` **644 mutants / 54 lanes** · `pnpm lint` exit 0 ·
`pnpm typecheck` exit 0 · 신설 뮤턴트 수동 kill-proof(옛 prepare 줄 주입 → exit 1, 실패 라인에 `[QK:HRB-PREPARE-STDOUT-CLEAN]`).
**아직 안 돈 것: qualification 전량(644)과 `pnpm run check:full`.** 이 커밋은 GLG의 날것 PC 재시도를 막지 않으려는
체크포인트다 — full floor는 별도.

## M3-b3 F — 설치 중 침묵 제거 `[2026-09-17]`

`[관측: GLG, 날것 PC, herdr 0.9.1]` `y` 누른 뒤 아무 출력 없이 몇 분 — "멈춘 줄 알았다".

`[측정: 소스 읽기, ~/repos/3rd/herdr @ c77af189, src/cli/plugin.rs:1328-1373]` herdr는 `[[build]]`를
**stdout·stderr 둘 다 pipe**로 잡아 tail-capped 버퍼에 담고, `if status.success() { return Ok(()) }` —
**성공하면 버퍼를 버린다.** 실패할 때만 찍는다. 그래서 build.mjs가 이미 쓰던 `[herdr-plugin-build] …`는
성공 경로에서 구조적으로 안 보였다. 우리 쪽 결함이 아니라 herdr 인터페이스 속성이다.

`[측정 2026-09-17]` herdr와 **정확히 같은 spawn 모양**(stdin null, stdout/stderr piped)으로 자식을 띄우고
`/dev/tty`에 쓰면 그 줄은 터미널에 **즉시** 뜨고 **두 캡처 버퍼 어디에도 안 들어간다**. herdr가 바꾸는 것은
우리 stdio이지 controlling terminal이 아니기 때문이다. E2E로도 확인했다 — 가짜 herdr를 PATH에 두고
piped stdio로 build.mjs를 돌리니 `[entwurf 1/5] …` / `[entwurf done] …`이 터미널에 live로 뜨고,
같은 줄이 부모의 captured stderr에도 남았다.

**출하한 것:** 새 leaf `plugins/herdr/lib/build-progress.mjs` + build.mjs의 5단계 서술.
- 터미널이 없으면(CI·파이프·데몬) **조용히 무력**하다 — 서술 때문에 설치가 깨지면 본말전도다.
- 모든 줄은 stderr에도 미러된다. 성공 시 공짜(herdr가 버림), **실패 시 그게 에러 앞에 붙는 발자취**다.
- 사람 문장만 나른다. 서브프로세스 출력도, 누가 파싱할 데이터도 아니다.
- 가장 긴 3단계는 "무엇을 어디서 받는 중이고 몇 분 조용할 것"이라고 말한다.

게이트 2셀 신설 — `[QK:HPB-PROGRESS-NAMED-SEQUENCE]`(5단계 순서·긴 단계 명명, 활성화 대상 없으면 1단계 뒤
곧장 done: 안 한 일을 서술하지 않는다) · `[QK:HPB-PROGRESS-TTY-OPTIONAL]`(터미널 없어도 무력+미러 유지,
close 두 번도 무해). 뮤턴트 2개, lane `herdr-plugin-build` 9→**11**, 인벤토리 644→**646**. 각각 단독 주입으로
kill 확인(실패 라인에 자기 QK).

### F-2 — "설치했는데 아무도 안 알려준다" `[2026-09-17]`

`[관측: GLG, 날것 PC]` 설치 성공 후에도 `pi --entwurf-control`을 쳐야 시민이 된다는 걸 아무도 말해주지 않는다.
"나는 이렇게 해놔서 문제가 없는데 그냥 둬선 아무도 모를 것 같다."

**이건 결함이 아니라 설계다** — 시민권은 argv로 잠근다. 플러그인의 pi 배선은 `~/.pi/agent/settings.json`의
**user-scope 패키지 등록**이라(`scripts/herdr-plugin-activate.mjs:138-160`) 확장은 그 호스트의 **모든** pi에
로드되지만, 플래그가 있어야 레코드·소켓·도구가 선다. 켜기만 하면 시민이 되는 pi는 오퍼레이터가 요청하지 않은
결정을 내리는 것이다. 문제는 **그 두 사실이 밖에서는 "설치가 아무것도 안 했다"와 구분되지 않는다**는 것.

**출하한 것 둘 — 둘 다 "사용자가 틀린 순간"에 말한다.**
1. **설치 마지막 줄** (`[entwurf] …`) — 활성화한 backend마다 한 줄. 두 배선이 정반대라 각각 다른 문장이다:
   claude-code는 MCP라 `claude`만 치면 되고, pi는 플래그가 필요하다. 새 `progress.note` 채널(done과 분리 —
   note는 결과가 아니다). 게이트 `[QK:HPB-INSTALL-USAGE-NOTE]`.
2. **플래그 없이 켠 pi** — 확장이 UI에 한 줄, **프로세스당 한 번**. `ctx.hasUI` 게이트라 `pi -p …` 파이프라인엔
   안 나간다(옆 refusal이 stderr를 always 쓰는 건 그게 durable fault이기 때문이고, 이건 평범한 상태다).
   게이트 `[QK:SELFADDR-UNCITIZENED-NOTICED]` — self-address 레인이 "없는 주소를 주장하지 않는다"의 거울면이라
   그 집에 뒀다.

**플래그를 말하지 launcher를 말하지 않는다.** PATH에 무엇을 놓을지는 오퍼레이터 결정이고 이 플러그인은 거기
한 바이트도 안 쓴다. `entwurf-pi` bin은 별건(아래).

뮤턴트 2개, lane `herdr-plugin-build` 11→**12** · `self-address` 5→**6**, 인벤토리 646→**648**, 각각 단독 kill 확인.

**독립 검수 (opus 형제 `20260917T123612-7479b4`, 2026-09-17) — Blocker 2 / Defect 2, 전부 처리:**
- `[B2 · 재현으로 확인 · 수리함]` `[QK:SELFADDR-UNCITIZENED-NOTICED]`의 소스 정규식이 자기 주장의 3분의 2를
  안 죽였다. **false success**다. 내가 직접 재현했다 — 호출을 시민 분기로 옮겨도, once-latch를 지워도
  **51/51 green**. 정규식은 호출이 존재하는지만 본다; 어느 분기에 있는지도, 몇 번 불리는지도 못 본다.
  수리: 세 조건을 순수 결정 `decideUncitizenedNotice`(self-address fence)로 빼고 호출을 **무조건**으로 바꿔
  `controlEnabled`를 사실로 넘긴다 — 분기가 사라지니 옮길 자리가 없다. 셀 1→3
  (`-DECISION` 진리표 8행 · `-NOTICED` 호출부가 진짜 플래그를 나름 · `-ONCE` latch),
  뮤턴트 1→3, 검수자가 통과시킨 두 뮤턴트가 이제 **각자의 claim으로** 죽는다. 53 assertions.
- `[B1 · 이슈 본문 수선함]` #118 초판이 `entwurf copilot`(`run.sh:6961-6975` + `scripts/copilot-launch.sh`)이라는
  **이미 출하된 선례**를 인용하지 않고 설계 질문 넷을 다시 열었다. 본문을 그 좌표로 고쳤고, 남은 진짜 질문은
  둘로 줄었다(pi 런처 선행조건 0인가 · 플래그 중복 argv 스캔).
- `[D1 · 수리함]` note 순서 계약 — spine 셀이 여섯 자리를 전부 핀으로 박고 있어 이미 구조적으로 보장되는데
  산문이 그걸 말하지 않았다. 산문을 고쳤다(중복 술어를 note 셀에 넣었다가 **엉뚱한 claim이 먼저 터져서** 뺐다 —
  "앞 셀이 먼저 트립하면 안 된다"의 실례).
- `[B3 · #118 선행조건으로 이월]` `--entwurf-control` 리터럴 6곳, `acp/session-store.ts:52`에 상수가 있는데도
  `6339cd2`가 둘 늘렸다. 런처가 7번째를 낳는 자리이므로 게이트 대조를 그 작업의 선행조건으로 박았다.
- `[검수가 기각한 의심]` `cd30388`의 `prepare` 범위는 정확하다 — 디렉터리 spec은 prepack/prepare/postpack이
  전부 stdout에 섞이지만 **git spec은 prepare 하나만** 돈다(검수자 독립 재현, `herdr-runtime.mjs:420-430`의
  기존 측정과 일치).
- `[Observation, 열지 않음]` notice에 은퇴 조건이 없다 — 그 호스트의 **의도적으로 시민이 아닌** 모든 pi가
  프로세스당 1회 권유를 받는다(GLG 본인이 그렇게 쓴다). ACP `--provider entwurf` 세션도 받는다. 메타 스토어가
  답을 알지만 IO 0인 경로에 스토어 읽기가 붙는다.

**열린 후속 `[GLG 결정 대기]`** — ① `entwurf-pi` bin(새 표면이라 이슈 하나 값어치; `pie`는 GLG bashrc 한 줄
별칭이 맞다 — 이미 `pit`/`pius`로 하는 방식) ② fresh_call 모델 거절 규칙은 #76으로 나갔다
([issuecomment-5707946216](https://github.com/junghan0611/entwurf/issues/76#issuecomment-5707946216) —
맨 alias 경로는 본문 가드로 못 막는다는 새 사실 포함).

**이월 관측 `[Observation]`** — 근본 수리는 herdr 쪽이다: `[[build]]` 출력을 성공 시에도 스트리밍하거나
최소한 단계 진행을 보여주는 것. 우리 `/dev/tty` 서술은 그때까지의 우리 몫이고, herdr가 스트리밍을 켜도
중복되지 않는다(우리는 5줄만 쓴다). herdr에 이슈로 올릴지는 GLG 판단.

**다음 한 걸음:** GLG가 날것 PC(herdr 0.9.1)에서 `--ref feat/116-herdr-coexist`로 재설치.
이제 checkout은 **이 커밋**이므로 pack이 깨끗한 JSON을 낸다.

**이월 관측 `[Observation, 지금 열지 않는다]`** — LIVE 게이트의 `insteadOf` 치환은 GitHub codeload 경로를
구조적으로 재현하지 못한다. 같은 계열의 다음 결함(어느 devDependency의 prepare든 stdout에 쓰면 재발)을 잡으려면
LIVE 쪽에 "prepare cwd에 `.git`이 없는" 조건을 만들거나, `readPackedArtifact`를 첫 `[`부터 읽도록 관용화해야 한다.
후자는 계약 변경이라 자기 뮤턴트를 벌어야 한다.

**상태명(정확히 이대로 쓴다): M1 complete; corrected C4 LIVE PASS.**
`[close 승인: 코디네이터 sol, 2026-09-15 — Blocker 0]` C4 PASS는 **이 opt-in 수용의 판정**이다. release aggregate 통과도, 전량 qualification도 뜻하지 않는다 — C4는 여전히 `check:full` 밖이고 aggregate 밖이다(VERIFY.md 문장). #116은 M2를 위해 **OPEN으로 유지**한다.

- Landed: 브랜치 `feat/116-herdr-coexist` = `2f97fc0`(공개 배선) + **`d8c85b2`** + **`5c1f68b`** + **`6684c41`**(C4 acceptance artifact) + **`8e5857d`**(레일별 C4 oracle 수선) + **`8f6c4fb`**(착지한 계획의 미래시제 산문 수선) + 이 문서. `LIVE=1 ./run.sh smoke-herdr-fresh-call-live`는 `8e5857d`에서 **exit 0, 29 assertions ok, 1m49s**, 영수증 `/tmp/herdr-fresh-call-live-exr8fL/receipts.md`. 전부 푸시됨.
- **M1-b floor 완료 `[측정 receipt, 코디네이터 sol, 2026-09-15]`:** exact HEAD `073938c`에서 `check-gate-qualification` 본체 **547/547 exit 0**(`bg04`), `build-bridge` 뒤 `pnpm run check:full` **509s exit 0**(`bg06`). #116 기록은 `issuecomment-5677631940`. M1-b는 더 이상 floor pending이 아니다.
- **M2-a 착지 `[커밋 f9cea1d]`** — core read-only `peer-facts` verb. 아래 「M2-a」 절은 그 커밋의 기록으로 남긴다.
- **M2-b 착지 `[커밋 07c7cbc]`** — read-only status pane. exact `07c7cbc`에서 qualification **566/566 exit 0**(56m46s)와 `check:full` **514s exit 0**(tarball 512 files), #116 `issuecomment-5679118371`. `[GLG direct operator acceptance]` real Herdr에서 link → status overlay open → unlink까지 통과하고 registry `[]`로 복귀, `issuecomment-5689610012`. `3d764a9`·`073938c`·`f9cea1d`·`07c7cbc` 넷은 **origin에 아직 없다**(`[ahead 4]`, 측정 2026-09-16) — push는 GLG 권위.

## M3 — clean-host activation `[열림 2026-09-16]`

`A = E ∩ H ∩ P`, `P = {pi, claude-code}` 동결. 좌표 SSOT는 #116 `issuecomment-5689767140`(교집합 계약) · `-5690300559`(lane freeze) · `-5690400550`(raw-PC 수용 목표) · `-5690462527`(M3-0 판독 계약).

- **M3-0 측정 착지 `[코드 0줄, 2026-09-16]`** — H의 출처 `herdr integration status`를 shipped 0.9.0 바이너리로 격리 HOME/XDG에서 쟀다. 원자료 `.agent-reports/116-m3-h-source-measure-20260916.md`(gitignore, host-local), 결정적인 줄은 `issuecomment-5690462527`에 붙였다. 판독 계약을 정하는 사실 넷: (1) **기계 출력 없음** — `--json`/`--format=json`/`-o json` 전부 `exit=2 usage:`, 정상 status는 어떤 상태에서도 exit 0이라 **exit code가 판정을 못 나른다**. (2) **`outdated (legacy < vN)`는 catch-all** — 빈 파일·`chmod 000`·마커 없는 본문이 전부 같은 문자열. 그래서 selected atom의 `outdated`는 named FAIL이지 SKIP이 아니다. (3) **`current`는 admission이지 무결성 주장이 아니다** — 마커 뒤 바이트 드리프트도, `v999`도 `current`. (4) **판독이 env에 휘둘린다** — 같은 바이트가 `PI_CODING_AGENT_DIR` 하나로 `current` ↔ `not installed`. 부수 사실: `integration install claude|opencode`는 **하네스 홈 디렉터리 존재만** 보므로(`install claude code first`, exit 1) 빈 디렉터리 fixture로 admit 가능 — Hard Rule 17 무사. operator 3표면(`integration status`/`plugin list`/`pane list`) 전후 IDENTICAL.
- **M3-a pure leaf `[checkpoint 착지 2026-09-16 · 교차검수 amendment 1회 반영]`** — `plugins/herdr/lib/integration-profile.mjs`: listing 문자열 → 동결된 activation plan. IO·env·process·write·watch·retry·cache 0, **미배선**(status.mjs가 import하지 않는다). 계약 **열넷**, 각자 자기 QK + exact-once mutant.
  - **교차검수 amendment `[Terra `20260916T100622-b1c32b` finding + 코디네이터 sol 독립 재현, 2026-09-16]`** — 1차 컷은 행의 **머리만** 읽고 나머지를 믿었다. before→after: `current (v8)`에 suffix가 아예 없을 때·상대경로일 때·닫는 괄호가 빠졌을 때·`()`일 때·`)` 뒤에 바이트가 남을 때 **다섯 셀 전부 activate**였고(재현 완료) 이제 다섯 전부 `herdr-status-row-malformed`. `pi:current …`처럼 colon 뒤 framing이 깨진 행은 **unrelated text로 버려지고 있었다** — 단독이면 `missing`으로 잘못 불렸고 valid 행 옆에 있으면 **그냥 무시**됐다. 이제 `<atom>:`가 행을 먼저 claim해서 단독=malformed, 병존=duplicate. 400자리 버전은 `Infinity`→JSON `null`로 조용히 통과했고 이제 u32 domain(0..4294967295) 밖은 malformed이며 경계값 `4294967295`는 계속 통과한다.
  - 계약 열넷: 닫힌 `{pi→pi, claude→claude-code}` 표 · missing/duplicate/malformed **세 거절을 각자의 QK로 분리**(1차엔 한 토큰이 셋을 대표하고 mutant는 duplicate만 심었다) · `<atom>:` 선언 framing · **행 전체 소비**(state + ` (<absolute path>)` + 줄끝, 경로 내부는 opaque) · u32 버전 domain · **front-anchored** state(`/srv/current (v9) (/x)/` 같은 디렉터리 이름이 판정을 못 정한다) · 표시 경로가 plan에 한 글자도 안 남는다(framing 검증 ≠ 주소 승격) · outdated·needs-repair는 named FAIL · not installed는 zero-write SKIP · `current`는 herdr의 admission이라 우리 floor를 덧붙이지 않는다 · P 밖 atom(OpenCode negative control)은 관측만이고 미지 atom의 깨진 행이 listing 전체를 막지 못한다 · 순수성.
- **M3-a checkpoint 수용 `[Terra 독립 재검증 Blocker 0 / Defect 0]`.** 측정 receipt `[2026-09-16, amendment 후]`: `check-herdr-plugin-profile` **14 assertions exit 0**, focused mutation으로 lane `herdr-plugin-profile` **14/14 KILLED + 14/14 정확 attribution**(claim마다 자기 QK가 첫 실패), `check-gate-manifests` **580 mutants / 51 lanes exit 0**(566 → 575 → **580**), 기존 `check-herdr-plugin` **32 assertions exit 0**, `pnpm run typecheck` 3 fence exit 0, biome 변경 5파일 exit 0. Terra가 suffix·delimiter·u32·QK mapping 네 셀을 별도로 재검증해 **Blocker 0 / Defect 0**. **이 checkpoint에서 미실행(의도)**: qualification 본체 · `check:full` · LIVE · push. M3 aggregate가 frozen candidate가 될 때 long floor를 한 번 실행한다.
- **M3-b0 측정 착지 `[코드 0줄, 2026-09-16]`** — clean-host 설치 트랜잭션의 실제 경계. 원자료 `.agent-reports/116-m3b0-install-topology-measure-20260916.md`(gitignore), 결정은 #116 `issuecomment-5690761095`. herdr `plugin install`의 **진짜 코드경로**를 git `url.insteadOf`로 **네트워크 0**에서 돌려 쟀다(가짜 바이너리·가짜 서버 없음). 설계를 정한 넷: (1) `[[build]]`는 **temp 체크아웃**에서 돌고 HOME·XDG는 호출자 것 그대로이며 `HERDR_*`는 전량 스크럽이라 build가 herdr 좌표를 **볼 수 없다**(`plugin.rs:193-230,1510-1528`). (2) reinstall은 managed 체크아웃을 **통째 교체**하고 config·state는 보존한다. (3) uninstall은 체크아웃만 지우며 **cleanup 훅이 스키마에 없다**(`schema/plugins.rs:51-61`) — herdr가 우리 역연산을 부를 자리가 없다. (4) build 실패는 원자적(registry·이전 설치 불변). 결정: **Entwurf 소유 stable active root**(managed-checkout `.runtime`과 PATH 선재 entwurf는 이름 붙여 기각), **post-build Herdr commit gap**은 저널로 이름 붙인다.
- **M3-b1 `[checkpoint 승인 2026-09-16 · Terra 최종 Blocker 0 / Defect 0]`** — `plugins/herdr/lib/runtime-bootstrap.mjs` + `plugins/herdr/runtime-lock.json`. 고정 주소 `$XDG_DATA_HOME/entwurf/herdr-plugin/runtime/active`(**실디렉터리**)에 exact `name@version`을 staging → 설치본 검증 → 디렉터리 swap으로 올린다. **미배선**.
  - **설계 변경 `[코디네이터 결정, Terra 검수]` — bin exposure는 b1에서 은퇴했다.** clean host에 새 `$XDG_DATA_HOME/.../bin`이 PATH일 근거가 없고 셸 프로필도 표준 bin 디렉터리도 건드릴 수 없으므로, load-bearing bare-bin 노출은 성립할 수 없는 조건에 기대고 있었다. `EXPOSED_BINS`/`exposeOwnedBins`/bin link 역연산과 그 QK 둘(`BIN-FOREIGN-REFUSED`/`BIN-TARGET-STABLE`)을 제거했다. 대신 세 bin은 **존재·실행가능을 검증만** 한다(`REQUIRED_BINS`). b2의 scoped wiring이 stable active root의 **절대경로 command**를 기록한다.
  - **amendment 1회 `[Terra 검수]`**: (A) 역연산 partial delete → 삭제 권위를 **전부 preflight한 뒤** 변이, 거절은 저널 바이트까지 불변. (B) 저널 없는 active를 말없이 파괴 → `runtime-owner-state-missing` **pre-mutation 거절**. (C) crash window에서 옛 런타임 영구 손실 → 상태표 + torn-swap 복구. (D) fixture 경계를 명시하고 **actual package 증명을 `check-pack-install`에 셀 합성**.
  - **amendment 2회 `[Terra 재검수 — Blocker 3 / Defect 1]`**: (E) `mkdir`이 판정보다 먼저였다 → **판정이 끝날 때까지 디렉터리 0개 생성**. (F) disk fact가 `existsSync`였다 → **lstat 기반 `absent|real-dir|symlink|other`**, dangling symlink를 absent로 읽지 않고 symlink/비dir은 이름 붙여 거절(runtimeRoot 포함 — 안 그러면 맨 ENOENT로 죽었다). (G) 저널 파서가 JSON `null`/array/scalar와 phase별 shape를 안 봤다 → 전부 `runtime-journal-uncertified`, phase가 함의하는 writer state와 digest가 어긋나면 거절, 빈 문자열은 identity 권위를 못 얻는다. (H) **상태표가 8조합 전부**로 확장. (I) **`stale-backup`이 active 검증 전에 previous를 지웠다** — 코디네이터가 잰 corrupt-active + good-previous에서 good 0으로 끝났다(내가 재현) → 이제 `inspectInstalledRuntime`으로 active를 먼저 보고, corrupt면 **previous를 복구**한다. (J) `installing` write가 직전 ready provenance를 덮었다 → 저널에 `previousRuntime`을 두어 백업이 존재할 수 있는 동안 provenance를 이어 나른다.
- **M3-b1 최종 수용.** `[Terra final recheck — Defect 1]` `readRuntimeLock`이 JSON `null` 뒤에 `.schemaVersion`을 읽어 **code 없는 native TypeError**를 흘렸다(재현함; array/scalar는 이미 이름으로 거절되고 있었다). 설치할 패키지를 정하는 **유일한 파일**이라 이름 없는 crash가 가장 나쁜 자리다 → field 접근 전에 shape를 보고 `runtime-lock-unreadable`. 별도 claim `HRB-LOCK-SHAPE-NAMED` + 자기 mutant로 귀속했다(integrity mismatch와 다른 결함). 계약 **열아홉**, 각자 자기 QK + exact-once mutant. 측정 receipt `[2026-09-16]`: `check-herdr-runtime-bootstrap` **19 assertions exit 0**, lane `herdr-runtime-bootstrap` focused mutation **19/19 KILLED + 19/19 정확 attribution**, **actual package 증명 `check-pack-install`** — `herdr-plugin runtime verifier: @junghanacs/entwurf@0.21.0 verified as an installed runtime (entwurf, entwurf-bridge, entwurf-statusline)` + self-fence pass, `check-gate-manifests` **599 mutants / 52 lanes exit 0**(580 → 591 → 594 → 598 → **599**), 기존 `check-herdr-plugin-profile` 14 · `check-herdr-plugin` 32 exit 0, `pnpm run typecheck` 3 fence exit 0, biome 변경 파일 exit 0. `[Terra micro-recheck]` JSON null/array/string/number/truncated lock은 전부 `runtime-lock-unreadable`, valid v1 lock은 통과했고 **Blocker 0 / Defect 0**. **미실행(의도)**: qualification 본체 · `check:full` · LIVE · push.
  - `[함정 기록]` 첫 실패 claim은 **게이트 파일의 assertion 순서**로 재야 한다(manifest 순서로 재다 한 번 오귀속). 그리고 **`run.sh`가 실행 중일 때 그 파일을 편집하면 안 된다** — bash가 파일을 이어 읽으므로 오프셋이 밀려 게이트 본문이 전부 통과한 뒤 꼬리에서 `her/: No such file or directory`로 죽었다.
  - `[M3-b2 입력, Observation]` 현재 inverse leaf는 `plugins/`에 있어 Herdr uninstall 뒤 checkout과 함께 사라진다. b2의 public deactivate는 **stable npm runtime에서 실행 가능**해야 하고 cleanup schema를 두 구현으로 포크하면 안 된다. 지금 refactor/public verb는 만들지 않는다.
- **M3-b2 `[구현 후보, 미커밋 2026-09-16]`** — scoped Pi/Claude 활성화. 공개 계약 #116 `issuecomment-5691382493`.
  - **owner move**: `plugins/herdr/lib/runtime-bootstrap.mjs` → **`scripts/herdr-runtime.mjs`**(npm에 실림). plugin 파일은 `export *` 한 줄의 thin re-export이고, 게이트가 그 한 줄임을 박는다. Herdr uninstall이 checkout을 지우고 cleanup 훅이 없으므로 **teardown 코드는 패키지 안에 있어야 한다.**
  - **Pi**: 신규 공개 verb `install-user-scope [--plugin-runtime <root>]` — **project write 0**의 정방향 seam(역방향 `remove-user-scope`만 공개였던 비대칭을 닫는다). plugin mode에서만 provider의 managed command가 **runtime root에서 파생한 절대 bridge**가 되고 그 값이 install-state에 기록된다. 상대/비정규 경로는 거절, 임의 command/path 플래그 없음, default bare 무변경. 역연산은 기존 user-scope ownership을 재사용하되 **command drift를 이름 붙여 거절**하고 남의 override를 지우지 않는다.
  - **Claude**: 같은 `meta-bridge-state.py` owner에 `--plugin-runtime` 추가(`desired_mcp`/`desired_statusline`), `meta-bridge-install.sh`가 `ENTWURF_PLUGIN_RUNTIME`로 같은 모드를 미러. **`preflight-uninstall`을 ledger 존재 확인에서 settings/claudeRoot 파싱 + 모든 restore 엔트리 적용 가능성 + owner/assembled 경로까지 zero-write로 확장**했고, 신규 `preflight-install`이 정방향 절반을 세운다. 벤더 `claude` CLI는 호출하지 않는다 — 절대 실행파일 수용은 **이름 붙인 LIVE 경계**.
  - **ledger + deactivate**: `scripts/herdr-activation.mjs`(certified schema: stable runtimeRoot, resolved Pi/Claude root와 그 **source**, activatedBackends, component outcome/ownership; clock 없음, P 밖 atom 거절) + 공개 verb **`entwurf herdr-plugin-deactivate`**. add-only(H가 줄어도 retain), roots drift는 pre-mutation 거절, preflight-all 뒤에만 첫 mutation, 순서 Claude → Pi → runtime → **ledger LAST**, component 실패는 runtime/ledger를 retry authority로 남긴다. **동적 import 0**(runtime 자기 삭제 뒤 lazy import는 ERR_MODULE_NOT_FOUND).
  - `[consumer cell이 잡은 진짜 버그]` main-module 가드가 `argv[1]`과 `import.meta.url`을 **미해석 비교**해서, pnpm이 패키지를 심볼릭 링크하면 가드가 조용히 false가 되고 verb가 아무것도 안 한 채 exit 0 — 모든 호출자가 성공으로 읽었다. realpath 비교로 고치고 `HAC-ENTRY-GUARD-REALPATH`로 박았다.
  - **amendment 1회 `[Terra Blocker 2 / Observation 1 + 코디네이터 실측 Blocker]`**:
    - **A. Claude state owner** — `preflight-uninstall`이 모든 entry에 `original`을 요구해 **실제 activation이 만든 state를 항상 거절**했다(코디네이터 receipt: `permissions.allow is not a restorable record`; `snapshot_array_items`는 `{originalExisted, added}`를 쓴다). 검사를 복제하지 않고 **`restore_entry`가 부르는 것과 같은 `certify_entry`** 하나로 합쳤다. `preflight-install`도 JSON-object 스모크에서 **진짜 `plan_snapshots`를 깊은 복사본 위에서 끝까지 돌리는 것**으로 올렸다(그래서 preflight green 뒤 prepare가 array-type로 죽지 않는다). `prepare`에도 plugin mode를 전달 — 안 그러면 migration 비교가 bare 값과 이뤄져 절대 plugin 값이 operator 원본으로 오인되고 uninstall 뒤 dangling absolute가 남는다. assembled 경로는 doctor와 **같은 suffix**로 검증한다.
    - **B. forward composition** — 공개 verb **`entwurf herdr-plugin-activate <backend...>`** 신설. 입력은 `{pi, claude-code}` 부분집합뿐(그 밖은 named refuse), **stable root는 여기서 파생**해 아래로 넘긴다. runtime-ready 저널 + 설치본 검증 → ledger/roots 인증 → add-only plan → **선택된 전 component preflight** → writer 실행 → ledger 트랜잭션. H∩P 판정은 여전히 b3.
    - **C. retryable transaction** — ledger에 **phase(`activating|active|deactivating`) + component state(`pending|active|removed`)** 를 두고 **각 mutation 전에 기록, 성공 직후 checkpoint**. deactivate는 이미 `removed`인 component를 **건너뛴다**(재실행하면 ownership state가 없어 영구 거절 — 첫 컷이 갇히던 자리). runtime만 지워지고 ledger가 남은 crash도 재호출로 마무리된다. duplicate/missing/extra component, 비정규 순서, phase↔state 모순을 전부 named reject. `ownedState` 산문은 제거했다.
    - **D. stable root / defaults / package proof** — `--plugin-runtime`이 **임의 absolute를 더 이상 받지 않는다**: 양쪽 writer가 XDG/HOME에서 파생한 **그 stable root와 일치할 때만** 수용(상대·비정규·다른 절대 전부 거절), 값 없는 플래그가 조용히 bare로 떨어지던 parser 구멍도 닫았다. deactivate의 Pi state 경로가 `XDG_DATA_HOME || ""`라 XDG 미설정 호스트에서 `/entwurf/...`를 보던 것을 **runtime owner와 같은 해석**으로 통일했다. package-consumer 증명을 'no ledger' 스모크에서 **진짜 self-delete**로 올렸다.
  - **final narrow correction `[Terra Blocker 2 / Defect 1, 2026-09-16]`**:
    - **phase 전이** — forward는 `deactivating` ledger를 절대 덮지 않는다(named refuse). `activating`은 retry를 위해 허용하되 **pending인 backend를 새 요청이 버리면 거절**. inverse는 `activating`을 거절한다 — pending component는 `active`가 아니라 plan에 step이 없어 **건너뛴 채 runtime을 지우면 반쪽 배선이 주소만 잃는다**.
    - **Claude root 완결** — ledger가 모든 component root를 안다고 주장하는데 `CLAUDE_CONFIG_DIR`만으로는 부족했다. user-scope MCP는 `$HOME/.claude.json`이고 state owner가 그것을 **HOME에서** 파생한다(`meta-bridge-state.py:144-147`). Terra 실측: 같은 XDG·같은 override에 **HOME만 옮기면 preflight가 green이고 옛 HOME에 MCP 엔트리가 남았다**. 이제 `claudeUserConfig {path, source:"HOME"}`를 따로 기록·strict certify하고 HOME drift를 pre-mutation 거절한다.
    - **aggregate preflight 완결** — Pi provider뿐 아니라 **`register-pi-package.py` user-scope preflight도** 수행한다. foreign package state는 ledger 첫 write 전에 거절되고 모든 바이트가 불변이다.
    - **Claude preflight argv** — env `ENTWURF_PLUGIN_RUNTIME`은 설치 스크립트의 채널이고 state owner는 **argv `--plugin-runtime`만** 읽는다. env만 주면 **default 모드를 preflight하고 plugin 모드를 설치**한다 — 아무도 하지 않을 일의 green이다. 이제 argv에 실어 보내고 게이트가 preflight receipt의 절대 mcp/statusline을 검사한다.
    - **runtime exact version** — 디스크 검증을 journal의 **정확한 name+version**에 묶었다. 이름만 맞는 다른 버전 트리는 pre-mutation 거절.
  - `[측정 receipt, final correction 후 2026-09-16]` `check-herdr-activation` **21 assertions exit 0** + lane `herdr-activation` **21/21 KILLED, 21/21 정확 attribution**; `check-herdr-runtime-bootstrap` **20/20** + lane **20/20**; **`check-pack-install` exit 0** — `runtime verifier … SHIPPED owner` · `installed herdr-plugin-deactivate removed its OWN runtime and retired the ledger with no checkout: … done: runtime -> ledger` · self-fence pass; `check-gate-manifests` **621 mutants / 53 lanes exit 0**; `check-herdr-plugin` 32 · `check-herdr-plugin-profile` 14 · `smoke-user-scope-citizen` PASS · `smoke-pi-provider-state` 52 · `smoke-setup-verdict` 135 · `check-meta-doctor-oracle` PASS; typecheck 3 fence · biome exit 0.
- **M3-b2 착지 완료 `[커밋 28d1324]`** — 위 절은 그 커밋의 기록으로 남긴다. 공개 보고 #116 `issuecomment-5691865148`.
  - `[열린 경계]` 벤더 `claude` CLI가 절대 실행파일을 MCP command로 받아들이는지는 **미측정 LIVE**. 게이트는 CLI의 *인터페이스*만 fixture로 세우고 벤더의 판정을 주장하지 않는다.
  - `[해소됨]` `claude_root_config_path()`가 `CLAUDE_CONFIG_DIR`를 따르지 않는다는 관측은 final correction에서 ledger의 `claudeUserConfig`로 계약이 됐다. 벤더 동작 자체는 그대로이고, 이제 **기록되고 drift가 거절된다**.
  - `[함정 기록]` `~/.claude.json`은 **이 라이브 Claude Code 세션이** 계속 갱신한다(격리 write는 UNTOUCHED로 확인). operator 증명에서 그 파일만은 "불변"이라고 말하면 안 된다.
- **CURRENT: M3-b3 candidate `[구현 후보, 미커밋 2026-09-16]`** — GLG 방향 `[저널 2026-09-16 14:24]`(npm 릴리즈를 candidate 반복의 선행조건에서 빼고 push된 커밋으로 설치 검증)을 Sol 판정으로 계약화한 판. 측정 원자료 `.agent-reports/116-m3b3-{git-source,shallow-source}-measure-*`, 판독은 Sol inbox 2026-09-16 14:37/14:45/14:49.
  - **A. acquisition source** — `runtime-lock.json`이 닫힌 discriminant `source: npm | herdr-checkout`를 운반한다(커밋된 선택자만, env·caller·fallback 0). npm 분기의 published sha512 비교는 바이트 무변경. checkout 분기는 managed checkout의 `git rev-parse --verify HEAD^{commit}` full SHA + repo 리터럴에 결속되고, product argv는 고정 `npm pack git+https://github.com/junghan0611/entwurf.git#<full-sha>` **하나**다(디렉터리 형식은 구조적으로 부재 — 그쪽만 `prepack`→pnpm→exit 127). 서브트 못 주면 `runtime-checkout-source-unavailable`, 대체 0.
  - **B. one `artifactIdentity` union** — journal·`previousRuntime`·torn recovery·activation ledger가 **같은 union·같은 certifier**를 쓴다(kind×stage exact key). checkout ready는 `{kind, repository, commit, packageName, packageVersion, observedDigest}`이고 이름/버전은 **completeness 증거일 뿐 정체가 아니다** — 같은 버전 다른 커밋은 절대 같은 runtime이 아니다. journal/ledger schemaVersion 2.
  - **C. activation rebind checkpoint** — source 변경은 pre-mutation named refusal(`activation-artifact-source-drifted`), 같은 source의 새 커밋은 `active` ledger + 전 component active + 요청이 기존 backend 전부 포함일 때만 rebind. 그 판정 전부가 zero-write이고, **ledger write 한 번**이 새 identity + `activating` + 선택 component `pending`을 동시에 올린다(앞의 crash=옛 ledger, 뒤의 crash=같은 verb로 resume).
  - **D. cache failure ownership** — 실패한 획득이 staging과 **자기 transaction이 채운 cache**를 회수하고 journal·previous·last-good은 보존해 retry가 green. journal 없는 pre-existing cache는 `runtime-cache-unowned-residue`로 거절(입양 금지).
  - **E. real `[[build]]` 배선** — 매니페스트에 `[[build]] command = ["node", "lib/build.mjs"]` 하나. runner가 real `herdr integration status` → M3-a profile → `A` → bootstrap → **설치본 패키지의** activation entry(존재+capability 확인, checkout fallback 금지) 순으로 조립한다. `A` 공집합은 exit 0 + 쓰기 0, selected atom의 outdated/needs-repair/malformed/duplicate는 bootstrap 전 named nonzero. post-build Herdr commit gap은 **이름 붙인 gap**이고 atomic이라 쓰지 않는다.
  - `[측정 receipt, amendment 뒤 재측정 2026-09-16 18:55]` `check-herdr-runtime-bootstrap` **30** · `check-herdr-activation` **24** · 신설 `check-herdr-plugin-build` **10**(real herdr 0.9.0 status 셀 포함) · `check-herdr-plugin` **32** · `check-herdr-plugin-profile` **14** 전부 exit 0. `check-gate-manifests` **643 mutants / 54 lanes** exit 0(599→621→640→**643**, 신설 lane `herdr-plugin-build` 9 · `herdr-runtime-bootstrap` 30). `pnpm lint` · `pnpm typecheck`(3 fence) exit 0.
  - `[뮤턴트 receipt]` 신규 claim **22/22 KILLED at own QK**(코디네이터 sol 측정, 스냅샷 focused mutation, baseline GREEN) + qualification 수선분 **9/9 KILLED at own QK**(구현자 측정, production 하네스 `createRepoSnapshot`+`qualifyMutants`, 4 group control-pre/post 전부 green, 로그 `/tmp/subset1.log`).
  - `[LIVE 실행됨 2026-09-16]` `LIVE=1 ./run.sh smoke-herdr-plugin-build-live` **exit 0, 5 assertions, 0 skipped**. 샌드박스 `/tmp/entwurf-hpbl-mytK4T`, candidate snapshot `6a868aa1ea56`(전임 실행 `/tmp/entwurf-hpbl-uISVi6` / `8ac02e7aaeff`와 같은 바이트에서 두 번 재현). 셀별로: mirror=checkout=runtime 동일 커밋 · **실제 벤더 `claude` CLI가 절대 실행파일을 MCP command로 수용**(아래 `[닫힘]` 줄의 근거) · unavailable retry 권위 보존 · post-build gap rebind · operator untouched. fixture 결함 넷(bare clone이 미커밋 candidate를 못 옮김 · 측정 순서 · 주석은 파싱된 매니페스트를 바꾸지 않음 · probe가 `process.exit` 뒤) 수선 후의 결과이고, 샌드박스 `GIT_CONFIG_GLOBAL`이 오퍼레이터의 `core.hooksPath`를 가리던 Blocker(코디네이터 sol 지적)도 함께 닫혀 두 commit이 정상 환경에서 돌고 훅 실행이 trace로 증명된다(`exactly 1 pre-commit child`, snapshot/gap 각 1 — trace 직접 카운트 확인).
  - `[교차검수]` Terra **0/0/0**(Blocker/Defect/Observation 0) 뒤, qualification 본체가 frozen candidate에서 red였다 — release-gate baseline red 1 + snapshot tree drift 1 + stale mutant 4 + WRONG-REASON 4 + SURVIVED 1. 그 **amendment 번들이 이 판의 마지막 수선**이고(위 receipt), 상세는 아래 「M3-b3 amendment」 절.
  - `[미실행]` qualification 본체 전량 · `check:full` · commit · push · issue. 전량 qualification은 최종 바이트 동결 뒤 재실행하며, 그 receipt는 이 문서가 아니라 **#116 checkpoint**에 기록한다. 그 전까지 이 판은 **floor pending**이다.
  - `[닫힘 2026-09-16]` 벤더 `claude`가 절대 실행파일을 MCP command로 받아들이는가 — 위 LIVE 셀2에서 **실제 CLI가 수용**했고, owner entry는 substring이 아니라 **정확히 1개로 세어** 확인했다. git 출처의 devDependency 레지스트리 접근·~44s·~523M 임시 캐시는 clean host 전제로 이름 붙인 그대로다.

### M3-b3 amendment — qualification 수선 `[구현 후보, 미커밋 2026-09-16]`

frozen candidate에서 `./run.sh check-gate-qualification`이 **615/643**이었다(코디네이터 sol 측정, `/home/junghan/.pi/background/1789547652234-bg03.log`). 계약을 넓히지 않고 여덟 파일만 고쳤다.

- **release-gate baseline red** — 신설 LIVE smoke가 `release_gate`에 배선되지도, 문서 제외로 등록되지도 않았다(`[QK:NO-SILENT-AGGREGATE-OMISSION]`). `scripts/check-release-gate-outcomes.ts`의 `DOCUMENTED_EXCLUSIONS`에 `smoke-herdr-plugin-build-live`를 등록하고 VERIFY.md 문장을 게이트가 읽는 평문으로 정리했다. 그 red 하나가 lane `release-gate` 19개를 전부 CONTROL-RED로 만들고 있었다.
- **snapshot tree drift**(`IMPURE: treeClean=false porcelainClean=true`) — 유일 드리프트 경로는 `scripts/__pycache__/pi_settings_io.cpython-313.pyc`. 게이트 child env에 `PYTHONDONTWRITEBYTECODE`를 넣는 수선은 **측정에서 불충분**이었다(`/tmp/entwurf-qualify-Q1NrVb`에서 그대로 재현) — 그 helper는 `run.sh`와 `herdr-plugin-activate.mjs` 경로로도 import된다. 그래서 이 리포의 기존 선례(`codex-mcp-config.py:33`)대로 **import하는 쪽**에 `sys.dont_write_bytecode = True`를 넣었다(`register-pi-provider.py`·`register-pi-package.py`). 재측정 `treeClean=true`, DRIFT 0줄(`/tmp/entwurf-qualify-58pkEd`).
- **stale 4** — 후보가 production 라인을 바꾼 뒤 find가 0회 매치. 새 라인으로 갱신하고 643개 전부 매치 1회임을 확인했다(다중 매치 0).
- **WRONG-REASON 4** — 전부 게이트 oracle이 자기 assertion **앞에서** 죽는 문제였다(빈 stdout `JSON.parse`, leaf refusal, install path-kind refusal, `artifactStage(null)`). 각 claim이 이미 주장하던 것을 assertion 안으로 끌어왔다 — refusal은 catch해서 판정하고, 파싱·stage는 null-safe로.
- **SURVIVED 1** — `[[build]]`는 M3-b3에서 정식이 되어 금지 목록을 떠났으므로, `HPL-MANIFEST-NO-FORBIDDEN-SECTIONS`의 mutation을 **자원해서 도는 것**(`[[startup]]`) 삽입으로 교체했다.
- **바뀐 파일 10**(이 문서 제외) — `scripts/check-release-gate-outcomes.ts`·`VERIFY.md`(제외 등록/문장) · `scripts/register-pi-provider.py`·`scripts/register-pi-package.py`(bytecode) · `scripts/mutants/herdr-activation.json`·`scripts/mutants/herdr-runtime-bootstrap.json`·`scripts/mutants/herdr-plugin.json`(mutant) · `scripts/check-herdr-activation.ts`·`scripts/check-herdr-plugin-profile.ts`·`scripts/check-herdr-runtime-bootstrap.ts`(oracle). 제품 코드·docs 계약·lane inventory 변경 0.
- `[Observation, 이 번들 밖]` `scripts/check-herdr-runtime-bootstrap.ts:271`에 경로+크기만 비교하는 로컬 `treeDigest`가 남아 있다. 공유 `scripts/lib/tree-digest.ts`는 바로 그 약한 oracle 때문에 생겼는데 consumer는 `check-herdr-plugin-build.ts`·`smoke-herdr-plugin-build-live.ts` 둘뿐이다. 같은 길이 in-place 수정은 이 게이트의 "byte-identical" 주장을 통과한다. 지금 red 아님.

## M2-b — `plugins/herdr/` read-only status pane `[착지, 07c7cbc]`

**무엇을 만들었나.** herdr 플러그인 하나, overlay pane 하나. 두 목록을 **한 번씩** 읽어 나란히 놓고, 키 입력 하나를 기다리고, 끝난다.

- **경로·신원**: `plugins/herdr/`. id `junghan0611.entwurf`(은퇴한 org 아님), version **독립** `0.1.0`, `min_herdr_version` = 잰 바닥 `0.9.0`, `platforms = ["linux"]`.
- **manifest는 `[[panes]]` 하나뿐.** `[[build]]`·`[[startup]]`·`[[events]]`·`[[actions]]`·`[[link_handlers]]` 0개이고, **없는 이유가 저마다 다르다**: build는 오퍼레이터의 실 HOME에서 돌고(herdr는 `HERDR_*`만 스크럽), startup/events는 이 레인이 거부하는 watcher가 자랄 자리이며, action의 stdout은 64KiB 로그로만 가서 읽으라고 만든 물건이 읽히지 않는다.
- **의존성 0.** `lib/status.mjs` 하나, Node builtin만. `node_modules`·build·`npm install`·`jq` 없음. manifest argv가 부르는 외부 프로그램은 `node` 하나뿐이고 README가 그 사실을 말한다.
- **조인은 불투명 pane id 문자열 동등 하나.** `peer-facts`가 `{kind:"herdr-pane", paneId}`를 주고 그 `paneId`를 herdr `pane_id`와 비교한다. 플러그인은 `nativeSessionId`도, 파일명→uuid 변환도, `agent_session` 삼중 재검증도 하지 않는다 — 그 pi 축 변환은 잰 벤더 바닥이고 사본은 아무 게이트도 문서도 덮지 않는다. 한 pane에 에이전트가 둘이면 고르지 않고 `ambiguous`.
- **활동은 herdr의 말이고 herdr의 칸에 있다.** `herdr-reported activity`는 `placement` 다음, 별도 칸·별도 이름. Entwurf liveness와 섞지 않고 주소·배달 판단에 쓰지 않는다(`docs/herdr-launch-rail.md` §9).
- **표는 "여기서 누가 보이는가"의 답이지 스토어 덤프가 아니다** `[교차검수 Blocker, 2026-09-15]`. 읽기는 전량 그대로(측정을 배급하면 `unobserved`를 지어낸다) 두고 **렌더만** 좁혔다: 배치 소유자가 보고한 행(`herdr-pane`·`ambiguous`)만 표에 넣고 나머지는 **세어서** 알린다. `unobserved`("아무도 배치를 관측하지 못했다")와 `none`("전량 읽었는데 이 시민이 없다")은 뜻이 달라 따로 센다. 표가 0행이면 `(none)`. 근거는 측정이다 — 오퍼레이터 스토어 1,162 레코드 전부 `unobserved`, `peer-facts` 출력 **17,437줄**. 1,002 시민 픽스처에서 표 1행 + 요약 2줄, 전체 15줄.
- **진단은 subject를 잃지 않는다** `[교차검수 Defect, 2026-09-15]`. `kind`+prose만 찍으면 "어딘가에 위험이 있다"가 되어 오퍼레이터가 할 일이 없다. provider가 붙인 필드를 **전부**, 키 정렬 순서로 낸다(`record-less-socket [gardenId=… liveness=dead]`, `meta-record-read-error [filename=…]`). 이름 denylist를 쓰지 않는다 — payload에 소켓 경로 같은 transport 좌표가 애초에 없고(#50 C4), denylist는 다음에 추가되는 subject 필드를 조용히 떨어뜨린다.
- **읽기 실패는 절대 빈 표가 아니다.** `peer-facts-failed`/`peer-facts-unparsable`/`herdr-agent-list-failed`/`herdr-agent-list-unparsable`/`herdr-bin-path-missing`/`entwurf-bin-not-absolute`/`entwurf-bin-not-executable`. Entwurf 부재만 SKIP — 정확히 `entwurf-not-found`, exit 0.
- **아무것도 쓰지 않는다.** `HERDR_PLUGIN_STATE_DIR`·`CONFIG_DIR` 포함 0바이트. setup·install·credential·global config 0. delivery 0.
- **overlay는 프로세스 종료 즉시 닫히므로**(herdr `src/app/api.rs:241-258,349-358 @ c77af189`) 마지막에 TTY 입력 1회를 기다린다. non-TTY는 stdin EOF로 끝나고 busy loop은 없다.
- **`files[]` 무변경** — `plugins/`는 npm 아티팩트 밖이다. herdr의 `plugin link`/`plugin install`이 이 lifecycle의 유일한 주인이다.

**`[측정, 격리 private herdr 서버]` 실바이너리 셀이 결함을 하나 잡았다.** 샌드박스 `HOME`/`XDG_*`에서 herdr 0.9.0 private 서버를 띄워 `plugin link` → `plugin pane open` → `pane read` → `pane close` → `server stop`을 돌렸다. 첫 실행이 돌려준 것은 표가 아니라 **`herdr-agent-list-failed / exit 2: usage: herdr agent list`** 였다 — `agent list`에는 `--json`이 없다(`plugin list`에는 있다). 대칭을 가정한 내 argv가 틀렸고, **stub은 아무 argv나 받아주므로 이것을 잡을 수 없었다.** argv를 `["agent","list"]`로 고친 뒤 같은 셀에서 표가 정상 렌더됐고(빈 샌드박스 스토어 → 빈 표 + `Diagnostics: (none)` + `[press Enter to close]`), 실패 경로가 설계대로 **이름 붙은 거절 + pane 유지**로 동작하는 것도 같은 셀이 보여줬다. 이 사실은 게이트 헤더에 기록했다 — 핀은 그 뒤에 있는 측정만큼만 참이다.

**`[측정]` 오퍼레이터 무변경.** link는 샌드박스 레지스트리에만 들어갔고, 실 HOME의 `plugin list`는 여전히 `[]`, `~/.config/herdr/plugins.json`은 여전히 `[]`(md5 `d751713988987e9331980363e24189ce`), `pane list` 스냅샷 전후 IDENTICAL. 샌드박스 제거 후 살아남은 herdr 서버는 pid 3869363 하나이고 `/proc/<pid>/environ`이 `HOME=/home/junghan` — 오퍼레이터 것이다. 플러그인 소유 디렉터리(`plugins/config/<id>`, `state/plugins/<id>`)는 herdr가 만들었고 **파일은 0개**였다.

- 바뀐/추가된 파일 9: 신규 `plugins/herdr/herdr-plugin.toml`·`plugins/herdr/lib/status.mjs`·`plugins/herdr/README.md`·`scripts/check-herdr-plugin.ts`·`scripts/mutants/herdr-plugin.json`, 수정 `run.sh`(usage 1줄 + case + helper)·`package.json`(`check:hermetic`)·`scripts/check-gate-qualification.ts`(lane inventory)·이 문서.
- **Verify(M2-b, focused only — 교차검수 amendment 뒤 재실행).** `check-herdr-plugin` **32** ✅ / `check-gate-manifests` **566 mutants·50 lanes** ✅(555·49에서 +11·+1) / `check-peer-facts` 20 ✅ / `check-install-surface` ✅ / `check-shell-quote` 16 ✅ / `check-herdr-placement` 22 ✅ / `npx tsc --noEmit` 두 fence exit 0 ✅ / `biome check` clean ✅ / 뮤턴트 lane `herdr-plugin` **11/11 KILLED, 전부 자기 QK 귀속**(손으로 돌린 focused kill 확인, 끝에 두 subject md5 동일).
- **완료 영수증.** exact `07c7cbc` qualification 566/566 + `check:full` 514s exit 0, GLG가 real Herdr에서 link/open/unlink까지 직접 통과했다. 아직 안 한 것은 push와 **GitHub clean-host install activation(M3)**이다.
- `[열린 위험]` **stub이 증명하지 못하는 것이 남아 있다** — 위 argv 결함이 그 증거다. 게이트는 이제 argv를 핀으로 박지만, 그 핀을 고치는 읽기는 실바이너리 쪽에 있고 이 게이트 안에는 없다. 같은 계열의 다음 후보: `agent list` JSON의 필드 이름(`pane_id`/`agent_status`)이 herdr 버전을 넘어 안정적인지는 0.9.0 한 판본에서만 쟀다.
- `[열린 위험]` **`peer-facts` 4.1초가 그대로 pane 열기 지연이다.** one-open/one-read가 계약이자 완화책이고 `[QK:HPL-ONE-OPEN-ONE-READ]`가 그것을 지킨다. 예산 도입은 M2-a에서 적은 `unobserved` 모호성 때문에 여전히 답이 아니다.

## M2-a — core read-only `peer-facts` verb `[착지, f9cea1d]`

**무엇을 위한 걸음인가.** M2-b 렌더러가 herdr pane ↔ garden id 조인을 shell로 다시 구현하면 `herdr-placement.ts:133` `piNativeSessionIdFromPath` — pi 0.85.1에 대고 잰 **벤더 바닥** — 을 게이트도 문서도 덮지 않는 파일로 포크하게 된다. `peer-facts`가 서 있으면 렌더러의 조인은 **불투명 pane id 문자열 동등 하나**로 줄고, 그건 shell이 정확히 할 수 있는 일이다. #65 `meta-facts`가 스토어 축에서 한 일("consumers stop carrying a decaying copy", `run.sh` 주석)을 관측 축에서 한 번 더 하는 것이지 새 개념이 아니다.

- **한 provider, 한 renderer, 두 번째 조인 없음.** payload는 `renderEntwurfPeers(result).payload`다 — MCP `entwurf_peers`와 **같은 provider를 같은 renderer로** 통과시키므로 payload **shape**이 그 표면의 shape이고 각 행은 `PeerFact`이며, 그 키셋은 `check-entwurf-peers-surface`가 이미 `{peers, diagnostics}`로 못 박았다. 재계산·재정렬·재작명 0건, 조인 재구현 0건.
  - **같은 바이트는 아니고, 그건 드리프트가 아니라 의도다.** `entwurf_peers`는 사람 목록이라 `observationLimit=32`를 주고 **렌더된 text만** wire로 돌려준다(`mcp/entwurf-bridge/src/index.ts:592-601`). 이 verb는 기계 projection이라 관측이 무제한이다. 그래서 오래된 행은 여기서 `exists`/`active`로 읽히고 사람 표면에서는 `unobserved`로 읽힐 수 있다 — 같은 사실을 더 많은 행에 대해 잰 것이지 다른 의견이 아니다.
- **소켓 좌표는 이 verb를 떠나지 않는다.** `ENTWURF_DIR`은 무엇을 **probe할지**만 고르고 출력되지 않는다. #50 C4가 legacy `sessions` projection을 없앨 때 "**그것이 노출하던 `controlDir`과 함께**" 없앴고(`entwurf-peers-render.ts` 헤더), 레코드가 유일한 주소축이며 소켓 경로는 dispatch 내부 transport다. 새 verb가 그걸 편의 필드로 되살리면 그 은퇴를 되돌리는 것이고, 렌더러는 그 값이 필요하지도 않다.
- **placement는 구조를 유지한다.** 사람 표면은 `herdr <pane>`을 찍지만 기계 소비자는 태그드 유니온 자체가 필요하다: `{kind:"herdr-pane",paneId}` / `unobserved` / `none` / `ambiguous`. `renderPlacement`를 적용하지 않는다.
- **승격 장벽은 키셋으로 세운다.** herdr `agent_status`·`interactive_ready`·화면 텍스트는 payload에 **없다**(`docs/herdr-launch-rail.md` §9). 렌더러가 보여주고 싶으면 herdr를 직접 읽고 "herdr 보고"라고 라벨을 단다. 게이트가 peer 행 키셋을 정확히 11개로 고정한다 — denylist가 아니라 화이트리스트여야 새 칸이 조용히 들어오지 못한다.
- **관측 예산 없음.** `observationLimit`을 주면 아무도 건너뛰기로 정하지 않은 행이 `unobserved`가 되고, 기계 payload에서 그것은 "herdr가 없어서 못 봤다"와 구분되지 않는다. 사람 표면은 자기 행을 배급해도 되지만 projection은 자기 사실을 배급하면 안 된다.
- **한 번의 placement 읽기.** `readPlacementIndex`를 주지 않아 provider 자신의 listing당 1회 읽기가 그대로 돈다(anti-watcher). 이 verb에는 루프도 재시도도 없다.
- `ENTWURF_DIR`을 브리지와 **같은 방식으로** 존중한다(`mcp/entwurf-bridge/src/index.ts:131`) — 두 표면이 서로 다른 소켓 세계에서 답하면 안 된다.
- 바뀐 파일 9: 신규 `scripts/peer-facts.ts`·`scripts/check-peer-facts.ts`·`scripts/mutants/peer-facts.json`, 수정 `run.sh`(usage 2줄 + case + helper + pack 목록 2곳)·`mcp/entwurf-bridge/tsconfig.build.json`·`package.json`(`check:hermetic`)·`scripts/check-gate-qualification.ts`(lane inventory)·`docs/mux-launch-rail.md`(§7-a에 사람 어휘 ↔ 태그드 유니온 구분 한 단락)·이 문서. **`files[]` 무변경** — `scripts/`가 이미 화이트리스트다.
- **Verify(M2-a, focused only — 교차검수 amendment 뒤 재실행).** `check-peer-facts` **20** ✅ / `check-install-surface` ✅ / `check-entwurf-fact-provider` 41 ✅ / `check-herdr-placement` 22 ✅ / `check-entwurf-peers-surface` 60 ✅ / `check-meta-facts` 16 ✅ / `check-mux-launch` 25 · `check-mux-resume-call` 28 · `check-mux-parent-artifact` 12 ✅(§7-a 문서를 읽는 게이트) / `check-shell-quote` 16 ✅ / `check-gate-manifests` **555 mutants·49 lanes** ✅(547·48에서 +8·+1) / `npx tsc --noEmit` 두 fence 전부 exit 0 ✅ / `biome check` clean ✅ / 뮤턴트 lane `peer-facts` **8/8 KILLED, 전부 자기 QK 귀속**(손으로 돌린 focused kill 확인: 백업 → in-place 변이 → focused gate → 복원, 끝에 md5 동일). 컴파일 트윈 `dist/scripts/peer-facts.js`를 실제로 빌드해 **설치 경로로 직접 구동**했다 — `--help` exit 2, 빈 스토어 exit 0.
- **교차검수 amendment 1회 `[코디네이터 sol, 2026-09-15 — Defect 3]`.** 셋 다 소스에 대고 재현했고 셋 다 실재하는 결함이었다. (1) **`controlDir` 공개 노출** — #50 C4가 legacy `sessions` projection을 없앨 때 "그것이 노출하던 `controlDir`과 함께" 없앴는데(`entwurf-peers-render.ts` 헤더) 새 verb가 그 필드를 되살려 놓았다. 출력·스키마 문서·top-level 키셋에서 제거하고, probe 동작과 그 QK는 그대로 뒀다. 그 자리에 새 뮤턴트 `PF-NO-SOCKET-COORDINATE`를 세웠다(lane 7→8) — 이 결함을 잡아낸 검수가 게이트로 굳었다. (2) **"MCP가 돌려주는 바로 그 객체"라는 과장** — MCP는 `observationLimit=32`를 주고 **text만** 돌려준다(`index.ts:592-601`). 정확한 계약은 "같은 provider·같은 renderer·같은 payload shape·조인 재구현 0, 그리고 기계 projection은 의도적으로 unbounded"이고, 헤더·`run.sh`·이 문서에서 모두 고쳤다. unbounded 결정 자체는 뒤집지 않았다. (3) **M1-b floor 상태 stale** — 위 NOW 첫 줄에서 완료 영수증으로 수선했다.
- **아직 안 한 것(의도).** `f9cea1d`에 대한 `pnpm run check:full` 미실행 · `check-gate-qualification` 본체 미실행 · LIVE 없음 · 푸시 없음. (M1-b의 floor는 `073938c`에서 이미 초록이고, 그 영수증은 이 커밋의 것이 아니다.)
- `[열린 위험]` 실 스토어(1,150여 레코드)에서 `./run.sh peer-facts`가 **4.1초** 걸렸다 — 관측이 무제한이라 레코드 수에 선형이다. 요청 시 여는 pane에는 감당되지만, M2-b가 이걸 자동 갱신 루프에 넣으면 그 순간 잘못된 모양이 된다. 예산을 도입하는 것은 위 `unobserved` 이유로 답이 아니다.

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

**Verify(M1-b) — 등급을 정직하게 분리한다.** `[GLG 스케줄 결정 2026-09-15]` amendment 뒤 구현자는 focused gates까지만 돌렸고, qualification 본체와 `check:full`은 checkpoint commit + #116 댓글 뒤에 코디네이터가 별도 후속했다. C4 LIVE는 짧은 acceptance라 amendment 검수 뒤 먼저 실행했다.

- **돌린 것(focused, 이 바이트에서):** `check-herdr-fresh-call` **35** ✅ / `check-herdr-sandbox` **11** ✅(실바이너리 private 서버) / `check-fresh-call-dispatch` 12 ✅ / `check-herdr-placement` 22 ✅ / `check-gate-manifests` **547** mutants·48 lanes ✅ / `check-release-gate-outcomes` ✅ / `check-entwurf-control-rpc` 32 ✅ / `npx tsc --noEmit -p tsconfig.json` exit 0 ✅ / `npx biome check .` 에러 0(경고 7·info 6 = HEAD 동일, stash 대조) ✅.
- **뮤턴트 lane `herdr-fresh-call` 28/28 KILLED** — 단 이것은 qualification 본체가 아니라 **손으로 돌린 focused kill 확인**이다(`/tmp/mutant-lane-check.sh`: 백업 → in-place 변이 → focused gate → 복원, 끝에 md5 동일). 등급이 다르다.
- **C4 LIVE PASS `[측정 oracle 2026-09-15, coordinator]`:** `LIVE=1 ./run.sh smoke-herdr-fresh-call-live` **exit 0, 29 assertions ok, 1m34s**. pi→pi와 claude→claude 모두 새 tab + initial pane 좌표, exact callback, caller 지속, named reject를 실제 레일로 통과했다. private 서버·소켓은 회수됐고 operator panes는 byte-identical. 영수증 `/tmp/herdr-fresh-call-live-xnHeIp/receipts.md`.
- **checkpoint 뒤 floor 완료.** exact HEAD `073938c`에서 qualification **547/547 exit 0**, `build-bridge` 뒤 `check:full` **509s exit 0**. #116 `issuecomment-5677631940`에 실패→수선→재실행 영수증을 남겼다.

**아직 안 한 것.** push 없음 · idle/running을 Entwurf fact로 투영하는 일은 미착수이자 금지 경계다. M2는 아래 `peer-facts` 구현 후보로 넘어갔다.

**교차검수 amendment 1회 `[코디네이터 sol, 2026-09-15 — Blocker 2 + Defect 1]`.** 셋 다 소스에 대고 재현했고 셋 다 실재하는 결함이었다.

- **Blocker 1 — caller pane 응답이 요청한 pane에 결속되지 않았다.** `pane get <HERDR_PANE_ID>` 응답의 workspace만 읽고 `paneId`가 우리가 물은 그 pane인지 검사하지 않았다. 읽을 수 있는데 **다른 pane**을 답하면 그 workspace를 믿고 엉뚱한 곳에 tab을 만들며 초록 영수증을 낸다 — 이 변경이 막으려던 silent relocation이 argv가 아니라 읽기를 통해 들어온다. 수선: `herdr-caller-pane-drift` pre-mutation 거절 신설(`unparsable`로 뭉개지 않음) + 자기 QK `HFC-CALLER-PANE-BOUND` + 자기 뮤턴트 + docs §5.
- **Blocker 2 — tab/create 두 절반의 결속이 부분적이었다.** `rootPane.tabId`는 **있을 때만** 대조했고 `rootPane.workspaceId`는 아예 대조하지 않았는데, 소스와 문서는 필수 일치라고 선언하고 있었다. 모순된 응답에서 initial pane과 receipt의 tab/workspace를 조합해 초록을 만든다. 수선: 둘 다 **필수 + 정확 일치**(없으면 불일치로 취급) + 자기 QK `HFC-TAB-HALVES-AGREE` + 자기 뮤턴트 + docs §5.
- **Defect 1 — create 실패 렌더가 자기 힌트와 모순됐다.** 힌트는 "nothing was created", 헤더는 "failed after the tab was created", recovery는 `orphan-unreclaimed:pane-get-failed`(시도한 적도 없는 `pane get`)였다. 게다가 `createHerdrRunner`는 **자기 timeout/kill도 herdr 실패와 같은 nonzero status**로 돌려주므로 "아무것도 안 생겼다"는 단정 자체가 과장이었다. 수선: stderr에 **herdr 자신의 error 봉투가 있으면** `none`(herdr가 만들기 전에 거절), **없으면** `unknown`(우리 bound가 끊었다 — tab이 있을 수 있다), 못 읽은 status-0 응답도 `unknown`. `HerdrRecovery`에 `none`/`unknown` 두 값을 더해 빈 pane id와 거짓 reason을 없앴고(기존 recovery 타입 억지 재사용 안 함), 헤더도 recovery가 아는 것 이상을 말하지 않는다. 자기 QK `HFC-CREATE-OUTCOME-HONEST` + 자기 뮤턴트 + docs §7 + dispatch gate `FCD-RECOVERY-VISIBLE` 확장.

**열린 위험 / 다음 검수 지점.**
1. `[닫힘 — C4 LIVE PASS]` 배치 교체의 실제 수용은 위 29 assertions로 통과했다.
2. **launch당 herdr CLI 왕복이 2 → 3**(`pane get` 추가). 거절 목록 맨 뒤라 "거절은 아무것도 남기지 않는다"는 성립한다.
3. `[닫힘 — checkpoint 후 floor 완료]` 레인 인벤토리 24→28을 포함해 qualification **547/547**, `check:full` **exit 0**. 위 receipt와 #116 댓글을 따른다.
4. `[닫힘 — Defect 1로 수선됨]` 이전 보고의 Observation 2(`HerdrOrphanReason`이 "아무것도 안 생김"을 거짓 reason으로 찍던 문제)는 이번 amendment에서 `none`/`unknown` 도입으로 닫혔다. 남은 `HerdrOrphanReason` 여섯 값은 이제 전부 **실제로 시도한 회수**만 설명한다.

`[닫힘]` 작업 중 operator herdr의 pi·claude 시민 둘이 사라진 것은 **`[GLG direct 2026-09-15]` GLG 본인이 끈 것**이다. 이 레인이 만든 변화가 아니고, 측정은 전부 샌드박스 private 서버였으며 `HS-OPERATOR-UNTOUCHED`는 두 실행 모두 통과했고 측정 잔여 프로세스는 0이었다.
