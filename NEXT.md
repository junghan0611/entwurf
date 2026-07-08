# NEXT — entwurf post-0.12.6: ⓪ #46 설치면 소유 이관 → ② fresh spawn / ③ mux

> 나침반이지 DB가 아니다: **현재 위치 · 다음 한 걸음 · 넘으면 안 되는 선**만 둔다.
> 현재+미래 방향과 설계 SSOT = **`ROADMAP.md`**. 닫힌 변경 핵심 = **`CHANGELOG.md`**. 세션별 process history = git log.

## DONE — 0.12.6 released (설치 경계 봉쇄) + agy delivery 레인 종결

- **agy delivery 레인 종결 (2026-07-04, 전부 push됨 — origin=`b030e44`)** — 봉인 9항 계약 하에 native-push rail 구현 ②~⑧(오푸스 11커밋) + 설치면 소유 ①②③(setup 편입 `af5d2ba`·dev-bin `da5579f`·agent-config 심링크 놓기) + ⑨ 정본 LIVE green(오라클 실 agy conversation `7b758f68`, 13 checks) + `DELIVERY.md` agy **shipped** 승격 + GPT origin fresh-clone 수용 @`c091bad`. 3자 검수(오푸스 구현·페블 리뷰·GPT 라이브 실측) 정렬. 계약 상세 = `DELIVERY.md` + `b030e44` 시점 NEXT(git log). **단, 이 종결은 oracle 시점** — 디바이스별 인수 잔여는 아래 NOW의 Task 0.
- **0.12.3 released** — 소넷5 전환+1M 캡 해제(`claude-sonnet-5` 전역 스왑, Sonnet 200K 캡 제거 → "compact 없이 가는" 기반), deps 정렬(wire SDK 1.1.0 메이저 포함, pi floor **0.80.3**), workflow 스칼라 2종 메타브리지 관리 추가, GPT 검수 반영(live smoke stale-timer 등). 상세 CHANGELOG. **`6d06ad0` fix(targets):** `entwurf/gpt-5.4|5.5` ACP-routed 엔트리 제거 — "ACP Codex is not on this surface until the ACP backend is implemented" → §③ mux 레인의 동기이자 완료판정.
- **0.12.6 released** — tag `v0.12.6` + npm `@junghanacs/entwurf@0.12.6` publish 완료(2026-07-04 오라클 실측: `git tag`·`npm view` 확인). 설치 경계 봉쇄를 코드/검증/라이브 배선까지 닫음. dev·npm 모두 live marketplace source를 `$XDG_DATA_HOME/entwurf/meta-bridge/.assembled`에 조립하고 repo/node_modules는 source origin으로만 남김. uninstall/doctor/check는 install-state의 recorded `assembledMarketplacePath`를 SSOT로 쓰며, missing/empty/bad-basename/corrupt path는 side-effect 전 fail-loud. `smoke-meta-install-state`가 install→XDG, recorded A 제거/env B 보존, corrupt path side-effect 0, state+settings both-corrupt FAIL, checkout-internal `.assembled` 미생성을 검증. `smoke-user-scope-citizen`으로 user-scope pi package registration도 고정.
- **0.12.4 hotfix 완료** — 일반설치 floor(`node_modules`)에서 `doctor-meta-bridge`가 raw `.ts` helper를 strip-types 실행해 가짜 FAIL 내던 버그 수정. hejdev6 실측: pre-fix `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` 재현, patched tarball 설치 후 compiled store-doctor plain-node scan + v2-surface defer 통과. tag/GitHub release/npm publish 완료.
- **0.12.2/0.12.1** — 이전 릴리즈(메타브리지 install 이식성 + `check-meta-manifest-schema`, 오라클 설치검증). 상세는 CHANGELOG.

## NOW — agy를 Claude Code 급으로 닫기 (#46 stem): display는 됐고, **자동 birth**가 남았다

**Stem:** 지금 닫을 것은 **agy**다. Claude Code는 SessionStart hook으로 켜자마자 garden id가 붙는다. agy도 "Claude Code 급"이라면 **누가 수동으로 `entwurf_register_native`를 실행해주면 안 된다** — 새 agy conversation이 정상 launch에서 자동으로 meta-record를 만들고 statusline에 gid가 떠야 한다. GLG 지시(2026-07-08): **"후크로 만들어. 구현 줄이고 간단하게 하지만 모든 하네스 동급으로."** pi-provider Task2는 별도 후반부/대기 전선이며 agy blocker가 아니다.

### 현재 사실 (2026-07-08 thinkpad 라이브 실측) — 끝난 것과 안 끝난 것

