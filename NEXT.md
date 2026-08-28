# NEXT — OMP as one garden sibling (실무 잠수함)

> NEXT는 disposable boot sector다. 완료 이력은 issue/git이 지고, 방향은 ROADMAP,
> 운영 규율은 AGENTS가 진다. 새 하네스 입학 경로는
> [docs/adding-a-harness.md](./docs/adding-a-harness.md)다.

# RAIL — 현재 좌표

- [x] **1. OMP measurement·audit·LIVE + Bundle A admission hardening** — backend registration, TUI-only birth, visible status, native MCP hand, sender identity, four-root/package/doctor hardening 완료.
- [x] **2. Operator deploy + real outbound acceptance** — 2026-08-28 oracle: 재설치·shared reader 재배포·doctor 4종 green, `check:full` exit 0, outbound LIVE 4건(그중 1건은 GLG가 직접 연 세션). `tools.xdev` 방언 발견과 문서화 포함.
- [ ] **3. Bundle A land + 0.16.0 준비** ← CURRENT: branch push 완료; main land 방식과 cut 여부는 GLG 결정. 남은 정리는 아래 LEDGER.
- [ ] **4. Bundle B: addressed receive / roundtrip** ← PAUSED: **대칭은 여기서 생긴다.** 다른 harness → 이미 열린 OMP wake·receive는 Bundle A 범위 밖이고 코드가 0줄이다.
- [ ] **5. Bundle C: visible fresh + grade** ← PAUSED: `entwurf_fresh_call`로 OMP를 열고 LIVE 영수증 뒤에만 DELIVERY/registry grade 이동.

현재 좌표: 1–2 완료 → **3 land·cut 결정** → 4–5 보류.

# NOW

- **Stem:** OMP TUI 하나를 독립 형제로 세우되, 그 안의 서브에이전트에는 garden id를 주지 않는다.
- **되는 것 (측정, 2026-08-28 oracle):** OMP TUI가 열리면 citizen 하나를 mint하고, 상태줄에 garden id를 보이고, 자기 이름으로 `entwurf_v2` outbound를 보낸다. task subagent는 `mode=print`로 scope-refused되어 아무것도 mint하지 않는다. 벤더 `/mcp list`가 native 우선을 확인한다.
- **안 되는 것 (설계된 경계):** 다른 harness → OMP 답장. receiver marker도 mailbox arm도 없고 watch를 쥔 프로세스가 없다(`pi-extensions/meta-bridge-omp.ts:17`). dispatch는 `mailbox-undeliverable`로 fail-closed. OMP는 `entwurf_fresh_call`로 열 수 없다. registry는 `D0`, 이는 정확한 표기다.
- **운영자 필수 설정:** `~/.omp/agent/config.yml`에 `tools: xdev: false`. 기본값(`tools.xdev: true` + `xdevDocs: builtins`)에서는 MCP 도구가 `xd://` 가상 device로 감싸이고 스키마가 프롬프트에 없어, 자연어 발신이 **거짓 성공 보고**로 끝난다(측정). 근거·숫자는 `docs/external-mcp-host.md` OMP 절.
- **Next:** GLG가 land 방식(merge/PR)과 0.16.0 cut 여부를 정한다. Bundle B는 별도 grant.
- **Boundary:** Bundle A가 사는 것은 **OMP → others outbound**뿐이다. 대칭(others → OMP)은 Bundle B이며 아직 없다; supported-harness/grade 선언으로 앞당기지 않는다.
- **Read:** #87 thread · `docs/setup-clean-host.md` §4b · `docs/external-mcp-host.md` OMP row · `docs/adding-a-harness.md` steps 3, 3.5, 5, 6, 7.
- **Do not touch:** Bundle B receive · Bundle C fresh/grade · README/setup support admission · DELIVERY/registry grade.

# RECENT

- **2026-08-28 (오후):** oracle에서 Bundle A를 실제로 설치·배포·수용. stale writer 두 축(omp 확장, Claude shared reader)을 doctor가 잡아 재배포. LIVE outbound 4건, subagent zero-mint, inbound fail-closed 모두 재현. OMP `tools.xdev` 기본값이 MCP 도구를 `xd://`로 감싸 거짓 발신 보고를 만든다는 것을 벤더 바이너리·트랜스크립트로 측정하고 3개 문서에 반영.
- **2026-08-28 (오전):** #87 Bundle A source, package and doctor hardening reviewed independently; qualification and final deterministic floor were green on the final candidate.
- **2026-08-27:** OMP vendor measurement and real TUI/subagent observations closed the Bundle A admission basis.

