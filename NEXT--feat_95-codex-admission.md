# NEXT — #95 Codex native sibling admission

Branch-only handoff for `feat/95-codex-admission`. Delete this file before any merge to main.

# RAIL — 현재 좌표

- [x] **1. Native candidate wiring** — USER birth/trust, strict identity, native-push, visible fresh.
- [x] **2. A: same-session deployment** — `6e28c9e` real `Pi → Codex → Pi`, 50/50 green.
- [x] **3. B source decision** — official Codex 0.153.4와 fetched main에 attached-TUI origin carrier 없음.
- [ ] **4. Vendor response** ← CURRENT: `openai/codex#44774` 응답 또는 2026-09-25까지 대기.
- [ ] **5. Admission/release** ← PAUSED: B가 실제 vendor surface에서 green일 때만 qualification/full 재개.

현재 좌표: candidate 완성 → A green → B vendor-blocked → upstream issue 대기 → release 보류

# NOW — issue first, PR은 최소 2주 뒤

- **Current:** branch `feat/95-codex-admission`; candidate product/docs are frozen through `eef8ec4`, with this handoff above them. Main merge는 계획하지 않는다.
- **Next:** `openai/codex#44774`의 maintainer 응답을 기다린다. 2026-09-25 전에는 PR을 제안·작성하지 않는다.
- **Decision gate:** 공식 TUI가 자기 process의 opt-in metadata를 `turn/start`와 `turn/steer`에 실을 지원 표면을 제공하는가?
- **If accepted upstream:** exact released vendor version에서 metadata→MCP/hook receipt를 먼저 측정한 뒤 B 설계와 qualification 일정을 다시 연다.
- **If declined/no response after 2026-09-25:** GLG가 PR 여부를 새로 결정한다. 자동으로 patch lane을 시작하지 않는다.
- **Blocker:** Entwurf가 아니라 official Codex TUI의 request-origin/seat carrier 부재.
- **Read:** [Entwurf #95 A/B outcome](https://github.com/junghan0611/entwurf/issues/95#issuecomment-5631236971), [upstream wait boundary](https://github.com/junghan0611/entwurf/issues/95#issuecomment-5631784361), [openai/codex#44774](https://github.com/openai/codex/issues/44774), `DELIVERY.md`, `docs/mux-launch-rail.md`.
- **Do not:** main merge, qualification/full/release, two-TUI symptom LIVE, app-server lifecycle 변경, hidden proxy/manager, pane/process guessing, manual placement나 one-app-server-per-seat를 B라고 재명명, 2026-09-25 전 PR.

# RECENT — durable receipts

## A green

- Product SHA: `6e28c9e`.
- Receipt: `.probe-artifacts/a95-live-20260911T162152-6e28c9e.log`.
- SHA-256: `e159f8fd1cf23cb1abd7782dc9e24cf9604add6b61ae24b7fd5260f16dfc2795`; 50 assertions, exit 0.
- Chain: Pi `20260911T162155-0db222` → Codex `20260911T162210-a974fe` → Pi `20260911T162238-7dcdaa`.
- All resolved to tmux `$158`; exact smoke windows were removed; records/transcripts and operator app-server were preserved.
- This proves same-session A only, never unrestricted attached-TUI parity.

## B decision

- Pinned vendor: `rust-v0.153.4` / `3d2ee51ca2d5db578f328aa75e20aa22c0197c9a`.
- Fetched main read: `02a8f038b87ad34d4a1dc5058eda26972ed7aa6c`; checkout remained pinned.
- No official no-patch request→attached-TUI join survives source audit.
- Existing `responsesapi_client_metadata` already reaches MCP `_meta` and hooks, but official TUI hard-codes `None` for TurnStart/TurnSteer.
- Minimal vendor request: opt-in environment-name allowlist, default empty, populated by the official TUI from its own process.
- Upstream issue: `openai/codex#44774`; Entwurf backlink: issue #95 comment `5631784361`.
- GLG rule: issue first; avoid a patch if possible; wait at least through 2026-09-25 before considering a PR.

## Candidate commits

- `6e28c9e` — trusted sender envelope over shared native-push.
- `2112bc3` — B as harness-admission stop.
- `87c1f2c` — exact A evidence.
- `eef8ec4` — B blocker across operator/release/mux documentation.

# PRESERVE

- Operator-owned app-server PID `155166`, UDS `/home/junghan/.codex/app-server-control/app-server-control.sock`, tmux `$158/@351/%351` were alive after A. Entwurf does not start, stop, restart, or supervise them.
- Vendor trust remains GLG's visible consent; never compute, pre-seed, or bypass `trusted_hash`.
- Branch push is archival/review visibility only. It is not admission, release approval, or permission to merge main.
