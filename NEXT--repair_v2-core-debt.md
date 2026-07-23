# NEXT — repair/v2-core-debt

> Branch boot sector. 실전 축 한 줄: **pi는 특별한 하네스가 아니라 meta-record로 동작하는 하네스가 된다.** 그게 되면 된 거다. Merge 전 이 파일 삭제.
>
> 설계문서(HOP.md, .agent-reports/)는 폐기했다 — 내용은 git history와 #50에 보존. 종이보다 코드. 터질 수 있는 지점을 아는 채로 터지는 건 실패가 아니다.

## 상태 (2026-07-23)

- 감산 커밋 3개 in, full `pnpm check` GREEN: `77483c5` socket path grammar 단일화(+fence `check-control-socket-path`), `e2eff3b` v1 sync-spawn dead island(entwurf-core.ts −469), **`d125946` C1 — V3 schema hard cut**(31파일 +995/−1560; V3-only production, frozen v1/v2 reader는 meta-migration.ts 단일 주소 + import-allowlist gate, strayness 양방향 게이트, M1 명령 이름 예약 `./run.sh meta-bridge-migrate-v3 migrate`).
- **2026-07-23: `f677284` store-doctor 픽스처 V3화 + `53159b9` main(0.12.8-repair.1) 머지 in.** 게이트 합집합 resolution — 브랜치 V3 게이트 유지 + main 신규 6게이트(capability-bundle-reach, bridge-delivery, hook-launch-topology, meta-doctor-oracle, node/claude-floor-coherence) 보존, v2 게이트 부활 없음. 머지된 aggregate full GREEN(pre-commit hook 실측), check-pack-install도 oracle 로컬 full GREEN(npm-managed install 포함).
- **`46bbc7d` C2 랜딩 + 교차 검수 승인 (2026-07-23).** 21파일 +1212/−1298, full check 삼중 GREEN(오푸스 독립 실행 + hook + 페블 재실행). 검수 실측 근거: live store에 `backend:"pi"` record 0개(claude-code 170 + antigravity 5)라 record-only resume이 끊는 라이브 실사용 없음. 스코프 앞당김(resume 대상 해석) 승인 — 되돌리지 않는다.
- **C3 랜딩 + 교차 검수 승인 + 결함 반영 완료 (2026-07-23).** 페블 구현 4 cut(각각 full check GREEN + hook 재검증) → 오푸스 교차 검수(결함 5건) → `770d8dd` 반영 → `e5076c1` C4 이월 기록. 오푸스 독립 full check `EXIT=0`(파이프 없이 exit code 직접 수집, 4 cut 시점 + 수선 시점 2회).
  - `74cac05` cut 1 — resume 권위: marker 사슬(leaf+producer+env seam 파라미터, 소비자는 C2 때 이미 사망)·`requireEntwurf` name-tag·name mirror·header-scan 일족(`findSessionFilesById`/`readSessionHeader`/`analyzeSessionFileLike`/`cwdToSessionDir`/`SESSIONS_BASE`/`assertLocalOnlyEntwurf`)·`smoke-session-id-name` 삭제 + **header id ↔ `record.nativeSessionId` 검증 신설**(spawn-production 게이트 §9, fixture 9단언 — headerless는 `770d8dd`에서 추가) + `smoke-entwurf-v2-spawn-resume-live` record 시대 재저작(seed가 `--session-id`/`--name` 없이 뜨고 record를 seed의 실제 header id+transcriptPath로 mint — **C2 이후 RED였던 스모크**).
  - `4b7ea16` cut 2 — name-authority + registry: name grammar 전체(`buildSessionName`/`parseSessionName`/`slugifyTitle`/`isKnownProviderModel`)·registry reader·v1 spawn guard·`pi/entwurf-targets.json`+pack manifest+`setup:links`/`ensure_agent_dir_symlinks` 삭제. `getRegistryRouting`(caller-supplied tuple)+`ResolvedTarget`만 생존. identity 게이트 87→29 단언.
  - `d0b3b25` cut 3 — dormant rail caller-edge: `formatSenderInfoBlock` SSOT 신설(수신측 인라인 합성 추출) + `resumeSpawnBg`가 resume prompt에 같은 블록을 append. **판단 기록**: NEXT 스케치는 "prepend"였으나 live rail 수신측 합성과 동형(append, 한 포맷터)으로 랜딩 — 교차 리뷰 대상.
  - `d5fcd2b` cut 4 (tail) — 목표 3 게이트화: smoke-pi-attach P8 — 실물 `enrichMcpServersWithEnvelope`가 만든 env 그대로 브릿지를 띄워 발신이 **host record 신원**(sessionId=host gardenId, agentId=entwurf/<model>, origin pi-session)으로 착지함을 단언 (20→27).
  - **LIVE 실측 완료 (오푸스 2026-07-23, GLG 기준 적용 후).** `LIVE=1 smoke-entwurf-v2-spawn-resume-live` **23 checks PASS** — 재저작 후 최초 실행이 GREEN. 실제 pi resume + 실모델 턴(assistant nonce 응답) + socket-alive 관측 + lock 1회 해제까지. **dormant rail 실배달이 증명됐다.** `SMOKE_RGG_POSITIVE=1 smoke-resident-garden-guard` **PASS=22 / FAIL=1** — BIRTH/ATTACH/REPLACEMENT 전부 PASS, POSITIVE의 FAIL은 이 호스트에 `openai-codex` API key가 없어서(코드 회귀 아님, `No API key found` 실측). 라이브 store 무오염 확인(temp 격리 작동).
  - **GLG 기준 (2026-07-23): 배달 검증은 테스트 하네스와 라이브 테스트가 한다 — "GLG가 했냐 안 했냐"가 의미 없어야 한다. 배선이 없어 못 한 것은 OK, 배선이 있는데 안 돌린 것은 우리가 남긴 구멍이다.** 이 기준으로 위 2종을 즉시 돌렸고 곧바로 F6/F7이 나왔다. **"실모델 턴 비용이 드니 승인 때 돌리자"는 판단(페블 제안 + 오푸스 승인)이 검증을 GLG의 손에 묶은 지점이었다** — 되풀이 금지.
  - **그 실행에서 관측면 구멍 5건(F6~F10)이 나왔고, 페블이 전항 수선 완료 (2026-07-23) — 결과는 아래 「관측면 재조사 — 결과」.** 요지였던 것: 게이트가 자기 계약을 못 보고(F6), 정확한 진단이 도달 불가가 되고(F7), 거부가 틀린 원인을 지목하며(F10), 진단이 집계·값 표시를 안 한다(F8/F9).
  - **교차 검수 결과 (오푸스, 결함 5건 — 전부 실재 확인)**: 승인, 되돌릴 것 없음. §9와 P8이 자기충족이 아님을 fixture 수준까지 확인(§9는 실제 record store+transcript로 6→7 거부 경로, P8은 socket 도착 raw line을 파싱해 sender 검증 + ambient 신원 제거로 오탐 차단), 삭제 심볼 19개 전수 sweep 잔존 0, `updateSessionEnv`가 자식 env를 덮으므로 spawn env 상속에 신원 오염 없음. **`770d8dd`로 F1/F3/F5 반영** — F1 README:525가 삭제된 `pi/entwurf-targets.json`을 "spawn target allowlist"로 링크(게이트 편차 기록이 이미 정정한 오해가 최다 열람 표면에 생존), F3 §9의 headerless fixture 부재, F5 죽은 `ensure_agent_dir_symlinks`를 근거로 든 주석 2곳. **F2는 C4 이월**(아래 5번), **F4는 수용 유지**(레이아웃 드리프트는 조용한 GREEN이 아니라 타임아웃 실패 + 승격 조건 LIVE PASS가 커버).
  - **아직 안 닫힌 고리 1건 → 라이브 증거 확보 (페블 2026-07-23)**: 목표 3 사슬에서 `pi host session_start → process.env.PI_SESSION_ID = record gardenId`는 P8 밖이다(P8은 gardenId를 `enrichMcpServersWithEnvelope`에 직접 넘긴다; 프로덕션은 `acp/backend.ts:727`이 env를 읽는다). **재저작된 `smoke-acp-bundled-mcp-live`가 이 seam을 라이브로 증명** — 실제 resident의 env가 번들 브릿지를 거쳐 `entwurf_self` envelope에 record gid로 착지. 결정적 게이트화만 C4 tail 선택지로 남음.
