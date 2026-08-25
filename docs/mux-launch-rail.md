# mux launch rail — 먼저 같은 tmux session의 window를 다룬다

> **Status (2026-08-13): visible fresh-call과 same-id pi resume-call이 출하됐고, fresh-call의 optional literal absolute `cwd`도 #73으로 착지했다.**
> `pi-extensions/lib/mux-placement.ts`의 세 동사(placement leaf)와 `pi-extensions/lib/mux-launch.ts`의
> visible launch는 그대로이고, `mux-fresh-call.ts`와 `mux-resume-call.ts`가 그 위의 두 public lifecycle
> composition으로 섰다 — placement leaf는 launch와 두 composition에서 재사용된다.
> `entwurf_fresh_call`과 `entwurf_resume_call`은 native pi와 MCP bridge 양쪽에 등록된다. resume의 record
> authority·lock·same-gid socket observation은 mux가 아니라 `entwurf-v2-visible-resume.ts`가 소유한다.
> delivery(`entwurf_v2`)는 여전히 launch를 import하지 않으며 그 동작도 이전과 동일하다.
> Onboarding adapter와 lifecycle 구현의 module/lane 소유선은 계속 분리된다. 다만
> [`adding-a-harness.md`](./adding-a-harness.md) step 9는 #82 이후 새 native harness를
> supported라고 부르기 전에 이 문서의 visible-fresh evidence까지 요구한다 — admission
> acceptance가 둘의 영수증을 모으는 것이지 어느 모듈이 다른 모듈을 import하는 것이 아니다.
> **§6이 서술한 형태의 T1-b(사전 주입 token → identity lookup)는 CLOSED다** — 미구현인 채로 §6-a의
> callback correlation에 의해 superseded됐고, 새 증거와 GLG 재승인 없이 다시 열지 않는다.
> 정확한 다음 행동은 active NEXT handoff가 진다.

## 1. 출발점 — 무엇을 부를지보다 어디에 여는지가 먼저다

`entwurf_v2`는 이미 record가 있는 garden citizen에게 메시지를 배달한다. 빠진 것은 새 runtime을
사람이 볼 수 있는 곳에 여는 능력이다. 하지만 무엇을 부를지 붙이기 전에 **어디에 여는지**부터
정확해야 한다.

GLG의 기본 장면은 한 tmux server 안의 한 operator session이다.

```text
tmux server
└─ session: entwurf
   ├─ window 1: 현재 세션
   ├─ window 2: 다른 형제
   ├─ window 3: 나중에 fresh launch가 들어올 자리
   └─ window 4: 나중에 resume가 들어올 자리
```

사람은 같은 session 안에서 `prefix + 1/2/3/4`로 이동한다. sibling 하나마다 별도 tmux session을
만드는 구조가 아니다.

여기서 갈라지는 두 문제를 계속 구분한다.

```text
existing dispatch:   garden identity가 입력이다     — 출하됨 (entwurf_v2)
fresh explicit call: garden identity가 callback이다 — 출하됨 (`entwurf_fresh_call`)
same-id pi resume: existing garden identity가 입력이다 — 출하됨 (`entwurf_resume_call`)
```

2026-08-04의 다중 agent 협업은 mux 없이 existing-citizen dispatch만 증명했다. 그 뒤 0.14.0이 visible
fresh creation과 same-id pi resume을 별도 lifecycle verb로 출하했다. 둘 중 어느 것도 delivery transport가
아니며, launch receipt를 task 성공이나 socket observation으로 올려 읽지 않는다.

## 2. tmux 좌표

| 층 | 예 | 현재 의미 |
|---|---|---|
| server | `/tmp/tmux-1000/default` | tmux daemon/socket domain |
| session | `$0`, 이름 `entwurf` | operator가 형제 window들을 모아 두는 container |
| window | `@0`, index `1` | sibling runtime을 놓을 기본 단위 |
| pane | `%0` | window 안의 실제 terminal/process handle |

human index `1/2/3/4`는 키바인딩 UX다. 기계가 후속 제어에 쓸 좌표는 stable native id
`$session / @window / %pane`다. 둘을 섞지 않는다.

index는 불변이 아니다. `renumber-windows on`에서 가운데 window가 사라지면 뒤 window의 index가
당겨진다. `@window`는 그대로다. 그래서 후속 제어는 언제나 `@window/%pane`으로 지정한다.

현재 위치는 이름 추측이나 `$TMUX` 문자열 수동 파싱으로 만들지 않는다. caller가 tmux 안에서 물려받은
`TMUX_PANE`을 anchor로 `tmux display-message`에 질의해 server/session/window/pane 사실을 얻는다.
tmux 밖이라면 추측하지 않고 거절한다.

단 `display-message`의 exit code는 존재 증거가 아니다. 없는 pane을 줘도 rc=0에 빈 출력이고, 빈
target은 rc=0으로 현재 pane에 조용히 fallback한다. 그러므로 inspect의 precondition은 네 겹이다.

```text
TMUX and TMUX_PANE both present and non-empty  (missing/empty → reject)
TMUX_PANE is a native %N pane id               (malformed → reject)
query output non-empty                         (unresolved → reject)
returned #{pane_id} == anchor                  (mismatch → reject)
```

`TMUX_PANE`은 어느 pane인지를 말하고, `TMUX`는 bare `tmux`가 default server가 아니라 caller의
server로 해석되게 만든다. 둘 다 필요하다. `TMUX`는 존재만 확인하고 파싱하지 않는다 — socket/session을
문자열에서 뜯어내는 것이 이 rail이 금지하는 추측이다. echo-back이 없으면 tmux 밖이나 잘못된 anchor에서
남의 pane을 집는다.

## 3. T0-b 실물 — placement leaf 하나 (완료)

아래 시나리오는 2026-08-04 private tmux server에서 raw CLI로 먼저 증명했고(T0-a), 그 명령 그대로
TypeScript로 옮겼다(T0-b).

```text
GIVEN  session entwurf has windows 1 and 2
WHEN   one window is appended
THEN   the same session has 1,2,3
WHEN   another window is appended
THEN   the same session has 1,2,3,4
AND    there is still exactly one tmux session
WHEN   only the new windows are removed
THEN   original windows 1 and 2 survive
```

