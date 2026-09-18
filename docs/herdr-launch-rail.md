# herdr launch rail

> 이 문서는 **herdr 안에서 형제를 여는 레일**을 소유한다. tmux 레일은 [`mux-launch-rail.md`](./mux-launch-rail.md)가 그대로 소유하고, 두 문서는 합쳐지지 않는다 — 좌표도 실패 모양도 다르기 때문이다.
> 대상: `pi-extensions/lib/herdr-fresh-call.ts` (#116 S2-c1). 측정 환경: herdr 0.9.0 / socket protocol 22, oracle — 2026-09-14, 배치 정책 교체분은 2026-09-15. herdr 소스 인용은 전부 `@ c77af189` 고정본이다.
> `[재측정 2026-09-17, oracle, herdr 0.9.1]` 공급 핀이 0.9.1로 올라갔다(`scripts/fixtures/herdr-supply.json`). 이 문서의 payload 리터럴은 **재기록하지 않았다** — 0.9.1에서 바뀐 관측은 셋뿐이고 전부 이 레일 밖이거나 무해하다: `herdr status client`의 `protocol: 22` 그대로, `check-herdr-sandbox` 11 assertions green(같은 argv·같은 응답 모양), `integration status`가 행 하나를 더한다(17→18, 추가분은 `letta (experimental)` 하나뿐이고 나머지 17행은 바이트 동일). 0.9.1 바이너리는 digest로 받아 temp에서 실행했고 오퍼레이터 설치본은 건드리지 않았다.

## 1. 이 레일이 무엇을 나누어 갖는가

| | herdr | entwurf |
|---|---|---|
| workspace·tab·pane 배치와 레이아웃 | **소유** | 어느 workspace에 tab 하나를 열어달라고만 말한다 |
| 에이전트 기동(`agent start`) | **소유** | 무엇을 띄워달라고 할지만 말한다 |
| 첫 턴 프레이밍·nonce | — | **소유** |
| garden id·주소·배달·거절 | — | **소유** |

예쁜 작업대와 공구함은 herdr 것이고, 드라이버가 우리 것이다. 이 레일은 그 경계를 코드로 옮긴 것이다.

## 2. 두 걸음이라는 사실, 그리고 그것이 깨는 불변

tmux 레일은 `new-window` 한 번이라 "위의 어떤 것도 창을 남기지 않는다"(`mux-fresh-call.ts:527-531`)가 성립한다. herdr는 **두 걸음**이다:

```text
tab create  →  (tab과 그 initial pane이 이미 존재)  →  agent start  →  실패할 수 있다
```

그래서 이 레일의 순서 논증은 다르게 쓰여 있다: **결정 가능한 모든 것을 `tab create` 앞으로 옮긴다.** context·backend·tmux seat 입력·caller id·task·model·cwd·인코딩된 argv의 제어문자까지 전부 pre-mutation 거절이고, 그 뒤로 살아남는 실패는 **herdr 자신의 실패뿐**이다.

그 사이에 **읽기가 하나** 있다(§5의 `pane get`). 읽기는 아무것도 만들지 않으므로 이 사실을 흐리지 않는다: 거절 목록 맨 뒤에 두어, 어차피 거절될 호출이 herdr CLI에 닿지 않게 한다.

## 3. 옵션 G — 여러 줄 프레이밍을 한 물리행으로

### 막은 것

`[file:line @ c77af189]` `src/app/agents.rs:157-162`은 인자에 **유니코드 제어문자가 하나라도** 있으면 pane을 조회하기도 전에 거절한다:

```rust
if params.args.iter().any(|arg| arg.chars().any(char::is_control)) { InvalidArgument }
```

`[측정 2026-09-14, 변이 0]` 존재하지 않는 pane으로 두 번 불러 순서까지 확인했다 — 여러 줄 인자는 `invalid_agent_argument`, 한 줄 인자는 `agent_pane_not_found`. 우리 프레이밍은 계약상 여러 줄이고 caller의 task도 흔히 여러 줄이다.

### 먼저 재보고 버린 통로 셋

- **메일함 배달**(빈 형제를 먼저 띄우고 프레이밍을 배달): `[측정]` claude 형제가 읽고 수신 확인까지 남긴 뒤 **거부**했다. 출생 주장·nonce·검증금지 문구를 전부 걷어낸 정중한 요청으로 다시 재도 **또 거부**했고, 이유는 문구가 아니라 **권한**이었다 — 방금 빈 채로 태어난 세션에는 검증할 맥락이 없다. 이 거부는 고칠 버그가 아니라 지킬 성질이다.
- **키 입력**(`agent prompt`): 터미널 입력이다. 이 제품은 형제를 키 입력으로 열지 않는다. `[측정 2026-09-18]` 그 verb가 실제로 무엇을 쓰는지는 §14가 벤더 소스로 잰다 — 2단계 기동 제안이 그 측정으로 닫혔다. **이 문장은 이제 게이트가 진다**: `check-typing-call-fence`가 `pi-extensions/`·`mcp/`의 프로덕션 소스를 코드만 남기고 훑어 타이핑 호출 이름을 찾는다 — 이 레일은 인자와 편지를 짓지 키 입력을 짓지 않으며, **타이핑 호출이 생긴 모듈은 이름으로 거절된다**. 산문은 면제다(규칙을 적은 문장이 곧 그 이름을 담으므로, 산문까지 읽는 스캐너는 자기 법을 지우게 만든다).
- **벤더 확장 디코더**: omp에는 선례가 있지만 claude-code에는 없다. 파일럿은 `pi | claude-code`다.

### 채택한 모양

프레이밍 **전체**를 JSON 문자열 리터럴 하나로 감싸, 그것을 디코드하라는 **한 문장** 뒤에 붙인다.

```text
Decode the following JSON string literal and follow the decoded instructions exactly as if they were this message: "You are a fresh visible citizen that entwurf opened in a new herdr tab.\n\nFIRST ACTION, …"
```

- **`JSON.stringify`만으로는 부족하다.** 그것은 C0와 따옴표·역슬래시만 이스케이프하고 **DEL(U+007F)과 C1 블록(U+0080–U+009F)은 리터럴로 남긴다.** 그래서 그 뒤에 남은 `\p{Cc}`를 `\uXXXX`로 되돌릴 수 있게 한 번 더 이스케이프한다.
- **전송이 바이트를 정규화하지 않는다.** 인코더는 개행 접기도 유니코드 정규화도 하지 않고, 자기 출력이 원본으로 정확히 디코드되는지 확인한 뒤 아니면 **던진다** — 재현할 수 없는 프레이밍으로 형제를 태우지 않는다. `[정확히 말하면]` 그 "원본"은 **공개 입력 계약을 통과한 뒤의 문자열**이다: model과 task는 두 레일 공통으로 **trim된다**(공백뿐인 task는 `task-empty`). trim이 launch 전체에서 유일한 정규화이고, 그 뒤로는 전송이 바이트를 건드리지 않는다.
- **호출 전에 `\p{Cc}` 0개를 증명한다.** 프롬프트만이 아니라 `agent start`에 넘길 **모든 인자**를 검사한다(서버도 모든 인자를 본다). 실패는 `herdr-argv-control-character` — `tab create` 이전이라 **고아 tab이 남지 않는다**.
- `[측정 2026-09-14, 두 파일럿]` 형제는 디코드하고 **콜백을 먼저** 보낸 뒤 과제에 답했다. 인코딩이 "콜백이 첫 행동"이라는 계약을 삼키지 않았다.

## 4. identity — 무엇이 무엇을 증명하는가

세 영수증은 **서로 다른 것**을 증명하고, 어느 하나도 다른 하나의 fallback이 아니다.

| 영수증 | 누가 | 무엇을 증명하나 |
|---|---|---|
| herdr `agent_started`의 direct witness | 호출자 | 무엇이 어디에 기동됐는가 (**launch 증거**) |
| exact-one V3 레코드 | 레코드 저장소 | 그 native session의 **주소** |
| nonce 콜백의 sender envelope | 형제 | 형제가 **첫 모델 행동**을 했다 |

`[측정 2026-09-14]` direct witness는 `agent start` 응답이 돌아오기 **전에** 이미 레코드가 존재하는 시점에 온다(claude 레코드 09:41:47 < 응답 09:41:48, pi 09:42:09 < 09:42:16) — watcher도 retry도 필요 없는 1회 조회다.

**그러나 이 모듈은 레코드를 읽지 않는다.** launch receipt에는 garden id도 native session id도 없다. 주소를 말하는 것은 레코드이고, 그 조회는 이 레일 밖(표면, c2)에서 일어난다. `[미검증 잔여]` "레코드가 아직 없는 순간"은 표본 2개 + 구조 논거일 뿐 herdr의 보장이 아니다. 이 레인은 direct witness를 공개 주소로 승격하지 않았다: `fresh-call-dispatch`는 레코드를 읽지 않고, 두 공개 표면의 주소 경로는 nonce 콜백으로 남는다. 따라서 이 미측정 칸은 dispatch fallback이나 재읽기 계약이 아니다.

## 5. 배치 정책 — 하나뿐이다

```text
pane get <HERDR_PANE_ID>                        # 읽기. 아무것도 만들지 않는다
tab create --workspace <그 응답의 workspace_id> --no-focus [--cwd <literal>] --env PI_SESSION_ID= --env PI_AGENT_ID=
```

`[결정 GLG direct 2026-09-15]` 새 형제는 **caller와 같은 workspace의 새 tab**으로 연다. 이전 정책은 caller pane을 아래로 split하는 것이었고, `[GLG 직접 관측 2026-09-15]` 그것도 실제로 동작했지만 쓰기에는 새 tab이 편했다. 바뀐 것은 배치 한 줄이고, `--no-focus`도 경계도 그대로다.

- **workspace는 herdr가 말해준다.** caller pane(`HERDR_PANE_ID`)을 `pane get`으로 물어 그 응답의 `workspace_id`를 쓴다. `w<N>:p<M>`의 앞자리를 떼어 쓰지 않는다 — `[측정 2026-09-14]` pane id는 불투명 문자열이고(열 번째가 `w7:pA`), `[측정 2026-09-14]` 워크스페이스 이동에서 좌표 자체가 바뀐다. 읽기는 아무것도 만들지 않으므로 이 네 실패는 전부 **pre-mutation 거절**이다: `herdr-caller-pane-get-failed` · `herdr-caller-pane-unparsable` · `herdr-caller-pane-drift` · `herdr-caller-workspace-missing`. `HERDR_PANE_ID` 자체가 없으면 `herdr-caller-pane-missing`.
- **그 응답은 우리가 물은 pane에 결속된다.** `[교차검수 2026-09-15, Blocker]` 읽을 수 있는데 **다른 pane**을 답하면 그 pane의 workspace는 caller가 어디 있는지에 대한 증거가 아니다. 그것을 믿으면 caller가 지목하지 않은 workspace에 초록 영수증과 함께 형제가 열린다 — `--workspace` 생략과 정확히 같은 silent relocation이 argv가 아니라 **읽기를 통해** 들어오는 것이다. 그래서 `unparsable`로 뭉개지 않고 `herdr-caller-pane-drift`로 이름 붙여 거절한다.
- **`--workspace`는 생략 가능한 옵션이 아니다.** `[측정 2026-09-15, 격리 private 서버]` 생략해도 `tab create`는 **성공한다** — herdr가 그때 focus된 workspace에 tab을 만든다. caller가 요청하지 않은 자리에 초록 영수증과 함께 형제가 열리는 것이고, 이 레일이 `placement:{tmuxSession}`을 거절하는 이유와 정확히 같은 모양이다. 그래서 workspace를 못 읽으면 기본값으로 넘어가지 않고 **거절한다**.
- `[측정 2026-09-15]` 모르는 workspace는 아무것도 만들기 전에 거절된다(`{"error":{"code":"workspace_not_found"}}`, exit 1). 그래서 두 걸음은 여전히 **두 걸음**이지 세 걸음이 아니다.
- `[측정 2026-09-15]` `tab create` 응답은 새 tab과 **그 initial pane을 한 번에** 준다:
  `{"id":"cli:tab:create","result":{"root_pane":{…pane_id·terminal_id·tab_id·workspace_id…},"tab":{…tab_id·workspace_id·pane_count…},"type":"tab_created"}}`. `agent start`는 그 정확한 `root_pane`에 한다 — `pane list`를 diff해 "새로 생긴 것"을 고르지 않는다.
- **두 절반은 같은 tab과 같은 workspace를 말해야 하고, 둘 다 말해야 한다.** `[측정 2026-09-15]` 모든 `tab_created` 응답이 `tab_id`와 `workspace_id`를 tab에도 root_pane에도 실어 보냈다. 그래서 **없는 것은 선택이 아니라 불일치다** — 한 번만 이름을 대는 응답은 자기 자신과 대조할 수 없고, 그것을 받아들이면 receipt가 가리키는 tab과 에이전트가 실제로 뜬 tab이 갈린 채 초록이 난다. `[교차검수 2026-09-15, Blocker]` 이전 판은 `root_pane.tab_id`가 **있을 때만** 대조하고 `workspace_id`는 아예 대조하지 않았다. 지금은 둘 다 필수·정확 일치이고, 어긋나거나 없으면 **payload 전체를 거절한다**.
- `[측정 2026-09-15]` `--no-focus`는 지켜진다: 응답의 `root_pane.focused`와 `tab.focused`가 둘 다 `false`이고 기존 focus pane은 그대로였다. 오퍼레이터의 키보드를 뺏지 않는다.
- `[측정 2026-09-15]` `--cwd`는 그대로 실린다. 다만 **없는 디렉토리를 줘도 herdr는 실패하지 않고** 서버 자신의 cwd로 조용히 떨어진다 — 그래서 존재 검사 셋(`cwd-not-absolute`/`cwd-missing`/`cwd-not-directory`)은 이 verb에서 오히려 더 필요하다. tmux 레일의 `#` 거절은 여기서 이유가 거짓이므로 가져오지 않는다.
- `[측정 2026-09-15]` **신원 스크럽이 상속을 이긴다.** 서버 env에 `PI_SESSION_ID`를 일부러 오염시켜 둔 상태에서 `tab create --env PI_SESSION_ID= --env PI_AGENT_ID=`로 연 tab의 프로세스는 `/proc/<pid>/environ`에서 둘 다 **빈 값**이었다(마커 변수로 그 프로세스를 특정했다). 화면이 아니라 커널이 준 증거다. `--env KEY=`는 키를 지우는 게 아니라 빈 값을 주입하고, 반복이 문법이다.
- **레이아웃 매니저를 만들지 않는다.** `--label`도 `--ratio`도 `--direction`도 싣지 않는다. 새 공개 placement/layout 선택축은 없다. 다른 배치를 원하면 herdr에서 tab을 옮기면 된다. 레이아웃은 herdr 것이다.

## 6. 이름과 좌표

- **agent name**: `entwurf-<sha256(nonce) 앞 20자>`. `[file:line @ c77af189]` `src/app/agents.rs:15-20`이 `[a-z][a-z0-9_-]{0,31}`을 요구하는데 nonce 자체(39자)는 통과하지 못한다. 이름은 **역할도 제목도 주소도 아니다** — `herdr agent list`를 읽는 사람이 알게 되는 것은 "entwurf가 열었다"뿐이다.
- **pane id는 불투명 문자열이다.** `[측정 2026-09-14]` 열 번째 pane은 `w7:p10`이 아니라 **`w7:pA`**로 왔다. 10진수를 가정하는 파서는 이미 틀렸다.
- **pane id는 형제의 수명 동안 안정적이지도 않다.** `[측정]` 워크스페이스 이동에서 `w7:p3` → `w8:p2`로 바뀌었고 그 아래 세션은 그대로였다. 그래서 좌표는 **저장하지 않고** 필요할 때마다 다시 읽는다.

## 7. 고아 회수 — 세대 안에서만 증명된다, 그리고 tab이 아니라 pane으로

`[측정 2026-09-14, 격리 샌드박스 서버]` `herdr server stop` → 재기동에서 **같은 pane id 셋이 전부 다른 terminal_id에 다시 묶였다**(`w1:p1/p2/p3`, `term_65b6d90e…` → `term_65b6d916…`).

두 가지가 따라온다:

1. **bare pane id는 무엇을 닫을 권위도 아니다.** `[file:line @ c77af189]` `src/api/schema/common.rs:33-36` — `close_pane`은 `pane_id`만 받고 기대 terminal 토큰을 받지 않는다.
2. **`terminal_id`도 세대를 넘지 못한다.** 그러므로 계약 문장은 *"terminal_id가 소유를 증명한다"*가 아니라 **"한 서버 세대 안에서 증명한다"**이다. 재기동 뒤의 낡은 영수증은 **항상** 불일치로 떨어지고, 그것이 안전한 방향이다.

### tab을 만들었는데 왜 pane을 닫는가 `[측정 2026-09-15, 격리 private 서버]`

배치가 tab으로 바뀌었으니 회수도 `tab close`여야 할 것 같지만, 재보니 반대였다.

- **`tab close`는 우리가 가진 것보다 큰 권위다.** `tab_id` 하나만 받고 기대 토큰이 없다 — pane과 같은 문제인데 대상은 더 넓다. `[측정]` **에이전트가 돌고 있는 tab을 그대로 닫고** `{"result":{"type":"ok"}}`를 돌려줬다. 우리 tab에 누군가 pane을 하나 붙여 놨다면 그 사람 것까지 같이 닫는다.
- **우리가 만든 pane 하나를 닫는 것으로 충분하다.** `[측정]` tab의 **유일한** pane을 `pane close` 하면 tab도 같이 사라진다(`tab get` → `tab_not_found`, 빈 tab 잔여 0). `[측정]` pane이 둘인 tab에서 우리 것만 닫으면 **tab과 남의 pane은 살아남는다**(`pane_count` 2→1).

두 방향 모두 fail-closed이고, 증명은 이미 가지고 있던 그 증명(pane id + terminal_id + agent_session 없음)이다. 그래서 **회수 계약은 한 줄도 바꾸지 않았다.** 바뀐 것은 그 계약이 무엇을 회수하는지에 대한 측정된 설명뿐이다.

회수 절차: 새 `pane get` → **pane id 일치 AND terminal_id 일치 AND agent_session 없음**일 때만 `pane close` 한 번.

### 무엇이 존재하는가 — 회수보다 먼저 답해야 하는 질문 `[교차검수 2026-09-15, Defect]`

`herdr-tab-create-failed`는 "아무것도 안 생겼다"를 **단정할 수 없다.** `createHerdrRunner`는 자기 timeout/kill/spawn 실패도 herdr의 실패와 **같은 nonzero status**로 돌려주고, 그때 stderr는 herdr의 JSON 봉투가 아니라 우리 평문이다. 죽인 `tab create`가 이미 tab을 만들었을 수 있다.

그래서 stderr가 판별자다: **herdr 자신의 error 봉투가 있으면** herdr가 답한 것이고 만들기 전에 거절했다 → `none`. **봉투가 없으면** herdr에게 들은 바가 없다 → `unknown`. status 0인데 못 읽은 응답도 `unknown`이다.

이전 판은 둘 다 `orphan-unreclaimed:pane-get-failed`(빈 pane id)로 찍었다 — `pane get`을 시도한 적도 없는데 실패했다고 말하고, 헤더는 "tab이 만들어진 뒤 실패"라고 하면서 힌트는 "아무것도 안 만들어졌다"고 하는 **자기모순**이었다. 지금 recovery는 네 값이고, 헤더도 그 값을 넘겨 말하지 않는다.

| 결과 | 뜻 |
|---|---|
| `none` | herdr가 자기 error 봉투로 이름 붙여 거절했다. 가서 볼 것이 없다 |
| `unknown` | 답을 못 받았거나 못 읽었다. **tab이 있을 수 있다.** 아무것도 닫지 않았으니 herdr를 직접 보라 |
| `closed` | 세대 안 증명을 갖춘 회수 |
| `orphan-unreclaimed: pane-get-failed` | 회수 확인의 `pane get`이 실패 |
| `orphan-unreclaimed: pane-get-unparsable` | 그 응답을 읽을 수 없음 |
| `orphan-unreclaimed: pane-id-mismatch` | 다른 pane |
| `orphan-unreclaimed: terminal-id-mismatch` | 같은 좌표, 다른 터미널(세대가 바뀜) |
| `orphan-unreclaimed: agent-session-present` | 남의 에이전트가 들어와 있음 |
| `orphan-unreclaimed: close-failed` | close가 실패 |

**`get`과 `close` 사이의 TOCTOU는 남는다.** 공개 API에 조건부 close가 없어서 닫을 수 없는 창이고, 그래서 감추지 않고 여기에 적는다.

## 8. `--kind`는 runtime 증명이 아니다

`[file:line @ c77af189]` `src/app/agents.rs:197-199` — herdr는 enum을 **bare executable 이름**으로 바꿔 pane의 셸에 쓰고 detection을 기다린다. PATH를 사전 resolve하지 않는다.

그러므로 tmux 레일의 여섯 가지 runtime 거절(`runtime-unresolved` 등)은 이 레일에 **없다.** 이것은 herdr로 넘어간 것이 아니라 **사라진 것**이고, 그렇게 적는다. 바이너리 부재·alias·PATH·timeout은 전부 **post-mutation** 결과이며 herdr 자신의 오류 코드를 그대로 인용해 돌려준다(`{"error":{"code":…}}`, stderr + exit 1 — `[file:line @ c77af189]` `src/cli.rs:745-753`).

## 9. receipt가 담는 것과 담지 않는 것

| 담는다 | 왜 |
|---|---|
| `backend` · `requestedKind` · `model` · `cwd?` | 무엇을 띄워달라고 했는가 |
| `herdrWorkspaceId` · `herdrTabId` | **우리가 만든 tab**. 이제 필수다 — 만든 물건을 선택적으로 말하지 않는다 |
| `herdrAgentName` · `herdrPaneId` · `herdrTerminalId` | 그 tab의 initial pane과 herdr의 이름, **view라고 이름 붙여서** |
| `nonce` | 발행 사실. 주소가 아니다 |

tab 좌표는 **그것을 만든 응답**에서 온다(`agent start`의 echo가 아니라). 오퍼레이터가 읽는 좌표와 회수가 겨냥하는 좌표가 같아야 하기 때문이다.

| 담지 않는다 | 왜 |
|---|---|
| `gardenId` · `nativeSessionId` | 주소는 레코드가 준다. 이 모듈은 저장소를 읽지 않는다 |
| `agent_session` | 조인 키다. receipt에 넣는 순간 pane이 주소로 승격되기 시작한다 |
| 화면 텍스트 · `agent_status` · `interactive_ready` | herdr의 화면 판정이다. 배달 증거가 아니다 |

## 10. 거절 어휘

**공유 입력 계약**(tmux 레일과 **같은 낱말**, 같은 순서, 같은 trim): `caller-identity-unavailable` · `model-empty` · `model-invalid` · `task-empty` · `task-too-long`. 이 다섯은 공개 verb의 caller-facing 계약이라 herdr 안이라고 다른 단어를 배우면 안 된다. `cwd`의 생략 규칙도 같이 온다 — **`undefined`와 정확히 빈 문자열만** "cwd 없음"이고, 나머지는 리터럴 경로다(untrimmed).

**herdr 고유 pre-mutation**(아무것도 생기지 않음): `herdr-context-missing` · `herdr-caller-pane-missing` · `herdr-caller-pane-get-failed` · `herdr-caller-pane-unparsable` · `herdr-caller-pane-drift` · `herdr-caller-workspace-missing` · `herdr-backend-unsupported` · `herdr-placement-tmux-rejected` · `herdr-argv-control-character` · `cwd-not-absolute` · `cwd-missing` · `cwd-not-directory`

**post-create** (회수 결과를 함께 낸다): `herdr-tab-create-failed` · `herdr-tab-create-unparsable` · `herdr-tab-root-pane-occupied` · `herdr-agent-start-failed` · `herdr-agent-start-unparsable` · `herdr-agent-start-pane-drift` · `herdr-agent-start-vanished` · `herdr-agent-start-argv-drift`

뒤의 셋은 **읽을 수 있는데 어긋난** 응답이라 `unparsable`로 뭉개지 않는다 — 오퍼레이터가 할 일이 각각 다르다. `pane-drift`는 우리가 연 pane·terminal·**tab**이 아닌 곳에서 뭔가 떴다는 뜻이고(회수는 **tab create 영수증**에서 시작한다), `witness-missing`은 아무도 식별할 수 없는 launch를 성공이라고 들었다는 뜻이며, `argv-drift`는 우리가 구성하지 않은 프레이밍으로 형제가 떴다는 뜻이다. `[file:line @ c77af189]` `src/app/agents.rs:197-199`가 echo되는 argv를 **canonical executable + 우리 args**로 정의하므로 이 대조는 추측이 아니다.

`placement`는 **정의되어 있기만 하면** 거절한다 — `{}`도 `{tmuxSession:""}`도. 멤버를 읽으면, seat를 요청했다가 오타를 낸 caller가 초록 영수증과 함께 기본 위치의 형제를 받는다.

`herdr-placement-tmux-rejected`가 따로 있는 이유: herdr 안에서 `placement:{tmuxSession}`은 **조용히 무시하면 안 된다.** 무시하면 caller가 요청하지 않은 곳에 형제가 열리는데 호출은 성공으로 보인다. tmux fallback은 없다 — 지원하지 않는 backend도 마찬가지로 이름 붙여 거절하고, 다른 레일로 몰래 보내지 않는다.

## 11. 경계 — 두 레일은 따로 지울 수 있어야 한다

- `herdr-fresh-call.ts`는 **`mux-*`도 `entwurf-*`도 import하지 않는다.** 공유하는 것은 중립 leaf `fresh-call-composition.ts`뿐이다(backend argv 방언 · 프레이밍 · nonce).
- 배치 문장은 **레일이 공급한다**. leaf는 빈 문장을 받으면 기본값을 지어내지 않고 던진다 — 한쪽 레일에서 참인 기본값은 다른 쪽에서 거짓말이기 때문이다.
- `entwurf_v2` dispatch 모듈은 herdr를 모른다(S1의 `HP-PLACEMENT-NOT-DISPATCH`와 같은 규율).

## 12. 증거 등급

| 축 | 어디서 |
|---|---|
| argv 문법 · 인코딩 · 파싱 · 거절 · workspace 결속 · 회수 결정 · receipt 모양 | `scripts/check-herdr-fresh-call.ts` (결정론, herdr 바이너리 불필요) |
| 실바이너리 격리 서버 | `scripts/check-herdr-sandbox.ts` (C2a). 샌드박스 `HOME`/`XDG`/`PI_CODING_AGENT_DIR`의 private 서버 + 실제 `herdr integration install pi` + 프로덕션 argv로 만든 tab에 빈 pi 기동 + 그 tab의 pane-레벨 회수. **가짜 herdr 실행파일·가짜 서버는 만들지 않는다** |
| 콜백 왕복 | LIVE (모델 턴이 필요한 순간부터가 LIVE다) |

`[측정]` 기록에 남은 비변이 CLI probe 하나: 존재하지 않는 pane으로 `agent start`를 불러 제어문자 판정이 pane 조회보다 앞선다는 것을 확인했다. 아무것도 만들지 않는 probe는 이 등급에서 허용된다.

## 13. 게이트 admission — 없음은 SKIP, 깨짐은 FAIL

`check-herdr-sandbox`는 herdr를 **선택적 레일**로 다룬다. 세 갈래뿐이다:

| 상태 | 결과 |
|---|---|
| PATH에 herdr 없음 | `[entwurf:herdr-rail-skip]` 두 줄을 찍고 **exit 0**. 결정론 표면에는 제3의 결과가 없고, 조용한 통과는 초록을 거짓말로 만든다 |
| herdr 없음 + `ENTWURF_REQUIRE_HERDR=1` | **FAIL**. 미래의 CI가 이 파일을 고치지 않고 부재를 빨강으로 바꾸는 손잡이 |
| herdr 있는데 셀을 완주 못함(pi 부재 포함) | **FAIL.** 부재는 선택이지만 고장은 아니다 |

**버전 경계**는 잰 것만 말한다: `herdr 0.9.x`가 아니면 **실패**하고 재측정을 요구한다. 이 문서가 그 경계를 소유하며, **entwurf setup은 herdr를 설치하지 않는다**(Hard Rule 17).

**`--approve`는 픽스처 전용이다.** 게이트는 자기 샌드박스의 오퍼레이터이므로 그 한 번의 실행을 스스로 승인할 수 있다. 프로덕션 argv에는 절대 들어가지 않는다 — `project-trust-handler.ts`가 "에이전트는 스스로 신뢰를 승격할 수 없다"를 의도된 보안 비대칭으로 적어 두었고, 런처가 오퍼레이터 대신 승인하면 그 판단을 조용히 가져가는 것이 된다. `[측정]` `--approve`는 `trust.json`을 만들지 않는다.

**C2b는 착지했다.** CI job은 `scripts/fixtures/herdr-supply.json`이 소유하는 정확한 published asset을 `scripts/install-herdr-ci.sh`로 내려받아 sha256 검증한 뒤 `check:full` 전에 PATH에만 노출하고, `ENTWURF_REQUIRE_HERDR=1`으로 부재를 FAIL로 만든다. 로컬에서는 여전히 optional rail의 named SKIP이다. 구조적 제약 하나는 남는다: **스스로 SKIP하는 게이트는 뮤턴트를 실을 수 없다** — SKIP은 exit 0이고, herdr 없는 호스트에서는 모든 뮤턴트가 SURVIVED로 읽힌다. 뮤턴트 lane은 CI admission이 필요한 환경에서만 붙인다.

## 14. LIVE 관측 — 첫 턴, 그리고 그 변동성 `[측정 oracle 2026-09-18 01:48~02:14]`

이 레일의 콜백 왕복은 LIVE이고(§12), LIVE 다섯 런이 **평균이 아니라 분류표**로 남았다. 같은 코드에서
결과가 갈릴 때 평균은 사실을 지우고, 분류는 다음 측정을 가리킨다.

| run | 자식 결과 | 자식 MCP연결 → 첫 프롬프트 | 진단 |
|---|---|---|---|
| 1 | — | — | `herdr-agent-start-failed [herdr: timeout]`. **모델 거절이 아니다** — 아래 결함 1 |
| 2 `sCzzE0` | **콜백 도착** | **195 ms** | 자식이 `entwurf_peers` → `entwurf_v2` 둘 다 성공. 수용 영수증 |
| 3 `e3aQHQ` | 침묵 | 171 ms | 도구 호출 0 |
| 4 `7yn2Xu` | 침묵 | 132 ms | 180초를 더 기다려도 같음 |
| 5 `5p7T9o` | 침묵 | 106 ms | `agent_status: idle`, `interactive_ready: true`, 터미널 제목 `✳ Entwurf callback with correlation tag` |

**죽은 가설 둘**(측정으로 죽었다): "프롬프트가 도착하지 않았다" — 자식은 매 런 `SessionStart` 뒤 ~300 ms에
`UserPromptSubmit`을 entwurf 자신의 hook 저널에 찍는다. "아직 생각 중이었다" — `agent_status: idle`, 턴이 끝나 있다.

**남은 선두 가설**: 첫 턴이 **entwurf-bridge 도구 목록이 도달하기 전에 구성된다**. 195 ms만 통하고
106/132/171 ms가 통하지 않은 순서와 일관되지만 **n=4이므로 상관이고 증명이 아니다** — omp가 `--entwurf-bootstrap`
페이로드를 갖게 된 것과 같은 축의 경주다(`fresh-call-composition.ts`, "WHY OMP ALONE CARRIES NO PROMPT").

**그 다음 측정으로 제안됐던 `agent prompt` 2단계 기동은 아래에서 닫혔다** — 모델 턴이 아니라 벤더
소스로, 그리고 **채택 불가**로.

### `agent prompt` 2단계 기동 — 재보고, 다시 버렸다 `[측정 2026-09-18, herdr 소스 @ 7505c08 + 설치본 0.9.1 CLI]`

위 가설의 "값싼 다음 측정"은 **모델 턴 없이** 끝났다. 자식이 콜백하는가보다 앞에 있는 물음이 있었기
때문이다 — `agent prompt`는 무엇을 보내는가.

| 물음 | 측정 | 어디서 `[file:line @ 7505c08]` |
|---|---|---|
| 무엇을 보내나 | 자식 pane의 **PTY에 bracketed paste로 감싼 텍스트 바이트**를 쓰고, **300 ms** 뒤 **Enter 키 인코딩**을 쓴다 | `src/app/api_helpers.rs:25-32`(`\x1b[200~{text}\x1b[201~`)·`:48-58`, `src/app/api/agents.rs:13`·`:195`·`:208-212` |
| 제어문자 거절이 argv와 같은가 | **아니다.** `agent start`는 `args`에 `char::is_control`이 하나라도 있으면 pane 조회 전에 거절하는데(`src/app/agents.rs:159`), `agent.prompt`의 `text`에는 **빈 문자열 검사 하나뿐**이고 제어문자 검사가 아예 없다 | `src/app/api/agents.rs:123-128` |
| 그래서 개행은 통과하나 | 통과한다. 다만 **계약이 아니라 상태다** — bracketed paste가 켜져 있으면 붙여넣기로 들어가고, 꺼져 있으면 `text.as_bytes()` 그대로라 개행 하나하나가 그 자리에서 제출이 된다. 어느 쪽인지는 그 순간 자식 터미널의 모드가 정한다 | `src/app/api_helpers.rs:26-31` |
| 무엇이 ack되나 | 입력이 **쓰였다**는 것. 벤더 help가 스스로 그렇게 적는다 — "before any input is sent", "It does not track turns" | `herdr agent prompt --help` (설치본 0.9.1) |
| 비-PTY 프롬프트 통로가 따로 있나 | 없다. 텍스트를 나르는 API 동사는 `agent.prompt`·`agent.send_keys`·`pane.send_text`·`pane.input.set` 넷이고 **전부 PTY 입력**이다 | `src/api/schema.rs:116-190` |

`agent prompt`는 herdr API 동사이지만 그 아래는 **자식 PTY에 찍는 합성 키 입력**이다. 그러면 2단계 기동은
§3이 이미 이름 불러 버린 통로(「키 입력(`agent prompt`): 터미널 입력이다」, 45행 · `herdr-fresh-call.ts:28`)를
프로덕션 레일로 되살리는 일이고, Hard Rule 16의 「keystrokes are not delivery evidence」를 하필 **첫 턴**에
적용하는 일이다. **구현하지 않았다.** LIVE 3런도 돌리지 않았다 — 채택할 수 없는 경로의 성질을 재는 값이다.

**이 절 이전 판이 §3과 모순돼 있었다.** 같은 문서가 3에서 버린 통로를 14에서 다음 측정으로 제안했다.
규칙의 소유자는 §3이고, 이 절은 그 제안을 측정으로 닫는다. 첫 턴 경주의 남은 적법한 방향은 **프레이밍이
도구 목록보다 먼저 서 있게 만드는 축**이다 — omp의 `--entwurf-bootstrap`과 같은 자리이지, 키 입력이 아니다.

### 이 레일에서만 드러난 결함 셋 `[전부 수리됨, f7f9d8c]`

1. **`agent start`에 `--timeout`을 넘기지 않았다.** herdr는 자기 기본 30초로 포기하고 우리 프로세스 바운드는
   300초에 앉아 있었으므로, 콜드 스타트 중인 **살아 있는** 형제가 회수되지 않은 pane과 함께
   `herdr-agent-start-failed [herdr: timeout]`으로 돌아왔다. 이제 명시적 240초이고 우리 300초 kill보다
   **낮다**: 둘이 경주하면 herdr가 져야 하고, 그래야 이름 붙은 답이 "no exit status"로 바뀌지 않는다
   (`HFC-START-READY-BOUND`). **날것 설치 PC는 정확히 이 콜드 스타트 경우다.**
2. **셀이 자식을 호출자의 시계로 판정했다.** 같은 코드 두 런의 차이가 오직 호출자 launch 시간(56s vs 37s)이었고,
   느린 쪽만 자식에게 충분한 머리시간을 주었다. 자식은 이제 자기 시계로 바운드된다.
3. **오라클이 우리 프롬프트와 모순됐다.** 자식의 첫 도구 호출이 `entwurf_v2`이기를 요구했는데, 프레이밍은
   읽기 전용 확인을 **권유**한다 — Sonnet 자식이 그 권유를 받아들이자 게이트가 우리가 부탁한 행동을
   실패로 읽었다. 이제 읽기 전용 확인을 허용하고, 주장의 대상이던 것만 금지한다.

### 증거 표면 — 자식 transcript는 없다 `[측정 2026-09-18]`

이 스모크의 **모든** claude 세션(호출자·자식, 행동한 것·침묵한 것)이 실HOME `~/.claude/projects/`에도, 격리
XDG 루트 어디에도 없다 — **도구를 두 번 성공시킨 자식조차**. HOME은 이 런타임들에게 실제값이므로 격리
부작용이 아니다. 따라서 이 레일의 증거 표면은 **herdr agent status + entwurf 자신의 hook 저널 둘뿐**이고,
`ab5c860` 이후 LIVE 셀은 매 런 그 둘을 receipts에 적는다. 자식이 무엇을 생각했는지 묻는 가설은 이 레일에서
검증할 수 없다 — 물을 수 있는 것은 자식이 무엇을 **했는지**다.
