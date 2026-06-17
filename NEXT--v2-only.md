# NEXT — `v2-only` 브랜치 (subtract-to-v2)

> 나침반: **현재 위치 · 다음 한 걸음 · 넘으면 안 되는 선**만.
> 이 브랜치는 main에 머지하기 전 삭제하고, 닫힌 결과는 ROADMAP/CHANGELOG로 승격.

## 목표 (한 줄)

**copy-subtract, then rename.** pi-shell-acp를 이 브랜치에서 통째로 두고 ACP/v1을 빼서
**v2-only로 동작**시킨다. 이름 변경(`pi-shell-acp`→`entwurf`, `piShellAcpProvider`→`entwurf`)은
**이번 브랜치에서 안 한다** — rename은 v2 green 확인 후 별도 단계(브랜치/Phase B).

## 현재 위치 (2026-06-16 KST, hejdev6)

- dev 버전 pi 설치 완료(hejdev6, 로컬 클론 소스, pi 0.79.4). 이건 main 기준 작업 — 브랜치와 독립.
- **env seam(step ⑤) 선분석 완료 → "본질 난제" 아님으로 격하** (아래 작업순서 step4 / 자율지침 step5).
  근거: `PI_SESSION_ID`는 이미 pi-native, 끊기는 건 `PI_AGENT_ID` 하나뿐이고 caller-side는 fallback
  보유 → MCP child만 상속 env로 메우면 됨(= PI_SESSION_ID와 동형 3줄). badlogic 원형이 확증(참고 섹션).
- **라우팅(`getRegistryRouting` 하드코딩 + `resolve-acp-bridge.ts`)은 env seam과 별개 잔여**로 분리됨.
- **step ① openclaw DROP + step ② check 체인 트림 DONE → `pnpm check` EXIT 0 (green)** (2026-06-16).
  6 RED 처리: `check-mcp` DROP(normalizeMcpServers=ACP 전용, v2 부재) / `check-dep-versions`·`check-pack`·
  `check-shell-quote`·`check-entwurf-session-identity` 수정(ACP 핀·required·SOURCE_SITES·v1 블록 제거) /
  `check-entwurf-v2-only`는 체인에서만 제거(게이트 자체는 step③). **커밋 안 함(GLG 대기).**
- **step② 잔여(green 무영향, 체인 밖 dead code)**: `check_backends/models/registration/auth_boundary/
  sdk_surface/claude_sessions` 함수+case+usage + backend smokes(smoke-claude/codex/gemini/all) +
  `smoke-installed-entwurf-acp` + package.json scripts 정리 / README ACP dep 언급 / `.husky/pre-commit` 주석.
- **방향 전환(2026-06-16, GLG): "ACP를 다 빼면 v1 ACP 의존이 드러난다" → step③ 보류, ACP 완전 제거 먼저.**
  (이유: v1 surface가 ACP backend에 매달린 지점이 ACP 제거로 loud하게 드러남. 그때 v1 뺄 범위가 명확.)
- **조사 결과**: ACP deps 이미 제거됨(`dependencies`=mcp-sdk+zod, ACP import 0건 → lockfile 재생성만).
  `protocol.js`=entwurf 공유 상수라 **KEEP**(ACP 아님). `release_gate`(4301-4515)는 ACP 직접 호출 0건.
  4542/4828은 case 분기(함수 아님). `bf4a533`=step①② 커밋(green).
- **ACP 완전 제거 대상**: run.sh 13 ACP 함수(`smoke_all/continuity/cancel/model_switch/entwurf_resume/
  async_resume/installed_entwurf_acp` + `check_backends/models/registration/auth_boundary/sdk_surface/
  claude_sessions`) = 함수+case+usage / `setup_all` 본문 ACP 호출(`check_global_*_acp`·`check_mcp`(이미
  함수삭제—dangling)·`check_backends/registration/models`·`smoke_all`) / package.json scripts /
  `check_global_*_acp`·`sync_auth` / 잔여(`scripts/resolve-acp-bridge.ts`·`getRegistryRouting` 하드코딩·
  mcp/index.ts description 문자열). **가드레일 = `pnpm check` green 유지.**
