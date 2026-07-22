# HOP — #50 v2 core debt settlement

> `repair/v2-core-debt` 캠페인의 **검증 가능한 작업 가설**이다. 규칙이나 영구 SSOT가 아니다. `NEXT--repair_v2-core-debt.md`는 지금 재개할 한 걸음을, HOP은 여러 PM 세션을 건너는 예상 경로를 기록한다. 실측이 틀렸음을 보이면 즉시 수정한다. 홉 설계 자체도 검증 대상이다.
>
> merge 전 삭제하고, 살아남은 규칙과 사실만 code/docs/AGENTS/#50으로 승격한다.

## 목적

pi session을 entwurf가 garden 형식으로 재작성하는 역사적 접힘을 걷어내고, 모든 pi 세션을 record-backed garden citizen으로 연결한다.

```text
identity   = V3 meta-record (gardenId ↔ backend/nativeSessionId)
liveness   = rail별 실시간 probe
transport  = pi socket / exact-file resume / Claude mailbox / agy native-push
caller     = delivered turn의 sender envelope
```

North Star와 hard-cut 결정은 #50 및 branch NEXT의 LOCKED PROTOCOL이 현재 기준이다. planner·worker tree·새 DB·transcript 복제·stored liveness를 만들지 않는다.

## 홉과 역할

한 **홉(hop)**은 관찰 가능한 상태변화 하나를 닫는 예상 단위다. 실제 결합이 다르면 홉을 쪼개거나 합치되 근거를 남긴다.

- **PM GPT:** 범위, 권위 이전, entry/exit evidence, 교차홉 계약, GLG decision queue를 소유한다.
- **실무 Opus:** 한 번에 한 slice만 구현·검증한다. 병렬 실무자는 열지 않는다.
- 세션의 지속·종료는 GLG와 PM이 대화 흐름에서 결정하며, 실무자가 작업 게이트로 삼지 않는다.
- 홉과 commit은 동일하지 않다. 다만 production 권위 이전 C1~C4는 각각 독립 GREEN commit 후보다.
- RED working cut은 branch commit으로 남기지 않는다.

## Uncommitted evidence persistence

사람의 서술만 믿지 않고 미커밋 상태를 artifact로 고정한다.

```text
.agent-reports/H<n>/catalog.md
.agent-reports/H<n>/working.patch
.agent-reports/H<n>/sha256
```

- `.agent-reports/`는 gitignored local artifact다. 억지로 commit하지 않는다.
- NEXT에 artifact 경로와 sha256을 기록한다.
- 후속 작업은 digest와 `git apply --check` 가능 여부를 확인한다.
- 선택 안전망으로 `refs/wip/<hop>` commit-tree를 쓸 수 있으나 branch history/push 대상이 아니다.
- hook 우회, RED commit, unsafe env는 금지한다.

## 전역 commit 불변식

production authority-transfer commit 하나는 **사실 하나**를 다음 삼중 규칙으로 옮긴다.

1. replacement authority의 writer/reader가 선다.
2. 그 사실의 production consumer 전원이 새 권위로 전환된다.
3. 같은 commit에서 옛 producer/normal-path reader가 삭제된다.

옛 producer를 지울 수 없으면 commit이 아니라 working-tree RED다. 각 commit ledger는 production symbol별 기대를 기계화한다.

```text
symbol → production hits 0
       → docs/history/migration-only 허용 경로는 exact allowlist
```

새 compatibility dual-read를 정상 production에 도입하지 않는다. V1/V2 reader는 M1 migration-only surface에 격리되고 정상 routing module의 import를 gate가 금지한다.

## 공유 런타임 보호

이 repo는 GLG·PM·Opus의 살아 있는 peer를 호스팅한다. 개발 fixture는 반드시 격리된 `ENTWURF_META_*_DIR`, HOME/XDG, pi session roots를 쓴다.

