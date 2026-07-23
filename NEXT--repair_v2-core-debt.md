# NEXT — repair/v2-core-debt

> Branch boot sector. 실전 축 한 줄: **pi는 특별한 하네스가 아니라 meta-record로 동작하는 하네스가 된다.** 그게 되면 된 거다. Merge 전 이 파일 삭제.
>
> 설계문서(HOP.md, .agent-reports/)는 폐기했다 — 내용은 git history와 #50에 보존. 종이보다 코드. 터질 수 있는 지점을 아는 채로 터지는 건 실패가 아니다.

## 상태 (2026-07-23)

- 감산 커밋 3개 in, full `pnpm check` GREEN: `77483c5` socket path grammar 단일화(+fence `check-control-socket-path`), `e2eff3b` v1 sync-spawn dead island(entwurf-core.ts −469), **`d125946` C1 — V3 schema hard cut**(31파일 +995/−1560; V3-only production, frozen v1/v2 reader는 meta-migration.ts 단일 주소 + import-allowlist gate, strayness 양방향 게이트, M1 명령 이름 예약 `./run.sh meta-bridge-migrate-v3 migrate`).
- **2026-07-23: `f677284` store-doctor 픽스처 V3화 + `53159b9` main(0.12.8-repair.1) 머지 in.** 게이트 합집합 resolution — 브랜치 V3 게이트 유지 + main 신규 6게이트(capability-bundle-reach, bridge-delivery, hook-launch-topology, meta-doctor-oracle, node/claude-floor-coherence) 보존, v2 게이트 부활 없음. 머지된 aggregate full GREEN(pre-commit hook 실측), check-pack-install도 oracle 로컬 full GREEN(npm-managed install 포함).
- live store 실측(oracle): 167 records, **100% schemaVersion=2**, v1/malformed/filename-mismatch/이물 0. C1 이후에도 live store는 무접촉 — M1/H7 레인이 옮긴다.
- 게이트 재편: check-meta-{record-v2, dual-read, dual-consumers, migration} 4개 삭제 → check-meta-{v3-record, migration-readers, identity-consumers} 3개 신설.

## NOW — vertical slice: pi-attach 테스트까지 최단 경로

목표 테스트: **pi 세션이 SessionStart에서 V3 meta-record(`backend:"pi"`)로 붙고 `entwurf_peers`/`entwurf_v2`로 addressable — 샌드박스 smoke.** 이게 GREEN이면 GLG 핵심 질문("언제 pi가 meta-record로 붙나")에 코드로 답한 것이다.

1. **C1 — V3 schema cut: DONE (`d125946`).** Opus 구조 cut + 페블 게이트 tail. 컴파일러 판정 2건 기록: `requireBackend`는 sender/receiver marker 경로의 live 심볼(native-3 axis는 marker 계약이지 record schema가 아님), `scanByNativeId`는 게이트 전용이라 삭제.
2. **C2 — 단일 경계 cut: DONE.** 삭제 + record 권위 + socket 전환 + 게이트 재저작이 한 커밋, full `pnpm check` GREEN.
   - **삭제**: `--session-id` 주입(resume argv), `assertGardenNativeSessionId` + session_start hard exit, `session_before_switch`/`session_before_fork` 인-프로세스 mint 거부, `/gnew`·`garden-new` + `createGardenSessionFile`/`removeUnadoptedGardenSessionFile`/`GARDEN_SESSION_FILE_VERSION`, `assertSessionIdAvailableForSpawn`, `buildGardenSessionName`+`RESIDENT_SESSION_TAG` 이름 미러(및 그 안의 `entwurf`-tag crash / resume-marker 예외), `scripts/gnew-rpc-drive.ts`.
   - **record 권위**: 새 seam `pi-extensions/lib/pi-citizen-birth.ts` — session_start와 turn_end가 같은 `birthPiCitizen()`을 호출(attach는 멱등, turn_end가 transcriptPath/model을 채운다). `PI_SESSION_ID`·sender envelope·`get_info`가 전부 record gardenId를 싣는다.
   - **socket 전환**: `startControlServer`가 record가 돌려준 socketPath를 받는다. grammar SSOT(`control-socket-path.js`)는 무접촉.
   - **경계에서 강제된 1건 (C3에서 앞당겨짐)**: `--session-id` 삭제는 resume 대상 해석을 같이 옮기지 않으면 성립하지 않는다. gardenId가 더는 pi 세션 id가 아니므로 (a) `pi --session-id <gardenId>`는 resume이 아니라 **빈 세션을 새로 민팅**하고, (b) `findSessionFileById(gardenId)` 헤더 스캔은 아무것도 못 찾으며, (c) `requireEntwurf`가 요구하던 name-tag는 이름 미러와 함께 사라진다. 그래서 `resolveResumeLaunchIdentity`가 `readMetaIdentityByGardenId → record.transcriptPath`로 바뀌고 argv는 `--session <abs>`가 됐다. 분할했으면 정확히 ②가 막으려던 gardenId↔socket-key 분기를 커밋했을 것. **C3에 남은 것**: resumed 파일 헤더 ↔ `record.nativeSessionId` 검증, resume env marker 사슬, `findSessionFilesById` 나머지 소비자, name-authority 사슬(`buildSessionName`→`isKnownProviderModel`→registry), sender envelope prepend.
