# NEXT — #82 Copilot garden id 시민화 (branch lane)

> **이 주제의 산문은 이 파일 하나다.** `docs/` 아래나 다른 산문에 복제하지 마라.
> 구현이 코드로 들어가면 이 파일은 지운다. 머지 전 삭제하는 disposable이다.
>
> **다만 이 파일은 색인이지 대체물이 아니다.** 결정적 증거는 아래에 원문 그대로 박아 두었지만,
> 이슈 스레드와 전체 영수증을 대신하지 않는다. 규약 4가 요약본 브리핑을 금지하는 것은
> **이 파일에도 적용된다** — 인용할 일이 생기면 여기서 가리키는 원본을 열어라.

레인: **Copilot이 garden id를 가진 가든 시민이 된다.** Claude Code처럼 주소로 부를 수 있어야
GitHub 쪽을 맡기고 `auto` 모드를 비용 레버로 쓸 수 있다.
근거는 GLG가 #82에 직접 쓴 코멘트 `5352330620` (2026-08-20T06:37:33Z).

브랜치 `issue-82-copilot-citizen`. **코드 변경 0.** 이 파일만 있다.

---

# §0 형제 간 사실 전달 규약 — 이 세션의 본 산출물

2026-08-19~20 이 레인은 세 번 엎어졌다. 매번 실력 문제가 아니라 **전달 문제**였다.
사실이 근거 없이 문장만 건너가면, 받은 쪽이 할 수 있는 건 **믿거나 반박하거나** 둘뿐이다.
그래서 대화가 자꾸 "그거 틀렸습니다"로 시작한다. 그건 사람 문제가 아니라 형식 문제다.

## 규약 1 — 모든 사실 문장은 증거 상태를 달고 다닌다

| 태그 | 뜻 | 받은 쪽이 할 일 |
|---|---|---|
| `[측정]` | 직접 실행/관측함. **영수증 파일명이 같이 적힌다** | 영수증을 열어볼 수 있다 |
| `[코드]` | 이 리포에서 `file:line`으로 직접 읽음 (확인 날짜 포함) | 그 줄을 열어볼 수 있다 |
| `[번들]` | 외부 산출물(Copilot 번들 등)에서 직접 읽음 | 경로가 적혀 있다 |
| `[미검증]` | 물려받은 **사실 주장**인데 아직 확인 안 함. 출처를 밝힌다 | **인용 전에 직접 재라** |
| `[제안]` | 사실이 아니라 **설계 판단**이다. 낸 사람을 밝힌다 | 재는 게 아니라 **채택하거나 다르게 결정한다** |

**§1–§3의 사실 주장에는 태그 없는 단정이 없다.** (레인 서술·RAIL·규약 자체는 사실 주장이 아니라
운영 문장이라 태그를 안 단다. 그 구분이 이 규약의 적용 범위다.)
태그를 못 붙이겠으면 그건 사실이 아니라 가설이다.

`[미검증]`과 `[제안]`을 섞지 마라. 미검증 사실은 **재면** 태그가 올라가지만,
설계 제안은 재서 올라가는 게 아니다 — 채택하거나 기각하는 것이고, 측정으로 기각하려 들면
제안을 사실로 오해한 것이다.

**영수증 이동성.** 이 레인의 전체 로그는 `~/.local/share/entwurf-salvage/` 에 있고 **호스트 로컬이다.**
git에 없다. 그래서 결정적 줄은 아래 §1에 **원문 그대로 박아** 두었다 — 그건 커밋 안에 있으니 어디서든 읽힌다.
**다른 기기에서, 또는 salvage가 지워진 뒤에는 인용 전체를 `[미검증]`으로 강등하고 §1의 박힌 원문만 `[측정]`으로 취급하라.**

## 규약 2 — 영수증 없는 주장은 *틀린 것*이 아니라 *단서*다

`[미검증]`은 비난이 아니다. 상태 표시다. 단서를 받은 쪽은 재고, 재면 태그가 올라간다.
그래서 **"그거 틀렸습니다"가 아니라 "그 문장에 영수증이 없어서 재봤습니다"** 가 기본형이다.
이건 말투 문제가 아니다. 실제로 오늘 세 번 중 두 번은, 틀린 게 아니라 **범위가 과장**돼 있었다.