- **ACP 완전 제거 DONE → `pnpm check` green** (setup_all v2화 / run.sh 16 ACP 함수+18 case+usage 제거 /
  package.json scripts 13 제거 / lockfile ACP deps 4 + plugins/openclaw importer 제거). **미커밋.**
- **잔여(라우팅성, Phase B 가까움)**: `scripts/resolve-acp-bridge.ts`(orphan 확인 후) /
  `getRegistryRouting` 하드코딩 `provider:"pi-shell-acp"`(=rename 영역 → Phase B) /
  `mcp/index.ts` description 문자열("from acp-bridge.ts" 등 정확성).
- **v1 surface 1차 제거 + env seam DONE → `pnpm check` green** (2026-06-16 19:25 KST): MCP `entwurf`/`entwurf_resume`/`entwurf_send`, pi-native `entwurf_send`, startup `/entwurf-send`, `spawn_async_resume`, v1 gate/async scripts 제거. `updateSessionEnv`가 이제 `PI_SESSION_ID`와 함께 `PI_AGENT_ID=<provider>/<model>`을 set/delete. `entwurf-v2-resume-marker.ts`는 v2 resume 인증이라 KEEP. 남은 건 문서/주석/레거시 smoke 정리 + 커밋.
- **run.sh dead v1/ACP smoke 정리 + release-gate 수리 DONE → green** (2026-06-16, 커밋 `496452e`):
  `smoke_entwurf_resume_single`(ACP, 0-caller) / `verify_resume`+`verify-resume` 서브커맨드 /
  `validate_pi_native_async_entwurf`+`check_native_async`(삭제된 entwurf.ts spawn) /
  `smoke_compaction_policy`(absent script) 제거 + release-gate MUST의 3 깨진 run_step 제거 + stale 주석.
  run.sh −326줄. `cross-cwd-resume-smoke.ts`는 이미 삭제돼 있어 dangling 참조만 정리.
- **fresh-mint 연기 결정 박기 DONE** (커밋 `c8cae8a`): ROADMAP 0.12 lane + NEXT step3.
- **AGENTS.md v2-only 재작성 DONE** (2026-06-16): 운영 baseline을 현재 표면으로 truthful하게 고침 —
  "What This Repo Is"=pi-native dispatch substrate + meta-bridge, Hard Rules 8개(ACP/3-backend 제거),
  Verification=실제 check-entwurf-v2-*/meta-*/sentinel/release-gate, Entwurf=v2 4도구+`/gnew`,
  File Structure/Deps(mcp-sdk+zod)/Typecheck fence 갱신. 상단에 **branch-status 배너**로 name(`pi-shell-acp`)↔
  content(no ACP) 불일치를 명시. rename은 보존(Phase B). **README는 아직 ACP 시대 — Phase B/후속 doc 패스로 미룸.**
