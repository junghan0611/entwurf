# NEXT — #160 OpenClaw citizen (branch `160-openclaw`)

# RAIL — 현재 좌표

- [x] **S0. 레일.** 브랜치·이 문서·팀 구성. GLG 결정 2026-11-13 thinkpad.
- [x] **S1. 측정 (11.3).** M0–M5를 완료하고 9fc008이 영수증을 샘플 검수했다. 10.10은 M0와 무로그인 범위까지만 재고 일시정지했다. 원 영수증: `~/.local/share/entwurf-lab/160/openclaw-2026.11.3/receipts/`(51개).
  - M1: 플러그인 도구 ctx가 팩토리와 execute 모두에서 agentId·sessionKey·sessionId를 받는다. 따라서 sender join은 (agentId, sessionKey)로 할 수 있다.
  - M4: stdio `mcp.servers`에는 `_meta`·세션 식별자·OPENCLAW env가 0이고, 런마다 새 프로세스가 뜬다. MCP 경로로는 sender join이 불가하다.
  - M2: busy일 때 `steerActiveRun`은 steered:true, idle일 때 `enqueueNextTurnInjection`은 모델이 소비했다. 둘 다 hidden internal_system이므로 발신자 표식은 본문에 실어야 한다.
  - M3: reset은 sessionId를 유지한다(세대 식별자는 lifecycleRevision이고 ctx에는 없다). `session_start`는 생성 시 발화하지 않는다. 종료 시에는 `gateway_stop` 뒤 session_end(shutdown)가 온다.
  - M5: 첫 ack는 messageSeq를 포함하고, dedupe ack는 `status:"ok"`에 messageSeq가 없다. conflict는 `chat-request-conflict`다.
  - 제약: `mcp set`은 Gateway가 오프라인일 때만 가능하다. 기본 codex 런타임은 사용할 수 없다. 플러그인 설치에는 2단 동의 게이트가 있다.
- [x] **S2. 결정 카드.** 4184c5가 작성했고 9fc008이 영수증을 확인했다. GLG가 7절 1–5를 권고대로 승인했고, 6은 oracle 측정으로 닫았다(2026-11-13).
- [ ] **S3. 구현.** ← CURRENT: 별도 Opus 구현 형제. 결정 카드 6절의 코어 diff 7항목과 `plugins/openclaw`, 그리고 바로 옆 테스트.
- [ ] **S4. LIVE.** 11.3 하나에서 nonce 왕복 → 자기 정체성으로 답신 → 재접속, 그리고 fresh 후보 (a)–(d).
- [ ] **S5. 오라클 Docker.** 별도 단계로, 운영을 11.3으로 맞추는 일과 함께 한다. S4 전에는 손대지 않는다(운영 10.9 / 8b18b55). 수신 CLI는 `docker exec openclaw-gateway openclaw …` 후보다.

# NOW

- **다음 한 행동:** S3 Opus 구현 형제를 열어 결정 카드대로 구현한다. 커밋은 GLG가 정한다.
- **역할:** 실무 코디 = `20261015T085719-9fc008`(Claude Code). 운영 코디 = `20261007T132839-b22677`(pi-durable, 단계 전환마다 짧게 보고). S1 Sonnet 2 — 10.10 = `20261113T120646-e9a750`, 11.3 = `20261113T120652-6cc29a`(콜백 nonce 일치). S3 구현은 별도 Opus 형제가 맡는다(GLG: 실무 코디는 구현하지 않는다). S2 설계 Opus = `20261113T143538-4184c5`(콜백 nonce 일치). 커밋·push는 GLG.
- **보고 경로:** 형제 → 9fc008만 사용. 운영 코디와 #142 lane에 직접 보내지 않는다.

# 결정 (GLG 2026-11-13)

- 대상 버전: **2026.11.3 하나** (GLG 2026-11-13 갱신: 여러 버전을 고려하지 않는다. 운영도 S5에서 11.3으로 맞춘다). 처음에는 10.10과 11.3 둘이었다. 10.10 lane은 M0까지만 재고 종료했으며, 그 영수증은 `~/.local/share/entwurf-lab/160/openclaw-2026.10.10/receipts/`에 보존한다.
- 같은 날 갱신: 11.3을 먼저 끝까지 잰다(GLG는 11.x 이전을 유력하게 본다). 10.10 lane은 M0 이후 일시정지했고, 로그인하지 않았다.
- 두 lab 공통 [측정]: host node 24.18.1(SQLite 3.51.2)은 OpenClaw의 WAL 가드에 걸려 거부된다(engines는 24.x 허용과 불일치). lab에서는 Nix store의 nodejs-24.21.0(sqlite 3.53.3)을 쓴다. pnpm 11 ignored-builds는 `openclaw` 하나만 승인했다.
- 테스트 에이전트: OpenClaw 자체 GPT(openai-codex) 로그인, 모델 **luna**. 자격증명은 복사하지 않는다. 로그인은 GLG가 직접 한다.
- 구조: OpenClaw 쪽 플러그인은 `plugins/openclaw`(herdr 플러그인과 같은 결). entwurf 코어는 이름이 정해진 최소 diff만 받는다.
- 이름 메모: ROADMAP "Deprecated"의 옛 `plugins/openclaw`(2026-06, pi-shell-acp wrapper)는 다른 트랙이다. 착수 시 ROADMAP에 새 트랙임을 한 줄로 남긴다.

