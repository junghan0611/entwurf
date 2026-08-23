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
- [ ] **7. Final amendment bundle** ← CURRENT: managed launcher `entwurf copilot`, capability cache invalidation, doctor native-process discovery, permission/launch docs, D6/D7-partial 등급 정착
- [ ] **8. Grade landing + push** — 독립 review → amendment → qualification 1회 → frozen `check:full` 1회 → GLG가 commit/push 결정

현재 좌표: 1–6 완료(구현 커밋 + 관리 LIVE 수용) → **7 final amendment bundle** → 8 등급 안착/push.
Hidden `--ui-server`는 여전히 다시 열지 않는다.

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

# NOW

- **Current — RAIL 7 final amendment bundle.** RAIL 5 구현 커밋(`9b4e248`) 위에서 관리 LIVE 수용이 끝났고
  (위 LIVE RECEIPT), 이 번들이 그 수용이 드러낸 결함과 남은 제품면을 닫는다. 범위는 다섯 가지뿐이다:
  1. **managed launcher `entwurf copilot`** — `scripts/copilot-launch.sh` + `run.sh` dispatch. 현재
     터미널에서 벤더 실행체로 `exec`하며 EXTENSIONS 토큰과 기본 프로필을 invocation-local로만 얹는다.
     tmux/fresh-call 아니고 citizen을 만들지 않는다 — birth 권위는 여전히 첫 프롬프트다.
  2. **capability cache invalidation** — `pi-extensions/lib/meta-session.ts`의 registry memo가
     process lifetime singleton이라, 살아 있는 dispatcher가 등급 변경을 영원히 못 본다. 구현은
     **무효화 기법이 아니라 뺄셈이다**: singleton을 없애고 매 load마다 다시 읽는다(캐시 없음).
     restart 안내로 덮지 않는다.
  3. **doctor native-process discovery** — `scripts/copilot-receive-bridge.sh`의 `pgrep -x copilot`은
     **구조적으로 빈 결과**다(아래 측정). 이 레인의 유일한 invisible-failure 탐지기가 false-negative였다.
  4. **permission/launch docs** — plain `copilot`과 managed `entwurf copilot`의 분리, 주입되는 기본값과
     override 목록, 호출 자체가 명시 동의라는 문장.
  5. **grade/receipt 정착** — D6 / D7-partial / L4를 registry와 문서 5축에 안착.
- **Grade fence.** D6은 위 호스트 사슬 **더하기** 상속된 reply 봉투의 결합 판정이다. 로컬
  enqueue→doorbell→read 사슬만으로 reply를 증명했다고 쓰지 않는다. D7은 reply/read는 관측됐으나
  completion taxonomy와 장기 운영이 아니라서 partial이다. D3 pending, D8 unproven, L4 한 호스트·한 왕복.
- **Fence.** push 금지, commit은 GLG의 별도 grant 전까지 금지. 새 Copilot LIVE/model turn 금지.
  독립 review 전에 qualification/`check:full` 금지 — inner loop는 영향받은 focused gate만.

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
9. **금지**: hidden `--ui-server`, `~/.copilot/run/ws.*`, ACP 경유 시도, `FRESH_CALL_BACKENDS`/fresh-call 확장.

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
