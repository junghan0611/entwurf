# NEXT--issue-62-vitest — vitest 도입 lane (issue #62), Phase 0–2 착지 / Phase 3 대기

> 이 파일은 branch `issue-62-vitest`의 disposable 핸드오프다. 머지 전에 삭제한다.
> 이슈 본문(Phase 0–4)과 코멘트(게이트 작성 교훈 5개)가 계약의 SSOT다.

## RAIL

```text
Phase 0 baseline  ✅  inventory 스크립트 + 실측 스냅샷 (아래)
Phase 1 pilot     ✅  vitest 4.1.9 exact + fresh-call lane 3파일 + run.sh shim
Phase 2 equival.  ✅  매핑표(아래) + escape 재식재 red 증명 + flake 5회 0 + 시간 실측
Phase 3 migration ⬜  lane 단위 — 다음 후보를 GLG/coordinator와 정한 뒤에만
Phase 4 subtract  ⬜  별도 결정 경계. Phase 1 성공만으로 열지 않는다 (이슈 명문)
```

## Phase 0 — baseline 실측 (2026-08-07, thinkpad)

재현: `node --experimental-strip-types scripts/inventory-verification-surface.ts`.
coordinator 독립 검수(blocker 1축)로 첫 판을 수선했다: (1) denominator가 scripts/뿐이라
test/로의 이동이 감산처럼 보였다 → 지금은 **legacy axis(scripts/) + framework axis(test/ +
vitest.config.ts) + COMBINED total**을 같이 고정하고 per-gate table에 vitest lane도 실린다.
(2) 스타일 분류는 이슈가 명문화한 의미 분류가 아니었다 → 이슈의 6-class
(pure-unit / behavioral-contract / source-topology / hermetic-integration / package-install /
real-live)를 **primary**로, first-match 규칙 + 사유 있는 좁은 override 3건 + **unclassified=0
단언**(분류 불가 파일은 throw)으로 세웠다. 스타일 축은 secondary로 보존.

**역사 스냅샷 (e405d64, 브랜치 변경 전 — 재실행 수치와 혼동 금지):**
- scripts/ 188 files 56,862 lines; 게이트 111 files 41,661 lines
- 스타일: imports-product 38 / mixed 36 / subprocess 14 / shell 15 / source-text 1 / other 7
- 뮤턴트 219 / 18 lanes, 45% infra-subject (probe-ordering 85개, 84 infra)
- 파일럿 구 게이트 `check-mux-fresh-call` 46 checks **0.085s**

**현재 워크서피스 실측 (amendment 후, HEAD e405d64 + 브랜치 변경):**
- legacy axis 188 files **56,822** lines · framework axis 5 files **789** lines ·
  **COMBINED 193 files 57,611 lines** — 이관은 축 간 이동이고 COMBINED가 줄어야만 감산이다
- 6-class: pure-unit 22 / behavioral-contract 25 / source-topology 4 /
  hermetic-integration 35 / package-install 5 / real-live 22 / **unclassified 0**
- 뮤턴트 221 / 19 lanes (mux-fresh-call 11→13)

## Phase 1 — pilot 배선

- **vitest `4.1.9` exact** — pi-mono `v0.84.0` 태그의 `packages/*/package.json` 실측
  (v0.83.0 체크아웃도 동일 4.1.9). `rregex 1.13.1` exact (rust-lang/regex WASM).
- `pnpm test` = `vitest run`; `test:watch`; `vitest.config.ts`는 `fileParallelism: false`
  (이슈의 subprocess-공유 flake 경고 — serial부터, 완화는 측정 후).
- typecheck fence: `test/**`는 scripts/tsconfig.json(allowImportingTsExtensions),
  root exclude에 `"test"` 추가. 한 파일 한 fence 규칙 유지.
- `run.sh check-mux-fresh-call`은 **transition shim** — `run_vitest`가 파일럿 3파일을 돌린다.
  installed package(node_modules 하위)에서는 run_ts와 같은 정직한 거절.
