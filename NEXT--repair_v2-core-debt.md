# NEXT — repair/v2-core-debt

> Branch-only boot sector. Main stays usable while this lane removes pi-session gardenization and finishes the pi meta-record citizen path. Delete this file before merge after durable outcomes move to code/docs/#50.

## NOW — subtraction first: pi session은 pi에게 돌려준다

- **Stem:** entwurf는 pi의 session id·filename·session name을 만들거나 강제하지 않는다. Garden identity는 meta-record가 `gardenId ↔ backend/nativeSessionId`로 연결하고, socket/mailbox/native-push는 delivery/liveness rail로만 남는다.
- **Decision:** pi도 record-backed citizen이다. Native GPT와 pi-hosted ACP는 모두 `backend:"pi"`; ACP는 model/provider axis이지 별도 citizen species가 아니다.
- **Next concrete move:** production symbol 기준 subtraction manifest를 만든다. 각 삭제 대상마다 producer / consumer / gate / docs / replacement authority를 한 줄로 매핑하고, GLG가 확인하기 전 production code는 열지 않는다.
- **Implementation rule:** working tree에서는 session manipulation을 먼저 제거해 RED와 실제 결합을 관측할 수 있지만 RED는 커밋하지 않는다. 첫 code checkpoint는 subtraction + pi record mapping이 함께 green일 때다. Hidden dual-read/dual-authority는 금지한다.
- **Main protection:** 모든 protocol surgery와 RED 관측은 이 branch에서만 한다. main/origin-main은 일상 사용 lane으로 유지한다.
- **SSOT:** #50 hard-cut decision — https://github.com/junghan0611/entwurf/issues/50#issuecomment-5033106676
- **Do not touch:** fresh sibling mint/#47 mux, Cortex/#48, 0.12.9 ACP dependency work, backend auth, transcript hydration, a new DB/planner/worker tree.

## LOCKED PROTOCOL

1. **Meta-record = garden mapping authority.** `gardenId` is the universal address; `nativeSessionId` belongs to the harness. They may be equal for migrated sessions but equality is never an invariant.
2. **Native session stays native.** Pi owns its id, filename, JSONL header, display name, `/new`, `/resume`, `/fork`, and storage layout. Entwurf reads public session facts; it does not rewrite them.
3. **Rail ≠ identity.** A pi record-backed citizen still uses control-socket while alive and exact `--session` spawn-resume while dormant. Claude uses mailbox; agy uses native-push.
4. **Liveness is computed.** Never store alive/dead in the record. Pi liveness is the socket probe keyed by the record's garden id.
5. **Call ≠ parentage.** No `parentGardenId`, mutable `lastCaller`, or worker tree in identity. Uniform caller evidence belongs in the delivered turn/envelope.
6. **All record-backed pi citizens are siblings.** Explicit `owned-outcome` + trust/preflight may wake a dormant pi citizen. Do not recreate `isEntwurf` as a species/permission boolean. If launch policy later proves necessary, it is separate operator policy.
7. **Hard cut, not permanent compatibility.** Existing gardenized pi sessions get one-shot record enrollment without JSONL mutation. New sessions use native pi ids. Record-less socket-only is a migration/crash diagnostic, not the final normal path.
8. **ACP remains supported.** The pi host session owns the record and socket; the ACP plugin only supplies the model/backend process behind that same pi citizen.

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

## EXECUTION ORDER

### A. Runtime/protocol evidence ✅

- Main `d89446b` owns pi `0.80.7`; full floor/package/loader gates were green.
- `v0.80.6..v0.80.7` did not change the relevant pi session boundary.
- #50 static audit established: caller edges exist on socket/mailbox but not spawn-resume/native-push; pi writer is absent; socket-only is current production fact.
- Historical source re-check established that v2 explicitly designed `backend:"pi"` and described socket-only as pre-writer/deploy-lag state.

### B. Source-level subtraction map ← current

Before code, produce an exact table:

```text
symbol/file → why it mutates or constrains pi → all callers → gates/docs → delete/keep → replacement authority
```

Audit at minimum:

