# NEXT — #82 Copilot garden citizen (branch lane)

> Disposable boot sector for `issue-82-copilot-citizen`. The issue thread is the
> durable chronology; delete this file before merge after promoting the last facts.

# RAIL — 현재 좌표

- [x] **1. Citizen birth + visible identity** — record, hook, doctor, statusline; real Copilot birth accepted
- [x] **2. MCP hand** — owned/reversible user MCP config; native `entwurf_*` invocation accepted
- [x] **3. Outbound sender identity** — own garden id + `origin:meta-session`; pushed CI green
- [x] **4. Evidence/docs checkpoint** — `9dc03c0` (extension LIVE receipt + raw reproducer + 문서 정정)
- [x] **5. Inbound receive implementation** — receiver extension + installer/doctor + gate 29셀 + mutants 13 + amendment (doctor clean-log 셀·hermetic 체인 합류) — `9b4e248`로 로컬 커밋됨
- [x] **6. Operator LIVE acceptance** — **수용됨 2026-08-23**. garden `20260823T181316-d9f6ba`에서 enqueue→doorbell→drain→read-receipt 사슬 완결 (영수증은 아래 LIVE RECEIPT)
- [x] **7. Final amendment bundle** — managed launcher `entwurf copilot`, registry no-cache reread, doctor argv discovery, permission/launch docs, D6/D7-partial — product SHA `31ebea0`
- [x] **8. Grade landing + push** — 독립 review PASS → amendment → qualification 230/230 → frozen `check:full` 370s exit0 → commit/push `31ebea02ed0cb63cf866e28dd1b50ff419684926` + exact-SHA CI SUCCESS + GLG managed-launch LIVE
- [ ] **9. Copilot visible fresh parity** — managed `entwurf copilot` + inherited PI identity env 소독 + explicit model/permission + birth/MCP/receiver preflight + exact-nonce callback LIVE. 합격 기준은 RAIL 10이 문서화한 `docs/adding-a-harness.md` step 9의 7개 조항이며, 이것이 비면 landing 금지
- [ ] **10. Universal harness support contract + OMP coordinate (docs-only)** — lifecycle parity·host-only citizenship·foreign-config reuse·identity-env 경계를 고정하고 OMP measured/pending 좌표를 보존. 이 계약은 RAIL 9를 구속하지만 OMP 제품 구현·installer·gate·admission을 이번 #82에 추가하지 않음
- [ ] **11. Subtraction review + landing** — branch 전체 과잉/중복 판독 + `DELIVERY.md`의 모든 `managed` 용례를 invocation/config ownership 뜻으로 재판독 → 필요한 qualification → frozen `check:full` → main exact-SHA CI → durable main SHA에서 #82 close → mode별 SemVer

현재 좌표: 1–8의 Copilot native delivery는 완료됐지만, GLG의 **2026-08-24 이 세션 직접 결정**으로
#82의 목적은 Copilot을 visible fresh까지 대칭 수준으로 마무리하고, 그 과정에서 다음 harness가 흔들리지
않을 보편 support contract를 남기는 것으로 확정됐다. `issuecomment-5386449092`는 대칭 원칙의 출처지만
그 코멘트의 "별도 후속 이슈" 배치 조항은 이 직접 결정으로 대체됐다. CURRENT는 **RAIL 9 — Copilot
visible fresh parity**이며, 이미 GREEN인 RAIL 10 docs-only candidate가 합격 기준을 선행 정의한다. OMP는
이번 #82에서 규칙과 measured/pending 좌표만 남기고, main landing·release·#82 close 뒤 **다음 이슈**에서
제품 지원을 논의한다. Hidden `--ui-server` / D3·D8 재개는 계속 금지다.

# NEW HARNESS CONTRACT / OMP COORDINATE — 2026-08-24

## 외부 계약 — 지원한다고 부르기 위한 최소치

- **핵심 대칭:** visible top-level birth, visible garden id, trusted sender identity, inbound receive,
  explicit model/permission의 visible fresh, exact callback correlation. 이 중 하나를 벤더의 권위 있는
  surface로 만들 수 없으면 그 harness를 admit하지 않는다.