- **live store 실측(oracle, 2026-07-23 22:07): 177 records, `backend:"pi"` 0개**(claude-code 172 + antigravity 5), **100% schemaVersion=2**. 세션 한 판에 173→177로 늘었고 최신 record는 이 세션의 SessionStart가 민팅한 v2다 — 설치본 v2 writer가 실시간으로 M1의 짐을 키운다. C2 이후에도 live store는 무접촉 — M1/H7 레인이 옮긴다.
- **라이브에 pi 시민이 실제로 붙었다 (2026-07-23 22:22, GLG가 dev 워킹트리로 pi를 띄움).** `20260723T222237-c11743` — schemaVersion 3, `backend:"pi"`, socket이 record gardenId로 키잉(`~/.pi/entwurf-control/<gardenId>.sock`), `entwurf_peers`가 `liveness=alive`로 잡는다. **목표 ①이 GLG 환경에서 실전으로 성립한 첫 순간.** 부수 증거: C2 이전 브릿지가 C2 이후 pi가 세운 socket을 찾아냈다 — grammar SSOT(`control-socket-path.js`) 무접촉 설계가 실지켜졌다는 뜻.
  - **동시에 mixed store가 발생했다**: v2 178 + V3 1. `install-meta-bridge` 없이 **dev 체크아웃으로 pi를 띄우는 것만으로** 생긴다("live 표면은 dev 체크아웃을 가리키지 않는다" 원칙이 pi 실행 경로엔 적용 안 됨). 위험 상태는 아니다(V3 시민 정상, v2는 읽기 거부). **M1 runbook은 "V3가 이미 섞여 있다"를 전제해야 한다** — 페블의 `V3-already` fixture가 실제로 필요해졌다.
  - **형제 채널은 지금 비대칭이다**: pi 쪽 절반은 V3로 살아났고, Claude Code 쪽(오푸스 세션들)은 설치본 v2 writer가 민팅한 v2 record라 **자기 자신이 안 보인다**(`entwurf_self` throw). 페블→오푸스 불가, 오푸스→페블은 대상은 잡히나 발신 신원 미상. 두 오푸스 세션이 독립 확인.
