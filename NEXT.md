# NEXT — OMP as one garden sibling (실무 잠수함)

> NEXT는 disposable boot sector다. 완료 이력은 issue/git이 지고, 방향은 ROADMAP,
> 운영 규율은 AGENTS가 진다. 새 하네스 입학 경로는
> [docs/adding-a-harness.md](./docs/adding-a-harness.md)다.

# RAIL — 현재 좌표

- [x] **1. OMP measurement·audit·LIVE + Bundle A admission hardening** — backend registration, TUI-only birth, visible status, native MCP hand, sender identity, four-root/package/doctor hardening 완료.
- [x] **2. Operator deploy + real outbound acceptance** — 2026-08-28 oracle: 재설치·shared reader 재배포·doctor 4종 green, `check:full` exit 0, outbound LIVE 4건(그중 1건은 GLG가 직접 연 세션). `tools.xdev` 방언 발견과 문서화 포함.
- [x] **3. Bundle B: addressed receive / roundtrip** — **대칭이 생겼다.** receiver 확장, bounded arm defer, `/new`·watch-error·vanished-signal·overlapping-edge fail-closed, install/uninstall/doctor, `check-omp-receive-arm` + `scripts/mutants/omp-receive.json`(11 mutants, 전부 정확한 이유로 kill), `smoke-omp-receive-state`, `smoke-omp-receive-live`. registry `self-fetch`/`D6`, DELIVERY 행 신설. 단언 개수는 게이트가 세는 것이지 증거가 아니므로 여기 박지 않는다 — 영수증은 `raw-omp-measure/README.md` §M7 이다.
- [x] **4. Bundle A+B land** — `a809ee7 feat(omp): receive addressed native messages` (26 paths). 체크포인트 commit; push·cut 없음.
- [ ] **5. Bundle C: visible fresh + admission release-stop** ← CURRENT: 구현이 한 candidate로 동결되고 independent review까지 끝났다(2026-08-30, architecture blocker 0 / **Defect 3** / observation 1). `entwurf_fresh_call`이 네 번째 backend로 omp를 연다. clause 7 LIVE(`smoke-omp-fresh-live`, release-gate MUST)는 **green** — 2026-08-30, 21 assertions, omp 18.0.0 / `openai-codex/gpt-5.6-sol`, callback sender garden `20260830T192913-df52b9`. 영수증 정본은 DELIVERY.md의 OMP 행이고, 그 근거로 DELIVERY/README의 라벨은 이미 이동해 있다. **한 호스트·한 모델·한 번의 수용이다** — multi-host도, multi-model도, 한 프로세스 안의 반복 fresh도 주장하지 않는다. review amendment 한 번들(Defect 1–3)은 2026-08-31에 반영되어 이 커밋에 포함됐다 — same-id `session_switch` epoch 무효화, creator 소유 `ctx.setTimeout`/`ctx.clearTimer` readiness 타이머(취소 불가 빌드는 arm 거부), 산문 정렬, 뮤턴트 21→23.

현재 좌표: 1–4 완료 → **5 구현 + review + amendment 반영 + clause 7 LIVE green** → closure review(b) → qualification·full floor → land·cut 결정.

# NOW

