# NEXT — entwurf 0.12.0 나침반

> 나침반이지 DB가 아니다: **현재 위치 · 다음 한 걸음 · 넘으면 안 되는 선**만 여기 둔다.
> 현재+미래 방향과 설계 SSOT(동결 결정·검증 원장·아키텍처·backlog) = **`ROADMAP.md`**.
> 게시되는 닫힌-변경 핵심 = **`CHANGELOG.md`**. 세션별 process history = git 커밋 log.
>
> **2026-06-16 대정리:** 0.11 작업의 닫힌 ledger(SE-1/2/3 · 세션 #12/#14 · model-in-loop triage 사가 ·
> Stage 0 step 설계 · 동결 결정 · 검증 원장 · backlog)를 `ROADMAP.md`로 이주하고 NEXT를 compass로 축소했다.
> 그 전 2133줄 ledger 전문은 git history(이 커밋 직전 NEXT.md)에 보존됨.

## NOW — entwurf 인플레이스 rename **landed**, 새 위치 GREEN (2026-06-23 갱신)

> **rename cutover 완료.** 패키지 `@junghanacs/entwurf@0.12.0` (커밋 `fcdac5a`), 물리 위치
> `~/repos/gh/entwurf/`. 브랜치 `entwurf-rename`, working tree clean.
>
> **2026-06-23 새 위치 airtight 검증 = GREEN:** `cd ~/repos/gh/entwurf && pnpm check` EXIT=0 —
> lint + typecheck + 60여 게이트 + `check-pack`(181 files tarball) 전 체인 통과. install 전파도 3면 증명
> (.pi/settings.json bridge → 새 경로, old 누수 0 · global registry 심볼릭링크 relink · `pi --list-models
> entwurf` 라이브). 디렉토리명 독립 + install 자가전파(REPO_DIR를 settings에 박음) 확인.

### 재배치 재현 runbook — install은 **2갈래**다 (2026-06-23 statusLine 死 사건의 교훈)

> **근본 원인:** repo를 옮기면(rename/move) install을 다시 돌려야 하는데, install이 둘로 갈려 있다.
> 이번에 `./run.sh install`(=pi 패키지)만 돌리고 `./run.sh install-meta-bridge`(=Claude Code 배선)를 안 돌려서,
> `~/.claude/settings.json` statusLine이 **死한 옛 경로**(`pi-shell-acp/scripts/meta-bridge-statusline.sh`)에 멈춰
> 상태바가 날아갔다. canonical installer 재실행으로 복구.

재배치/clone 후 working state를 **결정적으로 재현**하는 순서 (전부 새 위치에서):

1. `./run.sh install .` — **pi 패키지** 배선 (`.pi/settings.json` 의 `entwurfProvider` + `mcpServers.entwurf-bridge`
   절대경로, global registry 심볼릭링크). REPO_DIR을 self-박음 → 경로 독립.
2. `./run.sh install-meta-bridge` — **Claude Code** 배선 (statusLine·meta-bridge 플러그인·USER-scope `entwurf-bridge` MCP).
   `meta-bridge-state.py apply` 가 `~/.claude/settings.json` statusLine/`.assembled` 를 **현재 REPO 경로**로 박는다.
   ⚠ 이 단계를 빼먹으면 상태바가 옛 경로에 멈춘다 (= 이번 사건).
3. `./run.sh doctor-meta-bridge` — **fail-loud 검증 가드.** `meta-bridge-doctor.sh:117-118` 이 statusLine.command ==
   `$REPO/scripts/meta-bridge-statusline.sh` 를 assert; drift면 `bad "statusLine.command drifted (got…expected…)"`.
   `.assembled`/USER MCP 경로 drift도 같이 잡는다. **재배치 후 이걸 돌렸으면 즉시 빨갛게 떴다.**

> 가드(doctor)는 이미 존재. 갭은 "절차 지식"이었고 이 runbook이 그걸 닫는다. 더 단단히 하려면(선택, GLG 승인):
> `run.sh install` 이 meta-bridge가 **다른 repo 경로**를 가리키는 drift를 감지하면 "install-meta-bridge 돌려라" nudge
> 출력 → 단일 install이 갭을 surface. (pi-only 호스트엔 no-op이 되도록 detection-gated.)

---

### (역사) 2026-06-16 — 0.11.0 컷 준비 완료

