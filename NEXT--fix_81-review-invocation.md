# #81 review amendment handoff

> Branch-only boot sector. Delete this file before merging; promote the durable result through the normal main-line handoff.

# RAIL — 현재 좌표

- [x] **1. Three #81 false-green causes reproduced** — non-bare Pi override, agy configured invocation, pre-initialize tools/list.
- [x] **2. Amendment + focused proof** — exact command/args/env, sequential MCP handshake, ownership/runtime separation; focused gates green.
- [x] **3. Frozen-candidate qualification and full floor** — 183/183 mutants killed; `pnpm run check:full` green (211s).
- [ ] **4. GLG review/commit decision** ← CURRENT: inspect the uncommitted amendment; commit only on explicit approval.

현재 좌표: 3 완료 → 4 승인 대기

# NOW

- Next: GLG review the uncommitted amendment; commit/push only on explicit request.
- Verify: focused gates green; qualification 183/183; frozen pre-handoff `pnpm run check:full` green in 211s.
- Blocker: 없음.
- Read: `scripts/probe-bridge-command.ts`, `scripts/doctor-pi-provider.ts`, `scripts/agy-bridge.sh`, `docs/acp-backend-rail.md` “Bridge reachability”.
- Do not touch: new launcher architecture, delivery behavior, commit/push, CHANGELOG/ROADMAP.

# RECENT

- 2026-08-19: #81 amendment probes every Pi effective stdio entry and every agy configured `{command,args,env}`; a probe requires initialize response before tools/list. The child pipe's asynchronous EPIPE is folded into its process-close verdict, preserving launcher stderr. Focused gates passed; qualification 183/183 and frozen full floor passed (211s).
