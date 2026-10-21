# AGENTS.md — Maintainer Guidelines for entwurf

For agents who own this repository: durable invariants and the documents that own the changing evidence. This is the **entwurf capability package**: visible sibling lifecycle and garden-id delivery — the v2 dispatch core, native-harness bridges, ACP plugin, and pi adapter. Entwurf is the subject; pi is one adapter. ACP is a plugin, not the boundary. V2 addresses existing citizens; `entwurf_fresh_call` creates a new sibling.

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
- **pi adapter:** attaches its native session to a record, hosts the record-keyed control socket, and registers the compiled `entwurf-bridge` with Pi’s built-in MCP under that record’s identity.
- **Native bridges:** register existing sessions without owning transcript or auth. Claude Code and Copilot are self-fetch; Antigravity and Codex are native-push. Codex remains native rather than ACP so its vendor tools, delegation, and work context remain intact. Admission/evidence details belong in [DELIVERY.md](./DELIVERY.md) and [VERIFY.md](./VERIFY.md).
- **ACP plugin:** one `entwurf` provider under an isolated overlay. The host pi session is already a record-backed citizen; ACP creates neither a second citizen nor a socket layer.
- **mux:** launch-only placement and fixed-runtime launch. It never imports into delivery. Fresh identity arrives only through its callback envelope, never a lookup; same-id visible resume keeps identity/liveness/locking on the v2 side of the injected seam. Fresh call accepts only the narrow model, literal absolute cwd, and existing caller-server seat inputs; it creates no session and does not infer seat from cwd. A Codex CALLER alone has an omitted-placement rule: it opens beside its own TUI pane, matched by thread-id in that pane title; 0/2+ matches reject; explicit placement still wins. Do not turn either fresh call or resume into a generic driver, command/env carrier, or second creation API. Exact module/argv/import ownership: [docs/mux-launch-rail.md](./docs/mux-launch-rail.md).
- **Delivery:** `entwurf_v2` addresses an existing garden id through a live control socket, deliverable self-fetch mailbox, or probe-alive native push. It never starts a process. Fresh creation and visible same-id resume are separate lifecycle verbs.

## Hard Rules

1. **One surface name, hard cut.** Runtime/provider/routing identity is `entwurf`; no permanent alias, legacy reader, or hidden dual route.
2. **Record is the sole address authority.** Socket, env, marker, filename, model, and transcript are carriers or evidence, never a competing address axis. `PI_SESSION_ID` only carries record-established identity. If record birth fails, no socket starts and no `PI_SESSION_ID` is exported.
3. **One identity contract, capability domains.** Branch on rail/liveness capability, not a privileged citizen class.
4. **Live-fact dispatch.** Never store liveness or infer send/resume before resolving the record and probing its rail.
5. **Rejects are real.** Wrong intent, dead/drifted identity, undeliverable mailbox, ambiguity, and indeterminate probe reject without mutation or fallback.
6. **MCP and native modules are explicit.** MCP uses only explicit `mcpServers`. Native extension modules enter only through the owning bootstrap, from an operator-named absolute file or an operator-named absolute directory read once at launch: top level only, exact suffix filter, deterministic order, every selected entry a regular file. Neither discovers ambient or default locations, takes module paths from settings or environment, recurses, watches, or retrieves modules automatically. Native modules do not emulate a foreign extension API.
7. **One meta-store contract.** Record body and filename agree; active records are readable regular non-symlink V3 files; `nativeSessionId` is unique. Writers and doctor certify the active store before writing. Address-bearing reads use the addressable reader; `readStoreRecordFile`/`O_NOFOLLOW` and lstat policy both remain load-bearing. Quiesce and fresh-cut an unreadable generation; roll forward a stale reader that rejects a newly known backend or V3 key. Reader-version skew is not a generation change: preserve identities and records, and verify every participating reader before claiming rollout complete. Store protocol and gates: `meta-session.ts`, `check-meta-*`, `check-fresh-cut-gate`.
8. **GC reclaims processes, not memory.** Preserve or archive records and transcripts; do not casually delete them.
9. **Not a second harness.** No prompt reconstruction, transcript hydration, tool-result ledger, credential mediation, or harness emulation. Backends own auth and transcript.
10. **Native-push is distinct.** It is neither mailbox nor pi socket. Native-push citizens are record-backed plus probe-alive, with no receiver/watch state or resume authority. Antigravity retries only after bounded re-probe; Codex never replays queue acceptance. Codex sender identity is request-scoped metadata; app-server environment carries root/placement, never citizen identity.
11. **Package proof models a consumer.** Installed operator entrypoints reach compiled JS; `run_ts` is the sole TS crossing. Keep checkout, tarball, and consumer proofs distinct.
12. **Offline verification never rewires the operator.** Sandbox HOME, `PI_CODING_AGENT_DIR`, and writable XDG roots. Only named LIVE gates may touch the host, and must say so.
13. **Doctors report runtime and ownership independently.** Working runtime does not prove ownership; broken ownership does not erase runtime observation. Required failure on either axis is red.
14. **Native-hook ownership is structural.** Use shipped exec launchers and provenance, shared plausible-owner-pid policy, no shell fallback or ancestry guess. Version floors belong to their package source and are enforced there; hook contract/docs own the changing detail.
15. **Crash, don’t warn.** Invalid config/path/model/store state throws. Empty catches are only bounded environment probes; diagnostics go to stderr.
16. **mux launches, never delivers.** A tmux handle is an ephemeral view, not an address or liveness receipt; screen text/keystrokes are not delivery evidence. A Codex caller's seat is the pane whose title carries its own thread-id, a placement input only; it is never an address, and never a pane nobody named. Cross-window adjacency requires the documented observed-coordinate proof, never pane guessing.
17. **Supply the missing surface; do not become the harness.** Installation supplies Entwurf bytes, development fixtures, and declared upstream SDK dependencies. Where upstream omits a native execution surface from its distribution, Entwurf owns that thin, removable app/TUI composition as canonical source and ships its deterministic emission (type strip + import relocation) as a carrier, against one coherent published-library version set. The engine — native execution, auth, queues, storage, transcript, compaction, cancellation and recovery — remains the upstream SDK (Rule 9). Provenance, license, rebuild and installed-consumer proof belong to the supply contract. No Entwurf-owned copying/inlining of provider model catalogs, subscription, credential or login; no launch-time download, repair, update or fallback. Setup checks capability, version-set coherence and carrier integrity: absent optional capability is explicit skip; incomplete installation, mismatch and drift are named non-green refusals. Portability and runtime evidence remain separate.

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

