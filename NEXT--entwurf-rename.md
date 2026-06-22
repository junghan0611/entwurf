# NEXT — `entwurf-rename` 브랜치 (rename `pi-shell-acp` → `entwurf`: pi 탈중심화)

> 부트섹터. CP2 = 이 rename. **아직 치환 안 함** — GLG가 enumeration을 몇 번 더 조인 뒤 실행.
> 분기점: `acp-on-v2` `a893318`(CP1 정합성 lock, 원격 봉인됨). 영속 invariant·operator 세트 = `ROADMAP.md` SSOT.

# 미션 (탑)

pi-shell-acp repo를 `entwurf`로 rename. **단순 패키지명 교체가 아니다** — pi-중심 네이밍을 걷어내고 `entwurf`를 주어로 세운다. GLG 통찰: *"pi는 4번째 하네스일 뿐. entwurf capability는 하네스 무관. 이름이 pi를 중심에 두면 안 된다. entwurf 감각을 살려라."*

**원칙 (GLG 통찰 + GPT `20260622T191739-19b503` 적대검수 수렴, 2026-06-22):**
> "pi"는 *pi 하네스 adapter / pi-runtime / upstream 계약*일 때만 남긴다. 이 repo가 소유한 *garden citizen · identity · dispatch · bridge capability*는 **entwurf가 주어**. → "pi 제거"가 아니라 **"pi를 adapter로 격하하고 entwurf를 capability 주어로 세움."**

## ★ 실행 법칙 (GLG) — "정확히 나열 후 치환"

> **먼저 모든 토큰·변종·엣지케이스를 빠짐없이 *나열*(enumerate)하고 그것이 exhaustive함을 확인한 뒤에야** 결정적 일괄 텍스트치환을 한다. 치환부터 하지 않는다. 네이밍이 핵심이라 한 번에 정확히 — 이 NEXT의 「나열」을 몇 번 더 조여 완성한 뒤 실행.

- **blind `s/pi-/entwurf-/` 금지** (KEEP군 오염) — full-token exact only.
- 각 stage 후 **양방향 검증**: 잔존 `rg`(RENAME군 0이어야) + KEEP allowlist `rg`(남아야 정상).
- 게이트는 rename과 **같은 commit**(결합 규칙).
- 방법: grep token matrix + 검수 + 게이트. AST codemod 단독 부적합(대부분 문자열 계약: provider id·패키지명·MCP 서버명·env·settings 키·path·sentinel·log reason·docs·consumer config).

# 나열 — 토큰 매트릭스 (실측, node_modules 제외 · "몇 번 더 조여" 완성 대상)

## RENAME → entwurf (정체성 / 하네스 무관 capability)

| 토큰 (변종) | 측정 | → |
|---|---:|---|
| `pi-shell-acp` (kebab) | 906 | `entwurf` |
| `piShellAcp…` (camel, = `piShellAcpProvider`) | 67 | `entwurfProvider` |
| `PiShellAcp` (Pascal 타입) | 3 | `Entwurf` |
| `PI_SHELL_ACP_*` (SCREAMING, 26 vars) | 163 | `ENTWURF_*` |
| `pi_shell_acp` (snake, log reason/sentinel) | 5 | `entwurf` |
| `pi-tools-bridge` (MCP dir/server명) | 230 | `entwurf-bridge` |
| `mcp__pi-tools-bridge__*` (tool id, allow 패턴) | — | `mcp__entwurf-bridge__*` |
| `PI_TOOLS_BRIDGE_*` (3 vars) | — | `ENTWURF_BRIDGE_*` |
| `PI_ENTWURF_*` (우리 substrate env) | — | `ENTWURF_*` |
| `PI_META_*` (meta-bridge env) | — | `ENTWURF_META_*` |
| Symbol `"pi-shell-acp.acp-provider.registered"` | — | `"entwurf.acp-provider.registered"` |
| repo URL `github.com/junghan0611/pi-shell-acp` | — | `…/entwurf` |
| compound `pi-shell-acp-{demo,smoke,hero,no-auth,doomemacs,release-gate}` | — | `entwurf-…` |
| model prefix `pi-shell-acp/claude-…` | — | `entwurf/claude-…` |

## KEEP pi (남아야 정상 — adapter / runtime / upstream)

`pi-native` · `pi-session` · `PI_SESSION_ID` · `PI_AGENT_ID` · `pi-coding-agent` · `PI_CODING_AGENT_DIR` · `pi-core`/`pi-mono`/`pi-tui` · `PI_SETTINGS_PATH` · `PI_EMACS_AGENT_SOCKET` · `pi-extensions/` · `pi-context-augment` · `--entwurf-control`(pi-core flag) · `pi-acp`(svkozak 외부 프로젝트).

