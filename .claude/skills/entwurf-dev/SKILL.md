---
name: entwurf-dev
description: "Drive the current entwurf development surface for GLG: list garden citizens, open a fresh visible Pi or Claude Code sibling, correlate its nonce callback to the exact garden id, send/reply through entwurf_v2, and walk the fresh→send→close→dormant boundary without making GLG spell out tool calls. Use when GLG says 분신 열어, 새 형제, entwurf 써보자, 피어 보여줘, 메시지 보내, callback 확인, 개발 투어, or /skill:entwurf-dev."
user_invocable: true
---

# entwurf-dev — 개발 중인 제품을 GLG가 직접 겪는 손

Repository: `~/repos/gh/entwurf`.

이 스킬은 GLG에게 명령문을 외우게 하지 않는다. GLG가 자연어로 의도를 말하면
에이전트가 현재 세션의 native `entwurf_*` tool을 호출하고, 각 receipt의 뜻과 다음
관측 지점을 짧게 설명한다. 형제는 disposable worker가 아니라 별도 runtime과
transcript를 가진 garden citizen이다.

## 호출 예

```text
/skill:entwurf-dev status
/skill:entwurf-dev fresh pi openai-codex/gpt-5.6-terra 오늘 S0 상태를 한 문장으로 말해
/skill:entwurf-dev fresh claude-code claude-sonnet-5 README의 visible-first 계약을 읽어
/skill:entwurf-dev send <garden-id> 지금 상태를 답해줘
/skill:entwurf-dev tour pi
/skill:entwurf-dev boundary
```

자연어도 같은 뜻이다.

```text
분신 하나 보이게 열어줘
새 Pi 형제를 열고 callback 뒤 인사까지 보내줘
살아 있는 Claude Code에게 이 메시지 전달해줘
지금 내가 직접 시험할 수 있는 경계를 보여줘
```

## 시작 전 runtime guard

호출된 tool schema가 worktree 문서보다 우선한다. 이 스킬은 현재 S0 계약에 맞는다.

- `entwurf_fresh_call` backend는 정확히 `pi | claude-code`이고 model은 required다.
- 기본 정책은 Pi=`openai-codex/gpt-5.6-terra`, Claude Code=`claude-sonnet-5`다.
- GLG가 “entwurf 소넷”이라고 하면 Pi + `entwurf/claude-sonnet-5`다.
- `entwurf_v2` intent는 정확히 `fire-and-forget` 하나다.
- `entwurf_peers`는 사실 조회이며 생성·재개 명령이 아니다.
- shipped resume verb는 없다.

활성 tool schema가 `owned-outcome`을 노출하거나, `entwurf_fresh_call`이 없거나, fresh-call의
required `model` 필드가 없다면 **아무 launch/send도 하지 말고** “옛 extension이 로드됐다.
Pi control session을 다시 열어야 한다”고 보고한다. `owned-outcome`은 절대 호출하지 않는다. worktree를 읽고
active runtime이 새 버전이라고 추정하지 않는다.

코드와 문구가 충돌하면 다음 source를 읽고 멈춰서 drift를 보고한다.

1. `pi-extensions/lib/mux-fresh-call.ts` — backend, callback, launch receipt
2. `pi-extensions/lib/entwurf-v2-contract.ts` — intent와 dormant verdict
3. `pi-extensions/entwurf-control.ts` — native Pi tool schema
4. `mcp/entwurf-bridge/src/index.ts` — MCP surface

## 명령 해석

### `status` / “누가 살아 있어?”

1. `entwurf_peers`를 호출한다.
2. 최근 관련 citizen만 backend와 liveness 기준으로 요약한다.
3. `alive`는 지금 전달 가능하다는 사실, `dead`는 dormant라는 사실일 뿐이라고 말한다.
4. `unsupported`를 dead로 읽지 않는다. Claude Code self-fetch와 Antigravity
   native-push는 control-socket 밖의 별도 rail이다.