- **release-gate dead-ref 2차 정리 DONE → `pnpm check` green** (2026-06-17): `496452e`의 release-gate 수리가
  **불완전**했음을 검토로 발견 — `ae33e73`(ACP backend purge)에서 함수+case가 삭제된 6개 smoke를 release-gate가
  아직 MUST `run_step`으로 호출(run.sh unknown-subcommand=`exit 1` → MUST 6개 **가짜 RED** → gate 거짓 NOT-releasable).
  제거 6: `smoke-installed-entwurf-acp`/`smoke-all`/`smoke-async-resume`/`smoke-cancel`/`smoke-model-switch`/`smoke-entwurf-resume`
  (v2 대체는 이미 gate 내 `smoke-entwurf-v2-matrix-live`+`smoke-entwurf-v2-spawn-resume-live`). 동반:
  orphan `_single` 워커 3개(`smoke_continuity/cancel/model_switch_single`, 호출자 0, −411줄) 삭제 +
  orphan `scripts/smoke-async-resume.sh` 삭제 + usage/주석 5곳 truthful화(삭제된 명령 호명 제거). **미커밋.**
  → MUST tier가 이제 8스텝(static+id-name+RGG+check-bridge+v2 matrix/spawn-resume+session-messaging+xt-surface),
  전부 살아있는 subcommand. **LIVE 재실행이 비로소 유의미.**
  - **잔여(이번 단위 밖, doc-truth)**: 살아있는 파일 안 stale 주석이 삭제된 명령을 호명 —
    `scripts/sentinel-runner.sh`(225 smoke-async-resume / 457 smoke-continuity), `scripts/check-model-lock.ts`(31-32 smoke-model-switch),
    `scripts/smoke-entwurf-v2-matrix-live.ts`(29 smoke-async-resume family). 기능 무영향 → Phase B doc 패스.
  - **`scripts/resolve-acp-bridge.ts` orphan 심화 확정**: 유일 소비자였던 `smoke-installed-entwurf-acp` 제거로
    이제 더 명확한 orphan. 단 NEXT 잠금대로 라우팅 잔여 = **Phase B**에서 절삭(여기서 안 건드림).

## 잠긴 결정

- **전략 = subtractive**. additive(closure 골라 이식)는 JSON/스크립트/`pi/meta-bridge/` 등
  import-그래프 밖 자산을 silent 누락. subtractive는 게이트가 loud로 잡음.
- **여기서 작업**: pi-shell-acp repo의 `v2-only` 브랜치. 1단계 "통째 복사"는 브랜치 생성으로 충족(공짜).
- **D1 = 새 `entwurf` 설정 네임스페이스** (최소: `{"entwurf": {"targetsPath": "~/.pi/agent/entwurf-targets.json"}}`).
  `piShellAcpProvider` 폐기. 최상위 `mcpServers`는 pi-core/타 패키지와 의미 충돌 위험이라 비채택.
  → **단, 적용은 rename 단계(Phase B).** 이번 브랜치는 이름 보존이 원칙.
- **D3 = 공존 허용 + single-writer guard** (takeover 금지). 공유 자산
  (`~/.pi/agent/entwurf-targets.json`, meta-bridge 플러그인)은 schema-compatible + owner marker/
  doctor conflict check. 충돌 시 **warn 아니라 fail**. entwurf setup이 pi-shell-acp managed 파일을
  조용히 덮어쓰면 안 됨.

## 작업 순서 (6단계)

1. [x] 통째 복사 = `git checkout -b v2-only` (완료)
2. [~] **ACP/v1 삭제** — 진행 중.
   - [x] 루트 5파일(`index/acp-bridge/event-mapper/engraving/pi-context-augment`) + v1 `entwurf.ts` 삭제
   - [x] ACP 스크립트 2개(`transcript-poison-smoke`, `compaction-policy-smoke`) 삭제
   - [x] `package.json`: pi.extensions(2개로) + deps(ACP 3개 제거) + files[] 트림
   - [x] root+mcp+scripts **typecheck green**, lint green (7,718줄 삭제)
   - [x] **정정**: `entwurf-core.ts`(2033)는 v2가 import → KEEP. 실제 closure ~35파일/~13,400줄.
   - [ ] **`plugins/openclaw` 통째 DROP** — 설명이 "surfacing pi-shell-acp as ACP provider
     (Claude Code/Codex/Gemini ACP backends)"라 v2-only에선 의미 없음. `plugins/` 디렉토리 +
     `package.json`의 `check:plugins` 스크립트 + `pnpm-workspace.yaml`의 plugins 글롭 동반 제거.
     (이게 husky `[eval1]` acp-bridge.ts ERR_MODULE_NOT_FOUND의 정체.)
   - [ ] **run.sh DROP 게이트 제거** + `package.json` check 체인 트림:
     `check-models/backends/registration/auth-boundary/sdk-surface`, `verify-transcript-poison`,
     `check-claude-sessions`, backend smokes(`smoke-claude/codex/gemini/all`), `smoke-installed-entwurf-acp`.
   - [ ] `check-dep-versions`(KEEP): run.sh/README의 ACP dep 핀 참조 제거
   - [ ] README: ACP provider/backend dep 버전 언급 정리
   - [ ] `.husky/pre-commit` 주석의 ACP 게이트 나열(check-models/backends/registration/sdk-surface)도
     v2 게이트로 갱신 (안 그러면 문서-현실 불일치).
   **삭제 결합 규칙**: 파일/게이트 1개 = 함수 + run.sh case + npm script + check 체인 동반 제거.