## 규약 3 — 주장을 은퇴시킬 때 사람이 아니라 주장을 적는다

§2가 그 형식이다. 누가 말했는지가 아니라 **어떤 문장이 어떤 영수증에 의해 은퇴했는지**를 적는다.
사람 이름은 공적을 적을 때만 쓴다.

## 규약 4 — 형제를 브리핑할 때 내가 쓴 요약이 아니라 원본을 가리킨다

2026-08-20 오전 사고의 전파 경로가 정확히 이것이다. 한 세션이 이슈 **본문만** 읽고 설계 문서를 썼고,
그 문서의 펜스가 형제 셋의 task spec으로 복사됐다. 펜스는 산출물 자체를 금지하는 문장이었다.
→ **브리핑은 NEXT와 이슈 스레드 원문을 가리킨다.** 요약본을 브리핑하지 않는다.
→ 이슈는 **본문만 읽지 않는다.** 스레드를 읽는다. GLG의 목표 진술이 코멘트에 있었다.
→ **충돌하면 GLG의 코멘트가 이슈 본문을 이긴다.** 이 한 줄이 없으면 스레드를 읽어도 소용없다 —
  오전 사고는 본문의 Non-goals 펜스가 스레드의 garden-id 목표를 덮은 것이었다.
  그 펜스는 2026-08-20에 정정했다(§3 마지막). **찾으러 가지 마라.**
  우선순위 규칙 자체는 남는다 — 다음에 또 어긋날 때를 위한 것이지 그 펜스 하나를 위한 게 아니다.

## 규약 5 — 리뷰어가 구멍을 찾은 건 루프가 도는 것이다

오래 파고든 구현자는 반드시 못 보는 데가 생긴다. 리뷰어는 그걸 메우라고 있다.
찾았으면 짧게 사실만 적고 넘어간다. 자기평가로 열지 않고, 상대를 깎지 않는다.
**오늘 이 규약이 실제로 값을 냈다** — 아래 §2와 §3의 절반은 리뷰에서 나왔다.

---

# RAIL

- [x] **1. 첫 측정** — 왜 copilot meta-record가 0건인가 (§1)
- [x] **2. 크로스리뷰 2회** — 주장 5건 은퇴, 썩은 서술 전수 조사 (§2, §3)
- [x] **3. 신뢰 규약 수립** — §0
- [ ] **4. 썩은 서술 정리** ← NEXT SESSION. 펜스 2개는 우선 (§3)
- [ ] **5. 출생 구현** — 바닥은 닦였다. 설계는 구현팀이 (§4)
- [ ] **6. 0.14.3 스코프** — 시민 1건이 `entwurf_peers`에 뜬 뒤에 잡는다

# §1 측정 — Copilot CLI 1.0.80

`[측정]` LIVE 비용은 **`hi` 1턴, `total_nano_aiu: 8935400000` = 8.9354 AIC**, GLG 명시 승인.
그 외 전부 모델 턴 0회. 영수증 3건 — `~/.local/share/entwurf-salvage/` 의
`copilot-hookprobe-full.log` · `copilot-hookprobe-envelopes.jsonl` · `copilot-exec-array-rejection.log`.

**`[측정]` 출발점.** meta-record 실측 409건 = `claude-code` 312 · `pi` 92 · `antigravity` 5.
`codex`와 `copilot`은 **레코드가 아예 없다**(0건).
(`~/.pi/agent/meta-sessions/*.meta.json` 를 `backend` 필드로 집계, 2026-08-20)

