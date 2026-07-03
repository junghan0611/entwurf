# NEXT — entwurf post-0.12.5: ⓪ 설치 경계 봉쇄 → ① agy delivery → ② mux

> 나침반이지 DB가 아니다: **현재 위치 · 다음 한 걸음 · 넘으면 안 되는 선**만 둔다.
> 현재+미래 방향과 설계 SSOT = **`ROADMAP.md`**. 닫힌 변경 핵심 = **`CHANGELOG.md`**. 세션별 process history = git log.

## DONE — 0.12.3 released (소넷5 1M 전환)

- **0.12.3** tag `v0.12.3` + npm `@junghanacs/entwurf@0.12.3` publish 완료 + registry 설치 스모크(`pi --list-models entwurf`에서 `claude-sonnet-5`/`claude-opus-4-8` 둘 다 1M) 통과.
  - **deps 정렬:** `@agentclientprotocol/claude-agent-acp` 0.50.0→**0.54.1**, wire SDK `@agentclientprotocol/sdk` 0.29.0→**1.1.0(메이저)**, transitive `@anthropic-ai/claude-agent-sdk` 0.3.186→0.3.197, `@anthropic-ai/sdk` 0.100.1 peer-pin 유지. pi floor `@earendil-works/pi-* >=0.80.3 <0.81`. 게이트 핀 4곳(`check-acp-sdk-surface`/`check-dep-versions`/`check-pi-runtime-version` FLOOR/`check-pack-install` peer) 갱신. wire SDK 메이저 전환에도 value export 6종+타입 표면 생존.
  - **모델 스왑:** `claude-sonnet-4-6`→`claude-sonnet-5` 전역(34참조, CHANGELOG 히스토리만 보존). 큐레이션 SSOT `pi-extensions/lib/acp/models.ts`, 타깃 레지스트리, 모든 ACP 게이트/스모크 기본값.
  - **1M 캡 해제(핵심):** `models.ts`의 Sonnet 200K 캡 제거 → Sonnet 5도 Opus처럼 1M 노출(1M ceiling guard 유지). "compact 없이 가는" 기반.
  - **workflow 스칼라:** `MANAGED_SETTINGS_SCALARS`(`scripts/meta-bridge-state.py`)에 `enableWorkflows:false`/`workflowKeywordTriggerEnabled:false` 추가 → 메타브리지 install이 이 두 surface도 닫음. 스모크 목록 2곳(install-state post-install/uninstall) 정합.
  - **환경:** 전역 `pi`(`@earendil-works/pi-coding-agent`, pnpm global)를 0.80.2→**0.80.3** 업그레이드 — 익스텐션 로더가 런타임 pi 카탈로그를 해석하므로 이게 안 맞으면 sonnet-5가 로더에서 드롭됨.
  - **GPT 검수 반영:** live smoke 3종(`smoke-acp-{raw-turn,overlay,memory-containment}-live`)의 `withTimeout` stale-timer 누수(PASS 후 프로세스 붙잡힘) → `clearTimeout` in `.finally()`. `smoke-acp-session-reuse-live`: turn2 timeout 통일 + 성공경로 `process.exit(0)`→`process.exitCode=0`(PASS 로그 truncate 방지). stale SSOT(AGENTS/README/ROADMAP/setup-clean-host/demo) 정정.
  - **`6d06ad0` fix(targets):** `entwurf/gpt-5.4`·`entwurf/gpt-5.5` **ACP-routed 엔트리 제거**. 노트: "ACP Codex is not on this surface **until the ACP backend is implemented**." → 아래 §① mux 레인의 동기이자 완료판정.
- **0.12.4 hotfix 완료** — 일반설치 floor(`node_modules`)에서 `doctor-meta-bridge`가 raw `.ts` helper를 strip-types 실행해 가짜 FAIL 내던 버그 수정. hejdev6 실측: pre-fix `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING` 재현, patched tarball 설치 후 compiled store-doctor plain-node scan + v2-surface defer 통과. tag/GitHub release/npm publish 완료.
- **0.12.2/0.12.1** — 이전 릴리즈(메타브리지 install 이식성 + `check-meta-manifest-schema`, 오라클 설치검증). 상세는 CHANGELOG.

## NOW — ⓪ 설치 경계 봉쇄: `pnpm check`가 dev 배선을 삼킨 사건 (2026-07-03 `?`)

