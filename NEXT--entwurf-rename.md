# NEXT — `entwurf-rename` · rename `pi-shell-acp` → `entwurf` (pi 탈중심화)

> **상태:** 치환 **0건** · oracle 산출물 **재담금질 중**(2026-06-23 framing 정정). 분기점 `acp-on-v2` `a893318`(CP1 lock, 원격 봉인). operator 세트·영속 invariant SSOT = `ROADMAP.md`. GPT = 검수자 대기.
>
> **⚠️ framing 정정 (2026-06-23, GLG):**
> - **범위 = 이 repo 본체(`pi-shell-acp`→`entwurf`)만. 우리가 중심을 잡는다.** consumer 동기화는 **담당자(sibling) 위임** — 우리는 다른 repo를 직접 편집하지 않는다. 헛발질로 작업을 못 끝내는 걸 막는 핵심 규율.
> - **openclaw consumer는 허구다.** `plugins/openclaw`는 2026-06-10 deprecate·**디렉토리째 제거**(find 0건). repo 내 `openclaw` 언급은 전부 historical docs(README/CHANGELOG/ROADMAP/docs/run.sh 주석) — **코드 lockstep 0**. oracle이 docs 기록을 live 배포 consumer로 오인했던 §4-B는 **삭제**.
> - **rename이 먼저. npm publish는 최후행.** 순서 = **코드 rename(S1~S3) → repo/dir rename(GLG) → npm publish(GLG, 맨 마지막)**(§6 시퀀스). publish는 rename 트리거가 아니다. package.json `name` *문자열*은 S1 소스 치환 대상이지만 *registry publish*는 모든 rename 완료 후 별도. 설치 동기화 cut-choreography **폐기** — 쓰는 사람은 전문가, 내 방향 따라오거나 안 쓰면 그만. 범용 도구가 아니다.
>
> **▶ 다음 세션 진입점 (실제 작업):** ① 이 정정본 self-review 완료 → **GPT 재검수 요청** → ② §6 GLG 결정 확정(AGENTS dual-accept 적용 · repo/dir rename 타이밍 — *npm publish는 §6 후행 단계라 트리거 결정에서 제외*) → ③ §5 S1 readiness gate `fresh rg` 전수(**repo 내부만**) → ④ **버린 worktree에서 S1 dry-run**(RENAME군 0 / KEEP 잔존 / `pnpm check` green / `check-pack` registry 미접촉 green) → ⑤ GLG 비준 시 live S1 일격. *치환은 ④까지 0건 유지.*

---

## 0 · 미션 & 교리

**미션:** `pi-shell-acp` repo를 `entwurf`로 rename. 단순 패키지명 교체가 아니다 — pi-중심 네이밍을 걷어내고 `entwurf`를 주어로 세운다. *"pi는 4번째 하네스일 뿐, entwurf capability는 하네스 무관."* **이 작업이 끝나야 entwurf 기능 정리 → 릴리즈로 나아갈 수 있다.**

**원칙:** "pi"는 *pi 하네스 adapter / pi-runtime / upstream 계약*일 때만 남긴다. 이 repo가 소유한 *garden citizen · identity · dispatch · bridge capability*는 **entwurf가 주어**. → "pi 제거"가 아니라 **"pi를 adapter로 격하, entwurf를 capability 주어로."**

**교리 — 일격필살 (담금질 후 한 방):** S1은 **한 atomic commit, green-first-try, 중간 거짓상태 0**. 네이밍이 핵심이라 한 번에 정확히. 그 전까지 나열(담금질)을 충분히 조인다.

**범위 교리 — "중심만 잡는다":** 우리는 **이 repo 본체**만 친다. agent-config 등 다른 내 repo는 rename 후 담당자가 맞춘다. consumer를 우리가 직접 좇으면 헛발질로 작업을 못 끝낸다. NEXT에 남기는 consumer 정보는 *편집 대상*이 아니라 *담당자에게 넘길 핸드오프 명세*(§4).

**실행 법칙 — "정확히 나열 후 치환":**
- 모든 토큰·변종·엣지케이스를 빠짐없이 *나열*하고 exhaustive 확인 **후에야** 결정적 일괄 치환.
- **blind `s/pi-/entwurf-/` 금지** — full-token exact only (KEEP군 오염 방지).
- 각 stage 후 **양방향 검증**: 잔존 `rg`(RENAME군 0이어야) + KEEP allowlist `rg`(남아야 정상).
- **게이트 = rename과 같은 commit** (결합 규칙, silent red 금지).
- 방법 = grep token matrix + 검수 + 게이트. AST codemod 단독 부적합(대부분 문자열 계약).

---

## 1 · 불변 원칙 (담금질 산물 — 미래 구현자가 깨기 쉬운 지점)

