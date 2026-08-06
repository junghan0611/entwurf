# NEXT — visible-first S0 완료; operator tour 뒤 visible same-id resume가 다음이다

> `mux-placement` branch boot sector. Fresh-call product는 `88d7faa`, runtime-hermetic gate 수선은 `d4b7f97`, hidden resume withdrawal(S0)은 `6f8dd76`에 있다.

# RAIL — 현재 좌표

- [x] **1. placement + visible launch leaf** — T0-b/T1-a landed
- [x] **2. B/C/C2 raw baseline** — Pi·Claude Code initial turn + callback correlation measured
- [x] **3. owner/contract decision** — `{backend, model, task}` surface; caller가 고른 model을 runtime별 실측 CLI 방언으로 운반하고 callback sender envelope는 identity receipt다.
- [x] **4. implementation + focused gates** — product, two public surfaces, QK 6/mutants 6
- [x] **5. independent review + LIVE** — amendment bundle closed; isolated two-backend LIVE 18 checks green
- [x] **6. accept commit candidate** — qualification 165/165 + frozen `pnpm check` green; `88d7faa`
- [~] **7. public-harness lifecycle acceptance** ← HALTED 2026-08-06: 마지막 row(`owned-outcome` → spawn-bg resume)가 **hidden** child를 띄운다는 이유로 coordinator가 중단시켰다. visible-first가 정책이다.
- [x] **7-S0. visible-first hard cut** ← `owned-outcome` intent와 `spawn-bg` transport를 타입계에서 제거(회수이지 reject 뒤 은폐가 아니다). record-authoritative identity leaf만 `resume-launch-identity.ts`로 보존하고 gate를 붙였다. `6f8dd76`; qualification 171/171 + frozen `pnpm check` 92/92 green.
- [x] **7-M. explicit fresh model carrier** ← operator tour가 ambient defaults(Pi `gpt-5.5`, Claude Code Opus 5)를 연 gap을 잡았다. required `{backend, model, task}`와 Pi `--model <value>` / Claude Code `--model=<value>` 방언을 배선했고, exact Pi equals-form mutant까지 176/176 KILL 및 real two-backend LIVE 18/18로 닫았다.
- [x] **7-M-fix. fresh-call model pattern이 host schema validator를 통과한다** ← 7-M의 zod `.regex()`가 문자 클래스 안 `[`를 escape하지 않아 emitted JSON Schema pattern이 Rust regex 계열(호스트 tool schema validator)에서 `unclosed character class`로 거부됐다. 증상은 `400 tools.5.custom.input_schema` — 이 툴을 로드하는 모든 Claude 세션이 열리지 않는다. JS `RegExp`는 `u` 플래그에서도 통과시키므로 QK/mutant/LIVE 어느 축도 관측하지 못했다. TypeBox 면(`entwurf-control.ts`)은 처음부터 escape되어 있어 Pi native만 살아 있었다. 세 파일(`mcp/entwurf-bridge/src/index.ts`, `pi-extensions/lib/mux-fresh-call.ts`, `scripts/mutants/mux-fresh-call.json`)을 정렬했고 JS 판정 의미론은 동치다.
- [x] **7-L. operator tour** ← 새 runtime에서 3장면 관측 완료(2026-08-06 17:13~17:16). Claude Code `claude-sonnet-5`와 Pi `entwurf/claude-sonnet-5`가 각각 launch→callback(nonce 정확 일치)→delivery→reply 4축을 채웠고, 창을 닫자 **rail별로 서로 다른 정직한 거절**이 나왔다: Pi는 `dormant-fire-forget-unsupported (liveness: dead)`, Claude Code는 `mailbox-undeliverable (liveness: unsupported)`. model carrier 증거는 Pi가 더 강하다 — callback envelope의 agentId가 `entwurf/claude-sonnet-5`다(자기보고가 아니라 envelope 사실). 반대로 Pi 형제는 자신이 받은 rail을 self-fetch mailbox라고 **잘못** 자기보고했다(receipt는 `control-socket → sent`) — message body가 untrusted data라는 계약의 실증이다.
- [ ] **7-C. commit → main merge** ← CURRENT: 문서 편집이 모두 끝난 최종 candidate에서 `check-gate-qualification`을 **한 번** 돌리고, 통과하면 12파일을 커밋해 main에 머지한다.
- [ ] **8. visible same-id resume (S1)** ← landing 직후 착수. **오늘 실증으로 설계 입력이 확정됐다**: operator가 `pi --session <path>`만으로 열면 transcript는 복원되지만 **citizen은 서지 않는다** — control socket이 없어 record가 계속 `dead`이고 주소가 없다. 소켓을 여는 것은 `--entwurf-control`이며, 정확한 argv는 이미 `buildResumePiArgs`(`--entwurf-control [ext args] --session <file> [--provider] --model <m> <prompt>`)에, 대상 해석은 `resolveResumeLaunchIdentity`(record → sessionFile + cwd + provider + model)에 있다. **즉 없는 것은 argv 지식이 아니라 그 둘을 묶어 호출하는 verb다.** record가 model을 보존하므로(`entwurf/claude-sonnet-5`) 기본 model 보존은 구현 가능하며, 명시 override와의 경계는 S1에서 결정한다. `entwurf_v2`로 다시 라우팅하지 않는다. 설계는 `.agent-reports/20260806T112600-visible-resume-design-impact.md` R2. **S1/lifecycle acceptance는 scrubbed parent-transcript artifact를 남겨야 한다 — EXACT NEXT §7.**
  - **금지:** 에이전트가 raw tmux로 resume을 손으로 짜맞추는 것. 오늘 한 번 해봤고 `--entwurf-control` 누락으로 주소 없는 세션이 열렸다. 이 동작은 제품 루틴에 새겨져야 하며 operator 노가다로 대체하지 않는다.
