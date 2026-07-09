# NEXT — entwurf: agy 자동 birth (#46) 하나만 판다

> 나침반이지 DB가 아니다: **현재 위치 · 다음 한 걸음 · 넘으면 안 되는 선**만 둔다.
> 설계 SSOT = **`ROADMAP.md`** + `docs/*.md`. 닫힌 변경 = **`CHANGELOG.md`**. process history = git log.

## NOW — agy 자동 birth는 됨, MCP tool injection은 미완 (#46)

- **Stem:** agy도 Claude Code 급으로 “정상 launch만으로 garden citizen birth”가 되어야 한다. 수동 `entwurf_register_native` 호출 없이 새 agy conversation이 `backend=antigravity` meta-record를 만들고 statusline에 gid가 떠야 한다.
- **Current (2026-07-09 thinkpad live):** birth/statusline은 **성공**. 새 agy conversation `c9aad782-7279-4a0c-9a40-816ddb0c6d6f`가 자동으로 `20260709T183621-bbc3d5`를 만들었고 statusline도 `🪛 20260709T183621-bbc3d5 agy`로 뜸. `~/.local/state/entwurf/agy-imprint.log`에 create/attach 증거 있음.
- **Active install SSOT (all three roots — corrected):**
  - birth hook plugin: `~/.gemini/config/plugins/entwurf-agy-imprint/{plugin.json,hooks.json}` → `entwurf-agy-imprint`
  - statusline: `~/.gemini/antigravity-cli/settings.json` → `statusLine.command=entwurf-agy-statusline` (settings.json IS read from antigravity-cli)
  - MCP bridge: **`~/.gemini/config/mcp_config.json`** → `mcpServers.entwurf-bridge` (the doc-correct GLOBAL root)