**`[측정]` 훅은 돌았다. 어휘 문제가 아니었다.**
`~/.copilot/logs/process-1787119815820-2819185.log` 의 2026-08-19T06:13:53.110Z / 06:13:56.172Z
두 줄이 우리 플러그인을 `entwurf-meta-receive@meta-bridge-local`로 호명하고
`Hook command failed with code 1`을 기록한다. 그 stderr는
`[코드]` `pi/meta-bridge/entwurf-meta-receive/scripts/hook-launch.sh` 43–57행 그대로다.
→ **0건은 고장이 아니라 우리 fail-closed 가드가 제대로 작동한 결과다.**
Claude Code 2.1.138의 조용한 `args` 누락을 잡으려고 쓴 가드가 Copilot 1.0.80을 똑같이 잡았다.

**`[측정]` 떨어진 건 argv뿐. stdin 봉투는 정상 도착했다.**

| 선언 형태 | 발화 | argv | stdin 봉투 |
|---|---|---|---|
| Copilot 네이티브 — `version:1` · camelCase · `exec`(string) + `args` | ○ | **argc=1, 그대로** | 도착 |
| Copilot 네이티브 — `command`(셸 문자열) | ○ | argc=1 | 도착 |
| Claude Code — `type:"command"`+`command`+`args`, PascalCase | **○** | **argc=0** | **도착** |

원문(`copilot-hookprobe-full.log` — argv 열, 한 턴에서 발화한 순서 그대로):

```text
FIRED label=copilot:userPromptSubmitted:execStrArgs argc=1 argv=[copilot:userPromptSubmitted:execStrArgs]
FIRED label=copilot:userPromptSubmitted:shellCommand argc=1 argv=[copilot:userPromptSubmitted:shellCommand]
FIRED label=<NO-ARGS>                               argc=0 argv=[]      plugin_root=.../probe-claude
FIRED label=copilot:sessionStart:execStrArgs        argc=1 argv=[copilot:sessionStart:execStrArgs]
FIRED label=copilot:sessionStart:shellCommand       argc=1 argv=[copilot:sessionStart:shellCommand]
FIRED label=<NO-ARGS>                               argc=0 argv=[]      plugin_root=.../probe-claude
FIRED label=copilot:agentStop:execStrArgs           argc=1 argv=[copilot:agentStop:execStrArgs]
```

원문(`copilot-hookprobe-envelopes.jsonl` — 같은 두 발의 stdin. **argc=0 인데 봉투는 왔다**):

```json
{"hook_event_name":"UserPromptSubmit","session_id":"4269fad4-d5f5-4281-969f-bbeb211f0d7c","timestamp":"2026-08-20T11:20:29.476Z","cwd":"…/entwurf","prompt":"hi"}
{"hook_event_name":"SessionStart","session_id":"4269fad4-d5f5-4281-969f-bbeb211f0d7c","timestamp":"2026-08-20T11:20:32.102Z","cwd":"…/entwurf","source":"new","initial_prompt":"hi"}
```

Claude 폼 프로브가 `{hook_event_name, session_id, cwd, prompt}` 전체를 stdin으로 받았다.
`[코드]` 우리 launcher는 stdin을 안 읽고 `$# -eq 0`에서 죽는다(`hook-launch.sh:43`)
— **필요한 정체성은 내내 도착해 있었다.** 고칠 때 선택지가 argv 말고 하나 더 있다.

**`[측정]` `exec`는 string이어야 한다.** 배열은 프롬프트 전, 플러그인 로드 시점에 거절된다.
원문(`copilot-exec-array-rejection.log`, `Session: 0 AIC used`):

```text
2026-08-20T11:32:43.557Z [ERROR] Invalid hooks config for plugin "probe-execarray"
  at ".../probe-execarray/hooks/hooks.json": hooks.sessionStart[0].exec: Expected string
```
`[번들]` 스키마에 `args` 키 자체가 없다. 셸/exec 분기 원문:
`Specify either 'exec' (native executable) or 'bash'/'powershell'/'command' (shell), but not both`.
`[번들]` 나머지 스키마: `version`(필수, 리터럴 1) · `hooks`(object) · `disableAllHooks`(bool) ·
엔트리 필드 `matcher`(빈 문자열 불가) · `timeoutSec` · `env` · `allowedEnvVars` · `headers` · `url` ·
`prompt` · `_vsCodeCompat`. 중첩은 한 단계까지.