# S2 결정 카드 — OpenClaw 시민 (S2 설계 형제 작성, Claude Code, 2026-11-13 thinkpad, 미커밋)

읽는 법: **[측정]** = 영수증 있음(lab 경로는 `~/.local/share/entwurf-lab/160/openclaw-2026.11.3/receipts/`, 이하 `R/`), **[file:line]** = 소스·문서 판독, **[미측정]** = 열린 사실. 각 항목은 "사실" 상자와 "설계" 상자를 나눈다. 설계 상자는 제안이지 사실이 아니다. 이 카드는 S2 초안(remote-pair 차용)과 아래 운영 코디 검토를 흡수해 대체한다.

## 0. 이 카드가 S2 초안에서 바꾼 것 (먼저 읽을 것)

- **수신 doorbell을 플러그인 steer/next-turn에서 Gateway `chat.send {queueMode:"steer"}`로 바꾼다.** 근거: S1의 idle next-turn은 스스로 턴을 깨우지 않았다. `R/m2-nextturn-live.txt`는 enqueue 뒤 별도 `chat.send`("## normal turn")로 턴을 시작했고, 태그 문서도 "consuming an entry is not a receipt"이며 steer는 "does not automatically enqueue a later turn"이다(`docs/hooks/prompt-and-session.md`, `R/m2m3-doc-reading.txt`). 반면 이번 S2 측정에서 `chat.send queueMode:"steer"` 한 호출이 두 상태를 모두 덮었다 [측정 `R/s2-steer-live.txt`, `R/s2-steer-busy-live.txt`, 아래 4절].
- **플러그인 Gateway 메서드는 인증을 줄여 주지 않는다.** 그 메서드를 부르는 쪽도 operator scope 연결이 필요하다(echo-ctx 메서드가 `scope:"operator.write"`로 등록됨, `plugins/echo-ctx/dist/index.js`). 그리고 플러그인 안에서 다른 Gateway 메서드를 부르는 `api.runtime.gateway.request`는 "Calls from arbitrary external plugins are rejected" [태그문서 `docs/plugins/sdk-runtime/gateway-and-nodes.md` api.runtime.gateway]. 그래서 수신은 플러그인 밖, 코어의 native-push 어댑터가 맡는다.
- **선언 파일은 citizen 목록이 아니라 허용 범위(scope)다.** 고정 key와 fresh key 접두사를 함께 허용하고, 시민 여부는 V3 record가 정한다(1·2절).

## 1. 정체성과 birth

사실
- (agentId, sessionKey)는 플러그인 도구 ctx의 팩토리와 execute 양쪽에 채워진다 [측정 `R/m1-live-1.txt`: `{"agentId":"main","sessionKey":"agent:main:s1m1","sessionId":"2de2…"}`]. sessionKey 자체가 `agent:<agentId>:` 접두사를 갖는다 [측정 같은 줄].
- 세션 store는 Gateway state 루트 아래 에이전트별 SQLite다 (`state/agents/main/agent/openclaw-agent.sqlite`) [측정 `R/m5-rpc-1.txt` `"path"`]. `status`는 `runtimeVersion`만 주고 Gateway 인스턴스 id 같은 필드는 보이지 않았다 [측정 S2 `gateway call status`의 grep, 0건]. 따라서 key는 **한 Gateway state 루트 안에서만** 유일하다. 두 Gateway(예: lab 11.3과 oracle 컨테이너)는 둘 다 `agent:main:main`을 가질 수 있다 [추론, 미측정].
- `session_start`는 `sessions.create`에서 발화하지 않는다 [측정 M3]. birth를 훅에 걸 수 없다.
- record 쪽 계약: `nativeSessionId`는 store 전체에서 유일하고 writer는 store 전체를 certify한 뒤 쓴다 [AGENTS.md:37, `meta-session.ts:914-979`]. upsert는 nativeSessionId로 멱등이다 [`docs/adding-a-harness.md:223-224`].