**① hard-cut(repo) ⟂ dual-accept(historical-reader) — 모순 아니라 직교·상보.**
- repo = 살아있는 라우팅 정체성 → **hard-cut, permanent alias 금지**(AGENTS Hard Rule 1).
- historical-reader = 불변 과거를 읽음 → **old ∪ new 영구 dual-accept**(역사 불변이라 *영원히* 둘 다).
- ⚠️ **함정:** 누군가 Hard Rule 1을 읽고 `session-recap`의 `pi-shell-acp` 수용을 "residue"로 청소 → **과거 recall이 조용히 끊김**(runtime failure 아니라 기억 손실 = 더 나쁨). dual-accept는 alias가 아니라 *historical-compat*.
- **이 repo 내부 historical-reader = 공집합**(§2 KEEP-old 실증). dual-accept가 필요한 historical-reader는 전부 **consumer 측(agent-config)** → **담당자 위임**(§4). 우리는 그 사실을 명세로만 넘긴다.
- **AGENTS 반영 문구 (GPT 확정, §6-②에서 GLG 승인 후 적용 — 우리 repo AGENTS만; agent-config AGENTS는 담당자):**
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
| npm `@junghanacs/pi-shell-acp` (package.json `name` *문자열*) | `@junghanacs/entwurf` — **S1 소스 치환**. registry publish는 §6 최후행, 별개 |
| compound `pi-shell-acp-{demo,smoke,hero,no-auth,doomemacs,release-gate}` | `entwurf-…` |
| model prefix `pi-shell-acp/claude-…` | `entwurf/claude-…` |

### KEEP pi (남아야 정상 — adapter / runtime / upstream)
`pi-native` · `pi-session` · `PI_SESSION_ID` · `PI_AGENT_ID` · `pi-coding-agent` · `PI_CODING_AGENT_DIR` · `pi-core`/`pi-mono`/`pi-tui` · `PI_SETTINGS_PATH` · `PI_EMACS_AGENT_SOCKET` · `pi-extensions/` · `pi-context-augment` · `--entwurf-control`(pi-core flag) · `pi-acp`(svkozak 외부).