**Retirement is operator-requested, never autonomous.** A real citizen may be retired only when the operator explicitly requests that target/action, like the separate approval needed for a push. Development, tool exposure, a coordinator role, record-backed attribution or delegated release judgement is not a standing retirement grant. No timer, idle heuristic, roster cleanup or agent initiative substitutes for that request. Preserve request attribution without inventing a self-signed permission boolean or role database. Test-owned lifecycle gates require their own named execution scope; working siblings are never incidental test targets.

- Pi owns its native session lifecycle; `birthPiCitizen` attaches `(backend: "pi", nativeSessionId)` to the stable garden id. Socket and env values are record-derived carriers.
- `entwurf_resume_call {target}` is a separate lifecycle verb for pi and Claude Code targets, not delivery intent. It reopens the same dormant id visibly, submits no prompt, and receives every launch fact solely from the record (pi: transcript/model/provider/cwd; Claude Code: its session id and cwd, with no model or permission flag restored). Dormancy is rail-specific: a dead pi control socket, or — for Claude Code — the last validated owner the Entwurf hook armed is proven gone (`classifyMarkerOwner` dead) AND the record, re-read after that verdict, still carries the same non-null `attachIncarnation` (arm revision) the marker copied; an absent, unreadable, mismatched, inconclusive or unbound marker refuses. That guarantees only committed hook attaches: a process holding the session without one (hooks disabled, a record-arm lock timeout or store failure at its start) is invisible to it — a boundary GLG accepted on 2026-10-21. A launch receipt and the observation (same-id socket, or a NEW live owner in the opened pane re-arming the marker with a fresh binding the record carries) are distinct; an unobserved window stays visible. The caller is attributed, never authorised by that. Inside herdr it refuses; there is no herdr resume rail. No watcher, retry, or supervisor.
- **control-socket:** live send under per-target lock; dormant rejects.
- **self-fetch:** active receiver plus deliverable mailbox; no resume authority. Sender/receiver joins are owner-kind specific and must not be generalized across vendors.
- **native-push:** probe-alive direct injection; no mailbox and no resume authority.
- `entwurf_peers` reports facts only; `entwurf_self` requires record-backed active-rail identity.
- Delivery returns only an acknowledgement/receipt, not a peer turn result. `wants_reply` is etiquette, not ownership. Sender envelope contains session/agent/cwd/time and derived provenance/replyability.

## Issue Queue

