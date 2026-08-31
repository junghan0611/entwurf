# NEXT — OMP as one garden sibling (실무 잠수함)

> NEXT는 disposable boot sector다. 완료 이력은 issue/git이 지고, 방향은 ROADMAP,
> 운영 규율은 AGENTS가 진다. 새 하네스 입학 경로는
> [docs/adding-a-harness.md](./docs/adding-a-harness.md)다.

# RAIL — 현재 좌표

- [x] **1. OMP measurement·audit·LIVE + Bundle A admission hardening** — backend registration, TUI-only birth, visible status, native MCP hand, sender identity, four-root/package/doctor hardening 완료.
- [x] **2. Operator deploy + real outbound acceptance** — 2026-08-28 oracle: 재설치·shared reader 재배포·doctor 4종 green, `check:full` exit 0, outbound LIVE 4건(그중 1건은 GLG가 직접 연 세션). `tools.xdev` 방언 발견과 문서화 포함.
- [x] **3. Bundle B: addressed receive / roundtrip** — **대칭이 생겼다.** receiver 확장, bounded arm defer, `/new`·watch-error·vanished-signal·overlapping-edge fail-closed, install/uninstall/doctor, `check-omp-receive-arm` + `scripts/mutants/omp-receive.json`(11 mutants, 전부 정확한 이유로 kill), `smoke-omp-receive-state`, `smoke-omp-receive-live`. registry `self-fetch`/`D6`, DELIVERY 행 신설. 단언 개수는 게이트가 세는 것이지 증거가 아니므로 여기 박지 않는다 — 영수증은 `raw-omp-measure/README.md` §M7 이다.
- [x] **4. Bundle A+B land** — `a809ee7 feat(omp): receive addressed native messages` (26 paths). 체크포인트 commit; push·cut 없음.
- [x] **5. Bundle C: visible fresh + admission release-stop** — 구현이 한 candidate로 동결되고 independent review까지 끝났다(2026-08-30, architecture blocker 0 / **Defect 3** / observation 1). `entwurf_fresh_call`이 네 번째 backend로 omp를 연다. clause 7 LIVE(`smoke-omp-fresh-live`, release-gate MUST)는 **green** — 2026-08-30, 21 assertions, omp 18.0.0 / `openai-codex/gpt-5.6-sol`, callback sender garden `20260830T192913-df52b9`. 영수증 정본은 DELIVERY.md의 OMP 행이고, 그 근거로 DELIVERY/README의 라벨은 이미 이동해 있다. **한 호스트·한 모델·한 번의 수용이다** — multi-host도, multi-model도, 한 프로세스 안의 반복 fresh도 주장하지 않는다. review amendment 한 번들(Defect 1–3)은 2026-08-31에 `5bb1d50`으로 반영됐다 — same-id `session_switch` epoch 무효화, creator 소유 `ctx.setTimeout`/`ctx.clearTimer` readiness 타이머(취소 불가 빌드는 arm 거부), 산문 정렬, 뮤턴트 21→23. closure review 잔여 O-D1r은 defect 등급으로 승격되어 `153f9f4`에서 닫혔고(뮤턴트 23→24), 첫 standalone qualification이 `fd5e462`에서 manifest 부채를 측정으로 정산했다 — `check-gate-qualification` 324/324 KILLED, `check:full` exit 0 (430s).
- [x] **6. 0.16.0 cut** — 태그·릴리즈 완료.
- [ ] **8. #72 + 0.16.1 컷** ← NEXT SESSION: 아래 `#72` 절이 이번에 회수한 서명이다. 그 위에서 진단→수리→0.16.1.
- [x] **7. 0.16.0이 남긴 원커맨드 구멍 메우기** — 닫혔다(`4076498`, `c3d5b2a`), pi floor 0.84.4까지 함께(`5c1bda5`). 원래 본문: **v0.16.0은 OMP를 admit했지만 `setup`은 OMP를 합성하지 않았다.** GLG의 thinkpad(설치 안 된 호스트)에서 `entwurf setup`이 green을 찍는데 OMP는 확장도 mcp.json도 status line garden id도 없었다 — 유닛 게이트는 유닛만 묻고, admission 게이트는 registry↔fresh만 물어서, "유닛이 있다 → 원커맨드가 거기 닿는다" 간선을 아무 게이트도 소유하지 않았다. 이번 세션에서 (a) `setup_all`에 omp 4유닛(birth→MCP→`tools.xdev` 설정→receiver) presence-driven 합성, (b) 설정값 writer `install-omp-config`/`uninstall-omp-config` 신설(정확히 자기가 넣은 줄만 소유, 운영자의 명시적 `xdev: true`는 덮지 않고 이름 불러 거부), (c) `smoke-setup-verdict` S-8(스텁 벤더로 실제 합성 구동 + install-state 4종 + agent dir 산출물 + `xdev-off` 유효 판독 + 2회차 멱등) 및 S-1의 `OMP_BIN` absent 핀, (d) `docs/adding-a-harness.md` **step 10**(온보딩은 setup이 합성해야 끝난다)까지 닫았다. 남은 것: 버전 범프·CHANGELOG 승격은 `entwurf-release` prepare 몫(GLG 승인).

