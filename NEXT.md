# NEXT — OMP as one garden sibling (실무 잠수함)

> NEXT는 disposable boot sector다. 완료 이력은 issue/git이 지고, 방향은 ROADMAP,
> 운영 규율은 AGENTS가 진다. 새 하네스 입학 경로는
> [docs/adding-a-harness.md](./docs/adding-a-harness.md)다.

# RAIL — 현재 좌표

- [x] **1. OMP measurement·audit·LIVE + Bundle A admission hardening** — backend registration, TUI-only birth, visible status, native MCP hand, sender identity, four-root/package/doctor hardening 완료.
- [x] **2. Operator deploy + real outbound acceptance** — 2026-08-28 oracle: 재설치·shared reader 재배포·doctor 4종 green, `check:full` exit 0, outbound LIVE 4건(그중 1건은 GLG가 직접 연 세션). `tools.xdev` 방언 발견과 문서화 포함.
- [x] **3. Bundle B: addressed receive / roundtrip** — **대칭이 생겼다.** receiver 확장, bounded arm defer, `/new`·watch-error·vanished-signal·overlapping-edge fail-closed, install/uninstall/doctor, `check-omp-receive-arm` + `scripts/mutants/omp-receive.json`(11 mutants, 전부 정확한 이유로 kill), `smoke-omp-receive-state`, `smoke-omp-receive-live`. registry `self-fetch`/`D6`, DELIVERY 행 신설. 단언 개수는 게이트가 세는 것이지 증거가 아니므로 여기 박지 않는다 — 영수증은 `raw-omp-measure/README.md` §M7 이다.
- [x] **4. Bundle A+B land** — `a809ee7 feat(omp): receive addressed native messages` (26 paths). 체크포인트 commit; push·cut 없음.
- [x] **5. Bundle C: visible fresh + admission release-stop** — 구현이 한 candidate로 동결되고 independent review까지 끝났다(2026-08-30, architecture blocker 0 / **Defect 3** / observation 1). `entwurf_fresh_call`이 네 번째 backend로 omp를 연다. clause 7 LIVE(`smoke-omp-fresh-live`, release-gate MUST)는 **green** — 2026-08-30, 21 assertions, omp 18.0.0 / `openai-codex/gpt-5.6-sol`, callback sender garden `20260830T192913-df52b9`. 영수증 정본은 DELIVERY.md의 OMP 행이고, 그 근거로 DELIVERY/README의 라벨은 이미 이동해 있다. **한 호스트·한 모델·한 번의 수용이다** — multi-host도, multi-model도, 한 프로세스 안의 반복 fresh도 주장하지 않는다. review amendment 한 번들(Defect 1–3)은 2026-08-31에 `5bb1d50`으로 반영됐다 — same-id `session_switch` epoch 무효화, creator 소유 `ctx.setTimeout`/`ctx.clearTimer` readiness 타이머(취소 불가 빌드는 arm 거부), 산문 정렬, 뮤턴트 21→23. closure review 잔여 O-D1r은 defect 등급으로 승격되어 `153f9f4`에서 닫혔고(뮤턴트 23→24), 첫 standalone qualification이 `fd5e462`에서 manifest 부채를 측정으로 정산했다 — `check-gate-qualification` 324/324 KILLED, `check:full` exit 0 (430s).
- [x] **6. 0.16.0 cut** — 태그·릴리즈 완료.
- [x] **8. #72 진단·수리** — 원인은 entwurf가 아니었다. oracle에 다른 하네스(openclaw acpx, PR #245)용으로 손설치된 `acp-zombie-reaper.service`가 벤더 프로세스 이름 `claude-agent-acp`를 **argv 부분문자열**로 골라 900초 넘은 것을 SIGTERM한다. entwurf는 child를 턴 사이에 **retain**하므로 그 나이는 세션의 나이다 — 15분 넘은 세션은 5분마다 저격당했다. 벤더 핸들러가 그 시그널을 `dispose(); exit(0)`으로 지워서 exit 0/무시그널로 도착했고, 그래서 세 번의 진단이 후보 4개를 폐기하고도 놓쳤다. 두 boot에 걸쳐 **12/12** 대응(pid+시각 이중 잠금, 이슈를 연 2026-07-30 샘플과 2026-08-16 원조 필드 리포트 포함). 수리는 `ca52fdd` — 울타리 안에서 (a) vendor를 **같은 프로세스로 import**하는 entwurf 소유 launcher(재시작할 child가 없으므로 supervisor가 될 수 없다), (b) exact full-line 프레임으로 실린 typed signal observation. 게이트 `check-acp-launch-namespace` 신설 + CELL 12–15, mutant 8개 전수 KILLED, live receipt는 `scripts/raw-acp-child-exit-measure/README.md`.
- [x] **7. 0.16.0이 남긴 원커맨드 구멍 메우기** — 닫혔다(`4076498`, `c3d5b2a`), pi floor 0.84.4까지 함께(`5c1bda5`). 원래 본문: **v0.16.0은 OMP를 admit했지만 `setup`은 OMP를 합성하지 않았다.** GLG의 thinkpad(설치 안 된 호스트)에서 `entwurf setup`이 green을 찍는데 OMP는 확장도 mcp.json도 status line garden id도 없었다 — 유닛 게이트는 유닛만 묻고, admission 게이트는 registry↔fresh만 물어서, "유닛이 있다 → 원커맨드가 거기 닿는다" 간선을 아무 게이트도 소유하지 않았다. 이번 세션에서 (a) `setup_all`에 omp 4유닛(birth→MCP→`tools.xdev` 설정→receiver) presence-driven 합성, (b) 설정값 writer `install-omp-config`/`uninstall-omp-config` 신설(정확히 자기가 넣은 줄만 소유, 운영자의 명시적 `xdev: true`는 덮지 않고 이름 불러 거부), (c) `smoke-setup-verdict` S-8(스텁 벤더로 실제 합성 구동 + install-state 4종 + agent dir 산출물 + `xdev-off` 유효 판독 + 2회차 멱등) 및 S-1의 `OMP_BIN` absent 핀, (d) `docs/adding-a-harness.md` **step 10**(온보딩은 setup이 합성해야 끝난다)까지 닫았다. 남은 것: 버전 범프·CHANGELOG 승격은 `entwurf-release` prepare 몫(GLG 승인).

<details><summary>6의 원래 본문 (릴리즈 준비 기록)</summary>

CHANGELOG `## Unreleased`가 구현 범위 `v0.15.1..19ad90c` **30커밋** 전수로 채워져 있었다. CHANGELOG `## Unreleased`가 구현 범위 `v0.15.1..19ad90c` **30커밋** 전수로 채워져 있다(릴리즈 준비 커밋은 그 위에 따로 쌓이므로 `v0.15.1..HEAD`의 수는 계속 커진다 — 기준은 항상 범위이지 숫자가 아니다). 섹션 승격·버전 범프·lockfile·release-gate 수치는 `entwurf-release` **prepare** 몫이고, land/prepare/make/publish는 모드마다 별도 GLG 승인이다.

</details>

