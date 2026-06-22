# NEXT — `entwurf-rename` · 단일 액션 플랜 (rename `pi-shell-acp` → `entwurf`: pi 탈중심화)

> **상태:** 치환 **0건** · 형제 교차검수(**GPT GO + 비봇 GO** 수렴) · 영속저장소 패스 완료. **⚠️ 정정(2026-06-22): consumer = "openclaw 배포 family" 클래스** (agent-config 하나 아님) — `~/repos/{gh,work,3rd}` 전수 grep으로 **openglg-config + work/hejdev6-openclaw + hej-kip** 발견(§4-B). 공통 shape = provider config + npm install → **npm 패키지명 rename이 최대 blast**. agent-config discovery는 닫혔고, 배포군 functional 나열만 S1 prep으로 남음. 그 외 = §6 GLG 결정 3건 + 일격.
> 분기점 `acp-on-v2` `a893318`(CP1 lock, 원격 봉인). operator 세트·영속 invariant SSOT = `ROADMAP.md`.

---

## 0 · 미션 & 교리

**미션:** `pi-shell-acp` repo를 `entwurf`로 rename. 단순 패키지명 교체가 아니다 — pi-중심 네이밍을 걷어내고 `entwurf`를 주어로 세운다. *"pi는 4번째 하네스일 뿐, entwurf capability는 하네스 무관."*

**원칙:** "pi"는 *pi 하네스 adapter / pi-runtime / upstream 계약*일 때만 남긴다. 이 repo가 소유한 *garden citizen · identity · dispatch · bridge capability*는 **entwurf가 주어**. → "pi 제거"가 아니라 **"pi를 adapter로 격하, entwurf를 capability 주어로."**

**교리 — 일격필살 (담금질 후 한 방):** S1은 **한 atomic commit, green-first-try, 중간 거짓상태 0**. 네이밍이 핵심이라 한 번에 정확히. 그 전까지 나열(담금질)을 충분히 조인다.

**실행 법칙 — "정확히 나열 후 치환":**
- 모든 토큰·변종·엣지케이스를 빠짐없이 *나열*하고 exhaustive 확인 **후에야** 결정적 일괄 치환.
- **blind `s/pi-/entwurf-/` 금지** — full-token exact only (KEEP군 오염 방지).
- 각 stage 후 **양방향 검증**: 잔존 `rg`(RENAME군 0이어야) + KEEP allowlist `rg`(남아야 정상).
- **게이트 = rename과 같은 commit** (결합 규칙, silent red 금지).
- 방법 = grep token matrix + 검수 + 게이트. AST codemod 단독 부적합(대부분 문자열 계약).

---

## 1 · 불변 원칙 (담금질 산물 — 미래 구현자가 깨기 쉬운 3 지점)

**① hard-cut(repo) ⟂ dual-accept(consumer history-reader) — 모순 아니라 직교·상보.**
- repo = 살아있는 라우팅 정체성 → **hard-cut, permanent alias 금지**(AGENTS Hard Rule 1).
- consumer history-reader = 불변 과거를 읽음 → **old ∪ new 영구 dual-accept**(역사 불변이라 *영원히* 둘 다).
- ⚠️ **함정:** 누군가 Hard Rule 1을 읽고 `session-recap`의 `pi-shell-acp` 수용을 "residue"로 청소 → **과거 recall이 조용히 끊김**(runtime failure 아니라 기억 손실 = 더 나쁨). dual-accept는 alias가 아니라 *historical-compat*.
- **AGENTS 반영 문구 (GPT 확정, §6-②에서 GLG 승인 후 양쪽 repo 적용):**
  > *"No permanent runtime alias" does not forbid historical readers from accepting old provider strings. Transcript/session/agenda/semantic-memory readers MUST dual-accept immutable historical names (`pi-shell-acp`) and current names (`entwurf`); that is historical compatibility, not routing aliasing.*

