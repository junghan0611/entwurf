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
- [ ] **S2. 결정 카드.** ← CURRENT (GLG 식사 후). 수신 rail(플러그인 내 mailbox vs Gateway native-push), backend 이름, 코어 diff 목록 → GLG.
- [ ] **S3. 구현.** `plugins/openclaw` + 이름이 정해진 최소 코어 diff + 바로 옆 테스트.
- [ ] **S4. LIVE.** 10.10과 11.3 각각에서 nonce 왕복 → 자기 정체성으로 답신 → 재접속.
- [ ] **S5. 오라클 Docker.** 별도 단계. S4 전에는 손대지 않는다(운영 10.9 / 8b18b55).

# NOW

- **다음 한 행동:** S2 결정 카드를 만든다. 수신 방식(플러그인 Gateway 메서드 doorbell vs 외부 `chat.send`), 발신 방식(플러그인 도구가 ctx로 entwurf에 전달하는 경로), birth 시점(session_start 미발화이므로 첫 도구 호출이나 명시 등록), 세대 처리(lifecycleRevision), backend 이름, 코어 diff 목록이 들어간다. 설계 검토는 별도 Opus 형제가 맡는다.
- **역할:** 실무 코디 = `20261015T085719-9fc008`(Claude Code). 운영 코디 = `20261007T132839-b22677`(pi-durable, 단계 전환마다 짧게 보고). S1 Sonnet 2 — 10.10 = `20261113T120646-e9a750`, 11.3 = `20261113T120652-6cc29a`(콜백 nonce 일치). S3 구현은 별도 Opus 형제가 맡는다(GLG: 실무 코디는 구현하지 않는다). S2 설계 검토 Opus는 미개설. 커밋·push는 GLG.
- **보고 경로:** 형제 → 9fc008만 사용. 운영 코디와 #142 lane에 직접 보내지 않는다.

# 결정 (GLG 2026-11-13)

- 대상 버전: **2026.10.10**(10.x 안정 라인 최신)과 **2026.11.3**(11.x Latest). 운영 10.9는 S5에서 다룬다.
- 같은 날 갱신: 11.3을 먼저 끝까지 잰다(GLG는 11.x 이전을 유력하게 본다). 10.10 lane은 M0 이후 일시정지했고, 로그인하지 않았다.
- 두 lab 공통 [측정]: host node 24.18.1(SQLite 3.51.2)은 OpenClaw의 WAL 가드에 걸려 거부된다(engines는 24.x 허용과 불일치). lab에서는 Nix store의 nodejs-24.21.0(sqlite 3.53.3)을 쓴다. pnpm 11 ignored-builds는 `openclaw` 하나만 승인했다.
- 테스트 에이전트: OpenClaw 자체 GPT(openai-codex) 로그인, 모델 **luna**. 자격증명은 복사하지 않는다. 로그인은 GLG가 직접 한다.
- 구조: OpenClaw 쪽 플러그인은 `plugins/openclaw`(herdr 플러그인과 같은 결). entwurf 코어는 이름이 정해진 최소 diff만 받는다.
- 이름 메모: ROADMAP "Deprecated"의 옛 `plugins/openclaw`(2026-06, pi-shell-acp wrapper)는 다른 트랙이다. 착수 시 ROADMAP에 새 트랙임을 한 줄로 남긴다.

# S2 초안 — remote-pair 패턴 차용 (GLG와 합의한 방향, 운영 코디 검토 대기)

- **발신 (OpenClaw → 형제):** 플러그인 도구 `entwurf_v2`는 ctx에서 (agentId, sessionKey)를 꺼내고 `assertInvocationCurrent()`를 통과한 뒤 claim JSON을 만든다. 이 claim을 stdin으로 `entwurf openclaw-receive`(가칭) 입구에 건넨다. 입구는 선언과 대조해, 맞지 않으면 아무것도 바꾸기 전에 거절하고 맞으면 기존 로컬 v2 dispatch로 넘긴다. 종료 코드 계약은 remote-pair-receive와 같다(0/4/3/2/1). 플러그인은 entwurf 코드를 import하지 않는다.
- **수신 (형제 → OpenClaw):** backend `openclaw` record + 플러그인 Gateway 메서드. 세션이 busy면 `steerActiveRun`, idle이면 next-turn 주입. 발신자 envelope는 본문에 싣는다(M2: hidden internal_system).
- **정체성/birth:** 운영자 선언 파일 하나(0600, record store 옆)에 `gardenId ↔ (agentId, sessionKey)`를 적는다. 선언된 고정 세션만 시민이다. session_start 훅에 의존하지 않는다(M3).
- **신뢰 모델:** claim은 같은 운영자 계정이라는 전제 위의 범위 제한일 뿐 인증이 아니다(remote-pair 문구 그대로). ambient carrier는 읽지 않는다.
- **S5 컨테이너:** 경계는 마운트로 넘지 않고 전송으로 넘는다. 컨테이너 → 호스트 입구 실행(수단은 미측정), 호스트 → 컨테이너는 공개된 loopback Gateway 메서드다. #109의 경로·pid-ns 축을 피한다.
- **열린 결정:** reset 세대 처리(sessionId 불변, lifecycleRevision이 ctx에 없음), 수신 메서드를 부르는 쪽의 Gateway 인증(토큰 보관 위치; Rule 9), `/new`로 새로 생긴 세션의 취급, backend 이름, 코어 diff 목록(입구 명령 1, backend 등록·reader roll-forward, 수신 plan 1).

GLG 동의 (2026-11-13): 코디 검토 전부에 동의. agy native 행은 ACP로 대체되면 제거할 예정이므로 예외의 선례로 삼지 않는다.

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