### MOVE-lockstep (positive 기대값 — 값 + *검사처*를 같은 commit에, 어긋나면 RED=loud)
- `getRegistryRouting`/extension-spec: `entwurf-core.ts:1060` `if (target.provider !== "pi-shell-acp")` + `:1070` `resolveExplicitExtensionSpec("pi-shell-acp")` → 미치환 시 `Unknown provider`로 **즉사**(#29).
- **no-auth sentinel 값 `"pi-shell-acp-no-auth"` = 3-site 하드코딩:** `models.ts:29`(const) + `check-acp-provider-surface.ts:49`(drift assert) + `run.sh:1314/1319`(source-scan).
- `run.sh:30 PROVIDER_ID` · `Symbol.for("pi-shell-acp.acp-provider.registered")` · 게이트 기대값(`check-package-source-routing`·`-model-lock`·`-entwurf-session-identity`·`-event-mapper`·`-entwurf-resume-args`) · smoke tmpdir/clientInfo/`PI_AGENT_ID`.

### KEEP-old (negative — 옛 이름 유지, 치환하면 silent break) — **repo 내부 = 공집합 (실증)**
- compaction 가드는 *코드에 없음*(docs-only, 아래 §3 정정) · anti-spoof는 값-상대(`meta-session.ts:1310/1431` `liveKey !== marker.ownerStartKey`, 리터럴 없음).
- **historical dual-accept가 필요한 reader는 전부 consumer 측(agent-config) → §4 위임 명세.** repo 본체엔 없다.

### historical docs (openclaw 등 — rename 결합 아님, 대부분 보존)
- `plugins/openclaw`는 2026-06-10 제거 완료. repo 내 `openclaw` = README/CHANGELOG/ROADMAP/`docs/setup-clean-host.md`/`run.sh:21` 주석의 **historical 기록**뿐. live lockstep 0. rename과 결합하지 않음(역사 기록은 그대로 두거나 §7 PR-polish에서만 손댐).

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

## 4 · 담당자 위임 핸드오프 명세 (consumer — **우리가 편집하지 않음**)

> ⚠️ **우리는 이 repo 본체만 친다.** 아래는 rename이 깨뜨리는 **인터페이스 계약**을 담당자(agent-config sibling)에게 넘기기 위한 명세일 뿐 — *우리의 편집 대상이 아니다*. live S1 후 GLG가 담당자를 불러 맞춘다. (oracle의 openclaw 배포군 §4-B는 허구라 삭제됨; agent-config가 유일한 실제 functional consumer.)
>
> ⚠️ **(f) physical-path coupling:** agent-config는 `../../repos/gh/pi-shell-acp` 절대/상대 경로와 npm install spec을 들고 있다. → repo+dir+npm rename 후 담당자가 갱신. **우리 commit에 묶지 않는다.**

**담당자에게 넘길 계약 목록 (rename이 바꾸는 표면):**
- **provider identity:** `pi/settings*.json`의 `"piShellAcpProvider"` 키 → `entwurfProvider` · `pi/claude-plugin.json` description · model prefix `pi-shell-acp/…` → `entwurf/…`.
  - **transitional 주의(GPT):** `entwurfProvider` 블록 내부 `mcpServers.pi-tools-bridge`는 S2까지 옛 서버명 유지가 정상(거짓말 아님). provider key와 bridge명은 다른 beat.
- **MCP bridge:** allow `"mcp__pi-tools-bridge__*"` · 서버명 `pi-tools-bridge` → `entwurf-bridge` (S2 beat).
- **env:** `run.sh`의 `PI_SHELL_ACP_*` → `ENTWURF_*` (§3 taxonomy).
- **physical-path:** `../../repos/gh/pi-shell-acp` 경로·`PI_SHELL_ACP_INSTALL_SPEC`(GitHub URL)·`meta-bridge-local` source.path(`…/pi-shell-acp/pi/meta-bridge/.assembled`).
- **★ historical dual-accept (담당자 필수 — silent 위험):** agent-config의 history-reader는 옛 provider string을 **영구 수용**해야 한다(§1-①). 통째 치환하면 과거 recall이 조용히 끊김. 담당자에게 "치환이 아니라 old∪new dual-accept"임을 명시 전달. (oracle가 짚은 `session-recap.py`/`entwurf-peek.py`/`test-discovery.py` 픽스처 = 담당자 영역.)

**영속저장소 = clear ✅ (우리 패스 완료):** andenken/semantic-memory는 filename grammar(`SESSION_ID_RE`)+source-path로 인덱스, provider-string 필터 0 → provider는 content로만 임베드(rename-safe). agenda/botlog도 content-only. **silent-break 위험 없음.** ← 담당자 위임 불필요, 사실로 확정.

---

## 5 · 액션 플랜 (sequenced — 각 stage = 일괄치환 + 게이트 same-commit + `pnpm check` green + commit, bisectable. **전부 이 repo 내부만.**)

- **S0** docs map 고정 ✅
- **S0.5** SSOT 정렬(AGENTS no-rename 제거 · ROADMAP/NEXT hard-cut · env taxonomy) ✅

### ▶ S1 진입 readiness gate — **일격 전 이게 다 닫혀야**
- **(a) fresh `rg` 전수 (repo 내부만)** — 토큰 매트릭스(§2) + 27 env(§3) + negative-guard 패스(`!==`/`!includes`·sentinel·drift assert·docs-only) S1 직전 재실행. *consumer는 grep 안 함 — 담당자 영역.*
- **(c) cache migration 리허설** — `mv ~/.pi/agent/cache/pi-shell-acp/sessions → cache/entwurf/sessions` 를 **실제 `~/.pi`로** 리허설. **idempotent:** old有new無→mv / new有→ok / 둘다有→fail-loud. (hard-cut 무충돌: 1회 이동이지 dual-routing 아님.)
- **(g) npm name 게이트 무해 확인** — package.json `name`→`@junghanacs/entwurf` 치환 시 `check-pack`/`check-pack-install`가 **로컬 tarball 검증이라 registry 미접촉으로 green**임을 dry-run worktree서 실증(publish 없이). registry 접촉하면 readiness 미달.
- **AGENTS dual-accept 문구** — §1-① 문구를 **우리 repo AGENTS에** (§6-② GLG 승인). agent-config AGENTS는 담당자.
- **(d) GLG 비준 + (f) repo/dir rename 타이밍(§6-③) 확정 = 트리거.** *npm publish는 트리거 아님 — rename 완료 후 최후행(§6-①).*

### ▶ S1 — package/repo/provider identity (**원자, 쪼개지 말 것**)
중간상태 "package=entwurf인데 provider=pi-shell-acp" 금지 → 통째로:
- 패키지명(`@junghanacs/entwurf`) + provider id(`acp-provider.ts` baseUrl/api) + model prefix + `piShellAcpProvider`→`entwurfProvider` + `PiShellAcp*`/`piShellAcp*`/`pi_shell_acp` + Symbol + repo URL.
- **MOVE-lockstep(§2) 동시 이동** — getRegistryRouting `!==` + no-auth sentinel 3-site + PROVIDER_ID(shell).
- **게이트 same-commit:** `check-package-source-routing`·`check-model-lock`·`check-entwurf-session-identity`·`check-auth-boundary`.
- **bridge명은 건드리지 않음**(S2). → `pnpm check` EXIT0 + RENAME군 0/KEEP 잔존 양방향.
- **먼저 버린 worktree에서 dry-run**(physical rename 없이 가능 — dir명은 fs path지 alias 아님), green 확인 후 live.
- *consumer(agent-config)는 이 commit에 없다 — 담당자가 별도 beat로 맞춘다.*

### ▶ S2 — MCP bridge
`mcp/pi-tools-bridge`→`mcp/entwurf-bridge`(dir+서버명) + tool id `mcp__pi-tools-bridge__*`→`mcp__entwurf-bridge__*` 전수 + install/remove/prune settings + `check-pi-tools-bridge-boot`. (consumer mcpServers·노트 C 경로 = 담당자.)

### ▶ S3 — env namespace
taxonomy(§3)대로 `PI_SHELL_ACP_*` 27개 의미별 분해 + `PI_TOOLS_BRIDGE_*`→`ENTWURF_BRIDGE_*` + `PI_ENTWURF_*`→`ENTWURF_*` + `PI_META_*`→`ENTWURF_META_*` + env명 assert 게이트. **영구 alias 금지**, installer one-shot migration만.

### ▶ S4 deferred (구조개편, 텍스트치환 아님)
`pi/entwurf-targets.json` 경로 재검토 · `pi-extensions/`→`adapters/pi/extensions/` · `pi/meta-bridge/.assembled` 산출물 경로.

---

## 6 · 🔴 GLG 결정 & 시퀀스 (제가 못 정하는 것)

**전체 시퀀스 (rename 먼저, publish 최후):**
`코드 rename S1→S2→S3` (우리, commit) **→** `repo+dir rename` (GLG 오퍼) **→** `담당자 consumer 갱신` **→** `npm publish` (GLG, **맨 마지막**).

**일격 트리거 결정 (S1 진입용):**
2. **AGENTS dual-accept 문구 적용** — **우리 repo(`entwurf`) AGENTS**에 §1-① 문구. agent-config AGENTS는 담당자 몫.
3. **repo + 로컬 dir rename 타이밍** (GitHub repo `pi-shell-acp`→`entwurf` + `~/repos/gh/pi-shell-acp` dir) = GLG 오퍼레이션 (commit 밖). 이후 담당자가 consumer physical-path 갱신.

**후행 결정 (rename 전부 끝난 뒤 — S1 트리거 아님):**
1. **npm publish 전략 (최후행)** — `@junghanacs/pi-shell-acp` → `@junghanacs/entwurf`. npm in-place rename 미지원이 표준이므로 실질 = **새 이름 publish + 옛것 deprecate 마킹**. *설치자 동기화 cut-choreography 없음.* 결정할 것 = 옛 패키지 deprecate 문구뿐(시점은 "모든 rename 완료 후"로 고정). package.json `name` *문자열* 치환은 S1에 이미 들어감 — 여기서 정하는 건 *registry 행위*만.

---

## 7 · PR-polish (rename과 별개, S1~S3 중/후)

README/VERIFY/CHANGELOG stale(backend overclaim·packaged docs·persisted continuity·config passthrough · **compaction 가드 docs-only — 5개 문서가 없는 가드 주장** · openclaw deprecate 기록 정합) + ROADMAP "legacy verbs maintained" historical. `AGENTS.md`는 S0.5서 정책 정렬했고 이후 잔여 문자열만 결합 갱신.

## 8 · 넘으면 안 되는 선

- **치환 시작 = §5 readiness gate 전부 닫힘 + GLG 비준 후.** 지금까지 0건 유지.
- **다른 repo는 직접 편집 금지** — consumer는 담당자 위임. 우리는 이 repo 본체에만 집중.
- commit = commit skill, **push / tag / publish / repo-rename = GLG**. `--no-verify` 금지, `core.hooksPath`/`.git-hooks-mode` 무단 변경 금지.
- operator 세트(GPT=pi-native host / ACP Claude=socket-citizen / Claude Code=meta mailbox-citizen) = ROADMAP SSOT, rename 중 불변.

## 9 · 맥락 / 선행

- 분기점 `a893318`(CP1 lock) 원격 봉인, stamp `<2026-06-22 19:18>`.
- 이 NEXT = oracle 산출물(`f573d06`)의 **2026-06-23 framing 정정본** — openclaw 허구 삭제 · consumer 위임 격하 · npm 단순화 · 범위를 repo 본체로 수축. **GPT 검수 대기.**
- 형제 교차검수 이력: GPT `20260622T191739-19b503`(gpt-5.5) + 비봇 GO 수렴(단 oracle framing 기준 — 정정본 재검수 필요).
- 추가 구현 = rename 끝난 *다음 세션* 본질(ROADMAP deferred: persisted resume/load 1b-2c · Claude↔Claude live transport 등). **이 작업이 끝나야 entwurf 기능 정리 → 릴리즈.**
