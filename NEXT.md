# NEXT.md — pi-shell-acp

> 다음에 할 일만 남긴다. 로그가 아니다.
> 결정 trace 와 evidence 는 commit history / CHANGELOG / VERIFY / BASELINE / README / AGENTS / 코드로 보낸다.
> 라이브 정보 (현재 release / 인보이스 형상 / API 표면) 는 README.md, CHANGELOG.md, AGENTS.md, `package.json`, `pi/entwurf-targets.json`, `pi/settings.reference.json` 에서 꺼낸다 — NEXT 에 복제하지 않는다.

## Reference paths

- **본체**: `~/repos/gh/pi-shell-acp/` — monorepo lite (root + `plugins/openclaw/`)
- **OpenClaw source**: `~/repos/3rd/openclaw/` — validated baseline `2026.5.18`, peer `>=2026.5.12 <2026.6.0`
- **Workspace baseline (검증 cwd)**: `~/repos/gh/openclaw-config/config/workspace/`
- **ACP backend source**: `~/repos/3rd/acp/` — `claude-agent-acp/`, `codex-acp/`, `gemini-cli/`, `agent-shell/`, `acp.el`, `zed/`, `obsidian-agent-client/`
- **Consumer**: `~/repos/gh/agent-config/`

---

## Top priority — 0.7.5 dependency-audit-driven patch release

