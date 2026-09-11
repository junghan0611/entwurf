# AGENTS.md — Maintainer Guidelines for entwurf

For agents who own this repository: durable invariants and the documents that own the changing evidence. This is the **entwurf capability package**: garden-citizen dispatch substrate, native-harness bridges, ACP plugin, and pi adapter. Entwurf is the subject; pi is one adapter. ACP is a plugin, not the boundary. V2 addresses existing citizens; `entwurf_fresh_call` creates a new sibling.

## North Star — One Forged Screwdriver

`entwurf`는 두 번째 하네스나 오케스트레이터가 아니라, 맡은 접점에서만 강한 드라이버다.

- Entwurf is primary; pi is not a privileged identity layer. Harness sessions are peers that retain their own transcript, auth, and runtime.
- Capability/rail asymmetry is not a rank. Dispatch reads the record, live rail facts, and caller intent; it never reconstructs prompts, hydrates transcripts, scans ambient MCP, or invents a tool claim.
- A spawned or resumed session is a runtime-isolated sibling, never a disposable worker.
- 전송 방식은 달라도, 형제로서 부르고 불리는 기본 UX는 대칭이어야 한다.
- Evidence disciplines claims: source, gates, and the owning document must support an assertion.

Ask: does this follow capability rather than a surface name; record backend asymmetry without denying siblinghood; preserve one narrow driver rather than grow a harness; and make the next observable evidence rather than reopen settled direction?

## Architecture

- **entwurf-core (v2):** garden-id addressing, record facts, rail liveness, dispatch decisions, and delivery evidence.
- **Record authority:** every citizen uses V3 `MetaIdentity`; `backend` selects rail capability, never identity rank.
- **pi adapter:** attaches its native session to a record, hosts the record-keyed control socket, and exposes pi’s native tools.
- **Native bridges:** register existing sessions without owning transcript or auth. Claude Code and Copilot are self-fetch; Antigravity and Codex are native-push. Codex remains native rather than ACP so its vendor tools, delegation, and work context remain intact. Admission/evidence details belong in [DELIVERY.md](./DELIVERY.md) and [VERIFY.md](./VERIFY.md).
- **ACP plugin:** one `entwurf` provider under an isolated overlay. The host pi session is already a record-backed citizen; ACP creates neither a second citizen nor a socket layer.
- **mux:** launch-only placement and fixed-runtime launch. It never imports into delivery. Fresh identity arrives only through its callback envelope, never a lookup; same-id visible resume keeps identity/liveness/locking on the v2 side of the injected seam. Fresh call accepts only the narrow model, literal absolute cwd, and existing caller-server seat inputs; it creates no session and does not infer seat from cwd. Do not turn either fresh call or resume into a generic driver, command/env carrier, or second creation API. Exact module/argv/import ownership: [docs/mux-launch-rail.md](./docs/mux-launch-rail.md).
- **Delivery:** `entwurf_v2` addresses an existing garden id through a live control socket, deliverable self-fetch mailbox, or probe-alive native push. It never starts a process. Fresh creation and visible same-id resume are separate lifecycle verbs.

## Hard Rules

