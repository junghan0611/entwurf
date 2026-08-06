# NEXT--issue-62-vitest — issue #62 Vitest pilot amendment

> Branch-only disposable handoff for `issue-62-vitest`. Delete before merge after durable facts are promoted to issue #62's canonical ledger. Base is exactly `e405d64`; current pushed pilot is `4bf0c38`.

# RAIL — 현재 좌표

- [x] **1. Phase 0 baseline** — legacy/framework/combined denominator와 6-class inventory 구현
- [x] **2. Phase 1–2 pilot** — Vitest 4.1.9, fresh-call 46→44 mapping, runtime schema/provider 관측, 신규 mutants
- [ ] **3. Review amendment** ← CURRENT: CI RED + 독립 리뷰의 1 blocker/3 defects를 한 bundle로 수선
- [ ] **4. Frozen candidate acceptance** — independent review → qualification if needed → `pnpm check` → commit only
- [ ] **5. Phase 3 migration** ← PAUSED: amendment와 exact-SHA CI가 green이 되기 전에는 열지 않는다

현재 좌표: pilot commit `4bf0c38`은 원격에 있으나 CI RED → amendment 필요 → frozen acceptance 전 main/0.14.0 판단 금지

# NOW

- **Current:** GitHub Actions run `31129600532`에서 `check`만 실패했다. `install-surface`와 `artifact-consumer`는 green이다. 2차 Opus 독립 리뷰는 CI 조기 종료 뒤 잔여 check chain 39–95를 전부 실행해 추가 red가 없음을 확인했다.
- **Next:** GPT-5.6-sol coordinator가 새 Claude Code Opus reviewer를 visible mux로 열고 아래 amendment를 구현·교차검수한다. GLG 권한은 **commit까지만**, push 금지.
- **Blocker:** `test/fresh-call-provider.contract.test.ts`가 금지된 `@earendil-works/pi-ai/api/anthropic-messages` private subpath를 import한다. `./run.sh check-pi-import-surface`로 CI와 동일하게 재현된다.
- **Read:** `AGENTS.md`; issue #62 body; canonical ledger comment `#issuecomment-5209613895`; CI run `31129600532`; `4bf0c38`; Opus review 요약 아래.
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
- inventory output says combined `193 / 57,611`, semantic `hermetic 36 / real-live 21`, unclassified 0.
- synthetic Vitest code-frame negative proves a passing adjacent QK cannot certify a failing claim.
- installed package directly refuses `check-mux-fresh-call` for the intended reason.
- `pnpm test` 44/44, typecheck/lint green, `.only` absent.
- if gate/mutant changed, qualification reports every mutant KILLED at its own reason; then frozen `pnpm check` green.
- no file/index edit after final floor; final commit only, no push.

# REVIEW LEDGER

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
