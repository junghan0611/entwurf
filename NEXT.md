# NEXT — entwurf post-0.12.2: PR #40 cortex 재안착 + floor 검증

> 나침반이지 DB가 아니다: **현재 위치 · 다음 한 걸음 · 넘으면 안 되는 선**만 둔다.
> 현재+미래 방향과 설계 SSOT = **`ROADMAP.md`**. 닫힌 변경 핵심 = **`CHANGELOG.md`**. 세션별 process history = git log.

## DONE — 0.12.2 released

- **0.12.2** tag `v0.12.2` (origin) + npm `@junghanacs/entwurf@0.12.2` publish 완료. 메타브리지 install 이식성 회귀 2건(구버전 claude closed-schema manifest / pnpm-store 해시 MCP 경로 stale) + 신규 `check-meta-manifest-schema.py` 게이트 포함.
- **0.12.1** tag + npm + GitHub release 완료. hejdev6(오라클) `pnpm add -g` 설치 검증(bins/dist/pi-free/`tools/list`) 통과.
- **PR #40 cortex 재안착 준비 (이번 세션):** `docs/acp-backend-rail.md`를 as-built 0.12 기준으로 검토·영어 재작성(commit `4e9bcb6`, push). PR #40에 영어 개발 가이드 댓글 게시 — 실 네임스페이스(`pi-extensions/lib/acp/`)·`cortexAdapter`+`ADAPTERS` 등록·`check-acp-*` 게이트로 안내.

## NOW — PR #40 cortex 어댑터 재안착 (hvkiefer 개발 대기)

0.12.2 릴리즈는 기본 마무리. 활성 레인 = PR #40을 0.12 레일 위로 다시 받아내기.

- 우리 쪽 준비 끝: 레일 doc 정합 + PR 개발 가이드 댓글. 레일은 이미 green(claude 어댑터 + §9/§10 구현, `check-acp-*` 통과).
- 공은 hvkiefer에게: 0.11.0 fat-bridge가 삭제됐으니 rebase 아님 → `cortexAdapter` 1개 신규(`pi-extensions/lib/acp/backend-adapter.ts`) + `ADAPTERS` 등록 + curated cortex 모델 + `SNOWFLAKE_HOME` overlay + `check-acp-*` cortex 단언 + `smoke-acp-cortex-live`. 공통 turn loop 무수정.
- **미정 디테일 1건(가이드에 명시):** carrier 부재 백엔드(cortex)의 operator engraving이 first-user augment(`augment.ts`)에 합류하는 방식 — 현재 augment는 engraving을 안 실음. cortex PR이 그 경로를 정의해야 함.

## 다음 한 걸음

1. **hvkiefer cortex 어댑터 PR 갱신 대기** → 들어오면 `check-acp-provider-surface`/`-config`/`-overlay`/`-tool-surface`/`-session-reuse`/`-carrier-augment` + `smoke-acp-cortex-live` 기준 리뷰. 공통층 무수정 불변식 확인.
2. **0.12.2 floor 검증 (post-release, 미완):** hejdev6 clean reinstall(`pnpm add -g @junghanacs/entwurf@0.12.2` → `entwurf install-meta-bridge` → `doctor-meta-bridge`)로 floor 호스트 end-to-end 확정.

## Follow-up (이번 컷 blocker 아님 — GPT 합의 설계)

- **C2** `check-pack-install` 확장: fake `claude` CLI + temp `HOME`/`CLAUDE_CONFIG_DIR`로 installed `node_modules/.bin/entwurf install-meta-bridge` 실행 → `~/.claude.json` command가 해시 store 경로 아니라 안정적 `entwurf-bridge`인지 검증. (지금은 정적 desired_mcp 단언으로만 커버 — 실제 install wiring은 아직 게이트 밖.)
- **C3** support-floor: 실제 최저버전(2.1.97 오라클) validate/install/doctor를 0.12.2 컷 체크리스트 또는 별도 remote gate로. thinkpad 단독 검증은 거짓 안심 → 정직성 가드.
- **멀티하네스(Codex/Antigravity)**: claude marketplace 일반화 금지. 하네스별 adapter contract(manifest shape, MCP 등록면, version floor, doctor evidence). 공통화는 runner/reporting만.
- `smoke-acp-skill-live` "secret probe code" → "probe code/project marker" 낮추기 (injection-refusal 취약 선제 cleanup, GPT 제안 — 0.12.1부터 이월).

## 넘으면 안 되는 선

- Work on `main`; 이 레인용 브랜치 만들지 않음.
- `core.hooksPath` 안 건드림. `--no-verify` 금지.
- GLG 명시 승인 + green preflight 없이 publish/tag/push 금지.
- live release gate 요청 시 scratch cwd + `LIVE=1`.

## 참조

- 설계 SSOT: `ROADMAP.md` · 닫힌 변경: `CHANGELOG.md`
- 검증 calibration: `VERIFY.md`, `BASELINE.md`, `DELIVERY.md`
- repo baseline: `AGENTS.md` · ACP 레일: `docs/acp-backend-rail.md`
- clean-host 설치: `docs/setup-clean-host.md`