출하된 표면은 `pi-extensions/lib/mux-placement.ts`의 세 동사뿐이다.

```text
inspectPlacement()      inherited TMUX/TMUX_PANE의 server/session/window/pane 사실
appendWindow()          같은 session 끝에 detached default-shell window 하나
closeWindow()           origin context에 결박된 @window의 정직한 close receipt
```

네 안전 축이 이 leaf의 경계다.

| 축 | 규칙 |
|---|---|
| TMUX context | `TMUX`와 `TMUX_PANE` 둘 다 non-empty 필수. 하나라도 없으면 `no-tmux-context` 거절 |
| native selector grammar | `%pane`/`$session`/`@window`/decimal만 통과. 이름·index는 handle이 아니다 |
| tmux failure honesty | rc=0을 존재 증거로 쓰지 않는다. `already-gone`은 fresh `list-windows`에서 부재를 적극 증명했을 때만 |
| origin context binding | `WindowHandle`이 `serverPid`/`sessionId`를 함께 지고 다녀, 재시작 후 id를 재사용한 다른 server에 대고 close하지 않는다 |

성질:

- caller-supplied command/cwd/env/window name/label을 받지 않는다.
- append는 현재 window를 바꾸지 않는다. focus/switch helper는 없다.
- window 소멸 경로는 둘이고 같은 동사가 아니다. `remain-on-exit off`에서는 pane process가 끝나면
  window가 먼저 사라진다(runtime-owned natural exit). `closeWindow`는 살아 있는 window를 operator가
  명시적으로 정리하는 동작이다. 그래서 `CloseOutcome`은 `closed | already-gone`이고, 그 밖의 실패는
  throw한다 — 삼켜서는 안 되는 실패는 "window가 아직 있는데 닫지 못했다"이다.
- outside tmux는 mutation 전에 fail-loud 한다.

### 이 leaf가 모르는 것 — 그리고 삭제 조건

garden id, model, auth, transcript, task, delivery를 모른다. 장소만 다룬다.

이것은 core capability가 아니라 **삭제 가능한 optional leaf**다. 한 커밋으로 지워질 수 있어야 한다.
삭제 조건은 명시적이다 — **pi/tmux/operator가 같은 배치를 스스로 제공하면 이 leaf를 지운다.**

2026-08-04 기준 그 조건은 성립하지 않는다. pi 0.83.0의 `<pi>/docs/tmux.md`는 extended-keys 키보드 설정
문서일 뿐이고, pi는 자신을 어느 window에 놓을지에 대한 어떤 표면도 제공하지 않는다.
**pi 0.84.0에서 재확인(2026-08-07): 그 `docs/tmux.md`는 v0.83.0..v0.84.0 sha256 동일**
(`1fa5373d…`)이므로 삭제 조건은 여전히 불성립이다.

## 4. caller-side situation map — 전체 지도를 보는 쪽은 caller다

GLG가 원하는 것은 orchestrator가 아니라 다음 수동 판단의 재현이다. 이 지도는 **분기가 아니라, 판단에
필요한 사실 두 개를 같은 평면에 올려놓는 일**이다.

```text
"소넷이 가든 id로 대기중입니다"            — 지금 됨   (entwurf_peers)
"소넷이 tmux 세션 aaa의 window 3에 있습니다" — 지금 안 됨 (§7 seam)
```

situation map은 세 재료의 합성이며, 그 이상이 아니다.

```text
current placement            내 위치       inspectPlacement (T0-b, green)
garden peer facts            누가 있는가   entwurf_peers  (shipped)
proven peer placement        어디 보이는가 optional, exact evidence 있을 때만 (§7)
```

판단 루프:

```text
"대기 중인 Sonnet에게 보내줘"
  → caller agent가 garden peer facts를 본다
  → exact citizen이 하나면 garden id로 entwurf_v2 전달
  → placement가 증명돼 있으면 "aaa session / window 3"도 함께 보고
  → 없으면 caller 자신의 placement를 확인
  → 현재 repo/session 옆에 window를 append하고 Pi를 visible launch할지 판단
  → 후보가 모호하면 자동 선택하지 않고 GLG에게 묻는다
```

경계 세 개를 이 지도에 못 박는다.

1. **situation map은 새 public surface가 아니다.** 지금은 caller agent가 이미 가진 두 손
   (`entwurf_peers`, `inspectPlacement`)을 같은 문장 안에서 읽는 방식의 이름이다. 이를 위한
   `entwurf_situation` 같은 verb를 만들지 않는다.
2. **`entwurf-peek` skill은 이 지도의 SSOT가 아니다.** 그것은 sync entwurf 자식의 JSONL/activity를
   heuristic으로 들여다보는 진단 손이다. 추정으로 세션을 잇고, control socket 없는 세션까지 이름 태그로
   추측한다. 진단에는 유용하지만 **placement 사실의 출처로 인용해서는 안 된다.** 지도를 넓히려고
   peek을 확장하지 않는다.
3. **substrate는 작업자를 고르지 않지만, caller agent는 판단한다.** 자동 backlog·대체자·scheduler를
   core에 넣지 않는다는 뜻이지, 협업 중인 agent가 사실을 보고 한 단계 판단하지 말라는 뜻이 아니다.

## 5. T1-a와 T1-b는 같은 문제가 아니다

어제까지 T1은 하나의 덩어리였고, 그래서 "identity correlation이 안 되니 T1 전체가 막힘"이 됐다.
그런데 GLG가 손으로 하는 세 동작 — 내 위치 확인 / 옆 window 생성 / pi 실행 — 에는 identity 문제가
아예 없다. 전부 즉시·로컬 사실이다. 어려운 것은 그 다음이다.

### T1-a — visible Pi launch (완료; 유일한 consumer는 §6-a의 fresh-call composition)

`pi-extensions/lib/mux-launch.ts`. placement leaf에 네 번째 동사를 붙이지 않고 **그 위에 얹은 별도
composition**이다 — leaf에 command 파라미터를 두는 순간 그것이 leaf가 거부하는 carrier가 되고, leaf의
삭제 가능성도 함께 사라진다.

