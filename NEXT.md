# NEXT — v0.12.7: agy garden citizen 릴리즈

> NEXT는 부트 섹터다. 닫힌 역사는 CHANGELOG/git에, 장기 방향은 ROADMAP/이슈에 둔다.

## NOW — #46을 0.12.7로 출하

- **Stem:** agy/Antigravity를 완전한 garden citizen으로 출하한다. 당분간 릴리즈 축은 **0.12.x**이며, **0.13.0은 cortex 지원(#48)** 에 예약한다.
- **Current:** #46 본체 구현·설치면·회귀 게이트는 완료됐다. thinkpad에서 agy 자동 birth → gid/statusline → MCP `entwurf_v2` → `meta-session/antigravity`·`replyable:true` sender → 같은 gid로 native-push 답장 도착까지 라이브 왕복을 확인했다.
- **[2026-07-14] strip-types fence를 한 곳으로 모았다 (설치면 수리 완료).** agy imprint 블로커를 고친 뒤 **같은 계열이 3개 더 살아 있었다**: `doctor-pi-provider` / `new-session-id` / `meta-bridge-prune`이 installed에서 raw `.ts`를 실행해 전부 죽어 있었다(실제 tarball을 격리 HOME에 설치해 재현). 이 클래스의 **네 번째 재발**이라 손으로 고치지 않고 구조로 닫았다:
  - `run.sh`의 `.ts` 진입점 75곳을 `run_ts` 헬퍼 하나로 모았다. installed면 dist JS, dev clone이면 strip-types 소스. compiled twin이 없는 dev 전용 게이트는 raw `.ts` 폴백도 silent exit 0도 아닌 **명시적 거부**다.
  - `check-pack-install`이 이제 설치본에서 그 세 명령을 실제로 실행하고 **의미까지** 단언한다(id는 `SESSION_ID_RE` 형태, doctor는 verdict 본문 도달, prune은 0-record store 주행). bin만 두들기고 subcommand는 한 번도 안 두들긴 것이 3개를 놓친 이유였다.
  - 새 정적 게이트 `check-install-surface`(S1–S5)가 나머지 절반을 막는다. **초판은 우회 가능했고 리뷰가 3개를 뚫었다** — bin이 raw `.ts`를 직접 가리키는 경우, operator 명령이 helper 함수 뒤에 숨은 경우(이게 이 repo의 지배적 스타일이라 가장 위험했다), 스모크가 live 경로를 변수로 옮긴 경우. 셋 다 이제 잡는다. 최종 mutation: 우회 4종 + 기존 3종 잡음, 합법 2종 통과, 오탐 0.
  - **CI에 `check-pack-install` job을 추가했다.** 지금까지 설치면 축은 CI에 **한 번도 없었고**, 그래서 이 클래스가 네 번 반복됐다. `pnpm check`는 구조상 dev clone 바닥이다.
  - 스모크가 실제 설치면을 깨는 벡터는 **현재 없음**을 확인했다(설치 스모크 5개는 전부 샌드박스 HOME으로 갈아탐, RGG의 `rm -rf`는 `mktemp -d` 대상). 단 **S5는 정적 tripwire이지 샌드박스 증명이 아니다**: shell 소스를 읽으므로 literal 경로 + 별칭 1-hop까지만 본다. 여러 변수를 거치거나 heredoc 안에서 조립된 경로는 못 본다. 진짜 보장은 offline floor 전체를 swapped HOME에서 돌리는 것 — 아래 후속 항목.
  - **agy bridge doctor의 false red를 고쳤다.** `permissions.allow`에 운영자의 넓은 `mcp(*)`가 있으면 entwurf_v2는 이미 프롬프트 없이 호출된다. 그런데 doctor는 literal exact rule만 인정해 "registered and unusable"이라 **거짓 FAIL**을 냈다. 근거는 외부 문서가 아니라 repo 자신의 코드였다: `SHADOWING_RULES`가 이미 `mcp(*)`를 우리 tool과 매칭되는 것으로 취급하면서(deny/ask 방향), allow 방향에서만 그 커버리지를 무시했다. 이제 양방향으로 읽는다 — exact = `configured`, 넓은 운영자 규칙 = `covered-by-allow`(**NOTE, exit 0, 소유자를 명시**), 없음 = `DRIFT`. installer는 여전히 최소권한 한 줄만 쓴다. deny/ask precedence는 그대로 FAIL(같은 규칙이 양쪽에 있어도).
  - 죽은 스크립트 감사: `scripts/` 117개 중 **미참조 0건**. 고아처럼 보인 6개는 전부 의도된 것(LIVE 3종은 release-gate 밖이라고 AGENTS/VERIFY에 명시, `check-keyset-overlap`은 `smoke-meta-keyset-guard`가 감싸 `pnpm check`에서 실행, `check-pack-install`은 이제 CI). `smoke-meta-async-drift`는 죽은 게 아니라 **지금 RED다** — 아래 Next 3.
  - **[2026-07-14] hard-verify가 live XDG state를 오염시킨 사실을 확인했다.** scratch sweep이 HOME만 `/tmp`로 바꾸고 이미 export된 `XDG_DATA_HOME=~/.local/share`를 물려받아, agy bridge/permission/statusline/hooks + dev-bin 3개의 state 7개가 `/tmp/entwurf-hardverify-…/home-sweep`를 관리 대상으로 기록했다. 실제 bins/config/hooks는 살아 있고 agy 1.1.0 양방향 왕복도 성공했지만 provenance는 무효다. 세 doctor가 이제 foreign target을 FAIL하며, 후속 검수에서 corrupt/missing target도 FAIL, permission state는 bridge state와 독립 검증, runtime-present와 ownership-broken을 동시에 정직하게 보고하도록 보강했다(136/68/43). live 복구는 아래 Next 1이며 승인 전 자동 정리하지 않는다.
- **[2026-07-14] Fable 독립 검수 — 9커밋 재검수에서 구멍 4개를 찾아 닫았고, blocker ③(backend drift)을 닫았다.**
  - **S5b**: 사고의 실제 축(상속된 `XDG_DATA_HOME`)이 S5 tripwire에 없었다. HOME을 sandbox로 swap하면서 XDG_DATA_HOME을 같이 swap하지 않는 offline smoke를 정적으로 잡는다. mutation-check(export 제거 → FAIL) 통과.
  - **상대경로 state = CORRUPT**: doctor가 state의 managed path를 `abspath`로 정규화할 때 상대경로면 doctor의 CWD 기준으로 풀려 우연히 green이 될 수 있었다. install은 절대경로만 기록하므로 비절대 경로는 CORRUPT로 격상(binding 4지점 + 회귀 3개).
  - **wildcard가 가리던 owned drift**: 우리가 설치한 exact rule이 제거돼도 운영자 `mcp(*)`가 커버하면 bridge doctor가 green NOTE를 냈다 — agent-config `ensure_link` relink가 정확히 이 shape를 만들며 statusline doctor만 잡고 있었다. ownership beats coverage: 두 축을 다 말하고 verdict는 red (`ruleExistedBefore=true`인 운영자 소유 rule 소실은 여전히 green NOTE).
  - CHANGELOG의 diff-marker 오타(`+-`) 수정. 스모크 136/68/43 → **140/69/44**, AGENTS 규칙 11·12에 반영.
  - **blocker ③ 닫음**: agy pin `1.0→1.1` (2026-07-14 live 재검증 — 무프롬프트 `entwurf_self`, 양방향 native-push, 13/13 LIVE), codex pin `0.136→0.144` (**명시적 비재검증 판정** — DELIVERY §Codex에 기록, native-citizen lane 아님). `smoke-meta-async-drift` green (claude 2.1.208 / codex 0.144.1 / agy 1.1.2).
- **[2026-07-14 PM] check-pack-install 누출 + Claude 실제 단선을 GLG가 잡았다.** 첫 검수는 agy 배선만 보고 Claude의 `🪛 ? cc`를 agy 첫-turn 전 정상 `?`로 오인했다. 독립 실측은 반대였다: Claude 2.1.208 새 native session 4개에 대응하는 meta-record가 0개, hook log/최신 Claude record는 08:46에서 멈춤, plugin은 `enabled:true`지만 `Marketplace meta-bridge-local failed to load: cache-miss`, marketplace target `~/.local/share/entwurf/meta-bridge/.assembled`는 실제로 없었고 doctor도 FAIL했다. 즉 **Claude XDG live artifact가 사라진 실제 단선**이며 0.12.7 blocker였다. **[복구 완료 12:11]** `install-meta-bridge`로 XDG artifact를 재조립한 뒤 doctor PASS(source=assembled=installed v2), 새 native Claude probe가 `20260714T121134-5effc4`를 자동 birth해 record 116→117을 확인했다. 기존에 열려 있던 Claude UI는 재시작해야 새 hook을 로드한다. 별개로 게이트의 `run.sh install` 드라이브가 real pi-provider foreign state를 만들고 imprint 드라이브가 real 로그에 fake birth를 남긴 원인은 HOME만 스왑하고 XDG root를 상속한 것. 모든 드라이브에 XDG_DATA/STATE/CACHE 스왑을 추가했다. 첫 self-fence도 성공 말단에서만 DATA를 봐 불충분했다: 최종 outer fence는 early failure를 포함한 모든 return 뒤에 실행되고, real DATA tree byte identity + real STATE log의 gate 전용 fake marker count 불변을 함께 단언한다. Doctor도 이제 `enabled`와 `loadable`을 분리해 cache-miss를 정확히 보고한다.
- **Next:**
  1. ~~**오염된 live install-state를 pre-entwurf 상태에서 복구한다.**~~ **[완료 2026-07-14 12:21]** 기존 backup checksum을 재검증하고, 실행 직전 별도 백업 `~/.local/share/entwurf-recovery/live-repair-20260714T122114/`을 남겼다. dev-bin 3개를 먼저 live checkout으로 re-stamp한 뒤, statusLine을 agent-config 원본으로 복원하고 MCP/hook을 pre-entwurf shape로 제거했으며, foreign state 4개 + 8번째 pi-provider state + real imprint log의 fake pack lines 20개를 정리했다. 그 뒤 `install-agy-statusline` → `install-agy-bridge` → `install-agy-hooks` clean install 완료. state target 7개가 전부 live path, exact `mcp(entwurf-bridge/entwurf_v2)` package-owned, statusline preimage는 agent-config 원본, doctor 3종 static green. 복구 직후 doctor 3종 static green을 확인했고, 12:28 새 agy 1.1.2 conversation이 `20260714T122857-4860ca`를 자동 birth했다. 무프롬프트 `entwurf_self`가 `meta-session/antigravity · replyable:true`를 반환했고, 같은 gid로 native-push한 `AGY-ROUNDTRIP-20260714-OK`가 도착했다. 이어 실제 conversation id로 `LIVE=1 smoke-agy-native-push-live` 13/13 통과.
  2. ~~**#46 마지막 ownership handoff를 agent-config에서 닫는다.**~~ **[완료 2026-07-14 12:28, agent-config `0ed1194`]** pi fragments가 entwurf package + `entwurfProvider` 전체를 놓고, Claude server fragment가 checkout-local `.assembled`/statusLine/plugin wiring을 놓았다. agy source는 retired statusLine/file을 제거하고 whole-file symlink를 regular co-owned merge로 전환했으며, shared arrays(`permissions.allow`, `trustedWorkspaces`)는 ordered element-union한다. live에서 agent-config `setup:links` → entwurf `setup` → agent-config `setup:links` 재실행을 통과: pi settings regular file, user/project effective bare `entwurf-bridge`, Claude doctor PASS, agy exact permission/statusline/hooks 보존, doctor 3종 static green. agent-config unit 139/139.
  3. ~~backend drift를 닫는다~~ **[완료 2026-07-14]** agy pin `1.1` (live 재검증 증거를 DELIVERY §Antigravity에 기록), codex pin `0.144` (비재검증 판정을 DELIVERY §Codex에 기록). `smoke-meta-async-drift` green. 이 게이트는 외부 바이너리에 의존해 CI에 못 넣으므로 여전히 **컷 체크리스트의 수동 항목**이다.
  4. main을 push하고 CI green을 확인한다. 이제 job이 둘이다: `check`(정적 바닥)와 **`install-surface`**(실제 tarball 설치 후 bin/subcommand 주행 — 이번에 추가). agy 없는 러너에서 `smoke-agy-install-state`가 통과해야 한다(`b434d0f` 이전에는 여기서 터졌다).
  5. 기존 표준 명령 **`/prepare-release 0.12.7`**로 CHANGELOG 승격 + package/lock 버전 범프 + 정적/LIVE 관문 + release-prep 커밋을 수행한다. `tag-release` 스킬은 이 repo의 릴리즈 절차가 아니다.
  6. clean HEAD에서 **`/make-release 0.12.7`**로 tag/push/GitHub release를 수행한다.
  7. GLG 승인으로 npm publish를 수행하고 실제 글로벌 설치면을 0.12.7로 재배선한다.
- **[2026-07-14 12:39] 최종 release-gate가 세 번째 offline leak을 잡았다.** MUST 16/17에서 bundled MCP만 `Connected MCP servers: (none registered)`로 FAIL. 원인은 `smoke-user-scope-citizen`가 fake `PI_CODING_AGENT_DIR`와 real XDG ownership state를 섞어 `pnpm check` 중 live user MCP key + pi-provider state를 제거한 것. step-by-step hash bisect로 해당 smoke를 첫 mutator로 확정했다. 두 inverse call에 fake XDG를 묶고 S5c를 추가했다. setup 복구 뒤 targeted smoke live byte-purity PASS, bundled MCP 14/14 재통과.
- **[2026-07-14 PM] Opus 독립 검수: 그 S5c가 자기가 막으려던 클래스를 못 막았다.** 두 구멍을 mutation으로 증명하고 닫았다. ① S5c가 **inline-env 한 줄 형태만** 매칭해서, 같은 override를 `export`로 한 줄 위에 올리면 동일한 leak이 green을 통과했다(그리고 잡히던 케이스조차 명령이 아니라 `bad "run.sh …"` **에러 메시지 문자열**에 걸린 우연이었다). ② 명령 목록에 `install`/`setup`이 있는데, 이 둘은 `ensure_agent_dir_symlinks`가 `$HOME/.pi/agent`를 하드코딩해 agent-dir override를 아예 안 읽는다(run.sh:424) — 즉 게이트가 "PI_CODING_AGENT_DIR만 스왑하면 안전"이라고 축복하는 형태가 실제로는 운영자의 진짜 agent dir를 재링크한다. 이제 S5c는 **구동(drive)을 먼저 식별**하고(env 형태 무관, 산문·assert 문자열은 제외) 그 명령이 쓰는 각 루트별 격리를 요구한다. 스모크도 HOME+XDG 3종을 선격리해 run.sh 내부가 바뀌어도 새지 않는다. 오탐 0(전 스크립트), 우회 3종 차단, live 3표면 byte-identical 재확인. 후속 GPT 대조에서 XDG `export`가 drive **뒤**에 있어도 파일 전역 bool로 green이 되는 ordering 틈을 추가로 닫았다(`72def92`): export 격리는 해당 drive보다 앞에 있을 때만 유효하며, trailing-export mutation이 FAIL함을 확인했다.
- **Blocker: 모두 닫힘.** ① live provenance ② agent-config handoff ③ backend drift ④ fresh agy 1.1.2 live 왕복 ⑤ Opus 독립 검수 ⑥ 최종 LIVE release-gate 완료. HEAD `72def92`에서 MUST **17/17, FAIL=0, SKIP=0**, bundled MCP 14/14. BEHAVIOR는 `/gnew` 뒤 모델이 `entwurf_self`를 자발 호출하지 않은 advisory 1건으로 기존 비차단 판정과 동일. 로그: `/tmp/pi-tmux-release-cut-72def92.log`. 이제 GLG 결정으로 `/prepare-release 0.12.7` 단계에 진입할 수 있다.
  - agent-config: **닫혔다** (`0ed1194`). 실측 재확인 — `doctor-pi-provider`: user/project 모두 `entwurf-bridge`, EFFECTIVE bare + RESOLVES, install-state present.
- **Return:** 0.12.7 publish·실설치·doctor·fresh agy 왕복까지 끝나면 #47 mux launch rail로 돌아간다.

### 0.12.7 컷 관문

```bash
pnpm check
./run.sh check-pack
./run.sh check-pack-install
./run.sh smoke-meta-async-drift        # 수동: 외부 바이너리 pin. 2026-07-14 green (claude 2.1.208 / codex 0.144.1 / agy 1.1.2)
./run.sh doctor-agy-hooks
./run.sh doctor-agy-statusline
./run.sh doctor-agy-bridge
LIVE=1 ./run.sh release-gate /path/to/scratch
```

- release-gate는 반드시 repo 밖 scratch cwd에서 돌리고 MUST `FAIL=0 SKIP=0`을 확인한다.
- 실제 패키지 설치 후:
  1. `pnpm add -g @junghanacs/entwurf@0.12.7`
  2. `entwurf install-meta-bridge && entwurf doctor-meta-bridge`
  3. `entwurf install-agy-bridge && entwurf install-agy-statusline && entwurf install-agy-hooks`
  4. agy 관련 doctor 3개 green 확인
  5. 열린 Claude Code/agy를 재시작하고 **새 agy conversation**에서 자동 gid + MCP send + reply 왕복 재확인
- agy permission installer가 소유하는 것은 `mcp(entwurf-bridge/entwurf_v2)` 한 줄뿐이다. `command(*)`/`unsandboxed(*)` 같은 YOLO 정책은 운영자 소유이며 릴리즈 코드가 넓히지 않는다.

## RECENT

- **[2026-07-13] #46 implementation closed / ownership handoff pending:** ppid+start-key sender marker, record-backed ambiguity refusal, native-push probe 기반 replyability, exact agy permission ownership, install/reinstall/uninstall provenance 고정. `pnpm check` green; 핵심 회귀는 sender identity 28, self-address 31, agy install 120, hooks 37, statusline 62. GitHub issue 최종 감사에서 agent-config 옛 소유자 cleanup이 남은 것을 확인해 close 판정을 되돌렸다.
- **[2026-07-13] evidence boundary:** 동일 agy pid에서 여러 conversation이 동시에 model invocation을 수행하면 단일 marker가 last-writer로 덮인다. 현재 agy의 process-per-session·직렬 invocation에 기대며, 같은 pid 동시성은 지원하지 않는다. owner ancestry 추적은 `ENTWURF_AGY_TRACE_OWNER=1`에서만 켜진다.
- **[2026-07-03] 0.12.6 released:** XDG live artifact, user-scope pi citizen, pnpm 11/setup 단일화.

## AFTER 0.12.7

1. **#47 mux launch rail — 계속 0.12.x.** fresh spawn을 mux-visible surface로 통일한다. 착수 전 `docs/mux-launch-rail.md`를 읽는다.
2. **#48 cortex — 0.13.0.** PR #40은 PARK 상태다. mux 기반과 backend adapter 검증이 선 뒤에만 연다.
3. **Meta sender 모델 표기 — 비차단 후속.** 현재 `agentId=meta-session/<backend>`는 `AGENTS.md` 계약대로 정상이다. 모델을 보여주려면 agentId를 바꾸지 말고 optional display field로 별도 설계한다.

## DORMANT / 재판단할 것

- ACP dependency bump(claude-agent-acp 0.54.1→0.58.x, SDK 1.1.0→1.2.x)는 `ROADMAP.md`의 별도 트랙. 중간 0.55~0.57과 model forcing을 먼저 검토한다.
- Claude meta-bridge/dev-bin에도 agy에서 발견한 “재설치 시 자기 preimage를 재캡처” 패턴이 있는지 별도 audit한다. 0.12.7 blocker는 아니다.
- **offline floor 전체를 swapped HOME에서 실행한다.** `check-install-surface` S5는 정적 tripwire라 변수 조립/heredoc 경로를 못 본다. 진짜 보장은 `pnpm check`의 모든 smoke를 샌드박스 HOME 아래에서 돌려 **구조적으로** 실제 설치면에 닿지 못하게 하는 것이다. 현재 스모크들이 각자 HOME을 관리하므로 이중 격리 충돌을 먼저 확인해야 한다. 0.12.7 blocker는 아니지만 S5의 한계를 없애는 유일한 길이다.
- `doctor-pi-provider`에도 agy에서 고친 것과 같은 "운영자의 넓은 규칙이 커버 중"과 "정말 깨짐"을 구분하는 축이 있는지 재확인한다(이미 unowned-override note를 구분한다고 알려져 있으나 대조하지 않았다).
- `check-pack-install`의 fake Claude clean-host 확장과 Claude 2.1.97 floor 재검증은 기존 C2/C3 후속이며 이번 컷의 새 범위로 끌어오지 않는다.

## 넘으면 안 되는 선

- agy는 **native-push domain**이다. pi socket domain이나 mailbox receiver/watchArmed 축에 넣지 않는다.
- `origin`은 provenance이고 delivery rail이 아니다. native-push replyable은 `recordBacked ∧ probeAlive`다.
- 동일 pid 동시 conversation을 지원한다고 과장하지 않는다.
- `agentId=meta-session/<backend>` 계약을 0.12.7에서 바꾸지 않는다.
- #47 mux와 #48 cortex 구현을 0.12.7 컷에 섞지 않는다.
- `core.hooksPath`, `--no-verify`, unsafe override를 건드리지 않는다.
- green preflight와 GLG 명시 승인 없이 tag/publish하지 않는다.

## 참조

- repo 규칙: `AGENTS.md`
- 방향: `ROADMAP.md`
- 릴리즈 기록: `CHANGELOG.md`
- agy 전달 증거: `DELIVERY.md`
- 검증 기준: `VERIFY.md` · `BASELINE.md`
- 다음 구현: `docs/mux-launch-rail.md`
- 이슈: #46(agy, closed) · #47(mux, next 0.12.x) · #48(cortex, 0.13.0)
