# NEXT — #153 Herdr operator entrance 최종 검증

# RAIL — 현재 좌표

- [x] **1. CLI 기반.** dispatch 다이어트·안전 help, 11f922d branch push/정상 훅/해당 SHA CI 완료.
- [x] **2. source-only 경계.** 설치본의 dev-bin 두 mutation 거절, 독립 검수와 scoped PARTIAL 완료.
- [x] **3. operator lifecycle.** floor·candidate admission·단일 링크·철회·deactivate 합성 검수 및 실제 npm consumer 통과.
- [ ] **4. 최종 후보 검증.** ← CURRENT: source/consumer/sweep 닫힘. 정상 stage로 후보 확정 → 별도 GO의 frozen FULL 1회.
- [ ] **5. 요청한 commit/push.** FULL·정상 훅 뒤 현재 branch commit/push → agenda → exact-SHA CI 확인. 운영 설치/릴리즈/merge 아님.

# NOW

- **Next:** main이 검수된 29파일을 정상 commit workflow로 stage하고 후보를 고정한다. 별도 GO 뒤 `/tmp/e153h/operator-full/run.sh pnpm run check:full` 1회(새 빈 HOME/XDG4/PI, env-i). 예상 15–20분은 추정이며 source/index/**NEXT**를 동결하고 로그·전후 지문을 남긴다. `check-pack`의 선언된 dist 재emit만 허용하고 최종 파일별 bytes를 비교한다. whole qualification body/실제 pack-install/LIVE/새 install은 FULL에 넣지 않는다. 과거 `/tmp/e153h/full/` 증거는 덮지 않는다.
- **GLG 승인:** 이 세션에서 “이 작업 마무리되면 커밋푸시하자”. 검수·실제 consumer·영향 검증·frozen FULL을 닫은 뒤 이 branch를 정상 훅으로 commit/push한다. 운영 PATH/profile/auth 변경·배포·tag/release·merge는 별도다.
- **현재:** `feat/153-operator-entrance`, HEAD/upstream `11f922dcbcb9292561018b59d16546dc24a1aa2c`. main이 branch/status와 전체 29개 intended 변경을 직접 확인했고 commit skill/device(oracle)를 읽었다. 이제 정상 staging 뒤 FULL 후보를 고정하며, FULL GREEN 전 commit/push하지 않는다. 다른 파일이 나타나면 중단한다.
- **동결 규칙:** FULL/qualification 실행 중 source/index/**NEXT** 편집 금지. 중간 기록은 repo 밖. 첫 예상 밖 실패는 편집 script/assert까지 원자료·실제 exit 보존 STOP, named GO 전 수선·재시도 없음. LIVE/whole qualification body/새 의존 설치는 자동 실행하지 않는다.
- **읽을 곳:** [#153 thread](https://github.com/junghan0611/entwurf/issues/153), `plugins/herdr/README.md`, `VERIFY.md`, `scripts/herdr-operator-link.mjs`. 이전 상세 NEXT는 `/tmp/e153h/NEXT-operator-history-d5dcc0.md`(sha256 `5e4d19df…bc75`)에 보존했다. 현재 계약은 source/README/VERIFY가 소유하며 옛 설계 제안은 재개 지시가 아니다.

# RECENT — 직접 확인한 검증

모든 PARTIAL은 **각자의 과거 후보**에 대한 측정이다. 합산해 현재 후보 전체/릴리즈 통과로 부르지 않는다.

| 증거 | 판독 | 범위/후보 |
|---|---|---|
| dev guard PARTIAL r2 | main JSON 직접 READ: 21 KILLED, control ok, seal stable | `/tmp/e153h/devbin-boundary-qualification-r2.json`, workSurface `288b6018…`, receipt `3ecdfc1d…` |
| floor/admission PARTIAL | main 6 JSON 직접 READ: 35+38+25+2+25+6=131 KILLED, 새14 own QK, control/seal 정상 | `/tmp/e153h/u12q/G[1-6]-*.json`, workSurface `d4951768449926cdec288d355e3de8731a6c8c0f408e9e5e3c51b836cb5ebc11` |
| operator PARTIAL | main 3 JSON 직접 READ: 23+41+36=100 KILLED, 새20 own QK, control/seal 정상 | `/tmp/e153h/u3q/Q[1-3]-*.json`, workSurface `f75e1a5ad58d5b9d00fc8ecdffabcf07f0e57a10846f1b62c7a5f326df59caf4` |
| 실제 package consumer | main 전체 stdout/exit0/stderr0/전후 fp diff0/dist cmp 동일 직접 READ | `/tmp/e153h/u3p/`, source run.sh `5ba6d64f…`, VERIFY `f93a177c…`; FULL 아님 |

- PARTIAL들의 named-excluded `.vite/.../results.json` drift는 seal에 기록돼 있다. source/core/declared inputs의 안정성과 “모든 파일 무변경”을 혼동하지 않는다. structured Vitest의 own QK는 실패 title **집합** 귀속이며 첫/유일 실패를 뜻하지 않는다.
- Consumer는 실제 tarball/npm 설치본의 absolute expose → bare root/command help → withdraw(floor3 유지) → 재expose → bare deactivate의 link/runtime/ledger 회수 → 살아남은 원 설치본의 no-ledger orphan 거절을 관찰했다. helper는 literal/cmp/facts가 모두 통과한 뒤 PASS를 출력한다. 성공 step raw는 부모 trap이 지웠고, 보존 증거는 소스에 연결된 전체 gate log다.
- Consumer의 journal/active ledger는 seeded fixture다. 실제 Pi wiring/전체 component teardown/cache 회수/registry mode·postinstall 복원/LIVE/운영 host 설치는 측정하지 않았다. link-before-component 순서는 별도 HAC source proof와 mutation receipt가 담당한다. Consumer oracle 자체 kill-power는 미측정이다.
- 소비 gate의 npm install **6곳**과 pnpm 설치는 scripts-off다. SDK spec/version/coherence/host-range/two-root 검사는 유지됐다. flag는 source argv 근거이지 lifecycle 실행 추적이 아니다. package postinstall 방어·별도 normal container lane·pack prepare/prepack은 유지했다.
- Pack 전후 dist는 96파일/aggregate `2cb6bd61…` 및 파일별 bytes 동일. 2분37초 wall은 Opus d5dcc0 측정 보고다. Astra82d861도sourcehash/log/exit0/빈stderr/지문을읽어해당consumer closure를확인했다. 완료 DM 833/834는 각각 두 PARTIAL 사건에 한 번 보냈고 읽음 증거는 아니다.

# 채택한 제품 경계

- 공개 CLI는 `herdr-plugin-expose-operator --bin-dir <absolute>`와 `herdr-plugin-withdraw-operator`. 두 arm은 cwd를 바꾸지 않는다. public 두 verb는 active-package self admission을 요구하지만 공통 inverse/deactivate의 receipt-absent tail에는 이를 추가하지 않았다.
- 명시한 physical bin-dir·한 이름 `entwurf`만 다룬다. caller PATH의 prospective winner를 쓰기 전에 판정하고 외부 winner를 실행하지 않는다. profile/default dir/별칭/다른 bin/takeover/자동 source→runtime delegation 없음.
- Receipt는 고정 주소의 6 keys/3 phases. 모든 receipt는 certified ledger3·같은 runtime/roots에 결합한다. 무영수증 동일-target link도 foreign, ledger2+receipt는 자동 승격하지 않음, linked+missing은 drift다.
- 첫 노출은 settled active에서 floor3 → receipt linking → create-only symlink → linked 순서. opt-out 뒤3 유지. deactivate는 preflight-all → checkpoint → link → components → runtime → ledger-last. no-ledger 잔재는 고정 receipt에서만 출발하며 임의 PATH 소유권 탐색 없음.
- Candidate admission은 staging verify 뒤 첫 swap 전 기존 try 안의 sync-void callback. 공식 floor3 build가 candidate 자신의 reader로 정확한 host ledger를 읽게 하고 exit/stderr/전체 certified 값 정합을 요구한다. reader probe 하나가 inverse 지원을 인증하는 것은 아니다.
- Same-artifact early return은 probe 없음. recovery 이동 자체는 probe 전이고 이후 fresh candidate는 probe 대상이다. 실패 후보 회수 뒤 installing journal/previousRuntime은 retry authority이며 zero-write rollback이 아니다.
- EEXIST는 현재 호출 실패·linking intent 유지·다음 명시 retry 재판정. 실제 SIGKILL/power-loss/동시 mutator/SSH/셸 alias·function·hash/무중단 swap은 인증하지 않았다. 새 lock/manager/registry/loader/harness 없음.
- Old11f 증거는 `/tmp/e153h/old11f/RESULT.md`: 고정 old runBuild **함수 예외**와 old activate/deactivate CLI1의 schema3 거절·정의한 HOME snapshot 불변. Old activate의 check-bridge fixture child는 실행됐다. 전체 old build CLI/효과0/정상 legacy install 성공으로 넓히지 않는다.

# 보존된 실패와 절차 경계

- 최초 dev guard qualification은 main의 실행 중 NEXT 편집으로 seal RED였다. 뒤의 r2와 분리: `/tmp/e153h/devbin-boundary-qualification.json`, `DEVBIN-QUAL-NEXT-DRIFT.md`.
- R4 비연속 find의 manifest RED는 `/tmp/e153h/fl/46-check-gate-manifests.log`. 뒤의 편집 script exit1/AssertionError(0,0) 후 무승인 재개 이력은 `UNIT2-STOP-AND-READ-REVIEW.md`에 보존. 별도 raw log 없음/tool receipt만인 한계도 유지한다. 후속 GREEN은 이를 소급 승인하지 않는다.
- Help anchor 공백 실패는 `/tmp/e153h/u3/13-install-surface.log`; 한 문자 named 수선 뒤15가 GREEN. 초기 Nix argv0/과거 EPIPE·scanner 실패도 외부 history/원자료에 남아 있으며 뒤의 성공으로 지우지 않는다.

# 팀 / 다음 실행

- main `20261014T212756-68bd94`: 조율·NEXT·최종 commit workflow. Opus `20261030T190810-915040`: 구현/측정. Astra `20261030T185730-567753`: 독립 검수. 소통은 main 경유, DM도 main만.
- 이 checkout/branch만 사용. worktree/개발 clone/기록 삭제/임의 sibling 생성·resume·retire 없음. GLG 글·Org·homepage·autholog는 건드리지 않는다.
- Commit skill은 읽었다. 실제 device를 읽어 commit body에 known garden IDs와 기록한다. 정상 hook만 사용하고 unsafe/no-verify/force 금지. 요청한 push 성공 후 agenda를 한 번 찍는다.
- 최종 문구 두 곳은 a1d420으로 정정됐고 main이 실제 patch를 읽었다. README는 기본 비노출·새 command 포함 runtime의 명시 링크를 구별하며 기존0.45 snapshot에 기능이 있다고 주장하지 않는다. build 주석은 실제 raise owner를 현재형으로 적는다. Opus의 syntax/Biome/diff-check 각0, 동작 변경 없음.
- 직전 11f922d의 CI run41170297022/이전 FULL942초는 **그때 후보** 증거다. 새 commit의 exact-SHA CI와 새 frozen FULL을 대신하지 않는다. 새 태그/릴리즈는 요청하지 않았다.
