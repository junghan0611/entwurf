# NEXT — entwurf post-0.12.2: mux-agnostic spawn surface + PR #40 cortex

> 나침반이지 DB가 아니다: **현재 위치 · 다음 한 걸음 · 넘으면 안 되는 선**만 둔다.
> 현재+미래 방향과 설계 SSOT = **`ROADMAP.md`**. 닫힌 변경 핵심 = **`CHANGELOG.md`**. 세션별 process history = git log.

## DONE — 0.12.2 released

- **0.12.2** tag `v0.12.2` (origin) + npm `@junghanacs/entwurf@0.12.2` publish 완료. 메타브리지 install 이식성 회귀 2건(구버전 claude closed-schema manifest / pnpm-store 해시 MCP 경로 stale) + 신규 `check-meta-manifest-schema.py` 게이트 포함.
- **0.12.1** tag + npm + GitHub release 완료. hejdev6(오라클) `pnpm add -g` 설치 검증(bins/dist/pi-free/`tools/list`) 통과.
- **PR #40 cortex 재안착 준비 (이번 세션):** `docs/acp-backend-rail.md`를 as-built 0.12 기준으로 검토·영어 재작성(commit `4e9bcb6`, push). PR #40에 영어 개발 가이드 댓글 게시 — 실 네임스페이스(`pi-extensions/lib/acp/`)·`cortexAdapter`+`ADAPTERS` 등록·`check-acp-*` 게이트로 안내.

## NOW

### ⓪ GLG 결정 — fresh spawn도 mux-visible로 통일

**검토 결론(2026-06-30):** v2에 spawn이 "없는" 것은 아님. `entwurf_v2 owned-outcome`은 **기존 dormant pi citizen**을 `spawn-bg resume`으로 깨우는 production path가 있고, `smoke-entwurf-v2-spawn-resume-live`가 실 `pi --entwurf-control` child + model turn을 검증한다. 빠진 것은 v1 `entwurf`가 하던 **무에서 새 sibling을 만드는 fresh spawn/mint**다.

**GLG 의도(오늘 정렬):** fresh launch를 **mux-visible surface로 먼저 통일**한다. pi-native GPT도 일단 bg/detached `pi -p`로 숨기지 않는다. 투명하게 pane/session으로 보이고, 같은 launch 관문을 통과해야 한다. 나중에 필요하면 pi만 headless/bg 최적화 레인을 추가할 수 있지만, 지금은 pi를 "4번째 하네스"로 세우기 위해 Claude Code/Codex/Antigravity와 같은 mux launch 규율 위에 올린다.

- v1 본체: `pi-extensions/lib/entwurf-core.ts` `runEntwurfSync`(:1940, "spawn pi and collect result") = fresh-mint 본체 — registry gate `resolveEntwurfTarget`(미등록 provider/model reject) + session-id/name/cwd-enrich가 여기 산다. resume 경로는 같은 파일 `runEntwurfResumeSync`(:1772). launch arg shape SSOT는 `entwurf-resume-args.ts`(`--no-extensions`/`--entwurf-control` 결정처). 조립 형태 `[…ext] --mode … --no-extensions --session-id <new gid> --name … --provider <routing.provider> --model <m> <task>` — provider는 registry에서 동적으로 옴(`openai-codex` 하드코딩 아님; 게이트 기본 타깃만 `ENTWURF_LIVE_TARGET=openai-codex/gpt-5.4` env). 주: fresh-mint는 `--no-extensions` one-shot worker이지 `-p`/control 경로가 아니다.
- v2 현상: `entwurf_v2`는 target garden id 필수 + 기존 citizen 전용. `bad-target`은 절대 fresh spawn으로 변환하지 않는다. 즉 Claude Code에서 "새 GPT 불러줘"는 현재 표면상 불가능/우회 필요.
- 정렬: fresh-mint 복구는 **mux driver 위의 launch profile**로 다룬다. "pi는 tmux 없이 bg로 먼저"가 아니라, "모든 하네스를 mux로 투명하게 먼저"다.

### ① (능동·오늘) mux-agnostic spawn/launch surface

