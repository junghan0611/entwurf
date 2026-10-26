# NEXT — 0.45.0 (#154 agent guidance 단일 원천)

0.45.0은 모델에게 건네는 문구(도구 설명·reject hint·전달 결과 절)를 하나의 버전 있는 원천으로 묶은 이정표다. root `ENTWURF.json`(schema 6, revision 11)을 엄격 reader 하나가 읽고, source·compiled·installed에 같은 bytes가 실린다. 추출 이전 원문은 oracle로 남기고, 의미 수정은 따로 리뷰한 amendment layer로 쌓는다. wire 값·알고리즘·도구·권한의 새 기능은 없다. 0.42–0.44는 출시되지 않았다. bootstrap·notice·mailbox envelope·ACP 문구 등은 여전히 코드에 있다(CHANGELOG 0.45.0 "Still code-owned").

# RAIL — 현재 좌표

- [x] **0. 이전 cut 닫힘.** core `v0.41.2` = `a2980d6`(당시 npm `latest`). Herdr snapshot `v2026.10.24-herdr.0.41.2` = `94d0594`. 0.41.2 기록은 CHANGELOG에 있다.
- [x] **1. #154 범위 landing.** `1657eca`…`a4bea2d`(11 commits)를 main에 fast-forward했다. exact-SHA push CI run 40296075141은 4 job 모두 success다. 이 run은 pre-version SHA의 증거다.
- [x] **2. prepare 0.45.0.** `191e425`. canonical checkout에서 managed build 1회와 `release-gate --cut`(`check:full` 918 s, MUST 24/0/0)을 돌렸다(Fable 진단 뒤 GLG가 원래 절차로 복귀).
- [x] **3. make.** exact-SHA CI 40332074387(4 job), Windows preview 40333933835, 후보 `584fca5d…`(11473584 B) container 수용·installed remote-pair, native installed-host 수용. tag `v0.45.0` = `191e425`, GitHub release 공개. VERIFY 기준 5의 "single MCP server" 문구 범위와 수용 driver의 `--allowedTools` 한계는 후속 문서 보정으로 남는다.
- [x] **4. publish.** GLG가 직접 publish했다. npm `latest` 0.45.0, `repair` 0.12.8-repair.1. registry tarball은 수용 후보와 byte 동일이고 sha512/sha1이 `dist.integrity`/`dist.shasum`과 같다. sandbox registry 설치 smoke(U3) green.
- [ ] **5. Herdr snapshot `v2026.10.27-herdr.0.45.0`.** ← CURRENT: `chore/herdr-0.45.0-pin`에서 lock을 npm 0.45.0(측정 sha512)으로, manifest를 0.45.0으로 맞추고 docs를 정합했다. focused와 real-registry swap 22/22는 green이다. 남은 순서: FULL 1회 → commit → main FF push → exact-SHA CI → public-ref raw-install journey → tag·GitHub release. 각 단계는 코디가 따로 GO한다. tag 날짜는 실행 시 KST로 다시 맞춘다.
- [ ] **6. 운영 전환과 정리.** re-pin 뒤 developer-install 경로·ownership 확인 → GLG가 운영 대상과 시점을 정함 → 새 세션 검증과 재시작 → 검증된 폐기 가능 scratch만 정리(P9). 그때까지 sandbox·prefix·artifact·log·records는 남겨 둔다.

# NOW

- **증거 규칙.** 이전 후보의 PARTIAL은 후보별로 한 줄씩 적고 합산하지 않는다. 출하 SHA에서 kill-power를 다시 측정하지 않는다(#144). 다른 release의 증거를 이번 SHA로 올려 쓰지 않는다.
- **canonical checkout이 운영 launch source다.** 이 호스트의 `entwurf`/`entwurf-bridge`는 checkout을 가리킨다. canonical dist는 이제 0.45.0 후보 build다. build 이전 dist는 byte 그대로 보관돼 있다(복원은 명시 결정 때만). 이미 실행 중인 process는 자기가 load한 ESM을 그대로 쓰고, 새 spawn만 현재 checkout을 읽는다.
- **측정하지 않음:** 실행 중인 bridge가 지금 무엇을 load했는지, 서로 다른 release의 sender/receiver, #149 T3(opt-in).

# GUARDRAILS

- 모든 pnpm/commit/push hook에 `pnpm_config_verify_deps_before_run=error`를 둔다. 첫 RED·deps·wrapper 오류면 멈추고 보고한다. 자동 수선과 재시도, unsafe override, force push는 금지다.
- 모든 install 형태에 `--ignore-scripts`를 붙인다. root `prepare`가 canonical dist를 `rm -rf`하기 때문이다.
- 후보를 freeze한 뒤 worktree·index·dist가 움직이면 그 receipt는 무효다. records/native transcript/DB/색인, 후보와 사본, 증거, 옛 dist 보관본은 지우지 않는다.
- `.agent-reports/.envrc`는 보존한다(루트 `.envrc`는 재생성하지 않는다). 넓은 /tmp 청소, 프로세스 sweeper, 자동 whole-floor rerun은 금지다.