- **Stem:** OMP TUI 하나를 독립 형제로 세우되, 그 안의 서브에이전트에는 garden id를 주지 않는다.
- **이제 되는 것 (측정, 2026-08-30 oracle, omp 18.0.0):** OMP TUI가 열리면 citizen 하나를 mint하고, 상태줄에 garden id를 보이고, 자기 이름으로 보내고, **다른 harness의 메시지를 받는다.** idle 세션이 타이핑 0회로 깨어나 `entwurf_inbox_read`로 스스로 드레인하고 같은 native 세션에서 답한다. `/new`는 옛 시민의 doorbell을 회수하고 새 시민에게 arm한다. task subagent는 여전히 아무것도 mint·arm하지 않는다.
- **C에서 새로 되는 것:** `entwurf_fresh_call(backend=omp)`이 세 public surface 전부에서 열린다 — bare `omp` runtime, **positional prompt 없는 two-stage bootstrap**(고정 등록 플래그 `--entwurf-bootstrap`이 `{v,target,nonce,task}`를 나르고, 설치된 birth 확장이 callback tool이 실제로 부를 수 있게 된 뒤 callback-only 프롬프트를 보낸 다음 성공한 `tool_result`를 보고서야 다음 `turn_end`에 task를 넘긴다) + 명시적 `--approval-mode yolo`, callback tool `mcp__entwurf_bridge_entwurf_v`, 그리고 **5축** pre-mutation preflight(다섯째는 omp 고유의 `tools.xdev !== true`). launch seam에서 `PI_SESSION_ID`/`PI_AGENT_ID`를 scrub한다(모든 backend). positional은 선택이 아니라 측정 결과다 — `[LIVE 2026-08-30]` positional 후보는 도구가 존재하기 ~830ms 전에 턴을 시작해 `ACK`만 답했다.
- **아직 안 되는 것:** clause 7 LIVE는 green이지만 **한 번, 한 호스트, 한 모델**이다. multi-host·multi-model·반복 fresh는 증거가 없다. amendment는 반영됐고 영향받은 focused 게이트는 green이지만, closure review와 qualification·full floor는 아직이다.
- **새 일반 규칙 (C가 만든 것):** 새 하네스는 branch에서 partial evidence가 가능하지만, release package는 step 9까지 닫혀야 한다. unsupported 표기는 partial-release 허가가 아니다. deterministic 반쪽은 `check-harness-admission-parity`(check:full), LIVE 반쪽은 첫 release의 clause 7 MUST step. Copilot의 기존 operator-metered exclusion은 소급 재설계하지 않는다.
- **운영자 필수 설정 (변함없음):** `~/.omp/agent/config.yml`에 `tools: xdev: false`. 기본값에서는 doorbell이 모델이 부를 수 없는 도구를 알리게 된다. LIVE 스모크가 이걸 선행 조건으로 검사한다.
- **컷 게이트는 이제 실제 왕복을 요구한다:** `smoke-omp-receive-live`가 registry를 읽고 `self-fetch`를 보면 더 이상 SKIP하지 않는다 — `LIVE=1`에서 실제 tmux omp TUI를 띄우고 11개 단언을 요구한다. 하드코딩된 통과가 아니다.
- **Next:** (1) GLG 최종 인터뷰 — 교통 매트릭스 육안 수용 (창 @222의 live omp 시민이 재료), (2) **cross-harness leg의 deterministic 반쪽 배선** — post-contract 시민 backend마다 cross-harness LIVE step이 wired거나 선언된 metered 예외인지 `check-harness-admission-parity` 옆에 검사 (규칙은 `docs/adding-a-harness.md` release stop에 2026-08-31로 박혀 있고, 게이트가 없는 동안은 prose다 — 별도 grant), (3) land 방식·cut 결정 — GLG 몫. 배경: 옛 v1 상호호출 matrix는 d7783d4에서 gate를 떠나 fbcbdbc에서 삭제됐고 v2 follow-up이 하네스-쌍 축으로 돌아오지 않았다(GLM 조사, 2026-08-31 #87 스레드 예정).
- **Read:** #87 thread · `scripts/raw-omp-measure/README.md` §M7 (수용의 근거가 된 5셀 측정) · `docs/setup-clean-host.md` §4b · `docs/adding-a-harness.md` step 7.
- **Do not touch:** `mux-launch.ts`/`mux-placement.ts`(import fence) · omp용 managed launcher shell(근거 없음) · registry `supported` 필드(새 authority 금지) · #72/#76/#78 · Pi 0.84.4 · #87/#89 close.

# RECENT

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

- **L2 CHANGELOG:** `## Unreleased`가 비어 있고 v0.15.1 이후 커밋이 쌓여 있다. cut을 하면 `tag-release`가 채운다.
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