<details><summary>6의 원래 본문 (릴리즈 준비 기록)</summary>

CHANGELOG `## Unreleased`가 구현 범위 `v0.15.1..19ad90c` **30커밋** 전수로 채워져 있었다. CHANGELOG `## Unreleased`가 구현 범위 `v0.15.1..19ad90c` **30커밋** 전수로 채워져 있다(릴리즈 준비 커밋은 그 위에 따로 쌓이므로 `v0.15.1..HEAD`의 수는 계속 커진다 — 기준은 항상 범위이지 숫자가 아니다). 섹션 승격·버전 범프·lockfile·release-gate 수치는 `entwurf-release` **prepare** 몫이고, land/prepare/make/publish는 모드마다 별도 GLG 승인이다.

</details>

현재 좌표: 1–6 완료(구현·review·amendment·clause 7 LIVE green·closure review·qualification·full floor·0.16.0 cut) → **7. 원커맨드 구멍 메우기** ← 여기. 코드·게이트·문서는 워킹트리에 있고 `check:full` exit 0(251s)이다. commit·push·범프는 GLG 몫.

# oracle에서 열리는 형제에게 (2026-09-01, GLG가 이 자리를 여기로 옮긴다)

너는 **사고가 실제로 나는 호스트**에 서 있다. thinkpad는 507 ACP 턴에서 0건, oracle은 360에서
8건(4 mid-turn + 4 between-turn)이다. 재현을 시도할 수 있는 유일한 자리라는 뜻이고, 동시에
**남의 운영 호스트를 실험대로 쓰는 자리**라는 뜻이기도 하다. 무장·설정 변경은 GLG 결정이다.

**먼저 읽을 것 (요약이 아니라 소스로):**

1. `scripts/raw-acp-child-exit-measure/README.md` — 이 판의 정본. 서명의 파일·레코드 번호,
   소스가 지지하지 않는 판독 3개, 반례로 폐기된 후보 4개, 두 호스트 인구 표, exit(0)의 세 문,
   그리고 측정 가능한 형태로 적힌 열린 질문 하나. **untracked다** (repo 관례상 `raw-omp-measure`와
   같은 형식). 커밋 여부는 GLG 몫.
2. `https://github.com/junghan0611/entwurf/issues/72` — 본문의 수리 경계와, 2026-09-01에
   달린 진단 코멘트(위 README의 공개판). 본문과 스레드가 어긋나면 **스레드가 이긴다.**