**`[측정]` Copilot은 Claude 호환 봉투 번역을 싣고 있다.** 의도된 호환층이지 우연이 아니다.
네이티브 `{sessionId, timestamp(ms epoch), cwd, source, initialPrompt}` ↔
Claude-compat `{hook_event_name, session_id, timestamp(ISO), cwd, source, initial_prompt}`.

**`[측정]` `sessionStart`는 첫 프롬프트에 지연 발화한다.**
TUI를 열면 세션은 등록되지만 훅은 하나도 안 뛴다(등록 11:17:19.920Z, 3분 유휴, 훅 줄 0,
`Session: 0 AIC used`). 첫 프롬프트에서
`userPromptSubmitted`(11:20:29.476Z) → `sessionStart`(11:20:32.102Z) → `agentStop`(11:20:35.371Z).
8/19도 같은 모양(세션 06:10:16, 훅 06:13:53/56 — 3초 간격 두 발, 정확히 이 두 이벤트).
`[번들]` 벤더 스키마 설명은 *"Hooks that run when a session starts or resumes"* 인데 **관측은 다르다.**
→ **Copilot 시민은 세션 열 때가 아니라 첫 프롬프트에서 태어난다.** 뭉개지 마라.

**`[번들]` 훅 어휘 15개, 전부 camelCase.**
(`prebuilds/linux-arm64/runtime.node` 의 선언형 settings 스키마 문자열 `"path":"hooks.*"`)
`sessionStart` `sessionEnd` `userPromptSubmitted` `userPromptTransformed` `preToolUse`
`preMcpToolCall` `postToolUse` `postToolUseFailure` `permissionRequest` `errorOccurred`
`agentStop` `subagentStart` `subagentStop` `preCompact` `notification`
**부재: `CwdChanged` · `FileChanged` · `asyncRewake` · `watchPaths`.**
번들의 그 문자열들은 `TerminalCwdChangedAction` / `WorkspaceFileChangedData`이지 훅 이름이 아니다.
`[번들]` 계층 주의 — `schemas/api.schema.json`의 `HookType`은 **17개**(위 15 + `postResult` +
`prePRDescription`)이고 SDK 콜백 전송 계층이다. 한 계층의 개수를 다른 계층 것으로 인용하지 마라.

**`[번들]` 도어벨이 없다.** claude-code의 `self-fetch`를 성립시키는 셋
(`FileChanged` + `asyncRewake` + `watchPaths`)이 번들에 없다. **Copilot은 `self-fetch`가 될 수 없다.**

# §2 은퇴한 주장 — 되살리지 마라

크로스리뷰 2회에서 은퇴했다. **사람이 아니라 주장을 적는다**(규약 3).
각 줄의 오른쪽이 은퇴시킨 영수증이다.

| 은퇴한 문장 | 은퇴 근거 |
|---|---|
| ~~"훅이 한 번도 안 돌았다 / 어휘 불일치가 원인"~~ | `[측정]` Copilot 로그 06:13:53/56 두 줄 |
| ~~"`args` 하나가 문제"~~ | `[측정]` argv만 떨어짐. **stdin 봉투는 도착** |
| ~~"codex가 시민화 선례"~~ | `[측정]` codex도 레코드 **0건**. 세우는 건 *배달 없는 시민 자리*이지 출생 증거가 아니다 |
| ~~"`api.schema.json` 15개가 authoritative"~~ | `[번들]` 그 계층은 17개. 15개는 선언형 settings 스키마 |
| ~~README:382-385 "shell command-hook `sessionStart`는 `sessionId`를 안 싣는다"~~ | `[측정]` 오늘 훅 stdin이 `sessionId`를 싣는다 |

**은퇴가 아니라 승격된 것 — 따로 적는다.** 취소선을 붙이면 문장 자체가 틀린 것처럼 읽힌다.
`exec: Expected string` 은 **문구가 틀린 게 아니라 영수증 없이 인용된 것**이었다.
재현해서 아카이브했으므로 `[미검증]` → `[측정]` 으로 올라갔다. 아래 §1에 원문이 박혀 있다.

