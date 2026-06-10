# NEXT.md — pi-shell-acp

> 다음에 할 일만 남긴다. 로그가 아니다.
> 결정 trace 와 evidence 는 commit history / CHANGELOG / VERIFY / BASELINE / README / AGENTS / 코드로 보낸다.
> **0.10.0 (meta-bridge: garden-native async delivery / install / doctor, Claude Code only) = SHIPPED**
> — `v0.10.0` 태그(push 완료) + CHANGELOG `## 0.10.0 — 2026-06-06`. 전체 trace는 거기. NEXT는 더 안 들고 있는다.

## Active — 0.11.0: entwurf tmux-live lifecycle, pi = 4번째 메타 백엔드 (#35)

> **상태: 설계 동결 (2026-06-09, GLG + GPT힣 + Claude 3자 수렴). 각 요소 실측 완료 — 구현 세션
> 진입 시 설계 재탐색 불필요.** 아래 검증 원장의 항목은 다시 찌르지 말 것(doctor 실패/구체 버그만 예외).
> 구현 세션은 각 요소의 regression gate를 먼저 만들고, 그 다음 빌드 + 연결한다.
> **2026-06-09 언어 확정: Go 드롭, 순수 TS.** pi-trust를 소스까지 파보니(아래 검증원장) Go 재구현은
> 5겹 drift, node helper를 쓸 거면 단일-바이너리 명분이 사라지고, fact 레이어·cross-harness MCP 표면은
> 이미 0.10.0 TS 자산이다. 핵심 통찰(brain↔hand)은 유지, 언어 바인딩만 TS로.

**원칙 (장기 지침, 흔들지 말 것):**
- **No new language in 0.11.** 새 언어/바이너리 표면을 만들지 않는다. 코드 표면 최소화가 우선.
- **pi-interface-centric.** pi의 진화와 우리 프로젝트의 진화가 같이 간다 — pi raw semantics는 pi
  public export를 직접 import해 따라간다(재구현 금지). 인터페이스를 pi 수준으로 맞춘다.
- **하네스 백엔드(claude/codex/agy)에 휘둘리지 않는다.** 그들이 fact를 얻는 경로는 standalone
  binary가 아니라 pi-tools-bridge MCP. pi 중심을 보존하고 백엔드는 MCP 소비자로 둔다.
- **하드 게이트 통과 필수.** 모든 코드는 이 repo `pnpm check`(biome lint + tsc + 전 smoke/check
  게이트)를 전부 넘어야 한다. 새 표면마다 게이트 동반.

**▶ 다음 한 걸음:** Stage 0 **step 3D-2 = live receipt dual-write only**.
`enqueueMetaMessage` / `readMetaInbox`가 기존 `record.delivery.*` stamp를 **유지하면서** mailbox receipt
state(`meta-mailbox/<gardenId>/state.json`)도 stamp한다. **additive only** — delivery 제거 / v2 upsert 연결 /
capability consumer 전환 금지. `smoke-meta-mailbox`는 깨지면 안 된다. (순수 TS, push 아직 안 함.)
다음 구현 세션 계약 — 이 7개는 본문 동결결정/Trust 2층/Stage 0의 재확인이며 다시 흔들지 말 것:
1. **Stage 0 step 1·2 = pi 0.79 bump/import/runtime guard + TS preflight module/gate 완료.**
2. **설계 재탐색 금지** — 검증 원장 항목 다시 찌르지 말 것(doctor 실패/구체 버그만 예외).
3. **regression gate 먼저 작성** (각 요소 테스트가 빌드보다 선행).
4. **그 다음 구현** (각 요소 gate→build→연결).
5. **untrusted controlled launch = fail-fast** (조용한 degraded 금지).
6. **launcher는 사용자에게 trust flag를 노출하지 않되 내부적으로 `--approve`를 붙임**
   (preflight가 trusted 판정 → 내부 `--approve`; controlled launch는 handler 의존 금지).
7. **`--no-approve` degraded 기본 금지.**
(전체 순서는 아래 "Stage 0 순서", 근거는 "동결 결정" + "Trust 2층". precedence는 동결결정 8.)

**개념 닻 = #35 (SSOT, workshop≠factory).**
bbot가 일부러 컨셉만 담았다. 아래는 그 frame 위에서 GLG와 동결한 *설계*다.

### 왜 0.11.0인가 — 전략 전환
- 현 entwurf spawn은 `pi -p` headless 전용 → **pi만 분신이 된다.** Claude를 분신으로 부르려면 Claude
  Code를 *live interactive* 로 띄워야 하고, native는 headless live 불가 → **tmux가 launch surface**
  (`claude -p`/`pi -p`는 fresh-context·disposable이라 live 분신 surface 아님).
- **ACP 중심에서 내림(유지·관리는 계속).** 6/15 이후 ACP 사실상 미사용(antigravity 미지원, claude/gemini
  미사용, pi codex 네이티브). 1.0.0 = pi-shell-acp는 `plugins/`로, 프로젝트 중심은 **meta-bridge entwurf**.
- **pi = 4번째 메타 백엔드.** `META_BACKENDS += "pi"`. THE 하네스에서 garden-id 동료 시민으로 (North
  Star "no backend is privileged" 현금화). **순서: pi headless/tmux-live 먼저 + 테스트 → 그 다음 Claude
  Code ↔ Claude Code live.**

### 넘으면 안 되는 선 (전부 #35)
- **Workshop, not factory.** 살아있는 소수 도제 = 재질문 가능, 상태는 세션 안 → 외부 DB(beads/dolt) 금지.
- **GC = tmux 프로세스 자원 회수만, 데이터 삭제 절대 아님.** meta-record/transcript(denote-id 기억층)는
  남김. Phase 4 data prune(listing-only)과 **별개 cleaner 표면** — collapse 금지.
- **garden-id = authority, tmux = ephemeral.** 세션명=path(grouping), window 번호 renumber.
- **Factory 작업 OUT.** worktree·merge-wall fan-out 없음 → 백엔드 자체 orchestrator로 위임.

### 핵심 아키텍처 — 데이터 4분리 + 한 동사
- **record(누구였나)** / **capabilities(무엇·어떻게 깨움)** / **mailbox(메시지·receipt)** /
  **probe(지금 살아있나, 저장 안 함 — 매번 계산)**. 상태를 저장하면 거짓말이 된다(denote-instinct 함정).
- **두 레인 둘 다 KEEP:** `pi -p` headless(오케스트레이션, 가벼움) + tmux-live(`--entwurf-control`
  소켓, 도제). resume/send는 세션 type이 아니라 **현재 liveness의 함수** — dormant→resume, live→send.
- **entwurf = 한 동사 (새 `entwurf_v2`로 통합, 레거시 공존 — 동결결정 10).** spawn/resume/send는 probe 결과의
  내부 디스패치; low-level primitive는 숨기되 유지. resume↔send는 caller 선택이 아니라 **liveness의 함수**
  (dormant→resume, live→send)를 단일 동사가 call-time 계산. **`entwurf_peers` = 읽기 전용 fact 표면**
  (liveness/capability/identity/cwd-이력만 보고) — `resumable`/`sendable` 같은 **verb-routing을 fact 층에
  굽지 않는다**(그러면 헛나감). **기존 `entwurf`/`_resume`/`_send`는 완전 전환까지 유지**(Claude 3주체 라이브).
- **브레인 ↔ 핸드 분리 (둘 다 TS).** 브레인=**TS fact 모듈** — disk SSOT(meta-record)를 읽어
  `activeEntwurfs` in-memory Map(= pi 프로세스 1개의 기억이라 형제가 못 봄 = 현 비가시성의 근본)을
  대체. 0.10.0 `meta-session.ts`(`scanByNativeId` 등) 재사용 + 소켓/tmux/pid probe. cross-harness
  노출은 **기존 `entwurf_peers` MCP**(standalone 바이너리 아님). 핸드=기계적 실행(기존 TS primitive
  재사용). **최종 형제 선택은 에이전트, 모듈은 근거 제공.** (쿼터·시스템 부하 같은 **부가 신호는 substrate가
  아니라 에이전트 층** — 각 백엔드 liveness가 동작한 *다음* 얹는다. 아래 backlog "부가 신호".)