```text
resolvePiRuntime()                        PATH에서 공식 pi를 절대경로로 확정 + 실행 가능 증명
  → requireSameContext()                  leaf의 binding — 서버·세션이 바뀌었으면 거절
  → new-window … -- <runtime>             한 번의 mutation
  → @window / %pane / pane_pid 반환         여기서 책임 끝
```

- garden identity를 기다리지 않는다. record store를 읽지 않는다. task를 배달하지 않는다.
- 이 T1-a leaf composition의 launch shape는 **고정**이다. caller-supplied command/cwd/env/model/window-name carrier가 없다. 제품 surface인 §6-a fresh-call만 한 층 위에서 explicit model을 runtime CLI token으로, optional requested cwd를 자기 argv의 tmux `-c` token으로 붙인다.
- `-d`를 유지한다. "visible"은 operator 세션 안의 실제 window라는 뜻이지 focus를 빼앗는다는 뜻이 아니다.
- T1-b의 어려움을 T1-a에 미리 얹지 않는다. 반대로 **visible launch가 됐다고 automatic delegation까지
  됐다고 말하지 않는다.**

#### receipt가 뜻하는 것 — 그리고 일부러 뜻하지 않는 것

`PiLaunch`는 두 가지만 진술한다: tmux가 window를 만들며 보고한 id들, 그리고 우리가 건넨 절대 runtime
경로. **pi가 실행 중이라고 주장하지 않는다.**

이 절제는 겸손이 아니라 실측 결과다. `new-window … -- /nonexistent/bin/nope`는 **exit 0으로 멀쩡한
handle을 출력하고, 즉시 재조회해도 그 window는 여전히 목록에 있다** — tmux 3.6a에서 10/10회, 정상
launch와 그 순간 구별 불가능하다. window는 몇 밀리초 뒤 `remain-on-exit off` 경로로 사라진다.

그래서 launch 뒤의 존재 확인은 **아무것도 증명하지 못하면서 receipt를 검증된 것처럼 보이게 만든다.**
그것은 T0-a의 rc=0 함정이 모자만 바꿔 쓴 것이다. 이 모듈은 그 확인을 하지 않는다.

정직하게 할 수 있는 일은 **window가 생기기 전에 실패 부류를 지우는 것**이고, 그것이 precondition이다
(`scripts/lib/probe-cli-target.ts`와 같은 규율: absolute → whitespace → present → regular → executable).
거절은 열리지 않은 window에 대한 **named reason**이지 fallback이 아니다.

| precondition | 이유 |
|---|---|
| `runtime-unresolved` | PATH에 공식 `pi`가 없다 |
| `runtime-not-absolute` | 상대 경로는 새 pane의 cwd에 대해 해석된다 |
| `runtime-path-whitespace` | **tmux가 공백에서 argv 한 원소를 재분해한다**(실측). `/tmp/a b/pi`는 `/tmp/a`를 `b/pi` 인자로 실행하고 즉사한다 |
| `runtime-missing` / `-not-regular-file` / `-not-executable` | exec는 window가 생긴 뒤에 실패한다 |

`--`는 tmux가 target을 shell에 넘기지 않게 한다(실측: `x; touch <file>` 인자로 파일이 생기지 않았다).
그러나 `--`가 위 재분해까지 막지는 못한다 — 그래서 whitespace 검사는 별도 불변식이다.

#### cleanup — 얇은 것이 설계다

이 모듈의 mutation은 `new-window` **단 하나**고 그 뒤는 전부 순수 파싱이다. 그것이 cleanup 설계다 —
보상 트랜잭션이 아니라, 보상할 것이 거의 없는 모양. 남는 잔여 하나: tmux가 파싱 불가능한 handle을
보고하면 window는 존재하는데 그 id가 바로 우리가 읽지 못한 값이므로, 닫을 정직한 대상이 없다. 이
경우는 **fail loud 하고 orphan을 명시**한다. inventory diff로 "새로 생긴 것"을 추정해 죽이는 것은 이
rail이 다른 모든 곳에서 금지하는 바로 그 추측이다.

### T1-b — automatic delegation (historical token/lookup design; CLOSED)

```text
새 Pi가 낳은 exact garden id를 launch 요청과 결박
  → entwurf_v2로 task 전달
```

이 identity-correlation 문제를 token과 store lookup으로 풀려던 설계는 §6-a의 callback 방식으로
대체됐다. 아래 §6은 폐기된 선택지의 근거를 보존하며, 현재 구현 방향을 열지 않는다.

### 왜 fresh call이 어려운가

process를 여는 것보다 **그 process가 낳은 정확한 record/garden id를 caller의 요청과 상관짓는 일**이
어렵다. 시각·cwd·새 파일 목록으로 "방금 뜬 것이 아마 이것"이라고 추측하면 watcher·timeout·retry·경합
처리가 따라오고, 그 순간 Entwurf는 교환기에서 supervisor로 자란다.

## 6. pi identity 판정 — 앵커 2026-08-04 (pi `0.83.0`), 재확인 2026-08-07 (pi `0.84.0`)

T1-b를 열려면 둘 중 하나가 실제 pi lifecycle에서 증명돼야 한다.

1. **동기 반환** — official launch가 native session id 또는 garden id를 동기 반환하고, 그 값이
   정확히 한 record/garden id로 결정적으로 이어진다.
2. **사전 주입** — caller가 native identity를 미리 정해 launch에 주입할 수 있고, pi의 native
   lifecycle이 그 identity로 정확히 한 record를 낳는다.