## 회색지대 — 수렴 (GLG 비준 대기)

- **C4** 패키지/repo/provider = **순수 `entwurf`** (entwurf-acp ✗ — ACP는 plugin 하나지 정체성 아님). 문서: "entwurf 패키지 = core substrate + pi adapter + ACP plugin + meta bridge".
- **C5** MCP bridge = **`entwurf-bridge`** (entwurf-mcp=transport종속, -tools-bridge=잡다; 설명에 "MCP adapter/server" 명시).
- **C1** `PI_ENTWURF_*` → **`ENTWURF_*`**.   **C2** `PI_META_*` → **`ENTWURF_META_*`**.
- **C3** `pi-extensions/` **KEEP**.   **C6** `pi-context-augment` **KEEP** (둘 다 pi adapter — entwurf-*면 거짓말).
- (재검토) `PI_ENTWURF_ACP_FOR_CODEX` 의미 → `ENTWURF_CODEX_ACP_*` 류로 구체화?

# 스테이징 (각 = 변종 일괄치환 + 게이트 동시 + `pnpm check` green + commit · bisect 가능)

- **S0** docs map 고정 ✅ (이 파일)
- **S1 — package/repo/provider identity (원자, 쪼개지 말 것):** 중간상태 "package=entwurf인데 provider=pi-shell-acp" 금지 → 통째로. 패키지명 + provider id(acp-provider.ts baseUrl/api) + model prefix + `piShellAcpProvider`→`entwurfProvider` + `PiShellAcp*`/`piShellAcp*`/`pi_shell_acp` + Symbol + repo URL. 게이트 동시: `check-package-source-routing`·`check-model-lock`·`check-entwurf-session-identity`·`check-auth-boundary`. **agent-config consumer lockstep** (`pi/settings.json` model prefix + `piShellAcpProvider` block). → `pnpm check` EXIT0.
- **S2 — MCP bridge:** `mcp/pi-tools-bridge`→`mcp/entwurf-bridge` (dir+서버명) + **tool id `mcp__pi-tools-bridge__*`→`mcp__entwurf-bridge__*`** 전수 + install/remove/prune settings + `check-pi-tools-bridge-boot` + consumer mcpServers lockstep.
- **S3 — env namespace:** 위 RENAME env들(`PI_SHELL_ACP_*`→`ENTWURF_*`, `PI_TOOLS_BRIDGE_*`→`ENTWURF_BRIDGE_*`, `PI_ENTWURF_*`→`ENTWURF_*`, `PI_META_*`→`ENTWURF_META_*`) + env명 assert 게이트(`check-entwurf-v2-surface` 등). **런타임 영구 alias 금지**, 필요시 installer one-shot migration만.
- **S4 deferred (구조개편, 텍스트치환 아님):** `pi/entwurf-targets.json` 경로 재검토 · `pi-extensions/`→`adapters/pi/extensions/` layout.

# PR-polish (rename과 별개, S1~S3 중/후)

README/VERIFY/CHANGELOG stale (backend overclaim·packaged docs·persisted continuity·config passthrough) + ROADMAP 하단 "legacy verbs maintained" historical 표기. `AGENTS.md`(11 refs)는 **GLG 명시 요청 시에만** 편집.

# 넘으면 안 되는 선

- **아직 치환 시작 금지** — 「나열」 완성 + GLG 비준 후. 몇 번 더 조인다.
- commit = commit skill, **push / tag / publish / repo-rename = GLG**. `--no-verify` 금지, `core.hooksPath`/`.git-hooks-mode` 무단 변경 금지.
- operator 세트 정의(GPT=pi-native host / ACP Claude=socket-citizen / Claude Code=meta-session mailbox-citizen)는 ROADMAP SSOT — rename 중 흔들지 않는다.

# 맥락 / 선행

- 분기점 `acp-on-v2` `a893318`(CP1 정합성 lock) 원격 봉인 완료, stamp `<2026-06-22 19:18>`.
- GPT `20260622T191739-19b503`(gpt-5.5) 설계논의 DONE. 최종 감수는 rename 완결 diff에.
- 추가 구현("더 구현할게 있다") = rename 끝난 *다음 세션* "본질". ROADMAP deferred 후보(persisted resume/load 1b-2c · Claude↔Claude live transport 등).