### 검증 원장 — 실측 완료 (2026-06-09, 설계 재탐색 불필요)
| 요소 | 실측 결과 |
|---|---|
| tmux 3.6a | `@garden_id` 유저옵션 `list-panes -a -F` 라운드트립 OK(Claude 재실측 2026-06-09: `#{@garden_id}`+`pane_id`+`pane_pid` 동시 round-trip 확인). **`pane_title`은 shell/tmux 환경 의존이라 correlation authority 금지**("항상 덮어씀"은 과한 주장 — PS1/PROMPT_COMMAND 의존; authority로 안 쓰면 충분). 안전 필드만: `@garden_id`+`pane_id`+`pane_pid` |
| **pi 0.79 public export** | `hasProjectTrustInputs`/`ProjectTrustStore`/`getAgentDir`/`VERSION` 모두 index public export 확인 → TS 직접 import 가능(재구현 불필요). **repo는 2026-06-10 현재 0.79.1 핀(0.78→0.79.0→0.79.1 완료).** |
| pi 0.79 trust | `pi -p`는 **trust에서 안 멈춤**(비대화 미결정→`false` degraded). `--approve`(`trustOverride=true`)가 맨 앞 short-circuit. store=`~/.pi/agent/trust.json`. **0.79.1 변경: `ProjectTrustStore.get`이 cwd 정확-매치 → nearest-ancestor walk-up(`findNearestTrustEntry`)으로 바뀜** — 조상 cwd의 저장 결정을 자식이 상속한다. operator가 `~/repos/gh`를 distrust로 찍으면 그 아래 전 repo가 saved-false 상속(= 동결결정 8 precedence의 production 절반). `check-pi-preflight` 13 assertion에 못박음(2026-06-10). |
| trust input 정의 (0.79.1 소스 실측) | `hasProjectTrustInputs`: `.pi`는 **cwd 한정**(`hasProjectConfigDir`), `.agents/skills`만 root까지 walk. **0.79.1에서 `AGENTS.md`/`CLAUDE.md`(`CONTEXT_FILE_NAMES`)는 trust input에서 제거됨** — 이제 trust-gated 입력이 아니라 "항상 로드되는 context file"로 분리됨(npm 0.79.1 diff·실측 확인). canonicalize=`realpathSync`(없으면 raw 폴백). `CONFIG_DIR_NAME`은 `pkg.piConfig.configDir` override 가능(우리 repo는 override 없음 → `.pi`). **AGENTS-only repo는 0.79.1에서 fail-fast가 아니라 trusted-no-arg**, 그리고 우리 AGENTS 주입(`enrichTaskWithProjectContext`/`buildPiContextAugment`)은 trust와 무관한 자체 경로라 계속 동작한다. (디테일 베끼지 말고 pi 함수 직접 import) |
| **pi 0.79 trust API (확정, 재탐색 불필요)** | `--approve`/`-a`→`projectTrustOverride=true`(project 파일 **로드**), `--no-approve`/`-na`→`false`(project 파일 **무시**·degraded). handler `on("project_trust", (e:{cwd}, ctx:{mode,hasUI,ui}) => {trusted:"yes"\|"no"\|"undecided", remember?})`. `getAgentDir()`는 `PI_CODING_AGENT_DIR` honors → 테스트 격리는 그 env(0.10.0과 동일) 또는 주입 |
| meta v1 | schemaVersion=1, `lastSeen`+`delivery{}` 있음, `model`/`parentGardenId`/`isEntwurf` 없음. 디스크 claude-code v1 10+개 |
| **model@birth 없음** | Claude SessionStart stdin=`{session_id,transcript_path,cwd}`, `MetaMintInput`에 model 없음 → **v2 model/transcriptPath는 nullable** |
| pi liveness | 소켓 = `~/.pi/entwurf-control/<gid>.sock`(파일명=garden_id). **LIVE/STALE authority = portable socket connect + RPC `get_info`** — 이 repo `entwurf-control.ts`에 이미 있음: `isSocketAlive`(`net.createConnection`)·`getLiveSessions`·`getLiveSessionsWithInfo`(get_info로 cwd/model/idle enrich)·`gcStaleSockets`(connect 안 되는 소켓 unlink). **`ss -xlp`/`kill -0`은 Linux 실측·디버그 보조일 뿐 design authority 아님**(ss=Linux 전용, macOS 없음, pid 권한 의존). Claude 실측 2026-06-09: 소켓 3개 중 1개 STALE 확인(sweep 필요 실증) |
| pi tmux 부팅 | 강제 `--session-id <gid>` + `--entwurf-control` launch surface OK. **correlation=소켓파일명+@garden_id (environ PI_SESSION_ID는 상속/exec-snapshot이라 폐기)**. **GPT 재실측 2026-06-09: `pi --session-id <gid> --entwurf-control --approve --provider … --model …` → 소켓 생성·trust prompt 없음·TUI ready·모델 호출/토큰 0** = controlled invariant(`--approve` 주입)의 live-smoke로 게이트화 가능. (단 `--approve` 없는 no-prompt는 saved trust/prefix 상태 의존이라 설계 근거로 안 씀.) |
| pi 확장 API | `SessionStartEvent` 존재 → pi가 session_start에 meta-record upsert 가능(4th backend 경로) |

### meta-record v2 (nullable-at-birth)
```jsonc
{ "schemaVersion": 2, "gardenId":"…", "backend":"pi|claude-code|codex|antigravity",
  "nativeSessionId":"…", "cwd":"…",
  "model": null, "transcriptPath": null, "parentGardenId": null, "isEntwurf": false,
  "createdAt":"…", "recordUpdatedAt":"…" }
// 제거: status·lifecycle·wakeMode·deliveryLevel·delivery.*·trusted·tmuxTarget
// recordUpdatedAt = record touch time(이름으로 못 박음), liveness 아님
```
- **`model`/`transcriptPath` nullable 근거:** Claude SessionStart는 birth에 transcript_path를 주지만
  pi backend는 birth(session_start upsert)에 미확정일 수 있음 → 최소공통(minimum common denominator)
  으로 nullable, 이후 채움. model은 어느 백엔드도 birth stdin에 없음.
- **기존 v1 게이트는 의도적 재작성 대상.** v2가 `delivery.*`→mailbox state, `wakeMode`→capabilities.json
  으로 옮기므로 0.10.0 `check-meta-session`(receipt-in-record)·`smoke-meta-mailbox`·backend↔wakeMode
  단언 일부가 **깨진다 = update 대상이지 regression 아님.** dual-read 경로엔 v1 fixture 게이트를 별도 유지.
- **구현 계약(step 3 순서):** `parseMetaRecordV1/V2`·`normalizeMetaIdentity`는 아직 없음(현재 단일
  `parseMetaRecord` meta-session.ts:283) = 미실측이 아니라 **신규 작업.** 게이트 먼저: **v1 fixture를 golden으로
  고정 → `normalizeMetaIdentity` 출력을 golden assert → 그 다음 v2 writer를 붙인다.**

### 동결 결정 9개
1. 능력 레지스트리 = 새 파일 `entwurf-capabilities.json` (targets=launch allowlist와 별 관심사)
2. v1→v2 = `parseMetaRecordV1/V2`→`normalizeMetaIdentity` dual-read + lazy normalize, 새 write는 v2.
   v1 receipt 필드는 읽되 v2에선 mailbox state로 이동
3. correlation = 소켓파일명 + tmux `@garden_id`. **env probe 폐기 + launcher가 identity env scrub/명시
   override**(상속 누수 차단; lineage는 `PARENT_SESSION_ID`를 launcher gid로 명시 set)
