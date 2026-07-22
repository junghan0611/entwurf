# NEXT — repair/v2-core-debt

> Branch-only boot sector. Main stays usable while this lane removes pi-session gardenization and finishes the pi meta-record citizen path. Delete this file before merge after durable outcomes move to code/docs/#50.
>
> **Campaign map:** [`HOP.md`](./HOP.md) is the current H0–H7 hypothesis: entry/exit evidence and PM↔Opus roles. It is not a permanent rule; real evidence may revise it. This NEXT owns only the immediate resumption point and protocol decisions.

## NOW — subtraction first: pi session은 pi에게 돌려준다

- **Stem:** entwurf는 pi의 session id·filename·session name을 만들거나 강제하지 않는다. Garden identity는 meta-record가 `gardenId ↔ backend/nativeSessionId`로 연결하고, socket/mailbox/native-push는 delivery/liveness rail로만 남는다.
- **Decision:** pi도 record-backed citizen이다. Native GPT와 pi-hosted ACP는 모두 `backend:"pi"`; ACP는 model/provider axis이지 별도 citizen species가 아니다.
- **Current hop:** **H0 done (`50251ea`).** PM↔Opus 교차검토와 GLG의 D0/rollback 승인을 plan-only commit으로 닫았다. Production delta는 0이고 full commit-hook floor가 GREEN이었다.
- **Active serial implementer:** Opus garden `20260722T124111-bd16e8` (`tmux: entwurf-v2-debt-opus`). Previous planning Opus `20260722T112508-fad929` is closed. No parallel implementation is authorized. Session continuity is coordinated only by GLG↔PM conversation, not by implementer policy.
- **Expected self-host blackout:** C2/C4/H7에서 PM의 현재 socket-only session이 새 record garden socket으로 넘어가며 delivery가 잠시 끊길 수 있다. cut 직전 ids/HEAD/patch/next command를 고정하고, 끊긴 동안 GLG가 수동으로 턴을 전달한다. 새 pi record+socket, peers visibility, PM↔Opus 양방향 delivery가 복구되기 전 다음 cut으로 가지 않으며 fallback carrier를 만들지 않는다.
- **Current blocker (2026-07-22 12:45 KST): G1은 아직 닫히지 않았다.** fetch 기준 `origin/main=fbde7b8`; #51의 B/B2 실측은 끝났지만 **(1) Linux artifact-consumer C gate와 (2) winning launch form + topology gate**, 두 구현 축이 아직 main에 없다. 둘 다 착지해야 G1이고, 동일 tgz Linux/macOS acceptance → release → clean reinstall/installed doctor는 G2다. 이 branch는 `origin/repair/v2-core-debt`보다 H0+handoff commit 두 개 앞선다(push 없음).
- **Next session first move:** `HOP.md`와 이 NOW를 읽고 `git fetch origin --prune` + #51 status로 G1을 재확인한다. G1이 닫혔으면 main을 이 branch에 한 번 병합하고 H1 exact subtraction map을 시작한다. 아직 열리지 않았으면 merge·production edit·부분 map을 시작하지 말고 blocker 상태만 PM/GLG에게 보고한다.
- **H1 topic:** production symbol별 `producer / consumer / gate+live-smoke / docs / delete-or-keep / replacement authority / expected RED` 표와 C1~C4 cut ledger. 이것은 read-only 설계 산출물이다.
- **Two gates:** **G1** = #51 구현 코드 main 착지 → main 1회 병합 + H1(source-level subtraction map) 허용. **G2** = #51 release + maintainer/hejdev6g clean reinstall + installed `doctor-meta-bridge` GREEN → production 작업 개방; 첫 authority-transfer commit은 C1이다.
- **Implementation rule:** GLG가 subtraction map을 확인하고 G2가 닫히기 전 production code는 열지 않는다. RED는 커밋하지 않고 `.agent-reports/H<n>/` patch+digest로 보존한다. Production 권위 이전은 C1~C4 각각 `새 writer/reader + 소비자 전환 + 옛 producer 삭제`가 같은 GREEN commit에서 닫혀야 한다. 정상 routing의 새 dual-read/dual-authority는 금지한다.
- **Sequencing reason:** #51과 #50의 현재 direct code overlap은 실질적으로 없다(`#51`이 건드린 `meta-session.ts` / `meta-sender-identity.ts`도 주석 변화뿐). 기다리는 이유는 conflict 회피가 아니라 **증거 귀속**이다. strict oracle과 artifact harness가 닫히기 전에 production을 빼면 RED가 하네스 결함인지 #50 회귀인지 분리할 수 없다. 반대로 source audit은 그 위험이 없고, #51의 최종 gates/docs를 본 뒤 해야 더 정확하다.
- **Main protection:** 모든 protocol surgery와 RED 관측은 이 branch에서만 한다. main/origin-main은 일상 사용 lane으로 유지한다.
- **SSOT:** #50 hard-cut decision — https://github.com/junghan0611/entwurf/issues/50#issuecomment-5033106676
- **Do not touch:** fresh sibling mint/#47 mux, Cortex/#48, 0.12.9 ACP dependency work, backend auth, transcript hydration, a new DB/planner/worker tree.

