# NEXT — mux C2 제품 완료; public-harness lifecycle acceptance가 다음이다

> `mux-placement` branch boot sector. Product base is `e568980`; docs-only checkpoints `acb295f` and `e02fcd2` sit above it. C2 is the product completion point.

# RAIL — 현재 좌표

- [x] **1. placement + visible launch leaf** — T0-b/T1-a landed
- [x] **2. B/C/C2 raw baseline** — Pi·Claude Code initial turn + callback correlation measured
- [x] **3. owner/contract decision** — fixed `{backend, task}` surface; callback sender envelope is identity receipt
- [x] **4. implementation + focused gates** — product, two public surfaces, QK 6/mutants 6
- [x] **5. independent review + LIVE** — amendment bundle closed; isolated two-backend LIVE 18 checks green
- [x] **6. accept commit candidate** — qualification 165/165 + frozen `pnpm check` green; `88d7faa`
- [~] **7. public-harness lifecycle acceptance** ← HALTED 2026-08-06: 마지막 row(`owned-outcome` → spawn-bg resume)가 **hidden** child를 띄운다는 이유로 coordinator가 중단시켰다. visible-first가 정책이다.
- [x] **7-S0. visible-first hard cut** ← `owned-outcome` intent와 `spawn-bg` transport를 타입계에서 제거(회수이지 reject 뒤 은폐가 아니다). record-authoritative identity leaf만 `resume-launch-identity.ts`로 보존하고 gate를 붙였다.
- [ ] **8. visible same-id resume (S1)** ← NEXT LANE: 별도 verb(`entwurf_resume_call` 잠정), mux placement 위의 좁은 composition. `entwurf_v2`로 다시 라우팅하지 않는다. 설계는 `.agent-reports/20260806T112600-visible-resume-design-impact.md` R2. **S1/lifecycle acceptance는 scrubbed parent-transcript artifact를 남겨야 한다 — EXACT NEXT §7.**
- [ ] **9. v2-native recorded demo retake** ← PAUSED
- [ ] **10. branch landing** ← PAUSED. landing handoff는 §7 artifact의 **경로와 digest**를 반드시 싣는다(downstream `entwurf-peek`가 그것을 기다린다).

현재 좌표: C2 제품·직접 LIVE 완료 → hidden resume 회수(S0) → visible resume(S1) → 데모 재생성 → branch landing

# NOW

- **Current:** S0(visible-first hard cut)가 소스·gate·mutant·docs까지 닫혔고 coordinator review 대기다. dormant citizen은 지금 어떤 verb로도 닿지 않으며 그것이 의도된 fail-closed 상태다.
- **Next:** review 통과 후 qualification 1회 + 동결 candidate에서 `pnpm check` 1회 → commit. 그 다음이 S1 visible resume이다.
- **Blocker:** 없음. lifecycle acceptance chain은 S1이 착지하기 전까지 release MUST로 배선하지 않는다 — hidden resume을 release 성공으로 굳히지 않는다는 것이 중단 사유였다.
- **Do not touch:** 명시 없는 push/release; `entwurf_v2` 계약 변경; token/store lookup; product watcher/retry/supervisor; arbitrary command/model/provider/cwd/env carrier; issue #63.

## 제품 계약

```text
caller surface supplies canonical caller gardenId
  → entwurf_fresh_call { backend: pi|claude-code, task }
  → fixed backend argv opens a visible same-session window
  → sibling first action: existing entwurf_v2 nonce callback
  → callback sender envelope carries exact fresh gardenId
  → sibling continues initial task
```

- Pi identity: resident record closure only.
- MCP identity: canonical authoritative self envelope (inherited Pi carrier or trusted meta-sender marker).
- Task is trimmed non-empty, max 16,000 chars; argv is same-user visible, so no secrets.
- Synchronous receipt: tmux coordinates + backend/runtime + nonce only.
- Asynchronous correlation receipt: callback sender envelope. No polling or delivery-success claim.
- Existing citizen delivery/resume remains `entwurf_v2`; token+lookup alternative is CLOSED.

## 현재 증거와 남은 gap

- Focused: typecheck 3 configs; bridge build; fresh-call 38; launch 23; placement 23; affected bridge/peers/identity gates green.
- Qualification: **165/165 mutants KILLED**; fresh-call QK 6 / exact-once mutants 6 전부 포함.
- Frozen full floor: **`pnpm check` exit 0**.
- Direct-composition LIVE: real configured Pi + Claude Code, backend별 private tmux server, fixture meta/sender/receiver/mailbox/lock/control axes; two distinct callback sender garden ids; real store/socket residue 없음 — 18 checks green.
- **미증명:** caller가 public Pi/MCP `entwurf_fresh_call` 표면을 실제 호출하는 축; callback 뒤 같은 fresh citizen에 `entwurf_v2` live send; 그 fresh Pi를 launch handle로 종료해 dormant를 확인하는 연속성. (동일 gardenId resume은 S1의 몫으로 이월됐다.)
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

# 읽을 곳

1. `pi-extensions/lib/mux-fresh-call.ts`
2. `scripts/check-mux-fresh-call.ts` + `scripts/mutants/mux-fresh-call.json`
3. `scripts/smoke-mux-fresh-call-live.ts`
4. `docs/mux-launch-rail.md` §6-a/§6-b/§11/§12
5. `.agent-reports/20260805T143009-mux-bc-baseline.md` (local raw evidence)