3. 이 파일의 아래 `#72` 절 — 최초 핸드오프. **그 안의 세 판독은 이미 폐기됐다**(README §"Three
   readings"). 역사로 읽고, 사실로 쓰지 마라.

**지금까지 확정된 것 한 줄:** child는 죽는 게 아니라 **스스로 정상 종료(exit 0)** 한다. 크래시도
시그널 킬도 아니고, reason 없는 깨끗한 stdout EOF라 child가 먼저 갔고 pi가 닫은 게 아니다.
`claude-agent-acp` `dist/index.js:81-95`에 exit 0으로 나가는 문이 셋뿐이다 — `connection.closed`
/ SIGTERM / SIGINT → `dispose()` → `process.exit(0)`.

**남은 질문 하나:** 셋 중 어느 문인가. 지금 아티팩트로는 도출되지 않고, **시그널 전달 여부로
밖에서 구분된다.**

**대기 중인 결정 두 개 (GLG 몫, 네가 먼저 하지 마라):**

- (A) **stderr-only 프로브 무장.** launch 때 ACP child의 main module에 붙여 시그널 이름/exit
  경로를 entwurf가 이미 잡아 보여주는 stderr tail에 찍는다. #72의 "Done when"을 그대로
  만족하고 금지 목록(timeout·blind replay·watcher·supervisor·hidden retry·transcript
  hydration·새 pi recovery API)을 건드리지 않는다. **launch seam 변경이므로 GLG 승인 필수**이고,
  자체 gate cell + 정확한 이유로 죽는 mutant를 함께 내야 값이 있다.
- (B) **"작업 종류" 축 측정.** GLG의 관측(2026-09-01): "이 노트북에서도 날 텐데 ACP Claude를
  적게 써서 안 보인 것 같다." 턴 수로는 성립하지 않는다 — 적게 쓴 쪽이 oracle이다(opus-5
  44턴 중 4건 vs thinkpad 340턴 중 0건). 그러나 **턴 수가 아니라 작업의 종류**(장시간·다중도구·
  컨테이너/docker 왕복이 많은 무거운 턴의 비율)라면 성립할 수 있고, **그 축은 아직 아무도 안
  셌다.** `acp-turn-population.py`가 이미 턴당 tool start와 child 나이를 뽑으므로 확장이 싸다.

**하지 말 것:** 커밋·푸시(GLG가 명시할 때만) · `entwurf-release prepare` 시작(#72 처분이
정해지기 전) · oracle의 벤더/오버레이 설정 임의 변경(재현 조건이 곧 증거다) · 폐기된 후보 4개
재측정(반례가 README에 있다) · 2026-07-30의 `prompt timed out after 600000ms` 실패를 이것과
같은 것으로 묶기(다른 실패이고 이미 은퇴했다).