**판정(페블 진단 → 오푸스 검증 → GPT 재검증, 3중 합치):** pnpm 정리 무관. `pnpm check` 체인의 `smoke-meta-install-state`가 실제 `meta-bridge-uninstall.sh`를 real REPO 기준으로 실행 → dev-clone 분기의 `rm -rf $REPO/pi/meta-bridge/.assembled`(bec39f9의 honest-inverse rm)가 **샌드박스 밖으로 탈출** → marketplace directory source 소실 → 다음 새 CC 세션에서 `entwurf-meta-receive` 플러그인 silent drop → SessionStart 각인 불발 → statusline `?`. HOME/CLAUDE_CONFIG_DIR/fake-claude는 격리돼 있었고 **wrapper의 `REPO=HERE/..` 경계 하나만 구멍**이었다. 실측: 플러그인 마지막 실행 = 마지막 record 갱신 = 7/2 17:21:00; `pi/meta-bridge` mtime 17:23:03 = 커밋(17:22) 직후 푸시 전 check.

**원칙 판정(고정):** ① uninstall의 rm은 옳다 — honest inverse 유지, 약화 금지. ② statusline `?`는 **성공한 트립와이어** — 설계 검증됨. ③ 고칠 것은 smoke 격리이지 uninstall이 아니다. 이 사건의 이름: **"검증이 실제 개발자 배선을 파괴한 impurity bug"**.

**봉쇄 순서 (GPT 순서 채택 — 코드는 오푸스, 순서 바꾸지 말 것):**
1. **smoke 격리**: `smoke-meta-install-state`의 wrapper-uninstall 구간을 `$TMP` 사본 repo에서 실행. uninstall이 `HERE/..`로 REPO를 재계산하므로 env override보다 **temp repo copy가 자연스러움**. state prepare/apply도 그 temp repo 기준. 실제 `$REPO/scripts/meta-bridge-uninstall.sh` 직접 실행 금지.
2. **회귀 게이트**: smoke 시작/종료에 실제 `$REPO/pi/meta-bridge/.assembled` fingerprint 비교 — "check는 live developer wiring을 절대 만지지 않는다"를 check 스스로 증명. (`.assembled` 부재 상태에선 약하고, setup 복구 후부터 정확히 잡는다.)
3. **복구는 그 다음**: `./run.sh setup` → `pnpm check` 재실행(**`.assembled` 생존 확인**) → `./run.sh doctor-meta-bridge` PASS → CC 재시작 → 새 세션 각인 + statusline garden id 복원 확인. 봉쇄 전 setup만 하면 다음 check에서 또 잘린다.

**구현 완료 (2026-07-03, 커밋 대기 — GPT 재검토 채택):** `scripts/smoke-meta-install-state.sh`만 수정 — smoke 격리(wrapper-uninstall을 `$TMP` 사본 repo에서 실행; `uninstall.sh`가 REPO를 `HERE/..`로 재계산하므로 사본이면 rm이 사본 sentinel만 지움) + 회귀 게이트(실제 `.assembled` fingerprint 시작/종료 불변 단언). **`uninstall.sh`·`state.py` 무수정**(honest inverse rm 유지 — 원칙 준수). 검증 3중: PROOF.txt 대조 byte-불변(봉쇄 전이면 삭제됐을 파일) · `pnpm check` 전체 green(격리/회귀 게이트 2종 통과, `.assembled` 지문 `7522dc75…` 전후 동일) · `doctor-meta-bridge` PASS(writer-parity source=assembled=installed=v2). **남은 것 = CC 새 세션에서 `?`→`🪛 garden-id` 복원 수동확인**(현 세션은 SessionStart 놓쳐 정상적으로 `?` 유지). 확인되면 ⓪ DONE 강등 + NOW를 ①로.

**선택 강화(오푸스 판단 여지, 미착수):** statusline이 marketplace source 부재를 별도 글리프로 구분(=`?`를 진단 가능하게); doctor의 assembled-존재 체크가 이 케이스를 이미 FAIL로 잡는지 확인하고 아니면 추가.

**남는 구조 리스크(이번 레인 범위 밖, 기록만):** smoke를 고쳐도 `git clean -xfd`는 여전히 live 배선(`.assembled`)을 자른다 — gitignored 빌드 산출물이 곧 live marketplace source인 구조 자체의 긴장. dev도 XDG data dir 조립으로 옮길지(Follow-up C 계열)는 별도 결정.

