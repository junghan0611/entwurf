# NEXT — v0.12.7 출하 마무리 → v0.12.8 floor purity

> NEXT는 부트 섹터다. 닫힌 역사는 CHANGELOG/git에, 장기 방향은 ROADMAP/이슈에 둔다.

## NOW — 0.12.7 컷 완료, 출하는 GLG 손에

- **Stem:** #46 agy/Antigravity를 완전한 garden citizen으로 출하한다. 릴리즈 축은 당분간 **0.12.x**이며 **0.13.0은 cortex(#48)** 에 예약한다.
- **Current [2026-07-14]:** release-prep 커밋 `54a29de`. CHANGELOG `## 0.12.7 — 2026-07-14` 승격, package `0.12.6 → 0.12.7`, lockfile 갱신. 워킹트리 clean.
  - **`LIVE=1 release-gate` (fresh scratch, prep된 트리에서 재실행): MUST 17/17, FAIL=0, SKIP=0, EXIT=0.** bundled MCP(S2g axis3) 통과 — 오전에 RED였던 그 축이다. BEHAVIOR advisory 1건(`/gnew` 뒤 모델이 `entwurf_self`를 자발 호출하지 않음)은 게이트 스스로 비차단으로 분류하는 기존 항목이다.
  - 정적 바닥 `pnpm check` green. **실행 전후 live 3표면 byte-identical** 재확인 — `~/.pi/agent/settings.json`, `$XDG_DATA_HOME/entwurf` 트리, `agy-imprint.log` 줄 수.
  - blocker 6개 전부 닫힘: ① live state provenance 복구 ② agent-config ownership handoff (`0ed1194`) ③ backend drift pin ④ fresh agy 1.1.2 live 왕복 + native-push 13/13 ⑤ 교차검수(offline leak 3건 + 그 게이트 자신의 구멍 3건) ⑥ 최종 LIVE release-gate.
- **Next:**
  1. **`/make-release 0.12.7`** — clean HEAD에서 tag/push/GitHub release. **GLG가 실행한다.**
  2. GLG 승인으로 npm publish, 실제 글로벌 설치면을 0.12.7로 재배선한다.
  3. **실설치 검증** (publish 후):
     - `pnpm add -g @junghanacs/entwurf@0.12.7`
     - `entwurf install-meta-bridge && entwurf doctor-meta-bridge`
     - `entwurf install-agy-bridge && install-agy-statusline && install-agy-hooks` → agy doctor 3종 green
     - 열린 Claude Code/agy를 재시작하고 **새 agy conversation**에서 자동 gid + MCP send + reply 왕복 재확인
  4. agy permission installer가 소유하는 것은 `mcp(entwurf-bridge/entwurf_v2)` 한 줄뿐이다. `command(*)`/`unsandboxed(*)` 같은 YOLO 정책은 운영자 소유이며 릴리즈 코드가 넓히지 않는다.
- **수동 항목:** `smoke-meta-async-drift`는 외부 바이너리 pin에 의존해 CI에 못 넣는다. 컷 체크리스트의 수동 항목으로 남는다 (2026-07-14 green: claude 2.1.208 / codex 0.144.1 / agy 1.1.2).

## 0.12.8 첫 항목 — 정규식을 불변식으로 바꾼다 (floor purity)

**왜.** 이틀 동안 같은 클래스가 세 번 터졌다 — hard-verify(2026-07-13), `check-pack-install`의 드라이브, `smoke-user-scope-citizen`. 그리고 그걸 막으려 심은 게이트에서 **다시 세 개**가 나왔다: inline-env 한 줄 형태만 매칭, `install`/`setup`의 HOME 축 누락, trailing-export ordering. 원인은 하나다. **우리는 사고의 모양을 정규식으로 열거해 왔지, 불변식을 강제하지 않았다.** shell은 같은 동작을 무한히 많은 표기로 쓸 수 있으므로 금지 목록은 원리적으로 바닥이 없다. AGENTS rule 11이 이미 스스로 실토하고 있다 — *"the real guarantee is running the offline floor under a swapped HOME+XDG, **which is still open**"*.

**순서가 핵심이다: 계측기를 먼저 놓고, 그 다음에 기계를 바꾼다.** 격리부터 켜고 정규식을 떼면, 격리가 실제로 작동하는지 볼 눈이 없는 상태로 유일한 가드를 떼는 셈이다.

1. **`check-floor-purity` — 관측을 먼저 심는다.**
   바닥 실행 방식은 그대로 두고 **감싸기만** 한다: live manifest 해시 → `pnpm check` → 대조 → 다르면 RED. 관측은 아무것도 부수지 않으므로 지금 붙일 수 있고, 붙는 순간부터 **어떤 구문으로 새든** 잡는다. 정규식이 열거하던 무한 집합이 여기서 측정 하나로 접힌다.
   - **live manifest를 SSOT 파일 하나로 모은다.** 지금은 doctor·게이트·run.sh에 흩어져 있다: `~/.pi/agent/settings.json`, `$XDG_DATA_HOME/entwurf/**`, statusline gid 캐시, `~/.claude` plugin 배선, `~/.gemini` agy settings, dev-bin 심링크.
   - **불변면과 자연 churn면을 구분한다.** meta-sessions 스토어와 imprint 로그는 다른 하네스 세션이 지금도 쓰고 있다 — 전체 해시를 걸면 오탐 폭탄이다. 정답은 이미 리포 안에 있다: `check-pack-install`의 outer fence는 전체 줄 수가 아니라 **게이트 전용 fake marker 개수**만 센다. 그 패턴을 재사용한다.
   - CI에는 live 표면이 아예 없으므로 **"없던 것이 생기면 위반"** 이라는 가장 강한 형태가 공짜로 성립한다.