설계
- **Gateway scope:** 운영자가 선언 파일에 Gateway마다 고정 라벨 `scope`(예: `thinkpad-lab113`, `oracle`)를 적는다. 유일성 범위 = 그 scope 하나(= 한 Gateway state 루트). 라벨은 주소가 아니라 nativeSessionId의 namespace 성분일 뿐이다.
- **nativeSessionId = `openclaw:<scope>:<sessionKey>`** (예: `openclaw:thinkpad-lab113:agent:main:s1m1`). 이 합성은 birth writer 한 곳에서만 하고, 송신 join과 수신 probe는 record에서 역으로 읽는다(record에서 sessionKey를 꺼내 쓰지, 선언에서 꺼내지 않는다).
- **단일 birth writer:** 코어 함수 하나 `birthOpenclawCitizen(decl, scope, sessionKey)`와 그것을 감싸는 entry 하나 `entwurf openclaw-birth --decl <abs> --scope <s> --session-key <k>`. 순서: 선언 범위 대조 → 해당 Gateway에 `sessions.describe {key}`로 존재 확인(`session:null`이면 거절) → `upsertMetaSession({backend:"openclaw", nativeSessionId, cwd: describe의 sessionRoot})`. 호출자는 둘뿐이다: 기존 고정 세션에 대한 운영자 실행, 그리고 fresh composition(2절). 플러그인·송신 entry는 record를 쓰지 않는다(첫 발화 시 lazy birth 없음 — 수신 대상이 되려면 말하기 전에 record가 있어야 한다).
- **재등록 멱등성:** 같은 (scope, sessionKey)를 다시 birth하면 upsert가 기존 garden id에 attach한다 [`meta-session.ts:1317-1348` 3-value merge]. 다른 garden id를 새로 찍지 않는다.
- **선언 파일의 지위:** `openclaw-citizens.json`(record store 옆, 0600, remote-pair처럼 매 호출 다시 읽고 캐시하지 않음). 내용은 `{version:1, gateways:[{scope, url, configPath?}], allow:[{scope, agentId, sessionKey}], freshKeyPrefix?: {scope, agentId, prefix}}`. **gardenId를 담지 않는다.** 선언은 "이 key는 시민이 될 수 있다"까지만 말하고, "이 key의 시민은 누구다"는 record만 말한다. 선언에서 빠진 key의 기존 record는 송신·수신 모두 범위 거절(데이터는 보존, Hard Rule 8).

## 2. "선언된 고정 세션만 시민"과 visible fresh (step 9)

사실
- `sessions.create`는 key·label·model을 받아 세션을 실제로 만든다 [측정 `R/m1-live-1.txt`: `modelOverride:"gpt-6-luna"`, `modelOverrideSource:"user"`; S2 `s2steer`도 같음]. label은 store 안에서 유일하게 claim된다 [태그문서 `docs/gateway/protocol/rpc-session-control.md:83`].
- TUI는 정확한 key로 열 수 있다: `openclaw tui --session <key>`, 첫 메시지 `--message <text>` [측정 `tui --help`]. 모델·권한 폭을 받는 TUI 인자는 없다 [측정 같은 help].
- TUI footer는 "agent + session + model …"을 늘 보인다 [태그문서 `docs/web/tui.md:57,70`]. footer에 label이 나오는지, 임의 문자열(garden id)을 띄울 표면이 있는지는 [미측정].
- tool 정책 같은 권한성 override는 `sessions.patch`에서 `operator.admin`이 필요하다 [태그문서 `rpc-session-control.md:65`].
- TUI 안의 `/new`·`/session`은 다른 key로 화면을 옮길 수 있다 [태그문서 `docs/web/tui.md` "Passing --session, /session, /new, or /reset remains explicit"]. `chat.send "/new"`는 같은 key의 sessionId·lifecycleRevision을 바꾸지 않았다 [측정 `R/m3-new-live.txt`] — 이 경로에서 `/new`가 무엇을 했는지는 [미측정].

설계 — 관계 정리
- 고정 세션과 fresh는 같은 규칙 하나로 묶는다: **시민 = V3 record가 있고, 그 key가 선언 범위 안에 있다.** 범위는 고정 key 목록(`allow`)과 fresh 전용 접두사(`freshKeyPrefix`, 예: `agent:main:entwurf-`) 두 형태다. fresh launcher는 접두사 안의 새 key만 만든다. 선언 파일을 entwurf가 고쳐 쓰는 일은 없다(쓰는 순간 두 번째 장부가 된다).

설계 — fresh composition 후보 (agy 예외 차용 없음)
1. 고정 managed 진입점 `entwurf openclaw --scope <s> --model <provider/model> --width agent-policy --entwurf-bootstrap <{v,target,nonce,task}>`. 임의 명령·env carrier 없음.
2. pre-mutation preflight(창을 열기 전): Gateway 도달(`--expect-url` 일치), 플러그인 설치·활성·로드, 선언에 scope와 접두사 존재, 그리고 4능력 — birth(1절 writer), MCP hand 대신 **플러그인 도구 손**, receive(4절 어댑터), visible identity.
3. `sessions.create {key: <prefix><nonce-derived>, label, model}` — 모델은 여기서 명시된다 [측정 M1].
4. `openclaw-birth` → garden id. 그다음 label을 garden id 표시용으로 바꾸거나(`sessions.patch` label, operator.write 범위로 추정 [미측정]) 처음부터 label에 nonce를 실어 둔다.
5. mux가 `openclaw tui --session <exact key> --message <callback-before-task 프레이밍>`을 연다.
6. callback: 플러그인 프로세스는 Gateway 안에서 돌기 때문에 TUI 창의 `ENTWURF_CALLBACK_*` env를 읽을 수 없다 [추론: 플러그인은 Gateway 프로세스, TUI는 WS 클라이언트 — 측정 `R/m1-live-1.txt` pid는 Gateway 쪽]. 그래서 no-arg callback 대신 **Codex 형태**를 쓴다: 첫 프롬프트가 target과 nonce를 담고, 모델이 플러그인 `entwurf_v2`로 nonce를 보낸다. sender envelope은 ctx join으로 정해지므로 nonce 상관은 표준 그대로다 [선례 `docs/adding-a-harness.md:36` codex 행].
7. LIVE: callback sender garden id = 4단계 garden id, 이어서 주소 지정 `entwurf_v2` → `native-push` 주입 → OpenClaw 자신의 턴이 답신.