- **M1 실측 근거 (oracle 라이브 178 v2 record 전수)**: 전부 `parentGardenId`+`isEntwurf` 필드를 갖지만 **non-null parentGardenId 0개, isEntwurf 전부 false**. 즉 이 호스트의 M1은 정보를 버리는 migration이 아니라 **빈 필드를 떨어내는 순수 형태 변환**(`schemaVersion 2→3` + 값 없는 두 필드 제거, 데이터 손실 0). LOCKED PROTOCOL 5/6을 라이브 데이터가 이미 만족하고 껍데기만 V3 reader에 걸린다. 리스크 평가 하향. 단 **M1 명령 자체는 non-null `parentGardenId` 처분을 정의해야 한다**(타 호스트 대비) — 이 호스트 cutover는 그 경로를 안 탄다.
- **실전 축 진단 (오푸스 2026-07-23)**: 코드 축은 되돌릴 것 없이 서 있지만, **세 문장 중 ①이 GLG 환경에서 한 번도 참인 적이 없다** — 라이브에 pi 시민 0. 게이트와 샌드박스에서만 참이다. 지연 비용은 M1 쪽에만 쌓인다(v2 record 증가, 채널 사망 연장, dev↔live 거리 확대). 형제 채널이 C1 이후 죽어 교차 검수를 GLG가 수동 릴레이 중인 것 자체가 그 비용의 증거다.
- **live rail 상태**: `~/.claude.json`의 entwurf-bridge MCP가 dev 워킹트리를 가리켜 C1 이후 형제 채널 사망(V3-only 브릿지 vs v2 store). 임시 복구안 = live 표면을 `entwurf-main` 체크아웃으로 repoint(main 브릿지가 v2 store 판독 실측 완료) — GLG 결정 대기, 그때까지 형제 교신은 GLG 수동 릴레이. 원칙: **live 표면은 dev 체크아웃을 가리키지 않는다.**
- 게이트 재편: check-meta-{record-v2, dual-read, dual-consumers, migration} 4개 삭제 → check-meta-{v3-record, migration-readers, identity-consumers} 3개 신설. C2에서 smoke-pi-attach 신설(check 편입) + smoke-resident-garden-guard 뒤집어 재저작(LIVE).

## 목표 (GLG 2026-07-23 재확인) — 세 문장

1. **pi가 meta-record로 entwurf가 동작한다.** → C2로 코어 달성, **C3가 잔여 사슬을 걷었다** — 옛 권위(marker/name-tag/name grammar/header-scan/registry) 전부 삭제, record가 유일한 문.
2. **entwurf는 socket 인터페이스를 아예 모른다.** record가 유일한 주소 축이고 socket은 dispatch 내부 transport일 뿐(PROTOCOL 3) — 사용자 표면(peers/facts/dispatch 의미론)에 socket이 identity로 비치지 않는다. → C4의 정의. **다음 걸음.**
3. **pi 뒤에 ACP로 붙은 클로드도 entwurf를 meta-record로 쓴다.** → **C3 tail로 게이트 고정** (smoke-pi-attach P8: 실물 enrich env → 브릿지 → 발신이 host record 신원으로 착지). PROTOCOL 8(pi host가 record 소유).