## ① (⓪ 뒤 착수) agy delivery lane — 설치 가드레일의 검증면

**GLG 결정(2026-07-03): agy 지원을 mux보다 먼저.** agy는 두 번째 native-delivery 하네스 — 붙여봐야 install/doctor/uninstall 경계가 CC-특수인지 진짜 하네스-일반인지 드러난다. **agy 지원 = 설치면 가드레일 검증면.** mux보다 당기는 이유 = launch surface가 아니라 설치면/검증면/하네스별 adapter 경계를 먼저 조여야 codex·agy 지원 시 쓰레기 코드/파일 없이 단단해지기 때문. **GPT 재검토 최종판정: 이 레인의 핵심은 "Claude mailbox 일반화"가 아니라 direct-inject backend adapter를 v2 dispatch/doctor/install 경계에 정식으로 세우는 것.**

- **범위 한정(무너지면 다시 꼬임):** agy *delivery + install adapter*는 여기(①), agy *fresh spawn/launch*는 ③ mux 뒤. 여기는 수신/발신 + 설치 어댑터만.
- 기반 검수 완료: `DELIVERY.md` agy = **verified-probe D6+** (native LS gRPC `agentapi send-message`, `scripts/raw-async-delivery/raw-agy-send.sh`). 이 레인 = probe → **shipped lane** 승격.
- **✅ 계약 질문 해소 (페블 코드실측 검수, 2026-07-03): agy = direct-inject 확정, 불일치는 주석뿐.** 레지스트리 `pi/entwurf-capabilities.json`은 **이미 옳다**(antigravity/codex = `direct-inject`) → mailbox 게이트(`wakeMode !== "self-fetch"` 거부, deliverability:110)는 **현행으로 agy를 fail-closed로 막고 있음**. 거짓은 `entwurf-deliverability.ts:15` 주석의 "(Claude Code / Codex / agy)" self-fetch 그룹핑 하나(+ :106 "(pi)" 축소 표기) — **주석만 수정, 동작 무회귀.** 확정 4상한: CC = record+self-fetch mailbox / pi = socket-native+direct-inject / **agy·codex(app-server) = record-engraved+native-push direct-inject**.
- **✅ 검수 확정 — `LIVENESS_DOMAIN_BACKENDS`에 antigravity 추가 금지 (GPT 지적, 페블 코드 확인):** in-domain 경로는 구조적으로 pi socket 전용 — `entwurf-v2-decider.ts:302-324` in-domain이면 `decideInDomain(allowResume:true, cwd)` → lock → `inspectSocket`/`probeSocket`(소켓 전용 deps) → dormant면 spawn-bg resume. **backend별 probe seam 자체가 없다.** 넣으면 agy가 pi socket table로 빨려 들어감(경계 붕괴). `check-entwurf-facts.ts:88`이 `==["pi"]` 하드 단언(나이브 확장은 게이트 즉사 — 울타리 이미 존재). 답 = **pi control-socket domain과 별도의 native-push adapter rail**: fire+alive→native-push send / fire+dead·indeterminate→reject / owned-*→reject(resume authority 없음). 새 rail은 `check-entwurf-facts` 확장으로 도메인 분리를 게이트 강제.
- **✅ 검수 확정 — register-first, lazy mint 금지:** v2 target=garden id, record 없으면 이름조차 없음(decider 2c `identity===null → bad-target`). 정식 = **MCP self-register**(`get-conversation-metadata`로 conversationId 검증 후 `backend:"antigravity"` upsert), CLI register는 operator repair/debug 보조.
- **⚠ 페블 보정 ① — replyable-self에 receiver marker 재사용 금지:** marker 의미론 = "idle-wake watch armed"(armProvenance는 arm-capable 훅 한정, `meta-session.ts:1321-`), `computeMetaReceiverActive`(recordBacked∧ownerAlive∧watchArmed)라는 **mailbox 배달성 원자**에 들어감. agy는 watch 없음 — agy pid로 marker를 쓰면 native-push 생존성을 mailbox 의미론에 밀수(축 혼합). **native-push replyable = (record 존재 ∧ adapter probe 성공)**; self-register 흔적이 필요하면 새 provenance 종류로, watchArmed 합성 불참.
- **⚠ 페블 보정 ② — agy MCP 배선의 현 소유권은 entwurf 밖 (thinkpad 실측):** `~/.gemini/{antigravity-cli,config}/mcp_config.json` **둘 다** `agent-config/antigravity/mcp_config.json` 심링크 + entwurf-bridge **이미 손배선**(repo start.sh 직결). install adapter는 심링크/기존 배선 **detect→refuse/adopt를 state에 명시**(clobber 금지 — 남의 SSOT). 소비자 머신에선 agy가 실제 읽는 path를 doctor로 증명 후 단일 path 관리(무증명 dual-write 금지).

