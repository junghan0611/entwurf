# NEXT — fix/78-realhome-flavor (disposable; delete before merge)

## Status

entwurf#78 「First evidence」 구현 완료, 커밋 대기. main@4043601 분기.

## What changed (4 + 2)

- `pi-extensions/lib/acp/overlay.ts:423` — 가드가 `startsWith("/")` → `isAbsolute() || win32.isAbsolute()`.
  import `node:path` 확장, 에러 문구/D10 계약 문장 불변.
- `scripts/check-acp-cortex.ts` — 양성 셀 둘(drive/UNC, `realSnowflakeHome` 를 tmp 로 고정해 **가드만** 시험),
  음성 셀 하나(`""`). QK 라벨은 `assert.doesNotThrow` 한 곳에만 (매니페스트 계약: gate source 에 정확히 1회).
- `scripts/mutants/acp-cortex.json` — `CORTEX-REALHOME-PLATFORM-NEUTRAL` 추가 (13 → 14).
- `scripts/check-gate-qualification.ts:824` — `EXPECTED_LANE_MUTANTS["acp-cortex"]` 14.
- `docs/acp-backend-rail.md` D10 절 한 줄 + `CHANGELOG.md` Unreleased/Fixed.

## Receipts (measured here, oracle, 2026-09-08)

- `pnpm typecheck` 초록 · `./run.sh check-acp-cortex` exit=0 · `./run.sh check-gate-manifests` → 388 mutants / 40 lanes.
- 수동 kill: 가드를 `startsWith("/")` 로 되심음 → `AssertionError [ERR_ASSERTION]: Got unwanted exception: a
  win32-flavored absolute realHome ("C:\\Users\\x") must PASS the guard ... [QK:CORTEX-REALHOME-PLATFORM-NEUTRAL]`.
  정확히 새 줄로 복원 후 다시 exit=0.

## done_when

1. 코디네이터 보고 → 타 하네스 검수 → amendment 한 묶음.
2. 동결 candidate 에서 `./run.sh check-gate-qualification`(~40분) 과 `pnpm run check:full`(~8분) **각 1회**, tmux.
3. GLG 판정: #77 머지 후 적층 vs 이 커밋으로 close, 기여자 credit 방식. **push 금지, PR #77 코멘트 금지.**
