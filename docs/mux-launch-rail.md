# mux launch rail — 먼저 같은 tmux session의 window를 다룬다

> **Status (2026-08-04): T0-a 완료.** 아직 production mux driver나 launch profile은 없다.
> tmux placement와 same-session window append는 2026-08-04에 raw CLI로 실측해 증명했고, 그 사실은
> §2–§3에 반영돼 있다. 다음 단계(T0-b)는 그 세 동작만 placement controller로 옮기는 것이다.
> 정확한 다음 행동은 active NEXT handoff가 진다.

## 1. 출발점

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
tmux 밖이라면 첫 버전은 추측하지 않고 거절한다.

단 `display-message`의 exit code는 존재 증거가 아니다. 없는 pane을 줘도 rc=0에 빈 출력이고, 빈
target은 rc=0으로 현재 pane에 조용히 fallback한다. 그러므로 inspect의 precondition은 세 겹이다.

```text
TMUX_PANE presence (missing/empty → reject)
query output non-empty
returned #{pane_id} == anchor  (exact string echo-back)
```

echo-back이 없으면 tmux 밖이나 잘못된 anchor에서 남의 pane을 집는다.

## 3. 지금 만들 것 — placement controller 하나

아래 시나리오는 2026-08-04 private tmux server에서 raw CLI로 증명했다. 다음 단계(T0-b)는 **그 명령
그대로** 세 동작만 TypeScript로 옮기는 것이다.

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

구현 범위:

```text
inspectPlacement()             → caller pane의 $session/@window/%pane 사실
appendWindow(placement)        → 같은 session 끝에 default shell window를 -d로 열고 @window/%pane 반환
closeWindow(windowHandle)      → 그 @window만 닫음
```

- caller-supplied command/cwd/env/window name/label은 받지 않는다.
- append는 현재 window를 바꾸지 않는다. focus/switch helper는 아직 없다.
- window 소멸 경로는 둘이고 같은 동사가 아니다. `remain-on-exit off`에서는 pane process가 끝나면
  window가 먼저 사라진다(runtime-owned natural exit). `closeWindow`는 살아 있는 window를 operator가
  명시적으로 정리하는 동작이다. 따라서 close 대상이 이미 없을 수 있다 — 이를 silent success로 볼지
  `alreadyGone` receipt로 볼지 error로 볼지는 T0-b에서 계약으로 정한다.
- outside tmux는 mutation 전에 fail-loud 한다.
- API 이름과 파일 배치는 raw 실측 뒤 가장 작은 모양으로 정하되, 세 동작을 늘리지 않는다.
- fake가 먼저 계약을 만들지 않는다. real tmux acceptance가 session/window topology를 직접 판정하고,
  deterministic gate가 필요하면 그 실측에서 확인한 parse/argv만 좁게 고정한다.

## 4. 지금 만들지 않을 것

- pi 또는 다른 harness 실행
- fresh citizen minting
- dormant citizen resume
- record birth/liveness 대기
- task delivery
- generic driver/registry 또는 labels/metadata
- caller-supplied command/cwd/env/window-name carrier
- raw PTY input 또는 capture/history API
- 모든 tmux session을 관리하는 registry
- zmx adapter, 설치, self-fetch, fallback
- release-gate MUST

즉 **tmux 제어가 먼저고 entwurf 연결은 그 뒤**다.

## 5. 나중의 시퀀스 — 방향만, 현재 구현 명세 아님

T0가 닫힌 뒤 별도 합의로 다음을 연다.

### Fresh

1. caller placement를 읽는다.
2. 같은 tmux session에 새 window를 append한다.
3. 그 window에서 interactive runtime을 연다.
4. native lifecycle이 record/garden id를 낳는다.
5. rail liveness를 확인한다.
6. task는 tmux 키 입력이 아니라 `entwurf_v2`로 보낸다.

### Resume

1. 기존 dormant citizen과 정확한 native session을 정한다.
2. caller의 같은 tmux session에 새 window를 append한다.
3. 그 window에서 native resume를 연다.
4. 같은 garden id가 다시 live인지 확인한다.
5. 후속 task는 `entwurf_v2`로 보낸다.

이 시퀀스는 placement primitive가 실물로 선 뒤 다시 검토한다. 현재 `spawn-bg`를 옆에서 감싸거나
public creation verb를 미리 정하지 않는다.

## 6. 폐기한 첫 시도에서 남길 사실

2026-08-02 첫 시도는 placement를 정하기 전에 `tmux new-session` 기반 generic driver와 fake gate부터
만들었다. 원하는 window 3/4가 아니라 별도 tmux session을 만드는 잘못된 단위였으므로 production 코드,
gate, LIVE smoke, release 배선을 전부 제거했다.

그 과정에서 tmux 자체 parser가 caller 값을 재해석한다는 사실도 실측했다.

- trailing `;`는 값을 자르고 뒤 argv를 tmux command로 실행할 수 있다.
- `new-session -c`는 tmux format을 확장한다. `#{...}`는 변형되고 `#(...)`는 command를 실행할 수 있다.

따라서 나중에 command surface를 열더라도 “shell을 안 썼으니 argv/cwd/env가 byte-exact”라고 가정하지
않는다. 그러나 지금 이 parser 전체를 위한 codec/guard를 만들지도 않는다. 먼저 실제로 필요한 tmux verb와
고정 launch shape를 정하고 그 좁은 경계만 실물로 증명한다.

## 7. 영속 경계

- mux는 launch/visibility이지 delivery transport가 아니다.
- tmux handle은 garden address나 liveness fact가 아니다.
- pane text와 keystroke는 `entwurf_v2` receipt가 아니다.
- driver가 agent identity, model selection, task routing, quota, orchestration을 소유하지 않는다.
- background/headless 최적화는 live/visible 실물이 선 뒤의 별도 선택이다.

Tracker: [#47](https://github.com/junghan0611/entwurf/issues/47).