- [ ] **9. v2-native recorded demo retake** ← PAUSED
- [ ] **10. test framework lane** ← **issue #61** (https://github.com/junghan0611/entwurf/issues/61). main merge 후 그 이슈를 보고 **별도 브랜치**를 만들어 진행한다. 이 브랜치에서 착수 금지 — capability lane에 meta-infra를 태우지 않는다. 요약은 아래 §테스트 체계 관측.

현재 좌표: C2 제품·직접 LIVE 완료 → hidden resume 회수(S0) → model carrier(7-M) + schema fix → operator tour 완료 → **commit/merge** → S1(resume verb) → 데모 재생성

> **mux는 아직 닫히지 않았다.** tour가 fresh→send→close→dormant까지는 증명했지만, dormant citizen을 다시 세우는 축은 제품에 verb가 없어 오늘 operator가 손으로 흉내내야 했다. 그 노가다가 곧 미완성의 증거다 — S1이 이 lane의 마지막 조각이다.

# NOW

- **Current:** 7-M(required model carrier) + 7-M-fix(host schema validator를 통과하는 pattern)가 워킹트리에 있고 **미커밋**이다(12파일). `pnpm check` **exit 0**(92 게이트) 확인했고, public MCP 표면으로 두 backend operator tour까지 실제 관측했다. `.claude/skills/entwurf-dev/SKILL.md`가 GLG의 tool 호출과 기본 model policy를 맡고, product는 선택된 값만 운반한다.
- **Next:** (1) `check-gate-qualification`을 **한 번** 실행 — 문서 편집이 모두 끝난 최종 candidate 기준이어야 한다. 실행 중 워킹트리를 건드리면 work-surface hash 불일치로 IMPURE 처리된다(2026-08-06에 한 번 밟았다). → (2) 12파일 commit → (3) main merge → (4) 브랜치 NEXT 삭제 후 issue #61로 새 브랜치.
- **Blocker:** 없음.
- **Read:** `.claude/skills/entwurf-dev/SKILL.md` (runtime guard와 receipt 언어), 아래 §테스트 체계 관측, issue #61.
- **Do not touch:** 명시 없는 push/release; `entwurf_v2` 계약 변경; token/store lookup; product watcher/retry/supervisor; arbitrary command/cwd/env carrier 또는 model 외 별도 provider knob; issue #63. **이 브랜치에서 vitest 도입/게이트 제거 착수 금지** — RAIL 10 = issue #61.
- **런타임 주의:** bridge/extension은 `--experimental-strip-types`로 시작 시점 소스를 메모리에 들고 있다. 소스를 고쳐도 살아있는 프로세스는 옛 스키마를 방출하므로, schema를 만졌다면 **재시작 전 tool schema를 로드하지 않는다** — 그 세션이 400으로 죽는다. 재시작 뒤 프로세스 시작시각과 소스 mtime을 대조해 확인한다.

