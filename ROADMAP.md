# pi-shell-acp ROADMAP — 현재 + 미래 방향

> 이 문서는 **현재이자 미래방향**이다. `NEXT.md`는 disposable한 다음-한-걸음 나침반,
> `CHANGELOG.md`는 게시되는 "닫힌 변경" 핵심 로그, 이 `ROADMAP.md`는 게시되지 않는
> 내부 방향/설계 SSOT. 닫힌 작업의 세션별 process 잡음은 git 커밋 history에 산다.
> (NEXT는 npm tarball에서 제외, ROADMAP도 제외 — 내부 detail 안전. CHANGELOG는 게시됨.)

---

## 현재 — `acp-on-v2` / next release candidate: v2 core + ACP plugin

이 repo는 **pi-native v2 dispatch substrate (entwurf-core) + meta-bridge + ACP plugin**이다.
v1 entwurf verbs(`entwurf`/`entwurf_resume`/`entwurf_send`)는 끝났고 사라졌다(v2 core). v2가 척추.
ACP는 중심이 아니라 v2 core 위에 provider/model로 들어오는 **plugin 하나**(#38) — host
`--entwurf-control` pi 세션이 *이미* v2 socket-citizen이고, plugin은 socket/peers/citizen 층을
새로 만들지 않는다.

### Release north-star — operator 실사용 세트 (GLG 결정 2026-06-22)

이번 릴리즈 목표는 GLG가 매일 쓰는 **세트 하나**를 단단히 조이는 것이다. 그 밖의 backend는 형제로서
정직히 deferred로 둔다(제거 아님). 이게 정합성의 기준선 — 모든 문서가 이 세트를 같은 말로 비춘다.

| 세트 | 이 repo에서의 정체 | rail | 근거(AGENTS.md) |
|---|---|---|---|
| **GPT** | pi-native 호스트 그 자체 (pi가 harness, GPT는 pi로 구동) — 이 repo의 backend가 아니라 *그 위에서 도는 곳* | host | L61 "Pi stays the harness" |
| **Claude Code** (native 세션) | meta-bridge meta-session (SessionStart 훅 → garden id + mailbox + trusted marker, transcript 안 긁음, 2nd harness 아님) | mailbox-citizen (come-and-go) | L63, #87 |
| **ACP Claude** | ACP plugin backend (provider/model이 claude-agent-acp를 overlay 격리로 구동) | socket-citizen (always live, mailbox 없음) | L65, #102 |

세트 밖(deferred, 정직 유지): Codex(직접 주입으로 *이미* garden citizen, ACP backend 아님) · Antigravity
(릴리즈 후 lane) · Gemini CLI(deprecated→Antigravity) · non-Claude ACP/Cortex(후속) · fresh-mint spawn.

### Rename — `pi-shell-acp` → `entwurf` 확정 (GLG 결정 2026-06-22, 이전 "rename 없음" 뒤집음)

spine이 entwurf-core이고 ACP는 plugin 하나이므로, 이름이 spine을 따르는 게 정직하다. **인플레이스
rename**(한 몸 유지) — 패키지명 + GitHub repo 이름 둘 다 `entwurf`로. entwurf-core를 별 repo로 *추출*하는
아키텍처 split(#38, 「큰 방향」)은 *그것과 별개의 더 먼 좌표*로 남는다. 실행은 **체크포인트 2(새 브랜치)**
— 아래 「다음」의 rename 준비 체크리스트 참조. 이 lock 커밋 시점까지는 패키지명 `pi-shell-acp` 유지
(README/VERIFY 등 published 표면은 rename 브랜치에서 결합 규칙으로 동시 갱신).

**한 줄:** v2 substrate가 spine, ACP는 그 위 plugin. 기존 citizen 대상 send/reply → `entwurf_v2`
(무에서 새 형제 만드는 fresh creation은 deferred lane).

### ACP plugin on v2 core — S0~S2f DONE (전부 GPT 적대 검수 GREEN, 2026-06-18~19)

ACP가 0.11.0 fat bridge의 기계적 port가 아니라 v2 core 위 plugin으로 *새로* 구현됨
(0.11.0 `acp-bridge.ts`는 behavior oracle이지 architecture oracle 아님). Claude-first.

| 단계 | 능력 | LIVE 증거 |
|---|---|---|
| S0 | loader/fence + provider 등록 + curated Claude + no-auth sentinel | `pi --list-models` · check-auth-boundary / check-acp-provider-surface |
| S1 | turn-free socket citizenship (ACP model이 `entwurf_peers` 1급 시민) | `smoke-acp-socket-citizen-live` |
| S2a | pinned ACP deps + raw 1턴 (stdio JSON-RPC) | `smoke-acp-raw-turn-live` |
| S2b | config overlay (격리 + 도구축소 + `hooks:{}`) + tool-surface preflight | `smoke-acp-overlay-live` |
| S2c | event mapping + `streamSimple` 실 backend (fail-loud stub 제거) | `smoke-acp-provider-live` |
| S2d | in-memory session reuse + delta-only prompt + carrier(핀1) + first-user augment | `smoke-acp-session-reuse-live` · `smoke-acp-carrier-augment-live` |
| S2e | RGG — ACP-target garden guard (deterministic 30/0) | `smoke-acp-rgg-live` |
| S2f | always-on turn-progress visibility (lifecycle notices, display-only marker) | `smoke-acp-provider-live` (L3 marker) |

deterministic 짝(check-acp-overlay/tool-surface/event-mapper/prompt-builder/session-store/session-reuse/
carrier-augment 등)은 `pnpm check`에, LIVE 짝 7개는 release-gate **MUST** tier(LIVE=1·SKIP=0이 cut 조건).

### v2 substrate 증거 (이전 floor, 그대로 유효)

| 기능 | 증거 |
|---|---|
| v2 pi live send | `smoke-entwurf-v2-matrix-live` C1 |
| v2 recordless live pi socket-only send (A1 narrow) | matrix-live C1b |
| v2 dormant pi → spawn-bg resume (실 `pi --entwurf-control` child + model turn) | `smoke-entwurf-v2-spawn-resume-live` |
| v2 active Claude Code meta → meta-mailbox enqueue + doorbell | matrix-live C2 |
| v2 honest reject (false-delivered/`.msg` garbage 0) | matrix-live C3 + deliverability gates |
| floor 0.79.8 parity (`>=0.79.8 <0.80`) | `pnpm check` + release-gate MUST |

### 다음 — 체크포인트 (GLG 결정 2026-06-22, 명확히 분리)

- **체크포인트 1 (이 브랜치 `acp-on-v2`) — 문서 정합성 lock:** ROADMAP/NEXT를 operator-세트 + rename-확정
  현실에 정렬(이 lane). 커밋 후 push=GLG. README/VERIFY/CHANGELOG 등 published 표면은 *건드리지 않는다* —
  rename 브랜치에서 결합 규칙으로 한 번에.
- **체크포인트 2 (새 브랜치) — rename 실행 + 추가 구현("더 구현할게 있다"):** 아래 rename 준비 체크리스트
  실행 → `pnpm check` + LIVE release-gate MUST green → 실사용으로 엣지케이스 노출 → 단단히 조인 뒤
  cut/publish. version bump/tag/publish/repo-rename = GLG. **0.11.0은 이미 cut된 과거 태그**라 이 컷을 다시
  0.11.0으로 부르지 않는다(CHANGELOG는 Unreleased 유지).

#### rename 준비 (`pi-shell-acp` → `entwurf`, 체크포인트 2 실행 체크리스트)

세 식별자는 *서로 다르며* 따로 바꿀 수 있다 — 호환성 위험도 다르다:
- **npm 패키지명** `@junghanacs/pi-shell-acp` → `@junghanacs/entwurf` (`package.json` name + `repository.url`). bin 없음.
- **GitHub repo 이름** `junghan0611/pi-shell-acp` → `junghan0611/entwurf` (GitHub repo rename + git remote URL + README 배지/링크).
- **런타임 provider id** `pi-shell-acp` (`acp-provider.ts` 등록 키 + Entwurf target `provider=` 라우팅) —
  **여기가 호환성 최대 위험**: 기존 `provider=pi-shell-acp` Entwurf target / package-source-routing(#29)이
  깨진다. CP2에서 hard-cut vs alias(구 id 라우팅 호환 유지) 결정.

소스/게이트 — **결합 규칙**(source와 그 게이트를 *같이* 바꿔 `pnpm check`가 silent red 안 되게):
- 소스: `entwurf-core.ts`(44) · `run.sh`(49) · `model-lock.ts`(23) · `sentinel-runner.sh`(22) ·
  `meta-bridge-state.py`(9) — `pi-shell-acp` 문자열 90파일 분포 측정.
- 이름을 assert하는 게이트: `check-package-source-routing.ts`(30) · `check-entwurf-session-identity.ts`(39) ·
  `check-model-lock.ts`(12) — provider id/패키지명 기대값 동시 갱신.
- published 문서(결합 동시 갱신): README(48) · VERIFY.md(110) · docs/setup-clean-host.md(110) ·
  CHANGELOG(90) · demo/README(20) · BASELINE.md(10) · AGENTS.md(11, **명시 요청 시에만**).

게이트: rename 후 `pnpm check` EXIT0 + `LIVE=1 ./run.sh release-gate` MUST(SKIP=0) 재확인. published
consumer 호환성(provider id)은 cut 전 GLG와 alias/hard-cut 확정.

### deferred (범위는 보임)

- **persisted resume/load (1b-2c)** — 현재는 in-memory reuse + record write만, persisted read/use는 OFF.
- **non-Claude ACP backend / Cortex lane** — vendor/governed CLI는 로컬 완전검증 가능해지면.
- **fresh sibling minting (v2 `spawn-fresh`)** — v2 3 transport는 전부 기존 citizen 대상. 무에서 새
  형제 만드는 verb는 의도적 부재(능력 구멍을 문서에 못박음, silent regression 아님).
- **test/release-gate taxonomy (#41)** — 검증 자산을 deterministic / MUST live / BEHAVIOR / utility로 재분류.

### two-tier release-gate 원리 (그대로 유효)

release-gate는 MUST(차단·exit code 소유 — transport/provider/backend invariant)와 BEHAVIOR(advisory·
비차단 — 모델이 MCP entwurf를 *자율 호출*하는가)를 분리한다. model-in-loop tool-selection은 Claude
Sonnet에서 flaky(Bash/pi-CLI 우회·포기 노출)라 한 번의 flake가 컷을 막으면 안 되기 때문. **S7(Bash
우회)은 BEHAVIOR lane 안에서도 hard FAIL** — 우회를 PASS로 둔갑시키지 않되 컷은 안 막음. ACP plugin의
7개 LIVE smoke는 programmatic invariant라 MUST(BEHAVIOR 아님). surface affordance(voscli 사건): garden
id만으론 pi인지 Claude Code meta인지 모름 → canonical delivery = `entwurf_v2`로 못박음.

---

## 가까운 lane

### 0.11.1 / Stage 1
- **Claude Code tmux-live / Claude↔Claude live transport** — v2 production transport 구현(현재 enum만).
- **recordless dormant pi resume** — record 없이 cwd/model/resume authority 확보(JSONL-header authority
  resume 별도 설계 / A2 / Entwurf-core identity layer).
- **GC** (meta-record 누적) — `entwurf_peers` default live+recent+cwd 제한, dormant/meta 옵션화,
  stale marker·read body GC, record archive/TTL/lastSeen. **GC = 프로세스 자원 회수만, 데이터 삭제 아님.**
- **SE-3 readability** — 정직한 `replyable:false`가 버그로 오인되는 silent degraded addressability(가독성).
- **`/gnew` T3 backend axis** — 현재 claude-sonnet-4-6만 측정. codex/gemini로 확장.

### fresh-mint lane (v1 제거는 이미 완료)
- **v1 removal — DONE (v2 core).** v1 entwurf verbs(`entwurf`/`entwurf_resume`/`entwurf_send`), pi-native
  `entwurf_send`, `/entwurf*` 명령은 모두 제거됨. 현 surface = `entwurf_v2` + `entwurf_peers` +
  `entwurf_self` + `entwurf_inbox_read`. (옛 "unregister-토글 / V2_ONLY hide" lane은 v1이 사라져 moot.)
- **🔴 fresh sibling minting = 명시적 연기 (GLG 결정 2026-06-16).** v1 `entwurf.ts`("spawn a dedicated
  pi process to run a NEW task")가 fresh-mint 본체였고 v2 core에서 통째 삭제됨. v2의 3 transport
  (control-socket / spawn-bg **resume** / meta-mailbox)는 전부 **기존** garden citizen 대상 — 무에서
  새 형제를 만드는 verb는 v2에 없다(능력 구멍을 문서에 못박음, silent regression 아님). fresh-mint의
  v2 대체(4번째 transport `spawn-fresh` + 11-scenario gate)는 후속 lane. 그동안 이 트리는 "새 분신
  생성"이 필요한 데일리 드라이버로는 안 쓴다(기존 citizen resume/dispatch 전용).

---

## 큰 방향 — entwurf-core / ACP plugin 아키텍처 split (GLG 결정 2026-06-16, 2026-06-22 갱신)

**이번 인플레이스 rename(`pi-shell-acp`→`entwurf`, 「현재」 참조)과는 *별개의 더 먼 좌표*다.** rename은
이름을 spine에 맞추는 것이고(같은 한 몸), split은 한 몸인 코드를 *물리적으로 쪼개는* 것이다.
**언젠가 entwurf-core(v2 인터페이스)를 별 repo로 추출**해 ACP plugin과 분리할 수 있다 — 집중을 위해. 단
이것은 **deferred coordinate**(#38), 이번 lane이 아니다. 지금(그리고 rename 직후에도) 이 repo가 v2
dispatch substrate + meta-bridge + ACP plugin을 한 몸으로 들고 간다.

- v2(garden citizen에 대한 결정적 dispatch substrate: liveness×intent → control-socket / spawn-bg
  resume / meta-mailbox)는 분리 시 새 `entwurf` repo에서 깨끗이 자랄 후보다.
- **entwurf-core** = identity / garden id / inbox / liveness / dispatch / replyability / evidence 추출이
  그 첫 몸.
- split 전까지 (그리고 rename 후) `entwurf` = **v2 core + meta-bridge + ACP plugin**(v1은 이미 제거됨,
  한 몸). ACP는 plugin, boundary 아님(#38).

---

## 동결 invariant — 넘으면 안 되는 선 (전부 #35)

- **Workshop, not factory.** 살아있는 소수 도제 = 재질문 가능, 상태는 세션 안 → 외부 DB(beads/dolt) 금지.
- **GC = 프로세스 자원 회수만, 데이터 삭제 절대 아님.** meta-record/transcript(denote-id 기억층) 보존.
- **garden-id = authority, tmux = ephemeral.** 세션명=path(grouping), window 번호 renumber.
- **Factory 작업 OUT.** worktree·merge-wall fan-out 없음 → 백엔드 자체 orchestrator로 위임.

---

## 핵심 아키텍처 — 데이터 4분리 + 한 동사

- **record(누구였나) / capabilities(무엇·어떻게 깨움) / mailbox(메시지·receipt) / probe(지금 살아있나,
  저장 안 함 — 매번 계산).** 상태를 저장하면 거짓말이 된다(denote-instinct 함정).
- **두 레인 둘 다 KEEP:** `pi -p` headless(오케스트레이션, 가벼움) + tmux-live(`--entwurf-control` 소켓,
  도제). resume/send는 세션 type이 아니라 **현재 liveness의 함수** — dormant→resume, live→send.
- **entwurf = 한 동사(`entwurf_v2`로 통합, 레거시 공존).** `entwurf_peers` = 읽기 전용 fact 표면
  (liveness/capability/identity/cwd-이력만) — `resumable`/`sendable` 같은 verb-routing을 fact 층에 굽지
  않는다. 기존 `entwurf`/`_resume`/`_send`는 완전 전환까지 유지.
- **브레인 ↔ 핸드 분리(둘 다 TS).** 브레인 = TS fact 모듈(disk SSOT meta-record를 읽음, in-memory Map의
  형제-비가시성 대체). 핸드 = 기계적 실행. **최종 형제 선택은 에이전트, 모듈은 근거 제공.** 부가 신호
  (쿼터·시스템 부하)는 substrate가 아니라 에이전트 층 — substrate에 저장하지 않는다.

### meta-record v2 (nullable-at-birth)
`{ schemaVersion:2, gardenId, backend, nativeSessionId, cwd, model:null, transcriptPath:null,
parentGardenId:null, isEntwurf:false, createdAt, recordUpdatedAt }`. `model`/`transcriptPath` nullable
근거 = 어느 백엔드도 birth stdin에 model 없음, pi backend는 birth에 transcript 미확정. v1 receipt 필드는
읽되 v2에선 mailbox state로 이동. `recordUpdatedAt` = record touch time(liveness 아님).

---

## 동결 결정 (frozen decisions — 재설계 금지)

1. 능력 레지스트리 = 별도 `entwurf-capabilities.json`(launch allowlist와 별 관심사).
2. v1→v2 = `parseMetaRecordV1/V2`→`normalizeMetaIdentity` dual-read + lazy normalize, 새 write는 v2.
3. correlation = 소켓파일명 + tmux `@garden_id`. **env probe 폐기**(상속 누수); lineage는 launcher가
   `PARENT_SESSION_ID`를 명시 set. 안전 tmux 필드 = `@garden_id`+`pane_id`+`pane_pid`만(`pane_title`은
   shell 의존이라 authority 금지).
4. preflight/facts owner = **단일 TS 모듈**. launcher / global `project_trust` handler / MCP fact tool은
   결과만 소비, 누구도 prefix/trust 판정 재구현 안 함. **trust ≠ discovery**: trust는 launch-time 단일
   cwd만; peers/discovery는 trust 불필요.
5. untrusted controlled launch = **fail-fast**(조용한 `--no-approve` degraded 금지). trusted만 `--approve`.
   진짜 근거 = untrusted repo의 `.pi/settings.json`이 bridge로 적용되는 위험.
6. `project_trust` handler `remember` = **false**(prefix policy = SSOT). carve-out: 사람이 명시적으로
   상속-distrust를 덮어쓴 child override는 `remember:true` 저장.
7. prefix auto-approve roots = **operator policy, NOT package default**(public package 보안 footgun 방지).
   source = trusted operator surface만(`PI_SHELL_ACP_TRUST_ROOTS` env / user-global / agent-config). match =
   canonical path + separator boundary(bare `startsWith` 금지). GLG 기본 = `~/repos/gh`,`~/repos/work`,`~/org`.
8. **precedence 동결:** `saved false > saved true > prefix match > no-trust-inputs > fail-fast`.
9. **import surface = public root export만**(`getAgentDir`/`hasProjectTrustInputs`/`ProjectTrustStore`/
   `VERSION` + handler 타입). private subpath import 금지 = 공짜 drift 게이트. runtime은 `VERSION >= floor` fail-loud.
10. **공개 동사 먼저 축소(contract-lock) → fact-provider(facts only) → dispatch.** entwurf 공개 표면을 한
    동사로 줄이고 `entwurf_peers`를 읽기 전용으로 못박는 걸 fact-provider 빌드보다 먼저. 통합 dispatch는
    레거시 공존 새 이름(`entwurf_v2`)으로 additive. 레거시 3-verb 은퇴는 v2 증명 + 완전 전환 이후.

---

## 검증 원장 (measured, 재탐색 불필요)

- **pi 0.79 public export:** `hasProjectTrustInputs`/`ProjectTrustStore`/`getAgentDir`/`VERSION` 모두 index
  public export → TS 직접 import(재구현 불필요). floor = **0.79.8** (`>=0.79.8 <0.80`, next-minor 상한; 이전 0.11.0 floor=0.79.4).
- **pi trust(0.79.1+):** `pi -p`는 trust에서 안 멈춤(비대화 미결정→`false` degraded). `--approve`(`-a`)=
  project 파일 로드, `--no-approve`(`-na`)=무시·degraded. `ProjectTrustStore.get`은 nearest-ancestor
  walk-up(조상 cwd 결정을 자식이 상속). `AGENTS.md`/`CLAUDE.md`는 0.79.1에서 trust input에서 제거(항상
  로드되는 context file). 우리 AGENTS 주입은 trust 무관 자체 경로.
- **pi resume = no-lock append:** `SessionManager`는 신규 첫 flush만 `openSync(wx)`(생성 가드). resume은
  plain `appendFileSync`(락 없음) → pi는 동시-resume self-guard 안 함 → v2는 target=존재 시민이라 항상
  resume → **per-gid lockfile이 유일 가드.**
- **pi liveness:** 소켓 = `~/.pi/entwurf-control/<gid>.sock`(파일명=garden_id). LIVE/STALE authority =
  socket connect + RPC `get_info`(`entwurf-control.ts`에 `isSocketAlive`/`getLiveSessionsWithInfo`/
  `gcStaleSockets`). `ss`/`kill -0`은 디버그 보조일 뿐 authority 아님.
- **pi tmux 부팅:** `pi --session-id <gid> --entwurf-control --approve --provider … --model …` → 소켓 생성·
  trust prompt 없음·TUI ready. controlled invariant(`--approve` 주입) live-smoke 게이트화 가능.

---

## Backlog 트랙 (0.11.0 별개, GLG 재오픈 시)

- **Post-0.10 meta-bridge:** #34 잔여(empirical probe 4종 + unread-mailbox heartbeat), Phase 4 GC 자동화
  (`--apply`/TTL/liveness 코드화), step 7 `entwurf_peers(includeMeta)` 발견성.
- **Carried 0.9:** `/gnew` T3 codex/gemini 확장, `/gnew` empty-session GC(cross-cutting), `entwurf.ts`
  source guard refinement(plain UI send 추가 시 allowlist로 좁히되 equality 안 느슨하게).
- **Dep bump(별도 트랙):** claude-agent-acp 0.40.0 / sdk 0.24.0. sdk 0.24가 `unstable_setSessionModel`
  제거 → `session/set_config_option(configId="model")`로 마이그레이션 필요. codex/gemini model-forcing은
  그 RPC가 유일 경로라 `as any` 캐스트는 silent regress(=`check-sdk-surface`가 막는 anti-pattern).
- **Standing focus — Mitsein over MCP:** plain external(non-replyable) vs garden-native meta-session
  (replyable by garden id) 구분이 agent 발화에 정직히 반영되는가. native Claude meta-session이
  external-mcp로 퇴행하거나 `wants_reply=true`를 비대칭 거절하면 버그.
- **Session continuity hygiene:** `incompatible_config`가 너무 넓음 → 축별 diff 출력 + reason taxonomy
  (`auth-profile`/`auth-epoch`/`system-prompt`/`mcp`/`transcript-missing`/`emacs-socket`/`tool-surface`).
  `emacsAgentSocket` 누락이 대표 footgun.
- **#25 bridge hygiene(OpenClaw audit lessons):** transcript pre-flight(backend jsonl verifier), session
  cache hygiene(idle timeout/LRU/max-N), single-turn lock per session.

---

## Deprecated — closed, do not reopen

- **OpenClaw track(2026-06-10 종료):** `plugins/openclaw` deprecated & unmaintained. Claude/Gemini가 ACP
  네이티브 지원 → wrapper 존재 이유 소멸. npm `@junghan0611/openclaw-pi-shell-acp@0.0.1` deprecate 마킹,
  소스 reference 동결.
- **Gemini CLI(2026-06-18 deprecated):** Google AI Pro/Ultra·무료 tier 대상 종료 → Antigravity CLI 이관.
  repo는 Gemini 어댑터 코드를 **호환성용 잔존**, README는 더 이상 추천 setup 경로로 제시 안 함.
- **Long-term/separate issues:** #11 remote SSH resume cwd(원격 entwurf identity는 의도적 fail-fast),
  #10 broader ontology RFC, #8 ACP `entwurf_send` message visibility UX, #2 pi-first context meter, L5 long soak.

---

## Reference paths

- 본체: `~/repos/gh/pi-shell-acp/` · Consumer: `~/repos/gh/agent-config/` · NixOS: `~/repos/gh/nixos-config/`
- 미래 split 대상(#38, rename과 별개): entwurf-core(v2 interface)를 ACP plugin에서 떼어낸 별 repo
