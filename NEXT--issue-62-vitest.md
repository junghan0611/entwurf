# NEXT--issue-62-vitest — issue #62 Vitest pilot amendment

> Branch-only disposable handoff for `issue-62-vitest`. Delete before merge after durable facts are promoted to issue #62's canonical ledger. Base is exactly `e405d64`; current pushed pilot is `4bf0c38`.

# RAIL — 현재 좌표

- [x] **1. Phase 0 baseline** — legacy/framework/combined denominator와 6-class inventory 구현
- [x] **2. Phase 1–2 pilot** — Vitest 4.1.9, fresh-call 46→44 mapping, runtime schema/provider 관측, 신규 mutants
- [x] **3. Review amendment** — 6개 항목 구현 완료, focused gates green (아래 LEDGER)
- [ ] **4. Frozen candidate acceptance** ← CURRENT: independent review → correction bundle → `check-gate-qualification` once → `pnpm check` once → commit only
- [ ] **5. Phase 3 migration** ← PAUSED: amendment와 exact-SHA CI가 green이 되기 전에는 열지 않는다

현재 좌표: pilot commit `4bf0c38`은 원격에 있고 그 SHA의 CI는 여전히 RED다. amendment는 worktree에만 있으며 아직 commit 되지 않았다 → frozen acceptance 전 main/0.14.0 판단 금지

# NOW

- **Current:** amendment 6개 항목이 worktree에 구현되어 있고 focused gates가 green이다. commit 없음, push 없음. `4bf0c38`의 CI run `31129600532`는 여전히 RED이며 그 사실은 정정하지 않는다 — amendment는 아직 어떤 SHA도 CI를 통과하지 않았다.
- **Next:** coordinator(GPT-5.6-sol)의 독립 review → correction bundle → gate/mutant가 바뀌었으므로 `check-gate-qualification` 1회 → frozen candidate에서 `pnpm check` 1회 → commit only.
- **Blocker:** 없음. 직전 blocker(`@earendil-works/pi-ai/api/anthropic-messages` private subpath)는 `/compat`으로 닫혔다 — 근거는 LEDGER의 pi-ai 0.84 surface 실측.
- **Read:** `AGENTS.md`; issue #62 body; canonical ledger comment `#issuecomment-5209613895`; CI run `31129600532`; `4bf0c38`; 아래 LEDGER.
- **Do not touch:** Phase 4 감산, source-text 일괄 삭제, push/release, unrelated Claude launcher fix를 이 branch commit에 섞는 일.

## Amendment bundle — 정확히 이 순서

1. **CI import blocker:** provider conversion test를 package root contract가 허용하는 `@earendil-works/pi-ai/compat` surface로 옮긴다. Opus가 loopback capture로 pattern/bounds/description이 동일하게 wire에 실리는 것을 재현했다. 증거 강도를 낮추지 말 것.
2. **candidate denominator:** `run.sh`의 `check_pi_import_surface` corpus가 `git ls-files` tracked-only라 신규 untracked test를 floor에서 보지 못했다. `--cached --others --exclude-standard` work surface로 고치거나, staging-before-floor를 실행 계약으로 명문화하되 하나의 SSOT로 닫는다. 현재 권고는 gate corpus 확장이다.
3. **inventory semantic defect:** `H_LIVE`가 산문 속 `LIVE=1`까지 잡아 deterministic `scripts/check-release-gate-outcomes.ts`를 real-live로 오분류한다. 수선 후 expected totals는 hermetic-integration **36**, real-live **21**; combined **193 files / 57,611 lines**, net **+749**는 불변이다. `smoke-meta-async-drift.sh`의 deterministic+LIVE 2-tier도 맞는 이유로 분류되게 판단한다.
4. **Vitest QK attribution:** `scripts/lib/mutation-qualify.ts`의 line-token scan은 Vitest code frame에 인접한 통과 QK가 찍혀도 claimed signature로 오인할 수 있다. JSON reporter의 실제 failed-test title set 등 Vitest-aware oracle로 좁혀 WRONG-REASON을 KILLED로 올리지 않게 한다. 현재 13 mutants는 맞게 죽었지만 Phase 3 확장 전에 닫는다.
5. **installed refusal evidence:** `run_vitest`의 node_modules refusal은 수동 재현상 rc=1 + 명시적 dev-clone-only 메시지로 옳다. `check-pack-install`은 run_ts와 shell guard만 소비하므로 `check-mux-fresh-call`의 새 refusal branch를 실제 installed tree에서 한 번 구동해 증거를 붙인다.
6. **ledger honesty:** canonical ledger의 “`pnpm check` green”은 committed SHA `4bf0c38`에 대해 거짓이다. amendment exact-SHA CI가 green이 된 뒤에만 기존 행을 교정한다. CI green decision row를 추가하고 timing에는 host를 붙인다(thinkpad 약 1.5s, oracle 약 3.2s).

