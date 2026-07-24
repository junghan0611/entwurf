# AGENTS.md — Maintainer Guidelines for entwurf

For agents that own this repo: invariant principles + reproducible verification, not release-story drift.

> **Direction (read first).** This repo is the **entwurf capability package**:
> a v2 garden-citizen dispatch substrate (entwurf-core) + a meta-bridge + an
> ACP plugin + the pi adapter that hosts it today. v1 entwurf verbs are done
> and gone; v2 is the spine. ACP is **not** the project's center — it is one
> **plugin** that enters as a provider/model on a host `--entwurf-control`
> pi session — which is *already* a v2 socket-citizen — rather than minting
> citizens of its own (#38: *"ACP is a plugin, not the boundary."*).
> Package/repo/runtime identity is now `entwurf`; pi remains an
> adapter/runtime contract, not the center. The deferred #38 coordinate is a
> later physical extraction of entwurf-core into a separate repo, not this
> rename. Fresh sibling minting (the old v1 `entwurf` verb) stays deferred —
> see the branch NEXT.

## North Star — One Forged Screwdriver

`entwurf`를 만질 때 먼저 이 형상을 붙든다.
이 저장소는 스위스 아미 나이프가 아니다. 두 번째 하네스도 아니다.
이것은 **담금질된 드라이버 한 자루**다. 작고, 명시적이고, 자기가 맡은 접점에서만 강해야 한다.

영문 원칙만 읽으면 이것이 스펙처럼 보일 수 있다. 여기서는 그렇게 읽지 마라.
이 섹션은 기능 목록이 아니라 **판단의 중심축**이다.

### 먼저 붙들 정체성

- **entwurf가 주어이고 pi는 한 adapter다.** pi는 지금 이 repo가 가장 깊게 붙어 있는 하네스지만 4번째 하네스일 뿐이다. 이 repo는 pi의 세션 모델, transcript, UI, tool semantics와 경쟁하지 않는다.
- **다른 하네스의 세션은 형제다.** Claude Code, Codex, Antigravity는 학교가 달라도 모두 frontier 친구들이다. native bridge는 증명된 lifecycle/transport가 있는 세션만 garden id로 호명 가능한 citizen으로 등록할 뿐, 누구를 다른 누구로 위장시키지 않는다.
- **표면은 달라도 능력의 존엄은 낮추지 않는다.** 어떤 backend에서 `mcp__...`가 직접 보이지 않는다고 해서, 곧바로 그 backend를 "못하는 존재"로 취급하지 마라. 먼저 capability를 보고, 그 capability가 어떤 surface로 열리는지 확인하라.
- **substrate는 결정적 dispatch만 맡는다.** target liveness를 fact로 읽고, intent와 곱해 transport를 고른다. 그 이상 마술을 부리면 안 된다.
- **명시는 주변기류보다 강하다.** 숨겨진 transcript hydration, ambient MCP scanning, invisible tool claims, giant magical system prompt, 근거 없는 서사를 만들지 마라.
- **하네스의 도구 표면을 좁히는 것은 결핍이 아니라 규율이다.** entwurf가 backend를 몰 때(ACP Claude · pi-native 분신) 서브에이전트도 투두 도구도 없이 좁은 tool surface를 yolo로 돈다(ACP backend는 격리된 overlay 안에서) — pi에서 배운 **힣의 드라이버**다. backend가 못해서가 아니라, 한 자루 드라이버가 두 번째 오케스트레이터로 번지지 않게 하는 강제다. 이걸 강제해야 "힣의 드라이버를 쓴다"고 말할 수 있다. (backlog 형태는 `ROADMAP.md` tool narrowing.)
- **entwurf는 부속품이 아니라 분신을 연다.** spawn-bg resume된 세션은 runtime-isolated peer다. worker처럼 다루거나 권한 경계를 흐리지 마라.
- **증거가 말을 훈육한다.** README / AGENTS / CHANGELOG / VERIFY / BASELINE / runtime smoke가 받쳐주지 않으면, 작업을 중지하고 사용자에게 질문하라!

### 이 섹션을 읽는 올바른 방식

이 문단의 목적은 에이전트가 다음 질문을 **스스로** 하게 만드는 것이다.

- 나는 지금 tool 이름을 보고 있는가, 아니면 capability를 보고 있는가?
- 나는 backend의 비대칭을 정직하게 기록하고 있는가, 아니면 그것을 핑계로 형제성을 포기하고 있는가?
- 나는 사용자가 묻지 않아도 될 것을 되묻고 있는가?
- 나는 지금 두 번째 하네스를 만들고 있는가, 아니면 드라이버 한 자루를 더 단단하게 만들고 있는가?

### 금지할 오독

- 어떤 tool이 schema에 직접 안 보인다고 해서, 곧바로 "이 backend는 여기까지"라고 결론내리는 것
- surface 차이를 capability 포기로 번역하는 것
- 문서에 적힌 asymmetry를 면책조항처럼 사용하는 것
- `entwurf`를 하네스 런타임이나 범용 AI 작업실로 설명하는 것 — pi가 하네스 중 하나이고, 이 repo는 garden-citizen dispatch capability다
- MCP를 자동 맥락 검색이나 ambient tool scanning처럼 설명하는 것 — explicit injection만 허용된다
- `entwurf_v2`를 "새 분신을 만드는 도구"로 설명하는 것 — v2의 4 transport(control-socket / spawn-bg resume / meta-mailbox / native-push)는 전부 **기존** garden citizen 대상이다. fresh sibling 생성은 별개 능력이다
- 사용자가 이미 철학과 방향을 준 문제를 다시 사용자에게 되묻는 것

릴리즈 이야기와 개별 기능은 주변을 돈다.
중심은 언제나 이것이다: **thin substrate / explicit MCP / sibling-based entwurf / deterministic dispatch / observability / evidence-first language / capability dignity across sibling sessions**.

## What This Repo Is

An **entwurf garden-citizen dispatch substrate** + a **meta-bridge** + an **ACP plugin** + a **pi adapter**. Pi stays a harness/runtime, not the project center; every addressed session keeps its own identity.

- **Native-harness bridges**: Claude Code's global `SessionStart` hook creates a mailbox-backed garden meta-session; Antigravity's `PreInvocation` imprint creates/attaches a native-push garden citizen and writes its sender marker. Both preserve native transcript/auth/runtime ownership, but they are different rails and install surfaces. Codex has probe evidence only, not a shipped managed native-citizen lane.
- **v2 dispatch (`entwurf_v2`)**: one verb that delivers to / wakes an *already-identified* garden citizen. A pure decider reads transport-specific liveness facts and picks from a frozen table keyed on **target state × intent**: live pi + fire-and-forget → **control-socket**; dormant pi + owned-outcome → **spawn-bg resume**; active self-fetch + fire-and-forget → **meta-mailbox**; probe-alive native-push + fire-and-forget → **native-push**. Every complementary pair is an honest reject. It does **not** mint new siblings.
- **ACP plugin** (one pi-adapter ingress): registers the package provider `entwurf` as a pi session provider/model and drives the chosen ACP backend (Claude first; vendor/governed CLIs like Cortex next) under an isolated config overlay. It owns the backend process, the overlay, and the per-backend ACP dialect — **not** socket-citizenship. The host `--entwurf-control` pi session that selected the ACP model is *already* a v2 socket-citizen; the plugin does **not** mint a socket / peers / citizen layer. It is not the substrate and not a second harness. v1 entwurf verbs (`entwurf` / `entwurf_resume` / `entwurf_send`) are gone for good; the ACP plugin is a fresh build on the v2 core (0.11.0's `acp-bridge.ts` is a behavior oracle, not architecture to re-center). See §ACP Plugin Boundary.

## Code Principle — Crash, Don't Warn

Code in this repo is used by agents as infrastructure.

> **Never warn. Throw.**

Warnings make agents blame themselves and flail. Broken tool state must surface as broken tool state.

- Bad config → throw (e.g. `McpServerConfigError`); same for bad path / bad model id. No fallback.
- `catch {}` only for environment probing (optional package detection, ldd exit code variance).
- `console.warn` only in stderr diagnostic lines (read by operators, not agents).

## Hard Rules

1. **One surface name, hard-cut cutover**: provider/model/routing strings are `entwurf`. No permanent runtime aliases, legacy provider-id accept, or dual-read of old state. If existing operator state must be helped across, do it as an explicit one-shot cutover or a documented break, never as hidden dual routing. The `provider:` routing strings (`getRegistryRouting`, `model-lock.ts`) are **load-bearing** — they are identity, not residue.
2. **Dispatch is a function of liveness, not session type.** `entwurf_v2` never asks "is this a resume or a send" up front — it probes the target on its own rail and routes: live pi→control-socket, dormant pi→spawn-bg resume, active self-fetch→meta-mailbox, live native conversation→native-push. State is computed, never stored (a stored liveness bit is a lie).
3. **A reject is honest, never cosmetic.** When a target cannot receive (dead, drifted identity, wrong state×intent), the decider returns a reject — no `✓ delivered`, no `.msg` written, no signal poke. Silent degraded "delivery" is forbidden.
4. **MCP injection**: only via explicit `mcpServers` wiring. No ambient `~/.mcp.json` scanning, no automatic retrieval.
5. **Meta-record authority is the record body, never the filename.** `scanIdentityByNativeId` scans `.meta.json` bodies, throws on duplicate `nativeSessionId` (authority ambiguity is fail-fast), and never derives identity from a filename. A meta-record is nullable-at-birth (`model`/`transcriptPath` null until known). Production reads schemaVersion-3 records only (#50 hard cut); a pre-cut v1/v2 record fails loud naming the M1 migrate command, and the frozen legacy readers live solely in `pi-extensions/lib/meta-migration.ts`.
6. **GC reclaims process resources only — never data.** meta-records and transcripts (the denote-id memory layer) are preserved; dormant/stale entries are archived/TTL'd, not deleted.
7. **This is not a second harness**: no prompt reconstruction, no transcript hydration, no tool result ledger, no harness emulation. Native bridges front only a garden id plus their narrow delivery rail (Claude mailbox or agy native-push); they do not scrape transcripts or run a replacement control daemon.
8. **Auth boundary is deployment-surface-agnostic**. This repo does not provide, copy, proxy, decrypt, or mediate any backend's credentials. Native-harness sessions read whatever auth state is visible in their own process filesystem; nothing here moves that.
9. **Native-push is not a mailbox or pi socket in disguise.** Antigravity replyability is `recordBacked ∧ probeAlive`; it gets no receiver marker, no `watchArmed`, and no spawn/resume authority. Its `agentId` remains `meta-session/antigravity`. The pid+start-key sender join assumes serialized model invocation per agy process: two conversations concurrently invoking under one pid are unsupported and must never be claimed safe.
10. **A green dev clone is not a working package — and a green package on the maintainer's host is not a working consumer.** Node refuses `--experimental-strip-types` below `node_modules`, so any surface an operator can invoke must reach compiled JS when installed. This class has shipped four times (start.sh 0.12.1, store-doctor 0.12.4, plugin hook 0.12.5, agy imprint + three operator commands 0.12.7) because the fence was crossed by hand, per surface, and the source-tree floor cannot see it. There is now exactly one crossing — `run_ts` in `run.sh` — and two gates that hold it: `check-install-surface` (structural) and `check-pack-install` (drives the real tarball, in CI). A new `.ts` entrypoint routes through `run_ts` or it does not ship. Dev-only gates have no compiled twin by design and must be REFUSED under an installed package, never silently skipped — a `.sh` dev gate refuses in its own body, since `scripts/` ships whole and run.sh's dispatch is not the only way in. **`check-pack-install` is still a maintainer-shaped proof**: the checkout is present, every tree is operator-owned, and the install is project-local, so a surface that writes beside the installed package or depends on the repo being nearby is green there and broken for a real consumer. `check-install-container` (#51 C, own required CI job) closes that: one candidate tarball, read-only, into a container that has never seen this repo — non-root `npm install -g`, resolution through the PATH shim, a frozen package root, and a regular-file path+sha256 manifest fence across `install-meta-bridge`; the evidence line records the canonical tarball path + sha256 and the Node image id/repository digest. Default CI packs once into a temp dir; release acceptance passes a caller-preserved tarball through `ENTWURF_CANDIDATE_TGZ` and the gate consumes that exact file without re-packing, so `npm publish <same.tgz> --tag repair` can publish the accepted bytes. The two are not redundant detectors of one defect: the **freeze is a permission-level consumer fact** (the cell actually refuses the write, EACCES, the way a real consumer's host would), while the **manifest fence is the detector** — and it is exactly a regular-file path+sha256 comparison, not a whole-tree guarantee: it reads no permissions, ownership or symlink targets. A freeze at the package root alone is demonstrably insufficient (a write one directory down sails past it and only the fence sees it). Model the consumer's world, never a stricter one: a blanket `chmod -R a-w` freeze produced false reds because `cp -r` propagates modes into the installer's own assembly target, which no `sudo npm i -g` consumer can reach.
11. **Verification must not rewire the operator's own install.** An offline smoke that writes a live `~/.claude` / `~/.gemini` / `~/.pi` path uninstalls the operator as a side effect of "testing". Swap `HOME` **and every already-exported writable `XDG_*` root** (`XDG_DATA_HOME`: install-state · `XDG_STATE_HOME`: the imprint log · `XDG_CACHE_HOME`: the statusline gid cache): moving HOME alone still writes below the inherited roots. This class struck three times in two days — hard-verify 2026-07-13 (DATA, scratch scripts), `check-pack-install`'s own drives 2026-07-14 (DATA + STATE, inside run.sh), and `smoke-user-scope-citizen` 2026-07-14 (fake `PI_CODING_AGENT_DIR` paired with the real XDG ownership state, so its inverse followed the real `managedSettingsPath` and removed the live MCP key). `check-install-surface` S5 is a static **tripwire** over `scripts/*.sh` source only: it catches a literal live path, one hop of aliasing, (S5b) HOME-without-XDG swaps, and (S5c) a mutating `run.sh` drive left unsandboxed at any root that command writes — the agent dir, `XDG_DATA_HOME`, and, for `install`/`setup`, `HOME` itself, because `ensure_agent_dir_symlinks` hard-codes `$HOME/.pi/agent` and never reads the agent-dir override (so sandboxing `PI_CODING_AGENT_DIR` is not isolation for those commands) — but it cannot see a path assembled across variables, an embedded heredoc, or run.sh itself. **A tripwire keyed to one syntactic form is not a tripwire**: S5c first shipped matching only the inline-env drive, and a review mutation walked the identical leak straight past it by hoisting the same override into an `export` one line up. Match the drive, then demand the isolation — never the other way round. The dynamic complement is `check-pack-install`'s **outer self-fence**, which runs after every success or early-failure path: the operator's real `$XDG_DATA_HOME/entwurf` tree must be byte-identical, and the gate-specific fake agy marker count in the real `$XDG_STATE_HOME/entwurf/agy-imprint.log` must not increase (mutation-checked). Read a green S5 as "no obvious destructive line", never as "verification is sandboxed" — the real guarantee is running the offline floor under a swapped HOME+XDG, which is still open. LIVE gates are the only surfaces that may drive the real host, and they say so in their name.
12. **A doctor reports runtime truth and ownership truth separately.** Read the target's own semantics before calling a host broken. agy matches `mcp(*)` and `mcp(<server>)` against our tool wherever those rules appear, so an operator's broad `allow` already grants `entwurf_v2` — reporting that host as "NOT granted, agy prompts on every call" was a false red about a working surface. Installers still take the narrowest rule they need; doctors distinguish **we own this** from **someone else's rule is carrying it** from **it is genuinely broken**. Install-state is evidence only when it parses, names its required managed-path field as an absolute path, and that normalized path equals the live target this host reads; corrupt or foreign-target state is a failure even when the live command itself resolves. Ownership beats coverage: an element the state records as ours that has since vanished stays a failure even while an operator's broader rule keeps the surface working (a whole-file settings relink produces exactly this shape). Conversely, broken ownership state does not justify saying a visibly configured runtime command is absent — report both axes honestly and keep the final verdict red.
13. **A native-hook owner is structural, not a topology guess — and the structure is the exec form.** Shell-form command hooks do not expose one portable process tree: under the same Claude Code version we observed both a direct hook→Claude join and a retained `/bin/bash -c` wrapper, and ordinary tail-exec tests never reproduced the trigger. That form is retired, not patched. The meta-bridge declares the **exec form** — `command` is the shipped `hook-launch.sh`, `args` is the real argv — so no shell exists on the launch path, the launcher `exec`s the payload and preserves the pid, and the hook's parent IS Claude on every host (#51 B2, measured at Claude Code 2.1.217). The hook therefore reads `process.ppid` directly; the `$PPID` carrier, the ancestry walk, and the missing-carrier contract are **gone**, and re-introducing any of them means the manifest stopped feeding the owner. **But `process.ppid` is only the owner when the launcher was actually on the path, so `hook-launch.sh` stamps a non-identity `ENTWURF_META_HOOK_LAUNCH` provenance token and the hook writes NO sender/receiver marker without it.** This is not the retired carrier wearing a new name: the carrier smuggled a *pid* that had to be ancestry-checked, while this token carries no identity at all and answers only "was the authorized launch path taken". It is what keeps the upgrade mismatch fail-closed — an already-open Claude session still holding the OLD cached command reaches the new hook with a shell wrapper as its parent, and without the token that wrapper would be minted as an owner. Deleting it is never a cleanup. **entwurf requires Claude Code `>=2.1.217` and enforces that floor itself, because upstream gives no fail-loud:** an older Claude passes `plugin validate` on the exec manifest (unknown-key passthrough), then at runtime drops `args`, runs `command` alone, and reports the hook as `exit_code: 0, outcome: success` — measured at 2.1.138. `hook-launch.sh` refusing an empty argv is that silence made loud; installer and doctor refuse the version outright; there is no shell-form fallback for older versions. `check-hook-launch-topology` drives the shipped argv for real — including a plugin path containing a space, `$`, a backtick, and `;&` — and `check-claude-floor-coherence` keeps the floor one number derived from `package.json` `entwurf.claudeCodeFloor`. Evidence stays tiered: B/B2 are direct-native observations from actual 2.1.138/2.1.217 sessions on one NixOS host; the Linux artifact-consumer's fake Claude, planted cache, stand-in owner and `/proc` bridge are fixtures that prove package/oracle behavior, never a second native-host acceptance. **The doctor is the release oracle, so its exit 0 must mean every required layer was measured, never that a layer was skipped.** It resolves the ONE artifact Claude loads (`claude plugin list --json`.installPath; an ambiguous multi-version cache is refused, never guessed), classifies the installed *launch form* by name across all three owner hooks — a shell-form or launcher-less exec manifest is refused by name, not reported as unreadable drift — and then requires the live MCP↔marker join. Missing live evidence is `NOT CERTIFIED`, a failure worded distinctly from a broken install. The #51 repair cut has **Linux as its only currently certified axis**: install refuses Darwin because `/proc`-based live bridge discovery cannot certify it yet, doctor stays `NOT CERTIFIED`/nonzero there, and uninstall alone retains Darwin support so legacy state is not stranded. This is an evidence boundary, not a permanent macOS impossibility; future native validation may reopen the lane. `check-meta-doctor-oracle` holds this: a healthy fixture must reach PASS and twenty-one planted defects must each turn it red *naming their own cause*. An oracle with an optional central evidence layer is not an oracle.

## ACP Plugin Boundary

`entwurf-core` (the v2 substrate) is the center; **ACP is one plugin**, never the boundary (#38). Plugins supply read-only facts the core already asks for; they do not become the core, a memory layer, or a second harness (#39).

| Layer | Owns |
|---|---|
| **entwurf-core (v2)** | garden id · peer identity · liveness fact interface · dispatch decision · delivery evidence · rail choice (socket / mailbox / spawn / native-push) |
| **ACP plugin** | ACP backend process lifecycle · config overlay (isolation + tool-narrowing + identity-carrier materialization) · per-backend ACP dialect quirks · backend health / turn evidence — **NOT** socket-citizen registration or liveness/addressability facts (those are the host `--entwurf-control` session's, supplied via socket-discovery) |
| **ACP plugin MUST NOT become** | a memory DB · a task planner · an orchestrator · a second harness · a mailbox-citizen impersonation |

- **Sibling equality is a citizen-level property, not a rail-level one.** Every sibling is addressable (peers-visible, garden-id-addressed, `entwurf_v2`-reachable, replyable when its rail proves a return path). The *rail* differs by lifecycle: an ACP-backed pi resident is a **socket-citizen**; Claude Code is a **mailbox-citizen**; agy is a **native-push citizen**. Missing a mailbox on socket/native-push rails is right-sizing, not discrimination.
- **Durable memory is the authored common record** (`~/org`, botlog, agenda, Denote, andenken). entwurf lets peers move across that record layer; it never replaces it.
- **ACP enters as a model/provider, not a socket layer.** The ACP plugin registers as a pi session's provider/model and spawns the backend under an overlay; **socket-citizenship is supplied by the host `--entwurf-control` pi session**, not minted by the plugin. The plugin never builds a new socket registry, peers layer, or citizen protocol — over-designing one is the failure mode to avoid (`socket-discovery` is model-agnostic, so an ACP-model session is already a citizen).

### Operating boundaries (trust invariants — survive any re-implementation, #15)

These claims must stay true on every install surface; they are the first thing a re-implementation silently drops, so they are pinned here:

- `entwurf` does **not** provide, resell, or bypass Claude/vendor credentials, tokens, or subscription access. It connects only to the operator's **existing local authenticated backend** through an explicit plugin boundary.
- No auth bypass, no subscription sharing, no hidden transcript restoration.
- Expert escape hatches are **explicit and documented**, never accidental backdoors.
- The plugin **fails loud / fails closed** when an invariant is broken.

## Verification

Two axes, both required.

**Deterministic + smoke gates** (`./run.sh`, wired into `pnpm check`):

```bash
pnpm typecheck                              # 3-config tsc fence (root + mcp + scripts)
pnpm check                                  # full static floor: lint + typecheck + every check-*/smoke-* below
./run.sh check-entwurf-v2-matrix            # the decider's state×intent table, read as an SSOT (REAL decideDispatch)
./run.sh check-entwurf-v2-decider           # + -contract / -lock / -release / -send / -send-fallback / -mailbox / -runner / -production / -surface / -spawn / -spawn-production
./run.sh check-meta-session                 # + -v3-record / -migration-readers / -migrate-v3 / -mailbox-state-write / -receiver-marker / -capability-source / -identity-consumers / -listing (#50: record-v2→v3-record, dual-read deleted, migration→migration-readers, dual-consumers→identity-consumers)
./run.sh check-meta-doctor-oracle           # detection power of the release oracle: healthy fixture reaches `doctor: PASS`, 21 planted defects each turn it FAIL naming their own cause
./run.sh check-native-push-adapter          # agy probe/route leaf; separate from pi socket and mailbox liveness
./run.sh check-agy-sender-identity          # record-backed pid/start-key sender resolution + ambiguity refusal
./run.sh smoke-agy-install-state            # MCP + exact permission ownership + honest inverse (140)
./run.sh smoke-agy-statusline-state         # ambient garden identity install surface (69)
./run.sh smoke-agy-hooks-state              # PreInvocation birth/sender hook install surface (44)
./run.sh check-entwurf-bridge-boot          # the MCP entwurf-bridge stands up + exposes the v2/native-register tool set
./run.sh check-install-surface              # structural strip-types fence: run_ts is the only crossing, every operator command has a compiled twin, offline smokes never write the real $HOME
./run.sh check-install-container            # Linux artifact CONSUMER (#51 C, own CI job): one candidate .tgz, read-only, into a checkout-invisible node:<engines-major> cell — non-root `npm install -g`, PATH shim, frozen package root, MCP tools/list, install-meta-bridge under a path+sha256 byte-fence, strict doctor. Default pack-once temp; ENTWURF_CANDIDATE_TGZ consumes an exact preserved file without re-pack. SKIP without Docker; ENTWURF_REQUIRE_DOCKER=1 makes that RED
./run.sh check-bridge /path/to/project      # entwurf-bridge direct MCP smoke (tools/list + protocol/negative-path)
./run.sh check-auth-boundary                # ACP plugin no-auth sentinel present + no legacy-ENV apiKey literal (trust invariant, code-level)
./run.sh check-acp-provider-surface         # provider registers curated Claude anchor + streamSimple wired to the real streamShellAcp backend
# The legacy v1 ACP gates (sentinel / session-messaging / xt-tool-surface) and the
# v1-only meta smokes (smoke-meta-mailbox / smoke-meta-sender-identity, both calling
# the gone entwurf_send tool) were REMOVED in the 0.12 cutover (2026-06-27). Any
# re-test of those axes belongs on the entwurf_v2 surface as a fresh gate.
```

**Live release gate** (opt-in, owns the merge decision):

```bash
LIVE=1 ./run.sh release-gate /path/to/scratch   # two-tier: MUST (release-blocking, owns exit code) + BEHAVIOR (advisory)
LIVE=1 ./run.sh smoke-acp-socket-citizen-live    # S1: a real ACP-model --entwurf-control resident is a first-class socket-citizen (peers + get_info), turn-free (no backend, no stub fire)
LIVE=1 AGY_CONVERSATION_ID=<id> ./run.sh smoke-agy-native-push-live  # real agy probe/register/direct-inject evidence; conversation-id gated, outside aggregate release-gate
```

The MUST tier is the necessary condition ("green" = MUST PASS, FAIL=0); BEHAVIOR is advisory — the `smoke-resident-garden-guard` positives (a model-in-loop garden identity turn). Run every live gate with `PWD=scratch` so sessions never land in the repo's own session dir.

**Agent-driven verification** ([VERIFY.md](./VERIFY.md)): self-recognition/transcript agreement ≈ L1; objective MCP calls L2; on-disk/process L3; direct-native L4; soak L5.

If a gate fails or a claim drops below its needed evidence level, do not commit. Pipes can be connected and the water can still taste wrong.

## Entwurf

Uses `entwurf` instead of `delegate` to avoid ecosystem collisions. spawn-bg resume creates a sibling, not a worker.

- **Surface** — MCP `entwurf-bridge`: `entwurf_v2`, `entwurf_self`, `entwurf_peers`, `entwurf_inbox_read`, `entwurf_register_native` (explicit/manual fallback for an already-running native conversation). pi-native (`pi-extensions/entwurf-control.ts`): `entwurf_v2`, `entwurf_peers` tools (#50 C4 removed the socket-scan `/entwurf-sessions` command). The v1 `entwurf` / `entwurf_resume` / `entwurf_send` tools and the `/entwurf` / `/entwurf-send` / `/entwurf-status` commands are **removed**.
- **`entwurf_v2` is the one delivery verb.** Given a garden id, it classifies the target (live pi vs. dormant pi vs. mailbox meta-session vs. native-push citizen — a bare garden id does not reveal this) and routes correctly. It does **not** mint a fresh sibling: spawn-bg resumes an *already-identified* citizen, while native-register binds an *already-running* conversation. Fresh creation was the v1 `entwurf` verb and remains deferred.
- **`entwurf_peers`** is a read-only fact surface (liveness / capability / identity / cwd-history). Do not bake verb-routing (`resumable`/`sendable`) into the fact layer; routing is the decider's job.
- **`entwurf_self`** returns the authoritative identity envelope (pi-session env, or a trusted meta-session sender marker) and is identity-required. Its socketPath/mailboxPath lines are the CALLER's own transport diagnostics, not an identity surface — that is why they survive #50 C4 while `entwurf_peers` forbids every socket-shaped key/path (the peers listing points at OTHER citizens, where a socket path is an address claim).
- The target registry (`pi/entwurf-targets.json` + `setup:links`) is **gone** (#50 C3): v2 never spawns from a model tuple — `entwurf_v2` resumes an already-identified record-backed citizen, and dormant-resume authorization is record existence + the transcript-header ↔ `record.nativeSessionId` integrity check (the old `requireEntwurf` name-tag and resume-marker env are deleted). Bridge-extension routing survives as `getRegistryRouting` (caller-supplied tuple, ← resolve-acp-bridge). Identity Preservation Rule: no model override on resume.
- `PI_SHELL_ACP_V2_ONLY=1` was the v1-refusal flag; with v1 removed on this branch its guard (`entwurf-v2-only.ts`) is gone too. `runEntwurfV2` was always flag-clean.

> **Source-agnostic does not mean harness-agnostic.** 어디서 던지든 — GLG / sibling / external MCP host — entwurf 의 *target* 은 garden citizen 이다. spawn-bg resume 의 spawn surface 는 pi 자식 프로세스만 띄운다 (`pi --entwurf-control` keep-alive resident). 외부 MCP host 가 닿을 때도 target 은 이미 식별된 citizen 이어야 한다. *Model* 은 free axis (어느 형제 학교 모델이든), *spawn target* 은 harness 정합 axis.

> **Naming pair.** *Entwurf* (기투, projection-of-self) — a resident agent throws siblings forward (resume / messaging). The resident-side counterpart is *Mitsein* (공존, being-with), defined in the resident's own knowledge base (cwd-scoped, not a global persona). This repo owns the entwurf substrate; resident-side conventions live where the resident wakes.

### Resident identity — the record is the address (#50 C2)

A `--entwurf-control` session is a garden citizen because it has a **meta-record**, not
because its session id has a particular shape. pi mints its own id (a uuidv7 is normal);
`birthPiCitizen` upserts `(backend:"pi", nativeSessionId)` at `session_start`, the record
mints the `gardenId`, and everything addressable hangs off that one string.

- **Launch:** `pi --entwurf-control …`. No `--session-id` injection — that was the old
  launcher's job and it is gone, together with `run.sh new-session-id`'s role in launching
  (the generator itself stays; the record uses it to mint garden ids).
- **In-process new/resume:** pi's own. `/new`, `/fork`, `/clone` and RPC session replacement
  all just fire `session_start`, which attaches the new session as its own citizen and
  rebinds the socket to its address. The `/gnew` command, the pre-switch cancels and the
  garden-format hard exit are deleted — there is no id to police (LOCKED PROTOCOL 2).
- **Socket:** `~/.pi/entwurf-control/<gardenId>.sock`, keyed on the RECORD's id. A socket
  carrying pi's session id is the pre-cut address and a gate failure.
- **`PI_SESSION_ID`** carries the gardenId, so every child MCP process reads back a
  routable address (`entwurf_self`), never pi's internal id.
- **Failure is loud, not cosmetic:** if the record cannot be written (unreadable store,
  duplicate native id, a pre-cut v1/v2 store naming the M1 command) the control server is
  refused, `PI_SESSION_ID` stays unset, and the reason is on stderr. An unaddressable
  resident must not survive quietly — that is the guard's surviving purpose.
- **Status label = 🪛 (the forged screwdriver, the North Star), NOT the word "entwurf".**
  `🪛 ready` before the first assistant turn (session file not on disk → model changeable),
  `🪛 <gardenId>` after (file written → model locked).
- **The resident session NAME is pi's.** The `control`-tagged garden name mirror, its
  `entwurf`-tag refusal and the sessionId-bound resume-marker exemption are gone with the id
  they mirrored. Dormant-resume authorization is record existence (LOCKED PROTOCOL 6) plus
  the transcript-header ↔ `record.nativeSessionId` integrity check (#50 C3).
- Gates: `smoke-pi-attach` (deterministic, in `pnpm check`: record birth · record-keyed
  socket · attach-on-reopen · artifact delivers to the socket) + `smoke-resident-garden-guard`
  (LIVE, the same contract driven through a real `pi` process).

### Send-is-throw

Messages are thrown, not awaited.

- v2 delivery is fire-and-forget. There is no `wait_until` / `subscribe` / `turn_end` channel and no caller-side baseline correlation. For a control-socket send the RPC ack is the contract; for meta-mailbox it is the enqueue receipt; for native-push it is adapter acceptance plus the bounded post-send probe evidence. If you need a reply, say so in the message.
- The sender envelope rides every send by default: `{ sessionId, agentId, cwd, timestamp, origin?, replyable? }`. `origin` distinguishes pi-session senders (`replyable: true`) and trusted meta-session senders. Claude meta replyability is mailbox-backed; native-push replyability is record-backed + probe-alive. `entwurf_self` is authoritative-identity-required.
- **Human-greeted 담당자** is a first-class pattern: GLG may open a session in repo B, greet it directly, then hand its garden id to repo A. Spawned siblings and human-opened peers share the same messaging semantics; only the creation sequence differs.

## File Structure

| File | Purpose |
|------|---------|
| `pi-extensions/acp-provider.ts` | ACP plugin entry: registers the package provider `entwurf` + curated Claude model surface; wires `streamSimple` to the real ACP backend |
| `pi-extensions/lib/acp/*.ts` | ACP plugin internals: curated Claude surface + no-auth sentinel (`models.ts`), Claude config overlay (`overlay.ts`), tool surface + exclude-tools preflight (`tool-surface.ts`), ACP→pi event mapper (`event-mapper.ts`), pi Context→ACP prompt (`context.ts`), spawn-per-turn `streamSimple` backend (`backend.ts`) |
| `pi-extensions/entwurf-control.ts` | control plane: record attach at session_start, `--entwurf-control` socket (keyed on the record gardenId), RPC, `entwurf_v2` / `entwurf_peers` tools |
| `pi-extensions/lib/pi-citizen-birth.ts` | the #50 C2 attach seam: pi session → meta-record upsert → control-socket address |
| `pi-extensions/model-lock.ts` | package-provider model lock (pi.extension) |
| `pi-extensions/meta-bridge-hook.ts` | Claude Code `SessionStart` hook: register a mailbox-backed garden meta-session |
| `pi-extensions/lib/entwurf-v2-*.ts` | v2 substrate: contract / lock / decider / matrix / release / send / mailbox / native-push / runner / production / surface / spawn(+production) |
| `pi-extensions/lib/native-push/` | Antigravity adapter probe/route, direct-inject hand, explicit native registration core |
| `pi-extensions/lib/meta-*.ts` | V3-only meta-record authority (`meta-session.ts`), mailbox state, frozen v1/v2 legacy readers isolated in `meta-migration.ts` (M1 surface only), receiver/sender identity |
| `scripts/agy-{bridge,statusline-bridge,hooks-bridge}.*` | three state-backed agy install/doctor/inverse surfaces |
| `scripts/agy-imprint.ts` | agy `PreInvocation` automatic birth + record-backed sender marker |
| `pi-extensions/lib/entwurf-core.ts` | shared core (session-file lookup, identity read, explicit-extension args); some v1 exports now dead pending routing cleanup |
| `protocol.js` | dependency-free shared wire constants (`<project-context` marker); single source for tsc emit + strip-types MCP paths |
| `run.sh` | install (incl. `install-meta-bridge`), check-*/smoke-* gates, release-gate |
| `mcp/entwurf-bridge/` | MCP server exposing `entwurf_v2`, `entwurf_self`, `entwurf_peers`, `entwurf_inbox_read` |

## Typecheck Boundary

Single fence — every `.ts` source file is reached by some `tsc --noEmit` pass. No opt-out file. Three configs because the surfaces run under different runtime models:

| Config | Covers | Runtime model |
|---|---|---|
| `tsconfig.json` (root) | `pi-extensions/**` | emit-capable. The root config must not set `noEmit`. |
| `mcp/tsconfig.json` (extends root) | `mcp/entwurf-bridge/**`, plus the `pi-extensions/lib/*` it imports | `node --experimental-strip-types`. Adds `allowImportingTsExtensions` + `noEmit` because the bridge imports the shared lib with explicit `.ts` suffixes — Node's strip-types resolver requires the suffix on the wire. |
| `scripts/tsconfig.json` (extends root) | `scripts/**` (verification scripts), plus the `pi-extensions/lib/*` it imports | `node --experimental-strip-types`. Same trade-off: explicit `.ts` imports + `allowImportingTsExtensions` + `noEmit`. Scripts are runtime gates, not build inputs. |

`pnpm typecheck` runs all three passes; `pnpm check` and the husky pre-commit hook run them as part of the gate. Adding a new `.ts` file outside all three configs is a fence breach — include it or split a fourth config with a documented runtime model, but never extend the root `exclude` to hide drift.

Code-level invariants pinned at the same time:

- **typebox single-source.** `pi-extensions/entwurf-control.ts` imports `Type` / `StringEnum` from `@earendil-works/pi-ai` (which re-exports typebox 1.x). `@sinclair/typebox` is not a direct dependency. Mixing the two universes silently widens `StringEnum`-typed parameters to `unknown`.
- **garden-id addressing for entwurf.** Every entwurf addressing surface takes a sessionId / garden id, never a session name. Entwurf / resident garden sessions use garden ids (`YYYYMMDDTHHMMSS-[0-9a-f]{6}`); generic live pi peers may still surface pi-assigned uuids.
- **sender envelope contract.** `{ sessionId, agentId, cwd, timestamp, origin?, replyable? }`. `agentId` is one field (`<provider>/<model>` for `origin: "pi-session"`, `meta-session/<backend>` for `origin: "meta-session"`). `PI_SESSION_ID` + `PI_AGENT_ID` are the canonical pi-session carriers; meta-session markers are pid+start-key hints backed by the meta-record store — no cryptographic non-forgery; cross-process env injection is the operator's responsibility.
- **entwurf provider session model lock.** After a session is anchored, a model switch touching the package provider `entwurf` is reverted by `pi-extensions/model-lock.ts`; native-to-native switching stays free; fresh startup/new sessions stay unlocked until the first prompt.

## Runtime Dependencies

- `@modelcontextprotocol/sdk` and `zod` are the substrate runtime deps. With the Claude-first ACP plugin shipped, the Claude/ACP backend deps are pinned alongside them: `@agentclientprotocol/claude-agent-acp` (`0.61.0`), `@agentclientprotocol/sdk` (`1.3.0`), `@anthropic-ai/sdk` (`0.100.1` — kept: `claude-agent-sdk@0.3.217`'s peer floor is `>=0.93.0`, so 0.100.1 satisfies it and a mechanical rise to the newest SDK is NOT taken). Codex/Gemini ACP packages stay out of scope; Codex is native/probe, agy is the shipped native-push Google lane, and Gemini ACP remains compatibility history rather than a current target.
- `pi` (`@earendil-works/pi-ai`) on PATH at the pinned range (`>= 0.82.0 < 0.83` — devDep exact `0.82.0` + next-minor ceiling). Mismatches are caught by `check-dep-versions` / `check-pi-runtime-version`. 0.80 moved the standalone root `getModels()` to the deprecated `@earendil-works/pi-ai/compat` entrypoint; the curated Claude surface (`pi-extensions/lib/acp/models.ts`) imports `getModels` from `/compat` — the single subpath allowlisted in `check-pi-import-surface`. NOT a provider-factory subpath such as `providers/anthropic`: although it typechecks, pi's extension loader (jiti alias map in pi-coding-agent `core/extensions/loader.ts`) resolves only FOUR pi-ai specifiers for extensions — the bare root, `/compat`, `/oauth`, and (added in 0.81) `/providers/all` — so any other `providers/*` import resolves to the unresolvable `dist/compat.js/providers/…` and crashes extension load (caught live by `smoke-resident-garden-guard`, not by static typecheck). This `/compat` use is an **extension-loader compatibility shim** chosen by loader constraint, not a preference for a deprecated API — the `<0.83` ceiling guards it.
  - **The re-evaluation this line demanded has been done (2026-07-24, pi `v0.80.7..v0.82.0` source-diffed + both versions installed and `getModels("anthropic")` compared).** The shim holds: root / `/compat` / `/oauth` are untouched in the alias map, `getModels` is still exported from `/compat` (as `getBuiltinModels`, deprecation text now pointing at `/providers/all`), and the curated anchors are byte-identical across the bump (14 models, `claude-opus-4-8` + `claude-sonnet-5`, same `cost` / `contextWindow` / `maxTokens` / `reasoning`). What 0.81 ADDED — the `/providers/all` alias and native `registerProvider(provider)` registration — is a new surface, not a replacement forced on us; migrating the curated read off deprecated `/compat` onto it is a **separate cut**, deliberately kept out of the version bump. Re-evaluate again at the `<0.83` ceiling.

## Working Style

- Surgical changes. One thing at a time.
- Ask: does this belong in pi? In the resident's own repo? Or here?
- Removal on this branch is gate-verified: subtract source AND its gate/case/script together (the 결합 규칙) so `pnpm check` stays green and never goes silently red.
- **Every repair/removal commit hunts the sentences it invalidated** — adding the new fact without deleting the old claim has now shipped **eight** times (dead registry link → stale NEXT diagnosis → A1/launcher prose surviving C4 → `docs/setup-clean-host.md` teaching the deleted `--session-id` launcher *and a hard-exit guard that no longer exists* → the `shouldListAsLive` removal leaving its own policy sentences behind → the store-doctor claiming dual-read three cuts after V3-only · a gate header claiming v2 writes → **the schema module itself: `MetaIdentity`/serializer/minter/`decideUpsert` doc comments calling the live v3 shape "v2", one of them defaulting a field #50 deleted, while the same function's body comment was already correct**). **Stop extending the directory list — that is what failed three rounds running (`docs/`, then `scripts/`, then the lib the cut actually rewrote).** The unit is the REPO, and the sweep is a method, two axes:
  1. **Retired vocabulary → repo-wide grep.** Before committing, write down what the cut retired: deleted symbol names, the schema/authority words it demoted (`dual-read`, `v2 identity`, `socketOnly`), the command form it replaced. `grep -rn` each across the whole tree (not only touched files — a schema cut invalidates prose in consumers it never edits), then judge every hit: a *tombstone* ("`X` is GONE since #50") is the goal, a *live claim* ("`X` reads v1 AND v2") is the defect.
  2. **Landed plans → future-tense grep.** A cut that LANDS invalidates its own plan sentences: `yet` · `not here` · `Today …` · `does NOT yet` · `lands in step N` · `will land`. Staged-build headers are written in future tense and nobody returns to them when the step ships.
  Surfaces to cover at minimum: README · AGENTS · DELIVERY · VERIFY · ROADMAP · `docs/**` (an install walkthrough is a new host's first surface, so a stale command there costs more than a stale README line) · run.sh usage lines AND dispatch/function comments · `scripts/**` operator & gate scripts · **the module the cut rewrote, all of it — being the file you edited is not evidence its other 40 comments were read**. A deleted symbol's *prose* is not deleted by the compiler or by biome — only by this sweep.
- Keep docs calibrated: strong language is fine; unbacked language is not.
- Resist the urge to make the substrate more magical than necessary.

## Next

Current priority + open decisions: [NEXT.md](./NEXT.md) (main lane; per-branch work uses a disposable `NEXT--<branch>.md` lane file that is deleted before merge). Read at session start. `/recall` restores the past axis; NEXT fixes the future axis. Forward direction: [ROADMAP.md](./ROADMAP.md).

## References

- [ROADMAP.md](./ROADMAP.md) — current + future direction (the ACP-plugin-on-v2 lane; #38's eventual `entwurf` package extraction is a deferred coordinate).
- [VERIFY.md](./VERIFY.md) — agent-driven verification guide (Evidence Levels L0–L5 + the §1A interview; independent axes, do not conflate).
- [BASELINE.md](./BASELINE.md) — operator-driven verification record (companion to VERIFY.md).
- [agent-config](https://github.com/junghan0611/agent-config) — real consumer repo.
