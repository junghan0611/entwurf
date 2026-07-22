# mux launch rail — fresh spawn을 mux-visible surface로 통일

> **EXPIRING DOC — 착수하면 죽는다.** 이 문서는 영구 SSOT가 아니라 **작업 중 비계(scaffold)**다.
> 내용의 3/4(인터페이스 shape · driver 매핑 표 · 착수 8단계)는 *아직 안 쓴 코드*일 뿐이라
> 코드가 서는 순간 중복이 된다. 살아남을 유산은 갈 곳이 이미 정해져 있다:
> **불변식 → `scripts/check-mux-boundary.ts` 게이트(게이트가 곧 문서)** ·
> **원칙/후보 판단 이력 → 이슈 #47** · **완료판정 → `NEXT.md` 한 줄**.
> 코드/게이트로 스며든 뒤 **이 파일을 지우는 커밋이 곧 레인 종료 신호**다.
> 믿을 것은 `NEXT.md`. 이 문서가 NEXT와 어긋나면 NEXT가 이긴다. 도움이 안 되면 즉시 버려라.
>
> 트래커 = 이슈 **#47**(원칙/후보 재정렬). 동형 레퍼런스 = `docs/acp-backend-rail.md`(어댑터 1개 = 백엔드 1개).
> 착수 조건: agy imprint 레인(#46)이 닫힌 뒤. 이 레인을 agy close blocker로 끌고 오지 말 것.
>
> **앵커 재검증 2026-07-12:** 아래 코드 실측(라인 번호 포함)은 전부 살아 있음 — drift 없음.
> 단 §②의 "tmux는 repro에만" 주장은 **틀렸었고**, 아래에서 정정됨(`demo/demo.sh` 누락).

## ① fresh spawn도 mux-visible로 통일

v2에 spawn이 "없는" 게 아니다. `entwurf_v2 owned-outcome`은 **기존 dormant pi citizen**을 `spawn-bg resume`으로 깨우는 production path가 있고 `smoke-entwurf-v2-spawn-resume-live`가 실 child+turn을 검증한다. 빠진 것은 v1 `entwurf`가 하던 **무에서 새 sibling을 만드는 fresh spawn/mint**.

**정렬:** fresh launch를 **mux-visible surface로 먼저 통일**한다. pi-native GPT도 bg/detached `pi -p`로 숨기지 않고 투명하게 pane/session으로 보이며 같은 launch 관문을 통과 → pi를 Claude Code/Codex/Antigravity와 같은 급의 "4번째 하네스"로 세운다. pi 전용 headless/bg 최적화는 GLG가 나중에 명시할 때 별도 레인.

- v1 본체(**제거됨**): `runEntwurfSync`/`runEntwurfResumeSync`는 v1 sync-body dead-island sweep에서 삭제됐다 — 자산이 필요하면 git history에서 복원. 삭제 전에는 fresh-mint 본체(registry gate `resolveEntwurfTarget`(미등록 reject) + session-id/name/cwd-enrich)와 resume(registry 우회)였다. launch arg SSOT `entwurf-resume-args.ts`는 유지. 주: fresh-mint는 `--no-extensions` one-shot worker이지 `-p`/control 경로 아님.
- **레지스트리 현황(`6d06ad0` 이후):** `entwurf/claude-sonnet-5`·`entwurf/claude-opus-4-8`(ACP claude), `openai-codex/gpt-5.4|5.5`(native), `entwurf/gemini-3.1-pro-preview`(ACP gemini, explicitOnly). **ACP Codex 엔트리는 삭제됨** — 즉 "Claude Code에서 새 GPT 불러줘"는 레지스트리가 하드 차단. mux 레인이 서야 되살릴 수 있음.

## ② mux-agnostic spawn/launch surface

네이티브 백엔드(Claude Code)는 인터랙티브 TTY 필수 → headless 불가 → **multiplexer가 곧 launch surface**. pi-native GPT도 같은 mux-visible surface로 올린다. **tmux 전용 금지** — mux driver 인터페이스 뒤에서 `tmuxDriver`/`zmxDriver`가 동급. zmx는 후순위 장식이 아니라 경량 1급 후보(driver 한 개 갈아끼우는 일이 되도록). **원칙/후보 재정렬 = issue #47**(herdr = agent-aware 위험 강등, zmx/tmux 우선, zmx 확보는 설치면 계약 — probe/optional + self-fetch, 하네스 전제 금지).

**코드 실측(2026-07-01 → 2026-07-12 재검증, 라인 번호까지 drift 없음):**

- transport enum `ENTWURF_V2_TRANSPORTS`(`entwurf-v2-contract.ts:225`) = `["control-socket","spawn-bg","tmux-live","meta-mailbox","native-push"]`. `tmux-live`는 enum 한 값일 뿐이고, `native-push`는 07-04에 추가된 agy delivery rail이다.
- **프로덕션 런타임(`pi-extensions/`, `mcp/`)에 tmux 직접 호출 0개** (grep empty, 07-12 재확인) → **spawn launch는 프로덕션 빈칸**. 이 빈칸을 mux 추상화로 채우는 게 이 레인.
- **[정정 2026-07-12] tmux를 실제로 쓰는 곳은 repro 2개가 아니라 셋이다.** 07-01 실측이 `demo/`를 빠뜨렸다:
  1. `scripts/raw-async-delivery/repro-{plugin-idle-wake,addressed-routing}.sh` — 각인(`set-option @entwurf_garden_id`)과 `capture-pane` 폴링의 유일한 소스.
  2. **`demo/demo.sh` — 가장 완전한 launch 실물이자 유일한 pane 단위 소비자.** 아래 §"demo.sh가 뒤집는 전제" 참조. `demo/demo-baseline.sh`도 동형.
  3. `scripts/smoke-agy-native-push-live.ts` — 코드가 아니라 주석/수동 절차(“agy를 tmux로 띄우고 `capture-pane`으로 관찰”)로만 tmux에 의존. driver가 서면 이 수동 관찰이 첫 소비자 후보.
- `tmuxTarget`은 **프로덕션/스키마 필드가 아님** — fixture 2줄뿐(`check-entwurf-capabilities.ts:110`, `check-meta-record-v2.ts:188`, 둘 다 `"psa:3.1"`). 즉 "네이밍 중립화"는 cosmetic이고, 진짜 `muxTarget`/`paneTarget` 필드는 프로덕션 spawn이 생길 때 **새로 정의**하는 것(기존 prod 필드 rename 아님).

### repro 4동작 → driver 메서드 매핑 (tmuxDriver 이식 대상)

| repro (tmux) | driver 메서드 | 세부 |
|---|---|---|
| `tmux new-session -d -s <n> -x 200 -y 50` + `set-option @entwurf_garden_id/@entwurf_parent_garden_id` | `launch(spec)` | detached, geometry는 spec. **namespace 각인** → tmux server가 lineage 레지스트리(형 통찰). driver는 opaque 문자열만 새김(의미 모름) |
| `tmux send-keys -t <n> -l "<text>"` | `pasteText(target,text)` | literal 주입만. `-l`/paste-buffer 여지(arbitrary prompt 안전) |
| `tmux send-keys -t <n> Enter` | `sendKey(target,key)` | 단일 키 |
| (조합) `pasteText→sendKey(Enter)→sleep(1)→sendKey(Enter)` | **driver 아님 → launch-profile(claude-code, 착수 7)** | 더블-Enter 제출은 mux 차이 아니라 CC TUI submit policy. driver에 박으면 pi-native/타 TUI 오염 |
| `tmux capture-pane -t <n> -p` | `capture(target)` | raw pane text만. 폴링(`grep -qE '●\s*READY'`)은 호출측 책임 |
| `tmux list-sessions -F …` | `list(): MuxSessionView[]` | ★ 활성 파악 + 각인 읽어 lineage. **view, not fact** — authority(socket/meta-record/probe) 아님, 교차검증·진단 전용. 미각인은 optional 부재(throw 아님) |
| `tmux kill-session -t <n>` | `kill(target)` | idempotent — `\|\|true` 셸 대신 runner `okExitCodes` |
| (암묵 `has-session`) | `isAlive(target)?` | 선택 |

### ★ `demo/demo.sh`가 뒤집는 전제 (2026-07-12 — 착수 전 반드시 읽을 것)

위 표는 repro만 보고 만들어서 **launch 단위를 session으로 잡았다. 실물은 pane이다.** demo는 peer/sender **두 시민을 한 session의 두 pane에** 띄운다 — 이게 `opens siblings, not disposable workers`의 tmux 실물이고, repro의 1-session-1-agent보다 프로덕션에 가깝다. driver를 repro만 보고 짜면 **pane을 못 여는 driver**가 나오고 demo를 driver 위로 못 올린다.

| demo.sh 실측 | 표가 놓친 것 | 설계 귀결 |
|---|---|---|
| `new-session -d -s <s> -n demo -x 220 -y 50 "<cmd>"` / `split-window -t <pane> -v -P -F '#{pane_id}' "<cmd>"` | **launch = argv 직접 전달**. repro는 셸 세션 만들고 `send-keys`로 타이핑 | `MuxLaunchSpec.command: string[]`가 옳다. **launch는 `pasteText` 없이 완결** — 타이핑 launch는 repro의 편의이지 계약이 아님 |
| `split-window`로 두 번째 시민 | **launch 단위 = pane** (session 아님) | `MuxTarget.handle`은 pane id. **`launch(spec)`에 "새 session" vs "기존 target 옆 split" 두 모드가 필요** — OPEN: `launch(spec)` + `splitFrom?: MuxTarget`인가, 별도 `split()`인가. 착수 1에서 결정할 것 |
| `list-panes -s -F '#{pane_id}'`, `%N`로 `send-keys -t` | pane id 타겟팅 | demo 주석 그대로: **`%N`은 operator의 `base-index`/`pane-base-index` 설정과 무관하게 안정**. session명+인덱스 타겟팅은 사용자 설정에 흔들린다 → **handle은 `%N`** |
| `wait_for_new_socket` (control socket 등장 폴링) | **launch 완료판정의 authority** | repro의 `capture-pane \| grep READY`는 **view**, demo의 socket 등장이 **fact**. 3겹 불변식 §"view, not fact"와 정확히 정합 → `driver.capture()`는 진단용으로 남기고 **launch 성공 판정에 쓰지 말 것** |
| `asciinema --command "tmux attach -t <s>"` | 관찰 경로 | 후속 `openMuxTarget` manual 레이어의 실물 선례 (attach/switch는 core driver 아님) |
| 각인(`set-option @entwurf_garden_id`) **없음** | — | lineage 각인은 **repro가 유일 소스**. driver가 둘을 합쳐야 완전해진다(demo의 launch 정확성 + repro의 각인) |

**요컨대 driver의 소비자는 셋이고, 이식 대상은 repro 하나가 아니라 `repro ∪ demo`다.**

**동형 레퍼런스(그대로 미러):** `pi-extensions/lib/acp/backend-adapter.ts` — `interface AcpBackendAdapter`(:115), `claudeAdapter`(:194), `const ADAPTERS = [claudeAdapter]`(:275), `resolveAcpBackendAdapter(modelId)`(:287). driver 1개 = mux 1개 = siblings-not-workers의 mux 레이어 반복.

### 설계 3겹 불변식 (2026-07-01 opus4.8 ↔ gpt-5.5 3라운드 확정 — 어기면 tmux가 코드를 삼킨다)

1. **driver 불변식 = `$TMUX` 비의존.** caller가 tmux 밖이어도 `tmux new-session -d`로 detached 생성. "mux가 launch surface"이지 "caller도 mux 안"은 아님. → `check-mux-driver` fake-runner가 강제(fake엔 `$TMUX` 개념 없음).
2. **관찰 규율 = mux-visible launch가 default, 유령 분신 금지.** caller가 tmux 안이면 같은 server에 떠서 `tmux ls`+`switch-client`로 즉시 adopt. 강제 아니라 권장 posture(`opens siblings, not disposable workers`의 tmux 판). → manual observe smoke.
3. **경계 불변식 = mint ≠ transport.** spawn/mint(garden-id 발급·registry·name/cwd/model)는 **mux를 모르고**; driver는 **mint를 모른다**. mint/core 파일군의 `lib/mux/*` import 금지를 `scripts/check-mux-boundary.ts`(TS compiler API로 `ImportDeclaration`+dynamic import string literal 검사, **allowlist 방식** — launch-profile/orchestrator만 허용)가 강제(착수 7). "강제하면 코드가 tmux를 따라간다"의 실물 방어.

### 테스트 3층 (GPT 제안 채택)

- `check-mux-driver` — fake runner deterministic. argv/순서/kill idempotency(`okExitCodes`)만 단언. tmux 바이너리 불요.
- `LIVE=1` smoke — 진짜 tmux로 detached 생성/캡처/kill. `$TMUX` 비의존 증명.
- manual observe smoke — "parent inside tmux 권장" + `$TMUX` 감지 시 `switch-client -t <handle>` 힌트. attach/switch는 core driver 아님 → 후속 `openMuxTarget` manual 레이어.

### 착수 플랜(순서대로)

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
     command: string[]; env?: Record<string, string>;  // argv 직접 전달 (demo 실측) — 타이핑 launch 아님
     geometry?: { cols: number; rows: number };    // default 200×50 (demo는 220×50)
     cwd?: string;
     // ★ OPEN(착수 1에서 결정) — demo.sh는 형제를 `split-window`로 같은 session 옆 pane에 연다.
     //   splitFrom?: MuxTarget;  // 있으면 그 pane 옆에 split, 없으면 새 session
     //   ↔ 대안: 별도 `split(from, spec)` 메서드. 어느 쪽이든 pane 단위 launch는 필수.
   };
   // MuxTarget = launch/resolve된 실행 핸들. branded → list 결과(MuxSessionView)를 send/kill에 실수로 못 넣게
   // handle = tmux pane id(`%N`) — operator의 base-index/pane-base-index 설정에 흔들리지 않는 유일한 안정 좌표(demo 실측)
   export type MuxTarget = { readonly __brand: unique symbol; driverId: "tmux" | "zmx"; gardenId: string; handle: string; driverData?: unknown };
   // MuxSessionView = tmux ls 관찰 스냅샷. dispatch authority 아님(socket/meta-record/probe가 authority). conflict는 diagnostic bucket
   export type MuxSessionView = { driverId: "tmux" | "zmx"; handle: string; gardenId?: string; parentGardenId?: string; observedAt: number; raw?: string };
   export function createTmuxDriver(deps: { runner: MuxRunner; sleep?: (ms: number) => Promise<void> }): MuxDriver; // argv 순수부/부수효과 분리
   export const tmuxDriver: MuxDriver;              // createTmuxDriver({ runner: realRunner })
   export const DRIVERS: readonly MuxDriver[] = [tmuxDriver /*, zmxDriver */];
   export function resolveMuxDriver(id: string): MuxDriver; // resolveAcpBackendAdapter 미러 fail-fast
   ```

   - submit quirk(더블-Enter)는 **여기 없음** — claude-code launch-profile(7)이 소유. `pi-native-gpt`는 자기 submit policy.
   - `driver.ts`는 leaf: `entwurf-core`/mint import 금지. 역방향(mint→`lib/mux`) 금지는 7의 import-boundary 게이트.

2. **`tmuxDriver` 구현** — 이식 대상은 **`repro ∪ demo`**(repro만 보면 pane을 못 여는 driver가 나온다): demo에서 **argv launch + `split-window` pane 생성 + `%N` handle**, repro에서 **각인 + `capture-pane`**. 각 메서드는 `plan*(): string[][]`(argv) 계산 → injectable runner 실행. geometry/`@entwurf_garden_id`/`@entwurf_parent_garden_id`는 spec. 더블-Enter는 **여기 아님**. launch 성공 판정에 `capture()`를 쓰지 말 것(authority는 control socket 등장 — demo `wait_for_new_socket`). repro/demo 스크립트는 그대로 두되 프로덕션 경로가 driver를 쓰게 하고, 종국엔 **`demo/demo.sh`가 driver 위로 올라오는 게 이 레인의 실물 인수 테스트**다.
3. **deterministic 게이트 `check-mux-driver.ts`** — 실제 tmux 없이 fake runner로 tmuxDriver 구동: primitive별 argv/순서 단언, `@entwurf_garden_id` 각인 단언, kill idempotency(`okExitCodes`), `resolveMuxDriver` fail-fast. `check-acp-*` 스타일. `pnpm check` 체인 + `run.sh` dispatch 배선.
4. **`zmxDriver` 스텁** — 같은 interface로 `DRIVERS=[tmux,zmx]`가 컴파일되게. 미구현 op는 fail-loud. **zmx 확보 = 설치면 계약(#47 코멘트): `command -v zmx` probe → optional, 없으면 tmux fallback; 능동 확보는 upstream prebuilt self-fetch(opt-in), nix flake/external-packages.sh/특정 하네스 PATH 전제 금지.**
5. **enum 공존** — `ENTWURF_V2_TRANSPORTS`에 `zmx-live` 추가(`tmux-live`와 공존). schema↔types 게이트 갱신 **+ `DispatchVerdict`의 resume union도 같이 확장(GPT 지적 — 놓치면 타입 갈라짐)**. mux 종류를 별도 필드로 빼는 추상화는 금지(enum 나열 > 추상화 두께).
6. **네이밍 중립화(cosmetic)** — fixture `tmuxTarget`(위 2줄) → `muxTarget`. 프로덕션 필드가 아니므로 리스크 낮음.
7. **fresh pi-native GPT launch profile(더 큰 후속)** — `runEntwurfSync`(v1, sync-body sweep에서 **제거됨**)의 registry/session-id/name/cwd-enrich 자산을 git history에서 복원해 재사용하되, `--no-extensions` detached one-shot 복구가 아니라 mux-visible `pi-native-gpt` launch profile로 설계(`claude-code`/`codex`/`agy`도 같은 launch/observe/capture/kill 규율). **완료판정:** mux launch가 서면 `6d06ad0`이 지운 `entwurf/gpt-5.x` ACP 타깃을 레지스트리에 되살릴 수 있음.
8. **agy(Antigravity) spawn** — spawn surface 통일 **후** 그 위에 얹기(기반 먼저 안 서면 launch seam이 갈림). *주: agy **delivery/설치 어댑터**는 07-04 레인에서 mux보다 먼저 감 — 갈라진 건 launch면뿐.*

## 넘으면 안 되는 선 (이 레인 한정)

- **mux launch는 driver 인터페이스 뒤에서만** — 프로덕션 코드에 `tmux` 직접 호출 금지(repro 예외). tmux 전용 가정/타입/필드명 새로 심지 말 것. zmx는 경량 1급 driver 후보.
- **mint는 mux를 모르고 driver는 mint를 모른다** — spawn/mint 로직에 `lib/mux` import 금지, `driver.ts`는 `entwurf-core` 무의존 leaf. 더블-Enter submit은 driver 아니라 launch-profile. `$TMUX` 전제(caller도 tmux 안이어야)를 driver/게이트에 심지 말 것 — 관찰가능 launch는 강제 아닌 default posture.
- **fresh pi-native GPT도 먼저 mux-visible** — v1식 detached/bg `pi -p` 복구를 기본값으로 되살리지 않는다. headless/bg pi 최적화는 GLG 명시 시 별도 레인.

## 참조

- 트래커: #47 · 동형 패턴: `pi-extensions/lib/acp/backend-adapter.ts`
- **driver 소비자(이식 소스) 셋:** `demo/demo.sh`(+`demo-baseline.sh`) — argv launch·pane·`%N`·socket 폴링 / `scripts/raw-async-delivery/repro-{plugin-idle-wake,addressed-routing}.sh` — 각인·`capture-pane` / `scripts/smoke-agy-native-push-live.ts` — 수동 tmux 관찰 절차(주석)
- 이 문서의 출처: `NEXT.md` §②/§③ (`977519d` 시점) — 승격 후 NEXT는 포인터만 유지
- **폐기 조건:** 착수 1~3이 서면(`pi-extensions/lib/mux/driver.ts` + `scripts/check-mux-driver.ts` + `scripts/check-mux-boundary.ts`) 이 문서의 인터페이스/표/플랜은 전부 코드에 흡수된다. 그때 이 파일을 지우고 `NEXT.md`에 완료판정 한 줄(`6d06ad0`이 지운 `entwurf/gpt-5.x` 레지스트리 복원)만 남긴다.
