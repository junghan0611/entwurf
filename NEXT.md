# NEXT — entwurf post-0.12.2: mux-agnostic spawn surface + PR #40 cortex

> 나침반이지 DB가 아니다: **현재 위치 · 다음 한 걸음 · 넘으면 안 되는 선**만 둔다.
> 현재+미래 방향과 설계 SSOT = **`ROADMAP.md`**. 닫힌 변경 핵심 = **`CHANGELOG.md`**. 세션별 process history = git log.

## DONE — 0.12.2 released

- **0.12.2** tag `v0.12.2` (origin) + npm `@junghanacs/entwurf@0.12.2` publish 완료. 메타브리지 install 이식성 회귀 2건(구버전 claude closed-schema manifest / pnpm-store 해시 MCP 경로 stale) + 신규 `check-meta-manifest-schema.py` 게이트 포함.
- **0.12.1** tag + npm + GitHub release 완료. hejdev6(오라클) `pnpm add -g` 설치 검증(bins/dist/pi-free/`tools/list`) 통과.
- **PR #40 cortex 재안착 준비 (이번 세션):** `docs/acp-backend-rail.md`를 as-built 0.12 기준으로 검토·영어 재작성(commit `4e9bcb6`, push). PR #40에 영어 개발 가이드 댓글 게시 — 실 네임스페이스(`pi-extensions/lib/acp/`)·`cortexAdapter`+`ADAPTERS` 등록·`check-acp-*` 게이트로 안내.

## NOW

### ① (능동·오늘) mux-agnostic spawn/launch surface

네이티브 백엔드(claude code 등)는 인터랙티브 TTY가 필요 → headless 불가 → multiplexer가 launch surface가 된다. **단 tmux 전용 금지** — tmux는 무겁다. zmx 같은 가벼운 mux로 교체 가능해야 한다(driver 한 개 갈아끼우는 일이 되도록).

**코드 레벨 현황 (실측 2026-06-30):**
- transport는 이미 enum으로 추상화됨 — `entwurf-v2-contract.ts:186` `ENTWURF_V2_TRANSPORTS = ["control-socket","spawn-bg","tmux-live","meta-mailbox"]`. `tmux-live`는 하드코딩된 유일 경로가 아니라 enum 한 값.
- tmux 직접 호출(repo 전체 30 hit) 중 **프로덕션 launch 코드엔 0개.** 전부 `scripts/raw-async-delivery/repro-*.sh`(실험 재현)와 `check-*.ts` fixture(`tmuxTarget: "psa:3.1"` 테스트 데이터).
- → **실제 spawn launch는 프로덕션 미구현 = 빈칸.** 이 빈칸을 채울 때가 mux 추상화를 박을 적기. tmux로 직접 채우면 안 됨.

**할 일:**
1. repro 스크립트의 4개 동작(`new-session`/`send-keys`/`capture-pane`/`kill-session`)을 **mux driver 인터페이스**(`launch`/`send`/`capture`/`kill`)로 추상화해 프로덕션화. `tmuxDriver`·`zmxDriver`가 각각 구현. → ACP `backend-adapter` 패턴과 동형: driver 1개 = mux 1개 = siblings-not-workers 철학의 mux 레이어 반복.
2. **네이밍 중립화:** `tmuxTarget` → `muxTarget`/`paneTarget`. tmux 결속 필드명을 zmx가 상속하면 모순 + tripwire(target은 liveness hint지 정체성 아님) 위반.
3. enum은 `tmux-live`/`zmx-live` **공존**으로 충분. mux 종류를 별도 필드로 빼는 추상화는 지금 하지 말 것 — enum 나열 > 추상화 두께(thin semantics, fat verification).

### ② (수동·대기) PR #40 cortex 어댑터 재안착 — 공은 hvkiefer