- **host 하나만 citizen:** 내부 subagent/session은 별도 record·sender·receiver를 절대 얻지 않는다.
  내부 홉의 MCP 호출은 host 한 garden id의 손으로 귀속된다. top-level을 fail-closed로 구분할 벤더
  사실이 없으면 admit하지 않는다.
- **설정 발견 ≠ 지원:** vendor가 이미 읽는 foreign MCP config는 복제·소유하지 않지만, effective
  source·shadowing·connection·expected tool·실제 tool-name dialect를 doctor와 LIVE로 증명한다.
- **managed launch:** inherited `PI_SESSION_ID`/`PI_AGENT_ID`를 제거하고 explicit model/permission 및
  capability preflight를 소유한다. raw vendor launch를 supported fresh로 포장하지 않는다.
- **stop rule:** 새 watcher/orchestrator나 vendor 내부 team↔entwurf bridge를 만들지 않는다. 판별 조건을
  업그레이드마다 덧대야 하거나 evidence가 product보다 커지면 멈추고 GLG에게 보고한다.

## OMP facts / pending

- `[측정]` oracle의 `omp`는 v18.0.0 단일 aarch64 binary이고 source checkout은 tag v18.0.0
  (`4142f881`)이다. 같은 version 문자열은 확인했지만 설치 binary와 checkout의 동일 build는 미증명.
- `[읽음]` OMP subagent는 parent의 extension path를 자기 session API에 재bind하고 자기
  `session_start`를 emit한다(`task/executor.ts:3075-3133,3305`). 따라서 "같은 OS pid니까 별도
  citizen이 될 수 없다"는 과거 판정은 폐기한다. naive birth는 subagent마다 record를 mint할 수 있다.
- `[읽음]` visible TUI는 extension context `mode:"tui"`; subagent는 default `"print"` +
  `hasUI:false`다. birth는 `mode === "tui"` allowlist에서만 열고 나머지는 refuse-and-log한다.
  이 판별의 실제 top-level/subagent LIVE 관측은 pending이다.
- `[읽음]` OMP는 Claude MCP config를 priority 3으로 번역하고 subagent는 parent MCP manager를 borrow한다.
  config writer는 0줄로 재사용 가능하지만 readiness proof는 0줄이 아니다. sanitizer 계산상 callback tool은
  `mcp__entwurf_bridge_entwurf_v`이며 실제 live tool 목록 관측은 pending이다.
- `[읽음]` OMP extension `ctx.ui.setStatus`는 `FooterComponent`의 extension status line으로 이어지므로
  garden id 표시는 가능하다; real TUI render receipt는 pending이다.
- `[읽음]` bridge는 meta marker보다 `PI_SESSION_ID`/`PI_AGENT_ID` carrier를 먼저 믿는다. pi bash에서
  OMP를 직접 열면 부모 pi identity를 참칭할 수 있으므로 managed native launch의 env 소독이 선결이다.
- `[pending]` fresh prompt 위치와 `--model` 공백/등호 dialect, live callback tool 이름, TUI/subagent mode,
  birth→footer→sender→receive 사슬, receive rail 선택, record-authoritative resume 가능성.

# LIVE RECEIPT — 관리 수용, 2026-08-23 (호스트 측정, 두 세션에서 독립 확인)

garden `20260823T181316-d9f6ba` / native `20fe30c8-b2bc-4600-91a0-8a409131be51` / Copilot CLI 1.0.80.

