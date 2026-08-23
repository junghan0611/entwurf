# NEXT — #82 Copilot garden citizen (branch lane)

> Disposable boot sector for `issue-82-copilot-citizen`. The issue thread is the
> durable chronology; delete this file before merge after promoting the last facts.

# RAIL — 현재 좌표

- [x] **1. Citizen birth + visible identity** — record, hook, doctor, statusline; real Copilot birth accepted
- [x] **2. MCP hand** — owned/reversible user MCP config; native `entwurf_*` invocation accepted
- [x] **3. Outbound sender identity** — own garden id + `origin:meta-session`; `replyable:false`; pushed CI green
- [ ] **4. Evidence/docs checkpoint** ← CURRENT: commit the extension LIVE receipt, raw reproducer, and repaired standing docs; no product route in this commit
- [ ] **5. Inbound receive admission** ← NEXT AFTER COMMIT: a fresh Opus implements only after GLG's direct grant; transport is proved, lifecycle/liveness/dispatch remain

현재 좌표: 1–3 완료 → **4 증거를 먼저 고정** → 5 새 구현 팀. Hidden `--ui-server`는 여전히 다시 열지 않는다 — bundled extension이 대체한 것이지 부활한 것이 아니다.

# NOW

- **Current.** `[측정]` branch HEAD `a647292` is pushed and matches
  `origin/issue-82-copilot-citizen`; exact-SHA CI
  [32451415907](https://github.com/junghan0611/entwurf/actions/runs/32451415907) is green.
  The worktree now holds only the uncommitted 2026-08-23 extension transport evidence/docs
  checkpoint; no product receiver, dispatch, registry, installer, or gate changed.
- **Next.** Freeze the evidence/docs checkpoint: the two raw probe files, travelling LIVE
  receipt, `DELIVERY.md`, `docs/adding-a-harness.md`, and `docs/external-mcp-host.md`. Review
  claims for evidence state, run only syntax/doc-focused checks, and commit without push.
- **After that commit.** Form a fresh Opus implementation lane. Its first design move is the
  record-backed receiver lifecycle: garden id ↔ native session id join, installed-extension
  provenance, pid + start-key liveness, stale/crash refusal, and feature-flag ownership before
  any `replyable:true` or dispatch success. Admission updates the five coordinated claims together:
  `DELIVERY.md`, `docs/adding-a-harness.md`, `docs/external-mcp-host.md`, raw README, and this NEXT.
  When receiver state lands, replace the birth gate's `HAS-NO-RECEIVER-STATE` claim and the
  Claude-doctor oracle's scoped "no doorbell" comment in the same qualified gate amendment.
- **Blocker.** None for transport. Admission still owes lifecycle/liveness/dispatch evidence;
  the raw `ready.json` is discovery only and may remain stale after a crash.
- **Verify.** Focused gates first; independent review before one frozen full floor. Do not run
  `check-gate-qualification` locally unless a later gate change explicitly schedules it.
- **Do not touch in the evidence commit.** Product registry, receiver marker, dispatch route,
  installer/doctor, `FRESH_CALL_BACKENDS`, hidden `--ui-server`, ACP, release/tag, or push.

# RECENT

## RAIL 5 transport — 2026-08-23, 벽이 치워졌다

- `[측정]` Copilot CLI 1.0.80 IDLE 세션이 **타이핑 0회**로 깨어났다. 외부 파일 쓰기
  → extension의 `fs.watch` → `session.send({mode:"enqueue"})`. poke→`user.message`
  2.7초, poke→정확한 marker 응답 6.5초. 영수증은
  `scripts/raw-async-delivery/README.md`의 "Measured — 2026-08-23" 블록에 붙여 넣었다.
- `[측정→영수증 미보존]` 두 번째 무장 세션 B가 A로 두 번 배달하는 동안 움직이지
  않았다고 관측됐지만, B의 결정적 로그와 A의 두 번째 turn 줄은 scratch cleanup 전에
  옮겨지지 않았다. D3 격리는 admission LIVE rerun 항목이며 이 checkpoint의 durable PASS가 아니다.
- `[코드]` `--ui-server`의 **network authentication blocker는 이 transport에 없다.**
  extension은 CLI가 직접 fork하고 자식의 stdio로 JSON-RPC를 말하므로 포트·리스너가 없다.
  Product admission은 대신 installed-extension provenance와 parent/child lifecycle을 인증해야 한다.
- `[번들]` SDK는 CLI 패키지 안에 이미 들어 있고(`<platform-pkg>/copilot-sdk/`)
  `preloads/extension_bootstrap.mjs`가 자식에 주입한다. npm 별도 설치가 필요 없고
  SDK/CLI 버전 드리프트가 원천적으로 없다. `fs.watch` → `session.send()` 패턴은
  번들된 `copilot-sdk/docs/examples.md`가 스스로 문서화한 것이다.
- `[측정]` launch contract는 `COPILOT_CLI_ENABLED_FEATURE_FLAGS=EXTENSIONS` 하나.
  `--experimental`는 **불필요**(env만으로 무장 확인). 플래그가 없으면 CLI는 스캔조차
  하지 않고 **아무 오류 없이** 조용하다 — 무장 실패를 디버깅할 때 여기부터 본다.
- `[코드]` discovery scope는 user / plugin / session / project(대화형 한정). `plugin`
  스코프가 있으므로 RAIL 2에서 이미 설치된 entwurf Copilot 플러그인이 receiver의
  배송 수단이 될 수 있다 — 리포마다 `.github/extensions/`를 둘 필요가 없다.
- `[미검증]` active-turn 배달, 한 CLI 프로세스 안 background 세션, `/clear` 재무장,
  실험 플래그의 내구성, 권한 소유권/크래시/순서. 이것들은 admission의 남은 질문이다.
- `[산출물]` `scripts/raw-async-delivery/copilot-extension-receive/extension.mjs`,
  `scripts/raw-async-delivery/copilot-enqueue-addressed.sh`, README 정정. 커밋하지
  않았다.

## RAIL 5b — closed

- `[측정]` LIVE Copilot CLI 1.0.80 send arrived under its own garden id with
  `agentId:meta-session/copilot`, `origin:meta-session`, and `replyable:false`.
- `[측정]` Production join closed end to end: sender marker owner = running Copilot native pid =
  entwurf MCP child's parent; marker and V3 record agreed on backend/garden/native session id.
- `[측정]` `doctor-copilot-bridge` passed after deployment: 8 Copilot records, 0 Copilot errors,
  3 sender markers armed.
- `[측정]` implementation `88d0641`; companion inventory repair `a647292`; push and agenda stamp
  completed. CI initially caught `copilot-birth` expected count 10 vs actual 12, then the one-line
  repair passed the full exact-SHA CI.
- `[코드]` Sender identity does not create receiver capability. A Copilot model sentence claiming
  that a reply may later appear in its inbox was false: no reply enqueue/doorbell rail is admitted.

## RAIL 6 audit — deferred

- `[번들]` Copilot CLI 1.0.80 artifact contains no `asyncRewake` or `watchPaths`; `FileChanged`
  hits are workspace-event vocabulary, not a proved plugin doorbell.
- `[번들]` `agentStop` is a turn-end event that may enqueue a model follow-up; it cannot start a
  new turn in an already-idle session. Remote reply arrival also races the one stop event.
- `[미검증]` Declarative plugin acceptance of `agentStop` was not run. Independent Opus/GLM/Terra
  review agreed that a green result would not open replyability or D4, so the one-turn probe was
  deferred.
- `[미검증/history]` Hidden `--ui-server session.send({mode:"enqueue"})` once reported idle enqueue
  and auto-reply, but that unauthenticated/help-hidden surface was withdrawn and is not the native
  plugin citizen rail. Do not revive it without new evidence and explicit GLG approval.

# DURABLE LINKS

- #82 LIVE sender checkpoint: https://github.com/junghan0611/entwurf/issues/82#issuecomment-5365420577
- #82 local landing checkpoint: https://github.com/junghan0611/entwurf/issues/82#issuecomment-5365476249
- #82 pushed CI-green checkpoint: https://github.com/junghan0611/entwurf/issues/82#issuecomment-5365828064
- New-harness sequence: `docs/adding-a-harness.md`