Trigger: [#24 dep audit](https://github.com/junghan0611/pi-shell-acp/issues/24). 외부 upstream 흡수 — `@earendil-works/pi-ai|coding-agent|tui` `0.74.0 → 0.75.4`, `@agentclientprotocol/claude-agent-acp` `0.33.1 → 0.36.1`, `@agentclientprotocol/sdk` `0.21.0 → 0.22.1`. 우리 표면 (`piShellAcpProvider` settings / MCP injection contract / sessionId addressing / invariants) 안 바뀌면 **patch** — semver minor 갈 수준 아니므로 `0.7.4 → 0.7.5` one-shot 결정 (GLG 2026-05-21).

**라운드 묶음:**
- `7c6903c` ✅ `fix(package): revert pi.image to demo.gif` ([#22](https://github.com/junghan0611/pi-shell-acp/issues/22) image 항목; shields.io 배지 처리는 별도)
- `c57121f` ✅ `docs(openclaw): document child skill PATH + emacs socket env contract` ([#21](https://github.com/junghan0611/pi-shell-acp/issues/21) docs portion)
- **남은 작업** (이 라운드 안에서):
  - [#24](https://github.com/junghan0611/pi-shell-acp/issues/24) §2~§5 의 흡수 자리들 — `event-mapper.ts` `agent_end` + `willRetry`, `engraving.ts` / `pi-context-augment.ts` vs pi 0.75 XML boundary, sdk 0.22 schema v0.13.2 + event ordering, claude-agent-acp 0.35 plan-state hook + SDK settings resolution + 0.36 session delete experimental + `additionalDirectories`

**Post-0.7.5 follow-up (이 라운드에 포함 안 됨):**
- [#21](https://github.com/junghan0611/pi-shell-acp/issues/21) plugin-side env preparation 코드 fix — PATH augmentation + emacs socket detection on ACP child spawn. docs portion (`c57121f`) 은 이 라운드에 landed; 코드 fix 는 별도 라운드 (0.7.6 candidate). nixos-config consumer workaround ([3477206](https://github.com/junghan0611/nixos-config/commit/3477206)) 가 동작 중이므로 0.7.5 release blocker 아님. dep audit release 빠르게 닫는 우선.

**작업 순서 ([#24](https://github.com/junghan0611/pi-shell-acp/issues/24) §8):** Step 1 (codex-acp zero-risk + MCP SDK floats) → Step 2 (sdk 0.22) → Step 3 (pi 0.75) → Step 4 (claude-agent-acp 0.36). 각 step 후 `pnpm check` + 가능하면 small reproducer.

**Baseline preservation 시험** ([#24](https://github.com/junghan0611/pi-shell-acp/issues/24) 2026-05-21 baseline cmt 기준):

| 자리 | baseline GREEN signal | 흡수 후 회귀 시험 |
|---|---|---|
| 세션 연속성 | gateway 13h+ uptime, `Compactions: 0` | 새 dep set 재시작 후 같은 수준 유지하는지 |
| Prompt cache hit | 96% (859k cached + 35k new) | claude-agent-acp SDK settings resolution 변화가 cache key 패턴 영향 주는지 |
| Active memory | `status=ok elapsed≈10s query=...` | pi 0.75 XML boundary 변화 후 형태 유지하는지 |
| Role-preserving prompt | 8b25c1e 결과 — user role 변환된 memory 자연 인용 | system prompt assembly 변화 후 동작 유지 |
| Token accounting | `Tokens: N in / M out` | event settlement awaited lifecycle 변화 후 형식 동일 |
| `agent_end.willRetry` | (새 필드, baseline 시점 zero hit) | 새 필드가 들어와도 event-mapper noise zero |

**Publish gate:**
- `check-dep-versions` 6 assertions 통과 — package.json + run.sh + README 세 자리 동시 갱신
- nixos-config consumer-side workaround ([3477206](https://github.com/junghan0611/nixos-config/commit/3477206)) 가 새 dep set + pi 0.75 lifecycle script hardening 과 정합 유지 확인
- npm publish `@junghanacs/pi-shell-acp@0.7.5` — 본인 npm scope, blocker zero

**0.7.5 RELEASE CLOSED ✅** — `@junghanacs/pi-shell-acp@0.7.5` published 2026-05-21 (commit `412cc50`, tag `v0.7.5`, registry latest, Google Chat thread `ZtpDz4j2UxQ`). Tier B full verification (smoke-all + verify-resume + check-bridge + sentinel 6/6 + session-messaging 4/4) all GREEN.

**Phase 3.4 (plugin publish) — unblocked 2026-05-21 by scope pivot to `@junghan0611`** (next box).

---

## Phase 3.4/3.5 — OpenClaw plugin publish ([#23](https://github.com/junghan0611/pi-shell-acp/issues/23): RESOLVED via scope pivot)

**Status (2026-05-21, RESOLVED):** ClawHub `@junghanacs` handle release remains RFC-bound (timeline weeks-months, [openclaw/clawhub#2346](https://github.com/openclaw/clawhub/issues/2346) ClawSweeper v3 + RFC [#2320](https://github.com/openclaw/clawhub/issues/2320) / [#2333](https://github.com/openclaw/clawhub/issues/2333)), so the plugin pivots to a new owner identity instead of waiting. Decision ([#23](https://github.com/junghan0611/pi-shell-acp/issues/23)): **plugin npm scope = `@junghan0611`, ClawHub publisher = `junghan0611`** — one npm account (`junghanacs`) now holds two scopes (`@junghanacs` for root, `@junghan0611` free public org for plugin). Root `@junghanacs/pi-shell-acp` untouched (pi has no equivalent registration constraint).

Landed in this commit batch (commit `91561a6`):
- `plugins/openclaw/package.json` — `name` → `@junghan0611/openclaw-pi-shell-acp`, `version` → `0.1.0`, `private` removed, `publishConfig.access: public` added, `openclaw.compat.minGatewayVersion: 2026.5.12` added (D4)
- `plugins/openclaw/LICENSE` — MIT, copy of root (was listed in files but missing on disk)
- `plugins/openclaw/README.md` — user-facing "A note on the two npm scopes" section
- `plugins/openclaw/AGENTS.md` — "Scope Divergence Rationale" maintainer section + updated Canonical Owner

**Remaining Phase 3.4 next turn:**

> Run dry-runs from `plugins/openclaw/`:
> ```
> npm pack --dry-run --json
> npm publish --dry-run --access public
> clawhub package publish . --dry-run --json --owner junghan0611
> ```
> All clean → live publish:
> ```
> npm publish --access public                           # → @junghan0611/openclaw-pi-shell-acp@0.1.0
> clawhub package publish . --owner junghan0611         # → ClawHub publisher = junghan0611
> ```
> No `publisher create` step needed first — `clawhub whoami` already returns `junghan0611` (GitHub login). `publishToClawHub`/`publishToNpm` flags in `openclaw.release` left at `false` because we publish via the CLIs directly. Post-publish: README install section update (npm + ClawHub install paths), Phase 3.5 marked closed.

**Fresh ClawHub findings (2026-05-20):**
- Two install paths exist. `openclaw plugins install clawhub:<package>` is the official ClawHub/trust path; bare `openclaw plugins install <package>` is npm/cutover or ClawHub-first depending on doc page. **Doc conflict to resolve:** `docs/plugins/manage-plugins.md` says bare tries ClawHub first then npm fallback, while `docs/plugins/building-plugins.md` / `docs/cli/plugins.md` still describe npm-by-default launch cutover. Npm publish alone is not the final OpenClaw-native distribution.
- ClawHub publish is owner-scoped. Package scope must match selected owner. For `@junghanacs/openclaw-pi-shell-acp`, ClawHub owner `@junghanacs` must exist / be publishable before finalizing the package name. `curl -I https://clawhub.ai/junghanacs` currently returns 404; CLI auth/owner check still required.
- `clawhub` CLI is now installed globally on this host (`/home/junghan/.local/share/pnpm/clawhub`, v0.17.0) — `npx -y` prefix 불필요. `clawhub whoami` requires login. (어제 fresh finding 시점엔 미설치였음.)
- Current plugin dry-run shape before edits: `npx -y clawhub@0.17.0 package publish plugins/openclaw --dry-run --json` succeeds locally and reports source `github:junghan0611/pi-shell-acp@v0.7.4:plugins/openclaw`, name `@junghanacs/openclaw-pi-shell-acp`, version `0.6.0`, 9 files, 44333 bytes. This proves local packaging shape only; it does **not** prove owner permission/review/security outcome.
- OpenClaw `@openclaw/plugin-package-contract` code requires only `openclaw.compat.pluginApi` and `openclaw.build.openclawVersion`. It normalizes `compat.minGatewayVersion` from `install.minHostVersion` when absent. `build.pluginSdkVersion` is optional metadata, and `@openclaw/plugin-sdk` is not published on npm; decide whether to add it as explicit canonical metadata (`2026.5.18`) or omit because this external stub cannot depend on SDK.

**3.4 decision lock (GPT ↔ Claude 합의, 2026-05-20):**
- D1 owner pre-flight: ✅ **resolved 2026-05-21 ([#23](https://github.com/junghan0611/pi-shell-acp/issues/23))** — plugin owner pivoted to `junghan0611` (npm org + ClawHub publisher); `clawhub whoami` already returns `junghan0611`, no `publisher create` needed.
- D2 publish toggles: ⚠️ **갱신 (2026-05-21, [#23](https://github.com/junghan0611/pi-shell-acp/issues/23))** — 직접 `npm publish` + `clawhub package publish . --owner junghan0611` 호출. `release.publishTo*` flags 둘 다 `false` 유지 (CLI 직접 호출 패턴 사용).
- D3 `build.pluginSdkVersion`: 생략. 외부 stub 은 SDK npm dependency 가 없고 `@openclaw/plugin-sdk` 도 npm 미공개라 honest 반영. README 에 의도적 생략 사유 한 줄 추가.
- D4 `compat.minGatewayVersion`: 명시 추가. 값은 `2026.5.12` 후보 — compatibility floor 를 reader 가 fallback 추적 없이 읽게 한다.
- D5 provider manifest extras: 새 Claude 가 `sdk-provider-plugins.md` 읽고 `modelSupport` / `providerRequest` / auth metadata 필요성을 판단한 뒤 patch proposal → GLG 결정.
- D6 publish surface order: ✅ **restored 2026-05-21 ([#23](https://github.com/junghan0611/pi-shell-acp/issues/23))** — scope pivot to `@junghan0611` removed the RFC dependency, so npm + ClawHub publish can land in the same round again. Phase 3.4 = npm + ClawHub (`junghan0611` owner), Phase 3.5 = trustedSourceLinkedOfficialInstall verification.
- D7 NEXT commit: 이 NEXT 정렬은 별도 self-contained commit 후보 (`docs(next): phase 3.4 entry — clawhub pre-flight + dual dry-run`). 실제 metadata 변경과 섞지 않는다.
- D8 upstream doc conflict: 우리 publish 와 분리. 양쪽 surface 를 모두 만족시키므로 block 아님. 별도 sprint 로 OpenClaw docs issue/PR 후보.

**Owner identity status (2026-05-21, RESOLVED via scope pivot):**

**Plugin owner = `junghan0611`** (npm scope + ClawHub publisher). One npm account (`junghanacs@gmail.com`) holds two orgs: `@junghanacs` (personal — root) and `@junghan0611` (free public, admin = `junghanacs` — plugin). `npm org ls junghan0611 --json` → `{ "junghanacs": "owner" }`. `clawhub whoami` → `junghan0611` (GitHub login already valid). No `publisher create` step needed; the personal-owner mapping is sufficient for ClawHub publish via `--owner junghan0611`.

**Root owner = `@junghanacs` unchanged** — root never required ClawHub registration. Root namespace stays on `@junghanacs/pi-shell-acp` indefinitely; only the plugin pivoted to satisfy ClawHub's "scope must match selected owner" rule.

**Why pivot beat waiting:** ClawHub `@junghanacs` handle release was bound to RFC outcome (weeks-months, [openclaw/clawhub#2346](https://github.com/openclaw/clawhub/issues/2346) ClawSweeper v3 + [#2320](https://github.com/openclaw/clawhub/issues/2320) / [#2333](https://github.com/openclaw/clawhub/issues/2333) test-locked conflict at `convex/publishers.test.ts:1746`). Pivot is reversible later via `clawhub package transfer @junghan0611/openclaw-pi-shell-acp --to junghanacs` once the RFC lands and `@junghanacs` becomes claimable; this is recorded as a Cross-repo follow-up rather than a blocker on Phase 3.4.

**Historical trace (2026-05-20):** GLG attempted `clawhub publisher create junghanacs ...` → ConvexError: `Handle "@junghanacs" is already used by a user or personal publisher` (legacy account, soft-deleted). Treated as RFC-bound for ~24 hours, then resolved 2026-05-21 by accepting the divergence and creating npm org `junghan0611` (web UI; `npm org create` CLI does not exist).

**Phase 3.3 skipped — false premise.** SDK helper check already showed `@openclaw/plugin-sdk/process-runtime` is private/workspace-only, so external npm plugin cannot depend on it. Raw `spawn` remains acceptable for the prerelease stub; Phase 1.4 removes the child-`pi` spawn surface anyway.

---

## Phase 3 — OpenClaw plugin formal registration (active sprint)

| # | 작업 | 상태 |
|---|------|------|
| 3.1 | pi-shell-acp pi.dev 등록 push | ✅ closed (2026-05-19, gallery card 등장; 2026-05-20 hero 이미지 surface 정합) |
| 3.2 | bbot active-memory empty-final fix + role-preserving prompt (#20) | ✅ closed (2026-05-20, `e7eefeb` + `8b25c1e`; oracle bbot GREEN) |
| 3.3 | `@openclaw/plugin-sdk/*` sanctioned spawn helper 확인 | ⏭ skipped (2026-05-20, SDK `private: true` / `workspace:*` only — 우리가 reach 못함) |
| 3.4 | `@junghan0611/openclaw-pi-shell-acp` npm publish | 🔥 **active** (commit `91561a6` landed scope pivot + 0.1.0 reset; remaining = dry-run + publish — [#23](https://github.com/junghan0611/pi-shell-acp/issues/23)) |
| 3.5 | ClawHub 정식 등록 (publisher `junghan0611`) → `trustedSourceLinkedOfficialInstall` 경로 통과 | 3.4 publish 직후 — `clawhub package publish . --owner junghan0611` |
| 3.6 | Self-contained install — `openclaw plugins install @junghan0611/openclaw-pi-shell-acp` 한 줄 UX. plugin package 가 `acp-bridge.ts` 를 직접 import 하여 bridge runtime 을 품음. child `pi` binary 의존 제거 | 3.5 + Phase 1.4 ts refactor 완료 후 |
| 3.7 | CHANGELOG plugin entry + VERIFY 갱신 + invariant 보강 | 3.6 완료 후 |

### 3.4 entry checklist (별도 라운드)

publish 진입 전 결정/작업:

1. **Plugin version reset** — ✅ landed (commit `91561a6`): `0.6.0 → 0.1.0`, `private` removed, `@junghan0611` scope.
2. **Prerelease tag 정책** — 잠정 `0.1.0` 일반 publish + README "prerelease/alpha" 명시 유지. ClawHub 정식 등록 (3.5) 이 진짜 trust gate.
3. **ClawHub pre-flight** — ✅ resolved via pivot ([#23](https://github.com/junghan0611/pi-shell-acp/issues/23)):
   - `clawhub whoami` → `junghan0611` (GitHub login, 이미 valid)
   - `clawhub package publish . --owner junghan0611` 직접 호출 — `publisher create` 별도 step 불필요 (personal owner mapping)
4. **Metadata canonical 정렬** — ✅ landed (commit `91561a6`): `compat.minGatewayVersion: 2026.5.12` 명시 추가. `build.pluginSdkVersion` 의도적 생략 유지. `openclaw.plugin.json` publisher/owner field 는 schema 확인 전엔 손대지 않음 (GPT 검토 권고).
5. **Plugin publish gate** — 다음 라운드:
   - `cd plugins/openclaw && npm pack --dry-run --json` (10 files 정합 확인)
   - `npm publish --dry-run --access public`
   - `clawhub package publish . --dry-run --json --owner junghan0611`
   - 셋 다 클린 → 실제 publish
6. **README publish-ready 정합** — 부분 landed (scope divergence note 추가됨); publish 후 추가:
   - Install 섹션에 `npm install @junghan0611/openclaw-pi-shell-acp` + `openclaw plugins install clawhub:@junghan0611/openclaw-pi-shell-acp` 경로 추가
   - Status 를 "prerelease/alpha" → "released prerelease" 로 갱신
   - 호환 매트릭스 갱신: plugin `0.1.x` ↔ root `@junghanacs/pi-shell-acp@>=0.7.5` ↔ OpenClaw validated `2026.5.18`, floor `>=2026.5.12 <2026.6.0`
7. **OpenClaw host 측 deploy 의존** — 명시는 publish-time 별도 round: host/container 에 root `@junghanacs/pi-shell-acp@>=0.7.5`, `pi`, `codex-acp`, `gemini` 필요. Plugin `0.1.x` 는 child `pi` 호출 형태 (Phase 1.4 에서 embedded 로 swap).

### Plugin ↔ 본체 scope / 버전 정합 (SSOT)

**결정 (2026-05-19 PM)**: plugin 별도 lifecycle + 첫 publish `0.1.0` reset. **결정 (2026-05-21 [#23](https://github.com/junghan0611/pi-shell-acp/issues/23))**: plugin scope pivot — `@junghanacs` → `@junghan0611`.

| | npm scope | first publishable version | pi-shell-acp 본체 version | 비고 |
|---|---|---|---|---|
| **Root** | `@junghanacs` | `0.7.5` (published) | — | npm only, ClawHub 등록 무관 |
| **Plugin** | `@junghan0611` ← 2026-05-21 pivot | **0.1.0** (in flight) | **>=0.7.5** | npm + ClawHub. publisher `junghan0611` (GitHub login) |
| Plugin 0.2.x (예정) | `@junghan0611` | 0.2.x | >=0.8.0 (예정) | Phase 1.4 SDK 도입 후 swap 시점 |

이유 (한 줄씩):

- Plugin 별도 lifecycle: 이미 별도 진화 중 (plugin 0.6.0 vs 본체 0.7.5). partial sync 가 가장 혼란. 0.6.0 은 본체 trajectory 안의 작위적 숫자였고 first publish 라 `0.1.0` 이 honest.
- Plugin scope `@junghan0611`: ClawHub publisher handle (`junghan0611`) 과 npm scope 정합 필요 (ClawHub rule "scope must match owner"); `@junghanacs` ClawHub handle 이 RFC 의존 (weeks-months) 이라 pivot.
- Root scope `@junghanacs` 유지: ClawHub 등록 무관이라 pivot 비용 zero benefit. 0.7.5 stable baseline 보존.

폐기된 옵션 (참고): (i) `@junghanacs` ClawHub handle release 대기 — RFC 의존 weeks-months. (ii) `@junghan-garden` 임시 handle + 향후 transfer — identity 분열 + transfer 비용. (iii) plugin version 본체와 sync — partial sync 가 가장 안 좋은 패턴.

---

## Envelope identity sanitation (#19, 별도 sprint)

> [Issue #19](https://github.com/junghan0611/pi-shell-acp/issues/19) — 2026-05-19 oracle Stage 1 검증 turn 의 bbot schema-level 단서 분석으로 발견. 세 발견 모두 의도되지 않은 동작이므로 버그.

| # | 회귀 | 영향 |
|---|---|---|
| 1 | `PI_AGENT_ID` env 상속 — entwurf spawn 시 child 의 새 (provider/model) 로 override 안 함 | 분신 self-report hallucination (Codex 가 자기를 Claude 라 보고) |
| 2 | `PI_SESSION_ID` stale — MCP bridge child 가 spawn 시점 env 캐싱, 부모 갱신 catch 안 함 | `entwurf_self.sessionId` 가 부모 실제와 불일치, reply target 정합 깨짐 |
| 3 | `socketPath` fictional — `entwurf_self` 가 control socket 활성 검증 없이 path 반환 | 비활성 세션도 socketPath 반환 → caller 가 trust 시 `entwurf_send` fail |

→ 같은 surface (envelope identity) 라 묶어서 진행. **분리 sprint 로 결정** (#20 close 시점, 2026-05-20). Phase 3 packaging 안정 후 진행 — packaging block 안 함. 0.7.4 root cut 에 흡수하지 않음.

**Agent quality 에 의존하면 안 되는 invariant**: bbot 의 reasoning quality 가 schema-level 단서로 self-report hallucination 을 잡았지만, 평범한 분신은 못 잡을 수 있음. 평범한 분신도 깨지는 정합 회귀.

---

## 확정 사실 모음

- **Plugin npm 이름**: `@junghan0611/openclaw-pi-shell-acp` (2026-05-21 pivot from `@junghanacs/...` — see [#23](https://github.com/junghan0611/pi-shell-acp/issues/23) and § "Plugin ↔ 본체 scope / 버전 정합" table for rationale)
- **Plugin ClawHub publisher**: `junghan0611` (GitHub login, matches npm scope)
- **Plugin 디렉토리**: `plugins/openclaw/` — monorepo lite, `pnpm-workspace.yaml` `packages: ["plugins/*"]`. 의미: `pi-shell-acp` = pi 의 *extension*, `plugins/openclaw` = host 어댑터. `packages/` 어휘 충돌 회피.
- **OpenClaw peer**: `>=2026.5.12 <2026.6.0`. Validated baseline `2026.5.18`; 5.7~5.11 호환 포기.
- **pi-ai dep (plugin)**: `@earendil-works/pi-ai@0.74.0` (5.12 align).
- **Plugin configSchema default**: `mcpInjection: "self"`, `lockConflictPolicy: "strict"`.
- **Install trust path**: 정식 등록만. `dangerouslyForceUnsafeInstall` flag UX 사용자 권장 안 함.
- **README guardrail (plugin 측)**: acpx alternative 톤, pi 단어 마케팅 zero, 클로드코드 구독 멘트 금지.
- **README guardrail (root pi-shell-acp 측)**: "no core patch and no bypass" / MCP narrow surface / capability vs surface 명시.

---

## Cross-repo follow-ups (별도 추적)

- **ClawHub `@junghanacs` handle RFC outcome 추적 + future scope re-unification** — RFC [#2320](https://github.com/openclaw/clawhub/issues/2320) / [#2333](https://github.com/openclaw/clawhub/issues/2333) outcome 박힐 때 `@junghanacs` ClawHub handle 이 claimable 해지면 plugin scope 를 `@junghan0611` → `@junghanacs` 로 재정렬 가능. 경로: `clawhub package transfer @junghan0611/openclaw-pi-shell-acp --to junghanacs` + npm 측 deprecation/redirect (`npm deprecate @junghan0611/openclaw-pi-shell-acp "moved to @junghanacs/..."`). 이건 weeks-months 후의 옵션이고, 0.7.x 동안엔 진행 X — 분열을 maintain 하는 게 더 cheap. [#23](https://github.com/junghan0611/pi-shell-acp/issues/23) 참조.

- **Gemini bot usage 측정 OpenClaw 표시 갭** — bbot DIAG stderr 에 `meter=acpUsageUpdate ... used=24315 size=1000000 raw: input=13 output=591 cacheRead=54834 cacheWrite=14346` 정상 도착. 그러나 OpenClaw status bar 의 `📚 Context: ?/200k` 로 표시 (`?`). 분석 영역: (a) plugin `streamSimple` 의 final `message.usage` 에 정확히 전달되는지, (b) OpenClaw status renderer 의 model picker 가 plugin provider 의 usage 매칭하는지 (provider id `pi-shell-acp` 로 lookup 시 missing 인가). "어제도 봤던 버그" — 알려진 잔존 이슈.

- **OpenClaw delivery layer — final-text 정규화 + progress 채널 분리** — 정공법 합의 (2026-05-18 PM GPT힣 PM 검토): `showToolNotifications: true` 유지 (progress 가시성) + OpenClaw/bot 의 outgoing message layer 에서 `[tool:*]` notice 필터링 또는 progress channel 을 final 채널과 분리. 본체 코드 정합 (`index.ts:621` `?? false → ?? true`, 2026-05-19) 끝. 다음 라운드는 OpenClaw delivery layer 측 작업. #20 + follow-up leak 봉인 후 (`e7eefeb` + `8b25c1e`, 2026-05-20) 우리 측 visible-layer 작업은 정합 — 남은 progress noise / `[tool:*]` 노출 정책은 OpenClaw 측 별도 라운드.

- **pi CLI `--new-session` 표면 검토** — `pi -p "..." --session <new-id>` lookup-only. pi 자체 시멘틱 갭. pi-ai / pi-coding-agent 레벨 issue 후보.

- **`ctx.messages` SSOT 모델 공식화** — plugin spec 으로 명시 가치. 다른 backend (Codex/Gemini) 도 같은 모양 plug-in 가능.

- **OpenClaw compose default 검토** (Docker auth boundary) — 공개 install 가이드의 기본 권장이 in-container login 인지 host passthrough 인지. Claude Code auth refresh 가 read-only mount 에서 동작하는지 검증. 우리 측 의견: `plugins/openclaw/README.md` 의 Docker boundary 표 참고.

- **Long-lived session 시 entwurf scope** (Phase 1.4 또는 이후) — plugin path 가 현재 `--no-session` 으로 entwurf 표면을 자연 차단. 미래 long-lived ACP session 으로 가면 두 갈래 결정: (I) entwurf 를 plugin 의 child pi 안에서 그대로 활성화 (isolated topology, root AGENTS.md #9 정합) vs (II) entwurf 호출을 OpenClaw peer API 로 forward (host-coupled, #9 위반). 현재 정책 = I. (II) 는 OpenClaw SDK enhancement 필요, 지금 결정 안 함.

- **Telegram delivery bridge 정식화** (Phase 1.4) — Phase 1.8 응급 다리로 child pi final text → synthetic OpenClaw `message` toolCall 변환을 stub 에 넣음 (`pi-shell-acp-message-*`, toolResult 후 즉시 `end_turn`). 정식 작업에서 OpenClaw `context.tools` / provider tool surface 를 pi-shell-acp transport 에 연결하는 **일반 tool bridge** 로 승격. 지금 패치는 Telegram/message-tool-only path 를 뚫기 위한 prerelease shim. 남은 UX debt: tool trace 노출, `<system-reminder>`류 prompt hygiene, `HEARTBEAT_OK` 같은 session sentinel 이 child prompt 에 섞이는 문제.

- **Oracle Docker image 3-layer install** (Oracle config repo 측) — openclaw-gateway 컨테이너에 `pi`, `pi-shell-acp`, `codex-acp`, `gemini` 추가. `git` system pkg + pnpm global. 자세한 layout 은 `plugins/openclaw/AGENTS.md` § Install layers. Oracle 측 작업, 우리 측 plugin 코드 변경 없음.

- **agent-config server-mode `pi-shell-acp` ref 복귀** (Phase 3 release 후) — 현재 `agent-config 5f17d70` 가 server-mode 에서 main 추적 정책. Oracle 호스트가 우리 push 를 자동 follow. **prerelease / Oracle 검증 동안 임시**. Phase 3 의 ClawHub 등록 후 release tag (`git:...pi-shell-acp@v0.x.y` 등) 로 다시 ref pinning 으로 복귀. 잊으면 server 가 영원히 main 추적 — release 후엔 안 좋은 정책.

- **pi-tools-bridge MCP async surface** (0.7.x or 0.8.0 candidate) — 외부 MCP host (Claude Code / Codex / Gemini CLI) 에서 `entwurf` 가 sync-only (`mcp/pi-tools-bridge/index.ts` 의 tool description 이 honest 하게 명시). 다음 라운드: (1) MCP tool 에 `mode` 파라미터 노출, (2) `entwurf_status` MCP tool 추가, (3) ACP follow-up notification 채널로 완료 알림 surface 가능한지 조사 (Claude Code MCP host 의 notification 채널 지원 여부 의존). 호환성: 변경 시에도 sync default 유지하되 explicit `mode=async` 가능하게.

- **Remote entwurf follow-up cleanup** (2026-05-18 remote shell-quote 긴급 패치 후 잔여):
  - (a) `shellQuote` 3중 중복을 `pi-extensions/lib/shell-quote.ts` 로 통합. `check-shell-quote` 가 source parity 강제 중.
  - (b) Async remote resume 에도 `PARENT_SESSION_ID` carrier 전달 여부 결정.
  - (c) `#11` remote resume saved-header cwd 정렬 smoke/fix.
  - (d) **Remote home parity 제거** — `os.homedir()` 로 로컬 home 을 absolute 화해서 SSH 너머 전달 (불가피한 임시). NixOS 균질 환경 (`/home/junghan` 모든 호스트 동일) 에선 OK, mixed-OS / 다계정 환경 확장 시 깨짐. 진짜 해결은 remote `$HOME` query 또는 absolute-only 강제.
  - (e) **Remote 자동 smoke 게이트** — 현재 native/ACP × sync/async × spawn/resume remote 경로의 자동 회귀 게이트 없음. `./run.sh check-remote-entwurf <host>` 식 manual gate 추가 검토.

---

## Reference docs (Phase 3 입력)

- **pi.dev packages 규칙**: `~/repos/3rd/pi/pi-mono/packages/coding-agent/docs/packages.md` — manifest 키, peer dep, files allowlist, source type 3종 (npm/git/local), gallery metadata.
- **Sample 패키지** (`~/repos/3rd/pi/`):
  - `pi-packages/packages/pi-synthetic-provider/` — provider extension, scope 패키지. 가장 가까운 참고.
  - `agent-stuff/` (mitsupi) — multi-resource (extensions + skills + themes + commands). 확장 참고.
  - `pi-telegram/` — minimal extension.
  - `pi-packages/packages/{pi-firecrawl, pi-exa-mcp, pi-claude-code-use, ...}/` — 다양한 pi extension 패턴.

---

## Parked, Not Current

- **#11** remote SSH resume cwd alignment
- **#10** broader ontology RFC (`peer handle`, `contact_peer`, registry). cwd-authority 부분은 0.4.17 landed.
- **#8** ACP `entwurf_send` message visibility UX — 2026-05-16 `e31823c` 로 ACP path 의 late `[entwurf sent →]` customMessage 승격 비활성화. in-stream `[tool:start]/[tool:done]` notice 로 회귀. 재진입 조건: pi 가 in-stream passive UI append/update path 를 마련하면 다시 검토.
- **#2** pi-first context meter, post-0.5.0
- **L5 long soak** with repeated context-pressure events and sentinel recall, likely 0.6.x or later