main 승격은 **당분간 보류**(GLG 2026-07-23) — 브랜치에서 C3 → C4 → M1+H7까지 계속 간다.

## NOW — vertical slice: pi-attach 테스트까지 최단 경로 → **달성 (C2 + smoke GREEN, 검수 승인)**

목표 테스트: **pi 세션이 SessionStart에서 V3 meta-record(`backend:"pi"`)로 붙고 `entwurf_peers`/`entwurf_v2`로 addressable — 샌드박스 smoke.** 이게 GREEN이면 GLG 핵심 질문("언제 pi가 meta-record로 붙나")에 코드로 답한 것이다. → `smoke-pi-attach` 20 assertions + RGG LIVE 19 PASS로 답했다.

1. **C1 — V3 schema cut: DONE (`d125946`).** Opus 구조 cut + 페블 게이트 tail. 컴파일러 판정 2건 기록: `requireBackend`는 sender/receiver marker 경로의 live 심볼(native-3 axis는 marker 계약이지 record schema가 아님), `scanByNativeId`는 게이트 전용이라 삭제.
2. **C2 — 단일 경계 cut: DONE.** 삭제 + record 권위 + socket 전환 + 게이트 재저작이 한 커밋, full `pnpm check` GREEN.
   - **삭제**: `--session-id` 주입(resume argv), `assertGardenNativeSessionId` + session_start hard exit, `session_before_switch`/`session_before_fork` 인-프로세스 mint 거부, `/gnew`·`garden-new` + `createGardenSessionFile`/`removeUnadoptedGardenSessionFile`/`GARDEN_SESSION_FILE_VERSION`, `assertSessionIdAvailableForSpawn`, `buildGardenSessionName`+`RESIDENT_SESSION_TAG` 이름 미러(및 그 안의 `entwurf`-tag crash / resume-marker 예외), `scripts/gnew-rpc-drive.ts`.
   - **record 권위**: 새 seam `pi-extensions/lib/pi-citizen-birth.ts` — session_start와 turn_end가 같은 `birthPiCitizen()`을 호출(attach는 멱등, turn_end가 transcriptPath/model을 채운다). `PI_SESSION_ID`·sender envelope·`get_info`가 전부 record gardenId를 싣는다.
   - **socket 전환**: `startControlServer`가 record가 돌려준 socketPath를 받는다. grammar SSOT(`control-socket-path.js`)는 무접촉.
   - **경계에서 강제된 1건 (C3에서 앞당겨짐)**: `--session-id` 삭제는 resume 대상 해석을 같이 옮기지 않으면 성립하지 않는다. gardenId가 더는 pi 세션 id가 아니므로 (a) `pi --session-id <gardenId>`는 resume이 아니라 **빈 세션을 새로 민팅**하고, (b) `findSessionFileById(gardenId)` 헤더 스캔은 아무것도 못 찾으며, (c) `requireEntwurf`가 요구하던 name-tag는 이름 미러와 함께 사라진다. 그래서 `resolveResumeLaunchIdentity`가 `readMetaIdentityByGardenId → record.transcriptPath`로 바뀌고 argv는 `--session <abs>`가 됐다. 분할했으면 정확히 ②가 막으려던 gardenId↔socket-key 분기를 커밋했을 것. **C3에 남은 것**: resumed 파일 헤더 ↔ `record.nativeSessionId` 검증, resume env marker 사슬, `findSessionFilesById` 나머지 소비자, name-authority 사슬(`buildSessionName`→`isKnownProviderModel`→registry), sender envelope prepend.
