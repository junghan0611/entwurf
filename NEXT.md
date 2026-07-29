# NEXT — 0.13.0 cortex 랜딩 완료: LIVE 증거 확인 후 릴리즈 컷 판단

> NEXT는 부트 섹터다. 다음 세션은 이슈/과거 가설이 아니라 **현재 main·현재 게이트·§11-8**을 먼저 본다.

## NOW — cortex 어댑터 랜딩 (2026-07-29, GPT 계약 → 페블 구현)

**계약 출처:** GPT(`openai-codex/gpt-5.6-sol`)가 CP0 evidence(오푸스 측정, D1~D10) 위에서 합의한
8항목 계약을 GLG가 전달. 문서 SSOT는 `docs/acp-backend-rail.md` **§11-8** (D1~D10 + A~F 판정).

- **이식:** hvkiefer의 PR #40 커밋 `3dd6f5f`를 cherry-pick으로 저작성 보존 이식(충돌 6파일은
  main 기준 해소), 그 위에 CP0 계약 수선 커밋을 쌓았다. CHANGELOG 크레딧 유지.
- **수선 축 (전부 §11-8 D-번호에 핀):**
  - dual-HOME overlay (D2/D10) — 세션 스코프 격리 HOME + `.snowflake`, entwurf-bridge 항목에만
    real HOME 복원. `pi-extensions/lib/acp/overlay.ts`.
  - mcp.json 투영 (D9) — cortex `newSession`은 wire `mcpServers`를 무시하므로 envelope-enriched
    명시 서버를 overlay-private `cortex/mcp.json`으로 exact-author. non-stdio는 spawn 전 fail-loud.
  - `CORTEX_HOME` presence 거부 (D3, 빈 문자열 포함) / `autoUpdate:false` (D4) /
    최소 인증 passthrough = connections.toml + config.toml(optional) + credential_cache (D5/F).
  - 모델 강제 = per-turn `setSessionConfigOption("model", native)` — launch `-m` 폐기 (E/CP0-M).
  - 큐레이션 4행 (D7): `cortex-auto` / `cortex-claude-opus-5` / `cortex-claude-sonnet-5` /
    `cortex-openai-gpt-5.4`.
- **게이트:** `check-acp-cortex` (pnpm check 內) + mutant lane `acp-cortex` 9 claims — 전부 KILLED.
  CP2 LIVE = `LIVE=1 ENTWURF_ACP_CORTEX_CONNECTION=<conn> ./run.sh smoke-acp-cortex-live`
  (outbound entwurf_v2 + overlay 디스크 사실 + process-group 회수). claude 릴리즈 플로어 밖.
- **LIVE 결과 (이 세션):** **PASS 23/23** (2026-07-29, thinkpad, connection XD75151, model
  `entwurf/cortex-claude-sonnet-5`): resident가 V3 record citizen으로 탄생 → dual-HOME overlay 디스크
  사실(autoUpdate:false, mcp.json 투영, bridge HOME 복원, envelope 2종) → 모델이
  `mcp__entwurf-bridge__entwurf_v2`로 nonce를 peer mailbox에 정확히 1건 배달(sender gid는 프롬프트에
  없었고 envelope로만 도달, `from: entwurf/cortex-claude-sonnet-5` anchored) → teardown 후 overlay 內
  프로세스 잔존 0. CP0 owed ①(outbound v2 실송신) 종결.
- **부수 수선:** `check-probe-cli-shim` 섹션3 same-ms tie 플레이크 봉합 — STREAM_CLI per-turn
  응답에 5ms 지연(측정: anchor==receivedAtMs tie가 run의 ~10%에서 임의 claim을 WRONG-REASON으로
  오염). 계측기(shim)는 무접촉, 게이트 픽스처만 수정. probe lane 재검수 시 참고.

## 다음 한 걸음

1. **GLG: 커밋 검토 + push 결정.** 커밋 2개(이식 `f4b20bb` hvkiefer / 수선+문서+게이트)가 로컬에
   있다. push는 GLG 지시로만.
2. push 후 0.13.0 릴리즈 컷 여부 판단 (tag-release 스킬; CHANGELOG Unreleased가 이미 정리돼 있다).
3. GPT 코디네이터에 랜딩 보고 — §11-8과 LIVE 결과를 가리키면 된다.

## owed (랜딩이 주장하지 않는 것 — §11-8에 기록됨)

- project hook이 실재하는 리포에서의 cwd project hook 발화 (계약상 project scope는 허용).
- `_meta` caller-session-id seam의 의미 (측정됐으나 미탐색 — 계약 승격 안 함).
- 인증 유무 `configOptions` `[mode]`↔`[model]` 분기 원인.
- **rail-level readiness fence (§11-3/§11-7)** — cortex도 mcp.json 문 기준으로 race를 상속함이
  hand-client 강도로 측정됨. 이 랜딩은 그 질문을 닫지 않는다. #55/probe lane이 소유.

## 금지/주의

- `CORTEX_HOME`을 오퍼레이터 셸에 export하지 말 것 — cortex 턴이 전부 거부된다(설계).
- cortex 버전 핀 금지 (GLG: 유연하게). 동작 검증은 게이트가, 드리프트는 set-model fail-loud가 잡는다.
- probe-ordering/probe-cli-shim lane은 별도 축 — cortex 작업이 §11-7 결론을 인용하지 않게 유지.