- garden launcher/new-session-id, `/gnew`, `/new` guard;
- `assertGardenNativeSessionId`, `buildGardenSessionName`, `parseSessionName`, resident tags;
- resume marker and `requireEntwurf`;
- `findSessionFileById` normal production callers;
- `SocketOnlyFact`, `socketOnlyPi`, peers rendering and decider rejects;
- target registry: identity residue vs genuinely separate launch policy;
- status/env surfaces that currently assume `ctx.sessionManager.getSessionId() == gardenId`;
- sender envelope and socket path construction;
- docs/gates/install aliases that expose the old contract.

Exit: GLG can see what disappears, what remains, and expected production net line reduction before implementation.

### C. Mutation fence + subtractive working cut

- Add one structural gate proving entwurf does not set pi session names, inject garden native ids, block `/new`, or write native session headers.
- Remove the production manipulation listed above first.
- Run focused gates to catalogue the expected broken consumers. RED is evidence in the working tree, never a commit.
- Do not patch holes with a new env/global/name carrier.

### D. Pi meta-record writer / attach

At `session_start` (`startup|reload|new|resume|fork`):

1. read pi `nativeSessionId = ctx.sessionManager.getSessionId()`;
2. scan `(backend:"pi", nativeSessionId)` by record body;
3. attach exactly one or mint a new garden id; duplicate native ids fail loud;
4. write `cwd`, nullable `model`, nullable `transcriptPath` from public pi context;
5. refresh `transcriptPath` after pi actually materializes the file;
6. start the socket at the **record garden id**, then export the garden sender identity.

Record shape after debt removal:

```text
schemaVersion, gardenId, backend, nativeSessionId,
cwd, model?, transcriptPath?, createdAt, recordUpdatedAt
```

Remove `parentGardenId` and `isEntwurf`; never add liveness/delivery state.

### E. Record-first peers / dispatch / strict resume

- `entwurf_peers`: meta identities are citizens; pi identities get socket liveness enrichment.
- `entwurf_v2`: every normal target resolves by garden-id record first.
- live pi → socket at record garden id;
- dormant pi + owned-outcome → validate record backend/path/native header, then exact `--session <transcriptPath>`;
- resumed child `session_start` reattaches by native id and reopens the same garden socket;
- record-less socket becomes explicit legacy/crash diagnostic, then remove its normal send path after migration evidence.

The old #49 §C bug is absorbed here: exact file handoff remains, but gardenized header/name/tag/marker defenses disappear.

### F. Explicit legacy enrollment

- Existing gardenized sessions are read, never rewritten.
- One-shot enrollment writes records with `gardenId == nativeSessionId` and the existing transcript path.
- Live legacy sessions may attach on reload; dormant authorized targets need explicit import before hard cut.
- After enrollment verification, remove normal header-scan fallback and old socket-only compatibility.
- GC preserves records/transcripts; orphan/null-path records are reported or archived, never silently deleted.

### G. Uniform call provenance — separate from identity cut

- Reuse one sender envelope across socket, mailbox, spawn-resume, and native-push.
- Persist it in the receiver's native delivered turn/mailbox; no central call DB.
- Decide the minimal durable fields (`caller`, time, reply address; intent/transport only if GLG says they matter).
- Do not block the pi identity cut on a call-graph redesign.

### H. Verification / close

Required evidence:

- arbitrary pi-native UUID session becomes one stable garden citizen;
- extension writes no session name/header/id and builtin `/new` works unchanged;
- reload/resume preserve garden id; new/fork mint new garden ids;
- native GPT and pi-hosted ACP satisfy the same `backend:"pi"` lifecycle;
- file-absent birth is honest; first materialization refreshes path;
- record path/header native-id drift fails before socket/model turn;
- wrong child session resolver cannot redirect exact record-backed resume;
- no stored liveness; socket probe remains authority;
- migrated sessions work without JSONL mutation;
- full `pnpm check`, pack/install gates, sandbox negatives, and relevant live resume/send smokes green;
- production diff is net subtractive and every deleted source loses its obsolete gate/docs in the same cut.

Then update #49/#50 with evidence, promote durable rules to AGENTS/README, delete this branch NEXT, and let GLG decide merge/release/push.

## BASELINE

- Branch: `repair/v2-core-debt`; current local commit `5affcfe` atop main `d89446b`.
- Old remote branch still points to pre-rebase `d86b970`; any later update must be deliberate and lease-safe.
- Working tree currently changes only this branch NEXT.
- Main remains the daily usable lane.