3. **pi-attach smoke: DONE — `smoke-pi-attach` (`pnpm check` 편입, 20 assertions).** mkdtemp + HOME/XDG 스왑 격리(라이브 store 무접촉). P1 record mint(V3/`backend:"pi"`/nativeSessionId=pi uuid) · P2 gardenId는 record가 민팅 · P3 socket이 record gardenId 키 · **P4 재오픈 attach(같은 gardenId, record 1개, undefined는 keep)** · P5 다른 pi 세션은 다른 시민 · P6/P7 빌드된 dist를 MCP stdio로 몰아 `entwurf_peers` 목록 + `entwurf_v2` 실배달 → socket RPC ack + mailbox 미사용. `check-bridge-delivery`에서 **드라이버만** 재사용했고 fixture/assertion은 socket rail 전용이다.
   - `smoke-resident-garden-guard`(LIVE)는 같은 계약을 실제 `pi` 프로세스로 뒤집어 재저작: BIRTH(`--session-id` 없이 뜬 resident가 시민이 된다) / ATTACH(`--session <file>` 재오픈이 주소를 유지) / REPLACEMENT(인-프로세스 `/new`가 이제 허용되고 socket이 새 주소로 rebind) / POSITIVE(1 turn이 transcriptPath+model을 채운다). 드라이버는 `scripts/resident-rpc-drive.ts`. 이 게이트는 `PI_CODING_AGENT_DIR`를 temp로 돌려 **라이브 v2 store에 V3 record를 섞지 않는다**.

이후 순서:

4. **C3 — resume 권위**: exact `--session <absolute-file>`(record transcriptPath, native header 검증), resume env marker 사슬(`PI_SHELL_ACP_*` leaf/producer/consumer/gates), 정상 resume의 global JSONL header scan(`findSessionFilesById`), `requireEntwurf` name-tag 인가, v1 "entwurf-tagged ⇒ resident 불가" crash, name-authority 사슬(`buildSessionName`→`isKnownProviderModel`→`loadEntwurfTargets`+registry reader) 삭제. spawn-resume prompt 앞에 기존 structured sender envelope prepend(caller-edge 보존; native-push 동형은 후속 H6 성격).
5. **C4 — facts/dispatch record-first**: record-less socket-only를 migration/진단 상태로 강등, dispatch/resolveTarget rail 전환.
6. **M1 + H7 레인 (라이브 cutover)**: M1 operator command(backup `meta-sessions.v3-migration-backup-<ts>/` → migrate → verify non-V3=0 → restore/rollback 증명, fixture: V1/V3-already/malformed/stray-key/mismatch/half-migrated; duplicate는 파일명=gardenId 구조상 불가라 제외). 167 record 라이브 전환: quiesce → backup → M1 → non-V3=0 → 새 런타임. self-host blackout 예상 — cut 직전 ids/HEAD/patch 고정, 끊긴 동안 GLG 수동 릴레이, 양방향 delivery 복구 전 다음 cut 금지.

