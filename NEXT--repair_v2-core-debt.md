# NEXT — repair/v2-core-debt

> Branch boot sector. 실전 축 한 줄: **pi는 특별한 하네스가 아니라 meta-record로 동작하는 하네스가 된다.** 그게 되면 된 거다. Merge 전 이 파일 삭제.
>
> 설계문서(HOP.md, .agent-reports/)는 폐기했다 — 내용은 git history와 #50에 보존. 종이보다 코드. 터질 수 있는 지점을 아는 채로 터지는 건 실패가 아니다.

## NOW (2026-07-24 — hard-cut 구현 종료, main 수용 레인 시작)

> **다음 오푸스의 첫 3분**: 아래 「TO MAIN」을 먼저 읽는다. 이 브랜치의 끝은 H7만도, dependency bump만도 아니다. **H7로 현재 pin의 record 세계를 GLG 환경에서 먼저 살린 뒤 → pi와 ACP를 서로 분리해 올리고 → 최종 pin의 설치 산출물로 delivery를 끝까지 증명한 뒤에만 main으로 간다.** merge 뒤 잊힐 일을 main NEXT로 넘기지 않는다. push 대기분은 `git rev-list --count origin/repair/v2-core-debt..HEAD`로 그 자리에서 세고, push/H7은 각각 GLG 명시 지시를 받는다.

> GPT 검수 4건과 그 뒤 핸드오프 검수가 찾은 restore guard tail까지 `9c8ee58`에서 닫혔다. sibling symlink→foreign과 forged suffix를 직접 RED로 만들고, real-directory timestamp sibling만 허용했다(S15). 그 위에서 **GPT 재검수(2026-07-24)가 이름 검증의 다음 층을 재현**했다 — "이름이 올바른가"는 닫혔지만 "그 이름의 backup이 완전하고 판독 가능한가"가 열려 있었다: 유효한 이름의 malformed backup이 rc=0으로 복원돼 malformed record가 주소 권위가 됐다(직접 synthetic 재현). **`0f7db49`(페블)가 닫았다**: ① migrate backup을 `.partial-<pid>` staging에 복사 후 atomic rename으로만 final name을 부여(부분 복사가 trusted name을 차지 불가, 실패는 원인과 함께 loud REFUSE), ② restore가 store를 움직이기 전에 backup을 classifyStore()로 검사(problem 0 + record ≥1; v1/v2/v3 전부 합법 — backup은 pre-cut 바이트), ③ record 항목은 regular file만(classify는 링크를 따라 읽는데 copy는 링크를 심는 어긋남 차단), ④ lstat 실패가 실제 원인(EACCES/ENOTDIR 등)을 보존. 게이트 S16(내용 검증·lstat 원인)+S17(PATH_MAX로 강제한 mid-copy 실패·staging 잔재 거부) 신설. 그 위에서 **GPT 대칭 재검수가 마지막 구조 결함을 재현**했다 — `0f7db49`의 restore-국소 symlink guard가 migrate와 수용 영역을 갈라 **M1이 만든 backup을 M1이 거부**하는 입력이 존재 → regular-file 규칙을 **classifyStore() 한 곳으로 단일화**하고 기계 불변식 "migrate accepted ⇒ 인쇄된 backup restore 성공"을 S18로 고정(**85단언**). full check + pre-commit hook aggregate GREEN, **M1은 §6 「M1 동결」 네 문장으로 동결**. **H7은 2026-07-24 16:24 실행 완료**(§6 원장 — GPT 사후 승인, 왕복 실증, post-cut V3 birth까지 충족). 닫힌 수선을 다시 반복하지 않는다.

- **M1 검수 3라운드 종결 (2026-07-24).** 랜딩 `04f55b5`(페블) → 오푸스 R1 검수(결함 M1~M6, 되돌림 0, 판단 3건 전부 동의) → 페블 수선 `2a4fe13`/`95c15ff` → 오푸스 R2 검수(M1·M2·M3 닫힘 확인, 잔여 3건 R1~R3) → **오푸스가 직접 마감(`9e0ae46` 등)** → **GPT 교차 검수 4건(아래) 처리(`33ce266`) + 핸드오프 검수 restore tail 수선(`9c8ee58`) + GPT 재검수 backup 완결성 수선(`0f7db49`) + GPT 대칭 재검수 domain 단일화(아래)**. 게이트 `check-meta-migrate-v3` **85단언**, 독립 full check EXIT=0.
  - **R1 (실행 위험이 있던 유일한 잔여)** — M4가 프로덕션 거부 표면은 닫았는데 **M1 명령 자신의 출력 5곳**이 dev-clone 형식만 인쇄했다: 설치본 호스트가 `entwurf meta-bridge-migrate-v3 migrate`로 부르고 실패하면 못 치는 `./run.sh … restore`를 처방받는다 — **blackout 한복판에서**. `restorePrescription()` + verify의 `M1_PRESCRIPTION` 전환으로 전부 양형식. 게이트 2단언 신설(S9/S14), **컴파일 twin으로 실측 확인**(설치본이 실제로 도는 바이트).
  - **R2** — 새 규율(`scripts/**` 어휘 grep)을 돌리니 최대 밀집지가 **cut이 실제로 다시 쓴 `meta-session.ts`**였다: `MetaIdentity`(프로덕션 v3 타입)의 doc이 "The v2 identity-only record", 직렬화기가 "v2 WRITE shape … round-trips through `parseMetaRecordV2`"(그 심볼은 이 파일에서 allowlist 금지), minter가 삭제된 `isEntwurf`를 기본값으로 명명, `decideUpsert` doc이 삭제된 `parentGardenId`를 merge 축으로 나열(**같은 함수의 body 주석은 이미 정확했다**) + 0.11 단계빌드의 미래시제 화석 4곳("no v2 writer here **yet**", "lands in step 3D-4", "**Today** the read-receipt lives at record.delivery"). 전 항 수선.
  - **R3** — 단언 수 드리프트가 두 줄 중 한 줄만 고쳐져 있었다(§6에 52 생존). 양쪽 64로 정정.
  - **규율 일반화 (이번 라운드의 진짜 산출물)**: 세 라운드 연속 "디렉토리를 하나 더 추가"로 대응했다(`docs/` → `scripts/` → lib). AGENTS의 그 항목을 **목록에서 방법으로** 바꿨다 — 단위는 리포 전체, 두 축(① 은퇴한 어휘 repo-wide grep 후 tombstone/live-claim 판정, ② 착지한 계획의 미래시제 grep). **바꾸자마자 축②가 9번째를 잡았다**: `check-entwurf-capabilities.ts` 헤더가 "3D는 아직 안 왔고 const가 여전히 authority"라고 가르치고 있었다(3D-3/3D-4 둘 다 착지 완료).
