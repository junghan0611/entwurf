# NOW — pi-shell-acp 0.11 current pointer

> 새 담당자는 여기만 먼저 읽는다. 모르면 아래 `# LEDGER`의 링크/섹션으로 내려간다.
> NEXT는 DB가 아니라 나침반이다: 현재 위치·다음 한 걸음·넘으면 안 되는 선을 맨 위에 둔다.

## ◀ NOW — 세션 #15-3 (2026-06-15, thinkpad, CC Opus 실무자 87b48f) — ✅ (A)+(B) DONE → 🟢 0.11.0 acceptance 2 blocker 모두 해소 → 다음 = CHANGELOG/컷 (GLG 결정) — 여기부터

> **✅ (B) DONE — v2-only mode (커밋됨 `43021b0`·`abda09c`, push는 GLG):** GPT(c34027) **code GO**. NEW `pi-extensions/lib/entwurf-v2-only.ts`(zero-import leaf, marker와 동일 규율 — entwurf-control=`.js`세계 / entwurf.ts·MCP=`.ts`세계 양쪽 import라 leaf 강제): `isV2OnlyMode(env)`(env exact `"1"`만 true) / `checkV1EntwurfAllowed(surface,env)`(순수 `{allowed,message}`) / `assertV1EntwurfAllowed`(throw wrapper) / `v1DisabledMessage` / `PI_SHELL_ACP_V2_ONLY_ENV`. 거부문구 3토큰 = `PI_SHELL_ACP_V2_ONLY=1` + `entwurf_v2` + "unavailable"("v2 is not a drop-in for create" 정직 문구). **10 entrypoint 가드(9 surface groups; `/entwurf` tool+command 둘 다)** — 각 surface 기존 hard-refusal 채널 그대로: entwurf/entwurf_resume tool=`throw`(pi 0.70 throw-on-failure) / `/entwurf`·`/entwurf-send` cmd=`notify("error")+return` / entwurf_send tool=`{isError:true}` / RPC `spawn_async_resume`=`respond(false,…)` / startup `--entwurf-send-message`=`{error}` / MCP×3=`textErr`. **MCP entwurf_resume + control RPC 이중가드**(직접 spawn·socket 우회 hole 닫힘). **v1 코드 삭제 0·등록 제거 0**(호출 즉시 refusal만; 11-scenario replacement·v1 삭제는 0.12 lane). NEW gate `scripts/check-entwurf-v2-only.ts` = **28 checks PASS**(A: helper 단위 exact"1"·off→allowed·on→blocked+3토큰·assert throws/silent / B: 10 guard-site static + 이중가드 명시 + **v2 core(runner·surface) flag-CLEAN**). package.json check 체인 편입 → **`pnpm check` EXIT=0**(biome 122 clean / typecheck 3pass / 전 게이트 / check-pack 165). release_gate 별도 step 불필요(GPT: deterministic이라 pnpm check 안이 SSOT, A와 달리 LIVE 증거 불요).
> - **evidence (release-note/CHANGELOG 컷 때):** `./run.sh check-entwurf-v2-only` → 28 checks PASS; `pnpm check` EXIT=0. `PI_SHELL_ACP_V2_ONLY=1` blocks 10 v1 entrypoints while the `entwurf_v2` core stays flag-clean.
> - **변경 7파일(B 한 의미 단위 = 단독 커밋 후보):** 5 M(`mcp/pi-tools-bridge/src/index.ts`·`package.json`·`pi-extensions/entwurf-control.ts`·`pi-extensions/entwurf.ts`·`run.sh`) + 2 NEW(`pi-extensions/lib/entwurf-v2-only.ts`·`scripts/check-entwurf-v2-only.ts`), 77 insert.
> - **block table 실측 위치 (구현 SSOT):** entwurf.ts `entwurf`(414)·`entwurf_resume`(771)·`/entwurf`(642) / entwurf-control.ts `spawn_async_resume` RPC(926)·`entwurf_send` tool(1645)·`/entwurf-send`(2360)·startup `parseStartupControlSendOptions` / index.ts MCP `entwurf_send`(468)·`entwurf`(775)·`entwurf_resume`(853). **alive 유지**: `entwurf_v2`(entwurf-control 1493)·`runEntwurfV2` / 제외: `entwurf_status`·`entwurf_peers`·`entwurf_self`·`entwurf_inbox_read`(관측·수신면).
> - **다음 한 걸음:** ✅ B 단독 커밋 완료(`43021b0`·`abda09c`) → CHANGELOG(0.11.0 스코프 확정, 진행 중) → tag-release. **(A)+(B) = 0.11.0 acceptance 2 blocker 모두 해소.**

> **✅ 세션 #15-2 (A) DONE — 커밋됨:** `c6a478c` feat(entwurf) 코드 슬라이스 + `6f018c7` docs(next). **push는 GLG.** (A) `smoke-entwurf-v2-spawn-resume-live` 작성 → **LIVE 22 checks PASS**(real pi resume + model turn + lock×1). 첫 LIVE가 **production 설계 모순**을 드러냄 → GPT(c34027) 합의 **C-refined fix** → 재실측 GREEN + pnpm check EXIT=0. **GLG가 우려한 "spawn-bg resident lifecycle 미충족"의 실체였고 닫힘.**
> - **발견:** v2 spawn-bg resume는 `--entwurf-control` resident로 띄우는데(buildResumePiArgs v2-control), `entwurf-control.ts:maybeSetResidentName`이 **resident에 `entwurf` 태그 금지**(entwurf_resume 마커라서) → entwurf 태그 세션(resume 대상은 requireEntwurf 필수)을 resume하면 첫 이벤트에서 self-`exit(1)` "corrupt resident session name". resume 턴도 못 돌고 죽음. 5c-3c가 "5d가 증명"한다며 미룬 구멍이 실재였고 한 번도 LIVE로 안 봤음.
> - **fix (C-refined, GPT 합의):** "operator resident=entwurf 금지" 불변식 유지, **"v2 spawn-bg가 띄운 sessionId-bound authorized Entwurf child resident"만** 좁게 허용. ① NEW `pi-extensions/lib/entwurf-v2-resume-marker.ts`(zero-import leaf: 상수 `PI_SHELL_ACP_V2_RESUME_RESIDENT_SESSION_ID` + pure `isV2ResumeResidentAuthorized(id,env)` — leaf인 이유=entwurf-control은 root tsconfig `.js`-import 세계, spawn-production은 `.ts`-import 세계, 직접 import 시 TS5097) ② `entwurf-v2-spawn-production.ts` spawnChild seam `(cmd,args,cwd,env)` 확장 + `childEnv={...process.env,[MARKER]:plan.sessionId}` 주입 ③ `entwurf-control.ts` 가드 분기(mirror mismatch→crash / entwurf 태그+marker exact→허용·이름불변 / entwurf 태그+무marker→crash) ④ gate `check-entwurf-v2-spawn-production` **42 passed**(env marker + helper 3 assert) ⑤ release_gate에 matrix-live 뒤 spawn-resume-live LIVE/SKIP step 편입.
> - **green:** pnpm typecheck EXIT=0 / biome 120 files clean / gate 42 / LIVE 22 / zero-litter(rmdir 빈 cwd-hash dir). **커밋됨(`c6a478c`·`6f018c7`, push는 GLG).** 변경 6파일: `pi-extensions/{entwurf-control.ts, lib/entwurf-v2-spawn-production.ts}` 수정 + `scripts/check-entwurf-v2-spawn-production.ts`·`run.sh` 수정 + NEW `pi-extensions/lib/entwurf-v2-resume-marker.ts`·`scripts/smoke-entwurf-v2-spawn-resume-live.ts`.
> - **release-note draft (GPT 문구, 컷 때 CHANGELOG로):** ① `LIVE=1 ./run.sh smoke-entwurf-v2-spawn-resume-live` → 22 checks PASS: real saved Entwurf session → v2 spawn-bg resident resume → socket-alive → lock release×1 → resume user+assistant nonce appended → zero-litter cleanup. ② v2 spawn-bg resume initially failed as `child-exited` because `--entwurf-control` rejected existing `entwurf`-tagged names; fixed by sessionId-bound `PI_SHELL_ACP_V2_RESUME_RESIDENT_SESSION_ID` marker; operator residents still reject `entwurf` tags.
> - **다음 한 걸음:** ✅ 모두 진행됨 — ① (A)+fix 커밋(`c6a478c`·`6f018c7`) ② (B) v2-only 커밋(`43021b0`·`abda09c`) 완료 → 남은 것은 CHANGELOG(진행 중) + tag(GLG 결정). **(A) acceptance blocker = 해소.**

