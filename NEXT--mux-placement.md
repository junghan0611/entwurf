# NEXT — mux C2 제품 완료; public-harness lifecycle acceptance가 다음이다

> `mux-placement` branch boot sector. Product base is `e568980`; docs-only checkpoints `acb295f` and `e02fcd2` sit above it. C2 is the product completion point.

# RAIL — 현재 좌표

- [x] **1. placement + visible launch leaf** — T0-b/T1-a landed
- [x] **2. B/C/C2 raw baseline** — Pi·Claude Code initial turn + callback correlation measured
- [x] **3. owner/contract decision** — fixed `{backend, task}` surface; callback sender envelope is identity receipt
- [x] **4. implementation + focused gates** — product, two public surfaces, QK 6/mutants 6
- [x] **5. independent review + LIVE** — amendment bundle closed; isolated two-backend LIVE 18 checks green
- [x] **6. accept commit candidate** — qualification 165/165 + frozen `pnpm check` green; `88d7faa`
- [ ] **7. public-harness lifecycle acceptance** ← CURRENT: fresh spawn → callback id → `entwurf_v2` send → Pi dormant → same-id resume를 release MUST로 결박
- [ ] **8. v2-native recorded demo retake** ← PAUSED: 7의 같은 scene/evidence를 사람이 볼 수 있는 tmux/asciinema 연출로 얇게 감싼다
- [ ] **9. branch landing** ← PAUSED: acceptance + demo retake까지 선 뒤 explicit push/merge 결정

현재 좌표: C2 제품·직접 LIVE 완료 → release lifecycle 증명 → 같은 장면의 데모 영상 재생성 → branch landing

# NOW

- **Current:** 제품 composition LIVE는 green이지만, 현재 smoke는 `freshCall()`을 source에서 직접 호출한다. public Pi/MCP tool을 통해 시작해서 callback 뒤 send/resume까지 잇는 release lifecycle은 아직 미증명이다.
- **Next:** 아래 acceptance chain을 **release-gate MUST**로 만든다. 비용이 들어도 real configured runtimes/model turns를 쓴다. 그 gate가 진 같은 scene을 `demo/` recording wrapper가 재사용해야 mux lane이 끝난다.
- **Blocker:** 없음. GLG가 release aggregate 포함을 결정했다.
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
- **미증명:** caller가 public Pi/MCP `entwurf_fresh_call` 표면을 실제 호출하는 축; callback 뒤 같은 fresh citizen에 `entwurf_v2` live send; 그 fresh Pi를 launch handle로 종료해 dormant를 확인하고 동일 gardenId로 `owned-outcome` resume하는 연속성.
- 현재 `VERIFY.md`는 `smoke-mux-fresh-call-live`를 on-demand로 release aggregate에서 제외한다. 다음 lane은 이 상태를 끝내고 integrated lifecycle gate를 MUST에 배선한다.

## EXACT NEXT — release lifecycle gate

1. **public ingress:** 최소 MCP `tools/call entwurf_fresh_call`을 real bridge + trusted caller envelope + private tmux anchor로 통과시킨다. Native Pi 등록은 기존 deterministic surface QK와 대조하고, 모델 선택 행동을 MUST oracle로 삼지 않는다.
2. **fresh Pi:** launch receipt → nonce callback sender gardenId → 그 id에 `entwurf_v2 fire-and-forget` live send → stable launch handle로 window close → socket gone/dormant 적극 증명 → 같은 id에 `owned-outcome` → spawn-bg resume와 resumed turn 증명.
3. **fresh Claude Code:** launch receipt → callback sender gardenId → 그 id에 `entwurf_v2 fire-and-forget` mailbox delivery/read 증명. Claude에는 owned resume authority가 없으므로 resume를 가장하지 않는다.
4. **receipts 분리:** launch / callback identity / live send / resume receipt를 각각 기록한다. 어느 앞 단계도 뒤 단계 성공으로 읽지 않는다.
5. **release wiring:** prerequisite 없음은 exit 97 SKIP, `release-gate --cut`에서는 red. 비용·native transcript 보존을 VERIFY에 명시하고 `check-release-gate-outcomes`가 aggregate inclusion을 강제한다.
6. **isolation:** backend별 private tmux server, fixture record/receiver/sender/mailbox/lock/control roots, pane pid bounded teardown, real store/socket GID residue 0. 검증 harness의 bounded wait는 허용하지만 product에 watcher/supervisor를 넣지 않는다.

## COMPLETION — release scene와 demo retake가 같은 장면이다

현재 `demo/demo.sh`와 `demo/demo-baseline.sh`는 retired v1 `entwurf`/`entwurf_resume`/`entwurf_send`를 쓰는 archived evidence다. mux lane의 끝은 gate만 green인 상태가 아니라, 아래 v2 scene을 release acceptance와 영상에서 다시 재생할 수 있는 상태다.

1. **Scene 1 — fresh spawn:** public `entwurf_fresh_call`로 fixed Pi를 같은 tmux session에 열고, callback sender envelope에서 exact gardenId를 얻는다. initial task는 기록 가능한 짧은 fact(`tempered indigo`)를 기억시킨다.
2. **Scene 2 — live message:** 그 gardenId에 `entwurf_v2 fire-and-forget` 메시지를 보내 실제 sibling window에서 수신/응답을 보인다.
3. **Scene 3 — same-id resume:** launch handle로 Pi window를 닫고 dormant/socket-gone을 증명한 뒤 같은 gardenId에 `owned-outcome`; resumed turn이 Scene 1 fact를 회수한다.
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
