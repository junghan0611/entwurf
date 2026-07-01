# NEXT — entwurf post-0.12.4 hotfix: mux-agnostic spawn surface + PR #40 cortex

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
- **0.12.5 미배포(main ahead, publish 대기)** — strip-types 클래스의 **세 번째 얼굴**을 닫음. 오라클 실측: 0.12.4 글로벌 설치에서 marketplace source가 `.../node_modules/.../pi/meta-bridge/.assembled` → Claude가 그 source의 hook `.ts`를 직접 strip-types 실행 → 매 세션 `ERR_UNSUPPORTED_NODE_MODULES_TYPE_STRIPPING`. 근본은 hook이 유일한 `.ts`-at-runtime 표면(bridge boot 0.12.1 / store-doctor 0.12.4는 이미 dist JS). 조치: **L1** statusLine `entwurf-statusline` bin shim, **L2** marketplace `.assembled`를 XDG(`~/.local/share/entwurf/...`)로, **B(hook dist JS)** `build-bridge`가 `dist/pi-extensions/meta-bridge-hook.js` emit + install.sh가 installed면 그 `.js`(+`meta-session.js`) 복사·`__HOOK_ENTRY__` bake(dev는 `.ts` 유지). doctor writer-version parity를 `meta-session.<js|ts>` 모드별 비교로(installed=dist `.js` ↔ installed `.js`, false-STALE 방지). doctor BAKED 파싱/cached-hook 실행도 `.ts|.js` 확장자 인지. **회귀 게이트**: `check-pack-install`이 installed 컴파일 hook을 **node_modules 밑에서 plain node 실행 PASS + 같은 위치 raw `.ts` REFUSED 재현**(오늘 `.ts` FAIL / 새 `.js` PASS). 검증: `pnpm check` green, dev `doctor-meta-bridge` green(parity 3자 동일해시). 커밋 미푸시 — 0.12.5 prepare/publish는 GLG 승인 대기. **응급 회피(현행)**: dead-store 겪는 host는 dev clone `./run.sh install-meta-bridge`(marketplace=checkout, node_modules 밖). 단 dev `.assembled`는 gitignored라 `git clean -dfx`에 취약 — 0.12.5 글로벌이 영구 해법.
- **0.12.2/0.12.1** — 이전 릴리즈(메타브리지 install 이식성 + `check-meta-manifest-schema`, 오라클 설치검증). 상세는 CHANGELOG.

## NOW — ⓪ GLG 결정: fresh spawn도 mux-visible로 통일

v2에 spawn이 "없는" 게 아니다. `entwurf_v2 owned-outcome`은 **기존 dormant pi citizen**을 `spawn-bg resume`으로 깨우는 production path가 있고 `smoke-entwurf-v2-spawn-resume-live`가 실 child+turn을 검증한다. 빠진 것은 v1 `entwurf`가 하던 **무에서 새 sibling을 만드는 fresh spawn/mint**.

**정렬:** fresh launch를 **mux-visible surface로 먼저 통일**한다. pi-native GPT도 bg/detached `pi -p`로 숨기지 않고 투명하게 pane/session으로 보이며 같은 launch 관문을 통과 → pi를 Claude Code/Codex/Antigravity와 같은 급의 "4번째 하네스"로 세운다. pi 전용 headless/bg 최적화는 GLG가 나중에 명시할 때 별도 레인.

- v1 본체: `pi-extensions/lib/entwurf-core.ts` `runEntwurfSync`(:1940) = fresh-mint 본체 — registry gate `resolveEntwurfTarget`(미등록 reject) + session-id/name/cwd-enrich. resume는 `runEntwurfResumeSync`(:1772, registry 우회). launch arg SSOT `entwurf-resume-args.ts`. 주: fresh-mint는 현재 `--no-extensions` one-shot worker이지 `-p`/control 경로 아님.
- **레지스트리 현황(6d06ad0 이후):** `entwurf/claude-sonnet-5`·`entwurf/claude-opus-4-8`(ACP claude), `openai-codex/gpt-5.4|5.5`(native), `entwurf/gemini-3.1-pro-preview`(ACP gemini, explicitOnly). **ACP Codex 엔트리는 삭제됨** — 즉 "Claude Code에서 새 GPT 불러줘"는 레지스트리가 하드 차단. mux 레인이 서야 되살릴 수 있음.

## ① (다음 세션 착수) mux-agnostic spawn/launch surface

네이티브 백엔드(Claude Code)는 인터랙티브 TTY 필수 → headless 불가 → **multiplexer가 곧 launch surface**. pi-native GPT도 같은 mux-visible surface로 올린다. **tmux 전용 금지** — mux driver 인터페이스 뒤에서 `tmuxDriver`/`zmxDriver`가 동급. zmx는 후순위 장식이 아니라 경량 1급 후보(driver 한 개 갈아끼우는 일이 되도록).

**코드 실측(2026-07-01 재확인, drift 없음):**
- transport enum `ENTWURF_V2_TRANSPORTS`(`entwurf-v2-contract.ts:186`) = `["control-socket","spawn-bg","tmux-live","meta-mailbox"]`. `tmux-live`는 enum 한 값일 뿐.
- **프로덕션 launch 코드에 tmux 직접 호출 0개**(grep empty). tmux 4동작은 `scripts/raw-async-delivery/repro-{plugin-idle-wake,addressed-routing}.sh`에만 존재 → **spawn launch는 프로덕션 빈칸**. 이 빈칸을 mux 추상화로 채우는 게 이번 레인.
- `tmuxTarget`은 **프로덕션/스키마 필드가 아님** — fixture 2줄뿐(`check-entwurf-capabilities.ts:110`, `check-meta-record-v2.ts:188`, 둘 다 `"psa:3.1"`). 즉 "네이밍 중립화"는 cosmetic이고, 진짜 `muxTarget`/`paneTarget` 필드는 프로덕션 spawn이 생길 때 **새로 정의**하는 것(기존 prod 필드 rename 아님).