- [x] **9. ACP Claude를 메인 레일로 — 계기판 수리(#93)** — main에 랜딩됨 (`4d6fe4c` 및 선행 3커밋).
  본문 설계(`extractTurnUsage?` seam → 네 필드에 4분할 투영)는 2026-09-02 측정으로 **기각**됐고,
  실제로 랜딩한 것은 그 기각의 실행이다. #93·#92·#96 모두 닫혔다 — #92는 2026-09-03 두 번째
  호스트 재현으로, #96은 캐리어 없이 선 대체 계측으로. 이월된 관측은 CARRIED에 있다.
  독립 리뷰 D1(재청구 하한의 스코프 혼합)은 `9479750`에서 닫혔다.

- [x] **10. 0.17.0 cut** — 태그·GitHub 릴리즈 완료(`v0.17.0` @ `934acb9`). npm에는 올라가지 않았다.
      세 번의 재컷이 `cut: BLOCKED`로 끝났고 GLG가 네 번째를 금했다 — 그 구멍은 CHANGELOG 0.17.0
      Verification에 이름으로 적혀 있고, 반올림하지 않았다.

- [x] **11. 0.17.2 cut + npm** — `v0.17.2` @ `c82576c`, GitHub 릴리즈 + **npm `latest` = 0.17.2**
      (GLG가 직접 publish, 2026-09-03). 0.17선이 처음으로 레지스트리에 올랐다. #94·#98을 실었다.
- [x] **12. #101 랜딩 · 0.18.0 컷 + npm** — 한 pid 안의 세션 전환이 만든 유령 시민과 거짓 배달을
      닫은 커밋 7개(`3ca8220 → 5763bfa`)가 main에 올라가고 **`v0.18.0` @ `2934807`**로 컷됐다.
      GitHub 릴리즈 공개 + **npm `latest` = 0.18.0**. exact-SHA CI run `33866330016` 3잡 초록,
      LIVE 게이트 `cut: OK`(MUST 23/0/0, qualification 364/364). 발행된 integrity가 수용 candidate의
      것과 동일해 리팩이 없었음이 레지스트리에서 확인된다. npm 토큰이 만료돼 있어 발행은 GLG가
      직접 했다(0.17.2와 같은 방식).
- [x] **13. #102 1단계 main 랜딩** — `ci/99-stage1`이 fast-forward로 main에 담겼다:
      `8649967` (ci(qualification): move the head into the floor and stop tag pushes rebuilding).
      머리 게이트 `check-gate-manifests`가 `check:hermetic`으로 들어가고, semver 태그 push가
      이미 빌드된 SHA를 재빌드하지 않는다. #99·#102 닫힘. **2단계는 #103** — P2(이벤트 좁히기) /
      P5(잡 분리) / P6b(느린 그룹 재배치). 브랜치 NEXT(`NEXT--ci-99-stage1.md`)는 이 커밋에서 삭제됐다
      (머지 전에 지웠어야 했다).
- [x] **14. 버전 범프 레인 — pi 0.85.1 + claude-agent-acp 0.75.1 (+ #91 OMP 채택 규칙)** —
      **`9e1d067` 로 main 에 랜딩**(#104). 네 축 전부 초록: `check-gate-qualification`
      **369/369 KILLED** exit 0 (38분) · `pnpm run check:full` exit 0 **481s** ·
      `check-pack-install` exit 0 · `check-install-container` exit 0. #91 은 문서 절이
      랜딩해 **닫혔다**. **푸시 안 함** — origin 은 여전히 `67c4086`.
- [x] **15. 0.18.1 컷 (#102 + #104 합본)** — **`v0.18.1` @ `cabecf6`, GitHub 릴리즈 공개.**
      land(`c247594` CI run `34018205091` 3잡 초록) → prepare(`cabecf6`) →
      make(prepared-HEAD CI run `34027762637` 3잡 초록, candidate 수용, 태그·릴리즈·도장)까지
      끝났다. 발행은 토큰이 401 이라 0.17.2·0.18.0 과 같이 GLG가 직접 했다 — 16 에서 닫혔다.
- [x] **16. npm publish 0.18.1 + 사후 integrity 대조** — GLG 가 직접 발행했고(토큰 401),
      레지스트리 바이트가 수용 candidate 와 **동일**함을 2026-09-06 에 측정했다 —
      리팩이 없었다. `latest`=0.18.1 / `repair`=0.12.8-repair.1 (보존됨).
      수치는 아래 NOW 의 integrity 영수증 한 줄이 진다.

- [x] **17. #103 — CI qualification budget stage 2 (조각 1+2)** — 브랜치 `ci/99-stage2` 가 main 에
      fast-forward 로 들어갔다. **조각 1**: 정확-SHA 릴리즈 오라클에 네 번째 축 —
      그 run 의 `check` 잡 안에서 `Run ./run.sh check-gate-qualification` 스텝이 success 였는가
      (skipped 는 실패). dispatch run 도 증거로 받되 `headSha` 재확인이 그때 하중을 받는다.
      **조각 2**: 본체는 qualification 표면이 움직인 브랜치 push 에서만 돈다 —
      `scripts/ci-qualify-decide.sh` 가 경로 집합을 **매니페스트에서 런타임 산출**하고,
      fail-open 다섯이 각자 번호를 로그에 남긴다. `workflow_dispatch -f qualify=true` 와 주 1회
      schedule 은 무조건. 게이트 셋(8c/8d/8e/8f)과 뮤턴트 셋이 이를 진다. 인벤토리 **373**.
      **GitHub 실관측 [측정 2026-09-06/07]**: 코드 push `34047559085` = 본체 success, `check` 잡
      **36m24s** · docs-only push `34065841309` = 본체 **skipped**, **6m13s** · 그 SHA 에 4축 오라클은
      **ABORT**(초록 run 인데 릴리즈 증거로는 거부 — 조각 1 이 먼저여야 했던 이유) ·
      dispatch 복구 `34066181211` = `event=workflow_dispatch`, 본체 success, 오라클 PASS.
      `fetch-depth: 0` 실비용 **0초**(checkout 2s = depth 1 과 동일). #103 닫힘.

- [x] **18. v0.18.2 컷 (#103 합본)** — `v0.18.2` @ `5a640d7`, GitHub 릴리즈 공개(2026-09-07 11:58 KST).
      land run `34070192960`(4축 오라클 PASS @ `0f6667d`) → P5 LIVE `--cut` **MUST 23/0/0**, qualification
      **373/373**, 55m05s → M2 prepared-HEAD run `34076217321` 4축 PASS → M3 수용(no repack). **이 컷이
      자기 오라클로 판정됐다**: 릴리즈 커밋은 `CHANGELOG.md`+`package.json` 뿐인데 `package.json` 이 뮤턴트
      subject 라 필터가 본체를 돌렸고(`1 of 2 … run_body=true`), 네 번째 축이 그 success 를 읽었다.
      sol(gpt-5.6-sol) 독립 검수 Defect 4+2 전부 amendment 로 닫힘. 4번째 qualification 전수는 **GLG 결정으로
      생략**(red 1건은 `smoke-omp-bridge-state` 호스트 omp 스캔, 우리 diff 밖 — 아래 이월 관측).
- [x] **19. npm publish 0.18.2 + 사후 integrity 대조** — GLG 가 직접 발행(2026-09-07 12:xx KST).
      [측정 oracle 12:2x] `dist.integrity` sha512-`sZencZe+…d9V8kg==` ≡ candidate sha512 · `dist.shasum`
      `7e4c0820ff3797fbb09ed13982c302c99c066eb3` ≡ sha1 · 레지스트리 tarball 12,505,816 bytes sha256
      `27df97ad…84e5` ≡ 수용 sha, `cmp` **바이트 동일** · dist-tags `latest`=0.18.2, `repair`=0.12.8-repair.1 보존. 리팩 없음.
- [x] **20. #105 ① fresh project-seat placement — `feat/105-placement` 착지 (2026-09-07 12:12–17:10 KST).**
      조사 lane: OMP Opus `20260907T123530-a87cdb` + pi 형제 4(terra/grok/glm/sonnet) + scout 3 → R1–R8 50분, 정본
      `.agent-reports/105-research-20260907.md`(로컬). GLG 결정: **없으면 reject, 생성 없음** — `ifMissing`/`create` 축 자체를
      두지 않는다("다 자동화하면 테스트·검증 비용이 커진다"). 구현 Claude Code Opus `20260907T141316-a1c1a1` →
      `a39b637 feat(mux)`(22 파일, 새 leaf `resolve-tmux-session.ts`, `closeWindow` 서버 바인딩) · sol 독립 검수 Blocker 0 /
      Defect 3+1 → amendment 1 bundle · qualification **381/381** · `check:full` exit 0 554s · LIVE `smoke-mux-fresh-call-live`
      39/39(4 launch, seat×cwd 2×2) · grok 문서·이해 검수 Blocker 0 / Defect 5 → `5a6c21c docs(fresh-call)`.
      #105 스레드 댓글 2건이 계약 정본(본문은 스냅샷). ② retire / ③ remote 는 착수 때 새 이슈.
- [x] **21. v0.19.0 컷 + npm — 4모드 전부 닫힘.** `v0.19.0` @ `96b60e3`, GitHub 릴리즈 공개, **npm `latest` = 0.19.0**(GLG 직접 발행).
      land `1775b2d`(run `34112423341` 4축 PASS) → prepare `96b60e3` → make(run `34166283051` 4축 PASS, candidate 수용 no-repack,
      태그·릴리즈·도장) → publish. **레지스트리 integrity 대조 [측정 2026-09-08]**: `dist.integrity` sha512-`PYPhtlfxWtu6…vn9XCw==`
      ≡ candidate · `dist.shasum` `4de66c9a6c54a4e987ce5406c74c96af4190cc2c` ≡ sha1 · 레지스트리 tarball **12,535,258 bytes**
      sha256 `5f6f24b3…3048` ≡ 수용 sha, `cmp` **바이트 동일** · dist-tags `latest`=0.19.0, `repair`=0.12.8-repair.1 보존. 리팩 없음.
      **능력은 #105 ① 하나인데 검증이 결함 둘을 찾았다** — 출하된 `doctor-omp-bridge` 의 거짓 초록(부하 의존 5–15%)과 쓰인 이래 한 번도
      발동 못 한 `sync_auth` credential 트립와이어(100%). 원인 하나: `pipefail` 아래 조기 종료 `grep -q` 가 생산자를 SIGPIPE 로 죽이고
      141 이 `if` 의 clean 가지로 번역된다. 규칙은 `smoke-omp-mcp-state.sh:91` 에 이미 있었고 두 reader 에 닿지 않았다.
      독립 검수(pi `zai/glm-5.3`)가 두 번째를 **다른 레인에서** 찾아왔고, 첫 컷의 `MUTANT-STALE` 이 조용히 무효가 된 뮤턴트의 출하를 막았다.
      인벤토리 382 → **385**. #105 는 닫혔고 ②③ 는 sorge#8·#9 로, 잔여 관측은 sorge#7·#10 으로 나갔다.

- [x] **23. #78 First evidence 착지 — Cortex overlay `realHome` 가드 flavor 명시 + kill-proof 게이트** — 브랜치 `fix/78-realhome-flavor`
      → main fast-forward (`d67aff9`, 2026-09-08 22:xx KST). GLG 가 세운 팀: 코디네이터 fable `20260908T211235-485de8` · 구현 Opus
      `20260908T211458-5bbccd` · 검수 terra `20260908T212236-d157ee`(Blocker 0/Defect 0/Observation 0) · 판례 조사 Sonnet `20260908T221802-3e8543`.
      영수증(구현자 measured, oracle): qualification **388/388 KILLED** 2454s(`CORTEX-REALHOME-PLATFORM-NEUTRAL: KILLED in 0.6s`) ·
      `check:full` exit 0 450s(첫 실행은 gitignore `dist/` mtime 으로 `check-bridge-delivery` 붉음 → NEXT 규율대로 `build-bridge` 후 재실행, candidate 불변).
      **워크트리 금지·브랜치 작업**(GLG 결정, #110 이 그 자리를 비켜간 근거). PR #77(@yizixu) 은 이 SHA 로 close + 답글 + CHANGELOG credit(PR #40 선례).
      주장 범위: 가드가 더 이상 POSIX 전용이 아님(게이트 증명). **native Windows 지원 주장 없음** — #78 나머지 셀은 물리 호스트 필요, #78 은 열린 채.
      **exact-SHA CI PASS**: run [`34232316086`](https://github.com/junghan0611/entwurf/actions/runs/34232316086) `event=push` @ `da3af88`, 3잡 전부 success,
      `check` 잡의 `Run ./run.sh check-gate-qualification` 스텝 **success**(뮤턴트·게이트 표면을 건드렸으므로 `ci-qualify-decide` 가 본체를 켰다).

- [x] **24. #95 codex 레인 step 1(vendor measurement) 착지** — GLG 가 2026-09-08 에 2026-08-01 의 codex native lane 거절을 **뒤집었다**.
      브랜치 `feat/95-codex-lane` 6커밋 → main fast-forward. **문서·측정만, 소스/게이트/뮤턴트 바이트 0.** 영수증은 `scripts/raw-codex-measure/`.
      팀: 코디네이터 `20260908T211235-485de8` · 측정 Opus `20260908T224329-2680e2` · 검수 terra `20260908T212236-d157ee`(4라운드, 인용 20/20 CONFIRMED, Blocker 0).
      **GLG 결정처럼 보였던 갈림 둘이 측정으로 사라졌다** — hook trust 는 managed `/etc/codex` 레이어가 프롬프트 없이 열고, clause 4 는 `thread/name/set` 이 벤더 auto-titler 를 이긴다.
      **join 키의 모양이 바뀌었다**: parent-pid 가 아니라 와이어 `_meta.threadId` 이고 hook `session_id` 와 같은 문자열이다. 마감 코멘트가 #95 스레드의 정본.

- [x] **25. #78 macOS consumer-CI 랜딩 + v0.20.0 컷·발행** — `feat/78-macos-consumer-ci` 가 main 으로 머지됐고 `v0.20.0` 이
      **2026-09-09T13:02:45Z 에 태그·GitHub 릴리즈·npm 으로 나갔다.** `macos-install-surface` 는 그 컷에서 required 로 승격됐다.
      실린 것은 세 상태 그대로다 — Entwurf-only 설치면 **CERTIFIED (CI)**, 하네스 레일·마커 join·ACP 실턴·mux **NOT CERTIFIED — pending
      physical host**, native Windows **UNSUPPORTED**. 빌린 맥 영수증은 아직 없다(아래 CARRIED).

- [x] **26. #110 두 번째 체크아웃 self-registration + claude-agent-acp 0.76.0** — 브랜치 `fix/110-second-checkout` 2커밋
      (`6d6aaa6` 수리 / `2650e95` 범프, 원인이 달라 분리) → main fast-forward `2650e95`. 워크트리에서 작업했고 정본은 건드리지 않았다.
      **#110 의 제목이 틀렸다**: pi 는 부팅한다. tracked `packages: [".."]` 가 "지금 있는 체크아웃"을, user-scope 가 정본 절대경로를
      등록해서 pi 의 `local:<resolved path>` identity 가 갈리고, 두 번째 체크아웃에서 확장 사본 둘이 로드돼 **브랜치 사본이
      `--entwurf-control` 을 가져가고 설치본이 실패하는데 에러가 설치본 경로를 찍는다.** 수리: entwurf 자기 체크아웃은
      project-scope 자기등록을 갖지 않는다 — tracked 바이트로든 writer 가 쓴 바이트로든.
      영수증: qualification **393/393 KILLED**, `check:full` exit 0 472s, exact-SHA CI
      [`34438272372`](https://github.com/junghan0611/entwurf/actions/runs/34438272372) 4잡 success + qualification 본체 스텝 success,
      실물 수용(손) 정본·워크트리·foreign cwd 모두 확장에러 0 / 모델행 7.
      첫 qualification 이 `SECOND-CHECKOUT-EXTENSION-COLLISION` 을 **SURVIVED** 로 냈고 원인은 셀이 씨앗을 **인덱스**(`git show :`)에서
      읽어 자기 재이식을 못 본 것이었다 — 그 셀의 주체는 세션 시작 시 **디스크의 파일**이다. 게이트가 자기 일을 했다.

현재 좌표: 1–26 완료 → **26. #110 + acp 0.76.0 랜딩 완료**(main `2650e95`). 다음은 **0.20.1 컷**(patch: 결함 수리 + dep 범프, 새 능력 없음).
#109 openclaw 다리는 **닫혔다**(요청자가 컨테이너를 나왔다) · **0.16.1 make는 열린 채 PAUSED**.
푸시·태그는 `entwurf-release` 4모드 몫이다 (CalVer `tag-release`가 아님).

# NOW — stem: 0.20.1 컷 (#110 self-registration 수리 + claude-agent-acp 0.76.0)

- **Stem:** **0.20.1 을 자른다.** patch 가 맞다 — 결함 수리 하나와 dep 범프 하나이고 새 능력이 없다.
  `entwurf_fresh_call` 스키마도 움직이지 않았다. GLG 가 2026-09-10 에 push·병합·릴리즈를 승인했다.
- **좌표:** main = **`2650e95`** (#110 수리 `6d6aaa6` + acp 0.76.0 범프 `2650e95`, ff 머지·푸시 완료).
  exact-SHA CI [`34438272372`](https://github.com/junghan0611/entwurf/actions/runs/34438272372) 4잡 전부 success,
  `check` 잡의 qualification 본체 스텝 success. #110 은 병합 SHA 로 닫혔다. 패키지는 아직 `0.20.0`.
- **정본 개발자 설치는 끝났다:** `/home/junghan/repos/gh/entwurf` 에서 `./run.sh install` 이
  `project-scope packages[] skipped — entwurf's own checkout self-registers through user scope (#110)` 를 찍고
  tracked 파일을 바이트·mtime 그대로 뒀다. `doctor-pi-package` = owned, `doctor-pi-provider` = ok(7 tools).
  손 수용: 정본 / 워크트리 / foreign cwd **셋 다 확장에러 0 · entwurf 모델행 7**.
- **Next:** (1) `/skill:entwurf-release prepare 0.20.1` — CHANGELOG `## Unreleased` 를 `## 0.20.1 - <KST 날짜>` 로 **승격만**
  하고 본문은 다시 쓰지 않는다(이미 Fixed 2항목 + Upgrade note 가 들어 있다) · `npm version` · `pnpm install --lockfile-only` ·
  `docs/acp-backend-rail.md` 지원표의 Entwurf package 행을 0.20.1 로 · `check:full` · `LIVE=1 release-gate --cut`.
  (2) `make 0.20.1` — 푸시 → exact-SHA CI → 보존 candidate 1개 + `check-install-container`(**Docker 필요**) → 태그 → **GitHub 릴리즈 공개**.
  (3) `publish 0.20.1 <candidate> latest`.
- **Blocker:** 없음. 단 **npm publish 토큰이 401 이면 GLG 손이다**(0.17.2·0.18.0·0.18.1 전례) — 붙들지 말고 바로 DM.
- **Read:** `.claude/skills/entwurf-release/SKILL.md`(4모드가 각각 별도 권한 경계다) · `VERIFY.md` 릴리즈 수용 · `AGENTS.md` "Verification scheduling".
- **Do not touch:** **워크트리에서 `./run.sh install` 이나 `takeover-user-scope` 를 돌리지 마라** — `REPO_DIR` 이 워크트리라
  user-scope 자기등록을 워크트리로 옮겨 #110 을 반대 방향으로 다시 만든다. 개발자 설치는 정본 체크아웃에서만 ·
  태그만 만들고 GitHub 릴리즈를 빼먹지 마라(GLG 가 릴리즈 노트를 github.com 에서 읽는다) ·
  이슈 칸이 비었다고 채우지 마라(총 10 / 구현 5 상한; 현재 결함이나 실행 가능한 계약만 칸을 얻는다) ·
  codex 레인은 별도 `feat/95-codex-admission` candidate에서 작업 중이며 0.20.1 release stem과 섞지 않는다.

<details><summary>#78 macOS / 설치면 다양화 NOW (닫힘 — 0.20.0 으로 나갔다)</summary>

# NOW — stem: 사용자층 확보 = 설치면 다양화 (GLG, 2026-09-08: "설치면 다양화가 더 급하겠어")

- **Stem:** **#78 의 macOS 축.** GLG 가 「사용자층 확보 = 설치면 다양화 + 코덱스 지원」으로 축을 정했고, 둘 중 **설치면이 먼저**라고 정했다
  (2026-09-08). 우산은 [sorge#14](https://github.com/junghan0611/sorge/issues/14). **2026-09-09 에 GLG 가 축을 넓혔다** —
  *"나는 macos에서 내가 리눅스에서 하는것처럼 해주려는거야. 어설프게 해서 0.20.0을 넣을수는 없거든"* — 그리고 **회사 맥을 빌린다**고 정했다.
- **좌표:** 브랜치 `feat/78-macos-consumer-ci` @ **`9cc5b09`** 푸시됨. CI run
  [`34316688064`](https://github.com/junghan0611/entwurf/actions/runs/34316688064) **4잡 전부 success**,
  `check` 잡의 qualification 스텝 success. `macos-install-surface` 는 이제 **required** 다.
  **닫힘:** 그 브랜치는 머지됐고 `v0.20.0` 이 2026-09-09T13:02:45Z 에 나갔다. (3) "0.20.0 을 무엇이라 부를지" 는
  후자로 — 「설치면 CERTIFIED (CI) + 출하 경로 portable, 레일은 빌린 맥 영수증 후」 — 잘렸다.
- **⚠ 이전 판의 틀린 문장을 여기 남긴다:** 이 stem 은 *"macOS 는 싸다: `macos-latest` 러너가 곧 진짜 맥이라 **호스트를 빌릴 필요가 없고**"* 라고 적고 있었다.
  **그건 틀렸다.** CI 러너는 하드웨어상 맥이지만 **로그인된 하네스가 없어** 레일을 인증하지 못한다 — 설치면만 준다. 그래서 빌린 맥이 필요하다.
- **Read:** 브랜치 `NEXT--feat-78-macos-consumer-ci.md`(재론 금지 결정 3건 포함) · `.agent-reports/macos-portability-audit-20260909.md`(1010줄 감사) ·
  #78 본문 `## Evidence before a native-Windows claim` · #78 코멘트의 #86 obstruction matrix(2026-08-27).

</details>

## 세 상태를 섞지 마라 (0.20.0 에서 확정, 계속 유효)

이 리포에서 `certified` 는 **물리 호스트 닥터 초록**을 뜻하고, CI 가 주는 것은 그보다 약한 **CERTIFIED (CI)** 다.
**CERTIFIED (CI)** = macOS Entwurf-only 설치면 · **NOT CERTIFIED — pending physical host** = 모든 하네스 레일·마커 join·ACP 실턴·mux ·
**UNSUPPORTED** = native Windows 뿐. **CI 러너를 물리 호스트 증거로 재라벨하지 마라**(이전 stem 이 실제로 저지른 실수다).

**native Windows 는 제품 규모다**: bin 6개가 전부 bash 를 가리키고 `entwurf` bin 은 **6,725줄 `run.sh`** 라, #86 매트릭스대로
Node 프론트도어·심링크 없는 소스 노출·프로세스 seam 이 필요하다. 재진입 조건은 **GLG 의 명시적 product-scale 승인**이다. 열지 마라.
WSL2 는 계약상 리눅스의 연장이라 새 작업 없음.

## codex 레인 — unreleased native candidate, explicit home LIVE green

- **좌표:** `feat/95-codex-admission`. ACP Codex는 금지 그대로다. 목적은 GPT 접근을
  하나 더 만드는 것이 아니라 Codex의 native tools·delegation·work context를 그대로 둔 citizen이다.
- **candidate 모양:** root-owned prompt-free `/etc/codex` `SessionStart` birth · strict
  request-scoped metadata identity(join 충돌 fail-loud) · operator-owned app-server
  `thread/loaded/list` probe · one-shot `codex queue` native-push(**재시도 0**) · user
  MCP/status-line atom · `entwurf_fresh_call backend=codex`. mailbox/receiver/resume/ACP 없음.
- **GLG placement 결정:** operator가 기존 exact `codex` tmux home 하나를 소유하고 app-server와
  supported Codex TUIs를 거기 둔다. omitted-placement Codex fresh는 그 이름을 exact lookup하며,
  explicit placement는 expert override로 우선한다. Codex의 MCP child는 app-server의 `TMUX`/
  `TMUX_PANE`을 받아 outbound Pi를 같은 home에 연다. Entwurf는 session/app-server를 만들거나
  감독하지 않고 pane을 추측하지 않는다. request→arbitrary-attached-TUI seat join은 여전히 없으며
  그 넓은 topology는 unsupported/unclaimed다.
- **Home LIVE accepted (2026-09-12):** 57 assertions, exit 0. initial Pi `20260912T140748-355654`
  `$150/@397` → omitted Codex `20260912T140800-8bc8d9` `$158/@398` → outbound Pi
  `20260912T140829-a08178` `$158/@399`; app-server PID `1693273` stayed at `$158/@390/%390`.
  Exact callbacks and addressed delivery passed both ways. Receipt/digest는 `DELIVERY.md`가 진다.
- **보존된 pre-amendment LIVE (2026-09-11, Codex 0.153.4):** loaded-thread native-push,
  public MCP send, authenticated request identity, isolated source-birth/title 변경은 관측됐다.
  현재 amendment가 그 영수증으로 qualification됐다는 뜻은 아니다.
- **Oracle/release stop:** home LIVE는 닫혔다. 이제 `check-gate-qualification`과 frozen
  `pnpm run check:full`을 같은 candidate에서 통과하고 구현 커밋/#95 closure로 간다. 이후 명시적으로
  승인된 release prepare가 `0.20.2` version/changelog를 만든다. Codex는 그 경계가 끝날 때까지
  unreleased candidate이며 push/tag/publish는 별도 승인 전 금지다.

<details><summary>ACP fable 지원 NOW (닫힘)</summary>

# NOW — stem: ACP `claude-fable-5-1` 지원 (GLG, 2026-09-08: "entwurf acp fable 지원을 넣어줘. 그래야 계속 부를 수 있어")

- **Stem:** **`claude-fable-5-1` 을 curated ACP 모델 표면에 싣는다.** GLG 가 B 를 그 모델로 이미 불렀고(`entwurf/claude-fable-5-1`,
  garden `20260908T181437-30802a`, `backend=pi`, `liveness=alive`), 계속 부를 수 있게 표면·게이트·문서를 정합화하는 것이 이 stem 이다.
  **당분간 루프는 직접 만들어 쓴다 — openclaw 로 가는 길은 멀다(GLG 결정).**
- **좌표:** `main` = `origin/main` = **`9816618`**(푸시·도장 완료, 릴리즈 아님 — 버전 범프 없음). 이 stem 의 변경은 `models.ts`(GLG 손) · `check-acp-provider-surface`(6→7, GLG 손)
  · **`run.sh` pack-install 정확-집합 핀(내가 채운 구멍 — `check:full`/`prepublishOnly` 소속이라 다음 릴리즈에서 붉었을 것)**
  · **claim 둘**(`CORTEX-PROVIDER-SIX-ROW-SURFACE` → `…EXACT-ROW-SURFACE` 개명, `CLAUDE-CURATED-THREE-ROWS` 신설 + 뮤턴트 1개)
  · 인벤토리 `acp-cortex` 12→13, 총 **386 → 387** · README·`docs/acp-backend-rail.md:200`·CHANGELOG.
  열린 이슈 8 — 구현 5/5(97·78·76·106·108), research 3(95·88·107). **#109 닫으며 상한 복귀.**
  **갱신 2026-09-08 22:xx:** #97·#106 CLOSED NOT_PLANNED, #110 OPEN(개발환경 결함, 사용자층 축 안 막음 — sorge·코디네이터 재측정 `npm pack --dry-run` 에 `.pi/` 0건). 구현 5/5 = #110 #108 #95 #78 #76 · research #107 #88 · OPEN 7/10. 다음 값싼 칸 후보: #95(codex 0.147 raw probe 재측정).
- **랜딩 영수증 (oracle, 2026-09-08):** `check-gate-qualification` **387/387 KILLED** exit 0(40m, 뮤턴트 매니페스트 공백 재포맷 직전 candidate — claim/subject/find/replace 바이트 동일) ·
  `pnpm run check:full` exit 0 **452s**(커밋된 candidate) · `check-pack-install` 단독 exit 0(`exact curated set: claude 3 + cortex 4`) ·
  **exact-SHA CI PASS** run [`34215718330`](https://github.com/junghan0611/entwurf/actions/runs/34215718330) `event=push`, 3잡 전부 success,
  **`check` 잡의 `Run ./run.sh check-gate-qualification` 스텝 success**(표면을 건드렸으므로 `ci-qualify-decide` 가 본체를 켰다).
- **#109 가 남긴 것 (닫혔지만 버려지지 않는다):** 컨테이너 축 여섯 판독 + openclaw SDK 삼중 잠금 argv 는 이슈 스레드가 정본이다.
  **호스트 축 결함 다섯**은 openclaw 와 무관하게 남아 있다 — `entwurf_self` 의 connect-프로브 없는 `existsSync` 거짓 양성
  (`mcp/entwurf-bridge/src/index.ts:231-234`) · listing 의 relative transcript resolve(`entwurf-peer-observe.ts:67`) ·
  `kill(pid,0)` 만으로 lock 훔치기(`entwurf-v2-lock.ts:138-151`) · fresh-cut/`gcStaleSockets` 파괴적 ·
  **게이트가 거짓 문장을 지킨다**(`resume-launch-identity.ts:11` "no consumer" ↔ 게이트 `:238` + 뮤턴트 `RESUME-ID-GATE-SSOT`).
- **U5(pid-ns 제3 상태)는 설계만 깎여 있다 — 착수 안 함.** 계약 구멍은 실재하지만 급한 소비자가 없다("실제 결함, 현재 소비자 없음").
  설계 정본은 #109 댓글: frozen 전부 동결 · `receiver`/`transcript` 에 `unverifiable` · marker 리더를 `classifyMarkerOwner` 로 관통 ·
  composite `(bootId,pidNsInode,mountNsInode)` 매 읽기 계산 · matrix 9→10행 · 확정 MUTANT-STALE 1건(`RESUME-ID-MISSING-TRANSCRIPT-CAUSE`).
- **버그픽스 후보 (0.19.0 이 남긴 것):**
  1. **같은 결함 등급이 정적으로 금지되지 않는다.** `pipefail` + 조기 종료 grep + 큰 생산자. 인스턴스 셋은 고쳤지만
     규칙은 `smoke-omp-mcp-state.sh:91` 주석 한 줄에 갇혀 있다. tripwire 를 둘지는 GLG 판단 — 그 자체가 또 검증 기계다.
  2. **#108 placement 이 실 MCP wire 를 지나는 자동 증거가 없다.** `smoke-mux-lifecycle-live` 의 `tools/call` 셀에
     `placement` 를 실으면 되고, 그건 이미 release MUST 라 새 LIVE 비용 0.
  3. **codex 핀 범프** (`smoke-meta-async-drift` drift=1) · **#98 P4 관측창 승격 결정** · **#94 잔여 관측 둘** ·
     별건 마이그레이션 둘(`lastDeliveredAt` 제거, `stampMailboxReceipt` 2-writer lost-update).
- **Blocker:** 없음.
- **Read:** CHANGELOG `## Unreleased`(이 stem 의 정본) · #109 스레드(컨테이너 축 판독 + U5 설계) ·
  `models.ts:52-60` 의 "verify across both axes" 커미트먼트.
- **Do not touch:** curated 집합을 게이트 없이 늘리는 것(`run.sh` pack-install 핀과 `check-acp-provider-surface` 카운트가 함께 움직여야 한다) ·
  `CURATED_ANCHOR_MODEL_ID`(=`claude-opus-5`) 변경 · openclaw 벤더 패치·provider 주입(#109 제약, 유보된 레인) ·
  tmux 소켓 마운트 · v2 frozen reject enum · 0.16.1 make 섞기.
- **이번 컷이 새로 가르쳐 준 것 셋:**
  1. **배선이 멀쩡한데 MUST 가 붉을 수 있다.** `smoke-mux-lifecycle-live` 가 00:00 과 01:04 에 두 번 붉었는데, 형제가 프롬프트를
     읽고 콜백 대신 **GLG 에게 자라고 권했다**. 낮 첫 시도에 초록. 프롬프트를 고치지 않았다 — 지금 모델 습관에 제품을 맞추면
     그 비틀림이 습관보다 오래 산다. VERIFY 의 "도구를 알려주는 게이트는 실패가 우리 몫" 규칙에 측정된 예외가 생겼다.
  2. **저메모리 워치독은 실재하고 tmux 는 그걸 피한다.** 이 컷 하나에서 백그라운드 도구 호출이 **세 번** 죽었고(available 6.5Gi,
     커널 OOM 없음) tmux 게이트는 매번 살아남았다. "긴 명령은 tmux" 가 취향이 아닌 이유.
  3. **기존 뮤턴트의 앵커를 깨뜨리면 자격검증이 먼저 잡는다.** 닥터 한 줄을 고치자 `OMP-DOCTOR-CARRIER-TRIMS` 가 `MUTANT-STALE`
     이 됐고 첫 컷이 거기서 멈췄다. 소스를 고칠 때 **그 줄에 앵커를 건 기존 replant 를 함께 본다** — 새 것만 챙기면 반만 지킨 것이다.


</details>

<details><summary>0.19.0 착지 NOW (닫힘)</summary>

## Archived NOW — v0.19.0 전부 닫힘

### 원래 NOW — #105 ① 착지 → 0.19.0 릴리즈 lane (GLG: "main 올리고 배포 준비는 꼼꼼하게")

- **Stem:** 0.19.0 = #105 ① placement. minor 인 이유: `entwurf_fresh_call` 스키마에 optional `placement` 가 생기고 `closeWindow`
  계약이 서버 바인딩으로 바뀐다(호출자 호환, 세 surface 동시).
- **좌표:** `main` = `origin/main` = `7a6778c` + 브랜치 `feat/105-placement` 3 commit(`a39b637` feat · `5a6c21c` docs · NEXT 닫기).
  fast-forward 가능. 열린 이슈 6(구현 97·78·76·105 = 4/5, research 95·88) — #105 는 머지 SHA 로 close.
- **Next:** (1) `entwurf-release land` — L0 clean·non-diverged main, L1 push, L2 도장, L3 `verify-exact-ci.sh <SHA> wait`(이 push 는
  mutants/gates 를 건드렸으므로 `ci-qualify-decide` 가 본체를 켜야 한다; skipped 면 dispatch 복구) (2) `prepare 0.19.0` — CHANGELOG
  `## Unreleased` 는 비어 있다; 0.19.0 절 재료는 `a39b637`·`5a6c21c` 본문 + 아래 CARRIED 관측(AGENTS augment cap, MCP description cap)
  · version/lockfile · `check:full` · `LIVE=1 release-gate <scratch> --cut`(MUST 에 `smoke-mux-lifecycle-live` 포함 — 이 lane 이
  안 돌린 유일한 mux LIVE; `requireSameServer` 전환의 same-session 경로가 여기서 처음 실 검증된다) · on-demand
  `smoke-mux-fresh-call-live` 는 `5a6c21c` 가 문서 전용이라 `a39b637` 의 39/39 가 유효 (3) `make` (4) `publish`.
- **Blocker:** 없음(permission: 각 모드 GLG 승인).
- **Read:** #105 스레드 댓글 2건 · `a39b637`/`5a6c21c` 본문 · `.agent-reports/105-research-20260907.md` · `docs/mux-launch-rail.md` §8·§11.
- **Do not touch:** `ifMissing`/`create`/`new-session` 을 제품에 되살리는 것(GLG 결정) · `isSameContext` 완화 · tmux 를 주소·liveness·delivery 로
  승격(Hard Rule 16) · `cwd` ↔ `tmuxSession` 상호 추론 · v2 frozen reject enum · 0.16.1 make 섞기.
- **이번 주 운영 규율(전부 실제로 당한 것):** 게이트 도는 동안 커밋 금지 · 긴 명령은 tmux(저메모리 워치독) · `check-install-surface` 는 git
  index 를 읽는다 · `entwurf-release/SKILL.md` 만 ASCII 전용 · `entwurf setup` 을 LIVE 전에 · codex 레일 셋이 한꺼번에 죽으면 `quota` 먼저 ·
  형제에게 가는 사실 문장엔 증거 상태 · 독립 검수(sol 코드 / grok 문서·오독 테스트) 패턴 유지 · **frozen 중 untracked `dist/` stale 로
  `check-bridge-delivery` 가 붉을 수 있다 — `build-bridge` 재빌드는 candidate 를 안 바꾼다** · 첫 qualification 이 CONTROL-RED 면 원인
  게이트를 먼저 본다(`pnpm check` 에 없는 hermetic 게이트일 수 있다).


</details>

<details><summary>0.18.1 착지 NOW (닫힘 — #103 이월 관측은 이 안에 남는다)</summary>

## Archived NOW — v0.18.1 전부 닫힘 (npm 발행 + 레지스트리 integrity 대조 완료)

- **Stem:** 없다. 이 릴리즈 레인은 발행까지 전부 닫혔다. 다음 stem 은 GLG 가 고른다.
- **좌표:** `v0.18.1` @ `cabecf6` — 태그·GitHub 릴리즈·npm `latest` 가 전부 그 지점이다.
  그 뒤 `main` 에 쌓인 것은 NEXT 갱신 커밋 둘(`f01dc1e` + 이 integrity 영수증 커밋)뿐 —
  코드 변경 0 이라 릴리즈된 바이트와 어긋나지 않는다.
  릴리즈 https://github.com/junghan0611/entwurf/releases/tag/v0.18.1
- **integrity 영수증 (2026-09-06 oracle 측정, 발행 후 사후 증명):** 레지스트리 바이트 =
  수용 candidate 바이트, 세 해시 전부 일치 — sha512
  `sha512-CBHlaErNivPxXTHTc/yLXveEH+8/oZvQ4IET1LTpdKN8Jz9uFOYfkgpWcWc8f35uSznuVU2l8m+A0UFgBo9uNg==`
  (`dist.integrity` ≡ `openssl dgst -sha512 -binary | base64`), sha1
  `0605a979ac87c4f9494ead0118a3d9df268dbe0a` (`dist.shasum` ≡ `sha1sum`), sha256
  `e1f94b6855499098aca1bce081abe0472ea4711aa28746d7b182880ca7742603` (레지스트리 tarball 을
  내려받아 재계산 + `cmp` 바이트 동일, 12,495,520 bytes). dist-tags: `latest`=0.18.1,
  `repair`=0.12.8-repair.1 (발행이 건드리지 않은 레인 보존됨). 리팩은 없었다.
- **릴리즈 영수증 (전부 oracle, 2026-09-06):**
  - LIVE `release-gate --cut`: **MUST PASS=23 FAIL=0 SKIP=0**, BEHAVIOR 1/0/0, `cut: OK`,
    18:30:51→19:23:40 (52m49s). 그 안에서 qualification **369/369 KILLED**.
  - `smoke-acp-raw-turn-live` PASS — acp 범프의 지정 잠금. ROADMAP ledger ⑹ 에 실렸다.
  - `smoke-omp-fresh-live` 21 assertions + `smoke-omp-receive-live` — #91 센티널 둘 다 초록,
    **omp 18.0.0 위에서**(문서 weak floor 18.1.10 보다 낮다 — floor 는 허용이 아니라 증명의 기록).
  - prepared-HEAD CI `34027762637` 3잡 초록, candidate sha256
    `e1f94b6855…`, image `sha256:f1158c7f34cf…`, repoDigest `node@sha256:5711a0d445a1…`.
- **이 컷이 새로 가르쳐 준 것 두 가지:**
  1. **첫 `--cut` 은 우리 코드 때문이 아니라 codex 주간 쿼터 100% 로 막혔다.** codex 레일
     형제 셋(chain hop2 · mux pi-native · omp-fresh)이 태어나고 소켓까지 세우지만 턴을 못 돌아
     콜백/배달이 안 왔고, Claude 레일은 전부 초록이었다. **chain 스모크의 타임아웃 계측이
     이걸 읽히게 만들었다** — `terminus fixture at timeout: … alive=true watchArmed=true` 가
     mailbox 는 멀쩡했음을 증명해서 "미스터리"를 "판독"으로 바꿨다(#101 이월 관측 3번의
     계측이 실제로 값을 했다). GLG 가 쿠폰으로 초기화한 뒤 **코드 변경 0으로** 같은 게이트가 초록.
  2. **floor 를 올리면 우리 호스트가 먼저 비준수가 된다.** `entwurf setup` 이 `pi 0.84.4 is
     outside >=0.85.1 <0.86` 로 FAIL 하고 pi wiring 을 안 썼다 — 설계대로다(Hard Rule 17).
     GLG 가 `pi update` 하고 뜬 세션을 껐다. 그 경험이 CHANGELOG Upgrade note 의 3단계다.
- **미측정 (다음 레인으로):** 압축 `completed` 분기 · `usage-markdown.ts`(#1085) 소비 경로 ·
  `packages/chord` 내용물이 우리 표면에 닿는지. (레지스트리 integrity 대조는 위에서 측정돼 빠졌다.)
- **#103 이 남긴 이월 관측 (일 안 연다):**
  - **`smoke-omp-bridge-state` 는 호스트에 살아 있는 omp 프로세스를 스캔해 판정한다** → 뮤턴트
    control-pre/post 가 61초 사이 호스트 상태로 갈릴 수 있다 [측정 2026-09-07 oracle 1회:
    control-pre green → 뮤턴트 60.8s → control-post RED, 같은 셀이 clean tree 에서는 연속 2회
    exit 0]. 게이트 결정성 축이지만 **이슈는 만들지 않는다**(GLG 결정) — 필요해지면 그때.
  - 8f 의 fixture 커밋에 `-c commit.gpgsign=false` 를 더하면 전역 서명 설정이 있는 호스트에서 더
    안전하다 [측정: 이 호스트·CI 러너 모두 미설정 → 지금 red 위험 0].
  - 8d 는 경로마다 bash+python 을 새로 띄운다(약 70회). 인벤토리가 크게 자라면 묶는 최적화 후보.
  - PR 은 three-dot 으로 좁힐 수 있으나 안 한다(fail-open 5). 개행이 든 파일명은 line 기반
    matcher 를 우회하고, submodule 내부 subject 는 미지원.
  - `scripts/ci-qualify-decide.sh` 와 `scripts/fixtures/` 가 npm 패키지에 실린다(`files: scripts/`).
    `scripts/check-*` 선례와 같고 소비자 표면이 아니다.
- **Read:** CHANGELOG `## 0.18.1` Verification(두 컷 다 기록돼 있다) · ROADMAP
  **Dep bump(별도 트랙)** 2026-09-06 두 항목 · #102 종결 댓글의 CI 영수증.
- **Do not touch:** candidate 를 다시 pack 하는 것(수용된 바이트는 그 파일 하나다) ·
  `v0.18.1` 태그와 CHANGELOG 0.18.1 절 · 0.16.1 make 를 이 레인에 섞는 것.

</details>

<details><summary>0.18.0 착지 직후의 NOW (레인 닫힘 — 이월 관측은 여기 남는다)</summary>

## Archived NOW — 0.18.0 착지 후 (다음 stem 대기였던 자리)

- **Stem: 없다. GLG가 고른다.** 0.18.0이 태그·GitHub 릴리즈·npm `latest`까지 전부 닫혔다
  (`v0.18.0` @ `2934807`, 2026-09-04). 이 리포에 지금 열려 있는 릴리즈 레인은 없다.
- **이 레인이 실은 것:** `fix/101-session-switch` 커밋 7개(`3ca8220 → 5763bfa`). 한 pid 안에서 세션을 갈아타면 처음 열렸던 빈 세션이 계속 "살아있는
  형제"로 등록돼 있어 편지가 허공으로 갔다 — 그 유령을 은퇴시키고, 배달 가능 판정을 "지금도 그
  주소를 듣고 있는가"로 좁히고, 거절이 이유를 말하게 하고, 형제 목록에 `receiver=`/`transcript=`
  두 컬럼을 붙였다. 사람 말 정본은 **#101 종결 댓글**이다.
- **버전이 minor였던 이유:** `entwurf_peers` 줄의 컬럼 두 개와 거절 이유 문장은 **additive surface
  변경**이다. 제거도 의미 변경도 없으므로 patch가 아니라 minor.
- **Upgrade note (CHANGELOG에 실렸다, SSOT는 거기다):** 이 릴리즈는 `pi-extensions/lib/meta-session.ts`와 Claude 훅을
  바꾼다 → **네 install 경로**(`install-meta-bridge` / `install-omp-bridge` / `install-omp-receive` /
  `install-copilot-bridge`)의 배포 writer가 동시에 낡는다. **업그레이드 명령은 `entwurf setup` 하나**다.
  0.17.2에서 Claude 레일만 재설치했다가 첫 `--cut`이 `smoke-omp-receive-live`로 BLOCKED된 그 교훈
  그대로이며, CHANGELOG 0.17.2 Upgrade note가 그 SSOT다.
- **이 레인은 닫혔다.** 다음 stem은 GLG가 고른다. 남아 있던 후보는 여전히 유효하다 — codex 핀
  범프(`smoke-meta-async-drift` drift=1), 0.16.1 make(prepare 끝, make만 대기), #98 P4 관측창
  승격 결정, #94 잔여 관측 둘, 별건 마이그레이션 둘(`lastDeliveredAt` 제거,
  `stampMailboxReceipt` 2-writer lost-update).
- **이월 관측 (#101이 남긴 것 — 수정이 아니라 다음 레인 재료):**
  1. **omp-host 후보 조건 하나 더.** sender↔receiver 교차검증은 지금 `ownerKind = claude-code-cli`로
     스코프된다. OMP `unarm`의 marker 삭제 실패는 catch 후 진행하고
     (`meta-bridge-receive-omp.ts:610-636`) omp에는 reader-side join이 없어 방어막이 writer 하나뿐이다.
     lane을 넓히려면 이 비대칭부터 측정한다. Copilot은 구조적으로 제외다 — receiver marker owner가
     포크된 확장 자식의 pid이고 sender marker는 CLI의 ppid라 영구 `mailbox-undeliverable`이 된다.
  2. **observe seam footgun.** custom `metaEntries`를 주면서 observer를 주입하지 않으면 기본
     관측자가 다른 루트를 stat한다. 새 caller/gate는 `observe` 주입이 규율이고, 이유는 provider
     헤더에 있다.
  3. **원인 미상 1건 — 열린 채로 둔다.** `smoke-entwurf-chain-live` 1회가 hop3에서
     `rejected: mailbox-undeliverable (observed liveness: unsupported)`로 실패했다
     (2026-09-04 16:58 KST). 앞뒤 두 번은 통과, 재현 안 됨. start-key 레이스와 idle owner 조기
     종료는 측정으로 배제됐고, OOM 가설은 저널에 근거가 없다(Fable 측정: journalctl 16:50–17:02에
     OOM/kill 줄 없음, systemd-oomd kill 기록 없음, earlyoom 비활성). 다음 발생 때 갈라줄 자리는
     체인 시작 전 fixture 단언과 `terminus fixture at timeout: ownerPid=… alive=… ownerAlive=…
     watchArmed=…` 줄이며, 그 계측은 `f4dbe32`·`69bee12`로 이미 들어가 있다.
     **리드 하나 (영수증 아님, 2026-09-04 릴리즈 레인에서 나옴):** Claude Code 하네스의
     **저메모리 워치독**이 커널 OOM과 무관하게 백그라운드 도구 호출을 죽인다 — 릴리즈 담당
     세션에서 `Background command … was stopped because the system is running low on memory`,
     직후 `free -h` **available 13Gi**, 저널에 OOM/kill 0건. Fable 세션(dbf654)도 같은 날 같은
     문구로 두 건, 직후 available **12996 MB**. 저널에 흔적이 없는 경로가 커널이 아니라
     워치독이라면 위의 OOM 반증 측정은 전부 참이면서도 다른 킬러를 본 것이 된다.
     **미측정:** 그 chain-live가 백그라운드 도구 호출 안에서 돌았는지, 워치독이 실제로 idle
     owner를 골랐는지. 확인하려면 그 세션의 killed-task 알림 유무를 본다.
- **#99로 넘길 재료:** claude 훅에 처음 생긴 뮤턴트 lane(17 claim)과, "전수 뮤턴트를 언제 돌릴
  것인가"의 실측 — 오늘 전체 바닥 **완주 5회 / 3회**, 한 번에 약 35분. 대부분이 산문 수정 뒤
  재검증이었다. 수치 정본은 #101 종결 댓글 §비용.
- **이번 컷이 남긴 운영 교훈 (반복 방지, 전부 이번에 실제로 당한 것):**
  1. **릴리즈 게이트가 도는 동안 커밋을 만들지 않는다.** 첫 `--cut`이 50분을 쓰고
     `origin HEAD changed during qualification`으로 무효화됐다 — 게이트 중간에 온 커밋 요청을
     즉시 처리한 결과다. 워킹트리 편집은 무해하고, HEAD 이동만 치명적이다. 규율은
     `entwurf-release` 스킬 P5에 박아뒀다.
  2. **`.claude/skills/entwurf-release/SKILL.md`는 ASCII 전용이다.** `check-install-surface`의
     S7e가 `skillIsAscii`로 전 코드포인트 ≤127을 요구한다(`scripts/check-install-surface.ts:494`).
     그 스킬에 한글이나 em dash(—)를 한 글자라도 넣으면 `check:full`이 exit 1이다. 이번에
     실제로 그랬다 — Fable의 지시 문장을 그대로 옮겨 적다가 em dash 두 개가 들어갔고, prep 커밋을
     amend해서 고쳤다(`dea16d5` → `2934807`). **규율 한 줄을 추가하는 일조차 게이트를 깬다.**
  3. **그 게이트는 워킹트리가 아니라 git index를 읽는다.** `readCandidate`가
     `git show :<file>`이다(`check-install-surface.ts:436-445`). 파일만 고치고 재실행하면
     영원히 빨간 것처럼 보인다 — `git add` 후에 다시 돌려야 한다.
  4. **`entwurf setup`을 LIVE 게이트 **전에** 돌린다.** 게이트 직전 doctor 4종을 쳤더니 셋이
     STALE이었다(`installed=dd9df442d945 vs source=796aa7630133`). 0.17.2가 첫 `--cut`을
     `smoke-omp-receive-live`로 날린 그 축이고, 이번엔 50분을 쓰기 전에 잡았다.
  5. **긴 명령은 tmux로.** 이 하네스의 저메모리 워치독이 백그라운드 도구 호출을 죽인다 — LIVE
     게이트 1회를 그렇게 잃었다. tmux 세션은 그 밖이라 끝까지 간다.
- **Read:** #101 종결 댓글(사람 말 정본) · `scripts/raw-claude-session-switch/README.md`
  (S1–S6 훅 로그 verbatim, UPS native id 8/8) · `entwurf-release` 스킬.
- **Do not touch:** 0.17.0/0.17.1/0.17.2 태그와 그 CHANGELOG 절 ·
  `mux-launch.ts`/`mux-placement.ts` import fence ·
  이 호스트의 `~/.pi/agent/meta-mailbox/20260904T093135-ac7a1a/` 편지·표식·기록(#101 재현 증거) ·
  `source` 값에 분기하는 로직(로그로만 남긴다 — 호스트 독립성이 이유다).

</details>

<details><summary>0.17.1의 원래 NOW (C1b 원인 닫힘 — 태그·GH 릴리즈 완료, npm 미발행)</summary>

## Archived NOW — 0.17.1: C1b 원인을 닫고 npm까지

- **Stem:** 0.17.0은 태그까지 갔지만 세 번의 재컷이 `cut: BLOCKED`였고 npm에 오르지 않았다.
  0.17.1은 그 BLOCKED의 원인을 **측정으로 닫고** 처음으로 0.17선을 레지스트리에 올린다.
- **지금 서 있는 자리:** `main` = `665191d`, origin과 동일, exact-SHA CI 3잡 초록
  (run 33697821117 — `check` 34m20s, `install-surface`, `artifact-consumer`).
  릴리즈 범위는 두 커밋이다: `a3563bc`(진단) → `665191d`(원인 수리).
- **닫힌 원인 (C1b).** 스모크가 pi의 락 stale 창과 **정확히 같은 값**을 기다리다 148ms 차이로
  졌다. pi는 `auth.json`/`models-store.json`을 `proper-lockfile`로 잠그고 모든 boot이 그 락을
  거쳐 읽는다(`dist/core/auth-storage.js`, `staleMs = 30_000`). `terminateChild`의 SIGTERM은
  release가 돌기 전에 프로세스를 끝내므로 그 창에 들어간 kill이 락을 고아로 남긴다(kill 오프셋
  24개를 훑어 +375ms에서 재현). 고아 락 상태의 boot→record는 **30,148ms**, 인수 직후 같은 조건은
  **1,114ms**. `BOOT_TIMEOUT_MS = 30_000`은 레코드가 태어나기 148ms 전에 보기를 그만둔다.
  두 실패 컷 모두 호스트 audit 로그가 "자식은 30초 내내 살아 있었다"를 확증한다.
  통제군은 같은 세 런 안에 있었다 — `smoke-entwurf-chain-live`는 같은 2-레지던트 구조에
  `45_000`이고 3/3 PASS였다.
- **수리.** `PI_BOOT_TIMEOUT_MS = 45_000`이 측정 영수증과 함께
  `scripts/lib/pi-record-discovery.ts`에 있고, 30초 절벽에 앉아 있던 다섯 스모크가 전부 거기서
  파생한다. `describePiLockResidue()`는 실패 시점의 pi 락을 이름으로 찍되 **읽기만** 한다 —
  고아와 산 홀더는 바깥에서 구별되지 않고, 중재는 pi 자신의 stale 프로토콜 몫이다.
  제품 레일(birth/mux-launch)은 건드리지 않았다. 스모크 bound가 수리였다.
- **정정 하나 (기록으로 남긴다).** 조사 중간 보고는 "30→45는 실측으로 반증됐다"고 썼다. idle
  boot 1.1s만 보고 여유 25배로 읽은 것인데, 실패는 느린 boot이 아니라 30초짜리 락 대기였고
  bound가 하필 그 창과 같은 값이었다. 반증된 것은 "부하로 느려진다"이지 bound 자체가 아니었다.
- **아직 열린 것:** mux pi-native nonce 300s는 **이 버그가 아니다**(창의 10배이고, 같은 런에서
  코덱스 레일은 chain-live·omp-fresh로 건강했다). 이번에 들어간 pane forensics —
  pane pid 생존 · `list-panes` · `capture-pane` 마지막 40줄 — 이 다음 발생 때 답한다.
- **초록 컷 (0.17.0이 세 번 못 받은 것).** `LIVE=1 ./run.sh release-gate
  /tmp/entwurf-release-gate-0.17.1.hb5Q5j --cut` — **MUST PASS=23 FAIL=0 SKIP=0**, BEHAVIOR PASS=1,
  exit 0, `cut: OK`. 2026-09-03 09:46:37 → 10:35:42 KST, `665191d` 위. qualification 347/347 KILLED,
  `check:full` 451s. **막았던 두 셀이 같은 런에서 함께 통과했다** — matrix-live C1b, mux-lifecycle
  pi-native nonce.
- **Next:** `entwurf-release make 0.17.1` → `publish 0.17.1 <candidate.tgz> latest`.
  npm에 0.17.0은 없으므로 이 publish가 0.17선의 첫 `latest`다.
- **Read:** CHANGELOG `## 0.17.1` Verification(재현 조건과 수치) · `scripts/lib/pi-record-discovery.ts`
  의 `PI_BOOT_TIMEOUT_MS` 주석 · CHANGELOG 0.17.0의 세 BLOCKED 컷 기록(그 자리에 그대로 둔다).
- **Do not touch:** 0.17.0 태그(`v0.17.0` @ `934acb9`) · CHANGELOG 0.17.0 절 · 제품 레일을 이
  레인에 섞는 것 · `mux-launch.ts`/`mux-placement.ts` import fence · 0.16.1 make를 이 레인에
  섞는 것 · #92를 구현 이슈로 취급하는 것.

</details>

<details><summary>OMP 레인의 직전 NOW (0.16.1 make 대기 — 열린 채 보류)</summary>


- **Stem:** OMP TUI 하나를 독립 형제로 세우되, 그 안의 서브에이전트에는 garden id를 주지 않는다.
- **이제 되는 것 (측정, 2026-08-30 oracle, omp 18.0.0):** OMP TUI가 열리면 citizen 하나를 mint하고, 상태줄에 garden id를 보이고, 자기 이름으로 보내고, **다른 harness의 메시지를 받는다.** idle 세션이 타이핑 0회로 깨어나 `entwurf_inbox_read`로 스스로 드레인하고 같은 native 세션에서 답한다. `/new`는 옛 시민의 doorbell을 회수하고 새 시민에게 arm한다. task subagent는 여전히 아무것도 mint·arm하지 않는다.
- **C에서 새로 되는 것:** `entwurf_fresh_call(backend=omp)`이 세 public surface 전부에서 열린다 — bare `omp` runtime, **positional prompt 없는 two-stage bootstrap**(고정 등록 플래그 `--entwurf-bootstrap`이 `{v,target,nonce,task}`를 나르고, 설치된 birth 확장이 callback tool이 실제로 부를 수 있게 된 뒤 callback-only 프롬프트를 보낸 다음 성공한 `tool_result`를 보고서야 다음 `turn_end`에 task를 넘긴다) + 명시적 `--approval-mode yolo`, callback tool `mcp__entwurf_bridge_entwurf_v`, 그리고 **5축** pre-mutation preflight(다섯째는 omp 고유의 `tools.xdev !== true`). launch seam에서 `PI_SESSION_ID`/`PI_AGENT_ID`를 scrub한다(모든 backend). positional은 선택이 아니라 측정 결과다 — `[LIVE 2026-08-30]` positional 후보는 도구가 존재하기 ~830ms 전에 턴을 시작해 `ACK`만 답했다.
- **아직 안 되는 것:** clause 7 LIVE는 green이지만 **한 번, 한 호스트, 한 모델**이다. multi-host·multi-model·반복 fresh는 증거가 없고, 그 한계는 CHANGELOG Notes에 그대로 적혀 있다. closure review·qualification·full floor는 닫혔다(`153f9f4`, `fd5e462`). 남은 미지는 릴리즈 축뿐이다 — 버전 트리 위의 `LIVE=1 ./run.sh release-gate <scratch> --cut` 집계와 릴리즈 커밋 정확 SHA의 CI 3잡(`check`·`install-surface`·`artifact-consumer`).
- **새 일반 규칙 (C가 만든 것):** 새 하네스는 branch에서 partial evidence가 가능하지만, release package는 step 9까지 닫혀야 한다. unsupported 표기는 partial-release 허가가 아니다. deterministic 반쪽은 `check-harness-admission-parity`(check:full), LIVE 반쪽은 첫 release의 clause 7 MUST step. Copilot의 기존 operator-metered exclusion은 소급 재설계하지 않는다.
- **운영자 필수 설정 — 이제 손으로 넣지 않는다:** `~/.omp/agent/config.yml`의 `tools: xdev: false`는 `entwurf setup`이 `omp-config` 유닛으로 쓴다. 기본값에서는 doorbell이 모델이 부를 수 없는 도구를 알리게 되고, LIVE 스모크가 이걸 선행 조건으로 검사한다. 운영자가 **명시적으로** `xdev: true`를 적어 뒀다면 그건 결정이지 drift가 아니므로 writer가 덮지 않고 이름을 불러 거부하고, setup은 그것을 component FAIL로 세운다.
- **`config.yml` 리더 결함 하나 (측정, 2026-08-31 thinkpad):** 벤더 자신의 settings writer가 쓰는 `modelRoles:` + 들여쓴 `{}` 형태를 `scripts/omp-tool-surface.py`가 파일 전체 `unreadable`로 읽어 `doctor-omp-mcp`가 `tools.xdev`와 무관한 이유로 RED였다. flow collection을 값 자리와 자식 블록 자리 양쪽에서 파싱하도록 고쳤다. TS 리더(`readOmpConfigFlag`)는 원래 정상이었으므로 fresh preflight는 영향이 없었다 — 두 리더의 **합치**만 보는 셀은 이 결함을 영원히 통과시킨다(둘 다 unreadable/true를 "not false"로 접기 때문). 그래서 `[QK:OMP-XDEV-VENDOR-SHAPE-READABLE]` 직접 단언을 넣었다.
- **Copilot 1.0.81 행 문법 (측정, 같은 호스트):** `copilot plugin list`가 `(v0.1.0) (enabled)` + 들여쓴 `from <path>`를 찍게 바뀌어 버전이 `0.1.0) (enabled`로 읽혔고, 멀쩡히 설치·enabled인 호스트에서 `setup`이 `copilot-birth: FAIL`을 냈다. 상태 토큰 하나만 정확히 허용하도록 문법을 넓혔다.
- **컷 게이트는 이제 실제 왕복을 요구한다:** `smoke-omp-receive-live`가 registry를 읽고 `self-fetch`를 보면 더 이상 SKIP하지 않는다 — `LIVE=1`에서 실제 tmux omp TUI를 띄우고 11개 단언을 요구한다. 하드코딩된 통과가 아니다.
- **Next:** (1) **0.16.1 make** — prepare는 끝났다(CHANGELOG 승격·`0.16.1`·lockfile 무변경). `LIVE=1 ./run.sh release-gate <scratch> --cut`의 실측 MUST/BEHAVIOR 수치를 릴리즈 절에 적고, 그 다음이 `entwurf-release make 0.16.1`(push·tag·GitHub release — 모드별 GLG 승인). (2) **cross-harness leg의 deterministic 반쪽 배선** — post-contract 시민 backend마다 cross-harness LIVE step이 wired거나 선언된 metered 예외인지 `check-harness-admission-parity` 옆에 검사(규칙은 `docs/adding-a-harness.md` release stop에 박혀 있고, 게이트가 없는 동안은 prose다 — 별도 grant). (3) **#72 후속 둘** — between-turns 공지(`backend.ts`의 `previous … ended between turns`)에 `launchObservation`을 싣기(턴 사이에 외부 TERM이 오면 지금은 exit 0만 보인다, 한 줄 수리), 그리고 **reaper 수리는 openclaw 레인** — 청소기가 자기 것만 죽이도록 positive own-marker(`/proc/<pid>/environ` 또는 자기 pid registry)로 좁히는 게 primary이고, 우리 launcher는 defense-in-depth다. 이름 분리의 대가도 기록됐다: 이제 호스트 청소기는 entwurf의 **진짜** leak도 못 본다 — 그 cleanup은 entwurf가 소유한다.
- **Read:** #87 thread · `scripts/raw-omp-measure/README.md` §M7 (수용의 근거가 된 5셀 측정) · `docs/setup-clean-host.md` §4b · `docs/adding-a-harness.md` step 7.
- **Do not touch:** `mux-launch.ts`/`mux-placement.ts`(import fence) · omp용 managed launcher shell(근거 없음) · registry `supported` 필드(새 authority 금지) · #76/#78 · #87/#89 close. (Pi 0.84.4는 2026-09-01에 해제되어 랜딩됐다 — `5c1bda5`.)


</details>

# RECENT

- **2026-09-01 (ACP 메인 레일 판정, oracle):** GLG의 질문 "ACP로 클로드를 쓰면 손해 보나"가 세 번 재정의되며 깊어졌고, 마지막 형태는 **"400–500k 깊이에서 턴이 견고하게 유지되는가"**였다. 세 감사자(glm-5.3 · gpt-5.6-sol · kimi-k3)가 붙어 **근거 여섯 개를 회수**했다 — 그중 넷이 내 것이다. 남은 판정: 정상 reuse 구간에서 ACP와 네이티브는 **구분되지 않고**(같은 리포 통제 비교), 깊이 내구성은 **양 레일 모두 확보**돼 있으며(API 에러 턴 NATIVE 0.05% vs ACP 0.00%), 주 변수는 레일이 아니라 **사용 연속성**이다. 라이브 코디네이터가 관측 최대치 `415,541`을 돌파해(→ 475k+, resets 0) "그 값은 #72의 외부 janitor가 끊은 지점"이라는 의심을 반증했다. 같은 시각 네이티브 코더는 574k에서 리셋 0으로 돌았다 — "append-only는 ACP의 구조적 이점"이라는 프레이밍은 그 앞에서 계속 약하다. 가장 값진 것은 결론이 아니라 **공유 맹점**이었다: "compact 마커 양 레일 전수 0개"는 네이티브 **1,796파일 중 3파일**만 보고 쓴 것이었고, 두 세션이 그걸 함께 통과시켰다. 제3 감사자를 부른 이유가 정확히 그것이다. 이슈 큐 규율도 이 세션에서 두 상한(총 10 / 구현 5)으로 갈렸다.

- **2026-09-01 (#72 닫힘, oracle):** 여덟 달 서 있던 "ACP Claude child가 tool-loop 중간에 죽는다"가 **entwurf 결함이 아니었음**이 측정으로 닫혔다. 아무도 열지 않았던 아티팩트 하나 — 호스트 자신의 systemd user journal — 가 답이었고, 연결 고리는 처음부터 서명 안에 있었다: `(node:<pid>)`는 node `emitWarning`이 찍는 그 프로세스 자신의 pid다. 세 번의 진단이 주범으로 지목했다가 반례로 폐기한 그 경고 줄이, 내내 범인의 pid를 달고 있었다. 형제 둘이 붙어 각각 내 결론을 한 번씩 깼다 — GPT-5.6-terra는 "막을 수 없고 감별만 가능하다"를 launch shim으로 반증했고(시그널을 막는 게 아니라 **이름 매칭에서 빠지는** 층), Claude Fable 5는 프레임 필터가 개행 없는 마지막 말을 삼키는 회귀를 확정하고 live receipt를 만들었다. 이슈 코멘트 3건(진단·pid addendum·독립 검토)과 영수증 디렉터리가 남았다.

- **2026-08-31 (릴리즈 준비):** closure review 잔여가 닫히고(`153f9f4`) 첫 standalone qualification이 Bundle C 바이트 위에서 manifest 부채 네 갈래를 측정으로 정산했다(`fd5e462` — 324/324 KILLED, `check:full` exit 0 430s). cross-harness leg는 규칙과 첫 영수증을 함께 얻었고(`07349bd`, claude-code ↔ omp 양방향 live turn), 다섯 backend 비교표가 admission 문서 머리에 섰다(`7828bbc`). 업스트림 0.84.4 공개로 `check-pack-install`의 lockfile 없는 임시 설치가 pi-telemetry를 띄워 CI가 붉어졌고 transitive 핀으로 닫았다(`19ad90c`). CHANGELOG `## Unreleased`는 구현 범위 `v0.15.1..19ad90c` 30커밋 전수로 채워졌고, 릴리즈-정합 산문 정리가 뒤따랐다.
- **2026-08-30 (Bundle C candidate):** visible fresh가 붙었고, 그와 함께 **GLG가 찾은 release 구멍이 exit code가 되었다.** 원인은 닫힌 parity loop 두 개 사이에 간선이 없었던 것 — registry↔citizens와 surfaces↔fresh set을 각각 지키는 게이트는 있었지만 두 상수를 함께 import하는 파일이 0개였고, 그래서 omp는 D6 시민이면서 fresh 불가인 채로 모든 게이트를 green으로 통과했다. `check-harness-admission-parity`가 그 간선이다(추가 직후 `Unaccounted: omp`로 실제 RED, C 완성 뒤 green). agreement 게이트(`check-omp-fresh-preflight`)는 첫 실행에서 내 config reader의 fail-OPEN 오독(`tools.nested.xdev`를 `tools.xdev`로 읽음)을 잡았다. tmux env 누수도 실측 — server env의 `PI_SESSION_ID`가 새 pane에 그대로 상속되어(`SID=[leaked-uuid]`) 형제의 bridge child가 남의 신원으로 집에 전화할 수 있었고, launch seam에서 scrub한다. B의 packaging 누락 1건도 함께 고쳤다(`pi/omp-receive/entwurf-receive-omp/package.json`이 `files[]`에 없어 installed package에서 `install-omp-receive`가 죽었다).
- **2026-08-30:** Bundle B candidate. GLM 독립 검수 결과 architecture blocker 0 / Defect 3, 그 amendment까지 반영했다 — 가장 무거운 것은 `onEdge`의 `cancelRetry()`가 ctx 없이 불려 **핸들만 버리고 벤더 타이머는 계속 돌던** 결함이다(겹치는 birth edge마다 고아 타이머 하나). 인자를 필수로 바꾸고 겹침 셀과 exact-once mutant로 고정했다. D5 5셀 LIVE probe가 벤더 wake 표면을 처음으로 실측했다 — `pi.sendUserMessage`는 factory에 있고(ctx 아님), idle에서 턴을 시작하며(+31ms), `ctx.setInterval`은 idle에서 돌고 취소는 `ctx.clearTimer`뿐이다(`clearInterval` 없음 → `?.` 호출은 조용한 no-op). 확장 핸들러 순서가 디렉터리명 collation을 따르고, birth보다 먼저 도는 유닛은 sender marker를 못 본다는 것도 실측(20ms). D3 격리는 살아있는 omp 시민 2개로 증명 — Copilot 행이 아직 PENDING으로 두고 있는 셀이다.
- **2026-08-28 (오후):** oracle에서 Bundle A를 실제로 설치·배포·수용. stale writer 두 축(omp 확장, Claude shared reader)을 doctor가 잡아 재배포. LIVE outbound 4건, subagent zero-mint, inbound fail-closed 모두 재현. OMP `tools.xdev` 기본값이 MCP 도구를 `xd://`로 감싸 거짓 발신 보고를 만든다는 것을 벤더 바이너리·트랜스크립트로 측정하고 3개 문서에 반영.
- **2026-08-28 (오전):** #87 Bundle A source, package and doctor hardening reviewed independently; qualification and final deterministic floor were green on the final candidate.
- **2026-08-27:** OMP vendor measurement and real TUI/subagent observations closed the Bundle A admission basis.

# CARRIED

- **#78 물리 맥 영수증 — 아직 안 돌았다 (0.20.0 이 이 축을 열어둔 채 나갔다).** (1) 빌린 맥에서
  `sh scripts/raw-macos-measure/probe.sh` **한 번** — entwurf 설치도 로그인도 필요 없고, 수용 체크리스트 1–6 을 한 명령으로 닫는다.
  출력을 `scripts/raw-macos-measure/README.md` 의 `[host-darwin]` 절에 붙인다. (2) 그 영수증으로 7–9(설치·`doctor-meta-bridge`·
  실 배달 왕복)을 판단한다. 그 전까지 macOS 하네스 레일은 **NOT CERTIFIED — pending physical host** 이고, 그 등급을 CI 초록으로
  승격하지 마라(#78 본문: *"claim only what physical evidence proves"*).

- **AGENTS.md 가 ACP first-user augment 50KB cap 천장에 붙어 있다 (#105 lane 측정 2026-09-07).** HEAD `7a6778c` 기준 여유 932B,
  `a39b637` 뒤 316B(`buildPiContextAugment` claude, repo AGENTS + 12KB global baseline, `check-acp-carrier-augment`
  `[QK:AUGMENT-BUDGET-FITS]`). 그 게이트는 `check:hermetic` 소속이라 `pnpm check` 로는 안 보이고 full floor/qualification 에서 처음
  터진다 — AGENTS 한 문단 추가 lane 은 그 전까지 벽을 못 본다. 같은 계열: **MCP `entwurf_fresh_call` description 2028B/2048B(여유 20B)**.
  조치 후보(GLG 결정, 이슈 여부 포함): cap 상향 · AGENTS 감량 lane · core 에 값싼 budget tripwire.
- **#105 조사 lane 이월(②③ 착수 때 읽을 것):** ② retire — 제3자 receiver 마커 삭제 authority 불필요(죽은 소유자 마커는
  `readMetaReceiverMarker(verifyOwner)` 가 null, 측정 2건), 남은 어려움은 backend 별 소유 pid 비대칭(pi 는 pid 없음, antigravity 는
  receiver 마커 없음)과 사후 사실의 자리(sidecar `meta-events/<gid>.jsonl`, `.meta.json` 필터로 store 안 안전); acceptance "transcript
  byte-identical" 은 **레이스 의존**(Claude 2.1.263 이 종료 경로에서 `last-prompt` 한 줄 append, 2/2) → "신호 전 길이 N 의 `head -c N` 해시
  동일" 로; machine identity 는 `os.hostname()` + `entwurf-v2-lock.ts:119-120` seam, `~/.current-device` 는 load-bearing 금지.
  ③ remote — ROADMAP:216·853 fail-fast 유지, research. 운영 관측: foreground tool call 에 갇힌 pi 형제는 `mode:steer` 를 못 읽는다 ·
  doorbell 이 드레인된 편지를 중복 통지 · `resolve-tmux-session` 의 rc≠0 는 EACCES 류도 `missing` 으로 읽는다(두 번째 consumer 생기면 재분리).

- **`release_gate()` does not run `check-pack-install`** — measured 2026-09-06 while landing #104
  (`awk` over the function body: 0 hits; the gate is `prepublishOnly` + the CI install-surface
  job). That is how an OMP-absent fixture gap sat red on any omp-carrying host from 0.16.0 to
  0.18.0 without a single floor noticing. Whether the heavy gate belongs in the release MUST tier
  is an evidence-policy question, not this lane's — it sits beside #103, and it is recorded here
  rather than opened, because nothing about it is currently broken.

- **#78** macOS/native-Windows portability — separate grant; do not mix into #87.
- **#76** cortex gate slice — separate lane. (#72 is closed: `ca52fdd`.)
- **ACP 깊은-컨텍스트 내구성 — #92 CLOSED (2026-09-03), 관측만 이월.** thinkpad 코퍼스 1,022파일 전수로
  (a)가 두 번째 호스트에서 재현되고(peak `585,001`, 500k 초과 5세션 중 4개가 resets 0) 마지막까지 열려
  있던 (e) 갭 노출이 닫혔다 — ACP도 TTL 재작성을 지불하며 그 비율은 같은 호스트 네이티브와 구별되지
  않는다(1–2h 75% vs 85.6%, 2h+ 100% vs 80%). 구조적 우위는 warm(<5분) 구간뿐이고 거기서 29배
  (0.01% vs 0.29%). 깊은 ACP 리셋 29건 중 22건이 60분+ 유휴 직후, 7건은 아니며 그 7건은 전부
  2026-06-14 이전이다(원인 미측정). **열린 관측:** (f) pi 재시작 재구축 · (g) organic compaction 뒤
  의미·품질(recall probe) · `SessionModelLockedError` 미재현 · 585k–1M · 위 7건의 원인.
- **ACP 계측 — #96 CLOSED (2026-09-03), 캐리어 없이 대체 계측으로.** 업스트림 0.73.0도 왕복별 4분할을
  버린다(measured: `dist/acp-agent.js:3279-3284` 계산 → `:3286-3297` 스칼라만 emit, `_claude/usage` 없음).
  0.17.0이 `usage.acp` + `cache miss ≥Nk re-billed` 공지로 그 신호를 자체 확보했고, 남은 것은 TTL이 왕복
  사이에 만료될 때 bound가 약한 floor가 된다는 한계뿐이다(`backend.ts:1286-1288`). 계약은 산문이 아니라
  `scripts/mutants/acp-usage-accounting.json` 12뮤턴트가 지킨다. **agent-config 쪽 두 줄은 아직 고아다** —
  기본 pi 푸터로 복귀 금지, 캐리어 착지 시 `nocache` 가드 필요. 항구적 자리는 `glg-footer.ts` 헤더 주석.
- **컴팩션 소유권 반환 — #94, 커밋 `3bb0f9e`+`2f53a97` (푸시 전). 0.17.2에 실린다.**
  `autoCompactEnabled` / `env.DISABLE_AUTOCOMPACT`가 managed → retired로 옮겨졌다. 무엇을 왜는
  이슈 #94와 두 커밋이 진다.
  **prepare가 CHANGELOG로 올릴 것:** `env.DISABLE_AUTOCOMPACT`는 Claude 2.1.259에서 **no-op였다**
  (벤더가 읽는 이름은 밑줄 있는 `DISABLE_AUTO_COMPACT`/`DISABLE_COMPACT`, 우리 이름은 0회 등장).
  실제로 억제하던 것은 `autoCompactEnabled: false` 하나뿐이었다. 측정과 계보는 이슈 #94 §정정.
  **열린 후속 둘:** (a) `overlay.ts:29-33`의 `hooks:{}` LIVE 관측 1회 — 주석의 컴팩션 사유가
  `settingSources: []` 아래에서 stale일 가능성. (b) doctor가 retired NOTE를 화면에 못 보여준다
  (`meta-bridge-doctor.sh:121`이 stdout을 버린다) — 고치면 오라클 needle이 움직이므로 별건.
- **#98 딜리버리 투명성 — 커밋 `6306f93`(Phase 1 랩) + `c10b904`(Phase 2 제품), 푸시 전. 0.17.2에 실린다.**
  형제 우편이 도착하고 읽혔는데 사람 화면에는 `Stop hook feedback` 한 줄만 뜨던 것을 닫았다.
  무엇이 왜 들어갔는지는 두 커밋 메시지와 이슈 #98이 진다 — 여기서 되풀이하지 않는다.
  **Upgrade note (CHANGELOG 필수):** pull 뒤 **`install-meta-bridge` 1회**. 플러그인 템플릿에
  `rewakeSummary`/`rewakeMessage`가 생겨서, 안 하면 doctor가 `installed manifest DIFFERS … Re-run
  ./run.sh install-meta-bridge`로 빨개진다. 열린 Claude 세션은 옛 manifest를 캐시하므로 재시작
  전까지 옛 화면이다. oracle이 첫 대상.
  **열린 후속 둘:** (a) control-socket이 죽어 mailbox로 re-resolve된 `fallback-sent` 경로가
  `messagePath`를 버린다 — `entwurf-v2-send.ts:221`, `sendViaMailbox`의 반환에서 `success`만 읽는
  자리다. 발신자에겐 같은 우편인데 파일명이 없다. (같은 모양의 `:212`는 control-socket 재전송이라
  애초에 이름 붙일 파일이 없다 — 거기는 결함이 아니다.)
  (b) P4 관측창(`mailbox-watch.py`)의 제품 승격 여부는 GLG 결정 — `scripts/`로 옮겨 `run.sh`에
  넣거나, 랩에 둔 채 수동 실행.

  **별건 둘:** `lastDeliveredAt` 필드 제거는 마이그레이션이고(리더가 이중으로 엄격 + 매 도장마다
  재파싱, 온디스크 v1 180여 개), `stampMailboxReceipt`의 2-writer lost-update는 오늘 이미 있는 경합이다.
- **0.16.1 make** — prepare는 끝났고 make는 GLG 승인 대기. 오늘 요청 없었다.

# LEDGER — land 전에 정할 것

- **B에서 닫힌 것:** L1(두 state smoke가 `check:hermetic`에 편입, 이제 receive 짝까지 셋), L3(doctor가 `tools.xdev`를 읽고 LIVE 스모크도 선행 검사), L4(`entwurf_self`의 mailbox 렌더가 이제 참이다 — 드레인하는 프로세스가 실제로 있다).
- **B가 일부러 닫지 않은 것 (정직하게 기록):** event loop wedge 셀. marker는 "살아있는 소유자가 arm을 시도했다"까지만 뜻하며 watch 등록 ack이 아니다 — Claude 레일이 `meta-bridge-hook.ts:279-280`에서 같은 문장으로 이미 인정한 잔여 위험이고, OMP는 새로 만드는 게 아니라 물려받는다. 닫으려면 marker heartbeat + 리더 쪽 max-age가 필요하고 그건 claude·copilot 레일을 동시에 움직이므로 별도 이슈감이다.
- **런타임 extension reload/disable 셀은 미측정**이다. doctor 노트로만 남아 있다.

- **L2 CHANGELOG — 닫힘:** `## Unreleased`가 구현 범위 `v0.15.1..19ad90c` 30커밋 전수로 채워졌다(그중 `ec311a2`·`c3894be`·`7e45057`·`1143177` 4개는 v0.15.1 이후 이미 origin/main에 있던 것). 그 위에 쌓이는 릴리즈 준비 커밋은 이 30에 포함되지 않으므로, 범위를 다시 셀 때는 `v0.15.1..HEAD`가 아니라 이 끝점을 쓴다. 섹션 승격·버전 범프·release-gate 수치는 prepare 몫이고, Verification의 release-gate 줄은 일부러 빈 슬롯으로 남겼다. 이 리포의 릴리즈 도구는 CalVer `tag-release`가 아니라 SemVer `.claude/skills/entwurf-release`의 4모드다.
- **L5 claude 시민의 model 필드 — 답 나옴, 고치는 일만 남음 (#90 CLOSED):** 설치된 Claude Code **2.1.245**에서 우리 훅 stdin을 캡처한 결과, interactive `SessionStart` 봉투는 `model`을 **문자열**로 보낸다(`claude-opus-5[1m]`). print 모드(`claude -p`)는 아예 안 보낸다. 우리 리더(`meta-bridge-hook.ts:184-191`)가 객체 `.id`/`model_id`만 받아 그 문자열을 버리므로 claude-code 레코드는 0/353이다. 남은 일: 리더를 문자열 수용으로 넓히고 birth-hook fixture로 고정하되 **print 모드의 부재도 같이 고정**한다. 벤더 버전이 오르면 캡처를 다시 떠야 답이 유지된다. 별도 grant.
- **L8 OMP child가 bridge 권한을 물려받는다 (측정, GLG 세션 2026-08-28):** OMP task child의 `entwurf_self`는 **부모의 garden id**를 반환한다(두 번째 주소 없음 — §3.5 요구사항 충족, 게이트가 증명하는 그대로). 그러나 그 빌린 신원으로 `entwurf_v2`와 `entwurf_fresh_call`을 호출할 수 있다. §3.5(b)가 도구 차용을 의도적으로 허용하므로 깨진 불변식은 아니다. **열린 질문은 C에서 닫혔다 — 판정이 아니라 원칙으로:** `docs/adding-a-harness.md` §3.5의 principal doctrine이 visible host citizen을 가든 principal로 두고, 내부 위임과 그 책임을 그 시민·벤더 소유로 명시하며, Entwurf가 내부 ACL·subagent provenance·시민 아래 authority 축을 만들지 않는다고 못박았다. 빌린 신원의 dispatch는 principal이 자기가 고른 delegate를 통해 보낸 것이다. 따라서 아래 울타리 측정은 참고 자료로만 남는다. 값싼 울타리 후보 측정: omp 18.0.0에 subagent의 MCP 접근을 막는 `mcp.*` 키는 없으나 `task.enableLsp`(기본 false)가 **subagent별 개별 도구 차단 기제가 존재함**을 증명한다. 자체 tool set을 든 custom agent 정의는 미검증 단서.
- **L6 벤더 드리프트 — 트리거가 발동했다:** 이 호스트는 이제 **omp 18.1.12** 다(`omp --version`, 2026-09-10 재측정; 2026-08-30 의 18.0.0 에서 이동). 그러므로 `mode === "tui"` 판별자, `xd://` 동작, §M7 의 다섯 셀(호출 자리·idle wake·`clearTimer`·핸들러 순서)은 **지금 재측정 대상이고 아직 재측정되지 않았다**. 18.0.0 위에서 딴 §M7 영수증은 그 버전의 기록으로 유효하다 — 덮어쓰지 말고 새 측정을 옆에 붙여라.
- **L9 MODELS.md 드리프트 (2026-09-10 관측, 이 레인 밖):** `MODELS.md`(2026-09-04)가 *"omp 는 entwurf 브리지가 없어 Claude 를 github-copilot 으로만 닿는다"* 고 적었는데, 지금 `omp models` 는 `anthropic` 프로바이더 그룹을 갖고 있어 `claude-opus-5` 가 **두 레일로 풀린다**(metered anthropic API / copilot 구독). 그래서 이 레인의 omp 형제는 `github-copilot/claude-opus-5` 로 provider 를 못박아 열렸다. 별건 — 릴리즈 뒤 GLG 판단.

# DURABLE LINKS

- #72 (ACP child가 외부 SIGTERM으로 죽던 건 — 원인 닫힘, 수리 랜딩): https://github.com/junghan0611/entwurf/issues/72

- #87: https://github.com/junghan0611/entwurf/issues/87
- #90 (claude-code model 필드, CLOSED — 측정 완료, 리더 수정만 남음): https://github.com/junghan0611/entwurf/issues/90
- #98 (딜리버리 투명성 — `6306f93` 랩 영수증 + `c10b904` 제품, 푸시 전): https://github.com/junghan0611/entwurf/issues/98
- #101 (세션 전환 유령 시민과 거짓 배달 — 수리 랜딩, 0.18.0에 실린다): https://github.com/junghan0611/entwurf/issues/101
- Admission path: `docs/adding-a-harness.md`
- OMP operator boundary: `docs/setup-clean-host.md` §4b
- OMP tool-surface dialect: `docs/external-mcp-host.md` OMP row