네이티브 백엔드(claude code 등)는 인터랙티브 TTY가 필요 → headless 불가 → multiplexer가 launch surface가 된다. **pi-native GPT도 이번 lane에서는 같은 mux-visible launch surface로 올린다.** tmux 전용 금지 — tmux는 무겁다. zmx 같은 가벼운 mux로 교체 가능해야 한다(driver 한 개 갈아끼우는 일이 되도록).

**코드 레벨 현황 (실측 2026-06-30):**
- transport는 이미 enum으로 추상화됨 — `entwurf-v2-contract.ts:186` `ENTWURF_V2_TRANSPORTS = ["control-socket","spawn-bg","tmux-live","meta-mailbox"]`. `tmux-live`는 하드코딩된 유일 경로가 아니라 enum 한 값.
- tmux 직접 호출(repo 전체 30 hit) 중 **프로덕션 launch 코드엔 0개.** 전부 `scripts/raw-async-delivery/repro-*.sh`(실험 재현)와 `check-*.ts` fixture(`tmuxTarget: "psa:3.1"` 테스트 데이터).
- → **실제 spawn launch는 프로덕션 미구현 = 빈칸.** 이 빈칸을 채울 때가 mux 추상화를 박을 적기. tmux로 직접 채우면 안 됨.

**할 일:**
1. repro 스크립트의 4개 동작(`new-session`/`send-keys`/`capture-pane`/`kill-session`)을 **mux driver 인터페이스**(`launch`/`send`/`capture`/`kill`)로 추상화해 프로덕션화. `tmuxDriver`·`zmxDriver`가 각각 구현. → ACP `backend-adapter` 패턴과 동형: driver 1개 = mux 1개 = siblings-not-workers 철학의 mux 레이어 반복.
2. **zmx를 1급/가벼운 선택지로 본다.** tmux는 현재 repro/검증 기준으로 먼저 손에 잡는 driver일 뿐, 프로덕션 구조의 중심·필수 의존성이 아니다. package/runtime에서 tmux-only 전제를 만들지 말고, driver 선택 실패는 해당 driver 실패로만 표면화한다.
3. **네이밍 중립화:** `tmuxTarget` → `muxTarget`/`paneTarget`. tmux 결속 필드명을 zmx가 상속하면 모순 + tripwire(target은 liveness hint지 정체성 아님) 위반.
4. enum은 `tmux-live`/`zmx-live` **공존**으로 충분. mux 종류를 별도 필드로 빼는 추상화는 지금 하지 말 것 — enum 나열 > 추상화 두께(thin semantics, fat verification).
5. fresh-mint는 driver 위의 **launch profile**로 추가한다: `pi-native-gpt`(pi as 4th harness), `claude-code`, `codex`, `agy` 등이 같은 mux launch/observe/capture/kill 규율을 탄다. pi 전용 headless/bg 최적화는 후속 옵션이지 오늘의 기본값이 아니다.
6. v2 citizen identity: fresh spawn은 gid/sessionId를 먼저 정하고 필요한 경우 `backend=pi` meta identity를 남긴다(이후 dormant resume가 `bad-target`이 아니라 기존 citizen으로 보이게). 단, launch 관문은 mux-visible profile이 우선이다.

### ② (수동·대기) PR #40 cortex 어댑터 재안착 — 공은 hvkiefer

- 우리 쪽 준비 끝: 레일 doc 정합(`docs/acp-backend-rail.md`) + PR 개발 가이드 댓글. 레일 green(claude 어댑터 + §9/§10, `check-acp-*` 통과).
- 공은 hvkiefer: 0.11.0 fat-bridge 삭제됐으니 rebase 아님 → `cortexAdapter` 1개 신규(`pi-extensions/lib/acp/backend-adapter.ts`) + `ADAPTERS` 등록 + curated cortex 모델 + `SNOWFLAKE_HOME` overlay + `check-acp-*` cortex 단언 + `smoke-acp-cortex-live`. 공통 turn loop 무수정.
- **미정 디테일 1건(가이드에 명시):** carrier 부재 백엔드(cortex)의 operator engraving이 first-user augment(`augment.ts`)에 합류하는 방식 — 현재 augment는 engraving을 안 실음. cortex PR이 그 경로를 정의해야 함.