3. **pi-attach smoke: DONE — `smoke-pi-attach` (`pnpm check` 편입, 20 assertions).** mkdtemp + HOME/XDG 스왑 격리(라이브 store 무접촉). P1 record mint(V3/`backend:"pi"`/nativeSessionId=pi uuid) · P2 gardenId는 record가 민팅 · P3 socket이 record gardenId 키 · **P4 재오픈 attach(같은 gardenId, record 1개, undefined는 keep)** · P5 다른 pi 세션은 다른 시민 · P6/P7 빌드된 dist를 MCP stdio로 몰아 `entwurf_peers` 목록 + `entwurf_v2` 실배달 → socket RPC ack + mailbox 미사용. `check-bridge-delivery`에서 **드라이버만** 재사용했고 fixture/assertion은 socket rail 전용이다.
   - `smoke-resident-garden-guard`(LIVE)는 같은 계약을 실제 `pi` 프로세스로 뒤집어 재저작: BIRTH(`--session-id` 없이 뜬 resident가 시민이 된다) / ATTACH(`--session <file>` 재오픈이 주소를 유지) / REPLACEMENT(인-프로세스 `/new`가 이제 허용되고 socket이 새 주소로 rebind) / POSITIVE(1 turn이 transcriptPath+model을 채운다). 드라이버는 `scripts/resident-rpc-drive.ts`. 이 게이트는 `PI_CODING_AGENT_DIR`를 temp로 돌려 **라이브 v2 store에 V3 record를 섞지 않는다**.

이후 순서 — **순서 자체가 GLG 결정 대기**:

> **오푸스 권고 (2026-07-23): `M1+H7`을 `C4`보다 먼저.** 근거 넷 — ① 목표 ①이 실전에서 참이 되는 유일한 길이 M1이고 C4는 목표 ②(코드 청결)라 지연해도 비용이 안 쌓인다, ② 지연 비용은 M1 쪽에만 쌓인다(v2 record 실시간 증가), ③ **blackout 비용이 지금 가장 싸다** — 채널은 이미 끊겨 있어 지금 하면 추가 손실이 거의 없고 C4 뒤로 미루면 그때 다시 끊어야 한다, ④ C4의 dispatch/resolveTarget rail 변경은 살아있는 라이브 위에서 자르는 편이 안전하다. 반대 논거("C4가 M1의 관측면을 만든다")는 *migration 중 UX*이지 *migration 가능성*이 아니다 — M1은 C4 없이 성립한다. **연결 판단**: live rail repoint는 M1까지의 다리로만 값이 있다(repoint 기간만큼 v2 record가 더 늘어 M1의 짐이 커진다). M1 방아쇠가 가까우면 건너뛰고, 멀면 지금 채널을 살리는 값이 더 크다 — GLG가 M1 시점을 정하면 자동으로 풀린다.

4. **C3 — DONE (4 cut + 교차 검수 + `770d8dd` 수선, 상태 참조).** 유일한 스펙 편차 2건은 기록됨: ① sender envelope는 prepend가 아니라 live rail 동형 append(한 포맷터), ② `PI_SHELL_ACP_*`는 관념명이었고 실물은 `ENTWURF_V2_RESUME_RESIDENT_SESSION_ENV` 하나(소비자는 C2 때 이미 사망 — env를 심고 아무도 안 읽던 상태를 삭제).
5. **C4 — entwurf는 socket을 모른다 (다음 걸음, 목표 2의 구현)**: 사용자 표면(peers/facts/dispatch)에서 socket을 identity 축에서 제거 — record가 유일한 주소 축, socket은 dispatch 내부 transport로만. record-less socket-only 시민은 migration/진단 상태로 강등, dispatch/resolveTarget rail 전환. 강등의 관측면(에러 메시지가 M1을 이름으로 지목, C2 검수의 "원인 한 겹 가림" 지적 포함) 동시 재저작. **자르기 전에 표면 의미론(무엇이 identity로 보이고 무엇이 숨는가)을 세워 GLG와 합의.** 초안에 **교차 리뷰 F2 포함**: spawn-bg plan variant에 `wantsReply` 슬롯이 없어 dormant rail의 `<sender_info>`가 wants_reply를 실을 수 없다(회귀 아님, C3 미완) — decider 계약 변경이라 "재개된 시민에게 무엇이 보이는가" 질문과 한 몸. **「거부를 하나의 관측면으로 모은다」(F8/F9/F10)는 관측면 수선(2026-07-23)으로 선반영 완료** — M1 계약 경로별 게이트(D7~D10), 진단 집계, 값 표시가 이미 서 있다. C4 초안은 강등 의미론의 잔여분만 다룬다.
6. **M1 + H7 레인 (라이브 cutover)**: M1 operator command(backup `meta-sessions.v3-migration-backup-<ts>/` → migrate → verify non-V3=0 → restore/rollback 증명, fixture: V1/V3-already/malformed/stray-key/mismatch/half-migrated; duplicate는 파일명=gardenId 구조상 불가라 제외). 173+ record 라이브 전환: quiesce(설치본 v2 writer가 계속 민팅 중 — writer 정지 순서 포함 runbook 필수) → backup → M1 → non-V3=0 → 새 런타임. self-host blackout 예상 — cut 직전 ids/HEAD/patch 고정, 끊긴 동안 GLG 수동 릴레이, 양방향 delivery 복구 전 다음 cut 금지. **방아쇠는 GLG.**