**어댑터 계약 5축 (GPT 지침):**
1. **identity/registration** — agy conversationId ↔ garden id 결속. birth hook 자동인지 명시 register surface 필요인지. meta-record `backend:"antigravity"`/`nativeSessionId:conversationId`를 언제·누가 쓰나. (CC=meta-record anchor / pi=record-less socket — agy는 어느 모델?)
2. **liveness probe** — raw = `pgrep -x agy` + LS port 탐색 + `agentapi get-conversation-metadata`. production adapter seam으로 승격. transcript/db/WAL 간접흔적을 liveness로 삼지 말 것. **production에서 `pgrep -x agy | head -1`(raw-agy-send.sh:16) 금지** — 전 pid/LS port 스캔, `get-conversation-metadata`가 응답하는 route를 **매 send/probe마다 동적 발견**(LS address = volatile route, 저장 authority 아님).
3. **direct-inject send** — `agentapi send-message <conversationId> <content>`. mailbox enqueue 아님. entwurf_v2 fire-and-forget → native-push route. owned-outcome=reject.
4. **install/uninstall/doctor** — **claude marketplace 일반화 금지.** agy config adapter 별도. 대상 config: documented `~/.gemini/antigravity-cli/mcp_config.json` vs observed runtime `~/.gemini/config/mcp_config.json` — 어느 것이 SSOT·어느 것이 compatibility write인지 명시. stateful uninstall로 사용자 기존 MCP config 보존.
5. **검증** — deterministic(fake agy/ss/config-HOME으로 install/doctor/uninstall) + live(실제 agy conversation에 token send) + `DELIVERY.md` D-level verified-probe→shipped 갱신. **⓪ 규율 day-one 이식: smoke는 temp-copy 격리 + live-wiring fingerprint 게이트** — 레인 합격 기준 = agy 표면에서 `.assembled`류 impurity bug를 구조적으로 재생산 불가능하게 만든 것.

