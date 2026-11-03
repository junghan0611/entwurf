# NEXT — 0.51.0 core 출하 / Herdr npm 정합 검증 완료

# RAIL — 현재 좌표

- [x] **1. Core 출하.** `v0.51.0` = `32c31ea`; exact-SHA CI4, Windows carrier TGZ·동일 파일 Linux 수용, GitHub Release 및 인간 npm 게시 완료.
- [x] **2. Registry 수용.** 원 U0 기준 latest0.51.0/repair0.12.8-repair.1 보존. registry TGZ=accepted TGZ, private consumer668files/curated7models 확인.
- [x] **3. Herdr source 정합.** npm runtime pin/SRI·manifest0.51.0·Pi1.5 안내·README retire, 독립 검수와 affected5 PARTIAL/FULL 수용. GitHub description도 수정했다.
- [ ] **4. 후속 측정/운영 선택.** ← CURRENT: 현재 main의 exact-SHA push CI4를 확인한다. public-ref Herdr journey·plugin snapshot/tag/Release·운영 설치/재시작은 별도 요청이며 미실행이다.

# NOW

- **다음 한 행동:** 현재 main SHA의 push CI4를 읽어 source landing 상태를 확인한다. public-ref 수용을 요청받으면 `VERIFY.md`와 plugin README의 named `smoke-herdr-raw-install-live --ref main` 계약부터 읽는다. private build-runner proof를 public-ref 설치 성공으로 승격하지 않는다.
- **Source owner:** npm runtime/플러그인 버전은 `plugins/herdr/{runtime-lock.json,herdr-plugin.toml}`, 설치/동일-source rebind/explicit source-switch는 plugin README가 소유한다. unversioned install은 실행 시 ref의 lock을 따른다. core tag/TGZ/npm 바이트는 이 후속 작업으로 바뀌지 않는다.
- **운영 경계:** 기존 GR208e는 D1 이전 validation TGZ다. source/npm 출하가 기존 시민의 loaded bytes를 바꾸지 않는다. 운영 설치·deactivate/activate·정상 종료/동일-id 재개는 별도 인간 결정이다. 임의 retirement/kill/NativeDB open·lock 수선/새 login·credential 복사0.

# RECENT — 2026-11-04 receipts

- **출하:** [core Release](https://github.com/junghan0611/entwurf/releases/tag/v0.51.0), [exact32c31ea CI4](https://github.com/junghan0611/entwurf/actions/runs/41704213407), [Windows producer](https://github.com/junghan0611/entwurf/actions/runs/41706422290). Accepted TGZ SHA256 `04fcce26d0a6dec8b8bb9a7f14a843eee0defb313aedafa34080600853d36e4d`,11710142B; registry 실물과 byte-identical. 원 U0 pre-latest0.50.0/pre-repair0.12.8-repair.1에서 post-latest0.51.0/repair동일을 측정했다.
- **Herdr private n=1:** registry-installed helper로 realnpm0.50→0.51 swap/compiled bridge/3 executable bins/9verbs/668files/idempotence/inverse. 별도 root의 seeded torn-state 복구(실kill 아님), private build-runner activation/inverse(Herdr plugin registry/public-ref journey 아님)를 확인했다. U3consumer는 동일 registry bytes의 기존 receipt를 인용했다.
- **검수:** Fable→README amendment→Astra→코디, 각 scope에서0Blocker/0Defect. old0.50/SDK1.4 frozen oracle와 gate/SDK/helper source는 불변이며 mutant find만 자연스러운 역사 문장으로 re-point했다.
- **최종6파일 후보:** HEAD32c31ea+binary diff `847f63356b93dbaaf07d8a5d5f820885169a5ed367fc75d3bd89b3cb780d6b74`. fresh focused, exact argv `["bash","run.sh","check-dep-versions"]` PARTIAL5/5 KILLED/ownQK/controlsok/originpure(나머지1508 미실행), frozen FULL963s rc0/tee0. FULL logSHA `ac5bf3e850422c362b16547790ae676a4c3c5d7855b512bca9234bc45a723835`, 전후 seal 동일. **이 NEXT는 FULL 후 handoff bookkeeping이며, 7파일/새 commit SHA에서 FULL을 재실행했다고 주장하지 않는다.**
- **원 RED 보존:** postpublish seal 후 마지막203B를 append한 wrapper 순서 문제는27OK/1FAIL로 남겼다. prefix hash 일치와 별도 correction `394becc3371c384fa96554b53e82c5a50cda8721424f54b21cedd2cd276d51cd`/7277B/31hash로 결속했다. 원 manifest/log/exit는 덮지 않았고 재U2U3/재설치/재게시0이다.

# 읽을 곳 / 가드

- `plugins/herdr/README.md`, `VERIFY.md:108–112`, `CHANGELOG.md`0.51.0, [#155](https://github.com/junghan0611/entwurf/issues/155). 원 실행은 `/tmp/i155/make-051/{herdr-proof,herdr-focused5,herdr-floor,review}/`; registry 원자료는 `~/.local/state/entwurf-releases/0.51.0-32c31ea16487/postpublish.oSdxz1/`. host-local receipt를 다른 host에서 읽을 수 있다고 가정하지 않고 위 hash와 범위를 함께 전달한다.
- private 복귀점은 `~/.local/state/entwurf-preparations/155/RESTART.md`와 A의MAKE-STATUS. 옛 main NEXT는 git 이력(32c31ea)과 같은 private dir에, 미커밋 branch NEXT는 private `NEXT-herdr-branch-final-20261104.md`에만 보존했다.
- Offline는 private HOME/PI/XDG/runtime, TMPDIR=/tmp, pnpm/npm verify-deps=error, noCI. 첫 예상 밖 RED는 원 exit/log/seal 보존 STOP, blind retry/unsafe hook bypass/whole qualification BODY0. P9는read-only, records/transcripts/DB/receipt/fixture의 일괄 삭제0.
