# herdr launch rail

> 이 문서는 **herdr 안에서 형제를 여는 레일**을 소유한다. tmux 레일은 [`mux-launch-rail.md`](./mux-launch-rail.md)가 그대로 소유하고, 두 문서는 합쳐지지 않는다 — 좌표도 실패 모양도 다르기 때문이다.
> 대상: `pi-extensions/lib/herdr-fresh-call.ts` (#116 S2-c1). 측정 환경: herdr 0.9.0 / socket protocol 22, oracle, 2026-09-14. herdr 소스 인용은 전부 `@ c77af189` 고정본이다.

## 1. 이 레일이 무엇을 나누어 갖는가

| | herdr | entwurf |
|---|---|---|
| pane 배치·분할·레이아웃 | **소유** | 관여하지 않는다 |
| 에이전트 기동(`agent start`) | **소유** | 무엇을 띄워달라고 할지만 말한다 |
| 첫 턴 프레이밍·nonce | — | **소유** |
| garden id·주소·배달·거절 | — | **소유** |

예쁜 작업대와 공구함은 herdr 것이고, 드라이버가 우리 것이다. 이 레일은 그 경계를 코드로 옮긴 것이다.

## 2. 두 걸음이라는 사실, 그리고 그것이 깨는 불변

tmux 레일은 `new-window` 한 번이라 "위의 어떤 것도 창을 남기지 않는다"(`mux-fresh-call.ts:527-531`)가 성립한다. herdr는 **두 걸음**이다:

```text
pane split  →  (pane이 이미 존재)  →  agent start  →  실패할 수 있다
```

그래서 이 레일의 순서 논증은 다르게 쓰여 있다: **결정 가능한 모든 것을 split 앞으로 옮긴다.** context·backend·tmux seat 입력·caller id·task·model·cwd·인코딩된 argv의 제어문자까지 전부 pre-mutation 거절이고, split 이후로 살아남는 실패는 **herdr 자신의 실패뿐**이다.

## 3. 옵션 G — 여러 줄 프레이밍을 한 물리행으로

### 막은 것

`[file:line @ c77af189]` `src/app/agents.rs:157-162`은 인자에 **유니코드 제어문자가 하나라도** 있으면 pane을 조회하기도 전에 거절한다:

```rust
if params.args.iter().any(|arg| arg.chars().any(char::is_control)) { InvalidArgument }
```

`[측정 2026-09-14, 변이 0]` 존재하지 않는 pane으로 두 번 불러 순서까지 확인했다 — 여러 줄 인자는 `invalid_agent_argument`, 한 줄 인자는 `agent_pane_not_found`. 우리 프레이밍은 계약상 여러 줄이고 caller의 task도 흔히 여러 줄이다.

### 먼저 재보고 버린 통로 셋

- **메일함 배달**(빈 형제를 먼저 띄우고 프레이밍을 배달): `[측정]` claude 형제가 읽고 수신 확인까지 남긴 뒤 **거부**했다. 출생 주장·nonce·검증금지 문구를 전부 걷어낸 정중한 요청으로 다시 재도 **또 거부**했고, 이유는 문구가 아니라 **권한**이었다 — 방금 빈 채로 태어난 세션에는 검증할 맥락이 없다. 이 거부는 고칠 버그가 아니라 지킬 성질이다.
- **키 입력**(`agent prompt`): 터미널 입력이다. 이 제품은 형제를 키 입력으로 열지 않는다.
- **벤더 확장 디코더**: omp에는 선례가 있지만 claude-code에는 없다. 파일럿은 `pi | claude-code`다.

### 채택한 모양

프레이밍 **전체**를 JSON 문자열 리터럴 하나로 감싸, 그것을 디코드하라는 **한 문장** 뒤에 붙인다.

```text
Decode the following JSON string literal and follow the decoded instructions exactly as if they were this message: "You are a fresh visible citizen that entwurf opened in a herdr pane.\n\nFIRST ACTION, …"
```

- **`JSON.stringify`만으로는 부족하다.** 그것은 C0와 따옴표·역슬래시만 이스케이프하고 **DEL(U+007F)과 C1 블록(U+0080–U+009F)은 리터럴로 남긴다.** 그래서 그 뒤에 남은 `\p{Cc}`를 `\uXXXX`로 되돌릴 수 있게 한 번 더 이스케이프한다.
- **전송이 바이트를 정규화하지 않는다.** 인코더는 개행 접기도 유니코드 정규화도 하지 않고, 자기 출력이 원본으로 정확히 디코드되는지 확인한 뒤 아니면 **던진다** — 재현할 수 없는 프레이밍으로 형제를 태우지 않는다. `[정확히 말하면]` 그 "원본"은 **공개 입력 계약을 통과한 뒤의 문자열**이다: model과 task는 두 레일 공통으로 **trim된다**(공백뿐인 task는 `task-empty`). trim이 launch 전체에서 유일한 정규화이고, 그 뒤로는 전송이 바이트를 건드리지 않는다.
- **호출 전에 `\p{Cc}` 0개를 증명한다.** 프롬프트만이 아니라 `agent start`에 넘길 **모든 인자**를 검사한다(서버도 모든 인자를 본다). 실패는 `herdr-argv-control-character` — split 이전이라 **고아 pane이 남지 않는다**.
- `[측정 2026-09-14, 두 파일럿]` 형제는 디코드하고 **콜백을 먼저** 보낸 뒤 과제에 답했다. 인코딩이 "콜백이 첫 행동"이라는 계약을 삼키지 않았다.

## 4. identity — 무엇이 무엇을 증명하는가

세 영수증은 **서로 다른 것**을 증명하고, 어느 하나도 다른 하나의 fallback이 아니다.

| 영수증 | 누가 | 무엇을 증명하나 |
|---|---|---|
| herdr `agent_started`의 direct witness | 호출자 | 무엇이 어디에 기동됐는가 (**launch 증거**) |
| exact-one V3 레코드 | 레코드 저장소 | 그 native session의 **주소** |
| nonce 콜백의 sender envelope | 형제 | 형제가 **첫 모델 행동**을 했다 |

`[측정 2026-09-14]` direct witness는 `agent start` 응답이 돌아오기 **전에** 이미 레코드가 존재하는 시점에 온다(claude 레코드 09:41:47 < 응답 09:41:48, pi 09:42:09 < 09:42:16) — watcher도 retry도 필요 없는 1회 조회다.

**그러나 이 모듈은 레코드를 읽지 않는다.** launch receipt에는 garden id도 native session id도 없다. 주소를 말하는 것은 레코드이고, 그 조회는 이 레일 밖(표면, c2)에서 일어난다. `[미검증 잔여]` "레코드가 아직 없는 순간"은 표본 2개 + 구조 논거일 뿐 herdr의 보장이 아니다 — **이름 붙인 거절**로 둘지 **상한 있는 1회 재읽기**로 둘지는 표면 배선 때 정한다.

## 5. 배치 정책 — 하나뿐이다

```text
pane split --pane <HERDR_PANE_ID> --direction down --no-focus [--cwd <literal>] --env PI_SESSION_ID= --env PI_AGENT_ID=
```

- **부모 pane은 herdr가 준다**(`HERDR_PANE_ID`). `pane list`를 뒤져 부모를 고르지 않는다 — 그건 남의 view를 반으로 자를 대상으로 고르는 추측이다. 없으면 `herdr-parent-pane-missing`.
- `[file:line @ c77af189]` `src/cli/pane.rs:722-727` — `--direction`은 **필수**다. "herdr가 알아서"라는 선택지가 없으므로 정책을 우리가 말해야 한다. `--no-focus`는 오퍼레이터의 키보드를 뺏지 않기 위해 명시한다.
- `[file:line @ c77af189]` `src/cli/pane.rs:689-694` — `--cwd`는 `value.clone()`로 **그대로** 실린다. 포맷 확장이 없으므로 tmux 레일의 `#` 거절은 **가져오지 않는다**(그 거절의 이유가 여기서는 거짓이다). 존재 검사 셋(`cwd-not-absolute`/`cwd-missing`/`cwd-not-directory`)은 남는다 — 사라진 디렉토리에서 명랑하게 열리는 창이 tmux에서 문제였던 이유는 여기서도 같다.
- `[file:line @ c77af189]` `src/cli/pane.rs:710-717` — `--env`는 map에 insert되므로 **반복이 문법**이다. `[측정]` `--env KEY=`는 키를 지우는 게 아니라 **빈 값을 주입**한다. 그래서 신원 스크럽을 명시로 싣는다 — 서버 env가 깨끗하다는 데 베팅하지 않는다.
- **레이아웃 매니저를 만들지 않는다.** 다른 배치를 원하면 herdr에서 pane을 옮기면 된다. 레이아웃은 herdr 것이다.

## 6. 이름과 좌표

- **agent name**: `entwurf-<sha256(nonce) 앞 20자>`. `[file:line @ c77af189]` `src/app/agents.rs:15-20`이 `[a-z][a-z0-9_-]{0,31}`을 요구하는데 nonce 자체(39자)는 통과하지 못한다. 이름은 **역할도 제목도 주소도 아니다** — `herdr agent list`를 읽는 사람이 알게 되는 것은 "entwurf가 열었다"뿐이다.
- **pane id는 불투명 문자열이다.** `[측정 2026-09-14]` 열 번째 pane은 `w7:p10`이 아니라 **`w7:pA`**로 왔다. 10진수를 가정하는 파서는 이미 틀렸다.
- **pane id는 형제의 수명 동안 안정적이지도 않다.** `[측정]` 워크스페이스 이동에서 `w7:p3` → `w8:p2`로 바뀌었고 그 아래 세션은 그대로였다. 그래서 좌표는 **저장하지 않고** 필요할 때마다 다시 읽는다.

## 7. 고아 회수 — 세대 안에서만 증명된다

`[측정 2026-09-14, 격리 샌드박스 서버]` `herdr server stop` → 재기동에서 **같은 pane id 셋이 전부 다른 terminal_id에 다시 묶였다**(`w1:p1/p2/p3`, `term_65b6d90e…` → `term_65b6d916…`).

두 가지가 따라온다:

1. **bare pane id는 무엇을 닫을 권위도 아니다.** `[file:line @ c77af189]` `src/api/schema/common.rs:33-36` — `close_pane`은 `pane_id`만 받고 기대 terminal 토큰을 받지 않는다.
2. **`terminal_id`도 세대를 넘지 못한다.** 그러므로 계약 문장은 *"terminal_id가 소유를 증명한다"*가 아니라 **"한 서버 세대 안에서 증명한다"**이다. 재기동 뒤의 낡은 영수증은 **항상** 불일치로 떨어지고, 그것이 안전한 방향이다.

회수 절차: 새 `pane get` → **pane id 일치 AND terminal_id 일치 AND agent_session 없음**일 때만 `pane close` 한 번.

| 결과 | 뜻 |
|---|---|
| `closed` | 세대 안 증명을 갖춘 회수 |
| `orphan-unreclaimed: pane-get-failed` | 확인 자체가 실패 |
| `orphan-unreclaimed: pane-get-unparsable` | 응답을 읽을 수 없음 |
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
| `herdrAgentName` · `herdrPaneId` · `herdrTerminalId` · `herdrWorkspaceId?` · `herdrTabId?` | herdr의 좌표, **view라고 이름 붙여서** |
| `nonce` | 발행 사실. 주소가 아니다 |

| 담지 않는다 | 왜 |
|---|---|
| `gardenId` · `nativeSessionId` | 주소는 레코드가 준다. 이 모듈은 저장소를 읽지 않는다 |
| `agent_session` | 조인 키다. receipt에 넣는 순간 pane이 주소로 승격되기 시작한다 |
| 화면 텍스트 · `agent_status` · `interactive_ready` | herdr의 화면 판정이다. 배달 증거가 아니다 |

## 10. 거절 어휘

**공유 입력 계약**(tmux 레일과 **같은 낱말**, 같은 순서, 같은 trim): `caller-identity-unavailable` · `model-empty` · `model-invalid` · `task-empty` · `task-too-long`. 이 다섯은 공개 verb의 caller-facing 계약이라 herdr 안이라고 다른 단어를 배우면 안 된다. `cwd`의 생략 규칙도 같이 온다 — **`undefined`와 정확히 빈 문자열만** "cwd 없음"이고, 나머지는 리터럴 경로다(untrimmed).

**herdr 고유 pre-mutation**(아무것도 생기지 않음): `herdr-context-missing` · `herdr-parent-pane-missing` · `herdr-backend-unsupported` · `herdr-placement-tmux-rejected` · `herdr-argv-control-character` · `cwd-not-absolute` · `cwd-missing` · `cwd-not-directory`

**post-split** (회수 결과를 함께 낸다): `herdr-split-failed` · `herdr-split-unparsable` · `herdr-split-pane-occupied` · `herdr-agent-start-failed` · `herdr-agent-start-unparsable` · `herdr-agent-start-pane-drift` · `herdr-agent-start-witness-missing` · `herdr-agent-start-argv-drift`

뒤의 셋은 **읽을 수 있는데 어긋난** 응답이라 `unparsable`로 뭉개지 않는다 — 오퍼레이터가 할 일이 각각 다르다. `pane-drift`는 우리가 연 pane이 아닌 곳에서 뭔가 떴다는 뜻이고(회수는 **split 영수증**에서 시작한다), `witness-missing`은 아무도 식별할 수 없는 launch를 성공이라고 들었다는 뜻이며, `argv-drift`는 우리가 구성하지 않은 프레이밍으로 형제가 떴다는 뜻이다. `[file:line @ c77af189]` `src/app/agents.rs:197-199`가 echo되는 argv를 **canonical executable + 우리 args**로 정의하므로 이 대조는 추측이 아니다.

`placement`는 **정의되어 있기만 하면** 거절한다 — `{}`도 `{tmuxSession:""}`도. 멤버를 읽으면, seat를 요청했다가 오타를 낸 caller가 초록 영수증과 함께 기본 위치의 형제를 받는다.

`herdr-placement-tmux-rejected`가 따로 있는 이유: herdr 안에서 `placement:{tmuxSession}`은 **조용히 무시하면 안 된다.** 무시하면 caller가 요청하지 않은 곳에 형제가 열리는데 호출은 성공으로 보인다. tmux fallback은 없다 — 지원하지 않는 backend도 마찬가지로 이름 붙여 거절하고, 다른 레일로 몰래 보내지 않는다.

## 11. 경계 — 두 레일은 따로 지울 수 있어야 한다

- `herdr-fresh-call.ts`는 **`mux-*`도 `entwurf-*`도 import하지 않는다.** 공유하는 것은 중립 leaf `fresh-call-composition.ts`뿐이다(backend argv 방언 · 프레이밍 · nonce).
- 배치 문장은 **레일이 공급한다**. leaf는 빈 문장을 받으면 기본값을 지어내지 않고 던진다 — 한쪽 레일에서 참인 기본값은 다른 쪽에서 거짓말이기 때문이다.
- `entwurf_v2` dispatch 모듈은 herdr를 모른다(S1의 `HP-PLACEMENT-NOT-DISPATCH`와 같은 규율).

## 12. 증거 등급

| 축 | 어디서 |
|---|---|
| argv 문법 · 인코딩 · 파싱 · 거절 · 회수 결정 · receipt 모양 | `scripts/check-herdr-fresh-call.ts` (결정론, herdr 바이너리 불필요) |
| 실바이너리 격리 서버 | `scripts/check-herdr-sandbox.ts` (C2a). 샌드박스 `HOME`/`XDG`/`PI_CODING_AGENT_DIR`의 private 서버 + 실제 `herdr integration install pi` + 빈 pi 기동. **가짜 herdr 실행파일·가짜 서버는 만들지 않는다** |
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

`[미결, C2b]` CI가 herdr를 **누가 어떤 버전으로** 설치하는가, 그리고 **SKIP을 초록으로 둘지**. 그리고 구조적 제약 하나: **스스로 SKIP하는 게이트는 뮤턴트를 실을 수 없다** — SKIP은 exit 0이고, herdr 없는 호스트에서는 모든 뮤턴트가 SURVIVED로 읽힌다. 뮤턴트 lane은 admission이 정해진 뒤에 붙인다.
