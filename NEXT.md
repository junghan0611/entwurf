# NEXT — entwurf 0.12.1 pi-decouple lane

> 나침반이지 DB가 아니다: **현재 위치 · 다음 한 걸음 · 넘으면 안 되는 선**만 둔다.
> 현재+미래 방향과 설계 SSOT = **`ROADMAP.md`**. 닫힌 변경 핵심 = **`CHANGELOG.md`**. 세션별 process history = git log.

## NOW — 0.12.0 published, 0.12.1 pi-decouple 착수

- `0.12.0` 배포 완료 (`@junghanacs/entwurf@0.12.0`, npm latest, 2026-06-29).
- **설치면 검증에서 결함 발견** (GLG 지시 + GPT 검수, 둘 다 독립 확인):
  - 명제: **entwurf = harness-중립 npm 패키지여야 한다. pi는 4번째 하네스 lane일 뿐.** "pi install"이 아니라 "npm 설치"에서 끝나야 함. pi-package 정체성은 강등돼도 좋다 (rename의 이유).
  - 결함: 메타브릿지(`mcp/entwurf-bridge`)가 **pi 없이 boot 못 함** — transitive value-import로 pi가 박혀 있음:
    - **pi-ai**: `bridge index → fact-provider → entwurf-v2-contract.ts:44` (`StringEnum,Type` from `@earendil-works/pi-ai`, 모듈 top-level 358/368에서 즉시 실행)
    - **pi-coding-agent**: `bridge index → v2-surface:25 → v2-production:42` (`preflight` value import) `→ entwurf-preflight.ts:46-51` (`ProjectTrustStore` 등)
  - 현재 게이트가 못 잡은 이유: devDeps/peers가 깔린 상태로만 돌아서.
- 추가 발견: pi `>=0.80.2` floor 미달 시(예: hejdev6 0.79.8) 설치는 성공하나 **provider 무음 미등록**. README Install엔 floor 안내 없음(clean-host 문서에만).
- 설계 잠금 완료 (Opus + GPT `…e06002` 수렴). cut 순서 A→B→C→D 확정.

## 다음 한 걸음 — 0.12.1 구현 (main 직접, A→B→C→D)

**A. 게이트 먼저 (회귀 가드, RED 상태로)**
- `scripts/check-entwurf-bridge-pi-free.ts` 신규:
  - static: `mcp/entwurf-bridge/src/index.ts`의 **eager static value-import closure**에 `@earendil-works/*` 0개 (`import type` + dynamic `await import` 제외)
  - runtime smoke: pi peers 없는 tmp에 tarball install → `entwurf-bridge`가 MCP `tools/list`까지 boot (최종 권위)
- `run.sh` verb 등록 + `check` 파이프라인 + release-gate 편입

**B. 코드 분리 (boot path에서 pi 제거)**
- `pi-extensions/lib/entwurf-v2-contract.ts` → **pi-free core로 정화** (pi-ai import 제거; 상수/`isLivenessSupported`/dispatch/receipt types 유지)
- `pi-extensions/lib/entwurf-v2-contract-schema.ts` **신규** → `StringEnum,Type` + `EntwurfV2InputSchema`/`Receipt*Schema`만; "MCP bridge must not import this" 주석
- `pi-extensions/lib/entwurf-v2-decider.ts` → `preflightForCwd: MaybePromise<PreflightOutcome>`, resume 분기 `await` 1회
- `pi-extensions/lib/entwurf-v2-production.ts` → `preflight` eager import 제거 → `lazyProductionPreflight` (`await import("./entwurf-preflight.ts")`); factory는 **sync 유지**, `ProductionEntwurfV2Seams.preflight`도 MaybePromise
- `scripts/check-entwurf-v2-contract.ts` → 스키마 import를 새 파일로
- (선택, 더 깨끗한 경계) `entwurf-preflight-types.ts` 분리 — GPT는 게이트가 `import type` 제외하면 1안으로 충분하다고 봄

**C. packaging (npm-primary)**
- `package.json`: `bin: { "entwurf-bridge": "mcp/entwurf-bridge/start.sh" }` (= 主 진입점), `peerDependenciesMeta`로 pi peers + typebox optional, keywords 재정렬(`mcp`/`meta-bridge`/`entwurf` 앞, `pi-*` 뒤)
- `check-pack-install`에 **neutral npm install smoke** 추가 (pi peers 없이 install → bin/`npx --package @junghanacs/entwurf entwurf-bridge` → `tools/list`). 기존 pi loader smoke는 pi lane으로 유지
- typebox 실제 제거는 별도 cleanup

**D. README + docs**
- Install 헤드라인을 **npm/npx + `claude mcp add ... npx --package @junghanacs/entwurf entwurf-bridge`**로. `pi install`은 하위 "pi / ACP plugin lane" 섹션으로 강등. pi >=0.80.2 floor + 무음실패 경고 명시
- Concept primer에 **garden-id 문단** 추가 (GPT 초안 채택)

**검증 순서:** A(RED) → B → A 그린 → `pnpm check` → C → `check-pack-install`(+neutral smoke) → D.

## 별개 deliverable — hvkiefer / PR #40 답변 (commit과 분리)

- 0.12.1 lane 분리가 그 답변을 선명하게 함: **Cortex = ACP backend 기여 → pi/ACP-plugin lane** (`pi install` + pi floor 맞음). neutral 메타브릿지 lane은 분리 중.
- 영어 초안은 Opus+GPT 합의본 존재 (lane 구분 한 줄 추가 예정). **외부 기여자 대상이라 GLG 승인 후 포스팅.** 이슈 #44는 안 건드림(GLG 마인드셋 노트).

## post-0.12 follow-ups

- v2-native demo/GIF retake (현재 demo scripts는 v1 흐름).
- bundled-MCP deterministic split (`smoke-acp-bundled-mcp-live` MUST/BEHAVIOR 분리).
- fresh sibling minting (`spawn-fresh` lane), persisted ACP resume/load.

## 넘으면 안 되는 선

- `core.hooksPath` 건드리지 않음. `--no-verify` 금지.
- push / tag / npm publish / old package deprecate는 GLG 결정·실행 전용. agent는 working tree + commit까지.
- 외부 기여자(PR #40) 답변 포스팅은 GLG 승인 후.
- 실패한 게이트를 기준 낮춰 통과시키지 않는다. retier 필요 시 deterministic replacement를 같이 만든다.
- 0.12.1 핵심 불변식: bridge boot는 pi 없이 떠야 한다. owned-outcome spawn-bg resume만 pi 필요(정직한 runtime error 허용).

## 참조

- 설계 SSOT: `ROADMAP.md` / 닫힌 변경: `CHANGELOG.md`
- 검증 calibration: `VERIFY.md`, `BASELINE.md`, `DELIVERY.md`
- repo baseline: `AGENTS.md` / ACP 레일: `docs/acp-backend-rail.md`