| 축 | 위치 | 값 |
|---|---|---|
| record | `~/.pi/agent/meta-sessions/20260823T181316-d9f6ba.meta.json` | schemaVersion 3, backend `copilot`, 위 native id |
| join | `~/.pi/agent/meta-bridge-receive-copilot.log:1` | `09:12:51.789Z joined session=20fe30c8… host=2933805 armed=false` |
| arm | 같은 로그 `:2` | `09:13:19.515Z armed garden=20260823T181316-d9f6ba owner=2933903 host=2933805` — **owner ≠ host**: marker 소유자가 extension 자식이라는 설계가 LIVE에서 확인됨 |
| doorbell | 같은 로그 `:3-4` | `09:23:41.241Z doorbell fresh=1 unread=1` → `09:23:41.342Z rang unread=1` |
| enqueue/read | `~/.pi/agent/meta-mailbox/20260823T181316-d9f6ba/state.json` | lastEnqueuedAt `09:23:41.235Z`, lastReadAt `09:23:56.480Z` → **doorbell→read 15.24초** |
| 본문 | 같은 dir `2026-08-23T09-23-41-235Z-ba9a0f.msg.delivered.read` | sender `gpt-5.6-terra` / `20260822T185419-d6ef56`, wants reply yes |
| reply | Copilot 09:24:03.880Z 봉투 — same gid, `origin:meta-session`, `replyable:true`, body `LIVE 수용 확인: entwurf_inbox_read로 읽었고 read-receipt가 기록되었습니다.` | **상속된 사실**: 이 봉투만은 transcript로 독립 회수되지 않았다 → D7이 partial인 이유 |

판정: managed receive **D6 PASS**(동일 record/native/gid 사슬 위에서 모델이 응답), **D7 PARTIAL**(별도 garden reply + read receipt는 관측, completion taxonomy 전체·장기 운영은 아님), evidence **L4**(한 호스트·한 왕복). **D3**(관리형 두 번째 세션 격리)는 과거 B 관측의 결정적 로그가 scratch cleanup 전에 보존되지 않아 **pending**. **D8 unproven**. `replyable:true`는 armed marker가 있을 때의 사실이지 backend 상수가 아니다.

# LIVE RECEIPT — final GLG managed launch, 2026-08-23

garden `20260823T225651-65945c` / native `51d64392-8f36-4bb0-ac12-f3db6653947c`. GLG가 보이는 터미널에서 `entwurf copilot` 실행.

| 축 | 값 |
|---|---|
| product SHA | `31ebea02ed0cb63cf866e28dd1b50ff419684926` |
| CI | https://github.com/junghan0611/entwurf/actions/runs/32642653573 SUCCESS |
| reinstall | post-doctor PASS, `libSha256=40510dc3e5fcdd07ceaf49c3c62ed8378eed9e311e329d615a018b47fc2eaa87` |
| arm | receiver log `13:56:54.640Z` owner=3284114 host=3284032 |
| enqueue | `meta-mailbox → enqueued` `13:57:33.341Z` |
| doorbell / rang | `13:57:33.343Z` → `13:57:33.420Z` |
| lastReadAt | `13:57:40.709Z` |
| reply | `13:58:02.805Z` same gid, `agentId=meta-session/copilot`, `origin=meta-session`, `replyable=true` |

이 사슬이 managed launcher→birth→arm→addressed send→doorbell→inbox read→receipt→reply를 닫는다. D3/D8은 열지 않는다.

# NOW

- **Current — RAIL 9: Copilot visible fresh parity.** Copilot product SHA
  `31ebea02ed0cb63cf866e28dd1b50ff419684926`와 기존 CI/LIVE는 RAIL 1–8 영수증이지 branch
  landing 승인이 아니다. RAIL 10의 docs-only contract draft는 Opus 검수 GREEN이며, 그 step 9의
  7개 조항이 RAIL 9 acceptance를 구속한다.
- **Order (only):**
  1. GREEN인 RAIL 10 문서 후보를 RAIL 9의 acceptance contract로 유지한다. OMP는 measured/pending
     candidate만 보존하며 제품 코드·installer·gate·LIVE를 이 branch에 추가하지 않는다.
  2. RAIL 9 Copilot managed visible fresh 구현 → affected focused gate/mutant → exact callback LIVE.
  3. 독립 subtraction review 한 번 → amendment bundle → `DELIVERY.md`의 모든 `managed` 용례 재판독 →
     필요한 qualification → frozen `check:full`.
  4. main landing + exact-SHA CI; 이 파일은 merge 직전 현재 좌표를 main `NEXT.md`로 승격하며 삭제.
  5. #82를 durable **main** SHA에서 close한 뒤 `entwurf-release` land → prepare → make → publish;
     각 mode/version은 별도 GLG grant. 그 뒤 OMP 지원은 다음 이슈에서 이 contract와 좌표로 시작한다.
