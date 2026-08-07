# NEXT — issue train: #62 착지 → #66/#67 안전 blocker → #63/#65 계약 → #64/#62 종료 판정

> NEXT는 부트 섹터다. 현재 증거는 issue #62 canonical ledger, 검증 계약은 `VERIFY.md`,
> ACP 계약은 `docs/acp-backend-rail.md`, 릴리즈 권한 경계는 `.claude/skills/entwurf-release/SKILL.md`가 진다.

# RAIL — 현재 좌표

- [x] **1. #62 Phase 0–2 Vitest pilot + amendment** — code candidate exact-SHA CI green
- [x] **2. #62 branch closure** — durable ledger promoted, branch-only handoff deleted, final-HEAD CI required before merge
- [ ] **3. #66/#67 안전 blocker** ← CURRENT: merged main에서 exclusive record CREATE → launcher-safe mux LIVE
- [ ] **4. #63/#65 계약 결정** — `streamSimple` 의미 → owner-normalized facts projection
- [ ] **5. #64 field evidence + #62 종료 판정** — formation policy → Phase 3 한 lane 뒤 continue/stop

현재 좌표: #62 final branch acceptance 뒤 main에 착지하는 boot sector → post-main에서 #66 branch를 자른다.

# NOW

- **Current:** #62 canonical ledger `#issuecomment-5209613895`는 223/223, 57,843줄, exact-SHA CI 이력과
  #66/#67 분리를 반영했고 branch-only handoff는 삭제됐다. 이 boot sector는 accepted branch가 main에
  fast-forward된 뒤의 좌표를 가리킨다.
- **Next:** merged `main`에서 `issue-66-meta-create-exclusive`를 잘라 exclusive CREATE 구현을 시작한다.
- **Blocker:** release는 #67이 두 mux LIVE smoke의 real Claude launcher 파괴 경로를 닫기 전까지 막힌다.
- **Read:** issue #62 canonical ledger; #66; #67; `AGENTS.md` verification scheduling.
- **Do not touch:** #62 branch에서 #66 production source를 섞지 말 것; Phase 4를 열지 말 것;
  `smoke-mux-lifecycle-live`와 `smoke-mux-fresh-call-live`를 #67 수선 전에 실행하지 말 것.

# RECENT

- **2026-08-07:** #62 pilot `4bf0c38` → amendment `bc98184` → deterministic CI repair `82cbc9b`.
  code candidate와 branch-closure candidate의 exact-SHA CI가 green이다. `bc98184` CI의 24-bit birthday
  collision은 확률적 gate 결함과 silent record overwrite 위험을 함께 드러냈고 production repair는 #66으로 분리했다.
- **2026-08-07:** 실제 mux LIVE가 fixture `XDG_DATA_HOME` 아래 버전으로 real Claude launcher를 retarget한
  install-destruction incident를 #67로 기록했다. 이는 `pnpm check` 밖의 release blocker다.

# LEDGER — retained release/dependency history

## 0.13.1에 들어간 것

**⑴ 하드 미니멈 런타임 핀.** pi `0.82.1 → 0.83.0`, peer `>=0.83.0 <0.84`. 설치하면 0.82.x 호스트는
그대로 두는 게 아니라 **올라간다** — 이게 의도다. `run.sh`가 devDep에서 peer를 기계 유도하므로 손으로
틀릴 여지가 없고, `./run.sh check-dep-versions`가 오라클이다(5 baseline docs + package + run.sh 동시 검증).
천장은 실측으로 올렸다: `loader.ts`와 `packages/ai/src/compat.ts`가 v0.82.1..v0.83.0 sha256 동일.

**⑵ claude-agent-acp `0.62.0 → 0.63.0`.** 직전 bump와 성격이 다르다 — **adapter-code 릴리즈**다
(tarball 137,294 → 142,084 B, `acp-agent.js`·`tools.js`·`acp-agent.d.ts` 이동). 0.61→0.62의
byte-identical 논거를 재사용하면 안 된다. 우리 표면 도달은 좁고 그것도 실측이다: `clientCapabilities: {}`라
terminal meta와 subagent transcript는 off, 다만 opt-in 아닌 `_meta.claudeCode.title`/`.subagent`와
#916 heartbeat는 wire에 올 수 있고 mapper가 무시할 뿐이다. **"전부 미도달"로 쓰지 말 것.**