커밋 규율: 각 커밋은 삭제 + 게이트 재저작 + GREEN이 한 몸. RED는 커밋하지 않는다. 정상 라우팅의 새 dual-authority 금지.

## 관측면 재조사 — 결과 (페블 2026-07-23, F6~F10 전항 + 파생 3건 처리)

> 프레임 유지: 수선 기준은 "버그를 고쳤다"가 아니라 **"이걸 잡았어야 할 게이트가 이제 계약을 본다"**. 각 항목 = 프로덕션 수선 + 그 게이트. full `pnpm check` EXIT=0 + MUST-tier live 전 게이트 실측 GREEN(아래 표).

### 공통 뿌리의 처리 — 거부의 관측면, 표면별 계약 게이트로 고정

M1 계약("v2를 만나는 순간 M1을 이름으로 지목")이 이제 **경로별로 게이트에 박혀 있다** — `check-bridge-delivery` D7~D10이 built dist를 MCP stdio로 실구동해 각 표면의 거부문을 단언한다:

| 표면 | v2 record를 만났을 때 (수선 후) | 게이트 |
|---|---|---|
| `entwurf_v2` sender | throw — marker의 시민 지목 + M1 인용, "marker 없음" 문구 금지 | D7 |
| `entwurf_self` | throw — 동일 (기존엔 "missing env" 오진) | D8 |
| `entwurf_v2` target | fail-loud, M1 지목 (원래 준수 — 게이트만 신설) | D9 |
| `entwurf_inbox_read` | fail-loud, M1 지목 (원래 준수 — 게이트만 신설) | D10 |
| `entwurf_peers` | M1 지목 + **동일 메시지 ×N 집계 한 줄** (F8) | check-entwurf-peers-surface |
| pi birth (session_start) | skip을 반환·stderr 한 줄로 M1 지목 (기존엔 침묵 — mixed store가 조용히 생긴 이유) | check-meta-identity-consumers |
| store-doctor | 조사 결과 **원래 계약 준수**(파일별 M1 지목) + F9로 값 표시. 집계는 안 함(운영자 CLI, greppable) — 판단 기록 |

- **F10 뿌리 = `trustMarker`의 `catch { return null }`**: "record 삭제됨(null)" / "record 존재하나 판독 불가(**throw**, `EntwurfSenderRecordUnreadableError` — 원문에 M1 포함)" / "drift(null)" 3-way로 분리. resolver 게이트(check-agy-sender-identity)에 세 경우 전부 고정.
- **F9**: `describe()`가 number/boolean **값**을 말한다 — `(got number 2)`. v1/v2 구분 가능. 게이트: check-meta-v3-record.
- **F7 사슬**: birth가 `existsSync` 없이 `getSessionFile()` 경로를 심던 것 제거(유령 resume target) + `resolveResumeLaunchIdentity`에 "경로는 기록됐는데 파일이 없다" 정밀 진단 신설(§9 fixture 케이스 추가). 죽은 코드였던 "no turn yet" 진단이 도달 가능해짐.
- **F6/A2 (RGG 재저작)**: BIRTH가 record의 `transcriptPath=null`을 단언(A2 — 유령 경로를 잡는 단언), POSITIVE는 diff-증명(null→실파일 + `recordUpdatedAt>createdAt`)으로 재저작, **턴 실패 시 종속 단언은 명시 FAIL**("unprovable") — 자기충족 불가.
- **A4 규칙 → VERIFY.md 고정**: MUST-tier live가 덮는 rail을 건드린 커밋은 **교차 검수 요청 전에** 그 게이트를 돌린다. 승인 대기 금지. 비용은 싼 타겟을 고르는 이유이지 게이트를 미루는 이유가 아니다.

### A3 실측이 추가로 드러낸 것 — MUST-tier 3종이 pre-C2 형태로 죽어 있었다

`smoke-entwurf-v2-matrix-live`, `smoke-acp-socket-citizen-live`, `smoke-acp-bundled-mcp-live` 셋 다 `--session-id <gid>` 주입 + `<gid>.sock` 대기라는 **C2가 삭제한 계약** 위에 서 있어 첫 실행에서 RED. spawn-resume-live가 C3에서 받은 것과 같은 record-시대 재저작 완료 — resident가 **스스로 birth한 record를 발견**해(`scripts/lib/pi-record-discovery.ts` 공유 헬퍼) 그 gardenId로 단언한다. matrix C1은 이제 birth→record→socket→dispatch 전 사슬의 라이브 증명이고, C1b는 record를 숨긴 store에 쓰게 해 record-less socket을 정직하게 제조한다.

