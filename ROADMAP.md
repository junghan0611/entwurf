# entwurf ROADMAP — 현재 + 미래 방향

> 이 문서는 **현재이자 미래방향**이다. `NEXT.md`는 disposable한 다음-한-걸음 나침반,
> `CHANGELOG.md`는 게시되는 "닫힌 변경" 핵심 로그, 이 `ROADMAP.md`는 게시되지 않는
> 내부 방향/설계 SSOT. 닫힌 작업의 세션별 process 잡음은 git 커밋 history에 산다.
> (NEXT는 npm tarball에서 제외, ROADMAP도 제외 — 내부 detail 안전. CHANGELOG는 게시됨.)

---

## 현재 — 0.12.x: agy shipped, mux next, Cortex는 0.13.0

이 repo는 **entwurf-core(v2 garden-citizen dispatch) + native-harness bridges + pi adapter + ACP plugin**이다.
0.12.0의 `pi-shell-acp`→`entwurf` hard-cut은 끝났다. 현재 0.12.x는 Claude mailbox, pi socket/resume,
Antigravity native-push를 한 garden-id dispatch 표면에서 출하하며, 다음 0.12.x 구현은 mux-visible fresh
spawn(#47)이다. Cortex backend(#48)는 0.13.0에 예약한다. Pi는 오늘 가장 깊이 붙은 adapter지만,
프로젝트의 본질은 **garden id로 호명 가능한 형제 세션 사이의 얇은 dispatch substrate**다.

v1 entwurf verbs(`entwurf`/`entwurf_resume`/`entwurf_send`)는 끝났고 사라졌다. `entwurf_v2`가 척추다.
기존 citizen 대상 send/reply/resume → `entwurf_v2`; 무에서 새 형제를 만드는 fresh creation은 deferred lane.

### Vocabulary guard — 익숙한 말로 되돌리지 않는다

- **garden id**: 의도적으로 낯선 주소어. session id / worker id / delegate id로 번역하지 않는다.
- **citizen / sibling**: backend를 pi의 worker로 낮추지 않는다. 각 harness는 자기 transcript/auth/runtime을 가진다.
- **thin bridge**: auth 우회, transcript hydration, ambient MCP scanning, giant hidden prompt를 하지 않는다.
- **tool narrowing**: subagent 없음, todo tool 없음, yolo/좁은 tool surface는 기능 부족이 아니라 힣의 드라이버 규율이다.

### Current shipped / probe matrix

| Harness / rail | 0.12.x status | 이 repo에서의 정체 | Evidence |
|---|---|---|---|
| **pi** | shipped | control-socket adapter + spawn-bg resume host. ACP plugin도 pi provider/model로 들어온다. | `pnpm check`, v2 matrix/spawn LIVE, release-gate MUST |
| **Claude Code** | shipped | SessionStart meta-bridge → garden id + mailbox + trusted marker. Transcript를 가져오지 않는다. | meta-session gates, mailbox/deliverability, `doctor-meta-bridge` |
| **ACP Claude** | shipped | Claude-first ACP plugin backend under local operator auth; socket-citizen rail. | ACP LIVE smokes + release-gate MUST |
| **Codex** | verified probe | direct/native delivery evidence exists; no managed native-citizen lifecycle yet. Default is not ACP. | DELIVERY.md raw probe / external MCP evidence |
| **Antigravity (`agy`)** | shipped | `PreInvocation` auto-birth + record-backed sender + native LS gRPC push; managed MCP/permission, statusline, hook adapters. | agy deterministic gates + doctors + 2026-07-13 live round trip |
| **Cortex / governed ACP** | deferred | future non-Claude ACP backend candidate. | design lane only |
| **Gemini CLI** | deprecated path | replaced by Antigravity direction for current Google individual tiers. | README migration note |

### ACP plugin boundary

ACP는 중심이 아니라 v2 core 위에 provider/model로 들어오는 **plugin 하나**(#38)다. Host
`--entwurf-control` pi 세션이 *이미* v2 socket-citizen이고, plugin은 socket/peers/citizen 층을 새로 만들지
않는다. Claude-first이며, backend auth는 operator의 로컬 상태에 맡긴다. No OAuth proxy, no subscription bypass.

| 단계 | 능력 | LIVE 증거 |
|---|---|---|
| S0 | loader/fence + provider 등록 + curated Claude + no-auth sentinel | `pi --list-models` · check-auth-boundary / check-acp-provider-surface |
| S1 | turn-free socket citizenship (ACP model이 `entwurf_peers` 1급 시민) | `smoke-acp-socket-citizen-live` |
| S2a | pinned ACP deps + raw 1턴 (stdio JSON-RPC) | `smoke-acp-raw-turn-live` |
| S2b | config overlay (격리 + 도구축소 + `hooks:{}`) + tool-surface preflight | `smoke-acp-overlay-live` |
| S2c | event mapping + `streamSimple` 실 backend | `smoke-acp-provider-live` |
| S2d | in-memory session reuse + delta-only prompt + carrier(핀1) + first-user augment | `smoke-acp-session-reuse-live` · `smoke-acp-carrier-augment-live` |
| S2e | RGG — ACP-target garden guard | `smoke-acp-rgg-live` |
| S2g | operator mcpServers/skills + bundled bridge | deterministic split pending for bundled-mcp MUST vs BEHAVIOR |

### v2 substrate evidence

| 기능 | 증거 |
|---|---|
| v2 pi live send | `smoke-entwurf-v2-matrix-live` C1 |
| v2 record-less socket 거부 — 모든 intent pre-probe `record-less-socket`, 원인+M1 명명 (#50 C4; A1 narrow 은퇴) | matrix-live C1b |
| v2 dormant pi → spawn-bg resume (실 `pi --entwurf-control` child + model turn) | `smoke-entwurf-v2-spawn-resume-live` |
| v2 active Claude Code meta → meta-mailbox enqueue + doorbell | matrix-live C2 |
| v2 live Antigravity → native-push direct injection | native-push adapter/register/decider gates + `smoke-agy-native-push-live` |
| agy automatic citizen birth + sender/reply identity | hooks/statusline/install/sender gates + three doctors + fresh live round trip |
| v2 honest reject (false-delivered/`.msg` garbage 0) | matrix-live C3 + deliverability/native-push reject gates |
| pi 0.80.7 fence | `pnpm check` + release-gate MUST |

### Historical — 0.12.0 cutover close checklist

- ✅ README / DELIVERY / BASELINE / VERIFY / CHANGELOG를 0.12.0 현재 표면으로 재정리했다.
- ✅ 오래된 `pi-shell-acp` / `pi-tools-bridge` / clean-host 중심 문서는 live-instruction 표면에서 제거하거나 history/cutover 문맥으로 한정했다.
- ✅ release cut 직전 `pnpm check` + `check-pack` + `check-pack-install` + `LIVE=1 ./run.sh release-gate <scratch>`를 재확인했다: 2026-06-25 MUST `PASS=17 FAIL=0 SKIP=0`; BEHAVIOR `/gnew` T3 `entwurf_self` flake 1건은 advisory.
- `smoke-acp-bundled-mcp-live`의 MUST/model-in-loop 불일치를 split한다: deterministic bundled bridge proof는 MUST,
  모델 자율 tool-call echo는 BEHAVIOR. 이번 cut에서는 PASS였지만 taxonomy hardening으로 남긴다.
- 데모 gif / hero 이미지를 새 표면에 맞춰 재생성한다.
- **ACP 백엔드 어댑터 레일을 재도입한다 (아래 표준궤 섹션).**

### Historical design record — 0.12.0 ACP 백엔드 어댑터 레일

PR #40(Snowflake Cortex Code, hvkiefer)이 드러낸 핵심: 0.11.0엔 `AcpBackendAdapter` 어댑터 패턴
(`type AcpBackend`=claude|codex|gemini, `ACP_BACKEND_ADAPTERS` Record, `resolveAcpBackendAdapter`)이
있었고 PR은 거기에 cortex를 4번째로 끼웠다. 그러나 0.12.0 cutover가 fat `acp-bridge.ts`를 통째 버리고
Claude-first로 새로 빌드하며 그 추상화를 제거 → 현재 `lib/acp/`는 claude 단선 + `config.ts:374`
non-claude **throw** 가드. **백엔드 추가 레일이 0.11.0보다 후퇴**(단일 claude 코드 품질은 향상).

- **결정:** `AcpBackendAdapter` 인터페이스를 plugin 구조 위에 재도입하고 claude를 그 *첫 구현*으로
  리팩터한다. cortex가 2번째 백엔드 = 추상화를 정당화하는 첫 실수요("2개부터 패턴이 산다").
  레일을 표준궤로 못박는 것이 곧 0.12.0에 담을 내용이다.
- **7 seam:** `resolveLaunch` · `ensureOverlay`(auth passthrough+state hiding) · `buildSessionMeta`
  (carrier; cortex=undefined→first-user augment) · curated models+prefix 라우팅(`inferBackendFromModel`) ·
  model enforcement(claude=`session/set_config_option` / cortex=launch-time `-m` pin) ·
  settings+`bridgeConfigSignature` · gates(`check-backends`/`check-models`/`smoke-cortex`).
- **역할 분담:** GLG가 레일(인터페이스 + claude 리팩터)을 깔고, 기여자(hvkiefer)가 PR #40을 0.12.0
  `lib/acp/` 어댑터 하나로 포팅한다. 설계 SSOT = `docs/acp-backend-rail.md`. GPT 논의 후 확정.

### deferred (범위는 보임)

- **persisted resume/load (1b-2c)** — 현재는 in-memory reuse + record write만, persisted read/use는 OFF.
- **Cortex 백엔드 자체의 운영 lane** — 어댑터 레일(위 표준궤 섹션)이 0.12.0에 들어간 *뒤*, 기여자가
  PR #40을 어댑터로 포팅하고 로컬 완전검증(`smoke-cortex`)이 서면 운영 surface로 승격. 레일=0.12.0,
  백엔드 검증=그 위에서. (이전 "vendor CLI 검증되면" 단일 항목을 레일/백엔드로 분리.)
- **fresh sibling minting (v2 `spawn-fresh`)** — v2 4 transport(control-socket / spawn-bg resume /
  meta-mailbox / native-push)는 전부 기존 citizen 대상. 무에서 새 형제 만드는 verb는 의도적 부재
  (능력 구멍을 문서에 못박음, silent regression 아님).
- **test/release-gate taxonomy (#41)** — 검증 자산을 deterministic / MUST live / BEHAVIOR / utility로 재분류.

### two-tier release-gate 원리

release-gate는 MUST(차단·exit code 소유 — transport/provider/backend invariant)와 BEHAVIOR(advisory·
비차단 — 모델이 MCP entwurf를 *자율 호출*하는가)를 분리한다. model-in-loop tool-selection은 Claude
Sonnet에서 flaky라 한 번의 flake가 컷을 막으면 안 된다. 우회/포기는 BEHAVIOR lane 안에서도 hard FAIL로
기록하되 컷은 막지 않는다. 단, MUST에 model-in-loop가 섞인 gate는 split해야 한다.

---

## 가까운 lane

### Carried post-v2 lanes
- **Claude Code tmux-live / Claude↔Claude live transport** — v2 production transport 구현(현재 enum만).
- ~~**recordless dormant pi resume**~~ — **#50 C4가 이 lane의 전제를 닫았다**: record가 유일한 주소
  권위이고(목표 ②), record-less socket은 시민이 아니라 진단 대상이다. 재오픈하려면 "record 없이
  resume authority"가 아니라 "그 resident를 record로 데려오는 경로"(재시작 / M1)를 설계해야 한다.
- **GC** (meta-record 누적) — `entwurf_peers` default live+recent+cwd 제한, dormant/meta 옵션화,
  stale marker·read body GC, record archive/TTL/lastSeen. **GC = 프로세스 자원 회수만, 데이터 삭제 아님.**
- **SE-3 readability** — 정직한 `replyable:false`가 버그로 오인되는 silent degraded addressability(가독성).
- ~~**`/gnew` T3 backend axis**~~ — **주제 소멸**: `/gnew`·`garden-new` 명령은 #50 C2에서 삭제됐다
  (id를 단속할 대상이 없다 — pi가 자기 세션 id를 민팅하고 record가 주소를 민팅한다). 인-프로세스
  new/fork/clone은 이제 pi 자신의 것이고 `session_start`가 새 시민으로 붙인다.

### fresh-mint lane (v1 제거는 이미 완료)
- **v1 removal — DONE (v2 core).** v1 entwurf verbs(`entwurf`/`entwurf_resume`/`entwurf_send`), pi-native
  `entwurf_send`, `/entwurf*` 명령은 모두 제거됨. 현 MCP surface = `entwurf_v2` + `entwurf_peers` +
  `entwurf_self` + `entwurf_inbox_read` + 기존 native conversation을 묶는 수동 fallback
  `entwurf_register_native`. (옛 "unregister-토글 / V2_ONLY hide" lane은 v1이 사라져 moot.)
- **🔴 fresh sibling minting = 명시적 연기 (GLG 결정 2026-06-16).** v1 `entwurf.ts`("spawn a dedicated
  pi process to run a NEW task")가 fresh-mint 본체였고 v2 core에서 통째 삭제됨. v2의 4 transport
  (control-socket / spawn-bg **resume** / meta-mailbox / native-push)는 전부 **기존** garden citizen 대상 — 무에서
  새 형제를 만드는 verb는 v2에 없다(능력 구멍을 문서에 못박음, silent regression 아님). fresh-mint의
  v2 대체(4번째 transport `spawn-fresh` + 11-scenario gate)는 후속 lane. 그동안 이 트리는 "새 분신
  생성"이 필요한 데일리 드라이버로는 안 쓴다(기존 citizen resume/dispatch 전용).

---

## 큰 방향 — entwurf-core / ACP plugin 아키텍처 split (GLG 결정 2026-06-16, 2026-06-22 갱신)

**0.12.0 rename cutover와는 *별개의 더 먼 좌표*다.** rename은 이름을 spine에 맞춘 것이고(같은 한 몸),
split은 한 몸인 코드를 *물리적으로 쪼개는* 것이다.
**언젠가 entwurf-core(v2 인터페이스)를 별 repo로 추출**해 ACP plugin과 분리할 수 있다 — 집중을 위해. 단
이것은 **deferred coordinate**(#38), 이번 lane이 아니다. 지금(그리고 rename 직후에도) 이 repo가 v2
dispatch substrate + meta-bridge + ACP plugin을 한 몸으로 들고 간다.

- v2(garden citizen에 대한 결정적 dispatch substrate: rail-specific liveness×intent → control-socket /
  spawn-bg resume / meta-mailbox / native-push)는 분리 시 새 `entwurf` repo에서 깨끗이 자랄 후보다.
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
- **레인은 transport별로 KEEP:** pi socket/headless resume, Claude mailbox self-fetch, agy native-push.
  resume/send는 세션 type 문자열이 아니라 **각 rail에서 현재 측정한 liveness의 함수**다.
- **entwurf = 한 동사(`entwurf_v2`).** `entwurf_peers` = 읽기 전용 fact 표면
  (liveness/capability/identity/cwd-이력만) — `resumable`/`sendable` 같은 verb-routing을 fact 층에 굽지
  않는다. 기존 `entwurf`/`_resume`/`_send`는 제거 완료.
- **브레인 ↔ 핸드 분리(둘 다 TS).** 브레인 = TS fact 모듈(disk SSOT meta-record를 읽음, in-memory Map의
  형제-비가시성 대체). 핸드 = 기계적 실행. **최종 형제 선택은 에이전트, 모듈은 근거 제공.** 부가 신호
  (쿼터·시스템 부하)는 substrate가 아니라 에이전트 층 — substrate에 저장하지 않는다.

### meta-record V3 (nullable-at-birth) — #50 C1 hard cut
`{ schemaVersion:3, gardenId, backend, nativeSessionId, cwd, model:null, transcriptPath:null,
createdAt, recordUpdatedAt }`. `model`/`transcriptPath` nullable 근거 = 어느 백엔드도 birth stdin에
model 없음, pi backend는 birth에 transcript 미확정. `recordUpdatedAt` = record touch time(liveness 아님).

**프로덕션은 schemaVersion 3만 읽는다.** v1/v2 record를 만나면 fail-loud로 M1 명령
(`./run.sh meta-bridge-migrate-v3 migrate`)을 이름으로 지목하고, frozen legacy reader는
`pi-extensions/lib/meta-migration.ts` 한 주소에만 산다. 은퇴한 v2 필드 `parentGardenId`/`isEntwurf`는
**stray key로 거부된다** — 되살리지 마라(LOCKED PROTOCOL 6: record-backed pi 시민은 전부 sibling,
`isEntwurf` 종 boolean 부활 금지). v1 receipt 필드는 mailbox state로 이동한 그대로.

---

## 동결 결정 (frozen decisions — 재설계 금지)

> 번호는 고정이다 — 코드가 "frozen decision N"으로 참조한다(4·7·8·9·10 등). 뒤집힌 항목은
> 지우지 말고 취소선으로 남긴다: 번호를 재조정하면 그 참조가 깨지고, 빈 자리가 "왜 없지"를 낳는다.

1. 능력 레지스트리 = 별도 `entwurf-capabilities.json`(launch allowlist와 별 관심사).
2. ~~v1→v2 = `parseMetaRecordV1/V2`→`normalizeMetaIdentity` dual-read + lazy normalize, 새 write는 v2.~~
   **#50 hard cut이 이 결정을 뒤집었다 — 재설계 금지 대상 아님(오히려 되살리는 것이 금지다).** 프로덕션은
   V3-only(`parseMetaRecordAny`=v3 only), dual-read는 삭제됐고 v1/v2 reader는 `meta-migration.ts` 한 주소에
   frozen. pre-cut store는 명시적 M1(`./run.sh meta-bridge-migrate-v3 migrate`)로만 옮긴다. 아래 「meta-record
   V3」 절 참조.
3. ~~correlation = 소켓파일명 + tmux `@garden_id`; env probe 폐기; lineage는 launcher가 `PARENT_SESSION_ID`를
   명시 set.~~ **C1–C3가 이 correlation/lineage 설계를 대체했다.** 주소축은 meta-record 하나이고(LOCKED
   PROTOCOL 1), record엔 parent/lastCaller/worker tree가 없다(LOCKED PROTOCOL 5) — `PARENT_SESSION_ID`도
   tmux `@garden_id` correlation도 코드에 없다. socket은 record gardenId로 키잉되는 내부 transport일 뿐
   (C4, LOCKED PROTOCOL 3).
4. preflight/facts owner = **단일 TS 모듈**. launcher / global `project_trust` handler / MCP fact tool은
   결과만 소비, 누구도 prefix/trust 판정 재구현 안 함. **trust ≠ discovery**: trust는 launch-time 단일
   cwd만; peers/discovery는 trust 불필요.
5. untrusted controlled launch = **fail-fast**(조용한 `--no-approve` degraded 금지). trusted만 `--approve`.
   진짜 근거 = untrusted repo의 `.pi/settings.json`이 bridge로 적용되는 위험.
6. `project_trust` handler `remember` = **false**(prefix policy = SSOT). carve-out: 사람이 명시적으로
   상속-distrust를 덮어쓴 child override는 `remember:true` 저장.
7. prefix auto-approve roots = **operator policy, NOT package default**(public package 보안 footgun 방지).
   source = trusted operator surface만(`ENTWURF_PREFIX_ROOTS` env / user-global / agent-config). match =
   canonical path + separator boundary(bare `startsWith` 금지). GLG 기본 = `~/repos/gh`,`~/repos/work`,`~/org`.
8. **precedence 동결:** `saved false > saved true > prefix match > no-trust-inputs > fail-fast`.
9. **import surface = public root export만**(`getAgentDir`/`hasProjectTrustInputs`/`ProjectTrustStore`/
   `VERSION` + handler 타입). private subpath import 금지 = 공짜 drift 게이트. runtime은 `VERSION >= floor` fail-loud.
10. **공개 동사 먼저 축소(contract-lock) → fact-provider(facts only) → dispatch.** entwurf 공개 표면을 한
    동사로 줄이고 `entwurf_peers`를 읽기 전용으로 못박는 걸 fact-provider 빌드보다 먼저. 통합 dispatch는
    레거시 공존 새 이름(`entwurf_v2`)으로 additive. 레거시 3-verb 은퇴는 v2 증명 + 완전 전환 이후.

---

## 검증 원장 (measured, 재탐색 불필요)

- **pi 0.80 public export:** `hasProjectTrustInputs`/`ProjectTrustStore`/`getAgentDir`/`VERSION` 모두 index
  public export → TS 직접 import(재구현 불필요). floor = **0.80.7** (`>=0.80.7 <0.81`, next-minor 상한).
- **pi trust(0.79.1+):** `pi -p`는 trust에서 안 멈춤(비대화 미결정→`false` degraded). `--approve`(`-a`)=
  project 파일 로드, `--no-approve`(`-na`)=무시·degraded. `ProjectTrustStore.get`은 nearest-ancestor
  walk-up(조상 cwd 결정을 자식이 상속). `AGENTS.md`/`CLAUDE.md`는 0.79.1에서 trust input에서 제거(항상
  로드되는 context file). 우리 AGENTS 주입은 trust 무관 자체 경로.
- **pi resume = no-lock append:** `SessionManager`는 신규 첫 flush만 `openSync(wx)`(생성 가드). resume은
  plain `appendFileSync`(락 없음) → pi는 동시-resume self-guard 안 함 → v2는 target=존재 시민이라 항상
  resume → **per-gid lockfile이 유일 가드.**
- **pi liveness:** 소켓 = `~/.pi/entwurf-control/<gid>.sock`(파일명=garden_id, record가 키). LIVE/STALE
  authority = `probeSocketLiveness`(3-value connect probe) — 목록은 `scanSocketProbes`, GC는
  `gcStaleSockets`(#50 C4: `isSocketAlive`/`getLiveSessionsWithInfo` 소켓-스캔 lane은 삭제됨).
  `ss`/`kill -0`은 디버그 보조일 뿐 authority 아님.
- **pi tmux 부팅:** `pi --entwurf-control --approve --provider … --model …` → record가 주소를 민팅하고
  소켓 생성·trust prompt 없음·TUI ready (#50 C2: `--session-id` 주입 계약 은퇴). controlled
  invariant(`--approve` 주입) live-smoke 게이트화 가능.

---

## Backlog 트랙 (0.12.x 이후, GLG 재오픈 시)

- **Post-0.10 meta-bridge:** #34 잔여(empirical probe 4종 + unread-mailbox heartbeat), Phase 4 GC 자동화
  (`--apply`/TTL/liveness 코드화), step 7 `entwurf_peers(includeMeta)` 발견성.
- ~~**Carried 0.9**~~ — 세 항목 전부 **주제 소멸**: `/gnew` T3 확장과 `/gnew` empty-session GC는
  명령이 #50 C2에서 삭제되며 대상을 잃었고, `entwurf.ts` source guard refinement는 v1 본체가 0.12
  cutover에서 제거되며 같이 사라졌다.
- **Dep bump(별도 트랙):** claude-agent-acp / ACP SDK bump는 `check-acp-sdk-surface`와 raw LIVE로 잠근다.
  0.12.3 준비선은 claude-agent-acp 0.54.1 / sdk 1.1.0이며 model forcing은 `session/set_config_option(configId="model")`.
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
  #10 broader ontology RFC, #8 ACP `entwurf_v2` message visibility UX, #2 pi-first context meter, L5 long soak.

---

## Reference paths

- 본체: `~/repos/gh/entwurf/` · Consumer: `~/repos/gh/agent-config/` · NixOS: `~/repos/gh/nixos-config/`
- 미래 split 대상(#38, rename과 별개): entwurf-core(v2 interface)를 ACP plugin에서 떼어낸 별 repo