3. [x] **v1 surface 털어내기 (ACP v1)** — 조사로 호출 그래프 검증 완료 후 1차 제거 완료(2026-06-16, hejdev6 pi).
   **NEXT 원안 2곳 정정**:
   - 🔴 **`entwurf-v2-resume-marker.ts`는 v1 아님 → KEEP**. v2 spawn-bg resume의 resident 인증 마커
     (producer `entwurf-v2-spawn-production.ts:253`, consumer `entwurf-control.ts:1132`
     `maybeSetResidentName`). 지우면 v2 resume 깨짐. `isV2ResumeResidentAuthorized`/
     `V2_RESUME_RESIDENT_SESSION_ENV` 보존. **실제 v1 가드는 `entwurf-v2-only.ts` 하나뿐.**
   - 🔴 **`entwurf-async.ts` 삭제 대상 누락 → 추가**. v1 async resume 런처
     (`spawnEntwurfResumeAsync`+`makeBestEffortDeliverCompletion`), 유일 도달=v1-gated
     `spawn_async_resume` RPC(control.ts:947). v2는 안 씀 → orphan.
   **DELETE (v1 본체)**:
   - `mcp/.../index.ts`: 도구 `entwurf_send`(435)/`entwurf`(774)/`entwurf_resume`(833) + import
     `runEntwurfSync`/`runEntwurfResumeSync`(91-92)·`checkV1EntwurfAllowed`(99) + 전용 헬퍼.
   - `entwurf-control.ts`: `spawn_async_resume` RPC(919-960)/`entwurf_send`(1680)/
     `--entwurf-send-message`(2111)/`/entwurf-send`(2419) + import(107·126).
   - `lib/entwurf-v2-only.ts` 전체 / `lib/entwurf-async.ts` 전체.
   - `lib/entwurf-control-rpc.ts:79`: `spawn_async_resume` RPC 타입 멤버.
   - scripts+case+체인: `check-entwurf-v2-only` / `check-async-resume-gate` / `check-entwurf-send-mailbox-fallback` / `cross-cwd-resume-smoke` 제거.
   - `mcp/pi-tools-bridge/test.sh` + `check-pi-tools-bridge-boot`는 v2-only tool surface(`entwurf_v2/self/peers/inbox_read`) 기준으로 갱신.
   - `lib/entwurf-core.ts`의 `runEntwurfSync`/`runEntwurfResumeSync`는 현재 export dead로 남음. `getRegistryRouting`/package-source 라우팅 잔여와 얽혀 Phase B 직전 별도 절삭.
   **🔴 fresh sibling minting = 명시적 연기 (GLG 결정 2026-06-16, GPT 리뷰 급소2 확증)**:
   삭제한 v1 `entwurf.ts` 헤더 = "spawn a dedicated pi process to run a NEW task" = fresh-mint 본체.
   v2 3 transport(control-socket / spawn-bg **resume** / meta-mailbox)는 전부 **기존** citizen 대상 —
   무에서 새 형제 만드는 verb 없음. `runEntwurfSync`/`runEntwurfResumeSync`는 호출처 0(dead).
   → **0.12는 fresh creation을 포기(능력 축소): 기존 citizen dispatch만.** v2 대체(4번째 transport
   `spawn-fresh` + 11-scenario gate)는 0.12.x 후속 lane(ROADMAP). **이 브랜치에서 안 만든다.**
   그동안 v2-only 트리는 "새 분신 생성"이 필요한 데일리 드라이버로 안 씀. 빼기(17K)는 완료, 이
   한 칸 "맞추기"는 의도적으로 비워둔 상태로 머지한다(능력 구멍 = 문서화된 의도, silent 아님).
   **KEEP (v2 surface)**: `entwurf_v2`/`entwurf_self`/`entwurf_peers`/`entwurf_inbox_read` 도구 +
   `entwurf-v2-*.ts` 전부 + `entwurf-v2-resume-marker.ts` + `entwurf-core.ts`의 v2 4심볼
   (`findSessionFileById`·`getEntwurfExplicitExtensions`·`mirrorChildStderr`·`readSessionIdentity`)
   + `maybeSetResidentName`+`isV2ResumeResidentAuthorized`.
   **⚠️ loud 커플링(결합 규칙, 추측 금지)**:
   - `entwurf-async.ts` 삭제 → `check-shell-quote.ts:44` SOURCE_SITES + `check-entwurf-session-identity.ts:711-716`
     동반 수정 (안 하면 check RED).
   - `entwurf-core.ts` 죽은 함수 = 둘만 쓰는 전용 헬퍼 더 있는지 확인 후 트림.
   - `index.ts` 공유 헬퍼(`buildSendSenderEnvelope` 등)가 `entwurf_v2`에도 쓰이는지 확인 후 제거.
