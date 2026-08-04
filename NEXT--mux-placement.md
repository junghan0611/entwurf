# NEXT — `mux-placement` M1 검수·검증 완료 — GLG commit 결정 대기

> 이 파일은 `mux-placement` 브랜치 전용 boot sector다. merge 전 삭제하고, 살아남을 사실만 durable docs/source로 승격한다.

# NOW

- Branch: `mux-placement`, base `3b2bac1` (`v0.13.1`, `origin/main`).
- **T0-a accepted (2026-08-04).** raw tmux placement 실측이 끝났고 durable fact는 `docs/mux-launch-rail.md` §2/§3으로 승격했다.
- mux production 구현은 여전히 **0**. TypeScript 한 줄도 안 썼다.
- dirty diff = M1 경계 묶음(`tmux-live`를 v2 delivery contract에서 제거 + gate + mutant + 문서).
- Blocker: 없음. commit은 GLG 결정 대기.

# T0-a 증거 (2026-08-04, accepted)

private server `/run/user/1000/mux-t0a.sock` pid 76782, real server는 `/tmp/tmux-1000/default` pid 8150.

```text
S0  $0 t0a  1:@0(%0,76783,active)  2:@1(%1,76796)
S1  append → 3:@2(%2,76957)         active 불변
S2  append → 4:@3(%3,76966)         active 불변
S3  HUP(76957) → @2 window 자동 소멸 → 1,2,4
S4  kill-window -t '@3'             → 1,2 복구
전 구간 session 정확히 1
```

- 원본 pane_pid 76783/76796 불변, `#{window_active}` 불변, `@window/%pane` stable.
- real server BEFORE/AFTER `list-sessions` + `list-panes -a` diff 공집합 (11 sessions / 14 panes).
- cleanup 후 `list-sessions` rc=1, socket 파일 제거됨.
- `./run.sh check-entwurf-v2-contract` → 336 assertions passed.

관측 사실 (docs로 승격 완료):

- `renumber-windows on`에서 index는 재배열된다. `@window`는 불변.
- `display-message`는 없는 pane에 rc=0/빈 출력, 빈 target에 rc=0/현재 pane fallback. echo-back 검증이 load-bearing.
- `remain-on-exit off`에서 process 종료가 window를 먼저 제거한다. natural exit와 explicit close는 별개 lifecycle.
- interactive bash는 SIGTERM을 무시하고 SIGHUP에서 끝난다. (fixture 사실, docs에는 안 넣음)
- `base-index` 변경은 소급되지 않아 fixture에서 `move-window`가 필요했다. (setup 상세, docs에는 안 넣음)

실행 프로토콜 결함 2개 — 이번 관측은 오염되지 않았으나 다음 실측에서 고친다:

- fixture window에 `-n w1/w2` 이름을 붙였다. append 대상에는 안 붙였다.
- socket이 `$$` 없는 고정 경로였고 absent preflight / EXIT trap이 없었다.

# EXACT NEXT — GLG의 commit 결정

M1 검수와 검증은 끝났다. **exact next는 GLG가 boundary commit 하나를 승인하거나 수정 지시를 주는 것**이다. 그 전까지 아무것도 시작하지 않는다.

M1 묶음: `tmux-live`를 `ENTWURF_V2_TRANSPORTS`/`DispatchVerdict`에서 제거, `[QK:V2-DELIVERY-EXCLUDES-MUX]` gate, mutant lane `mux-boundary`, 문서 경계 정리 + T0-a 반영분. 승인되면 boundary commit **하나**로 묶는다. commit/push는 GLG 결정이다.

## 검증 완료 증거 (2026-08-04)

contract/gate를 바꾼 묶음이라 focused gate 하나로는 commit 대기 상태가 되지 않는다. 아래 순서를 전부 실행했고 전부 green이다.

```text
git diff --check                          rc=0
./run.sh check-entwurf-v2-contract        336 assertions passed
./run.sh check-gate-qualification         [gate-qualification] ok  (V2-DELIVERY-EXCLUDES-MUX 포함)
pnpm check                                exit 0, [check-pack] 310 files, invariants pass
```

3·4는 tmux 세션으로 돌려 dead status 0을 확인했다. 로그의 `SURVIVED|WRONG-REASON|CONTROL-RED|MUTANT-STALE|MULTI-MATCH|HANG` 15건은 qualification self-test의 서술 문장이지 실제 verdict가 아니다.

**source/doc가 다시 바뀌지 않으면 재실행하지 않는다.** 바뀌면 위 순서를 그대로 다시 돌린다. 30초 넘는 명령은 tmux로 돌리고, 실패하면 원인에서 멈추고 최소 수선 1회까지만 한다.

# STOP LINE

M1이 닫히기 전에는 아래를 시작하지 않는다.

- `inspectPlacement / appendWindow / closeWindow` TypeScript 구현
- 새 gate, 새 mutant 추가, LIVE smoke, `run.sh`/`pnpm check` **배선 변경**
- pi/ACP/harness launch profile, command/cwd/env/name/label carrier
- garden id mint, record/liveness, spawn/resume, delivery receipt
- generic `MuxDriver`/registry, input/capture/history, zmx
- push, release

# AFTER M1 — T0-b

세 동작만 가장 얇은 production shape로 옮긴다.

```text
inspectPlacement()      TMUX_PANE presence + non-empty + exact pane-id echo-back
appendWindow(placement) new-window -d -a -t '<session>:{end}', carrier 없음
closeWindow(@window)    @window id로만 지정; absent 처리 방식을 계약으로 결정
```

real-tmux acceptance가 topology를 직접 판정한다. fake가 먼저 계약을 만들지 않는다.

# RECENT

- 2026-08-04: T0-a 실측 완료·accepted. R1(`display-message` rc=0 함정)과 index renumber 사실을 docs §2/§3으로 승격했다.
- 2026-08-03: dirty mux 정리 묶음을 main에서 `mux-placement` 브랜치로 이동했다.
- 2026-08-02: placement 없이 별도 tmux session을 만들던 첫 구현을 전부 폐기했다. tmux-first이며 zmx는 optional later다.