- H7 controlled cutover 전에는 live `~/.pi/agent/meta-*`를 migration/rewrite하지 않는다.
- C4는 candidate artifact + 격리 store에서 reachability를 preflight하고, H7이 cut 전후 실제 peer reachability를 garden id별로 측정한다.
- record-less/socket-only 제거는 C4 sandbox preflight와 H7 self-host acceptance를 모두 통과해야 출하 가능하다.

### Expected coordination blackout

C2/C4/H7에서 pi identity/socket을 record garden id로 옮길 때, PM의 현재 socket-only control session이 잠시 `entwurf_v2` delivery를 못 받을 수 있다. 이것은 숨은 fallback을 추가할 이유가 아니라 self-host cut의 예상 경계다.

1. cut 직전 `HOP/NEXT/.agent-reports/<hop>/`에 PM·Opus garden ids, HEAD, working patch digest, 다음 명령, expected peer map을 고정한다.
2. Opus native session과 tmux를 유지하되 자동 재시도/polling으로 상태를 흐리지 않는다.
3. socket delivery가 끊기면 GLG가 두 세션 사이의 턴을 수동 전달한다.
4. pi session을 V3 record에 attach하고 record garden id에서 socket을 다시 연다.
5. `entwurf_peers` visibility + PM→Opus/Opus→PM 양방향 `entwurf_v2` delivery/reply가 복구돼야 cut을 계속한다.
6. 예상 blackout을 거짓 socket-only fallback, name/env carrier, dual routing으로 덮지 않는다.

## 브랜치 실행 게이트

이 캠페인은 `repair/v2-core-debt`에서 main과 독립적으로 전진한다. #51의 main 테스트 하네스 착지·릴리즈는 #50의 entry gate가 아니다. 옛 production authority를 전제로 만든 하네스를 먼저 병합하면 이 브랜치가 곧 삭제할 권위를 새 gate가 다시 고정하는 기술부채가 된다.

- **H1 개방:** H1-prep handoff digest + clean plan-only branch가 entry evidence다. main 병합 없이 exact subtraction map을 연다.
- **production 개방:** H1 cut ledger를 GLG가 승인하고 H2 sandbox rehearsal/mutation RED가 닫히면 C1을 연다.
- #51 결과는 관측·설계 입력으로 읽을 수 있지만 자동 merge/cherry-pick하지 않는다. H7에서 최종 authority에 맞는 package/OS floor만 재적합한다.
- branch 밖 하네스의 green을 #50 회귀 증거로 빌리지 않는다. 각 C commit은 자기 replacement authority와 mutation gate를 같은 commit에서 닫는다.

## 확정된 schema cutover 가설 — D0

GLG 승인(2026-07-22): **V3 hard cut + explicit one-shot V1/V2→V3 migration**.

- V3는 최소 identity keyset을 새 ledger와 gate로 동결한다.
- M1 migrator만 V1/V2를 읽는다. M1은 explicit installed operator command로만 실행하며 SessionStart/PreInvocation 같은 best-effort per-session hook에서 자동 실행하지 않는다. 정상 production parser/routing은 cut 뒤 V3 only다.
- migrator는 idempotent하고 재실행 가능하다.
- rewrite 전 `meta-sessions.v3-migration-backup-<timestamp>/`를 만든다.
- 종료 조건은 `non-V3 record count == 0`이다. live old writer가 record를 되살리면 quiesce 후 재실행한다.
- rollback evidence는 backup 복원 + 이전 release 재설치 + 이전 reader/doctor GREEN이다.
- 미migration record의 operator error는 migrate command를 직접 지목한다.
- entwurf는 기존 pi JSONL을 수정하지 않는다. Pi가 자기 구버전 session format을 load 시 현재 버전으로 migrate/rewrite하는 것은 pi 소유 동작이며 byte-equality 검증에서 분리한다.

이 설계도 H1/H2 실측에서 반증되면 GLG에게 되돌린다.

