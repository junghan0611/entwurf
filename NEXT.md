# NEXT.md — pi-shell-acp

> 다음에 할 일만 남긴다. 로그가 아니다.
> 결정 trace 와 evidence 는 commit history / CHANGELOG / VERIFY / BASELINE / README / AGENTS / 코드로 보낸다.

## Hotfix before 0.9.0 — 0.8.1 package-installed Entwurf ACP routing (#29)

Oracle surfaced a current-release bug: when `pi-shell-acp` is installed in Pi settings as `git:github.com/junghan0611/pi-shell-acp`, Entwurf ACP spawn cannot resolve the bridge extension for the child `pi --no-extensions` process. `resolveExplicitExtensionSpec()` returns null for `git:` / `npm:` sources, so `provider=pi-shell-acp` child exits with `Unknown provider "pi-shell-acp"` before any session file exists.

Independent from #28 (0.9.0 session identity). This blocks reliable Entwurf routing on every package-installed machine and must ship in 0.8.1. Fix it before leaning on Entwurf for #28 implementation work.

### Root cause (code-confirmed)

- `pi-extensions/lib/entwurf-core.ts:573` — `resolveExplicitExtensionSpec()`:
  ```ts
  if (!source || source.startsWith("git:") || source.startsWith("npm:")) return null;
  ```
  Only local-path package sources are resolved; `git:` / `npm:` early-return null.
- `getRegistryRouting()` (entwurf-core.ts:696-703, spawn path) then only pushes a **warning** and spawns the child anyway → `pi --no-extensions --provider pi-shell-acp` → `Unknown provider`.
- `getEntwurfExplicitExtensions()` (entwurf-core.ts:658-664, **resume path** via `wantsAcpByRecordedProvider`) has the same warning-only hole — resume of a recorded `provider=pi-shell-acp` session also dies on git installs. Both paths must be fixed.
- `resolveConfiguredPackageSource()` (entwurf-core.ts:557) reads only user `~/.pi/agent/settings.json` (`PI_SETTINGS_PATH`, hardcoded at line 44). Project `-l` sources live in `./.pi/settings.json` and are never even seen — a separate scope gap, handle explicitly (resolve or fail-fast, never silent).

### Install-path mapping (from pi substrate, user scope)

Verified in `~/repos/3rd/pi-mono/packages/coding-agent/src/core/package-manager.ts` (`getGitInstallPath` / `getNpmInstallPath` / `getManagedNpmInstallPath`). Replicate the minimal equivalent locally — do **not** import pi internals into entwurf-core:

| source | installed root |
|---|---|
| `git:github.com/junghan0611/pi-shell-acp` | `~/.pi/agent/git/github.com/junghan0611/pi-shell-acp` (`agentDir/git/<host>/<path>`) |
| `npm:@junghanacs/pi-shell-acp` | `~/.pi/agent/npm/node_modules/@junghanacs/pi-shell-acp` (managed); if absent, pnpm/npm-global legacy fallback |
| git project `-l` | `./.pi/git/<host>/<path>` |
| npm project `-l` | `./.pi/npm/node_modules/<name>` |

### A. Code fix — entwurf-core.ts resolver

- In `resolveExplicitExtensionSpec`, compute `localRoot`/`remoteRoot` per source kind (local / `git:` / `npm:`), then reuse the existing candidate-probe loop (index.ts / extensions/index.ts / dist/... at line 580-601) unchanged.
- `git:` → strip prefix, `path.join(AGENT_DIR, "git", rest)`. `npm:` → managed `node_modules` root first, then decide legacy-global candidate vs explicit unsupported.
- Keep the no-pi-internals-import policy: implement the tiny host/path + node_modules mapping inline.

### B. Fail-fast routing (no warning-only)

- `getRegistryRouting()`: when `provider === "pi-shell-acp"` and bridge unresolved → **throw before spawn**, not warn. Message must list what was checked (local path / git install / npm install) and refuse the unknown-provider child.
- Source present in settings but install dir missing → also fail-fast.
- Apply the same to the resume path (`getEntwurfExplicitExtensions` recorded-provider branch).

