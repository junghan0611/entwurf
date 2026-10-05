# NEXT — Pi1.0.2 안착·재개 완료 · durable branch로 이동

# RAIL — 현재 좌표

- [x] **1. Source 통합** — Pi1.0.2 floor/pins `011f705` local main ff 통합, push0; published0.30.1 불변.
- [x] **2. Operator 안착** — global/local quartet1.0.2, private RPC/compiled-MCP startup accepted, 모델 tokens/cost0, 보호 hash MATCH.
- [x] **3. Coordinator 재개** — GLG가 resume를 보고했고 self에서 같은 garden id/liveness를 확인했다. CLI1.0.2 설치 버전도 확인.
- [ ] **4. Durable native support** ← CURRENT: `feat/durable-native-support`의 branch handoff를 따른다. 목표 릴리즈0.31.0.

# NOW

- **Next/read:** [NEXT--feat_durable-native-support.md](NEXT--feat_durable-native-support.md), [지원 방향](docs/durable-native-support.md), issue #129 live thread. 구현·자문·검증의 상세 좌표는 branch NEXT만 소유한다.
- **Coordinator:** `20261003T164401-a30dda`, `openai-codex/gpt-6.1-sol`; native session=`01a100b8-4d08-7247-98b3-efb293657eff`. 모델 변경 없이 같은 대화로 복귀했다(사용자 보고 + 같은 self envelope).
- **Local/published:** local main/base=`011f705642788615224d8c5de5f6c0d664f56742`; origin/main/tag/npm0.30.1=`6932a01`. Commit/push/prepare/make/publish는 각 명시 승인 경계 유지. 0.31.0은 목표이지 지금 version/tag/publish 실행 요청이 아니다.
- **Guardrails:** 다른 리포/운영 config/auth/기존 record·transcript·Emacs 보존. Global Herdr0.9.1 변경0. Historical release/floor runner를 복귀만을 위해 반복하지 않는다.

# RECENT

- `~/tmp/entwurf-pi102-upstream/operator-upgrade/{install-accepted,startup-accepted}.json` — bg11/bg13 rc0, 6 exposed+2 hidden compiled bridge tools. 실제 ordinary CLI sandbox startup이지 durable integration/native LIVE/release 증거는 아니다.
- Source floor: local qualification842/842/full645s accepted; `candidate-accepted.json`, `frozen-floor-r3/`, `frozen-full-r4/`. Exact committed-SHA CI/native-LIVE 아님.
- 기존 연구 Opus/퇴근 worktree Opus는 구현에 재할당하지 않는다. Source 인계는 `~/tmp/entwurf-pi102-durable/research-to-new-lane.md`. Codemode P1/P2 제품 제안 철회.
- 이 기록 커밋은 NEXT/ROADMAP/branch NEXT/방향 문서만 포함한다. pi-durable 제품 변경은 미커밋·admission 미완료이며, 별도 하네스의 좁은 접점만 만든다. Historical main NEXT는 `landing/main-NEXT-before-handoff.md` 보존. Prior release archive=`~/archives/entwurf/20261005T012218-v0.30.1/`; agy1.2 NOT CERTIFIED/#128·Herdr npm carrier 재핀은 별도 범위다.