- 우리 쪽 준비 끝: 레일 doc 정합(`docs/acp-backend-rail.md`) + PR 개발 가이드 댓글. 레일 green(claude 어댑터 + §9/§10, `check-acp-*` 통과).
- 공은 hvkiefer: 0.11.0 fat-bridge 삭제됐으니 rebase 아님 → `cortexAdapter` 1개 신규(`pi-extensions/lib/acp/backend-adapter.ts`) + `ADAPTERS` 등록 + curated cortex 모델 + `SNOWFLAKE_HOME` overlay + `check-acp-*` cortex 단언 + `smoke-acp-cortex-live`. 공통 turn loop 무수정.
- **미정 디테일 1건(가이드에 명시):** carrier 부재 백엔드(cortex)의 operator engraving이 first-user augment(`augment.ts`)에 합류하는 방식 — 현재 augment는 engraving을 안 실음. cortex PR이 그 경로를 정의해야 함.

## 다음 한 걸음

1. **mux driver 인터페이스 + `tmuxDriver` 먼저** (기존 repro 동작 보존 = 회귀 기준), `zmxDriver` 후속.
2. **agy(Antigravity) 서포트** — **spawn surface 통일 후** 그 위에 얹기. (아래 Follow-up 멀티하네스 항목에서 승격. 기반 먼저 안 서면 agy 넣다가 launch seam이 갈림.)
3. **hvkiefer cortex PR 갱신 대기** → 들어오면 `check-acp-*` 6종 + `smoke-acp-cortex-live` 기준 리뷰. 공통층 무수정 불변식 확인.
4. **0.12.2 floor 검증 (post-release, 미완):** hejdev6 clean reinstall(`pnpm add -g @junghanacs/entwurf@0.12.2` → `entwurf install-meta-bridge` → `doctor-meta-bridge`)로 floor 호스트 end-to-end 확정.

## Follow-up (이번 컷 blocker 아님 — GPT 합의 설계)

- **C2** `check-pack-install` 확장: fake `claude` CLI + temp `HOME`/`CLAUDE_CONFIG_DIR`로 installed `node_modules/.bin/entwurf install-meta-bridge` 실행 → `~/.claude.json` command가 해시 store 경로 아니라 안정적 `entwurf-bridge`인지 검증. (지금은 정적 desired_mcp 단언으로만 커버 — 실제 install wiring은 아직 게이트 밖.)
- **C3** support-floor: 실제 최저버전(2.1.97 오라클) validate/install/doctor를 0.12.2 컷 체크리스트 또는 별도 remote gate로. thinkpad 단독 검증은 거짓 안심 → 정직성 가드.
- **멀티하네스(Codex/Antigravity)**: claude marketplace 일반화 금지. 하네스별 adapter contract(manifest shape, MCP 등록면, version floor, doctor evidence). 공통화는 runner/reporting만.
- `smoke-acp-skill-live` "secret probe code" → "probe code/project marker" 낮추기 (injection-refusal 취약 선제 cleanup, GPT 제안 — 0.12.1부터 이월).

## 넘으면 안 되는 선

- Work on `main`; 이 레인용 브랜치 만들지 않음.
- **mux launch는 driver 인터페이스 뒤에서만** — 프로덕션 코드에 `tmux` 직접 호출 금지(repro 스크립트는 예외). tmux 전용 가정을 새로 심지 말 것.
- `core.hooksPath` 안 건드림. `--no-verify` 금지.
- GLG 명시 승인 + green preflight 없이 publish/tag/push 금지.
- live release gate 요청 시 scratch cwd + `LIVE=1`.

## 참조

- 설계 SSOT: `ROADMAP.md` · 닫힌 변경: `CHANGELOG.md`
- 검증 calibration: `VERIFY.md`, `BASELINE.md`, `DELIVERY.md`
- repo baseline: `AGENTS.md` · ACP 레일: `docs/acp-backend-rail.md`
- clean-host 설치: `docs/setup-clean-host.md`