**② 3축 분류 — 직교한다.** 단어 *출처*(capability=RENAME / adapter=KEEP) × *env taxonomy*(§3) × *의미방향*(positive/negative).
- **의미방향이 핵심:** 토큰을 코드가 *positive*(있어야/같아야)로 검사하면 어긋날 때 게이트 **RED=loud**; *negative*(없어야/forbidden)로 검사하면 치환 시 **green인 채 inert=silent**. silent 부류만 위험.
- **실증 de-risk:** silent negative-guard 클래스는 **repo 내부 공집합**(§2 KEEP-old). rename 표면은 압도적 loud-lockstep.

**③ identity = garden-id-keyed → rename-immune (설계가 곧 안전판).** meta-records/mailbox는 `<pi-agent-dir>/meta-{sessions,mailbox}/<gardenId>`(패키지명 무관). 비대칭공존 설계(denote식, DB 없이 패키지명에 의미 안 실음)가 rename으로부터 정체성을 보호. orphan 위험 = ACP reuse 캐시 **1경로**뿐(§5 S1 migration).

---

## 2 · 나열 — 토큰 매트릭스 (수치는 rough; **S1 직전 fresh `rg`로 전수 재확인** 후 치환)

### RENAME → entwurf (정체성 / 하네스 무관 capability)
| 토큰 (변종) | → |
|---|---|
| `pi-shell-acp` (kebab) | `entwurf` |
| `piShellAcp…` (camel, =`piShellAcpProvider`) | `entwurfProvider` |
| `PiShellAcp` (Pascal) | `Entwurf` |
| `PI_SHELL_ACP_*` (SCREAMING env, 실측 27개) | §3 taxonomy 참조 |
| `pi_shell_acp` (snake) | `entwurf` |
| `pi-tools-bridge` (MCP dir/서버명) | `entwurf-bridge` |
| `mcp__pi-tools-bridge__*` (tool id/allow) | `mcp__entwurf-bridge__*` |
| `PI_TOOLS_BRIDGE_*` (3) · `PI_ENTWURF_*` · `PI_META_*` | §3 |
| Symbol `"pi-shell-acp.acp-provider.registered"` | `"entwurf.…"` |
| repo URL `github.com/junghan0611/pi-shell-acp` | `…/entwurf` |
| compound `pi-shell-acp-{demo,smoke,hero,no-auth,doomemacs,release-gate}` | `entwurf-…` |
| model prefix `pi-shell-acp/claude-…` | `entwurf/claude-…` |

### KEEP pi (남아야 정상 — adapter / runtime / upstream)
`pi-native` · `pi-session` · `PI_SESSION_ID` · `PI_AGENT_ID` · `pi-coding-agent` · `PI_CODING_AGENT_DIR` · `pi-core`/`pi-mono`/`pi-tui` · `PI_SETTINGS_PATH` · `PI_EMACS_AGENT_SOCKET` · `pi-extensions/` · `pi-context-augment` · `--entwurf-control`(pi-core flag) · `pi-acp`(svkozak 외부).

