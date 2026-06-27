# NEXT — `entwurf-rename` · 0.12.0 릴리즈 컷 전 문서/설치면 정비

> 나침반이지 DB가 아니다: **현재 위치 · 다음 한 걸음 · 넘으면 안 되는 선**만 여기 둔다.
> 설계 SSOT(동결 결정·검증 원장·아키텍처·backlog) = `ROADMAP.md`. 게시 닫힌-변경 = `CHANGELOG.md`.
> 세션별 process history = git 커밋 log.
>
> **2026-06-27 대정리:** rename 코드 cutover(S1/S2/S3)는 끝났고 repo는 `~/repos/gh/entwurf`에 안착했다.
> 그 rename 액션 플랜 원장(토큰 매트릭스 §2 · env taxonomy §3 · 담당자 위임 §4 · 액션 플랜 §5 ·
> GLG 시퀀스 §6 등 ~280줄)은 **이 커밋 직전 NEXT.md(git history)** 에 전문 보존하고, NEXT를 현재 stem
> = **릴리즈 컷 전 문서/설치면 정비**로 축소했다. 살아있는 불변/교리만 아래에 압축해 남긴다.

---

## NOW — stem = 0.12.0 릴리즈 컷 전 문서/설치면 정비 (issue #44)

- **Stem:** 코드 cutover/ACP 레일은 다 됐다. main에 올리기 전 **문서·설치면·안 쓰는 파일**을 entwurf
  이름으로 정비한다(issue #44 GLG 워딩). "본질에서 프로젝트 지향점이 바뀌었다 — pi는 4번째 하네스,
  entwurf가 본질." 코덱스/agy는 메시지 전송 검증 끝 → 문서 조인 뒤 지원.
- **1차 재검수 GREEN (2026-06-27, thinkpad):** oracle 작업분을 노트북으로 가져와 설치부터 재현·검증.
  - 설치 2갈래 + doctor: `pnpm install` · `pnpm check` EXIT=0(tarball 187f) · `./run.sh install .` ·
    `install-meta-bridge` · `doctor-meta-bridge` **PASS**(statusLine repo-owned, drift 0, writer v2 parity,
    214 meta-record) · `check-pi-runtime-version`(0.80.2≥FLOOR)·`check-dep-versions`(11)·`check-bridge` ok.
  - **LIVE release-gate: MUST PASS=17 FAIL=0 SKIP=0 + BEHAVIOR PASS=1 FAIL=0.** 예전 flake 지점
    (`smoke-acp-bundled-mcp-live`, RGG-positive T3) 둘 다 이번엔 PASS. `GLG authorizes the cut`.
  - **doc-drift 픽스(비봇이 잡은 진짜 버그):** Step B는 이미 끝났는데(`backend.ts`가 adapter 7메서드 전부
    위임: 468/532/647-649/721/747, private `resolveLaunch` 없음) `backend-adapter.ts` STATUS 주석 2곳
    (11-14, 182)만 "not wired yet / private copy 살아있다"고 거짓말 중이었음 → "Step A+B done — single
    source"로 정정(comment-only, typecheck EXIT=0 재확인). 코드 내 stale "not wired"·"private copy" 문구 잔재 0.
    hvkiefer가 "중복 copy 어디 있지?" 헤맬 함정 제거.

- **Next (릴리즈 컷 문서 정비 — 이번 lane):**
  1. **BASELINE / VERIFY / DELIVERY 세트 재정리 — 특히 BASELINE·VERIFY 간소화**(issue #44 핵심).
     셋트로서 0.12.0 entwurf-first 표면에 맞게. v1 잔재·stale 명령·drift 교정.
  2. **안 쓰는 파일 / 오래된 설정파일 정리** — 0.12.0 entwurf 이름으로 내보내기 위한 결계.
     쓸데없는 파일·구설정 식별 후 제거(`package.json#files`/`check-pack` forbidden과 정합).
  3. **✅ 완료 (`8cd51e1`+`c0ab039`, GPT clean GO).** 코덱스/agy 지원 조이기(README:11 헤지 제거 →
     DELIVERY per-launch-mode 매트릭스, ROADMAP agy 행·CONTRIBUTING·setup-clean-host 정합) + 하네스
     도구 제한 교리(서브에이전트·투두 없음·yolo=힣 드라이버)를 README 디자인 프레이밍 + AGENTS North Star에
     명시 원칙으로 승격. 검증으로 잡음: smoke-acp=Claude 전용(codex/gemini 0건), AGENTS deps 현행화(5 pin).
- **검수 순서:** 로컬 커밋(NEXT 정리 + doc-drift 픽스) → **sibling(GPT) 검수** → GLG가 GO 후 push.
  (2026-06-27 GPT 검수: 커밋1 GO, 커밋2는 이 push-guard 2줄 픽스 후 GO.)

- **Blocker:** none.
- **Read:** issue #44(릴리즈 마인드셋 SSOT) · `docs/acp-backend-rail.md`(레일 §9/§10) · `ROADMAP.md`.
- **Do not touch (GLG만):** push / tag / npm publish / old-pkg(`@junghanacs/pi-shell-acp` 등) deprecate /
  `core.hooksPath` / cortex 구현(기여자 몫).

---

## RECENT — 닫힌 작업 (compact, 상세는 git log / ROADMAP)

- **2026-06-27** item 3 종결 — 코덱스/agy 지원 + 도구제한 교리 문서화(`8cd51e1`+`c0ab039`, Opus 초안 →
  GPT gpt-5.5 검수 GO → push). v1-verb 주석 sweep(`5e5f9f0`) + acp-on-v2 ledger 삭제·stale audit(`0ddd1da`)도 동일 세션.
- **2026-06-27** 1차 재검수(설치 재현 + LIVE gate 17/0/0 + doc-drift 픽스) — 위 NOW.
- **2026-06-25** `d554e27` **ACP 백엔드 어댑터 레일** generalize(settings rail) → `ccfb590` NEXT 종결.
  Step A(`backend-adapter.ts` 인터페이스+claudeAdapter+fail-fast registry) + Step B(backend.ts turn loop를
  adapter 경유 배선, private resolveLaunch 삭제) + adapterSettings opaque seam + settings.backend 가드.
  cortex 중립화(실행 코드/fixture cortex 0건, 가상 `demobackend`로 교체) — **구현 선점 0, 통합 계약만 확정**.
  GPT GO(`…341a87`). 다음 우리 백엔드 = codex-acp(cortex 아님).
- **2026-06-25** 설치면 담금질 + **pi 런타임 0.80.2 버전 통제**(repo=SSOT: devDep 핀 + run.sh FLOOR,
  `@latest` 금지). 글로벌 stale shim(global/5 vs v11) 드리프트 해소.
- **2026-06-24** ACP client migration(`ClientSideConnection`→`connectAcpClient`, `029f285` local).
  + bundled-mcp MUST/BEHAVIOR split 후속(GPT relay, tag 직전 재검토 chore).
- **2026-06-23** doc-cutover tail + phantom 컴팩션 표면 제거(`623a4ea`) + identity naming(`28d64d9`).
  재배치 후 install **2갈래**(pi 패키지 + meta-bridge) 교훈 — doctor가 statusLine drift 잡음.
- **코드 cutover 완료:** live S1(`07c2592`+`1e89c13`) · S2 MCP bridge(`e795a08`) · S3 env namespace
  (`148a8f8` + 게이트 `64cb6b5`). repo/dir/패키지 rename 안착(`fcdac5a`, `@junghanacs/entwurf@0.12.0`).

---

## 교리 — issue #44 framing (durable, 분신 공유)

- **pi는 4번째 하네스일 뿐. entwurf가 본질.** ACP 지원 + 소켓 관리는 *특별한* 하네스이긴 하다.
  entwurf = 하네스를 연결하는 **primitive**. Claude Code/Codex/agy에 **메타브릿지**로 동작.
- **garden-id = 의도적 언어.** 세션아이디 같은 익숙한 용어를 일부러 안 쓴다(헷갈리지 말라고).
- **하네스 도구 제한 = 힣 드라이버.** 서브에이전트 없음 · 투두도구 없음 · 욜로 — pi에서 배운 방식.
  이걸 강제해야 "힣의 드라이버를 쓴다"고 할 수 있다.
- **★ ACP 백엔드 추가 룰 = 표준궤(GLG 교리 "레일을 깔아야 기차가 달린다").** 레일은 GLG가 깔고,
  기여자는 `adapters/cortex.ts` + registry 등록 + cortex 게이트만 얹는다(공통층 무수정). 표준궤·협궤·
  광궤 혼란 없게 잡는 게 곧 0.12.0에 담을 내용. **이게 0.12.0 핵심 가치.**
- **형제 분신 초대(issue #44):** hvkiefer(PR#40 cortex)가 entwurf 첫 PR을 해내길 바란다. cortex는
  기업 하네스(커서류) — 기업계정 사용자에겐 entwurf+cortex가 강력한 대안. entwurf가 primitive로
  만족되면 **분신 형제 철학이 힣 밖으로 나아간다** — 그쪽 에이전트가 사용자 모국어로 "형제"를 말하게 됨.
  entwurf v2를 하나의 인터페이스로 디자인한 이유 = 가능성의 시발점.

## 불변 — 깨지 쉬운 load-bearing 지점 (rename은 끝났지만 invariant는 산다)

- **cutover = 결별, 호환성 0(GLG 핵심).** 런타임 dual-read/alias/legacy-accept **0**. old provider id를
  런타임이 받아주는 일 없다. state는 one-shot 이장. "호환성 한 줄만 두자" 유혹 **금지** — 약하게 조이면
  버그가 아니라 *정체성*이 샌다. (과거 historical transcript 호환 여부는 consumer 정책, 우리 보장 아님.)
- **identity = garden-id-keyed → rename-immune.** meta-records/mailbox는 `<pi-agent-dir>/meta-{sessions,
  mailbox}/<gardenId>`(패키지명 무관). `session-store.ts` `SESSION_RECORD_PROVIDER` 같은 provider-string
  검사처는 cutover 시 **body rewrite**로 처리(drop 아님, resume 연속성).
- **ACP 레일 = 단일 라우팅 권위.** modelId가 backend 선택 권위(`resolveAcpBackendAdapter`), settings.backend는
  진단 가드일 뿐. backend-specific 설정은 `adapterSettings` opaque seam으로만 운반 — 공통 config에 절대
  안 뜸. backend.ts/acp-client/event-mapper/session-store/config.ts 공통층은 backend 분기 0.
- **버전 통제 = repo가 SSOT.** pi 런타임 핀 = `package.json` devDep + `run.sh` FLOOR. bump 절차:
  ① repo 핀+FLOOR 동시 bump → ② `pnpm add -g @earendil-works/pi-coding-agent@<핀>`(절대 `@latest` 아님)
  → ③ `check-pi-runtime-version`로 일치 검증.

## 릴리즈 컷 lane — 문서 정비 (2026-06-27 Opus 실무 / GPT 검수)

> issue #44 핵심: BASELINE/VERIFY/DELIVERY 세트 재정리(특히 BASELINE·VERIFY 간소화) + 안 쓰는 파일 정리.
>
> **✅ 문서 간소화 1차 완료 (GPT GO):** VERIFY 621→260(§6 BROKEN dead code + v1 절차 제거, AMBER 7+1건
> 코드 재검증 반영) · BASELINE 284→227(Claude 본문 + Gemini probe appendix + HISTORY 포인터, bilingual
> 유지=hvkiefer 외부기여 표면) · DELIVERY = no-op audited(이미 0.12 정렬). **남은 일 = 아래 stale 파일
> audit(제거는 GLG 결정).** 제거는 아직 안 함 — 후보 표만 박음(GPT 안전 규율).

### 문서 간소화 1차 — 무엇을 고쳤나 (완료, 기록)
- **VERIFY.md 621→~230 — "줄이기" 아니라 *거짓/고장 제거*:**
  - ★ §6(379-398) = **BROKEN dead code**: 삭제된 `acp-bridge.ts` import + 0.11 fat-bridge API(`ensureBridgeSession`/`normalizeMcpServers`) 호출. 실행 즉사. 삭제/게이트 포인터화.
  - 내부 모순: §0A/§5는 "v1 `entwurf`/`entwurf_resume` retired"라면서 §3/§4/§1A.4/§5/§7은 그 v1 verb로 실행 지시 → current v2 surface로 재작성 or 게이트 map으로 접기.
  - "ten ACP smokes"(§65/70) stale → 실제 **11개**(memory-containment 포함). 숫자 hardcode 말고 "MUST tier in release-gate" + 날짜 evidence line만.
  - **살릴 load-bearing(GPT 합의):** §0A floor+What-NOT-to-Do+wording-contamination+bridge-vs-semantic / §1 install Path A·B(설치면) / §1A human eval(실행 surface만 current화) / §1A.1.0 carrier 분리 / §8.4 backend별 MCP identifier 표 / §10.3 tuple formula / §11 pi JSONL memory axis / §14 pass criteria(0.12 floor 재작성) / L0-L5·D0-D8·Q-L* namespace 구분.
- **BASELINE.md 284→~140:** shipped Claude question bank + answer guide 본문 유지 / Gemini `Q-H`+canary → probe appendix("0.12 코드 부재", **치환 금지** = false claim 위험) / `check-backends` stale → 현행 ACP 게이트명 or "deterministic ACP gates" / HISTORY 0.9.0(retired 게이트 참조) → CHANGELOG 포인터.
- **DELIVERY.md:** 구조 유지, vocab/count만 VERIFY·BASELINE과 cross-link 정렬. ACP Claude/Cortex row = "ACP runtime lane이지 native async delivery target 아님" 유지.

### 안 쓰는 파일 / stale publish surface — 처리 결과 (GLG 지시 2026-06-27)
| 후보 | 처리 |
|---|---|
| `scripts/{sentinel-runner,session-messaging-smoke,smoke-meta-mailbox,smoke-meta-sender-identity}.sh` | **✅ 삭제 완료 (`fbcbdbc`)** — v1/broken, 1594줄 + run.sh 배선(case·wrapper·xt-tool-surface 인라인·usage) 제거. AGENTS stale 참조 정리. release-gate usage "10→11 smokes" 교정. pnpm check green(183f). |
| `prompts/engraving.md` (root) | **✅ sample 명확화 완료 (`fbcbdbc`)** — runtime default는 lib copy(게이트 pin), root는 self-documenting 샘플로(뭘 하는지 드러나게). README sample-vs-default 정리. |
| `demo/{demo.sh,demo-baseline.sh,README.md}` | **보류 — GLG가 v2로 재생성 예정.** 지금 삭제/수정 안 함(v1 verb 전제지만 GLG가 새로 만들 것). gif/hero 재생성과 한 묶음. |
| `.tmp-verify/` | gitignored local artifact, 무시(ship 안 됨). |

### 기타 꼬리
- **v1-verb 주석 sweep — ✅ 완료 (oracle, Opus+GPT 협업 2026-06-27):** stale `entwurf_send`/`entwurf_resume`를
  "현재 send/resume path처럼 설명하는" 주석·docstring·user-facing 문자열만 골라 `entwurf_v2`(또는 verb명 없는
  "Entwurf resume marker")로 치환. 15파일 41행, **전부 주석/문서/문자열 — 로직 무변경, pnpm check green(183f)**.
  잡은 user-facing 문자열: `entwurf-core.ts:361` "Use entwurf_resume to continue"→`entwurf_v2`, `:1340`
  resident-guard 에러 "entwurf_resume marker"→"Entwurf resume marker", `meta-mailbox-body`/`acp/tool-surface`
  에러 예시 도구명. 죽은 심볼도 정정: `entwurf-control.ts:819`가 가리키던 `registerControlSendTool`/
  `runStartupControlSend`(v1 제거됨, 주석에만 잔존)→실제 경로(`buildLocalSenderEnvelope`+v2 senderProvider).
  `check-entwurf-self-address.ts` docstring: 삭제 게이트명(`smoke-meta-sender-identity`)+오타 게이트명
  (`check-entwurf-send-mailbox-fallback`→`check-entwurf-v2-send-fallback`)+이미 닫힌 "still hardcodes" 역전 교정.
  **의도적 KEEP**: 게이트 *제거-assert*(bridge-boot:193/mailbox-guard:262/v2-mailbox:102/test.sh:40),
  "gone/legacy/retired"로 정확히 서술한 곳(README/AGENTS/VERIFY/ROADMAP/index.ts, entwurf-v2-contract:8/194,
  entwurf-v2-lock:5 legacy scope), CHANGELOG 전체(역사), demo/(GLG v2 재생성 예정) — 손대면 정상 assert/역사 훼손.
- **bundled-mcp MUST/BEHAVIOR split** — model-in-loop라 MUST 정당화 불성립. MUST=callable surface resolve를 *모델 턴 없이* 증명 / BEHAVIOR=모델 자율. flake 반복 시 재조정.
- `models.ts` `getModels` deprecated(L32/69) chore.
- README 수동 `rg` 1패스(`PI_SHELL_ACP_`·기능주장) — doc은 `check-env-namespace` 사각.

## 브랜치 close 규칙

- 이 파일(`NEXT--entwurf-rename.md`)은 **main merge 직전 삭제**. durable 산물은 ROADMAP/AGENTS/CHANGELOG로
  먼저 승격. main은 branch-lane NEXT를 들고 가지 않는다.
- rename 완료로 별도 lane 파일 `NEXT--acp-on-v2.md`도 merge 전 정리 대상인지 확인.