2. **바닥 컨테인먼트 — 한 곳에서.**
   fence가 지켜보는 상태에서 게이트 체인 전체를 스왑된 `HOME` + XDG 3종 + `PI_CODING_AGENT_DIR` 아래로 넣는다. 개별 스모크가 안에서 무슨 구문을 쓰든 live에 닿을 수 **없다** — 탐지가 아니라 불가능이 된다. 이때 fence의 역할이 leak 탐지기에서 **컨테인먼트 증명기**로 바뀐다: 절대경로를 하드코딩해 샌드박스를 빠져나가는 게이트가 있으면 fence가 빨갛게 잡는다.
   - `pnpm lint`/`typecheck`은 감싸지 않는다 — pnpm store/cache가 XDG 아래라 재다운로드가 터진다. 감싸는 것은 `./run.sh check-*` / `smoke-*` 체인뿐이다.
   - 이 단계의 실제 작업량은 **"가짜 HOME에서 무엇이 깨지는가" 감사**다.
3. **루트 해석 resolver를 하나로 — 이 병의 뿌리.**
   지금 루트 해석이 최소 8곳에 흩어져 서로 다른 규칙을 쓴다(`run.sh` 339/370/392/424/503, `agy-imprint.ts:36`, meta-session, statusline). `ensure_agent_dir_symlinks`(run.sh:424)만 `$HOME/.pi/agent`를 하드코딩하고 `PI_CODING_AGENT_DIR`를 아예 안 읽는 게 정확히 그 증상이다. resolver 하나로 모으면 격리가 "환경변수를 잘 챙겼나"에서 **"resolver 하나를 갈아끼웠나"**로 바뀌고, 감사 지점도 하나가 된다. 설치 코드 리팩터이므로 fence가 켜진 뒤에 한다.
4. **S5 계열을 강등한다. 삭제하지 않는다.**
   역할이 "마지막 방어선"에서 **"의도 린트"**로 바뀐다 — *컨테인먼트가 어차피 막아주더라도, live를 겨냥한 줄은 애초에 쓰지 마라.* 강등 조건은 **두 루틴(정적 tripwire · 동적 fence)이 여러 컷에 걸쳐 계속 합의하는 것**이다. 한 번 green 맞췄다고 떼면 지금까지의 실수를 그대로 반복한다.

   | 정적 | fence | 읽는 법 |
   |---|---|---|
   | green | green | 정상 |
   | green | **RED** | 우리가 열거하지 못한 **새 형태**. 정적에 추가하고, 컨테인먼트가 왜 놓쳤는지 추궁한다 |
   | **RED** | green | 정적 오탐이거나 죽은 코드. 정적을 조이거나 코드를 지운다 |

   - **알려진 잠재 틈 (현재 인스턴스 0건):** S5b도 S5c와 같은 ordering 축을 갖는다 — HOME 스왑과 XDG export 사이에서 XDG-rooted write가 일어나면 못 본다. 전 스모크가 HOME 직후 1~5줄 안에 XDG를 export하므로 실체는 없다. **정규식을 또 얹지 않고 fence로 흡수한다** (이게 이 lane의 규율이다).
   - agent-config `setup:links`도 공유 설정면을 만지는 같은 구조다. fence 개념은 결국 그쪽에도 간다.

## RECENT

- **[2026-07-14] 0.12.7 컷 완료.** #46 본체·설치면·회귀 게이트 + 교차검수 3라운드(Fable → GPT → Opus → GPT). 상세는 CHANGELOG `## 0.12.7`.
- **[2026-07-13] evidence boundary:** 동일 agy pid에서 여러 conversation이 동시에 model invocation을 수행하면 단일 marker가 last-writer로 덮인다. 현재 agy의 process-per-session·직렬 invocation에 기대며, 같은 pid 동시성은 지원하지 않는다. owner ancestry 추적은 `ENTWURF_AGY_TRACE_OWNER=1`에서만 켜진다.
- **[2026-07-03] 0.12.6 released:** XDG live artifact, user-scope pi citizen, pnpm 11/setup 단일화.

## AFTER 0.12.7

1. **floor purity (위 0.12.8 첫 항목)** — 출하 직후 착수한다.
2. **#47 mux launch rail — 계속 0.12.x.** fresh spawn을 mux-visible surface로 통일한다. 착수 전 `docs/mux-launch-rail.md`를 읽는다.
3. **#48 cortex — 0.13.0.** PR #40은 PARK 상태다. mux 기반과 backend adapter 검증이 선 뒤에만 연다.
4. **Meta sender 모델 표기 — 비차단 후속.** 현재 `agentId=meta-session/<backend>`는 `AGENTS.md` 계약대로 정상이다. 모델을 보여주려면 agentId를 바꾸지 말고 optional display field로 별도 설계한다.