- 뮤턴트 lane `mux-fresh-call`: 11 → **13** (gate argv 불변, signatureSource가 test/*로 이동,
  timeout 60→120s — vitest 게이트가 구 게이트보다 느린 만큼).

## Phase 2 — 등가성 매핑표 (구 46 checks → 신 44 tests)

구 게이트 `scripts/check-mux-fresh-call.ts`(삭제됨, git history에 보존) 기준.

| 구 계약 | 신 위치 | 축 변화 |
|---|---|---|
| [QK] PI-ARGV-PROMPT-FIRST / PI-MODEL-ARGV / PI-MODEL-DIALECT | test/mux-fresh-call.test.ts | 동일 (runtime unit) |
| [QK] CLAUDE-ARGV-EQUALS-FORM / CLAUDE-MODEL-ARGV | 〃 | 동일 |
| argv no-shell-flags · fixed backend set | 〃 | 동일 |
| [QK] CALLBACK-PRECEDES-TASK · framing gid/nonce/tool/금지 3종 | 〃 | 동일 |
| refusal 6종 + 렌더 6종 (identity-first 포함) | 〃 | 동일 (it.each) |
| [QK] RECEIPT-WITHOUT-CORRELATION · 렌더 2종 · no-watcher | 〃 | 동일 (sync runtime + interface source-topology) |
| composition no-env/store · leaf carrier-free · no delivery import | 〃 | 동일 (구조 계약, 의도적 static) |
| [QK] PI-MODEL-SCHEMA (구: source regex, `.min(1)`에서 멈춤) | test/fresh-call-surfaces.contract.test.ts | **업그레이드**: 실제 extension registerTool 캡처 → runtime schema의 presence/required/min/max/pattern |
| [QK] PI-SURFACE-IDENTITY (구: source regex) | 〃 | **업그레이드**: runtime 파라미터 집합 = {backend,model,task} + 행동 판별(PI_SESSION_ID 심고 invalid model — mutant는 model-invalid, 원본은 caller-identity-unavailable; invalid model이라 mutant도 tmux 도달 불가) |
| [QK] CLAUDE-MODEL-SCHEMA (구: source regex) | 〃 | **업그레이드**: 실제 bridge boot → tools/list runtime schema |
| [QK] CLAUDE-SURFACE-IDENTITY | 〃 | 유지 (identity-authority 구조 계약 — runtime 관측은 실제 launch 리스크) |
| desc cap 2048 (구: 소스 파싱 재조립) | 〃 | **업그레이드**: runtime tools/list + 캡처 description, 전 도구로 확대 |
| contract literals 8종 + world map + facts-only 프레임 | 〃 | runtime description 기준으로 이동. 단 구 literal `no secrets`는 rendered description에 없던 **파일 소스 매칭**이라 `secrets`로 교정 (계약 자체는 유지) |
| — (신규) [QK] MODEL-PATTERN-HOST-VALID | 〃 | **신규 계약**: tools/list의 모든 pattern이 Rust-regex-family(rregex)에서 컴파일. #62 escape의 결손 계약 |
| — (신규) 두 표면 pattern 바이트 동일 | 〃 | **신규**: "같은 문법 두 벌 손글씨" 결함류 |
| — (신규) [QK] MODEL-PATTERN-PROVIDER-VALID | test/fresh-call-provider.contract.test.ts | **신규**: pi-ai 실제 anthropic-messages 변환이 로컬 캡처 서버로 보낸 **실 request body**의 pattern이 등록 pattern 그대로이고 Rust에서 컴파일 (이슈 open question을 pi lane에서 닫음) |

**escape 재식재 증명 (2026-08-07 실측).** biome unescape를 zod 표면에 심으면
HOST-VALID + 두-표면-동일 2셀이 정확히 `unclosed character class`로 red;
TypeBox 표면에 심으면 PROVIDER-VALID 포함 3셀 red. 원 게이트에서는 둘 다 green이었다.

**시간 실측.** 파일럿 3파일 44 tests **~1.5s** (구 게이트 0.085s — bridge boot/extension
로드/HTTP 캡처가 실린 대가). flake: 연속 5회 44/44, `.only` 없음.

## 검증 상태 (이 브랜치, 커밋 전)

- focused: check-mux-fresh-call(shim) · check-shell-quote · check-install-surface ·
  check-pack · check-package-source-routing 전부 PASS. typecheck/lint green.
  vitest 44/44, flake 연속 5회 0, `.only` 없음.
- **최종 후보의 qualification / `pnpm check` 수치는 이 문서에 적지 않는다.** 문서를 이 상태로
  고정한 **뒤** 두 검증을 순서대로 돌리고, 그 뒤에는 아무 파일도 편집하지 않으며, 결과는
  coordinator 채널 메시지로만 보고한다 — run 이후의 문서 편집은 후보를 움직여 증거를
  무효화한다(AGENTS 검증 scheduling). 교훈 실측 둘: ⑴ qualification **도중** untracked 문서를
  써도 origin-drift로 무효가 된다(첫 실행이 그렇게 정직하게 죽었다). ⑵ run **이후**의
  "수치 기입" 편집도 같은 금지에 걸린다(검수가 잡았다). 수치가 필요한 미래 독자는
  git log의 커밋 메시지와 coordinator 채널 기록을 본다.

## 다음 한 걸음

1. GLG/coordinator 승인 후 commit (Pebble은 커밋하지 않는다). checkpoint는
   2026-08-07 05:5x KST에 coordinator(20260807T045821-b349ec)로 발신됨.
2. Phase 3 첫 lane 후보 결정은 회신 후. 후보 메모: NEXT.md 10번이 남긴
   `check-acp-sdk-surface`의 QK/mutant 부재도 이 lane 시야에 있다 (이슈 본문).

## DO NOT (이 lane)

- 커밋·푸시는 GLG/coordinator 승인 후 (Pebble은 하지 않는다).
- Phase 4(감산/뮤턴트 축소)를 Phase 1–2 성공을 근거로 열지 말 것.
- source-text 검사 일괄 삭제 금지 — 세 종류 세 운명 표(이슈)로 개별 판정.
- `pnpm format` 전체 실행 금지; 고친 파일만 `npx biome check --write <file>`.
- qualification/`pnpm check` 중 트리·이 파일 저장 금지.