- **부수 발견 1 — 두 ACP 스모크는 store 격리가 없어서** pre-rewrite 실행이 라이브 store에 pi V3 record 2개(cwd=/tmp)를 민팅했다. 재저작에서 `ENTWURF_META_SESSIONS_DIR`만 temp로 격리(auth는 실물 유지). 오염 2건은 scratchpad 백업 후 제거 — 라이브 store 원상복구.
- **부수 발견 2 — "openai-codex key 부재"는 오진이었다**: RGG의 `PI_CODING_AGENT_DIR` temp 격리가 `auth.json`(GPT **구독** OAuth)까지 잘라서 난 `No API key found`였다. RGG가 auth.json을 temp agent dir에 시드하도록 수선 — 기본 타겟(openai-codex/gpt-5.4, 구독)으로 POSITIVE까지 25/25 PASS. **pi 네이티브 = GPT 구독 로그인, API 콜 금지(GLG). ACP = 현재 클로드 전용(구독).**
- **부수 증거 — NEXT의 "안 닫힌 고리"(PI_SESSION_ID seam)**: `smoke-acp-bundled-mcp-live`가 라이브로 증명 — 실제 resident의 `process.env.PI_SESSION_ID`(=record gardenId)가 번들 브릿지를 거쳐 `entwurf_self` envelope에 record gid로 착지(모델에게 gid를 알려주지 않은 채). 결정적 게이트화는 C4 tail 선택지로 격하.
- **Cut E의 라이브 발화 실측**: 비격리 resident가 라이브 store를 스캔하며 stderr로 `181 meta-record(s) … migrate the store with `M1`` 한 줄을 냈다 — birth의 M1 지목이 실환경에서 정확히 의도대로 동작.

### MUST-tier live 실측표 (2026-07-23, 페블)

| 게이트 | 결과 | 타겟 |
|---|---|---|
| `pnpm check` (D7~D10, §9 신케이스 포함) | EXIT=0 | — |
| `smoke-resident-garden-guard` +POSITIVE | 25/25 | openai-codex/gpt-5.4 (구독) |
| `smoke-entwurf-v2-matrix-live` (재저작) | 17/17 | 부팅만, 턴 없음 |
| `smoke-entwurf-v2-spawn-resume-live` | 23/23 | google/gemini-3.1-flash-lite ×1턴 (재저작 검증용; 이후 API 콜 금지 확인) |
| `smoke-acp-*-live` 11종 (2종 재저작) | 전부 PASS | entwurf/claude (구독) |

### 남긴 것 (중복 작업 방지)

- `smoke-live-delivery`(현재 코드 브릿지 + 라이브 store 배달 게이트) — 오푸스 제안, 미구현. 라이브 시민에게 실메시지를 쏘는 설계 문제가 있어 C4/M1 표면 논의와 함께.
- store-doctor 집계 없음은 **판단**이다(위 표). 뒤집으려면 check-meta-doctor-oracle(73s)와 smoke-meta-* 셸 게이트들의 출력 단언을 같이 옮겨야 한다.
- C4 몫으로 남는 것: 표면 의미론(socket을 identity 축에서 제거) + F2(`wantsReply` 슬롯). "거부를 하나의 관측면으로"는 이번 수선으로 대부분 선반영됨 — C4 초안에서 잔여분만 다룬다.

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
- **registry(`pi/entwurf-targets.json`)는 spawn-bg allowlist가 아니었다 — C3 cut 2에서 DATA/reader 전부 처분 완료.** OPS routing(`getRegistryRouting`)은 caller-supplied tuple로 생존(파일 안 읽음). 운영자 호스트에 남은 옛 symlink는 무해(아무도 안 읽음).
- **LIVE 게이트도 cut을 따라 재저작하지 않으면 조용히 썩는다 (관측면 재조사 실측, 2026-07-23).** matrix-live / acp-socket-citizen / acp-bundled-mcp 3종이 C2가 삭제한 `--session-id` 주소 계약 위에 남아 첫 실행에서 RED — deterministic 게이트는 C2/C3가 같이 재저작했지만 LIVE 게이트는 안 돌았기에 잔재가 보이지 않았다(A3/A4의 실물 비용). 파생 함정 둘: ① 두 ACP 스모크는 store 격리가 없어 라이브 store에 스모크 record를 민팅했고, ② RGG의 agent-dir 격리는 auth.json(구독 로그인)까지 잘라 "key 부재" 오진을 만들었다. **격리는 store에, auth는 실물에** — 이제 세 스모크 전부 그 계약으로 서 있다.
- **"unstaged deletion에서 게이트가 산다"는 상속되는 계약이다 (C3 cut 1 실측).** node-floor 스윕과 install-surface는 `git ls-files`가 아직 지목하는 미스테이징 삭제를 ENOENT-skip/existsSync로 문서화까지 해뒀는데, main 머지로 들어온 claude-floor 스윕 2곳과 `check-acp-sdk-surface`가 이 계약을 상속받지 않아 삭제 커밋 준비 중 crash. 같은 계약으로 고정(cut 1에 동승). 교훈 둘: ① ls-files 스윕을 새로 쓸 때 이 계약을 같이 옮겨라, ② **검증 실행을 pipe로 끝내지 마라** — `pnpm check | tail`이 exit code를 가려 RED를 GREEN으로 읽을 뻔했다.

