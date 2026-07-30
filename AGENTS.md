# AGENTS.md — Maintainer Guidelines for entwurf

For agents that own this repo: invariant principles and reproducible verification, not release-story archaeology.

> **Direction.** This repo is the **entwurf capability package**: a v2 garden-citizen dispatch substrate, native-harness bridges, an ACP plugin, and the pi adapter that hosts that plugin today. `entwurf` is the subject; pi is one harness adapter. ACP is a plugin, not the boundary (#38). V1 verbs are gone. V2 addresses existing citizens; fresh sibling creation remains deferred. Current work and ordering live in [NEXT.md](./NEXT.md).

## North Star — One Forged Screwdriver

`entwurf`는 스위스 아미 나이프나 두 번째 하네스가 아니다. 이것은 **담금질된 드라이버 한 자루**다: 작고, 명시적이고, 맡은 접점에서만 강해야 한다.

- **entwurf가 주어이고 pi는 한 adapter다.** pi는 가장 깊게 붙은 하네스지만 다른 하네스보다 높은 정체성 계층이 아니다.
- **다른 하네스의 세션은 형제다.** Claude Code, Codex, Antigravity, pi는 각자의 transcript/auth/runtime을 소유한다. 증명된 lifecycle과 transport가 있을 때 같은 garden address space의 citizen이 된다.
- **능력을 surface 이름으로 재단하지 않는다.** 도구 이름이나 transport 비대칭은 capability 차이이지 존재의 등급이 아니다.
- **substrate는 결정적 dispatch만 맡는다.** record에서 identity를 읽고, rail별 liveness와 caller intent로 transport를 고른다. 숨은 hydration, ambient MCP scanning, 근거 없는 tool claim을 만들지 않는다.
- **좁은 tool surface는 규율이다.** entwurf가 backend를 몰 때 sub-agent/todo 없이 한 자루 드라이버로 움직인다. 두 번째 orchestrator로 자라지 않게 한다.
- **entwurf는 부속품이 아니라 분신을 연다.** resumed/spawned session은 runtime-isolated peer이지 disposable worker가 아니다.
- **증거가 말을 훈육한다.** README, source, gates, VERIFY, BASELINE이 받치지 않는 강한 주장은 멈춘다.

판단할 때 묻는다:

1. tool 이름을 보는가, capability를 보는가?
2. backend 비대칭을 정직하게 기록하는가, 형제성을 포기하는 핑계로 쓰는가?
3. 두 번째 하네스를 만드는가, 드라이버 한 자루를 단단하게 만드는가?
4. 이미 주어진 방향을 되묻는가, 실행 가능한 다음 증거를 만드는가?

## Architecture

- **entwurf-core (v2)** owns garden-id addressing, peer facts, liveness interfaces, dispatch decisions, rail choice, and delivery evidence.
- **Record authority** owns citizen identity. Every addressable pi, Claude Code, Antigravity, or future Codex citizen uses the same V3 `MetaIdentity` schema. `backend` selects capability/rail behavior; it does not create an identity hierarchy.
- **pi adapter** attaches a pi session to a record at `session_start`, hosts the record-keyed control socket, and exposes the native pi tool surface.
- **Native bridges** register already-running native sessions without taking over their transcript or auth: Claude Code is mailbox/self-fetch; Antigravity is probe-backed native-push; Codex has probe evidence but no shipped managed citizen lane.
- **ACP plugin** registers provider `entwurf` inside a pi host session and drives a backend under an isolated overlay. The host pi session is already a record-backed socket citizen; the plugin does not mint another citizen/socket/peer layer.
- **One delivery verb:** `entwurf_v2` addresses an existing garden id. Current routes are live control-socket send, dormant spawn-bg resume, active self-fetch mailbox enqueue, and probe-alive native-push. Complementary state×intent pairs reject honestly. Fresh creation is a separate future capability.

## Hard Rules

1. **One surface name, hard cut.** Runtime/provider/routing identity is `entwurf`. No permanent aliases, legacy readers, or hidden dual routing. One-shot migration or documented break only.
2. **The record is the sole garden address authority.** A socket, env var, marker, filename, model id, or transcript id is never an independent address axis. `PI_SESSION_ID` is only a child-process carrier for the garden id already established by pi's record birth.
3. **All citizens share one identity contract; rails differ by capability.** The control-socket liveness domain currently contains backend `pi`; self-fetch and native-push have different predicates. Branch on capability/domain, not on a privileged notion of “pi citizen.”
4. **Dispatch is computed from live facts.** Never store liveness. Never infer send/resume from session type before resolving the target and probing its rail.
5. **Rejects are real.** Wrong intent, dead/drifted identity, undeliverable mailbox, ambiguous address, or indeterminate probe returns a reject and mutates nothing. No cosmetic success or silent fallback.
6. **MCP is explicit.** Only explicit `mcpServers` wiring. No ambient `~/.mcp.json` scan or automatic retrieval.
7. **Meta-record store contract is one contract.** Record body is authority; filename must agree with the body; every active entry is a regular non-symlink file readable by the live V3 schema; `nativeSessionId` ownership is unique. Identity writers and doctor certify the whole active store before writing. Address-bearing reads use `readAddressableMetaIdentity`; targeted relay reads keep the documented per-entry contract. `readStoreRecordFile`/`O_NOFOLLOW` and the lstat policy layer are both load-bearing—do not merge or bypass them. No legacy reader/migrator: quiesce and run `entwurf meta-bridge-fresh-cut` when the generation is unreadable. Source and gates: `meta-session.ts`, `check-meta-*`, `check-fresh-cut-gate`.
8. **GC reclaims process resources, never memory/data.** Records and transcripts are preserved or archived; they are not casually deleted.
9. **This is not a second harness.** No prompt reconstruction, transcript hydration, tool-result ledger, credential mediation, or harness emulation. Each backend owns auth and transcript state.
10. **Native-push is its own rail.** It is not a mailbox or pi socket in disguise. Antigravity replyability is record-backed plus probe-alive; no receiver marker, watch state, or resume authority is invented for it.
11. **Package proof must model a consumer.** Operator entrypoints reach compiled JS when installed; `run_ts` is the single TS crossing. Keep `check-install-surface`, `check-pack-install`, and the checkout-invisible `check-install-container` distinct. A green clone is not a green tarball or consumer.
12. **Offline verification never rewires the operator.** Sandbox `HOME`, `PI_CODING_AGENT_DIR`, and every writable `XDG_*` root. LIVE gates alone may touch the real host and must say so. Keep static tripwires and dynamic outer self-fences; neither substitutes for the other.
13. **Doctors report runtime truth and ownership truth separately.** Runtime coverage does not prove entwurf owns the configuration; broken ownership does not erase visibly working runtime configuration. Final verdict remains red when either required axis fails.
14. **Native hook ownership is structural.** Claude hooks use the shipped exec-form launcher and provenance token; marker writers/readers share `isPlausibleOwnerPid`; no shell-form fallback, ancestry guess, or retired pid carrier. entwurf requires Claude Code `>=2.1.217` and enforces that floor itself because upstream gives no fail-loud — an older Claude validates the exec manifest, then drops `args` at runtime and reports success. The number is derived from `package.json` `entwurf.claudeCodeFloor`, never retyped as a second source. Currently certified axis is Linux desktop/workstation. Source/gates: `hook-launch.sh`, `meta-session.ts`, `check-hook-launch-topology`, `check-claude-floor-coherence`, `check-meta-doctor-oracle`.
15. **Crash, don't warn.** Bad config/path/model/store state throws. Empty catches are only for bounded environment probing; operator diagnostics go to stderr.

Detailed incident histories belong in CHANGELOG/issues/BASELINE and source-adjacent comments, not in this prompt. When a concise rule and old archaeology disagree, verify source + gate and repair the stale prose.

## ACP Plugin Boundary

| Layer | Owns |
|---|---|
| **entwurf-core** | identity/fact interfaces · dispatch table · delivery evidence · rail choice |
| **ACP plugin** | backend process lifecycle · isolated overlay · tool narrowing · per-backend ACP dialect · turn evidence |
| **ACP plugin does not own** | citizen registration · socket registry · peer protocol · memory DB · planner/orchestrator · auth |

- One `entwurf` provider, model-id routing, adapter resolved once at turn entry. Backend-specific settings remain opaque behind `adapterSettings`.
- The common turn sequence stays backend-invariant: spawn → initialize → newSession → enforceModel → prompt → event map.
- Rich operator/project context rides the **first user message augment**, not a large system prompt. The actual callable schema is the tool truth; prose never grants a tool.
- A backend may have no carrier or use launch-time model pinning; those asymmetries stay inside its adapter.
- A streaming assistant message starts `pending`. ACP terminal reasons are mapped explicitly; refusal, exhausted turn budget, unknown, or absent reasons end as errors, and the raw reason is preserved. Never restore a default-to-success branch.
- Claude is the reference adapter. Cortex is the second landed adapter (0.13.0): session-scoped dual-HOME containment, overlay-private `mcp.json` projection (its ACP server ignores the wire `mcpServers` param), `CORTEX_HOME` presence refusal, per-turn set-model. Current contract: `docs/acp-backend-rail.md` “Cortex Code audit (D1–D10)”.
- entwurf never supplies, copies, proxies, decrypts, or bypasses vendor credentials/subscriptions. It uses the operator's existing local authenticated backend.

## Citizen Identity and Dispatch

### One record axis

A `--entwurf-control` pi session is a citizen for the same reason a native bridge session is: it has a V3 meta-record.

- pi owns its native session id, filename, transcript, name, `/new`, `/fork`, `/clone`, and `/resume` lifecycle.
- `birthPiCitizen` upserts `(backend:"pi", nativeSessionId)` and receives the stable `gardenId` from the record.
- The control socket is `~/.pi/entwurf-control/<gardenId>.sock`; a record-less socket is a diagnostic, never a citizen.
- `PI_SESSION_ID` and `PI_AGENT_ID` propagate the record-established identity to child MCP processes. They are carriers, not a second authority.
- If record birth fails, no socket starts and no `PI_SESSION_ID` is exported.
- Reopening the same pi native session attaches to the same record; in-process replacement creates/attaches the replacement's own record.
- Dormant resume requires record existence, transcript-header ↔ `record.nativeSessionId` integrity, and model preservation.

### Capability domains, not rank

- **control-socket domain (currently `pi`)**: socket liveness, per-target lock, live send, and the dormant cell that selects spawn-bg.
- **spawn-bg resume** is a **separate relaunch transport**, not the control-socket rail: the dormant socket-liveness branch selects it, and the launch leaf (`resolveResumeLaunchIdentity`) is what checks backend authority. There is no separate spawn-domain predicate today — do not describe it as its own domain until one exists.
- **self-fetch domain (currently Claude Code)**: active receiver + mailbox deliverability; no owned resume.
- **native-push domain (currently Antigravity)**: adapter probe + direct injection; no mailbox or owned resume.
- `origin: "pi-session" | "meta-session" | "external-mcp"` records sender provenance. It is not the citizen identity schema and not a hierarchy.
- `entwurf_peers` reports record citizens and liveness facts only. It never embeds routing verbs or socket addresses for peers.
- `entwurf_self` is identity-required. For pi, its env carrier must have been planted from record birth; native marker identity must be backed by the matching record. Replyability is derived from the active rail, never hardcoded.

### Send-is-throw

- Delivery returns an ack/receipt, not the peer's turn result. If a reply is wanted, say so and set `wants_reply`; that flag is etiquette, not ownership.
- Sender envelope: `{ sessionId, agentId, cwd, timestamp, origin?, replyable? }`.
- Human-opened and spawned/resumed siblings use the same addressing and messaging semantics.

## Verification

Two axes are required: deterministic/package gates and opt-in LIVE evidence.

```bash
pnpm typecheck
pnpm check
./run.sh check-entwurf-v2-matrix
./run.sh check-meta-session
./run.sh check-entwurf-bridge-boot
./run.sh check-install-surface
./run.sh check-install-container       # require Docker in release acceptance

LIVE=1 ./run.sh release-gate /path/to/scratch
LIVE=1 ./run.sh smoke-acp-socket-citizen-live
LIVE=1 ./run.sh smoke-acp-bundled-mcp-live
LIVE=1 ./run.sh smoke-acp-v2-send-live
LIVE=1 ENTWURF_ACP_CORTEX_CONNECTION=<conn> ./run.sh smoke-acp-cortex-live   # on-demand; outside the claude release floor
LIVE=1 AGY_CONVERSATION_ID=<id> ./run.sh smoke-agy-native-push-live
```

- `pnpm check` is the static floor and includes the detailed `check-*`/offline smoke matrix.
- **Kill-proof discipline (gate qualification).** A gate is a test only if re-planting a closed defect turns it red for the claimed reason. `check-gate-qualification` proves that automatically: committed mutants in `scripts/mutants/` must be KILLED at their `[QK:<claim>]` signature inside an isolated snapshot repo (control→mutant→restore→control; the real checkout is never written). Gates a release touches carry such manifests; assertion counts are never evidence — claim IDs + killed mutant IDs are. `check-agy-permission-matrix` holds the enumerated permission contract space; matrix cells change by axis/rule edits, never by appending cases.
- **When changing a contract/gate:** name the production subject and an oracle independent of it; give the failing assertion a stable `[QK:<claim>]` label and add/update the exact-once mutant in `scripts/mutants/*.json`; if the contract is combinatorial, update the literal matrix axes/cells/exclusions together with their declared counts; then verify focused gate → `check-gate-qualification` → `pnpm check`, in that order. `MUTANT-STALE`/`SURVIVED`/`WRONG-REASON`/`CONTROL-RED`/`HANG`/`IMPURE` are red — never substitute an assertion count for a kill.
- Run LIVE gates with `PWD` in scratch so session artifacts do not land in the repo.
- Release acceptance and evidence levels are defined in [VERIFY.md](./VERIFY.md); recorded host evidence is in [BASELINE.md](./BASELINE.md).
- A failed gate or evidence downgrade blocks commit/release. Pipes can be connected and the water can still taste wrong.

## Repository Map

| Path | Purpose |
|---|---|
| `pi-extensions/entwurf-control.ts` | pi adapter: record attach, record-keyed socket, RPC, native tools |
| `pi-extensions/lib/pi-citizen-birth.ts` | pi native session → shared V3 record → socket address |
| `pi-extensions/lib/meta-session.ts` | shared V3 record/store authority plus native marker/mailbox primitives |
| `pi-extensions/lib/entwurf-v2-*.ts` | v2 contract, decider, transports, runner, production wiring |
| `pi-extensions/lib/entwurf-fact*.ts` | record citizens + transport-specific liveness facts |
| `pi-extensions/lib/native-push/` | native-push adapter/probe/register leaf |
| `pi-extensions/acp-provider.ts` | `entwurf` provider registration |
| `pi-extensions/lib/acp/` | ACP adapter rail, config/overlay, augment, turn loop, event mapping |
| `mcp/entwurf-bridge/` | MCP surface for v2/self/peers/inbox/native-register |
| `scripts/` | deterministic gates, LIVE smokes, install/doctor surfaces |
| `run.sh` | installed command and gate dispatcher |

## Type and Runtime Boundaries

- Every `.ts` file belongs to one typecheck fence: root emit-capable config, MCP strip-types config, or scripts strip-types config. Do not hide files with `exclude`.
- Root pi extensions import TypeBox through `@earendil-works/pi-ai`; do not mix direct `@sinclair/typebox` types.
- MCP/scripts use explicit `.ts` imports where Node strip-types requires them. Installed operator surfaces route to compiled JS.
- pi runtime range is `>=0.83.0 <0.84` with devDep exact `0.83.0`; re-evaluate loader aliases and `/compat` at the minor ceiling. Re-measured at the 0.82.1→0.83.0 move: `packages/coding-agent/src/core/extensions/loader.ts` and `packages/ai/src/compat.ts` are byte-identical across the two tags, so the ceiling moved on measurement, not assumption.
- ACP pins are recorded in `package.json` and checked by `check-dep-versions`/`check-acp-sdk-surface`; do not describe a dependency bump as a behavioral fix without evidence.

## Working Style

- Surgical changes, one contract at a time. Ask whether a change belongs in core, a harness adapter, a backend adapter, or the resident's own repo.
- Removal/repair changes source and their gates together. Do not leave a green gate that only proves retired behavior.
- Before commit, perform a **repo-wide** stale-prose sweep on two axes:
  1. retired symbols/authority vocabulary (`dual-read`, old schema names, removed commands, privileged identity wording);
  2. landed-plan future tense (`yet`, `will land`, `not here`, stale step headers).
- Judge each grep hit: historical CHANGELOG tombstones may remain; live claims, comments, usage text, gates, README, docs, NEXT, and source-module prose must agree with current behavior.
- Prefer capability/domain names (`control-socket domain`, `self-fetch`, `native-push`, `out-of-domain`) over identity-rank names (`pi-only citizen`, `non-pi citizen`).
- Keep docs calibrated and compact. Implementation archaeology belongs in git/CHANGELOG/issues; AGENTS keeps only invariants needed before acting.
- Use tabs unless the existing file/linter requires otherwise.
- GLG decides commit, push, and release gates. Never infer push from a commit request.

## Next and References

- [NEXT.md](./NEXT.md) — current priority and exact next move; branch work uses disposable `NEXT--<branch>.md`.
- [ROADMAP.md](./ROADMAP.md) — forward direction and deferred lanes.
- [docs/acp-backend-rail.md](./docs/acp-backend-rail.md) — ACP adapter contract and current entry conditions.
- [DELIVERY.md](./DELIVERY.md) — delivery capability/evidence coordinates.
- [VERIFY.md](./VERIFY.md) / [BASELINE.md](./BASELINE.md) — verification protocol and recorded evidence.
- [README.md](./README.md) — operator-facing package contract.