- **Grade fence (unchanged).** 기존 Copilot receive는 D6 PASS / D7 partial / L4. D3 pending, D8 unproven이며
  그것들을 재개하지 않는다. Hidden `--ui-server`, ACP 재개, host reinstall 반복도 금지다. 이번 #82의
  남은 제품 일은 Copilot fresh 하나뿐이다.

## 이 번들이 닫는 결함 — 측정 (2026-08-23, oracle)

- **`pgrep -x copilot`은 절대 매치하지 않는다.** `type -P copilot` = `/home/junghan/.local/share/pnpm/bin/copilot`,
  POSIX shell wrapper이고 꼬리가 전부 `exec node …/@github/copilot/npm-loader.js "$@"`다. `exec`이 프로세스
  이미지를 갈아치우므로 `comm`은 `copilot`이 될 수 없다. 측정: `pgrep -x copilot` = 빈 결과.
- **`comm`은 판별자가 아니다.** 이 호스트 `ps -eo comm=` 집계에 `MainThread`가 44개 — nodejs-slim 24가
  main thread에 붙이는 이름이고, 다른 node 빌드는 `node`로 뜬다. 그래서 production identity는
  **`/proc/<pid>/cmdline`의 벤더 argv 모양 하나로만** 판정한다 — `@github/copilot/…​.js` 엔트리가 있고
  extension entry(`extension.mjs`)가 없을 것. flag 진위는 `/proc/<pid>/environ`이 답한다.
  `/proc/<pid>/exe`는 **일부러 쓰지 않는다**: wrapper가 generic node로 exec하므로 exe는 Copilot 고유
  판별자가 아니고, 얹으면 서명처럼 보이는 무의미한 조건이 하나 늘 뿐이다. **어떤 게이트 셀도
  `comm == MainThread`를 native 서명으로 단언하지 않는다** — 오늘 초록이고 node 빌드가 바뀌면
  조용히 거짓이 된다.
  (구 PM이 상속시킨 "native comm이 MainThread"는 여전히 **미측정 상속 사실**이다. 살아 있는 native CLI를
  이 세션에서 재지 않았다. 확정된 것은 wrapper의 `exec`과 빈 `pgrep`뿐이다.)
- **lookalike는 실물로 존재한다.** `pgrep -f 'entwurf-copilot-receive'` = 살아 있는 고아 42개,
  전부 `comm=MainThread`. 이들은 게이트가 fork한 stub extension 자식이므로 discovery가 반드시 배제해야 한다.
- **registry memo는 process lifetime이다.** `loadMetaCapabilityRegistry`가 "the file is immutable at
  runtime"이라 적고 singleton으로 캐시한다. 등급을 D0→D6으로 옮겨도 이미 떠 있는 bridge 자식은 D0을 계속 판다.

## LIVE 재현 절차 (수용은 끝났다 — 재측정이 필요할 때만)

1. **사전조건(호스트)**: `./run.sh install-copilot-bridge`(birth) → `./run.sh install-copilot-mcp`
   (entwurf_inbox_read 손) → `./run.sh install-copilot-receive` → `./run.sh doctor-copilot-receive`.
2. **launch**: `entwurf copilot` (이 번들 이후의 관리형 경로). 수동 등가물은
   `COPILOT_CLI_ENABLED_FEATURE_FLAGS=EXTENSIONS copilot --model auto --yolo`.
3. **birth + arm (≈프리미엄 1)**: 첫 프롬프트 1턴. statusline footer에 garden id 확인;
   없으면 `~/.pi/agent/meta-sessions/` 최신 `backend:copilot` 레코드 또는 형제의 `entwurf_peers`로 확인.
4. **inbound 배달**: 형제에서 `entwurf_v2 {target: <그 garden id>, intent: fire-and-forget, …}`.
   sender 영수증 = enqueue 성공(live marker).
5. **doorbell→drain (≈프리미엄 1)**: 공지 등장 → 모델이 `entwurf_inbox_read` 호출 → lastReadAt 스탬프.
   영수증 3곳: receive 로그의 `doorbell`/`rang`, mailbox state `lastReadAt`, 모델 응답.
