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
- 다음 한 걸음 = step② dead code 정리 → **step③ v1 가드 삭제**(+`check-entwurf-v2-only` 게이트) →
  step④ `pnpm install` → step⑤ env seam 3줄 → step⑥ green.

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
3. [ ] **v1 가드 삭제** — `entwurf-v2-only.ts` / `entwurf-v2-resume-marker.ts` + 호출처
   (`entwurf-control.ts`, `mcp/pi-tools-bridge/src/index.ts`의 `checkV1EntwurfAllowed`/`isV2OnlyMode`/
   `isV2ResumeResidentAuthorized`).
4. [ ] **env sender seam 수술 (재평가: 본질 난제 아님)** — `PI_SESSION_ID`는 이미 pi-native
   (`updateSessionEnv` entwurf-control.ts:1162, badlogic 원형 `control.ts:970`과 동일). 끊기는 건
   `PI_AGENT_ID` 하나. caller-side(`buildLocalSenderEnvelope` :527)는 `${ctx.model.provider}/${ctx.model.id}`
   fallback을 이미 가져 **무변경 동작**. MCP child(별도 프로세스, env만 읽음)만 메우면 됨 →
   `updateSessionEnv`에 `process.env.PI_AGENT_ID = ${ctx.model.provider}/${ctx.model.id}` 3줄 추가
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
3. **v1 가드 삭제** (step 3): `entwurf-v2-only.ts` + `entwurf-v2-resume-marker.ts` + 호출처
   (`entwurf-control.ts`, `mcp/pi-tools-bridge/src/index.ts`) + `check-entwurf-v2-only` 게이트.
   v1 분기는 지우고 v2 경로만 남긴다.
4. **lockfile 재생성**: `pnpm install` (ACP deps 3개 빠졌으니). 그 후 `pnpm check` 돌려 남은 RED 확인.
5. **env sender seam (step 4 — 재평가 끝, 기계적)**: `updateSessionEnv`에 PI_AGENT_ID set 3줄
   (위 작업순서 step4 참조). caller-side는 `ctx.model` fallback으로 이미 동작 → MCP child 상속만 메움.
   PI_SESSION_ID와 동형이라 추측 아님. agent id 포맷 변화는 GLG OK 방향(2026-06-16). 마무리 LIVE 1회.
   - **별개 잔여(라우팅, env seam 아님)**: `getRegistryRouting`(`entwurf-core.ts:991,1089`)의 하드코딩
     `provider: "pi-shell-acp"` + `scripts/resolve-acp-bridge.ts` + `smoke-installed-entwurf-acp` =
     패키지/확장 resolve 경로. v2-only 확장 entry는 `entwurf-control.ts`(index.ts 아님). 이건 rename(Phase B)
     직전 또는 green 배선(step6)에서 다룬다. 여기서 추측 구현 금지.
6. **green**: `pnpm check` 전체 통과 → `--no-verify` 없는 정상 커밋.

### 손대지 말 것
- **rename 금지** (pi-shell-acp→entwurf, piShellAcpProvider→entwurf): 이 브랜치 범위 밖 = Phase B.
  D1(새 `entwurf` 키)/D3(공존+single-writer guard, takeover 금지)는 잠겼지만 **적용은 Phase B/설치 수술 때**.
- `~/repos/gh/entwurf` 셸은 안 건드림 (Phase B destination).

## 다음 한 걸음

→ **2-tail step 1부터**: openclaw DROP → run.sh/check 체인 트림 → v1 가드 삭제 →
   `pnpm install` → `pnpm check` RED 목록 확인 → env seam에서 GLG 합의.

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