## LOCKED PROTOCOL

1. **Meta-record = garden mapping authority.** `gardenId` is the universal address; `nativeSessionId` belongs to the harness. They may be equal for migrated sessions but equality is never an invariant.
2. **Native session stays native.** Pi owns its id, filename, JSONL header, display name, `/new`, `/resume`, `/fork`, and storage layout. Entwurf reads public session facts; it does not rewrite them. Pi may migrate/rewrite its own older session-format versions when loading; that native behavior is not entwurf mutation.
3. **Rail ≠ identity.** A pi record-backed citizen still uses control-socket while alive and exact `--session` spawn-resume while dormant. Claude uses mailbox; agy uses native-push.
4. **Liveness is computed.** Never store alive/dead in the record. Pi liveness is the socket probe keyed by the record's garden id.
5. **Call ≠ parentage.** No `parentGardenId`, mutable `lastCaller`, or worker tree in identity. Uniform caller evidence belongs in the delivered turn/envelope.
6. **All record-backed pi citizens are siblings.** Explicit `owned-outcome` + trust/preflight may wake a dormant pi citizen. Do not recreate `isEntwurf` as a species/permission boolean. If launch policy later proves necessary, it is separate operator policy.
7. **Hard cut, not permanent compatibility.** Existing gardenized pi sessions get one-shot record enrollment without **entwurf-authored** JSONL mutation. New sessions use native pi ids. Record-less socket-only is a migration/crash diagnostic, not the final normal path.
8. **ACP remains supported.** The pi host session owns the record and socket; the ACP plugin only supplies the model/backend process behind that same pi citizen.
9. **Schema hard cut is V3 + one-shot migration.** V1/V2 readers live only in the explicit M1 migration surface; normal production becomes V3-only. Migration is idempotent, verifies zero non-V3 records, and proves backup restore + previous-release rollback before touching the live store.

## AUTHORITY TABLE

| fact | authority |
|---|---|
| garden address ↔ native session | meta-record |
| native pi transcript/session content | pi native session + native id |
| dormant resume file | record `transcriptPath`, validated against native id |
| live/dead | socket probe |
| live runtime cwd/model/idle | socket `get_info` |
| caller/reply address | sender envelope in delivered turn |
| launch trust | existing trust/preflight policy |

## SUBTRACTION MANIFEST — remove before fitting the record

### Pi session mutation / constraint

- garden-id `--session-id` injection in entwurf launchers;
- garden-id-format hard exit for pi native session ids;
- `pi.setSessionName()` garden mirror and provider/model/tag writer;
- session-name parser as identity/resume authority;
- `__control` and `__entwurf` species semantics;
- builtin `/new` block and `/gnew` / `/garden-new` replacement;
- custom pre-created garden session header/name path;
- docs/gates that require pi header id == garden id or filename/name mirrors.

### v1/v2 workaround residue

- `entwurf-tagged ⇒ resident cannot be live` crash;
- resume env-marker leaf, producer, consumer, and authorization gates;
- normal resume's global JSONL header scan by garden id;
- `requireEntwurf` name-tag authorization;
- filename/header/name triple claims;
- record-less socket-only pi promotion as a normal dispatch target;
- `socketOnlyPi` and `socket-only-no-resume-authority` once enrollment/cutover is proven.

### Keep — these are adapter capabilities, not session mutation

- `--entwurf-control` runtime switch for socket/tools activation (for now);
- control socket, RPC, `get_info`, socket liveness probe;
- `ctx.sessionManager.getSessionId()` / `getSessionFile()` reads;
- exact upstream `pi --session <native transcript>` resume;
- ACP provider/model plugin and model lock;
- trust/preflight, target lock, deterministic v2 decider;
- meta-record parser/writer/store and native bridge records.

