# NEXT — 0.32.0 prepared-SHA CI → 보존된 versioned artifact

# RAIL — 현재 좌표

- [x] **1. Source/native + pre-version landing** — frozen b220 r4와 main78c917a CI37679372365 수용. 각각 고유 fingerprint.
- [x] **2. Grok 정합성 + metadata 준비** — B0/D2/O6, prose 수선/test0. 0.32.0 version/CHANGELOG 묶음은 정상 hooks/scanner로 닫는다.
- [ ] **3. Prepared-SHA CI / 보존 artifact 결과** ← CURRENT: `.tmp-verify/032-release/`의 owning receipt 확인. Four jobs+BODY success 뒤 one preserved candidate만 exact Docker 소비. 완료 receipt가 있으면 다음 GLG 승인 대기로 이동; 반복 실행 없음.
- [ ] **4. Tag/GitHub Release → npm publish** ← PAUSED: 이번 승인 범위 밖, 별도 GLG 결정.

# NOW

- **Next:** `prepared.sha`, `ci/accepted.json`, `artifact/accepted.json`에서 실제 prepared SHA/CI/body/candidate canonical path/SHA256/image를 읽는다. Missing은 미완료, PASS receipt는 그 단계의 결과이지 다음 mode 권한이 아니다. 두 축이 수용되면 태그/GH Release의 GLG 승인 대기. npm publish는 별도 explicit version/candidate/dist-tag 승인이 필요하다.
- **Authorized:** GLG가 local FULL+LIVE 반복 생략 → version 준비 → prepared-SHA main push/required CI → 보존된0.32 artifact 검증에 명시 승인했다. `.tmp-verify/032-release/authority.md`가 이 좁은 계약을 소유한다. 정상 hooks/shared scanner, prepared-SHA 필수 CI/body, one exact Docker는 유지한다. 문서 수정으로 local FULL/body/LIVE/pack-install을 반복하지 않는다. Generic P4/P5/M0 반복은 이번 명시 범위에서 없으며 원 b220/78 영수증을 새 SHA로 승격하지 않는다.
- **Freeze:** branch NEXT는 main merge 전 원문 보존 후 retire. Prepared commit/index/worktree를 CI→pack→artifact verdict까지 고정한다. 임시 CI tar를 release candidate로 재사용하지 않는다. 최종 candidate는 한 번 pack한 같은 canonical file/hash로 검증한다. 이후 상태 갱신은 ignored receipt/issue에 기록하고 태그 대상 SHA를 움직이지 않는다.
- **Protect:** runtime/native SDK/overlay/pins/mutants/gates 불변. Operator auth/settings/records/transcripts/SQLite/Emacs/foreign roots/0.31 archives/원r3 RED 보존. P9는 read-only, cleanup/signals0. RED는 raw/candidate 보존 → owning leaf → STOP; model fallback/blind replay 없음. 실제 env-loader는 release 후 agent-config.
- **Read:** `.claude/skills/entwurf-release/SKILL.md` mode boundaries/exact CI/M3, `VERIFY.md` evidence axes, `.tmp-verify/032-release/{authority.md,docs-commit.sha,prepared.sha,ci/,artifact/}`, [#130 thread](https://github.com/junghan0611/entwurf/issues/130).

# RECENT / SCOPE

- **b220:** `.tmp-verify/032-final/aggregate-r4-accepted.json` f16dcfa3…cf58 — FULL716s,898 IDs each once KILLED,178 controls green,origin pure,MUST25/0/0,BEHAVIOR1. Explicit installed proof 별도, Codex65/PD36 공식 saved snapshots를 owning oracles로 재판정. 이 pre-version source/native receipt는 prepared-SHA/0.32 artifact/registry 증거가 아니다.
- **78c917a:** CI37679372365 four jobs+BODY success/898 once KILLED/178 green/container exit0. Temporary CI tar9cb0fd68…5481d는0.31.0 이름의 당시 source bytes이며 published0.31 artifact나 보존된0.32 candidate가 아니다.
- **Grok:** pre-prepare reportca021850…dd5e/6907bytes/B0D2O6. Source/status/index before/after MATCH, old reports 불변,test/build0. Carrier pending underclaim/issue 첫RED 문장과 README branch 표현을 prose-only로 수선. 기존 peer grants는 소진, STOP 유지.
- **Integrity:** r3 aggregate RED/FULL714s0, protected36MB snapshot 복구불가/wider extent unknown/vendor-32603 cause unknown. 원 raw/confirmation/erratum 보존. Prior-evidence regression은 private-fixture proof이고 r4 실제 tmp에는 이전 root가 없었다. Immutable0.31 tag/artifact/archive 유지. agy1.2 NOT CERTIFIED/핀1.1 unchanged; 새 native agy acceptance 없음.