6. **D3 격리 (B birth ≈프리미엄 +1)** — **아직 pending인 축**: 두 번째 무장 세션 B를 띄운 뒤 A로 한 번 더
   배달 — B의 receiver log가 `ARMED` 외 무변화·B 화면 무반응이 PASS. **이번엔 로그를 scratch cleanup 전에
   옮겨라** (지난번 결정적 영수증이 그렇게 사라졌다).
7. **실패 시 관측**: `meta-bridge-receive-copilot.log`, `./run.sh doctor-copilot-receive`,
   `~/.pi/agent/meta-receivers/<gid>.json`, birth 축은 `./run.sh doctor-copilot-bridge`.
8. **honest rollback**: `./run.sh uninstall-copilot-receive`(상태 파일이 가진 것만 제거).
   이미 armed 세션은 extension exit까지 marker 유지 — start-key가 회수한다.
9. **이 과거 receive 수용 절차의 금지**: hidden `--ui-server`, `~/.copilot/run/ws.*`, ACP 경유 시도.
   `FRESH_CALL_BACKENDS` 확장은 이제 CURRENT RAIL 9만 소유하며 이 재현 절차에 끼워 넣지 않는다.

## 남은 observation 축 (자동화가 못 증명하는 것 — 판정에 넣지 않는다)

- **D3 관리형 두 번째 세션 격리** — 관측됐으나 영수증 미보존. 다음 LIVE에서 회수.
- active-turn `enqueue` vs `immediate` — busy 세션 배달은 미측정.
- `/clear` 및 foreground 교체 후 재무장 — docs는 reload라 하나 미측정.
- `EXTENSIONS` flag 내구성 — CLI 업그레이드마다 재확인 필요.
- duplicate/ordering under load — 다중 `.msg` 동시 도착의 공지·드레인 순서.
- **게이트 자식 누수(이 레인 밖)** — `check-copilot-receive-arm`이 fork한 extension 자식이
  `ppid=1` 고아로 남는다(측정: 42개 생존, `/tmp/entwurf-copilot-receive.*` 60개). 격리는 지켜졌으므로
  (`HOME`/`PI_CODING_AGENT_DIR` 모두 temp, 실 receivers dir 무오염) host 오염이 아니라 정리 누수다.
  #82 이후 별도 레인.

# RECENT

## RAIL 7–8 landing — 2026-08-23, product SHA `31ebea0`

- `[커밋]` `31ebea02ed0cb63cf866e28dd1b50ff419684926` `feat(copilot): land managed launch and D6 receive grade` (20 files, +1570/−164). branch `issue-82-copilot-citizen`.
- `[CI]` exact SHA https://github.com/junghan0611/entwurf/actions/runs/32642653573 SUCCESS. check 22m3s (`check:full` + qualification), artifact-consumer, install-surface.
- `[로컬]` qualification 230/230 KILLED; frozen `check:full` 370s exit0. index-preflight / clean-log WRONG-REASON은 수리 고고학이지 수용 헤드라인이 아니다.
- `[호스트]` CI 뒤 `install-copilot-receive` 1회. pre STALE `95cc51d49dba` → post PASS `40510dc3e5fc`. 다른 installer/orphan 미접촉.
- `[LIVE]` 위 final GLG managed-launch receipt. thread: https://github.com/junghan0611/entwurf/issues/82#issuecomment-5386397337
- `[당시 다음]` main landing + SemVer였으나, 2026-08-24 GLG의 직접 결정으로 Copilot fresh +
  universal harness contract 정리 뒤로 미뤄졌다. OMP 제품 지원은 #82 close 뒤 다음 이슈다. 이 NEXT는
  최종 merge 직전 삭제.

## 독립 검수 + amendment — 2026-08-23, D0 커밋으로 조임

- `[측정]` 독립 리뷰(GLM)가 RAIL 5 구현을 재측정: receive-arm 28셀·birth 62·receiver-marker 53·
  capabilities 17·typecheck 초록, 3축 join(record↔raw log 동일 id)·host 무오염 확인.
  Defect 2건 발견 — ① doctor가 정상 로그에서 `set -euo pipefail`+no-match grep으로 무심사 즉사,
  ② receive 게이트가 어떤 check 체인에도 없어 `check:full`이 이 레인을 검증 안 함.