**repro 4동작 → driver 메서드 매핑 (tmuxDriver 이식 대상):**

| repro (tmux) | driver 메서드 | 세부 |
|---|---|---|
| `tmux new-session -d -s <n> -x 200 -y 50` | `launch(spec)` | detached, pane geometry(200×50)를 spec 파라미터로 |
| `tmux send-keys -t <n> "<text>" Enter` **+ `sleep 1; send-keys Enter`** | `send(target,text)` | **더블-Enter 제출 quirk 캡슐화** — CC TUI는 첫 keystroke가 입력창만 채우고 두번째 Enter가 제출 |
| `tmux capture-pane -t <n> -p` | `capture(target)` | raw pane text만 반환. 폴링(`grep -qE '●\s*READY'`, 30회 loop)은 호출측 책임 |
| `tmux kill-session -t <n>` | `kill(target)` | idempotent(`2>/dev/null \|\| true`) |
| (암묵 `has-session`) | `isAlive(target)?` | 선택 |

**동형 레퍼런스(그대로 미러):** `pi-extensions/lib/acp/backend-adapter.ts` — `interface AcpBackendAdapter`(:115), `claudeAdapter`(:194), `const ADAPTERS = [claudeAdapter]`(:275), `resolveAcpBackendAdapter(modelId)`(:287). driver 1개 = mux 1개 = siblings-not-workers의 mux 레이어 반복.

**착수 플랜(순서대로):**
1. **mux driver 인터페이스 먼저** — 새 파일 `pi-extensions/lib/mux/driver.ts`(경로 확정은 착수 시): `MuxDriver` interface + `MuxLaunchSpec`/`MuxTarget` 타입 + `DRIVERS`/`resolveMuxDriver`. 아직 tmux 바이너리 호출 없음. shape 초안:
   ```ts
   export interface MuxDriver {
     readonly id: "tmux" | "zmx";                     // enum 값 ↔ transport `<id>-live`
     launch(spec: MuxLaunchSpec): Promise<MuxTarget>; // detached pane, liveness handle 반환
     send(target: MuxTarget, text: string): Promise<void>; // 더블-Enter 제출 캡슐화
     capture(target: MuxTarget): Promise<string>;     // raw pane text (호출측 폴링)
     kill(target: MuxTarget): Promise<void>;          // idempotent
   }
   export const DRIVERS: readonly MuxDriver[] = [tmuxDriver /*, zmxDriver*/];
   export function resolveMuxDriver(id: string): MuxDriver; // resolveAcpBackendAdapter 미러
   ```
2. **`tmuxDriver` 구현** — repro의 정확한 4동작 이식(더블-Enter 포함, geometry는 spec 파라미터). repro 스크립트는 그대로 두되 프로덕션 경로가 driver를 쓰게.
3. **deterministic 게이트 `check-mux-driver.ts`** — 실제 tmux 바이너리 없이(fake/echo mux) tmuxDriver 구동: 4동작 argv 단언, 더블-Enter 제출 시퀀스 단언, kill idempotency. `check-acp-*` 스타일. `pnpm check` 체인 + `run.sh` dispatch 배선.
4. **`zmxDriver` 스텁** — 같은 interface로 `DRIVERS=[tmux,zmx]`가 컴파일되게. 미구현 op는 fail-loud.
5. **enum 공존** — `ENTWURF_V2_TRANSPORTS`(:186)에 `zmx-live` 추가(`tmux-live`와 공존). schema↔types 게이트 갱신. mux 종류를 별도 필드로 빼는 추상화는 금지(enum 나열 > 추상화 두께).
6. **네이밍 중립화(cosmetic)** — fixture `tmuxTarget`(위 2줄) → `muxTarget`. 프로덕션 필드가 아니므로 리스크 낮음.
7. **fresh pi-native GPT launch profile(더 큰 후속)** — `runEntwurfSync`(:1940)의 registry/session-id/name/cwd-enrich 자산 재사용하되, `--no-extensions` detached one-shot 복구가 아니라 mux-visible `pi-native-gpt` launch profile로 설계(`claude-code`/`codex`/`agy`도 같은 launch/observe/capture/kill 규율). **완료판정:** mux launch가 서면 `6d06ad0`이 지운 `entwurf/gpt-5.x` ACP 타깃을 레지스트리에 되살릴 수 있음.
8. **agy(Antigravity)** — spawn surface 통일 **후** 그 위에 얹기(기반 먼저 안 서면 launch seam이 갈림).

## ② (수동·대기) PR #40 cortex 어댑터 재안착 — 공은 hvkiefer

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

## 넘으면 안 되는 선

- Work on `main`; 이 레인용 브랜치 만들지 않음.
- **mux launch는 driver 인터페이스 뒤에서만** — 프로덕션 코드에 `tmux` 직접 호출 금지(repro 예외). tmux 전용 가정/타입/필드명 새로 심지 말 것. zmx는 경량 1급 driver 후보.
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
