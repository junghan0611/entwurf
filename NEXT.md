# NEXT — Herdr 0.37.0 snapshot (core 0.37.0 출하 뒤)

# RAIL — 현재 좌표

- [x] **1. 0.36.1 출하 기준점** — `cab1b9f` / `v0.36.1`. 이전 cut의 수용 근거는 CHANGELOG와 #128에 둔다.
- [x] **2. 0.37.0 범위 착륙** — #143 `3a65c8d`, Herdr 0.9.5 pin `d8cd8f3`과 CI 기록 `dbb8a32`, 프로젝트 skill 수선 `4968ffd`. 각 PARTIAL은 CHANGELOG 0.37.0 Release boundary에 있다.
- [x] **3. 0.37.0 prepare** — CHANGELOG 승격, version 0.37.0, 문서 정합(독립 readback PASS). 로컬 static FULL은 이번 컷에 한해 exact CI 위임. LIVE MUST 23/23(첫 run 18 + 재실행 5, step 19 1회 재시도), BEHAVIOR 1/1. 근거는 CHANGELOG 0.37.0 Release boundary.
- [x] **4. 0.37.0 make** — `d0c2edf` / `v0.37.0`, GitHub Release Latest. exact CI run 38716311132(4 jobs, BODY 982/982, check-herdr-sandbox Herdr 0.9.5). 보존 artifact sha256 `d127a927…2035ee`를 GLG가 npm에 게시했고, registry tarball이 그것과 바이트 동일하다.
- [ ] **5. Herdr plugin 0.37.0 snapshot** ← CURRENT — runtime-lock npm 0.37.0(registry integrity 측정), manifest 0.37.0(min 0.9.0 유지). 착수 검증은 CHANGELOG `v2026.10.15-herdr.0.37.0` 절. 남은 것: main push, exact CI(qualification body 포함), public-ref install journey(Herdr 0.9.5, 깨끗한 container), CalVer tag `v2026.10.15-herdr.0.37.0`(latest=false). 선례는 `9f33dd1` → `v2026.10.14-herdr.0.36.0`.

# NOW

- **다음 한 걸음:** Herdr 0.37.0 snapshot 커밋을 main에 올리고 exact-SHA CI를 기다린다. 그 뒤 `smoke-herdr-raw-install-live --ref main`을 깨끗한 container에서 돌리고 CalVer tag와 GitHub Release(latest=false)를 낸다. RED는 보존하고 멈춘다.
- **정본:** 범위와 검증 경계는 CHANGELOG `## 0.37.0`. 절차는 `.claude/skills/entwurf-release/SKILL.md`와 VERIFY.
- **실사용 반영:** 실행 중인 pi-durable 프로세스는 재시작해야 새 carrier(#143 동작, 프로젝트 skill 목록)가 반영된다. 재시작은 GLG가 한다.

# RECENT

- 2026-10-15: GLG 요청으로 소유 pi-durable 레퍼런스 앱을 pi 자체 조립과 대조했다. upstream은 v1.2.0에서 experimental durable 앱 경로를 제거했고(`7472cda0d`), 우리 소스는 v1.1.0에서 출발했다. 프로젝트 skill 상대경로를 잘못된 기준으로 풀던 결함은 `4968ffd`로 고쳤다. `:<level>` 없는 명시 모델의 thinking `off`는 #142에 기록했고 고치지 않았다. 조사 원본은 ignored `.tmp-verify/pi-durable-ownership-audit/`에 있다.
- Herdr 0.9.5: aarch64는 private CLI baseline, x86_64는 `d8cd8f3`의 CI run 38667564413에서 check-herdr-sandbox 12 assertions. 운영 Herdr 업그레이드와 claude integration 재설치는 GLG가 나중에 한다.

# GUARDRAILS / PARKED

- 로컬 `check-herdr-sandbox`, `check-herdr-plugin-build`(운영 herdr 실행), 로컬 whole qualification BODY는 금지다. 이번 컷의 static FULL CI 위임은 상속되지 않는다.
- records/transcripts/DB/WAL/native modules/운영 설정은 보존한다. 기존 프로세스를 자동 재시작하지 않는다.
- #142는 대기 중이다. thinking 기본값과 ACP effort 전달을 함께 다룬다. 전환할 때 기존 담당 `20261014T115640-17d999`, `.tmp-verify/128-kickoff-037/COORDINATOR-142-REENTRY.md`를 읽는다.
- 조사의 나머지 관찰(1.2 InputEntry drift, 조용히 무시되는 pi 설정, project trust)은 이 컷에 없다.