- `[코드]` amendment: doctor 로그 4개 grep에 `{ grep … || [ "$?" -eq 1 ]; }` 정밀 가드
  (no-match만 정상 처리, 진짜 오류는 fail-loud 유지), 게이트 §9에 clean-log doctor 셀
  (`[QK:COPILOT-RECEIVE-DOCTOR-PASSES-CLEAN-LOG]`, PASS 라인+rc=0), 13번째 mutant가
  그 가드를 제거해 결함을 재심기, `check:hermetic` 체인에 receive-arm 합류.
- `[검증]` focused(수정 게이트·bash -n·doctor 수동 재현 rc=0) → qualification 1회(13 mutants) →
  frozen `check:full` 1회 → 단일 커밋(**그 시점의** 등급은 D0 유지 — LIVE 수용 전이었다). push/LIVE는 GLG 소관.

## RAIL 5 구현 — 2026-08-23, receiver가 제품이 됐다

- `[코드]` **arm은 birth 뒤에만 일어난다.** extension은 join 시점에 시민이 아닐 수 있다(Copilot은
  첫 프롬프트에 태어난다). 그래서 `armOnce`가 세션 이벤트마다 재시도하고, CLI pid의 sender marker +
  V3 record + SDK `session.sessionId` **세 축이 일치할 때만** 마커를 쓴다. 불일치는 refusal이며 로그에 남는다.
- `[측정]` 그 3축 join은 이미 측정돼 있었다 — record `20260823T112003-9d069a`의
  `nativeSessionId`(hook 봉투 출처)와 보존된 raw 로그의 `ARMED sessionId=4fc16d8d-473d-4258-a1fd-f99d3cb375e9`(SDK 출처)가
  **같은 id**다. CLI 1.0.80. 새 LIVE 측정 없이 설계를 고정할 수 있었던 근거.
- `[코드]` **marker의 owner는 extension 자식 pid**(`ownerKind: "copilot-extension"`,
  `armProvenance: "extension-join"`). 벤더 bootstrap(`preloads/extension_bootstrap.mjs`)이
  부모 CLI를 1초마다 확인하고 부모가 사라지면 자식을 종료하므로, extension 생존 = CLI 생존이며
  크래시는 start-key 한 번 읽기로 회수된다. CLI pid를 owner로 삼았다면 죽은 doorbell이 TUI가 열려 있는 내내 armed로 읽혔다.
- `[코드]` **doorbell은 알림이지 주입이 아니다.** 본문은 mailbox에 남고 모델이 `entwurf_inbox_read`로
  스스로 긷는다 — Claude `doorbell.sh`와 같은 계약(fresh `.msg`만 트리거, `.msg.delivered`는 "울렸다"이지 "읽었다"가 아님,
  개수는 read tool이 실제로 돌려줄 `.msg.delivered` 전부). 그래서 `wakeMode: self-fetch`가 참인 문장이 된다.
- `[코드]` dispatch는 **한 줄도 바꾸지 않았다.** mailbox rail은 이미 backend-generic이라
  registry의 `self-fetch` + 살아 있는 receiver marker만으로 `entwurf_v2`가 배달한다. 안 armed면 `mailbox-undeliverable`.
- `[측정]` **stale writer가 실재하는 사고 모드다.** unit이 컴파일된 writer의 *사본*을 들고 있어서,
  `extension-join` 이전 lib을 가진 unit은 모든 arm에서 throw했고 증상은 "시민이 영영 deliverable이 안 됨"뿐이었다.
  게이트를 만들다 실제로 밟았다. → install-state에 `libSha256`, doctor가 배포본 vs 체크아웃 digest 비교(RED).
- `[코드]` flag 소유는 **탐지**로 정의했다. entwurf는 오퍼레이터 셸의 env를 못 정한다. 대신 doctor가
  살아 있는 copilot 프로세스의 `/proc/<pid>/environ`을 읽어, receiver가 설치됐는데 플래그 없이 뜬 세션이 있으면 RED.
  벤더가 침묵하는 실패를 보이게 만드는 것이 여기서 가능한 소유의 전부다.
