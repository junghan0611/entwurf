# NEXT — #155 / 0.51.0 D1 수선 완료 → 출하 수용

# RAIL — 현재 좌표

- [x] **1. SDK 1.5.0 + D1 표시 호환 수선.** 구현 체크포인트 `20426b2`; 독립 검수와 carrier PARTIAL 66건 수용.
- [x] **2. 새 frozen FULL/P5 + 정리.** 11-04 지명된 후보에서 MUST24/0/0, BEHAVIOR1/0/0, Source witness 및 P9 수용.
- [ ] **3. 최종 bookkeeping → landing/Make.** ← CURRENT: CHG/NEXT 증거 delta를 동결·검수하고 정상 커밋한 뒤 main FF. 최종 SHA의 Make M0 FULL·push/CI4·Windows TGZ/동일 파일 Linux 수용은 아직이다.
- [ ] **4. tag/GitHub Release → 사람의 npm 게시.** 산물 수용 뒤 U0 영수증과 단일 게시 명령 인계. npm/registry/Herdr·운영 적용은 각각 별도 경계다.

# NOW

- **다음 한 행동:** Oracle 코디가 A169dd1의 CHG와 이 NEXT 마감 내용을 합쳐 freeze → Fable → Astra의 evidence-only delta 검수를 닫는다. 구현 파일/SDK/pin/dist는 바꾸지 않는다. branch NEXT는 owning 문서/CHG와 private 원문에 근거를 승격·보존한 뒤 삭제했다. 검수 후 정상 release-bookkeeping 커밋으로 landing을 준비한다. 검수/최종 SHA 확정 전에 main FF/push/tag/Windows dispatch를 하지 않는다.
- **실행자:** A169dd1은 release gate·artifact/검증·CHG, 코디68bd94는 NEXT·계약/검수·commit/push 게이트를 맡는다. 준비/Make는 승인된 범위로 이어가되, npm은 인간 직접 실행이다. 새 형제/프레임워크/임의 재설치·재시작은 없다.
- **다음 모드:** `.claude/skills/entwurf-release/SKILL.md`의 Make. 최종 clean main SHA에서 M0 FULL을 새로 실행하고, push 후 도장 → exact-SHA push CI4 → Windows producer 1개 → 그 TGZ 동일 바이트 Linux 수용 → tag/GitHub Release/U0 순서다. 오래된 validation TGZ를 게시 파일로 쓰거나 재포장/이동하지 않는다.
- **읽을 곳:** `~/.local/state/entwurf-preparations/155/RESTART.md`, A 소유 `MAKE-STATUS.md`, `CHANGELOG.md` 0.51.0, `VERIFY.md`, [#155](https://github.com/junghan0611/entwurf/issues/155). private 경로가 없는 다른 host는 아래 결정적 수치와 issue thread를 읽는다.

# RECENT — 코디가 원문을 직접 대조한 근거

- **구현:** `20426b25af19b6e604f16e4335a901a2db63f3d6`, parent `434874e`, tree `ba596c153283efa1587009ffdb1d87ca02ff5447`, 12개 subject/proof/docs 파일, 정상 hooks rc0. SDK 공식 raw active 전체를 head-first/archive 제외로 표시하며, 모델 context·저장·압축은 SDK 소유다.
- **qualification:** 원 65/66 WRONG-REASON은 보존했다. SEED 변이가 test의 context-only handle 관측을 끊어 beforeAll에서 죽는 것을 확인하고 watch 관측 한 줄만 보정했다. 새 formal group66은 control ok/KILLED66/자기 QK 귀속66, receipt SHA `822f2d8b950eca254fa7f7a12e27e7cd2904bfdba985c19414fc9695870aed40`, candidate head `434874e`/surface `b6cee8925072cb26e99179f63d2158b3c2d655022e22947cf32ebdd07370a621`. release 전체의 kill-power가 아니며 다른1447은 미실행이다.
- **새 P5:** head `20426b2`, index tree `ba596c15…`, patch `b8172a65fd356db69a5f00d52c54ab84aeb75496acefab815dc855978124ba5c`, dist `3c3c679a…6d85`; wrapper 03:02:34 시작, gate 03:02:41–03:23:10 KST/1229초, wrapper 03:23:11 마감. 관리 build0/7초와 dist 동일, canonical FULL 963초 PASS를 포함해 MUST24/0/0·BEHAVIOR1/0/0·cut OK, gate/tee/sampler/전체 exit0. log SHA `d16537ca4455498c6a371bc80a869d0de70832d30d86d770ccbc8212427380c2`, 원 scratch와 보존 사본 동일. 전후 seal `37446ea0a4f527b33fa0525ca902fc2d34279300e626bce3d2403954650a6662` 동일. 이 마감 문서는 그 뒤의 bookkeeping이다.
- **Source Native:** W1–5 모두 true. PD host1286681/startKey85825017 → private server1286518 → garden `20261104T032235-3f6fd3`/location owner 일치 → checkout bridge1286727. 초기 ordinary Pi MCP1286617은 GR208e다. 이 join은 Source 기동/왕복 근거이며 모든 module load trace·vendor 긴 이력 pixel 표시 근거가 아니다.
- **정리/P9:** 새 app-server1204048의 기록 startKey85682104 일치 후 SIGINT0, listener/A/S 소멸. 코디는 해당 server/자식1286077/PD host/표본기의 `/proc` 부재를 직접 확인했다. 기존 daemon은 무접촉. 재부모 `/tmp` holder는 선행 emacs 1개로 관측됐고, 새 fixture temp8개(코디 크기 관측 0–34B)·chain/scratch/records/DB/receipts는 보존했다. read-only P9, 삭제0. 실제 파일/바이트 전부의 HOME 불변을 주장하지 않는다.

# 가드 / 아직 하지 않은 일

- 새 FULL/P5는 위 후보의 증거다. 최종 bookkeeping SHA/출하 artifact의 CI·Make M0·Windows·Linux 수용으로 자동 승계하지 않는다. whole qualification BODY는 출하 축이 아니며 추가하지 않는다.
- 운영 GR208e는 D1 이전 validation TGZ다. 새 D1-bearing 산물 설치와 인간의 재시작 전 기존 시민에 D1이 켜졌다고 하지 않는다. 기존 Claude 일부의 loaded0.50/전용 MCP 경계도 별도다. 운영 DB 시험 open/lock 수선/retirement/blanket kill/credential 복사·새 login은 금지다.
- Offline는 private HOME/PI/XDG/runtime·TMPDIR=/tmp·pnpm/npm verify-deps=error·no CI. named LIVE는 native auth/provider/endpoint를 유지하고 정확한 identity 이름만 unset한다. wildcard `CLAUDE_CODE_*` 제거는 하지 않는다.
- 예상 밖 실패는 원 exit/log/seal을 보존하고 STOP한다. blind retry/자동 rollback/unsafe hook bypass는 하지 않는다. 첫1.5 write 전 일관 전체 백업을 되돌리는 것과 package downgrade를 혼동하지 않는다.
- thinkpad의 이전0.50 개발자 설치·동일 대화 복귀는 별도 host 기록이다. 자동 pull/build/restart하지 않는다. 원 main/branch NEXT는 private `NEXT-{main,branch}-before-landing-20261104.md` 및 git 이력에 보존했다. 현재 stage를 옛 host의 승인/설치 수용으로 읽지 않는다.