4. [x] **env sender seam 수술 (재평가: 본질 난제 아님)** — `PI_SESSION_ID`는 이미 pi-native
   (`updateSessionEnv` entwurf-control.ts:1162, badlogic 원형 `control.ts:970`과 동일). 끊기는 건
   `PI_AGENT_ID` 하나. caller-side(`buildLocalSenderEnvelope` :527)는 `${ctx.model.provider}/${ctx.model.id}`
   fallback을 이미 가져 **무변경 동작**. MCP child(별도 프로세스, env만 읽음)만 메움 →
   `updateSessionEnv`에 `process.env.PI_AGENT_ID = ${ctx.model.provider}/${ctx.model.id}` 추가
   (PI_SESSION_ID와 대칭, off일 때 delete 포함). 결정 1건: agent id 포맷
   `pi-shell-acp/<model>`→`<provider>/<model>` (v2-only 목적과 일치, fallback이 이미 쓰던 값) —
   GLG OK 방향(2026-06-16). LIVE(pi child spawn)로 상속 1회 확인.
5. [ ] **rename 보류** — 이번 브랜치에서 안 함. v2 green 후 Phase B.
6. [ ] **배선 + green** — `pi.extensions` 정리, ACP deps 제거(`@agentclientprotocol/*`,
   `@zed-industries/codex-acp`, `@anthropic-ai/sdk`), lockfile, `pnpm check` 전체 통과.

## 자율 진행 지침 (hejdev6 Opus 대상)

이 브랜치를 이어받는 너에게. GLG는 퇴근, "알아서 진행"이 위임됐다. 순서대로 밀어라.

### 커밋 정책 (중요)
- 이 repo `core.hooksPath = .husky/_` → 글로벌 세이프레일 아님, **husky `pnpm check` 품질 게이트**.
- 절삭 도중엔 ACP 불변식 게이트(`check-models/backends/registration/sdk-surface` 등)가 **설계상 FAIL**.
- 따라서 **2-tail이 끝나 `pnpm check`가 다시 통과하기 전까지의 WIP 커밋은 `--no-verify` 허용**
  (훅 주석이 명시적으로 sanction함: "이해하면 우회"). 단 `pnpm check` green 복구가 끝나면 즉시
  `--no-verify` 중단하고 정상 커밋으로 복귀. **`core.hooksPath`/`.git-hooks-mode`는 건드리지 마라.**