판정: **성립 후보다. 다만 지금은 admission이 아니다.** 1·3·5(일부)·7의 표면은 측정되었거나 문서로 확인되지만, 다음 네 가지가 [미측정]이고 이 넷 중 하나라도 안 되면 harness를 admit하지 않는다(`docs/adding-a-harness.md:676-677`): (a) footer/header에 garden id가 보이는 표면, (b) `--width agent-policy`가 실제로 무엇을 제공하는지 — pi-durable의 "native installed-tool offering, no filter" 선례(`docs/adding-a-harness.md:650-653`)에 맞춰 명시 토큰으로만 둔다, (c) `tui --message`가 정확한 key에 첫 턴으로 들어가는지, (d) TUI 안 `/new`·`/session` 전환 때 화면과 record가 갈라지는 것을 어떻게 보이게 할지. 그때까지는 브랜치 실험이고 출하가 아니다(release stop, `docs/adding-a-harness.md:682-691`).

## 3. 송신 (OpenClaw → 형제)

사실
- ctx는 (agentId, sessionKey, sessionId)를 준다 [측정 M1]. `assertInvocationCurrent()`는 런이 끝난 뒤나 reset 뒤에 보관해 둔 ctx를 `refused: agent tool caller authority is no longer active`로 거절한다 [측정 `R/m1-stale-ctx.retry1.txt`].
- stdio MCP에는 발신자 식별이 0이다 [측정 M4]. 플러그인이 외부 명령을 띄우는 vendor 표면은 `api.runtime.system.runCommandWithTimeout(cmd,args,opts)`이며 timeout 결과를 code 124로 준다 [태그문서 `docs/plugins/sdk-runtime/state-and-system.md` api.runtime.system].
- remote-pair entry의 종료 계약과 strict claim 파서가 선례다 [`scripts/remote-pair-receive.ts:15-24`, `pi-extensions/lib/remote-pair-receive.ts:114-133`].

설계
- **경로:** 플러그인 도구 `entwurf_v2(target, message, wants_reply)` → execute에서 claim 생성 → `runCommandWithTimeout(<pluginConfig.entwurfBin 절대경로>, ["openclaw-send", "--decl", <pluginConfig.declPath 절대경로>], {stdin: claim})` → entry가 선언 범위 대조 → record join → 기존 `runAndRenderEntwurfV2FromSurface`. 플러그인은 entwurf 코드를 import하지 않는다.
- **claim 스키마 (정확히 이 키들, 그 외 키는 거절):** `{v:1, scope, agentId, sessionKey, target, message, wantsReply}`. `scope`는 pluginConfig에서(운영자가 OpenClaw 설정에 적은 값), `agentId`/`sessionKey`는 ctx에서, 나머지는 모델 인자에서 온다. sessionId는 싣지 않는다 — reset을 넘어 바뀌지 않으므로 검사할 것이 없다(5절). 검사: sessionKey가 `agent:<agentId>:`로 시작, 헤더 필드에 제어문자 없음, message ≤16000, target은 garden id 문법.
- **entry `entwurf openclaw-send --decl <abs>` 종료 계약** (remote-pair와 같은 번호, 같은 의미):
  - `0` dispatch 했고 오류 없음 — receipt JSON 1줄
  - `4` dispatch 했고 dispatch가 오류를 보고(`retry-safe:false` 포함 가능) — receipt
  - `3` 범위 거절, dispatch 안 함 — `openclaw-scope-not-declared`(scope/key가 선언 밖) 또는 `openclaw-sender-not-citizen`(선언 안이지만 record 없음/모호) — receipt
  - `2` `--decl`이 이 호스트의 정규 경로가 아님, 선언 부재·파손, claim 무효 — `{kind:"invalid"}` receipt (argv 오류는 usage만)
  - `1` 잡히지 않은 throw — receipt 없음, 플러그인은 indeterminate로 보고
  - 플러그인 쪽: 그 밖의 code, 124(timeout), 줄 수·JSON 불일치 → `indeterminate`. 재시도 없음.