### C. Deterministic test — `check-package-source-routing` (no backend, 0 tokens)

Exercise the resolver in isolation with a temp `PI_SETTINGS_PATH` + synthetic install trees. Cover the full matrix:
- local checkout → resolves
- git user, installed → `~/.pi/agent/git/<host>/<path>`
- git user, **install missing → fail-fast**
- npm user → managed root, or explicit unsupported
- project `-l` git/npm → mapped or **explicit unsupported-scope error** (never silent `Unknown provider`)
- no source → null

Consider making `PI_SETTINGS_PATH` env-overridable (like `PI_ENTWURF_TARGETS_PATH`) so the test needn't touch the real settings file.

### D. Live gate — `smoke-installed-entwurf-acp`

One package-installed topology (git user), real Entwurf ACP spawn, assert child no longer dies with `Unknown provider`. Isolate with temp `HOME`/`PI_CODING_AGENT_DIR` so the operator's real `~/.pi/agent/settings.json` is untouched. Use one cheap ACP target.

### E. Release-gate wiring (cut condition)

`./run.sh release-gate <scratch>` is the cut condition, so install-topology must run there — `run.sh` `release_gate()` (line 3712-3810). Add both steps **before** the Entwurf live gates (after step 3 / before `smoke-all`):
```bash
run_step "check-package-source-routing"  gate bash "$self" check-package-source-routing
run_step "smoke-installed-entwurf-acp"    gate bash "$self" smoke-installed-entwurf-acp "$project_dir"
```
Why: current `check-pack-install` (run.sh:2845+) proves tarball shape + `pi -e <node_modules> --list-models` but does NOT simulate Pi settings package sources (`git:` / `npm:`) and never calls Entwurf (`--ignore-scripts` even skips prepare, line 2919). That blind spot is exactly why this bug shipped. Keep `check-pack-install` as-is; add the topology gates alongside.

### F. Docs / repro matrix

Cover all official install paths, not just local checkout:
- npm global `pi install npm:@junghanacs/pi-shell-acp`; npm project `-l`; git global `pi install git:github.com/junghan0611/pi-shell-acp`; git project `-l`; pi.dev/gallery (document exact source/layout, map to the same smoke).
- README install section: distinguish provider-registration smoke (`--list-models` / `smoke-all`) from Entwurf ACP-routing smoke.
- `docs/setup-clean-host.md` Stage 5: promote from two-session `entwurf_send` to a package-source Entwurf ACP spawn check (the bug is child extension injection, not peer messaging).

### G. husky prepare noise (fold in here)

`package.json:91` `"prepare": "husky 2>/dev/null || true"` — no behavior change, just silences the `husky: command not found` stderr on consumer/git-install machines (husky is dev-only; `|| true` already handles exit code, this drops the cosmetic line). Bundle into the same PR.

### Pre-implementation correction checklist (GPT-힣 review, code-verified)

Five corrections to fold into the A–F work so we don't backtrack. All verified against current code.