## 제품 계약

```text
caller surface supplies canonical caller gardenId
  → entwurf_fresh_call { backend: pi|claude-code, model, task }
  → fixed backend runtime + explicit model CLI argv opens a visible same-session window
  → sibling first action: existing entwurf_v2 nonce callback
  → callback sender envelope carries exact fresh gardenId
  → sibling continues initial task
```

- Pi identity: resident record closure only.
- MCP identity: canonical authoritative self envelope (inherited Pi carrier or trusted meta-sender marker).
- Model is required, max 200 chars and argv-safe: Pi takes canonical `provider/model` as `--model`, value; Claude Code takes model id/alias as `--model=value`. Both bypass ambient defaults using the measured runtime dialect.
- Task is trimmed non-empty, max 16,000 chars; model/task argv is same-user visible, so no secrets.
- Synchronous receipt: tmux coordinates + backend/runtime + requested model + nonce only.
- Asynchronous correlation receipt: callback sender envelope. No polling or delivery-success claim.
- Existing citizen delivery remains `entwurf_v2`; shipped resume verb는 없고 token+lookup alternative는 CLOSED다.

## 현재 증거와 남은 gap

- Focused: fresh-call **46/46** + typecheck 3 configs green. Model 전달 claim과 Pi two-token dialect claim을 분리했다.
- Qualification: model-carrier candidate에서 **176/176 mutants KILLED across 13 lanes**; exact Pi equals-form regression이 `FRESHCALL-PI-MODEL-DIALECT`에서 KILL되고 실행 전후 work-surface hash가 동일하다. **단, 이 측정은 7-M-fix 이전 candidate 기준이며 landing 전에 한 번 다시 돌려야 한다.**
- Frozen full floor: `pnpm check`, **exit 0** — 7-M-fix 적용 후 재확인(2026-08-06 17:04, 92 게이트).
- **관측된 커버리지 공백:** host tool-schema 수용성. 176 mutant와 92 게이트 어느 것도 emitted JSON Schema가 호스트 validator를 통과하는지 보지 않는다. `V2SURF-DESC-FITS-HOST-CAP`이 같은 축에서 길이만 잰다. 7-M-fix가 그 공백으로 들어왔다. 계약 신설은 RAIL 10의 몫이며 이 브랜치에서 하지 않는다.
- Direct-composition LIVE: real configured Pi + Claude Code, backend별 private tmux server, fixture meta/sender/receiver/mailbox/lock/control axes; requested models로 두 distinct callback sender garden ids 수신; real store/socket residue 없음 — **18/18** green.
- Public-surface lifecycle (2026-08-06 17:13~17:16, **직접 관측**): 실제 MCP `entwurf_fresh_call` 호출 → nonce 정확 일치 callback → 같은 citizen에 `entwurf_v2` live send(Claude Code `meta-mailbox → enqueued`, Pi `control-socket → sent`) → 양쪽 reply 수신 → 창 종료 → `entwurf_peers`에서 dormant 확인 → rail별로 다른 정직한 거절. 이전 "미증명" 세 축이 여기서 닫혔다.
- **미증명:** dormant citizen을 같은 gardenId로 다시 세우는 축. verb가 없어 operator가 raw tmux로 흉내내야 했고, `--entwurf-control` 없이 열면 transcript만 복원되고 주소는 살아나지 않는다(오늘 실측). **S1의 몫이며 mux lane은 그 전까지 닫히지 않는다.**
- 현재 `VERIFY.md`는 `smoke-mux-fresh-call-live`를 on-demand로 release aggregate에서 제외한다. 다음 lane은 이 상태를 끝내고 integrated lifecycle gate를 MUST에 배선한다.