- **sender envelope:** remote-pair와 달리 `external-mcp`가 아니다. entry가 (backend `openclaw`, nativeSessionId) record를 찾아 record-backed 시민 envelope을 만들고, replyable은 그 시민의 수신 probe(4절)가 alive일 때만 참이다(who-sent ≠ replyable, `docs/adding-a-harness.md:451-453`). ambient `PI_SESSION_ID` 등은 읽지 않는다.
- **`assertInvocationCurrent` 호출 시점:** execute 안에서 인자 검증과 claim 직렬화가 끝난 뒤, `runCommandWithTimeout` 직전에 **한 번**. 이것이 commit 지점이다. throw하면 도구 오류로 끝내고 프로세스를 띄우지 않는다. 띄운 뒤에는 되돌릴 수 없으므로 두 번째 호출은 의미가 없다(entry는 다른 프로세스라 ctx가 없다). 팩토리 시점 호출은 하지 않는다 — 팩토리 ctx는 보관용이지 송신 권한이 아니다.
- **신뢰 모델:** claim은 인증이 아니다. 같은 OS 계정이면 누구든 entry에 아무 선언된 (scope, sessionKey)를 주장할 수 있다. 선언은 범위 제한일 뿐이다(remote-pair 문구, `remote-pair-receive.ts:9-13`).

## 4. 수신 (형제 → OpenClaw)