4. **preflight/facts owner = 단일 TS 모듈** (`pi-extensions/lib/entwurf-preflight.ts` 예정). TS
   launcher / global `project_trust` handler / MCP fact tool 모두 **그 결과만 소비** — 누구도 prefix/
   trust.json 판정을 재구현하지 않음. pi raw trust는 그 모듈이 pi public export를 직접 import.
   **주입 가능 시그니처**: `preflight({cwd, agentDir?=getAgentDir(), prefixRoots?=operator config})` —
   tests는 temp agentDir(또는 `PI_CODING_AGENT_DIR`, 0.10.0과 동일 격리)만 써서 real
   `~/.pi/agent/trust.json`을 읽거나 오염하지 않는다. **trust ≠ discovery**: trust 판정(`ProjectTrustStore`
   락 read)은 **launch-time 단일 cwd**만; `peers`/`who-can` discovery는 trust 불필요(스토어 안 건드림,
   `scanByNativeId`+probe 재사용). `plan` JSON은 explicit target일 때만. **최종 형제 선택은 에이전트.**
5. untrusted controlled launch = **fail-fast** (조용한 `--no-approve` degraded 금지). 근거(0.79.1 소스 확정):
   pi `--no-approve`(`-na`)는 "거부"가 아니라 **trust-gated project-local(`.pi/settings.json`·`.agents/skills`)을
   무시하고 degraded 실행.** trusted만 `--approve`(project 파일 로드), 아니면 throw.
   **(0.79.1 갱신:** 예전 근거였던 "repo `AGENTS.md`를 못 받아 담당자 컨텍스트가 깨진다"는 **무효** — 0.79.1에서
   AGENTS.md/CLAUDE.md는 trust-gated가 아니고, 우리 담당자 주입은 `enrichTaskWithProjectContext`/
   `buildPiContextAugment` 자체 경로라 trust와 무관하게 동작한다. fail-fast의 진짜 근거는 **untrusted repo의
   `.pi/settings.json`이 bridge `loadProviderSettings`로 적용되는 위험** — 아래 정렬 가드의 bootstrap reader.)
6. `project_trust` handler `remember` = **false** (prefix policy = SSOT, trust.json 안 더럽힘).
   **carve-out(Fable 검수 F5b, 2026-06-10):** `remember:false`는 **prefix-policy 한정**이다. **인간이 명시적으로
   상속-distrust를 덮어쓴 child override**(handler가 직접 prompt → yes)는 **`remember:true`로 trust.json 저장**
   — prefix 자동승인이 아니라 사람의 직접 선택이라 정당. (상세는 아래 Fable 검수 섹션.)
7. prefix auto-approve roots = **operator policy, NOT package default** (보안). 이 repo는 public
   package라 broad auto-approve(`~/repos/gh` 전체 등)를 패키지 기본값으로 하드코딩하면 타 사용자에게
   security footgun. source = **trusted operator surface만** — `PI_SHELL_ACP_TRUST_ROOTS` env /
   user-global settings / agent-config 주입. **project-local `.pi/settings.json`·project package·cwd
   resource는 trust 결정 입력으로 절대 읽지 않음**(untrusted 입력으로 trust 정하면 순환/취약). match =
   **canonical path + separator boundary**(pi와 동일 정규화; `/org`는 `/org/a` 매칭, `/org2` 불매칭 —
   bare `startsWith` 금지). **GLG 환경 기본값**(설정으로 활성) = `~/repos/gh`, `~/repos/work`, `~/org`
   (**`~/repos/3rd` 제외**). roots 정책은 **preflight 모듈 한 군데** 소유; tests는 fixture roots 주입.
8. **precedence 동결:** `saved false > saved true > prefix match > no-trust-inputs > fail-fast`.
   명시적 distrust(false)는 prefix보다 강함; prefix는 **미결정(null)만 yes로 승격**; trust input이
   없으면 trusted지만 launch arg 없음; 그 외 unknown/untrusted controlled launch는 fail-fast.
9. **import surface = public root export만** (`@earendil-works/pi-coding-agent`의 `getAgentDir`,
   `hasProjectTrustInputs`, `ProjectTrustStore`, `VERSION`, + handler 타입 `ProjectTrustEvent`/
   `ProjectTrustEventResult`/`ProjectTrustHandler`). `/dist/core/...` private subpath import 금지 —
   static 가드가 **index.ts / pi-extensions / mcp / scripts / plugins 전부** 스캔. pi가 export 제거하면
   tsc 실패 = 공짜 drift 게이트(dev-time). **runtime**: doctor/check가 pi `VERSION >= 0.79.1` 확인 —
   0.78 런타임에서 named export import가 깨지므로 친절히 fail-loud(tsc만으론 설치 환경 못 잡음).
10. **공개 동사 먼저 축소 (contract-lock) → fact-provider(facts only) → dispatch.** (GLG 2026-06-10)
    entwurf 공개 표면을 **한 동사**로 줄이고 `entwurf_peers`를 **읽기 전용 fact 표면**으로 못박는 걸
    **fact-provider 빌드보다 먼저** 한다. 순환처럼 보이지만 **contract(인터페이스 모양, 지금 잠그는 결정)와
    implementation(dispatch, probe 필요)을 분리**하면 풀린다: contract 먼저 → fact-provider는 그 위에서
    facts만 보고 → dispatch가 facts로 resume/send를 call-time 계산. **순서 근거:** 3-verb 표면을 켜둔 채
    discovery를 지으면 fact 층에 verb-routing(`resumable`/`sendable`)이 구워져 **entwurf_peers가 헛나간다**
    — 그래서 "처음에 줄여야". **scope(GLG 확정 2026-06-10 = A):** 기존 외부 MCP `entwurf`/`entwurf_resume`/
    `entwurf_send`는 **건드리지 않고 완전 전환까지 유지**한다. 지금 **Claude 3주체가 그 표면으로 라이브 협업
    중** — 부수면 당장 못 쓴다. 1-동사 통합 dispatch는 **레거시와 공존하는 새 이름**(provisional
    `entwurf_v2`)으로 **additive하게** 올린다(0.11 dual-write 교리와 동일: 3D-2가 `delivery.*`를 유지하며
    receipt state를 더하듯, 새 통합 표면을 더하고 레거시를 안 깬다). 레거시 3-verb **은퇴는 `entwurf_v2`
    경로 증명 + 완전 전환 이후에만.** liveness-routing 축(resume↔send) ≠ outcome-ownership 축(mode/
    wants_reply); 후자 파라미터는 유지. (이번 라운드 현금화 대상 = pi-native dispatch.)
    **→ 이 "contract-lock"의 미해결 빈칸은 Fable 5 검수(아래 별도 섹션)가 채운다: F1 caller-intent 4칸표,
    F4 backend별 liveness 술어 추상화, F6 contract=TypeBox 스키마+결정표+error taxonomy(산문 아님). 그것이
    잠긴 후라야 step 4-5 진입.**

### Trust 2층 (구현 형태 — 둘 다 같은 TS preflight 모듈 소비)
핸들러 API 확정: `on("project_trust", (e:{cwd}, ctx:{mode,hasUI,ui}) => ProjectTrustEventResult | undefined)`.
**N4:** `undefined`(abstain)=pi 기본 흐름에 defer, `{trusted, remember?}`=즉답. **`undecided`는 0.79.1에서 `no`와 동일**(둘 다 false coerce) — defer는 abstain만.
- **사람이 직접 여는 pi** = global `project_trust` 확장이 preflight 결과를 매핑(안전망):
  - approve → `{trusted:"yes", remember:false}`
  - saved false(명시적 distrust) → `{trusted:"no", remember:false}`
  - fail-fast/unknown → interactive(`ctx.hasUI`)면 **`return undefined`(abstain)** 으로 pi 기본 prompt에 defer.
    **⚠ 정정(0.79.1 소스 확정, Fable 검수):** `{trusted:"undecided"}`를 반환하면 안 된다 — pi
    `resolveProjectTrusted`(project-trust.js)가 `result.trusted === "yes"`로 coerce해 **undecided를 즉시 false로
    반환(store.get·prompt 도달 전)** 한다. defer하려면 핸들러가 **결과를 안 내고 abstain**해야 pi가 store→
    defaultProjectTrust→prompt 흐름을 탄다. (0.79.0엔 이 모듈이 없었음 = 0.79.1 구조.)
  - **상속-distrust 탈출구(F5b):** inherited-false인데 사람이 이 cwd만 믿고 싶을 때, abstain은 store가
    nearest-ancestor false를 non-null로 줘서 silent false다 → **핸들러가 직접 prompt 띄우고 yes면
    `{trusted:"yes", remember:true}`**(동결결정 6 carve-out)만이 유일한 탈출구.
