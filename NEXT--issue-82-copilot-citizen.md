# NEXT — #82 Copilot garden citizen (branch lane)

> Disposable boot sector for `issue-82-copilot-citizen`. The issue thread is the
> durable chronology; delete this file before merge after promoting the last facts.

# RAIL — 현재 좌표

- [x] **1. Citizen birth + visible identity** — record, hook, doctor, statusline; real Copilot birth accepted
- [x] **2. MCP hand** — owned/reversible user MCP config; native `entwurf_*` invocation accepted
- [x] **3. Outbound sender identity** — own garden id + `origin:meta-session`; pushed CI green
- [x] **4. Evidence/docs checkpoint** — `9dc03c0` (extension LIVE receipt + raw reproducer + 문서 정정)
- [x] **5. Inbound receive implementation (D0)** — receiver extension + installer/doctor + gate 29셀 + mutants 13 + amendment (doctor clean-log 셀·hermetic 체인 합류) — **D0로 로컬 커밋됨**. 관리 LIVE 수용은 아직 없음
- [ ] **6. Operator LIVE acceptance** ← CURRENT: GLG가 visible Copilot에서 직접 수행 (최소 절차는 NOW)
- [ ] **7. Grade + push** — LIVE 수용 후 receive 등급 이동 판단, 그 다음 GLG가 push 결정

현재 좌표: 1–5 완료(D0 구현 커밋됨) → **6 GLG의 관리 LIVE 수용** → 7 등급/push. Hidden `--ui-server`는 여전히 다시 열지 않는다.

# NOW

- **Current.** RAIL 5 구현 + 검수 amendment가 **하나의 커밋으로 로컬에 커밋됨(D0 유지, LIVE 미수용, push 대기)**.
  커밋 범위: `pi/copilot-receive/entwurf-receive/extension.mjs`, `scripts/copilot-receive-bridge.sh`,
  `scripts/check-copilot-receive-arm.ts`(29셀), `scripts/mutants/copilot-receive.json`(13),
  `pi/entwurf-capabilities.json` copilot `wakeMode:self-fetch`(grade D0 유지), `meta-session.ts`
  (`extension-join` provenance·ownerKind), birth 게이트/doctor 주석 정정, run.sh verb 3종,
  package.json(hermetic 체인 합류 포함), 문서 5축.
- **Next — GLG의 관리 LIVE 수용 (아래 절차, 프리미엄 ≈2회 / D3 B 포함 ≈3회).**
- **Grade fence.** 등급은 D0, `replyable:false`/LIVE-unaccepted. 자동화 green은 managed LIVE success로
  번역되지 않는다 — hermetic 게이트는 fork의 entwurf 쪽만 증명한다.

## GLG LIVE 최소 절차 (visible Copilot, 직접 실행)

1. **사전조건(호스트, 아직 안 됐다면)**: `./run.sh install-copilot-bridge`(birth) →
   `./run.sh install-copilot-mcp`(entwurf_inbox_read 손) → `./run.sh install-copilot-receive` →
   `./run.sh doctor-copilot-receive` → artifact/digest/marker 축 green(세션 없는 flag 축은 note가 정상).
2. **launch**: 다른 터미널에서 `COPILOT_CLI_ENABLED_FEATURE_FLAGS=EXTENSIONS copilot --model auto`
   (visible; `--experimental` 불필요). 세션 A.
3. **birth + arm (≈프리미엄 1)**: 첫 프롬프트 1턴. statusline footer에 garden id 확인;
   없으면 `~/.pi/agent/meta-sessions/` 최신 `backend:copilot` 레코드 또는 형제의 `entwurf_peers`로 확인.
4. **inbound 배달**: 형제(pi 등)에서 `entwurf_v2 {target: <그 garden id>, intent: fire-and-forget,
   message: "관리 LIVE 수용 — entwurf_inbox_read로 읽고 한 줄로 확인"}`. sender 영수증 = enqueue 성공(live marker).
5. **doorbell→drain (≈프리미엄 1)**: 세션 A에 공지 등장 → 모델이 `entwurf_inbox_read` 호출 →
   lastReadAt 스탬프. 영수증 3곳: `~/.pi/agent/meta-bridge-receive-copilot.log`의
   `doorbell`/`rang` 라인, mailbox state `lastReadAt`, 모델 응답.
6. **D3 격리 (B birth ≈프리미엄 +1)**: 두 번째 flagged 세션 B를 띄워 first prompt로 born→armed 후
   A로 한 번 더 배달 — B의 receiver log가 `ARMED` 외 무변화·B 화면 무반응이 PASS.
7. **실패 시 관측**: `meta-bridge-receive-copilot.log`(join/refused/armed/doorbell 라인),
   `./run.sh doctor-copilot-receive`, `~/.pi/agent/meta-receivers/<gid>.json`, birth 축은
   `./run.sh doctor-copilot-bridge`.
8. **honest rollback**: `./run.sh uninstall-copilot-receive`(상태 파일이 가진 것만 제거).
   이미 armed 세션은 extension exit까지 marker 유지 — start-key가 회수한다. 등급은 LIVE 실패 시 D0 그대로.
9. **금지**: hidden `--ui-server`, `~/.copilot/run/ws.*`, ACP 경유 시도, `FRESH_CALL_BACKENDS`/fresh-call 확장.

## LIVE 이후 observation 축 (자동화가 못 증명하는 것 — 판정에 넣지 않는다)

- active-turn `enqueue` vs `immediate` — busy 세션 배달은 미측정.
- `/clear` 및 foreground 교체 후 재무장 — docs는 reload라 하나 미측정.
- `EXTENSIONS` flag 내구성 — CLI 업그레이드마다 재확인 필요(experimental/staff-or-experimental).
- duplicate/ordering under load — 다중 `.msg` 동시 도착의 공지·드레인 순서.

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
  frozen `check:full` 1회 → 단일 커밋(D0 유지). push/LIVE는 GLG 소관.

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