## 공통 홉 기록 형식

각 홉 종료 시 HOP/NEXT 또는 report에 다음을 남긴다.

```text
Entry gate:     기계적으로 확인 가능한 시작 조건
Exit evidence:  gate/grep/fixture 명령과 결과
Prod LOC delta: +x/-y, net
Forbidden:      해당 홉에서 건드리지 않을 것
Artifacts:      report/patch/digest 경로
Rollback:       종료 sha + 그 sha에서 GREEN인 gate 목록
```

## 예상 홉 지도

기본은 **H1~H7, operational 7홉**이다. H0는 현재 계획 수립이다. H3/H4는 합치지 않는다. 결합이 예상보다 크면 H5를 C3/C4 두 PM 홉으로 분리해 operational 8홉으로 늘린다. exit gate를 낮춰 홉 수를 맞추지 않는다.

### H0 — 계획 잠금 (done)

**Entry:** #50 hard-cut 결정, branch production delta 0.

**Work**

- 브랜치 실행 게이트, D0, C1~C4 authority-transfer commits를 PM↔Opus가 교차검토한다.
- RED artifact, rollback/LOC/live-smoke 규율을 고정한다.

**Exit evidence**

- `HOP.md`와 branch NEXT가 같은 즉시 다음 행동을 가리킨다.
- Opus 반론과 PM 판정을 반영했다.
- GLG가 D0와 backup/rollback을 승인했다.
- `git diff --check` GREEN.
- plan documents only commit.

**Forbidden:** main merge, production 수정, live store 접근.

### H1 — exact subtraction map, cut ledger (현재)

**Entry gate:** H1-prep handoff digest 검증 + clean plan-only branch. main/#51 merge는 요구하지 않는다.

**Work**

1. `.agent-reports/H1-prep/HANDOFF.md`와 14개 artifact digest를 검증하고, 현재 HEAD에서 각 주장을 재측정한다.
2. 아래 표를 production symbol 기준으로 완성한다.

```text
symbol/file → current authority/mutation → all production callers
→ gates/docs/live smoke → delete/keep → replacement → expected failure
```

3. 감사면:
   - launcher/new-session-id, `/gnew`, `/new` guard
   - id/name/header writers와 parsers
   - resume marker, `requireEntwurf`, global header scan
   - socket path, sender identity, status/env
   - `SocketOnlyFact`, peers/facts/decider/send-fallback
   - target registry identity vs launch trust
   - V1/V2 schema/migration/upsert와 obsolete fields
4. C1~C4 ledger, grep allowlist, gate ownership, production LOC baseline을 만든다.
5. self-host coordination blackout의 trigger, GLG manual relay, pi rejoin 명령, expected peer map을 cut ledger에 넣는다.
6. live smokes를 배정한다.
   - C2: `smoke-resident-garden-guard` (native-id hard crash, `/gnew`, resident-name axes), `smoke-acp-socket-citizen-live`
   - C3: `smoke-resident-garden-guard` (resume block/tag/marker axes), `smoke-entwurf-v2-spawn-resume-live`
   - C4/H7: 세 smoke의 cutover 후 재확인

**Exit evidence**

- unknown production caller 0 또는 GLG decision queue에 명시.
- C1~C4 각각 독립 GREEN 가능성이 source graph로 증명됨.
- GLG가 cut ledger 승인.

**Forbidden:** production/gate expectation/native data 수정.

### H2 — branch baseline, migration rehearsal, mutation RED catalog

**Entry gate:** H1 ledger GLG 승인.

**Work**

1. 현재 branch의 targeted/full floor와 격리 fixture 기준을 baseline으로 기록한다. #51 release/installed doctor는 entry gate가 아니며, 이용할 수 있는 결과는 참고 evidence로만 분리 기록한다.
2. sandbox store inventory로 V1/V2/V3/malformed/duplicate fixture 수를 고정한다.
3. M1 migration을 fixture에서 rehearsal한다.
   - idempotence
   - concurrent/stale V2 resurrection → verify-loop RED
   - backup + restore
   - previous-reader rollback
   - migration-only import allowlist mutation