**⑶ ACP stop-reason 계약 (이번 컷이 미니점을 버는 지점).** `mapPromptStopReason`의
`default: return "stop"`이 `refusal`·`max_turn_requests`·미지의 reason·**reason 부재** 넷을 전부
깨끗한 성공으로 접고 있었다. pi 0.83이 자기 프로바이더에서 같은 구멍을 닫았고(#7272) `rawStopReason`을
줬다. 이제 `{stopReason, rawStopReason?, errorMessage?}` 판정으로 넷 다 **error 이벤트**로 닫고,
스트림 시드를 `"stop"` → `"pending"`으로 바꿔 진행 중 턴이 성공을 선취하지 않게 했다.

**⑷ 죽은 `[tool:running]` 제거.** `_meta.terminal_output`은 `clientCapabilities._meta.terminal_output
=== true`에 게이팅되는데 우리는 `{}`를 보낸다 — 처음부터 발화 불가능한 분기였다. terminal capability를
켜는 것은 **별도 축**이지 한 줄 재활성화가 아니다(켜면 어댑터가 mapper가 정직하게 렌더 못 하는
terminal widget/meta를 보낸다).

**⑸ 게이트.** 신규 `check-acp-stop-reason` — 7셀(closed ACP terminal set 5 + 미지 + 부재)을
`streamAcpTurn`으로 **behavioral하게** 몰고 event kind / event reason / 최종 메시지의
stopReason·rawStopReason·errorMessage를 함께 판정한다. `acp-stop-reason` mutant lane 6종 추가 →
**111/7 lanes → 117/8 lanes**.

**⑹ 문서 정비.** README의 fresh-cut/external-host 상세를 패키지에 포함되는 전용 문서로 분리하고,
현재 계약이 아닌 릴리즈 고고학을 덜어냈다. `README` 843→500줄, `VERIFY` 333→299줄,
`DELIVERY` 285→141줄, `BASELINE` 444→282줄, ACP rail 1317→198줄, clean-host guide
406→200줄, fresh-cut policy 204→99줄. Codex를 이미 shipped native citizen으로 부르던 잘못된 문장과
아직 구현되지 않은 ACP persisted resume/load 주장도 교정했다. Claude floor 앵커는 README에 남고
`check-claude-floor-coherence`가 계속 결박한다. ROADMAP dep-bump 트랙에는 이번 bump 기록을 추가했다.

**⑺ ACP prompt lifecycle — 진행 중인 턴을 벽시계로 죽이지 않는다 (구현 완료, 커밋 안 됨).**
`PROMPT_TIMEOUT_MS` 600초를 삭제했다. prompt는 이제 lifecycle 사건으로만 끝난다 — 에이전트가 답하거나,
사용자가 abort하거나, child가 죽거나 stdio가 끊기거나. bootstrap 30초 셋(initialize/newSession/set-model)은
그대로다. abort는 ACP `session/cancel` 알림이 먼저 가고(`cancelled`→aborted), bounded grace(5초) 뒤에만
process-group teardown으로 승격한다. `stderrTail`을 turn이 아니라 **session** 스코프로 옮겨 reuse 턴의
child 사망도 exit status와 함께 읽힌다. 턴 사이에 조용히 죽은 세션은 다음 턴이 **1회** announce하고,
우리가 한 teardown은 `retiring` 플래그로 침묵한다. 신규 게이트 `check-acp-prompt-lifecycle`(8셀,
behavioral) + `acp-prompt-lifecycle` mutant lane 8종, `check-probe-ordering`에 production cutoff 부재의
static oracle 2종 추가 → **117/8 lanes → 127/9 lanes**. 신규 LIVE `smoke-acp-long-turn-live`.

**⑻ claude-agent-acp 0.63.0 → 0.64.0 (2026-07-31).** 단일 기능 릴리즈다 — 상류 checkout(release
`9cc5a09`)에서 직접 대조했고 기능 델타는 `src/elicitation.ts` **+14줄 하나뿐**(`d7a65ce`): AskUserQuestion
form의 "Other" 자유입력 필드에 공유 마커 `_meta._askUserQuestionCustomAnswer`를 붙인다. 런타임 의존성 동일
(ACP SDK 1.3.0, claude-agent-sdk 0.3.220), unpackedSize 529,638 → 530,740 B, fileCount 24 → 24.
**우리 해석의 `@modelcontextprotocol/sdk`는 1.29.0 그대로다** — 상류 lock의 1.29→1.30은 그들의 dev 트리이고,
그대로 옮겨 적으면 틀린다(실측). **도달성은 "기본 off"가 아니라 "소스 변경 없이는 불가"다**: `backend.ts:974`의
`clientCapabilities: {}`가 config seam 없는 하드코딩이라 상류가 `elicitationSupport.form=false`를 계산하고,
`acp-agent.ts:5358`이 `AskUserQuestion`을 금지하며 `:5449`가 그 목록을 **concat**으로 합쳐 오퍼레이터
`disallowedTools`로 제거할 수 없고, 방출 분기 `:4558`도 같은 플래그에 걸린다.

## 0.13.1 추가 조임 — ACP ingress/carrier provenance (A축, 닫힘)

**관측된 문제.** Claude ACP Opus가 Q-B0/Q-L1에서 `You are operating through entwurf...`와
`A task is a task...`를 실제 system engraving이라고 확정했지만, 코드는 둘 다
`pi-extensions/lib/acp/augment.ts`의 **first-user-message augment**다. 실제 shipped Claude carrier는
`pi-extensions/lib/acp/prompts/engraving.md`의 `# Engraving Here` 한 줄뿐이다. 처음에는 “system과 prepend
경계를 증명할 수 없다”고 답하고 뒤에서 확정했으므로 carrier provenance baseline은 실패다. Cortex는
`_meta.systemPrompt` carrier가 없는 rail이므로 같은 현상을 같다고 가정하지 말고 별도로 측정한다.

**같이 닫을 결함.** (1) `entwurf_v2` MCP description은 6,775자로 Claude ACP와 순정 Claude Code 양쪽에서
`… [truncated]`가 재현됐다 — intent/owned-outcome/mode 계약을 잃지 않게 압축한다. (2) Claude SDK 고정 첫
문장과 trim된 `# Engraving Here`가 개행 없이 접합된다 — non-empty carrier의 auto-memory containment는
유지하고 경계만 고친다. (3) Co-Authored-By/Generated-with 지시와 유령 `Monitor` 참조는 순정 Claude Code에도
있는 upstream tool-description 드리프트다. entwurf가 native description을 덮지 말고, 정책 충돌이 실제
행동 위험이면 **짧은 non-empty operator engraving override**로 완화할지 명시적으로 결정한다.

**추가 런타임 결함 — absolute timeout × blind retry 증폭.** garden `20260730T184615-8eda64`의 실제 host
transcript는 같은 검수 prompt를 `prompt timed out after 600000ms`로 세 번 연속 실패한 뒤 네 번째 cold ACP
session까지 열고 `Aborted after 3 retry attempts`로 끝냈다. Claude overlay 자식 4개는 매번 full augment와
같은 prompt를 처음부터 받았다. 첫 두 자식은 timeout 직전까지 tool use가 계속됐고(두 번째는 2048자 cap까지
발견), 세 번째도 615KB transcript와 지속 tool activity가 있었다. 같은 시각 짧은 후속 턴은 37초 안에
`end_turn`했다. 따라서 서비스 혼잡이 지연을 키웠을 가능성은 열어두되, 현재 증거의 1차 원인은 **진행 중인
turn도 600초 wall-clock으로 절단하고 pi retry가 진척 없는 cold replay로 비용을 증폭하는 결합**이다. 이를
단순 “서비스 터짐”으로 닫지 말고 ACP Claude runtime 계약으로 재현·분류한다.

**Next.** (A) **닫힘 — 아래 "검증 실측 — axis A".** A-join은 loader-owned
`trim → CARRIER_LEAD_SEPARATOR → body` 순서로 수선했다. non-empty containment는 유지하며, fresh
`claude-opus-5` Q-L1이 SDK 고정 문장 뒤의 빈 줄과 독립 `# Engraving Here` header를 직접 인용했다.
carrier 귀속 self-report는 Opus 1표본이고, Sonnet은 system slot 격리 때문에 인용 불가였다는 한계를 보존한다.
(B) **닫혔다** — 아래 "검증 실측 — axis B". 소유 경계는 확인된 대로였다:
600초 absolute timeout은 `backend.ts`의 `PROMPT_TIMEOUT_MS`, 3회 replay는 pi 0.83의 기본 agent-level
`retry.maxRetries=3`이다(현재 global settings에 override 없음; provider-level retry 기본은 0).
`prompt timed out after 600000ms`는 pi-ai `isRetryableAssistantError`의 `timed? out`/`timeout` 사전에 정확히
걸린다. **정책 결정(유효): 정상 ACP prompt에 absolute wall-clock cutoff를 두지 않는다.** 도구 사용·추론·서비스
지연으로 오래 걸리는 turn은 끝날 때까지 계속 살아야 하며, elapsed time 자체는 실패 근거가 아니다. 종료 권한은
사용자 abort, pi shutdown, child exit/stdio EOF처럼 명시적 lifecycle 사건에만 둔다.

**B 구현 계약 — 전부 이행됨(검증은 아래 절).** bootstrap `initialize/newSession/set-model` 30초 유지 ✓.
`check-probe-ordering`의 production exact-match pin을 이 셋으로 좁히고 prompt cutoff 부재를 별도 static
oracle로 증명 ✓. probe의 `PROBE_PROMPT_OBSERVATION_MS`는 production 집합 밖에 두어 harness의 observation
horizon임을 게이트가 강제 ✓(folding back이 mutant `PROMPT-HORIZON-NOT-PRODUCTION`로 죽는다). `BridgeSession`이
stderr tail + child exit `{code, signal}`을 보존해 new/reuse 모두 lifecycle error에 실음 ✓. prompt-phase
lifecycle error가 `isRetryableAssistantError`에 false(pi의 실제 분류기를 import한 오라클) ✓.

**⚠ 이 컷이 이행하지 않은 절반 — 관측.** 원 정책은 "멈춤 의심은 죽이는 timer가 아니라 진행·상태를 드러내는
관측으로 먼저 다룬다"였다. 착지한 것은 **죽이지 않는 쪽뿐이다.** `sending prompt` 이후 entwurf가 내보내는
lifecycle notice는 없고, 조용한 턴의 가시성은 전적으로 백엔드의 `[tool:*]` 알림에 의존한다 — 도구를 쓰지 않고
추론만 오래 하는 턴은 여전히 무표시다. 별도 축으로 남기고, B가 관측까지 닫았다고 쓰지 말 것.

**후속 셀 — retained Sonnet child death의 회복성 (여전히 미착수, B 진단과 분리).** `20260730T194358-0061d2`는 4회
reuse 성공 뒤 tool 사용 중 `ACP connection closed`로 현재 turn이 error seal됐고, 다음 user turn에서 새 ACP child가
열렸다. B는 이 죽음의 이유를 밝혀 주고 clean teardown을 보장할 뿐, child 사망 자체를 막거나 이미 끊긴 in-flight
turn의 결과를 복원하지는 않는다. B LIVE 뒤 이 실제 셀을 재현/분류한다: (a) child가 왜 EOF했는가(exit/signal/stderr),
(b) config signature/context prefix가 바뀌지 않은 정상 retained turn에서 새 child가 열리지 않는가, (c) death 뒤 새
child가 열릴 때 full transcript replay·tool side effect 중복 없이 어떠한 explicit recovery contract를 제공할 것인가.
자동 replay는 non-idempotent tool 작업을 중복할 수 있으므로 증거 없이 켜지 않는다. **pi에는 새 `gnew`류 API나
recovery 동작을 추가하지 않는다** — pi 자체를 손대지 않는 경계다. closed connection 폐기와 model immutability는
유지하고, error는 exit/signal/stderr/lifecycle phase를 담아 투명하게 surface한다. 그 뒤 v2
description 압축과 Claude 접합부를 source+gate로 수선한다. 계약/gate 변경이면 독립 oracle + `[QK:*]` +
exact-once mutant를 함께 세우고 focused gate → `check-gate-qualification` → `pnpm check` 순서로 검증한다.
LIVE acceptance는 Claude provenance probe + 통제된 long-tool turn을 필수로 하고, common backend를 고치면 Cortex도
같은 timeout 셀을 재측정한다.

**Read.** `pi-extensions/lib/acp/{engraving,augment,tool-surface,backend-adapter}.ts`,
`pi-extensions/lib/acp/prompts/engraving.md`, `mcp/entwurf-bridge/src/index.ts`,
`scripts/check-acp-carrier-augment.ts`, `docs/acp-backend-rail.md`.

## 검증 실측 — axis A, carrier provenance + v2 description (2026-07-31 새벽, oracle)

**⑴ carrier provenance — augment가 자기 출처를 스스로 말한다.** 관측된 실패는 모델의 거짓말이 아니었다:
wire 위에서 긴 first user message와 system prompt는 **구분 불가능**하고, 블록 안에 어느 쪽인지 적혀 있지
않았다. 이제 적혀 있다 — 두 rail 공통 문장(`PROVENANCE_LEAD`)으로 "이것은 첫 사용자 메시지에 prepend된
것이고 네 시스템 프롬프트가 아니다", 그 뒤는 **rail별로 다르게**: claude는 "carrier(`_meta.systemPrompt`)가
있고 operator engraving만 싣는다", cortex는 "carrier가 아예 없다". 하나의 일반 문장이면 한쪽에서 거짓이 된다.

**이 rail 차이는 문서 주장이 아니라 소스에 결박했다** — `cortexAdapter.buildSessionMeta() → undefined`를
게이트가 읽는다(`CARRIER-RAIL-DIFF-IS-SOURCE-PINNED`). cortex가 나중에 carrier를 얻으면 프레임이 거짓이
되는데, 산문 검사로는 절대 못 잡는 종류다.

**⚠ 이것은 진술 가능성(stateability)이지 준수 강제가 아니다.** 모델이 그래도 추측하는 것은 막지 못한다.
사라지는 것은 "알 방법이 없었다"는 변명뿐이다. 이 절을 "모델이 이제 정직하게 답한다"로 읽지 말 것 —
그 주장은 LIVE probe로만 설 수 있고 이번 컷은 그것을 하지 않았다.

**⑵ `entwurf_v2` description — 실측 4,022자, 호스트 캡 2,048자.** 잘려나간 절반이 하필
**INTENT 계약 전체**였다: reject taxonomy, 세 값짜리 native-push probe, lock 범위 — intent를 골라야 하는
모델이 한 글자도 못 읽었다. **2,033자로 압축**했고 게이트가 요구하는 리터럴 16개를 전부 보존했다.
두 표면(pi-native template literal · MCP `+`-concat)이 렌더 후 **2,033자로 바이트 동일**임을 확인했다.

**캡 자체를 게이트로 세웠다** — `V2SURF-DESC-FITS-HOST-CAP`. 기존 assertion 121개는 전부 "문장이 소스에
있는가"만 보므로 **호스트가 절반을 버린 사실을 원리적으로 볼 수 없었다.** 측정 중 MCP 슬라이스가 14자
과다 계상되는 것을 발견해 앵커를 `CANONICAL`로 바로잡았다(캡 게이트가 틀린 숫자를 보고하면 그대로 인용된다).

**뮤턴트 정합성.** description 교체로 `V2SURF-MCP-LOCK-DOMAIN`·`V2SURF-MERGED-REJECT` 두 앵커가 죽어서
전 lane을 기계적으로 대조해 갱신했다. 신규 클레임 6종(`CARRIER-PROVENANCE-STATED`,
`CARRIER-FRAME-NAMES-CLAUDE-CARRIER`, `CARRIER-FRAME-DENIES-CORTEX-CARRIER`,
`CARRIER-RAIL-DIFF-IS-SOURCE-PINNED`, `V2SURF-DESC-FITS-HOST-CAP`, + prompt-lifecycle 8종) → **127 → 132**.

**⑶ LIVE 재측정 — 0.64.0 어댑터 하에서 (2026-07-31, oracle).** bump가 rail을 갈았으므로 B의 0.63.0 표본은
증거로 쓸 수 없어 둘 다 다시 돌렸다.
- `smoke-acp-raw-turn-live` **PASS** — launch source `package:@agentclientprotocol/claude-agent-acp`,
  `claude-sonnet-5`, `stopReason=end_turn`, **36,948 rawBytes** NDJSON.
- `smoke-acp-long-turn-live` **PASS** — elapsed **733,207ms**(은퇴한 600초 cutoff를 133초 초과), nonce 도달,
  cold ACP bootstrap **정확히 1회**(리플레이 0), retry/timeout 서명 0건.

**⑷ 최종 정적 축 (A + B + 0.64.0 bump + A-join 합산 트리).** `pnpm check` **EXIT=0**, qualification
**136/136 KILLED, 9 lanes**, `check-pack` **304 files**, **`check-pack-install` EXIT=0**
(pi 0.83.0 트리 핀 · loader가 host global이 아닌 pinned pi · exact 6-row curated set · installed hook이
node_modules-safe compiled JS). focused: `check-acp-sdk-surface`, `check-dep-versions`,
`check-acp-carrier-augment`, `check-entwurf-v2-surface`(123 checks), `check-acp-prompt-lifecycle`,
`check-probe-ordering` 전부 PASS.

## 검증 실측 — axis B, prompt lifecycle (2026-07-30 22:4x–23:3x KST, oracle)

**정적.** `pnpm check` **EXIT=0**, qualification **127/127 KILLED, 9 lanes**, `check-pack` **304 files**.
focused 재통과: `check-acp-prompt-lifecycle`(8셀), `check-probe-ordering`. qualification 뒤 트리 drift 0.
신규 claim 10종이 KILLED 목록에 이름으로 선다 — `PROMPT-STALL-NOT-KILLED`, `ABORT-SENDS-PROTOCOL-CANCEL`,
`ABORT-ESCALATION-BOUNDED`, `CHILD-EXIT-DIAGNOSED`, `REUSE-CARRIES-CHILD-DIAGNOSTICS`,
`PROMPT-ERROR-NOT-TRANSIENT`, `IDLE-DEATH-ANNOUNCED`, `RETIRED-TEARDOWN-NOT-ANNOUNCED`,
`NO-PRODUCTION-PROMPT-CUTOFF`, `PROMPT-HORIZON-NOT-PRODUCTION`.

**LIVE — `LIVE=1 ./run.sh smoke-acp-long-turn-live` PASS.** `entwurf/claude-sonnet-5`, 실 pi provider 턴이
**735,646ms** 살았다 — 은퇴한 600초 cutoff를 135초 넘겼고, nonce가 어시스턴트 답변에 도달했고, 영속
transcript의 cold ACP bootstrap은 **정확히 1회**(리플레이 0), retry/timeout 서명 0건. **이것이 벽시계
계약의 첫 실측이다** — 정적 게이트는 fake 상대이고 probe pin은 소스 상대라, 스택 전체(pi runner + retry
정책 + 실 어댑터 + 실 모델)가 긴 턴을 살려두는지는 이 축만 말할 수 있다.

**1차 LIVE는 미측정으로 폐기됐다(하네스 결함, 계약 아님).** 최초 설계가 `3 × sleep 240s`였는데 Claude
백엔드의 Bash 도구가 **foreground `sleep`을 정책으로 거부한다**("Foreground `sleep` is blocked; use Monitor
with an until-loop"). 모델이 명령을 detach하고 "백그라운드에서 돌고 있다"고 보고한 뒤 기다리겠다며 턴을
끝내서 **22.9초**에 nonce 없이 종료했다 — 긴 도구 작업 자체가 발생하지 않았으므로 PASS도 FAIL도 아닌
**미측정**이다. 작업 형태를 `python3 -c "import select; select.select([], [], [], 240)" && echo ROUND_COMPLETE`로
바꿔(같은 벽시계, `sleep` 미호출) 재실행한 것이 위 PASS다. 프로덕션 소스는 이 수정에 관여하지 않았다.
마지막 assert의 `/timed out|timeout/i`도 좁혔다 — 프롬프트가 도구 한도를 지시하므로 **모델이 자기 한도를
서술만 해도** 터지는 오탐이었다. 이제 결함의 실제 서명 셋(`prompt timed out after`,
`Aborted after N retry attempts`, `retry attempt N`)만 본다.

**세 가지 종료가 이제 증거로 갈린다.**

| 상황 | 증거 |
|---|---|
| 긴 정상 턴 | 아무 lifecycle 사건도 없으므로 봉인되지 않는다. `[acp: preparing claude session]` 1회 + 원 prompt에서 온 답 |
| 사용자 abort | ACP `session/cancel`이 **먼저** 나가고 `cancelled`→`aborted` 봉인, 협조하는 child에는 시그널이 안 간다. 무시하면 grace 뒤 SIGTERM + close, 그래도 aborted. 새 child 0개 |
| child 사망 | `ended while the prompt was still in flight (exit code N / signal S)` + session-scoped stderr tail. new·reuse 양쪽 동일. pi 분류기에 **비-transient** |
| 턴 사이 사망 | 다음 턴이 bootstrap 알림 **앞에서** `previous claude session ended between turns (…)`를 1회 announce. 우리가 한 teardown은 `retiring`으로 침묵 |

**Cortex는 이 호스트에서 못 돈다 — 정확한 blocker.** binary는 있다(`~/.local/bin/cortex`,
**Cortex Code v1.1.52**, thinkpad와 동일 버전). 없는 것은 **Snowflake connection**이다:
`~/.snowflake/connections.toml` 부재, `~/.snowflake/cortex/settings.json`은 `theme` 키 하나뿐,
`ENTWURF_ACP_CORTEX_CONNECTION` 미설정. `smoke-acp-cortex-live:197`이 이 변수로 게이팅되므로 지금 돌리면
honest-skip이다. 설치·설정·타 기기 우회는 하지 않았다. common backend(`mapPromptStopReason`·
`awaitAcpPromptTurn`은 adapter 분기가 없는 `backend.ts`에 있다)를 건드렸으므로 **cortex LIVE 재측정은
빚으로 남는다** — connection이 있는 호스트에서 `LIVE=1 ENTWURF_ACP_CORTEX_CONNECTION=<conn> ./run.sh
smoke-acp-cortex-live`.

## 검증 실측 (2026-07-30, oracle — `fea773f` 시점 숫자)

- 최종 구현 + 문서 정비 + § 참조 sweep 트리에서 `pnpm check` **EXIT=0**,
  qualification **117/117 KILLED, 8 lanes**, `check-pack` **301 files**.
- **`check-pack-install` EXIT=0 — 하드 미니멈의 실증.** 실제 tarball을 임시 트리에 설치해
  `every @earendil-works pi package is 0.83.0` / `loader runtime: pinned pi 0.83.0 (not the host's
  global pi)` / `exact 6-row curated set: claude 2 + cortex 4`를 확인했다. **이 게이트는 `pnpm check`에
  없다** — 핀을 움직인 컷은 반드시 따로 돌려야 한다.
- `check-claude-floor-coherence`, `check-dep-versions`, `check-acp-sdk-surface`,
  `check-acp-stop-reason`, `check-acp-cortex`, `check-acp-event-mapper` focused 재통과.
  상대 Markdown 파일 링크 0 broken.
- **정체성 축 확인.** 문서 압축 후에도 `garden id`(8파일)·`citizen`(11)·`thin bridge`(3)·`sibling`(7)·
  `기투` 생존, ROADMAP `Vocabulary guard` 절 유지, README 첫 문장 원문 유지. 정체성 게이트
  (`check-entwurf-session-identity`·`check-meta-identity-consumers`·`check-agy-sender-identity`·
  `meta-identity` lane) 전부 green.

## 검증 실측 — axis 2 (2026-07-30 18:0x–18:2x KST, thinkpad)

**두 번째 머신이 처음으로 섰다.** oracle이 `fea773f`를 푸시한 뒤 thinkpad에서 pi를 `0.82.1 → 0.83.0`으로
올리고(`pi update --self` — SSOT는 `nixos-config/scripts/external-packages.sh`, pnpm 재설치가 아니라
self-update다) `pnpm install` → `prepare` 훅이 `build-bridge`를 자동 실행해 dist를 재emit했다.

- **정적 축 재현.** `pnpm check` **EXIT=0**, qualification **117/117 KILLED, 8 lanes**,
  `check-pack` **301 files** — oracle과 같은 숫자.
- **`check-pack-install` EXIT=0 — axis 2 설치축.** `every @earendil-works pi package is 0.83.0` /
  `loader runtime: pinned pi 0.83.0 (not the host's global pi)` / `exact 6-row curated set` /
  dev-only gate refusal / installed store-doctor scan / self-fence(real DATA tree byte-identical).
- **`smoke-acp-raw-turn-live` PASS** — launch source `package:@agentclientprotocol/claude-agent-acp`
  (0.63.0), `initialize protocolVersion=1`, model set → `claude-sonnet-5`,
  **`prompt returned (stopReason=end_turn)`**, reply `"OK"`, 33103 rawBytes NDJSON.
  0.63.0 어댑터의 wire stop reason을 **실측**했다 — 0.62.0 표본 재사용이 아니다.
- **`smoke-acp-cortex-live` PASS (23 assertions)** — cortex **v1.1.52**(CP0-M이 실측한 그 버전),
  connection은 환경에서 주입. `agent_start` → **`agent_end` (no hang)** → **`no extension_error`**.
  이 세 줄이 stop-reason 하드닝의 cortex 리스크를 닫는다: cortex가 reason을 빠뜨리거나 닫힌 집합 밖
  값을 실었다면 새 `mapPromptStopReason`이 ERROR로 봉인해 `agent_end`가 아니라 `extension_error`가
  떴을 것이다. 함께 선 것 — D4 `autoUpdate:false`, D9 mcp.json projection, D10 dual-HOME 복원,
  CP0에서 빚으로 남긴 **아웃바운드 `entwurf_v2`**(cortex 모델이 자기 자신으로 배달, payload는 nonce
  정확히 그것뿐), process-group teardown `leaked: none`.

**어댑터 축은 cortex에 도달하지 않는다** — `backend-adapter.ts`의 cortexAdapter는 PATH의
`cortex acp serve`를 띄우고 `claude-agent-acp`를 `require.resolve`하는 것은 claudeAdapter뿐이다.
그래서 0.62→0.63 bump의 cortex 리스크는 0이고, 공유되는 것은 pi와 common layer
(`mapPromptStopReason`은 `backend.ts`에 있고 adapter 분기가 없다)다.

## 남은 것 — 이 순서로

1. ~~`LIVE=1 ./run.sh smoke-acp-raw-turn-live`~~ — **완료 (thinkpad, PASS).**
2. ~~`LIVE=1 ENTWURF_ACP_CORTEX_CONNECTION=<conn> ./run.sh smoke-acp-cortex-live`~~ —
   **완료 (thinkpad, PASS 23 assertions).** oracle의 cortex 미설치 blocker는 axis 2가 흡수했다.
3. ~~커밋~~ — `fea773f`로 완료·푸시됨.
4. ~~**B축 prompt lifecycle — 정적 + LIVE**~~ — **완료·커밋·푸시됨** (`9e406b1`). 위 "검증 실측 — axis B".
5. ~~**A-join 개행 수선**~~ — **완료, 미커밋.** loader-owned boundary + 4 claims, fresh Opus Q-L1 LIVE가
   독립 header를 인용했다. P1 합산 qualification은 **143/143**이다. 아래 axis A에 증거를 보존한다.
6. ~~**release-gate P1 skip 정직성**~~ — **완료, 미커밋.** protocol exit `97`, every-step invocation,
   diagnostic vs `--cut` authority, 7 QK claims, qualification **143/143**. P5 canonical command은
   `LIVE=1 ./run.sh release-gate <scratch> --cut`; bare invocation은 SKIP을 보이는 진단일 뿐 acceptance가 아니다.
7. ~~**실 delivery coverage**~~ — **완료, 미커밋.** Cortex/spawn-live/Claude native resume은 MUST에 편입했고,
   (`spawn-live`는 이후 visible-first cut에서 transport와 함께 삭제됐다 — 지금 MUST에 없다.)
   native Claude Code → pi GPT-5.4 → pi ACP Claude Sonnet → mailbox terminus의 실제 chain은 23 assertions으로
   PASS했다(각 hop sender gid/replyable, 지름길 배제, durable mailbox read receipt). long-turn은 aggregate 밖의
   on-demand lifecycle acceptance라 final source set에서 별도 LIVE 재실행 중이다. 현재 oracle `--cut`은
   Cortex connection 부재 하나만 SKIP=1로 정직하게 BLOCKED한다.
8. ~~**thinkpad final cut + implementation commits**~~ — **닫힘 (oracle, 2026-07-31).** Cortex는 external
   Snowflake connection을 요구하는 documented on-demand axis로 aggregate에서 제외했고 carry-forward로만
   기록했다. final `LIVE=1 ./run.sh release-gate <scratch> --cut`은 MUST `PASS=20 FAIL=0 SKIP=0`,
   BEHAVIOR `PASS=1 FAIL=0 SKIP=0`, `cut: OK`; final long-turn은 733,635ms / one bootstrap / no replay.
   `429d5c3` implementation과 `4150c50` prepare commit이 닫혔다. **다음은 GLG의 명시적
   `/entwurf-release make 0.13.1` authority뿐이다.**
   **CHANGELOG 첫 항목은 pi floor가 0.82.x 설치를 깬다는 사실이어야 한다** — patch 번호가 실어주지
   않는 신호를 산문이 대신 싣는다. `0.14.0`은 CODEX 지원에 예약돼 있다(GLG).
9. ~~**mux capability lane**~~ — **닫힘·머지됨 (2026-08-07).** visible fresh call + visible same-id
   resume. `1750af4` · `d8d9452`, CI green. 위 NOW 첫 항목 참조. 이 컷의 범위가 넓어졌으므로
   `prepare` 때 CHANGELOG는 dep bump뿐 아니라 mux verb 두 개를 함께 실어야 한다.
10. ~~**dep bump — pi `v0.84.0` / claude-agent-acp `v0.65.0`**~~ — **닫힘 (2026-08-07, main).**
    측정·해시·성격 판정은 ROADMAP.md **Dep bump(별도 트랙)** 2026-08-07 항목이 SSOT다. 다음 lane이
    알아야 할 durable한 결론만 남긴다:
    - **acp 0.64.0 → 0.65.0은 세 번째 성격이다** — adapter-code 릴리즈이면서 선언 런타임 의존성은
      불변. 0.61→0.62(dist 동일+dep 이동)도 0.62→0.63(dist 이동+dep 이동)도 아니므로 **그 두 논거를
      재사용하면 안 된다.** 순 기능 델타 둘(#930 permission `_meta`+재라벨링, #958 steered turn을
      `idle`에서 settle). #938은 0.64.1 랜딩 → 0.64.2 revert로 순 델타 0.
    - **도달성은 기능별로 따로 판정한다.** #930은 우리 wire에 **실제로 온다** —
      `resolvePermissionResponse`가 라벨이 아니라 `kind`로 골라서 무해한 것이지 기능이 off인 게 아니다
      (라벨 독립성 주장). #958은 `session/steer`를 보내지 않아 구조적 미도달.
    - **pi 천장 논거가 바뀌었다.** `compat.ts`는 여전히 바이트 동일이지만 `loader.ts`는 아니다.
      앞으로 pi 천장은 "두 파일 동일"이 아니라 **diff를 읽고 도달성을 판정**해서 올린다.
    - **pi 런타임 별자리가 커졌다** — `check-pack-install`이 `pi-client`/`pi-protocol`을 핀한다.
    - peer floor는 기계적 상향이 아니라 재실측이다: claude-agent-sdk 0.3.220 → `>=0.93.0` 불변,
      `@anthropic-ai/sdk 0.100.1` 유지.
    - **이 bump가 닫지 않은 것 둘.** ⑴ `check-acp-sdk-surface`에는 `[QK:]` claim도 mutant manifest도
      없다 — capability lane에 meta-infra를 태우지 않으려고 만들지 않았다. 그래서 이 게이트는
      `check-gate-qualification`이 지키지 않는다. ⑵ #930은 **실제 permission 왕복 LIVE 표본이 없다**;
      kind 기반 선택의 무해함은 소스 실측까지가 증거다.
11. **issue #62 — vitest 도입과 손으로 지은 검증면 감산.** ← **NEXT**. **별도 브랜치**에서 연다.
    capability lane이나 main에 meta-infra를 태우지 않는다. 이슈 본문에 Phase 0–4와
    게이트 작성 교훈이 실려 있다. 위 10번이 남긴 mutant manifest 부재도 이 lane에서 함께 볼 후보다.

## 미결 — 이 컷이 주장하지 않는 것

- ACP rail의 §11-7 probe/ordering lane은 여전히 **instrument admissible, measurement owed**다. 첫 paired run은
  inconclusive이고 inconclusive는 "문제 없음"이 아니다. 게다가 그 표본은 0.62.0 어댑터 기준이다.
- 0.63.0의 세 upstream fix 중 어느 것도 readiness fence가 아니다. `mcpServerStatus()`는 여전히
  호출되지 않는다. bump를 readiness 수정으로 쓰지 말 것.
- **axis 2(두 번째 머신)는 이제 인증됐다** — thinkpad에서 정적·설치·LIVE 셋 다 GREEN(위 "검증 실측 —
  axis 2"). 다만 **linux 두 대**일 뿐이다: macOS/WSL2는 계속 비인증이고, axis 2가 섰다고 OS 축이
  섰다고 쓰지 말 것.
- cortex LIVE는 **v1.1.52 한 버전, connection 하나**의 표본이다. cortex가 올라가면 stop-reason 표면은
  다시 측정 대상이다 — 이번 PASS를 cortex 일반에 대한 보증으로 쓰지 말 것.
- **B축 LIVE는 claude-sonnet-5 한 모델, 735초 한 표본이다.** "벽시계가 없다"는 소스·게이트가 지고,
  LIVE가 진 것은 "실제로 600초를 넘겨 살아서 한 턴으로 끝났다" 하나다. 무한히 산다는 주장이 아니다.
- **B는 abort·child death를 관측된 실전 셀로 재현하지 않았다.** 그 둘은 fake ACP child 상대의 게이트가
  진다. `20260730T194358-0061d2`의 실제 sonnet reuse 사망은 여전히 재현 미착수다(위 "후속 셀").
- **관측(진행 표시) 축은 열려 있다.** B는 죽이지 않는 쪽만 닫았다.
- **Cortex overlay skills projection (deferred, entwurf 소관).** 실제 Cortex ACP overlay는
  `$HOME/.snowflake/cortex/plugins`만 seed하고 `skills/`는 비워 둔다. host
  `~/.snowflake/cortex/skills`의 40개는 `./skills/` SSOT 링크가 아닌 흩어진 복사본이라 drift 중이며, session은
  그 host HOME도 보지 못한다. GLG 방향: overlay builder가 overlay의 Cortex skills 위치에
  **host `~/.claude/skills/`를 연결**해 Cortex가 격리된 HOME 안에서도 공통 skill surface를 읽게 한다.
  containment(overlay-private config/auth/mcp)는 유지하며, global host tree 전체를 mount하지 않는다. 구현 전
  Cortex의 actual discovery path·symlink 허용 여부·host `~/.claude/skills`의 SSOT/ownership을 3-link fixture로
  확인하고, source+gate+fresh Cortex session에서 skill 목록을 실측한다. `agent-config` 문서의 direct-host skill
  parity 문구도 이 ACP overlay 예외를 한정해 고친다. **함께 수선:**
  `docs/acp-backend-rail.md` D1–D2의 `~/.cortex` 표기는 실재 host 경로가 아니다. Cortex skill/config
  경로는 `$SNOWFLAKE_HOME/cortex/`(실측 host `~/.snowflake/cortex/`, overlay도 그 하위)로 바로잡고,
  `~`가 overlay HOME으로 확장된다는 사실을 문서의 host/overlay 좌표에 명시한다.
- **A축 stateability LIVE는 제한적으로 섰다.** fresh Sonnet Q-L1은 provenance frame을 정확히 읽었지만
  system slot을 인용할 수 없었고, fresh Opus Q-L1만 SDK 문장 + blank line + 독립 carrier header를 인용했다.
  따라서 carrier 귀속 self-report는 Opus 1표본이며, Q-B0-CARRIER의 네 surface(system / augment / schema /
  system-reminder) 전체 귀속표는 아직 미측정이다. LIVE는 자기관찰 보고이지 wire dump가 아니다; 게이트는
  rendered/wire contract와 rail-correct 문구를 지고, SDK 고정 문장은 upstream literal을 우리가 재현한 한계가 있다.
- **0.64.0의 elicitation 마커 도달성은 이 델타에 한정된 주장이다.** 다른 축(terminal capability,
  subagent transcript, readiness)으로 일반화하지 말 것. bump는 readiness fence를 추가하지 않았다.
- **`entwurf_v2` 압축은 2,033/2,048자다 — 여유가 15자뿐이다.** 문장을 늘리면 캡 게이트가 먼저 막지만,
  늘릴 자리가 거의 없다는 사실 자체를 알고 있을 것.
- **idle-death announce map은 운영 hardening 빚이다.** `unreportedChildEnds`는 다음 turn이 없는 sessionKey를
  read-and-clear하지 못해 process 수명 동안 누적될 수 있다. 값은 `{code, signal}`뿐이고 B의 투명성 계약을
  깨지는 않으므로 이번 컷은 막지 않는다. 다음 lifecycle hardening에서 bounded retention/GC 정책을 정한다.

# DO NOT

- 로컬 커밋을 이미 push됐다고 쓰지 말 것. push는 GLG의 현재 세션 명시 요청이 있어야 한다.
- 한 모드 호출을 다음 모드 권한으로 읽지 말 것. `prepare`는 `land`이 아니고 `make`는 `publish`가 아니다.
- 0.63.0 도달성을 "전부 미도달"로 요약하지 말 것. 축별로 측정된 것만 쓴다.
- 0.61→0.62의 byte-identical 논거를 0.62→0.63에 재사용하지 말 것.
- terminal capability를 mapper 수선 없이 켜지 말 것.
- readiness fence 구현 금지 — ACP rail §11-7/#55 소유.
- `check-gate-qualification`/`pnpm check` 중 tree를 건드리거나 `NEXT.md`를 저장하지 말 것. work-surface
  hash가 움직이면 증거가 무효다. `.ts` 수정 뒤 `pnpm run build-bridge`를 빼먹지 말 것.
- 새 게이트가 `.tmp-verify`를 비운 채 남기지 말 것 — 빈 부모 디렉터리가 IMPURE tree drift로 읽힌다.
- **문서를 크게 줄인 뒤 § 참조 sweep을 빼먹지 말 것.** 2026-07-30 rail 1317→198줄 압축에서 죽은
  §번호 13건이 소스·게이트·ROADMAP에 남았다(`§4`·`§6`·`§9-x`·`§10`·`§11-3`). 살아있는 섹션 이름으로
  가리켜라. 확인: rail 앵커는 `11-7`/`11-7-a/b`/`11-7-c`뿐이다.
- **주석을 고치기 전에 그 줄이 mutant `find` 앵커인지 확인할 것.** `backend-adapter.ts`의
  `(rail: Adapter contract)` 주석은 `acp-cortex.json`의 `CORTEX-ENFORCE-SET-MODEL`이 유일성 확보용
  context로 쓴다. 소스만 고치면 MUTANT-STALE로 죽는다 — 소스와 매니페스트 `find`/`replace`를 함께 옮겨라.
- **핀을 움직인 컷은 `check-pack-install`을 따로 돌릴 것.** `pnpm check`에 들어있지 않아서 아무도
  안 돌린 채 green으로 착각하기 쉽다.
- **LIVE 하네스에서 백엔드에 `sleep`으로 긴 작업을 시키지 말 것.** Claude의 Bash 도구가 foreground
  `sleep`을 거부하고 모델이 detach해버려서, 긴 턴을 측정하려던 실행이 22.9초에 끝난다. 벽시계를 태우려면
  `python3 -c "import select; select.select([], [], [], N)"`처럼 `sleep`을 호출하지 않는 blocking 명령을 쓴다.
- **LIVE assert에 `/timeout/i` 같은 넓은 정규식을 쓰지 말 것.** 모델이 자기 도구 한도를 서술만 해도
  완벽한 실행이 터진다. 결함의 실제 서명(`prompt timed out after`, `Aborted after N retry attempts`)만 본다.
- **`pnpm format`(`biome check --write .`)을 부분 수정에 쓰지 말 것.** 손대지 않은 게이트 파일의 기존
  lone-block 경고까지 자동 수정해 트리를 오염시킨다. 고친 파일만 `npx biome check --write <file>`.
- **모델이 읽는 문구를 고쳤으면 그 문구를 앵커로 쓰는 뮤턴트를 함께 옮길 것.** 2026-07-31 v2 description
  교체에서 `V2SURF-MCP-LOCK-DOMAIN`·`V2SURF-MERGED-REJECT` 앵커 둘이 한 번에 죽었다. 매니페스트를 기계적으로
  대조하는 스크립트를 돌려라 — 눈으로 찾지 말 것.
- **한 `[QK:*]` 토큰을 여러 assertion에 붙이지 말 것.** qualification이 exact-once로 거부한다. 서로 다른
  것을 보는 assertion이면 **클레임을 쪼개고 뮤턴트도 각각** 세워라(그게 커버리지도 낫다).
- **description/프롬프트 길이는 "있는가"가 아니라 "잘리는가"로 볼 것.** 호스트 캡은 2,048자다. presence
  assertion 121개가 전부 green이어도 호스트가 절반을 버린 것은 원리적으로 안 보인다 —
  `V2SURF-DESC-FITS-HOST-CAP`이 그 축을 진다.
- **상류 lock의 의존성 이동을 우리 트리의 사실로 옮겨 적지 말 것.** 0.64.0에서 상류
  `@modelcontextprotocol/sdk` 1.29→1.30은 **그들의 dev 트리**이고 우리 해석은 1.29.0 그대로였다. 설치 후 실측해라.
- **carrier provenance 프레임을 "모델이 이제 정직하게 답한다"로 쓰지 말 것.** 이번 컷이 세운 것은
  진술 가능성뿐이다. 준수는 LIVE probe로만 설 수 있고 아직 하지 않았다.