### MOVE-lockstep (positive 기대값 — 값 + *검사처*를 같은 commit에, 어긋나면 RED=loud)
- `getRegistryRouting`/extension-spec: `entwurf-core.ts:1060` `if (target.provider !== "pi-shell-acp")` + `:1070` `resolveExplicitExtensionSpec("pi-shell-acp")` → 미치환 시 `Unknown provider`로 **즉사**(#29).
- **no-auth sentinel 값 `"pi-shell-acp-no-auth"` = 3-site 하드코딩:** `models.ts:29`(const) + `check-acp-provider-surface.ts:49`(drift assert) + `run.sh:1314/1319`(source-scan).
- `run.sh:30 PROVIDER_ID` · `Symbol.for("pi-shell-acp.acp-provider.registered")` · 게이트 기대값(`check-package-source-routing`·`-model-lock`·`-entwurf-session-identity`·`-event-mapper`·`-entwurf-resume-args`) · smoke tmpdir/clientInfo/`PI_AGENT_ID`.

### KEEP-old (negative — 옛 이름 유지, 치환하면 silent break) — **완전 매핑**
- **repo 내부 = 공집합 (실증):** compaction 가드는 *코드에 없음*(docs-only, 아래 §3 정정) · anti-spoof는 값-상대(`meta-session.ts:1310/1431` `liveKey !== marker.ownerStartKey`, 리터럴 없음).
- **consumer (agent-config) = 3파일** → dual-accept 필수 (§4 keep-old):
  `session-recap.py:172`(+cognate `:145`) · `entwurf-peek.py:243` · `test-discovery.py:41`(`write()` 헬퍼).
- **영속저장소 = clear ✅ (패스 완료):** andenken/semantic-memory는 **filename 그래미(`SESSION_ID_RE`)+source-path**로 인덱스, provider-string 필터 **0** → provider는 content로만 임베드(rename-safe). agenda/botlog도 content-only. **silent-break 위험 없음.**

---

## 3 · Env taxonomy (`PI_` 접두 제거 ≠ pi 단어 전부 제거)

> 버킷+규칙+대표예시일 뿐 전수 아님. `PI_SHELL_ACP_*` **27개**를 S3 직전 `rg`로 전수 배정·확인 후 치환. **비자명 선결:** `LIVE_{MODEL,PROVIDER,TARGET}`·`RGG_TARGET`·`S1_MODEL`·`CODEX_MODE`. 자명: `*_CONTEXT`/`*_MODEL`/`*_SENTINEL`/`TRUST_ROOTS`→ACP, `V2_ONLY`/`DEBUG`→core.

- **Core/substrate:** `PI_ENTWURF_TARGETS_PATH`→`ENTWURF_TARGETS_PATH`, `PI_ENTWURF_DIR`→`ENTWURF_DIR`, `PI_SHELL_ACP_V2_RESUME_RESIDENT_SESSION_ID`→`ENTWURF_V2_RESUME_RESIDENT_SESSION_ID`.
- **ACP plugin:** `PI_SHELL_ACP_PROVIDER_MODEL`→`ENTWURF_ACP_PROVIDER_MODEL`, `*_CLAUDE_CONTEXT`/`*_ENGRAVING_PATH`/`*_MEMORY_*`/`*_OVERLAY_*`/`*_RAW_TURN_*`→`ENTWURF_ACP_*`.
- **MCP bridge:** `PI_TOOLS_BRIDGE_*`→`ENTWURF_BRIDGE_*`.
- **Meta bridge:** `PI_META_*`→`ENTWURF_META_*`.
- **Pi adapter target:** `PI_SHELL_ACP_ALLOW_PI_COMPACTION`→**`ENTWURF_ALLOW_PI_COMPACTION` (확정)** — `ALLOW_` 동사-접두가 코드베이스 관용(`_ALLOWED` 선례 0), `PI`=object(압축 대상=pi-side transcript).
- **정정 (compaction 가드는 코드에 없다, grep 실측):** `ALLOW_COMPACTION`/`before_compact`가 `.ts`/`.sh`(tests 포함) 0건 read. `assertLegacyCompactionKnobUnset`는 5개 문서에만 존재(v2서 빠짐) → live trap 아님, **doc-drift=PR-polish**.

---

## 4 · Consumer constellation lockstep 맵

> ⚠️ **consumer = "openclaw 배포 family"라는 클래스** (단일 repo 아님). `~/repos/{gh,work,3rd}` 전수 grep(2026-06-22): functional = **agent-config(A, primary)** + **openglg-config + work/hejdev6-openclaw + hej-kip(B, 배포군)**; 나머지(nixos/openclaw-config docker, notes/cos/edge/lego/junghan0611 등)는 주석·docs.
> **공통 shape:** provider config 블록 + `pi install @junghanacs/pi-shell-acp` + MCP 배선. → **npm 패키지명 `@junghanacs/pi-shell-acp`→`@junghanacs/entwurf` rename이 최대 blast-radius**(모든 배포의 install 줄이 republish 전엔 깨짐 = §6-① cut-choreography 핵심). 이 device는 **dev-clone 모드**(`~/.pi/agent` pi-managed install 없음, 라이브=gh checkout).

### A · agent-config (primary, 완전 매핑)
> `~/repos/gh/agent-config` 실측. **dirty baseline:** `pi/settings.server.json` M = `lastChangelogVersion` 0.79.6→0.79.8 (pi 런타임 자동 마커·benign) — **rename commit에 섞지 말 것**(§5 S1 readiness, `git add -p`).

- **S1 identity (repo S1과 같은 beat):** `pi/settings.json`+`.server.json:14` `"piShellAcpProvider"` 키→`entwurfProvider` · `pi/claude-plugin.json:3` description.
  - **★ transitional shape (GPT):** `piShellAcpProvider` 블록 내부에 `mcpServers.pi-tools-bridge`(`:20-24`) 동거. S1은 *provider key만* `entwurfProvider`, **내부 bridge명은 S2까지 `pi-tools-bridge` 유지** — `entwurfProvider.mcpServers.pi-tools-bridge`는 의도된 transitional(거짓말 아님). S1 config gate 기대값 = provider key=`entwurfProvider` / server명=아직 `pi-tools-bridge`.
- **S2 bridge:** `claude/settings.server.json:17` allow `"mcp__pi-tools-bridge__*"` · `antigravity/mcp_config.json`+`.server.json`·`codex/config.toml:48` 서버명 `pi-tools-bridge`→`entwurf-bridge` · README/AGENTS/CHANGELOG docs.
- **S3 env:** `run.sh` `PI_SHELL_ACP_DIR`/`_INSTALL_SPEC`/`_TRACKING_REF`→`ENTWURF_*`.
  - ✅ `PI_ENTWURF_BOT_TOKEN` = **repo 범위 밖** (pi-shell-acp가 `BOT_TOKEN` 0건 read, agent-config/telegram 자체 var). `ENTWURF_BOT_TOKEN` 전환은 agent-config 독립 결정, **repo S1과 묶지 말 것.**
- **★ (f) physical-path coupling — consumer S1을 GATE (§6-① GLG 결정):** GLG가 GitHub repo+로컬 dir rename 전엔 `entwurf`로 못 바꿈 —
  - `pi/settings*.json:11` `"../../repos/gh/pi-shell-acp"` · `:22` start.sh 절대경로 · `run.sh` checkout `~/repos/gh/pi-shell-acp`·pi-managed git 경로·`PI_SHELL_ACP_INSTALL_SPEC`(GitHub URL).
  - **노트 C (grep 누락 방지):** `claude/settings.server.json` `extraKnownMarketplaces.meta-bridge-local.source.path = …/pi-shell-acp/pi/meta-bridge/.assembled` — `mcp__pi-tools-bridge`가 아닌 **meta-bridge artifact 경로**.
- **★★ keep-old (history-reader, dual-accept 필수):**
  - `session-recap.py:172` `if "pi-shell-acp" in api/provider or model.startswith("claude-")` + cognate `:145`. (단 `model.startswith("claude-")` 백스톱 있어 break 불균등.)
  - `entwurf-peek.py:243`(백스톱 없음) + **`test-discovery.py:41` `write()` 헬퍼**(모든 픽스처가 `"provider":"pi-shell-acp"`+`==pi-shell-acp/claude-…` 헤더 상속; spoof header-authority 케이스 포함) → **통째 치환 = historical-parsing 회귀를 테스트째 삭제.**

### B · openclaw 배포군 (전수 grep, S1 prep에서 fresh-rg 재확인)
- **openglg-config (gh, 2차 functional):** `openclaw/config/openclaw.json.example` provider 블록 `"pi-shell-acp": {`·`"allow": ["pi-shell-acp"]`·`"model": "pi-shell-acp/…"`(S1 identity, `.example` 템플릿) + **`openclaw/Dockerfile:34` `pi install @junghanacs/pi-shell-acp`**(npm 패키지명, (f)). docker-compose/apt-bootstrap는 주석.
- **work/hejdev6-openclaw · hej-kip/openclaw (회사 배포 — PRIVATE.md 적용):** 같은 shape — `openclaw.example.json` provider config + `Dockerfile` npm install + `.env.example` + docs(AGENTS/ROADMAP/NEXT/TOOLS). **npm `@junghanacs/entwurf` republish 후 install 줄 갱신 필요**(cross-repo cut-choreography). 회사 repo라 편집은 GLG/PRIVATE.md 절차.
- **nixos-config / openclaw-config (docker 배포, 가벼움):** `docker-compose.yml`·`Dockerfile` hit이 대부분 **주석**(#21 workaround·overlay passthrough) + KEEP env `PI_EMACS_AGENT_SOCKET`. pi-shell-acp는 in-container 설치 아니라 **host `~/.pi/agent` bind-mount** → 설치 lockstep은 agent-config run.sh가 owner. 주석/commit-pin은 PR-polish.
- **docs constellation (`.md`/`.org`):** `notes`(20) · `cos`(3) · `edgeagent-config`·`legoagent-config`(1) · `junghan0611`(README) · `doomemacs-config`·`logickocli`·`memex-kb`·`zotero-config`. = 콘텐츠 언급/historical. **rename 결합 아님** — 일부 PR-polish, 대부분 그대로 둠(역사 기록).

---

## 5 · 액션 플랜 (sequenced — 각 stage = 일괄치환 + 게이트 same-commit + `pnpm check` green + commit, bisectable)

- **S0** docs map 고정 ✅
- **S0.5** SSOT 정렬(AGENTS no-rename 제거 · ROADMAP/NEXT hard-cut · env taxonomy) ✅

### ▶ S1 진입 readiness gate — **일격 전 이게 다 닫혀야** (GPT+비봇 GO 종합)
- **(a) fresh `rg` 전수** — 토큰 매트릭스(§2) 27 env(§3) + negative-guard 패스(`!==`/`!includes`·sentinel·drift assert·docs-only) + **consumer constellation §4 A(agent-config)+B(openclaw 배포군: openglg·work)** **S1 직전 재실행**.
- **(c) cache migration 리허설** — `mv ~/.pi/agent/cache/pi-shell-acp/sessions → cache/entwurf/sessions` 를 **실제 `~/.pi`로** 리허설. **idempotent:** old有new無→mv / new有→ok / 둘다有→fail-loud. (hard-cut 무충돌: 1회 이동이지 dual-routing 아님.)
- **(e) consumer dirty baseline 고정** — S1 직전 `git -C agent-config diff -- pi/settings.server.json`가 `lastChangelogVersion` 한 줄뿐인지 재확인 → S1 후 `git add -p`로 rename hunk만 stage(marker hunk 제외, commit purity).
- **keep-old 방어** — `test-discovery.py`에 `pi-shell-acp` 픽스처 **≥1 보존**(케이스명 `historical_pi_shell_acp`) + `entwurf` 픽스처 추가. session-recap/entwurf-peek는 dual-accept. (영속저장소 = 이미 clear ✅.)
- **AGENTS dual-accept 문구** — §1-① 문구를 양쪽 repo AGENTS에(§6-② GLG 승인).
- **(d) GLG 비준 + (f) physical-path 전략(§6-①) 확정 = 트리거.**

### ▶ S1 — package/repo/provider identity (**원자, 쪼개지 말 것**)
중간상태 "package=entwurf인데 provider=pi-shell-acp" 금지 → 통째로:
- 패키지명 + provider id(`acp-provider.ts` baseUrl/api) + model prefix + `piShellAcpProvider`→`entwurfProvider` + `PiShellAcp*`/`piShellAcp*`/`pi_shell_acp` + Symbol + repo URL.
- **MOVE-lockstep(§2) 동시 이동** — getRegistryRouting `!==` + no-auth sentinel 3-site + PROVIDER_ID(shell).
- **게이트 same-commit:** `check-package-source-routing`·`check-model-lock`·`check-entwurf-session-identity`·`check-auth-boundary`.
- **consumer lockstep(§4):** [agent-config] `pi/settings*.json` `entwurfProvider` 블록(model prefix 포함, 내부 bridge명은 S2 유지) + `claude-plugin.json`; [openglg-config] `openclaw.json.example` provider 블록/allow/model + Dockerfile npm install(npm republish와 동기).
- **bridge명은 건드리지 않음**(S2). → `pnpm check` EXIT0 + RENAME군 0/KEEP 잔존 양방향.
- **먼저 버린 worktree에서 dry-run**(physical rename 없이 가능 — dir명은 fs path지 alias 아님), green 확인 후 live.

### ▶ S2 — MCP bridge
`mcp/pi-tools-bridge`→`mcp/entwurf-bridge`(dir+서버명) + tool id `mcp__pi-tools-bridge__*`→`mcp__entwurf-bridge__*` 전수 + install/remove/prune settings + `check-pi-tools-bridge-boot` + **consumer mcpServers lockstep**(§4 S2: transitional shape 해소) + 노트 C 경로.

### ▶ S3 — env namespace
taxonomy(§3)대로 `PI_SHELL_ACP_*` 27개 의미별 분해 + `PI_TOOLS_BRIDGE_*`→`ENTWURF_BRIDGE_*` + `PI_ENTWURF_*`→`ENTWURF_*` + `PI_META_*`→`ENTWURF_META_*` + env명 assert 게이트. **영구 alias 금지**, installer one-shot migration만.

### ▶ S4 deferred (구조개편, 텍스트치환 아님)
`pi/entwurf-targets.json` 경로 재검토 · `pi-extensions/`→`adapters/pi/extensions/` · `pi/meta-bridge/.assembled` 산출물 경로.

---

## 6 · 🔴 GLG 결정 (제가 못 정하는 것 — 일격 트리거)

1. **★ physical-path + npm 전략 (최대 blast-radius)** — live S1을 **①** 같은 beat에 GitHub repo+로컬 dir rename + npm `@junghanacs/entwurf` republish + 모든 배포(§4) install/path 최종형(깔끔) vs **②** repo identity만 hard-cut, consumer 옛 경로/옛 패키지명 한 beat 유지 + "old=fs/registry location, not alias" 명시 + **RENAME-0 예외 allowlist**(위험제어 쉬움). *repo S1 dry-run은 어느 쪽이든 physical/npm 없이 가능*(dev-clone). **npm republish 전엔 모든 openclaw 배포 install 줄이 옛 이름이어야 정상** — 이게 cut-choreography 핵심.
2. **AGENTS dual-accept 문구 적용** — pi-shell-acp + agent-config **양쪽** AGENTS(§1-① 문구). durable 2-repo 표면이라 승인 후 편집.
3. **repo rename 타이밍** (GitHub repo + 로컬 dir) = GLG 오퍼레이션 (commit 밖).

---

## 7 · PR-polish (rename과 별개, S1~S3 중/후)

README/VERIFY/CHANGELOG stale(backend overclaim·packaged docs·persisted continuity·config passthrough · **compaction 가드 docs-only — 5개 문서가 없는 가드 주장**) + ROADMAP "legacy verbs maintained" historical. `AGENTS.md`는 S0.5서 정책 정렬했고 이후 잔여 문자열만 결합 갱신.

## 8 · 넘으면 안 되는 선

- **치환 시작 = §5 readiness gate 전부 닫힘 + GLG 비준 후.** 지금까지 0건 유지.
- commit = commit skill, **push / tag / publish / repo-rename = GLG**. `--no-verify` 금지, `core.hooksPath`/`.git-hooks-mode` 무단 변경 금지.
- operator 세트(GPT=pi-native host / ACP Claude=socket-citizen / Claude Code=meta mailbox-citizen) = ROADMAP SSOT, rename 중 불변.

## 9 · 맥락 / 선행

- 분기점 `a893318`(CP1 lock) 원격 봉인, stamp `<2026-06-22 19:18>`.
- 형제 교차검수: GPT `20260622T191739-19b503`(gpt-5.5) + 비봇 = GO 수렴. 최종 감수는 rename 완결 diff에.
- 추가 구현 = rename 끝난 *다음 세션* 본질(ROADMAP deferred: persisted resume/load 1b-2c · Claude↔Claude live transport 등).
