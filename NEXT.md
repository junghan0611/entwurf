# NEXT — 0.45.0 (#154 agent guidance 단일 원천)

0.45.0은 모델에게 건네는 문구(도구 설명·reject hint·전달 결과 절)를 하나의 버전 있는 원천으로 묶은 이정표다. root `ENTWURF.json`(schema 6, revision 11)을 엄격 reader 하나가 읽고, source·compiled·installed에 같은 bytes가 실린다. 추출 이전 원문은 oracle로 남기고, 의미 수정은 따로 리뷰한 amendment layer로 쌓는다. wire 값·알고리즘·도구·권한의 새 기능은 없다. 0.42–0.44는 출시되지 않았다. bootstrap·notice·mailbox envelope·ACP 문구 등은 여전히 코드에 있다(CHANGELOG 0.45.0 "Still code-owned").

# RAIL — 현재 좌표

- [x] **0. 이전 cut 닫힘.** core `v0.41.2` = `a2980d6`(npm `latest` 0.41.2). Herdr snapshot `v2026.10.24-herdr.0.41.2` = `94d0594`. 0.41.2 기록은 CHANGELOG에 있다.
- [x] **1. #154 범위 landing.** `1657eca`…`a4bea2d`(11 commits)를 main에 fast-forward했다. exact-SHA push CI run 40296075141은 4 job 모두 success다. 이 run은 pre-version SHA의 증거다.
- [ ] **2. prepare 0.45.0.** ← CURRENT
  - package.json 0.45.0으로 올리고 offline/ignore-scripts frozen sync(lock 불변).
  - CHANGELOG 0.45.0 절, Herdr lock은 `herdr-checkout` carrier로.
  - 문서 리뷰 → 후보 freeze → private world에서 managed build + `check:full`(canonical dist 불변) → `release-gate --cut` → release-prep commit.
- [ ] **3. make.**
  - prepared main push → exact-SHA CI → Windows preview dispatch 1회 → candidate 회수(재pack 금지).
  - Linux container 수용 → 같은 tgz로 installed remote-pair → native installed-host acceptance → tag·GitHub release.
- [ ] **4. publish.** 별도 권한이다. 수용된 tgz만 출하한다.
- [ ] **5. Herdr snapshot re-pin.** publish 뒤 측정한 sha512로 npm 0.45.0에 다시 pin한다. 별도 snapshot·tag.
- [ ] **6. 운영 전환.** 수용된 artifact로 바꾸고 에이전트를 정지·재시작한 뒤, 새 세션에서 installed doctor를 돌린다. 대상과 시점은 GLG가 정한다.

# NOW

- **증거 규칙.** 이전 후보의 PARTIAL은 후보별로 한 줄씩 적고 합산하지 않는다. 출하 SHA에서 kill-power를 다시 측정하지 않는다(#144). 0.41.2의 증거를 이번 SHA로 올려 쓰지 않는다. landing CI(a4bea2d)는 prepared SHA의 CI가 아니다.
- **canonical checkout이 운영 launch source다.** 이 호스트의 `entwurf`/`entwurf-bridge`는 checkout을 가리킨다. checkout 편집·build·node_modules 변경은 다음 spawn에 닿는다. 그래서 FULL과 build는 private world에서 돌린다.
- **측정하지 않음:** 실행 중인 bridge가 지금 무엇을 load했는지, 서로 다른 release의 sender/receiver, #149 T3(opt-in).

# GUARDRAILS

- 모든 pnpm/commit/push hook에 `pnpm_config_verify_deps_before_run=error`를 둔다. 첫 RED·deps·wrapper 오류면 멈추고 보고한다. 자동 수선과 재시도, unsafe override, force push는 금지다.
- 모든 install 형태에 `--ignore-scripts`를 붙인다. root `prepare`가 canonical dist를 `rm -rf`하기 때문이다.
- 후보를 freeze한 뒤 worktree·index·dist가 움직이면 그 receipt는 무효다. records/native transcript/DB/색인, 후보와 사본, 증거, 옛 dist 보관본은 지우지 않는다.
- `.agent-reports/.envrc`는 보존한다(루트 `.envrc`는 재생성하지 않는다). 넓은 /tmp 청소, 프로세스 sweeper, 자동 whole-floor rerun은 금지다.