- **launcher가 여는 controlled session** = handler에 의존 금지(`--no-extensions`면 안 돎).
  같은 `preflight(cwd)` 모듈로 판단 → trusted면 `--approve`, untrusted면 **throw**(undecided/no 둘 다).
- 두 경로가 **동일 모듈**을 부르므로 판정 불일치가 구조적으로 없음. `remember:false`는 동결결정 6(trust.json 안 더럽힘).
- **handler 위치 = user/global extension 또는 CLI `-e` extension만.** pi 0.79에서 `project_trust`는
  project resources load *전*에 발화 → project-local extension은 그때 아직 로드 안 됨 = 안전망 못 됨.

### preflight 정렬 가드 (Stage 0 step 5, 소스 확정 — 구현 세션 필수)
controlled launch는 **preflight(trusted 판정)를 모든 project-local manual read보다 먼저** 실행한다.
trusted 전에는 cwd 아래 어떤 project-local 파일도 읽지 않는다 — pi가 trust gate를 세웠는데 bridge가
옆문으로 읽으면 정렬이 깨진다. 실측된 bridge-local readers(현재 trust 무관하게 읽음):
> **0.79.1 갱신(2026-06-10):** 아래 3 reader 중 AGENTS.md를 읽는 `enrichTaskWithProjectContext`·
> `buildPiContextAugment`는 0.79.1이 AGENTS.md를 trust input에서 빼면서 **pi-trust gate 대상이 아니게 됐다**
> (= 항상 로드되는 context file). 진짜 pi-trust 정렬 대상은 `.pi/settings.json`을 읽는 **`loadProviderSettings`
> 하나**로 좁혀진다(GPT 2026-06-10 리뷰가 집중하라 한 지점). AGENTS reader 정렬은 bridge-hygiene 차원의 별도
> 선택이지 pi-trust 강제는 아니다 — Stage 0 step 5 스코프(parent `enrichTask` 정렬)는 유지하되 근거를 이렇게 읽는다.
- **부모 spawn-side reader:** `enrichTaskWithProjectContext` (`pi-extensions/lib/entwurf-core.ts:1101`,
  read at 1105) → target `cwd/AGENTS.md`를 자식 prompt에 주입. controlled launch preflight의 직접
  보호 대상.
- **bridge bootstrap-side reader:** `loadProviderSettings` (`index.ts:642`, `readSettingsFile(join(cwd,
  ".pi", "settings.json"))`) → bridge backend session 설정. provider/ACP 세션 부팅면의 project-trust
  정렬 대상.
- **bridge first-user augment reader:** `buildPiContextAugment` (`pi-context-augment.ts:125–149`, 호출부
  `index.ts:974–985`) → `~/AGENTS.md` + `cwd/AGENTS.md`. `pi-context-augment.ts`는 실재 파일이며
  실제 `readFileSync` 위치다. 호출부(`index.ts`)만 보고 실재 reader를 놓치지 말 것.

**Stage 0 step 5 스코프 경계 (산행 방지 — 코드 확정 2026-06-09):**
- **parent pre-spawn reader = `enrichTaskWithProjectContext` 하나** → Stage 0가 **직접 gate**한다.
  call edge: `부모 entwurf 실행 → preflight(target cwd) → enrichTask(target cwd/AGENTS.md) → spawn child pi -p`.
  Stage 0 직접 작업 = **preflight를 enrichTask보다 앞으로 이동**.
- **child/bridge bootstrap reader = `loadProviderSettings` + `buildPiContextAugment`** (둘 다 `streamShellAcp`
  index.ts:866 내부, 호출부 1256). Stage 0는 이 둘을 **직접 gate하지 않는다.** 단 "controlled launch와 무관"은
  아님 — controlled launch가 `provider=pi-shell-acp` child를 띄우면 **bridge가 그 child 안에 살아서**
  (spawn sites: `entwurf.ts` async spawn, `entwurf-async.ts` async resume, `entwurf-core.ts` sync spawn/resume;
  provider stream registered at `index.ts:1256`) child 프로세스가 자기 `streamShellAcp`에서 이 reader들에
  도달한다. 이들은 **child 자신의 cwd**를 읽는 child-bootstrap reader지 부모 pre-spawn reader가 아니다.
- **보호 메커니즘 = controlled launch invariant** (현재 코드에 없음 = step 5 신규): preflight allow 없이는
  child를 spawn하지 않고, allow된 child에는 내부 `--approve`를 반드시 붙인다. 따라서 child가 `streamShellAcp`에
  도달하기 전 trust가 이미 확정 → child-bootstrap reader 직접 gate가 불필요.