## EXECUTION ORDER — 현재 가설

세부 entry/exit/rollback은 `HOP.md`가 가진다. 실측이 다르면 이 순서를 고친다.

1. **H0 done (`50251ea`):** PM↔Opus 홉 설계 교차검토를 plan-only commit으로 닫았다.
2. **H1 after G1:** main 1회 병합 → exact subtraction/caller/gate/live-smoke map → C1~C4 cut ledger를 GLG가 확인한다.
3. **H2 after G2:** #51 release/doctor baseline → sandbox M1 migration+rollback rehearsal → mutation RED catalog와 self-host pre-cut peer map.
4. **C1 / H3 — schema authority:** V3 minimal record + migration-only V1/V2 M1 + backup/restore/verify-loop. `parentGardenId`/`isEntwurf` 제거. 정상 production은 V3 only.
5. **C2 / H4 — pi lifecycle/identity authority:** native pi id로 record attach/mint; socket/sender는 record garden id. session-id/name/header gardenization, `/gnew`, `/new` guard 제거.
6. **C3 / H5a — resume/file authority:** ordinary prompt 앞에 기존 structured `<sender_info>`를 prepend하고 `wantsReply`는 sibling input으로 유지; record transcript path/native header 검증 + exact `--session`; global scan/name authorization/resume marker 제거. 새 child carrier/custom-message reconstruction은 만들지 않는다.
7. **C4 / H5b — facts/dispatch authority:** M1 뒤 live legacy session은 C2 attach, dormant M2는 explicit absolute JSONL paths로만 등록한다(global inventory/name/pi-open 없음). Alive socket-only count 0을 증명한 뒤 facts/listing rail과 dispatch/resolveTarget rail을 각각 record-first로 전환한다. Target registry DATA/OPS와 RT-dead reader는 이 authority transfer와 분리한다.
8. **H6:** native-push까지 uniform call provenance를 완성한다.
9. **H7:** D5/M1-trigger 결정 뒤 candidate artifact로 controlled live backup→M1→M2 cutover와 rollback을 실증한다. 이어 full floor/package/live evidence, production net subtraction, durable docs/#49/#50 승격, branch plan docs 삭제를 준비한다.

C1~C4는 각각 독립 GREEN authority-transfer commit이다. H5a/H5b가 한 PM 홉에 과하면 둘로 나눠 operational 8홉으로 수정한다.

### Required close evidence

- arbitrary pi-native UUID session becomes one stable garden citizen;
- extension writes no session name/header/id and builtin `/new` works unchanged;
- reload/resume preserve garden id; new/fork mint new garden ids;
- native GPT and pi-hosted ACP satisfy the same `backend:"pi"` lifecycle;
- file-absent birth is honest; first materialization refreshes path;
- record path/header native-id drift fails before socket/model turn;
- wrong child session resolver cannot redirect exact record-backed resume;
- V1/V2→V3 migration is reversible and normal routing imports no legacy reader;
- no stored liveness; socket probe remains authority;
- enrollment performs no entwurf-authored JSONL write; pi's own old-format migration is measured separately rather than forced byte-identical;
- cut 전후 self-host peers remain reachable by garden id;
- full `pnpm check`, pack/install gates, sandbox negatives, and assigned live smokes green;
- each C1~C4 records SHA, GREEN gates, production LOC delta, rollback evidence;
- production diff is net subtractive and every deleted source loses its obsolete gate/docs in the same cut.

Then update #49/#50, promote durable rules to AGENTS/README/VERIFY, delete branch NEXT/HOP before merge, and let GLG decide merge/release/push.

## BASELINE

- Branch: `repair/v2-core-debt`; HEAD and `origin/repair/v2-core-debt` were both `5ca4040` before this plan correction.
- The branch absorbed main `d89446b` by merge commit `7877af0`; it was not rebased. Local `main` was `aa93218`, while fetched `origin/main` was `fbde7b8` at review time.
- Before H0 planning, branch delta against main was this branch NEXT only. H0 adds `HOP.md` and updates NEXT; no production implementation exists.
- Do not merge a partial #51 checkpoint merely to start reading. Wait for #51 implementation code to finish landing, merge main once, then run H1. G2 opens production work; C1 is the first authority-transfer commit.
- Main remains the daily usable lane.