**프로브 한계 3건 — 표를 과독하지 마라.**
(a) 비격리: 설치본이 같은 프로세스에서 같이 실패했다(다른 로그에 씀, 표는 오염 안 됨)
(b) `matcher:"*"`가 `notification`/`preCompact`엔 invalid regex라 **스킵됐다**
(`Invalid matcher regex … hook will be skipped`, 11:17:19.868Z) → **그 둘이 안 뛴 건 증거가 아니다**
(c) 표는 `hi` 턴 한정. `sessionEnd`는 세션 종료 때 따로 뜬다.

# §3 썩은 서술 — 전수 조사 완료, 정리는 다음 세션

**`[코드]` 철회된 펜스가 두 곳에 커밋된 채 살아 있다.** 둘 다 지금 목표를 금지한다.

1. `scripts/raw-async-delivery/README.md:392` —
   `Do not add backend:"copilot", FRESH_CALL_BACKENDS, a schema change, or an OPEN issue …`
2. `DELIVERY.md:182` — `Do not add a record backend or dispatch route until permission …`

각각 **절반만 철회**다: `FRESH_CALL_BACKENDS`·native-push 금지는 **아직 참**,
`META_BACKENDS`·record backend·schema 금지는 **철회**(그게 산출물이 됐다).

`[측정]` `git grep -c -i copilot` 전수 + `[코드]` 줄 단위 판정:

| 파일 | 철회됨 | 아직 참 | 비고 |
|---|---|---|---|
| `scripts/raw-async-delivery/README.md` | :254 제목("positive") · :269-279 · :351-371 · **:382-385** · **:392-396** · :410-415(프레임만) | :15-20 · :22-28 · :91 · :256-266 · :281-349 · :373-380 · :388-390 | 파일 전체가 썩은 게 아니다. Claude/agy/Codex 절은 다른 주제 |
| `DELIVERY.md` | :84 행렬 행(D7) · :130 제목("positive") · **:182-183** | :86 · :128 · :131-137 · :141-176 · :178-181 | :139-140은 *`--ui-server` 경로 한정*으로 수식 필요 — 안 그러면 "훅이 안 돈다"로 읽혀 오늘 측정과 충돌 |
| `ROADMAP.md` | :27("승격 판정") · :164 제목 · :173-174 스키마 펜스 | :165-172 하네스 구분·측정 서술 · :173-174의 `fresh_call` 금지 | :47-53 표에 **Copilot 행 자체가 없다** — 거짓이 아니라 구멍 |
| `scripts/raw-async-delivery/copilot-ui-server-probe.mjs` | — | 전체 | **지우지 마라.** 거절된 레인의 방법론 아카이브. 지우면 0.14.2가 실은 named-turn 계약이 사라진다. 실행도 하지 마라 |
| `CHANGELOG.md` :9 :19 :38 | — | 전체 | **건드리지 마라.** 0.14.2 발행 기록. 그 시점 범위로 정확하다 |
| `bench.sh` :22 :28 | — | — | **무관.** `github-copilot/claude-sonnet-4.6`은 pi provider 모델 id |
| `CONTRIBUTING.md:7` · `README.md:13` | — | 전체 | "two-backend ACP rail" / "Cortex is the second" — **아직 참.** Copilot ACP는 착지한 적 없다 |

**`[번들]` `--ui-server` 거절 자체는 여전히 참이다.** 지우면 안 된다:
`api.schema.json`에 `rpcMethod` 노드 **341개, 전부 `stability:"experimental"`**.
`connect`는 서술상 *"validates the **optional** connection token"*.
`session.permissions.setAllowAll`은 *"Used by **attach-mode clients** … to flip the **target
session's** permission state … swaps in unrestricted path and URL managers"*.
→ 썩은 건 그걸 **"positive lane 후보"로 그린 서술**이지 거절 근거가 아니다.