- **결론:** Stage 0 작업 범위 = **parent pre-spawn `enrichTask` 정렬 + child launch `--approve`/no-spawn
  invariant** 둘뿐. bridge bootstrap-side reader 직접 정렬은 **별도 bridge-surface 트랙(#25 또는 Stage 1)**이며
  Stage 0가 그쪽으로 번지면 0.11 "ACP 중심에서 내림" 방향과 충돌한다.
- 사람이 직접 여는 pi의 native resource-load trust 흐름은 pi가 순서를 보장한다(이 가드는 controlled/entwurf
  launch 한정).

### Packaging — 새 언어/바이너리 없음
0.11은 순수 TS. 새 빌드 toolchain·바이너리·node helper 프로세스 없음. brain/preflight/facts는
`pi-extensions/lib` TS 모듈, cross-harness는 기존 pi-tools-bridge MCP. (미래에 진짜 node 없는 fact
소비자가 생기면 그때 TS 코어 위에 얇은 래퍼를 얹는다 — YAGNI, 0.11엔 안 둠.)

### Stage 0 순서 (pi only, 순수 TS)
1. **pi deps 0.79 bump + public-import 가드** — pi-ai/pi-coding-agent/pi-tui devDep 0.79.1, peer
   `>=0.79.1`(2026-06-10 0.79.0→0.79.1 완료). `/dist/...` private import 금지 static 가드.
2. **TS preflight 모듈** — pi trust public export 직접 import + prefix overlay + precedence(동결결정 8).
   게이트: synthetic fixture에서 pi 자기 함수와 대조(같은 프로세스라 trivial) + precedence 단위 테스트.
   controlled-launch decision(JSON/내부 객체) 산출.
3. **meta-record v2** — identity-only, pi backend 포함, v1 dual-read+normalize. 기존 v1 게이트 재작성.
   **(전제: 동결결정 10 contract-lock을 step 4보다 먼저 잠근다 — entwurf=공개 동사 1개, `entwurf_peers`=
   읽기 전용 fact 표면. 그래야 아래 fact-provider가 verb-split을 굽지 않는다.)**
4. **TS fact-provider (facts only)** — `peers`/`who-can`/`preflight`. `meta-session.ts`·mailbox·소켓/tmux
   probe 재사용, 기존 `entwurf_peers` MCP로 cross-harness 노출. **fact만 보고**(liveness/capability/identity/
   cwd-이력) — verb-routing 금지(동결결정 10). **liveness authority = 기존 `entwurf-control.ts`의
   `isSocketAlive`(`net.createConnection`)·`getLiveSessions`·`getLiveSessionsWithInfo`(RPC `get_info`)·
   `gcStaleSockets`를 lib로 추출/재사용.** 새 `ss`/`kill` probe 표면을 만들지 않는다(Go 드롭했는데 Linux
   CLI probe로 새 표면이 도로 생기는 걸 막음 — portable socket/RPC 경로가 이미 있음).
5. **상위 entwurf 단일 표면 (새 `entwurf_v2`, 레거시 공존)** — preflight + fact-provider 소비 → liveness로
   resume/send call-time 계산, trusted면 내부 `--approve`로 `pi -p` bg / tmux-live dispatch, untrusted면
   fail-fast. **레거시 `entwurf`/`_resume`/`_send`는 안 건드리고 완전 전환까지 유지**(additive; 동결결정 10).
   **preflight를 project-local read보다 먼저**(위 "preflight 정렬 가드"). primitive 내부 유지. **쿼터·부하
   부가 신호는 여기 안 넣음**(에이전트 층, 백엔드 liveness 동작 후 — backlog).
→ **각 요소는 테스트 코드로 먼저 검증, 연결은 그 다음.** Stage 1 = Claude Code ↔ Claude Code live
(그때의 trust는 pi가 아니라 Claude 모델 → 별도 backend preflight, 0.11 Stage 0 범위 밖).

> **진행 (2026-06-09):** step 1(pi 0.79 bump + import/runtime 가드) = 커밋 `be6ccde`. step 2(TS
> preflight 모듈 `pi-extensions/lib/entwurf-preflight.ts` + `check-pi-preflight` 10 assertions) = 커밋
> `b2c7824`. **step 3A**(v1→v2 identity normalize: `parseMetaRecordV1/V2`·`normalizeMetaIdentity` +
> strict v2 keyset + `check-meta-record-v2` 17 assertions 골든) = 커밋 `ed58102` (GPT 끊을 지점 ① 통과).
> **step 3B**(mailbox receipt state schema+store `MailboxReceiptState`·`stampMailboxReceipt` +
> body/path gardenId drift fail-fast + field 런타임 검증 + `check-mailbox-receipt-state` 19 assertions)
> = 커밋 `7d69691` (GPT 리뷰 통과, schema/store-only — live dual-write·delivery 제거는 3D).
> **step 3C**(backend capability source `pi/entwurf-capabilities.json` + `parseMetaCapabilityRegistry`
> coverage==META_BACKENDS_V2 + 기존 3 backend ≡ `META_BACKEND_DESCRIPTORS` drift guard +
> `check-entwurf-capabilities` 15 assertions, **pi wakeMode=direct-inject** = control-socket triggerTurn
> 직접 주입, packaging `files`+check-pack 등재) = 커밋 `0be536c` (GPT 리뷰 통과, parser/gate-only — live
> consumer 갈아엎기·record wakeMode 제거는 3D). **step 3D-1**(pure v2 write shape `serializeMetaIdentity`
> + dual-read dispatcher `parseMetaRecordAny`(schemaVersion peek→V1/V2) + `parseMetaIdentity`(dual-read→
> normalized identity) + `check-meta-dual-read` 14 assertions) = 커밋 `232d02c` (GPT 리뷰 통과, pure-only —
> FS upsert·live·delivery 제거 전부 없음). **다음 = step 3D-2(live receipt dual-write).** (push 아직 안 함.)
>
> **진행 (2026-06-10, pi 0.79.0→0.79.1 side-quest — 본궤도 3D-2와 별개, 깨짐 방지용 선반영):**
> pi 0.79.1이 trust-manager를 둘 바꿈: (a) `hasProjectTrustInputs`에서 AGENTS.md/CLAUDE.md 제거,
> (b) `ProjectTrustStore.get`을 nearest-ancestor walk-up으로 변경. npm 0.79.1 diff·실측으로 둘 다 확정.
> 검증원장·동결결정 5·정렬 가드를 위에서 갱신했고 3 커밋으로 반영: `994353d`(preflight fixture
> AGENTS.md→`.pi/`, 0.79.0-safe 선행 — 0.79.0에서 green 체크포인트) → `f2bcb64`(deps 0.79.0→0.79.1
> lockstep: devDep/peer floor `>=0.79.1`/run.sh check-pack-install 핀/runtime FLOOR/lockfile) →
> `f141c3f`(0.79.1 nearest-ancestor 상속 assertion 3개, preflight 총 13). `pnpm check` + heavy
> `check-pack-install` 모두 0.79.1에서 green. **본궤도(3D-2)는 변경 없음 — bump가 derail하지 않았다.**
> (push 아직 안 함.) **잔여 follow-up:** `entwurf-preflight.ts` 헤더 주석 "no-trust-inputs = nothing
> project-local to load"는 0.79.1 기준 "no trust-gated input"으로 표현 정밀화 가능(코드 로직은 정확, 문구만).
>
> **3D 4-조각 분해 (GPT 2026-06-09, live path라 한 덩어리 금지):**
> - **3D-1 ✅** pure dual-read/writer (serializer + dispatcher + identity path, FS 연결 없음) = 이번 커밋.
> - **3D-2** live receipt dual-write — `enqueueMetaMessage`/`readMetaInbox`가 기존 `record.delivery.*`
>   stamp 유지하면서 mailbox receipt state(3B)도 stamp. **additive only**, delivery 제거 금지, v2 writer/
>   capability consumer 연결 금지, `smoke-meta-mailbox` 안 깨짐. 여기서 새 state live 체감.
> - **3D-3** capability-backed metadata — live descriptor 소비처를 capability registry(3C)로 전환,
>   기존 3 backend drift guard 유지, record 안 wakeMode 제거 준비.
> - **3D-4** v2 writer/upsert + gate update — 새 write=v2, v1 read 유지, `check-meta-session`/
>   `smoke-meta-mailbox`/store-doctor 정당 update. **여기서 끊을 지점 ②(GPT 큰 리뷰).**

### Fable 5 설계 검수 반영 — entwurf_v2(step 4-5) 진입 블로커 (2026-06-10, Fable+Opus+GPT 3자 수렴, 소스 확정)

Fable 5(Anthropic 신모델)에 entwurf_v2 설계 검수를 의뢰 → Opus 재검증 + GPT 교차검증으로 수렴. 8 finding
전부 소스 대조 확정. **3D-2(다음 한 걸음)는 전 finding과 독립 = 그대로 진행.** 아래는 **step 4(fact-provider)·
step 5(entwurf_v2 dispatch) 진입 전** 원장에 닫아야 할 것(동결결정 10의 미해결 빈칸 + 결정 5/6·Trust 2층 정정).

**go/no-go (3자 만장일치):** 3D-2 = **GO**(독립) · 0.79.1 trust 반영(결정 1) = **GO**(버킷 A로 완성) ·
entwurf_v2 구현 = **NO-GO** until 버킷 B(안 닫고 들어가면 "다시 보니 안되네요" 확정 = GLG 10:58 기준 위반).

**finding 처분 (심각도 순, 전부 소스 확정):**

| F | 결함 | 소스 근거 | 버킷 |
|---|---|---|---|
| **F1** Critical | entwurf_v2가 resume(owned-outcome)·send(fire-and-forget)을 liveness만으로 바꿔 **caller가 받는 계약이 call-time 비결정** | `entwurf-control.ts:24-37` (send=ack-only "end of contract") | B |
| **F2** Critical | dispatch 동시성 가드 없음 — probe→spawn TOCTOU; v2/legacy가 같은 substrate 다른 entry → 같은 dormant 타깃 이중 spawn | `entwurf-async.ts:245` spawn에 per-gid lock/liveness 체크 없음, `activeEntwurfs`는 in-process Map(형제 못 봄) | B |
| **F3** High | `gcStaleSockets`가 **timeout에도 unlink** → 부하로 멈칫한 live 소켓 영구삭제 → 이후 probe 전부 dormant → live 세션 resume = identity split. "probe는 계산만" 교리 자기위반. **N5: `startControlServer`마다 호출(`:1201`)이라 v2 무관하게 오늘 legacy를 깰 수 있는 live 버그** | `entwurf-control.ts:288-310`(timeout·error 둘 다 false), `282-285`(`!alive`→unlink), `1201`(startup GC) | **A 확정** |
| **F4** High | liveness=pi-socket 전용인데 contract는 보편 표방. claude=self-fetch(소켓 없음) liveness 술어 미정의; `connect`=reachable≠responsive | 검증원장 "liveness authority=socket connect+RPC" = pi 한정 | B |
| **F5** Med | 0.79.1 상속: preflight가 `store.get`이라 **inheritedFrom 증거 소실** + 탈출구 방향 미검증 + **undecided≠defer** | `preflight.ts:140`, `project-trust.js:29`(undecided→false), `check-pi-preflight #12` 한 방향만 | A |
| **F6** Med | "contract-lock 완료"는 과장 — entwurf_v2는 NEXT 산문에만, 입출력/target 의미론/error taxonomy 미동결 | grep: 코드 전무 | B |
| **F7** Low-Med | capability registry=trust-the-json. drift guard=코드 사본 일관성(현실검증 아님), codex/agy direct-inject live 게이트 없음 | `check-entwurf-capabilities`(descriptor 일치만) | C |
| **F8** Low | `getLiveSessionsWithInfo` 직렬 1.5s×N → stuck 세션 몇 개에 peers 열거 수초 블록 | `entwurf-control.ts:355`(직렬 for-await) | C |

**3 설계 결정 (GPT 권고 + 소스 확정, GLG 승인 2026-06-10):**
1. **F1 = caller intent 선언.** liveness는 transport만, outcome 계약 불변. **6칸표(N1: F3 3값과 정합 — binary 표는 indeterminate를 dormant로 접어 identity-split 부활):**
   | intent | live | dormant | indeterminate (F3 timeout) |
   |---|---|---|---|
   | **fire-and-forget** | send, ack only | **v2 초기 = reject**(N2: mailbox-wake는 0.10.0 substrate 있으니 additive 확장, 영구 reject 아님) | **절대 spawn 금지 → reject** |
   | **owned-outcome** | **기본 reject**(wants_reply는 ownership 아님) | async resume, caller completion 소유 | **절대 spawn 금지 → reject** |
   → owned+live 자동 send(wants_reply) 강등 금지. **indeterminate 타깃은 절대 spawn 안 함**(GC만 고치고 디스패치를 안 고치면 F3를 절반만 끊음 — N1). dispatch 영수증(경로+caller 기대)을 contract 산출물에 포함.
2. **F3 = unlink 축소만(heartbeat는 2단계). 버킷 A 확정(N5: live 버그, `startControlServer:1201`).**
   `isSocketAlive → alive|dead|indeterminate`; ECONNREFUSED/ENOENT만 dead; timeout=indeterminate; GC는 dead만
   unlink. 게이트: "timeout 소켓은 unlink 안 함." **indeterminate는 `getLiveSessions` live 목록에서 제외하되
   unlink 안 함 → 현행 listing 의미론 보존**(소켓 누수 무시 가능: 죽은 프로세스는 ECONNREFUSED=dead로 회수,
   timeout-영구는 SIGSTOP류 희귀; 카운터 저장은 교리 위반이라 수용).
3. **F5b = getEntry 전환 + active-prompt 탈출구.** preflight evidence에 `trustStoreEntryPath`/`trustStoreInherited`/
   `trustStoreDecision`. 게이트: 자식 true>조상 false(탈출구 방향) / inherited-false outcome의 entryPath===parent /
   direct-false outcome의 entryPath===cwd. **entryPath 비교는 pi `normalizeCwd` 캐노니컬 축으로**(우리 normalizePath
   아님, symlink cwd edge — 게이트 assertion이 잡게). 탈출구 = 핸들러 직접 prompt → yes면 `{trusted:"yes",
   remember:true}`(결정 6 carve-out). **undecided-defer는 0.79.1에서 작동 안 함**(Trust 2층 정정 참조).
   **N3a(의도 명문화):** controlled launch는 `trustOverride` short-circuit(project-trust.js:17)이라 핸들러 도달
   안 함 → active-prompt 탈출구는 **인간-인터랙티브 전용**. 에이전트가 자가 trust 승격 못 하는 건 **버그 아니라
   의도된 보안 속성.** **N3b 게이트:** inherited-false deny 메시지는 `inheritedFrom` 출처 + remedy("인터랙티브
   pi를 `<cwd>`에서 열어 override")를 반드시 말한다(F5a evidence가 원료).

**0.79.1 소스 확정 — Trust 2층 가정 깨짐 (보너스, 어느 리뷰어도 못 봄):**
`resolveProjectTrusted`(project-trust.js)는 핸들러를 `store.get`보다 **먼저** emit하고 `result.trusted === "yes"`로
coerce → **`{trusted:"undecided"}`는 즉시 false 반환(store/prompt 도달 전).** pi 기본 prompt로 defer하려면 핸들러가
**`undefined`(abstain)** 해야 함. `undecided`/`no`는 pi에 동일(둘 다 false). 상속-false는 abstain해도 store가
non-null false라 silent false → **탈출구는 active prompt만.** (0.79.0엔 이 모듈 부재 = 0.79.1 구조; 우리가 핀하는
버전에서 깨지므로 결정 1의 정당한 버그수정.) → Trust 2층 절·동결결정 6에 인라인 반영 완료.

**버킷 분류:**
- **버킷 A (지금 코드+게이트, 결정 1 완성):** F5a/c(preflight `getEntry` + evidence 3필드 + 탈출구 방향
  assertion, entryPath는 pi `normalizeCwd` 축) · Trust 2층 핸들러 `undecided`→`undefined`(abstain) 정정 +
  상속-false active-prompt(`remember:true`) · **N3b** inherited-false deny 메시지에 `inheritedFrom`+remedy ·
  **N4** Trust 2층 API 라인 `=> Result | undefined` · **N5 F3 unlink 축소 = A 확정**(live 버그).
- **버킷 B (entwurf_v2 step 4-5 진입 전, 원장에 산문 아니라 결정표/스키마/게이트로):** **N1 intent×{live,dormant,
  indeterminate} 6칸표 + "indeterminate 절대 spawn 금지" 동결 + dispatch 영수증** / **N2 fire-forget+dormant =
  "지금은 reject" 잠금**(mailbox-wake는 reply-correlation id가 substrate에 없어 additive 확장) / F2 per-gid
  lockfile + pi 동시-resume 실측(검증원장 추가) + send-fail fallback / F4 liveness를 backend-capability 술어로
  추상화 + claude liveness 술어 Stage 1 전 한 줄 동결 / F6 entwurf_v2 TypeBox 입출력 스키마 + target 의미론
  (garden-id only? 오타 gid가 신규 spawn 사고 막기) + error taxonomy를 `check-*` 게이트로.
- **버킷 C (backlog):** F7(doctor backend wake-path probe 또는 BASELINE "live-verified: date|never" 표) ·
  F8(`getLiveSessionsWithInfo` `Promise.all` 병렬화 한 줄).

**Fable 2차 재검수 (2026-06-10, folding 검수):** F1-F8 처분 충실성 = clean(누락/격하 없음). folding 과정에서
나온 신규 N1-N5 전부 위에 반영: N1(6칸표 모순 해소)·N2(fire-forget+dormant "지금 reject" 잠금)·N3(비대칭 =
의도된 보안 속성 명문화 + deny 메시지 게이트)·N4(API 라인 정정)·N5(F3 = A 확정 live 버그). **최종 go/no-go:
(a) 버킷 A 구현 진입 = GO**(N3b deny-메시지·N4·N5 동반). **(b) 버킷 B 설계 동결 진입 = GO**(N1 6칸 + N2 잠금 +
N3a 한 줄을 B 작업목록에 포함하는 조건 — 충족). N3-검증: controlled launch `trustOverride` short-circuit
(project-trust.js:17)·`startControlServer` GC(:1201) 소스 확정.

### Stage 0 step 3 progress map — meta-record v2 (정찰 완료, 3A·3B·3C·3D-1 완료)

정찰 + GPT 리뷰 + 코드 재검수로 순서 고정. 지금은 3D-2 직전이다 — 어기면 dual-read 역호환 또는
receipt 증거가 깨진다.

**현 authority 위치 (2026-06-09 현재 — 전환 중):**
- **live receipt authority = 아직 `record.delivery.*`** (`enqueueMetaMessage`/`readMetaInbox` stamp,
  Claude D7 observable). 파일 마커 `.msg`/`.msg.delivered`는 doorbell이지 read-receipt 아님.
  **새 mailbox receipt state store는 존재**(`MailboxReceiptState`, `stampMailboxReceipt`,
  `meta-mailbox/<gardenId>/state.json`)하지만 live path에는 아직 연결하지 않았다. **3D-2 = additive
  dual-write로 연결, 기존 `record.delivery.*` 유지.**
- **capability source 파일 = `pi/entwurf-capabilities.json` 존재**(`parseMetaCapabilityRegistry`,
  `check-entwurf-capabilities`). 단 live record mint/parse 소비처는 아직 `META_BACKEND_DESCRIPTORS`다.
  **3D-3 = live descriptor 소비처를 capability registry로 전환.**

**v1→v2 델타 (검증원장 대조 확정):** backend `+=pi` · transcriptPath required→nullable · 신규
`model:null`/`parentGardenId:null`/`isEntwurf:false` · `lastSeen`→`recordUpdatedAt` rename · `delivery{}`
통째 제거. (검증원장이 "제거"라 적은 `status·lifecycle·trusted·tmuxTarget`은 **현 v1에 이미 없음** —
실제 제거 대상은 `delivery{}` + `lastSeen` rename 둘뿐.)

**구현 순서 (고정, 진행 반영):**
1. ✅ **synthetic/sanitized v1 fixture**를 golden으로 고정. 실제 디스크 meta-record(real cwd/transcriptPath)를
   public repo에 커밋 **금지**. (`check-meta-record-v2`)
2. ✅ `parseMetaRecordV1/V2` + `normalizeMetaIdentity` 먼저. v1→normalized v2 identity golden GREEN 전엔
   v2 writer **금지**. (끊을 지점 ① 통과)
3. ◐ v2 write shape + dual-read pure 함수 완료(`serializeMetaIdentity`, `parseMetaRecordAny`,
   `parseMetaIdentity`, `check-meta-dual-read`). **아직 FS upsert 연결 없음.**
4. ✅ **delivery 제거 전 mailbox receipt state schema/store 먼저 못박음** — `MailboxReceiptState` /
   `stampMailboxReceipt` / body-path drift guard 완료. **다음 3D-2에서 live dual-write 연결.**
5. ✅ **wakeMode 제거 전 capability source 먼저 못박음** — `pi/entwurf-capabilities.json` + parser/gate 완료.
   **3D-3에서 live consumer 전환.**
6. 남음: **정당하게 update될 게이트(= regression 아님):** `check-meta-session`(delivery.*/lastSeen/wakeMode +
   backend↔wakeMode contradiction 단언) · `smoke-meta-mailbox`(receipt assertion 위치) · store-doctor
   (contradiction check). dual-read 경로엔 v1 fixture 게이트 별도 유지.
7. 남음: **MCP `pi-tools-bridge`는 구조 비의존**(`readMetaInbox()`만 호출, index.ts:661) → 코드 무변경 가능.
   단 주석/description의 `lastReadAt` wording + doctor/error wording은 update 대상.

**구현 전 반드시 끊을 지점 (2):**
- ① v1 fixture → `normalizeMetaIdentity` golden GREEN **직후 = GPT 리뷰.** v1 무손실 normalize 증명 전
  v2 writer 금지(디스크 v1 10+개 역호환이 여기 걸림).
- ② 깨진 게이트 update **직후 = GPT 리뷰.** "정당한 update vs 진짜 regression" 혼동 최다 구간.

**체감 단위 분해 (3A–3D, 2026-06-09 GLG+GPT힣) — step 3를 한 번에 하지 말 것:**
step 1·2는 안전장치/토대라 체감이 없었다. step 3부터는 **관찰 가능한 결과 단위**로 끊는다. 각 단위마다
새/수정 gate + 관찰 가능한 결과를 낸다. 아래는 위 "구현 순서(고정)"의 재배열·명시화이지 새 결정이 아니다
(특히 3B·3C를 3D writer **앞**에 두는 건 위 4·5의 "먼저 못박음" 제약을 순서로 박은 것).
- **3A. v1→v2 normalize gate** (= 고정순서 1·2). 결과: 기존 v1 meta-record를 읽고 v2 identity로 normalize
  = "옛 시민을 잃지 않음". 검증: synthetic v1 fixture → normalized v2 golden GREEN. → **끊을 지점 ①.**
- **3B. mailbox receipt state** (= 고정순서 4). schema/store 완료. 결과: receipt의 새 집
  `meta-mailbox/<gardenId>/state.json`이 생김. **live 체감(`inbox_read` 후 state에 `readAt`)은 다음 3D-2.**
- **3C. capability source** (= 고정순서 5). 완료. 결과: wakeMode/deliveryLevel이 record가 아니라 capability
  source(`pi/entwurf-capabilities.json`)에서 나올 준비 완료 → "이 시민은 self-fetch/direct-inject 가능한가 /
  pi는 control-socket live 가능한가"를 capability가 답함. (live consumer 전환은 3D-3.)
- **3D. v2 writer + dual-read** (= 고정순서 3). 3D-1 pure writer/dual-read 완료. 남은 3D-2/3/4:
  live receipt dual-write → capability-backed metadata → v2 writer/upsert + gate update. 이후 고정순서 6
  (게이트 update) → **끊을 지점 ②** → 고정순서 7(MCP wording).

### 0.10.0과의 관계
0.10.0(meta-bridge delivery/install/doctor)은 #35 frame을 배신하지 않음(workshop-safe). 0.11.0은 그
substrate(SessionStart 훅·mailbox·doorbell·소켓) 위에서 launch surface를 tmux-live로 통일 + pi를 4th
backend로 편입한다.

### 부가 신호 (backlog — Stage 0 밖, 각 백엔드 liveness 동작 후, GLG 2026-06-10)
"최적의 형제" 판단의 **부가 입력** — substrate가 아니라 에이전트 층이다. 6/9 설계 원본의 사례:
- **주간 쿼터**(클로드 거의 참 → pi로 지피티) — "별도로 쉽게 알수있음", substrate 밖 외부 신호.
- **시스템 부하**(burden → live 대신 `pi -p` bg) — OS probe, 호출 시점 에이전트 판단.
순서: Stage 0(정체성/능력/liveness/trust substrate) + 각 백엔드 dispatch가 동작한 **다음** 얹는다.
substrate(record/capabilities/mailbox/probe)에 쿼터·부하를 **저장하지 않는다**(상태 저장 = 거짓말 함정).

## Post-0.10.0 meta-bridge follow-ups (backlog — 0.11.0과 별개 트랙, GLG 재오픈 시)

- **#34 잔여 (doc 제외).** empirical probe 4종(FileChanged coalescing bound / active-turn arrival /
  watchPath 고갈 / compact-window) + unread-mailbox heartbeat backstop. deterministic 절반(catalog
  1–4 + level-trigger)은 0.10.0서 닫힘.
- **Phase 4 후속 — 실제 GC 자동화.** `--apply`(또는 `--print-rm` 게이트), TTL/liveness 코드화, 글로벌
  설치 스킬로 에이전트가 뒷정리(동작 로직 방해 금지). corrupt/duplicate가 그 nativeId registration을
  영구 차단하는 문제도 이 트랙. 참고: `agent-config/.claude/skills/agent-config/`.
- **step 7 `entwurf_peers(includeMeta)`** — 메타세션 발견성. 가치 있으나 install/doctor보다 우선순위 낮음.

## Carried-forward follow-ups from 0.9.0 (real next work, not cut blockers)

- **`/gnew` T3 backend axis — Claude-only measured.** Backend identity after `/gnew`
  (`PI_SESSION_ID` → backend MCP child) is live-proven on `claude-sonnet-4-6` only; the resident
  guard runs at the default `SMOKE_RGG_MODEL`. The switchSession rebind is backend-agnostic at the
  bridge level, so risk is low. The 0.9.0 BASELINE/CHANGELOG now carries the explicit
  skip-with-reason; follow-up is to extend `SMOKE_RGG_MODEL` to codex/gemini for a `/gnew` T3 run.
- **`/gnew` empty-session GC.** `/gnew` persists the header+metadata file immediately
  (switchSession needs it to exist), so repeated `/gnew` without a turn leaves header-only files —
  more than the launcher (which defers the file to the first turn). A cross-cutting empty-session
  GC (applies to the launcher too) is the follow-up, not a `/gnew` defect.
- **`entwurf.ts` source guard refinement.** The deterministic guard is fail-closed (every
  `pi.sendMessage` must sit inside a best-effort arrow wrapper). Correct while `entwurf.ts` is
  completion-send only. If a plain UI send is ever added there, refine the guard to
  close-handler scope / allowlist — do NOT loosen the equality check.

## Deferred — dep bump (claude-agent-acp 0.40.0 / @agentclientprotocol/sdk 0.24.0) — SEPARATE track

sdk 0.24 removed `unstable_setSessionModel` (the model-set RPC) entirely (type + runtime),
replacing it with `session/set_config_option` (configId="model"). Claude model selection survives
via `_meta.claudeCode.options.model` at newSession, but **codex/gemini model-forcing has no other
path** — `resolveCodex/GeminiAcpLaunch` pass no `--model`, so the RPC was their sole mechanism; an
`as any` cast over the removed method would silently regress them (the exact 0.4.5 anti-pattern
`check-sdk-surface` exists to block). Forward fix: migrate `enforceRequestedSessionModel` to
`setSessionConfigOption({configId:"model", value})` with config-value discovery + a per-backend
resolved-model release-gate assertion + live codex/gemini verification (codex-acp is a bundled
binary — set_config_option support is unverifiable statically). The critical Opus 4.8
thinking-blocks fix is already in the pinned 0.39.0, so the entwurf identity line needs nothing
from 0.40.0. Bump `~/sync/org/setup/update-claude.sh` pin in lockstep when this lands.

## Standing focus — Mitsein over MCP: plain external vs garden-native meta-session

상시 초점: `pi-shell-acp` 를 OpenClaw plugin 으로 더 미는 것보다, **pi session ↔ Claude Code /
external MCP host ↔ pi-tools-bridge ↔ entwurf** 가 서로 다른 하네스 정체성을 유지하면서 함께
일하는 시나리오를 검증한다.

2026-06-06 전환: 예전 "외부 MCP host = non-replyable" 비대칭은 **plain external** 에만 맞다.
Claude Code native 가 meta-bridge `SessionStart` 로 garden citizen 이 되고 sender marker 까지 쓰면
그 세션은 pi control-socket 은 아니지만 `entwurf_send` 에서는 **replyable meta-session** 이다.
즉 send/inbox는 대칭 공존으로 닫혔고, 남은 비대칭은 `entwurf_resume` async followUp 같은
pi control-socket 전용 채널이다.

핵심 질문:
- agent 가 plain external(non-replyable) 과 garden-native meta-session(replyable by garden id)을
  구분하는가?
- `entwurf_send` 는 fire-and-forget, `entwurf` / `entwurf_resume` 는 outcome ownership 이라는
  역할 분담이 실제 워크플로에서 헷갈리지 않는가?
- Claude Code 가 설계/리뷰하고 pi-shell-acp 세션이 실행하거나 그 반대인 시나리오가
  문서/로그/UX 상 정직한가? (서로 forward 하지 않고 GLG 가 역할을 정하는 패턴 유지.)

성공 기준: 각 시나리오에서 "누가 outcome 을 소유하는가" 가 명확하고, replyable / non-replyable /
send-is-throw / MCP `entwurf_resume` 조건부 async default(0.7.6) 경계가 agent 발화에 정확히
반영된다. 특히 native Claude meta-session 이 `external-mcp/claude-code` 로 퇴행하거나
`wants_reply=true` 를 비대칭 논리로 거절하면 버그다 — install/doctor/sender-marker 경로를 본다.

## Active hygiene — session continuity (`incompatible_config`)

같은 pi 세션을 resume 할 때 실행 옵션이 달라지면 bridge config signature 가 달라져 ACP backend
session 이 `incompatible_config` 로 invalidate 된다. 대표 footgun: 평소
`pi --entwurf-control --emacs-agent-socket server` alias 와 달리 plain `pi` 로 실행하면
`--emacs-agent-socket` 누락 → `bridgeConfigSignature` 변동 → pi JSONL 은 남지만 backend 매핑이
새로 생겨 모델이 이전 맥락을 모르는 것처럼 반응.

다음 작업 후보:
1. `incompatible_config` 로그에 축별 diff 출력 (예: `emacsAgentSocket: null -> "server"`).
2. `PI_SHELL_ACP_STRICT_BOOTSTRAP=1` 운영 문서화 / silent-new 대신 fail-fast 검토.
3. `emacsAgentSocket` 을 session compatibility 축에 넣는 게 맞는지 재검토.

## Main backlog — #25 bridge hygiene (OpenClaw audit lessons)

OpenClaw audit lesson 을 plugin 확장이 아니라 **pi-shell-acp 본체 bridge hygiene** 로 흡수한다:
1. **Transcript pre-flight** — backend native jsonl 위치 verifier (Claude `CLAUDE_CONFIG_DIR`,
   Codex `CODEX_HOME`/`CODEX_SQLITE_HOME`, Gemini `GEMINI_CLI_HOME`).
2. **Invalidation reason taxonomy** — 지금 `incompatible_config` 가 너무 넓다. 후보:
   `auth-profile`, `auth-epoch`, `system-prompt`, `mcp`, `transcript-missing`, `emacs-socket`,
   `tool-surface`.
3. **Session cache hygiene** — `acp-bridge.ts` bridge session cache 에 idle timeout / LRU /
   max-N cap 검토.

나중 후보: fingerprint-keyed reuse (skills snapshot + extra system prompt hash 축); single-turn
lock per session (같은 sessionId 동시 prompt 진입 throw).

## Reference paths

- 본체: `~/repos/gh/pi-shell-acp/`
- Consumer: `~/repos/gh/agent-config/`
- NixOS consumer: `~/repos/gh/nixos-config/`
- OpenClaw source: `~/repos/3rd/openclaw/`. Plugin `plugins/openclaw/` is **deprecated** (see below).

## Deprecated — closed, do not reopen

- **OpenClaw track (2026-06-10 종료)**: `plugins/openclaw` deprecated & unmaintained.
  Claude / Gemini 가 ACP 를 네이티브로 지원하고 (Claude 는 6/15 이후 크레딧 기반),
  wrapper 레이어의 존재 이유가 사라졌다. ACP 본체(pi-shell-acp)는 계속 Claude / Codex /
  Gemini 지원 — 맥락만 바뀐 것. npm `@junghan0611/openclaw-pi-shell-acp@0.0.1` 은
  `npm deprecate` 로 마킹, 소스는 reference 용으로 동결. ClawHub publish / self-contained
  install / embedded runtime 전부 폐기. `@junghanacs` publisher 핸들은 확보됐고(issue #2346
  resolved) 다른 용도로 전용.
- **Long-term / separate issues**: #11 remote SSH resume cwd alignment (remote entwurf identity는
  0.9.0 에서 의도적으로 fail-fast), #10 broader ontology RFC, #8 ACP `entwurf_send` message
  visibility UX, #2 pi-first context meter, L5 long soak with repeated context-pressure events.
