# NEXT — cortex 랜딩 로컬 완결: 다음 세션은 fresh replicant 검수 + installed-consumer acceptance (release 아님)

> NEXT는 부트 섹터다. 상세 근거는 `docs/acp-backend-rail.md` §11-8과 `VERIFY.md`가 SSOT — 여기 다시 쓰지 않는다.

## Current

- **로컬 커밋 3개, push 금지 유지 (GLG/GPT 지시).** origin/main(`f1ead4b`) 대비 ahead:
  1. `f4b20bb` — hvkiefer PR #40 이식 (저작성 보존)
  2. `f18ecfe` — CP0 계약 수선 (dual-HOME/D9 투영/D3/D4/D5/E/4행 큐레이션 + 게이트/뮤턴트/스모크/문서)
  3. `<이번 커밋>` — GPT P0 리뷰 수선: ⑴ overlay scope가 backend의 authoritative
     `resolveSessionKey`(opts.sessionId 우선)를 명시 carrier로 받도록 배선(P0-1; adapter의 ambient
     재유도 제거, `AcpOverlayParams.sessionKey`), ⑵ repo-wide stale prose 스윕(README/DELIVERY/rail
     §11-3 실측 강도 교체/run.sh 게이트 코멘트/carrier-less → system-prompt-carrier-less).
- **검증 상태:** mutant lane `acp-cortex` 11 claims (신규: `CORTEX-OVERLAY-KEY-IS-SESSION-KEY`,
  `ACP-OVERLAY-SESSIONKEY-WIRED`), 전체 suite 110/110 목표 — 마지막 커밋의 훅 체인 통과 로그가 증거.
- **CP2 LIVE PASS 23/23** (2026-07-29, thinkpad, conn XD75151, `entwurf/cortex-claude-sonnet-5`):
  outbound `entwurf_v2` envelope 배달 + overlay 디스크 사실 + process-group 회수. P0-1 수선은 scope
  key의 출처만 바꾸며(값은 그 LIVE 조건에서 동일) runtime overlay semantics 불변 → 재실행 불요 판정.

## Next session first move — fresh replicant review + installed-consumer acceptance (NOT release)

1. **repo-wide current-prose sweep** 재검 (AGENTS working-style 2축).
2. **tarball/installed-JS consumer 축:** `check-install-surface` + `check-pack-install` + Docker
   `check-install-container`.
3. **scratch HOME에서 installed package**가 4개 cortex 모델을 등록하고 dual-HOME/mcp projection을
   실제로 쓰는지.
4. **실제 operator installed surface**에서 cold-start / reuse / outbound v2 반복.
5. **negative paths:** `CORTEX_HOME` set / auth·connection 부재 / unsupported model / non-stdio
   server / teardown.
6. **readiness gap은 §11-3·#55 known-open 강도 유지** — fence 즉흥 구현 금지.

## Do not

- version/tag/publish/release 금지, push 금지 (GLG 지시 대기).
- readiness fence 구현 금지 (§11-7 lane 소유).
- `CORTEX_HOME`을 오퍼레이터 셸에 export하지 말 것 — cortex 턴 전부 거부(설계).
- cortex 버전 핀 금지 (GLG: 유연하게) — 드리프트는 set-model fail-loud가 잡는다.

## 참고 (probe lane에 넘길 사실)

- `check-probe-cli-shim` 섹션3 same-ms tie 플레이크를 봉합했다(STREAM_CLI per-turn 응답 5ms 지연;
  계측기 무접촉). anchor==receivedAtMs tie가 run의 ~10%에서 임의 claim을 WRONG-REASON으로 오염시키던
  실측 근거는 f18ecfe 커밋 메시지와 게이트 픽스처 주석에 있다.
