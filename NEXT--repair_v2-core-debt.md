# NEXT — repair/v2-core-debt

> Branch boot sector. 실전 축 한 줄: **pi는 특별한 하네스가 아니라 meta-record로 동작하는 하네스가 된다.** 그게 되면 된 거다. Merge 전 이 파일 삭제.
>
> 설계문서(HOP.md, .agent-reports/)는 폐기했다 — 내용은 git history와 #50에 보존. 종이보다 코드. 터질 수 있는 지점을 아는 채로 터지는 건 실패가 아니다.

## NOW (2026-07-24 오전 갱신 → M1 랜딩)

- **M1 operator command 랜딩 (페블 2026-07-24, 오푸스 검수 대기).** `scripts/meta-bridge-migrate-v3.ts` — allowlist가 예약해둔 바로 그 경로에, 3 verb(`migrate [--drop-parentage]` / `verify` / `restore <backup-dir>`), env+default store 해석(dir argv 없음 — H7 runbook은 THE live store를 겨눈다). dangling name 종료: run.sh dispatch + usage + `pnpm check` 편입(`check-meta-migrate-v3`, CLI를 서브프로세스로 모는 52단언 — §6 fixture 6종 + parentage 처분 + verify 집계(F8 ×N) + restore 왕복) + tsconfig.build emit + check-pack/tar_required 목록 + check-pack-install 설치본 verify 드라이브. **판단 기록(오푸스 검토 대상) 3건**: ① non-null `parentGardenId`/`isEntwurf=true`는 기본 REFUSE(쓰기 0) + `--drop-parentage`가 명시 처분 — 백업이 원본 바이트 보존(#50 Call ≠ parentage; 이 호스트 실측 0건이라 cutover는 이 경로를 안 탐), ② migrate는 classify-first all-or-nothing — malformed/stray/half-migrated/drift/**duplicate nativeSessionId**까지 전부 쓰기 전 거부(blackout 중 발견보다 quiesce 전 발견이 싸다), ③ restore는 `.v3-migration-backup-` 이름만 수용 + 현 store를 `.pre-restore-<ts>`로 옮겨두고 복사(아무것도 파괴 안 함).
- Current: **세 문장 목표 ①②③ 전부 코드로 성립 + C4 교차 검수 2라운드 완료(승인, 되돌림 0) + 결함 9건 전항 반영 + M1 command 랜딩.** push 대기. 남은 것은 **H7 라이브 cutover 하나** (§6 runbook, 방아쇠는 GLG).
- **C4 교차 검수 R1 (오푸스, GLG 위임 headless 세션 — 보고서 `/tmp/entwurf-c4-review/report.md`)**: 독립 full check EXIT=0(2332 단언) + **변이 8종을 스크래치 트리에 심어 게이트 자기충족 검증 — 7종 RED**(A1 부활·sessions 부활·익명 기본 복귀·REQUIRE 재성장·M1 명명 제거·wantsReply 회귀·folding 제거), 라이브 로그 내부 대조로 aggregate가 C4 트리에서 돌았음 확인. 판단 기록 3건 전부 동의. 뚫린 1종(hatch 봉투 replyable:true를 아무 게이트도 못 잡음)이 F3. → 결함 6건(F1~F6).
- **R1 수선 (페블)**: `e906f8f` F1/F2/F4/F6 — README 발신 정책 4곳+hatch 문서화+Codex 절, run.sh usage·주석 5곳, ROADMAP 원장 3곳, provider doc + **AGENTS 승격 2건**(판단① self/peers 경계, "무효화된 문장 찾기" 규율+대상 목록). `f757a33` F3/F5 — D12에 `(external, non-replyable)` 단언+`replyable —` 부정 단언, 감산 잔재 2건 결합 삭제, **biome `noUnusedImports`=error(결합 규칙 첫 기계 backstop)**.
- **검수 R2 + 수선 (오푸스, 같은 세션)**: 수선 후 full check EXIT=0(2328 단언 — 회계 일치: `shouldListAsLive` 동반 삭제 −5, 신설 D12 +1). **변이 재실행 3종**: R1에서 유일하게 뚫렸던 `replyable:true`가 이제 D12로 RED, 미사용 import 재도입이 `biome check` EXIT=1, `noUnreachable`도 여전히 RED(**그룹 오버라이드가 나머지 recommended 규칙을 끄지 않았음을 확인** — 껐다면 backstop을 얻으며 lint를 약화시킨 셈). F1~F6 전항 확인. 새 결함 3건(G1~G3)을 오푸스가 직접 수선 → 이 커밋.
  - **G1** `docs/setup-clean-host.md` Stage 7이 pre-C2 launcher를 가르쳤다 — `--session-id` 주입 + **존재하지 않는 hard-exit 가드 주장** + 틀린 소켓 경로 주석(record가 자기 gid를 민팅하므로 주입한 id로는 소켓이 안 선다), `:233`은 pre-C4 sender 문장. **원인: AGENTS 대상 목록에 `docs/`가 없었다** — 규율의 구멍이 미스가 난 자리와 같았다. 목록에 `docs/**` 추가(+ 왜 install 가이드가 README보다 비싼지).
  - **G2** `f757a33` 자신이 `shouldListAsLive`의 정책 산문 2줄을 남겼다(`socket-probe.ts` 모듈 doc, `check-socket-probe.ts` 헤더). 같이 발견된 pre-C4 잔재(모듈 doc이 브릿지를 소비자로 지목 — 브릿지는 socket-probe를 import하지 않는다)도 정정. **기계 backstop은 심볼을 잡지 산문을 못 잡는다**는 실증.
  - **G3** NEXT 커밋 수 off-by-one(23 → 실측 24).
- Next: (1) **오푸스 교차 검수** (M1 커밋 — 위 판단 기록 3건 포함) → (2) GLG: **push 여부** → (3) **H7 라이브 cutover** (runbook은 §6, "V3-already" 전제 — M1 fixture가 이미 커버).
- 대기: Ⅰ-4 `smoke-agy-native-push-live`(살아있는 `AGY_CONVERSATION_ID` 필요), 「기계가 말하는 장치」(게이트별 마지막 PASS × rail 대조 — 오푸스 최우선 후보; F5의 biome backstop이 같은 계열의 첫 조각).
- Do not touch: fresh sibling mint/#47, Cortex/#48, 0.12.9 ACP 의존성, backend auth, transcript hydration, 라이브 `install-meta-bridge`(M1 전 금지).

## 상태 (2026-07-24 저녁)

- **C4 랜딩 — 목표 ② "entwurf는 socket을 모른다" 코드로 성립 (페블, 오푸스 검수 대기).** 4 cut + 문서 수선, 커밋마다 full check GREEN: `be12348` cut① F2(spawn-bg plan `wantsReply` → dormant `<sender_info>` live rail 동형) · `d76d9f7` cut② dispatch rail(A1 narrow 삭제 — record-less socket은 모든 intent pre-probe `record-less-socket` 거부, 원인+M1 명명; `socket-only-no-resume-authority` 은퇴, +212/−312) · `5d99173` cut③ 목록 표면(legacy `sessions` projection·`controlDir`·socketOnly 섹션·per-socket get_info enrich·`/entwurf-sessions` 삭제 — peers = 시민+진단 2섹션, record-less는 F8 집계 진단, +352/−518) · `bc3f72d` cut④ 발신 신원(익명 발신 기본 거부, `ENTWURF_BRIDGE_ALLOW_ANONYMOUS_SENDER=1`이 유일한 문서화 hatch, REQUIRE env 은퇴 — installer/doctor/oracle/컨테이너 동반 재저작, D11/D12 신설) · `924f7d9` docs(README의 A1 시대 문장 3곳+dispatch 표, **pre-C2 `--session-id` launcher 섹션**, DELIVERY 행 — "무효화된 기존 문장 찾기" 규율 적용).
- **C4 실측 (2026-07-24)**: `check-pack-install` EXIT=0 + `ENTWURF_REQUIRE_DOCKER=1 check-install-container` EXIT=0(새 후보 tgz sha256 `d526378a…`) + **aggregate `LIVE=1 release-gate` MUST PASS=16 FAIL=0 SKIP=0 + BEHAVIOR PASS=1, EXIT=0** (record 시대 두 번째 aggregate GREEN — "게이트 신선도 장치"의 둘째 데이터 포인트). matrix-live 20/20: **실제 record-less resident의 live socket이 두 intent 모두 pre-probe 거부 + lock 무접촉 + 렌더가 record 권위와 M1을 명명** — C4 강등의 라이브 증명. spawn-resume-live 23/23(openai-codex/gpt-5.4 구독 1턴) — wantsReply 실린 dormant rail 실배달.
- 판단 기록(오푸스 검토 대상): ① `entwurf_self`의 socketPath/mailboxPath 라인은 자기 transport 진단으로 보고 C4 범위 밖 유지, ② record-less-socket을 **pre-probe**(null liveness)로 분류 — presence lstat은 liveness 측정이 아니라는 근거, A1의 "살아있는 걸 absent로 부르지 마라"는 `bad-target`과의 분리로 계승, ③ D12 hatch의 배달 본문은 external-mcp를 정직하게 명명.

## 상태 (2026-07-23)

- 감산 커밋 3개 in, full `pnpm check` GREEN: `77483c5` socket path grammar 단일화(+fence `check-control-socket-path`), `e2eff3b` v1 sync-spawn dead island(entwurf-core.ts −469), **`d125946` C1 — V3 schema hard cut**(31파일 +995/−1560; V3-only production, frozen v1/v2 reader는 meta-migration.ts 단일 주소 + import-allowlist gate, strayness 양방향 게이트, M1 명령 이름 예약 `./run.sh meta-bridge-migrate-v3 migrate`).
- **2026-07-23: `f677284` store-doctor 픽스처 V3화 + `53159b9` main(0.12.8-repair.1) 머지 in.** 게이트 합집합 resolution — 브랜치 V3 게이트 유지 + main 신규 6게이트(capability-bundle-reach, bridge-delivery, hook-launch-topology, meta-doctor-oracle, node/claude-floor-coherence) 보존, v2 게이트 부활 없음. 머지된 aggregate full GREEN(pre-commit hook 실측), check-pack-install도 oracle 로컬 full GREEN(npm-managed install 포함).
- **`46bbc7d` C2 랜딩 + 교차 검수 승인 (2026-07-23).** 21파일 +1212/−1298, full check 삼중 GREEN(오푸스 독립 실행 + hook + 페블 재실행). 검수 실측 근거: live store에 `backend:"pi"` record 0개(claude-code 170 + antigravity 5)라 record-only resume이 끊는 라이브 실사용 없음. 스코프 앞당김(resume 대상 해석) 승인 — 되돌리지 않는다.
- **C3 랜딩 + 교차 검수 승인 + 결함 반영 완료 (2026-07-23).** 페블 구현 4 cut(각각 full check GREEN + hook 재검증) → 오푸스 교차 검수(결함 5건) → `770d8dd` 반영 → `e5076c1` C4 이월 기록. 오푸스 독립 full check `EXIT=0`(파이프 없이 exit code 직접 수집, 4 cut 시점 + 수선 시점 2회).
  - `74cac05` cut 1 — resume 권위: marker 사슬(leaf+producer+env seam 파라미터, 소비자는 C2 때 이미 사망)·`requireEntwurf` name-tag·name mirror·header-scan 일족(`findSessionFilesById`/`readSessionHeader`/`analyzeSessionFileLike`/`cwdToSessionDir`/`SESSIONS_BASE`/`assertLocalOnlyEntwurf`)·`smoke-session-id-name` 삭제 + **header id ↔ `record.nativeSessionId` 검증 신설**(spawn-production 게이트 §9, fixture 9단언 — headerless는 `770d8dd`에서 추가) + `smoke-entwurf-v2-spawn-resume-live` record 시대 재저작(seed가 `--session-id`/`--name` 없이 뜨고 record를 seed의 실제 header id+transcriptPath로 mint — **C2 이후 RED였던 스모크**).
  - `4b7ea16` cut 2 — name-authority + registry: name grammar 전체(`buildSessionName`/`parseSessionName`/`slugifyTitle`/`isKnownProviderModel`)·registry reader·v1 spawn guard·`pi/entwurf-targets.json`+pack manifest+`setup:links`/`ensure_agent_dir_symlinks` 삭제. `getRegistryRouting`(caller-supplied tuple)+`ResolvedTarget`만 생존. identity 게이트 87→29 단언.
  - `d0b3b25` cut 3 — dormant rail caller-edge: `formatSenderInfoBlock` SSOT 신설(수신측 인라인 합성 추출) + `resumeSpawnBg`가 resume prompt에 같은 블록을 append. **판단 기록**: NEXT 스케치는 "prepend"였으나 live rail 수신측 합성과 동형(append, 한 포맷터)으로 랜딩 — 교차 리뷰 대상.
  - `d5fcd2b` cut 4 (tail) — 목표 3 게이트화: smoke-pi-attach P8 — 실물 `enrichMcpServersWithEnvelope`가 만든 env 그대로 브릿지를 띄워 발신이 **host record 신원**(sessionId=host gardenId, agentId=entwurf/<model>, origin pi-session)으로 착지함을 단언 (20→27).
  - **LIVE 실측 완료 (오푸스 2026-07-23, GLG 기준 적용 후).** `LIVE=1 smoke-entwurf-v2-spawn-resume-live` **23 checks PASS** — 재저작 후 최초 실행이 GREEN. 실제 pi resume + 실모델 턴(assistant nonce 응답) + socket-alive 관측 + lock 1회 해제까지. **dormant rail 실배달이 증명됐다.** `SMOKE_RGG_POSITIVE=1 smoke-resident-garden-guard` **PASS=22 / FAIL=1** — BIRTH/ATTACH/REPLACEMENT 전부 PASS. ~~POSITIVE의 FAIL은 API key 부재~~ → **오진이었다(아래 부수 발견 2에서 정정): RGG의 temp 격리가 `auth.json`까지 잘랐던 것.** auth 시드 수선 후 25/25. 라이브 store 무오염 확인(temp 격리 작동).
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
2. **entwurf는 socket 인터페이스를 아예 모른다.** record가 유일한 주소 축이고 socket은 dispatch 내부 transport일 뿐(PROTOCOL 3) — 사용자 표면(peers/facts/dispatch 의미론)에 socket이 identity로 비치지 않는다. → **C4 랜딩 (2026-07-24, 위 상태 참조) — 오푸스 검수만 남음.**
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

> ~~오푸스 권고 (2026-07-23): `M1+H7`을 `C4`보다 먼저~~ → **사건으로 해소 (2026-07-24)**: GLG가 뺄셈(C4)을 지시했고 페블이 하루에 랜딩했다. 남은 큰 레인은 M1+H7 하나 — 아래 권고의 근거(지연 비용은 M1에만 쌓인다)는 그대로 유효하며 이제 가리키는 곳도 M1뿐이다. 원문 보존:
>
> **오푸스 권고 (2026-07-23): `M1+H7`을 `C4`보다 먼저.** 근거 넷 — ① 목표 ①이 실전에서 참이 되는 유일한 길이 M1이고 C4는 목표 ②(코드 청결)라 지연해도 비용이 안 쌓인다, ② 지연 비용은 M1 쪽에만 쌓인다(v2 record 실시간 증가), ③ **blackout 비용이 지금 가장 싸다** — 채널은 이미 끊겨 있어 지금 하면 추가 손실이 거의 없고 C4 뒤로 미루면 그때 다시 끊어야 한다, ④ C4의 dispatch/resolveTarget rail 변경은 살아있는 라이브 위에서 자르는 편이 안전하다. 반대 논거("C4가 M1의 관측면을 만든다")는 *migration 중 UX*이지 *migration 가능성*이 아니다 — M1은 C4 없이 성립한다. **연결 판단**: live rail repoint는 M1까지의 다리로만 값이 있다(repoint 기간만큼 v2 record가 더 늘어 M1의 짐이 커진다). M1 방아쇠가 가까우면 건너뛰고, 멀면 지금 채널을 살리는 값이 더 크다 — GLG가 M1 시점을 정하면 자동으로 풀린다.

4. **C3 — DONE (4 cut + 교차 검수 + `770d8dd` 수선, 상태 참조).** 유일한 스펙 편차 2건은 기록됨: ① sender envelope는 prepend가 아니라 live rail 동형 append(한 포맷터), ② `PI_SHELL_ACP_*`는 관념명이었고 실물은 `ENTWURF_V2_RESUME_RESIDENT_SESSION_ENV` 하나(소비자는 C2 때 이미 사망 — env를 심고 아무도 안 읽던 상태를 삭제).
5. **C4 — entwurf는 socket을 모른다 (DONE 2026-07-24, 4 cut + docs — 상태 참조. 표면 의미론은 GLG 위임으로 확정, 사후 오푸스 검토 대기)**. 아래 표가 랜딩된 의미론의 기록이다:

   **한 문장**: 사용자 표면(peers/facts/dispatch/발신 신원)에서 주소·신원 축은 meta-record 하나다. socket은 (a) in-domain liveness의 측정 증거, (b) dispatch 내부 transport로만 존재하고, record 없는 socket은 시민이 아니라 **진단 대상**이다. GLG 방향 재확인(2026-07-24): "pi-shell-acp 때 pi를 중심으로 세워놓은 기둥을 다 덜어내고 meta-record와 entwurf_v2로 완전히 조인다. ACP=클로드 전용, pi 네이티브=코덱스(GPT 구독) 전용, 리플리컨트↔리플리컨트급 게이트 정교함 유지."

   | 표면 | 지금 | C4 이후 |
   |---|---|---|
   | `entwurf_peers` (bridge + pi-native) | peers + `socketOnly` 섹션 + legacy `sessions`(sessionId+socketPath) + `controlDir` | **peers + diagnostics 두 섹션만.** record-less socket은 `record-less-socket` 진단(F8 집계형, liveness별 그룹, 원인+처방 명시). `sessions`/`controlDir`/`socketOnly`/get_info enrich 삭제 |
   | `/entwurf-sessions` (pi-native 명령) | 독자 socket-scan 세계(`getLiveSessions`) | **삭제** — 목록 표면은 `entwurf_peers` 하나 |
   | `entwurf_v2` dispatch | A1 narrow: record-less socket에 ff-send 허용(`socket-only-no-resume-authority` 포함) | **거부** `record-less-socket` (pre-probe, observedLiveness=null) — 원인 명명: record가 유일한 주소 권위, 처방(pre-record resident 재시작 / M1) 포함 |
   | spawn-bg `<sender_info>` | `wantsReply` 슬롯 없음 (F2) | plan에 `wantsReply` — live rail과 동형 (한 포맷터, 두 rail 등가) |
   | bridge 발신 신원 (Ⅲ-8) | 익명 external-mcp 기본 허용, `ENTWURF_BRIDGE_REQUIRE_META_SENDER` opt-in 금지 | **신원 필수가 기본.** `ENTWURF_BRIDGE_ALLOW_ANONYMOUS_SENDER=1`이 명시적·문서화된 escape hatch(구 동작 보존: origin external-mcp, replyable:false). REQUIRE env는 hard cut 삭제(구 설치본의 잔존 env는 무해 — 새 기본과 동치) |

   **의도적으로 유지**: liveness 어휘(4-value fact — socket이라는 단어 없이 의미 전달), quarantine 진단들(이미 진단), socket-discovery/probe/grammar SSOT(internal transport), stale socket sweep(GC=process resource), `entwurf_self`의 socketPath/mailboxPath 라인(자기 transport 상태 진단이며 identity 목록 표면이 아님 — **C4 범위 밖으로 판단, 오푸스 검토 대상**).

   **cut 순서**: ① F2 wantsReply → ② dispatch rail(taxonomy `record-less-socket` 신설 + `socket-only-no-resume-authority` 삭제 + A1 narrow/ResumePolicy 삭제) → ③ facts/listing(socketOnly→진단 강등, sessions/controlDir/enrich/`/entwurf-sessions` 삭제) → ④ 발신 신원 기본 뒤집기(installer/doctor/oracle/컨테이너 게이트 동반 재저작; install 표면이라 push 전 check-pack-install + check-install-container 로컬 실측).
6. **M1 + H7 레인 (라이브 cutover)**: ~~M1 operator command~~ → **M1 DONE (2026-07-24, 위 NOW 참조)** — backup `<store>.v3-migration-backup-<ts>/` → migrate → verify non-V3=0 → restore 전부 코드+52단언 게이트로 성립. fixture: V1/V3-already/malformed/stray-key/mismatch(drift)/half-migrated **+ duplicate nativeSessionId**(gardenId 중복은 파일명 구조상 불가로 제외가 맞았지만 nativeSessionId 중복은 가능해서 preflight 거부에 편입). **남은 것 = H7 라이브 전환**: 182+ record(V3 1 + v2 181+, 세션마다 증가): quiesce(설치본 v2 writer가 계속 민팅 중 — writer 정지 순서 포함 runbook 필수) → `verify`로 사전 분류 확인(read-only) → `migrate`(backup 자동) → non-V3=0 → 새 런타임. self-host blackout 예상 — cut 직전 ids/HEAD/patch 고정, 끊긴 동안 GLG 수동 릴레이, 양방향 delivery 복구 전 다음 cut 금지. 실패 시 `restore <backup-dir>`가 즉시 롤백. **방아쇠는 GLG.**
   - ~~오늘의 실상태: dangling name~~ → **닫힘 (M1 랜딩)**: `./run.sh meta-bridge-migrate-v3 migrate`는 이제 실명령이다. 전 거부 표면(peers/self/v2/inbox/birth/store-doctor)의 처방이 실행 가능한 이름을 가리킨다.

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
- ~~C4 몫으로 남는 것~~ → C4 랜딩 (2026-07-24). 잔여 선택지 둘만 남음: C4 tail(PI_SESSION_ID seam의 결정적 게이트화 — live 증거는 이미 확보, 선택), `smoke-live-delivery` 설계(오푸스 제안 — 라이브 시민에 실메시지를 쏘는 설계 문제, M1 표면 논의와 함께).

## 🔵 오푸스 교차 검수 (2026-07-23 심야) — 승인 + 남은 빈 곳 15건

**검수 결론: 관측면 수선 3커밋 승인. 되돌릴 것 없다.** 독립 full check `EXIT=0`(파이프 없이). 페블 보고가 실측과 일치하고, 수선이 자기충족이 아님을 라이브에서 재현했다.

| 검증 | 방법 | 결과 |
|---|---|---|
| F7 수선 | **내가 3/3 유령 경로를 뽑았던 그 명령 재실행** | 3/3 `transcriptPath = None` — 확정 |
| F8/F9 수선 | 현재 코드 브릿지를 새로 띄워 라이브 `entwurf_peers` | **177줄 → 1줄** `×181` 집계 + `(got number 2)` 값 표시, 시민 줄 생존 |
| F10 수선 | D7/D8 게이트 독해 | 자기충족 아님 — 실제 v2 body를 써서 dist를 MCP stdio 구동, M1 문자열 **포함** 단언 + 거짓 원인 **부재** 부정 단언 |
| F6 수선 | RGG POSITIVE 독해 | diff 증명(null→실파일 + `recordUpdatedAt` 전진)으로 재저작. **F7 수선이 birth를 null로 만들어야 성립** — 두 수선이 서로를 강화한다 |
| 라이브 store | 전수 스캔 | V3 1(페블 pi) + v2 181 = 182. ACP 오염 2건 제거 확인 |

**부수 실측 1건 — 라이브 배달은 현재 코드로 작동한다.** F10 재현을 시도하다 `entwurf_v2 control-socket → sent`로 페블 세션에 실제로 닿았다(메시지 `probe`, 무해). control-socket rail 라이브 실배달의 첫 증거다.

### 남은 빈 곳 — 6축 15건

**Ⅰ. 검증이 아직 안 닿은 곳 → 1·2·3 닫힘 (페블 2026-07-24 마무리 실측)**
1. ~~aggregate `release-gate`가 한 달간 안 돌았다~~ → **닫힘: `LIVE=1 ./run.sh release-gate /tmp/entwurf-rg-scratch-20260724` — MUST PASS=16 FAIL=0 SKIP=0 + BEHAVIOR PASS=1 FAIL=0, EXIT=0 (2026-07-24).** record 시대 최초의 aggregate GREEN. MUST step 수는 17→16(구 substrate smoke 삭제분 반영). "개별 GREEN의 합 ≠ 집계 GREEN" 가정은 이번엔 성립하지 않았지만, 그 가정을 검증 없이 들고 있던 한 달이 문제였다 — 아래 「기계가 말하는 장치」가 근본 처방.
2. ~~`check-bridge` 실행 기록이 없다~~ → **닫힘: `./run.sh check-bridge` EXIT=0** (direct MCP smoke 5 verbs + test.sh). 관찰은 유효했다: `pnpm check` 명령줄에 없고 **release-gate의 MUST step으로만** 돈다 — 이번 aggregate 실측에도 포함됨.
3. ~~CI 전용 2게이트 미실행~~ → **닫힘 (2026-07-24): `check-pack-install` EXIT=0 + `ENTWURF_REQUIRE_DOCKER=1 check-install-container` EXIT=0** — 관측면 수선 3커밋 위에서 로컬 실측. 새 후보 tgz sha256 `f110dd16…`(트리가 바뀌었으니 `82656026…`에서 이동한 것이 정상), Node 24 Linux consumer clean.
4. `smoke-agy-native-push-live` 미실행(별도 acceptance axis, `AGY_CONVERSATION_ID` 필요 — **GLG가 살아있는 agy 대화 id를 주면 닫힌다**). 라이브에 antigravity record 5개가 있다.

**Ⅱ. 문서 정합성 — 같은 패턴이 두 번째다**
5. **NEXT 17줄이 stale이다.** 아직 *"POSITIVE의 FAIL은 openai-codex API key가 없어서"*인데, **91줄이 그걸 오진으로 정정했다**(원인은 RGG 격리가 `auth.json`을 자른 것). 같은 파일 안에서 두 설명이 충돌한다 — 17줄만 읽는 사람은 틀린 원인을 믿는다.
6. **패턴 경고**: 이건 F1(README:525 죽은 링크)과 **같은 형태**다 — *새 사실을 추가하면서 옛 문장을 안 지운다.* 두 번 나왔으니 우연이 아니다. **수선 커밋마다 "이 발견이 무효화한 기존 문장"을 찾는 단계를 규율에 넣어라.**
7. ~~오염 record 백업이 scratchpad(휘발성)에 있다~~ → **닫힘: `~/.pi/agent/meta-sessions.smoke-backup-20260723/`로 내구화** (store의 형제 디렉토리 — readdir 스캔 비대상, 2026-07-24).

**Ⅲ. 표면 의미론 — C4 재료 → 전항 닫힘 (페블 2026-07-24, C4 랜딩)**
8. ~~익명 배달이 그냥 나간다~~ → **닫힘: cut④ `bc3f72d`** — 신원 필수가 브릿지 기본, hatch는 명시적 env 하나, D11(기본 거부·mailbox 무오염)/D12(hatch 배달·external-mcp 정직 명명) 게이트 고정.
9. ~~F2 미착수~~ → **닫힘: cut① `be12348`** — spawn-bg plan `wantsReply`, live rail 동형.
10. ~~C4 본체 미착수~~ → **닫힘: cut② `d76d9f7` + cut③ `5d99173`** — record-less socket은 dispatch 거부 + 목록 진단, 두 경로 다 원인+M1 명명. matrix-live C1b가 라이브 증명.

**Ⅳ. 재현 가능성 갭**
11. **F10을 라이브에서 재현할 방법이 없다.** marker는 부모 pid 체인으로 찾는데 셸에서 띄운 브릿지는 체인이 끊겨 marker를 못 만난다(실측). D7/D8이 fixture로 잡지만 **라이브 경로가 없다** — `smoke-live-delivery` 설계 시 핵심 제약.
12. **다음 오푸스 세션은 F10을 실제로 만난다.** 이 세션의 브릿지는 18:11:16 시작 = C2 이전 코드였다. 새 세션은 수선된 코드로 뜨고, Claude Code record는 여전히 v2다 — **수선 확인의 자연 기회**다. 첫 `entwurf_v2` 호출의 에러 문구를 그대로 기록할 것.

**Ⅴ. 라이브 상태 (M1이 여는 문)**
13. 라이브 store 182개, 세션마다 증가. mixed 상태(V3 1 + v2 181) 지속.
14. 형제 채널 비대칭 여전 — pi 쪽은 V3로 붙고, Claude Code 쪽은 v2라 **자기 자신이 안 보인다**. 교차 검수가 아직 GLG 수동 릴레이다.
15. ~~M1 미착수~~ → **M1 command 랜딩 (2026-07-24, NOW 참조).** 위 13·14는 명령이 아니라 **H7 실행**이 푼다 — 방아쇠는 GLG.

### 🔴 가장 예리한 것 — A4 규칙만으로는 A3형 구멍이 다시 뚫린다

A3(MUST-tier 라이브 3종이 C2 이후 죽어 있었는데 아무도 몰랐다)의 진짜 교훈은 **"MUST tier"라는 딱지가 실행을 보장하지 못했다**는 것이다. A4를 VERIFY.md에 고정한 건 옳지만 **그건 사람이 지키는 규칙**이고, A3는 정확히 사람이 안 지켜서 생긴 구멍이다. Ⅰ-1(aggregate 한 달 미실행)이 지금 **같은 형태로 살아있다** — 규칙을 쓴 그 순간에도.

**필요한 것은 기계가 말하는 장치다**: 게이트별 마지막 PASS 시각을 기록하고, 커밋이 건드린 rail과 대조해 *"이 커밋은 X를 건드렸는데 X를 덮는 MUST 게이트의 마지막 PASS가 N일 전이다"*를 **자동으로 말하게** 하라. 그게 없으면 다음 대공사에서 또 한 달이 지난다. **다음 세션의 최우선 후보로 제안한다.**

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