4. pi session 비조작 structural fence의 mutation power를 증명한다.
5. subtraction 묶음별 expected RED를 `.agent-reports/H2/`에 기록한다.
6. self-host pre-cut peer map과 PM↔Opus 양방향 delivery baseline을 저장하고 manual-relay/rejoin 절차를 sandbox에서 rehearsal한다.

**Exit evidence**

- vacuous하지 않은 mutation RED.
- M1/rollback rehearsal 명령과 expected result.
- unexpected RED 0 또는 explicit blocker.
- C1~C4 실행 순서가 파일/symbol 단위로 고정.

**Forbidden:** live store rewrite, RED commit, compatibility flag/carrier.

### H3 — C1: V3 record schema authority + M1

**Entry gate:** H2 migration/rollback rehearsal GREEN.

**Authority-transfer commit C1**

- V3 minimal identity keyset + ledger/gate.
- migration-only V1/V2 parser와 operator M1 surface.
- backup, idempotent verify-loop, restore/rollback.
- 정상 production parser/upsert/scan은 V3 only.
- `parentGardenId`, `isEntwurf`를 schema와 production facts/rendering에서 제거.
- V2 strict-keyset tests는 migration-only protection으로 이동.
- 미migration operator error가 M1 명령을 지목.

**Exit evidence**

- normal routing의 migration parser imports 0.
- explicit import allowlist GREEN.
- healthy V1/V2 fixtures → V3; malformed/half-migrated RED.
- backup restore + previous reader GREEN.
- full targeted meta gates GREEN.

**Prod LOC delta / Rollback:** C1 종료 시 실제 수치, SHA, GREEN gate 목록 기록.

**Forbidden:** pi identity/socket/resume/dispatch 전환, live store migration.

### H4 — C2: pi lifecycle/identity authority

**Entry gate:** C1 GREEN commit + sandbox V3 store.

**Authority-transfer commit C2**

- `session_start(startup|reload|new|resume|fork)`에서 native pi id로 V3 record attach/mint.
- duplicate native id fail-loud.
- nullable transcript path와 materialization refresh.
- garden-id `--session-id` injection, garden-format hard crash, entwurf의 session-name writer/parser authority 제거. Pi 소유 `/name`, `--name`, RPC `set_session_name`은 그대로 남는다.
- `/gnew`/`/garden-new`, builtin `/new` guard, custom pre-created header/name path 제거.
- socket path와 pi sender envelope를 record garden id에 결속.
- native GPT와 pi-hosted ACP가 같은 `backend:"pi"` lifecycle 사용.
- resource는 factory에서 시작하지 않고 `session_start`에서 attach하며, `session_shutdown` cleanup은 idempotent해야 한다.
- pi session id/name/header 비조작 structural fence GREEN.

**Exit evidence**

- arbitrary native UUID → stable V3 garden citizen.
- new/fork mint, reload preserves; resume attachment은 C3가 완성할 범위를 명시.
- socket/sender가 native id와 garden id equality에 의존하지 않음.
- `smoke-resident-garden-guard`의 obsolete garden-name assertions는 제거되고 새 identity assertion GREEN.
- `smoke-acp-socket-citizen-live` GREEN.

**Prod LOC delta / Rollback:** C2 SHA와 GREEN gate 목록 기록.

**Forbidden:** dormant resume authority와 socket-only normal routing을 임시 fallback으로 고치기.

### H5 — C3/C4: resume와 dispatch 권위

결합이 크면 C3와 C4를 서로 다른 PM 홉으로 나눈다. commit은 항상 분리한다.

#### C3 — resume/file authority