- **끝남·라이브: agy MCP install 인수.** `~/.gemini/antigravity-cli/mcp_config.json` → bare `entwurf-bridge` 실측. `doctor-agy-bridge` static/state OK. (dangling symlink 2개는 `smoke-agy-install-state` E2로 봉인 후 제거됨.)
- **끝남·라이브: agy statusline 표시/조회 면(Reader).** `~/.gemini/antigravity-cli/settings.json` → `statusLine.command = "entwurf-agy-statusline"`(custom/enabled) 실측. `statusLine` subtree 통째 소유, 별도 XDG state, symlink refuse, honest inverse, dev-bin 다중화, `doctor-agy-statusline`, setup non-fatal 편입. Smoke `smoke-agy-statusline-state` 53 checks. stdin `conversation_id`로 record body를 `nativeSessionId` 스캔해 gid/`?` 렌더 — **읽기 전용, record를 만들지 않음.**
- **미흡: birth 자동화(Writer 부재).** meta-record를 만드는 훅이 없다 → 새 conversation은 수동 `entwurf_register_native` 전까지 영원히 `?`. `🪛 ? agy` → 수동 register → `🪛 <gid> agy`였던 07-06 실증은 표시·역조회 사슬 증거일 뿐, CC 급 자동 각인이 아니다.
- **잔여(#46 완료판정): agent-config 옛 소유 미회수.** `~/repos/gh/agent-config/antigravity/{settings.json,statusline.sh}`가 아직 존재(구 `statusline.sh` 절대경로 보유). 라이브 CLI는 `antigravity-cli/`를 읽으므로 경합은 아니나, #46은 agent-config가 "놓음"을 요구 — imprint close와 함께 정리.

### 훅 루트 = `~/.gemini/antigravity-cli/` (실측 확정, GPT+agy 교차확인 2026-07-08)

**`~/.gemini/config/`는 이 레인에서 금지.** 근거: 이미 작동하는 두 어댑터(MCP·statusLine)가 전부 `~/.gemini/antigravity-cli/`에 쓰고, `~/.gemini/config/mcp_config.json`은 0바이트(CLI가 안 씀). agy 본체도 `~/.gemini/antigravity-cli`를 App Data Directory로 확인. `json_configs.md`가 전역 등록을 보장하는 건 `skills.json`/`plugins.json`뿐이며 `hooks.json`은 그 목록에 없다 → 전역 config root 가설 폐기.

- **1순위 hook target:** `~/.gemini/antigravity-cli/hooks.json` (CLI 실 customization root; `hooks.md`가 "customization root의 hooks.json"이라 명시).
- **2순위 fallback(1순위가 발화 안 하면):** 같은 root 아래 plugin 방식 — `~/.gemini/antigravity-cli/plugins/entwurf/plugin.json` + `.../plugins/entwurf/hooks.json`. (plugin hooks는 `plugins.md`가 실행을 명시.)
- **settings.json `hooks` 키는 비권장/후순위.** statusLine은 settings가 맞지만 hooks까지 settings subtree라는 증거 없음.

### 다음 한 수 — PreInvocation imprint 훅 (코드 전에 probe로 루트 확정)

> **GPT 검수 GO (2026-07-08):** config 폐기 / antigravity-cli hooks.json 1순위 / plugin fallback / settings.json hooks 후순위 / stdout `{"injectSteps":[]}` / acceptance "수동 register 0 자동 birth" / "공유 birth core + 얇은 envelope adapter" — **전부 OK.** 단 **probe-first 권장**: 코드부터 짜면 잘못된 install surface에 맞춰 doctor/smoke를 만들 위험 → 어느 hook file을 agy가 실제로 읽는지부터 실측하고 그 위에 배선.

**계약 확정(`hooks.md` 실측):** PreInvocation = 첫 모델 호출 직전. payload common fields camelCase — `conversationId` + `workspacePaths[0]`(cwd) + `transcriptPath` + `modelName`(= CC upsert 입력과 필드 대칭). 훅은 **동기 블로킹**(timeout 30s default) + **매 invocation 발화**(`invocationNum` 증가) → best-effort·빠름 필수.

**0. 먼저: 루트 probe (live, GLG 승인 완료 — 다음 세션에서 실행).**
   - **대상 2곳만, 순서대로:** (1) `~/.gemini/antigravity-cli/hooks.json`, 실발화 안 하면 (2) `~/.gemini/antigravity-cli/plugins/entwurf/{plugin.json,hooks.json}`.
   - **안전 계약(양쪽 공통, 위반 금지):**
     - **preimage 백업/복구 필수.** 기존 파일이 있으면 원본을 백업하고, probe 끝나면 원상 복구.
     - **기존 `hooks.json` 절대 clobber 금지** — named hook **하나만** adopt-and-preserve로 추가/삭제(다른 hook 키 보존).
     - **plugin fallback도 동일 규율** — preimage 백업/복구 + named plugin(entwurf)만 제거.
     - **probe hook은 stdout `{"injectSteps":[]}`만** 방출. **payload dump는 temp/log 파일로만** 남김(터미널/루프에 안 흘림).
     - **`~/.gemini/config`는 건드리지 않음.**
     - probe 중 만든 파일/디렉터리는 끝나면 **전부 정리.**
   - **검증(성공 판정):** ① 훅이 실발화 ② payload에 `conversationId`/`workspacePaths` 실림 ③ `{"injectSteps":[]}`이 agy 루프를 안 깸. **결과(성공/실패, 확정 target)를 NEXT.md에 실측값으로 반영** → 그 다음에야 step 1~3.
**1. `entwurf-agy-imprint` bare bin.** PreInvocation stdin → `conversationId`+`workspacePaths[0]` → **공유 birth core** `upsertMetaSession({backend:"antigravity", nativeSessionId:conversationId, cwd, transcriptPath, model})`(scan-by-nativeId → idempotent create/attach). **stdout `{"injectSteps":[]}` 고정**(빈 `{}` 아님 — PreInvocation 출력계약). best-effort+log(agy 루프 절대 안 막음), 빈 `conversationId` 등록 금지. mailbox arm/sender·receiver marker/watchPaths는 **넣지 않음**(Claude native-push 전용). "구현 줄이고 동급": `meta-bridge-hook.ts`와 birth core를 공유하고 envelope 어댑터만 얇게 분리(← GPT 검수: core 공유 vs 복제).
   - **검증:** 격리 stdin(camelCase 봉투)로 bin 직접 구동 → meta-record 1개 생성, body `backend=antigravity`/`nativeSessionId`/`cwd` 정합, 재실행 시 attach(중복 0), 빈 `conversationId`면 no-write + log.
**2. installer 배선(step 0 확정 target).** PreInvocation → `entwurf-agy-imprint`. statusline과 **동일 계약** — adopt-and-preserve, honest inverse(우리가 넣은 키만 제거), **stable bin only**(repo/checkout 경로 금지), symlink refuse, setup non-fatal. **구현 줄이기:** 별도 XDG state·config.py·doctor·smoke triad를 새로 만들기보다 **기존 agy 어댑터에 {mcp,statusLine,hooks} 흡수**를 우선 검토(← GPT 검수).
   - **검증:** install→해당 hook file에 named hook 존재 + stable bin 해석, uninstall→우리 키만 제거·나머지 보존, 두 번 install 멱등, config가 symlink면 refuse, checkout 안에 아티팩트 0.
**3. doctor + smoke.** hook 배선·resolvable·state 정합 doctor + smoke(멱등/symlink refuse/honest inverse/corrupt refuse/checkout impurity 0/빈 id 등록거부). 2번 흡수 여부에 따라 신설 vs 기존 확장.
   - **검증:** `doctor-agy-*` rc0(정상)·dangling static FAIL·agy 부재 시 live-SKIP(PASS 둔갑 금지), smoke는 격리 HOME+XDG에서 전 계약 통과(check count 기록).
**4. live close gate = 수동 register 0.** `entwurf_register_native`는 debug/명시 경로로 잔존. close = **새 conversation에서 사람/형제 tool call 없이** meta-record 자동 생성 → 같은 conversation statusline `🪛 <gid> agy`. 첫 메시지 전 짧은 `?`는 timing상 허용.
   - **검증:** 새 agy conversation 하나 → register 호출 0 → 첫 invocation 후 record body `backend=antigravity`/`nativeSessionId=<conversationId>`/`cwd` 정합 + statusline gid 육안 확인.
**5. 문서/회수.** `DELIVERY.md` ambient-status 축 "완료" 승격 + `agent-config/antigravity/{settings.json,statusline.sh}` 잔재 회수(#46 완료판정).
   - **검증:** agent-config 회수 후에도 라이브 statusLine/MCP/hook 무중단, `doctor-agy-*` 전부 rc0.

### Parked — pi-provider Task2 (agy blocker 아님)

- 코드 `7240023`은 user/project `entwurfProvider.mcpServers.entwurf-bridge`를 bare `entwurf-bridge`로 이관하는 pi/ACP provider 후반부다. 현재 thinkpad live는 아직 legacy repo path일 수 있지만, 이것은 agy 완료판정이 아니다.
- trap: `doctor-pi-provider` rc0는 완료가 아니며 malformed project shadow false-green gap이 있다. pi-provider를 다시 열 때 먼저 doctor/smoke를 보강한다.
- agent-config의 pi `packages[]`/`entwurfProvider` 제거도 pi-provider live 이관 뒤의 별도 repo 후속이다. agy close 중에는 손대지 않는다.

### 넘으면 안 되는 선 (이 stem 한정)

- **`~/.gemini/config/` 금지** — 이 레인은 `~/.gemini/antigravity-cli/`만 건드린다. 전역 Gemini root(config/hooks.json, config/plugins.json)에 쓰지 말 것.
- **settings.json에 `hooks` 키 넣지 말 것**(비권장) — hooks는 hooks.json/plugin 경로로.
- agy를 "register 후 citizen이 정본"으로 닫지 말 것. Claude Code 급이면 **자동 birth**가 필요하다.
- cwd 역매칭으로 gid를 발명하지 말 것. `conversationId/nativeSessionId`만 권위다.
- PreInvocation stdout은 **`{"injectSteps":[]}`** — 빈 `{}`로 얼버무리지 말 것. 훅은 동기 블로킹이니 best-effort·빠름 위반 금지.
- pi-provider / mux / spawn을 agy close blocker로 끌고 오지 말 것.
- imprint를 넣더라도 agy 루프가 느려지거나 깨지면 안 된다: bounded, best-effort, 실패 시 조용히 log + `{"injectSteps":[]}`.

**agy delivery 레인 이월 잔여(blocker 아님):** 기존 meta-record `20260704T201811-071ba8` prune은 GLG 확인 대기. smoke-owned agy launch / dead reject / transcript content-receipt는 mux/launch 생애주기 필요 시 후속으로 다룬다.

## ② (⓪ 이관 뒤 착수) fresh spawn도 mux-visible로 통일

v2에 spawn이 "없는" 게 아니다. `entwurf_v2 owned-outcome`은 **기존 dormant pi citizen**을 `spawn-bg resume`으로 깨우는 production path가 있고 `smoke-entwurf-v2-spawn-resume-live`가 실 child+turn을 검증한다. 빠진 것은 v1 `entwurf`가 하던 **무에서 새 sibling을 만드는 fresh spawn/mint**.

**정렬:** fresh launch를 **mux-visible surface로 먼저 통일**한다. pi-native GPT도 bg/detached `pi -p`로 숨기지 않고 투명하게 pane/session으로 보이며 같은 launch 관문을 통과 → pi를 Claude Code/Codex/Antigravity와 같은 급의 "4번째 하네스"로 세운다. pi 전용 headless/bg 최적화는 GLG가 나중에 명시할 때 별도 레인.

- v1 본체: `pi-extensions/lib/entwurf-core.ts` `runEntwurfSync`(:1940) = fresh-mint 본체 — registry gate `resolveEntwurfTarget`(미등록 reject) + session-id/name/cwd-enrich. resume는 `runEntwurfResumeSync`(:1772, registry 우회). launch arg SSOT `entwurf-resume-args.ts`. 주: fresh-mint는 현재 `--no-extensions` one-shot worker이지 `-p`/control 경로 아님.
- **레지스트리 현황(6d06ad0 이후):** `entwurf/claude-sonnet-5`·`entwurf/claude-opus-4-8`(ACP claude), `openai-codex/gpt-5.4|5.5`(native), `entwurf/gemini-3.1-pro-preview`(ACP gemini, explicitOnly). **ACP Codex 엔트리는 삭제됨** — 즉 "Claude Code에서 새 GPT 불러줘"는 레지스트리가 하드 차단. mux 레인이 서야 되살릴 수 있음.

## ③ (⓪ 이관 뒤 착수) mux-agnostic spawn/launch surface

네이티브 백엔드(Claude Code)는 인터랙티브 TTY 필수 → headless 불가 → **multiplexer가 곧 launch surface**. pi-native GPT도 같은 mux-visible surface로 올린다. **tmux 전용 금지** — mux driver 인터페이스 뒤에서 `tmuxDriver`/`zmxDriver`가 동급. zmx는 후순위 장식이 아니라 경량 1급 후보(driver 한 개 갈아끼우는 일이 되도록). **원칙/후보 재정렬 = issue #47**(herdr = agent-aware 위험 강등, zmx/tmux 우선, zmx 확보는 설치면 계약 — probe/optional + self-fetch, 하네스 전제 금지).

**코드 실측(2026-07-01 재확인, drift 없음):**
- transport enum `ENTWURF_V2_TRANSPORTS`(`entwurf-v2-contract.ts:186`) = `["control-socket","spawn-bg","tmux-live","meta-mailbox"]`. `tmux-live`는 enum 한 값일 뿐. (07-04 native-push 추가로 5값 — ⓪ 레인과 무관.)
- **프로덕션 launch 코드에 tmux 직접 호출 0개**(grep empty). tmux 4동작은 `scripts/raw-async-delivery/repro-{plugin-idle-wake,addressed-routing}.sh`에만 존재 → **spawn launch는 프로덕션 빈칸**. 이 빈칸을 mux 추상화로 채우는 게 이번 레인.
- `tmuxTarget`은 **프로덕션/스키마 필드가 아님** — fixture 2줄뿐(`check-entwurf-capabilities.ts:110`, `check-meta-record-v2.ts:188`, 둘 다 `"psa:3.1"`). 즉 "네이밍 중립화"는 cosmetic이고, 진짜 `muxTarget`/`paneTarget` 필드는 프로덕션 spawn이 생길 때 **새로 정의**하는 것(기존 prod 필드 rename 아님).

**repro 4동작 → driver 메서드 매핑 (tmuxDriver 이식 대상):**

| repro (tmux) | driver 메서드 | 세부 |
|---|---|---|
| `tmux new-session -d -s <n> -x 200 -y 50` + `set-option @entwurf_garden_id/@entwurf_parent_garden_id` | `launch(spec)` | detached, geometry는 spec. **namespace 각인** → tmux server가 lineage 레지스트리(형 통찰). driver는 opaque 문자열만 새김(의미 모름) |
| `tmux send-keys -t <n> -l "<text>"` | `pasteText(target,text)` | literal 주입만. `-l`/paste-buffer 여지(arbitrary prompt 안전) |
| `tmux send-keys -t <n> Enter` | `sendKey(target,key)` | 단일 키 |
| (조합) `pasteText→sendKey(Enter)→sleep(1)→sendKey(Enter)` | **driver 아님 → launch-profile(claude-code, ①-7)** | 더블-Enter 제출은 mux 차이 아니라 CC TUI submit policy. driver에 박으면 pi-native/타 TUI 오염 |
| `tmux capture-pane -t <n> -p` | `capture(target)` | raw pane text만. 폴링(`grep -qE '●\s*READY'`)은 호출측 책임 |
| `tmux list-sessions -F …` | `list(): MuxSessionView[]` | ★ 활성 파악 + 각인 읽어 lineage. **view, not fact** — authority(socket/meta-record/probe) 아님, 교차검증·진단 전용. 미각인은 optional 부재(throw 아님) |
| `tmux kill-session -t <n>` | `kill(target)` | idempotent — `\|\|true` 셸 대신 runner `okExitCodes` |
| (암묵 `has-session`) | `isAlive(target)?` | 선택 |

**동형 레퍼런스(그대로 미러):** `pi-extensions/lib/acp/backend-adapter.ts` — `interface AcpBackendAdapter`(:115), `claudeAdapter`(:194), `const ADAPTERS = [claudeAdapter]`(:275), `resolveAcpBackendAdapter(modelId)`(:287). driver 1개 = mux 1개 = siblings-not-workers의 mux 레이어 반복.

**설계 3겹 불변식 (2026-07-01 opus4.8 ↔ gpt-5.5 3라운드 확정 — 어기면 tmux가 코드를 삼킨다):**
1. **driver 불변식 = `$TMUX` 비의존.** caller가 tmux 밖이어도 `tmux new-session -d`로 detached 생성. "mux가 launch surface"이지 "caller도 mux 안"은 아님. → `check-mux-driver` fake-runner가 강제(fake엔 `$TMUX` 개념 없음).
2. **관찰 규율 = mux-visible launch가 default, 유령 분신 금지.** caller가 tmux 안이면 같은 server에 떠서 `tmux ls`+`switch-client`로 즉시 adopt. 강제 아니라 권장 posture(`opens siblings, not disposable workers`의 tmux 판). → manual observe smoke.
3. **경계 불변식 = mint ≠ transport.** spawn/mint(garden-id 발급·registry·name/cwd/model)는 **mux를 모른다**; driver는 **mint를 모른다**. mint/core 파일군의 `lib/mux/*` import 금지를 `scripts/check-mux-boundary.ts`(TS compiler API로 `ImportDeclaration`+dynamic import string literal 검사, **allowlist 방식** — launch-profile/orchestrator만 허용)가 강제(①-7). "강제하면 코드가 tmux를 따라간다"의 실물 방어.

**테스트 3층 (GPT 제안 채택):**
- `check-mux-driver` — fake runner deterministic. argv/순서/kill idempotency(`okExitCodes`)만 단언. tmux 바이너리 불요.
- `LIVE=1` smoke — 진짜 tmux로 detached 생성/캡처/kill. `$TMUX` 비의존 증명.
- manual observe smoke — "parent inside tmux 권장" + `$TMUX` 감지 시 `switch-client -t <handle>` 힌트. attach/switch는 core driver 아님 → 후속 `openMuxTarget` manual 레이어.

**착수 플랜(순서대로):**
1. **mux driver 인터페이스 먼저 (leaf module)** — 새 파일 `pi-extensions/lib/mux/driver.ts`. `entwurf-core`를 import하지 않는 순수 transport leaf(tmux argv + injectable runner). GPT 검수 반영 shape:
   ```ts
   export interface MuxDriver {
     readonly id: "tmux" | "zmx";                 // bare id — transport 문자열은 호출측이 {tmux:"tmux-live",zmx:"zmx-live"}로 파생
     launch(spec: MuxLaunchSpec): Promise<MuxTarget>;
     pasteText(t: MuxTarget, text: string): Promise<void>;  // literal 주입만 (send-keys -l 여지)
     sendKey(t: MuxTarget, key: string): Promise<void>;     // 단일 키 (Enter 등)
     capture(t: MuxTarget): Promise<string>;                // raw pane text (호출측 폴링)
     kill(t: MuxTarget): Promise<void>;                     // idempotent
     list(): Promise<MuxSessionView[]>;                     // 진단용 관찰 스냅샷 — authority 아님(view, not fact)
     isAlive?(t: MuxTarget): Promise<boolean>;
   }
   export type MuxLaunchSpec = {
     gardenId: string; parentGardenId?: string;   // → @entwurf_garden_id / @entwurf_parent_garden_id 각인(namespace)
     command: string[]; env?: Record<string, string>;
     geometry?: { cols: number; rows: number };    // default 200×50
     cwd?: string;
   };
   // MuxTarget = launch/resolve된 실행 핸들. branded → list 결과(MuxSessionView)를 send/kill에 실수로 못 넣게
   export type MuxTarget = { readonly __brand: unique symbol; driverId: "tmux" | "zmx"; gardenId: string; handle: string; driverData?: unknown };
   // MuxSessionView = tmux ls 관찰 스냅샷. dispatch authority 아님(socket/meta-record/probe가 authority). conflict는 diagnostic bucket
   export type MuxSessionView = { driverId: "tmux" | "zmx"; handle: string; gardenId?: string; parentGardenId?: string; observedAt: number; raw?: string };
   export function createTmuxDriver(deps: { runner: MuxRunner; sleep?: (ms: number) => Promise<void> }): MuxDriver; // argv 순수부/부수효과 분리
   export const tmuxDriver: MuxDriver;              // createTmuxDriver({ runner: realRunner })
   export const DRIVERS: readonly MuxDriver[] = [tmuxDriver /*, zmxDriver */];
   export function resolveMuxDriver(id: string): MuxDriver; // resolveAcpBackendAdapter 미러 fail-fast
   ```
   - submit quirk(더블-Enter)는 **여기 없음** — claude-code launch-profile(①-7)이 소유. `pi-native-gpt`는 자기 submit policy.
   - `driver.ts`는 leaf: `entwurf-core`/mint import 금지. 역방향(mint→`lib/mux`) 금지는 ①-7 import-boundary 게이트.
2. **`tmuxDriver` 구현** — repro 동작 이식하되 각 메서드는 `plan*(): string[][]`(argv) 계산 → injectable runner 실행. geometry/`@garden_id`/`@parent_session_id`는 spec. 더블-Enter는 **여기 아님**(①-7). repro 스크립트는 그대로 두되 프로덕션 경로가 driver를 쓰게.
3. **deterministic 게이트 `check-mux-driver.ts`** — 실제 tmux 없이 fake runner로 tmuxDriver 구동: primitive별 argv/순서 단언, `@garden_id` 각인 단언, kill idempotency(`okExitCodes`), `resolveMuxDriver` fail-fast. `check-acp-*` 스타일. `pnpm check` 체인 + `run.sh` dispatch 배선.
4. **`zmxDriver` 스텁** — 같은 interface로 `DRIVERS=[tmux,zmx]`가 컴파일되게. 미구현 op는 fail-loud. **zmx 확보 = 설치면 계약(#47 코멘트): `command -v zmx` probe → optional, 없으면 tmux fallback; 능동 확보는 upstream prebuilt self-fetch(opt-in), nix flake/external-packages.sh/특정 하네스 PATH 전제 금지.**
5. **enum 공존** — `ENTWURF_V2_TRANSPORTS`(:186)에 `zmx-live` 추가(`tmux-live`와 공존). schema↔types 게이트 갱신 **+ `DispatchVerdict`의 resume union도 같이 확장(GPT 지적 — 놓치면 타입 갈라짐)**. mux 종류를 별도 필드로 빼는 추상화는 금지(enum 나열 > 추상화 두께).
6. **네이밍 중립화(cosmetic)** — fixture `tmuxTarget`(위 2줄) → `muxTarget`. 프로덕션 필드가 아니므로 리스크 낮음.
7. **fresh pi-native GPT launch profile(더 큰 후속)** — `runEntwurfSync`(:1940)의 registry/session-id/name/cwd-enrich 자산 재사용하되, `--no-extensions` detached one-shot 복구가 아니라 mux-visible `pi-native-gpt` launch profile로 설계(`claude-code`/`codex`/`agy`도 같은 launch/observe/capture/kill 규율). **완료판정:** mux launch가 서면 `6d06ad0`이 지운 `entwurf/gpt-5.x` ACP 타깃을 레지스트리에 되살릴 수 있음.
8. **agy(Antigravity) spawn** — spawn surface 통일 **후** 그 위에 얹기(기반 먼저 안 서면 launch seam이 갈림). *주: agy **delivery/설치 어댑터**는 07-04 레인에서 mux보다 먼저 감 — 갈라진 건 launch면뿐.*

## ④ (수동·대기) PR #40 cortex 어댑터 재안착 — 공은 hvkiefer

- 우리 쪽 준비 끝: 레일 doc(`docs/acp-backend-rail.md`) + PR 개발 가이드 댓글. 레일 green.
- hvkiefer: `cortexAdapter` 1개 신규(`pi-extensions/lib/acp/backend-adapter.ts`) + `ADAPTERS` 등록 + curated cortex 모델 + `SNOWFLAKE_HOME` overlay + `check-acp-*` cortex 단언 + `smoke-acp-cortex-live`. 공통 turn loop 무수정.
- **미정 1건:** carrier 부재 백엔드(cortex)의 operator engraving이 first-user augment(`augment.ts`)에 합류하는 방식 — 현재 augment는 engraving 미탑재. cortex PR이 그 경로 정의.
- 들어오면 `check-acp-*` 6종 + `smoke-acp-cortex-live` 기준 리뷰, 공통층 무수정 불변식 확인.

## Follow-up (blocker 아님)

- **Post-publish global meta-bridge invariant:** package upgrade alone does not refresh Claude's plugin bundle/cache. Future publish checklist: `pnpm add -g @junghanacs/entwurf@<version>` → `entwurf install-meta-bridge` → `entwurf doctor-meta-bridge` from the same installed surface, then restart open Claude Code sessions. With the main follow-up, installed statusLine/MCP use stable bins and marketplace source uses a stable data dir; reinstall remains the explicit bundle refresh, not a dead-link repair.
- **C2** `check-pack-install` 확장: fake `claude` CLI + temp `HOME`/`CLAUDE_CONFIG_DIR`로 installed `entwurf install-meta-bridge` 실행 → `~/.claude.json` command가 해시 store 경로 아니라 안정적 `entwurf-bridge`인지 검증.
- **C3** support-floor: 실제 최저버전(2.1.97 오라클) validate/install/doctor를 컷 체크리스트 또는 remote gate로.
- **user-scope 등록 역연산 부재 (페블 GO 판정 명명 팔로업, 2026-07-03):** `install_local_package`는 `register_user_scope_citizen`으로 `~/.pi/agent/settings.json`에 쓰지만 `run.sh remove`는 project scope만 지움 — 소비자가 패키지 삭제 시 user-scope packages[]에 dangling 경로가 남아 모든 cwd의 pi 기동에 파급 가능(honest-inverse 위반). SSOT(`register-pi-package.py --remove`)는 이미 있으니 인버스 노출 지점만 결정(remove가 user-scope도 내리거나 별도 커맨드). 경미 nit 동반: register-pi-package.py `write_text` 비원자(tmp+rename 없음) — user-scope는 글로벌 파일. **⓪ 레인 Task 2와 인접 — 오푸스 판단으로 같이 닫아도 됨.**
- **멀티하네스(Codex/Antigravity):** claude marketplace 일반화 금지. 하네스별 adapter contract(manifest shape, MCP 등록면, version floor, doctor evidence). 공통화는 runner/reporting만.
- `smoke-acp-skill-live` "secret probe code" → "probe code/project marker" 낮추기(injection-refusal 선제 cleanup, GPT 제안 이월).
- **pnpm 10→11 이관 + 단일 설치면(setup) 재검증** — *배경*: npm `codex` 중복(같은 바이너리가 `~/.local/share/pnpm/bin`과 부모 dir에 2개)에서 출발 → 원인은 pnpm **자기관리 shim(11.5)↔nix pnpm(10.33)** 이 디렉토리별 버전 스위칭하며 글로벌 스토어를 `global/5`(pnpm10)+`global/v11`(pnpm11) 둘로 쪼갠 것. 머신 정리: nix 단일 pnpm **11.9.0** + `~/.config/pnpm/rc`(home-manager) `manage-package-manager-versions=false`+`global-bin-dir` 고정 → 자기관리 pnpm/`.tools`/`global/5` 제거. **패키지 소유권 3층**: nix store(선언) / `external-packages.sh`(npm글로벌·벤더·go, 목록SSOT) / per-repo devShell(특정버전 필요 시). **entwurf 쪽 config**: `packageManager: pnpm@10.33.0` 핀 제거(전역 nix pnpm 따라감), `.npmrc`(pnpm11이 무시하는 죽은 파일) 삭제 → `pnpm-workspace.yaml`(autoInstallPeers:false + allowBuilds `@google/genai`·protobufjs false)이 SSOT, CI `pnpm/action-setup` 10.33→11.9. **설치면**: `./run.sh setup <project>` **단일**로 정리 + `pi install` 제거(중복 확정 — project-scope `.pi/settings.json` `packages[]`만으로 provider/ACP 로드됨을 `pi --list-models entwurf`로 실증; pi 바이너리는 필요, pi install 커맨드는 불필요). *재검증(다음 세션/클린 호스트)*: ① `which -a pnpm` 1개·전역/entwurf 모두 11.9.0 ② 11.9.0에서 `pnpm check` **전체** green(이번엔 dep-versions/문법만 확인함) ③ `./run.sh setup <scratch>` 한 방 green ④ `pi install` 없이 provider 로드 ⑤ `doctor-meta-bridge` PASS. 소비자(npm)엔 무영향(tarball=package.json+files만; `.npmrc`/`pnpm-workspace.yaml`/lock 제외).

## 넘으면 안 되는 선

- Work on `main`; 이 레인용 브랜치 만들지 않음.
- **⓪ 레인 봉인 계약 6항(위 NOW)** — 특히 keyset 1개 수술 원칙·이관 순서(새 소유자 먼저)·stable bin only·honest 라벨.
- **source origin ≠ live artifact** — live marketplace source는 항상 `$XDG_DATA_HOME/entwurf/meta-bridge/.assembled`(repo/npm 조립 입력만 다름). 어떤 install/doctor/uninstall/check도 `$REPO/pi/meta-bridge/.assembled`를 만들거나 참조하지 말 것. check/smoke는 실제 `~/.claude`/`~/.claude.json`/`~/.pi`·실제 XDG artifact도 만지지 않는다 — 파괴 검증은 전부 격리 HOME+XDG_DATA_HOME에서. uninstall의 honest-inverse rm은 XDG에서 유지(약화 금지).
- **live artifact는 checkout 밖(XDG)** — `./run.sh install-meta-bridge`/`setup`이 곧 XDG 이관 절차다(더는 `pnpm check`가 배선을 자르지 않음). repo 안에 `.assembled`를 되살리지 말 것.
- **agy는 native-push domain** — pi socket domain(`LIVENESS_DOMAIN_BACKENDS`)에도 mailbox self-fetch 게이트에도 밀어넣지 않는다. receiver marker/watchArmed는 mailbox 전용 원자 — native-push replyable에 재사용 금지. reject reason에 `backend-liveness-unsupported`를 agy에 재사용하지 않는다.
- **mux launch는 driver 인터페이스 뒤에서만** — 프로덕션 코드에 `tmux` 직접 호출 금지(repro 예외). tmux 전용 가정/타입/필드명 새로 심지 말 것. zmx는 경량 1급 driver 후보.
- **mint는 mux를 모르고 driver는 mint를 모른다** — spawn/mint 로직에 `lib/mux` import 금지, `driver.ts`는 `entwurf-core` 무의존 leaf. 더블-Enter submit은 driver 아니라 launch-profile. `$TMUX` 전제(caller도 tmux 안이어야)를 driver/게이트에 심지 말 것 — 관찰가능 launch는 강제 아닌 default posture.
- **fresh pi-native GPT도 먼저 mux-visible** — v1식 detached/bg `pi -p` 복구를 기본값으로 되살리지 않는다. headless/bg pi 최적화는 GLG 명시 시 별도 레인.
- pi floor는 이제 **0.80.3**, entwurf sonnet은 **`claude-sonnet-5`(1M)** — 되돌리지 말 것.
- `core.hooksPath` 안 건드림. `--no-verify` 금지.
- GLG 명시 승인 + green preflight 없이 publish/tag/push 금지.
- live release gate 요청 시 scratch cwd + `LIVE=1`.

## 참조

- 설계 SSOT: `ROADMAP.md` · 닫힌 변경: `CHANGELOG.md`
- 검증 calibration: `VERIFY.md`, `BASELINE.md`, `DELIVERY.md`
- repo baseline: `AGENTS.md` · ACP 레일: `docs/acp-backend-rail.md`
- clean-host 설치: `docs/setup-clean-host.md`
- 소유 경계 이슈: #45(원칙) · #46(이 레인) · #47(mux 후속)
- mux repro 원본: `scripts/raw-async-delivery/repro-{plugin-idle-wake,addressed-routing}.sh`
- 동형 패턴: `pi-extensions/lib/acp/backend-adapter.ts`
