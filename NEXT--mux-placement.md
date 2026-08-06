# NEXT — S1 visible same-id resume 착지; 남은 것은 candidate 검수와 승인 게이트다

> `mux-placement` branch boot sector. Fresh-call product는 `88d7faa`, runtime-hermetic gate 수선은 `d4b7f97`, hidden resume withdrawal(S0)은 `6f8dd76`에 있다.

# RAIL — 현재 좌표

- [x] **1. placement + visible launch leaf** — T0-b/T1-a landed
- [x] **2. B/C/C2 raw baseline** — Pi·Claude Code initial turn + callback correlation measured
- [x] **3. owner/contract decision** — `{backend, model, task}` surface; caller가 고른 model을 runtime별 실측 CLI 방언으로 운반하고 callback sender envelope는 identity receipt다.
- [x] **4. implementation + focused gates** — product, two public surfaces, QK 6/mutants 6
- [x] **5. independent review + LIVE** — amendment bundle closed; isolated two-backend LIVE 18 checks green
- [x] **6. accept commit candidate** — qualification 165/165 + frozen `pnpm check` green; `88d7faa`
- [~] **7. public-harness lifecycle acceptance** ← HALTED 2026-08-06: 마지막 row(`owned-outcome` → spawn-bg resume)가 **hidden** child를 띄운다는 이유로 coordinator가 중단시켰다. visible-first가 정책이다.
- [x] **7-S0. visible-first hard cut** ← `owned-outcome` intent와 `spawn-bg` transport를 타입계에서 제거(회수이지 reject 뒤 은폐가 아니다). record-authoritative identity leaf만 `resume-launch-identity.ts`로 보존하고 gate를 붙였다. `6f8dd76`; qualification 171/171 + frozen `pnpm check` 92/92 green.
- [x] **7-M. explicit fresh model carrier** ← operator tour가 ambient defaults(Pi `gpt-5.5`, Claude Code Opus 5)를 연 gap을 잡았다. required `{backend, model, task}`와 Pi `--model <value>` / Claude Code `--model=<value>` 방언을 배선했고, exact Pi equals-form mutant까지 176/176 KILL 및 real two-backend LIVE 18/18로 닫았다.
- [x] **7-M-fix. fresh-call model pattern이 host schema validator를 통과한다** ← 7-M의 zod `.regex()`가 문자 클래스 안 `[`를 escape하지 않아 emitted JSON Schema pattern이 Rust regex 계열(호스트 tool schema validator)에서 `unclosed character class`로 거부됐다. 증상은 `400 tools.5.custom.input_schema` — 이 툴을 로드하는 모든 Claude 세션이 열리지 않는다. JS `RegExp`는 `u` 플래그에서도 통과시키므로 QK/mutant/LIVE 어느 축도 관측하지 못했다. TypeBox 면(`entwurf-control.ts`)은 처음부터 escape되어 있어 Pi native만 살아 있었다. 세 파일(`mcp/entwurf-bridge/src/index.ts`, `pi-extensions/lib/mux-fresh-call.ts`, `scripts/mutants/mux-fresh-call.json`)을 정렬했고 JS 판정 의미론은 동치다.
- [x] **7-L. operator tour** ← 새 runtime에서 3장면 관측 완료(2026-08-06 17:13~17:16). Claude Code `claude-sonnet-5`와 Pi `entwurf/claude-sonnet-5`가 각각 launch→callback(nonce 정확 일치)→delivery→reply 4축을 채웠고, 창을 닫자 **rail별로 서로 다른 정직한 거절**이 나왔다: Pi는 `dormant-fire-forget-unsupported (liveness: dead)`, Claude Code는 `mailbox-undeliverable (liveness: unsupported)`. model carrier 증거는 Pi가 더 강하다 — callback envelope의 agentId가 `entwurf/claude-sonnet-5`다(자기보고가 아니라 envelope 사실). 반대로 Pi 형제는 자신이 받은 rail을 self-fetch mailbox라고 **잘못** 자기보고했다(receipt는 `control-socket → sent`) — message body가 untrusted data라는 계약의 실증이다.
- [x] **7-C. model carrier commit** ← 최종 candidate에서 qualification **176/176 KILLED**(work-surface hash before/after 동일) + `pnpm check` exit 0. `1750af4`로 커밋·push 완료. **머지는 하지 않는다.**
- [x] **8. visible same-id resume (S1)** ← **착지**. `entwurf_resume_call {target}`이 별도 lifecycle verb로 두 표면에 등록됐다. record가 transcript·model·provider·cwd를 주므로 prompt/task/model override가 없고, **턴을 돌리지 않는다**. LAUNCH receipt와 OBSERVATION receipt는 분리되며 후자만 시민이 돌아왔다고 말한다. live/indeterminate/address-conflict/non-pi(`target-not-pi`)는 창 없이 거절하고, 미관측이면 **창은 열어둔 채 lock을 해제**한다 — watcher·retry·supervisor 없음. 구현: `pi-extensions/lib/mux-resume-call.ts`(mux만) + `pi-extensions/lib/entwurf-v2-visible-resume.ts`(v2 leaf만, launch는 주입 seam), 표면 두 곳이 composition root. 게이트: `check-mux-resume-call` · `check-entwurf-v2-visible-resume` · `check-entwurf-resume-args` · `check-mux-parent-artifact`, 그리고 통합 LIVE `smoke-mux-lifecycle-live`가 **release-gate MUST**(`run_live_step` 1회).
- [ ] **9. v2-native recorded demo retake** ← PAUSED
- [ ] **10. test framework lane** ← **issue #61** (https://github.com/junghan0611/entwurf/issues/61). main merge 후 그 이슈를 보고 **별도 브랜치**를 만들어 진행한다. 이 브랜치에서 착수 금지 — capability lane에 meta-infra를 태우지 않는다. 요약은 아래 §테스트 체계 관측.