# ACCEPTANCE

```text
implement focused fixes
→ affected focused gates
→ independent Opus review + one amendment correction bundle
→ gate/mutant changed: check-gate-qualification once
→ stage the exact candidate index before any index-sensitive full floor
→ pnpm check once on frozen candidate
→ commit only (no push)
```

Required evidence:

- `./run.sh check-pi-import-surface` green and the test still captures the real pi-ai 0.84 anthropic-messages request body on loopback.
- inventory output says semantic `hermetic 36 / real-live 21`, unclassified 0, files `193`. **Line total은 두 좌표를 구분해 읽는다:** `pilot 4bf0c38 = 57,611`(역사적 좌표, 보존), `amendment work surface = 57,840`(+229, 출처는 amendment 자신이 추가한 줄). 숫자를 맞추려고 검증 코드를 감산하지 않는다.
- synthetic Vitest code-frame negative proves a passing adjacent QK cannot certify a failing claim.
- installed package directly refuses `check-mux-fresh-call` for the intended reason.
- `pnpm test` 44/44, typecheck/lint green, `.only` absent.
- if gate/mutant changed, qualification reports every mutant KILLED at its own reason; then frozen `pnpm check` green.
- no file/index edit after final floor; final commit only, no push.

# REVIEW LEDGER

## Amendment as implemented (worktree, uncommitted)

| # | 수선 | 증거 |
|---|---|---|
| 1 | provider test가 `@earendil-works/pi-ai/compat`의 `stream`을 쓴다 | pi-ai 0.84 package root는 `stream`/`streamAnthropic`을 **export하지 않는다**; root `lazyStream(model, setup)`은 `setup` 안에서 private api 모듈을 다시 import해야 한다. `/compat`의 `stream`·`streamAnthropic` 둘 다 loopback anthropic request body에 `tools[].input_schema.properties.model{pattern,minLength,maxLength}` + description을 private subpath와 동일하게 실어보내는 것을 실측했다. 증거 강도 하락 없음. run.sh allowlist 주석이 두 consumer(`lib/acp/models.ts` getModels, 이 test)를 명시한다 |
| 2 | `check-pi-import-surface` corpus = `--cached --others --exclude-standard` | `pi_import_work_surface`/`pi_import_scan` 두 helper를 실제 repo와 **외부 mktemp fixture repo** 양쪽에서 동일 호출한다. fixture는 tracked-allowed(`/compat`)와 untracked-forbidden을 함께 두어 분모를 양방향으로 증명한다. worktree에는 아무것도 쓰지 않는다 |
| 3 | `H_LIVE`를 code-only projection에 적용 | TS는 주석+리터럴 blank, shell은 주석+홑따옴표만 blank(쌍따옴표 안 `${LIVE:-0}` 확장은 실제 read라 보존). `check-release-gate-outcomes.ts` real-live → hermetic-integration. `smoke-meta-async-drift.sh`는 real-live 유지 + 새 `two-tier gates` 섹션이 deterministic 기본 tier / `LIVE=1` add-on tier를 명시(stale entry는 throw) |
| 4 | Vitest QK 귀속을 failed-test title로 | `fencedEnv`가 `ENTWURF_MUTATION_VITEST_REPORT=<invocationDir>/vitest-report.json`을 넘기고, `run_vitest`가 marker 한 줄 + `--reporter=default --reporter=json --outputFile.json` 으로 돈다. `runGateBounded`가 child close 시점에 읽어 `GateRunResult.failedTitles`(`"legacy" \| "unreadable" \| string[]`)를 채운다. marker가 있는데 report가 없거나 깨지면 `unreadable` → attribution false → WRONG-REASON, **token scan fallback 금지**. legacy node:assert/shell gate는 `ok`-line oracle 그대로 |
| 5 | installed refusal 증거 | `check-pack-install`이 설치된 tree에서 `check-mux-fresh-call`을 직접 구동해 nonzero + `dev-clone-only surface` + `vitest is a devDependency` 두 문구를 모두 요구한다 |
| 6 | ledger 정직성 | 아래 “정직하게 남기는 사실” |

Measured numbers (frozen 전 worktree 기준):