## EXACT NEXT — release lifecycle gate

1. **public ingress:** 최소 MCP `tools/call entwurf_fresh_call`을 real bridge + trusted caller envelope + private tmux anchor로 통과시킨다. Native Pi 등록은 기존 deterministic surface QK와 대조하고, 모델 선택 행동을 MUST oracle로 삼지 않는다.
2. **fresh Pi:** launch receipt → nonce callback sender gardenId → 그 id에 `entwurf_v2 fire-and-forget` live send → stable launch handle로 window close → socket gone/dormant 적극 증명 → 그 상태에서 dispatch가 `dormant-fire-forget-unsupported`로 정직하게 거절함을 증명. same-id resume은 S1이 착지한 뒤 그 verb로 증명한다.
3. **fresh Claude Code:** launch receipt → callback sender gardenId → 그 id에 `entwurf_v2 fire-and-forget` mailbox delivery/read 증명. 어느 rail에도 resume authority는 없다.
4. **receipts 분리:** launch / callback identity / live send / resume receipt를 각각 기록한다. 어느 앞 단계도 뒤 단계 성공으로 읽지 않는다.
5. **release wiring:** prerequisite 없음은 exit 97 SKIP, `release-gate --cut`에서는 red. 비용·native transcript 보존을 VERIFY에 명시하고 `check-release-gate-outcomes`가 aggregate inclusion을 강제한다.
6. **isolation:** backend별 private tmux server, fixture record/receiver/sender/mailbox/lock/control roots, pane pid bounded teardown, real store/socket GID residue 0. 검증 harness의 bounded wait는 허용하지만 product에 watcher/supervisor를 넣지 않는다.
7. **scrubbed parent-transcript artifact (다운스트림 계약, coordinator `20260806T101528-cae60f` 2026-08-06).** acceptance는 부모 transcript의 **실제 모양**을 산출물로 남겨야 한다 — `entwurf_fresh_call` nonce와 그 뒤 callback의 `sender_info` envelope을 둘 다 담은 **scrub된 fixture/artifact** 하나. landing handoff에 **정확한 경로와 digest**를 적는다.
   - **금지:** 개인 live transcript를 그 자리에 쓰지 않는다. 그 artifact를 placement 증거로 읽지 않는다 — 그것은 부모 쪽 모양의 표본이지 window가 열렸다는 증명이 아니다(placement 증거는 계속 handle/receipt 축이다).
   - **왜 지금 적어두나:** agent-config의 `entwurf-peek` 수선이 이 모양에 의존하고, `mux-placement` landing까지 **대기**한다. acceptance를 짜는 사람이 이 요구를 모르면 산출물 없이 green이 나고, 그때 downstream은 사적 transcript를 뒤지는 것 말고 방법이 없어진다.

## COMPLETION — release scene와 demo retake가 같은 장면이다

현재 `demo/demo.sh`와 `demo/demo-baseline.sh`는 retired v1 `entwurf`/`entwurf_resume`/`entwurf_send`를 쓰는 archived evidence다. mux lane의 끝은 gate만 green인 상태가 아니라, 아래 v2 scene을 release acceptance와 영상에서 다시 재생할 수 있는 상태다.

1. **Scene 1 — fresh spawn:** public `entwurf_fresh_call`로 fixed Pi를 같은 tmux session에 열고, callback sender envelope에서 exact gardenId를 얻는다. initial task는 기록 가능한 짧은 fact(`tempered indigo`)를 기억시킨다.
2. **Scene 2 — live message:** 그 gardenId에 `entwurf_v2 fire-and-forget` 메시지를 보내 실제 sibling window에서 수신/응답을 보인다.
3. **Scene 3 — same-id resume:** launch handle로 Pi window를 닫고 dormant/socket-gone을 증명한 뒤, S1의 visible resume verb로 같은 gardenId를 **보이는 창**에 되살린다; resumed turn이 Scene 1 fact를 회수한다. S1 이전에는 이 scene을 찍지 않는다 — 지금 그 자리에 있는 것은 정직한 거절이다.
4. **Scene 4 — cross-backend fresh:** public fresh-call로 Claude Code도 열어 callback gardenId와 mailbox send/read를 보인다. Claude owned-resume는 만들지 않는다.