**구현 순서 (GPT안, 페블 검수 통과):** ① stale 주석 정리(deliverability:15/:106) → ② `native-push` transport enum + schema/type/**DispatchVerdict·runner union 동시** 확장(③mux 레인 5번의 경고와 동일 규율) → ③ NativePushAdapter interface → ④ antigravityAdapter(probe/send/fake-runner gate) → ⑤ decider에 pi domain과 **별도** native-push branch → ⑥ MCP self-register 설계(보정① 반영) → ⑦ agy install/uninstall/doctor config adapter(보정② 반영) → ⑧ LIVE smoke(기존 live agy conversation에 token send).

## ② (mux 사전결정, 2026-07-02) fresh spawn도 mux-visible로 통일

v2에 spawn이 "없는" 게 아니다. `entwurf_v2 owned-outcome`은 **기존 dormant pi citizen**을 `spawn-bg resume`으로 깨우는 production path가 있고 `smoke-entwurf-v2-spawn-resume-live`가 실 child+turn을 검증한다. 빠진 것은 v1 `entwurf`가 하던 **무에서 새 sibling을 만드는 fresh spawn/mint**.

**정렬:** fresh launch를 **mux-visible surface로 먼저 통일**한다. pi-native GPT도 bg/detached `pi -p`로 숨기지 않고 투명하게 pane/session으로 보이며 같은 launch 관문을 통과 → pi를 Claude Code/Codex/Antigravity와 같은 급의 "4번째 하네스"로 세운다. pi 전용 headless/bg 최적화는 GLG가 나중에 명시할 때 별도 레인.

- v1 본체: `pi-extensions/lib/entwurf-core.ts` `runEntwurfSync`(:1940) = fresh-mint 본체 — registry gate `resolveEntwurfTarget`(미등록 reject) + session-id/name/cwd-enrich. resume는 `runEntwurfResumeSync`(:1772, registry 우회). launch arg SSOT `entwurf-resume-args.ts`. 주: fresh-mint는 현재 `--no-extensions` one-shot worker이지 `-p`/control 경로 아님.
- **레지스트리 현황(6d06ad0 이후):** `entwurf/claude-sonnet-5`·`entwurf/claude-opus-4-8`(ACP claude), `openai-codex/gpt-5.4|5.5`(native), `entwurf/gemini-3.1-pro-preview`(ACP gemini, explicitOnly). **ACP Codex 엔트리는 삭제됨** — 즉 "Claude Code에서 새 GPT 불러줘"는 레지스트리가 하드 차단. mux 레인이 서야 되살릴 수 있음.

## ③ (①agy 뒤 착수) mux-agnostic spawn/launch surface

네이티브 백엔드(Claude Code)는 인터랙티브 TTY 필수 → headless 불가 → **multiplexer가 곧 launch surface**. pi-native GPT도 같은 mux-visible surface로 올린다. **tmux 전용 금지** — mux driver 인터페이스 뒤에서 `tmuxDriver`/`zmxDriver`가 동급. zmx는 후순위 장식이 아니라 경량 1급 후보(driver 한 개 갈아끼우는 일이 되도록).

**코드 실측(2026-07-01 재확인, drift 없음):**
- transport enum `ENTWURF_V2_TRANSPORTS`(`entwurf-v2-contract.ts:186`) = `["control-socket","spawn-bg","tmux-live","meta-mailbox"]`. `tmux-live`는 enum 한 값일 뿐.
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
4. **`zmxDriver` 스텁** — 같은 interface로 `DRIVERS=[tmux,zmx]`가 컴파일되게. 미구현 op는 fail-loud.
5. **enum 공존** — `ENTWURF_V2_TRANSPORTS`(:186)에 `zmx-live` 추가(`tmux-live`와 공존). schema↔types 게이트 갱신 **+ `DispatchVerdict`의 resume union도 같이 확장(GPT 지적 — 놓치면 타입 갈라짐)**. mux 종류를 별도 필드로 빼는 추상화는 금지(enum 나열 > 추상화 두께).
6. **네이밍 중립화(cosmetic)** — fixture `tmuxTarget`(위 2줄) → `muxTarget`. 프로덕션 필드가 아니므로 리스크 낮음.
7. **fresh pi-native GPT launch profile(더 큰 후속)** — `runEntwurfSync`(:1940)의 registry/session-id/name/cwd-enrich 자산 재사용하되, `--no-extensions` detached one-shot 복구가 아니라 mux-visible `pi-native-gpt` launch profile로 설계(`claude-code`/`codex`/`agy`도 같은 launch/observe/capture/kill 규율). **완료판정:** mux launch가 서면 `6d06ad0`이 지운 `entwurf/gpt-5.x` ACP 타깃을 레지스트리에 되살릴 수 있음.
8. **agy(Antigravity) spawn** — spawn surface 통일 **후** 그 위에 얹기(기반 먼저 안 서면 launch seam이 갈림). *주: agy **delivery/설치 어댑터**는 ①에서 mux보다 먼저 감 — 갈라진 건 launch면뿐.*

## ④ (수동·대기) PR #40 cortex 어댑터 재안착 — 공은 hvkiefer

- 우리 쪽 준비 끝: 레일 doc(`docs/acp-backend-rail.md`) + PR 개발 가이드 댓글. 레일 green.
- hvkiefer: `cortexAdapter` 1개 신규(`pi-extensions/lib/acp/backend-adapter.ts`) + `ADAPTERS` 등록 + curated cortex 모델 + `SNOWFLAKE_HOME` overlay + `check-acp-*` cortex 단언 + `smoke-acp-cortex-live`. 공통 turn loop 무수정.
- **미정 1건:** carrier 부재 백엔드(cortex)의 operator engraving이 first-user augment(`augment.ts`)에 합류하는 방식 — 현재 augment는 engraving 미탑재. cortex PR이 그 경로 정의.
- 들어오면 `check-acp-*` 6종 + `smoke-acp-cortex-live` 기준 리뷰, 공통층 무수정 불변식 확인.

## Follow-up (blocker 아님)

- **Post-publish global meta-bridge invariant:** package upgrade alone does not refresh Claude's plugin bundle/cache. Future publish checklist: `pnpm add -g @junghanacs/entwurf@<version>` → `entwurf install-meta-bridge` → `entwurf doctor-meta-bridge` from the same installed surface, then restart open Claude Code sessions. With the main follow-up, installed statusLine/MCP use stable bins and marketplace source uses a stable data dir; reinstall remains the explicit bundle refresh, not a dead-link repair.
- **C2** `check-pack-install` 확장: fake `claude` CLI + temp `HOME`/`CLAUDE_CONFIG_DIR`로 installed `entwurf install-meta-bridge` 실행 → `~/.claude.json` command가 해시 store 경로 아니라 안정적 `entwurf-bridge`인지 검증.
- **C3** support-floor: 실제 최저버전(2.1.97 오라클) validate/install/doctor를 컷 체크리스트 또는 remote gate로.
- **멀티하네스(Codex/Antigravity):** claude marketplace 일반화 금지. 하네스별 adapter contract(manifest shape, MCP 등록면, version floor, doctor evidence). 공통화는 runner/reporting만.
- `smoke-acp-skill-live` "secret probe code" → "probe code/project marker" 낮추기(injection-refusal 선제 cleanup, GPT 제안 이월).
- **pnpm 10→11 이관 + 단일 설치면(setup) 재검증** — *배경*: npm `codex` 중복(같은 바이너리가 `~/.local/share/pnpm/bin`과 부모 dir에 2개)에서 출발 → 원인은 pnpm **자기관리 shim(11.5)↔nix pnpm(10.33)** 이 디렉토리별 버전 스위칭하며 글로벌 스토어를 `global/5`(pnpm10)+`global/v11`(pnpm11) 둘로 쪼갠 것. 머신 정리: nix 단일 pnpm **11.9.0** + `~/.config/pnpm/rc`(home-manager) `manage-package-manager-versions=false`+`global-bin-dir` 고정 → 자기관리 pnpm/`.tools`/`global/5` 제거. **패키지 소유권 3층**: nix store(선언) / `external-packages.sh`(npm글로벌·벤더·go, 목록SSOT) / per-repo devShell(특정버전 필요 시). **entwurf 쪽 config**: `packageManager: pnpm@10.33.0` 핀 제거(전역 nix pnpm 따라감), `.npmrc`(pnpm11이 무시하는 죽은 파일) 삭제 → `pnpm-workspace.yaml`(autoInstallPeers:false + allowBuilds `@google/genai`·protobufjs false)이 SSOT, CI `pnpm/action-setup` 10.33→11.9. **설치면**: `./run.sh setup <project>` **단일**로 정리 + `pi install` 제거(중복 확정 — project-scope `.pi/settings.json` `packages[]`만으로 provider/ACP 로드됨을 `pi --list-models entwurf`로 실증; pi 바이너리는 필요, pi install 커맨드는 불필요). *재검증(다음 세션/클린 호스트)*: ① `which -a pnpm` 1개·전역/entwurf 모두 11.9.0 ② 11.9.0에서 `pnpm check` **전체** green(이번엔 dep-versions/문법만 확인함) ③ `./run.sh setup <scratch>` 한 방 green ④ `pi install` 없이 provider 로드 ⑤ `doctor-meta-bridge` PASS. 소비자(npm)엔 무영향(tarball=package.json+files만; `.npmrc`/`pnpm-workspace.yaml`/lock 제외).

## 넘으면 안 되는 선

- Work on `main`; 이 레인용 브랜치 만들지 않음.
- **check/smoke는 live developer wiring을 절대 만지지 않는다** — 실제 `$REPO/pi/meta-bridge/.assembled`, 실제 `~/.claude`/`~/.claude.json`/`~/.pi` 어느 것도. 파괴 검증은 전부 `$TMP` 사본에서. uninstall의 honest-inverse rm은 약화 금지(고칠 곳은 smoke 격리다).
- **⓪ 봉쇄 완료 전 `./run.sh setup` 단독 복구 금지** — 다음 `pnpm check`가 또 자른다. 순서: 봉쇄 → setup → check 생존 확인 → doctor → CC 재시작.
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
- mux repro 원본: `scripts/raw-async-delivery/repro-{plugin-idle-wake,addressed-routing}.sh`
- 동형 패턴: `pi-extensions/lib/acp/backend-adapter.ts`