- **Stem:** 0.11.0 릴리즈 컷 = **`#35`**(원제목 "entwurf tmux-live lifecycle", NEXT:833 — 단 production은 detached `spawn()` pi resident이므로 **headline 표현은 "spawn-bg resident lifecycle"로 정정**, ↓잠금). 2단 구조: **Stage 0**(pi-only 순수 TS substrate, step 1~5 = 5 시리즈 5a~5d-5 + SE detour) / **Stage 1**(Claude↔Claude live, **명시적으로 Stage 0 범위 밖** NEXT:1160-61). 5d-5 = step 5의 끝(5e 없음). 현재 릴리즈 = `v0.10.0`(첫 meta-bridge, Claude only). 0.11.0 **컷 안 됨** — package.json도 `0.10.0`.
- **현재:** Stage 0 **코드 줄기 닫힘**(5d-5 CLOSE, 게이트 GREEN, `pnpm check` EXIT0), v0.10.0 이후 **155 커밋 push 완료**(working tree clean, `main...origin/main` 동기). **그러나 릴리즈 아님.**
- **릴리즈 전 미결 2갭 — ✅ 둘 다 해소(acceptance 2/2 closed, 세션 #15-3):**
  1. **✅ RESOLVED (세션 #15-2, `c6a478c`) — LIVE acceptance 구멍 닫힘.** spawn real-pi E2E를 `smoke-entwurf-v2-spawn-resume-live`로 LIVE 22 PASS 실견(real pi resume + model turn + lock×1). 닫는 과정에서 production 모순(entwurf-control이 entwurf-tagged resident 거부) 발견·수정. **(A) blocker 해소.** (↓ 옛 분석은 발견 경위 기록으로 보존.)
  1b. **✅ RESOLVED (세션 #15-3, 커밋됨 `43021b0`·`abda09c`) — (B) v2-only mode.** `PI_SHELL_ACP_V2_ONLY=1`이 10 v1 entrypoint hard-refuse(중앙 helper `entwurf-v2-only.ts` + 9 surface groups 가드 + MCP/RPC 이중가드), `entwurf_v2` core flag-clean. gate `check-entwurf-v2-only` 28 PASS + `pnpm check` EXIT=0. v1 삭제 0(0.12 lane). ↑NOW 상세. **0.11.0 남은 acceptance blocker 없음 — CHANGELOG/컷만 남음(GLG).**
  1-old. **(보존) 🔴였던 분석 — spawn real-pi E2E 미실견 (GLG 핵심, 2026-06-15).** production spawn-bg는 **detached `spawn()` pi 자식**(tmux 아님 — `pi-extensions/lib/entwurf-v2-spawn-production.ts:177` `detached:true` unref'd; tmux는 `smoke-async-resume.sh`가 **v1** async-entwurf worker[`entwurf-async.ts` `entwurf-task`/`entwurf-complete` followUp]를 disposable target으로 띄우는 fixture지 v2 production spawn 경로 아님). **약속 미이행이 NEXT 안에 박혀 있음:** step 5(5c-3c, `e9d12df` 주석)가 *"real-pi resume E2E는 5d matrix가 증명(D5 phase gate split)"*이라며 spawn 실증을 5d로 **의도적으로 미뤘는데**, 정작 5d matrix-live(D4-b)는 **control-socket/mailbox/guard 3-cell만** 만들고 **spawn-bg cell을 안 만든 채 5d-5 CLOSE**. 다른 LIVE 게이트도 못 채움: `smoke-entwurf-v2-spawn-live`=**OS substrate watcher만**(NEXT 명시 "real pi resume 아님"). ⇒ **실제 자식 pi가 떠서 resume해 일하는 full loop을 LIVE로 한 번도 안 봄.** 5d-5 CLOSE는 "합성 증거"로 닫은 것 — GLG는 실제 spawn을 눈으로 보고 싶다. **GLG 방향(2026-06-15): v2 검수 통과 = v1 인터페이스(async-entwurf worker 경로) 차단의 전제조건 — 검수되면 v1을 끄고 v2-only로 디테일 평가 진입. 지금 에이전트들이 v1을 쓰고 있어 함부로 못 끄는 것. ⇒ spawn-bg real-pi resume LIVE는 nice-to-have가 아니라 v1 deprecation의 전제.**
  2. **✅ RESOLVED (세션 #15-3) — 컷 스코프 확정 + CHANGELOG 1차 채움.** 0.11.0 = **entwurf v2 dispatch substrate**(5 시리즈 step4-pre~5d-5 + SE detour + fact-surface + meta/trust) + **(A) spawn-bg resident lifecycle**(c6a478c) + **(B) v2-only**(43021b0). "SE·hejdev6·openclaw 묶음 여부"는 컷 blocker 아님(GLG 2026-06-15): **SE**=v2 substance, already included(이미 push, CHANGELOG에 실림) / **hejdev6**=별도 lane(비핵심 secret 이름, 0.11.0 무관) / **openclaw**=별도 lane(별개 Deprecated 사실, 이미 CHANGELOG `Unreleased`에 기록, 0.11.0 main feature 아님). `CHANGELOG.md ## Unreleased`에 0.11.0 substance 도메인 그룹 **DRAFT 채움**(promote/version bump 안 함). **남은 floor = live `release-gate` PASS=15 FAIL=0 SKIP=0** — 이게 통과해야 `## 0.11.0` promote + `npm version 0.11.0` + lockfile + `chore(release)` 커밋(`/prepare-release 0.11.0` 절차). 그 다음 `/make-release`가 tag/push/stamp.
- **(LEDGER archive — 경계 확정 과정, 모두 resolved):** GPT 1차(03:21)·2차(03:33) 회신 + GLG 잠금(2026-06-15)으로 0.11.0 acceptance = **2 blocker**로 확정됐고 둘 다 닫힘 → **(A) `smoke-entwurf-v2-spawn-resume-live` PASS**(`c6a478c`) / **(B) v2-only `PI_SHELL_ACP_V2_ONLY=1`**(`43021b0`). 확정된 durable 결정: headline = **"spawn-bg resident lifecycle"**(tmux 표현 폐기) / **0.12 lane으로 분리** = 11-scenario v1 replacement·v1 삭제·new sibling v2 대체·status+followUp UX / **out-of-scope** = hejdev6(별도 lane)·openclaw(별도 lane, 이미 npmjs deprecated)·Stage 1(Claude↔Claude, 범위 밖). 구현 핀 상세는 ↓ "0.11.0 구현 사양" 섹션 + GPT 회신 archive `meta-mailbox/…d2928f`.
- **검수 라인(세션 #15):** 실무자 = CC Opus `20260615T115707-d2928f`(meta-session, replyable:true 실측) / 자문·1차 = GPT5.5 `20260615T115712-c34027`(socket-only alive, direct). 옛 id(`20260614T152031-e914f2`·`20260614T122717-bdfe6e`)는 **stale**.
- **Detour:** SE-1/SE-2 본체 **종료**(✅ 헤더 CLOSE 정리 완료, 코드 push 완료, deliverability seam은 CHANGELOG Unreleased 흡수). SE-3 🟡 record-only(SE-1 slice 5 folded, 컷 blocker 아님).
- **Return:** ✅경계 잠금 완료 → ✅(A) spawn real-pi 실견(`c6a478c`) → ✅(B) v2-only(`43021b0`) → **CHANGELOG(진행 중)** → tag/push/stamp(GLG).
- **Blocker:** 없음 (model auth OK — GLG 확인, 환경 OK).
- **Do not touch:** CHANGELOG/tag는 **경계 확정 + GLG "컷 가자" 전까지 손대지 말 것**(tag-release 스킬은 명시 요청 시만). `core.hooksPath`·안전레일 불변.

### 0.11.0 구현 사양 (GPT 2차 GO 2026-06-15, 원문 archive `meta-mailbox/…d2928f`)

**(A) `smoke-entwurf-v2-spawn-resume-live` — 구현 핀 10 (기존 spawn-live·matrix-live seam 재사용):**
1. seed session = **`entwurf` tag canonical name 필수**(`resolveResumeLaunchIdentity`가 `requireEntwurf:true`) → TS smoke서 `buildSessionName` import(shell 재구현 금지).
2. seed는 fixture + **`backend=pi` meta identity hand-mint**, **mint→minted gid를 seed `--session-id`로** 순서(`resolveTarget`이 meta-record 봄). "pi-writer E2E 아닌 spawn-resume E2E" 주석.
3. cwd authority 고정: seed header cwd = identity.cwd = temp cwd 하나(decider plan.cwd ↔ JSONL header cwd 어긋나면 디버깅 더러움).
4. preflight 통과 명시: `makeProductionEntwurfV2Deps({prefixRoots:[tmp]})`/trust fixture, `--approve`가 `plan.launchArgs` 들어가는지.
5. **result PASS = `socket-alive`만**, `child-exited`는 실패 처리(resident lifecycle).
6. JSONL poll은 watcher 반환 **후 별도 단계**: ① result spawn-bg/socket-alive+lock release assert ② session file poll로 user nonce append ③ assistant nonce는 더 긴 timeout poll. prompt=`Reply exactly V2_SPAWN_RESUME_OK_<nonce> and nothing else.`, acceptance=`includes(nonce)`(모델이 exact 어길 수 있음).
7. JSONL 형태 특정 금지 → 파싱해 `JSON.stringify(entry).includes(nonce)`로 user/assistant 후보 탐색(type/role은 보조만).
8. cleanup **pid+socket 둘 다** SIGTERM→wait→SIGKILL backstop + socket gone 확인. 실패 시 temp world/gid/session path/stderr tail 보존.
9. **release counter=1 AND lock file absent**(다른 축 — "release called" ≠ "lock gone").
10. release_gate 편입 = matrix-live 뒤 별도 step, `LIVE!=1`이면 SKIP, NEXT/CHANGELOG에 "tag 전 `LIVE=1 ./run.sh smoke-entwurf-v2-spawn-resume-live` PASS 필수" 박기.

**(A) F1~F5 잠금 + 타입 (GPT 3차 GO 2026-06-15 03:45):**
- **result PASS** = `{kind:"executed", transport:"spawn-bg", outcome:{transport:"spawn-bg", result:{kind:"socket-alive", released:true, pid?}}}`. `child-exited`/`lock-retained`/`spawn-start-failed`=실패. cleanup용 pid=`outcome.result.pid`(child는 detached, ChildProcess handle 없음).
- **F1:** real `~/.pi/agent/sessions` seed(`findSessionFileById` env override 불가) → mint → `findSessionFileById(gid)===null` assert → seed → seed 후 잡은 **정확한 1파일만** cleanup(디렉토리 rm 금지), 실패 시 보존.
- **F2:** `seams.releaseLock:(claim,{dir})=>unknown` wrapper(shared release closure가 spawn watcher까지) → `releaseCount===1` + `releasedGids===[gid]` + `!existsSync(lockPathFor(gid,lockDir))`. **production 변경 0.**
- **F3:** seed = `pi --no-extensions --mode json -p --session-id <gid> --name <buildSessionName({sessionId:gid,provider,model,tags:["entwurf"]})> --provider <p> --model <m> --approve <seed prompt>` one-shot → seed exit 후 `readSessionIdentity(sessionFile,{requireEntwurf:true})` 즉시 검증(non-null, `cwd===tmp`, provider/modelId===seed). model_change 누락이면 거기서 fail.
- **F4:** seed `--approve`(CLI-level), v2 resume `makeProductionEntwurfV2Deps({prefixRoots:[tmp]})`(preflight).
- **F5:** assistant nonce까지 **hard fail**(socket-alive+user만 PASS면 "실제로 일했다" 증거 비어 v1 차단 전제 약화). timeout seed120/observe30/user60/assistant180s(env `PI_SHELL_ACP_SPAWN_RESUME_ASSISTANT_TIMEOUT_MS`). resume 직전 line count 기록→이후 append만. `V2_SPAWN_RESUME_USER_<nonce>`(user)+`V2_SPAWN_RESUME_OK_<nonce>`(assistant), `includes`. child cleanup=`process.kill(pid,SIGTERM)`→socket gone poll→SIGKILL.

**(B) v2-only 우회 entrypoint block table (0.11.0 필수 — GLG 우회 본능, RPC·startup 놓치면 빈틈):**
1. pi-native `entwurf` async/sync → **spawn 전** 거부. 2. pi-native `/entwurf` 거부. 3. pi-native `entwurf_resume` sync/async 거부. 4. `/entwurf-status`/`entwurf_status`=선택(execution 아님, read-only 유지 가능, blocker 아님). 5. pi-native `entwurf_send` 거부+`entwurf_v2` 안내. 6. MCP `entwurf_send` 거부. 7. MCP `entwurf_resume` 거부(async가 `spawn_async_resume` RPC **보내기 전**). 8. MCP `entwurf` spawn 있으면 거부. 9. **control RPC `spawn_async_resume` 직접 거부**(MCP 막아도 RPC 열리면 우회!). 10. startup `--entwurf-send`/native startup send path 거부(**silent skip 금지, error report**). 11. `entwurf_v2` pi-native+MCP는 flag-on에서도 **등록·동작** deterministic gate.
   - error 문구(정직, "use entwurf_v2"만 말해 "새 create도 v2로 된다" 거짓암시 금지): `v1 entwurf surface is disabled in v2-only mode (PI_SHELL_ACP_V2_ONLY=1). Use entwurf_v2 for existing garden citizens; new sibling create / v1 completion followUp are intentionally unavailable in this mode until the 0.12 cutover lane.`
   - gate = static grep만 말고 가능하면 handler 직접 호출 또는 source block에 `assertV1EntwurfAllowed` 들어갔는지 + **v2 block엔 안 들어갔는지** 함께. "등록 제거"보다 "등록되지만 호출 즉시 refuse"(관측성).

### ⇄ 세션 #14 done (2026-06-14, thinkpad) — RECENT (참고)

> 노트북 이관 완료(pull + D1 재배포·D2 symlink → doctor PASS / pnpm check EXIT0 / matrix 82). **5d-5 = CLOSE**(GPT verdict):
> D4 트리오 done — a(deterministic 82) / b(LIVE 11/11, `openai-codex/gpt-5.4`) / c(release_gate wiring). 커밋 `ae8e4e5`~`de207c5` **push 완료**.
> 미결로 넘긴 GLG 판단: ① D3 브랜치 `verify/doctor-pipefail-and-pi-0.79.2` 삭제(정보유실 0 확인) ② hejdev6 보안 묶기.
> 재배포 함정(SE-3): `install-meta-bridge` 재배포 시 수신측 세션 새로 열기/resume해야 receiver armed. mid-session `replyable:false`는 정직(버그 아님).

## ⇄ (closed, 세션 #12) — detour SE-1/SE-2 종료(push 완료) → 5d-5 복귀 맥락 (참고 LEDGER, NOW 아님)

> **줄기(stem)는 5d-5 LIVE matrix다.** detour SE-1/SE-2 본체는 **종료**(2d-3·2e·body-render 후속까지 push 완료,
> `9710d06` HEAD). 이제 5d-5 진입인데, **그 전에 닫아야 할 detour가 아래 인벤토리 4건**이다 — GLG가 말한 "detour가
> 없을 수 없다"의 실체. 줄 세운 것 말고 *하다가/돌아와보니 터져 있는* 것들. **위임 불가** — 삼형제+GLG가 직접.

### ▶ 5d-5 진입 전 닫아야 할 detour 인벤토리 (세션 #12 처리 결과)

> D1·D2 닫힘(ops, 커밋 아님). D3 보존 완료(삭제만 GLG 승인 대기). D4 = 줄기 본체, GPT design 논의 진입.
> **D1·D2는 환경(머신)별이라 노트북에서도 동일 복구가 필요할 수 있다** — repo 커밋으로 안 옮겨지는 ops.

1. **✅ D1 — deploy hygiene (닫힘, ops):** `doctor-meta-bridge`가 writer-version parity stale로 FAIL이었음
   (`source=ebdb9f61` = SE-2 slice 2b `7cac9e3`가 `meta-session.ts` writer 변경 vs `installed=e132bc98` 옛 배포본).
   **fix:** `./run.sh install-meta-bridge` 재배포 → source=assembled=installed=`ebdb9f61` 일치 → **doctor PASS**(세션 #12 실측).
   **노트북에서도:** writer drift면 `install-meta-bridge` 재배포 후 doctor 확인.
2. **✅ D2 — entwurf registry 안 잡힘 (닫힘, ops — 환경/개발버전):** test.sh 4e "unregistered tuple" fail의 진짜
   원인은 `~/.pi/agent/entwurf-targets.json` symlink가 **옛 install 경로**(`~/.pi/agent/git/github.com/.../pi/entwurf-targets.json`)를
   가리키는 dead link였던 것. **우리는 개발 버전을 쓰므로 그 `~/.pi/agent/git` 폴더는 없는 게 정상** → dead link →
   "Entwurf target registry not found" → **모든 entwurf spawn refuse**(test 4e만이 아니라 5d-5 LIVE 전체 전제가 깨진 상태였음).
   **fix:** `./run.sh setup:links --force` → repo canonical(`~/repos/gh/pi-shell-acp/pi/entwurf-targets.json`)로 relink →
   **test.sh 20/20 passed**(세션 #12 실측). **노트북에서도:** 개발 버전이면 같은 dead link 가능 → `setup:links --force` 한 번.
3. **🟢 D3 — 브랜치 `verify/doctor-pipefail-and-pi-0.79.2` (보존 완료, 삭제만 GLG 승인):** origin에 살아있음.
   확인 결과 **삭제해도 정보 유실 없음** — fix 2건은 main에 `3a01fbd`/`a2bd5c6`로 흡수, run.sh:1040/1077 흡수는 `0dfe4d0`,
   **나머지 pipefail deferred 6건은 이미 이 NEXT 아래 `smoke-meta-prune:138` + `smoke-resident-garden-guard:80/149/223/347/348`로 보존됨**
   (브랜치 "8 deferred" − 흡수 2 = 6, 일치). 브랜치 tip NEXT는 세션 #7~#8 옛 스냅샷. **GLG 승인 시:**
   `git push origin --delete verify/doctor-pipefail-and-pi-0.79.2`.
4. **🔵 D4 — 5d-5 matrix 본체 미구현 (줄기의 실제 남은 큰 일, GPT design 진입):** `release_gate`(run.sh:4421)는 일반
   substrate live gate(smoke-all/async-resume/cancel/model-switch/entwurf-resume/check-bridge…)만 3-backend로 돈다.
   **5d-5 headline의 (c) release-gate matrix = sender surface(pi-native tool / MCP verb) × target kind(alive pi /
   dormant pi / unsupported citizen) × direction에서 lock acquire→release ×1 + lock-retained 진단 표면화 는 아직 스크립트가 없다.**
   design은 GPT 잠금 상태(아래 본문 line 324~). **D1·D2가 닫혀 이제 실 entwurf spawn이 살아있으니 LIVE 실증 가능.**
   - **환경 고정 선결:** 어떤 모델/백엔드로 실 pi 세션을 띄워 spawn-resume·send를 실증할지(Fable 차단, Opus 복구).
   - **D5(이미 완료):** `LIVE=1 ./run.sh smoke-entwurf-v2-spawn-live → 7 passed`(5c-3c phase gate, real pi resume 아님).
   - **진입 방식:** GPT와 matrix runner design부터 잠그고(별도 smoke vs release_gate step 편입), 슬라이스별 1차 검수.
   - **GPT design GO(2026-06-14):** Q5 2층 = (A) deterministic 전수 게이트 + (B) live sentinel smoke. 3슬라이스:
     **D4-a**(deterministic `check-entwurf-v2-matrix`) / **D4-b**(`smoke-entwurf-v2-matrix-live`, 모델 Opus 고정 금지 →
     registry default + `PI_SHELL_ACP_LIVE_MODEL` override, control-socket 1 + meta-mailbox 1 cell) / **D4-c**(release_gate
     check-bridge 직후 편입). LIVE는 substrate-still-works happy-path만; negative/timeout은 deterministic이 담당.
   - **✅ D4-a DONE(로컬 커밋, push 대기 — GPT 구조 GO + call-reach 보강):** NEW `scripts/check-entwurf-v2-matrix.ts` —
     REAL `decideDispatch`를 minimal fakes로 구동하는 thin coverage gate(decider 재구현 0). 12행 도달성×락 표 +
     coverage(transport 3 / lock class 5 / reject reason 8) + reach축(pre-probe/unsupported/in-domain별 inspect·probe·
     mailbox call-count 강제). **82 assertions.** run.sh 함수+dispatcher+help, `pnpm check` 편입(decider 뒤). check-pack
     158→**159**, typecheck 3-config / biome clean / `pnpm check` EXIT=0.
   - **✅ D4-b CODE DONE(로컬 커밋 `ccc7f40`, push 대기 — GPT design GO + code GO 둘 다):** NEW
     `scripts/smoke-entwurf-v2-matrix-live.ts`(3-cell LIVE sentinel) + run.sh(함수/dispatch/help). C1 control-socket(실
     `pi --entwurf-control --mode rpc` → RPC send, outcome=`sent`, lock acquire→release ×1) / C2 meta-mailbox deliverable
     (armed receiver → `.msg`×1 + `inbox.signal`, lock-free) / C3 guard(receiver 없음 → reject `mailbox-undeliverable`,
     garbage 0). **model-in-loop OUT(programmatic enqueue, GPT Q2)** — "모델이 entwurf_send 부르나"는 별도 behavior 테스트.
     자동화 seam(terminateChild SIGTERM→SIGKILL, fresh gid+temp, staged timeout, 실패 시 temp 보존). LIVE=1 없으면 honest
     skip(release_gate 무인 안전). target `PI_SHELL_ACP_LIVE_TARGET` 기본 `openai-codex/gpt-5.4`. GPT 1라운드 상세 리뷰에서
     B1(non-TTY spawn→`--mode rpc`)·B2(cleanup helper)·B5(reason pin) 등 blocker 8건 잡혀 전부 보정 후 **code GO**.
     check-pack 160→**161**, `pnpm check` EXIT=0.
   - **✅ D4-b LIVE DONE(2026-06-14 세션 #14, GLG thinkpad 실측):** `LIVE=1 ./run.sh smoke-entwurf-v2-matrix-live`
     target=`openai-codex/gpt-5.4` → **11/11 checks passed, 첫 실행 보정 0.** C1 실 pi control-socket RPC `outcome=sent` +
     lock release / C2 meta-mailbox `.msg`×1 + `inbox.signal` + lock-free / C3 guard reject `mailbox-undeliverable` +
     garbage 0. fixture(pi citizen mint + 실 `pi --mode rpc`)가 실제로 동작 — D4-b LIVE evidence 확보.
   - **✅ D4-c DONE(로컬 커밋 `68e6da8`, push 대기 — GPT design GO):** `release_gate`(run.sh)에 **check-bridge 직후**
     `smoke-entwurf-v2-matrix-live`를 **단일 step**(backend loop 없음 — substrate sentinel)으로 편입. **LIVE!=1이면 PASS가
     아니라 SKIP으로 카운트**(gemini-availability idiom 차용: `warn`+`results SKIP`+`skip++`) → 무인 release_gate 안전 +
     summary 거짓 PASS 없음. `--allow-skip-gemini`와 독립축. bash -n OK / skip-path OK. GPT Q1(직후)·Q2(1회)·Q3(SKIP 명시) 반영.
   - **▶ D4 트리오 완성 = 5d-5 headline (c) release-gate matrix 닫힘** (a=deterministic 전수표 / b=LIVE sentinel 11/11 /
     c=release wiring).
   - **✅✅ 5d-5 CLOSE(GPT verdict 2026-06-14 세션 #14):** headline (a)MCP in-process spawn-bg·(b)pi-native dynamic-import는
     **별도 LIVE 불요 — 합성 증거로 닫힘**(G1 단독 아님): `check-entwurf-v2-surface`(pi-native dynamic-import 등록·MCP
     in-process 호출·renderer) + `check-pi-tools-bridge-boot`(실 start.sh 부팅 + tools/list `entwurf_v2` runtime schema) +
     `check-entwurf-v2-production`/`check-entwurf-v2-matrix`(deps 조립·decider matrix·spawn-bg lock 표) + D5
     `smoke-entwurf-v2-spawn-live`(spawn watcher OS substrate LIVE) + D4-b `smoke-entwurf-v2-matrix-live`(production
     runEntwurfV2 + 실 control socket + 실 mailbox + lock release LIVE). **= surface wiring + runtime boot + production
     substrate 합성.** (옵션 미래 D4-d = literal `MCP tools/call entwurf_v2` E2E hardening — 5d-5 blocker 아님.)
     **남은 것: GLG push(`ae8e4e5`~`de207c5`) + 다음 줄기 = release 컷 준비.**

- **삼형제 역할(세션 #12):** 실무자 = 현 Opus(claude-code, garden `20260614T152031-e914f2`) / 자문·리뷰 = **GPT5.5
  (openai-codex/gpt-5.5, `20260614T122717-bdfe6e`, live direct — 현행 검수자)**. 아래 line 384~의 옛 GPT id
  (`20260613T121021-03a5d7`)·Fable id는 **stale**. Fable5 2차 가용 여부 미확인(직전 Anthropic 이슈로 응답불가였음).
  **형제 차별 없음 — ACP도 정식 경로.**

## 🐛 끼어든 버그 레저 (detour ledger) — 줄기와 분리해서 관리

> 줄 세운 작업(5d) 밖에서 하다가 터지는 버그를 여기 담는다. 항목별: 증거 → 근본원인 → 설계합의 → 슬라이스 → 상태.
> 원칙: 잠깐 수리하고 줄기로 복귀. 위임하지 않는다 — 꼬리를 직접 따라가야 연관 문제까지 검토된다.

### SE-1 — pi-shell-acp 세션 inbound 2등 시민 (sibling-equality inbound) — ✅ CLOSE (0.11 deliverability blocker 종료·push 완료, seam은 CHANGELOG Unreleased 흡수 — residual pi meta-writer/record-only = SE-3 별도 lane, 컷 blocker 아님)

- **LIVE 증거(2026-06-14):** 실무자 Opus가 `--entwurf-control` **없이**(control socket 없음) garden id(`…102907-f77390`)
  만 가지고 뜸. 보낸 메시지는 `✓ delivered`인데, GPT/CC가 그 id로 **회신하면 거부**: `no meta-record … not a garden
  citizen, cannot deliver`. → 같은 id에 `--entwurf-control` 붙여 재기동하니 socket 생성·peers `liveness=alive`·왕복 성공.
- **거짓 신호 사슬(GLG가 속은 지점):** 하나의 "garden id"가 세 보장을 동시에 암시하는데 실제론 분리됨 —
  (a) garden id 존재 = 정체성/model-lock 신호(상태바 🪛<id> + statusline이 citizen처럼 보임),
  (b) live control socket = ALIVE inbound(오직 `--entwurf-control`),
  (c) meta-record = DORMANT inbound(현재 네이티브 CC SessionStart 훅 전용).
  상태바는 (a)만 보장하면서 (b)/(c)처럼 보이고, `entwurf_self`도 socket 존재검증 없이 `replyable:true`+합성 socketPath
  출력. **모든 층이 yes인데 실제 배달만 no = Crash-Don't-Warn 위반.**
- **근본 메커니즘(실측):** pi-shell-acp claude overlay가 `settings.json`에 `hooks={}`로 훅 strip(Hard Rule #10 memory
  containment) → meta-bridge SessionStart 훅이 pi 백엔드에선 안 뜸 → **pi 세션은 meta-record를 못 만듦**. 같은 cwd
  네이티브 CC(`…582512`)는 citizen 등재. ⇒ pi 세션은 구조적 inbound 2등 시민. **fix는 백엔드 훅이 아니라 pi-side 층.**
- **v1·v2 동일 실패(GLG 핵심):** v2 decider도 같은 fact surface(socket?+meta-record?) 읽음 → socketless·record-less pi
  세션은 frozen dispatch table 밖 → reject. dormant(소켓 죽은) pi 세션은 `entwurf_peers`에 안 보여 v2 resume 대상으로도
  안 잡힘. **v2에서 pi-shell-acp를 빼고 가는 게 아님 — alive·dormant 양쪽에서 네이티브 CC와 동등한 도달성 필요.**
- **GPT5.5 자문 verdict(2026-06-14 01:57):** Q1/Q5 방향 동의, 단 "meta-record 존재=replyable"로 바로 넓히면 v1
  fallback이 pi record에도 mailbox enqueue를 성공 처리 → **pi는 mailbox drain/wake 없음** → 오늘보다 더 큰 거짓 성공.
  ⇒ **먼저 mailbox deliverability/replyable 진실성을 막고, 그 위에 pi meta writer를 올린다.**
  - **Q1(YES):** session_start에서 pi-side v2 MetaIdentity mint/upsert. `backend=pi`, `nativeSessionId=sessionId`,
    `gardenId=sessionId`(보존 필수), cwd/model/transcriptPath(nullable). 현 `upsertMetaSession`은 create 시
    `generateSessionId()`로 새 id 민팅 → 그대로 쓰면 안 됨. `MetaIdentityMintInput.gardenId?` 또는 pi 전용 upsert 필요.
    `--entwurf-control` 독립적으로, garden id 세션이면 동작.
  - **Q2(YES, socket 우선):** record+live socket→control send / record+dead·absent socket→dormant(owned=spawn-bg
    resume, fire-forget=reject). **meta-mailbox는 pi 기본 fallback 아님**(pi=direct-inject, drain/wake 없음).
  - **Q3:** replyable = "PI_SESSION_ID 있음"이 아니라 "지금 이 sender에게 model-visible 회신을 넣을 inbound path가 있음".
    `mcp/pi-tools-bridge/src/index.ts`의 `buildStrictPiSenderEnvelope()`가 env만 보고 true, `entwurf_self`가 socketPath
    합성 = 오늘의 거짓. 중앙 `computeSelfAddressability` seam으로 실제 socket probe(미래 pi mailbox drain). **Q1 후에도
    record만으론 replyable true 아님.**
  - **Q4:** 상태바 분리. `🪛<id>`=identity/model-lock 유지, addressability는 별도(`control:alive`/`citizen:dormant`/
    `no-inbound`). socketless running pi는 "record 있음+live inbound 없음"이라 단일 glyph는 또 속임.
  - **Q5:** classifier 거의 준비됨 — `MetaBackendV2`에 `pi`, `isLivenessSupported('pi')`, `scanSocketProbes`가 absent
    canonical socket을 `dead`로 → dormant route 열림. 확인할 곳: legacy/in-process `entwurf_peers`가 live-only surface인
    점, v1 fallback이 capability 없이 `enqueueMetaMessage` 하는 점.
- **합의 슬라이스 순서(GPT verdict — 면피용 금지, Q1 단독 선행 금지):**
  1. **Repro/guard 게이트(실패 테스트):** PI_SESSION_ID 있고 socket/record 없는 세션에서 `entwurf_self`/sender envelope가
     `replyable:true`를 못 말하게.
  2. **v1 mailbox fallback capability guard:** legacy `entwurf_send` dead-socket fallback이 self-fetch deliverable
     citizen(claude-code)에만 enqueue하도록. **pi record 도입 전에 먼저** 닫아야 거짓 doorbell wake 방지.
  3. **pi MetaIdentity writer:** session_start에서 garden id 보존 upsert(늦은 file/model은 turn_end attach refresh).
     게이트: idempotent / `gardenId=sessionId` / `--entwurf-control` 없어도 생성 / corrupt·drift fail-loud.
  4. **v2 matrix 게이트:** pi record+alive→fire-forget control send / pi record+absent→owned spawn-bg resume /
     fire-forget dormant reject / peers·fact surface에 dead pi citizen 노출.
  5. **entwurf_self·UI 정직성:** socketPath를 canonical/expected vs alive 구분 렌더, statusbar addressability를
     identity와 분리.
- **검수 라인:** GPT5.5(자문) = `20260614T102904-fe7f37`(live, direct send). CC Opus(3번째) = `20260614T103037-582512`
  (native, meta-mailbox+doorbell) — **다음 턴 합류**. 회신은 doorbell→`entwurf_inbox_read`.
- **read-only 실측 결과(2026-06-14, 코드 무변경) — 위험 그림 크게 완화:** v2 인프라는 이미 pi-complete. 갭은 소수
  honesty 누수뿐.
  - ① `mintMetaIdentity`(meta-session.ts:587)는 **pi backend 수용**(`requireBackendV2`), `model`/`transcriptPath`
    **이미 nullable**. 유일 갭 = `gardenId: generateSessionId(now)`(새 민팅) + `MetaIdentityMintInput`에 `gardenId?` 없음
    → 필드 1개 + 1줄 보존. 🟡
  - ② **pi 전부 ready** 🟢: `META_BACKENDS_V2=["claude-code","antigravity","codex","pi"]`(선언된 4번째 시민),
    `isLivenessSupported("pi")=true`, capability registry에 `pi:{wakeMode:"direct-inject"}`(`pi/entwurf-capabilities.json`),
    `factLivenessOf("pi",socket)` alive/dead/indeterminate 정상.
  - ③ **거짓 확정** 🔴: `buildStrictPiSenderEnvelope`(mcp:273)가 env만 보고 `replyable:true` 하드코딩(socket probe 0),
    `entwurf_self`(mcp:593)는 `existsSync` 없이 socketPath 합성·렌더. (정직 헬퍼 `getActiveSocketPath` mcp:139는
    existsSync-gated로 이미 존재 → 재사용.)
  - ④ **v1 fallback capability 체크 0개** 🔴: `enqueueMetaMessage`(mcp:459) blind enqueue. pi record 생기면 pi에
    enqueue+"doorbell wake" 거짓. (v2 decider/send-fallback은 이미 `wakeMode==="self-fetch"`로 게이트 — **flag 존재 입증,
    CC ① 인프라로 확인**.)
  - ⑤ record-존재 readers(CC ③): `metaRecordExistsByGardenId`→v2 production:196 / `listAllMetaIdentities`→fact-provider
    (peers)·doctor / `readMetaIdentityByGardenId`. **v2 `resolveTarget`(production:194)는 이미 pi 완전 인지**(record+pi
    →liveness route, unsupported→record-side lstat). statusbar(`meta-bridge-statusline.sh`)·entwurf_self는 별도.
  - **결론:** SE-1은 "동등성 모델 부재"가 아니라 **capability-correct 코어를 우회하는 honesty 누수 몇 개**. 작업 = 새 비대칭
    생성이 아니라 기존 capability-aware 기계에 배선. **다음 한 걸음 = 실측+CC 반영 후 슬라이스 1 failing test**(아래 SE-2와
    공통 guard로 묶어 진행).

### SE-2 — 종료/비활성 receiver mailbox 쓰레기 (no active-receiver guard) — ✅ CLOSE (active-receiver guard push 완료, deliverability seam은 CHANGELOG Unreleased에 흡수)

- **출처:** GLG가 GPT5.5에 별도 조사 지시(2026-06-14). 시나리오: GLG가 네이티브 Claude Code 2개를 띄워 대화하다 **하나를
  종료**, 다른 하나가 "작업 끝내고 답장 보낸다". 종료된 세션에 답장이 전달되나? **GLG 의도: 사람이 종료한 세션엔 전달 안 돼야
  하고, 어디에도 쓰레기로 남지 말아야 한다.**
- **현재 동작(GPT 확인):** 종료된 claude-code meta-session에 대한 답장도 **"성공"할 수 있음** — live 전달은 아니지만
  **meta-record 존재만으로** meta-mailbox에 `.msg` enqueue + "delivered/enqueued" 응답. 종료 세션이면 모델엔 안 들어가고
  `~/.pi/agent/meta-mailbox/<garden-id>/*.msg`로 **대기 쓰레기**가 됨.
- **로컬 스냅샷(GPT):** live pi socket `…fe7f37`·`…f77390`; 오늘 새 unread `.msg`/`.delivered` 없음; 미처리 1건 old
  (`…20260605T174659-0497e2 …msg.delivered`). → 이번엔 새 쓰레기 안 생김(원칙상 생길 수 있는 구조일 뿐).
- **설계 판단(GLG, GPT 동의):** human-terminated 세션에 conversational reply는 **기본 reject**. active receiver 없으면
  enqueue 금지. 명시적 archive/mailbox send만 예외.
- **닫을 구멍(GPT):** (1) meta-record exists만으로 mailbox enqueue 허용 금지. (2) claude-code meta-session도
  **active-receiver marker / live-owner pid** 수신가능성 검증. (3) v1 `entwurf_send` fallback + v2 meta-mailbox **둘 다 같은
  guard**. (4) 정직 실패 문구: `"record exists but receiver inactive — not enqueued"`.
- **SE-2의 진짜 난제(실측 연결):** claude-code는 liveness 도메인 **밖**(`unsupported`, socket probe 없음) → pi처럼
  socket-alive로 active 판정 불가. **self-fetch 백엔드용 별도 active-receiver 신호가 필요**(live owner pid / marker
  freshness / lock 등 — reviewer 설계질문). 이게 SE-2 코어.

### 묶음 — SE-1 + SE-2 = 같은 deliverability-guard 표면 (함께 개선)

- **공통 지점:** v1 fallback(`mcp/pi-tools-bridge/src/index.ts:459`) + v2 meta-mailbox 경로. 둘 다 현재 "record exists →
  enqueue → ✓delivered"의 거짓.
- **합성 deliverability 정의(CC ② 3단 + GPT 닫을구멍 + capability flag):**
  `deliverable = capability(wakeMode === "self-fetch") AND active-receiver(수신 가능: live owner / marker)`.
  - **SE-1 몫:** `wakeMode` capability 게이트(pi=`direct-inject` → mailbox 거부, socket route로). flag·등록 이미 존재.
  - **SE-2 몫:** self-fetch citizen(claude-code)이라도 **active-receiver 검증**(종료 세션 거부). socket probe 밖 backend라
    새 신호 필요.
  - CC ②의 `deliverable/delivered/read` 3단에서 **"deliverable"이 "receiver active"를 포함**해야 함 — 이 둘이 합쳐지는 지점.
- **슬라이스 영향:** SE-1 slice 2(v1 fallback guard)를 **"wakeMode + active-receiver" 합동 guard**로 확장. slice 1 replyable
  진실성 정의에도 active-receiver 축이 들어감. slice 4 matrix에 "종료된 self-fetch citizen → reject + no enqueue" 행 추가.
### 묶음 설계 잠금 — GPT 1차 GO + CC Opus 2차 GO (둘 다 실측 기반, 2026-06-14)

- **predicate 협소화(GPT a):** 넓은 `deliverable` 금지. 정확한 이름 = **`mailboxConversationalDeliverable`** /
  `canEnqueueForDoorbellNow`. "나중에 읽을 archival mailbox"가 아니라 "지금 닫힌 세션에 쓰레기 안 남기는 conversational
  reply" 계약. v2 기존 `resolveMailboxDeliverability`도 이 의미로 좁힘.
- **🔴 확정된 살아있는 버그(CC 실측 + 코드 검증):** `pi-extensions/meta-bridge-hook.ts:148`
  `const senderOwners = [process.ppid, parentPid(process.ppid)]` — sender marker를 **ppid + grandparent 둘 다** 기록.
  CC 트리 = [claude CLI(starttime 248977), 로그인 bash 42593(202374)]. grandparent(42593)는 ghostty/i3 아래 세션 종료
  후에도 생존 → claude 죽어도 grandparent 마커가 `processStartKey` 통과 → **"종료 세션 active receiver" false-positive가
  지금 샌다.** GPT (b)는 가설이 아니라 현재 동작. ⇒ 슬라이스에 **기존 dual-owner sender marker 수정**(ppid 단독)을 같이.
- **active-receiver 신호 = 별도 `meta-receiver`(presence) marker(GPT b + CC Q1 검증):** sender marker 재사용 금지.
  담을 것 `{gardenId, backend, nativeSessionId, ownerPid, ownerStartKey, ownerKind, updatedAt, armProvenance}`. owner =
  **watchPaths 구독을 든 claude CLI(= 훅의 `process.ppid` 단독)**, plugin host 아님(네이티브 트리 직결 확인). 선별 불확실
  → fail-closed. 검증 = `processStartKey(ownerPid) === ownerStartKey` + record(garden/native/backend) 일치. pid 단독 금지.
  capability registry 새 축 불요(함수 seam). 부품 이미 존재: `meta-session.ts` `processStartKey()`(1148, field22→
  `linux:<starttime>`) + `writeMetaSenderMarker`의 `ownerStartKey`(1239) + reader 재사용가드(1288 `liveKey!==ownerStartKey→null`).
- **cleanup 훅 없음 → startKey가 load-bearing(CC Q2 검증):** hooks.json 이벤트 = SessionStart/CwdChanged/UserPromptSubmit/
  FileChanged **4개뿐, SessionEnd/Stop 없음.** 종료/SIGKILL 시 record·marker 전부 stale로 남음 → `processStartKey` 일치가
  **유일한 정직 사망탐지기(optional 아님).** cleanup 훅을 1차 방어로 만들지 말 것(SIGKILL에 안 뜸).
- **deliverable = 명시 3-conjunct(CC Q4-1):** `self-fetch(정적) AND ownerPid-startKey-alive(런타임) AND watch-armed(런타임)`.
  ownerPid 살아도 watch 미arm이면 wake 0(UserPromptSubmit-only 경로는 watchPaths 못 냄, SessionStart arm ERROR나도 record는
  landing). "record-fresh"를 deliverable로 승격 금지.
- **arm provenance(CC Q4-2):** presence marker에 어느 이벤트가 arm했는지 기록. SessionStart/CwdChanged=arm가능,
  UserPromptSubmit=record-only(addressability를 active로 올리면 안 됨 — re-arm 불가).
- **reject 게이트(GPT c + CC Q4-3):** "닫힌 claude-code target(record有/receiver無) → **reject** AND 새 `.msg` 0개 AND
  **signal poke 0** AND 타깃 mailbox 파일시스템 **무변이**"(기존 미배달 `.msg` + poke = re-ring 위험까지 차단). **GLG 쓰레기
  방지의 본체.**
- **슬라이스 순서(잠금):** 1·2 분리하되 **같은 release block**에서 닫음.
  1. **replyable 진실성:** pi self/envelope가 live socket 검증 없으면 `replyable:false`/`wants_reply` reject, socketPath
     expected vs alive 구분. **failing test 필수 행(CC ④): "record有+owner-dead(startKey 불일치)→false", "record有+
     watch-unarmed→false"** (전부-부재 행만으로는 슬라이스 3 착지 후 green인데 regress).
  2. **합동 mailbox guard:** v1 fallback(mcp:459) + MCP v1 + pi-native v1 + v2 decider/send-fallback이 **같은 pure
     predicate**(`mailboxConversationalDeliverable`) 사용. self-fetch라도 activeReceiver false면 enqueue 0. + dual-owner
     sender marker 수정.
  3. **pi writer:** `gardenId=sessionId` 보존 upsert. `mintMetaIdentity`에 `gardenId?` 추가하되 **non-pi는 기본 generate,
     pi caller만 explicit id 허용+검증**. idempotent attach, backend drift fail-loud.
  4. **matrix:** pi record alive/dead v2 cells + "v1 fallback이 pi record에 blind enqueue 안 함" + 위 reject 게이트.
     golden case = 이 cwd 실측 배치(CC ⑤).
  5. **UI/status/self 정직성:** identity glyph(🪛<id>) vs addressability glyph 분리.
- **슬라이스 1 DONE(로컬, 미커밋 — slice 2와 같은 release block에서 GLG가 커밋. 세션 #10, 실무자 CC Opus `20260614T122715-6adf55`
  + GPT5.5 `…122717-bdfe6e` code GO):** failing test→green. (a) NEW `pi-extensions/lib/entwurf-self-address.ts` PURE
  `computeSelfAddressability(facts)` — pi=socketAlive / meta=recordBacked∧ownerAlive∧watchArmed(미정의=fail-closed) /
  external=false. "alive"=existsSync-level(canonical path 존재)이며 listener probe는 후속 hardening(주석 명시). (b) NEW
  `scripts/check-entwurf-self-address.ts` 18 checks — pure 진실표 + 필수 RED 행(record有+owner-dead / record有+watch-unarmed)
  + buildStrictPiSenderEnvelope **함수 body로 좁힌** 소스가드(replyable:true 하드코딩 제거 + computeSelfAddressability +
  canonical socket(ENTWURF_DIR+sessionId+SOCKET_SUFFIX) existsSync) + entwurf_self existsSync. (c) `mcp/.../index.ts`:
  buildStrictPiSenderEnvelope가 existsSync→predicate→replyable, entwurf_self가 alive vs "expected — not alive" 렌더(합성
  socketPath 거짓 제거). (d) **detour 속 detour:** `smoke-meta-mailbox` Case A가 빈 PI_ENTWURF_DIR로 pi sender를 socketless로
  두면서 replyable이라 단언 = SE-1 옛 거짓을 인코딩 → sender 자기 socket touch로 honestly replyable + target-socket-부재 명시
  assert(면피 아닌 원칙 fix, GPT GO). (e) run.sh+package.json 배선, check-pack 151→**153**, 전체 `pnpm check` EXIT=0.
- **슬라이스 2 진행(전부 GPT design+code GO, 로컬 커밋·미push — slice 1과 같은 release block):**
  - **DONE ✅ 2a** `36faa97` dual-owner: `meta-bridge-hook.ts` sender marker write `[ppid, parentPid(ppid)]`→**ppid 단독**.
  - **DONE ✅ 2b** `7cac9e3` meta-receiver presence marker: `meta-session.ts`에 `defaultMetaReceiversDir`+`MetaReceiverMarker`+
    `write/readMetaReceiverMarker`(garden-id 키, atomic 0600, dead-owner startKey guard), hook arm 지점 write(ppid 단독,
    armProvenance=session-start|cwd-changed|file-changed, UPS 제외 fail-closed). gate `check-meta-receiver-marker` 26.
  - **DONE ✅ 2c** `be4e859` PURE predicate: NEW `entwurf-deliverability.ts` `computeMetaReceiverActive`(공유 atom) +
    `mailboxConversationalDeliverable`(=self-fetch ∧ active). self-address가 atom 공유(SSOT). tsconfig fence 2개 추가.
    gate `check-entwurf-deliverability` 18.
  - **DONE ✅ 2d-1** `0877099` guarded enqueue wrapper: NEW `entwurf-mailbox-guard.ts` `gatherMailboxDeliverabilityFacts` +
    `guardedMailboxEnqueue`(deliverable일 때만 injected enqueue). gate `check-entwurf-mailbox-guard` 15(pure 0-call +
    tmpdir 스냅샷). **additive — 배선 전.**
  - **DONE ✅ 2d-2a** `4b934e6` MCP `entwurf_send` fallback → guardedMailboxEnqueue(isError "not conversationally deliverable").
    consumer wiring 소스가드 + 두 smoke(meta-mailbox·meta-sender-identity) 갱신: 타깃에 active receiver marker(owner=$$) +
    "record有 marker無 → reject + mailbox 무변이"(SE-2) 행.
  - **DONE ✅ 2d-2b** `a098669` pi-native `entwurf_send` fallback(`entwurf-control.ts`) → guardedMailboxEnqueue via **non-literal
    dynamic import**(root-tsc fence 제약, entwurf-v2-surface 패턴). body는 closure 밖 계산(params.message narrowing). 
    `check-entwurf-send-mailbox-fallback` wiring 갱신(dynamic guarded import, no static import, enqueue가 guard 안). 
    **→ v1 conversational 경로(MCP+pi-native) SE-2 쓰레기 방지 완전 강제.**
  - **DONE ✅ 2d-3(로컬 커밋 `0b6455d`+`df9a93f`, push 대기 — 세션 #11, 실무자 후임 Opus `20260614T141824-d242bf`
    + GPT5.5 `…122717-bdfe6e` design GO → code GO):** active-receiver 차원을 v2 dispatch에 **REQUIRED injected seam**으로.
    컴파일이 모든 호출자 강제 → SE-2 갭 부활 불가(=정책으로 막음, 코드 산더미 아님). 한 것:
    1. `entwurf-deliverability.ts`: NEW PURE `receiverMarkerMatchesIdentity(marker, identity)` — structural `ReceiverIdentityFacts`
       (gardenId/backend/nativeSessionId, meta-session 타입 import 0, equality-only). null/undefined/drift 전부 fail-closed. **v1·v2 공유 SSOT.**
    2. `entwurf-v2-decider.ts`: `DispatchDeciderDeps.mailboxDeliverabilityFor:(identity)=>MailboxDeliverabilityResult|Promise` **required**;
       unsupported path가 `await deps.mailboxDeliverabilityFor(identity)`→resolveDispatch(intent,"unsupported",m.deliverable).
       `resolveMailboxDeliverability`→**`resolveMailboxWakeModeCapability`** rename(helper만, decider 직접호출 0). **decider의 `capabilityFor` dep 제거**(deliverability seam이 capability 캡슐화 → dead seam 안 남김).
    3. `entwurf-v2-send-fallback.ts`: 같은 required seam, line 104 → `await deps.mailboxDeliverabilityFor(identity)`. `capabilityFor` dep + metaCapabilityFor import 제거.
    4. `entwurf-v2-production.ts`: `ProductionEntwurfV2Seams.readReceiverMarker`(default `readMetaReceiverMarker`). closure 1개
       `mailboxDeliverabilityFor`=metaCapabilityFor(backend).wakeMode + recordBacked:true(by construction, GPT 확인) + `receiverMarkerMatchesIdentity`(marker↔identity) → `mailboxConversationalDeliverable`. **같은 closure를 deciderDeps + controlSendDeps.deadFallback 양쪽 주입(drift 0).**
    5. `entwurf-mailbox-guard.ts`: `gatherMailboxDeliverabilityFacts`도 같은 helper로 marker↔identity 검증(v1 presence-only 거짓 닫음 — 보너스 동시 적용).
    6. contract: resolveDispatch(boolean)만 봐서 **무영향**, 주석만 "target/capability/**presence** layer ... required seam"으로 보정. taxonomy=`mailbox-undeliverable` 유지(미확장).
    - **detour-in-detour:** `check-entwurf-mailbox-guard`의 `liveIdentity`가 `mintMetaIdentity`(랜덤 gid)였는데 marker↔identity 검증 들어가니
      gid 불일치로 옛 "deliverable" 테스트 깨짐 = presence-only 거짓을 인코딩하던 테스트. 면피 아닌 honest fix(GARDEN 고정 객체 + drift 행). GPT 동의.
    - **gates(새 파일 0, 기존 5개 확장):** deliverability 18→**24**, mailbox-guard 15→**20**, decider →**107**, send-fallback →**26**, production →**23**.
      decider SE-2 RED행=self-fetch citizen+seam false→mailbox-undeliverable+seam 1회+no lock/probe. production E2(marker absent→rejected+enqueue 0-call+release1)/E3(drift→rejected).
    - **검증:** typecheck 3-config / biome clean / `pnpm check` EXIT=0 / check-pack 158 불변. **GPT code GO, blocker 0.**
  - **DONE ✅ 2e(로컬 커밋 `b2f55d1`, push 대기 — 세션 #11, 후임 Opus + GPT5.5 design GO → code GO):** 남은 `replyable:true`
    하드코딩 3곳을 honest replyability로. **2f(옛 소스가드 갱신) 흡수.**
    - **2e-a (native pi, `entwurf-control.ts`):** NEW `decoratePiSenderAddressability(sender, compute)` — canonical 소켓
      `existsSync(getSocketPath)` → `computeSelfAddressability(pi-session)` → `replyable:self.replyable`. 두 call site(entwurf_v2
      senderProvider, legacy mailbox fallback) 모두 `ENTWURF_SELF_ADDRESS_MODULE` non-literal dynamic import 경유(root-tsc fence).
    - **2e-b (MCP meta-self, `buildTrustedMetaSenderEnvelope`):** sender marker=identity 권위까지만; replyability는 receiver
      presence marker `readMetaReceiverMarker(gardenId)` + `receiverMarkerMatchesIdentity` → `computeSelfAddressability(meta-session)`.
      **record backed but receiver inactive → meta identity 유지 + replyable:false**(null degrade 금지 = who-sent 보존, GPT 주의).
      `entwurf_self`는 sender.replyable 그대로 렌더 → 자동 따라옴. production.ts opts 주석도 보정.
    - **2e-c (smoke E2E, `smoke-meta-sender-identity`):** sender 자신 receiver inactive(C record-only) → `entwurf_self`가 meta
      identity 유지 + replyable:false + wants_reply=true reject(`sender.replyable===false` flag 기반) + ff 통과. regression
      "inactive→external-mcp degrade"를 runtime이 잡음(GPT 권고).
    - **gates(새 파일 0, 기존 3개 확장):** v2-surface 32→**34**, send-mailbox-fallback →**26**, self-address 18→**24**.
    - **🐛 body-render 후속 DONE ✅(세션 #11, 후임 Opus `…152031-e914f2` + GPT5.5 code GO, 로컬 미커밋 — push 대기):**
      `formatMetaMailboxBody`가 `replyable:false`면 origin 무관 항상 `(external, non-replyable)` 렌더 → meta non-replyable이 body에서
      "external"로 흐려지던 흠. envelope(`origin:meta-session`)는 원래 정직, 렌더만 부정확했음. surgical fix(2 files, +17 -3):
      `meta-mailbox-body.ts` non-replyable 브랜치에서 `isMeta`면 `(meta-session, non-replyable)`, 아니면 `(external, non-replyable)` 유지.
      external-mcp/pi-session 기존 의미·모든 replyable 브랜치 불변, envelope/taxonomy 변경 0. regression 2행
      (`send-mailbox-fallback` 26→**28**: meta non-replyable이 `meta-session, non-replyable` 포함 + `external`로 degrade 안 됨).
      커밋 메시지 = `fix(entwurf): preserve meta origin for non-replyable mailbox senders`.
    - **검증:** typecheck 3-config / biome clean / `pnpm check` EXIT=0 / check-pack 158. **GPT code GO, blocker 0.**
  - **release block 마감(닫힘):** native hardcode 0 · 옛 소스가드 0 (2e가 2f 흡수) · body-render 후속까지 닫힘. **다음 = GLG
    push → 노트북 pull → 줄기 5d-5 LIVE matrix 복귀.** detour SE-1/SE-2 본체 종료.

### SE-3 — 정직한 replyable:false가 버그로 오인됨 (silent degraded addressability) — 🟡 OPEN (가독성)

- **출처(2026-06-14 세션 #14, thinkpad 실측):** mid-session에 `./run.sh install-meta-bridge` 재배포 후, 실무자
  네이티브 CC 세션(`20260614T154633-dee9ef`)의 `entwurf_self`가 `replyable:false`로 떨어짐. GPT에 `entwurf_send`는
  `✓ delivered`(control-socket direct)인데 **회신을 garden-id로 못 받음** → GLG가 "재배포로 버그 생겼나" 의심.
- **근본원인(버그 아님 — SE-2가 정직하게 동작):** `replyable`은 SE-2 slice 2e-b(`index.ts:332`)에서 **별도 사실** =
  "내 receiver watch가 armed인가"(`~/.pi/agent/meta-receivers/<gid>.json` 존재+owner-alive+watch-armed). 재배포가
  receiver marker를 리셋했고, **재배포 *이전* 시작된 세션은 mid-session이라 re-arm 못 함** → marker 부재 →
  정직하게 false. **resume(SessionStart 훅 재실행)하면 새 writer로 re-arm → replyable:true 복구**(실측: 같은 gid가
  false→true, marker 16:49 생성).
- **왜 detour:** 로직은 맞다. 문제는 **표면이 침묵**해서 일시적 degraded(재배포→unarmed)와 구조적 2등(SE-1)을
  구분 못 하고 둘 다 그냥 `false` → 사람이 "버그/회귀"로 읽음. **Crash-Don't-Warn의 사촌: 정직한 no인데 *이유*가 없어
  오진을 부른다.**
- **GLG 지시:** "뭔가 안 되는 표시를 해야겠다. 🪛를 상태에서 빼버리든가." → 정확히 SE-1 Q4/slice5 방향(🪛=identity/
  model-lock 유지, **addressability는 별도 glyph**: `control:alive`/`citizen:dormant`/**`no-inbound`**)과 수렴.
- **제안 fix (SE-1 slice 5에 folding — 별도 메커니즘 만들지 말 것):** ① `entwurf_self`가 replyable:false면 **machine-readable
  reason code + human hint 둘 다** 동봉(문자열만 주면 나중 gate가 약해짐 — GPT 보강). reason taxonomy:
  `receiver-unarmed`(resume/new to re-arm after redeploy) / `no-inbound-path`(SE-1: --entwurf-control 또는 meta-bridge로
  시작) / `owner-dead` / `watch-unarmed`. ② statusbar/세션명 addressability를 **identity glyph `🪛<gid>`(model-lock 전용)와
  분리**한 별도 라인/필드로: `replyable:true` | `replyable:false (<reason>)`. ③ (운영) 이관 체크리스트 "재배포 → 세션 새로
  열기/resume → doctor" 순서 강조 — 우리가 "세션 열기"를 빼먹어 재현됨.
- **검수 잠금(2026-06-14 세션 #14, GPT5.5 `20260614T163106-01a6e2`):** **A + Q2 후자 + D4 영향 없음**으로 GPT GO.
  Q1=slice 5 folding(단독 B로 D4-b 앞에 surface change 끼지 말 것, 본질이 addressability honesty 렌더라 slice 5 소유물).
  Q2=lazy re-arm 반대(armed는 수신측 watch/doorbell capability 사실 — 발신 시점에 위조/복구 금지, SE-2가 닫은 "record
  exists→deliverable 착각"의 재도입 위험). Q3=release_gate/D4-c 무영향(D4-b는 reply round-trip이나 human-readable
  reason에 의존하면 안 되고 transport/lock/enqueue만 본다). **결론: 버그 아님 = 정직한 degraded state의 설명 부족. 지금은
  기록만, D4-b 계속 GO.**
- **자동화 함의:** reply 라운드트립 *행동 테스트*를 짤 땐 수신측이 재배포 후 fresh/resume 세션이어야 함을 전제로 박을 것.

## 전달지침 — 새 담당자(2026-06-13 세션 #9 → 후임 세션 #10)

- **세션 #9 진행분(재검증 + NEXT 재편, push 완료):** 실무자 Opus(로컬 세션, garden `20260613T154121-c98fc3`) + GPT힣
  (새 세션 `20260613T154104-99b405`, live pi direct) 페어로 5d-2~5d-4 전체를 read-only 재검증했다. **HEAD: oracle 세션이
  doctor pipefail fix 2건을 main에 머지 → `134ff76`→`a2bd5c6`(ff, `3a01fbd` 빈 store + `a2bd5c6` baked-node parse를
  `{ … || true; }`로 pipefail-abort 봉합 — fresh install에서도 doctor가 끝까지 + v2 섹션 실행).** 감사 결과 빈 곳 3개
  (트리오 수렴, GREEN 재확인: `pnpm check` EXIT=0 / check-pack 150 / v2-surface 32 / `LIVE=1 smoke-entwurf-v2-spawn-live`
  7/7):
  - **G1a/G1b(게이트 갭, load-bearing):** MCP 서버(`mcp/pi-tools-bridge/src/index.ts`)는 빌드 없이 `node
    --experimental-strip-types`로 직접 부팅하며 v2 fence 그래프 전체를 top-level static import한다. 그런데 서버를 실제
    부팅하는 `check-bridge`(→`test.sh`)는 **`pnpm check` 밖**이고(`check-mcp`는 `normalizeMcpServers()` 순수검사, 서버
    부팅 안 함), `test.sh` EXPECTED_TOOLS엔 `entwurf_v2`가 없다. 즉 fence 그래프에 strip-types-금지 구문(enum/namespace/
    parameter property/`import=`)이 들어와도 `pnpm check`는 green인데 MCP 서버는 부팅 크래시 = 회귀 방어 갭. (오늘 그래프는
    hostile 구문 0개로 클린, 수동 부팅으로 entwurf_v2 등록·스키마 실증.)
  - **G2(benign):** doctor 유일 FAIL = `deployed writer STALE`. 13줄 drift = 5d-2b가 추가한 `metaRecordExistsByGardenId`
    한 블록, dispatcher(source import)만 소비, **SessionStart write-path 바이트 동일** → correctness 아닌 redeploy 위생.
    `install-meta-bridge`로 해소(oracle 2커밋과 직교).
  - **G3(doc):** prefixRoots seam 주석 3곳 stale(`mcp/.../index.ts:559`, `entwurf-control.ts:1484-85`, `surface.ts:58-61`)
    — "5d-4 wires through this opts seam"인데 실제론 adapter env-fallback(`surface.ts:172`)으로 갔다.
  **NEXT 재편(아래 ◀ NOW):** 원래 NOW였던 5d-5 LIVE matrix 앞에 deterministic·auth-불요 hardening 배치(`5d-5-pre`)를
  먼저 둔다 — G1을 먼저 닫아야 LIVE 실패 원인이 분리되고 doctor PASS가 release-gate를 깨끗하게 한다. **검수 라인(세션 #9):**
  GPT힣 = `20260613T154104-99b405`(live pi direct), Fable5 여전히 응답 불가. 회신은 doorbell→`entwurf_inbox_read`.
- **후임자에게(세션 #9 인계):** 어서 와. 세션 #8은 **5d-2 + 5d-3 + 5d-4를 전부 닫았다**(트리오 = 실무자 Opus + GPT힣
  `20260613T121021-03a5d7`, Fable 부재). 5d 블록은 이제 **5d-5 하나만 남았다.** 흐름: 5d-2(`runEntwurfV2` +
  `makeProductionEntwurfV2Deps` + RPC 추출) → 5d-3(pi-native + MCP 두 surface, 통합 경계 Option A로 봉합) → 5d-4(doctor
  섹션 + `PI_ENTWURF_PREFIX_ROOTS` SSOT). 매 슬라이스 GPT design GO → code GO, **GPT 검수에서 실 blocker 2개 잡힘**
  (QB3 spawn releaseFn split-brain, B1 pi target pre-lock lstat). **네 첫 한 걸음 = ◀ NOW(아래 5d-5). 5d-5는 LIVE=1
  matrix라 design은 GPT랑 잠그되 LIVE 실행은 GLG 환경과 조율**(auth/model/실 pi 세션). 그 전에 이 섹션 + 아래 `5d-2/3/4
  done` 요약 + `## Current state` 맨 위만 읽으면 이어받는다. **세션 #8 커밋: `8e9aa66`·`18fe0e2`·`7a0414e`·`1476cbd`(5d-2,
  push 완료) / `bc3743e`·`562f10e`·`4140394`(5d-3, push 완료) / `e42f9f0`·`3ac4476`·`4829935`(5d-4, push 대기).**
- **세션 #7 인계분(직전, push 완료):** 5c 전체 + 5d-1(execute-router)을 닫고 push까지 끝냈다. (1) 5c-4
  meta-mailbox send `730b578` (`executeMetaMailboxSend` + `makeProductionSendViaMailbox`, gate 28). (2) **5d-1a** send-hand
  N1/N3 보강 `e0c6e75`(`rejectReason` carry + `SendDeliveredReleaseFailedError`, send gate 46→**49**). (3) **5d-1b** pure
  execute-router `97704c9`(`entwurf-v2-runner.ts`: `executeDispatch(decision, deps)` → outcome-rich `EntwurfV2RunResult`,
  gate **23**). 전부 GPT design GO → code GO(5d-1b는 mailbox `success:false` silent-success blocker 1개 봉합 후 GO).
  `pnpm check` EXIT=0, check-pack 140→**144**. Fable 부재로 GPT 페어 검수. **5개 커밋 push 완료(GLG 승인).**
  **네 첫 한 걸음 = ◀ NOW(아래 5d-2). 5d-2는 ctx/실IO 조립 슬라이스라 코드 전에 GPT랑 design부터 잠가라**(pure-before-IO
  경계를 5d-1에서 의도적으로 끊었다). 그 전에 이 섹션 + `## Current state` 맨 위 항목만 읽으면 바로 이어받는다.
- **세션 #6 인계분(직전, 전부 push 완료):** 5c-3 전체(spawn-bg resume 경로) — watcher(`222f4d0`) + resume-argv
  SSOT(`314a334`) + R1 path-core(`e9d12df`) + production adapter(`6e8b9ba`) + live phase-gate smoke(`410110d`). 전부
  GPT 검수 GO. 게이트 spawn-production 38 / socket-discovery 58 / resume-args 28 / live smoke 7.
- **검수 라인 상태(중요):** Fable5(`20260613T064858-0dc14b`)가 Anthropic 쪽 이슈로 **응답 불가**(GLG 조사 중).
  GPT힣은 이전 세션(`063959-cfdcff`)이 컨텍스트 차서 **현재 `20260613T121021-03a5d7`(live pi, direct)**로 인계됐다 —
  이 세션이 5b·5c 전체 맥락을 갖고 있으니 **이 garden id로 계속 검수받아라**(fresh면 다시 브리핑). Fable 복귀 전까진
  **GPT힣 + 실무자 페어**(Fable 합류 전 원래 모드). 세션 #6 입증: 실무자가 판단 중심 잡고 GPT를 1차+사실상 2차로
  같이 돌리면, Fable 없이도 production lifecycle 결함(B1 spawn-started, B2 fast-exit)까지 다 잡힌다. **천천히, 매
  슬라이스 design→코드 둘 다 GPT에 통과시키고 커밋.**
- **세션 #8 진행분(5d-2 전체 done, 로컬 커밋 — push 대기):** GPT힣(`20260613T121021-03a5d7`)과 트리오로 5d-2를 3슬라이스로
  닫았다. (1) **5d-2a** pure `runEntwurfV2(input,{decide,executor})` `8e9aa66` — GPT Q1 보정대로 `DispatchDeciderDeps`가
  아니라 **decide 함수 주입**(composition contract만 증명), decide-throw propagate, gate runner 23→**33**. (2) **RPC 추출
  micro-slice** `18fe0e2` — `--entwurf-control` 프로토콜(`SenderEnvelope`+Rpc*+`sendRpcCommand`)을 ctx-free SSOT
  `lib/entwurf-control-rpc.ts`로 behavior-preserving 추출(control.ts −166/+31, re-export, 호출처 6곳 무변경), gate
  `check-entwurf-control-rpc` **11**(소스가드+round-trip+close-before-response). (3) **5d-2b** `makeProductionEntwurfV2Deps`
  `7a0414e` — ctx-free production 조립, gate **18**. 셋 다 GPT design GO → code GO. **5d-2b는 GPT 코드검수서 실 blocker
  B1(pi target pre-lock lstat) 잡혀 봉합 후 GO.** `pnpm check` EXIT=0, check-pack 144→**148**.
- **세션 #8 5d-3 done(두 surface, 로컬 커밋 — push 대기):** 5d-3a pi-native `bc3743e` + 5d-3b MCP `562f10e`. 통합 경계
  발견·봉합: entwurf-control.ts(root tsc, emit-capable)가 fence `runEntwurfV2`를 static import하면 fence의 `.ts` import가
  root program에 끌려와 **TS5097** → GPT와 **Option A** 잠금: surface glue를 ctx-free fence `lib/entwurf-v2-surface.ts`
  (`toDispatchInput`/`renderEntwurfV2Result`/`runAndRenderEntwurfV2FromSurface`)에 두고, pi-native는 **non-literal dynamic
  import**(`const M="./lib/entwurf-v2-surface.ts"; await import(M)`)로 root tsc static pull 회피(TS5097 닫힘 유지), MCP는
  fence 소비자라 static import. 두 surface 다 같은 surface adapter 소비. senderProvider: pi-native=`buildLocalSenderEnvelope(ctx)`
  +`{origin:pi-session,replyable:true}` decorate / MCP=`buildSendSenderEnvelope()` verbatim(replyable gate 없음). MCP는
  in-process(Q1) — decider가 transport 결정, legacy rpcCall/enqueue 직접 호출 안 함. gate `check-entwurf-v2-surface` **25**
  (map/render/ctx-free + case4 pi-native wiring + case5 MCP wiring). 둘 다 GPT design GO → code GO. `pnpm check` EXIT=0,
  check-pack 148→**150**.
- **세션 #8 5d-4 done(로컬 커밋 — push 대기):** 5d-4a doctor `e42f9f0` + 5d-4b prefixRoots `3ac4476`. 5d-4a =
  `meta-bridge-doctor.sh`에 `[entwurf-control / v2 dispatch surface]` 섹션(pi-native flag + entwurf_v2 tool + MCP verb
  source 체크 + `check-entwurf-v2-surface` 단일 gate 실행; live turn은 5d-5, `pi --help` grep 회피). 5d-4b = 공유 env
  **`PI_ENTWURF_PREFIX_ROOTS`** SSOT — ctx-free fence `parseEntwurfPrefixRootsEnv`(`path.delimiter` split·trim·drop-empty·
  unset→[]·**no throw**, typo는 verbatim 유지=preflight normalize가 fallback), `runAndRenderEntwurfV2FromSurface`에서
  `opts.prefixRoots ?? parse()`로 양 surface 공통 배선, agentDir undefined 유지, doctor는 env display only(parser 재구현 X).
  gate 25→**32**. 둘 다 GPT GO. `pnpm check` EXIT=0, check-pack 150. **doctor 전체는 기존 installed-writer-stale로 FAIL
  (install-meta-bridge 재배포 영역, 세션 #8 변경 무관) — 새 v2 섹션 5/5 OK.**
- **지금 할 일:** ◀ NOW = **5d-5 LIVE matrix**. (그 앞단 **5d-5-pre hardening + deploy hygiene 둘 다 DONE** — 아래 참조.)
  **5d-5-pre hardening 배치 DONE·push 완료(`7a4ed48..ec7c688`, 매 슬라이스 GPT design→code GO).** 트리오 근거: G1을
  먼저 닫아야 LIVE 실패 원인이 "실 lifecycle"인지 "MCP boot/schema 회귀"인지 분리되고, doctor PASS가 release-gate를
  깨끗하게 한다. **5d-5-pre 커밋(전부 push):**
  1. `27bef33` `docs`: G3 prefixRoots-seam 주석 3곳(`index.ts:559`·`entwurf-control.ts:1484-85`·`surface.ts:58-61`)
     → opts seam이 아니라 adapter env-fallback(`PI_ENTWURF_PREFIX_ROOTS`)이 SSOT임 반영.
  2. `418325c` `test(mcp)`: 신설 `check-pi-tools-bridge-boot` gate(start.sh 부팅 + `tools/list` + `entwurf_v2`
     presence·schema deep-assert: props target/intent/message/mode/wants_reply, required target/intent/message, intent/
     mode enum set-equality; tools/list만→side-effect/auth 없음) → `pnpm check` 편입(check-entwurf-v2-surface 뒤),
     check-pack 150→**151**. `check-bridge`/`test.sh`는 broad negative suite 유지, EXPECTED_TOOLS + `validate_pi_tools_bridge`
     expected에 `entwurf_v2` presence만 추가(D1=A안). 게이트 **12 checks**. **G1a/G1b 닫힘.**
  3. `0dfe4d0` `test(smoke)`: oracle deferred `run.sh:1040/1077` turn{1,2}_acp pipefail-abort guard — 파이프 끝 `|| true`로
     emptiness가 기존 `[[ -z ]]`/`[[ != ]]` 진단 가드로 흐름(성공 경로 no-op). oracle doctor :153/:89 idiom.
  4. `88b679a` `fix(doctor)`: A3b — installed `CACHE_HOOKS` 존재 + BAKED command parse 불가 = drift → `warn`에서 `bad`로
     승격(store-churn guard blind = verify-impossible은 fail-loud); hooks.json 부재(설치 전)는 `warn` 유지. parse 성공 시 무변경.
  5. **ops DONE(commit 아님):** `./run.sh install-meta-bridge` 실행 완료 → `doctor-meta-bridge` **PASS**(ok 26, FAIL 0,
     `deployed writer matches source (v2) e132bc98` — G2 해소). v2 dispatch surface 섹션 ok. **deploy hygiene 닫힘.**
  **그다음 5d-5 LIVE matrix(headline):** (a) MCP in-process spawn-bg path 실증(부팅·schema 절반은 G1 boot gate가 이미
  닫음), (b) pi-native dynamic import path 실증, (c) release-gate matrix — sender surface(pi-native tool / MCP verb) ×
  target kind(alive pi / dormant pi / unsupported citizen) × direction에서 lock acquire→release ×1, lock-retained 진단
  표면화. **LIVE=1 영역**(auth/model/실 pi 세션) — design은 GPT 잠금, LIVE 실행은 GLG 조율. **LIVE 직전 체크포인트(비봇
  관찰): 어느 백엔드/모델로 실 pi 세션을 띄워 spawn-resume·send를 실증할지 환경부터 고정**(모델 상황 유동 — Fable 차단,
  Opus 복구). **D5(완료): `LIVE=1 ./run.sh smoke-entwurf-v2-spawn-live → 7 passed`.**
  **결정 확정:** D1=신설 boot gate(A안)✅ / D2=BAKED drift→`bad`✅(GLG 확정) / D4=pi dev pin bump 안 함(B2, peer
  `>=0.79.1`이 runtime 0.79.2 이미 허용 + `check-dep-versions` devDep==peer floor 강제)✅. **남은 결정:** D3=브랜치
  `verify/doctor-pipefail-and-pi-0.79.2`는 deferred 일부(`run.sh:1040/1077`) 흡수 완료 후 삭제 — 나머지 deferred
  (`smoke-meta-prune:138`, `smoke-resident-garden-guard:80/149/223/347/348`)는 후속.
  **후속(GPT 권고):** `test.sh` pre-existing 1-failure(entwurf registry "unregistered tuple" — 환경/별개, 5d-5-pre 무관)는
  `check-bridge`를 나중에 release-gate에 넣을 때 발목 잡을 수 있으니 별도 후속으로 추적.
- **5d-1 done 요약(`e0c6e75` 5d-1a + `97704c9` 5d-1b, GPT GO):** 5d-1a = send-hand result에 N3 `rejectReason`(dead
  fallback resolver reason carry; in-band refuse는 reason 없음) + N1 `SendDeliveredReleaseFailedError`(non-failed
  outcome 후 releaseLock throw = delivered+lock-dirty 구조화, bare rethrow 대체; `failed`는 original error 우선 유지).
  5d-1b = `entwurf-v2-runner.ts` `executeDispatch(decision, deps)` pure router — reject→실행 없이 receipt+diagnostic
  carry / control·spawn·mailbox는 `decision.lock` verbatim으로 해당 hand 호출(runner lock 재판단 ❌, hand fail-loud) /
  결과 `EntwurfV2RunResult`(rejected | executed{transport-tagged outcome} | execution-failed{finalizedOutcome?,
  releaseFailed?, retrySafe:false}) / spawn `lock-retained`는 executed로 ride / **mailbox `success:false`=계약위반
  fail-loud**(silent success ❌) / retrySafe 항상 false(indeterminate double-delivery 위험). deps = 3 hand 주입,
  실 IO 0. 게이트 send 49 / runner 23.
- **5c-4 done 요약(`730b578`, GPT design GO → code GO):** enqueue-only meta-mailbox send. 신규
  `pi-extensions/lib/entwurf-v2-mailbox.ts`(ctx-free, dep-injected): `executeMetaMailboxSend(plan, sender, deps)` —
  sender 있으면 `formatMetaMailboxBody(sender, plan.message, **plan.wantsReply**)`(legacy hard-false 탈피, 의도적
  divergence)·없으면 raw `plan.message`; `deps.enqueue({gardenId: plan.targetGardenId, body, sessionsDir, mailboxDir})`
  verbatim; `{success:true}` 고정; **enqueue throw는 propagate**(mailbox엔 in-band refuse 없어 success:false 안 만듦) —
  send hand가 throw→failed+rethrow. `makeProductionSendViaMailbox({senderProvider, enqueue?})` = async adapter, **lock
  미접근**(release는 hand 단독), default enqueue=`enqueueMetaMessage`. **release seam·routing seam 둘 다 구조적 부재.**
  소비자 ① send hand `deps.sendViaMailbox(plan, lock)` fallback(`entwurf-v2-send.ts:199`) ② 5d runner의 direct
  meta-mailbox 경로(lock null). 게이트 `check-entwurf-v2-mailbox` **28**(enqueue 인자·wantsReply yes/no·envelope-less
  raw·throw-propagate·**poison-lock 미접근**·adapter throw→rejected-promise·소스 가드 no-release/no-routing). tsconfig
  exclude fence(send/decider와 동일) + run.sh + package.json 배선. check-pack 140→**142**, `pnpm check` EXIT=0.
- **5c-3c done 요약(`e9d12df` R1 + `6e8b9ba` adapter + `410110d` live smoke, 전부 GPT GO):** R1 =
  `inspectControlSocketPath(socketPath,lstatFn)` path-core 추출(watcher가 plan.expectedSocketPath를 gid 재유도 없이
  inspect), `inspectTargetControlSocket`은 thin wrapper. adapter = `makeProductionSpawnBgResumeDeps(opts)`(plan/lock
  캡처 안 함=D3) — `socketWatchVerdict`(addressConflict→forged/alive→alive/dead·indeterminate→wait) + spawnChild
  (buildResumePiArgs v2-control, **B1: spawn event 대기 후 resolve·error면 reject**) + awaitSocketAlive(exact path 폴링,
  forged 즉시 reject·connect 안 함) + awaitChildExit(**B2: proc 생성 즉시 resolve-only exitPromise 설치 → fast-exit 안
  놓침**) + awaitTimeout(setTimeout+abort clear) + killChild(SIGTERM). 게이트 check-entwurf-v2-spawn-production **38**,
  check-socket-discovery 47→**58**. **live smoke(체인 밖, LIVE=1) 7 checks: S1 실 unix socket connectability(실 lstat+probe)·
  symlink forged·absent abort / S2 실 child spawn-event resolve+SIGTERM kill+exit 관측 / S3 실 timeout→kill→child-exited→
  release×1.** real-pi resume E2E는 5d surface matrix가 증명(D5 phase gate split).
- **5c-3c 진입 시 이월 계약(세션 #6 검수에서 도출):**
  - **(Fable, bounded-return)** watcher의 bounded return은 `awaitTimeout` dep이 실제로 settle한다는 계약에 의존한다.
    5c-3c에서 `awaitTimeout`을 setTimeout 기반(+abort 시 clearTimeout)으로 잇고, `awaitSocketAlive`/`awaitChildExit`는
    AbortSignal을 존중해 teardown 되게 하라(게이트로 증명 불가한 실 IO 영역 — smoke로 박을 것).
  - **(GPT, 비차단)** 현재 5c-3a 게이트는 AbortSignal을 타입/호출 형태로만 강제하고 `controller.abort()` 호출 자체는
    카운트하지 않는다. 5c-3c 실 watcher 붙일 때 **loser watcher가 abort를 존중하는 smoke/gate**를 별도로 둬라.
  - **(5c-3a 설계 계약)** killGraceMs는 plan이 아니라 watcher dep config(라우팅 결정 아님 → decider plan 무수정). retained
    진단은 gid/pid/expectedSocketPath/lockPath/observeTimeoutMs/killGraceMs를 싣는다 — 5d surface가 이걸 렌더해 운영자가
    target-locked lock을 관측·정리하게 해야 한다(F2-P2).
  - **(5c-3b 이월, GPT 비차단)** `--no-extensions` 제거로 v2 자식은 settings extensions + `-e <self>`가 같이 들어갈 수
    있다. 지금은 #29 provider-resolution footgun이 더 load-bearing이라 양 variant `explicitExtensionArgs` verbatim 보존이
    옳음. 5c-3c adapter smoke에서 실제 중복 로드가 provider registration conflict를 만들면 builder가 아니라
    `getEntwurfExplicitExtensions`에 dedup/intent를 넣어 풀 것(builder는 verbatim spread 유지).
- **트리오로 밀어라(GLG 지침, 세션 #5·#6 입증). GLG + GPT힣 1차 + Fable5 2차 = 셋이 계속 밀고 가면 엇나갈 일이 없다.**
  세션 #6는 5c-3a를 이 트리오로 통과시켰다 — GPT가 내 초안의 "직접 release backstop"을 거부(관측 없는 release=double-spawn
  창 재개방)하고 retained fail-closed로 잠갔고, Fable이 sync-throw silent-leak(S1)을 잡았다. 둘 다 혼자였으면 못 봤다. 너도
  혼자 짜고 끝내지 말고 **매 슬라이스 1차→2차 검수를 반드시 거쳐라.** 아래 두 분신은 이 세션 끝 시점에 건재하다.
- **검수 분신(살아있는 세션, 순차 호출 — 동시 같은 질문 금지):**
  - **GPT힣(현재) = garden id `20260613T121021-03a5d7`** (live pi control socket, direct 도달). 이전 GPT(`063959-cfdcff`)
    컨텍스트 만료로 인계받음. **설계/코드 1차 + (Fable 부재 동안) 사실상 2차.** `entwurf_send`로 직접 보냄.
  - **Fable5 2차** = garden id `20260613T064858-0dc14b` (claude-code, meta-mailbox + doorbell). **현재 응답 불가
    (Anthropic 이슈, GLG 조사 중).** 복귀하면 1차 통과분만 2차로. `entwurf_send`로 보내면 doorbell이 깨움.
  - **회신 수신:** 네 garden id mailbox로 doorbell이 와서 너를 깨운다 → `entwurf_inbox_read <네 gid>`로 drain(read-receipt 찍힘).
  - **Fable 부재 동안 운용:** GPT가 새 세션이므로 **실무자가 판단 중심을 잡고** GPT를 1차+2차로 같이 돌린다(Fable 합류
    전 원래 페어 모드). GPT는 매번 직접 파일을 읽고 게이트를 재실행해 검증한다 — fresh라도 cwd가 같아 self-onboard 가능.
  - GPT는 5b·5c-1·5c-2·5c-3a·5c-3b 맥락을 이 세션에서 받음. 5c-3a·5c-3b GO 완료 — 5c-3c는 실 IO adapter라
    **design부터** GPT와 논의 후 진입(socket-alive connectable·abort teardown을 코드 전에 잠근다).
- **규율:** 매 슬라이스 GPT 1차 → 반영 → Fable 2차 → 둘 다 GO → local 커밋. **push는 GLG.** AI 서명 금지. `--no-verify`·
  `AGENT_ALLOW_UNSAFE_COMMIT` 금지. 공개 repo라 device 호스트명·실명·시크릿을 커밋/푸시 diff에 넣지 말 것(pre-push가 막음).
- **GLG는 폰에서 tmux 관망, 커밋 시점에만 확인.** 셋이 밀고 나가다 진짜 막힐 때만 호출.
- **이번 세션(#6) 커밋(전부 push 완료, GLG 승인):** `222f4d0` 5c-3a + `f547464` docs · `314a334` 5c-3b + `edd30c6`
  docs · `e9d12df` 5c-3c R1 + `6e8b9ba` 5c-3c adapter + `cd4d4ec` docs · `410110d` 5c-3c live smoke + (이) docs.
  5c-3 전부 종결. NOW = 5c-4.

## North Star — 잊지 말 것

- **One forged screwdriver.** pi-shell-acp는 두 번째 하네스가 아니라 pi-facing bridge다. pi가 하네스이고, 이 repo는 ACP/backend/MCP/entwurf 접점을 얇고 명시적으로 정렬한다.
- **0.11 목표:** meta-bridge entwurf live lifecycle. pi를 4번째 메타 백엔드 시민으로 올리고, `record / capabilities / mailbox / probe` 4분리 위에 새 단일 동사 `entwurf_v2`를 additive로 세운다.
- **Workshop, not factory.** 소수의 살아있는 도제 세션을 다룬다. 외부 DB/factory fan-out/worktree orchestration으로 번지지 않는다.
- **Facts before verbs.** fact-provider와 `entwurf_peers`는 liveness/capability/identity/cwd-history만 말한다. send/resume/transport 판단은 step 5 dispatch에서만 한다.
- **Capability dignity.** Claude/Codex/Gemini/pi는 형제 백엔드다. surface 차이를 capability 포기로 번역하지 말고, unsupported는 숨기지 말고 사실로 노출한다.

## GLG 작업 스타일 — 다음 세션 시작 전에 붙들 것

- **개발은 뺄셈이다.** 새 기능·새 축을 만들기 전에 "안 해도 되는가"를 먼저 묻는다.
- **작게 자르고 순차 검수한다.** GPT힣 1차 → 통과분만 Fable 2차. 동시 throw 금지.
- **5b는 pure decider만.** transport 실행·spawn·smoke·새 표면은 다음 슬라이스로 넘긴다.

## Current state — 2026-06-13 (구현 세션 #6 — 5c-3 전부 done·push 완료, NOW = 5c-4)

- **2026-06-13 구현 세션 #6 (Opus 실무자): 5c-3c live phase-gate smoke (`410110d`, GPT GO). 5c-3 슬라이스 전부
  종결·push 완료.** `smoke-entwurf-v2-spawn-live`(체인 밖, LIVE=1) = production deps를 실 OS 객체로 실증:
  S1 실 unix socket(`net.Server`)→awaitSocketAlive resolve(실 fs.lstat+probeSocketLiveness)·symlink forged·absent abort /
  S2 실 generic child→spawnChild 실 'spawn' event resolve(B1)+SIGTERM kill+eager exitPromise exit 관측(B2) / S3
  executeSpawnBgResume+production deps→실 timeout→kill→child-exited→release×1(실 timer+실 child+5c-3a watcher 통합).
  **`LIVE=1 ./run.sh smoke-entwurf-v2-spawn-live → 7 passed`(D5 phase gate 실행·기록 완료).** S2 발견(GPT 동의): 'spawn'
  event는 process creation이지 child의 SIGTERM-handler readiness 아님 → spawn 직후 kill은 code null 가능 → 단언
  `0||null`(둘 다 유효한 exit 관측, watcher는 any code로 release). real-pi resume E2E는 5d matrix(D5 split). check-pack
  139→**140**, full `pnpm check` EXIT=0.
- **2026-06-13 구현 세션 #6 (Opus 실무자): 5c-3c production deps adapter (`e9d12df` R1 + `6e8b9ba` adapter,
  GPT design GO → 코드 GO[B1/B2 blocker 봉합 후]). Fable 부재로 GPT 페어 2회 검수.**
  R1 = `inspectControlSocketPath(socketPath, lstatFn)` path-core 추출(watcher가 `plan.expectedSocketPath`를 gid
  재유도 없이 inspect; `inspectTargetControlSocket`은 thin wrapper, P1 symlink guard·mapInspectionToLiveness 무변경,
  기존 호출자 무행동변화). adapter = `makeProductionSpawnBgResumeDeps(opts): SpawnBgResumeDeps` — **D3: plan/lock
  캡처 안 함**(lock은 watcher가 deps.releaseLock에 넘김). `socketWatchVerdict`(pure: addressConflict→forged 즉시
  reject / alive→alive / dead·indeterminate→wait) + spawnChild(resolveResumeLaunchIdentity[#29·#9 fail-fast] +
  `buildResumePiArgs(v2-control)` + detached unref spawn) + awaitSocketAlive(exact path 폴링·forged connect 안 함) +
  awaitChildExit + awaitTimeout(setTimeout+abort clear) + killChild(SIGTERM) + releaseLock(lock primitive). 게이트
  check-entwurf-v2-spawn-production **38**, check-socket-discovery 47→**58**, check-pack 137→**139**, `pnpm check` EXIT=0.
  - **GPT 1차 검수 blocker 2개(봉합, load-bearing — 5c-3a 관측 계약 직결):** **B1** `spawn()` 반환은 started 보장
    안 함(spawn-time 실패=`error` event) → spawnChild가 **`spawn` event 대기 후 resolve·`error`면 reject** → watcher
    spawn-start-failed 경로로(stalled spawn-started 우회 방지). **B2** child가 spawnChild resolve↔awaitChildExit 등록
    micro-gap에 fast-exit하면 놓침→부당 retain → proc 생성 **즉시 resolve-only exitPromise** 설치, awaitChildExit는
    그걸 abort와 race. 둘 다 게이트(2b·4d) 추가. **둘 다 새 GPT 세션이 잡음 — Fable 없이도 페어 검수가 작동.**
  - **⚠ 5c-3c step 5(미완) / 5d로 이월:** (a) `smoke-entwurf-v2-spawn-live`(체인 밖 manual, LIVE=1) — 실 pi resident
    spawn + socket connectability + abort teardown 실측. **5d 전 1회 실행+기록 필수**(D5 phase gate; 안 하면 거짓 green).
    (b) GPT 비차단: exitPromise의 `on('exit')` listener는 resident 수명 동안 1개 유지(이 슬라이스 문제 아님; 원하면
    once/cleanup wrapper 후속). (c) SIGKILL escalator는 별도 정책+smoke.

- **2026-06-13 구현 세션 #6 (Opus 실무자): 5c-3b resume-argv SSOT 구현 (`buildResumePiArgs`, GPT design GO →
  GPT code GO → 새 GPT GO[Fable 부재]). push 완료.** `entwurf-resume-args.ts`(import-free 모듈) = legacy async
  worker와 v2 spawn-bg resident citizen이 공유하는 pi argv SSOT. variant `legacy`|`v2-control`. **load-bearing A1:
  legacy launcher는 resume 자식에 `--entwurf-control`을 의도적으로 안 줬다**(entwurf.ts:22 "socket server would keep
  pi -p from exiting" — one-shot worker). **v2는 정반대로 그 keep-alive가 목적** = resumed session이 RESIDENT
  addressable citizen으로 떠서 control socket 세움 → 5c-3a watcher가 socket-alive 관측→release(자식 잔존),
  child-exited→조기실패 release. GPT 보정: **`-p` 드롭 안 함** — v2도 `-p prompt`로 턴 실행하되 `--entwurf-control`로
  resident. v2-control argv = `--mode json -p --entwurf-control [launchArgs --approve] ...explicitExtensionArgs
  --session-id gid [--provider p] --model m prompt`. `explicitExtensionArgs` 양 variant verbatim 보존(#29
  provider-resolution footgun). legacy launcher(entwurf-async.ts:311) 인라인 piArgs를 SSOT 호출로 refactor —
  바이트동일(`check-async-resume-gate` 19 통과로 무행동변화 증명). 게이트 check-entwurf-resume-args **28**(fixture는
  실제 production shape `-e <path>`), check-pack 135→**137**, full `pnpm check` EXIT=0.
  - **5c-3b 컷:** arg builder SSOT만. production `SpawnBgResumeDeps` adapter는 5c-3c(다음). GPT 조건 유지:
    5d 전 5c-3c까지 닫는다(`--no-extensions`/`--entwurf-control` 안 닫고 MCP 표면 얹으면 live path 거짓 green).

- **2026-06-13 구현 세션 #6 (Opus 실무자): 5c-3a spawn-bg RESUME watcher hand 구현 (`222f4d0`, GPT design GO →
  GPT code GO → Fable 2차 GO). local only, push 대기.** `executeSpawnBgResume(plan, lock, deps)` = 5c-1 reducer의
  `release-after-spawn-observation` 정책 위에 spawn/observe IO를 배선(전부 dep 주입, 게이트가 deferred promise로 race
  순서 제어 — 실 spawn/socket/timer 없이 증명). 핵심 = **timeout≠release**: primary race(socketP, exitP, timeoutP)에서
  timeout 승리는 release 0 → `killChild` → bounded `killGrace` race → **실 socket-alive ∨ child-exited(any code incl
  null) 관측에만** `fire()`→reduceRelease 통과 시 release. 관측 불능(grace 만료, 또는 post-spawn watch dep throw)은
  release 금지·`lock-retained` fail-closed(released:false, gid/pid/socket/lockPath/두 timeout 진단 surface, bounded
  return — 무한 hold 없음). `fire()`가 유일 release 경로 = 직접 release 해치 없음. post-spawn dep throw는 backstop
  (best-effort kill → race(exitP, graceP) 관측 시 release, 아니면 observe-failed retained). watcher는 plan.expectedSocketPath
  만, release/진단은 넘겨받은 lock claim의 lockPath만(gid 재조회 금지). 게이트 check-entwurf-v2-spawn **71**, check-pack
  133→**135**, full `pnpm check` EXIT=0.
  - **검수 협업 교훈(이번 세션):** ① **GPT design correction(Q4)** = 내 초안의 "예상 밖 dep throw 시 reducer 안 거치고
    직접 guarded release" 제안을 GPT가 거부 — post-spawn 관측 없는 release는 Fable 계약을 깨고 double-spawn 창 재개방.
    대안은 직접 release가 아니라 **retained-lock diagnostic으로 fail-closed**(관측 가능해야 수용). ② **Fable 2차 S1 blocker**
    = socketP/exitP 생성이 try 밖이라 watch dep의 **동기 throw**(Promise 반환 자리에서 throw하는 버그 dep, send 게이트
    case 13과 동급)가 try/finally 전에 탈출 → 무진단 영구 lock leak. 게이트 8/9는 async rejection만 커버. 수정: 생성을 자체
    try/catch로 감싸 best-effort kill→defuse→retained, 게이트 case 13/14 추가(60→71). 둘 다 혼자였으면 못 본 지점 — 트리오
    가치 재입증.
  - **⚠ 5c-3b로 이월할 계약 3개(load-bearing, 위 전달지침에도):** (Fable) bounded-return은 `awaitTimeout` dep settle 계약
    의존 → 5c-3b wrapper에서 setTimeout 기반 + AbortSignal teardown smoke. (GPT) 5c-3a 게이트는 abort 호출을 카운트 안
    함 → loser watcher abort 존중 smoke 별도. (설계) killGraceMs=watcher dep config(decider plan 무수정), retained 진단은
    5d surface가 렌더.

- **2026-06-13 구현 세션 #5 (Opus 실무자): 5c-2(b) dead-control-send resolver 구현 (`1814c5d`, GPT design GO(길 B)
  → GPT 코드 1차 GO → Fable 2차 GO).** `resolveDeadControlSendFallback(plan, lock, deps)` = 5c-2(a) hand가 dead
  연결에서 호출하는 same-lock re-resolve. 5b dispatch를 lock lifecycle만 빼고 1회 재실행. **intent=fire-and-forget 고정**
  → `resolveDispatch("fire-and-forget", liveness, deliverable)` 재호출이 라우팅 전담. fire-and-forget row엔 **resume 셀
  없음**(live→send, dormant→reject "dormant-fire-forget-unsupported", indeterminate→reject) → send-dead→resume 승격
  구조적 불가(+hand spawn-bg throw +resolver transport-drift throw 이중 격리). N2 asymmetry: in-domain dormant pi=reject,
  unsupported+deliverable=mailbox. `DeadFallbackDeps`에 **release seam 없음**(타입 차원 구조). inspect/probe throw는
  propagate(hand backstop이 failed+release). **`mapInspectionToLiveness`를 socket-discovery로 추출**(공유 SSOT, decider
  내부 livenessFromInspection verbatim 이동 — decider 게이트 100 유지). 게이트 check-entwurf-v2-send-fallback **24**,
  check-socket-discovery 42→**47**(helper 4-way), check-pack 131→**133**, full `pnpm check` EXIT=0.
  - **⚠ 5c-4/5d로 이월할 계약 2개(load-bearing):**
    - **(Fable N3) reject reason이 hand 경계에서 소실.** resolver는 풍부한 reason(bad-target / dormant-fire-forget-
      unsupported / indeterminate-no-spawn / mailbox-undeliverable / target-address-conflict) 반환하는데, 5c-2(a)
      driveDeadFallback이 `{kind:"reject"}`를 outcome "rejected"로 접으며 reason 폐기. 5d/호출자가 "in-band 거부"·
      "dormant"·"소멸"을 구분 못 함(F2-P2 "관측 가능해야 수용"과 같은 결). SendDrive/ControlSocketSendResult에 optional
      `rejectReason` 실어 5d 렌더 — 5c-4/5d에서 박을 것.
    - **(GPT+Fable) layering 위생:** `resolveMailboxDeliverability`를 resolver가 decider module에서 value import 중.
      순수 exported helper 재사용이라 지금은 수용. 나중에 mailbox deliverability를 contract/meta-session 쪽으로 옮겨
      resolver의 decider 의존을 얇게. 비차단.
- **2026-06-13 구현 세션 #5 (Opus 실무자): 5c-2(a) control-socket send hand 구현 (`03add67`, GPT 1차 GO →
  Fable 2차 GO).** `executeControlSocketSend(plan, lock, deps)` = 5c-1 release reducer 위에 control-socket send IO 배선.
  IO 전부 dep 주입(게이트 fake, 라이브 소켓 없이 send→outcome→release 순서 증명). outcome 매핑: ack→sent / in-band
  reject→rejected(no fallback) / dead→`deps.deadFallback` 1회(held lock 아래)→control retry∨mailbox enqueue(one-shot) /
  indeterminate→deadFallback·mailbox 미호출, 즉시 failed+release+rethrow(double-delivery 방지). **검수 blocker 2개
  반영(load-bearing):** B1=lock-leak backstop(executeControlSocketSend가 driveSend 전체 try/catch, 모든 throw를 failed로
  접어 finalizeRelease 통과 → spawn-bg contract throw·예상 밖 dep throw도 release 보장 후 rethrow) · B2=same-lock
  mis-route(driveDeadFallback이 rePlan.targetGardenId===plan===lock.gardenId assert, 다른 target plan은 retry/enqueue
  전 fail-loud). 게이트 check-entwurf-v2-send **46** (8 outcome케이스 + masking + lock invariants + spawn-bg/dep-throw
  release backstop + mis-route + non-failed release-throw 전파 + mailbox-enqueue-throw). check-pack 129→**131**, full
  `pnpm check` EXIT=0. 5c-2(a) 경계(뺄셈): deadFallback resolver=5c-2(b), sendViaMailbox=5c-4, 둘 다 인터페이스 dep.
  - **⚠ 5c-2(b)/5d로 이월할 계약(Fable N1, load-bearing):** **성공 outcome(sent/fallback-sent) 후 releaseLock throw**는
    전달이 *이미 일어난 뒤*다 → releaseErr 전파(현행 정직, 게이트 case 16 고정). 5d surface가 "send 실패"와 "전달됨+release
    실패(재전송 금지·lock 수동 정리)"를 **구분 렌더**해야 한다. 호출자가 이 throw 보고 재dispatch하면 double delivery.
- **2026-06-13 구현 세션 #4 (랩톱→개발 서버 이전 첫 세션): 5b B1/B2/B3 봉합 + 5c design + 5c-1 구현.
  매 단계 GPT 1차 GO → Fable 2차 GO. local 커밋만(push 전, GLG가 더 진행 후 일괄).**
  - **5c-1 (`ff69a3a`, GPT design GO → code GO → Fable GO): pure release-policy reducer.** transport IO
    전에 "어떤 event에서 lock release 허용되는가"를 순수 state machine으로 격리(`entwurf-v2-release.ts`).
    `decideReleasePolicy`(meta-mailbox→no-lock / in-domain→release-after-{send-final, spawn-observation},
    lock 非null+gid 일치 강제) + `reduceRelease`(single-release 선가드, spawn-started 단독 release 금지=
    double-spawn 창 방지, 첫 socket-alive∨child-exited∨spawn-start-failed에만 release). 게이트
    check-entwurf-v2-release **27**. 상세 = 커밋 `ff69a3a` 본문.
  - **⚠ 5c-2/5c-3 배선 시 반드시 박을 계약 2개(검수에서 도출, load-bearing):**
    - **(GPT, 5c-2) `send-final(failed)`는 첫 send 실패가 아니라 legacy fallback/re-resolve까지 끝난 최종
      outcome에만 emit** — 첫 실패에 emit하면 lock 조기 release. 5c-2 게이트: "send-final은 fallback 체인 소진 후 1회".
    - **(Fable, 5c-3) timeout은 release event가 아니다** — ReleaseEvent에 timeout 종류 없음은 의도된 설계
      (bare timeout release는 child가 늦게 socket 띄우면 double-spawn 창 재개방). watcher는 observeTimeoutMs 만료를
      **관측으로 해소**해야: kill child → `child-exited(null)` → release, 또는 hold + 증거 표면화. 5c-3 게이트로 박을 것.
  - **5b lock-lifecycle B1/B2/B3 (`33f0c20`):** 상세 커밋 본문. B1=IO seam required dep 승격(뺄셈, footgun 소멸)
    · B2=post-lock try/retainLock/catch + reject-path release retry · B3=RejectDiagnostic로 target-locked holder 보존.
    게이트 check-entwurf-v2-decider 82→**100**(lock-leak 9 + B3 diagnostic/null-holder + retry-pin).
    full `pnpm check` EXIT=0. check-pack 127→**129**(release.ts + gate 2파일 packed; scripts/ 게이트도 tarball 포함).
  - **검수 협업 교훈(살릴 것):** GPT 1차 → 반영 → Fable 2차 **순차**. **동시에 같은 것 묻지 않기가 핵심.**
    순서·역할은 사안 따라 유동(어떤 사안은 GPT가 더 필요할 수도). 이번엔 double-release 관찰을 GPT가 던지고
    Fable이 "현행이 옳다 — retry는 무해를 넘어 이득"으로 독립 판정 + 게이트 retry-pin 권고 → 분업이 실제로 값을
    만든 사례. GLG는 폰에서 tmux 관망, **커밋 시점에만 확인**(셋이 밀고 나가다 진짜 막힐 때만 호출).
  - **설계 SSOT 부재 주의:** `.agent-reports/5b-decider-design.md`는 gitignored — 랩톱에만 있고 이 개발
    서버엔 없음. 코드 + 커밋 `33f0c20` 본문 + 이 NEXT가 SSOT 역할. (5c 설계 산출물도 gitignored면 같은 한계.)
- **2026-06-12 구현 세션 #2: 진입① + 5a 완료·커밋·푸시·검수통과**.
  - **S1 = GLG 해소(2026-06-12):** nested spawn은 **코드레벨에서 차별 안 함**(다 열어둠), **지침으로 가드**. 5c
    launcher가 `--entwurf-control` 붙여 손자 spawn이 코드상 가능해지는 걸 수용. depth-cap 기계 가드 안 만듦. 인터페이스는
    뚫어두되 "사용자가 허락하는 경우에만" = 정책/지침 레벨. → **S1 BLOCKER 해소, 5c 진행 가능.** (재귀 dispatch 안전:
    try-acquire-only라 lock 사이클 deadlock 불가 — Fable 확인.)
  - **진입① ？6+F3 (`b9d46db` + 검수 `95e9989`):** reject receipt `observedLiveness: FactLiveness|null`(required-nullable).
    pre-probe 3종(bad-target/target-locked/`target-address-conflict`)=null·나머지=non-null을 `rejectObservedLivenessWellFormed`
    순수 술어로. **우회 차단 = `makeRejectReceipt(reason,lv)` constructor(wellFormed 위반 throw) — 5b는 reject를 손으로
    조립 말고 무조건 이것만.** F3 `target-address-conflict`=pre-resolver enum(RESOLVER 멤버 아님). 게이트 109→**233**.
  - **5a per-gid lock (`9c05576` + 검수 `d80476e`,`517a05c`):** `openSync wx`, target-locked+holder JSON, **reclaim
    mutex(`<gid>.lock.reclaim` wx)** = F2 이중-spawn race 봉합(GPT+Fable 독립 발견), nonce-owned release,
    same-host+ESRCH-only reclaim(EPERM/remote/alive/unknown fail-closed), corrupt/gid-mismatch=conflict, ENOSPC/close
    실패 시 자기 wx파일 unlink, F2-P1 gid 검증. 게이트 신규 **67**. `~/.pi/entwurf-v2-locks/<gid>.lock`.
  - **검수: GPT힣(1차)+Fable(2차) 둘 다 GO.** reclaim race=완전 폐쇄(Fable interleaving 전수 증명).
- **⚠ 검수 프로세스 교훈(GLG 2026-06-12):** 분신 검수는 **순차** — GPT 1차 → 통과분을 Fable 2차. **동시에 둘 다
  던지지 말 것**(이번에 그래서 둘이 같은 reclaim race를 중복 발견 = 리소스 낭비). 다음 슬라이스부터 적용.
- **5c로 이월(Fable 3, load-bearing):** F2 완전 봉합 = nonce-release ∧ reclaim-mutex ∧ **release-after-observation(5c
  watcher)** 3박자. **acquire→spawn 배선은 5c watcher 전에 켜면 안 됨** → 5c 게이트 "관측 전 release 없음"으로 박을 것.
- **비차단 backlog(Fable O1):** reclaim marker는 nonce 무소유 → 인간이 in-flight marker 오삭제 시에만 race 재개방
  (document-grade, conflict detail이 이미 경고). 운영 중 marker 수동 정리가 실제로 일어나면 marker에 nonce 기록+자기것만
  unlink(~5줄). 지금은 불요.
- **뺄셈 재검토 닻:** 5b/5c가 안정된 뒤 **자동 stale reclaim 자체가 꼭 필요한지** 다시 본다. 더 단순한 대안은
  "ESRCH여도 자동 reclaim 없이 `target-locked`+수동 cleanup"이다. 지금 구현은 `acquireLock` 내부에 격리되어 있으니
  유지하되, reclaim 위에 새 기능을 더 얹지 말 것.
- Done: step 4 fact-provider slice 1·2·3·4a·4b·4c **+ F-mailbox amendment** (contract층 step 5 blocker 닫힘). `entwurf_peers` renders facts + legacy `sessions` projection from the same provider; no second socket scan.
- F-mailbox amendment (this cleanup's companion commit): `entwurf_v2` contract now routes `fire-and-forget + unsupported citizen → meta-mailbox/ack-only` instead of rejecting it. New `meta-mailbox` transport + `mailbox-undeliverable` reason (fail-closed) + `UNSUPPORTED_DISPATCH_TABLE` mini-table separate from the 6-cell table. `resolveDispatch` takes a 2nd `mailboxDeliverable` fact. GPT힣 review = GO; `RESOLVER_REJECT_REASONS` rename + in-domain no-mailbox guard folded in.
- Verified: `check-entwurf-v2-contract` **109** (was 81), `check-socket-discovery` 31, `check-entwurf-fact-provider` 27, `check-entwurf-peers-surface` 40, full `pnpm check` green.
- Real-IO smoke on live `~/.pi/agent/sessions` after 4c: `peers=67`, `socketOnly=4`, `diagnostics=0`, `sessions=4`, backend distribution `claude-code=67`. No live false-positive diagnostics.

## Next moves — read order

1. **Step 5 — 5b + 5c 전체(5c-1·2a·2b·3a·3b·3c·4) + 5d-1(a+b) DONE(`ff69a3a`+`03add67`+`1814c5d`+`222f4d0`+
   `314a334`+`e9d12df`+`6e8b9ba`+`410110d`+`730b578`+`e0c6e75`+`97704c9`, 전부 GPT(+Fable where available) GO;
   5c-1~5c-3 push 완료, 5c-4·5d-1 로컬 커밋), ◀ NOW = 5d-2 production runEntwurfV2.**
   - **5d 분해:** 5d-1a send-hand N1/N3 ✅(`e0c6e75`) → 5d-1b pure execute-router ✅(`97704c9`, `executeDispatch`) →
     **5d-2 production runEntwurfV2(◀ NOW)** = decide→execute 조립 + production deps → 5d-3 MCP `entwurf_v2` additive
     등록 + pi-native surface → 5d-4 doctor flag + prefixRoots 배선 → 5d-5 release-gate matrix smoke. pure-before-IO.
   - **5c 분해(GPT design GO, 전부 ✅):** 5c-1 pure release reducer ✅ → 5c-2(a) control-socket send hand ✅ → 5c-2(b)
     deadFallback resolver ✅ → 5c-3a spawn-bg watcher hand ✅(`executeSpawnBgResume`, 6 IO dep 주입) →
     5c-3b resume-argv SSOT ✅(`buildResumePiArgs`) → 5c-3c production deps adapter ✅(`makeProductionSpawnBgResumeDeps`,
     게이트 38 + live smoke 7) → **5c-4 meta-mailbox send ✅**(`executeMetaMailboxSend` + `makeProductionSendViaMailbox`,
     게이트 28). 위험 순, pure-before-IO. **5c transport hands 전부 종결.**
   - **5c-4 done(`730b578`): enqueue-only meta-mailbox send.** 신규 `entwurf-v2-mailbox.ts`(ctx-free, dep-injected):
     `executeMetaMailboxSend(plan, sender, deps)` = sender 있으면 `formatMetaMailboxBody(sender, plan.message,
     plan.wantsReply)`(legacy hard-false 탈피)·없으면 raw `plan.message` → `deps.enqueue({gardenId: plan.targetGardenId,
     body, sessionsDir, mailboxDir})` verbatim → `{success:true}`; **enqueue throw propagate**(success:false 안 만듦).
     `makeProductionSendViaMailbox({senderProvider, enqueue?})` = async adapter, **lock 미접근**(release는 hand). 재사용
     `enqueueMetaMessage`(meta-session.ts:1467) + `formatMetaMailboxBody`(lib/meta-mailbox-body.ts:60) — NEXT 옛 표기
     `buildLocalSenderEnvelope`만 entwurf-control.ts:582(private, 5d wiring site가 senderProvider로 주입). 게이트
     `check-entwurf-v2-mailbox` 28(enqueue 인자·wantsReply yes/no·raw·throw-propagate·poison-lock·rejected-promise·소스
     가드). tsconfig exclude fence + run.sh + package.json. **routing 결정 ❌**(5b dispatch table이 이미 결정).
   - **5d top-level dispatch runner = 5c-4의 direct 소비처.** decider `DispatchDecision`(execute/reject)을 받아
     plan.transport별로 실행: control-socket→`executeControlSocketSend` / spawn-bg→`executeSpawnBgResume`+production deps /
     meta-mailbox(lock null)→`executeMetaMailboxSend`(senderProvider = `buildLocalSenderEnvelope(ctx)`+{origin:"pi-session",
     replyable:true}). MCP `entwurf_v2` additive 등록은 이 runner를 호출한다.
   - **5c-3c = production `SpawnBgResumeDeps` factory (GPT 5c-3c 설계, 코드 전 잠금):** dep factory로 5c-3a pure
     watcher 무수정 유지. ① `spawnChild(plan)` = identity authority 재사용(`readSessionIdentity(plan.sessionId)` +
     `getEntwurfExplicitExtensions(resumeModel,false,provider)`; cwd=header authority, process.cwd fallback 금지) +
     `buildResumePiArgs({variant:'v2-control', sessionId:plan.sessionId, explicitExtensionArgs, provider, model:
     override??resumeModel, prompt:plan.prompt, launchArgs:plan.launchArgs})` + `spawn('pi',args,{cwd,shell:false,
     detached:true,stdio:['ignore','ignore','pipe']})`+unref+mirrorChildStderr; spawn error→rejection(watcher
     spawn-start-failed release). ② `awaitSocketAlive(socketPath,signal)` = **lstat(non-symlink isSocket)+connect
     probe alive만 alive; file-exists는 NO; symlink/not-socket=forged→reject(watcher backstop→retained); absent=대기
     until abort/timeout; bounded polling + `inspectSocket`/`probeControlSocket` 재사용**. ③ `awaitChildExit(child,
     signal)` = close/exit 1회 resolve + abort listener cleanup(SpawnedChild를 내부 `{pid,proc}`로 확장, public은 pid만).
     ④ `awaitTimeout(ms,signal)` = setTimeout + abort 시 clearTimeout(bounded-return 핵심). ⑤ `killChild` = SIGTERM
     우선(SIGKILL escalator는 분리, 넣으면 smoke). ⑥ adapter 시작부에서 plan.sessionId===plan.targetGardenId assert,
     expectedSocketPath 재유도 금지(plan 것만 관측). **게이트 불가 실 IO라 smoke**: (1) v2 argv(--entwurf-control,
     no --no-extensions, -p+prompt final, --approve 보존) (2) socket-alive connectable(plain exists/symlink/non-socket
     은 alive 금지) (3) loser abort teardown(socket승/exit승/timeout→kill 각 경로 timer·listener cleanup) (4)
     timeout→kill→exit release · killGrace elapsed→lock-retained (5) child early-exit→child-exited release, no re-spawn.
     **5d로 미루기 NO(GPT)** — adapter 안 닫고 MCP 표면 얹으면 live path 거짓 green.
   - **5c-3 = spawn-bg plan을 실제로 띄우고 5c-1 `release-after-spawn-observation`을 실 watcher로 구동.**
     load-bearing 계약(Fable, 위 전달지침에도): **timeout은 release event 아님** — watcher가 observeTimeoutMs 만료를
     관측으로 해소(kill child→`child-exited(null)`→release, 또는 hold+증거). bare timeout release 금지(double-spawn
     창 재개방). `spawnEntwurfResumeAsync` `--no-extensions` 하드코딩 무수정 호출 금지 — `--entwurf-control` 살려야
     socket 관측 가능(A1), piArgs SSOT 공유. reduceRelease(spawn-started=hold, socket-alive∨child-exited=release)는
     5c-1에 이미 있음 — 5c-3는 실 spawn/probe IO를 그 위에 배선 + watcher가 이벤트 공급.
   - **5c-2(b) = `deps.deadFallback(plan, lock)` 실구현.** 5c-2(a) hand가 dead 연결에서 held lock 아래 1회 호출하는
     resolver 본체. 재사용(정찰됨, 재구현 금지): 5b `resolveTarget`/`inspectSocket`(socket-discovery)/`resolveDispatch`/
     `resolveMailboxDeliverability`. **release 절대 안 함**(release는 hand 단독 책임). 반환 = `{kind:"execute",plan}|
     {kind:"reject",reason}`, plan.targetGardenId은 원 target과 동일해야(hand가 이미 assert, resolver도 그 불변식 안에서 생성).
     **`decideDispatch` 통째 재호출 금지** — acquire/release lifecycle이 꼬인다(이미 lock 보유 중). 게이트: existing-lock
     re-resolve가 control-socket∨mailbox plan 반환·release 미발생·다른 target 안 만듦·no-route→reject.
   - **5c-2 설계 = GPT design 조건부 GO(아래 조건 박아야 함). public unit = `executeControlSocketSend(plan, lock, deps)`.**
     `reduceRelease(release-after-send-final, …)`에 event 먹여 lock release. **재사용 map(정찰됨, 재구현 금지):**
     `sendRpcCommand`(entwurf-control.ts:1105, newline-JSON RPC, 5s timeout) + `RpcSendCommand`{type:"send",message,mode,sender} +
     `classifyConnectError`(socket-probe.ts:39) + `enqueueMetaMessage`(meta-session.ts:1467) + `formatMetaMailboxBody` +
     `buildLocalSenderEnvelope`(entwurf-control.ts:582). legacy 핸들러 형상 = entwurf-control.ts:1680-1730.
     - **조건① re-resolve 모델(load-bearing):** v2 control-socket plan은 5b가 alive 관측 후 고른 in-domain(pi) send.
       send 시 `dead`는 TOCTOU race. control hand가 mailbox를 **직접 결정 금지**(5b dispatch table/deliverability/conflict
       우회 — pi backend primary wakeMode=direct-inject라 "dead≠mailbox 가능"). → **same-lock one-shot re-resolve**:
       `deps.deadFallback` 인터페이스 주입, 그 안은 **existing-lock fallback resolver**(5b `resolveTarget`/`inspectSocket`/
       `resolveDispatch`/`resolveMailboxDeliverability` 재사용하되 **release 안 함**; `decideDispatch` 통째 재호출 ❌ —
       acquire/release lifecycle 꼬임). resolver 반환 = `{kind:"execute",plan} | {kind:"reject"}`, hand는 실행만.
       re-resolve가 control-socket이면 1회 retry 허용(원 send는 connect-dead라 미전달), 그 retry도 1회뿐.
     - **조건② send-final outcome 매핑:** RPC ack 성공→`sent` / RPC `success:false` in-band reject→`rejected`(fallback 없음) /
       connect `dead`→re-resolve 후 success→`fallback-sent`·reject/no-route→`rejected`·IO throw→`failed`+원error rethrow /
       connect `indeterminate`(timeout/EACCES/stall)→**fallback 금지, 즉시 `failed`+release+rethrow**(double delivery 방지).
       모든 경로 release 정확히 1회, `releaseLock`은 reducer가 shouldRelease일 때만.
     - **조건③ helper 경계:** mailbox send=공유 `executeMetaMailboxSend(plan,sender,deps)` = **enqueue만**(routing 결정 ❌).
       5c-4가 직접 사용, 5c-2는 re-resolve가 meta-mailbox plan 줄 때만. control hand에 `enqueueMetaMessage` 직접 판단 박지 말 것.
     - **게이트 8케이스:** sent→release1 / in-band reject→release1,no-fallback / dead→deadFallback 1회 호출(held lock 아래)→
       success→fallback-sent→release1 / dead→reject/no-route→release1+rejected / dead→throw→release1+rethrow /
       indeterminate→deadFallback 미호출·mailbox helper 미호출→release1+rethrow / send-final event 경로당 1회 / first-dead에
       fallback 없이 direct mailbox 금지. (releaseLock throw는 원 error 마스킹 금지 — 5b 방향.)
     - **뺄셈 팁(GPT):** `deps.deadFallback`만 인터페이스로 박고 resolver 실제 구현은 **다음 sub-slice(5c-2b)**로 미뤄도 됨 →
       5c-2(a) 게이트가 작아짐. resolver 복잡하면 분리.
   - **5c-3 진입 시 박을 계약(Fable, load-bearing):** timeout은 release event 아님. watcher는 observeTimeoutMs
     만료를 **관측으로 해소**(kill child→`child-exited(null)`→release, 또는 hold+증거). bare timeout release 금지
     (double-spawn 창 재개방). `spawnEntwurfResumeAsync`는 `--no-extensions` 하드코딩이라 무수정 호출 금지 —
     v2는 `--entwurf-control` 살려야 socket 관측 가능(A1), 옵션/wrapper 추가하되 piArgs SSOT 공유. watcher는
     `plan.expectedSocketPath`만, release는 넘겨받은 `lock` claim으로만(gid 재조회 금지).
   - **4-step 규율:** 이해(읽기만)→(GLG 폰 관망, 막힐 때만 호출)→구현→검수(GPT 1차→Fable 2차, 동시 같은 질문 금지).
     커밋은 셋이 GO 후 local, push는 GLG가 더 진행 후 일괄.
   - **소비할 plan 계약(5b가 심어둠, 재유도 금지):** control-socket={socketPath,mode,wantsReply,message} ·
     meta-mailbox={mailboxDir,sessionsDir,wantsReply,message} · spawn-bg={sessionId(=gid),cwd,prompt,launchArgs,
     expectedSocketPath,observeTimeoutMs,releaseWhen}. **provider/model·child pid는 plan에 없음** — 5c launcher가
     saved JSONL에서 launch identity 읽고(D4), pid는 watcher의 release-context(실행 중 출생). lock은 in-domain
     execute만 non-null(control-socket·spawn-bg), meta-mailbox는 null(？7).
   - **구현된 7단계(검증됨, check-entwurf-v2-decider 100):** ① `requireGardenId`(F2-P1) → ② `resolveTarget`(probe-free;
     없음=`bad-target`, quarantine=`target-address-conflict`) → ③ backend → ④ in-domain만 `acquireLock` before lstat →
     ⑤ lock 아래 `inspectTargetControlSocket`(？2) → `resolveDispatch` → resume verdict이면 `preflight`(deny→nonce-owned
     release→`untrusted-fail-fast`, 1B) → plan → ⑥ unsupported: 무락, `resolveMailboxDeliverability`(self-fetch) →
     `resolveDispatch`. ⑦ send-fail fallback은 **5c 소관**(decider 1회 결정). 반환 `DispatchDecision`, transport 0.
   - 이후: **5c** transport hand(control-socket/meta-mailbox/spawn-bg=`--no-extensions` 빼고 `--entwurf-control --approve`
     A1; releaseWhen=`socket-alive ∨ child-exited(any code)` A2; **release-after-observation 게이트 = Fable 3**;
     send-fail fallback 같은 nonce 1회; 실패 전달 경로 명시) → **5d** MCP `entwurf_v2` additive 등록 + release-gate matrix
     smoke + doctor `--entwurf-control` flag 체크 + prefixRoots 배선. 상세 = ↓ "Stage 0 step 5 작업 계획"(5a-5d 분해).
2. **Small optional follow-up:** `get_info` enrich for alive socket probes (`cwd/model/idle`, per-socket `infoError`, `Promise.allSettled`, no whole-list throw). Current `(not enriched)` is honest.
3. **Release-gate matrix smoke (step 5와 같이 게이트화):** sender surface(pi-native / MCP bridge) × target kind(live socket / meta mailbox) × direction(pi→meta·meta→pi·meta→meta·pi→pi). cross-transport 실제 도달성은 contract층이 아니라 여기서 증명(GPT힣 (c) 판정).
4. **Separate backlog:** pi `session_start` meta-record writer; legacy `entwurf_send` direct socket symlink guard; 5b/5c 안정 후
   **자동 stale reclaim을 뺄 수 있는지 재검토**(수동 cleanup 모델과 비교).

## Guardrails for next agent

- Do not put `sendable/resumable/dispatch/action/transport/mailboxDeliverable` on `entwurf_peers` rows.
- Do not hide `unsupported` citizens; F-mailbox needs them as input.
- Do not bake mailbox into the 6-cell `DISPATCH_TABLE`; mailbox deliverability is a separate fact/input.
- `mailbox ack` means enqueued + doorbell only, not read. `mode` (`steer`/`follow_up`) is meaningless on mailbox transport and must be named as such.
- `sessions` is legacy projection only: alive pi citizens + alive socket-only entries derived from facts.

# RECENT — reverse ledger

## 2026-06-12 — step 5 물음표 닫힘 (GPT + Fable + 실측 삼각측량, 첫 세션)

- Opus(실무자) 정찰·？1 실측 + GPT힣 자문 + Fable adversarial 3자 수렴. **step 5 진입 물음표 전부 닫힘** —
  상세 결론·게이트·decider 순서는 LEDGER "### step 5 물음표 닫힘" 블록. 전부 흡수형 보강, 재설계 없음.
- 실측(？1, Groq 8b throwaway): observable spawn-bg viable → `owned+dormant`=`spawn-bg` 유지. 새 사실 — A1
  `--no-extensions` ⊗ `--entwurf-control` 상호배타(control=extension 기여 flag), A2 releaseWhen=`socket-alive ∨
  child-exited(any code)`.
- contract 수정 1건 동결(？6, GPT): reject receipt `observedLiveness`=required-nullable(pre-probe reject 3종=null).
- 합의: ？2 post-lock lstat-then-connect(`probeSocketLiveness`=connect-only라 P1 재개방 방지) + non-pi/pi symlink→
  `target-address-conflict` + conflict predicate `socketGids ∪ symlinkedGardenIds`로 확대 · ？7 lock iff in-domain
  backend(mailbox path 무락) · 1B preflight=resume verdict 뒤에만(F-mailbox 보호) · F3 named reason 확정.
- ⚠ **GLG 확인 대기 = S1**: v2 child가 extension 로드로 "완전무장 시민"이 됨 → 손자 spawn 재귀 fan-out 표면이
  코드 차원에서 열림("workshop, not factory"가 정책-only). 추천=눈뜨고 수용+가드레일 1줄, GLG가 택1.
- 잔여 배선: doctor `--entwurf-control` flag 존재 체크(설치 의존, 없으면 rc=1 즉사) · 5d prefixRoots operator-policy
  주입원(env/user settings) 명시(안 하면 모든 resume fail-fast).

## 2026-06-11 — F-mailbox amendment (step 5 진입 전 BLOCKER 닫힘)

- 발견된 v2 결함: `resolveDispatch`가 `unsupported` backend(claude 등)를 `fire-and-forget`까지 `backend-liveness-unsupported`로 reject. 그런데 ff는 0.10.0 meta-bridge mailbox로 liveness 없이도 늘 전달된다 → "한 동사"로 통합 시 가장 흔한 fire-forget-to-Claude를 막아 레거시 `entwurf_send`를 영영 못 죽임.
- 보강 (GPT힣과 (A)/(B) 논의 → (B) 채택): `meta-mailbox` transport + `mailbox-undeliverable` reason 선점 + `UNSUPPORTED_DISPATCH_TABLE` intent-keyed 2칸 미니표(6칸표와 분리, Fable (i)). `resolveDispatch(intent, liveness, mailboxDeliverable)` — deliverability는 별도 fact(fail-closed, `entwurf_peers` row 아님). `observedLiveness`는 unsupported 유지, ack=enqueue+doorbell, `mode`는 mailbox transport에서 무의미.
- GPT힣 리뷰 GO: `TABLE_REJECT_REASONS`→`RESOLVER_REJECT_REASONS` rename(미니표도 emit하므로), in-domain 6칸표 no-meta-mailbox 가드 추가. boolean 3번째 인자 유지(객체 불필요). cross-transport 실제 도달성 smoke는 step 5 dispatch 게이트 몫.
- 게이트 `check-entwurf-v2-contract` 81→**109**, `pnpm check` green.

## 2026-06-11 — fact-provider slice 4c shipped + real-IO smoke

- 4c shipped in `6467466` + `2b339dd`: socket-axis hardening, symlink/malformed/dir-read diagnostics, `entwurf_peers` fact render, and `sessions` projection from facts.
- Gates rechecked locally: `check-socket-discovery` 31, `check-entwurf-fact-provider` 27, `check-entwurf-peers-surface` 40.
- Real-IO smoke: live meta-store parsed cleanly (`diagnostics=0`), `socketOnly=4` confirms pi writer is still a separate future slice, and `sessions=4` confirms projection wiring.
- Note: already-running MCP bridge sessions may still have the old tool implementation until a new session loads the bridge. Source complete ≠ deployed into every live process.

# LEDGER — 0.11.0 active plan and frozen evidence

> 다음에 할 일만 남긴다. 로그가 아니다.
> 결정 trace 와 evidence 는 commit history / CHANGELOG / VERIFY / BASELINE / README / AGENTS / 코드로 보낸다.
> **0.10.0 (meta-bridge: garden-native async delivery / install / doctor, Claude Code only) = SHIPPED**
> — `v0.10.0` 태그(push 완료) + CHANGELOG `## 0.10.0 — 2026-06-06`. 전체 trace는 거기. NEXT는 더 안 들고 있는다.

## Active — 0.11.0: entwurf tmux-live lifecycle, pi = 4번째 메타 백엔드 (#35)

> **상태: 설계 동결 (2026-06-09, GLG + GPT힣 + Claude 3자 수렴). 각 요소 실측 완료 — 구현 세션
> 진입 시 설계 재탐색 불필요.** 아래 검증 원장의 항목은 다시 찌르지 말 것(doctor 실패/구체 버그만 예외).
> 구현 세션은 각 요소의 regression gate를 먼저 만들고, 그 다음 빌드 + 연결한다.
> **2026-06-09 언어 확정: Go 드롭, 순수 TS.** pi-trust를 소스까지 파보니(아래 검증원장) Go 재구현은
> 5겹 drift, node helper를 쓸 거면 단일-바이너리 명분이 사라지고, fact 레이어·cross-harness MCP 표면은
> 이미 0.10.0 TS 자산이다. 핵심 통찰(brain↔hand)은 유지, 언어 바인딩만 TS로.

**원칙 (장기 지침, 흔들지 말 것):**
- **No new language in 0.11.** 새 언어/바이너리 표면을 만들지 않는다. 코드 표면 최소화가 우선.
- **pi-interface-centric.** pi의 진화와 우리 프로젝트의 진화가 같이 간다 — pi raw semantics는 pi
  public export를 직접 import해 따라간다(재구현 금지). 인터페이스를 pi 수준으로 맞춘다.
- **하네스 백엔드(claude/codex/agy)에 휘둘리지 않는다.** 그들이 fact를 얻는 경로는 standalone
  binary가 아니라 pi-tools-bridge MCP. pi 중심을 보존하고 백엔드는 MCP 소비자로 둔다.
- **하드 게이트 통과 필수.** 모든 코드는 이 repo `pnpm check`(biome lint + tsc + 전 smoke/check
  게이트)를 전부 넘어야 한다. 새 표면마다 게이트 동반.

**버킷 A ✅ 완료 (2026-06-10 구현 세션) — F3 live 버그 + trust 3조각 전부 닫힘.** 상세는 commit history:
- **F3** = `2660fe4`. 3값 probe(`alive|dead|indeterminate`) SSOT `pi-extensions/lib/socket-probe.ts`;
  `gcStaleSockets`=`shouldUnlinkOnGc`(dead만) unlink, indeterminate(부하 stall)·alive 생존 → 3주체 메일박스
  협업 깨던 live 버그 닫힘; 브리지 사본도 같은 lib 소비=drift 제거; "모르면 파괴 안 함"(EACCES/EPIPE/
  undefined→indeterminate). 게이트 `check-socket-probe` 18.
- **F5a+N3b** = `1cae918`. preflight `store.get`→`getEntry` + evidence `trustStoreEntryPath`/
  `trustStoreInherited`; 탈출구 방향 #13b(자식 true>조상 false); entryPath=우리 `normalizePath`≡pi
  `canonicalizePath` 동치를 direct-케이스 게이트로 입증(pi 정규화 함수 public 아님). `formatPreflightDenial`
  순수 formatter(inherited-false=inheritedFrom+remedy, **launcher 배선 X=버킷 B**). 게이트 `check-pi-preflight` 13→22.
- **핸들러** = 이번 커밋. Trust 2층: 순수 `decideProjectTrust(outcome,ctx,prompt)` + 얇은
  `createProjectTrustHandler` 어댑터. 탈출구=inherited-false+interactive+trust-here→`{yes,remember:true}`→pi가
  direct child true 저장→상속 false 이김. GLG 6포인트(①store.set 금지=pi가 단일 작성자 ②undefined 금지
  ③non-interactive→undecided ④ctx.ui 주입+fake prompt ⑤preflight만 소비 ⑥등록은 consumer user/global) +
  GPT event-reachable fixture(child trust input 있어야 pi가 `project_trust` 발화). `ExtensionMode`는
  `ProjectTrustContext["mode"]`로 추출; lib→lib `.ts` import + root tsconfig exclude(scripts/tsconfig가
  typecheck). 게이트 `check-project-trust-handler` 16.

**▶ 다음 한 걸음 (구현 세션 진입점 — step 4 fact-provider 코어 완료. 선택적 enrich → F-mailbox amendment → step 5 `entwurf_v2` dispatch):**
> **현재 고정 (2026-06-11):** fact-provider slice 1·2·3·4a·4b·4c 전부 커밋·푸시 완료(`2b339dd`). `entwurf_peers`는 `listEntwurfFacts` + `renderEntwurfPeers`를 쓰고, legacy `sessions`는 facts projection으로만 산출한다.
> - **socket-axis hardening 완료 (`6467466`):** `scanSocketProbes`가 `SocketScanResult{probes, symlinkedGardenIds, malformedNames, dirError}`를 반환. symlinked `<gid>.sock`는 probe 금지, malformed name/dir-read error는 diagnostic, non-ENOENT dirError 창에서는 citizen을 `indeterminate`로 held-not-stranded 처리.
> - **MCP surface 4c 완료 (`2b339dd`):** `entwurf-peers-render.ts` + MCP handler 배선. verdict 필드/단어 금지, unsupported 노출, diagnostics 노출, empty `(none)`, `(not enriched)`, `getLiveSessions`/`isSocketAlive` 제거. 게이트: `check-entwurf-peers-surface` 40, `check-socket-discovery` 31, `check-entwurf-fact-provider` 27.
> - **Real-IO smoke 완료:** live `~/.pi/agent/sessions`에서 `peers=67`, `socketOnly=4`, `diagnostics=0`, `sessions=4`, backend=`claude-code=67`. 실제 v1/v2 meta-record dual-read와 socket-only pi 모집단 모두 정상.
> - **선택적 enrich 후속:** `SocketProbe`/`SocketOnlyFact` enrich(cwd/model/idle)는 현재 null 노출(probe-only 정직). `enrichSocketProbes`(alive 소켓만, `Promise.allSettled` + per-socket `infoError`, 전체 throw 금지)로 get_info 배선 = 별도 작은 slice.
> - **step 5 진입 전 BLOCKER = F-mailbox amendment:** `meta-mailbox` transport 추가, `fire-and-forget + unsupported citizen → send/meta-mailbox/ack-only`, `owned-outcome + unsupported → reject` 유지. mailbox를 기존 6칸 `DISPATCH_TABLE`에 굽지 말고 별도 fact 입력으로 처리.
> - **이월(backlog):** 레거시 `entwurf_send` direct socket path는 아직 symlink guard를 안 탄다. v2는 facts를 쓰므로 보호됨; 레거시 완전 차단은 별도 hardening.
>
> **▣ 세션27 마무리 + 배포 확인 (2026-06-11, `main` push 완료):**
> - **contract-lock = 구현·커밋·푸시 완료** (`fa95a8a` feat 계약+게이트, `aeac8d8` schema 정확성 = **81 assertions**, `7aff4eb` docs).
>   GPT 1·2·3차 검수 통과 = freeze-ready. **GPT 3차 blocker 보강(`aeac8d8`):** receipt/input 스키마에
>   `additionalProperties:false` — discriminated union이어도 default가 extra key 허용이라 `{ok:true,reason}`
>   불법 영수증이 통과하던 구멍 차단(게이트가 `additionalProperties===false` assert). **Fable 코드-증거 교차검수 =
>   GO(2026-06-11)** — Fable `20260611T112732-0f42b6`가 6문 전수 PASS(라인레벨 소스 근거)로 회신, contract-lock
>   freeze 확정. 비차단 관찰 1건(FACT_LIVENESSES const↔FactLiveness 타입 exhaustiveness 링크)은 버킷 B R3b로 이월.
>   Opus `20260611T112840-57da07` 수신·반영.
> - **⚠ meta-bridge 배포 지연 발견(중요, 데이터 손상 아님):** 3D-4 v2 cut이 **소스만 v2**로 바꾸고
>   `pi/meta-bridge/.assembled/`(배포 번들 = Claude SessionStart 훅 실행체, gitignored, Jun 6)를 재조립 안 함 →
>   **라이브 writer가 여전히 v1**이었음. 그래서 당시 store 58개 전부 schemaVersion 1(v2 0개), 내 세션 포함.
>   v1 레코드는 `parseMetaRecordAny` dual-read로 정상 = 손상 아님, 그러나 "transition complete"는 **repo 기준만 참**.
>   왜 안 잡혔나: `store-doctor`가 dual-read라 all-v1에서도 green, install이 버전 stamp 안 함.
> - **고침 + 검증 완료:** `doctor-meta-bridge`에 **writer-version parity** 추가(`4c25fbf`) — source/assembled/
>   installed 각 live-write schema(`serializeMetaIdentity` 유무 = v2/v1) + content-hash + store 분포 출력,
>   installed≠source면 **FAIL "STALE → install-meta-bridge"**. 이후 `550e6db` + `50ac8e1`로 v2 writer의
>   load-bearing registry(`pi/entwurf-capabilities.json`)를 plugin-root에 번들하고, doctor가 **registry 없음/registry hash drift**도
>   FAIL하도록 보강(false-green 차단).
> - **배포 완료:** `./run.sh install-meta-bridge` 실행, 새 Fable/Opus Claude 세션 생성 후 `doctor-meta-bridge` **PASS**.
>   현재 writer parity: source=v2 / assembled=v2 / installed=v2, registry hash 모두 일치, store 분포 `v1=58 v2=2`.
>   새 세션 `20260611T112732-0f42b6`, `20260611T112840-57da07` 모두 schemaVersion 2로 기록됨.
> - **완전 전환(v1 dual-read 제거) 기준 3개 (GPT+GLG 합의, 그 전까진 additive 유지 = 안전장치, 더러움 아님):**
>   ① installed writer v2 확인(**완료**) ② 기존 v1 store migration/archival 방침 확정 ③ doctor가 live v1 의존 없음 증명.
> - **dev-flow 원칙 (박아둠 — 자기 발톱 깎기):** meta-bridge는 *우리 세션을 기록하는 바로 그 시스템*이라
>   schema/interface cut은 **additive + 버전 가시 + 배포 검증 후에야 legacy 제거**한다. **"source complete ≠
>   deployed complete."** entwurf_v2를 바로 `entwurf`로 안 한 것과 동일 이유 — 인터페이스 안정+버전 가시가 먼저.
> - **후속(process):** (a) Fable/Opus 교차검수 결과를 받아 contract-lock freeze를 최종 확정하거나 보강한다.
>   (b) release-gate에 source↔.assembled parity assert 검토(doctor는 머신-로컬, CI는 .assembled gitignore라 재조립-후-diff 필요).
- **(main track 현재 보정)** contract-lock + 버킷 B freeze + step 4 fact-provider core는 완료. 다음 큰 덩어리는 **F-mailbox amendment → step 5 `entwurf_v2` dispatch**다. 레거시 3-verb `entwurf`/`_resume`/`_send`는 완전 전환까지 무변경 유지하고, 통합 표면은 새 이름 `entwurf_v2`로 **additive**하게 올린다. `entwurf_peers`는 계속 **읽기 전용 fact 표면**(verb-routing 금지)이다. 과거 contract-lock 작업 단위·근거는 ↓ "entwurf_v2 contract-lock 작업 계획" 섹션.
- **step 3D-4 ✅ 완료 = the cut (끊을 지점 ②, GPT+Fable 리뷰 통과).** 커밋1 `31a246c`(dual-read seam +
  delivery-비결합 소비자) + 커밋2 `f0a20d7`(v2 write + migration + enqueue/read cut + 게이트 재작성). 이로써
  **meta-record v2 전환(3A→3D) 완결:** live write=v2 identity, receipt=state.json 단독, capability=registry,
  v1 dual-read 유지. 게이트: check-meta-session 49 / check-meta-mailbox-state-write 14 / check-meta-migration 14
  / check-meta-dual-consumers 9 / check-meta-capability-source 14, smoke 전부 green. GPT 보강(isEntwurf 런타임
  검증 + migration create/attach-v2 no-state claim) 반영. **남은 잔여:** 고정순서 7(MCP `pi-tools-bridge` wording
  — 구조 비의존이라 코드 무변경, 주석만) = 저우선.
- **잔여 인지사항 — capability registry(Fable 검수 2026-06-10):** (1) `pi/entwurf-capabilities.json`이 이제 **런타임
  load-bearing** — 3D-3 이후 모든 mint/parse가 이 파일에 의존, 누락/corruption이면 메타레코드 파싱 전체
  throw(fail-loud, check-pack이 tarball 포함 보장; 단 설치환경 깨지면 MCP 브리지 전체 멈춤 = 의존성 승격 인지).
  (2) mint/parse 자체는 registry 주입 안 받음(seam 주입은 `metaCapabilityFor` 레벨뿐) → 미래 리팩터가 mint
  내부를 const로 되돌려도 값이 같아 게이트가 못 잡음(정직한 한계, 게이트 주석에 명시). **3D-4에서 const가
  죽거나 강등되면 이 창 자연 소멸 — 그때 const 유일 소비자가 drift 게이트뿐인지 확인하고 처분 결정.**
- **3D-3 ✅ 완료** = `97c0503`. capability-source cut-over: mint/parse가 `wakeMode`/`deliveryLevel`을
  `META_BACKEND_DESCRIPTORS` → capability registry(`metaCapabilityFor` seam = memoized
  `loadMetaCapabilityRegistry`, 주입 가능)에서 읽음. const는 `check-entwurf-capabilities`의 drift-guard
  reference로만 생존(registry≡const = behaviour-preserving). `record.delivery.wakeMode` 슬롯 유지(제거는 3D-4),
  SOURCE만 이동. 게이트 `check-meta-capability-source` 14(doctored-registry 주입으로 registry-driven 증명,
  shipped/doctored 동적 비교) + check-meta-session 47 + check-entwurf-capabilities 15 green.
- **3D-2 ✅ 완료** = `79b3c98`. live receipt dual-write: `enqueueMetaMessage`/`readMetaInbox`가
  `record.delivery.*`(v1 home) stamp **유지** + mailbox `state.json`(3B) dual-write 추가, byte-identical. 게이트
  `check-meta-mailbox-dualwrite` 15 + smoke green. additive only. **비차단(3D-4 참고):** read-side가 drift'd
  `state.json`에 throw하면 메시지는 이미 `.read` archive라 재호출 0건 — no-rollback 스코프의 내재적 결과 = 수용.
- **entwurf_v2(step 4-5) = NO-GO** — contract-lock executable freeze(계약물 4종, 산문 금지) + 버킷 B
  먼저. (↓ "entwurf_v2 contract-lock 작업 계획" + Fable 섹션.)
다음 구현 세션 계약 — 이 7개는 본문 동결결정/Trust 2층/Stage 0의 재확인이며 다시 흔들지 말 것:
1. **Stage 0 step 1·2 = pi 0.79 bump/import/runtime guard + TS preflight module/gate 완료.**
2. **설계 재탐색 금지** — 검증 원장 항목 다시 찌르지 말 것(doctor 실패/구체 버그만 예외).
3. **regression gate 먼저 작성** (각 요소 테스트가 빌드보다 선행).
4. **그 다음 구현** (각 요소 gate→build→연결).
5. **untrusted controlled launch = fail-fast** (조용한 degraded 금지).
6. **launcher는 사용자에게 trust flag를 노출하지 않되 내부적으로 `--approve`를 붙임**
   (preflight가 trusted 판정 → 내부 `--approve`; controlled launch는 handler 의존 금지).
7. **`--no-approve` degraded 기본 금지.**
(전체 순서는 아래 "Stage 0 순서", 근거는 "동결 결정" + "Trust 2층". precedence는 동결결정 8.)

**개념 닻 = #35 (SSOT, workshop≠factory).**
bbot가 일부러 컨셉만 담았다. 아래는 그 frame 위에서 GLG와 동결한 *설계*다.

### 왜 0.11.0인가 — 전략 전환
- 현 entwurf spawn은 `pi -p` headless 전용 → **pi만 분신이 된다.** Claude를 분신으로 부르려면 Claude
  Code를 *live interactive* 로 띄워야 하고, native는 headless live 불가 → **tmux가 launch surface**
  (`claude -p`/`pi -p`는 fresh-context·disposable이라 live 분신 surface 아님).
- **ACP 중심에서 내림(유지·관리는 계속).** 6/15 이후 ACP 사실상 미사용(antigravity 미지원, claude/gemini
  미사용, pi codex 네이티브). 1.0.0 = pi-shell-acp는 `plugins/`로, 프로젝트 중심은 **meta-bridge entwurf**.
- **pi = 4번째 메타 백엔드.** `META_BACKENDS += "pi"`. THE 하네스에서 garden-id 동료 시민으로 (North
  Star "no backend is privileged" 현금화). **순서: pi headless/tmux-live 먼저 + 테스트 → 그 다음 Claude
  Code ↔ Claude Code live.**

### 넘으면 안 되는 선 (전부 #35)
- **Workshop, not factory.** 살아있는 소수 도제 = 재질문 가능, 상태는 세션 안 → 외부 DB(beads/dolt) 금지.
- **GC = tmux 프로세스 자원 회수만, 데이터 삭제 절대 아님.** meta-record/transcript(denote-id 기억층)는
  남김. Phase 4 data prune(listing-only)과 **별개 cleaner 표면** — collapse 금지.
- **garden-id = authority, tmux = ephemeral.** 세션명=path(grouping), window 번호 renumber.
- **Factory 작업 OUT.** worktree·merge-wall fan-out 없음 → 백엔드 자체 orchestrator로 위임.

### 핵심 아키텍처 — 데이터 4분리 + 한 동사
- **record(누구였나)** / **capabilities(무엇·어떻게 깨움)** / **mailbox(메시지·receipt)** /
  **probe(지금 살아있나, 저장 안 함 — 매번 계산)**. 상태를 저장하면 거짓말이 된다(denote-instinct 함정).
- **두 레인 둘 다 KEEP:** `pi -p` headless(오케스트레이션, 가벼움) + tmux-live(`--entwurf-control`
  소켓, 도제). resume/send는 세션 type이 아니라 **현재 liveness의 함수** — dormant→resume, live→send.
- **entwurf = 한 동사 (새 `entwurf_v2`로 통합, 레거시 공존 — 동결결정 10).** spawn/resume/send는 probe 결과의
  내부 디스패치; low-level primitive는 숨기되 유지. resume↔send는 caller 선택이 아니라 **liveness의 함수**
  (dormant→resume, live→send)를 단일 동사가 call-time 계산. **`entwurf_peers` = 읽기 전용 fact 표면**
  (liveness/capability/identity/cwd-이력만 보고) — `resumable`/`sendable` 같은 **verb-routing을 fact 층에
  굽지 않는다**(그러면 헛나감). **기존 `entwurf`/`_resume`/`_send`는 완전 전환까지 유지**(Claude 3주체 라이브).
- **브레인 ↔ 핸드 분리 (둘 다 TS).** 브레인=**TS fact 모듈** — disk SSOT(meta-record)를 읽어
  `activeEntwurfs` in-memory Map(= pi 프로세스 1개의 기억이라 형제가 못 봄 = 현 비가시성의 근본)을
  대체. 0.10.0 `meta-session.ts`(`scanByNativeId` 등) 재사용 + 소켓/tmux/pid probe. cross-harness
  노출은 **기존 `entwurf_peers` MCP**(standalone 바이너리 아님). 핸드=기계적 실행(기존 TS primitive
  재사용). **최종 형제 선택은 에이전트, 모듈은 근거 제공.** (쿼터·시스템 부하 같은 **부가 신호는 substrate가
  아니라 에이전트 층** — 각 백엔드 liveness가 동작한 *다음* 얹는다. 아래 backlog "부가 신호".)

### 검증 원장 — 실측 완료 (2026-06-09, 설계 재탐색 불필요)
| 요소 | 실측 결과 |
|---|---|
| tmux 3.6a | `@garden_id` 유저옵션 `list-panes -a -F` 라운드트립 OK(Claude 재실측 2026-06-09: `#{@garden_id}`+`pane_id`+`pane_pid` 동시 round-trip 확인). **`pane_title`은 shell/tmux 환경 의존이라 correlation authority 금지**("항상 덮어씀"은 과한 주장 — PS1/PROMPT_COMMAND 의존; authority로 안 쓰면 충분). 안전 필드만: `@garden_id`+`pane_id`+`pane_pid` |
| **pi 0.79 public export** | `hasProjectTrustInputs`/`ProjectTrustStore`/`getAgentDir`/`VERSION` 모두 index public export 확인 → TS 직접 import 가능(재구현 불필요). **repo는 2026-06-10 현재 0.79.1 핀(0.78→0.79.0→0.79.1 완료).** |
| pi 0.79 trust | `pi -p`는 **trust에서 안 멈춤**(비대화 미결정→`false` degraded). `--approve`(`trustOverride=true`)가 맨 앞 short-circuit. store=`~/.pi/agent/trust.json`. **0.79.1 변경: `ProjectTrustStore.get`이 cwd 정확-매치 → nearest-ancestor walk-up(`findNearestTrustEntry`)으로 바뀜** — 조상 cwd의 저장 결정을 자식이 상속한다. operator가 `~/repos/gh`를 distrust로 찍으면 그 아래 전 repo가 saved-false 상속(= 동결결정 8 precedence의 production 절반). `check-pi-preflight` 13 assertion에 못박음(2026-06-10). |
| trust input 정의 (0.79.1 소스 실측) | `hasProjectTrustInputs`: `.pi`는 **cwd 한정**(`hasProjectConfigDir`), `.agents/skills`만 root까지 walk. **0.79.1에서 `AGENTS.md`/`CLAUDE.md`(`CONTEXT_FILE_NAMES`)는 trust input에서 제거됨** — 이제 trust-gated 입력이 아니라 "항상 로드되는 context file"로 분리됨(npm 0.79.1 diff·실측 확인). canonicalize=`realpathSync`(없으면 raw 폴백). `CONFIG_DIR_NAME`은 `pkg.piConfig.configDir` override 가능(우리 repo는 override 없음 → `.pi`). **AGENTS-only repo는 0.79.1에서 fail-fast가 아니라 trusted-no-arg**, 그리고 우리 AGENTS 주입(`enrichTaskWithProjectContext`/`buildPiContextAugment`)은 trust와 무관한 자체 경로라 계속 동작한다. (디테일 베끼지 말고 pi 함수 직접 import) |
| **pi 0.79 trust API (확정, 재탐색 불필요)** | `--approve`/`-a`→`projectTrustOverride=true`(project 파일 **로드**), `--no-approve`/`-na`→`false`(project 파일 **무시**·degraded). handler `on("project_trust", (e:{cwd}, ctx:{mode,hasUI,ui}) => {trusted:"yes"\|"no"\|"undecided", remember?})`. `getAgentDir()`는 `PI_CODING_AGENT_DIR` honors → 테스트 격리는 그 env(0.10.0과 동일) 또는 주입 |
| meta v1 | schemaVersion=1, `lastSeen`+`delivery{}` 있음, `model`/`parentGardenId`/`isEntwurf` 없음. 디스크 claude-code v1 10+개 |
| **model@birth 없음** | Claude SessionStart stdin=`{session_id,transcript_path,cwd}`, `MetaMintInput`에 model 없음 → **v2 model/transcriptPath는 nullable** |
| pi liveness | 소켓 = `~/.pi/entwurf-control/<gid>.sock`(파일명=garden_id). **LIVE/STALE authority = portable socket connect + RPC `get_info`** — 이 repo `entwurf-control.ts`에 이미 있음: `isSocketAlive`(`net.createConnection`)·`getLiveSessions`·`getLiveSessionsWithInfo`(get_info로 cwd/model/idle enrich)·`gcStaleSockets`(connect 안 되는 소켓 unlink). **`ss -xlp`/`kill -0`은 Linux 실측·디버그 보조일 뿐 design authority 아님**(ss=Linux 전용, macOS 없음, pid 권한 의존). Claude 실측 2026-06-09: 소켓 3개 중 1개 STALE 확인(sweep 필요 실증) |
| **pi resume = no-lock append (Opus 2026-06-11 소스확정, F2)** | `SessionManager._persist`(0.79.1): 신규 첫 flush만 `openSync(file,"wx")`(session-manager.js:652/:1146 = 동시 *생성* EEXIST 가드). **resume 경로는 `setSessionFile`이 존재파일 로드→`flushed=true`(:551)→이후 `appendFileSync` plain append(:664) = 락 없음.** ∴ pi는 동시-resume를 self-guard 안 함. v2 target=존재 시민(R2)이라 항상 resume → pi `wx`(생성 가드)는 v2에 무용 → **per-gid lockfile이 유일 가드.** (라이브 race 테스트는 소스 확정이라 생략, 구현단계 게이트로 대체.) |
| pi tmux 부팅 | 강제 `--session-id <gid>` + `--entwurf-control` launch surface OK. **correlation=소켓파일명+@garden_id (environ PI_SESSION_ID는 상속/exec-snapshot이라 폐기)**. **GPT 재실측 2026-06-09: `pi --session-id <gid> --entwurf-control --approve --provider … --model …` → 소켓 생성·trust prompt 없음·TUI ready·모델 호출/토큰 0** = controlled invariant(`--approve` 주입)의 live-smoke로 게이트화 가능. (단 `--approve` 없는 no-prompt는 saved trust/prefix 상태 의존이라 설계 근거로 안 씀.) |
| pi 확장 API | `SessionStartEvent` 존재 → pi가 session_start에 meta-record upsert 가능(4th backend 경로) |

### meta-record v2 (nullable-at-birth)
```jsonc
{ "schemaVersion": 2, "gardenId":"…", "backend":"pi|claude-code|codex|antigravity",
  "nativeSessionId":"…", "cwd":"…",
  "model": null, "transcriptPath": null, "parentGardenId": null, "isEntwurf": false,
  "createdAt":"…", "recordUpdatedAt":"…" }
// 제거: status·lifecycle·wakeMode·deliveryLevel·delivery.*·trusted·tmuxTarget
// recordUpdatedAt = record touch time(이름으로 못 박음), liveness 아님
```
- **`model`/`transcriptPath` nullable 근거:** Claude SessionStart는 birth에 transcript_path를 주지만
  pi backend는 birth(session_start upsert)에 미확정일 수 있음 → 최소공통(minimum common denominator)
  으로 nullable, 이후 채움. model은 어느 백엔드도 birth stdin에 없음.
- **기존 v1 게이트는 의도적 재작성 대상.** v2가 `delivery.*`→mailbox state, `wakeMode`→capabilities.json
  으로 옮기므로 0.10.0 `check-meta-session`(receipt-in-record)·`smoke-meta-mailbox`·backend↔wakeMode
  단언 일부가 **깨진다 = update 대상이지 regression 아님.** dual-read 경로엔 v1 fixture 게이트를 별도 유지.
- **구현 계약(step 3 순서):** `parseMetaRecordV1/V2`·`normalizeMetaIdentity`는 아직 없음(현재 단일
  `parseMetaRecord` meta-session.ts:283) = 미실측이 아니라 **신규 작업.** 게이트 먼저: **v1 fixture를 golden으로
  고정 → `normalizeMetaIdentity` 출력을 golden assert → 그 다음 v2 writer를 붙인다.**

### 동결 결정 9개
1. 능력 레지스트리 = 새 파일 `entwurf-capabilities.json` (targets=launch allowlist와 별 관심사)
2. v1→v2 = `parseMetaRecordV1/V2`→`normalizeMetaIdentity` dual-read + lazy normalize, 새 write는 v2.
   v1 receipt 필드는 읽되 v2에선 mailbox state로 이동
3. correlation = 소켓파일명 + tmux `@garden_id`. **env probe 폐기 + launcher가 identity env scrub/명시
   override**(상속 누수 차단; lineage는 `PARENT_SESSION_ID`를 launcher gid로 명시 set)
4. **preflight/facts owner = 단일 TS 모듈** (`pi-extensions/lib/entwurf-preflight.ts` 예정). TS
   launcher / global `project_trust` handler / MCP fact tool 모두 **그 결과만 소비** — 누구도 prefix/
   trust.json 판정을 재구현하지 않음. pi raw trust는 그 모듈이 pi public export를 직접 import.
   **주입 가능 시그니처**: `preflight({cwd, agentDir?=getAgentDir(), prefixRoots?=operator config})` —
   tests는 temp agentDir(또는 `PI_CODING_AGENT_DIR`, 0.10.0과 동일 격리)만 써서 real
   `~/.pi/agent/trust.json`을 읽거나 오염하지 않는다. **trust ≠ discovery**: trust 판정(`ProjectTrustStore`
   락 read)은 **launch-time 단일 cwd**만; `peers`/`who-can` discovery는 trust 불필요(스토어 안 건드림,
   `scanByNativeId`+probe 재사용). `plan` JSON은 explicit target일 때만. **최종 형제 선택은 에이전트.**
5. untrusted controlled launch = **fail-fast** (조용한 `--no-approve` degraded 금지). 근거(0.79.1 소스 확정):
   pi `--no-approve`(`-na`)는 "거부"가 아니라 **trust-gated project-local(`.pi/settings.json`·`.agents/skills`)을
   무시하고 degraded 실행.** trusted만 `--approve`(project 파일 로드), 아니면 throw.
   **(0.79.1 갱신:** 예전 근거였던 "repo `AGENTS.md`를 못 받아 담당자 컨텍스트가 깨진다"는 **무효** — 0.79.1에서
   AGENTS.md/CLAUDE.md는 trust-gated가 아니고, 우리 담당자 주입은 `enrichTaskWithProjectContext`/
   `buildPiContextAugment` 자체 경로라 trust와 무관하게 동작한다. fail-fast의 진짜 근거는 **untrusted repo의
   `.pi/settings.json`이 bridge `loadProviderSettings`로 적용되는 위험** — 아래 정렬 가드의 bootstrap reader.)
6. `project_trust` handler `remember` = **false** (prefix policy = SSOT, trust.json 안 더럽힘).
   **carve-out(Fable 검수 F5b, 2026-06-10):** `remember:false`는 **prefix-policy 한정**이다. **인간이 명시적으로
   상속-distrust를 덮어쓴 child override**(handler가 직접 prompt → yes)는 **`remember:true`로 trust.json 저장**
   — prefix 자동승인이 아니라 사람의 직접 선택이라 정당. (상세는 아래 Fable 검수 섹션.)
7. prefix auto-approve roots = **operator policy, NOT package default** (보안). 이 repo는 public
   package라 broad auto-approve(`~/repos/gh` 전체 등)를 패키지 기본값으로 하드코딩하면 타 사용자에게
   security footgun. source = **trusted operator surface만** — `PI_SHELL_ACP_TRUST_ROOTS` env /
   user-global settings / agent-config 주입. **project-local `.pi/settings.json`·project package·cwd
   resource는 trust 결정 입력으로 절대 읽지 않음**(untrusted 입력으로 trust 정하면 순환/취약). match =
   **canonical path + separator boundary**(pi와 동일 정규화; `/org`는 `/org/a` 매칭, `/org2` 불매칭 —
   bare `startsWith` 금지). **GLG 환경 기본값**(설정으로 활성) = `~/repos/gh`, `~/repos/work`, `~/org`
   (**`~/repos/3rd` 제외**). roots 정책은 **preflight 모듈 한 군데** 소유; tests는 fixture roots 주입.
8. **precedence 동결:** `saved false > saved true > prefix match > no-trust-inputs > fail-fast`.
   명시적 distrust(false)는 prefix보다 강함; prefix는 **미결정(null)만 yes로 승격**; trust input이
   없으면 trusted지만 launch arg 없음; 그 외 unknown/untrusted controlled launch는 fail-fast.
9. **import surface = public root export만** (`@earendil-works/pi-coding-agent`의 `getAgentDir`,
   `hasProjectTrustInputs`, `ProjectTrustStore`, `VERSION`, + handler 타입 `ProjectTrustEvent`/
   `ProjectTrustEventResult`/`ProjectTrustHandler`). `/dist/core/...` private subpath import 금지 —
   static 가드가 **index.ts / pi-extensions / mcp / scripts / plugins 전부** 스캔. pi가 export 제거하면
   tsc 실패 = 공짜 drift 게이트(dev-time). **runtime**: doctor/check가 pi `VERSION >= 0.79.1` 확인 —
   0.78 런타임에서 named export import가 깨지므로 친절히 fail-loud(tsc만으론 설치 환경 못 잡음).
10. **공개 동사 먼저 축소 (contract-lock) → fact-provider(facts only) → dispatch.** (GLG 2026-06-10)
    entwurf 공개 표면을 **한 동사**로 줄이고 `entwurf_peers`를 **읽기 전용 fact 표면**으로 못박는 걸
    **fact-provider 빌드보다 먼저** 한다. 순환처럼 보이지만 **contract(인터페이스 모양, 지금 잠그는 결정)와
    implementation(dispatch, probe 필요)을 분리**하면 풀린다: contract 먼저 → fact-provider는 그 위에서
    facts만 보고 → dispatch가 facts로 resume/send를 call-time 계산. **순서 근거:** 3-verb 표면을 켜둔 채
    discovery를 지으면 fact 층에 verb-routing(`resumable`/`sendable`)이 구워져 **entwurf_peers가 헛나간다**
    — 그래서 "처음에 줄여야". **scope(GLG 확정 2026-06-10 = A):** 기존 외부 MCP `entwurf`/`entwurf_resume`/
    `entwurf_send`는 **건드리지 않고 완전 전환까지 유지**한다. 지금 **Claude 3주체가 그 표면으로 라이브 협업
    중** — 부수면 당장 못 쓴다. 1-동사 통합 dispatch는 **레거시와 공존하는 새 이름**(provisional
    `entwurf_v2`)으로 **additive하게** 올린다(0.11 dual-write 교리와 동일: 3D-2가 `delivery.*`를 유지하며
    receipt state를 더하듯, 새 통합 표면을 더하고 레거시를 안 깬다). 레거시 3-verb **은퇴는 `entwurf_v2`
    경로 증명 + 완전 전환 이후에만.** liveness-routing 축(resume↔send) ≠ outcome-ownership 축(mode/
    wants_reply); 후자 파라미터는 유지. (이번 라운드 현금화 대상 = pi-native dispatch.)
    **→ 이 "contract-lock"의 미해결 빈칸은 Fable 5 검수(아래 별도 섹션)가 채운다: F1 caller-intent×liveness 6칸표,
    F4 backend별 liveness 술어 추상화, F6 contract=TypeBox 스키마+결정표+error taxonomy(산문 아님). 그것이
    잠긴 후라야 step 4-5 진입.**

### Trust 2층 (구현 형태 — 둘 다 같은 TS preflight 모듈 소비)
핸들러 API 확정: `on("project_trust", (e:{cwd}, ctx:{mode,hasUI,ui}) => {trusted:"yes"|"no"|"undecided", remember?})`.
**defer = `{trusted:"undecided"}`** — `emitProjectTrustEvent`(runner.js:70)가 undecided를 `continue`로 fallthrough,
`yes`/`no`만 즉답 채택. **`undefined` 반환 금지**(runner가 `handlerResult.trusted` 접근 → TypeError = extension
error, 깨끗한 abstain 아님). **N4 기각**(Fable 2차의 `=> Result | undefined`는 소스 미스, GPT 2026-06-10 교정).
- **사람이 직접 여는 pi** = global `project_trust` 확장이 preflight 결과를 매핑(안전망):
  - approve → `{trusted:"yes", remember:false}`
  - saved false(명시적 distrust) → `{trusted:"no", remember:false}`
  - fail-fast/unknown → interactive(`ctx.hasUI`)면 **`{trusted:"undecided"}`** 로 pi 기본 prompt에 defer
    (소스 확정 0.79.1: `emitProjectTrustEvent` runner.js:70이 undecided를 `continue`로 fallthrough →
    result undefined → `resolveProjectTrusted`가 store.get→defaultProjectTrust→prompt 흐름. **핸들러 `undefined`
    반환 금지** = TypeError). `undecided`(defer) ≠ `no`(즉답 false).
  - **상속-distrust 탈출구(F5b):** inherited-false인데 사람이 이 cwd만 믿고 싶을 때, undecided로 defer해도
    그 다음 `store.get`이 nearest-ancestor false를 non-null로 줘서(project-trust.js:37) prompt 없이 false다 →
    **핸들러가 직접 prompt 띄우고 yes면 `{trusted:"yes", remember:true}`**(동결결정 6 carve-out)만이 유일한 탈출구.
    (사람이 **no**면 `{trusted:"no", remember:false}` — child false 안 씀, inherited가 이미 커버.)
- **launcher가 여는 controlled session** = handler에 의존 금지(`--no-extensions`면 안 돎).
  같은 `preflight(cwd)` 모듈로 판단 → trusted면 `--approve`, untrusted면 **throw**(undecided/no 둘 다).
- 두 경로가 **동일 모듈**을 부르므로 판정 불일치가 구조적으로 없음. `remember:false`는 동결결정 6(trust.json 안 더럽힘).
- **handler 위치 = user/global extension 또는 CLI `-e` extension만.** pi 0.79에서 `project_trust`는
  project resources load *전*에 발화 → project-local extension은 그때 아직 로드 안 됨 = 안전망 못 됨.

### preflight 정렬 가드 (Stage 0 step 5, 소스 확정 — 구현 세션 필수)
controlled launch는 **preflight(trusted 판정)를 모든 project-local manual read보다 먼저** 실행한다.
trusted 전에는 cwd 아래 어떤 project-local 파일도 읽지 않는다 — pi가 trust gate를 세웠는데 bridge가
옆문으로 읽으면 정렬이 깨진다. 실측된 bridge-local readers(현재 trust 무관하게 읽음):
> **0.79.1 갱신(2026-06-10):** 아래 3 reader 중 AGENTS.md를 읽는 `enrichTaskWithProjectContext`·
> `buildPiContextAugment`는 0.79.1이 AGENTS.md를 trust input에서 빼면서 **pi-trust gate 대상이 아니게 됐다**
> (= 항상 로드되는 context file). 진짜 pi-trust 정렬 대상은 `.pi/settings.json`을 읽는 **`loadProviderSettings`
> 하나**로 좁혀진다(GPT 2026-06-10 리뷰가 집중하라 한 지점). AGENTS reader 정렬은 bridge-hygiene 차원의 별도
> 선택이지 pi-trust 강제는 아니다 — Stage 0 step 5 스코프(parent `enrichTask` 정렬)는 유지하되 근거를 이렇게 읽는다.
- **부모 spawn-side reader:** `enrichTaskWithProjectContext` (`pi-extensions/lib/entwurf-core.ts:1101`,
  read at 1105) → target `cwd/AGENTS.md`를 자식 prompt에 주입. controlled launch preflight의 직접
  보호 대상.
- **bridge bootstrap-side reader:** `loadProviderSettings` (`index.ts:642`, `readSettingsFile(join(cwd,
  ".pi", "settings.json"))`) → bridge backend session 설정. provider/ACP 세션 부팅면의 project-trust
  정렬 대상.
- **bridge first-user augment reader:** `buildPiContextAugment` (`pi-context-augment.ts:125–149`, 호출부
  `index.ts:974–985`) → `~/AGENTS.md` + `cwd/AGENTS.md`. `pi-context-augment.ts`는 실재 파일이며
  실제 `readFileSync` 위치다. 호출부(`index.ts`)만 보고 실재 reader를 놓치지 말 것.

**Stage 0 step 5 스코프 경계 (산행 방지 — 코드 확정 2026-06-09):**
- **parent pre-spawn reader = `enrichTaskWithProjectContext` 하나** → Stage 0가 **직접 gate**한다.
  call edge: `부모 entwurf 실행 → preflight(target cwd) → enrichTask(target cwd/AGENTS.md) → spawn child pi -p`.
  Stage 0 직접 작업 = **preflight를 enrichTask보다 앞으로 이동**.
- **child/bridge bootstrap reader = `loadProviderSettings` + `buildPiContextAugment`** (둘 다 `streamShellAcp`
  index.ts:866 내부, 호출부 1256). Stage 0는 이 둘을 **직접 gate하지 않는다.** 단 "controlled launch와 무관"은
  아님 — controlled launch가 `provider=pi-shell-acp` child를 띄우면 **bridge가 그 child 안에 살아서**
  (spawn sites: `entwurf.ts` async spawn, `entwurf-async.ts` async resume, `entwurf-core.ts` sync spawn/resume;
  provider stream registered at `index.ts:1256`) child 프로세스가 자기 `streamShellAcp`에서 이 reader들에
  도달한다. 이들은 **child 자신의 cwd**를 읽는 child-bootstrap reader지 부모 pre-spawn reader가 아니다.
- **보호 메커니즘 = controlled launch invariant** (현재 코드에 없음 = step 5 신규): preflight allow 없이는
  child를 spawn하지 않고, allow된 child에는 내부 `--approve`를 반드시 붙인다. 따라서 child가 `streamShellAcp`에
  도달하기 전 trust가 이미 확정 → child-bootstrap reader 직접 gate가 불필요.
- **결론:** Stage 0 작업 범위 = **parent pre-spawn `enrichTask` 정렬 + child launch `--approve`/no-spawn
  invariant** 둘뿐. bridge bootstrap-side reader 직접 정렬은 **별도 bridge-surface 트랙(#25 또는 Stage 1)**이며
  Stage 0가 그쪽으로 번지면 0.11 "ACP 중심에서 내림" 방향과 충돌한다.
- 사람이 직접 여는 pi의 native resource-load trust 흐름은 pi가 순서를 보장한다(이 가드는 controlled/entwurf
  launch 한정).

### Packaging — 새 언어/바이너리 없음
0.11은 순수 TS. 새 빌드 toolchain·바이너리·node helper 프로세스 없음. brain/preflight/facts는
`pi-extensions/lib` TS 모듈, cross-harness는 기존 pi-tools-bridge MCP. (미래에 진짜 node 없는 fact
소비자가 생기면 그때 TS 코어 위에 얇은 래퍼를 얹는다 — YAGNI, 0.11엔 안 둠.)

### Stage 0 순서 (pi only, 순수 TS)
1. **pi deps 0.79 bump + public-import 가드** — pi-ai/pi-coding-agent/pi-tui devDep 0.79.1, peer
   `>=0.79.1`(2026-06-10 0.79.0→0.79.1 완료). `/dist/...` private import 금지 static 가드.
2. **TS preflight 모듈** — pi trust public export 직접 import + prefix overlay + precedence(동결결정 8).
   게이트: synthetic fixture에서 pi 자기 함수와 대조(같은 프로세스라 trivial) + precedence 단위 테스트.
   controlled-launch decision(JSON/내부 객체) 산출.
3. **meta-record v2** — identity-only, pi backend 포함, v1 dual-read+normalize. 기존 v1 게이트 재작성.
   **(전제: 동결결정 10 contract-lock을 step 4보다 먼저 잠근다 — entwurf=공개 동사 1개, `entwurf_peers`=
   읽기 전용 fact 표면. 그래야 아래 fact-provider가 verb-split을 굽지 않는다.)**
4. **TS fact-provider (facts only)** — `peers`/`who-can`/`preflight`. `meta-session.ts`·mailbox·소켓/tmux
   probe 재사용, 기존 `entwurf_peers` MCP로 cross-harness 노출. **fact만 보고**(liveness/capability/identity/
   cwd-이력) — verb-routing 금지(동결결정 10). **liveness authority = 기존 `entwurf-control.ts`의
   `isSocketAlive`(`net.createConnection`)·`getLiveSessions`·`getLiveSessionsWithInfo`(RPC `get_info`)·
   `gcStaleSockets`를 lib로 추출/재사용.** 새 `ss`/`kill` probe 표면을 만들지 않는다(Go 드롭했는데 Linux
   CLI probe로 새 표면이 도로 생기는 걸 막음 — portable socket/RPC 경로가 이미 있음).
   **probe lib 추출 = 이 step 4의 첫 슬라이스로 F3 수정에서 선제 완료**(`pi-extensions/lib/socket-probe.ts`,
   3값 `SocketLiveness` export). fact-provider가 3값 liveness를 fact로 노출해야 할 때(버킷 B R3b) 이미 준비됨 —
   양쪽 표면의 boolean `isSocketAlive` 래퍼는 listing 정책 소비라 그대로 두고, 3값 노출만 추가하면 된다.
5. **상위 entwurf 단일 표면 (새 `entwurf_v2`, 레거시 공존)** — preflight + fact-provider 소비 → liveness로
   resume/send call-time 계산, trusted면 내부 `--approve`로 `pi -p` bg / tmux-live dispatch, untrusted면
   fail-fast. **레거시 `entwurf`/`_resume`/`_send`는 안 건드리고 완전 전환까지 유지**(additive; 동결결정 10).
   **preflight를 project-local read보다 먼저**(위 "preflight 정렬 가드"). primitive 내부 유지. **쿼터·부하
   부가 신호는 여기 안 넣음**(에이전트 층, 백엔드 liveness 동작 후 — backlog).
→ **각 요소는 테스트 코드로 먼저 검증, 연결은 그 다음.** Stage 1 = Claude Code ↔ Claude Code live
(그때의 trust는 pi가 아니라 Claude 모델 → 별도 backend preflight, 0.11 Stage 0 범위 밖).

> **진행 (2026-06-09):** step 1(pi 0.79 bump + import/runtime 가드) = 커밋 `be6ccde`. step 2(TS
> preflight 모듈 `pi-extensions/lib/entwurf-preflight.ts` + `check-pi-preflight` 10 assertions) = 커밋
> `b2c7824`. **step 3A**(v1→v2 identity normalize: `parseMetaRecordV1/V2`·`normalizeMetaIdentity` +
> strict v2 keyset + `check-meta-record-v2` 17 assertions 골든) = 커밋 `ed58102` (GPT 끊을 지점 ① 통과).
> **step 3B**(mailbox receipt state schema+store `MailboxReceiptState`·`stampMailboxReceipt` +
> body/path gardenId drift fail-fast + field 런타임 검증 + `check-mailbox-receipt-state` 19 assertions)
> = 커밋 `7d69691` (GPT 리뷰 통과, schema/store-only — live dual-write·delivery 제거는 3D).
> **step 3C**(backend capability source `pi/entwurf-capabilities.json` + `parseMetaCapabilityRegistry`
> coverage==META_BACKENDS_V2 + 기존 3 backend ≡ `META_BACKEND_DESCRIPTORS` drift guard +
> `check-entwurf-capabilities` 15 assertions, **pi wakeMode=direct-inject** = control-socket triggerTurn
> 직접 주입, packaging `files`+check-pack 등재) = 커밋 `0be536c` (GPT 리뷰 통과, parser/gate-only — live
> consumer 갈아엎기·record wakeMode 제거는 3D). **step 3D-1**(pure v2 write shape `serializeMetaIdentity`
> + dual-read dispatcher `parseMetaRecordAny`(schemaVersion peek→V1/V2) + `parseMetaIdentity`(dual-read→
> normalized identity) + `check-meta-dual-read` 14 assertions) = 커밋 `232d02c` (GPT 리뷰 통과, pure-only —
> FS upsert·live·delivery 제거 전부 없음). **step 3D-2**(live receipt dual-write: enqueue/read가
> `record.delivery.*` 유지 + mailbox `state.json` dual-write, byte-identical invariant + 빈 inbox no-op +
> drift fail-loud, `check-meta-mailbox-dualwrite` 15) = 커밋 `79b3c98` (GPT+Fable 리뷰 통과, additive only).
> **step 3D-3**(capability-source cut-over: mint/parse가 wakeMode/deliveryLevel을 `META_BACKEND_DESCRIPTORS`
> → capability registry(`metaCapabilityFor` seam, 주입 가능)에서 읽음; const는 drift-guard reference로만 생존;
> `check-meta-capability-source` 14) = 커밋 `97c0503` (GPT+Fable 리뷰 통과, behaviour-preserving).
> **다음 = step 3D-4(v2 writer/upsert + gate update = 끊을 지점 ②).**
>
> **진행 (2026-06-10, pi 0.79.0→0.79.1 side-quest — 본궤도 3D-2와 별개, 깨짐 방지용 선반영):**
> pi 0.79.1이 trust-manager를 둘 바꿈: (a) `hasProjectTrustInputs`에서 AGENTS.md/CLAUDE.md 제거,
> (b) `ProjectTrustStore.get`을 nearest-ancestor walk-up으로 변경. npm 0.79.1 diff·실측으로 둘 다 확정.
> 검증원장·동결결정 5·정렬 가드를 위에서 갱신했고 3 커밋으로 반영: `994353d`(preflight fixture
> AGENTS.md→`.pi/`, 0.79.0-safe 선행 — 0.79.0에서 green 체크포인트) → `f2bcb64`(deps 0.79.0→0.79.1
> lockstep: devDep/peer floor `>=0.79.1`/run.sh check-pack-install 핀/runtime FLOOR/lockfile) →
> `f141c3f`(0.79.1 nearest-ancestor 상속 assertion 3개, preflight 총 13). `pnpm check` + heavy
> `check-pack-install` 모두 0.79.1에서 green. **본궤도(3D-2)는 변경 없음 — bump가 derail하지 않았다.**
> (push 완료.) **잔여 follow-up:** `entwurf-preflight.ts` 헤더 주석 "no-trust-inputs = nothing
> project-local to load"는 0.79.1 기준 "no trust-gated input"으로 표현 정밀화 가능(코드 로직은 정확, 문구만).
>
> **3D 4-조각 분해 (GPT 2026-06-09, live path라 한 덩어리 금지):**
> - **3D-1 ✅** pure dual-read/writer (serializer + dispatcher + identity path, FS 연결 없음) = 이번 커밋.
> - **3D-2 ✅** live receipt dual-write (`79b3c98`) — `enqueueMetaMessage`/`readMetaInbox`가 기존
>   `record.delivery.*` stamp 유지하면서 mailbox receipt state(3B)도 stamp. additive only, delivery 유지,
>   byte-identical invariant, 빈 inbox no-op, drift fail-loud. `check-meta-mailbox-dualwrite` 15 + smoke green.
> - **3D-3 ✅** capability-backed metadata (`97c0503`) — mint/parse 소비처를 `META_BACKEND_DESCRIPTORS`
>   → capability registry(3C, `metaCapabilityFor` seam)로 전환, 기존 3 backend drift guard 유지, const는
>   drift-guard reference로만 생존. `record.delivery.wakeMode` 슬롯 유지(제거는 3D-4). `check-meta-capability-source` 14.
> - **3D-4 ✅** v2 writer/upsert + the cut (`31a246c` commit1 dual-read seam + `f0a20d7` commit2 the cut) —
>   live write=v2, receipt=state.json 단독, v1 dual-read 유지. 게이트 재작성(check-meta-session 49 /
>   check-meta-mailbox-state-write 14 rename / check-meta-migration 14 신규 / smoke state.json). **끊을 지점 ②
>   = GPT+Fable 리뷰 통과.** 상세 계획은 ↓ 섹션(이력 보존).

### Stage 0 step 3D-4 작업 계획 — 정찰 완료 (GPT+Fable 자문 통합 2026-06-10, 재정찰 불필요)

3D-4 = v1 delivery authority를 끊고 **v2 identity + state.json(receipt) + registry(capability)**로 단일화.
~10 함수 + 3 게이트 + prune이 얽힌 cut이라 **2-커밋 분할**(분할선 = delivery 결합 여부, Fable 정정).
구현 세션은 이 섹션의 라인·분류·결정으로 재정찰 없이 게이트부터 작성한다.

**커밋1 (green checkpoint — delivery-비결합 dual-read 소비자, store 안 깨고 되돌리기 쉬움):**
- 신규 `readMetaIdentityByGardenId`(`parseMetaIdentity` dual-read). `readMetaRecordByGardenId`(meta-session.ts:1188)는 **유지**(커밋2 처분).
- **`scanByNativeId`(:790) → dual-read/identity scan (G1, GPT — 빠지면 duplicate-mint 버그):** 커밋2에서 upsert가
  v2 write 시작하면 다음 attach 때 이게 v2를 못 읽으면 **존재하는 시민을 못 찾아 중복 mint** → 커밋1에서 미리
  v1·v2 둘 다 읽게(backend/nativeSessionId만 보니 identity로 충분, delivery-비결합). invariant ④의 작업 항목.
- `meta-bridge-prune.ts`(:23 import, :97 parse, :111-114 필드, :132 transcriptPath, :140 `lastSeen`) →
  `parseMetaIdentity` + `lastSeen`→`recordUpdatedAt`. **transcriptPath nullable 규칙(G2, GPT — null≠orphan):**
  `null`은 orphan **아님**(pi nullable-at-birth = "미확정/없음", "파일 사라짐"과 다름) — orphan은
  `typeof===string && !exists`만, stale은 `recordUpdatedAt` 기준만.
- `meta-bridge-store-doctor.ts:34` `parseMetaRecord` → `parseMetaRecordAny`.
- `mcp/pi-tools-bridge/src/index.ts:337-338`(marker 검증, `rec.backend`/`rec.nativeSessionId`만 봄 = identity로 충분)
  → `readMetaIdentityByGardenId`로 **의도적 분류**(H4; typecheck 우연 통과 금지). `entwurf_inbox_read` receipt는
  `readMetaInbox` 반환 경유라 state-stamp 후 자연 정합 = 무변경 OK.
- 게이트: synthetic v2 fixture로 scan/prune/doctor/marker가 **v1·v2 둘 다** 읽음 = green checkpoint.

**커밋2 (the cut, 끊을 지점 ② = GPT 큰 리뷰 대상 — delivery-결합 3인방, 서로 의존이라 atomic):**
- `mintMetaIdentity`(v2) + `MetaIdentityMintInput`{`backend:MetaBackendV2`(pi 포함), `nativeSessionId`, `cwd`,
  `model?`, `transcriptPath?`(nullable), `parentGardenId?`, `isEntwurf?`}. `mintMetaRecord`(v1)/`MetaMintInput`은
  v1-fixture/dual-read 게이트용 **보존**.
- **attach merge 3-값 규칙(G5, GPT — optional≠null):** `decideUpsert` attach 시 optional 필드
  (model/transcriptPath/parentGardenId)는 `undefined`=기존 값 **보존**, `null`=명시적 unknown/clear, `string`=갱신.
  (안 그러면 pi birth의 null 입력이 기존 transcriptPath를 지움.) 게이트로 3-값 구분 assert.
- `decideUpsert`(:838)/`upsertMetaSession`(:1140, **+optional `mailboxDir` 기본값** = enqueue/read와 동일 패턴, hook
  무변경)/`atomicWriteRecord`(:1157) → `serializeMetaIdentity`(v2) write.
- **`readMetaRecordByGardenId`(:1188) 처분(G3, GPT — 반환 타입 flip 금지=이름 거짓말):** v1 legacy 전용으로
  `readMetaRecordV1ByGardenId`로 **rename/강등**, live path는 `readMetaIdentityByGardenId`만.
- 신규 `migrateV1DeliveryReceipts`(별도 export, **단독 게이트**): per-field `merged[f]=state[f] ?? v1[f]`(state wins),
  **timestamp 3개만**(`lastEnqueuedAt`/`lastDeliveredAt`/`lastReadAt` — wakeMode/deliveryLevel은 registry 소유, 통째-merge면
  3B strict keyset throw = H2). **crash-order: state merge를 v2 rewrite보다 먼저**(사이 crash 시 record 여전히 v1 →
  다음 attach 재migration = 멱등 안전; 반대 순서는 receipt 영구 소실).
- `enqueueMetaMessage`(:1249 markEnqueued)/`readMetaInbox`(:1307 read, :1333 markRead) — record-stamp **중단**,
  state.json만(`readAt`←state stamp).
- `markEnqueued`(:876)/`markRead`(:886)/`markDelivered`(:881) 처분(삭제 or v1-fixture 전용 명시 강등 = H3);
  `check-meta-capability-source`의 `mintMetaRecord`(v1) "live mint" docstring re-label(H3).
- 게이트 재작성(정당 update, regression 아님): `check-meta-session`(:80-88 delivery seed, :130-131 keyset,
  :161-167 delivery parse, :559 `.delivery.lastReadAt` → **v2 identity 단언 + v1-fixture dual-read 서브게이트**),
  `check-meta-mailbox-dualwrite`(H1: "record.delivery v1 home intact" → **"identity 파일 byte-identical + state만 stamp"**;
  cut 후 dualwrite 이름이 거짓말 → `check-meta-mailbox-state-write`류로 **rename**=정리1),
  `smoke-meta-mailbox`(:107-108 `.meta.json` delivery.lastReadAt → **state.json lastReadAt**).
- 신규 게이트: migration **4케이스 분류(G4 정밀화, GPT — state-wins ↔ no-create 충돌 방지):** create=state 무변경 /
  attach v2→v2=무변경 / **attach v1→v2 = v1 receipt가 state의 null 필드를 실제로 채울 때만 write 1회** /
  **state가 이미 이기거나 v1 delivery 전부 null = no-write/no-create**("migrating nothing is not a receipt") +
  crash-order(drift-throw로 record 여전히 v1 assert).

**invariant 체크리스트 (커밋2 게이트로 박을 것 — GPT 8 + Fable 보강):** ①upsert create→`schemaVersion 2`
②v2엔 delivery·lastSeen 없음 ③attach→`recordUpdatedAt`(lastSeen 아님) ④scan/read v1·v2 둘 다 수용 ⑤enqueue/read는
**identity 파일 byte-identical, mailbox state만 변경** ⑥빈 inbox는 record도 state도 무변경 ⑦v1 legacy fixture 여전히
normalize ⑧v1 delivery receipt가 state로 migrate(conflict 시 state wins, 전부 null이면 no-create).

### entwurf_v2 contract-lock 작업 계획 — step 4 진입 전 executable freeze (2026-06-11, Opus 실측 + GPT 보정 + Fable R1-R5 수렴)

> **✅ 구현·커밋 완료 + Fable 코드검수 통과 (2026-06-11, `fa95a8a` feat + `7aff4eb` docs — push는 GLG; Fable 교차검수 = 구조 GO):** 계약물 4종, 전체
> `pnpm check` EXIT=0(새 게이트 `check-entwurf-v2-contract` **81 assertions** + 전 게이트 + check-pack 113 files).
> - `pi-extensions/lib/entwurf-v2-contract.ts` — 순수 계약: `ENTWURF_INTENTS`/`FACT_LIVENESSES`(4값)/
>   `LIVENESS_DOMAIN_BACKENDS`(=["pi"], R1) + `factLivenessOf`/`dispatchLivenessOf` + `DISPATCH_TABLE`(6칸
>   상수, 칸당 단일 verdict) + `ENTWURF_V2_REJECT_REASONS`(R5, `target-locked` 선점 포함) + 순수
>   `resolveDispatch` + TypeBox `EntwurfV2InputSchema`/`EntwurfV2ReceiptSchema`(`Type`/`StringEnum` via pi-ai).
>   **런타임 dispatch/spawn/IO 없음**(step 5).
> - **GPT 2차 검수 보강(2026-06-11):** (1) 영수증 = `Type.Union(success|reject)` **discriminated** — flat-optional이
>   `{ok:true,reason}` 불법 영수증 허용하던 구멍 차단. (2) `target`에 `SESSION_ID_RE.source` **pattern** 박음
>   (오타 gid가 스키마에서 탈락 = R2/F6 executable). (3) drift guard에 `mode`/`action`/`ownership` enum 추가 +
>   `mode` 설명을 outcome-ownership → **delivery mode(steer/follow_up)** 로 교정.
> - `scripts/check-entwurf-v2-contract.ts` — R1 도메인 가드 / 6칸 전수+단일 verdict(Q2) / N1 indeterminate
>   무spawn / Q2 owned-live 무autosend / **R3 "결정표 칸 ↔ 영수증" round-trip 전수** / R5 taxonomy+pre-claim /
>   **union 2-branch + 불법 영수증 배제(success엔 reason 없음·reject엔 allow facet 없음) + target pattern +
>   전 enum drift**. run.sh case+help + `pnpm check` 편입.
> - **끊을 지점 통과 = Fable 코드-증거 교차검수 GO**(2026-06-11, 6문 전수 PASS, 라인레벨 소스 근거 — Fable
>   `20260611T112732-0f42b6`). 비차단 관찰 1건(FACT_LIVENESSES const↔FactLiveness 타입 exhaustiveness 미링크)은
>   버킷 B R3b로 이월(같은 커밋 강제 아님). **버킷 B 잔여 freeze = ✅ 완료**(2026-06-11, F2/F4/R3b — ↓ "버킷 B
>   잔여 freeze" 블록). **다음 = step 4 fact-provider.** **커밋은 GLG.**

동결결정 10 + 버킷 B(F1/F2/F4/F6)의 미해결 빈칸을 **산문이 아니라 실행 가능한 계약 + 게이트**로 잠근다.
이게 step 4(fact-provider) 코드보다 **먼저**다 — 3-verb 표면을 켜둔 채 facts를 지으면 fact 층에 verb-routing
이 구워져 `entwurf_peers`가 헛나가기 때문(동결결정 10 순서 근거). **런타임 dispatch 구현은 이 단위에 없음**
(그건 step 5) — 계약 코드 + 결정표 + 게이트까지만.

**실현성 (2026-06-11 Opus 실측, 재탐색 불필요):** TypeBox `Type` 스키마 표면은 이미
`@earendil-works/pi-ai` re-export로 쓰고 있고(새 direct `@sinclair/typebox` 의존성 없음), MCP 도구 파라미터를
`Type.Object`로 정의하는 패턴도 이미 존재(`entwurf.ts:340` `entwurfParameters`, `entwurf-control.ts:1541`
`entwurfSendParameters`). `check-*` 게이트는 `scripts/check-*.ts` standalone → `node --experimental-strip-types`
→ run.sh case+help 등록의 확립된 패턴(메타 계열 `check-meta*`/`check-entwurf-capabilities`/
`check-mailbox-receipt-state` 다수 — 정확한 수는 부수적, 패턴 존재가 요점, Fable 숫자 보정 2026-06-11). F6의 "TypeBox 스키마 + check-* 게이트" 요구가
**이 repo 관행과 동일 모양** = 새 toolchain 없음. F1 근거(send=ack-only "end of contract")도 소스 확정
(`entwurf-control.ts:29-37`).

**계약물 4종 (이 단위 산출 — 전부 실행 가능, 산문 금지):**
1. **`entwurf_v2` TypeBox input/output 스키마** — 기존 `Type.Object` 패턴. input = caller **intent**
   (`fire-and-forget`|`owned-outcome`) + target(**garden-id only, 존재 시민 주소지정 전용** — spawn-new는 v2
   scope 밖 = **R2 (a) 정직 잠금**, 레거시 `entwurf` 유지 + 추후 additive; 미존재/오타 gid = 무조건 reject
   `bad-target`, F6 자동 성립) + outcome-ownership 파라미터(mode/wants_reply는 liveness-routing 축과 **별개**로
   유지, 동결결정 10). output = **dispatch 영수증**: 경로(**transport**) + **observedLiveness** + caller
   기대(owned vs ack-only) — 이 필드라야 게이트가 "결정표 칸 ↔ 영수증" round-trip 전수 assert 가능(R3 = F6
   기계 증명). **reject 표현 = 영수증 `ok:false`+`reason` vs throw 중 택1을 output 스키마가 지금 결정.**
2. **intent×liveness dispatch 결정표 = 상수 테이블** (N1, F3 3값과 정합). **선행 도메인 가드(R1): liveness
   predicate가 정의된 backend만 표에 진입** — 초기 = pi(direct-inject, control-socket)만(검증원장 실측:
   claude-code=self-fetch 소켓 없음 = predicate 미정의, F4). **도메인 밖 gid = `backend-liveness-unsupported`
   reject**(dead/indeterminate로 접기 금지 = identity-split 재발 = R1 핵심). 도메인 안에서만 live/dormant/
   **indeterminate** × fire-forget/owned-outcome: **indeterminate = 무조건 reject(절대 spawn 금지)**(GC만 고치면
   F3 절반, N1) · fire-forget+dormant = **"지금은 reject"**(N2: mailbox-wake는 reply-correlation id가 substrate에
   없어 영구 아닌 additive 확장 여지) · owned+live = **무조건 reject `owned-live-no-autosend`**(상수 표는 칸당
   verdict 1개 — "기본"이란 단어는 escape hatch라 비결정 재유입, Fable Q2; 확장 여지는 주석만). **각 칸 = 단일 verdict.**
3. **error taxonomy = 상수/fixture** — reject 사유 enum: `indeterminate-no-spawn` /
   `dormant-fire-forget-unsupported` / `owned-live-no-autosend` / **`backend-liveness-unsupported`(R1)** /
   `untrusted-fail-fast` / `bad-target`(미존재 gid, R2). **F2 선점(R5):** `target-locked`(per-gid lockfile 충돌)을
   지금 enum에 선점 — 안 그러면 버킷 B F2가 taxonomy 재개봉. (대안: 게이트를 **closed-enum 아니라 minimal-set
   assert**로 명시.) **scope 한 줄(R5):** 이 enum = **pre-dispatch reject 전용**; 버킷 B "send-fail fallback"
   (결정 후 transport 실패)은 별 축 — 섞지 말 것.
4. **`check-entwurf-v2-contract.ts` 게이트** — 결정표 전수(도메인 가드 + 6칸) + 스키마 round-trip +
   **영수증 round-trip(칸 ↔ observedLiveness/transport, R3)** + taxonomy 망라. run.sh case+help 등록,
   `pnpm check` 편입. **이게 "executable" 증거** = 결정표가 코드로 강제됨.

**경계 (버킷 B 조심점 — 이 단위에서 넘지 말 것):**
- **`entwurf_peers`에 `resumable`/`sendable` verb-routing 금지** — facts only(liveness/capability/identity/
  cwd-이력). liveness fact = **alive|dead|indeterminate|unsupported 4값 노출**(R1: predicate 미정의 backend는
  명시적 `unsupported` — indeterminate로 접기 금지; 숨기면 6칸 dispatch가 도메인 밖을 못 봄 = facts-only 위반, R3b).
- **F4 = Claude liveness 구현 아님.** backend별 liveness predicate **자리만** 추상화하고, claude(소켓 없음,
  self-fetch)는 **"unsupported / Stage 1 전 정의 보류"로 정직하게 못박음**(GPT 2026-06-11). `connect`=reachable
  ≠ responsive 주의.
- **레거시 3-verb 무변경.** 이 단위는 순수 additive — 기존 `entwurf`/`_resume`/`_send` 코드/표면 안 건드림.

**이후 스텝 arc (하나만 보지 말 것 — Fable 검수는 이 전체 호를 봐야 함):**
| 단계 | 무엇 | 게이트/산출 | 의존 |
|---|---|---|---|
| **step 4-pre ✅ 커밋(`fa95a8a`+`aeac8d8`)** | contract-lock (위 계약물 4종) | `check-entwurf-v2-contract` 81 ✅ | — |
| **F-mailbox amendment ✅ (2026-06-11, GPT힣 GO)** | `meta-mailbox` transport + `mailbox-undeliverable` reason + `UNSUPPORTED_DISPATCH_TABLE` 미니표 + `resolveDispatch` 2nd deliverability fact (↑ "F-mailbox" 블록) | `check-entwurf-v2-contract` **109** ✅ | contract-lock |
| **버킷 B 잔여 freeze ✅ (2026-06-11)** | F2 lockfile=`wx` primitive + 실측(검증원장 row) + release=관측가능성 + send-fail fallback · F4 claude=unsupported 동결 · R3b 4값 fact 노출 + `Record<FactLiveness,…>` 링크 | ✅ 동결 = ↑ "버킷 B 잔여 freeze" 블록(Opus 실측 + GPT 비준); 게이트는 step 4-5 구현단계 | contract-lock |
| **step 4 ✅ core complete** | TS fact-provider (`peers`/`who-can`/`preflight`, facts only) — slices 1·2·3·4a·4b·4c shipped. `entwurf_peers` MCP now exposes the provider+render surface, legacy `sessions` is derived from facts, and unsupported citizens/diagnostics stay visible. **Remaining optional slice:** get_info enrich(cwd/model/idle) for alive socket probes. **Separate slice, not step-4 core:** pi `session_start` meta-record writer. | `check-entwurf-facts` 82 / `check-socket-discovery` 31 / `check-meta-listing` 13 / `check-entwurf-fact-provider` 27 / `check-entwurf-peers-surface` 40 + Real-IO smoke | contract + 버킷 B |
| **step 5 ◀ NEXT** | `entwurf_v2` 단일 표면(레거시 공존) — preflight+fact-provider 소비 → liveness/deliverability로 send/resume/meta-mailbox call-time 계산, trusted→내부 `--approve` `pi -p` bg / tmux-live, untrusted→fail-fast. F2 per-gid lock + send-fail fallback. **진입 전 BLOCKER 없음 — F-mailbox 닫힘.** | dispatch 게이트(lock concurrency·`target-locked` receipt·fake-socket dispatch) + release-gate matrix smoke + live smoke | step 4 + F-mailbox ✅ |
> **끊을 지점:** 이 contract-lock freeze 직후 = **Fable/Claude 교차검수**(step 4 코드 진입 전). F6가 "산문 금지"
> 라 검수 대상은 **계약 코드+게이트**여야 함 — Fable이 볼 코드 증거(2026-06-11 검수 합의) = **"결정표 상수(도메인
> 가드+6칸) ↔ 게이트 전수 assert ↔ 영수증 observedLiveness/transport round-trip"** 가 실제로 코드로 강제되는지.
>
> **Fable 검수 결과 (2026-06-11): 구조 GO, R1·R2를 계약물에 박은 뒤 freeze(위에 반영 완료), R3-R5+숫자는 같은 커밋.**
> 전부 새 결정이 아니라 기내려진 결정(동결결정 10 pi-native, F4 unsupported)을 계약 코드에 명시 = 추가 비용 거의 없음.

### Stage 0 step 5 작업 계획 — entwurf_v2 dispatch (2026-06-11, Opus 정찰 + GPT힣 Q1-Q5 동결, F-mailbox 닫힌 후 ◀ NEXT)

> **진입 전 BLOCKER 없음** — contract-lock + 버킷 B + step 4 fact-provider + F-mailbox 전부 닫힘.
> step 4 규율 그대로: **각 슬라이스는 regression gate 먼저 → pure-before-IO → 연결.** 4슬라이스로 끊는다.
> **소비 표면(정찰 완료, 재탐색 불필요):** `preflight(input)→{approve|trusted-no-arg|deny}`(entwurf-preflight.ts) ·
> `listEntwurfFacts(deps)→{facts,diagnostics}`(entwurf-fact-provider.ts, facts-only) ·
> `resolveDispatch(intent,liveness,mailboxDeliverable)→receipt`(entwurf-v2-contract.ts, F-mailbox 닫힘) ·
> transports: control-socket(entwurf-control.ts) / spawn-bg=`spawnEntwurfResumeAsync`(entwurf-async.ts) / tmux-live /
> meta-mailbox=`enqueueMetaMessage` · MCP 등록 패턴(entwurf.ts:382 spawn, entwurf-control.ts:1926 entwurf_peers).

**슬라이스 순서 (GPT힣 Q4 = 5a lock 먼저 확정):**
- **5a — F2 per-gid lock primitive (load-bearing, gate-first).** `openSync(lockPath,"wx")` atomic acquire **(liveness probe 이전)** ·
  lock 내용 JSON `{gardenId,pid,hostname,createdAt,nonce,owner:"entwurf_v2"}` · release = **nonce가 자기 것일 때만** unlink ·
  stale reclaim = **same hostname + `kill(pid,0)==ESRCH`만**(TTL 탈취 금지=이중 spawn 위험) · 충돌 → `target-locked` reject(taxonomy 선점 멤버 현금화).
  **release 타이밍 = 관측 가능한 liveness 전이 후**(control-socket alive/bounded `get_info` 확인) — 아래 Q1 참조.
  게이트: lock concurrency deterministic test + `target-locked` receipt test. lockfile만, dispatch 배선 없음.
- **5b — dispatch decider (pure orchestration).** `(target,intent,mode,wantsReply)` + 주입된 facts/preflight/lock/capability →
  전 경로 계산: bad-target(facts에 citizen 없음) → untrusted-fail-fast(preflight deny) → target-locked(lock 충돌) →
  liveness+mailboxDeliverable → `resolveDispatch`. **transport 실행 없음.** 반환 = `DispatchDecision`(Q3):
  ```ts
  type DispatchDecision =
    | { kind:"reject"; receipt: RejectReceipt }
    | { kind:"execute"; receipt: SuccessReceipt; plan: ExecutionPlan; lock: LockClaim };
  type ExecutionPlan =
    | { transport:"control-socket"; action:"send"; targetGardenId; socketPath; mode; wantsReply; message }
    | { transport:"meta-mailbox"; action:"send"; targetGardenId; mode:"ignored"; wantsReply; message; mailboxDir }
    | { transport:"spawn-bg"|"tmux-live"; action:"resume"; targetGardenId; sessionId; cwd; prompt; provider?; model?; releaseWhen:"control-socket-alive" };
  ```
  reject는 lock 잡기 전에 나거나, 잡았으면 release 후 반환. `transcriptPath` 등 private은 transport 내부로만.
  **`mailboxDeliverable` 출처(Q2, fail-closed 동결):** fact-provider row 아님 → 신규 `resolveMailboxDeliverability(identity, capabilityRegistry)`
  소유. **초기 predicate = `wakeMode === "self-fetch"`** (registry 기준 현재 claude-code만 deliverable; codex/antigravity는
  `mailbox-undeliverable`로 떨어지는 게 **의도** — 0.10.0 mailbox가 Claude only였고 direct-inject drain은 미증명 capability).
  `meta-record exists`/`deliveryLevel=D6`만으로 넓히지 말 것 — 넓히려면 명시 predicate+게이트(미래 field `mailboxWakeMode`).
  **5b 진입조건:** entwurf-capabilities.json의 실제 wakeMode 분포를 한 번 확인하고 self-fetch=deliverable 동결을 재확정.
  게이트: fake socket/preflight/lock/capability 주입 매트릭스 + 아래 추가 invariant.
- **5c — transport 실행 (the hand).** plan별 배선: control-socket send / meta-mailbox enqueue / spawn-bg·tmux-live resume.
  기존 primitive 재사용. **F2-send-fail fallback(R5 post-transport):** send 결정 후 socket이 mid-flight로 죽으면 → **같은
  dispatch 결정표로 1회만 재resolve**(특수분기/silent spawn 금지, 별도 enum 안 만듦). 재resolve 칸이 reject면 reject.
  게이트: transport 단위 + fallback 재resolve test.
- **5d — MCP `entwurf_v2` 등록(additive, 레거시 무변경) + smoke.** entwurf_peers 등록 패턴 차용. 레거시 `entwurf`/`_resume`/`_send`
  안 건드림(동결결정 10 scope A). + release-gate matrix smoke(아래 Q5).

**Q1 동결 — F2 관측가능성 (GPT힣, conditional·미실측):**
- contract의 `owned-outcome+dormant → resume/spawn-bg` 칸과 F2-release "관측 가능한 liveness 전이 없는 plain headless spawn은
  v2 resume transport 아님"이 충돌한다. 현 `spawnEntwurfResumeAsync`는 `-p --no-extensions`(--entwurf-control 없음)=비관측.
- **판정 = (a') observable spawn-bg 우선.** 레거시 `spawnEntwurfResumeAsync`는 **그대로 두고**, v2 전용 resume launcher/opt-in이
  `pi -p` bg라도 **`--entwurf-control` alive/`get_info` 관측되는 child만** `spawn-bg`로 인정. lock release는 그 관측 후.
- **⚠ 미실측 = 5b plan-freeze 전 empirical gate (Fable F4: 측정이 계약보다 먼저):** `pi -p + --entwurf-control` 조합이
  실제로 관측가능 child를 띄우는지 **5b ExecutionPlan union을 동결하기 전에** 찌른다 (검증원장 213줄 GPT 실측은 **tmux-live TUI
  부팅**이지 `-p` headless+control socket 조합이 아니다). 실측이 뒤집히면(불가/`--no-extensions` 충돌) owned+dormant 칸
  transport와 resume ExecutionPlan 모양이 **둘 다** 바뀌어 5b union을 재단해야 하므로 5a/5c 초입이 아니라 plan-freeze 전이 맞다.
  뒤집힐 시 → **즉시 contract owned+dormant 칸을 `tmux-live`로 수정 + 게이트 동반(같은 흐름).** 원칙 불변: **plain headless
  spawn은 v2 resume transport 아님.** (c) lock 유지+경고는 폐기("never warn, throw" 충돌·sequential gap).

**Q5 동결 — matrix smoke 2층 (GPT힣):**
- **Required deterministic gate(전수, 모델/API 없음):** temp meta-store/mailbox + fake Unix control socket server로
  sender(pi-native/MCP bridge) × target(control-socket/meta-mailbox) × direction(pi→meta·meta→pi·meta→meta·pi→pi) 전수.
  여기서 cross-transport symmetry·envelope·ack·fallback/re-resolve를 강제(contract층 아님, 이 게이트가 도달성 SSOT).
- **Live release smoke(최소 sentinel만):** 실제 `--entwurf-control` pi 1개로 control-socket cell, 실제 meta mailbox/inbox_read
  1개로 mailbox cell. 전 방향 live 전수는 flaky/비용 과다 = release blocker 부적합. live는 "substrate still works" 확인용.

**추가 invariant (5b decider 게이트에 박을 것 — GPT힣):**
- success receipt `transport` === `plan.transport` (round-trip)
- `meta-mailbox` plan에서 `mode` = ignored/무의미 명시
- `unsupported + ff + mailboxDeliverable=false` → **실행 plan 없음**(reject만)

**Fable adversarial 검수 반영 (2026-06-11, 구조 GO 조건 — 5a/5b 커밋 동반 필수, 전부 계획 수정이지 재설계 아님):**
- **F1 3자 round-trip = 2게이트로 분해.** (1) receipt↔plan(5b pure): execute면 plan 존재 + `plan.transport===receipt.transport`
  + lock claim 존재 / reject면 **plan 없음 AND lock 미보유(해제 완료)** 4중 assert — 위 invariant에 "reject ⇒ no-plan AND
  no-lock-retained" 추가. (2) plan↔syscall(5c): **hand = plan-키 dispatcher, 다른 입력 금지.** `execute(plan, transports)`의
  transports는 `ENTWURF_V2_TRANSPORTS`에 정확히 키잉된 주입 맵; fake-transports 게이트가 plan kind마다 정확히 그 fn 1회 ·
  **plan 필드 그대로** 호출됨을 assert. **금지: hand가 gid에서 socketPath/mailboxDir를 재유도**(재유도=두 번째 brain=드리프트,
  4c socketPath SSOT와 동일 class). 잔여 틈("진짜 fn이 이름값")만 live sentinel이 덮음 = 정직한 최소 분담.
- **F1 놓친 축 = 결정-영수증 ≠ 결과-영수증.** 5c send-fail fallback이 재resolve하면 caller 최종 영수증은 **두 번째 결정**
  (alive→send→mid-flight death→재probe dead→ff+dormant=reject; decider는 execute였는데 caller는 reject 수신 — 정직하나 게이트가
  구분해야 함). invariant: ① 재resolve = 같은 `resolveDispatch`, **최대 1회**(루프 금지) ② **재resolve는 원래 lock claim(nonce
  불변) 아래서** 실행 — fail↔재resolve 사이 타 dispatcher 진입 창을 lock이 닫음(없으면 F2 절반만 닫힘).
- **F2-P1: gid 재검증을 decider 첫 줄에.** MCP TypeBox pattern은 그 표면만 지킴; pi-native/내부 호출은 스키마 우회 →
  `SESSION_ID_RE` `requireGardenId`를 **path(lockPath/socketPath) 구성 전** 실행(심층방어 + path-traversal 차단).
- **F2-P2: PID 재활용 = 영구 target-locked**(TTL 탈취 금지의 대가, workshop 스케일 수용 — 단 **관측 가능해야 함**):
  `target-locked` reject 메시지에 lock JSON(pid/host/createdAt/lockPath) 포함(사람 수동 해제 근거). + **EPERM(타 유저 pid, 살아있음)
  = 회수 안 함 fail-closed를 게이트로** 박을 것(ESRCH-only라 EPERM 분기가 코드에서 빠지기 쉬움). + 빈/corrupt lockfile(open-wx↔write
  사이 crash)도 같은 메시지 경로로 표면화.
- **F3: quarantine된 시민 = bad-target 아님(시민 존재) → 신규 reason `target-address-conflict`.** decider가
  `readMetaIdentityByGardenId` 직독이면 quarantine(garden-id-socket-conflict) 우회 → non-pi로 resolve → ff+deliverable →
  meta-mailbox send인데 그 gid엔 소켓이 살아있어 레거시 pi-native send는 소켓을 먼저 침 = **표면별로 다른 수신자에 닿는
  dispatch-레벨 identity-split.** 거부하되 reason은 정직하게 `target-address-conflict`(enum 재개봉 = F-mailbox `mailbox-undeliverable`
  선례와 같은 규율: 게이트+스키마 동반). **구조 요건: quarantine 판정은 한 군데** — 현재 `listEntwurfFacts` 인라인을 **공유
  predicate로 추출**해 fact-provider와 decider가 같은 함수 소비(4c "재유도 금지"와 동일 원리; 두 quarantine 드리프트 차단).
- **F4 최대 미봉합 = resume(owned+dormant) lock 수명.** `releaseWhen=control-socket-alive`인데 child가 소켓 생성 전 죽으면
  holder(dispatcher, 특히 **장수 MCP bridge**) pid가 살아 ESRCH 회수 안 됨 → bridge 재시작까지 영구. 요건: **모든 execute 경로
  failure-시 finally-release + releaseWhen watcher에 유한 timeout**(만료 시 release — 이중 spawn 창 미세하나 유한, 영구 잠금보다 정직).
- **F4 over-engineering 깎기 = Q5 matrix의 sender축 축소.** pi-native/MCP **레거시 sender**는 `check-entwurf-send-mailbox-fallback`(24)이
  이미 소유 — matrix가 재검증하면 게이트 sprawl + 이중 소유(한쪽 갱신 시 다른 쪽 가짜 적색). matrix는 **v2가 새로 여는 것만**
  (entwurf_v2 → 4 transport × direction 도달성) 소유. live sentinel 2개는 최소로 정확 = 더 늘리지 말 것.

**남은 물음표 닫기 (2026-06-11, GPT힣 최종 판정 — 구현 진입 시 열린 ？는 ？1 measurement 하나뿐):**
- **？0 ✅ capability registry 확인(로컬):** `entwurf-capabilities.json` = claude-code `self-fetch`/D6, codex·antigravity·pi `direct-inject`/D6.
  **넷 다 D6**라 "deliveryLevel로 deliverable 넓히지 말 것"(Fable)이 구체적으로 옳음 — drain 가능한 self-fetch는 claude-code뿐.
  ∴ `resolveMailboxDeliverability` 초기 predicate = `wakeMode==="self-fetch"` **확정**, codex/agy는 의도대로 `mailbox-undeliverable`.
- **？2 ✅ mode/wantsReply 축 (GPT힣):** `mode`(steer/follow_up) = **control-socket send 전용**, meta-mailbox=ignored/absent, **resume=N/A**.
  `wantsReply` = **두 send transport 모두**(control-socket + meta-mailbox; send-envelope etiquette), **resume(owned-outcome)에는 N/A**(caller가
  completion 소유). 위 ExecutionPlan union이 이미 이 모양(control-socket: mode+wantsReply / meta-mailbox: wantsReply + mode ignored /
  resume: 둘 다 없음) — 게이트로 "resume plan엔 mode/wantsReply 필드 부재" assert.
- **？3 ✅ resume lock finite-timeout (GPT힣) — pre-dispatch reject 아님 = post-transport execution failure(신규 RejectReason에 섞지 말 것):**
  `ENTWURF_V2_OBSERVE_TIMEOUT_MS` 명시 상수 + env override(초기 30s, 실측 후 45s 조정 가능; probe timeout 배수에 묶지 말 것). 정책:
  (1) launch 후 control-socket alive/`get_info` bounded wait → (2) timeout이면 child/pane/process-group **terminate** → (3) 종료+socket
  부재 확인 후 **nonce-owned release** → (4) 종료 증명 못 하면 **fail-loud + lock 보존/manual-cleanup 진단**(늦게 뜬 child + 재spawn 충돌이
  영구잠금보다 나쁨). **timeout cleanup이 load-bearing**(holder=장수 MCP bridge면 ESRCH reclaim 안 됨). lock/evidence에 **spawned child
  pid/process-group 또는 tmux pane id 기록**(cleanup 증명 가능하게).
- **？4 ✅ decider fact 조회 + path SSOT (GPT힣):** fact엔 socketPath **안 넣음**(4c facts-only 유지). decider가 SSOT helper로 **한 번**
  계산→plan에 박고 hand는 plan 값만 사용. socket = `controlSocketPath(gardenId, dir)`(기존 SSOT). mailbox = `defaultMetaMailboxDir()`
  (root SSOT) + `enqueueMetaMessage({gardenId, mailboxDir})`가 citizen path 내부 생성 — hand가 `path.join(mailboxDir,gid)` **재유도 금지**,
  필요 시 `metaMailboxCitizenDir(mailboxDir,gid)` helper 추가해 decider/transport 공유. clean facts에 없는 gid = `bad-target`.
- **F3 reason vs diagnostic — 5b 미니-？ (Fable vs GPT힣 갈림, 5b 커밋에서 택1):** quarantine된 gid(garden-id-socket-conflict) 처분 =
  Fable는 신규 `target-address-conflict` reason(정직, F-mailbox `mailbox-undeliverable` 선례) / GPT힣은 taxonomy 재개봉 회피 위해
  **fail-loud diagnostic**으로 surface해도 됨. **추천 = Fable안(named reason)** — dispatch-레벨 identity-split은 named+gated 받을 가치가
  있고 F-mailbox가 비용 낮음을 입증. 단 최종 택1은 5b 코드 진입 시(게이트 동반).
- **⚠ ？1 (유일하게 열린 채 구현 진입) — `pi -p + --entwurf-control` observability measurement gate (5b plan-freeze 전):**
  pi 실행 필요라 자문으로 못 닫음 = 측정으로만 닫힘. 측정축(GPT힣 보강 반영):
  (i) **실제 v2 args shape** `pi --session-id <gid> --mode json -p --no-extensions --entwurf-control --approve --provider X --model Y <prompt>`
  로 소켓 `~/.pi/entwurf-control/<gid>.sock` 생성되나 + `--no-extensions` **없이도** 대조 1회.
  (ii) `get_info` RPC 응답하나. (iii) **`listEntwurfFacts`가 그 gid를 alive로 보나**(관측가능성의 실제 소비자 = 핵심 축).
  (iv) prompt 처리 후 프로세스 종료되며 소켓 사라지나/유지되나 — **유지 안 되면 spawn-bg 불가** → contract owned+dormant를 `tmux-live`로.
  (v) timeout cleanup negative fixture: child kill 후 socket/lock 사라지나.
  통과=observable spawn-bg 유효 / (iv) 실패=contract 수정(tmux-live) + 게이트 동반(같은 흐름).

### step 5 물음표 닫힘 — GPT + Fable + 실측 수렴 (2026-06-12, Opus 실무자 정찰)

> **상태: step 5 진입 물음표 전부 닫힘.** 첫 세션(2026-06-12) 3자 삼각측량 — Opus(실무자) 정찰·실측,
> GPT힣 자문, Fable adversarial. 아래는 5a→5d 구현 세션이 **재탐색 없이** 소비할 결론이다. 전부 흡수형 보강,
> 재설계 없음. 결정 trace는 이 세션 mailbox 라운드 + 본 블록.

**？1 ✅ 실측으로 닫힘 (Opus, Groq 8b throwaway 2-trial, cwd=/tmp).** `pi --session-id <gid> --mode json -p
[±--no-extensions] --entwurf-control --approve --provider groq --model llama-3.1-8b-instant <prompt>`:
- **판정: observable spawn-bg는 viable. contract `owned+dormant`는 `spawn-bg` 유지(tmux-live 강제 아님).**
- **A1 (frozen plan에 없던 새 사실): `--no-extensions` ⊗ `--entwurf-control`는 상호배타.** `--entwurf-control`은
  core flag가 아니라 **extension 기여 flag**(`pi --help`엔 보이나 `--no-extensions`면 `Error: Unknown option:
  --entwurf-control`, rc=1, 소켓 0). 레거시 `spawnEntwurfResumeAsync`(entwurf-async.ts:315)는 `--no-extensions`라
  **영영 비관측이 맞다.** v2 전용 spawn-bg launcher는 `--no-extensions`를 빼고 `--entwurf-control --approve`를 더한다.
- **A2 = releaseWhen 술어 (P-b1로 정밀화): `socket observed alive ∨ child exited(any exit code)`.** Trial B에서
  소켓 ~0.9s 생성→connect-OK(턴 중)→`-p` 턴 완료 시 프로세스 종료하며 소켓 소멸. `-p` 턴이 observe poll보다
  빨리 끝나면 alive 창을 놓치므로 단독 `control-socket-alive` 불충분. **lock 안전성은 "프로세스 소멸"만 필요
  (exit 0이든 137이든 동시 append 불가); exit code는 결과 보고 축**(exit≠0에 release 안 하면 crashed child가
  lock 영구점유 = F4 영구잠금). 게이트 3분기 전수: ① socket alive 관측→release(child 계속 삶) ② exited(any
  code)→release ③ alive∧미관측∧timeout→terminate→exit 확인→release(？3). watcher는 직접 spawn한 child의 process
  handle(`exit` 이벤트)을 쓰므로 "exited" 관측 신뢰 가능(pid 재활용 무관 — F2-P2는 lockfile reclaim 축).
- **부수 실측:** stdout 청정(control server가 `--mode json` 오염 안 함, 단 user extension 가변이라 소비자는
  비-JSON 라인 방어적 스킵 유지), session id=전달 gid 그대로(소켓 파일명·session header 일치, correlation 정상).
- **5c 실패 전달(F1 spawn-bg 버전): execute receipt = launch 영수증 ≠ 완료 영수증.** child가 observe 창에서
  exit≠0으로 죽으면 dispatcher가 유일 목격자 → 실패를 owned caller에 전달할 경로(followUp/diagnostic stamp)를
  5c에서 명시(안 박으면 "ok-execute 받았는데 무음").

**？6 ✅ contract 수정 동결 — reject receipt `observedLiveness` = required-nullable (GPT 판정, Fable 발견).**
pre-probe reject 3종(`bad-target`=시민/backend 없음, `target-locked`=5a상 probe 이전, `target-address-conflict`
=address-subject 충돌이라 probe 금지)은 찍을 정직한 4값이 없다(`indeterminate`=in-domain probe 불확정 ≠ "아직
안 봄"; `unsupported`=backend predicate 없음 ≠ "pre-probe라 모름"). **split(b) 아님 — required-nullable(a′):**
reject 분기 type `observedLiveness: FactLiveness | null`, schema `Type.Union([StringEnum(FACT_LIVENESSES),
Type.Null()], {description:"… null for pre-probe rejects …"})` (optional로 빼지 말 것 — exact schema +
discriminated union 유지). 게이트: RESOLVER_REJECT_REASONS 5종=non-null · pre-probe 3종=null · success=non-null
· 불법 `{ok:false,reason:"bad-target",observedLiveness:"indeterminate"}`는 reason-dependent라 schema 불가 →
`check-entwurf-v2-contract` semantic fixture로. **F-mailbox처럼 contract 파일 수정 = 5b receipt mint 전 동결.**

**？2/1C ✅ post-lock target probe = lstat-then-connect (GPT+Fable 합의, Opus 코드확정).** `probeSocketLiveness`
(socket-probe.ts:74)는 `net.createConnection`만=connect-only, symlink 가드 없음 → unix socket connect가 symlink
따라감. 현 symlink 가드는 `scanSocketProbes` readdir dirent(socket-discovery.ts:150)에만 산다. ∴ 5b decider가
post-lock에 bare `probeSocketLiveness(controlSocketPath(gid))`만 하면 lock 이후 심긴 symlink로 alive 위조 →
control-socket send 하이재킹(P1 재개방). **신규 helper `inspectTargetControlSocket(gid, controlDir)`:** `absent`
(ENOENT만→in-domain이면 dead) / `socket-file`(→그때 connect/probe) / `address-conflict`(symlink·not-socket) /
`indeterminate`(EACCES/unknown lstat error=dead 아님, spawn 금지 쪽). 순서: lstat 먼저 → ENOENT만 absent →
`isSymbolicLink()`이면 **절대 connect 금지** → socket이면 probe. **symlink 처분(GPT 더 엄격):** non-pi+symlink뿐
아니라 **pi citizen+symlink도 v2 decider에선 `target-address-conflict` reject**(listing은 "forced dead"였지만 v2는
실제 transport 정하는 손이라 socket address authority 오염 시 사람이 symlink 치우게). **provider conflict
predicate 구멍(Opus 발견·양자 확인): `entwurf-fact-provider.ts:124`의 conflict는 `socketGids`만 보는데 `socketGids`는
symlink 제외(socket-discovery.ts:150-156) → non-pi gid에 symlinked 소켓이면 `garden-id-socket-conflict` 안 뜨고
clean PeerFact 잔존→mailbox 진행, 레거시 send는 symlink 따라가 identity-split.** → **conflict predicate를
`socketGids ∪ symlinkedGardenIds`로 확대**(provider+decider 공유 predicate, 복붙 금지 = 4c "재유도 금지" 동형;
관측 비트 출처만 매개변수화: listing=readdir dirent, dispatch=lock 안 lstat).

**？7 ✅ lock iff in-domain backend (GPT+Fable 합의).** 5a "acquire before probe"는 probe 있을 때 순서지 "전
dispatch lock"이 아니다. unsupported+ff(mailbox)는 probe도 spawn도 없고 enqueue=append-create라 이중spawn 위험 0
→ lock 불필요. claude gid까지 잠그면 가장 흔한 ff→Claude가 F2-P2 영구 target-locked에 결합. **`target-locked`은
결국 in-domain dispatch 전용 pre-dispatch reason**(taxonomy엔 남기되 mailbox path는 이 reason에 안 막힘).

**1B ✅ preflight = resume verdict 뒤에만 (전 dispatch 아님 — Fable break 실패, GPT 합의).** preflight는
controlled-**launch** 결정(child가 target cwd `.pi/settings.json` 로드하나). allow verdict 3개 중 spawn하는 건
`owned+dormant→resume` 단 하나 → control-socket send/meta-mailbox send엔 보호할 project-local read 없음. 동결된
5b 순서가 send에도 preflight 걸면 F-mailbox 반쯤 재사망. **구조적 안전망(Fable):** send verdict는 ff에서만
나오고 ff열에 resume 칸 없음 → send가 launch로 변이 불가(타입 차원 차단; 게이트 1줄 "fallback 재resolve receipt에
action:resume 없음" 권장, N2 mailbox-wake 확장 대비). 동반: **`resolveDispatch` docstring(:208-211) "caller runs
preflight BEFORE reaching here"가 거짓이 됨 → 같은 커밋 주석 수정**(계약 로직 무변경). untrusted-fail-fast가 이제
lock+probe 뒤라 receipt observedLiveness가 정직한 실측값(dormant)이 됨 + "reject ⇒ no-plan AND no-lock-retained"
assert 매트릭스에 이 경로 추가.

**F3 ✅ named reason `target-address-conflict` (GPT가 Fable안 합류).** 더 강한 근거(Fable): diagnostic은 listing
표면(entwurf_peers render) 채널이고 dispatch는 receipt만 반환 → decider diagnostic은 v2 caller에 안 보임(보이게
하려면 side-channel 신설=새 표면). **dispatch-레벨 quarantine의 유일한 in-band 정직 채널 = receipt taxonomy**
("받을 가치"가 아니라 "다른 채널 없음"). scope: pre-resolver reject 그룹(bad-target/untrusted-fail-fast/
target-locked과 동급), `RESOLVER_REJECT_REASONS`(:122-128) 멤버 아님 — 2층 주석 구조(:114-121) 유지.

**S1 ⚠ GLG 확인 대기 — v2 child = "완전무장 시민" (Fable 발견, architecture·North Star 닿음).** 레거시
`--no-extensions` child는 entwurf 도구 없는 **불임 작업자**였는데, A1로 `--no-extensions` 빼면 v2 child가 entwurf
extension까지 로드 → **손자 spawn/send 가능 = 재귀 fan-out 표면이 코드 차원에서 열림.** "workshop, not factory"가
정책으로만 남고 코드 가드 사라짐. trust 구멍은 아님(Fable break 실패: project-local은 여전히 --approve 게이트,
user/global extension은 operator 소유물). **추천(Fable+Opus) = 눈뜨고 수용 + 이 줄로 의도 명시**(depth cap 기계
가드는 0.11 scope 밖; lineage는 `PARENT_SESSION_ID`로 추적). **무언의 변화로 두지 말 것 — 레거시와 child 권한
등급이 다르다는 게 frozen plan에 없던 신규 사실. GLG가 "수용 vs nested-spawn 억제 플래그" 택1.**

**ops/배선 잔여 (5c·5d·doctor):**
- **doctor flag 존재 체크(Fable):** `--entwurf-control`이 extension 기여 = 설치 상태 의존. extension 없는/구버전
  pi에선 v2 spawn이 rc=1 "Unknown option"으로 즉사 → stderr 패턴 전용 진단("entwurf-control extension 없음/구버전")
  + doctor 1줄. tsc 못 잡는 runtime drift(flag rename 포함) = fail-loud 친절화.
- **5d prefixRoots 배선(Fable):** preflight `prefixRoots`는 operator-policy 주입(동결결정 7, 패키지 default 없음).
  5d MCP 표면이 어디서 받는지(env `PI_SHELL_ACP_TRUST_ROOTS` / user settings) 배선 명시 안 하면 **모든 resume이
  fail-fast = dead-on-arrival**(안전하나 무용).

**통합 decider 순서 (GPT 정리, 5b 게이트로 박을 것):**
1. `requireGardenId(target)` — `SESSION_ID_RE` runtime guard, path/lock/socket 계산 전(F2-P1, MCP schema 우회 차단).
2. meta identity lookup / address-conflict precheck (probe 없음) — 시민 없음→`bad-target`; quarantine→`target-address-conflict`.
3. backend 확인.
4. **`isLivenessSupported(backend)`이면** acquire lock(`openSync wx`) **before** lstat/connect.
5. in-domain: lock 아래 `inspectTargetControlSocket`(lstat-then-connect) → `resolveDispatch(intent,liveness,deliverable)`
   → verdict=resume이면 그때 `preflight(cwd)`(deny→nonce-owned release 후 `untrusted-fail-fast`) → plan.
6. unsupported(mailbox): **lock 없음.** `resolveMailboxDeliverability`(wakeMode==="self-fetch", fail-closed) →
   `resolveDispatch(intent,"unsupported",deliverable)`.
7. unsupported+owned reject도 lock 없음. send-fail fallback = 같은 lock nonce 아래 최대 1회 재resolve(루프 금지).

### step 4 slice 4 설계 동결 (2026-06-11, GPT힣 + Fable 수렴 — slice 2-3 코드 GO 후)

slice 2(`4e47820` resolveFactList union)·slice 3(`d837e99` scanSocketProbes)를 양 검수자가 코드
직접 리뷰 → **구조 GO**(라인레벨 근거, 게이트 82/18 재실행). 그 위에서 slice 4(조립 + MCP 노출)를 동결.

**slice 4 분해: 4a ✅(`62e9bd6` listAllMetaIdentities, check-meta-listing 13) → 4b ✅(`ee7eef4` listEntwurfFacts 조립, `entwurf-fact-provider.ts`, quarantine+diagnostics union) → socket-axis 보강 ✅(`6467466`, symlink/malformed/dir-read diagnostics, check-socket-discovery 31 / check-entwurf-fact-provider 27) → 4c ✅(`2b339dd`, MCP `entwurf_peers` render `entwurf-peers-render.ts`, Fable 5건 + GPi 4c검수 Q2/P1·Q4 닫힘, check-entwurf-peers-surface 40). = step 4 fact-provider 코어 완결.**

**slice 4b 설계 동결 (2026-06-11, GPT힣 추가 검수 — quarantine 정책 + C 원칙):**
- `listEntwurfFacts` = `listAllMetaIdentities → pi gid 추출 → scanSocketProbes(piGids) → pre-quarantine
  non-pi/socket conflicts → resolveFactList(clean) → {facts, diagnostics}`.
- **C 원칙(어떤 throw를 강등/유지하나 — GPi가 짚은 빈 곳):** **expected data corruption = diagnostics,
  impossible wiring invariant = throw 유지.** resolveFactList의 duplicate-identity/unprobed-in-domain throw는
  **조립 버그**라 catch해 삼키면 결함이 숨는다 → throw 유지(provider가 안 건드림). **non-pi+socket collision만**
  외부 상태 충돌이라 provider가 **사전 검출 → diagnostics quarantine**(core throw는 최후 방어선으로 남음 =
  이중구현 아님, 입력 정제). 게이트 둘 다 박음(core throw + provider quarantine).
- **quarantine 범위:** non-pi 시민 + 같은 gid 소켓 충돌 시 **둘 다** normal output에서 제거(PeerFact도 socket도) —
  gardenId=universal address, send path가 socket 먼저 보니 record만 노출=반쯤 거짓. diagnostic 하나로 격리.
  정상: pi+socket=merge, non-pi+socket=quarantine both.
- **diagnostics = kind-tagged union**(출처 선명): `{kind:"meta-record-read-error", filename, message}`(4a errors를
  fold) / `{kind:"garden-id-socket-conflict", gardenId, backend, message}` / future `socket-scan-error`. 충돌
  diagnostic은 backend/gardenId까지만(identity 전체를 half-fact로 싣지 말 것).
- **deps 두 축 주입:** meta(entries/readRecord 또는 sessionsDir wrapper) + socket(controlDir/readdir/probe →
  scanSocketProbes). enrich=null 그대로 노출("not enriched", unknown identity로 해석 금지). EACCES 조용한 empty는
  후속 `onDirError`(지금 blocker 아님, slice 3 D).

**slice 4(전체) = fact-provider 조립 함수 + MCP 표면 (verb-routing 절대 금지):**
- **조립 = `listEntwurfFacts({sessionsDir, controlDir, ...deps}) → {facts: FactList, diagnostics}`** fact-provider
  함수. 내부: `listAllMetaIdentities` → pi 시민 gid 추출(`isLivenessSupported`) → `scanSocketProbes(piGids)` →
  `resolveFactList`. **MCP handler는 호출+render만**(handler가 brain 되면 pi-native/doctor/v2 dispatch가 같은
  facts 재사용 불가). deps 주입으로 게이트가 IO 없이 구동.
- **`listAllMetaIdentities({mode:"collect"|"strict"}) → {identities, errors}` (meta-session.ts 신규).**
  corrupt/half-migrated record는 **silent skip❌ / 전체 throw❌** → explicit partial. corrupt의 주어는 시민이
  아니라 **store 파일**(SocketOnlyFact 주어-정밀성 논증과 동형). **errors = file path + error message만,
  verbatim-or-nothing**(건진 gid-처럼-보이는 문자열을 fact로 내면 synthetic 뒷문 = Fable 조임). collect=listing
  기본 / strict=doctor·게이트용. 0.10 lesson "corrupt가 registration 영구 차단" 재발 방지.
- **enrich(get_info cwd/model/idle) = 별도 pass `enrichSocketProbes`, alive 소켓만**(dead 무의미, indeterminate
  재타격). slice 4는 enrich 계속 **null 노출**(probe-only 정직), parity는 후속 slice. 넣으면 `Promise.allSettled`
  + per-socket `infoError`, 전체 throw 금지. RPC client(`sendRpcCommand`↔MCP `rpcCall` 중복)는 공통 lib 추출
  여지(root emit vs strip-types 경계 주의).
- **MCP `entwurf_peers` 출력 = 기존 `sessions` payload 유지(호환) + additive `peers`/`socketOnly`/`diagnostics`.**
  **세 종류 섹션 분리를 MCP 표면까지 관통**(한 배열 병합 금지 — slice 2가 두 배열로 만든 주어-분리가 표면에서
  무너짐). **verdict 필드(`sendable`/`resumable`/`dispatch`/`action`/`transport`) 금지, `mailboxDeliverable` 금지.**
  단 **도구 description이 `DISPATCH_TABLE` 의미론을 정적 인용하는 건 routing이 아니라 contract 참조**(동결 상수를
  가리키는 건 거짓말일 수 없음): "alive pi citizen ⇒ v2 fire-forget send / dead pi ⇒ owned resume / unsupported
  citizen ⇒ 표 밖 = 레거시 send 또는 F-mailbox amendment". **per-row 계산 필드가 생기는 순간이 verb-routing 경계선.**

**slice 2-3 비차단 정리 (slice 4 진입 전 작은 커밋, GPT+Fable 둘 다 권장):**
1. `SocketOnlyFact` doc "A live control socket" → "record-less control-socket probe"(dir-present stale=dead,
   stall=indeterminate도 들어옴). **dead/indeterminate socket-only를 출력에서 빼지 말 것**(stale은 GC 일, listing이
   숨길 일 아님; indeterminate=unlink 금지+live 아님이라 표시 가치 최대). kind 이름 "socket-only"는 주어 정확 = 유지.
2. **`GARDEN_ID_RE` → `SESSION_ID_RE` import**(SSOT). 동결결정3은 "두 축이 같은 id grammar 말할 때만" 성립 —
   drift하면 정당 gid 소켓이 침묵 탈락(in-domain은 canonical-path probe가 구제, socket-only는 사라짐).
3. **정렬 통일** — `resolveFactList`는 localeCompare, `scanSocketProbes`는 default sort → 단순 `<` 비교로 통일.
4. (후순위, 버킷 C F8) `scanSocketProbes` 직렬 for-await → `Promise.all`; readdir EACCES도 조용히 empty →
   slice 4 diagnostics "socket-dir unreadable" 표면화(Q2와 한 몸).

### step 4 slice 2 설계 동결 (2026-06-11, GPT힣 + Fable 수렴 — 재설계 금지)

slice 1(`2ed4603` 순수 `PeerFact`+`resolvePeerFact`, "identity verbatim from meta-record") 위에서
slice 2(meta-store 축 + 소켓 축 union → fact 목록)를 GPT힣(`20260611T115213-3aa371`)·Fable
(`20260611T112732-0f42b6`) 양 검수자와 수렴 동결. **두 검수자 이견 없음 = GO.** 구현 세션은 이 shape로
게이트부터 작성한다.

**핵심 발견(라이브 교차검증):** meta-sessions store에 `backend:"pi"` 레코드 **0개**(claude-code 63),
그런데 `entwurf_peers`엔 라이브 pi control socket 존재 = **"socket-only pi"**(live 소켓 + meta-record
없음). slice 1 시그니처 `resolvePeerFact(identity: MetaIdentity)`(entwurf-facts.ts:66)는 identity 없이
호출 불가라 **synthetic identity 금지가 타입으로 강제**됨.

**동결 1 — 2A/2B는 택일 아님.** record 없는 live socket을 정직하게 노출하는 표현(2B)은 **영구 안전망**
(pi writer 배포 전 라이브 세션·배포 지연 창["source complete ≠ deployed complete"]·crash 창 때문에
socket-only 인구는 0이 안 됨). **pi `session_start` meta-record writer는 slice 2에 묶지 않고 별도 slice**
(3D 4조각 규율 = 순수 consumer ≠ live writer 한 덩어리 금지; pi writer는 "우리 세션 기록하는 시스템 그
자체"라 단독 게이트+리뷰). **slice 2 = consumer/union만.**

**동결 2 — discriminated 두 종류(5번째 liveness 값 아님).** 4값 `FACT_LIVENESSES`는 "이 시민의 소켓"
진술; "record 없는 live socket"은 "이 소켓엔 시민이 없다"는 소켓 진술 = **주어가 다름**(같은 enum이면 R1이
unsupported 접지 말라던 것과 동형 오류, frozen contract 재개봉). 출력:
- `PeerFact` (kind:"peer") = identity meta-record authority + liveness **4값**. slice 1 그대로.
- `SocketOnlyFact` (kind:"socket-only") = `gardenId`(소켓파일명=동결결정3 correlation authority) +
  `liveness: SocketLiveness` **3값** + optional **probe-derived** `cwd/model/idle/infoError`(get_info 실측 =
  synthetic 아님, 출처 라벨만 다름). 새 `entwurf_peers`가 두 종류 다 보고 → 기존 live pi discovery 대체.

**동결 3 — dedup/authority.** 키 = **gardenId**(nativeSessionId는 backend-local). 같은 gid로 두 종류
**동시 출력 금지**: meta-record 있으면 `PeerFact`로 merge, no record일 때만 `SocketOnlyFact`. 같은 gid에
**non-pi meta-record + control socket = fail-loud**(주소 모호); pi meta-record + socket = 정상 merge;
pi writer 배포 후 socket-only는 `PeerFact`로 자동 승격. identity authority=meta-record, liveness
authority=socket probe(pi backend일 때만 의미).

**동결 4 — 금지 + 필수 게이트.**
- `mailboxDeliverable` 필드 **금지**: ≡ meta-record 존재(`enqueueMetaMessage` 유일 게이트 =
  `readMetaIdentityByGardenId` throw, meta-session.ts:1403)라 모든 `PeerFact`에서 상수 true = 정보 0 +
  verb-routing 냄새. dispatch 시점에 stale listing 믿지 말고 enqueue gate가 재확인(citizen⇒deliverable,
  socket-only⇒not은 두 종류 union이 이미 암묵 인코딩).
- **dormant probe 게이트(필수)**: pi 시민은 **항상 canonical socket path에 probe 실행**. `socket=null`을
  넘기면 `factLivenessOf("pi",null)=indeterminate` → 6칸표 owned+indeterminate=reject → **정상 dormant
  시민 영원히 resume 불가**. ENOENT는 `classifyConnectError`가 dead(socket-probe.ts:20-21)로 → dead→
  dormant→resume 산다. `null`은 unprobed/out-of-domain 전용. 게이트 assertion: "pi citizen + 소켓파일
  부재 → probe(path) → dead → liveness=dead" + "null 입력은 unprobed 경로만".

**이후 slice:** 3(entwurf-control liveness fn lib 추출 + 3값 probe) / 4(MCP 노출 + who-can/preflight,
facts-only — `sendable`/`resumable` verb 이름 금지, `unsupported` 시민 숨기지 말 것) / pi writer(별도 slice).

### Fable 5 설계 검수 반영 — entwurf_v2(step 4-5) 진입 블로커 (2026-06-10, Fable+Opus+GPT 3자 수렴, 소스 확정)

Fable 5(Anthropic 신모델)에 entwurf_v2 설계 검수를 의뢰 → Opus 재검증 + GPT 교차검증으로 수렴. 8 finding
전부 소스 대조 확정. **3D-2(다음 한 걸음)는 전 finding과 독립 = 그대로 진행.** 아래는 **step 4(fact-provider)·
step 5(entwurf_v2 dispatch) 진입 전** 원장에 닫아야 할 것(동결결정 10의 미해결 빈칸 + 결정 5/6·Trust 2층 정정).

**go/no-go (3자 만장일치):** 3D-2 = **GO**(독립) · 0.79.1 trust 반영(결정 1) = **GO**(버킷 A로 완성) ·
entwurf_v2 구현 = **NO-GO** until 버킷 B(안 닫고 들어가면 "다시 보니 안되네요" 확정 = GLG 10:58 기준 위반).

**finding 처분 (심각도 순, 전부 소스 확정):**

| F | 결함 | 소스 근거 | 버킷 |
|---|---|---|---|
| **F1** Critical | entwurf_v2가 resume(owned-outcome)·send(fire-and-forget)을 liveness만으로 바꿔 **caller가 받는 계약이 call-time 비결정** | `entwurf-control.ts:24-37` (send=ack-only "end of contract") | B |
| **F2** Critical | dispatch 동시성 가드 없음 — probe→spawn TOCTOU; v2/legacy가 같은 substrate 다른 entry → 같은 dormant 타깃 이중 spawn | `entwurf-async.ts:245` spawn에 per-gid lock/liveness 체크 없음, `activeEntwurfs`는 in-process Map(형제 못 봄) | B |
| **F3** High | `gcStaleSockets`가 **timeout에도 unlink** → 부하로 멈칫한 live 소켓 영구삭제 → 이후 probe 전부 dormant → live 세션 resume = identity split. "probe는 계산만" 교리 자기위반. **N5: `startControlServer`마다 호출(`:1201`)이라 v2 무관하게 오늘 legacy를 깰 수 있는 live 버그** | `entwurf-control.ts:288-310`(timeout·error 둘 다 false), `282-285`(`!alive`→unlink), `1201`(startup GC) | **A 확정** |
| **F4** High | liveness=pi-socket 전용인데 contract는 보편 표방. claude=self-fetch(소켓 없음) liveness 술어 미정의; `connect`=reachable≠responsive | 검증원장 "liveness authority=socket connect+RPC" = pi 한정 | B |
| **F5** Med | 0.79.1 상속: preflight가 `store.get`이라 **inheritedFrom 증거 소실** + 탈출구 방향 미검증 + 상속-false가 prompt 막음 | `preflight.ts:140`, `runner.js:70`(undecided fallthrough)+`project-trust.js:37`(store inherited 우선), `check-pi-preflight #12` 한 방향만 | A |
| **F6** Med | "contract-lock 완료"는 과장 — entwurf_v2는 NEXT 산문에만, 입출력/target 의미론/error taxonomy 미동결 | grep: 코드 전무 | B |
| **F7** Low-Med | capability registry=trust-the-json. drift guard=코드 사본 일관성(현실검증 아님), codex/agy direct-inject live 게이트 없음 | `check-entwurf-capabilities`(descriptor 일치만) | C |
| **F8** Low | `getLiveSessionsWithInfo` 직렬 1.5s×N → stuck 세션 몇 개에 peers 열거 수초 블록 | `entwurf-control.ts:355`(직렬 for-await) | C |

**3 설계 결정 (GPT 권고 + 소스 확정, GLG 승인 2026-06-10):**
1. **F1 = caller intent 선언.** liveness는 transport만, outcome 계약 불변. **6칸표(N1: F3 3값과 정합 — binary 표는 indeterminate를 dormant로 접어 identity-split 부활):**
   | intent | live | dormant | indeterminate (F3 timeout) |
   |---|---|---|---|
   | **fire-and-forget** | send, ack only | **v2 초기 = reject**(N2: mailbox-wake는 0.10.0 substrate 있으니 additive 확장, 영구 reject 아님) | **절대 spawn 금지 → reject** |
   | **owned-outcome** | **기본 reject**(wants_reply는 ownership 아님) | async resume, caller completion 소유 | **절대 spawn 금지 → reject** |
   → owned+live 자동 send(wants_reply) 강등 금지. **indeterminate 타깃은 절대 spawn 안 함**(GC만 고치고 디스패치를 안 고치면 F3를 절반만 끊음 — N1). dispatch 영수증(경로+caller 기대)을 contract 산출물에 포함.
2. **F3 = unlink 축소만(heartbeat는 2단계). 버킷 A 확정(N5: live 버그, `startControlServer:1201`).**
   `isSocketAlive → alive|dead|indeterminate`; ECONNREFUSED/ENOENT만 dead; timeout=indeterminate; GC는 dead만
   unlink. 게이트: "timeout 소켓은 unlink 안 함." **indeterminate는 `getLiveSessions` live 목록에서 제외하되
   unlink 안 함 → 현행 listing 의미론 보존**(소켓 누수 무시 가능: 죽은 프로세스는 ECONNREFUSED=dead로 회수,
   timeout-영구는 SIGSTOP류 희귀; 카운터 저장은 교리 위반이라 수용).
3. **F5b = getEntry 전환 + active-prompt 탈출구.** preflight evidence에 `trustStoreEntryPath`/`trustStoreInherited`/
   `trustStoreDecision`. 게이트: 자식 true>조상 false(탈출구 방향) / inherited-false outcome의 entryPath===parent /
   direct-false outcome의 entryPath===cwd. **entryPath 비교는 pi `normalizeCwd` 캐노니컬 축으로**(우리 normalizePath
   아님, symlink cwd edge — 게이트 assertion이 잡게). 탈출구 = 핸들러 직접 prompt → yes면 `{trusted:"yes",
   remember:true}`(결정 6 carve-out). **undecided는 정상 defer**(runner.js:70 fallthrough); 막는 건 그 다음
   `store.get` inherited-false → 탈출구는 active-prompt만(Trust 2층 참조; GPT 소스 교정).
   **N3a(의도 명문화):** controlled launch는 `trustOverride` short-circuit(project-trust.js:17)이라 핸들러 도달
   안 함 → active-prompt 탈출구는 **인간-인터랙티브 전용**. 에이전트가 자가 trust 승격 못 하는 건 **버그 아니라
   의도된 보안 속성.** **N3b 게이트:** inherited-false deny 메시지는 `inheritedFrom` 출처 + remedy("인터랙티브
   pi를 `<cwd>`에서 열어 override")를 반드시 말한다(F5a evidence가 원료).

**0.79.1 소스 — 상속-false 탈출구 (Fable F5b, GPT 소스 교정 2026-06-10):**
흐름: `resolveProjectTrusted`(project-trust.js)가 핸들러를 `store.get`보다 **먼저** emit → `emitProjectTrustEvent`
(runner.js:70)가 `{trusted:"undecided"}`를 `continue`로 **fallthrough**(yes/no만 즉답) → result undefined →
`store.get(cwd)`가 **nearest-ancestor false를 non-null로 반환(line 37)** → prompt 없이 false. 즉 **상속-false에서
prompt가 안 뜨는 건 맞지만, 원인은 "undecided가 false라서"가 아니라 "undecided 정상 defer 뒤 store inherited
false가 이겨서"다.** ("undecided≡false coerce" 주장의 출생지는 **Opus folding(651aefe)의 "보너스 발견"**이고
Fable 2차가 미검증 승인+N4로 증폭; Fable 1차 F5b는 mechanism-무관 — **GPT가 runner.js fallthrough로 교정 —
undecided≠false, `undefined` 반환은 TypeError**.) **탈출구는 그대로: 핸들러가 직접 prompt → yes면
`{trusted:"yes", remember:true}`**(결정 6 carve-out, 인간 명시 override라 정당). (0.79.0엔 이 모듈 부재 = 0.79.1 구조.)

**버킷 분류:**
- **버킷 A (지금 코드+게이트, 결정 1 완성):** F5a/c(preflight `getEntry` + evidence 3필드 + 탈출구 방향
  assertion, entryPath는 pi `normalizeCwd` 축) · 상속-false **active-prompt 탈출구**(`{trusted:"yes",
  remember:true}`; defer는 `{trusted:"undecided"}` — handler `undefined` 금지) · **N3b** inherited-false deny
  메시지에 `inheritedFrom`+remedy · **N5 F3 unlink 축소 = A 확정**(live 버그). (**N4 기각**: undecided→undefined
  정정은 소스 미스라 철회.)
- **버킷 B (entwurf_v2 step 4-5 진입 전, 원장에 산문 아니라 결정표/스키마/게이트로):** **N1 intent×{live,dormant,
  indeterminate} 6칸표 + "indeterminate 절대 spawn 금지" 동결 + dispatch 영수증** / **N2 fire-forget+dormant =
  "지금은 reject" 잠금**(mailbox-wake는 reply-correlation id가 substrate에 없어 additive 확장) / F2 per-gid
  lockfile + pi 동시-resume 실측(검증원장 추가) + send-fail fallback / **fact-provider는 4값 liveness
  (alive|dead|indeterminate|**unsupported**)를 fact로 노출**(F3 결정의 "indeterminate는 getLiveSessions 제외"는 legacy
  listing 한정 — 숨기면 facts-only 교리 위반 + 6칸표 디스패치가 indeterminate/도메인밖을 못 봄, R3b; **unsupported는
  Fable R1 2026-06-11** = predicate 미정의 backend) / F4 liveness를 backend-capability 술어로
  추상화 + claude liveness 술어 Stage 1 전 한 줄 동결 / F6 entwurf_v2 TypeBox 입출력 스키마 + target 의미론
  (garden-id only? 오타 gid가 신규 spawn 사고 막기) + error taxonomy를 `check-*` 게이트로. **→ contract-lock
  단위 산출·이후 스텝 arc·R1-R5 freeze 반영은 ↑ "entwurf_v2 contract-lock 작업 계획" 섹션(2026-06-11).**
- **버킷 C (backlog):** F7(doctor backend wake-path probe 또는 BASELINE "live-verified: date|never" 표) ·
  F8(`getLiveSessionsWithInfo` `Promise.all` 병렬화 한 줄) · **formatter remedy 정밀화(GPT 2026-06-10):**
  `formatPreflightDenial`의 inherited-false remedy("interactive pi에서 approve")는 controlled-launch deny에
  쓰일 때 cwd가 `hasTrustInputs=false`면 pi가 prompt를 안 띄워(early `return true`) 부정확할 수 있다 →
  버킷 B에서 launcher가 formatter를 소비할 때 `hasTrustInputs` 분기 고려. (핸들러 경로는 항상 event-reachable
  =hasTrustInputs=true라 무영향.)

**버킷 B 잔여 freeze (2026-06-11, Opus 소스실측 + 새 GPT 비준 — step 4 진입 전 F2/F4/R3b 3항목 동결, 코드 아님):**
- **F2-실측 = 검증원장 row 추가됨.** pi 0.79.1은 동시-resume self-guard 안 함(`appendFileSync` plain append,
  session-manager.js:664; `wx` 가드는 신규 *생성*만 :652/:1146). v2=항상 resume라 pi `wx` 무용 → **per-gid
  lockfile이 유일 가드.**
- **F2-lock 메커니즘 = ⓐ `openSync(lockPath,"wx")` atomic primitive** (GPT 비준; pi 신규 가드와 동일 primitive,
  새 direct dep 0, durable state 아닌 짧은 dispatch claim이라 프로젝트 원칙 정합 — proper-lockfile 직접 의존 회피).
  **구현 계약:** (1) acquire는 **liveness probe 이전**. (2) lock 내용 = JSON `{gardenId, pid, hostname,
  createdAt, nonce, owner:"entwurf_v2"}`. (3) release = **nonce가 자기 것일 때만** unlink. (4) stale reclaim =
  **same hostname + `kill(pid,0)==ESRCH`만**(TTL-only 탈취 금지 = 이중 spawn 위험). (5) 충돌 = `target-locked`
  reject(taxonomy 선점 멤버 현금화).
- **F2-lock release 조건 (GPT 보강 — 관측가능성, freeze 핵심):** lock은 "spawn-in-progress"를 보호한다. release =
  **다음 dispatcher가 같은 target을 더는 dormant로 오판하지 않을 관측 가능한 상태**가 됐을 때 — pi live/tmux/control
  transport에서 bounded `get_info`/control-socket alive 확인 후 release. **관측 가능한 liveness 전이가 없는
  transport(plain headless spawn)는 v2 resume transport로 쓰지 않는다.** 근거: 현 `spawnEntwurfResumeAsync`는
  `-p --no-extensions` headless = `--entwurf-control` 없음(entwurf-async.ts:311-319) → 자식 소켓 비관측 → fact
  liveness 영영 dead → **sequential duplicate 갭.** ∴ **v2 resume child는 control-socket 관측 가능해야 F2가
  완전히 닫힌다**(wx lock만으론 동시 race만 줄이고 sequential 갭 잔존). = 0.11 tmux-live `--entwurf-control`
  surface와 정합.
- **F2-send-fail fallback (R5 별 축, post-transport):** send 결정 후 socket이 mid-flight로 죽으면 → **같은 dispatch
  결정표로 1회만 재resolve**(특수분기 금지, silent spawn 금지). 재resolve 칸이 reject면 reject. 예: fire-forget가
  live 판정→send 실패→dormant 되면 표상 fire-forget+dormant=reject라 spawn 안 함(N1/Q2 정합). **별도 enum 안
  만듦** — pre-dispatch taxonomy와 분리.
- **F4 동결:** claude-code=self-fetch, control socket 없음 → liveness predicate **미정의=`unsupported`, Stage 1 전
  보류**(`LIVENESS_DOMAIN_BACKENDS=["pi"]` 이미 contract 인코딩). `connect`=reachable≠responsive 주의.
- **R3b 동결:** fact-provider는 `alive|dead|indeterminate|unsupported` 4값 노출(claude=unsupported 명시,
  indeterminate로 접지 않음). `FACT_LIVENESSES` 4값 이미 contract. Fable 비차단 관찰(`Record<FactLiveness,…>`
  exhaustiveness 링크) = 이 작업서 봉합.
- **구현 단계 게이트 (step 4-5, 지금 아님):** lock primitive deterministic concurrency test · `target-locked`
  receipt test · fake socket/probe 기반 dispatch test. (live 동시-resume race는 flake/cost 대비 약 = 게이트 대체.)
- **레거시 갭 명시:** 레거시 `_resume`(entwurf-async.ts)는 동결결정 10 scope A로 무변경 → 레거시 동시-resume
  이중실행은 *알려진 잔여 갭*(단일 오케스트레이터 관행이라 드묾), 완전 전환 시 닫힘. lock은 v2 dispatch만 잡음.

**F-mailbox = v2 contract mailbox-deliverability 축 (2026-06-11 발견 → ✅ SHIPPED 2026-06-11, GPT힣 review GO):**
> **닫힘.** 아래 보강 방향(1-4) + 구현 제약(i-iv)이 모두 `entwurf-v2-contract.ts` + `check-entwurf-v2-contract`(109 assertions)로 현금화됨. `meta-mailbox` transport · `mailbox-undeliverable` reason(fail-closed) · `UNSUPPORTED_DISPATCH_TABLE` 미니표 · `resolveDispatch(intent, liveness, mailboxDeliverable)`. 아래 본문은 step 5 dispatch가 소비할 **설계 근거**(future-risk·게이트 교훈·릴리즈 매트릭스)라 보존. 결정 trace는 commit + RECENT 참조.
> **발견 경위:** pi 세션(GPi)이 Claude 시민(Opus)에게 회신하려다 `connect ENOENT .../….sock` 실패. 추적 결과
> **같은 뿌리의 버그가 두 층에 있었다:** (1) 레거시 pi-native `entwurf_send`가 control-socket-only라 mailbox
> fallback 없음(= **고침 완료** `26ca0df`, ↓ 세션 블록), (2) **v2 contract도 동형 갭.**
- **v2 결함 (소스 확정):** `resolveDispatch`(entwurf-v2-contract.ts:177)는 `unsupported` backend(claude/codex/agy)를
  **두 intent 모두** `backend-liveness-unsupported`로 reject — `fire-and-forget`까지. 그런데 fire-forget은 0.10.0
  meta-bridge mailbox로 **liveness 없이도 늘 전달**된다. `ENTWURF_V2_TRANSPORTS=["control-socket","spawn-bg","tmux-live"]`엔
  **`mailbox`가 없어** "메일박스에 떨군다"를 표현할 수단 자체가 없다. = **liveness-routing(resume↔send) ≠ mailbox
  deliverability(liveness-free)** 두 축을 혼동.
- **Stage 0엔 정직, 통합엔 치명:** 지금 pi-only 스코프라 `backend-liveness-unsupported`는 "v2가 이 backend 아직
  안 함 — 레거시 써라"는 정직한 reject(= **Fable contract-lock GO 유효**, pi-도메인 정확성을 본 것). 하지만 v2가
  *그 한 동사*가 되면(동결결정 10) fire-forget-to-Claude reject는 **틀렸다** — 가장 흔한 경우를 막아 레거시
  `entwurf_send`를 영영 못 죽인다. **∴ step 5(dispatch) 전에 반드시 닫는다.**
- **보강 방향 (step 5 전 결정/스키마/게이트로 동결):** (1) transport enum에 **`meta-mailbox` 추가**. (2)
  **fire-and-forget + mailbox-deliverable 시민 → send/meta-mailbox/ack-only**(reject 아님). (3) **owned-outcome +
  unsupported는 계속 reject**(self-fetch라 진짜 liveness 필요 = 정당). (4) **indeterminate pi socket은 여전히
  no-spawn / no-silent-mailbox**(안전). → `check-entwurf-v2-contract`에 mailbox-deliverability 축 assertion 추가.
- **amendment 구현 제약 (Fable 검수 2026-06-11, amendment 커밋에 동반 필수):**
  (i) **mailbox를 6칸 `DISPATCH_TABLE`에 굽지 말 것** — deliverability는 **별도 fact 입력**(citizen 존재)이다.
  resolveDispatch가 2번째 fact를 받거나, R1 도메인-가드 분기가 자체 **2칸 미니표**(unsupported×ff→send/meta-mailbox/
  ack-only · unsupported×owned→reject)가 되는 형태 — Q2 단일-verdict 순수성 + "6칸표=in-domain liveness 전용" 유지.
  (ii) **ack 정직:** mailbox ack = "enqueued+doorbell"이지 read 아님. `observedLiveness`는 `unsupported` 그대로
  (transport=meta-mailbox임을 영수증이 말함). (iii) **N2 비대칭 한 줄 명문화:** ff+dormant-**pi**=reject vs
  ff+unsupported-**citizen**=mailbox는 정당 — in-domain dormant=not-running **확정**이라 enqueue는 침묵 적체(resume
  권할 자리)·unsupported=미지라 doorbell best-effort가 최선. 이 줄 없으면 표가 모순처럼 읽힌다. (iv) **mode
  (steer/follow_up)는 mailbox transport에서 무의미** — v2 스키마/영수증이 명시.
- **미래 위험 (Fable, amendment 원장에 박을 것):** pi가 4번째 메타백엔드가 되면 `--entwurf-control` 없이 뜬
  **live** pi 세션 = meta-record 있고 소켓 없음 → ENOENT → silent mailbox인데, 그 세션 wakeMode(direct-inject)가
  mailbox를 drain 안 하면 메시지 **영구 적체**. 지금은 불가능(writer=Claude SessionStart 한정)이나 pi-backend
  도입 시 deliverability fact가 "메일박스 drain 능력"까지 봐야 함.
- **게이트-교훈 (GLG 2026-06-11, 박아둠):** 이 버그 클래스(= "control socket 없음 / liveness 없음"을 "전달
  불가"로 오해)는 **테스트로 검출됐어야 했다.** 레거시 쪽은 `check-entwurf-send-mailbox-fallback`(24 assertions,
  WIRING 가드 포함)으로 닫았다 — **Fable 검수 = 구조 GO**(전달가능성 0 입증된 ENOENT/ECONNREFUSED만 mailbox行,
  "close before response"는 surface라 중복전송 창구 구조적 0). 비차단 관찰: WIRING 가드는 존재-assert(텍스트)라
  미래에 get_message를 같은 try로 감싸면 못 잡음(주석이 by-construction 명시 = 수용). **v2 쪽 가드는 위 보강과
  같은 커밋에 박는다** — cross-transport 대칭(소켓 시민·mailbox 시민 둘 다 도달)을 게이트가 강제하도록.
- **릴리즈게이트 매트릭스 smoke (GLG 2026-06-11 지침 + GPT 제안 — 지금 blocker 아님, step 5/v2 amendment 때
  같이 게이트화·잊지 말 것):** entwurf 전달 경로를 **매트릭스로 전수** 테스트하는 별도 이름 smoke를 release gate에
  박는다 — **sender surface**(pi-native / MCP bridge) × **target kind**(live control socket / meta mailbox) ×
  **direction**(pi→meta · meta→pi · meta→meta · pi→pi). 지금은 개별 게이트(check-entwurf-send-mailbox-fallback +
  smoke-meta-mailbox + check-socket-probe)가 칸들을 부분 커버하지만, **매트릭스 전수 한 판이 없어서** 이번 pi→meta
  비대칭이 라이브에서야 드러났다(그게 교훈). 원칙: "막히는 부분 먼저 뚫되, 뚫은 자리마다 매트릭스 칸을 게이트로
  남긴다."

**Fable 2차 재검수 (2026-06-10, folding 검수):** F1-F8 처분 충실성 = clean(누락/격하 없음). folding 과정에서
나온 신규 N1-N5 검토: N1(6칸표 모순 해소)·N2(fire-forget+dormant "지금 reject" 잠금)·N3(비대칭 = 의도된 보안
속성 명문화 + deny 메시지 게이트)·N5(F3 = A 확정 live 버그) **채택** / **N4 기각**(GPT 소스 교정 2026-06-10:
`undecided`는 `emitProjectTrustEvent` runner.js:70에서 `continue` fallthrough = **정상 defer**, `undefined`가 아님
— Fable 2차의 `=> Result|undefined` API 변경은 소스 미스. undecided≠false coerce; 상속-false는 그 다음
store.get이 막음). **최종 go/no-go:
(a) 버킷 A 구현 진입 = GO**(N3b deny-메시지·N5 동반; N4는 기각). **(b) 버킷 B 설계 동결 진입 = GO**(N1 6칸 + N2 잠금 +
N3a 한 줄을 B 작업목록에 포함하는 조건 — 충족). N3-검증: controlled launch `trustOverride` short-circuit
(project-trust.js:17)·`startControlServer` GC(:1201) 소스 확정.

### Stage 0 step 3 progress map — meta-record v2 (3A→3D-4 ✅ 완료, 이력 보존)

정찰 + GPT 리뷰 + 코드 재검수로 고정했던 순서와 완료 이력이다. **step 3은 완결**됐고, 아래는 후속 세션이
왜 이 순서로 왔는지 확인하기 위한 원장이다.

**현 authority 위치 (2026-06-10 현재 — meta-record v2 전환 완결):**
- **live receipt = state.json 단독(3D-4 `f0a20d7`).** `enqueueMetaMessage`/`readMetaInbox`가 record를
  안 건드리고(identity dual-read만) mailbox `state.json`(`MailboxReceiptState`/`stampMailboxReceipt`)에만
  stamp. v2 record엔 `delivery{}` 없음. 파일 마커 `.msg`/`.msg.delivered`는 여전히 doorbell이지 read-receipt
  아님. v1 legacy record의 receipt는 upsert attach 시 `migrateV1DeliveryReceipts`로 state에 이관(state-wins).
- **capability source = 이제 registry(3D-3 `97c0503`).** mint/parse가 `metaCapabilityFor` seam
  (memoized `loadMetaCapabilityRegistry`)으로 `pi/entwurf-capabilities.json`에서 wakeMode/deliveryLevel을
  읽음. `META_BACKEND_DESCRIPTORS`는 `check-entwurf-capabilities`의 **drift-guard reference로만 생존**
  (registry≡const). **함의(3D-4 인지):** registry 파일이 런타임 load-bearing 승격 — 누락/corruption이면
  mint/parse 전체 throw(fail-loud, check-pack이 tarball 포함 보장).

**v1→v2 델타 (검증원장 대조 확정):** backend `+=pi` · transcriptPath required→nullable · 신규
`model:null`/`parentGardenId:null`/`isEntwurf:false` · `lastSeen`→`recordUpdatedAt` rename · `delivery{}`
통째 제거. (검증원장이 "제거"라 적은 `status·lifecycle·trusted·tmuxTarget`은 **현 v1에 이미 없음** —
실제 제거 대상은 `delivery{}` + `lastSeen` rename 둘뿐.)

**구현 순서 (고정, 진행 반영):**
1. ✅ **synthetic/sanitized v1 fixture**를 golden으로 고정. 실제 디스크 meta-record(real cwd/transcriptPath)를
   public repo에 커밋 **금지**. (`check-meta-record-v2`)
2. ✅ `parseMetaRecordV1/V2` + `normalizeMetaIdentity` 먼저. v1→normalized v2 identity golden GREEN 전엔
   v2 writer **금지**. (끊을 지점 ① 통과)
3. ◐ v2 write shape + dual-read pure 함수 완료(`serializeMetaIdentity`, `parseMetaRecordAny`,
   `parseMetaIdentity`, `check-meta-dual-read`). **아직 FS upsert 연결 없음.**
4. ✅ **delivery 제거 전 mailbox receipt state schema/store 먼저 못박음** — `MailboxReceiptState` /
   `stampMailboxReceipt` / body-path drift guard 완료. **3D-2(`79b3c98`)에서 live dual-write 연결 완료.**
5. ✅ **wakeMode 제거 전 capability source 먼저 못박음** — `pi/entwurf-capabilities.json` + parser/gate 완료.
   **3D-3(`97c0503`)에서 live consumer(mint/parse) 전환 완료.**
6. 남음: **정당하게 update될 게이트(= regression 아님):** `check-meta-session`(delivery.*/lastSeen/wakeMode +
   backend↔wakeMode contradiction 단언) · `smoke-meta-mailbox`(receipt assertion 위치) · store-doctor
   (contradiction check). dual-read 경로엔 v1 fixture 게이트 별도 유지.
7. 남음: **MCP `pi-tools-bridge`는 구조 비의존**(`readMetaInbox()`만 호출, index.ts:661) → 코드 무변경 가능.
   단 주석/description의 `lastReadAt` wording + doctor/error wording은 update 대상.

**구현 전 반드시 끊을 지점 (2):**
- ① v1 fixture → `normalizeMetaIdentity` golden GREEN **직후 = GPT 리뷰.** v1 무손실 normalize 증명 전
  v2 writer 금지(디스크 v1 10+개 역호환이 여기 걸림).
- ② 깨진 게이트 update **직후 = GPT 리뷰.** "정당한 update vs 진짜 regression" 혼동 최다 구간.

**체감 단위 분해 (3A–3D, 2026-06-09 GLG+GPT힣) — step 3를 한 번에 하지 말 것:**
step 1·2는 안전장치/토대라 체감이 없었다. step 3부터는 **관찰 가능한 결과 단위**로 끊는다. 각 단위마다
새/수정 gate + 관찰 가능한 결과를 낸다. 아래는 위 "구현 순서(고정)"의 재배열·명시화이지 새 결정이 아니다
(특히 3B·3C를 3D writer **앞**에 두는 건 위 4·5의 "먼저 못박음" 제약을 순서로 박은 것).
- **3A. v1→v2 normalize gate** (= 고정순서 1·2). 결과: 기존 v1 meta-record를 읽고 v2 identity로 normalize
  = "옛 시민을 잃지 않음". 검증: synthetic v1 fixture → normalized v2 golden GREEN. → **끊을 지점 ①.**
- **3B. mailbox receipt state** (= 고정순서 4). schema/store 완료. 결과: receipt의 새 집
  `meta-mailbox/<gardenId>/state.json`이 생김. **live 체감(`inbox_read` 후 state에 `readAt`) = 3D-2(`79b3c98`) 완료.**
- **3C. capability source** (= 고정순서 5). 완료. 결과: wakeMode/deliveryLevel이 record가 아니라 capability
  source(`pi/entwurf-capabilities.json`)에서 나올 준비 완료 → "이 시민은 self-fetch/direct-inject 가능한가 /
  pi는 control-socket live 가능한가"를 capability가 답함. (live consumer(mint/parse) 전환 = 3D-3 `97c0503` 완료.)
- **3D. v2 writer + dual-read** (= 고정순서 3). 3D-1 pure writer/dual-read 완료. 남은 3D-2/3/4:
  live receipt dual-write → capability-backed metadata → v2 writer/upsert + gate update. 이후 고정순서 6
  (게이트 update) → **끊을 지점 ②** → 고정순서 7(MCP wording).

### 0.10.0과의 관계
0.10.0(meta-bridge delivery/install/doctor)은 #35 frame을 배신하지 않음(workshop-safe). 0.11.0은 그
substrate(SessionStart 훅·mailbox·doorbell·소켓) 위에서 launch surface를 tmux-live로 통일 + pi를 4th
backend로 편입한다.

### 부가 신호 (backlog — Stage 0 밖, 각 백엔드 liveness 동작 후, GLG 2026-06-10)
"최적의 형제" 판단의 **부가 입력** — substrate가 아니라 에이전트 층이다. 6/9 설계 원본의 사례:
- **주간 쿼터**(클로드 거의 참 → pi로 지피티) — "별도로 쉽게 알수있음", substrate 밖 외부 신호.
- **시스템 부하**(burden → live 대신 `pi -p` bg) — OS probe, 호출 시점 에이전트 판단.
순서: Stage 0(정체성/능력/liveness/trust substrate) + 각 백엔드 dispatch가 동작한 **다음** 얹는다.
substrate(record/capabilities/mailbox/probe)에 쿼터·부하를 **저장하지 않는다**(상태 저장 = 거짓말 함정).

## Post-0.10.0 meta-bridge follow-ups (backlog — 0.11.0과 별개 트랙, GLG 재오픈 시)

- **#34 잔여 (doc 제외).** empirical probe 4종(FileChanged coalescing bound / active-turn arrival /
  watchPath 고갈 / compact-window) + unread-mailbox heartbeat backstop. deterministic 절반(catalog
  1–4 + level-trigger)은 0.10.0서 닫힘.
- **Phase 4 후속 — 실제 GC 자동화.** `--apply`(또는 `--print-rm` 게이트), TTL/liveness 코드화, 글로벌
  설치 스킬로 에이전트가 뒷정리(동작 로직 방해 금지). corrupt/duplicate가 그 nativeId registration을
  영구 차단하는 문제도 이 트랙. 참고: `agent-config/.claude/skills/agent-config/`.
- **step 7 `entwurf_peers(includeMeta)`** — 메타세션 발견성. 가치 있으나 install/doctor보다 우선순위 낮음.

## Carried-forward follow-ups from 0.9.0 (real next work, not cut blockers)

- **`/gnew` T3 backend axis — Claude-only measured.** Backend identity after `/gnew`
  (`PI_SESSION_ID` → backend MCP child) is live-proven on `claude-sonnet-4-6` only; the resident
  guard runs at the default `SMOKE_RGG_MODEL`. The switchSession rebind is backend-agnostic at the
  bridge level, so risk is low. The 0.9.0 BASELINE/CHANGELOG now carries the explicit
  skip-with-reason; follow-up is to extend `SMOKE_RGG_MODEL` to codex/gemini for a `/gnew` T3 run.
- **`/gnew` empty-session GC.** `/gnew` persists the header+metadata file immediately
  (switchSession needs it to exist), so repeated `/gnew` without a turn leaves header-only files —
  more than the launcher (which defers the file to the first turn). A cross-cutting empty-session
  GC (applies to the launcher too) is the follow-up, not a `/gnew` defect.
- **`entwurf.ts` source guard refinement.** The deterministic guard is fail-closed (every
  `pi.sendMessage` must sit inside a best-effort arrow wrapper). Correct while `entwurf.ts` is
  completion-send only. If a plain UI send is ever added there, refine the guard to
  close-handler scope / allowlist — do NOT loosen the equality check.

## Deferred — dep bump (claude-agent-acp 0.40.0 / @agentclientprotocol/sdk 0.24.0) — SEPARATE track

sdk 0.24 removed `unstable_setSessionModel` (the model-set RPC) entirely (type + runtime),
replacing it with `session/set_config_option` (configId="model"). Claude model selection survives
via `_meta.claudeCode.options.model` at newSession, but **codex/gemini model-forcing has no other
path** — `resolveCodex/GeminiAcpLaunch` pass no `--model`, so the RPC was their sole mechanism; an
`as any` cast over the removed method would silently regress them (the exact 0.4.5 anti-pattern
`check-sdk-surface` exists to block). Forward fix: migrate `enforceRequestedSessionModel` to
`setSessionConfigOption({configId:"model", value})` with config-value discovery + a per-backend
resolved-model release-gate assertion + live codex/gemini verification (codex-acp is a bundled
binary — set_config_option support is unverifiable statically). The critical Opus 4.8
thinking-blocks fix is already in the pinned 0.39.0, so the entwurf identity line needs nothing
from 0.40.0. Bump `~/sync/org/setup/update-claude.sh` pin in lockstep when this lands.

## Standing focus — Mitsein over MCP: plain external vs garden-native meta-session

상시 초점: `pi-shell-acp` 를 OpenClaw plugin 으로 더 미는 것보다, **pi session ↔ Claude Code /
external MCP host ↔ pi-tools-bridge ↔ entwurf** 가 서로 다른 하네스 정체성을 유지하면서 함께
일하는 시나리오를 검증한다.

2026-06-06 전환: 예전 "외부 MCP host = non-replyable" 비대칭은 **plain external** 에만 맞다.
Claude Code native 가 meta-bridge `SessionStart` 로 garden citizen 이 되고 sender marker 까지 쓰면
그 세션은 pi control-socket 은 아니지만 `entwurf_send` 에서는 **replyable meta-session** 이다.
즉 send/inbox는 대칭 공존으로 닫혔고, 남은 비대칭은 `entwurf_resume` async followUp 같은
pi control-socket 전용 채널이다.

핵심 질문:
- agent 가 plain external(non-replyable) 과 garden-native meta-session(replyable by garden id)을
  구분하는가?
- `entwurf_send` 는 fire-and-forget, `entwurf` / `entwurf_resume` 는 outcome ownership 이라는
  역할 분담이 실제 워크플로에서 헷갈리지 않는가?
- Claude Code 가 설계/리뷰하고 pi-shell-acp 세션이 실행하거나 그 반대인 시나리오가
  문서/로그/UX 상 정직한가? (서로 forward 하지 않고 GLG 가 역할을 정하는 패턴 유지.)

성공 기준: 각 시나리오에서 "누가 outcome 을 소유하는가" 가 명확하고, replyable / non-replyable /
send-is-throw / MCP `entwurf_resume` 조건부 async default(0.7.6) 경계가 agent 발화에 정확히
반영된다. 특히 native Claude meta-session 이 `external-mcp/claude-code` 로 퇴행하거나
`wants_reply=true` 를 비대칭 논리로 거절하면 버그다 — install/doctor/sender-marker 경로를 본다.

## Active hygiene — session continuity (`incompatible_config`)

같은 pi 세션을 resume 할 때 실행 옵션이 달라지면 bridge config signature 가 달라져 ACP backend
session 이 `incompatible_config` 로 invalidate 된다. 대표 footgun: 평소
`pi --entwurf-control --emacs-agent-socket server` alias 와 달리 plain `pi` 로 실행하면
`--emacs-agent-socket` 누락 → `bridgeConfigSignature` 변동 → pi JSONL 은 남지만 backend 매핑이
새로 생겨 모델이 이전 맥락을 모르는 것처럼 반응.

다음 작업 후보:
1. `incompatible_config` 로그에 축별 diff 출력 (예: `emacsAgentSocket: null -> "server"`).
2. `PI_SHELL_ACP_STRICT_BOOTSTRAP=1` 운영 문서화 / silent-new 대신 fail-fast 검토.
3. `emacsAgentSocket` 을 session compatibility 축에 넣는 게 맞는지 재검토.

## Main backlog — #25 bridge hygiene (OpenClaw audit lessons)

OpenClaw audit lesson 을 plugin 확장이 아니라 **pi-shell-acp 본체 bridge hygiene** 로 흡수한다:
1. **Transcript pre-flight** — backend native jsonl 위치 verifier (Claude `CLAUDE_CONFIG_DIR`,
   Codex `CODEX_HOME`/`CODEX_SQLITE_HOME`, Gemini `GEMINI_CLI_HOME`).
2. **Invalidation reason taxonomy** — 지금 `incompatible_config` 가 너무 넓다. 후보:
   `auth-profile`, `auth-epoch`, `system-prompt`, `mcp`, `transcript-missing`, `emacs-socket`,
   `tool-surface`.
3. **Session cache hygiene** — `acp-bridge.ts` bridge session cache 에 idle timeout / LRU /
   max-N cap 검토.

나중 후보: fingerprint-keyed reuse (skills snapshot + extra system prompt hash 축); single-turn
lock per session (같은 sessionId 동시 prompt 진입 throw).

## Reference paths

- 본체: `~/repos/gh/pi-shell-acp/`
- Consumer: `~/repos/gh/agent-config/`
- NixOS consumer: `~/repos/gh/nixos-config/`
- OpenClaw source: `~/repos/3rd/openclaw/`. Plugin `plugins/openclaw/` is **deprecated** (see below).

## Deprecated — closed, do not reopen

- **OpenClaw track (2026-06-10 종료)**: `plugins/openclaw` deprecated & unmaintained.
  Claude / Gemini 가 ACP 를 네이티브로 지원하고 (Claude 는 6/15 이후 크레딧 기반),
  wrapper 레이어의 존재 이유가 사라졌다. ACP 본체(pi-shell-acp)는 계속 Claude / Codex /
  Gemini 지원 — 맥락만 바뀐 것. npm `@junghan0611/openclaw-pi-shell-acp@0.0.1` 은
  `npm deprecate` 로 마킹, 소스는 reference 용으로 동결. ClawHub publish / self-contained
  install / embedded runtime 전부 폐기. `@junghanacs` publisher 핸들은 확보됐고(issue #2346
  resolved) 다른 용도로 전용.
- **Long-term / separate issues**: #11 remote SSH resume cwd alignment (remote entwurf identity는
  0.9.0 에서 의도적으로 fail-fast), #10 broader ontology RFC, #8 ACP `entwurf_send` message
  visibility UX, #2 pi-first context meter, L5 long soak with repeated context-pressure events.