1. **One surface name, hard cut.** Runtime/provider/routing identity is `entwurf`; no permanent alias, legacy reader, or hidden dual route.
2. **Record is the sole address authority.** Socket, env, marker, filename, model, and transcript are carriers or evidence, never a competing address axis. `PI_SESSION_ID` only carries record-established identity. If record birth fails, no socket starts and no `PI_SESSION_ID` is exported.
3. **One identity contract, capability domains.** Branch on rail/liveness capability, not a privileged citizen class.
4. **Live-fact dispatch.** Never store liveness or infer send/resume before resolving the record and probing its rail.
5. **Rejects are real.** Wrong intent, dead/drifted identity, undeliverable mailbox, ambiguity, and indeterminate probe reject without mutation or fallback.
6. **MCP is explicit.** Only explicit `mcpServers`; no ambient configuration scan or automatic retrieval.
7. **One meta-store contract.** Record body and filename agree; active records are readable regular non-symlink V3 files; `nativeSessionId` is unique. Writers and doctor certify the active store before writing. Address-bearing reads use the addressable reader; `readStoreRecordFile`/`O_NOFOLLOW` and lstat policy both remain load-bearing. Quiesce and fresh-cut an unreadable generation; redeploy a stale unknown-backend reader. Store protocol and gates: `meta-session.ts`, `check-meta-*`, `check-fresh-cut-gate`.
8. **GC reclaims processes, not memory.** Preserve or archive records and transcripts; do not casually delete them.
9. **Not a second harness.** No prompt reconstruction, transcript hydration, tool-result ledger, credential mediation, or harness emulation. Backends own auth and transcript.
10. **Native-push is distinct.** It is neither mailbox nor pi socket. Native-push citizens are record-backed plus probe-alive, with no receiver/watch state or resume authority. Antigravity retries only after bounded re-probe; Codex never replays queue acceptance. Codex sender identity is request-scoped metadata; app-server environment carries root/placement, never citizen identity.
11. **Package proof models a consumer.** Installed operator entrypoints reach compiled JS; `run_ts` is the sole TS crossing. Keep checkout, tarball, and consumer proofs distinct.
12. **Offline verification never rewires the operator.** Sandbox HOME, `PI_CODING_AGENT_DIR`, and writable XDG roots. Only named LIVE gates may touch the host, and must say so.
13. **Doctors report runtime and ownership independently.** Working runtime does not prove ownership; broken ownership does not erase runtime observation. Required failure on either axis is red.
14. **Native-hook ownership is structural.** Use shipped exec launchers and provenance, shared plausible-owner-pid policy, no shell fallback or ancestry guess. Version floors belong to their package source and are enforced there; hook contract/docs own the changing detail.
15. **Crash, don’t warn.** Invalid config/path/model/store state throws. Empty catches are only bounded environment probes; diagnostics go to stderr.
16. **mux launches, never delivers.** A tmux handle is an ephemeral view, not an address or liveness receipt; screen text/keystrokes are not delivery evidence. Codex caller placement means the app-server’s actual tmux seat, never an attached TUI pane; cross-window adjacency requires the documented observed-coordinate proof, not pane guessing.
17. **Entwurf installs itself; setup composes.** Installation supplies Entwurf bytes and development fixtures, never a harness binary, subscription, credential, or login. Setup detects existing harness capability; absence is explicit skip and detected incompleteness is non-green. Portability evidence and rail/runtime support remain separate.

History and incident detail belong in [CHANGELOG.md](./CHANGELOG.md), issue threads, [BASELINE.md](./BASELINE.md), or source-adjacent comments. When prose and behavior disagree, repair the owning source or document.

## ACP Boundary

| Layer | Owns |
|---|---|
| **entwurf-core** | identity/facts, dispatch table, rail choice, delivery evidence |
| **ACP plugin** | isolated backend lifecycle, tool narrowing, backend dialect, turn evidence |
| **ACP does not own** | citizen registration, socket registry, peer protocol, memory/planner, transcript, or auth |

- One provider; resolve its adapter once per turn. Backend settings remain opaque behind the adapter.
- Common sequence is spawn → initialize → newSession → model enforcement → prompt → event map. Callable schema is tool truth; prose grants no tool.
- Rich context rides the first user-message augment, not a large system prompt. Carrier/backend differences stay inside the adapter.
- Start streaming assistant messages as pending; explicitly map every terminal reason. Refusal, exhausted budget, unknown, or absent reason is an error and preserves the raw reason.
- Bootstrap has bounded wall-clock steps; a running prompt has no elapsed-time success/failure inference. Cancel through ACP first, then bounded cleanup. A failure we author must not invite blind whole-prompt replay.
- Entwurf never provides, copies, proxies, decrypts, or bypasses vendor credentials/subscriptions.
- Adapter/overlay contracts and backend-specific evidence: [docs/acp-backend-rail.md](./docs/acp-backend-rail.md).

## Citizen Identity and Dispatch

A pi control session and native bridge session are citizens for the same reason: each has a V3 record.

- Pi owns its native session lifecycle; `birthPiCitizen` attaches `(backend: "pi", nativeSessionId)` to the stable garden id. Socket and env values are record-derived carriers.
- `entwurf_resume_call {target}` is a separate pi-only lifecycle verb, not delivery intent. It reopens the same dormant id visibly, runs no turn, and receives transcript/model/provider/cwd solely from the record. A launch receipt and socket observation are distinct; an unobserved window stays visible. No watcher, retry, or supervisor.
- **control-socket:** live send under per-target lock; dormant rejects.
- **self-fetch:** active receiver plus deliverable mailbox; no resume authority. Sender/receiver joins are owner-kind specific and must not be generalized across vendors.
- **native-push:** probe-alive direct injection; no mailbox and no resume authority.
- `entwurf_peers` reports facts only; `entwurf_self` requires record-backed active-rail identity.
- Delivery returns only an acknowledgement/receipt, not a peer turn result. `wants_reply` is etiquette, not ownership. Sender envelope contains session/agent/cwd/time and derived provenance/replyability.