- push는 원래 GLG지만 이번 세션 GLG가 "커밋 푸시해"로 명시 위임함. 이어지는 WIP push도 동일 위임으로 본다.

### 진행 순서 (NEXT 6단계의 2-tail부터)
1. **openclaw DROP** → `plugins/` 제거 + `check:plugins` 스크립트 + `pnpm-workspace.yaml` 글롭.
   → `tsc`/`pnpm check`의 `[eval1]` acp-bridge 에러 해소.
2. **run.sh DROP 게이트 + check 체인 트림** (위 step2 목록). 삭제 결합 규칙 준수
   (함수 + case + npm script + 체인 동시). `check-dep-versions`/README/.husky 주석의 ACP 핀도 정리.
3. **v1 surface 삭제 완료.** `entwurf-v2-resume-marker.ts`는 삭제 금지(KEEP) — v2 spawn-bg resume resident 인증.
4. **lockfile 재생성**: 필요 시 `pnpm install`; 현재 `pnpm check` green.
5. **env sender seam 완료**: `updateSessionEnv`에 PI_AGENT_ID set/delete 추가. caller-side는 `ctx.model` fallback으로 이미 동작 → MCP child 상속만 메움.
   PI_SESSION_ID와 동형이라 추측 아님. agent id 포맷 변화는 GLG OK 방향(2026-06-16).
   - **별개 잔여(라우팅, env seam 아님)**: `getRegistryRouting`(`entwurf-core.ts:991,1089`)의 하드코딩
     `provider: "pi-shell-acp"` + `scripts/resolve-acp-bridge.ts` + `smoke-installed-entwurf-acp` =
     패키지/확장 resolve 경로. v2-only 확장 entry는 `entwurf-control.ts`(index.ts 아님). 이건 rename(Phase B)
     직전 또는 green 배선(step6)에서 다룬다. 여기서 추측 구현 금지.
6. **green**: `pnpm check` 전체 통과 → `--no-verify` 없는 정상 커밋.

### 손대지 말 것
- **rename 금지** (pi-shell-acp→entwurf, piShellAcpProvider→entwurf): 이 브랜치 범위 밖 = Phase B.
  D1(새 `entwurf` 키)/D3(공존+single-writer guard, takeover 금지)는 잠겼지만 **적용은 Phase B/설치 수술 때**.
- `~/repos/gh/entwurf` 셸은 안 건드림 (Phase B destination).

## A 재범위화 결과 (2026-06-17, 커밋 `d7783d4`) — LIVE 2회 + 단독 1회로 실증

**release-gate를 v2-native floor로 재범위화 완료** (GLG+GPT 처분안). 코드 4파일(+67/−33):
- **retarget**: `scripts/smoke-session-id-name.ts` — 하드코딩 `--provider pi-shell-acp --model claude-sonnet-4-6`
  → native target(`PI_SHELL_ACP_LIVE_TARGET`, 기본 `openai-codex/gpt-5.4`) + `buildSessionName` 동기화 +
  **격리 temp `PI_CODING_AGENT_DIR`에 real `auth.json` 복사**(native provider는 auth.json로 인증, 구 ACP는
  Claude Code OAuth라 격리가 공짜였음). **단독 LIVE 재실행 PASS** (name=`openai-codex/gpt-5.4...`, T1/T2/T3 ok).
- **drop from release floor** (subcommand·case·usage는 on-demand 보존, GPT 지침): `xt-tool-surface`(ACP backend
  exclude-tools), `session-messaging`(제거된 `entwurf_send` v1 도구 호출), `sentinel`(ACP multi-backend matrix).