커밋 규율: 각 커밋은 삭제 + 게이트 재저작 + GREEN이 한 몸. RED는 커밋하지 않는다. 정상 라우팅의 새 dual-authority 금지.

## LOCKED PROTOCOL (요지)

1. meta-record = garden 주소 권위 (`gardenId ↔ backend/nativeSessionId`). 둘이 같을 수 있으나 동일성은 불변식이 아니다.
2. pi 세션은 pi 소유 — id/파일명/헤더/이름/`/new`/`/resume`/저장 형식에 entwurf가 손대지 않는다. pi 자신의 구버전 migrate는 pi 소유 동작.
3. rail ≠ identity: live socket / dormant spawn-resume / mailbox / native-push는 transport일 뿐.
4. liveness는 저장하지 않는다 — socket probe로 계산.
5. caller는 delivered turn의 sender envelope. record에 parent/lastCaller/worker tree 없음.
6. record-backed pi 시민은 전부 sibling. `isEntwurf` 종 boolean 부활 금지. 필요하면 별도 operator policy.
7. V3 hard cut + explicit one-shot M1(installed operator command only, hook 자동실행 금지). entwurf-authored JSONL 수정 없음.
8. ACP는 model/provider axis — pi host 세션이 record와 socket을 소유.

## 게이트 편차 기록

- **`check-pack-install` de-scope는 오진이었다 — 2026-07-23 정정, 재장전 완료.** "upstream registry 고장으로 unrunnable, released main도 동일 RED"는 증거와 맞지 않았다: 실제 CI run 29918778751은 게이트를 끝까지 돌았고 딱 한 줄, C1이 안 옮긴 run.sh store-doctor 픽스처(schemaVersion:2 + V3가 거부하는 parentGardenId/isEntwurf)에서 죽었다. main CI는 내내 GREEN. `f677284`로 픽스처 V3화, oracle 로컬 full check-pack-install GREEN(npm-managed install 포함) 실측. 이 게이트는 다시 산다 — de-scope 근거를 잃었다. 교훈: 게이트를 끄면 자기 회귀를 upstream 탓으로 오진한 채 달린다.
- **registry(`pi/entwurf-targets.json`)는 spawn-bg allowlist가 아니다.** v2 spawn 경로는 이 파일을 읽지 않는다. 실제 dormant resume 인가는 `requireEntwurf` name-tag + resume marker(둘 다 C3 삭제 대상). 살아있는 소비자는 OPS routing(`getRegistryRouting` ← resolve-acp-bridge)뿐. registry DATA/OPS 처분은 C3에서.

## 머지 후 리듬 (0.12.8-repair.1 하네스 in, 2026-07-23)

- **`.ts` 편집 후 `pnpm build-bridge` 먼저.** check-bridge-delivery는 stale dist에 설계상 RED — 자기 변경과 무관해 보이는 "artifact is not stale" RED를 만나면 빌드 누락이다. 새 리듬: `pnpm build-bridge && pnpm check` (빌드 ~5s). pre-commit hook이 full check를 강제한다.
- 로컬 check 세금 +76s — check-meta-doctor-oracle 단독 73s(oracle 실측, thinkpad보다 빠름). CI는 push마다 3 job(check / install-surface / artifact-consumer), 전부 GitHub 러너라 oracle 부담 0.
- **M1+H7 전까지 라이브 `install-meta-bridge` 금지.** 라이브 167 record는 v2, 프로덕션은 V3-only — 지금 라이브에 새 아티팩트를 깔면 store-doctor가 전 record를 거부한다. main 승격 후 릴리즈를 자르더라도 기존 v2 store 호스트(이 oracle 포함)는 M1 migration 전 설치 금지. 신규 설치는 무관(처음부터 V3 mint).
- **main 승격 체크포인트: C2 통합 커밋 + pi-attach smoke GREEN**에서 `main ← repair/v2-core-debt`. 승격 전 이 파일 삭제(boot sector 규칙).

## Do not touch

fresh sibling mint/#47 mux, Cortex/#48, 0.12.9 ACP 의존성 작업, backend auth, transcript hydration, 새 DB/planner/worker 트리.

## SSOT

#50 hard-cut 결정 — https://github.com/junghan0611/entwurf/issues/50