- spawn-resume ordinary prompt 앞에 기존 structured `<sender_info>` grammar와 기존 sender envelope를 prepend한다. `wantsReply`는 envelope 밖 sibling input으로 유지한다. Raw tag의 UI 노출은 수용하며 badge parity를 위해 child custom-message reconstruction이나 새 carrier를 만들지 않는다.
- record `transcriptPath` + native header id 검증 → exact `--session <absolute-file>`.
- global JSONL header scan, `requireEntwurf`, session-name tag authorization 제거.
- v1 resident prohibition과 resume env marker producer/consumer/gates 제거.
- wrong resolver와 path/header drift가 model/socket 전에 RED.
- `smoke-resident-garden-guard`의 resume block/tag/marker assertions가 새 계약으로 전환돼 GREEN.
- `smoke-entwurf-v2-spawn-resume-live` GREEN.

#### C4 — cutover surface + peers/dispatch authority + M2 enrollment

- H2가 rehearsal한 M1→M2 순서를 operator cutover surface로 연결한다.
- live legacy pi session은 C2 `session_start` attach로 등록한다. Dormant M2는 **명시적 absolute JSONL path 입력만** 받으며 global inventory, session name, `SessionManager.open()`에 의존하지 않는다. Header/model entries를 직접 읽고 `gardenId == nativeSessionId`인 V3 record를 쓴다.
- M2는 shipped operator command의 `run_ts` + compiled-twin 계약을 따른다. HOME/XDG/agent roots를 모두 격리해 sandbox에서 **entwurf-authored JSONL write 0**을 증명한다. Pi 자체의 구버전 session-format rewrite는 별도 native 동작이다.
- `non-V3 record count == 0` 뒤에만 M2를 연다. Record-first routing 전 완료 counter는 **alive `FactList.socketOnly` count == 0**이며, 모든 일반/dormant pi JSONL의 전량 inventory를 주장하지 않는다.
- facts/listing rail(`listEntwurfFacts`→renderer)과 dispatch rail(`resolveTarget`→decider)을 서로 다른 편집면으로 재검증해 둘 다 record-first로 전환한다.
- live pi는 record garden id socket, dormant pi는 C3 path.
- `SocketOnlyFact` listing과 `socketOnlyPi` dispatch promotion/reject/send-fallback을 각각 제거한다.
- target registry는 dispatch와 연결되지 않는다. DATA/OPS install 계약은 H1에서 별도 결정하고, RT-dead reader chain은 authority transfer에 끼우지 않고 H7 sweep 대상으로 판정한다.
- record-less socket은 migration/crash diagnostic only.
- candidate artifact + 격리 store의 pre/post peer reachability 보존.
- C2/C3/C4 담당 live smokes는 격리 target에서 재확인하고, 실제 host cutover는 H7이 소유한다.

**Exit evidence**

- C3와 C4 각각 삼중 commit invariant/grep allowlist GREEN.
- arbitrary UUID live/send/dormant resume가 garden id 보존.
- M2가 JSONL을 쓰지 않음을 syscall/write fence로 증명한다. Pi load가 자체 session-format migration을 수행한 파일에는 byte-identical을 요구하지 않는다.
- record-less normal dispatch path 0.
- candidate/sandbox pre/post peer map의 expected peers 도달 가능.

**Prod LOC delta / Rollback:** C3, C4 각각 SHA·수치·GREEN gates 기록.

**Forbidden:** C3/C4를 RED 한 commit으로 합치기, live enrollment를 sandbox 증거 전에 실행하기.

### H6 — transport-neutral call provenance 완성

**Entry gate:** C1~C4 GREEN commits.

**Work**