# CARRIED

- **#78** macOS/native-Windows portability — separate grant; do not mix into #87.
- **#72 #76** bugs and cortex gate slice — separate lanes.

# LEDGER — land 전에 정할 것

- **L1 게이트 편입:** `smoke-omp-bridge-state` / `smoke-omp-mcp-state`가 `check:full`·`release-gate`·`setup` 어디에도 없다(측정: package.json 스크립트 전체에서 0회). `check-omp-birth-hook`만 `scripts/mutants/omp-birth.json`을 통해 `check-gate-qualification`에서 돈다. Copilot 대응물은 `check:hermetic`에 있다 — 비대칭.
- **L2 CHANGELOG:** `## Unreleased`가 비어 있고 v0.15.1 이후 커밋이 쌓여 있다. cut을 하면 `tag-release`가 채운다.
- **L3 doctor가 모르는 설정:** `doctor-omp-mcp`는 `tools.xdev`를 보지 않는다. 설정이 기본값이면 doctor는 green인데 모델은 도구를 제대로 못 부른다. doctor 셀 하나로 넣을지, Bundle C의 preflight 능력으로 올릴지 결정 필요.
- **L4 표기 다듬기:** `entwurf_self`가 omp 시민에게 `metaDeliveryDomain: "self-fetch"` + `mailboxPath`를 렌더한다. `replyable:false`와 decider는 정직하므로 동작 결함은 아니지만, 드레인하는 프로세스가 없는 경로를 보여준다.
- **L5 주소 지정 공백 → #90으로 승격:** `entwurf_peers`에서 claude-code 시민은 `model=(unknown)`(측정: 0/353). 원인 가설은 "벤더는 문자열 `model`을 주는데 우리 리더가 `{id}`/`model_id`만 받는다"이나, 그 근거로 쓴 `~/repos/3rd/claudecode`는 **한때 공개됐던 소스 스냅샷이지 설치된 제품이 아니다** — step 1이 금지하는 오라클이므로 상속·미검증으로 강등. 살아 있는 제품에서 SessionStart 봉투를 실제로 캡처해야 결정된다.
- **L8 OMP child가 bridge 권한을 물려받는다 (측정, GLG 세션 2026-08-28):** OMP task child의 `entwurf_self`는 **부모의 garden id**를 반환한다(두 번째 주소 없음 — §3.5 요구사항 충족, 게이트가 증명하는 그대로). 그러나 그 빌린 신원으로 `entwurf_v2`와 `entwurf_fresh_call`을 호출할 수 있다. §3.5(b)가 도구 차용을 의도적으로 허용하므로 깨진 불변식은 아니고, 열린 질문은 **내부 agent가 dispatch·형제 생성 권한을 가져도 되는가**이며 이는 OMP 한정이 아니라 가든 전역이다. 값싼 울타리 후보 측정: omp 18.0.0에 subagent의 MCP 접근을 막는 `mcp.*` 키는 없으나 `task.enableLsp`(기본 false)가 **subagent별 개별 도구 차단 기제가 존재함**을 증명한다. 자체 tool set을 든 custom agent 정의는 미검증 단서.
- **L6 벤더 드리프트:** 측정은 omp 18.0.0 기준. 세션 중 18.0.9까지 올라갔다. `mode === "tui"` 판별자와 `xd://` 동작은 업그레이드 시 재측정 대상.
- **L7 ROADMAP:** "현재" 절이 아직 측정 단계로 적혀 있다.

# CARRIED

- **#78** macOS/native-Windows portability — separate grant; do not mix into #87.
- **#72 #76** bugs and cortex gate slice — separate lanes.

# DURABLE LINKS

- #87: https://github.com/junghan0611/entwurf/issues/87
- #90 (claude-code model 필드, 별도 레인): https://github.com/junghan0611/entwurf/issues/90
- Admission path: `docs/adding-a-harness.md`
- OMP operator boundary: `docs/setup-clean-host.md` §4b
- OMP tool-surface dialect: `docs/external-mcp-host.md` OMP row