**`[코드]` D-좌표가 오늘 측정과 어긋난다.** `DELIVERY.md` 행렬의 Copilot 칸은 거절된
`--ui-server`의 D7이다. 오늘 측정은 **다른 표면**이다 — 훅/플러그인은 발화하고, argv가 떨어지고,
stdin에 `sessionId`가 있고, 첫 프롬프트에 태어난다. 도어벨이 없어 D2/D4가 해당 없다. 시민은 0.
→ 빠진 행: *"Copilot CLI plugin/hooks — not a citizen; birth on first prompt; no doorbell."*

**`[측정]` 리포 밖 — 닫혔다.** #82 이슈 **본문**의 Non-goals에 살아 있던
`No Copilot entry in META_BACKENDS`를 2026-08-20에 정정했다(코멘트 `5356078607`).
지우지 않고 **취소선 + 철회 이유**로 남겼다 — 지우면 리포는 깔끔해지고 교훈은 안 보인다.
본문 맨 위에 헤더를 달아 GLG 코멘트를 가리키고, **충돌하면 스레드가 이긴다**를 본문 안에 박았다.
반만 철회다: `FRESH_CALL_BACKENDS` 금지는 **아직 참**(시민이 아니라 형제를 여는 별개 질문).

**없는 것:** `the third backend` / `both native harnesses` 류 카디널리티 잔재는 산문에 없다.
`probe/copilot-raw-delivery` 잔재도, ACP-Copilot 코드도 없다(브랜치 삭제됨).

# §4 출생 구현 — 다음 세션 구현팀에게

바닥은 닦였다. **설계 결정은 구현팀이 한다.** 아래는 좌표이지 결정이 아니다.
줄번호는 전부 `[코드]` — 2026-08-20에 직접 열어 확인했다.

1. 플러그인 소스는 `pi/meta-bridge/entwurf-meta-receive/`.
   `[제안: terra]` Claude 유닛을 고치지 말고 **Copilot 형 유닛을 따로** 두는 쪽을 권한다 —
   기존 게이트 `check-hook-launch-topology` / `check-meta-manifest-schema`가 Claude exec-form과
   4개 PascalCase 이벤트를 고정하고 있어 섞으면 그 고정이 약해진다.
2. `pi-extensions/meta-bridge-hook.ts`의 `backend:"claude-code"` 하드코딩은 **3곳**:
   `:213`(mint) · `:245`(sender marker) · `:292`(receiver marker).
   **Copilot은 mint만 타야 한다.** marker/watch/doorbell 블록은 없는 게 정상이다.
   따라서 `META_SENDER_BACKENDS`(`pi-extensions/lib/meta-sender-identity.ts:52`,
   현재 `["claude-code","antigravity"]`)에도 넣지 않는다. codex도 거기 없다.
3. 레지스트리 4곳: `META_BACKENDS`(`pi-extensions/lib/meta-session.ts:82`) ·
   `META_BACKEND_DESCRIPTORS`(`:111`) · `META_CITIZEN_BACKENDS`(`:213`) · `pi/entwurf-capabilities.json`.
   `[제안: terra]` `wakeMode:"direct-inject"` · `deliveryLevel:"D6"`.
   `[측정]` `nativeIdLabel:"sessionId"` — 이것만 근거가 있다(네이티브 봉투의 조인 키).
   **D6는 특히 제안이다.** 도어벨 없는 백엔드에 배달 좌표를 다는 판단이라 측정이 아니다 —
   재서 정할 게 아니라 구현팀이 결정할 것이다.
   **`direct-inject`는 어댑터가 있다는 뜻이 아니다** — codex가 정확히 그 상태다.
4. **같이 닫아야 하는 게이트 구멍.** `scripts/check-entwurf-capabilities.ts:58`이 `META_BACKENDS`가
   아니라 리터럴 `["claude-code","antigravity","codex"]`를 돈다 → 새 백엔드의 descriptor가
   **비교 없이** 통과한다. 초록인데 안 지키는 게이트다. 레지스트리를 건드리는 **같은 변경에서** 닫아라.