- socket receiver의 인라인 `<sender_info>` 생성을 pure shared formatter로 추출하고 socket·spawn-resume·native-push가 같은 grammar/`SenderEnvelope`를 사용한다. `wantsReply`는 envelope 밖 sibling input이며 true일 때만 `wants_reply`를 emit한다.
- mailbox는 self-fetch rail에 맞는 human-readable formatter를 유지하되 동일 envelope fields와 sibling `wantsReply`를 보존한다.
- socket/mailbox/spawn/native-push 네 rail의 A→B→C와 reply evidence를 검증한다. Shared formatter와 각 rail consumer에 provenance-drop mutation gate를 둔다.
- identity record에 parent/lastCaller/call DB를 넣지 않는다.
- durable 공통 사실은 caller envelope뿐이다. Intent/transport는 dispatch 선택·caller receipt에만 남고, delivery receipt는 기존 rail별 증거(mailbox state/RPC ack/socket observation/native probe)를 유지하며 공통 DB로 승격하지 않는다.

**Exit evidence**

- 네 hand 모두 caller를 잃지 않음.
- reply 불가능 rail은 정직하게 표시.
- call provenance가 routing authority가 아님.

**Prod LOC delta / Rollback:** 종료 SHA·수치·GREEN gates.

### H7 — full floor, controlled live cutover, 문서와 종료

**Entry gate:** C1~C4 + call provenance GREEN. 최초 live M1 전에 D5 old-writer quiesce 절차/actuator와 detector를 GLG가 확정한다. M1 trigger는 explicit operator command로 고정됐다.

**Work**

- full `pnpm check`, pack/install, 최종 authority에 맞춘 artifact-consumer/OS floor. #51 구현은 그대로 병합하지 않고 현재 코드에 재적합한다.
- candidate artifact로 controlled live cutover를 순서대로 실행한다: old-writer quiesce+detector GREEN → live store backup → explicit M1 → `non-V3 == 0` → M2 → alive socket-only `== 0` → 새 runtime 시작.
- stale V1/V2 writer가 되살아나면 D5 절차 뒤 M1 verify-loop를 재실행한다.
- cut 전후 실제 self-host peer reachability와 relevant live resume/send smokes를 확인한다.
- rollback은 **backup 완전 복원 먼저 → 이전 artifact 재설치** 순서로 실증한다. 이전 V1/V2 reader가 V3를 보는 창과 부분복원을 허용하지 않은 뒤 새 cutover를 다시 완료한다.
- stale production symbols, legacy imports, gates/docs, generated residue sweep.
- production net subtraction 합산.
- AGENTS/README/VERIFY/#49/#50에 durable outcome/evidence 승격.
- branch NEXT/HOP 삭제 준비.

**Exit evidence**

- branch NEXT verification list 전부 evidence 보유.
- package consumer가 checkout/repo `node_modules` 없이 GREEN.
- identity species가 아닌 transport fact로 모든 rail 설명 가능.
- clean commit series와 rollback ledger.
- GLG가 merge/release/push를 결정할 수 있음.

## Decision queue

D0와 backup/rollback은 GLG가 승인했다. 아래는 근거가 나올 때만 GLG에게 올린다.

1. **D5 — H7 live-cutover entry blocker:** 최초 live M1 전에 live old writer quiesce를 강제할 operator 절차/actuator와 detector를 GLG가 확정한다. 현재 doctor는 stale deployed writer를 검출하지만 quiesce actuator는 없다. H2 rehearsal과 이용 가능한 doctor evidence가 선택 근거를 낸다.
2. target registry에서 identity 제거 뒤 별도 dormant-launch trust policy 필요 여부.
3. record-less diagnostic을 doctor/peers에서 얼마 동안 노출할지. 정상 routing fallback은 금지.

결정 전 임시 fallback을 만들지 않는다.

## 현재 상태

- Current: H0 + H1-prep 종료. PM↔Opus 교차검토와 14개 read-only artifact가 있다.
- Production implementation: 없음.
- Branch delta: `HOP.md` + branch NEXT plan only.
- Next: main/#51을 기다리지 않고 H1 exact subtraction map과 C1~C4 cut ledger를 현재 branch에서 연다.