사실
- **idle:** `chat.send {queueMode:"steer"}`가 새 턴을 시작했다. ack `{"runId":"s2-idle-steer","status":"started","messageSeq":1}`, 모델 답 `ALPHA` [측정 `R/s2-steer-live.txt`].
- **busy:** `sleep 30` 도구 실행 중 같은 호출이 실행 중인 run에 주입되었다. ack `{"runId":"s2-busy-steer","status":"started"}`(messageSeq 없음), transcript user 행에 `"steerTargetRunId":"s2-long"`, 최종 답 `DONE-LONG BRAVO` [측정 `R/s2-steer-busy-live.txt`]. Gateway 로그 `slow chat send 25192ms stage=steer ack=48ms` [측정 `R/s2-gateway.log`]. 문서 문구와 일치: "injects the message into that session's direct active run, or starts a new turn when the session is idle" [태그문서 `rpc-session-control.md:77`].
- **ack로는 steer와 새 턴을 구별할 수 없다**(둘 다 `status:"started"`). transcript를 봐야 안다 [측정 위 두 영수증].
- 주입된 행의 provenance는 `external_user`, transport client `cli`이다 [측정 같은 영수증]. 발신자 표식은 없으므로 envelope은 본문에 실어야 한다(native-push 공통 규칙, `docs/adding-a-harness.md:512-517`).
- **probe:** `sessions.describe {key}`는 없는 key에 `{session:null}`, 있는 key에 `hasActiveRun`·`sessionId`·`lifecycleRevision`을 준다 [측정 M5, `R/s2-steer-live.txt`].
- **dedupe:** 같은 idempotencyKey·같은 입력 재전송은 `{status:"ok"}`로 행이 늘지 않고, 다른 입력은 `chat-request-conflict` [측정 `R/m5-dedupe-live.txt`]. dedupe 보존 기간은 [미측정].
- **인증:** `openclaw gateway call`은 `--token` 없이 lab 설정의 `gateway.auth`(mode token)로 연결되었다 [측정 S2 전 호출 exit=0]. `--expect-url`은 "Fail if the resolved Gateway URL differs; preserves configured authentication" [측정 `gateway call --help`]. 필요한 scope는 `chat.send`=`operator.sessions.write`, `sessions.describe`=read 계열 [태그문서 10.9 `session-method-scopes-base.ts:7-66`, #160 comment; 11.3 재확인은 미측정].
- host node 24.18.1은 OpenClaw의 SQLite WAL 가드에 걸린다 [측정 S1]. `gateway call`이 그 가드를 타는지는 [미측정] — lab은 Nix node 24.21.0으로만 쟀다.

설계
- **rail class: native-push** (record + probe-alive, mailbox·receiver marker 없음, resume 권한 없음) [Hard Rule 10, AGENTS.md:40]. `NATIVE_PUSH_BACKENDS += "openclaw"` [`entwurf-v2-contract.ts:130`].
- **어댑터 `native-push/openclaw-gateway.ts`:**
  - probe = vendor CLI `openclaw gateway call sessions.describe --json --expect-url <decl.url> --params {"key":<record에서 꺼낸 sessionKey>}`. `session` 있음 → alive(route = {backend:"openclaw", url, configPath}), `session:null` → dead, 연결 실패·timeout·exit≠0 → indeterminate. `hasActiveRun`은 경로 선택에 쓰지 않는다(steer 호출 하나가 두 상태를 덮는다).
  - send = `openclaw gateway call chat.send --json --expect-url <url> --params {sessionKey, message:<렌더된 본문>, idempotencyKey:"entwurf-<dispatch uuid>", queueMode:"steer"}`. 성공 판정 = exit 0 ∧ `status ∈ {started, ok}`. `retriable:false`로 시작한다(Codex와 같은 보수적 선택; dedupe가 측정되어 있으니 같은 key 1회 재시도는 나중에 증거로 열 수 있다).
  - 실행은 execFile(셸 없음), bounded timeout, 선언에 `configPath`가 있으면 그 한 실행에만 `OPENCLAW_CONFIG_PATH`를 넘긴다(Copilot의 one-invocation flag 선례, `DELIVERY.md` Copilot "The flag"). entwurf는 토큰을 읽지도, argv에 싣지도, 복사하지도 않는다.
- **본문:** 메일박스 본문 SSOT로 envelope을 한 번 렌더해 그대로 주입한다(`makeNativePushSend`의 senderProvider 경로, `entwurf-v2-native-push.ts:64-90`).
- **보이는 것과 배달은 다르다:** 세션은 TUI가 닫혀 있어도 Gateway 안에 살아 있으므로 probe는 alive이고, 배달은 아무도 보지 않는 턴을 시작할 수 있다. 화면이 열려 있는지는 확인하지 않는다(remote-pair "Visibility" 문단과 같은 경계).
- **인증 소유 (GLG 결정 7-1):** 권고안 = "Gateway 인증은 그 Gateway의 운영자가 OpenClaw 자기 설정 안에 소유하고, entwurf는 vendor CLI를 실행할 뿐 credential을 만지지 않는다. entwurf가 거는 제약은 `--expect-url` 일치 하나." 경계: (i) 같은 호스트 Gateway — 운영자 계정의 OpenClaw 설정(또는 선언의 `configPath`), (ii) 컨테이너·원격 Gateway(S5) — 호스트 쪽 OpenClaw 설정의 `gateway.remote.url`+token을 운영자가 직접 둔다. 토큰 자동 발견·추출·복사·중계는 하지 않는다.

## 5. reset 세대 정책

사실
- `sessions.reset` 뒤 sessionId는 그대로, `lifecycleRevision`만 바뀐다 [측정 `R/m3-reset-live.txt`: `849027d7…` ← `f85f95ef…`]. ctx에는 lifecycleRevision이 없다 [측정 M1 ctx 키]. reset은 retained ctx를 무효화한다 [측정 `R/m1-stale-ctx.retry1.txt` "assert retained AFTER reset → refused"].
- `sessions.reset`·archive 류는 `expectedSessionId` CAS를 받지만 "does not reject changes that keep the same session ID, including … reset-in-place" [태그문서 `rpc-session-control.md:69`]. 즉 sessionId는 세대 fence가 될 수 없다.

설계
- **sessionId 불변을 세대 증거로 쓰지 않는다.**
- 권고 정책: **garden id는 (scope, sessionKey) 자리에 붙고 reset을 넘어 유지된다.** reset은 같은 시민의 대화 교체로 취급한다(record 갱신 없음, lifecycleRevision을 record에 저장하지 않음 — 저장하면 V3 키 추가 + reader roll-forward가 필요하다).
- 이 정책이 막는 것과 못 막는 것: 송신 쪽 stale ctx는 `assertInvocationCurrent`가 막는다 [측정]. 수신 쪽에는 fence가 없다 — reset 직전에 보낸 형제 메시지가 reset 뒤 새 대화에 들어갈 수 있다. 이것을 받아들이는 경계로 명시한다.
- 대안(GLG가 고르면): record가 birth 시점의 `lifecycleRevision`을 들고, probe가 다르면 `native-push-target-drifted`로 거절, 재-birth가 새 garden id를 찍는다. 비용: V3 스키마 키 + 모든 reader roll-forward + reset마다 시민이 바뀌는 UX.

## 6. 코어 diff 목록 vs `plugins/openclaw`

코어 (이름이 정해진 최소 diff, 각 항목 옆 테스트)
1. **backend 등록:** `META_BACKENDS`·`META_CITIZEN_BACKENDS`·`META_BACKEND_DESCRIPTORS`에 `openclaw`, `pi/entwurf-capabilities.json`에 `wakeMode: native-push` 행. **reader roll-forward:** 빌드 → 모든 공유 reader 재배포 + doctor → 살아 있는 MCP bridge child 재시작 계획 → 그 뒤에만 첫 record birth [`docs/adding-a-harness.md:168-190`].
2. **선언 reader** `openclaw-citizens.json` (strict 스키마, 경로 정규화, 매 호출 재독, 파손 시 이름으로 거절) — `remotePairOptInPath` 옆.
3. **birth entry** `entwurf openclaw-birth` + `birthOpenclawCitizen` (1절).
4. **송신 entry** `entwurf openclaw-send --decl` + claim 파서 + 종료 계약 + record-backed sender 조립(`meta-sender-identity.ts`에 openclaw claim join 한 갈래) (3절).
5. **수신 plan:** `NATIVE_PUSH_BACKENDS += openclaw`, `NativePushRoute` openclaw 변형, 어댑터 `native-push/openclaw-gateway.ts`, decider·self-address의 replyable 연결 (4절).
6. **fresh composition/preflight:** `FRESH_CALL_BACKENDS += openclaw`, 콜백 도구 이름 열(`FRESH_CALL_CALLBACK_TOOL`: Codex처럼 `entwurf_v2`), managed verb `entwurf openclaw`, 5축 preflight, 세 공개 표면 동기(`test/fresh-call-surfaces.contract.test.ts`), `check-harness-admission-parity`, LIVE `smoke-openclaw-fresh-live` (2절).
7. **CLI·문서:** `ENTWURF-CLI.json`에 새 verb들(S9가 비교), DELIVERY 행, `docs/adding-a-harness.md` source map 행, ROADMAP에 새 트랙 한 줄.

`plugins/openclaw` (OpenClaw 쪽, entwurf import 없음)
- `openclaw.plugin.json` + `dist/index.js`: `contextVersion: 2` 도구 `entwurf_v2`(필요하면 읽기 전용 `entwurf_peers`도 같은 entry 경유로), pluginConfig `{entwurfBin, declPath, scope}` — 셋 다 운영자가 OpenClaw 설정에 적는 절대값, 탐색 없음.
- `runCommandWithTimeout` 호출, receipt 분류(0/4/3/2 + 그 밖은 indeterminate), `assertInvocationCurrent` 위치.
- 설치·doctor 문서(2단 동의 게이트 [측정 S1]), 바로 옆 `*.test.mjs` hermetic 테스트(가짜 entry로 claim·종료코드 분류).
- **수신 코드는 플러그인에 두지 않는다**(4절). 플러그인 steer/next-turn/system-event 경로는 쓰지 않는다.

## 7. GLG만 정할 것

1. **수신 인증의 소유와 경계:** "OpenClaw 운영자가 자기 OpenClaw 설정에 소유, entwurf는 vendor CLI만 실행하고 `--expect-url`만 강제"(권고) — 이것으로 정하는가, 아니면 다른 경계(선언이 가리키는 토큰 파일 등)를 원하는가.
2. **수신 표면을 Gateway `chat.send queueMode:"steer"`로 바꾸는 것**(transcript에 `external_user` 행으로 남고 발신자 표식은 본문 envelope뿐) — S2 초안의 플러그인 steer/next-turn 대신.
3. **reset 정책:** garden id가 reset을 넘어 유지(권고, 수신 쪽 무 fence를 경계로 수용) vs reset마다 새 시민(lifecycleRevision을 record에 저장).
4. **backend 이름 `openclaw`와 nativeSessionId 합성 `openclaw:<scope>:<sessionKey>`**, scope는 운영자가 정하는 Gateway 라벨.
5. **fresh 경로 채택 여부:** 2절 후보(Codex 형 callback = `entwurf_v2` 인자형, `--width agent-policy` 명시 토큰)를 S3/S4 측정 대상으로 승인하는가. 미측정 (a)–(d) 중 하나라도 실패하면 OpenClaw를 admit하지 않고 브랜치 상태로 둔다는 것을 확인.
6. ~~host node 문제~~ **닫힘** [측정 2026-11-13 ssh oracle]: oracle host의 node는 24.18.1 / sqlite 3.51.2이고 `openclaw`는 없다. 운영 컨테이너 `openclaw-gateway`는 node 24.22.1 / sqlite 3.53.4, OpenClaw 2026.10.9 (8b18b55)다. 운영 OpenClaw는 이미지 node로 돌기 때문에 host node와 무관하다. S5의 수신 CLI는 `docker exec`로 컨테이너 쪽을 쓰므로 nixos-config의 node 정리는 필요 없다. host에 직접 설치하는 경우(thinkpad lab)만 node ≥24.19가 필요하다.

**GLG 승인 (2026-11-13):** 1–5를 권고대로 승인했다. 1은 운영자 OpenClaw 설정이 인증을 소유하고 `--expect-url`로 강제한다. 2는 `chat.send queueMode:"steer"`, 3은 garden id 유지, 4는 `openclaw` / `openclaw:<scope>:<sessionKey>`다. 5는 fresh를 S3/S4 측정 대상으로 삼되, (a)–(d) 중 하나라도 실패하면 브랜치에 남긴다.

## 남은 측정 (S3/S4가 닫을 것)

- footer/header의 garden id 표시면, `--width` 의미, `tui --message` 첫 턴, TUI `/new`·`/session` 전환 시 가시성 (2절 a–d).
- `sessions.patch label`이 operator.write로 되는지, footer에 label이 나오는지.
- chat.send dedupe 보존 기간, 11.3에서 메서드별 scope 재확인.
- 측정에 쓴 lab 세션 `agent:main:s2steer`는 lab store에 남아 있다. Gateway는 내렸다 [측정: 18811 listen 없음, openclaw 프로세스 없음].

GLG 동의 (2026-11-13, 초안 단계): 코디 검토 전부에 동의. agy native 행은 ACP로 대체되면 제거할 예정이므로 예외의 선례로 삼지 않는다.

## 운영 코디 검토 (b22677, 2026-11-13 14:32) — 방향에 억지는 없음. 그대로 입장시키지 말아야 할 두 지점

1. **선언 파일은 허용 범위일 뿐 두 번째 주소 원장이 아니다** (AGENTS.md:32,37).
   - gardenId는 기존 V3 record에서 얻는다. 선언에 gardenId를 적더라도 검증된 참조일 뿐이고, mint·갱신·조회 권위가 아니다.
   - S2에서 함께 명시할 것: birth의 단일 writer, 재등록 멱등성, (agentId, sessionKey) 유일성이 성립하는 Gateway 인스턴스 범위.
2. **c — agy 예외는 이식할 수 없다** (adding-a-harness.md:611–637,682–696; DELIVERY.md:129).
   - fresh 후보가 되는 조건: 새 세션을 실제로 만들고 → 그 정확한 key의 TUI를 고정 managed launcher로 연다 → 모델과 권한 폭을 명시한다 → garden-id 표시면을 둔다 → callback-before-task와 nonce → 주소 지정 수신 LIVE.
   - 기존 고정 key에 TUI만 붙이는 것은 fresh가 아니다.
   - "선언된 고정 세션만 시민"과 동적 fresh의 관계를 먼저 풀고, fresh composition과 preflight를 코어 diff 목록에 넣는다.
   - 미측정인 동안 브랜치 실험은 해도 되지만 지원·출하는 아니다.

나머지 판단:
- **a.** 토큰이 있다는 것만으로 credential mediation이 되지는 않는다. 다만 자동 발견·추출·복사·로그인·중계는 승인 범위 밖이다. 인증을 누가 소유하는지는 GLG 결정 카드에 둔다. 토큰을 피하려고 watcher+mount로 바꾸지 않는다. "#109 축을 피했다"는 아직 가설이다.
- **b.** reset 후 같은 garden id를 유지하는 것은 정책으로 선택할 수 있다. 다만 sessionId 불변을 세대 fence의 증거로 쓰지 않는다. run-current 검증과 reset 경계의 stale 거절은 별도 증거다.

# S1 브리프 — 측정 형제가 읽는 원본

## 근거 (원본을 읽을 것, 요약을 믿지 말 것)

- 이슈 본문: `gh issue view 160` (+ GLG 댓글: agy ACP는 별도 축).
- 하네스 경로: `docs/adding-a-harness.md` §0과 §1(벤더 측정 6항목). omp 행(프로세스 내 watch + announce-only doorbell)이 플러그인 가설의 선례다.
- 역사: #109 종료 코멘트(컨테이너 축, "argv 실측 없이 말하지 않는다").
- 태그 문서: `gh api "repos/openclaw/openclaw/contents/docs/<path>?ref=v2026.10.10" -H "Accept: application/vnd.github.raw"`. 라이브 docs 사이트는 main 기준이라 버전 증거가 아니다.

## 격리 규칙 (위반 시 즉시 STOP)

- 기존 `~/.openclaw`(2026-05 잔재)는 읽지도 쓰지도 않는다. state/config는 버전별 lab 루트로만 향하게 한다. 그것을 보장하는 env/flag부터 M0에서 재고, 보장되지 않으면 설치 후 첫 실행 전에 멈춘다.
- lab 루트: `~/.local/share/entwurf-lab/160/openclaw-<version>/`(prefix, state, receipts). 리포 안이나 /tmp 개발 클론에는 두지 않는다.
- 설치: NixOS pnpm으로 lab prefix에만 설치한다(`pnpm add --dir <lab>/prefix openclaw@<version>`). global·corepack·npm -g는 금지.
- Gateway: loopback만 사용한다. 포트는 10.10=18810, 11.3=18811. 채널(텔레그램 등)·`--deliver`·외부 발송은 금지한다.
- 오라클·운영 봇·`~/repos/gh/openclaw-config`·`~/.pi/agent` record/mailbox에는 쓰지 않는다. entwurf 소스도 편집하지 않는다.
- 첫 예상 밖 실패는 raw 출력과 exit을 보존하고 STOP한다. 다른 방법으로 다시 시도하지 않는다. 비밀값·토큰은 출력하지 않는다.

## 측정 항목

- **M0 설치 사실:** 정확한 버전·SHA·node 요구, state/config 경로를 정하는 env/flag, `openclaw --help` 상위 명령, plugin 설치 명령의 형태.
- **M1 플러그인 도구의 세션 문맥:** 플러그인이 등록한 도구가 호출될 때 agentId / session key / sessionId 중 무엇을 받는가. 플러그인 SDK 타입과 실제 호출로 확인한다(최소 echo 플러그인). 답신 sender join의 결정 측정이다.
- **M2 플러그인 → 자기 세션 메시지 주입:** 플러그인 API로 특정 session key에 user/system 메시지를 넣고 턴을 깨울 수 있는가(doorbell). 메시지가 busy일 때와 idle일 때 각각 어떻게 되는가.
- **M3 생명주기 hook:** 세션 시작·`/new`·`/reset`·gateway 재시작 때 플러그인이 받는 이벤트와 그 시점(record birth 후보).
- **M4 `mcp.servers`:** 에이전트용 stdio MCP 서버 프로세스가 받는 env·argv·요청 metadata에 세션 식별자가 들어 있는가. 세션마다 프로세스가 생기는가, 공유되는가.
- **M5 Gateway RPC 대조:** `sessions.describe`(exact key), `chat.send` idempotencyKey 재시도·충돌 응답, ack 필드(11.x의 admission/persistence 분리 여부)를 raw로 기록한다.

## 산출물

- `<lab>/receipts/`에 원 영수증을 남긴다. 9fc008에게 보내는 보고에는 판정을 가르는 줄을 붙여 넣는다(host-local 경로만 보내지 않는다).
- 각 항목: [측정] / [태그문서 file:line] / [미측정] 표기. 가설과 사실을 다른 상자에 둔다.