- **RGG retarget**: `smoke-resident-garden-guard.sh` 기본 provider/model을 native로(provider 마스킹 제거).
- **텍스트 보정**: run.sh release-gate 헤더/usage/BEHAVIOR 주석 + AGENTS.md Verification → v2-only floor.

**LIVE 최종 상태 (hejdev6, 재실행 2 + 단독 1 합성)** — MUST 6: **5 PASS** (static / smoke-session-id-name / check-bridge /
smoke-entwurf-v2-matrix-live / smoke-entwurf-v2-spawn-resume-live), **1 FAIL** (RGG 29/30). BEHAVIOR 1 advisory FAIL
(RGG positives, model-in-loop). **v2 substrate(matrix-live + spawn-resume-live)는 GREEN — 단, resident-side는 전역 혼입.**

## ✅ topology 고정 + LIVE/설치 green (thinkpad 2026-06-17): repo-under-test로 결정

결정: release-gate LIVE smoke는 **repo code under test**다. deployment-smoke가 아니다. 따라서 resident `pi --entwurf-control`
spawn은 device-local 전역 package에 의존하지 않고 **`--no-extensions -e $REPO`로 이 체크아웃만 로드**한다.

반영:
- `smoke-resident-garden-guard.sh`: 모든 resident spawn에 `REPO_EXTENSION_ARGS=(--no-extensions -e "$REPO")` 주입.
  repo guard가 stderr만 남기고 JSON session header를 안 뱉는 빠른 hard-exit 경로를 위해 `neg_sid` parse를 no-match 허용으로 보강.
- `scripts/gnew-rpc-drive.ts`: `/gnew` RPC resident도 같은 repo-under-test args로 spawn.
- `scripts/smoke-entwurf-v2-matrix-live.ts`: C1/C1b real resident spawn에 repo-under-test args 주입.
- `scripts/smoke-entwurf-v2-spawn-resume-live.ts`: spawn-bg resume child의 `resolveIdentity` seam에서
  `explicitExtensionArgs=[--no-extensions,-e,$REPO,...]`를 심어 native target에서도 전역 extension을 타지 않게 함.

검증:
- `pnpm check` PASS.
- `SMOKE_RGG_POSITIVE=0 ./run.sh smoke-resident-garden-guard` PASS=30 FAIL=0 (0-token 경로). `/new` cancel 해소 확인.
- `LIVE=1 ./run.sh smoke-entwurf-v2-matrix-live` PASS=17 (model-in-loop 없음, real control socket + mailbox).
- `LIVE=1 ./run.sh release-gate /tmp/pi-shell-acp-live-scratch` (PWD=scratch) 결과:
  - **MUST PASS=6 FAIL=0 SKIP=0**: static / smoke-session-id-name / RGG deterministic / check-bridge /
    matrix-live / spawn-resume-live 전부 green.
  - **BEHAVIOR FAIL=1 advisory**: RGG positive T3에서 model이 `entwurf_self`를 실제로 호출하지 않아
    `selfEnvelopeSessionIds=[]` (positive garden turn 자체는 PASS). 컷 차단 아님, 0.11.x usability lane.
- `./run.sh setup /tmp/pi-shell-acp-setup-scratch` PASS: install + pi-tools-bridge v2 install smoke green.
- thinkpad daily wiring 확인: `~/.pi/agent/settings.json` → `agent-config/pi/settings.json`, `packages[]`가
  `~/repos/gh/pi-shell-acp` 체크아웃(v2-only)을 직접 가리킴, MCP tools/list는 v2 4도구만 노출.
  Active tool descriptions/package metadata에서 v1 `entwurf_send`/ACP bridge 안내 제거.

해석: hejdev6의 RGG `/new` FAIL은 pi event drift가 아니라 stale/global topology artifact였음이 thinkpad repo-under-test 주입과
전체 LIVE MUST green으로 재확인됨.

## GPT 리뷰 반영 (2026-06-17, 이번 커밋)