Keep at most ten open issues, including at most five implementation issues. Classify by destination: a diff-closing issue is implementation; research or a decision is not. An issue needs current evidence and an executable next measurement. Do not keep collection points or “just in case” issues; move enduring direction to [ROADMAP.md](./ROADMAP.md) and close solved work at its durable SHA. The issue thread is the live contract; repair a stale body visibly when it diverges.

## Verification

Two independent axes are required: deterministic/package gates and opt-in LIVE evidence. Exact commands, evidence levels, and release acceptance are owned by [VERIFY.md](./VERIFY.md); recorded host evidence by [BASELINE.md](./BASELINE.md). Run LIVE gates from scratch with ambient identity carriers stripped so artifacts and callbacks cannot bleed from the operator session.

A new contract's test goes beside the behavior it certifies — `pi-extensions/**/*.test.ts` or `plugins/herdr/**/*.test.mjs` — and `check-tests-beside-behavior` discovers it by glob, so landing one edits no filename list. `scripts/check-*` stays the home of LIVE, install, spawning and mixed gates; a new hand-built gate there needs a reason the vitest lane could not carry it.

### Scheduling

```text
implement → affected focused gates → independent review → one amendment bundle
          → affected qualification PARTIAL once if gate/mutant/matrix changed → full floor once on frozen candidate → commit
```

- GLG-requested branch checkpoint commits keep completed subject/proof bundles small: scoped review, affected focused checks and normal hooks/shared scanner before each checkpoint, with known RED/unmeasured boundaries recorded. A checkpoint is not frozen-candidate acceptance. The sequence above owns final candidate acceptance: the affected qualification PARTIAL, frozen FULL and native/LIVE/release floors remain mandatory before landing, and the prepared SHA's exact-SHA CI push run (its four required jobs; the qualification body is no longer a release axis, #144) before shipment, never inherited from an interim commit.
- Inner loop runs only affected gates; review and its corrections finish before the full floor.
- A changed contract names a production subject and independent oracle; its focused assertion has a stable QK and exact-once mutant. Matrices change by their declared axes/cells, not appended anecdotes.
- Development never runs the whole qualification body. A changed gate/mutant/matrix runs its affected exact-argv groups once, after review and amendment, as PARTIAL receipts (`./run.sh check-gate-qualification --group '<argv JSON>' --receipt <absolute path outside the repo>`); the manifest head stays in the deterministic floor. Since #144 (GLG, 2026-10-16) the whole body is not a release axis: it runs only on the weekly schedule or a manual `qualify=true` dispatch, as a drift diagnostic no cut waits for, and no cut owes a local whole body either. A release states that kill-power was not re-measured at its SHA and lists any earlier-candidate PARTIAL with its own candidate; a PARTIAL never stands for the release, and the release still requires the exact-SHA evidence VERIFY names, never a nearby green run.
- Freeze the candidate while the full floor runs; any worktree/index movement voids that receipt. Pre-commit is not the full floor.
- LIVE/release floors are not lowered by a shorter inner loop. Failed gate or evidence downgrade blocks the relevant commit/release decision.

## Type and Working Boundaries

- Each `.ts` file belongs to one declared typecheck fence; `exclude` may move a file between fences but never out of all of them, so an exclude states the receiving `include` in the same change. Root pi extensions use TypeBox through `@earendil-works/pi-ai`; MCP/scripts use explicit `.ts` imports required by Node strip-types. Installed surfaces route to compiled JS. Behavior-adjacent `.test.ts` takes the fence `test/` takes — `scripts/tsconfig.json`, never the emit-capable root program — and is kept out of the tarball by a files-array negation whose tripwire is `check-pack`.
- Develop only on branches in this repository checkout; never use worktrees or tmp development clones. Isolated test fixtures and temporary evidence are not development checkouts.
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
- [docs/herdr-launch-rail.md](./docs/herdr-launch-rail.md) — herdr launch rail (#116): two-step placement, the one-line birth argv, and within-generation reclaim. `entwurf_fresh_call` selects it from process context (`HERDR_ENV=1`, pilot `pi | claude-code`), never from a caller parameter and never as a fallback either direction.
- [docs/acp-backend-rail.md](./docs/acp-backend-rail.md) — ACP adapter contract.
- [DELIVERY.md](./DELIVERY.md), [VERIFY.md](./VERIFY.md), [BASELINE.md](./BASELINE.md) — delivery coordinates, verification protocol, and evidence.
- [README.md](./README.md) — operator-facing package contract.
