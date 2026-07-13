# NEXT — v0.12.7: agy garden citizen 릴리즈

> NEXT는 부트 섹터다. 닫힌 역사는 CHANGELOG/git에, 장기 방향은 ROADMAP/이슈에 둔다.

## NOW — #46을 0.12.7로 출하

- **Stem:** agy/Antigravity를 완전한 garden citizen으로 출하한다. 당분간 릴리즈 축은 **0.12.x**이며, **0.13.0은 cortex 지원(#48)** 에 예약한다.
- **Current:** #46 본체 구현·설치면·회귀 게이트는 완료됐다. thinkpad에서 agy 자동 birth → gid/statusline → MCP `entwurf_v2` → `meta-session/antigravity`·`replyable:true` sender → 같은 gid로 native-push 답장 도착까지 라이브 왕복을 확인했다. 최종 문서/pack 감사에서 npm-installed `entwurf-agy-imprint`가 raw `.ts`를 실행해 `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`으로 죽는 릴리즈 블로커를 발견했고, compiled dist dispatch + 실제 tarball 설치 회귀로 수정했다.
- **Next:**
  1. **#46 마지막 ownership handoff를 agent-config에서 닫는다.** "새 소유자가 잡는" 앞 절반은 이 호스트에서 이미 끝났다: live `~/.gemini/antigravity-cli/settings.json`은 **regular file**이고 `statusLine.command=entwurf-agy-statusline` + `permissions.allow`에 `mcp(entwurf-bridge/entwurf_v2)` 한 줄이 들어가 있으며, 운영자 소유 `command(*)`/`unsandboxed(*)`는 그대로 보존돼 있다. 남은 것은 "옛 소유자가 놓는" 뒷 절반이다.
     - 재발 벡터가 구체적이다: `agent-config/run.sh:741`의 `ensure_link`가 그 파일을 **whole-file symlink로 되돌린다.** 그 순간 entwurf의 원소별 adapter는 symlink-refuse로 막히고 statusline/permission 소유가 agent-config 버전으로 되돌아간다. agent-config가 symlink를 버리고 disjoint-key merge로 바꾸기 전에는 agy doctor green이 재현 가능한 상태가 아니다.
     - pi 축은 아직 앞 절반도 안 끝났다: agent-config `pi/settings{,.server}.json`이 entwurf `packages[]` + repo-path `entwurfProvider.mcpServers`를 들고 있고, `doctor-pi-provider`는 EFFECTIVE를 legacy repo path로 읽으며 user-scope install-state가 없다. entwurf `setup`을 먼저 돌려 bare `entwurf-bridge`로 normalize한 뒤 agent-config가 그 키들을 놓는다.
     - 완료판정: `doctor-pi-provider` EFFECTIVE bare + agy doctor 3개 green + **agent-config setup 재실행 후에도** 무회귀.
  2. main을 push하고 CI green을 확인한다 (agy 없는 러너에서 `smoke-agy-install-state`가 통과해야 한다 — `b434d0f` 이전에는 여기서 터졌다).
  3. 기존 표준 명령 **`/prepare-release 0.12.7`**로 CHANGELOG 승격 + package/lock 버전 범프 + 정적/LIVE 관문 + release-prep 커밋을 수행한다. `tag-release` 스킬은 이 repo의 릴리즈 절차가 아니다.
  4. clean HEAD에서 **`/make-release 0.12.7`**로 tag/push/GitHub release를 수행한다.
  5. GLG 승인으로 npm publish를 수행하고 실제 글로벌 설치면을 0.12.7로 재배선한다.
- **Blocker:** agent-config의 옛 소유자 cleanup이 아직 안 닫혔다. 현재 `doctor-pi-provider`는 EFFECTIVE project repo-path + no state를 "not yet adopted"로 정직하게 보고한다. 이 상태에서 issue #46을 닫거나 0.12.7을 prepare하지 않는다.
- **Return:** 0.12.7 publish·실설치·doctor·fresh agy 왕복까지 끝나면 #47 mux launch rail로 돌아간다.

### 0.12.7 컷 관문

```bash
pnpm check
./run.sh check-pack
./run.sh check-pack-install
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