5. 설치/닥터는 `install-meta-bridge`를 겸용으로 만들지 말고 별도로. Claude 닥터는
   sender/receiver marker·doorbell·live delivery를 요구하는데 Copilot엔 **없어야 정상**이다.
   `[측정]` `copilot plugin list` 동작 확인(설치본이 뜬다), `copilot plugin marketplace add <source>` 존재 확인.
   `[미검증]` 실제 install 실행은 **안 해봤다.** `--scope` 부재도 `--help` 근거뿐이다.
6. 첫 프롬프트 출생 의미론을 적을 자리는 **코드 주석과 doctor 출력**이지 새 산문 문서가 아니다.

# §5 Do not touch

- **ACP 재개** — `copilot --acp`, `copilotAdapter`, `AcpBackendAdapter`. 폐기됨.
  `[미검증: MODELS.md 스냅샷 2026-08-20]` pi는 이미 `github-copilot` provider로 28개 모델을 쓴다.
  `[코드]` `ROADMAP.md:21`이 중복 구현 금지를 명문화했고,
  `[측정]` `#56 Codex native citizen lane`은 그 이유로 2026-08-01T22:09:42Z에 CLOSED.
- **`--ui-server` / loopback / `~/.copilot/run/ws.*`** — 거절 유지. 근거는 §3에 `[번들]`로 검증돼 있다.
- **배달 어댑터 신설** — 도어벨이 없다. 출생과 배달을 한 입학으로 묶지 마라.
- **qualification 레인 필터** — `check-gate-qualification.ts` 헤더가 이미 닫았다. 22분짜리를
  개발 루프에서 돌리지 마라. 루프는 `pnpm run check`(39s) + 건드린 주제의 focused gate.
- **카디널리티 포획기** — "이 문장이 백엔드 개수를 주장한다"를 잡는 린터/뮤턴트 레인. 명시 거절.
- **Copilot LIVE 모델 턴 추가** — 1턴 썼다. 다음 턴은 GLG 승인 사안.
- **`copilot-ui-server-probe.mjs` 삭제·실행** — 보존만.
- **CHANGELOG 수정** — 발행 기록이다.

# §5b 이 브랜치에 같이 탄 것 — #82와 무관한 CI 수리 한 건

`scripts/check-fresh-cut-gate.sh` 의 G 절(archive-destination preflight)이
**제품 변경 0인 이 브랜치를 빨갛게 만들었다**(CI run 32370770123, 커밋 `8e6ce56`).
`[측정]` 원인은 픽스처의 시간 창이다 — G는 컷이 찍을 스탬프를 모르니 가능한 초를 미리 점유하는데
그 띠가 3초였다. 느린 러너에서 node가 `stamp()`에 늦게 닿아 띠 밖을 찍었고, 충돌이 안 일어나
컷이 **정상 성공**했는데 G1이 제품 결함으로 보고했고 G2·G3이 연쇄로 무너졌다. 원문:

```text
https://github.com/junghan0611/entwurf/actions/runs/32370770123 · job `check` · step `Run pnpm run check:full`
12:49:32.987Z [check-fresh-cut-gate] G. archive-destination preflight
12:49:33.147Z   ❌ G1 the cut proceeded into an occupied destination, or refused with the wrong status (rc=0, want 1)
12:49:33.149Z        archived: /tmp/entwurf-fresh-cut-gate.lMsRhm/store.archive-20260820T124933
12:49:33.149Z        archived: /tmp/entwurf-fresh-cut-gate.lMsRhm/mailbox.archive-20260820T124933
12:49:33.150Z   ❌ G2 half-cut generation: the store was archived before the mailbox collision was seen
12:49:33.150Z   ❌ G3 the refusal never claimed the no-op
```

`[측정]` flake 판별: run `32371224215`(`91c229e`, **같은 게이트 코드**)는 G1·G2·G3 전부 초록.