## Issue Queue

Keep at most ten open issues, including at most five implementation issues. Classify by destination: a diff-closing issue is implementation; research or a decision is not. An issue needs current evidence and an executable next measurement. Do not keep collection points or “just in case” issues; move enduring direction to [ROADMAP.md](./ROADMAP.md) and close solved work at its durable SHA. The issue thread is the live contract; repair a stale body visibly when it diverges.

## Verification

Two independent axes are required: deterministic/package gates and opt-in LIVE evidence. Exact commands, evidence levels, and release acceptance are owned by [VERIFY.md](./VERIFY.md); recorded host evidence by [BASELINE.md](./BASELINE.md). Run LIVE gates from scratch with ambient identity carriers stripped so artifacts and callbacks cannot bleed from the operator session.

### Scheduling

```text
implement → affected focused gates → independent review → one amendment bundle
          → qualification once if gate/mutant/matrix changed → full floor once on frozen candidate → commit
```

- Inner loop runs only affected gates; review and its corrections finish before the full floor.
- A changed contract names a production subject and independent oracle; its focused assertion has a stable QK and exact-once mutant. Matrices change by their declared axes/cells, not appended anecdotes.
- Qualification body is scheduled once when its surface changes; its manifest/head checks remain in the deterministic floor. A release requires the exact-SHA qualification evidence required by VERIFY, never a nearby green run.
- Freeze the candidate while the full floor runs; any worktree/index movement voids that receipt. Pre-commit is not the full floor.
- LIVE/release floors are not lowered by a shorter inner loop. Failed gate or evidence downgrade blocks the relevant commit/release decision.

## Type and Working Boundaries

- Each `.ts` file belongs to one declared typecheck fence; never hide a file with `exclude`. Root pi extensions use TypeBox through `@earendil-works/pi-ai`; MCP/scripts use explicit `.ts` imports required by Node strip-types. Installed surfaces route to compiled JS.
- Make surgical, one-contract changes. Removal repairs source and its proof together; a green gate never proves retired behavior.
- Before commit, sweep repository-wide for retired authority vocabulary and landed-plan future tense. Historical tombstones may remain; live docs, source, gates, and usage must agree.
- Prefer capability-domain language over identity rank. Use tabs unless the project formatter requires otherwise. GLG decides commit, push, and release gates.

### Review Discipline

- Reproduce one manual action per step: measure → narrow leaf → visible composition → observe pain → next step. Never pre-build manager, watcher, backlog, role system, or model-specific scaffolding.
- Classify findings: **Blocker** (false success, data loss, authority violation) fixes now; **Defect** (explicit-contract mismatch) joins one amendment bundle; **Observation** records future risk without opening current work. Two new architecture blockers in an amendment bundle return to design.
- Source-adjacent proof belongs with its capability. Unrelated scheduling/cache/receipt infrastructure does not ride that lane. If verification grows beyond the capability it serves, stop and report to GLG.
- Claims crossing sessions carry evidence state: measured receipt, `file:line`, external artifact, or named unverified source. Keep inherited facts separate from proposals; paste decisive evidence into cross-host artifacts.

## References

- [NEXT.md](./NEXT.md) — current ordering and handoff.
- [ROADMAP.md](./ROADMAP.md) — direction and deferred work.
- [docs/adding-a-harness.md](./docs/adding-a-harness.md) — entry route for a new harness.
- [docs/mux-launch-rail.md](./docs/mux-launch-rail.md) — mux ownership and launch contracts.
- [docs/acp-backend-rail.md](./docs/acp-backend-rail.md) — ACP adapter contract.
- [DELIVERY.md](./DELIVERY.md), [VERIFY.md](./VERIFY.md), [BASELINE.md](./BASELINE.md) — delivery coordinates, verification protocol, and evidence.
- [README.md](./README.md) — operator-facing package contract.