현재 좌표: C2 제품·직접 LIVE 완료 → hidden resume 회수(S0) → model carrier(7-M) + schema fix → operator tour → **S1 visible same-id resume 완료** → candidate 승인 대기

> **mux capability lane의 구현과 frozen 검증은 닫혔다.** 남은 것은 GLG의 commit 승인과, 그와 별개인 main merge/push 승인이다. recorded demo retake는 PAUSED이며 landing의 선행조건이 아니다.

# NOW

- **Current:** S1 candidate가 staged/uncommitted 상태로 서 있다. 통합 LIVE가 세 cell(claude-code · pi-native · pi-acp) 전부 green이고, 두 Pi provider shape 모두 **창을 닫기 전에 들은 사실을 resume 뒤에 회수**했다 — 소켓이 아니라 그 회수가 같은 대화가 돌아왔다는 증거다.
- **Next:** (1) final candidate 검수 → (2) **commit 승인 대기**(GLG) → (3) **main merge 승인 대기**(별도 권한) → (4) merge 후 이 브랜치 NEXT 삭제 → (5) issue #61은 **별도 브랜치**.
- **머지 규칙:** commit과 merge/push는 서로 다른 권한이다. 어느 쪽도 지시 없이 진행하지 않는다.
- **Read:** `.claude/skills/entwurf-dev/SKILL.md`, 아래 §테스트 체계 관측, issue #61.
- **Do not touch:** 명시 없는 push/release; `entwurf_v2` 계약 변경; token/store lookup; product watcher/retry/supervisor; model 외 provider knob; issue #63. 이 브랜치에서 vitest 착수 금지 — RAIL 10 = issue #61.

## S1이 바꾼 계약 (durable)