certified pi `0.83.0`의 공식 문서와 dist source를 읽고 판정한다. 아래 표의 pi 측 근거는
certified pi가 `0.84.0`으로 올라간 뒤 재실측했고 **판정은 그대로다**: `--session-id`와
`assertValidSessionId` 문법은 살아 있고, `session-manager.ts`의 유일한 v0.83.0..v0.84.0 변경은
session 디렉터리 스캔이 symlink를 허용하게 된 것(identity minting과 무관)이며, 동기로 identity를
반환하는 새 표면은 추가되지 않았다. 즉 조건 1은 0.84.0에서도 불성립이다.
0.84.1 재확인(2026-08-07): `session-manager.ts`는 v0.84.0..v0.84.1 compare set에 없다(바이트 동일)
— 이 판정은 0.84.1에서도 재측정 없이 그대로 선다.
0.84.2 재확인(2026-08-16, #79): `session-manager.ts`의 유의미 델타는 user-facing `APP_NAME` 표시 문구뿐
이고 identity mint / `--session-id` / 동기 id 반환 표면은 불변 — 조건 1은 0.84.2에서도 불성립.
0.84.3 재확인(2026-08-25): upstream v0.84.2..v0.84.3의 `session-manager.ts` 델타는 branch_summary
`fromId` 북키핑 한 건(분기 전 leaf를 기록)뿐이고 identity mint / `--session-id` / 동기 id 반환
표면은 불변 — 조건 1은 0.84.3에서도 불성립.
역사 표본(0.83.0/0.84.0)은 덮어쓰지 않는다.

### 읽은 근거

`<pi>` = 설치된 `@earendil-works/pi-coding-agent@0.84.0`(이 절의 표본을 뜬 install; 현 certified floor는 0.84.3 — 위 0.84.3 재확인 문단 참조) 패키지 루트(pnpm global store).
아래 표에서 출처가 `(0.83.0)`으로 적힌 행은 **앵커 시점의 역사적 표본**이고, 그 행의 사실이 0.84.0에서도
성립하는지는 위 재실측 문단이 따로 진다. 접두사 없는
경로는 이 repo 기준이다.

| 사실 | 출처 |
|---|---|
| `--session-id <id>` "Use exact project session ID, creating it if missing" | `pi --help` (0.83.0; 0.84.0에서 잔존 확인) |
| id 문법 `^[A-Za-z0-9](?:[A-Za-z0-9._-]*[A-Za-z0-9])?$` | `<pi>/dist/core/session-manager.js:15-19` (`assertValidSessionId`) |
| flag 검증과 `--session`/`--continue`/`--resume` 상호배제 | `<pi>/dist/main.js:204-224` |
| 미존재 id → 경고 후 그 id로 신규 생성 | `<pi>/dist/main.js:304-311` |
| 기존 project-local id 존재 → 그 세션을 **연다** | `<pi>/dist/main.js:305-308` |
| 기본 id는 pi가 미는 uuidv7 | `<pi>/dist/core/session-manager.js:12-14` |
| `--session-id`는 automation용으로 도입된 flag | `<pi>/CHANGELOG.md:849,856` |
| pi는 tmux placement 표면을 제공하지 않는다 (키보드 설정 문서뿐) | `<pi>/docs/tmux.md` 전문 |
| garden id는 pi가 아니라 meta-record가 민팅, join key는 `(backend:"pi", nativeSessionId)` | `pi-extensions/lib/pi-citizen-birth.ts:1-29` |
| store의 `nativeSessionId → record` mapping은 **single-valued**: 한 holder면 ATTACH(주소 재사용), 두 record가 한 id를 claim하면 store certification이 upsert 전체를 refuse | `pi-extensions/lib/meta-session.ts:1758-1761` (holder 조회), `1096-1140` (`decideUpsert`), `733,1007,1065-1074` (#52 uniqueness certification) |
| 그 holder 조회는 **store 전역**이다. project별로 나뉘지 않는다 | `meta-session.ts:1755-1761` (`certifyActiveStoreDir` 결과 전체를 scan) |
| 같은 `nativeSessionId` 재시작은 새 gardenId를 만들지 않고 ATTACH | `pi-citizen-birth.ts:16-19` |
| 같은 native id가 다른 backend에 묶여 있으면 identity drift로 throw | `meta-session.ts:1139-1143` |
| record birth는 `--entwurf-control` 세션의 `session_start`에서 일어난다 | `pi-extensions/entwurf-control.ts:1100-1135` |
| 출하된 record reader는 **gardenId key** 또는 전체 listing뿐. `nativeSessionId`로 읽는 exported surface는 없다 | `meta-session.ts:1881,1950,2050` (gardenId), `1014,830` (listing) |

### 판정

**조건 1(동기 반환)은 성립하지 않는다.** visible interactive launch는 TUI를 점유하고, 자신의 session
id나 garden id를 caller가 읽을 수 있는 동기 채널로 반환하지 않는다.

**조건 2(사전 주입)는 pi 쪽에서 성립한다.** `--session-id`는 caller가 정한 문자열을 그 세션의
`nativeSessionId`로 고정한다. 그 native identity를 caller가 미리 정할 수 있다는 것이 조건 2가 묻는
것이고, 그 절반은 참이다.

```text
caller가 fresh token N을 민팅
  → pi --session-id N --entwurf-control … 를 새 window에서 실행
  → 새 pi의 session_start가 (backend:"pi", nativeSessionId=N)로 record upsert
  → N의 holder가 없으면 CREATE → record가 gardenId G를 민팅
  → caller가 key N으로 G를 읽어야 한다        ← 이 seam이 아직 없다
```

**그러나 "정확히 하나의 record를 낳는다"는 나머지 절반은 아직 증명되지 않았다.** store의
`nativeSessionId → record` mapping이 single-valued인 것은 맞지만, 그것이 곧 fresh mapping을 뜻하지는
않는다. 기존 holder가 하나 있으면 upsert는 실패하지 않고 **ATTACH해서 그 gardenId를 재사용한다.**
그러면 caller는 자기가 방금 연 세션이 아니라 남의 주소를 상관짓게 된다.

당시 결론은 **"T1-b가 원리적으로 후보로 열렸다"**이지 "correlation이 증명됐다"가 아니었다.
아래 세 조건은 그 후보에 필요했지만 전부 미설계로 남았고, §6-a의 callback correlation이 제품 완료점이
되면서 이 후보는 CLOSED됐다.

### 폐기된 후보에 필요했던 것 — 끝내 미설계

1. **주입하는 것은 garden id가 아니라 caller가 민팅한 opaque native token이다.** 과거에는 launcher가
   `--session-id <gardenId>`를 넣었고, 그것이 pi와 entwurf 두 authority를 한 문자열에 묶었다.
   #50 C2가 그 결합을 끊었다(`entwurf-resume-args.ts:39-46`). 되돌리지 않는다. token은 상관용이고,
   주소는 record가 민팅한다.
2. **fresh-token contract — 두 namespace 모두에서 부재를 확인해야 한다.** 충돌 지점이 둘이고, 서로
   다른 방식으로 조용히 실패한다.

   | namespace | 충돌 시 | 결과 |
   |---|---|---|
   | pi project-local session corpus | `<pi>/dist/main.js:305-308`이 에러 없이 그 세션을 **연다** | 남의 대화에 붙는다 |
   | active meta-record store (**전역**, project 무관) | upsert가 **ATTACH**해 기존 gardenId를 재사용한다 | 남의 주소를 자기 launch로 상관짓는다 |

   그러므로 조건은 최소 **`pi project-local corpus에 없음` + `active meta-record store에 holder 없음`**
   이고, token은 caller가 소유한 fresh opaque 값이어야 한다. preflight에서 부재를 확인하고, holder가
   있으면 **fail 또는 re-mint** 한다. **ATTACH를 fresh success로 받아들이면 안 된다.**
   (다른 backend가 그 id를 쥐고 있을 때만 identity drift로 throw한다 — `meta-session.ts:1139-1143`.
   같은 backend면 조용히 붙는다.)

   **한계를 숨기지 않는다: 동시 mint 경합에 대한 예약(reservation) authority가 없다.** preflight 확인과
   실제 record birth 사이는 열려 있고, 그 창을 닫는 설계는 존재하지 않는다. N개 병렬 launch는 이 문제를
   정면으로 만난다.

3. **caller가 `nativeSessionId`로 gardenId를 읽는 출하된 surface가 없다.** 출하된 reader는 gardenId를
   key로 쓰거나(`meta-session.ts:1881,1950,2050`) 전체를 listing한다(`1014,830`). native id로의 해석은
   `upsertMetaSession` 내부(`1758-1761`)에만 있고 그것은 write path다. **T1-b caller seam은 미구현이다.**

   그 seam을 만들 때도 경계는 유지한다: 그것은 **입력으로 이미 알려진 key에 대한 strict lookup + bounded
   wait**여야 한다. **unknown record가 나타나기를 기다리며
   시각·cwd를 비교하는 discovery watcher가 아니다.** 이 구분이 무너지면 T1-b는 열지 않는다.

### 그래서 지금 무엇이 바뀌는가 — 아무 배선도 바뀌지 않는다

정리하면 이렇다.

| 축 | 상태 |
|---|---|
| pi-side 사전 주입 (`--session-id`) | **성립** — caller가 native identity를 미리 정할 수 있다 |
| 동기 identity 반환 | **불성립** |
| fresh-token contract (두 namespace preflight + 경합 처리) | **미설계** |
| native id → gardenId caller lookup seam | **미구현** |
| end-to-end T1-b correlation | **미증명; §6-a가 다른 방식으로 대체 → CLOSED** |

즉 이 절이 바꾼 것은 **"T1-b가 upstream 때문에 원리적으로 닫혀 있다"는 판정 하나뿐**이다. 그 문은
닫혀 있지 않다. 그러나 열려 있지도 않다 — 여는 데 필요한 계약이 아직 없다.

**그리고 그 계약은 끝내 설계되지 않았다.** 위 표의 미설계·미구현 항목은 2026-08-05 현재 그대로다.

> **이 문은 이제 닫혔다 (2026-08-05, GLG 판정).** §6-a의 callback correlation이 제품 완료점이 되면서
> pre-injected token → identity lookup 방식은 **PAUSED가 아니라 superseded/declined**다. "언젠가 열
> 후보"로 남겨 두면 다음 세션이 다시 설계를 시작한다 — 실제로 이 lane은 그 방식으로 두 번 폐기했다.
> **새 증거와 GLG의 명시적 재승인 없이 다시 열지 않는다.**

## 6-a. 실제로 열린 문 — callback correlation (fresh-call, 2026-08-05)

§6은 correlation을 **caller가 미리 정한 token으로 나중에 조회하는 문제**로 놓았다. repo 밖 baseline이
드러낸 것은 그 전제가 틀렸다는 사실이다.

**garden record와 control socket은 첫 turn 이전에 이미 존재한다.** 첫 turn이 돌지 않은 두 셀을 관측했고,
둘 다 record가 live였고 pi 셀은 socket 파일까지 있었다. 즉 주소는 창이 열리는 순간 있다 — **caller가
그것을 모를 뿐이다.** 첫 turn이 필요한 이유는 id를 *만들기* 위해서가 아니라 **새 citizen이 그것을 caller에게
말하기** 위해서다.

그래서 fresh-call은 lookup을 만들지 않는다. launch argv에 first task와 함께 **callback 지시**를 실어
보내고, 새 citizen의 첫 행동이 기존 `entwurf_v2`로 nonce를 되돌린다. **그 메시지의 sender envelope이
곧 exact garden id**다 — 우리가 조회한 것이 아니라 delivery 계층이 스스로 붙인 것이다.

| 축 | §6의 T1-b | §6-a의 fresh-call |
|---|---|---|
| identity 출처 | caller가 사전 주입한 token으로 **조회** | 새 citizen이 보낸 메시지의 **sender envelope** |
| 필요한 신규 계약 | fresh-token contract + lookup seam + 경합 처리 | **신규 identity lookup·transport는 없다** — 기존 `entwurf_v2` 전달을 그대로 쓴다. 다만 fresh-call의 first-turn framing과 두 public surface는 **새 계약이다** |
| 동기성 | 동기 반환을 원함(불성립) | **비동기** — launch receipt와 correlation receipt가 분리된다 |
| 실패 모드 | 조회 실패·경합 | callback 부재. 감시하지 않고 visible window가 증거 |

**Model은 ambient default가 아니라 explicit launch input이다 (2026-08-06 operator tour).** 첫 출하 shape는
`{backend, task}`로 bare runtime을 열었고 실제 사용에서 Pi는 퇴역한 `gpt-5.5`, Claude Code는 의도와
다른 Opus 5를 골랐다. 이것은 runtime 선택을 존중한 것이 아니라 caller의 선택을 버린 것이다. 그래서
surface는 `{backend, model, task}`로 좁게 확장됐고 composition은 shell 없이 runtime별 실측 CLI 방언으로 전달한다:
Pi는 `--model <provider/model>` 두 argv token, Claude Code는 `--model=<id-or-alias>` 한 token이다. command/env carrier나 별도
provider/settings knob는 여전히 없다(cwd는 아래 문단의 좁은 별도 입력이다). Launch receipt의 model은 **무엇을 요청했는지**만 증명하며 runtime이
그 model로 turn을 완료했다는 증거는 callback 뒤 self-report/record 축에서 따로 얻는다.

**Cwd도 explicit launch input이다 (#73, 2026-08-13).** cross-repo fresh 상담이 target repo의 cwd를 얻으려고
dormant record를 `entwurf_resume_call`로 되세우는 압력이 실측됐다(2026-08-10 incident) — resume은 continuity
verb이지 placement 우회로가 아니다. 그래서 fresh surface는 `{backend, model, task, cwd?}`로 좁게 한 번 더
확장됐다. 규칙은 좁다: `undefined`와 정확한 `""`만 생략(기존 no-`-c` 동작 그대로)이고, 그 외는 **literal**
절대경로다 — trim도 realpath도 project-name resolution도 store/peers/record 조회도 없다. caller가 유일한
cwd 출처다. 분류는 resume과 **공유하는 `classify-tmux-cwd.ts` leaf**가 지고(4개 reason 문자열 동일; measured
tmux 3.6a 사실도 그 leaf에 있다), `-c`는 fresh 자신의 argv builder가 resume과 대칭인 token 위치(`-t` 뒤,
`-P -F` 앞)에 붙인다 — placement leaf는 여전히 `-c`를 모른다. Launch receipt의 cwd는 model과 같은 종류의
사실로 **무엇을 요청했는지**만 말하며, pane이 실제 어디 앉았는지는 receipt의 사실이 아니다(acceptance 축).
resume은 계속 `{target}` 하나다: recorded cwd 일치는 resume을 고를 이유가 아니다.

**이것이 증명하는 것은 "전달 계층이 그 citizen을 안다"이지 "citizen이 자기를 안다"가 아니다.** 아래
§6-b가 그 구분을 measured incident로 보존한다.

### 6-b. 왜 sibling에게 자기 id를 묻지 않는가 — measured (2026-08-05)

수동 baseline에서 fresh `--entwurf-control` 셀에 자기 gardenId를 물었다. 그 셀은:

1. 셸에서 `entwurf_self`를 찾다가 exit 127 — **native pi 표면에는 그 도구가 없다.**
   `entwurf-control.ts`가 노출하는 것은 `entwurf_v2`·`entwurf_peers`·`entwurf_fresh_call`·`entwurf_resume_call`뿐이고,
   `entwurf_self`는 MCP bridge의 도구다.
2. `mcp/entwurf-bridge/start.sh`를 **스스로 스폰**했다. 그 프로세스는 pi의 MCP child가 아니라 셸의 자식이라
   pi가 child MCP에 심는 sender carrier를 받지 못했고, 상속된 env의 `PI_SESSION_ID`만 보고 답했다.
3. 그 uuidv7을 gardenId로 출력했다. **틀렸다.** 진짜 id는 상태줄에 있었고 control socket 파일명이 그것을
   확증했다. 반환값 자신도 `socketState: "expected"` / `replyable: false`로 자기가 주소가 아님을 말하고
   있었는데, 그 신호는 읽히지 않았다.

그래서 fresh-call framing은 env 탐색·`entwurf_self`·MCP 직접 spawn을 **명시적으로 금지**하고, 어느 표면도
caller에게 garden id를 파라미터로 받지 않는다. 받는 순간 이 오답이 callback target이 될 수 있다.

구현 승인 범위와 STOP LINE은 active NEXT handoff가 진다.

## 7. peer placement evidence seam — 모르면 `unknown`

peer가 어느 tmux window에 보이는지는 **garden address도 liveness도 아니다.** 이 사실은 다음 규칙
아래에서만 지도에 붙는다.

| 규칙 | 이유 |
|---|---|
| meta-record에 저장하지 않는다 | record는 garden address의 authority다. placement는 ephemeral view이고, 서버 재시작 한 번에 거짓이 된다 |
| window title로 추측하지 않는다 | title은 shell/사용자가 언제든 덮어쓰는 표시 문자열이다 |
| cwd 일치로 추측하지 않는다 | 한 repo에 여러 형제가 흔하다. cwd는 후보를 좁힐 뿐 결박하지 않는다 |
| 시각 근접으로 추측하지 않는다 | 그것이 곧 discovery watcher다 |
| exact evidence가 없으면 `unknown` | 빈칸을 그럴듯한 값으로 채우지 않는다 |

exact evidence로 인정되는 것은 둘뿐이다.

1. **launch receipt** — 이 caller가 직접 연 window의 `@window/%pane`이고, T0-b handle이 지고 있는
   `serverPid`/`sessionId` context와 함께 제시될 때.
2. **peer의 검증 가능한 self-report** — peer 자신이 `inspectPlacement`로 얻은 사실을 보고할 때. 그 값도
   보고자의 server context와 함께 읽고, 다른 tmux server의 좌표는 비교하지 않는다.

두 경우 모두 optional view다. situation map은 placement 없이도 성립해야 한다.

## 8. 지금 만들지 않을 것

- 폐기된 token/lookup correlation 재개 (fresh-token 계약, lookup seam, 예약 authority 포함)
- launch shape 확장: focus/switch, window 이름, 여러 개 동시 launch
- peer placement 저장·추측, 또는 새 public situation-map surface
- 두 번째 spawn/creation verb 또는 `entwurf_v2` 확장 (S1의 visible resume은 creation이 아니라 **별도 lifecycle verb**로 착지했고, delivery를 통과하지 않는다)
- record watcher, timeout/retry, unknown-id discovery
- unknown/new record birth 또는 liveness를 발견하려는 대기 (S1의 known-id socket observation은 한 번의 bounded startup observation으로 출하됨)
- generic driver/registry, labels/metadata
- caller-supplied command/env/window-name carrier, 또는 model·cwd 외 별도 provider/settings carrier (fresh의 cwd는 §6-a의 좁은 literal 시작 디렉터리 입력이지 generic carrier가 아니고, project-name resolver도 아니다)
- raw PTY input, capture/history API
- 모든 tmux session을 관리하는 registry
- zmx adapter, 설치, self-fetch, fallback
- task queue, dependency graph, worker pool, role, quota·context 판단

즉 mux는 여기서 멈추고 supervisor로 키우지 않는다. S1이 착지시킨 것은 fresh-call과 대칭인 좁은 verb 하나이고 — `entwurf_resume_call {target}`, prompt·model override·task 없음, 턴 없음, watcher/retry/supervisor 없음 — 통합 lifecycle LIVE는 이제 **release-gate MUST**다(그것이 이 목록에서 빠진 이유다).

## 9. Repo 밖 baseline — 완료된 선행 증거

GLG가 소유한 raw baseline은 다음 순서로 제품 경계를 먼저 증명했다.

1. placement leaf로 필요한 window를 append한다.
2. 각 window에서 official pi CLI를 실행한다.
3. 새 시민은 native lifecycle로 record를 낳는다.
4. caller가 정확한 identity를 얻은 뒤 `entwurf_v2`를 반복 호출한다.

이 baseline에서 사람 correlation이 실제 병목으로 관측됐고, §6-a의 callback sender envelope가
watcher나 store lookup 없이 그 자리를 대체했다. raw evidence는 active branch handoff가 가리킨다.

## 10. 폐기한 첫 시도에서 남길 사실

2026-08-02 첫 시도는 placement를 정하기 전에 `tmux new-session` 기반 generic driver와 fake gate부터
만들었다. 원하는 window 3/4가 아니라 별도 tmux session을 만드는 잘못된 단위였으므로 production 코드,
gate, LIVE smoke, release 배선을 전부 제거했다.

그 과정에서 tmux 자체 parser가 caller 값을 재해석한다는 사실도 실측했다.

- trailing `;`는 값을 자르고 뒤 argv를 tmux command로 실행할 수 있다.
- `new-session -c`는 tmux format을 확장한다. `#{...}`는 변형되고 `#(...)`는 command를 실행할 수 있다.

따라서 나중에 command surface를 열더라도 "shell을 안 썼으니 argv/cwd/env가 byte-exact"라고 가정하지
않는다. 그러나 지금 이 parser 전체를 위한 codec/guard를 만들지도 않는다. 먼저 실제로 필요한 tmux verb와
고정 launch shape를 정하고 그 좁은 경계만 실물로 증명한다.

## 11. 소유권과 금지선

| 층 | 소유하는 것 | 소유하지 않는 것 |
|---|---|---|
| `entwurf` contract/decider/runner | garden id 주소 해석, envelope, rail 선택, delivery receipt/reject | creation, model 선택, task 분해, supervision |
| 기존 delivery composition (`entwurf-v2-production.ts`) | contract와 이미 출하된 socket/mailbox/native-push hands의 조립 | fresh launch, tmux placement, 프로젝트 정책 |
| tmux placement leaf (`mux-placement.ts`) | caller placement, same-session append, stable handle close | harness launch, identity, delivery |
| T1-a launch composition (`mux-launch.ts`) | 고정 runtime의 precondition 증명, 같은 session에 window+runtime 한 번의 mutation, 로컬 handle receipt | garden identity, record 조회, task delivery, supervision, 어떤 carrier도 |
| pi/ACP harness adapter | official runtime/session lifecycle, auth, model, transcript, record birth | 프로젝트의 작업자 선택·backlog |
| cwd classification leaf (`classify-tmux-cwd.ts`) | `-c` 후보의 분류 하나 — 4개 stable reason(absolute / `#` 없음 / 존재 / 디렉터리; tmux가 `-c`를 format-expand하고 없는 경로를 조용히 `$HOME`으로 폴백하기 때문) | argv, tmux 실행, hint 문구(각 consumer가 자기 표현을 소유), fallback 디렉터리 |
| resume-call composition (`mux-resume-call.ts`) | record가 준 cwd에서의 same-session append(`-c`) — 분류는 공유 leaf, "recorded cwd" hint 표현, launch receipt | garden identity, record 조회, lock, delivery, supervision |
| fresh-call composition (`mux-fresh-call.ts`) | backend별 fixed runtime + argv dialect, explicit model CLI token, optional **requested** cwd(caller가 유일한 출처; `undefined`/`""`만 생략, literal·no-trim, 같은 leaf로 pre-mutation 분류, resume 대칭 `-c` 위치), first-turn framing(callback→task 순서), nonce 민팅, launch receipt | garden identity(표면이 공급), cwd 추측·resolve, delivery transport, task 분해, supervision |
| copilot capability preflight leaf (`copilot-fresh-preflight.ts`) | Copilot fresh **한 건**에 대한 pre-mutation 판정 — birth·MCP hand·receiver·visible footer 네 축의 **설치/설정 사실**과 축마다 하나인 named reason + repair 문구 | runtime 사실(벤더 spawn·live process·연결 여부는 doctor와 LIVE 소유), mutation, 다른 backend, generic doctor로의 성장 |
| public surfaces (`entwurf-control.ts` · MCP `index.ts`) | fresh의 record-backed caller identity와 `{backend, model, task, cwd?}` schema, resume의 target-only schema, 양쪽 렌더, resume launch seam 조립 | argv 문법, placement, identity 민팅 |
| project policy (repo 밖) | 누구를·언제·무엇으로 부를지, fan-out 횟수, 실패 후 판단 | transport 내부 구현 |

강제 가능한 import 금지선은 넓은 일반론이 아니라 좁은 몇 줄이다. `entwurf-v2-production.ts`는 이미
delivery hands를 조립하는 composition root이므로 "core는 adapter를 전혀 import하지 않는다"고 말하지
않는다.

```text
entwurf-v2 contract/decider/runner/production  -X-> mux-placement
entwurf-v2 contract/decider/runner/production  -X-> mux-launch
mux-placement                                  -X-> entwurf core
mux-launch                                     -X-> entwurf core
mux-placement                                  -X-> mux-launch        (leaf는 혼자 삭제 가능해야 한다)
mux-launch                                      -> mux-placement
mux-fresh-call                                  -> mux-launch + mux-placement + classify-tmux-cwd + copilot-fresh-preflight
mux-resume-call                                 -> mux-launch + mux-placement + classify-tmux-cwd
classify-tmux-cwd                              -X-> 모든 mux/entwurf 모듈   (공유 분류 leaf; node 표준만 본다)
copilot-fresh-preflight                        -X-> 모든 mux/entwurf 모듈   (좁은 backend leaf; node 표준만 본다)
entwurf-v2-visible-resume                      -X-> mux-*            (launch는 표면이 주입하는 seam)
public surfaces                                 -> mux-resume-call + entwurf-v2-visible-resume  (composition root)
all other shipped production sources           -X-> mux-launch
```

`check-mux-launch`는 출하 source 전체(`pi-extensions/**` + `mcp/**`, build artifact 제외)를 스캔해
`mux-fresh-call.ts`와 `mux-resume-call.ts` **둘만** launch를 import하도록 강제하고(정확한 집합이며 `mux-*` 접두 규칙이 아니다 — 세 번째 모듈은 결정이어야 한다), delivery/core의 역의존을 금지한다.
`MUX-LAUNCH-CORE-IMPORT-FREE` mutant는 delivery production root에 금지 import를 심어 이 경계를 죽인다.

leaf가 T1-a composition에 여는 seam도 여기 적는다. `mux-placement.ts`는 세 동사 외에 `runTmux`와
`requireSameContext`를 export하는데, 이것은 **네 번째 동사도 public operator surface도 아니고 좁은 내부
seam**이다. 위험을 숨기지 않고 말하면: `runTmux`는 이 모듈이 작성하지 않은 argv를 그대로 받으므로 leaf의
GRAMMAR 경계가 그것을 지켜주지 않는다. 문법은 `build*Args` builder들이 지키고, `runTmux`에 손을 뻗는
쪽이 같은 검증을 스스로 져야 한다. 현재 `runTmux` production consumer는 launch·fresh-call·resume-call 세
composition이고, 각각 source-adjacent gate가 argv 경계를 진다. 출하 delivery 경로는 둘 다 호출하지 않는다.

## 12. Receipt와 supervision의 절단선

| 사실 | 현재 상태 | 경계 |
|---|---|---|
| control-socket send / mailbox enqueue / native injection | **현재 출하된 `entwurf_v2` receipt** | 호출 시 rail이 즉시 진술 |
| mailbox `lastReadAt` | 후속 evidence, **send receipt 아님** | self-fetch receiver가 나중에 읽은 사실 |
| window opened (`@window/%pane`) | **`entwurf_fresh_call`의 launch receipt로 출하됨** (§6-a) | tmux가 창을 만들었다는 사실까지. 실행 여부·delivery는 주장하지 않는다 |
| process spawned (`pane_pid`) | 같은 launch receipt에 포함 | 동기 로컬 사실이며, 그 process가 살아 있다는 주장은 아니다 (§5) |
| resume launch (`@window/%pane` + target gid + 재개하는 transcript) | **`entwurf_resume_call`의 첫 receipt로 출하됨** | tmux가 창을 만들고 pi 시작을 요청했다는 사실까지. 시민이 돌아왔다는 주장은 아니다 |
| resume observation (same-gid socket-alive 또는 `resume-unobserved`) | **`entwurf_resume_call`의 두 번째 receipt로 출하됨** | 시민이 다시 주소를 갖는다고 말하는 **유일한** 사실. launch와 절대 합치지 않는다. 미관측은 실패가 아니라 결과이며 창은 열린 채 lock은 해제된다 |
| launch가 동기 반환한 native session/garden identity | **없음** (§6 조건 1 불성립) | pi 0.83.0도 0.84.0도 제공하지 않는다(재실측). fresh-call도 동기로는 주지 않는다 |
| callback 메시지의 sender envelope이 실은 gardenId | **fresh-call의 correlation receipt** (§6-a) — 비동기, caller의 기존 수신면에 도착 | delivery 계층이 붙인 사실이며 sibling의 자기 진술이 아니다 (§6-b) |
| 사전 주입한 native token으로 조회한 gardenId | **CLOSED** — callback correlation이 대체한 폐기 후보 (§6) | 새 증거 + GLG 재승인 없이는 재개하지 않는다 |
| unknown record가 나타날 때까지 감시·추측 | 금지된 supervision | 시간에 걸친 발견·상관짓기 |
| peer stall/context/task outcome, retry·재배정 | Entwurf 밖 supervision | 프로젝트 정책 |

## 13. 영속 경계

- mux는 launch/visibility이지 delivery transport가 아니다.
- tmux handle은 garden address나 liveness fact가 아니다.
- pane text와 keystroke는 `entwurf_v2` receipt가 아니다.
- placement/driver가 agent identity, model policy, task routing, quota, orchestration을 소유하지 않는다. fresh-call은 caller가 이미 고른 model 한 값(그리고 선택 시 literal cwd 한 값)을 CLI/argv에 정확히 전달할 뿐이다.
- background/headless 최적화는 live/visible 실물이 선 뒤의 별도 선택이다.
- 모든 adapter는 삭제 조건을 가진다. 삭제 조건을 말할 수 없는 기능은 core 밖이다.
- 모델의 현재 버릇을 보정하는 구조(stall 감시, quota 인식, 자동 재배정, "누가 잘하는가" 기록)를 만들지
  않는다. 다음 모델/과금에서 함께 불탄다.
- Receipt에서 책임을 멈춘다. task outcome, 품질, 완료 시각, peer의 맥락·건강 상태는 Entwurf의 사실이
  아니다.
- 메타도구 자체를 고치는 일이 실제 위임보다 커지면 정지한다.

Tracker: [#47](https://github.com/junghan0611/entwurf/issues/47).
