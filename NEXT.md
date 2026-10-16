# NEXT — core 0.37.1 cut (#144: automatic qualification body retired as a release axis)

# RAIL — 현재 좌표

- [x] **1. 0.37.0 / Herdr 0.37.0 snapshot 출하 기준점** — `d0c2edf` / `v0.37.0`, snapshot `5e1e629` / `v2026.10.15-herdr.0.37.0`. 수용 근거는 CHANGELOG 각 절.
- [x] **2. #144 범위 착륙 (branch)** — `1df7926` (pi-durable mutant 좌표 분리, 오라클 job 거부 증명), `c208d37` (자동 BODY 퇴역). 브랜치 push CI run 38811304369: 4 jobs green, BODY step skipped. 로컬 main은 `c208d37`로 fast-forward. push 전 기준 원격 main은 `5e1e629`.
- [x] **3. 0.37.1 prepare** — source fix `1077e27`(mux 모델/순서, Codex id 접두어) 위의 `chore(release): prepare v0.37.1`. 기록 리뷰 닫힘. CHANGELOG 승격, version 0.37.1, runtime-lock을 `herdr-checkout` 후보 carrier로. static FULL은 이번 컷 GLG 승인으로 prepared SHA의 CI에 위임(P4·P5 첫 step·M0). LIVE 3차(r3)가 step별 실행으로 MUST 23/23·BEHAVIOR 1/1 PASS. 그 바이트가 `1077e27`과 이 prepare commit에 그대로 들어갔다. Codex app-server(Opus1 소유 교체 서버)는 r3 뒤 TERM 1회로 정지, subtree·listener·alias 소멸 확인(`.tmp-verify/release-0.37.1/codex-server-r2/` 03·05·06·07).
- [ ] **4. 0.37.1 make** ← CURRENT: 승인됨 — prepared main push, exact CI(4 jobs; BODY는 릴리즈 축 아님), 보존 candidate 수용, tag, GitHub Release. GLG가 prepare 뒤 재개를 승인했고 sol이 진행한다.
- [ ] **5. publish / Herdr re-pin** — npm 게시는 GLG 전용. Herdr 0.37.1 re-pin은 별도 snapshot이며 #145 전 필수 의무 아님.

현재 좌표: 1–3 완료 → 4 make 진행(승인됨) → 5 GLG 결정

# NOW

- **다음 한 걸음:** prepared main(이 prepare commit)을 한 번 push → `verify-exact-ci.sh <SHA> wait`로 exact 4-job CI 확인 → 보존 candidate 수용 → tag·GitHub Release. 이 가운데 어느 것도 아직 성공으로 기록하지 않는다. `v0.37.1` tag와 GitHub Release가 이미 있으면 make를 반복하지 않고, 둘을 확인한 뒤 #145로 돌아간다.
- **검증된 바이트:** package.json·runtime-lock·run.sh·VERIFY·smoke-mux·codex protocol은 r3가 검증한 바이트 그대로다(`.tmp-verify/release-0.37.1/fix-mux-first/07-pre-records/hashes.txt`). LIVE 뒤에는 CHANGELOG·NEXT만 기록용으로 움직였다.
- **남은 권한:** GLG가 commit과 prepare 뒤 make 재개를 명시 승인했다. 사람의 별도 START를 다시 기다리지 않고, sol의 GO가 실행 시점을 정한다. make(main push, exact CI 4 jobs, candidate, tag, Release)는 sol 소유다. 중간 fix push는 없고 prepared main push는 sol이 한 번 한다. npm publish는 GLG 전용. 로컬 FULL·BODY PASS는 없다. prepared SHA의 exact CI(4 jobs)가 static `check:full`을 갚아야 한다.
- **정본:** 범위와 검증 경계는 CHANGELOG `## 0.37.1`. 절차는 `.claude/skills/entwurf-release/SKILL.md`와 VERIFY. #144 결정 원문과 측정은 issue #144 thread.
- **검증 수준:** 이 SHA에서 979 claims의 kill-power는 재측정하지 않는다(#144, 명명된 손실). 이전 후보 PARTIAL은 CHANGELOG에 receipt별로만 나열하고 합산하지 않는다. weekly schedule·수동 `qualify=true` 경로는 새 정책 아래 아직 미관측.

# RECENT

- 2026-10-16: CI/CD milestone — 0.37.1은 whole BODY가 릴리즈 축이 아닌 첫 컷이다(#144). 로컬에서는 LIVE와 영향받은 focused check·PARTIAL만 돌았고 FULL·BODY는 돌지 않았다. static FULL은 prepared SHA의 exact CI에 위임되었다. 그 CI는 아직 빚이다.
- 2026-10-16: LIVE r1(mux, 구 위치)·r2(Codex id 접두어 누락) 빨강, r3 MUST 23/23·BEHAVIOR 1/1. 원인(`gpt-6-luna`가 ACK는 출력했지만 callback을 호출하지 않음, 접두어 누락)은 둘 다 미확정. 새 모델/순서의 mux는 r2·r3 두 번 통과했다(관찰 2회, 원인 증명 아님). 수치·receipt는 CHANGELOG `## 0.37.1`.
- 2026-10-16: P9 관찰(read-only census: 삭제·kill 없음. owned Codex server의 TERM 1회와 끝난 세션은 별도로 명시적으로 닫았다) — chain 계열 world가 transcript를 남기고, 비동기 `fsp.mkdtemp` 접두어는 현재 OWNED 추출(`mkdtempSync` grep)에 잡히지 않는다. 오래된 미사용 owned overlay 1개, dead-owner marker도 그대로다. 측정·보존 정책 결정은 컷 뒤 후속(지금 issue·scheduler·정리 코드 수정 없음). pi-durable raw receipt는 의도된 보존.
- 2026-10-16: GLG 결정 — 로컬 게이트와 CI를 나누고, 자원 낭비를 줄이기 위해 이름 붙인 검증 수준 하락을 받는다. 30분 목표는 폐기. 한 컷 창(cab1b9f→5e1e629)에서 BODY가 5개 SHA에 5회, 506.3분 돌았던 것이 적용 전 비용.
- 2026-10-15: 0.37.0 출하와 Herdr 0.37.0 snapshot(npm pin, CalVer tag, latest=false) 완료.

# GUARDRAILS / PARKED

- 로컬 `check-herdr-sandbox`, `check-herdr-plugin-build`(운영 herdr 실행), 로컬 whole qualification BODY는 금지다. 이번 컷의 static FULL CI 위임은 GLG의 2026-10-16 새 승인이며 다음 컷에 상속되지 않는다.
- records/transcripts/DB/WAL/native modules/운영 설정은 보존한다. 기존 프로세스를 자동 재시작하지 않는다. Codex app-server의 owner는 Opus1이며 이 lane은 stop/kill/adopt하지 않는다.
- #145(pi 1.3.0)는 0.37.1 출하 뒤. 지금 dependency/pin/코드 변경 혼합 없음.
- #142는 대기 중이다. thinking 기본값과 ACP effort 전달을 함께 다룬다. 전환할 때 기존 담당 `20261014T115640-17d999`, `.tmp-verify/128-kickoff-037/COORDINATOR-142-REENTRY.md`를 읽는다.