- **RESOLVED — "뭐가 글로벌인지" (2026-07-09 oracle):** the MCP-injection blocker's root was the config-root confusion, NOT birth/permission. agy's own builtin doc `mcp_servers.md` is explicit: **global MCP = `~/.gemini/config/mcp_config.json`** (applies to all sessions); the `~/.gemini/antigravity-cli/mcp_config.json` copy the installer used was a mis-wiring agy never reads as global (evidence: entwurf-bridge tool cache `20260704T201605` PREDATES the installer's antigravity-cli write `20260704T232051`, and the last agy run left that cache unrefreshed = not re-read). Same pattern as the hooks-root correction (`config/` is the live customization root; `antigravity-cli/` holds settings.json + appDataDir/cache).
- **Installer fixed + oracle migrated:** `scripts/agy-bridge.sh` now targets the GLOBAL `config/mcp_config.json` and, as a one-way migration, CLEANS the stale entwurf-bridge entry from the legacy antigravity-cli root (new `clean-legacy` in `agy-bridge-config.py`; never clobbers a symlinked SSOT). Doctor labels swapped `documented/observed`→`global/legacy`. smoke +7 (86 checks), lint+typecheck green. Oracle applied (uninstall old → install new): `config/mcp_config.json` carries entwurf-bridge, antigravity-cli absent, `doctor-agy-bridge` green. Server healthy: direct MCP handshake to `entwurf-bridge` lists `entwurf_v2, entwurf_self, entwurf_peers, entwurf_inbox_read, entwurf_register_native`. Oracle `settings.json` permissions already grant `mcp(*)`.
- **Oracle now FULLY installed + garbage-pruned + idempotent (2026-07-09):** all three surfaces green — bridge (global config/), `install-agy-statusline` (statusLine→`entwurf-agy-statusline`, old custom captured as preimage), `install-agy-hooks` (birth plugin created, no legacy cruft). dev-bin exposed all 3 bins (entwurf-bridge/-agy-statusline/-agy-imprint) + migrated the pre-multi-bin single dev-bin state. **Garbage swept:** the orphaned `pi-tools-bridge` agy MCP cache (the pre-cutover server key, per CHANGELOG "stale pi-tools-bridge entries are pruned as one-shot cutover state") is now pruned BY the installer (exact-name whitelist, live/unrelated caches + symlinks untouched) — install re-run is byte-identical (idempotency measured). Left intact (not ours): `~/.gemini/settings.json.bak.20260514` (gemini-cli era settings backup).
- **LIVE PROVEN (2026-07-09 oracle) — birth + MCP send both work:** a real agy session in `~/nixos-config` (conv `961d6677`) auto-birthed gid `20260709T194223-2ba8f1` (`backend=antigravity`, model `gemini-3.5-flash-low`, in the meta-session store) AND directly called the entwurf-bridge MCP to deliver a message to this Claude session's inbox (`external-mcp @ ~/nixos-config`, received via mailbox). So **tool injection is not the blocker anymore** — agy calls `entwurf_v2`/send for real, not shell-out.
- **NEW real blocker — agy SENDER IDENTITY (non-replyable / unknown-host):** the agy send arrives as `external-mcp/unknown-host`, **non-replyable**, even though the session is birthed. NOT a resume-vs-fresh issue and NOT a model-list issue — two concrete code gaps: (1) `mcp/entwurf-bridge/src/index.ts:~164` `resolveMetaSender` only reads `backend:"claude-code"` markers by ppid — no `antigravity` branch; (2) `scripts/agy-imprint.sh` writes ONLY the meta-record, no sender marker (grep: no marker/ppid/ownerPid). So the bridge can't map the calling agy pid → its gid and falls back to external-mcp (`index.ts:282`). A fresh agy session will birth + inject + SEND, but stays non-replyable until this is built. Design Q: does the PreInvocation imprint hook run under the same agy pid that parents the MCP child (the ppid-marker precondition Claude Code relies on)? Verify before building. Quick partial: an `env.ENTWURF_BRIDGE_EXTERNAL_AGENT_ID` in the mcp_config server entry fixes only the `unknown-host` LABEL (→ `antigravity/<host>`), not replyability.
- **Remaining for #46:** build the agy sender-marker lane (hook writes a ppid-keyed `backend:antigravity` marker + bridge reads it) so an agy send is a replyable meta-session. THEN the reply-TO-agy path (agy is native-push domain, not mailbox self-fetch — how a peer reaches the agy gid is the other half).
- **Verify before commit/push:**
  - `./run.sh doctor-agy-hooks && ./run.sh doctor-agy-statusline && ./run.sh doctor-agy-bridge`
  - `./run.sh smoke-agy-hooks-state` (currently 34 checks), `./run.sh smoke-agy-statusline-state` (59), `./run.sh smoke-agy-install-state` (79)
  - `pnpm lint && pnpm typecheck`
  - Live: restart agy, ask it to call `entwurf_v2` to send to a known gid; accepted only if actual MCP tool call happens, not `Bash run.sh ...`.
- **Do not touch:** mux/spawn/cortex/pi-provider while this is open. Do not reintroduce `~/.gemini/antigravity-cli/hooks.json` or `~/.gemini/config/plugins/entwurf-probe` except as legacy-cleanup specimens in smokes. Do not use `agy -p` as acceptance.

### Closed in this detour (keep as evidence, promote to CHANGELOG only at release)

- **agy MCP global-root fix + legacy-cache prune (2026-07-09):** `install-agy-bridge` now writes to the doc-correct GLOBAL `~/.gemini/config/mcp_config.json` (was the un-read `~/.gemini/antigravity-cli/mcp_config.json`) and one-way CLEANS the legacy entry (new `agy-bridge-config.py clean-legacy` — idempotent, preserves unrelated servers, removes-if-ours-only, refuses a symlinked SSOT). It ALSO prunes the orphaned agy MCP tool-schema cache for cut-over-FROM keys (`LEGACY_CACHE_KEYS=pi-tools-bridge`, `AGY_MCP_CACHE_DIR` overridable) — exact-name whitelist, live/unrelated caches + symlinks untouched. `agy-bridge.sh` renamed `DOCUMENTED/OBSERVED`→`GLOBAL/LEGACY`; doctor labels + run.sh + README comment corrected. `smoke-agy-install-state` +11 (H2/H2b/H2c legacy-migration + H3/H3b cache-prune; 90 total). lint+typecheck green. Oracle migrated + all-3-doctors green + entwurf-bridge handshake lists entwurf_v2.
- Added `entwurf-agy-imprint` thin PreInvocation writer: stdin camelCase payload → `upsertMetaSession({backend:"antigravity", nativeSessionId:conversationId, cwd:workspacePaths[0], model:modelName, transcriptPath})`; stdout always `{"injectSteps":[]}`; no transcript hydration, no receiver marker.
- Added `agy-hooks-bridge` / `agy-hooks-config.py` / `smoke-agy-hooks-state.sh` and `package.json` bin / dev-bin exposure for `entwurf-agy-imprint`.
- Installer now hard-cuts hook SSOT to `~/.gemini/config/plugins/entwurf-agy-imprint/` and doctor fails if legacy top-level `hooks.json` or old `entwurf-probe` plugin carries `agy-birth-probe`/duplicate imprint keys; install cleans only our known legacy keys and preserves unrelated hooks.
- Fixed statusline doctor distinction: `settings.json` file missing = ORPHAN auto-clean, but existing file with `statusLine` removed = DRIFT fail. Added smoke coverage.
- Live cleanup performed: removed stale `/home/junghan/.gemini.bak/antigravity-cli/hooks.json`; removed active top-level hooks; removed old `entwurf-probe` plugin via installer cleanup.

## RECENT

- **[2026-07-09]** 훅 루트 재검증 — `~/.gemini/antigravity-cli/` 확정(동형 실증), `~/.gemini/config/` = gemini-cli 잔재로 판별, `.agents/` = 프로젝트 로컬로 배제. `hooks.md`에서 "훅 cwd = hooks.json 디렉터리" 트랩 발견. §②/§③ mux 설계 → `docs/mux-launch-rail.md` 승격. §④ cortex → 이슈 #48로 승격.
- **[2026-07-04]** agy delivery 레인 종결(origin `b030e44`) — native-push rail ②~⑧ + 설치면 소유 ①②③ + 정본 LIVE green(실 agy conversation `7b758f68`, 13 checks) + `DELIVERY.md` agy **shipped** 승격. 3자 검수(오푸스 구현·페블 리뷰·GPT 라이브 실측) 정렬. **단 이 종결은 oracle 시점** — 디바이스별 인수 잔여가 위 NOW.
- **[2026-07-04]** `0.12.6` released — 설치 경계 봉쇄(live marketplace source = `$XDG_DATA_HOME/entwurf/meta-bridge/.assembled`, install-state가 SSOT, corrupt path fail-loud). tag + npm publish 완료.
- **0.12.4 / 0.12.3 / 0.12.2 / 0.12.1** — hotfix·소넷5 전환(1M 캡 해제)·메타브리지 이식성. 상세 전부 `CHANGELOG.md`.
- `6d06ad0` — `entwurf/gpt-5.4|5.5` ACP-routed 엔트리 제거("ACP Codex is not on this surface until the ACP backend is implemented"). mux 레인의 동기이자 완료판정.

## 다음 레인 (agy 닫힌 뒤, 순서대로)

- **mux launch rail (#47)** — fresh spawn을 mux-visible surface로 통일. 설계 SSOT 전문은 **`docs/mux-launch-rail.md`** (driver 인터페이스 · 3겹 불변식 · repro→driver 매핑 · 테스트 3층 · 착수 8단계). 착수 전 그 문서부터 읽을 것.
- **cortex 통합 → 0.13.0 (#48, PR #40)** — 리뷰 완료·PARK. 전문(green 범위 / 남은 메인테이너 몫 / overlay 버전핀 함정 / 기여자 커밋 보존)은 **이슈 #48**에 있다. 요지: 레지스트리 2개 중 pi provider만 채워졌고 entwurf spawn allowlist는 mux 레인(#47)이 서야 채울 수 있다. PR은 열어둔다 — 기여자는 이미 자기 브랜치로 매일 쓰고 있어 미머지가 아무도 막지 않는다.

## Follow-up (blocker 아님)

- **Post-publish global meta-bridge invariant:** 패키지 업그레이드만으로 Claude의 plugin bundle/cache가 갱신되지 않는다. publish 체크리스트: `pnpm add -g @junghanacs/entwurf@<version>` → `entwurf install-meta-bridge` → 같은 설치면에서 `entwurf doctor-meta-bridge`, 그다음 열린 Claude Code 세션 재시작.
- **C2** `check-pack-install` 확장: fake `claude` CLI + temp `HOME`/`CLAUDE_CONFIG_DIR`로 installed `entwurf install-meta-bridge` 실행 → `~/.claude.json` command가 해시 store 경로 아니라 안정적 `entwurf-bridge`인지 검증.
- **C3** support-floor: 실제 최저버전(2.1.97 오라클) validate/install/doctor를 컷 체크리스트 또는 remote gate로.
- **user-scope 등록 역연산 부재 (2026-07-03):** `install_local_package`는 `register_user_scope_citizen`으로 `~/.pi/agent/settings.json`에 쓰지만 `run.sh remove`는 project scope만 지운다 → 패키지 삭제 시 user-scope `packages[]`에 dangling 경로가 남아 모든 cwd의 pi 기동에 파급(honest-inverse 위반). SSOT(`register-pi-package.py --remove`)는 이미 있으니 인버스 노출 지점만 결정. 경미 nit: `register-pi-package.py` `write_text` 비원자(tmp+rename 없음) — user-scope는 글로벌 파일.
- **멀티하네스(Codex/Antigravity):** claude marketplace 일반화 금지. 하네스별 adapter contract(manifest shape, MCP 등록면, version floor, doctor evidence). 공통화는 runner/reporting만.
- `smoke-acp-skill-live` "secret probe code" → "probe code/project marker" 낮추기(injection-refusal 선제 cleanup).
- **pnpm 10→11 이관 + 단일 설치면(setup) 재검증** — *배경*: npm `codex` 중복에서 출발 → 원인은 pnpm 자기관리 shim(11.5)↔nix pnpm(10.33)이 디렉토리별 버전 스위칭하며 글로벌 스토어를 `global/5`+`global/v11` 둘로 쪼갠 것. 머신 정리: nix 단일 pnpm **11.9.0** + `~/.config/pnpm/rc`(home-manager) `manage-package-manager-versions=false`+`global-bin-dir` 고정 → 자기관리 pnpm/`.tools`/`global/5` 제거. **패키지 소유권 3층**: nix store(선언) / `external-packages.sh`(npm글로벌·벤더·go, 목록SSOT) / per-repo devShell. **entwurf config**: `packageManager: pnpm@10.33.0` 핀 제거, `.npmrc`(pnpm11이 무시하는 죽은 파일) 삭제 → `pnpm-workspace.yaml`이 SSOT, CI `pnpm/action-setup` 10.33→11.9. **설치면**: `./run.sh setup <project>` **단일**로 정리 + `pi install` 제거(project-scope `.pi/settings.json` `packages[]`만으로 provider/ACP 로드됨을 `pi --list-models entwurf`로 실증). *재검증(클린 호스트)*: ① `which -a pnpm` 1개·전역/entwurf 모두 11.9.0 ② 11.9.0에서 `pnpm check` **전체** green ③ `./run.sh setup <scratch>` 한 방 green ④ `pi install` 없이 provider 로드 ⑤ `doctor-meta-bridge` PASS. 소비자(npm)엔 무영향.

## 넘으면 안 되는 선 (전역)

- Work on `main`; 이 레인용 브랜치 만들지 않음.
- **source origin ≠ live artifact** — live marketplace source는 항상 `$XDG_DATA_HOME/entwurf/meta-bridge/.assembled`. 어떤 install/doctor/uninstall/check도 `$REPO/pi/meta-bridge/.assembled`를 만들거나 참조하지 말 것. check/smoke는 실제 `~/.claude`/`~/.claude.json`/`~/.pi`·실제 XDG artifact를 만지지 않는다 — 파괴 검증은 전부 격리 HOME+XDG_DATA_HOME. uninstall의 honest-inverse rm은 XDG에서 유지(약화 금지).
- **live artifact는 checkout 밖(XDG)** — `./run.sh install-meta-bridge`/`setup`이 곧 XDG 이관 절차. repo 안에 `.assembled`를 되살리지 말 것.
- **agy는 native-push domain** — pi socket domain(`LIVENESS_DOMAIN_BACKENDS`)에도 mailbox self-fetch 게이트에도 밀어넣지 않는다. receiver marker/watchArmed는 mailbox 전용 원자 — native-push replyable에 재사용 금지. reject reason `backend-liveness-unsupported`를 agy에 재사용하지 않는다.
- pi floor는 **0.80.3**, entwurf sonnet은 **`claude-sonnet-5`(1M)** — 되돌리지 말 것.
- `core.hooksPath` 안 건드림. `--no-verify` 금지.
- GLG 명시 승인 + green preflight 없이 publish/tag/push 금지.
- live release gate 요청 시 scratch cwd + `LIVE=1`.

## 참조

- 설계 SSOT: `ROADMAP.md` · `docs/acp-backend-rail.md` · `docs/mux-launch-rail.md`
- 닫힌 변경: `CHANGELOG.md` · 검증 calibration: `VERIFY.md` · `BASELINE.md` · `DELIVERY.md`
- repo baseline: `AGENTS.md` · clean-host 설치: `docs/setup-clean-host.md`
- 이슈: #45(소유 경계 원칙) · **#46(이 레인)** · #47(mux) · #48(cortex 0.13.0)
- agy 훅 계약 원문: `~/.gemini/antigravity-cli/builtin/skills/agy-customizations/docs/`