- `[게이트]` `check-copilot-receive-arm` — 진짜 installer를 temp extensions dir로 몰고, 진짜
  `extension.mjs`를 **벤더와 같은 loader hook 방식**으로 스텁 SDK에 붙여 fork한다. dist가 gitignore라
  qualification 스냅샷에는 없으므로, 없으면 게이트가 2파일 클로저를 temp에 직접 emit한다
  (`ENTWURF_COPILOT_RECEIVE_LIB_DIR` 심; dist를 지우고 초록 확인함).
- `[문서]` 5개 축 동시 갱신: `DELIVERY.md`(행 2개 + rail note), `docs/adding-a-harness.md`(step 7·8),
  `docs/external-mcp-host.md`, raw README(제품으로 가는 포인터 + probe/product liveness SSOT 분리), 이 NEXT.
  `AGENTS.md`의 self-fetch 도메인도 Claude+Copilot으로 정정.
- `[코드]` birth 쪽 claim은 이름만 바뀌었다: `COPILOT-BIRTH-HAS-NO-RECEIVER-STATE` →
  `COPILOT-BIRTH-DOES-NOT-ARM-RECEIVER`. 단언은 그대로 참이고 **이유가 바뀌었다** — 예전엔 doorbell이 없어서,
  지금은 watch를 쥔 프로세스가 hook이 아니라 extension이라서.

## RAIL 5 transport — 2026-08-23, 벽이 치워졌다

- `[측정]` Copilot CLI 1.0.80 IDLE 세션이 **타이핑 0회**로 깨어났다. 외부 파일 쓰기
  → extension의 `fs.watch` → `session.send({mode:"enqueue"})`. poke→`user.message`
  2.7초, poke→정확한 marker 응답 6.5초. 영수증은
  `scripts/raw-async-delivery/README.md`의 "Measured — 2026-08-23" 블록.
- `[측정→영수증 미보존]` 두 번째 무장 세션 B의 격리는 관측됐으나 결정적 로그가 scratch cleanup 전에
  옮겨지지 않았다. **D3는 managed LIVE 수용에서 다시 받는다.**
- `[번들]` SDK는 CLI 패키지 안에 있고(`<platform-pkg>/copilot-sdk/`) `preloads/extension_bootstrap.mjs`가
  자식에 주입한다 — npm 설치 불필요, 버전 드리프트 없음. 자식은
  `COPILOT_EXTENSION_PARENT_PID` / `SESSION_ID` / `COPILOT_SDK_PATH` / `EXTENSION_PATH`를 받는다.
- `[측정]` launch contract는 `COPILOT_CLI_ENABLED_FEATURE_FLAGS=EXTENSIONS` 하나. `--experimental`는 불필요.
  플래그가 없으면 CLI는 스캔조차 하지 않고 **아무 오류 없이** 조용하다.
- `[번들]` 벤더 문서가 인정하는 discovery scope는 `.github/extensions/`(project, 대화형)와
  user 디렉터리(`~/.copilot/extensions/`). 제품은 **user scope**를 쓴다 — 어느 cwd에서도 무장되고 되돌리기 쉽다.
- `[미검증]` active-turn 배달, 한 CLI 프로세스 안 background 세션, `/clear` 재무장,
  실험 플래그의 내구성, 부하/순서. managed LIVE 수용과 그 뒤의 열린 질문들.

## RAIL 5b — closed

- `[측정]` LIVE Copilot CLI 1.0.80 send가 자기 garden id로 도착: `agentId:meta-session/copilot`,
  `origin:meta-session`, `replyable:false`.
- `[측정]` production join 종단 확인: sender marker owner = 실행 중인 Copilot native pid =
  entwurf MCP 자식의 부모; marker와 V3 record가 backend/garden/native id에서 일치.
- `[측정]` 구현 `88d0641`, 인벤토리 수리 `a647292`, 문서 체크포인트 `9dc03c0`.

# DURABLE LINKS

- #82 LIVE sender checkpoint: https://github.com/junghan0611/entwurf/issues/82#issuecomment-5365420577
- #82 local landing checkpoint: https://github.com/junghan0611/entwurf/issues/82#issuecomment-5365476249
- #82 pushed CI-green checkpoint: https://github.com/junghan0611/entwurf/issues/82#issuecomment-5365828064
- New-harness sequence: `docs/adding-a-harness.md`