- **resume은 delivery가 아니다.** `entwurf_v2`는 여전히 어떤 rail에서도 process를 열지 않고 dormant를 정직하게 거절한다. dormant pi를 다시 세우는 것은 `entwurf_resume_call` 하나뿐이다.
- **작동하는 기준선과의 차이는 확인 대상이지 추론 대상이 아니다.** 환경 변수 하나를 "canonical 경로니까 동치"로 두었다가 통합 LIVE가 세 번 붉었다. 원인은 working control이 그 변수를 *삭제*하는데 이쪽은 *설정*한 것이었다. 기준선이 있으면 exact parity로 맞추고, 동치 여부는 측정으로 판정한다.
- **lock oracle은 제품이 실제로 해석한 경로를 직접 대조한다.** `ENTWURF_V2_LOCK_DIR`은 env가 아니라 `os.homedir()` 기반 import-time 상수다. 같은 이름의 env를 세우는 것은 fence처럼 보이고 아무것도 막지 않는다.
- **scrub된 fixture도 native grammar를 지킨다.** session `$N` / window `@N` / pane `%N` / decimal pid / 실행파일형 runtime — 값이 안전해지려면 자기 문법 안에 있어야 한다.
- **ACP cell은 fence할 수 없고, 그 사실을 문서가 진다.** ACP provider가 스폰하는 `claude`는 operator의 real home에서 인증한다(측정: fenced HOME이면 `Authentication required`로 턴이 죽고, `CLAUDE_CONFIG_DIR`만으로는 안 풀린다). 그래서 그 cell만 real HOME에서 돌고 control socket·lock이 잠깐 실제 루트에 생긴다. meta store는 언제나 fixture라 record는 밖에 생기지 않으며, 안전 oracle은 종료 시 **6개 real root의 entry-set 불변**이고 그 검사는 **실패 경로에서도** 돈다.
- **scrubbed parent-transcript artifact가 tracked로 섰다:** `scripts/fixtures/mux-parent-transcript.scrubbed.jsonl`, sha256 `2f2a10a50ad1d9ed489756c3ccec3b80ef61237fe0d27df8a0d400531fb6e4df`, 게이트 `check-mux-parent-artifact`. 실제 shape는 fixture-only Pi parent retake에서 왔고(측정: pi는 별도 toolCall row를 남기지 않으며 callback은 `custom_message`/`entwurf-message`로 `<sender_info>` envelope을 실어 온다), **placement 증거가 아니다**.

# RECENT

- **2026-08-06:** S1 착지. `entwurf_resume_call` 두 표면 등록, mux/v2 분리 + 주입 seam, 통합 lifecycle LIVE가 release MUST가 됐고 세 cell 전부 green. artifact digest는 위 §S1 계약에 고정.
- **2026-08-05:** callback correlation replaced and CLOSED the pre-injected-token/store-lookup design. No new identity lookup or delivery transport was added.
- **2026-08-05:** review repaired consumer-zero QK wording, default `pnpm check` wiring, MCP fail-loud identity handling, dual-surface description parity, stale SSOT, and LIVE isolation.
- **2026-08-05:** final LIVE launched both backends, received both nonce callbacks, proved distinct sender-envelope garden ids, tore down pane processes/private servers, and left no fixture root or real record/socket residue.

# 테스트 체계 관측 — RAIL 10 입력

7-M-fix를 추적하다 나온 관측이다. **이 브랜치에서 실행하지 않는다.** 작업 단위는 **issue #61**(https://github.com/junghan0611/entwurf/issues/61)이고 main merge 후 그 이슈로 브랜치를 만든다. 로컬 측정 원본은 `.agent-reports/20260806T170500-test-strategy-observation.md`.

- 176 mutant의 게이트 실행시간 합은 **6.4분**인데 `mux-fresh-call` lane 기여분은 **0.9초(0.2%)**다. 상위 3 lane이 82%를 차지하고, subject가 테스트 인프라인 mutant가 **51%**다.
- 게이트 전수에서 **57개(18.5K줄)는 이미 제품을 import해 실행한다.** "테스트가 0개"는 부정확한 표현이었다 — 없는 것은 프레임워크지 계약 테스트가 아니다. 다만 분모가 glob에 따라 흔들리므로 Phase 0의 재현 가능한 inventory가 선행 조건이다.
- 대조군: pi-mono 352 테스트 / prime-agent 414 테스트, 둘 다 vitest. entwurf `scripts/`는 그 7–10배 라인인데 러너가 없다.
- 방향은 vitest 표준 구성. **일괄 철거는 NO-GO**이며 vitest 도입과 mutation 감산은 서로 다른 결정이다. 텍스트 검사도 3분류(런타임 관측 가능 / 구조 계약 / 설치·패키지 계약)로 나눠 처분하며, `smoke-*-install-state`는 LIVE가 아니므로 landing-only로 밀지 않는다.

# 읽을 곳

1. `pi-extensions/lib/mux-fresh-call.ts`
2. `scripts/check-mux-fresh-call.ts` + `scripts/mutants/mux-fresh-call.json`
3. `scripts/smoke-mux-fresh-call-live.ts`
4. `docs/mux-launch-rail.md` §6-a/§6-b/§11/§12
5. `.agent-reports/20260805T143009-mux-bc-baseline.md` (local raw evidence)