1. **Respect `PI_CODING_AGENT_DIR` / `PI_SETTINGS_PATH` env — required for the isolated smoke (D).** pi's `getAgentDir()` (pi-mono `config.ts:485`, `ENV_AGENT_DIR = PI_CODING_AGENT_DIR`) reads the env (expand-tilde) before falling back to `~/.pi/agent`. entwurf-core hardcodes `os.homedir()/.pi/agent` at **both line 43 (AGENT_DIR) and line 579 (remoteRoot)**. Make local resolution env-aware:
   ```ts
   const AGENT_DIR = process.env.PI_CODING_AGENT_DIR ?? path.join(os.homedir(), ".pi", "agent");
   const PI_SETTINGS_PATH = process.env.PI_SETTINGS_PATH ?? path.join(AGENT_DIR, "settings.json");
   ```
   Without this, `smoke-installed-entwurf-acp`'s temp-HOME isolation can't point the resolver at the synthetic install tree. (Keep remoteRoot on the *remote* homedir — env override is a local-resolution concern; don't leak local env into the SSH path.)

2. **npm root from parsed package name, not `source.slice(4)`.** `npm:@junghanacs/pi-shell-acp` may carry a version/spec (`npm:@scope/name@1.2.3`). Root must be `agentDir/npm/node_modules/<parsed.name>`, so a minimal parser must split `@scope/name` from optional `@version`/spec. Raw-slice would build a wrong path.

3. **Project `-l` gap includes local-path sources, not just git/npm.** pi resolves project local package sources against `cwd/.pi` too; the resolver reads only user `~/.pi/agent/settings.json`, so it misses *all three* project-scope kinds (git/npm/local). 0.8.1 decision: support project scope OR explicit unsupported-scope fail-fast — but **never silent `Unknown provider`**.

4. **Define fail-fast as "explicit ACP intent" — and decide the Claude legacy fallback.** Throw-before-spawn applies to: registry target `provider === "pi-shell-acp"`; resume `recordedProvider === "pi-shell-acp"`; opt-in Codex-via-ACP (`ENTWURF_CODEX_ACP_ENV`). Separately decide the Claude path: `entwurf-core.ts:20-21` says "Claude models always routed through pi-shell-acp, falls back to pi-claude-code-use, then warns" (fallback at line 644-655). Warning-only there is slightly off-principle — choose keep-as-warning vs promote-to-fail-fast explicitly, don't leave it implicit.

5. **Add an `import.meta.url` self-root fallback for local spawn (safety against fail-fast regressions).** entwurf.ts/index.ts currently have NO `import.meta`/`fileURLToPath` self-detection (confirmed). For a local-dev `pi -e /abs/path/pi-shell-acp` where settings has no matching source, fail-fast alone would now throw. The parent extension already knows its own load path: derive the loaded pi-shell-acp root from `import.meta.url` and add it as a resolution candidate — for **local** spawn this is more accurate than settings. Remote spawn still needs settings/source mapping (can't use a local self-root across SSH).

Implementation order (unchanged, with the 5 folded in):
1. resolver: env-aware AGENT_DIR/SETTINGS (1) + git/npm root mapping (2) + self-root candidate (5)
2. spawn + resume warning-only → fail-fast with explicit-intent scope (4), project-scope decision (3)
3. deterministic `check-package-source-routing`
4. live `smoke-installed-entwurf-acp` (relies on 1)
5. release-gate wiring
6. prepare stderr noise

Issue: https://github.com/junghan0611/pi-shell-acp/issues/29

---

## Top priority — 0.9.0 Entwurf garden-native session identity (#28)

Pi 0.76.0 `--session-id` + Pi 0.78.0 `--name` 가 준비되었으므로 Entwurf 세션을 더 이상 특수 `entwurf-*.jsonl` 파일종으로 만들지 않는다.

> **Sessions are born as garden citizens.**

### Non-negotiable direction

- **Breaking change allowed / intended.** 기존 `taskId` / `*entwurf-<taskId>*.jsonl` saved-session 호환은 유지하지 않는다. 이미 필요한 세션은 semantic-memory 축에 임베딩되었다고 보고, 잘못된 구버전 handle 은 깨져야 한다.
- **Public handle = `sessionId`.** `taskId` 는 public schema, help text, result text, docs, tests, comments 에서 제거한다. 필요하면 내부 process-run 식별자는 `runId` 같은 별도 이름으로만 둔다.
- **Spawn uses Pi primitives.** Entwurf spawn 은 직접 session file path 를 만들거나 `--session <file>` 을 넘기지 않고 `pi --session-id <id> --name <displayName>` 을 넘긴다.
- **Resume uses `--session-id`.** Resume 은 먼저 JSONL header scan 으로 `sessionId` 의 saved session file / header cwd / recorded provider+model 을 찾고, child cwd 를 header cwd 에 맞춘 뒤 `pi --session-id <sessionId>` 로 이어붙인다. `--session <file>` 은 0.9.0 Entwurf path 에서 제거한다.
- **Session file is diagnostic only.** API/문서/테스트의 primary handle 로 `sessionFile` 을 쓰지 않는다. 있으면 디버그 출력에만 둔다.
- **No compatibility comments.** 구버전 taskId / filename convention 을 설명하는 주석·문서가 남아 있으면 agent 가 우회한다. 구현 버전에 맞는 주석·테스트·문서만 남긴다.

### Proposed identity / name grammar

- `sessionId`: timestamp-first, collision-safe, Pi validator compatible.
  - 추천: `YYYYMMDDTHHMMSS-xxxx` (예: `20260530T120912-a3f8`)
  - 이유: garden sort/link 감각 유지 + 병렬 spawn collision 방지. 순수 second timestamp 만 쓰면 Pi `--session-id` 의 “있으면 open” 동작 때문에 race/collision 이 조용히 이어붙을 수 있다.
- `displayName`: Entwurf meaning layer.
  - 예: `entwurf · gpt-5.4 · from 20260530T120000 · review release gate`
  - 포함 축: `entwurf`, model, caller/session hint, short task hint. 너무 길면 task hint truncate.

### Implementation touch points to specify before coding

- `pi-extensions/lib/entwurf-core.ts`
  - `EntwurfResult.taskId` → `sessionId` 중심으로 타입/formatter 변경.
  - `runEntwurfSync` 에서 `crypto.randomUUID().slice(0,8)` taskId + `cwdToSessionDir()` + `${timestamp}_entwurf-${taskId}.jsonl` 제거.
  - `findEntwurfSessionFile(taskId)` 제거, `findSessionFileById(sessionId)` / header scan helper 로 교체.
  - `runEntwurfResumeSync(taskId, ...)` → `runEntwurfResumeSync(sessionId, ...)` 로 contract 변경.
  - resume invocation 은 `--session-id <sessionId>` 사용. cwd authority 는 saved header cwd 유지 (#9 invariant).
  - `formatSyncSummary` 는 `Session ID:` 를 primary 로 출력. `Task ID:` 제거.
- `pi-extensions/entwurf.ts`
  - async spawn 도 `--session-id` + `--name` 사용.
  - active map key / tool schema / result details / status display 를 `sessionId` 로 변경.
  - `entwurf_status` 는 sessionId 기준으로 조회. process 실행 식별이 필요하면 내부 `runId` 로 분리.
  - `entwurf_resume` schema 의 `taskId` 제거 → `sessionId`.
- `pi-extensions/lib/entwurf-async.ts`
  - `AsyncEntwurfInfo.taskId` public field 제거/변경.
  - `findEntwurfSession(taskId)` filename scan 제거 → header id scan.
  - async resume ack/completion text 의 `Resume ID` / `Original` 표현 재검토: durable handle 은 같은 `sessionId`; 새 실행 구분이 필요하면 `runId` 만 내부/diagnostic 으로 표시.
- `mcp/pi-tools-bridge/src/index.ts`
  - `entwurf_resume` schema `taskId` → `sessionId`.
  - MCP help text 에서 “Task ID from prior entwurf”, “saved entwurf session by taskId”, “`*entwurf-<taskId>*` lookup” 제거.
  - `entwurf` result text도 `Session ID` 를 후속 resume handle 로 안내.
- Tests / smokes
  - `scripts/sentinel-runner.sh`: `*entwurf-*.jsonl` 검색·taskId regex 파싱 제거. tool result / JSON details 에서 `sessionId` 를 파싱.
  - `scripts/cross-cwd-resume-smoke.ts`: `spawn.taskId` → `spawn.sessionId`.
  - `scripts/compaction-policy-smoke.ts`: 동일.
  - `scripts/smoke-async-resume.sh`: taskId 중심 prompt/parsing/negative path 제거.
  - `mcp/pi-tools-bridge/test.sh`: unknown taskId negative → unknown sessionId negative.
  - `run.sh` smoke prose 중 Entwurf resume/taskId 문구 정리.
- Docs / comments
  - AGENTS.md Entwurf section, README, VERIFY, CHANGELOG, MCP descriptions, tool promptGuidelines 에서 taskId/file convention 제거.
  - “legacy fallback” 류 문구 금지. 0.9.0 기준으로만 설명.

### Pre-implementation review evidence

Opus review completed on oracle (code read only, no repo edits):

- Review sessionId: `20260530T123336-opus28`
- Review JSONL: `~/.pi/agent/sessions/--home-junghan-repos-gh-pi-shell-acp--/2026-05-30T03-33-38-357Z_20260530T123336-opus28.jsonl`
- Review stdout log: `/tmp/pi-shell-acp-28-opus-review-20260530T123336-opus28.jsonl`
- Derived llmlog note: `~/org/llmlog/20260530T123824--entwurf-090-가든네이티브-세션정체성-구현전-리뷰__entwurf_llmlog_pishellacp_review_session.org`

핵심 판정: Pi substrate 는 가능하나 `--session-id` cwd-local lookup 때문에 resume cwd 가 틀리면 조용히 새 세션을 만들 수 있다. 0.9.0 의 가장 중요한 guard 는 “resume 이 기존 세션에 append 하는가, 새 세션을 만들지 않는가”다. Async spawn 때문에 sessionId 는 부모가 생성해야 하며, durable `sessionId` 와 per-process `runId` 를 분리해야 한다.

0.9.0 방향 메모: llmlog 는 파생 artifact 일 뿐, garden-native Entwurf 에서는 **세션 자체가 llmlog** 가 된다. 세션 끝에 기록/요약을 남기고, 나중에 sessionId/name/header metadata 로 해당 session JSONL 위치를 찾아오는 기능이 필요하다. 그래야 리뷰/구현 세션을 직접 열어 “제대로 조사했는지”, “무엇을 실수했는지”를 판단할 수 있다.

---

## Ready but parked — 0.8.0 cut (awaiting GLG)

모든 게이트·문서·버전 작업 완료, 프리릴리즈 가능 상태. 결정 trace 와 evidence 는 CHANGELOG 0.8.0 / VERIFY / BASELINE / commit history 에 있다 (여기 로그로 다시 쓰지 않는다). 남은 것은 GLG 승인 후 릴리즈 시퀀스뿐:

1. GLG final review → `git diff` 확인 → commit → push
2. `pnpm publish --access public` (prepublishOnly 가 `pnpm check` + `check-pack-install` 재실행)
3. tag `v0.8.0` + push tag (GitHub release optional)
4. agenda stamp + Google Chat 알림

cut 직전 GLG 가 `./run.sh release-gate <scratch>` 를 한 번 더 돌려 기록용 evidence 를 남긴다 (npm latest 는 cut 전까지 0.7.6).

> **OpenClaw is a separate track.** `plugins/openclaw/` 의 `claude-opus-4-7` (src/dist/config/README) + README:24/61 "1M context on Sonnet 4.6 / Opus 4.7" prose 는 GLG 가 별도 마이그레이션. 0.8.0 cut 에서 건드리지 않는다.

> **Deferred decision — Sonnet async-resume variance.** resume step 2 에서 Sonnet 이 가끔 `mode:'sync'` 를 emit. 현재는 bounded-retry + `MODEL_ARG_OR_ENVELOPE_MISMATCH` 분류로 완화 (model-variance mitigation, product fix 아님). replyable caller 에 async 강제하는 real fix 는 contract 결정 — real-use 실패 shape repro 가 먼저다.

---

## Deferred — not part of 0.8.0 unless GLG reopens

- **`--session-id`** — new pi CLI flag for exact project-local session ids. Entwurf intentionally uses `--session <absolute sessionFile>` (file-identity dependent). Do not rewrite the entwurf path just because the flag exists. Possible pilot: small `run.sh` automation/smoke where fixed IDs improve determinism. Does NOT solve ACP backend continuity footguns from bridge config signature drift.
- **RPC `bash.excludeFromContext`** — pi 0.77 lets RPC clients run bash while keeping output out of the next model prompt. Matters beyond tokens: noisy output pollutes transcript / recall / semantic-memory embeddings. Audit pi-shell-acp / helper / MCP / session-control paths using pi RPC bash. Principle if adopted: operational probes should be observable to the caller without auto-becoming model/embedding context unless explicitly useful.

---

**OpenClaw 쪽은 당분간 진행하지 않는다.** `3a65072 docs(openclaw): recommend native lanes for Claude/Codex, narrow plugin to Gemini` 로 정리한 대로, OpenClaw 5.22 native `claude-cli` 가 Pro/Max 결제 + 1M ctx + workspace skill + live-session 재사용까지 충분히 동작함을 확인했다. Claude/Codex lane 은 OpenClaw native 를 쓰면 되고, 우리 OpenClaw plugin 은 더 밀 필요가 없다.

`pi-shell-acp` 본체는 계속 **pi extension / ACP bridge / entwurf surface** 로 유지한다. OpenClaw plugin 은 “Gemini lane 이 필요할 때 쓸 수 있는 보조 어댑터” 정도로 parked.

---

## Standing focus — Asymmetric Mitsein with Claude Code

(0.8.0 캠페인과 병행하는 상시 초점. 릴리즈 게이트 작업이 끝나면 다시 전면으로.)

당분간 초점은 **비대칭 공존(Asymmetric Mitsein)** 이다. `pi-shell-acp` 를 OpenClaw plugin 쪽으로 더 밀기보다, **pi session ↔ Claude Code / external MCP host ↔ pi-tools-bridge ↔ entwurf** 가 서로 다른 하네스 정체성을 유지하면서 함께 일하는 시나리오를 검증한다.

핵심 질문:
- Claude Code 쪽에서 `pi-tools-bridge` MCP surface 를 통해 pi session / entwurf 와 자연스럽게 협업하는가?
- 외부 MCP host 는 replyable 하지 않다는 비대칭을 agent 가 정확히 이해하는가?
- `entwurf_send` 는 fire-and-forget, `entwurf` / `entwurf_resume` 는 outcome ownership 이라는 역할 분담이 실제 워크플로에서 헷갈리지 않는가?
- Claude Code 가 설계/리뷰하고 pi-shell-acp 세션이 실행하거나, 반대로 pi 가 Claude Code 쪽 맥락을 불러 협업하는 시나리오가 문서/로그/UX 상 정직한가?

테스트 시나리오 후보:
1. **Claude Code → live pi session send** — `entwurf_peers` 로 sessionId 확인 → `entwurf_send(mode=follow_up)` 로 작업 전달 → receiver 가 sender envelope / external non-replyable 상태를 오해하지 않는지 확인.
2. **Claude Code → pi-native entwurf** — external MCP host 의 sync path 와 pi-native async path 차이를 명확히 기록; 긴 작업은 pi session 안에서 async entwurf 로 넘기는 패턴 확인.
3. **pi session ↔ Claude Code 역할 분리** — Claude Code: 설계/리뷰/코드 읽기, pi-shell-acp: 실행/검증/entwurf orchestration. 서로 forward 하지 않고 GLG가 역할을 정하는 패턴 유지.
4. **세션 연속성 + 비대칭 공존** — 아래 session continuity hygiene footgun 과 결합 테스트.

성공 기준:
- 각 시나리오에서 “누가 outcome 을 소유하는가”가 명확하다.
- replyable / non-replyable, send-is-throw, MCP `entwurf_resume` 조건부 async default(0.7.6)와 external non-replyable sync-default/reject 경계가 agent 발화에 정확히 반영된다.
- 필요한 경우 README / AGENTS / VERIFY 중 한 곳에 운영 패턴으로 정리한다.

---

## Active hygiene — session continuity

같은 pi 세션을 resume할 때 실행 옵션이 달라지면 bridge config signature 가 달라져 ACP backend session 이 `incompatible_config` 로 invalidate 된다.

대표 footgun:

```bash
pi --entwurf-control --emacs-agent-socket server   # 평소 alias
pi                                                  # 테스트로 plain 실행
```

현재 결론:
- 사용자가 일관되게 alias 로 실행하면 문제 없음.
- 직접 원인 후보는 `--emacs-agent-socket server` 누락. 이 값이 `bridgeConfigSignature` 에 들어감.
- pi JSONL 세션은 남지만, Claude ACP backend 세션 매핑이 새로 만들어져 모델이 이전 맥락을 모르는 것처럼 반응한다.

다음 작업 후보:
1. `incompatible_config` 로그에 diff 출력 (예: `emacsAgentSocket: null -> "server"`) — 어떤 축 때문에 invalidate 됐는지 보여주기.
2. `PI_SHELL_ACP_STRICT_BOOTSTRAP=1` 운영 문서화 또는 UX 검토 — silent new 대신 fail-fast 로 잡을 수 있는지.
3. `emacsAgentSocket` 을 session compatibility 축에 넣는 게 맞는지 재검토.

검증 기준: alias 실행 → resume/load 유지 / plain 실행 후 alias 복귀 → 현재는 `incompatible_config`, 개선 후 원인 diff 명확 / `./run.sh verify-resume <project>` 또는 작은 live smoke 로 확인.

---

## Main backlog — #25 lessons from OpenClaw audit

OpenClaw 5.22 native `claude-cli` audit lesson 을 **pi-shell-acp 본체 품질**로 흡수한다 (plugin 확장이 아니라 bridge hygiene).

우선순위:
1. **Transcript pre-flight** — backend native jsonl 위치 verifier (Claude `CLAUDE_CONFIG_DIR`, Codex `CODEX_HOME`/`CODEX_SQLITE_HOME`, Gemini `GEMINI_CLI_HOME`).
2. **Invalidation reason taxonomy** — 지금 `incompatible_config` 가 너무 넓다. 후보: `auth-profile`, `auth-epoch`, `system-prompt`, `mcp`, `transcript-missing`, `emacs-socket`, `tool-surface`.
3. **Session cache hygiene** — `acp-bridge.ts` bridge session cache 에 idle timeout / LRU / max-N cap 검토.

나중 후보: fingerprint-keyed reuse (skills snapshot + extra system prompt hash 축); single-turn lock per session (같은 sessionId 동시 prompt 진입 throw).

---

## Reference paths

- 본체: `~/repos/gh/pi-shell-acp/`
- OpenClaw source: `~/repos/3rd/openclaw/`
- OpenClaw plugin stub: `plugins/openclaw/`
- Consumer: `~/repos/gh/agent-config/`
- NixOS consumer: `~/repos/gh/nixos-config/`

---

## Parked — do not pick unless GLG reopens

### OpenClaw plugin / packaging

- Phase 3.6 self-contained install
- ClawHub trust mark elevation
- plugin embedded runtime / child `pi` removal
- OpenClaw delivery layer progress/final channel split
- Oracle Docker image 3-layer install
- agent-config server-mode `pi-shell-acp` ref 복귀
- Gemini bot usage 표시 갭

이유: OpenClaw native `claude-cli` / `openai-codex` 가 이미 충분히 좋다. Gemini lane 은 필요 시 재개.

### Long-term / separate issues

- #11 remote SSH resume cwd alignment
- #10 broader ontology RFC
- #8 ACP `entwurf_send` message visibility UX
- #2 pi-first context meter
- L5 long soak with repeated context-pressure events
- Remote entwurf cleanup

---

## Closed baseline reminders

- `@junghanacs/pi-shell-acp@0.7.6` published (latest before 0.8.0 campaign).
- `@junghan0611/openclaw-pi-shell-acp@0.0.1` published 2026-05-21 (confirmed live on npm 2026-05-29), parked — no work since publish. README must reflect *published-but-parked*, not "not yet published" (OpenClaw track, GLG handles).
- Recommended routing as of 2026-05-26: Claude → OpenClaw native `claude-cli`; Codex → OpenClaw native `openai-codex`; Gemini → `pi-shell-acp` ACP lane if richer MCP/skill surface is needed.