- **RGG env 통일** (GPT 2): `smoke-resident-garden-guard.sh`가 이제 다른 live smoke와 동일하게
  `PI_SHELL_ACP_LIVE_TARGET="<provider>/<model>"`(기본 openai-codex/gpt-5.4)을 파싱. `SMOKE_RGG_*` override 유지.
- **drop 3 legacy 정직화** (GPT 4): `xt-tool-surface`/`session-messaging`/`sentinel` usage에 `[LEGACY — broken on
  v2-only]` 표기 + 실행 시 fail-loud warn. "on-demand 보존"이 아니라 "참조용 legacy, v2 rewrite 대기"로 명시.
- **topology 고정 + LIVE/설치 green(thinkpad)**: repo-under-test로 결정하고 resident spawn에 `--no-extensions -e $REPO` 주입.
  `LIVE=1 release-gate` MUST 6 green, scratch `setup` green.

## 다음 한 걸음

→ **노트북 이어받기 (우선순위 순):**
1. **CHANGELOG MUST-PASS 카운트** — 옛 "MUST PASS=17"은 삭제 이전 로그. 현재 floor=MUST 6. LIVE MUST green 기준으로 갱신.
2. **B = 배포 위생(D1)** — 별도 결정. 이번 gate는 deployment-smoke가 아니므로 전역 `pi-shell-acp`를 v2-only로 올릴지 여부는
   daily 운용 판단으로 분리.
3. **session-messaging / sentinel v2 재작성** — `entwurf_v2` surface 기준(drop이 아니라 재작성 결정 시).
4. **README / 라우팅 잔여(Phase B)**: README ACP 시대 재작성 / `scripts/resolve-acp-bridge.ts`(orphan 심화) /
   `getRegistryRouting` 하드코딩 `provider:"pi-shell-acp"` / `mcp/index.ts` description. rename과 묶어 절삭.
5. **stale 주석(doc-truth)**: `scripts/sentinel-runner.sh`(225/457), `check-model-lock.ts`(31-32),
   `smoke-entwurf-v2-matrix-live.ts`(29)가 삭제된 명령 호명. Phase B doc 패스.

## 넘으면 안 되는 선

- **rename 금지(이번 브랜치)**. 이름 바꾸다 깨지는 걸 피하려 v2 동작 먼저.
- `core.hooksPath` 불변. push/tag/publish = GLG. `--no-verify` 금지.
- 삭제는 브랜치라 안전(되돌림 가능)하되, 게이트 동반 삭제 안 하면 check red — 결합 규칙 준수.
- D1/D3는 잠겼지만 **적용은 해당 단계에서** (D1=rename단계, D3=install/doctor 수술 시).

## 참고

- **원형 레퍼런스**: `~/repos/3rd/agent-stuff/extensions/control.ts` (badlogic mitsupi) = 우리
  `entwurf-control.ts`의 원형. `updateSessionEnv`(960-970)가 **PI_SESSION_ID만 set, PI_AGENT_ID 없음**
  → env-set 정석 위치 확증 + PI_AGENT_ID가 pi-shell-acp 고유 확장임을 증명. `ctx.model.provider/id`
  접근도 `loop.ts:91-93`에서 동일 패턴(가드 포함). env seam 설계의 SSOT 참조.
- GPT(codex)와 동행 중. 같은 방향 합의: subtractive, 삭제 먼저 rename 나중.
- `~/repos/gh/entwurf`에 GPT가 깐 v2-only 셸(README/AGENTS/ROADMAP/check-boundaries)이 있음.
  rename/이주 단계(Phase B)에서 그 셸 문서를 destination으로 재활용 가능. 이번 브랜치는 안 건드림.
- 실측 기준선: v2 closure 33파일/11,400줄, rename 대상 `pi-shell-acp`류 89파일/1508곳
  (삭제 후 줄어든 숫자로 Phase B에서 단계적·게이트검증, 한 방 sed 금지).