**0.16.1:** 커밋 5개가 이미 랜딩돼 있다 — `4076498`(copilot 1.0.81 행 문법), `c3d5b2a`(setup이
OMP를 합성), `5c1bda5`(pi floor 0.84.4), `fe44477`(#72 핸드오프), 그리고 이 메시지의 커밋.
CHANGELOG `## Unreleased`에 setup/OMP·copilot 항목은 있고 **pi floor 항목과 #72 항목이 없다.**
버전 범프·섹션 승격은 `entwurf-release` **prepare** 몫이며 모드마다 GLG 승인이다.

**게이트 자세:** HEAD에서 `pnpm run check:full` exit 0, `./run.sh check-gate-qualification`
328/328 KILLED. 새 주장은 자기 gate cell과 mutant를 데려와야 한다. 산문은 진실이 아니다.

**형제 하나가 thinkpad에 살아 있다:** garden `20260901T062537-c3a343` (claude-code/opus,
`~/repos/gh/entwurf`). 위 아티팩트를 만든 당사자다. 필요하면 `entwurf_v2`로 부를 수 있지만,
역할 분담은 GLG가 정한다 — 네가 임의로 일을 넘기지 마라.

# #72 — ACP Claude child가 tool-loop 중간에 죽는다 (다음 세션의 실제 작업)

**이슈:** https://github.com/junghan0611/entwurf/issues/72 (open, `bug`/`field report`).
이슈 본문의 첫 수용 조건은 "수리 전에 서명을 회수하라"이고, **그 서명이 아래에 있다.**

**증거 등급:** 아래 인용문은 GLG의 Termux 스크린샷 3장에서 읽은 것이다(external artifact).
정본 경로 — `~/screenshot/Screenshot_20260831_205336_Termux.jpg`,
`~/screenshot/Screenshot_20260831_211334_Termux.jpg`,
`~/screenshot/Screenshot_20260831_212616_Termux.jpg`.
로그 파일이나 트랜스크립트에서 다시 읽은 것이 아니므로, 다음 세션의 첫 일은 **같은 서명을
호스트의 로그에서 재확인**하는 것이다(스크린샷은 화면이지 receipt가 아니다).

**한 세션에서 3회 (2026-08-31, oracle 호스트, `~/nixos-config`, model `claude-opus-5`):**
20:53 / 21:13 / 21:26. 매번 오류 문구가 바이트 단위로 같다:

```
Error: ACP connection closed
[acp] lifecycle: the ACP backend connection closed while the prompt was
still in flight — the child ended (exit code 0); this turn has no answer
--- backend stderr (tail) ---
[session/query] sessionId=<uuid> resume=none apiType=native baseUrl=native
(node:<pid>) [CLAUDE_SDK_CAN_USE_TOOL_SHADOWED] Warning: canUseTool will
not be invoked: permissionMode 'bypassPermissions' auto-approves every
tool call (except explicit deny rules) before the callback is consulted.
To gate every tool call, use a PreToolUse hook instead.
```

이 서명이 이슈 본문의 추측 몇 개를 이미 정리한다:

- **child는 exit code 0이다.** 크래시도 시그널도 아니고 정상 종료다. "긴 턴이 타임아웃"
  가설과 다르다 — 죽는 게 아니라 **끝난다**.
- **retained-reuse가 아니다.** 세 샘플의 `sessionId`가 전부 다르고(`a190b806-91a3-4d74-a760-668ae60d57f2`,
  `c798f097-9b28-432d-af2c-e9f73ef023ce`, `b40bce08-3556-42fa-b358-76b09212632f`) 전부 `resume=none`이다.
  이슈 본문은 "retained session의 4번째 reuse turn"을 적고 있는데, 이 세 샘플은 그 조건이 아니다.
  **같은 실패 모드인지 다른 것인지가 첫 갈림길이다.**
- **실패 지점이 일정하다.** 세 번 다 `[tool:start] Terminal` 직후, 답이 오기 전.
- **stderr tail의 유일한 신호가 `CLAUDE_SDK_CAN_USE_TOOL_SHADOWED`다.** 다른 오류 줄이 없다.

**GLG의 가설 (2026-09-01):** `~/.pi/agent/claude-config-overlay/settings.json:1-5`의

```json
{ "permissions": { "defaultMode": "bypassPermissions" } }
```

이 설정이 영향을 준다. ACP Claude는 오버레이 환경으로 가므로, **오버레이 경로와 일반
경로를 구분해서 안정성을 제공해야 한다.** 간단히 해결될 수도 있다.

**주의 — 이 가설은 아직 사실이 아니다.** 경고문이 stderr tail에 있다는 것은
`bypassPermissions`가 `canUseTool` 콜백을 무력화한다는 SDK의 안내일 뿐이고, 그 경고가
곧 child 종료의 원인이라는 연결은 아직 아무도 측정하지 않았다. 그 경고는 정상 동작하는
턴에도 찍힐 수 있다 — **경고가 찍힌 성공 턴이 존재하는지부터가 첫 측정이다.** 존재한다면
경고는 배경이고 원인은 다른 곳이다.

**이슈 본문이 미리 그은 수리 경계 (그대로 유효):** 절대 prompt timeout 금지, in-flight 턴
blind replay 금지(비멱등 tool 부작용), watcher/supervisor/hidden retry/transcript
hydration/새 pi recovery API 금지, closed-connection 폐기와 model immutability는
fail-loud 유지, 공통 ACP backend를 건드리면 live connection이 있을 때 Cortex 재측정.

**0.16.1:** #72 수리 + 이미 랜딩된 세 커밋(`4076498`, `c3d5b2a`, `5c1bda5`)을 묶어서 컷한다.
CHANGELOG `## Unreleased`에 setup/OMP·copilot 항목은 이미 있고, pi floor 항목과 #72 항목이
아직 없다. 버전 범프·섹션 승격은 `entwurf-release` **prepare** 몫이고 모드마다 GLG 승인이다.

# NOW

- **Stem:** OMP TUI 하나를 독립 형제로 세우되, 그 안의 서브에이전트에는 garden id를 주지 않는다.
- **이제 되는 것 (측정, 2026-08-30 oracle, omp 18.0.0):** OMP TUI가 열리면 citizen 하나를 mint하고, 상태줄에 garden id를 보이고, 자기 이름으로 보내고, **다른 harness의 메시지를 받는다.** idle 세션이 타이핑 0회로 깨어나 `entwurf_inbox_read`로 스스로 드레인하고 같은 native 세션에서 답한다. `/new`는 옛 시민의 doorbell을 회수하고 새 시민에게 arm한다. task subagent는 여전히 아무것도 mint·arm하지 않는다.
- **C에서 새로 되는 것:** `entwurf_fresh_call(backend=omp)`이 세 public surface 전부에서 열린다 — bare `omp` runtime, **positional prompt 없는 two-stage bootstrap**(고정 등록 플래그 `--entwurf-bootstrap`이 `{v,target,nonce,task}`를 나르고, 설치된 birth 확장이 callback tool이 실제로 부를 수 있게 된 뒤 callback-only 프롬프트를 보낸 다음 성공한 `tool_result`를 보고서야 다음 `turn_end`에 task를 넘긴다) + 명시적 `--approval-mode yolo`, callback tool `mcp__entwurf_bridge_entwurf_v`, 그리고 **5축** pre-mutation preflight(다섯째는 omp 고유의 `tools.xdev !== true`). launch seam에서 `PI_SESSION_ID`/`PI_AGENT_ID`를 scrub한다(모든 backend). positional은 선택이 아니라 측정 결과다 — `[LIVE 2026-08-30]` positional 후보는 도구가 존재하기 ~830ms 전에 턴을 시작해 `ACK`만 답했다.
- **아직 안 되는 것:** clause 7 LIVE는 green이지만 **한 번, 한 호스트, 한 모델**이다. multi-host·multi-model·반복 fresh는 증거가 없고, 그 한계는 CHANGELOG Notes에 그대로 적혀 있다. closure review·qualification·full floor는 닫혔다(`153f9f4`, `fd5e462`). 남은 미지는 릴리즈 축뿐이다 — 버전 트리 위의 `LIVE=1 ./run.sh release-gate <scratch> --cut` 집계와 릴리즈 커밋 정확 SHA의 CI 3잡(`check`·`install-surface`·`artifact-consumer`).
- **새 일반 규칙 (C가 만든 것):** 새 하네스는 branch에서 partial evidence가 가능하지만, release package는 step 9까지 닫혀야 한다. unsupported 표기는 partial-release 허가가 아니다. deterministic 반쪽은 `check-harness-admission-parity`(check:full), LIVE 반쪽은 첫 release의 clause 7 MUST step. Copilot의 기존 operator-metered exclusion은 소급 재설계하지 않는다.
- **운영자 필수 설정 — 이제 손으로 넣지 않는다:** `~/.omp/agent/config.yml`의 `tools: xdev: false`는 `entwurf setup`이 `omp-config` 유닛으로 쓴다. 기본값에서는 doorbell이 모델이 부를 수 없는 도구를 알리게 되고, LIVE 스모크가 이걸 선행 조건으로 검사한다. 운영자가 **명시적으로** `xdev: true`를 적어 뒀다면 그건 결정이지 drift가 아니므로 writer가 덮지 않고 이름을 불러 거부하고, setup은 그것을 component FAIL로 세운다.
- **`config.yml` 리더 결함 하나 (측정, 2026-08-31 thinkpad):** 벤더 자신의 settings writer가 쓰는 `modelRoles:` + 들여쓴 `{}` 형태를 `scripts/omp-tool-surface.py`가 파일 전체 `unreadable`로 읽어 `doctor-omp-mcp`가 `tools.xdev`와 무관한 이유로 RED였다. flow collection을 값 자리와 자식 블록 자리 양쪽에서 파싱하도록 고쳤다. TS 리더(`readOmpConfigFlag`)는 원래 정상이었으므로 fresh preflight는 영향이 없었다 — 두 리더의 **합치**만 보는 셀은 이 결함을 영원히 통과시킨다(둘 다 unreadable/true를 "not false"로 접기 때문). 그래서 `[QK:OMP-XDEV-VENDOR-SHAPE-READABLE]` 직접 단언을 넣었다.
- **Copilot 1.0.81 행 문법 (측정, 같은 호스트):** `copilot plugin list`가 `(v0.1.0) (enabled)` + 들여쓴 `from <path>`를 찍게 바뀌어 버전이 `0.1.0) (enabled`로 읽혔고, 멀쩡히 설치·enabled인 호스트에서 `setup`이 `copilot-birth: FAIL`을 냈다. 상태 토큰 하나만 정확히 허용하도록 문법을 넓혔다.
- **컷 게이트는 이제 실제 왕복을 요구한다:** `smoke-omp-receive-live`가 registry를 읽고 `self-fetch`를 보면 더 이상 SKIP하지 않는다 — `LIVE=1`에서 실제 tmux omp TUI를 띄우고 11개 단언을 요구한다. 하드코딩된 통과가 아니다.
- **Next:** (1) `entwurf-release prepare 0.16.0` — CHANGELOG 승격·버전·lockfile·`check:full`·LIVE `--cut`까지, 모드별 GLG 승인 하에 (교통 매트릭스 육안 수용의 영수증은 2026-08-31 cross-harness 왕복으로 DELIVERY OMP 행에 남았다), (2) **cross-harness leg의 deterministic 반쪽 배선** — post-contract 시민 backend마다 cross-harness LIVE step이 wired거나 선언된 metered 예외인지 `check-harness-admission-parity` 옆에 검사 (규칙은 `docs/adding-a-harness.md` release stop에 2026-08-31로 박혀 있고, 게이트가 없는 동안은 prose다 — 별도 grant), (3) land 방식·cut 결정 — GLG 몫. 배경: 옛 v1 상호호출 matrix는 d7783d4에서 gate를 떠나 fbcbdbc에서 삭제됐고 v2 follow-up이 하네스-쌍 축으로 돌아오지 않았다(GLM 조사, 2026-08-31 #87 스레드 예정).
- **Read:** #87 thread · `scripts/raw-omp-measure/README.md` §M7 (수용의 근거가 된 5셀 측정) · `docs/setup-clean-host.md` §4b · `docs/adding-a-harness.md` step 7.
- **Do not touch:** `mux-launch.ts`/`mux-placement.ts`(import fence) · omp용 managed launcher shell(근거 없음) · registry `supported` 필드(새 authority 금지) · #72/#76/#78 · #87/#89 close. (Pi 0.84.4는 2026-09-01에 해제되어 랜딩됐다 — `5c1bda5`.)

# RECENT

- **2026-08-31 (릴리즈 준비):** closure review 잔여가 닫히고(`153f9f4`) 첫 standalone qualification이 Bundle C 바이트 위에서 manifest 부채 네 갈래를 측정으로 정산했다(`fd5e462` — 324/324 KILLED, `check:full` exit 0 430s). cross-harness leg는 규칙과 첫 영수증을 함께 얻었고(`07349bd`, claude-code ↔ omp 양방향 live turn), 다섯 backend 비교표가 admission 문서 머리에 섰다(`7828bbc`). 업스트림 0.84.4 공개로 `check-pack-install`의 lockfile 없는 임시 설치가 pi-telemetry를 띄워 CI가 붉어졌고 transitive 핀으로 닫았다(`19ad90c`). CHANGELOG `## Unreleased`는 구현 범위 `v0.15.1..19ad90c` 30커밋 전수로 채워졌고, 릴리즈-정합 산문 정리가 뒤따랐다.
- **2026-08-30 (Bundle C candidate):** visible fresh가 붙었고, 그와 함께 **GLG가 찾은 release 구멍이 exit code가 되었다.** 원인은 닫힌 parity loop 두 개 사이에 간선이 없었던 것 — registry↔citizens와 surfaces↔fresh set을 각각 지키는 게이트는 있었지만 두 상수를 함께 import하는 파일이 0개였고, 그래서 omp는 D6 시민이면서 fresh 불가인 채로 모든 게이트를 green으로 통과했다. `check-harness-admission-parity`가 그 간선이다(추가 직후 `Unaccounted: omp`로 실제 RED, C 완성 뒤 green). agreement 게이트(`check-omp-fresh-preflight`)는 첫 실행에서 내 config reader의 fail-OPEN 오독(`tools.nested.xdev`를 `tools.xdev`로 읽음)을 잡았다. tmux env 누수도 실측 — server env의 `PI_SESSION_ID`가 새 pane에 그대로 상속되어(`SID=[leaked-uuid]`) 형제의 bridge child가 남의 신원으로 집에 전화할 수 있었고, launch seam에서 scrub한다. B의 packaging 누락 1건도 함께 고쳤다(`pi/omp-receive/entwurf-receive-omp/package.json`이 `files[]`에 없어 installed package에서 `install-omp-receive`가 죽었다).
- **2026-08-30:** Bundle B candidate. GLM 독립 검수 결과 architecture blocker 0 / Defect 3, 그 amendment까지 반영했다 — 가장 무거운 것은 `onEdge`의 `cancelRetry()`가 ctx 없이 불려 **핸들만 버리고 벤더 타이머는 계속 돌던** 결함이다(겹치는 birth edge마다 고아 타이머 하나). 인자를 필수로 바꾸고 겹침 셀과 exact-once mutant로 고정했다. D5 5셀 LIVE probe가 벤더 wake 표면을 처음으로 실측했다 — `pi.sendUserMessage`는 factory에 있고(ctx 아님), idle에서 턴을 시작하며(+31ms), `ctx.setInterval`은 idle에서 돌고 취소는 `ctx.clearTimer`뿐이다(`clearInterval` 없음 → `?.` 호출은 조용한 no-op). 확장 핸들러 순서가 디렉터리명 collation을 따르고, birth보다 먼저 도는 유닛은 sender marker를 못 본다는 것도 실측(20ms). D3 격리는 살아있는 omp 시민 2개로 증명 — Copilot 행이 아직 PENDING으로 두고 있는 셀이다.
- **2026-08-28 (오후):** oracle에서 Bundle A를 실제로 설치·배포·수용. stale writer 두 축(omp 확장, Claude shared reader)을 doctor가 잡아 재배포. LIVE outbound 4건, subagent zero-mint, inbound fail-closed 모두 재현. OMP `tools.xdev` 기본값이 MCP 도구를 `xd://`로 감싸 거짓 발신 보고를 만든다는 것을 벤더 바이너리·트랜스크립트로 측정하고 3개 문서에 반영.
- **2026-08-28 (오전):** #87 Bundle A source, package and doctor hardening reviewed independently; qualification and final deterministic floor were green on the final candidate.
- **2026-08-27:** OMP vendor measurement and real TUI/subagent observations closed the Bundle A admission basis.

# CARRIED

- **#78** macOS/native-Windows portability — separate grant; do not mix into #87.
- **#72 #76** bugs and cortex gate slice — separate lanes.

# LEDGER — land 전에 정할 것

- **B에서 닫힌 것:** L1(두 state smoke가 `check:hermetic`에 편입, 이제 receive 짝까지 셋), L3(doctor가 `tools.xdev`를 읽고 LIVE 스모크도 선행 검사), L4(`entwurf_self`의 mailbox 렌더가 이제 참이다 — 드레인하는 프로세스가 실제로 있다).
- **B가 일부러 닫지 않은 것 (정직하게 기록):** event loop wedge 셀. marker는 "살아있는 소유자가 arm을 시도했다"까지만 뜻하며 watch 등록 ack이 아니다 — Claude 레일이 `meta-bridge-hook.ts:279-280`에서 같은 문장으로 이미 인정한 잔여 위험이고, OMP는 새로 만드는 게 아니라 물려받는다. 닫으려면 marker heartbeat + 리더 쪽 max-age가 필요하고 그건 claude·copilot 레일을 동시에 움직이므로 별도 이슈감이다.
- **런타임 extension reload/disable 셀은 미측정**이다. doctor 노트로만 남아 있다.

- **L2 CHANGELOG — 닫힘:** `## Unreleased`가 구현 범위 `v0.15.1..19ad90c` 30커밋 전수로 채워졌다(그중 `ec311a2`·`c3894be`·`7e45057`·`1143177` 4개는 v0.15.1 이후 이미 origin/main에 있던 것). 그 위에 쌓이는 릴리즈 준비 커밋은 이 30에 포함되지 않으므로, 범위를 다시 셀 때는 `v0.15.1..HEAD`가 아니라 이 끝점을 쓴다. 섹션 승격·버전 범프·release-gate 수치는 prepare 몫이고, Verification의 release-gate 줄은 일부러 빈 슬롯으로 남겼다. 이 리포의 릴리즈 도구는 CalVer `tag-release`가 아니라 SemVer `.claude/skills/entwurf-release`의 4모드다.
- **L5 claude 시민의 model 필드 — 답 나옴, 고치는 일만 남음 (#90 CLOSED):** 설치된 Claude Code **2.1.245**에서 우리 훅 stdin을 캡처한 결과, interactive `SessionStart` 봉투는 `model`을 **문자열**로 보낸다(`claude-opus-5[1m]`). print 모드(`claude -p`)는 아예 안 보낸다. 우리 리더(`meta-bridge-hook.ts:184-191`)가 객체 `.id`/`model_id`만 받아 그 문자열을 버리므로 claude-code 레코드는 0/353이다. 남은 일: 리더를 문자열 수용으로 넓히고 birth-hook fixture로 고정하되 **print 모드의 부재도 같이 고정**한다. 벤더 버전이 오르면 캡처를 다시 떠야 답이 유지된다. 별도 grant.
- **L8 OMP child가 bridge 권한을 물려받는다 (측정, GLG 세션 2026-08-28):** OMP task child의 `entwurf_self`는 **부모의 garden id**를 반환한다(두 번째 주소 없음 — §3.5 요구사항 충족, 게이트가 증명하는 그대로). 그러나 그 빌린 신원으로 `entwurf_v2`와 `entwurf_fresh_call`을 호출할 수 있다. §3.5(b)가 도구 차용을 의도적으로 허용하므로 깨진 불변식은 아니다. **열린 질문은 C에서 닫혔다 — 판정이 아니라 원칙으로:** `docs/adding-a-harness.md` §3.5의 principal doctrine이 visible host citizen을 가든 principal로 두고, 내부 위임과 그 책임을 그 시민·벤더 소유로 명시하며, Entwurf가 내부 ACL·subagent provenance·시민 아래 authority 축을 만들지 않는다고 못박았다. 빌린 신원의 dispatch는 principal이 자기가 고른 delegate를 통해 보낸 것이다. 따라서 아래 울타리 측정은 참고 자료로만 남는다. 값싼 울타리 후보 측정: omp 18.0.0에 subagent의 MCP 접근을 막는 `mcp.*` 키는 없으나 `task.enableLsp`(기본 false)가 **subagent별 개별 도구 차단 기제가 존재함**을 증명한다. 자체 tool set을 든 custom agent 정의는 미검증 단서.
- **L6 벤더 드리프트:** 이 호스트는 아직 **omp 18.0.0**이다(2026-08-30 측정: `omp --version`). 벤더는 **18.0.11**을 알린다(TUI 배너). `mode === "tui"` 판별자, `xd://` 동작, 그리고 이제 §M7의 다섯 셀(호출 자리·idle wake·`clearTimer`·핸들러 순서)이 업그레이드 시 재측정 대상이다.
- **L7 ROADMAP:** "현재" 절이 아직 측정 단계로 적혀 있다.

# DURABLE LINKS

- #87: https://github.com/junghan0611/entwurf/issues/87
- #90 (claude-code model 필드, CLOSED — 측정 완료, 리더 수정만 남음): https://github.com/junghan0611/entwurf/issues/90
- Admission path: `docs/adding-a-harness.md`
- OMP operator boundary: `docs/setup-clean-host.md` §4b
- OMP tool-surface dialect: `docs/external-mcp-host.md` OMP row