구현 규칙:

- release gate의 PASS oracle은 sender envelope, delivery/resume receipt, record/socket/transcript evidence다. pane text나 `send-keys`는 증거가 아니다.
- `demo/`는 같은 scene의 **presentation wrapper**다: tmux window 전환, scene caption, asciinema/agg/GIF 변환만 소유한다. 별도 transport나 두 번째 테스트 로직을 만들지 않는다.
- recording 도구가 없어도 release MUST는 돈다. `asciinema`/`agg`/`gifsicle`은 영상 재생성 전제이지 제품 acceptance 전제가 아니다.
- 결과물은 archived pre-0.12 GIF를 v2-native take로 교체하고 `demo/README.md`/README의 archived 문구를 현재 계약으로 바꾼다.
- gate와 demo가 같은 fixed messages/nonces/scene names를 쓰되, gate의 machine oracle을 화면 scraping으로 바꾸지 않는다.

# RECENT

- **2026-08-05:** callback correlation replaced and CLOSED the pre-injected-token/store-lookup design. No new identity lookup or delivery transport was added.
- **2026-08-05:** review repaired consumer-zero QK wording, default `pnpm check` wiring, MCP fail-loud identity handling, dual-surface description parity, stale SSOT, and LIVE isolation.
- **2026-08-05:** final LIVE launched both backends, received both nonce callbacks, proved distinct sender-envelope garden ids, tore down pane processes/private servers, and left no fixture root or real record/socket residue.

# 테스트 체계 관측 — RAIL 10 입력

7-M-fix를 추적하다 나온 관측이다. **이 브랜치에서 실행하지 않는다.** 작업 단위는 **issue #61**(https://github.com/junghan0611/entwurf/issues/61)이고 main merge 후 그 이슈로 브랜치를 만든다. 로컬 측정 원본은 `.agent-reports/20260806T170500-test-strategy-observation.md`.

- 176 mutant의 게이트 실행시간 합은 **6.4분**인데 `mux-fresh-call` lane 기여분은 **0.9초(0.2%)**다. 상위 3 lane이 82%를 차지하고, subject가 테스트 인프라인 mutant가 **51%**다.
- 게이트 전수에서 **57개(18.5K줄)는 이미 제품을 import해 실행한다.** "테스트가 0개"는 부정확한 표현이었다 — 없는 것은 프레임워크지 계약 테스트가 아니다. 다만 분모가 glob에 따라 흔들리므로 Phase 0의 재현 가능한 inventory가 선행 조건이다.
- 대조군: pi-mono 352 테스트 / prime-agent 414 테스트, 둘 다 vitest. entwurf `scripts/`는 그 7–10배 라인인데 러너가 없다.
- 방향은 vitest 표준 구성. **일괄 철거는 NO-GO**이며 vitest 도입과 mutation 감산은 서로 다른 결정이다. 텍스트 검사도 3분류(런타임 관측 가능 / 구조 계약 / 설치·패키지 계약)로 나눠 처분하며, `smoke-*-install-state`는 LIVE가 아니므로 landing-only로 밀지 않는다.

# 읽을 곳

1. `pi-extensions/lib/mux-fresh-call.ts`
2. `scripts/check-mux-fresh-call.ts` + `scripts/mutants/mux-fresh-call.json`
3. `scripts/smoke-mux-fresh-call-live.ts`
4. `docs/mux-launch-rail.md` §6-a/§6-b/§11/§12
5. `.agent-reports/20260805T143009-mux-bc-baseline.md` (local raw evidence)
