# NEXT — mux fresh-call C2 accepted; branch landing만 남았다

> `mux-placement` branch boot sector. Product base is `e568980`; docs-only checkpoints `acb295f` and `e02fcd2` sit above it. C2 is the product completion point.

# RAIL — 현재 좌표

- [x] **1. placement + visible launch leaf** — T0-b/T1-a landed
- [x] **2. B/C/C2 raw baseline** — Pi·Claude Code initial turn + callback correlation measured
- [x] **3. owner/contract decision** — fixed `{backend, task}` surface; callback sender envelope is identity receipt
- [x] **4. implementation + focused gates** — product, two public surfaces, QK 6/mutants 6
- [x] **5. independent review + LIVE** — amendment bundle closed; isolated two-backend LIVE 18 checks green
- [x] **6. accept commit candidate** — qualification 165/165 + frozen `pnpm check` green; GLG commit 승인
- [ ] **7. branch landing** ← CURRENT: accepted candidate commit 뒤 explicit push/merge 결정 대기

현재 좌표: C2 구현·LIVE·qualification·full floor 완료 → commit 승인 → push/merge는 별도 결정

# NOW

- **Current:** `entwurf_fresh_call`의 accepted candidate를 이 branch에 commit한다.
- **Next:** commit 뒤 멈추고 GLG의 explicit push/merge 결정을 기다린다. branch NEXT는 merge 전에 삭제한다.
- **Blocker:** 없음.
- **Do not touch:** 명시 없는 push/release; `entwurf_v2`; token/store lookup; watcher/retry/supervisor; arbitrary command/model/provider/cwd/env carrier; issue #63.

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

## 검증 좌표

- Focused: typecheck 3 configs; bridge build; fresh-call 38; launch 23; placement 23; affected bridge/peers/identity gates green.
- Qualification: **165/165 mutants KILLED**; fresh-call QK 6 / exact-once mutants 6 전부 포함.
- Frozen full floor: **`pnpm check` exit 0**.
- LIVE: real configured Pi + Claude Code, backend별 private tmux server, fixture meta/sender/receiver/mailbox/lock/control axes; two distinct callback sender garden ids; real store/socket residue 없음 — 18 checks green.
- LIVE first attempt exposed an over-isolation defect (Claude entered onboarding); final smoke uses fixture HOME for Pi and canonical operator HOME for Claude while preserving native transcripts as runtime evidence.

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