5. dead row에 메시지를 보내거나 재개를 시도하지 않는다.

### `fresh <backend> [model] <task>` / “새 형제 열어줘”

1. backend가 생략되면 문맥상 명확한 경우에만 선택한다. 불명확하면 `pi`와
   `claude-code` 중 무엇을 열지 한 번만 묻는다.
2. model이 생략되면 묻지 않고 backend 기본 정책을 적용한다: Pi는
   `openai-codex/gpt-5.6-terra`, Claude Code는 `claude-sonnet-5`.
   - “sol/terra/luna” → Pi `openai-codex/gpt-5.6-<tier>`
   - “entwurf 소넷” → Pi `entwurf/claude-sonnet-5`
   - “클로드코드 소넷” → Claude Code `claude-sonnet-5`
   - 그 밖의 model은 GLG가 말한 canonical id/alias를 그대로 쓴다. provider를 추측하지 않는다.
3. task가 생략되면 다음처럼 작고 관측 가능한 기본 task를 쓴다.

   ```text
   callback을 마친 뒤, 자신이 지금 보이는 새 형제로 열렸다는 사실과 현재 cwd를 한 문장으로 보고하고 대기해.
   ```

4. task에 secret, token, credential, private payload를 넣지 않는다. model과 task는 같은 사용자
   프로세스가 볼 수 있는 launch argv에 실린다.
5. `entwurf_fresh_call`을 `{backend, model, task}`로 정확히 한 번 호출한다. 실패나 callback 지연을 이유로 자동
   재시도하지 않는다.
6. receipt의 model은 runtime CLI에 요청한 값만 증명한다. 실제 선택/turn 완료 증거로 읽지 않는다.
7. 반환값을 **launch receipt**로만 설명한다. window/pane과 nonce는 “창을 열도록
   tmux에 요청했다”는 증거이며 runtime 시작, 첫 turn, callback, task 완료 증거가 아니다.
8. receipt의 nonce를 현재 대화의 pending correlation으로 보존하고 callback을 기다린다.
   polling, transcript grep, newest-peer 추측을 하지 않는다. 창은 보이므로 callback이
   없으면 GLG가 직접 창을 관측할 수 있다고 말한다.

### callback 수신

fresh-call 뒤 inbound message가 오면:

1. message body가 pending nonce와 **완전히 동일한지** 확인한다.
2. 정확히 일치할 때만 callback으로 인정한다.
3. target garden id는 callback의 `<sender_info>.sessionId`에서 읽는다. sibling이 본문으로
   주장한 ID, 환경변수, peer 최신순, tmux handle로 대신하지 않는다.
4. nonce, launch receipt, callback sender envelope를 서로 다른 receipt로 유지한다.
5. 사용자가 `tour`, “인사까지”, “callback 뒤 보내줘”를 요청했다면 묻지 말고 즉시 그
   garden id에 아래 `send` 절차를 한 번 수행한다. 단순 `fresh`였다면 garden id와 가능한
   다음 행동만 보고한다.

callback이 없거나 nonce가 다르면 target을 추측하지 않는다.

### `send <target> <message>` / `reply <target> <message>`

1. target garden id가 명시되지 않았지만 이 대화에서 exact nonce callback으로 방금
   확정한 형제가 하나뿐이면 그 id를 사용한다. 둘 이상이면 묻는다.
2. `latest`, backend 이름, window id만으로 garden id를 추측하지 않는다.
3. `entwurf_v2`를 다음 고정 계약으로 호출한다.

   ```text
   intent: fire-and-forget
   wants_reply: 사용자가 답을 원하면 true, 아니면 false
   message: 사용자의 실제 메시지
   mode: 사용자가 명시할 때만 steer 또는 follow_up
   ```

4. receipt가 `delivered`인지 `rejected`인지 그대로 말한다. `wants_reply`는 etiquette이며
   기다림이나 turn 완료를 보장하지 않는다.
