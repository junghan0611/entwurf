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
  - 죽은 스크립트 감사: `scripts/` 117개 중 **미참조 0건**. 고아처럼 보인 6개는 전부 의도된 것(LIVE 3종은 release-gate 밖이라고 AGENTS/VERIFY에 명시, `check-keyset-overlap`은 `smoke-meta-keyset-guard`가 감싸 `pnpm check`에서 실행, `check-pack-install`은 이제 CI). `smoke-meta-async-drift`는 죽은 게 아니라 **지금 RED다** — 아래 Next 2.
- **Next:**
  1. **#46 마지막 ownership handoff를 agent-config에서 닫는다.** "새 소유자가 잡는" 앞 절반은 이 호스트에서 이미 끝났다: live `~/.gemini/antigravity-cli/settings.json`은 **regular file**이고 `statusLine.command=entwurf-agy-statusline` + `permissions.allow`에 `mcp(entwurf-bridge/entwurf_v2)` 한 줄이 들어가 있으며, 운영자 소유 `command(*)`/`unsandboxed(*)`는 그대로 보존돼 있다. 남은 것은 "옛 소유자가 놓는" 뒷 절반이다.
     - 재발 벡터가 구체적이다: `agent-config/run.sh:741`의 `ensure_link`가 그 파일을 **whole-file symlink로 되돌린다.** 그 순간 entwurf의 원소별 adapter는 symlink-refuse로 막히고 statusline/permission 소유가 agent-config 버전으로 되돌아간다. agent-config가 symlink를 버리고 disjoint-key merge로 바꾸기 전에는 agy doctor green이 재현 가능한 상태가 아니다.
     - pi 축은 아직 앞 절반도 안 끝났다: agent-config `pi/settings{,.server}.json`이 entwurf `packages[]` + repo-path `entwurfProvider.mcpServers`를 들고 있고, `doctor-pi-provider`는 EFFECTIVE를 legacy repo path로 읽으며 user-scope install-state가 없다. entwurf `setup`을 먼저 돌려 bare `entwurf-bridge`로 normalize한 뒤 agent-config가 그 키들을 놓는다.
     - 완료판정: `doctor-pi-provider` EFFECTIVE bare + agy doctor 3개 green + **agent-config setup 재실행 후에도** 무회귀.
  2. **backend drift를 닫는다 (0.12.7 차단).** `smoke-meta-async-drift`가 지금 RED다: **agy 1.1.0**(pin 1.0.x), **codex 0.144.1**(pin 0.136.x). claude 2.1.207은 pin 안이라 PASS. 이번 릴리즈의 주체가 agy인데 1.0.x 가정 위에서 검증한 셈이므로 그냥 pin만 올리면 안 된다. agy 1.1.0에서 `LIVE=1 AGY_CONVERSATION_ID=<id> ./run.sh smoke-agy-native-push-live` + fresh conversation 왕복을 재확인한 뒤 pin과 DELIVERY를 갱신한다. codex는 native-citizen lane이 아니므로 "이번 컷에서 재검증하지 않음"을 명시 판정으로 남기거나 같이 확인한다. 이 게이트는 외부 바이너리에 의존해 CI에 못 넣으므로 **컷 체크리스트의 수동 항목**이다.
  3. main을 push하고 CI green을 확인한다. 이제 job이 둘이다: `check`(정적 바닥)와 **`install-surface`**(실제 tarball 설치 후 bin/subcommand 주행 — 이번에 추가). agy 없는 러너에서 `smoke-agy-install-state`가 통과해야 한다(`b434d0f` 이전에는 여기서 터졌다).
  4. 기존 표준 명령 **`/prepare-release 0.12.7`**로 CHANGELOG 승격 + package/lock 버전 범프 + 정적/LIVE 관문 + release-prep 커밋을 수행한다. `tag-release` 스킬은 이 repo의 릴리즈 절차가 아니다.
  5. clean HEAD에서 **`/make-release 0.12.7`**로 tag/push/GitHub release를 수행한다.
  6. GLG 승인으로 npm publish를 수행하고 실제 글로벌 설치면을 0.12.7로 재배선한다.
- **Blocker (둘):** ① agent-config의 옛 소유자 cleanup. ② backend drift — agy 1.1.0 미검증. 둘 중 하나라도 열려 있으면 #46을 닫거나 0.12.7을 prepare하지 않는다.
  - agent-config: 아직 안 닫혔다. 현재 `doctor-pi-provider`는 EFFECTIVE project repo-path + no state를 "not yet adopted"로 정직하게 보고한다. 이 상태에서 issue #46을 닫거나 0.12.7을 prepare하지 않는다.
- **Return:** 0.12.7 publish·실설치·doctor·fresh agy 왕복까지 끝나면 #47 mux launch rail로 돌아간다.

### 0.12.7 컷 관문

```bash
pnpm check
./run.sh check-pack
./run.sh check-pack-install
./run.sh smoke-meta-async-drift        # 수동: 외부 바이너리 pin. 지금 RED (agy 1.1.0 / codex 0.144.1)
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