수리: 띠를 하나의 base epoch에서 파생해 **연속**으로 만들고(반복마다 `date`를 부르면 초 경계에서
띠 **중간에 구멍**이 난다), 60초로 넓히고, 미스를 **미스로** 보고하고(G2/G3은 미스일 때 채점 안 함),
미스면 **한 번 재시도**한다. 재시도가 본질이다 — 넓힌 띠는 여전히 경합이고 *"60초면 충분하다"* 는
증명할 수 없는 주장이지만, 두 번 연속 미스는 한 번의 제곱이고 행복 경로에서는 발화하지 않아 공짜다.
`check-gate-qualification`이 이 게이트를 control과 mutant 양쪽에서 돌리므로, 거기서의 미스 한 번은
빨간 칸 하나가 아니라 **22분 인벤토리 전체**의 비용이다.
`[측정]` 미스는 빨간 칸 **두 개**를 낸다(G1 miss + G2/G3 not scored). control 166/0 초록.
`[코드]` #82 레인과 무관하지만 이 브랜치의 CI를 막고 있어서 같이 실었다.

**`[측정]` IMPURE의 정체와, 그것을 찾다 내가 한 번 틀린 방법.**
qualification이 186/186 killed인데 exit 1이었다. 원인은 `scripts/__pycache__/pi_settings_io.cpython-313.pyc` —
이 게이트가 `run.sh install` → `register-pi-package.py`를 돌리고 CPython이 스냅샷에 바이트코드를 남긴다.
스냅샷은 **추적 파일만** 복사하므로 거기서만 새 파일이고, `__pycache__/`가 gitignore라 porcelain은 침묵하는데
manifest는 `.git`/`node_modules`만 빼고 전부 해시한다 → `treeClean=false porcelainClean=true`.
`smoke-pi-provider-state.sh:41`과 `smoke-meta-install-state.sh:9`가 같은 이유로 이미 가드를 심어뒀다.
수리는 `check-fresh-cut-gate.sh:58`의 `export PYTHONDONTWRITEBYTECODE=1` 한 줄.

**은퇴한 내 주장:** *"내 레인은 IMPURE의 원인이 아니다 — 게이트 단독도, 변형을 심은 상태도
`computeTreeManifest` 해시가 동일했다."* **틀렸다.** 두 팔 모두 게이트를 돌렸으니 **두 팔 모두 같은
pycache를 썼다.** post-vs-post 비교는 **양쪽에 공통인 결정론적 기록자에게 눈이 먼다.**
하네스가 재는 건 preTree(게이트 실행 **전**) 대 postTree다.
→ **오염을 찾을 땐 실행 전/후를 비교하라. 두 실행 후를 비교하지 마라.** 측정이 틀린 게 아니라 설계가 틀렸다.

# §5c 인계 — 이 세션은 여기서 끝난다

`[측정]` 브랜치 `issue-82-copilot-citizen` = `05737c5`, origin에 푸시됨, 워크트리 clean.
커밋 6개: `7b3c6d6`(규약) · `4317e89`(구멍 6) · `8e6ce56`(AGENTS) · `91c229e`(구멍 2) ·
`862211b`(1차 수리) · `05737c5`(qualified 2차 수리).
`agent-config`: `0627421` · `4b51cd0`.

**§5b 게이트 레인은 닫혔다.** `[측정]` 동결 후보에서 `check-gate-qualification` **186/186 killed,
exit 0, IMPURE 없음** · `check:full` **334s 초록** · focused gate **166/0**.
`FRESH-CUT-COLLISION-NO-MOVE`이 control-pre/post 초록 사이에서 KILLED.
`05737c5`의 CI는 아직 확인 안 했다 — **다음 사람이 첫 수로 그것만 보면 된다.**

**#82 본 레인(§4 출생 구현)은 아직 한 줄도 안 짰다.** 좌표는 §4에 `file:line`으로 있다.
`[측정]` 세 형제가 검수했고 세 세션 다 컨텍스트를 다 썼다 —
grok `20260820T202338-c35998` · terra `20260820T221544-05305c` · glm `20260820T222951-c3b15c`.
재소환하지 말고 필요하면 새로 열어라. 브리핑은 §0 규약대로 **이 파일과 #82 스레드 원문**을 가리켜라.

# §6 Verify

시민 1건이 `meta-sessions/`에 생기고 `entwurf_peers`에 뜨는 것. 그 전까지는 전부 가설이다.