**①②③④ + affordance fix 전부 DONE (Opus#3, GPT `87388d` 동행), 커밋 `2ca818f`:**

- **② pi floor `>=0.79.4`** (package.json peer/devDep + lockfile + run.sh:3420 FLOOR + run.sh:3796
  check-pack-install = 6곳, `pnpm check` EXIT0). deterministic 회귀 없음 → 안전.
- **① release-gate two-tier** — MUST(차단·exit authority, "green"은 여기만) / BEHAVIOR(advisory·비차단:
  sentinel·RGG-positive). S7 Bash-우회는 BEHAVIOR lane 안 hard-FAIL이되 컷 비차단.
- **④ fresh LIVE release-gate** (0.79.4+two-tier, log `…20260616T141023`) = **`MUST PASS=17 FAIL=0 SKIP=0`**
  (necessary 충족) **+ `BEHAVIOR PASS=1 FAIL=1`** (sentinel S7 advisory; RGG-positive 직전 FAIL→이번 PASS
  flip로 flaky 입증). VERIFY/CHANGELOG 기록 완료.
- **affordance fix (voscli 사건):** garden-id delivery canonical = `entwurf_v2`, `entwurf_send` 격하
  (tool description MCP+native 4곳 · README tool list에 v2/inbox_read 추가 + "send/reply→v2, create→v1" ·
  CHANGELOG). description+docs only(런타임 무변경, LIVE 유효).

> v1/v2 분리 결론·되는것/안되는것·triage 최종 진단은 **`ROADMAP.md` 「현재 — 0.11.0」**에 정리됨.

## 다음 한 걸음 — rename 후행 tail (전부 GLG 결정)

> 코드/install/런타임 축은 닫혔다. 남은 건 **전역 설정·GitHub repo·old 폴더 처분** — 전부 GLG 손/결정.

1. **GitHub repo rename = GLG.** `origin` 아직 `git@github.com:junghan0611/pi-shell-acp.git`. GitHub에서
   repo rename(pi-shell-acp→entwurf) 후 `git remote set-url origin …/entwurf.git`. (GitHub는 old명 redirect 유지.)
2. **consumer repoint = GLG.** 새 경로를 박을 전역 설정들 (지금 old `pi-shell-acp/` 가리킴):
   - ✅ `~/.claude.json` top-level mcpServers `pi-tools-bridge` (dangling: `pi-shell-acp/mcp/pi-tools-bridge/start.sh`,
     bridge가 `entwurf-bridge`로 rename되며 죽은 줄 + env가 구namespace `PI_TOOLS_BRIDGE_*`) **= 2026-06-23 제거됨**
     (`claude mcp remove pi-tools-bridge -s user`). top-level mcpServers 이제 `{}`.
   - ⏳ agent-config repo lane (= `~/.pi/agent/settings.json` 심볼릭링크 대상): `piShellAcpProvider`(→`entwurfProvider`로
     rename) · `piShellAcpProvider.mcpServers.pi-tools-bridge`(같은 dangling) · `packages` 의 `pi-shell-acp`(→`entwurf`).
     **entwurf만 piecemeal 금지** — provider명+packages+mcpServers를 한 번에 옮겨야 half-migrated 안 됨. agent-config lane에서 처리.
   - ⏳ `~/.claude/settings.json` → `pi-shell-acp/pi/meta-bridge/.assembled` + `scripts/meta-bridge-statusline.sh`.
     주의: **entwurf엔 `.assembled` 가 아직 없다**(build artifact, gitignore). 새 경로로 돌리기 전 assemble 선행 필요.
3. **old 폴더 처분 = GLG.** `pi-shell-acp/`(rename 원본, 동일 커밋), `pi-shell-acp-v1/`, `pi-entwurf/` 잔존.
   archive/삭제 결정. **단 consumer repoint(2번)가 끝나기 전엔 old 삭제 금지** — 위 설정들이 아직 의존.
4. **push/컷 = GLG.** 0.12.0 bump 커밋은 로컬-온리. push 후 agenda stamp.

## 넘으면 안 되는 선

- `core.hooksPath` 건드리지 않음. **push / tag / npm publish = GLG 결정 전 금지.** `--no-verify` 금지.
- CHANGELOG는 게시됨(npm tarball, 이미 225KB) — 내부 process detail 덤프 금지, 핵심만. 내부 ledger는 ROADMAP.
- agent는 `CHANGELOG.md` + `NEXT.md` + (요청 시) `ROADMAP.md`만 편집. AGENTS.md 무단 수정 금지.

## 참조

- **현재+미래 방향 · 설계 SSOT:** `ROADMAP.md`
- **닫힌 변경 핵심(게시):** `CHANGELOG.md`
- **검증 calibration:** `VERIFY.md` · **전달 capability levels:** `DELIVERY.md` · **repo baseline:** `AGENTS.md`
- 본체 `~/repos/gh/entwurf/` (old `pi-shell-acp/` = rename 원본, tail 닫히면 처분) · consumer `~/repos/gh/agent-config/`