## 다음 한 걸음

1. **mux driver 인터페이스 먼저** — tmux/zmx 공통 contract를 먼저 박고, 기존 repro 동작 보존용 `tmuxDriver`와 가벼운 선택지 `zmxDriver`를 같은 급으로 붙인다. 오늘의 중심은 launch surface 통일이지 tmux 의존성 도입이 아니다.
2. **fresh pi-native GPT spawn-fresh는 mux profile로 얹기** — v1 `runEntwurfSync`(`entwurf-core.ts:1940`) + `resolveEntwurfTarget` registry / session-id / name / cwd-enrich 자산은 재사용하되, `--no-extensions` one-shot detached 복구가 아니라 mux-visible `pi-native-gpt` launch profile로 설계한다.
3. **agy(Antigravity) 서포트** — **spawn surface 통일 후** 그 위에 얹기. (아래 Follow-up 멀티하네스 항목에서 승격. 기반 먼저 안 서면 agy 넣다가 launch seam이 갈림.)
4. **hvkiefer cortex PR 갱신 대기** → 들어오면 `check-acp-*` 6종 + `smoke-acp-cortex-live` 기준 리뷰. 공통층 무수정 불변식 확인.
5. **0.12.2 floor 검증 (post-release, 미완):** hejdev6 clean reinstall(`pnpm add -g @junghanacs/entwurf@0.12.2` → `entwurf install-meta-bridge` → `doctor-meta-bridge`)로 floor 호스트 end-to-end 확정.

## Follow-up (이번 컷 blocker 아님 — GPT 합의 설계)

- **C2** `check-pack-install` 확장: fake `claude` CLI + temp `HOME`/`CLAUDE_CONFIG_DIR`로 installed `node_modules/.bin/entwurf install-meta-bridge` 실행 → `~/.claude.json` command가 해시 store 경로 아니라 안정적 `entwurf-bridge`인지 검증. (지금은 정적 desired_mcp 단언으로만 커버 — 실제 install wiring은 아직 게이트 밖.)
- **C3** support-floor: 실제 최저버전(2.1.97 오라클) validate/install/doctor를 0.12.2 컷 체크리스트 또는 별도 remote gate로. thinkpad 단독 검증은 거짓 안심 → 정직성 가드.
- **멀티하네스(Codex/Antigravity)**: claude marketplace 일반화 금지. 하네스별 adapter contract(manifest shape, MCP 등록면, version floor, doctor evidence). 공통화는 runner/reporting만.
- `smoke-acp-skill-live` "secret probe code" → "probe code/project marker" 낮추기 (injection-refusal 취약 선제 cleanup, GPT 제안 — 0.12.1부터 이월).

## 넘으면 안 되는 선

- Work on `main`; 이 레인용 브랜치 만들지 않음.
- **mux launch는 driver 인터페이스 뒤에서만** — 프로덕션 코드에 `tmux` 직접 호출 금지(repro 스크립트는 예외). tmux 전용 가정/타입/필드명을 새로 심지 말 것. zmx는 후순위 장식이 아니라 가벼운 1급 driver 후보.
- **fresh pi-native GPT도 먼저 mux-visible** — v1식 detached/bg `pi -p` 복구를 기본값으로 되살리지 않는다. pi는 4번째 하네스이므로 같은 launch surface에서 투명하게 보이게 한다. headless/bg pi 최적화는 GLG가 나중에 명시할 때 별도 레인.
- `core.hooksPath` 안 건드림. `--no-verify` 금지.
- GLG 명시 승인 + green preflight 없이 publish/tag/push 금지.
- live release gate 요청 시 scratch cwd + `LIVE=1`.

## 참조

- 설계 SSOT: `ROADMAP.md` · 닫힌 변경: `CHANGELOG.md`
- 검증 calibration: `VERIFY.md`, `BASELINE.md`, `DELIVERY.md`
- repo baseline: `AGENTS.md` · ACP 레일: `docs/acp-backend-rail.md`
- clean-host 설치: `docs/setup-clean-host.md`