## 머지 후 리듬 (0.12.8-repair.1 하네스 in, 2026-07-23)

- **`.ts` 편집 후 `pnpm build-bridge` 먼저.** check-bridge-delivery는 stale dist에 설계상 RED — 자기 변경과 무관해 보이는 "artifact is not stale" RED를 만나면 빌드 누락이다. 새 리듬: `pnpm build-bridge && pnpm check` (빌드 ~5s). pre-commit hook이 full check를 강제한다.
- 로컬 check 세금 +76s — check-meta-doctor-oracle 단독 73s(oracle 실측, thinkpad보다 빠름). CI는 push마다 3 job(check / install-surface / artifact-consumer), 전부 GitHub 러너라 oracle 부담 0.
- **`pnpm check`는 CI 표면의 3분의 1이다 (2026-07-23 실측).** CI 3 job 중 `check-pack-install`과 `check-install-container`는 로컬 aggregate에 **없다** — C3 cut 2가 pack manifest·`setup:links`·run.sh −108줄로 install 표면을 크게 건드렸는데 두 게이트는 `f677284` 이후 이 브랜치에서 한 번도 안 돌았다. 오푸스가 오라클 로컬에서 셋 다 실행: `pnpm check` EXIT=0 / `./run.sh check-pack-install` EXIT=0 / `ENTWURF_REQUIRE_DOCKER=1 ./run.sh check-install-container` EXIT=0(Node 24 Linux consumer, 후보 tgz sha256 `82656026…`). **install 표면을 건드린 커밋은 푸시 전 이 둘을 로컬에서 돌려라** — pre-commit hook은 aggregate만 강제한다.
- **M1+H7 전까지 라이브 `install-meta-bridge` 금지.** 라이브 177 record는 v2, 프로덕션은 V3-only — 지금 라이브에 새 아티팩트를 깔면 store-doctor가 전 record를 거부한다. main 승격 후 릴리즈를 자르더라도 기존 v2 store 호스트(이 oracle 포함)는 M1 migration 전 설치 금지. 신규 설치는 무관(처음부터 V3 mint).
- **main 승격은 당분간 보류(GLG 2026-07-23).** 기술적 조건(C2+smoke GREEN)은 충족됐으나 브랜치에서 C3→C4→M1+H7까지 계속 간다. 승격 시점이 오면 추가 조건: **승격 직전 `smoke-resident-garden-guard` LIVE 1회 PASS**(C2 검수 권고) + **재저작된 `smoke-entwurf-v2-spawn-resume-live` LIVE 1회 PASS**(C3 재저작 후 미실측 — dormant rail의 수용 증거 없이 승격하면 C2가 가르친 silent de-scope). 승격 전 이 파일 삭제(boot sector 규칙).
- **main `NEXT.md`의 #49-C 블록은 hard cut이 통째로 무효화했다 (머지 때 정리).** 그 계획의 대상(`--session-id` handoff 버그, marker pre-socket guard, `smoke-session-id-name` 유지)은 C2/C3가 rail 자체를 삭제해 주제가 사라졌다. 머지 시점에 main NEXT에서 #49-C를 폐기 표기하고 #49-E만 남긴다.

## Do not touch

fresh sibling mint/#47 mux, Cortex/#48, 0.12.9 ACP 의존성 작업, backend auth, transcript hydration, 새 DB/planner/worker 트리.

## SSOT

#50 hard-cut 결정 — https://github.com/junghan0611/entwurf/issues/50