- **M1 operator command (`04f55b5`)**: `scripts/meta-bridge-migrate-v3.ts` — allowlist가 예약해둔 바로 그 경로에, 3 verb(`migrate [--drop-parentage]` / `verify` / `restore <backup-dir>`), env+default store 해석(dir argv 없음 — H7 runbook은 THE live store를 겨눈다). dangling name 종료: run.sh dispatch + usage + `pnpm check` 편입(`check-meta-migrate-v3`, CLI를 서브프로세스로 모는 **85단언**(현재) — §6 fixture 6종 + duplicate nativeSessionId + parentage 처분 + verify 집계(F8 ×N) + restore 왕복 + M2/M3 예외 경로 + S15~S18 restore/backup/domain mutation) + tsconfig.build emit + check-pack/tar_required 목록 + check-pack-install 설치본 verify 드라이브. **판단 기록 3건 전부 오푸스 동의**: ① parentage 기본 REFUSE + `--drop-parentage` 명시 처분(verify가 blackout 전에 예고), ② classify-first all-or-nothing + duplicate nativeSessionId 편입, ③ restore는 아무것도 파괴하지 않음.
- **M1~M6 처리 내역 (전부 코드 되돌림 0)**: **M1** runbook 순서 — §6에 반영, H7 전 필독. **M2** 쓰기 시작 후 예외가 처방 없이 raw stack으로 나가던 것 → migrate/restore 양쪽 try/catch가 restore/aside 처방을 인쇄(원인 스택은 그대로 보존), 게이트 S14가 백업 후 크래시를 실제 제조해 처방 문구+복구 경로(restore→재실행 완주)까지 증명. **M3** `readFileSync`가 try 밖이라 EISDIR 등에서 크래시 → unreadable을 problem으로 분류, S13이 디렉토리형 엔트리로 증명(migrate 거부+verify read-only 동일 보고). **M4** 설치본 처방 — `M1_PRESCRIPTION` 신설(`M1_MIGRATE_COMMAND_INSTALLED` = `entwurf meta-bridge-migrate-v3 migrate`): parse/birth/peers/self/v2/inbox 전 거부 표면이 dev clone + 설치본 양형식을 명명, 게이트 substring 단언은 전부 보존됨(문장 확장이지 교체가 아님). **M5** 산문 수선 — store-doctor "dual-read" 주장, mailbox-state-write 게이트 "written as v2" 주장, husky 유물 주석(존재하지 않는 0.4시대 게이트 5종 열거), + **AGENTS 목록에 `scripts/**` BY NAME 승격 — 그 규율을 즉시 실행해 오푸스 목록 밖 2건 추가 발견·수선**(atomicWriteIdentity "(v2 identity write)", migrateV1DeliveryReceipts "called by upsert" — 그 호출자는 C2 때 죽었다). **M6** 이 문서 단언 수 정정(두 줄 중 한 줄만 닫혀 R3로 이월).
- **레인 밖 발견 — GLG 결정 대기 (에이전트 무접촉)**: 이 리포 `.git/config`의 `core.hooksPath=.husky/_`가 전역 안전 레일(`~/repos/gh/agent-config/git-hooks`)을 덮는다. husky엔 `pre-push`가 없어 **push 시 identity/secret 스캔이 0회** 돈다(공개 `junghan0611/entwurf`이라 원래 strict 대상). 두 방향: ⓐ `.husky/pre-commit`·신설 `pre-push`가 `_delegate.sh`의 역방향으로 전역 스캐너를 호출, ⓑ `core.hooksPath`를 전역으로 되돌리고 husky를 그 아래 체인(전역 훅이 이미 `_delegate.sh`로 repo-local을 부르게 설계돼 있음 — ⓑ가 설계 의도에 맞다). **어느 쪽도 에이전트가 임의로 바꾸지 않는다**(AGENTS: hooksPath 변경은 GLG 명시 요청). 그때까지는 push 전 수동 실행이 대체물: `bash ~/repos/gh/agent-config/git-hooks/_scan.sh range origin/<branch> HEAD`.
- Current: **세 문장 목표 ①②③ + M1은 현재 pin에서 코드로 성립하고 교차검수·restore tail·backup 완결성·대칭(domain 단일화) 수선을 전부 통과했다.** push 완료(exact-SHA CI 3 jobs GREEN ×2회) + **현재 HEAD에서 LIVE aggregate GREEN**(아래 실측표 — 3자 배선 실증거). 이후 같은 날: **H7 완료**(§6 원장) → **pi uplift 0.82.0 완료**(`dfa3967`, §TO MAIN 2) → **ACP uplift 워킹트리 랜딩 + LIVE aggregate GREEN**(§TO MAIN 3, 커밋은 GLG 게이트). 남은 줄기는 **(a) 2c probe 검출력 수선(D, GLG 승인 대기) → (b) ACP 커밋 → (c) 커밋된 최종 HEAD에서 3셀+LIVE 재획득 → (d) durable docs 승격 + 이 파일 삭제 → main merge**다. A/B/C 관측 공백은 ROADMAP 승격 권고(§TO MAIN 5 아래 처분 참조). **브랜치 명제 (GLG 2026-07-24)**: 이 브랜치에서 pi 특별 대우를 끝낸다 — 배선은 claudecode ↔ pi-acp-claude ↔ pi-native-gpt 3자(agy는 배선 완료 상태라 claudecode 살면 확인만), 그리고 "테스트하네스로 Linux 설치가 보장되고 auth 로그인돼 있으면 실동작도 보장된다"를 deterministic 3셀 + LIVE aggregate가 말하게 한다. demo/의 pre-0.12 GIF 재촬영은 이 브랜치 범위가 아니다(README의 post-0.12 follow-up 그대로).
- **검증 기준 (다음 세션이 뭘 돌려야 하는가)**: 코드를 건드렸다면 `pnpm build-bridge && pnpm check`(EXIT=0). install 표면(pack manifest/bin/hook/dist 목록)을 건드렸다면 **추가로** `./run.sh check-pack-install` + `ENTWURF_REQUIRE_DOCKER=1 ./run.sh check-install-container`. 이 마감 커밋 시점 실측은 아래 「마감 실측」 표.
- **GPT 교차 검수 (2026-07-24, M1-마감 후) — 4건 처리**: ① **[높음·확증] restore가 foreign backup 수용** — `path.basename().includes(".v3-migration-backup-")` substring만 봐서 `foreign.v3-migration-backup-x`(이 store의 sibling 아님)를 rc=0으로 복원, `/evil` record가 주소 권위가 됐다(직접 재현). 수선: `<resolved-store>.v3-migration-backup-<ts>` 정확한 prefix + 단일 세그먼트(nested 거부)로 조임, 게이트 S15 신설(foreign/nested/look-alike 거부 + 진짜 sibling 수용). ② **[중간·확증] repo-wide 산문 sweep 미완** — **내 R2 grep이 `--include=*.ts`로 한정돼 `.md`를 빠뜨렸다**(규율을 "단위는 리포 전체"로 일반화해놓고 실행에서 어긴 아이러니). ROADMAP 동결결정 2(dual-read)·3(PARENT_SESSION_ID/tmux correlation) = #50이 뒤집은 죽은 결정을 "재설계 금지"로 박아둠 → 취소선+무효화 명시, AGENTS:130(삭제 gate 4종 나열)·231(dual-read/migration)·docs/mux:38(삭제된 `check-meta-record-v2.ts` 인용) 정정. ③ **[중간·운영] H7 §6이 "runbook" 자칭하나 순서 불변식뿐** — 실행 체크리스트(quiesce 확인/exact candidate/판정 증거)를 명령 수준으로 재구성, GLG 환경 의존은 ★ 빈칸으로 명시(H7 방아쇠 전 필수). ④ **[낮음·확증] NEXT "M1 전 금지"** → "H7 전 금지"로 정정(M1 코드는 끝났다). 판정 동의: 당시 push 차단 ①②를 닫았고, 후속 검수가 ①의 symlink/suffix 우회를 추가 발견해 `lstat`+정확한 timestamp grammar+S15 mutation으로 `9c8ee58`에서 닫았다. ③은 H7 전, 아키텍처·C1~C4/M1 본체 승인.
- **핸드오프 검수 (오푸스, GPT restore tail 커밋 `9c8ee58` 검수)**: GPT의 `lstat`+timestamp-grammar 수선을 독립 재현으로 확인 — 수선 전 HEAD 코드에서 timestamp-shaped symlink→foreign이 실제 rc=0으로 store를 교체함을 재현, 수선 후 rc=1 거부 + 무접촉 확인, 정상 `stamp()` 출력이 정규식을 통과해 왕복 안 깨짐 확인. **부수 발견**: GPT가 실측으로 적은 tgz sha256 `c21233ef…`가 최종 커밋 바이트에서 재현 안 됨(실제 `0d53ad5b…`, 결정론 실측). 원인 = 커밋 전 워킹트리에서 pack. 교훈은 G3/M6/R3와 동형 — **sha256도 커밋 SHA에 묶지 않으면 썩는 숫자다.** NEXT 실측표 정정.
- **GPT 재검수 (2026-07-24, `9c8ee58` 검수) — 3건 처리 (`0f7db49`, 페블)**: ① **[높음·확증] 유효 이름의 불완전·손상 backup을 rc=0으로 restore** — migrate가 backup을 trusted final name에 직접 복사(부분 복사가 final name으로 잔존 가능) + restore가 이름·directory 여부만 보고 내용 무검증인 채 현재 store를 aside로 이동(synthetic `broken.meta.json` 재현: malformed record가 주소 권위로). 수선 = staging `.partial-<pid>` 복사 → **atomic rename만이 final name 부여**(= "final name 존재 = 완료된 M1 backup"이 성립) + restore가 store 이동 전 classifyStore(problem 0 · record ≥1, v1/v2/v3 전부 합법). **파생 판단 1건**: classify는 symlink를 따라 읽는데 copy는 링크를 심는다 — cpSync `dereference:true`가 Node에서 중첩 항목에 무시됨을 실측, 실물화 대신 **형태 거부**(restore-국소 guard)로 닫음. ~~"migrate가 만들 수 없는 형태는 이 동사로 안 받는다"~~ → **전제가 다음 라운드에서 반증됨**(migrate가 실제로 그 형태의 backup을 만들었다 — 아래 대칭 재검수가 규칙을 classifyStore로 단일화). ② **[중간·확증] lstat 오류 원인 은폐** — EACCES/ENOTDIR/EIO 전부 "does not exist" 오진 → 실제 원인 보존(`cannot inspect backup path …: <cause>`). ③ **[낮음] NEXT 커밋 전 표현 3곳** → `9c8ee58`/`push(checkpoint)`로 정정. 게이트 S16/S17 mutation 10개 신설(80단언), mid-copy 실패는 PATH_MAX(4096) 초과로 root-proof 강제 — store 자신은 완전 판독/기록 가능인 채 staging sibling 내부 경로만 넘친다.
- **GPT 대칭 재검수 (2026-07-24, `0f7db49` 검수) — 차단 결함 1건 재현, `a4a19be`로 닫음**: `0f7db49`의 restore-국소 regular-file guard가 **비대칭**을 만들었다 — migrate의 classifyStore()는 symlink record를 따라가 읽어 수용하고 backup은 링크를 보존하는데 restore만 거부 → **M1이 스스로 만든 backup을 M1 restore가 거부**(GPT 직접 재현: migrate_rc=0 → restore_rc=1). "migrate가 만들 수 없는 형태는 받지 않는다"던 `0f7db49`의 전제가 실측으로 틀렸다. 수선 = GPT 처방 그대로: **regular-file 규칙을 classifyStore() 한 곳으로 단일화**(lstat-first — verify/migrate preflight/사후 disk verify/restore backup classify 네 경로가 같은 domain) + restore의 독자 pre-loop 삭제(두 번째 rule-site가 이번 drift의 원인이었다 — 세 번째 guard 금지) + **S18 신설**: 유효한 v2 바이트를 가리키는 symlink record가 verify/migrate 양쪽 front door에서 거부(backup 0, symlink 무접촉) + migrate가 **인쇄한 정확한 backup 경로**가 restore rc=0. 기계 불변식: **"migrate accepted ⇒ 그가 인쇄한 backup은 restore가 받는다."** 이로써 M1은 §6의 「M1 동결」 네 문장으로 동결 — 이후는 H7 준비만.
- Next: 아래 「TO MAIN」 1→5를 순서대로 닫는다. **H7과 dependency uplift를 한 cut에 섞지 않는다.** 현재 pin으로 H7을 먼저 성공시켜 hard-cut과 upstream 변화의 실패 원인을 분리한다.
- **라이브 거부면 실측 — Ⅳ-12 닫힘 (2026-07-24, 페블 세션 `20260724T144042-30d75c`)**: 수선된 코드 브릿지에 대고 실제 `entwurf_self`/`entwurf_v2`를 호출 — 둘 다 **D7/F10 계약 문구 그대로** 거부했다: "sender marker is live and names garden id …, but that citizen's meta-record cannot be read: schemaVersion must be 3 (got number 2) … migrate the store with `./run.sh meta-bridge-migrate-v3 migrate` (installed: `entwurf …`) … This is NOT a missing-marker problem". `entwurf_peers`는 alive pi 시민(`20260724T161741-d294f0`, gpt-5.6-sol)을 잡고 v2 191건을 F8 집계 한 줄로 냈다. **결론: claudecode→pi 발신은 H7 전에는 설계대로 불가** — 검수 요청은 GLG 수동 릴레이로 전달. 관측 3종(F8 집계·F10 3-way 원인·M1 양형식 처방)이 실환경에서 전부 의도대로 동작.
- **flaky MUST 게이트 실측 1건 (2026-07-24, 결정 대기)**: `check-entwurf-session-identity`의 "256 generated ids unique (6-hex suffix)" 단언이 pre-commit hook에서 실제로 RED(255 !== 256) — 6-hex 공간(16.7M)에 256 draw면 생일 충돌 ~0.2%/run인 **확률 주장을 결정론 단언으로** 박아둔 것. 재실행은 GREEN(docs-only 커밋에서 발화 — 코드 무관). 수선 방향은 identity 계약 판단이 필요: (a) 게이트를 충돌-내성으로(무엇을 실제로 계약하나 재정의), (b) 프로덕션 mint에 same-second 충돌 가드(file-exists 재시도)를 넣고 게이트가 그 가드를 검증. H7 비차단.
- **관측 공백 처분 (2026-07-24, 오푸스 `79087d` 보고 + 재현, 페블 동의)**: **~~A~~ teardown hang은 존재하지 않는 결함** — 새 pin 조합에서 one-shot `pi -p` 2회 정상 종료(EXIT=0), 게이트 주석의 "teardown hang backlog"는 stale claim. **A′(신설, main 전 필수·문서 cut — GPT 정제 반영)**: plain `pi -p` one-shot(`docs/setup-clean-host.md:302`·`VERIFY.md:201`)은 **provider one-turn smoke로서 옳고 명령을 바꾸지 않는다**(EXIT=0 실작동, 목적 = "provider가 서는가"). 빠진 것은 **provider mode ↔ citizen mode 경계의 문서화**: 그 모드는 `entwurf-control.ts:943`이 의도적으로 PI_SESSION_ID를 지워 `entwurf_self`/`entwurf_v2` sender 호출이 **의도대로 fail-loud**("sender envelope wiring incomplete") — garden citizen 기능은 Stage 7 / `--entwurf-control`이 담당. GLG 실사용 증상 = provider mode에서 citizen 기능을 기대(문서가 경계를 안 말함). 수선 = 두 문서에 경계 문구 + bundled smoke 주석의 stale "teardown hang" 역사화(resident/RPC의 진짜 근거 = 장기 socket-citizen 회로 명시), **코드·계약 변경 0** — plain one-shot에 garden identity를 주는 계약 변경은 GPT·오푸스·페블 전원 반대(#50 record authority/replyability 보존, :943 로직이 옳다). dependency cut과 섞지 않는 별도 cut. **B** ACP 모델의 entwurf_v2 실발신(BEHAVIOR-tier, 수신/신원은 증명됨) — ROADMAP. **~~C~~ 닫힘**: GPT가 event-mapper 직접 확인(`ensureTextBlock`이 선행 assistant 상태 없이 블록 신설, event-mapper.ts:113-121) — 새 wire kind가 아니라 기존 kind의 새 발생 조건, 전용 게이트 불필요(delta 카탈로그 기록만).
- **별도 cut 후보**: pi 0.81+가 추가한 `@earendil-works/pi-ai/providers/all` 4번째 loader alias — `/compat`이 살아있어 강제 아님(deprecated 주석만 그쪽을 가리킴). 옮길지 판단은 main 이후.
- 대기(merge 비차단): Ⅰ-4 `smoke-agy-native-push-live`는 살아있는 `AGY_CONVERSATION_ID`가 있을 때만. 「기계가 말하는 장치」(게이트별 마지막 PASS × rail 대조)는 별도 후속이며 이 브랜치의 main 수용 조건을 늘리는 핑계로 쓰지 않는다.
- Do not touch: fresh sibling mint/#47, Cortex/#48, backend auth, transcript hydration, 새 DB/planner/worker tree. 라이브 `install-meta-bridge`는 **H7 원자 전환 순간까지 금지**(지금 mixed store에 V3-only 아티팩트를 미리 깔지 않는다). `core.hooksPath`/`.git-hooks-mode`는 GLG 명시 요청 없이는 금지. **pi/ACP dependency uplift는 이제 이 브랜치의 명시적 범위지만 H7 성공 뒤에만 착수한다.**

### 현재 실측 (2026-07-24, domain 단일화 커밋 `a4a19be` 바이트)

| 검증 | 결과 |
|---|---|
| 독립 full `pnpm check` | **EXIT=0** — 앞선 2398 + S16/S17 10개 + S18 5개 = **2413 회계** (pre-commit hook aggregate 3회 GREEN) |
| `check-meta-migrate-v3` | **85단언** — S15(이름·grammar·symlink dir) + S16(malformed/empty/drift 내용·lstat 원인·symlink record) + S17(mid-copy 실패·staging 잔재) + S18(단일 domain front-door 거부 + printed-backup roundtrip) |
| `./run.sh check-pack-install` | **EXIT=0** — 설치본 bin/compiled twin 포함(migrate CLI twin이 이번 수선의 실변경물) |
| `ENTWURF_REQUIRE_DOCKER=1 check-install-container` | **EXIT=0** — Node 24 checkout-invisible consumer. **커밋 `a4a19be` 바이트 tgz sha256 = `4995b6fa…`** (`0f7db49`의 `620eed20…`에서 이동한 것이 정상 — CLI/게이트가 바뀌었다). sha256은 반드시 커밋 SHA에 묶는다 |
| restore differential | GPT synthetic 재현(유효 이름 + `broken.meta.json`) **수선 전 rc=0 복원** → 수선 후 rc=1 + store/aside 무접촉; empty/drift/symlink-record/staging-잔재도 rc=1 |
| 대칭 differential | GPT 재현(symlink-record store: migrate_rc=0 → 자기 backup에 restore_rc=1) → 수선 후 그 store는 **verify/migrate front door에서 rc=1**(backup 0, symlink 무접촉), in-domain store는 **인쇄된 backup 경로 그대로 restore rc=0** |
| backup 원자성 | PATH_MAX 강제 mid-copy 실패에서 final-name backup 0개 + store byte 무접촉 + loud REFUSE(원인 보존) 실측 |
| 라이브 store | 이번 수선은 synthetic store만 사용 — 라이브 store write/backup/aside 무접촉 |
| push 안전 스캔 | push 직전 `bash ~/repos/gh/agent-config/git-hooks/_scan.sh range origin/repair/v2-core-debt HEAD` 재실행 |
| **LIVE aggregate (H7 전 baseline, 2026-07-24)** | `LIVE=1 ./run.sh release-gate /tmp/entwurf-rg-scratch-20260724-live` — **MUST PASS=16 FAIL=0 SKIP=0 + BEHAVIOR PASS=1 FAIL=0, EXIT=0** (record 시대 세 번째 aggregate GREEN, 현재 HEAD `c1f3d21`+★제안 워킹트리 바이트). **3자 배선 실증거**: pi-native-gpt = matrix-live 20/20(real control socket+real mailbox, openai-codex/gpt-5.4) + spawn-resume-live 23/23(real resume+실모델 턴+lock release) + RGG 20/20 및 **POSITIVE 25/25(BEHAVIOR — 실턴이 transcriptPath+model 채움)**; pi-acp-claude = ACP LIVE 11종 전부 PASS(claude-sonnet-5 구독 실턴, socket-citizen/raw-turn/overlay/provider/reuse/carrier/containment/rgg/mcp/skill/bundled-mcp); claudecode(mailbox rail) = matrix-live의 active Claude mailbox 착지 + check-bridge 5 verbs. agy는 GLG 지시로 live 제외(결정론 state 게이트는 GREEN — claudecode 살면 확인만 하면 됨). **첫 실행이 RG_EXIT=1이었던 것은 결함이 아니라 운영 실수**(scratch dir을 rm만 하고 mkdir 안 함 — release-gate는 존재하는 project-dir을 요구, static tier만 PASS=1) — dir 생성 후 전량 GREEN |

## TO MAIN — 새 오푸스가 닫을 남은 줄기 (순서 고정)

> **브랜치 종료 정의:** “코드가 맞다”가 아니라 **최종 dependency pin의 exact 설치 산출물이 record-backed 시민을 만들고, 실제 `entwurf_v2` delivery를 수신면까지 착지시키며, sender identity/replyability와 honest reject를 함께 증명했다**가 끝이다. 이 증거와 현재 계약을 durable docs로 승격한 뒤 branch NEXT를 삭제하고 main에 넣는다.

### 1. Baseline checkpoint + H7 — 현재 pin으로 hard-cut을 먼저 살린다 → **DONE (2026-07-24: push+CI GREEN, LIVE baseline, H7 완전 종료 — §6 원장)**

- 기준 조합: pi packages **0.80.7**, `claude-agent-acp` **0.54.1**, ACP SDK **1.1.0**, Anthropic SDK **0.100.1**. 이 조합은 지금까지의 deterministic/LIVE/artifact 증거가 있는 원인 분리용 baseline이다.
- push는 GLG 명시 지시 때만: 직전 strict `_scan.sh range` 재실행 → push → exact-SHA CI 3 jobs GREEN 확인.
- H7 방아쇠 전에 §6의 ★를 **명령과 실제 대상 값으로 채운다**: quiesce 방법/확인, exact candidate HEAD·tgz·sha256와 설치 명령, 왕복 시민 2명, rollback threshold.
- H7 성공 정의: `verify non-V3=0` + installed `doctor-meta-bridge` rc=0 + pi↔Claude 양방향 live delivery 1회(각 방향 sender garden id 일치) + 새 세션이 V3만 mint. 실패 시 dependency bump로 도망가지 말고 baseline에서 restore/원인 수선.
- **금지:** H7 전에 pi/ACP pin을 움직이지 않는다. migration/runtime 교체와 upstream API 변화를 섞으면 어느 축이 채널을 죽였는지 판별할 수 없다.

### 2. pi uplift — 0.80.7 → ~~npm current 0.81.1~~ **0.82.0, DONE (`dfa3967`, 2026-07-24 오푸스 `79087d`)**

- **완료 실측**: 재조회 규율이 작동했다 — 0.81.1은 0.81.0 extension 회귀("Full provider extensions"가 pre-0.81 agent-core API extension을 깨뜨림, #6915가 0.81.1에서 복원)의 hotfix를 우연히 가리키고 있었고, GLG 확정으로 **0.82.0 직행**. seam 7/7 GREEN(소스 실측 + 격리 설치 getModels 실대조 — 모델 14행 바이트 동일), 유일한 실질 변화 = 0.82.0 bash tool의 PI_SESSION_ID 탈취 → entwurf 소비 0건 + MCP 명시 주입이라 무회귀, **smoke-pi-attach P8이 host record gardenId 착지를 실증**(소스 판정으로 닫지 않는다는 수용 조건 충족). 게이트: check-dep-versions/pi-runtime-version/pack-install(resolved-tree 전부 0.82.0)/container EXIT=0(**`dfa3967` 바이트 tgz sha256 = `5db69f3ca0ad686a8f95b89f90aa43f9a968f89f535432c9df95079bfd18bc84`**), LIVE RGG 25/25 + spawn-resume 23/23 + matrix 20/20.
- **⚠️ 숨어 있던 조건 명시**: LIVE 스모크는 `spawn("pi")`로 **PATH의 글로벌 pi**를 몬다(`resident-rpc-drive.ts:178`) — 글로벌 pi를 0.80.6→**0.82.0**으로 함께 올렸다(GLG 승인). 안 올렸으면 LIVE가 새 pin이 아니라 구 바이너리를 검증했다. 이후 pi bump 시 반드시 글로벌 pi도 같은 버전으로.
- (원계획 절차·seam 목록은 git history 참조 — 아래 원문 유지)
- 별도 commit/cut. `@earendil-works/pi-ai`·`pi-coding-agent`·`pi-tui`와 install-smoke의 `pi-agent-core`를 같은 exact version으로 묶고 peer range/ceiling을 새 minor에 맞춘다. 숫자를 손으로 흩뿌리지 말고 package.json 파생을 우선한다.
- 먼저 0.81 release/API delta를 카탈로그화하고 다음 load-bearing seam을 실행으로 확인한다: extension loader alias map, `/compat`의 `getModels`, public imports, session_start/new/fork/reload, `--session <abs>` resume, model catalogue/curated anchors, `--entwurf-control` lifecycle.
- 필수 게이트: `check-dep-versions`, `check-pi-runtime-version`, `check-pi-import-surface`, `check-pack-install`의 resolved-tree exact pin, `smoke-pi-attach`, resident birth/attach/replacement, dormant spawn-resume, ACP-model host의 record garden id 전달.
- 0.81에서 `/compat` 또는 loader 계약이 바뀌면 0.80 shim을 억지로 보존하지 말고 새 public/loader surface로 hard-cut한다. 숨은 alias/fallback 금지.

### 3. Claude ACP uplift — pi GREEN 뒤 0.54.1 → npm current 0.61.0, 단독 cut → **워킹트리 랜딩 (2026-07-24 오푸스 `79087d`, 커밋은 GLG 게이트)**

- **현재 상태**: claude-agent-acp 0.54.1→**0.61.0**, sdk 1.1.0→**1.3.0**, `@anthropic-ai/sdk` **0.100.1 유지**(peer graph 판독), CAS 0.3.197→0.3.217 동반 이동. `check-acp-sdk-surface.ts` 15곳 + AGENTS/ROADMAP/run.sh/raw-turn 주석 갱신. **`LIVE=1 release-gate` MUST 16/16 + BEHAVIOR 1/1, EXIT=0**(ACP 11 LIVE 전부 PASS — 단 워킹트리 바이트: 커밋 후 최종 HEAD에서 3셀+LIVE 재획득 필요, §4). GPT R1: 1건 철회(리포 밖 측정 — `autoInstallPeers:false` 미상속; 우리 조건에선 direct pin 필요 실재), 1건 수용 = **2c probe 검출력 결함**(`casRequire` 만들고 리포 root copy로 판정 — nested drift면 false GREEN; 수정안 합의, GLG 승인 대기).
- (원계획 절차는 아래 원문 유지)
- `@agentclientprotocol/claude-agent-acp` **0.61.0**과 `@agentclientprotocol/sdk` **1.3.0**을 목표로 한다. `@anthropic-ai/sdk`는 현재 `0.100.1`을 기계적으로 유지/상승하지 말고 새 adapter·claude-agent-sdk의 peer graph를 읽어 **한 runtime resolution**으로 결정하고 gate 문구도 함께 옮긴다.
- 먼저 adapter/SDK changelog·exports·protocol delta를 읽고 다음 seam을 검증한다: spawn/handshake, exclude-tools와 tool narrowing, isolated overlay/auth boundary, config/meta shape, event mapper, prompt delta, in-memory session reuse, carrier/first-user augment, model forcing.
- 필수 증거: `check-acp-sdk-surface`가 새 peer graph를 실제 runtime context에서 읽음 + raw ACP turn + overlay/tool-surface + provider turn + session reuse/carrier + ACP socket-citizen + bundled MCP delivery. 버전 문자열만 바꿔 GREEN을 만들지 않는다.
- pi uplift와 같은 commit에 넣지 않는다. ACP cut에서 pi 코드를 고쳐야 한다면 교차-contract 변화로 명시하고 두 축의 gate를 모두 다시 돌린다.

### 4. Final delivery acceptance — 최종 pin·최종 바이트에서 전부 다시

**결정론/산출물 3셀(모두 필수):**

1. checkout built dist: `pnpm build-bridge && pnpm check` — `check-bridge-delivery`가 실제 MCP `tools/call`→socket/mailbox 착지와 seeded sender를 본다.
2. installed tree: `./run.sh check-pack-install` — 설치된 bin/shim의 같은 delivery scene, resolved pi/ACP dependency tree exactness.
3. clean consumer: `ENTWURF_REQUIRE_DOCKER=1 ./run.sh check-install-container` — checkout 비가시·global PATH shim·non-root·frozen package root에서 doctor delivery self-diagnostic까지.

**LIVE(최종 HEAD에서 신선한 증거 필수):**

- `LIVE=1 ./run.sh release-gate <fresh-scratch>` MUST 전부 GREEN. BEHAVIOR는 분리 기록.
- `smoke-resident-garden-guard` BIRTH/ATTACH/REPLACEMENT/POSITIVE.
- `smoke-entwurf-v2-matrix-live`: live pi send + active Claude mailbox + honest reject.
- `smoke-entwurf-v2-spawn-resume-live`: dormant record → exact transcript resume → 실제 모델 턴 → sender block/wantsReply/lock release.
- ACP: socket-citizen + raw turn + overlay + provider + reuse/carrier + bundled MCP. aggregate가 일부를 안 부르면 해당 gate를 명시 실행한다.
- **사람이 눈으로 보낸 것으로 대체 금지:** harness가 target garden id, delivery receipt/착지 파일 또는 socket ack, landed sender garden id·origin·replyable을 assert해야 한다. “tools/list가 된다”는 delivery 증거가 아니다.

### 5. Durable docs + merge cleanup — branch에서 끝낸 뒤 잊는다

- 최종 버전/계약을 `package.json`에서 파생해 AGENTS Runtime Dependencies, README, `docs/setup-clean-host.md`, run.sh 주석/사용법, version/coherence gates를 함께 갱신한다. 0.80/0.54 설명이 live claim으로 남지 않게 repo-wide 두 축 grep.
- 최종 evidence를 VERIFY/BASELINE에 남긴다: exact HEAD, candidate sha256, Node/Linux 축, deterministic 3셀, LIVE gate 결과, H7 전후 store/왕복 사실. 세션 서사는 NEXT에만 두고 durable 문서에는 재현 가능한 계약과 증거만 둔다.
- main merge 직전: main의 무효화된 #49-C 계획 폐기 표기, branch NEXT의 아직 유효한 장기 항목만 ROADMAP/이슈로 승격, 이 파일 삭제. version/tag/publish는 별도 release authority이며 merge 요청만으로 실행하지 않는다.
- **main 수용 금지 조건:** H7 미완, dependency 두 축 중 하나 미완, 최종 artifact delivery 3셀 중 하나 미실행/SKIP, 최종 LIVE evidence가 pre-bump HEAD, 문서에 옛 pin/live claim 생존.

## 상태 (2026-07-24 저녁)

- **C4 검수 라운드 원장 (2026-07-24 오전, M1 이전)** — 아래 3줄과 G1~G3은 C4 레인의 닫힌 기록이다. M1 검수의 R1~R3(NOW)과 라운드 이름이 겹치지 않도록 `C4-` 접두어를 붙였다.
  - **C4-R1 교차 검수 (오푸스, GLG 위임 headless 세션 — 보고서 `/tmp/entwurf-c4-review/report.md`)**: 독립 full check EXIT=0(2332 단언) + **변이 8종을 스크래치 트리에 심어 게이트 자기충족 검증 — 7종 RED**(A1 부활·sessions 부활·익명 기본 복귀·REQUIRE 재성장·M1 명명 제거·wantsReply 회귀·folding 제거), 라이브 로그 내부 대조로 aggregate가 C4 트리에서 돌았음 확인. 판단 기록 3건 전부 동의. 뚫린 1종(hatch 봉투 replyable:true를 아무 게이트도 못 잡음)이 F3. → 결함 6건(F1~F6).
  - **C4-R1 수선 (페블)**: `e906f8f` F1/F2/F4/F6 — README 발신 정책 4곳+hatch 문서화+Codex 절, run.sh usage·주석 5곳, ROADMAP 원장 3곳, provider doc + **AGENTS 승격 2건**(판단① self/peers 경계, "무효화된 문장 찾기" 규율+대상 목록). `f757a33` F3/F5 — D12에 `(external, non-replyable)` 단언+`replyable —` 부정 단언, 감산 잔재 2건 결합 삭제, **biome `noUnusedImports`=error(결합 규칙 첫 기계 backstop)**.
  - **C4-R2 검수 + 수선 (오푸스, 같은 세션)**: 수선 후 full check EXIT=0(2328 단언 — 회계 일치: `shouldListAsLive` 동반 삭제 −5, 신설 D12 +1). **변이 재실행 3종**: R1에서 유일하게 뚫렸던 `replyable:true`가 이제 D12로 RED, 미사용 import 재도입이 `biome check` EXIT=1, `noUnreachable`도 여전히 RED(**그룹 오버라이드가 나머지 recommended 규칙을 끄지 않았음을 확인** — 껐다면 backstop을 얻으며 lint를 약화시킨 셈). F1~F6 전항 확인. 새 결함 3건(G1~G3)을 오푸스가 직접 수선 → 이 커밋.
  - **G1** `docs/setup-clean-host.md` Stage 7이 pre-C2 launcher를 가르쳤다 — `--session-id` 주입 + **존재하지 않는 hard-exit 가드 주장** + 틀린 소켓 경로 주석(record가 자기 gid를 민팅하므로 주입한 id로는 소켓이 안 선다), `:233`은 pre-C4 sender 문장. **원인: AGENTS 대상 목록에 `docs/`가 없었다** — 규율의 구멍이 미스가 난 자리와 같았다. 목록에 `docs/**` 추가(+ 왜 install 가이드가 README보다 비싼지).
  - **G2** `f757a33` 자신이 `shouldListAsLive`의 정책 산문 2줄을 남겼다(`socket-probe.ts` 모듈 doc, `check-socket-probe.ts` 헤더). 같이 발견된 pre-C4 잔재(모듈 doc이 브릿지를 소비자로 지목 — 브릿지는 socket-probe를 import하지 않는다)도 정정. **기계 backstop은 심볼을 잡지 산문을 못 잡는다**는 실증.
  - **G3** NEXT 커밋 수 off-by-one(23 → 실측 24).

- **C4 랜딩 — 목표 ② "entwurf는 socket을 모른다" 코드로 성립 (페블, 오푸스 교차검수·후속 수선 완료).** 4 cut + 문서 수선, 커밋마다 full check GREEN: `be12348` cut① F2(spawn-bg plan `wantsReply` → dormant `<sender_info>` live rail 동형) · `d76d9f7` cut② dispatch rail(A1 narrow 삭제 — record-less socket은 모든 intent pre-probe `record-less-socket` 거부, 원인+M1 명명; `socket-only-no-resume-authority` 은퇴, +212/−312) · `5d99173` cut③ 목록 표면(legacy `sessions` projection·`controlDir`·socketOnly 섹션·per-socket get_info enrich·`/entwurf-sessions` 삭제 — peers = 시민+진단 2섹션, record-less는 F8 집계 진단, +352/−518) · `bc3f72d` cut④ 발신 신원(익명 발신 기본 거부, `ENTWURF_BRIDGE_ALLOW_ANONYMOUS_SENDER=1`이 유일한 문서화 hatch, REQUIRE env 은퇴 — installer/doctor/oracle/컨테이너 동반 재저작, D11/D12 신설) · `924f7d9` docs(README의 A1 시대 문장 3곳+dispatch 표, **pre-C2 `--session-id` launcher 섹션**, DELIVERY 행 — "무효화된 기존 문장 찾기" 규율 적용).
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
2. **entwurf는 socket 인터페이스를 아예 모른다.** record가 유일한 주소 축이고 socket은 dispatch 내부 transport일 뿐(PROTOCOL 3) — 사용자 표면(peers/facts/dispatch 의미론)에 socket이 identity로 비치지 않는다. → **C4 랜딩 + 오푸스 교차검수·후속 수선 완료 (2026-07-24, 위 상태 참조).**
3. **pi 뒤에 ACP로 붙은 클로드도 entwurf를 meta-record로 쓴다.** → **C3 tail로 게이트 고정** (smoke-pi-attach P8: 실물 enrich env → 브릿지 → 발신이 host record 신원으로 착지). PROTOCOL 8(pi host가 record 소유).

main 승격은 **브랜치 종료 조건 충족까지 보류**(GLG 2026-07-24 갱신) — C3/C4/M1 구현 뒤에도 H7(current pin) → pi 0.81 → Claude ACP 0.61/SDK 1.3 → final artifact delivery acceptance를 이 브랜치에서 끝낸다.

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
6. **M1 + H7 레인 (라이브 cutover)**: ~~M1 operator command~~ → **M1 DONE (2026-07-24, 위 NOW 참조)** — backup `<store>.v3-migration-backup-<ts>/` → migrate → verify non-V3=0 → restore 전부 코드+85단언 게이트로 성립. fixture: V1/V3-already/malformed/stray-key/mismatch(drift)/half-migrated **+ duplicate nativeSessionId** + restore real-sibling-only(foreign/nested/forged-suffix/symlink 거부) **+ backup 완결성(staging 원자성·내용 classify·lstat 원인 보존) + 단일 record-entry domain(regular file만, classifyStore 한 곳)**. **남은 것 = H7 라이브 전환.**

   **🧊 M1 동결 (2026-07-24, GPT 대칭 검수 후 확정) — 네 문장 계약.** 구멍이 계속 나온 원인은 공격 표면이 무한해서가 아니라 각 경로를 따로 검수했기 때문이다. 아래 네 문장이 M1의 전체 계약이며, 이 중 하나가 깨졌을 때만 M1 수선을 다시 연다 — restore 보강을 계속 파지 않는다:
   1. migrate와 restore는 **동일한 record-entry domain**을 쓴다 — regular file만, 규칙은 `classifyStore()` 한 곳 (S18이 양방향 고정: domain 밖 store는 verify/migrate front door 거부, domain 안 store는 migrate가 인쇄한 backup이 restore rc=0).
   2. final backup 이름은 **완료된 staged copy에만** 부여된다 (atomic rename, S17).
   3. restore는 backup **전체를 검증한 뒤에만** 현재 authority를 움직인다 (S16).
   4. 실패는 원인을 보존하고 store/backup/aside 중 **적어도 하나에 완전한 데이터**를 남긴다 (M2, S14).

   **범위 밖 (명시적 threat boundary)**: 검사 직후 파일을 바꾸는 TOCTOU 공격, 운영자가 의도적으로 제작한 완벽한 가짜 backup, 검증 직후의 물리 bit rot, root 권한 공격자. 이 CLI의 경계는 **operator-owned local filesystem**이다 — 이 밖을 쫓으면 restore가 암호학적 저장소가 되며 줄기(H7)에서 이탈한다.

   **🔴 순서 불변식 (확정 — H7 전 필독): migrate와 새 런타임 설치는 한 원자 단계다 — 그 사이에 어떤 세션도 뜨지 않는다.** 구 런타임(설치본 v2 훅)의 세션이 하나라도 뜨면: v2 시대 `scanIdentityByNativeId`가 방금 v3로 옮긴 자기 record를 판독 불가로 skip → match 0 → 같은 `nativeSessionId`의 v2를 **새 gardenId로 재민팅** → v3/v2 쌍이 duplicate nativeSessionId가 되어 판단②가 store 전체를 REFUSE — migrate 재실행이 blackout 한복판에서 막힌다(오늘의 mixed store가 정확히 이 메커니즘의 역방향 실증). 사고 시 `meta-bridge-prune`이 ambiguous로 잡아 manual rm을 인쇄한다.

   **✅ H7 실행 완료 (2026-07-24 16:24~16:27 KST, 페블 — GLG 방아쇠 "수정을 해야지", GPT 사후 승인).** 실측 증거:
   - **quiesce**: settings.json 플러그인 `false` + agy hooks.json rename → `verify` 2회 연속 **v2 191 / v3 3 / problem 0** 불변. 창 동안 live V3 pi 시민(`d294f0`, 검수자)은 idle 유지 — migrate는 v3 바이트 무접촉.
   - **migrate**: `./run.sh meta-bridge-migrate-v3 migrate` — **191 v2→v3, kept 3, 총 194**, backup `~/.pi/agent/meta-sessions.v3-migration-backup-20260724T162453`(194 record, GPT 독립 계수 `{v2:191,v3:3}` drift 0), 디스크 재검증 non-V3=0.
   - **⚠️ runbook 편차 (GPT 수용 판정)**: ③의 계획은 npm tgz 설치였으나 **설치 직전 실측 = 이 호스트는 checkout-managed**(`entwurf` bin 부재, npm -g 빈 목록, MCP가 dev worktree `start.sh`) → 새 런타임은 같은 `c1f3d21` 체크아웃 바이트의 `./run.sh install-meta-bridge` 재조립으로 랜딩(플러그인+MCP+settings 자동 복원 = quiesce 자연 해제). **아래 ③의 tgz 절차는 clean/npm-managed host용 계획문이며 이 호스트에서 실행된 명령이 아니다.** agy hooks 원복 완료.
   - **판정**: `doctor-meta-bridge` PASS(live Claude owner join 1, delivery self-diagnostic PASS, source/assembled/installed writer parity) + `verify ok: 194 v3, non-V3=0` + **양방향 라이브 왕복**: claudecode(`20260724T144042-30d75c`)→pi(`20260724T161741-d294f0`) `control-socket → sent` (직전 동일 발신이 D7 계약대로 거부됐던 것의 differential) / pi→claudecode mailbox 착지 + `entwurf_inbox_read` read-receipt(`lastReadAt=2026-07-24T07:27:26Z`). 각 방향 sender garden id 일치.
   - **rollback 미사용** — backup은 무접촉 보존 중. **새 세션 V3-only mint 확인 완료**: post-cut 첫 Claude Code 새 세션(`20260724T163013-79087d`)이 schemaVersion 3으로 birth(GPT 판정: 이로써 H7 성공 정의 전부 충족 — **H7 완전 종료**).

   ~~실행 체크리스트 — ★ 제안 채움 (방아쇠 전 확정 지점: ③ 릴리즈 컷, ⑤ 시민, ⑥(c) 판정선)~~ → 전부 실행으로 소진, 기록 보존:
   - **① quiesce (제안)** — 설치본 v2 writer는 실배선 조사로 둘이다: (1) Claude Code **플러그인** `entwurf-meta-receive@meta-bridge-local`(`~/.claude/settings.json`의 plugin enable + marketplace path `~/.local/share/entwurf/meta-bridge/.assembled`; 훅은 settings의 hooks 절이 아니라 플러그인 hooks.json의 SessionStart/CwdChanged/UserPromptSubmit), (2) agy `~/.gemini/config/plugins/entwurf-agy-imprint/hooks.json`의 PreInvocation `entwurf-agy-imprint`. 순서: settings.json의 `"entwurf-meta-receive@meta-bridge-local": true → false` → agy hooks.json을 옆으로 rename → dev 체크아웃 pi 세션 종료(V3 민팅도 창 동안은 멈추는 게 단순). **확인 = `./run.sh meta-bridge-migrate-v3 verify` 2회 연속 카운트 불변.** 창 동안 새 Claude 세션은 record 없이 뜬다 — 교차검수 릴레이는 GLG 수동.
   - **② verify (read-only)** — `entwurf meta-bridge-migrate-v3 verify`: **2026-07-24 15:37 재실측 v2 190 / v3 2 / problem 0 / parentage 0 → `--drop-parentage` 불필요** (v2는 세션마다 늘지만 parentage 0은 안정적 — 이 호스트 M1은 순수 형태 변환).
   - **③ exact candidate (확정, GLG 2026-07-24: 릴리즈 컷 없음 — main 이전이라 브랜치 tgz로 간다)** — HEAD **`c1f3d21`**(push 완료, exact-SHA CI 3 jobs GREEN)의 `npm pack` 산출물 `junghanacs-entwurf-0.12.8-repair.1.tgz`, **full sha256 = `4995b6faaba280349a3cbf6ba48adc1a1bbf6b413a13e65592816ca00faa427b`** (`a4a19be`·`c1f3d21` 두 커밋에서 결정론 재현 — NEXT 문서는 pack 비대상). 설치 절차 = `npm install -g <tgz>` → `entwurf setup`(내부 install-meta-bridge, 플러그인+MCP+settings 재조립).
   - **④ 원자 전환** — `migrate`(backup 자동) → non-V3=0 확인 → **즉시** ③의 설치. ①의 writer는 이 순간까지 죽어 있어야 한다(불변식).
   - **⑤ 판정 (시민 제안)** — 설치 후 복구 증거: `doctor-meta-bridge` 0 + `verify` non-V3=0 + **라이브 형제 채널 왕복 1회**: (a) 설치 후 GLG가 띄우는 **pi 신규 세션**(V3 birth), (b) **Claude Code 신규 세션**(새 런타임 훅이 V3 mint). pi→Claude `entwurf_v2` 1발 + Claude→pi 응답 1발, 각 방향 sender garden id 일치.
   - **⑥ 실패 시 롤백 (기준 제안)** — `entwurf meta-bridge-migrate-v3 restore <그 store의 .v3-migration-backup-<ts>>` (이 store의 **완전 판독 가능한** sibling만 받는다 — 이름 grammar + 내용 classify, `9c8ee58`/`0f7db49`/`a4a19be` 수선; store만 되돌리고 mailbox state는 state-wins·멱등) → 구 런타임 재설치. 판정선: **(a)** migrate 자체 rc≠0 = 무기록이므로 rollback 아님(원인 수정 후 재시도), **(b)** migrate rc=0 후 `doctor-meta-bridge` rc≠0 또는 `verify` non-V3>0 → 즉시 restore + 구 런타임 재설치, **(c)** 설치·verify GREEN인데 왕복만 미성립 → store 판독 오류가 한 건이라도 보이면 restore, 순수 rail/전송 문제면 전진 수선(delivery 실패에 store를 되돌리면 원인 축이 섞인다).

   self-host blackout 예상 — 끊긴 동안 GLG 수동 릴레이, 양방향 delivery 복구(⑤) 전 다음 cut 금지. **방아쇠는 GLG.**
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
- **H7 원자 전환 전까지 라이브 `install-meta-bridge` 금지.** 라이브 store는 pre-cut v2와 V3가 섞여 있고 프로덕션은 V3-only다. H7은 current-pin candidate로 migration+install을 한 원자 단계로 실행한다. 신규 설치는 처음부터 V3 mint라 별개다.
- **main 승격 조건은 2026-07-24 확대됐다.** H7만으로 merge하지 않는다. H7 baseline 성공 뒤 pi 0.81 축과 Claude ACP 0.61/SDK 1.3 축을 각각 검증하고, 최종 HEAD에서 deterministic artifact 3셀 + LIVE delivery acceptance를 새로 얻는다. 상세는 상단 「TO MAIN」이 SSOT다. 승격 전 이 파일 삭제(boot sector 규칙).
- **main `NEXT.md`의 #49-C 블록은 hard cut이 통째로 무효화했다 (머지 때 정리).** 그 계획의 대상(`--session-id` handoff 버그, marker pre-socket guard, `smoke-session-id-name` 유지)은 C2/C3가 rail 자체를 삭제해 주제가 사라졌다. 머지 시점에 main NEXT에서 #49-C를 폐기 표기하고 #49-E만 남긴다.

## Do not touch

fresh sibling mint/#47 mux, Cortex/#48, backend auth, transcript hydration, 새 DB/planner/worker 트리. **단 pi 0.81과 Claude ACP 0.61/SDK 1.3 dependency uplift는 상단 「TO MAIN」에 따라 이 브랜치에서 완료한다.**

## SSOT

#50 hard-cut 결정 — https://github.com/junghan0611/entwurf/issues/50