- semantic: **hermetic-integration 36 / real-live 21 / unclassified 0** — 요구치 일치.
- combined: **193 files / 57,840 lines**. 파일 수는 불변, 줄 수는 `57,611`이 아니다. 차이 **+229**는 재분류가 아니라 amendment 자신이 추가한 줄(`run.sh`, `scripts/lib/mutation-qualify.ts`, `scripts/check-gate-qualification.ts`, `scripts/inventory-verification-surface.ts`)이다. `57,611`은 `4bf0c38` 시점 숫자다. 이 문서(`NEXT--*.md`)는 inventory denominator(`scripts/` + `test/` + `vitest.config.ts`) 밖이라 문서 수정은 숫자를 움직이지 않는다.
- mutant lane: `mux-fresh-call` 13 → **15** (`PIIMPORT-WORK-SURFACE`, `VITEST-FAILED-TITLE-ATTRIBUTION`이 이 pilot lane에 붙는다), `release-gate` 10 유지, `EXPECTED_LANE_MUTANTS` 동시 수정.

수동 replant(둘 다 자기 QK로 죽고 바이트 복원 확인):

- `git ls-files -z --cached`로 되돌림 → `[QK:PIIMPORT-WORK-SURFACE]` rc=1.
- `assertion.status === "failed") continue`로 되돌림 → `[QK:VITEST-FAILED-TITLE-ATTRIBUTION]` AssertionError rc=1.

attribution self-test는 **비공허**하다: 첫 cell이 legacy failure-line oracle이 그 measured code frame에서 인접 **PASSING** claim을 실제로 TRUE로 인증한다는 것을 먼저 단언한 뒤, 구조화 oracle이 FALSE/TRUE로 갈라지는 것을 본다.

Focused gates green: `check-pi-import-surface`, `check-mux-fresh-call`(44/44, `.only` 없음), attribution self-test(4), `inventory-verification-surface`, `check-pack-install`, `pnpm typecheck`, `pnpm lint`.

## 정직하게 남기는 사실

- `4bf0c38`에 대해 `pnpm check`는 **RED**였다. canonical ledger의 “`pnpm check` green” 행은 그 SHA에 대해 거짓이며, amendment commit의 exact-SHA CI가 green이 되기 전에는 정정하지 않는다.
- 이 amendment는 **어떤 SHA에서도 CI를 통과한 적이 없다.** 지금 있는 것은 로컬 focused gate 증거뿐이고, full floor(`pnpm check`)와 `check-gate-qualification`은 frozen candidate에서 각각 1회 아직 돌지 않았다.
- CI green decision row와 host별 timing(thinkpad 약 1.5s, oracle 약 3.2s)은 실제 green이 난 뒤에 적는다.

## What remains valid from `4bf0c38`

- Historical denominator: base `scripts/` 188 files / 56,862 lines. Pilot combined surface is 193 files / 57,611 lines, net +749; migration is not subtraction.
- One typecheck fence: root sees config, scripts fence sees four `test/**` files, mcp sees none; no duplicate/hidden test files.
- Old 46 = 34 textual `ok()` call sites minus two loop bodies plus 6 refusal rows plus 8 description rows. New 44 tests preserve the contracts; counts are not quality scores.
- MCP observation is a real bridge boot + `tools/list`; pi observation is real extension registration capture; provider observation is pi-ai conversion to a loopback request body with an intentional HTTP 400, never fake success.
- New HOST-VALID and PROVIDER-VALID mutants replant the original malformed Rust-family character class and were KILLED at their named QK claims in the reviewed candidate.

## Separate urgent lane — never mix into #62 amendment

The oracle host's `~/.local/bin/claude` was found dangling into `/tmp/mux-lifecycle-live-*/xdg-data/claude/versions/2.1.223`. Official install restored `~/.local/share/claude/versions/2.1.223`.

Opus traced the mechanism to `scripts/smoke-mux-lifecycle-live.ts` and the same shape in `scripts/smoke-mux-fresh-call-live.ts`: Claude receives real `HOME` but fixture `XDG_DATA_HOME`; self-update can write the real launcher to a temporary version target, then cleanup deletes the target. This predates #62 and is triggered by LIVE execution, not `pnpm check`. Treat it as a separate install-destruction blocker with its own branch/issue and fail-closed launcher pre/post fence.

# DO NOT

- Do not merge or include in 0.14.0 while exact-SHA CI is red.
- Do not push; GLG decides push after reading the local commit.
- Do not open Phase 3/4 from pilot success.
- Do not claim qualification alone proves Vitest QK attribution until the code-frame false-positive is closed.
- Do not run the two mux LIVE smokes on the operator host until the Claude launcher safety lane is fixed.