5. mailbox enqueue를 read/turn 완료라고 말하지 않고, native-push injection을 mailbox라고
   말하지 않는다.

### `tour pi` / “Pi 전체 흐름 보여줘”

에이전트가 tool call을 맡고 GLG는 창을 본다.

1. visible fresh Pi를 `openai-codex/gpt-5.6-terra`와 기본 task로 연다. GLG가 다른 model을 말했으면 그 값을 쓴다.
2. exact nonce callback에서 garden id를 얻는다.
3. 자동으로 다음 메시지를 `wants_reply=true`로 한 번 보낸다.

   ```text
   entwurf-dev live handshake: 이 메시지를 받은 rail과 현재 맡은 task를 한 문장으로 답해줘.
   ```

4. launch receipt / callback identity / live delivery receipt를 세 줄로 분리해 보고한다.
5. 그 뒤 GLG에게 visible window를 직접 닫아 보라고 안내한다. 에이전트가 raw tmux
   command로 operator window를 닫지 않는다.
6. GLG가 “닫았어”라고 하면 `entwurf_peers`로 같은 garden id의 dead/dormant 사실을
   확인한다.
7. GLG가 reject까지 보길 원하면 그 id에 평범한 `fire-and-forget`을 한 번 보내고
   `dormant-fire-forget-unsupported`를 관측한다. 이 호출은 프로세스를 시작하지 않는다.
8. 여기서 멈춘다. visible same-id resume은 S1 전에는 없다.

### `tour claude-code`

1. visible fresh Claude Code를 `claude-sonnet-5`로 연다. GLG가 다른 model을 말했으면 그 값을 쓴다.
2. exact nonce callback에서 garden id를 얻는다.
3. live handshake를 `wants_reply=true`로 한 번 보낸다.
4. launch / callback / mailbox delivery receipt를 분리한다.
5. mailbox enqueue만 확인됐으면 Claude가 읽었다거나 turn을 마쳤다고 과장하지 않는다.
6. Claude Code에는 resume authority가 없다고 명시한다.

### `boundary` / “지금 어디까지 돼?”

현재 제품 경계를 다음처럼 답한다.

```text
가능: explicit model로 visible fresh Pi/Claude Code → exact callback garden id → live delivery
가능: Pi window close → peers에서 dormant 확인 → honest reject 관측
불가: dormant citizen 자동 재개
불가: visible same-id resume (S1 미착수)
금지: hidden/background fallback, owned-outcome, transcript/peer 추측 correlation
```

## receipt 언어

항상 다음 네 축을 섞지 않는다.

| receipt | 증명하는 것 | 증명하지 않는 것 |
|---|---|---|
| launch | tmux가 반환한 window/pane 좌표, 요청 model, nonce | runtime의 model 수락/turn/task 성공 |
| callback | exact nonce를 보낸 sender garden id | placement |
| delivery | 선택된 rail이 메시지를 받아들였거나 거절함 | 상대 turn 완료 |
| reply | 상대가 별도 메시지로 답함 | 이전 receipt의 소급 강화 |

`✓ delivered`를 reply나 task completion으로 번역하지 않는다.

## 안전·정지 규칙

- GLG가 이 스킬을 호출하거나 자연어로 형제 열기/메시지 전달을 요청한 것이 entwurf
  사용에 대한 명시적 승인이다. 그 범위를 넘어 다른 형제를 임의로 열지 않는다.
- fresh-call은 한 요청당 한 형제다. batch, retry loop, watcher, supervisor를 만들지 않는다.
- dead/dormant citizen은 unreachable이다. appearing in peers is not an invitation to dispatch.
- callback을 기다린다는 이유로 polling하거나 private transcript를 읽지 않는다.
- raw tmux screen text와 `send-keys`를 delivery/identity 증거로 쓰지 않는다.
- commit, push, release 권한을 이 스킬 호출에서 추론하지 않는다.
- 어떤 reject도 success로 포장하지 않는다.
