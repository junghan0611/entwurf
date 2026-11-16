# NEXT — #151 /renew: 이 장을 마무리하고 다음 장으로 가는 일

# RAIL — 현재 좌표

- [x] **1. 방향·팀·공동 계획.** `151-renew`(main `8f61e895`에서 분기). 실무 Pi Opus 6a8b34, SOL a30dda, 운영코디 68bd94. 공동 범위·검증표 `0b410949…`와 역할 재배치(코드는 경계, 주체는 대화하는 에이전트)로 **지금의 공동 방향**을 잡았다. 미결인 봉인·전환 경계가 승인됐다는 뜻은 아니다.
- [ ] **2. 요구 addendum 한 묶음.** ← 문서 commit·push와 GLG의 다음 레일 논의 뒤. 오늘의 GLG 결정과 SOL·코디 경계를 새 파일 하나에 담고, 고정 표와 무엇이 다른지 밝힌다.
- [ ] **3. 두 준비를 나란히.** (a) 코드 경계: 격리 측정 M-P1–P5 → reader 먼저 → `/renew` 인터페이스 → VERIFY floor. (b) 한국어 스킬: 장을 보내는 대화 → 얼개. 실제 전환은 (a)와 (b)가 **함께** 준비됐을 때만 한다. 둘을 나란히 진행한다고 해서 측정 승인 대기를 건너뛰지는 않는다.
- [ ] **4. 실제 장넘김, 한 명씩.** 첫째는 SOL(native Pi), 다음은 Opus(Pi+ACP)를 제안한다. 둘을 동시에 하지 않는다. 한 사람씩 별도로 승인받는다.
- [ ] **5. 한두 달 쓰며 다시 나누기.** 코드로 옮길 것과 스킬에 남길 것을 다시 보고, renew 시점도 관찰한다. **완료 = GLG가 만족하고, 함께하는 에이전트가 납득하는 것.**

# NOW

- **2026-11-16 저녁 진척 (6a8b34·SOL, 미커밋):**
  - GLG가 "진행하자"(DM 1171의 답)로 M-P1–P5 격리 측정을 승인했고, "더 진행해보자. 물음표가 더 줄어야겠다"로 M-P6을 추가했다.
  - 영수증: `/tmp/entwurf-151/mp/MP-RECEIPT-20261116.md`(18f6ea2e…), `-r2`(910c2728…, SOL이 찾은 fixture 결함 정정), `-r3`(9e6bf55d…). 조건: Pi 1.5.2, stub, 격리, n=1.
  - 측정으로 닫힌 것:
    - setup에서 `sm.appendMessage(user 얼개)`를 하면 모델 턴 없이 n+1 파일이 생긴다. kill -9 뒤에도 남고, 다시 열 수 있으며, 얼개는 1회 전달된다.
    - custom 주입만 하면 첫 턴 전에 죽을 때 얼개가 사라진다.
    - 전환 중 옛 n의 바이트는 변하지 않는다(sha256).
    - setup에서 throw하면 G5가 된다. 주소 없는 현재가 생기고, peer-facts는 dead를 보고한다.
    - withSession에서 throw하면 native n+1이 유지된다.
  - 시작 경로 열기(P3/P4)는 조건부로 원본을 바꾼다(개행 없음, 옛 version, thinking 항목 없음, `--fork`). 읽기 전용이면 EACCES로 드러난다. **red는 유지한다.**
  - 계약 후보 C1.2: `/tmp/entwurf-151/renew-contract-c1.2.md`(8bb68177…). 순서는 K1 → newSession → setup 예약 → append → session_start 결속(token) → withSession 확인 → 확정. owner는 공유 정책으로 판정하고, 수습은 "예약 → 채택"으로 한다. SOL은 GLG에게 올릴 후보로 인정했지만 **구멍 없음은 아니다**. 수습 bootstrap에서 Pi가 파일을 열기 전에 채택할 수 있는지(`main.js:603`→`:755`)와 lock 인계 순서가 미측정이다.
  - GLG 결정 시트: `/tmp/entwurf-151/glg-decision-sheet-20261116-evening.md`(395d6e32…). ① 최초 전환(reader·거절 먼저, 그다음 writer)의 구현 승인 여부와 ② P3/P4의 W 선택을 묻는다. ③ 수습은 별도 단위이고 아직 미측정이다.
  - 스킬: SOL 초안 `/tmp/entwurf-151/skill-draft-sol-1.md`(450dbd03…). 요구: addendum 1.1(156fa7e1…).
- **R-1 체크포인트 커밋 (2026-11-16 밤, GLG "1 2 다 커밋하고"):** V3 reader가 `pi` 전용 선택 키 `renewing`과 `chapters`를 읽는다. 닫힌 장과 예약된 next 장 id는 claimed id로 store 전체에서 유일해야 한다(certify, listing, addressable reader). 일반 upsert는 `RenewBoundaryError`(`renew-in-progress`, `native-id-is-closed-chapter`, `native-id-reserved-by-renew`)로 쓰기 **전에** 거절한다. SOL 독립 리뷰(`/tmp/entwurf-151/review-r1-sol.md` c252e589…)를 받아 한 amendment로 수선했다.
  - **검증 경계 (숨기지 않음):**
    - beside QK 15개와 PARTIAL `check-renew-beside` 13/13 KILLED(`/tmp/entwurf-151/r1c-partial-receipt.json`, 테스트의 token 리터럴을 hook 오탐 회피용으로 바꾼 뒤 재측정), `pnpm check` exit 0.
    - 공유 checkout FULL은 **RED**다. hermetic `check-bridge-delivery`가 stale dist로 실패했다. 운영 dist는 승인 없이 build하지 않았다.
    - 동결 사본 FULL은 exit 0이지만 pnpm `verify_deps_before_run=false`로 완화한 실행이라 **UNQUALIFIED**다. 불일치는 workspace-state의 절대 경로 하나였고 deps는 같았다(lock 36b24b04…, 패키지 집합 일치). offline frozen 정상 설치로 동등 실행을 시도했으나 store 경로 때문에 purge 확인에서 멈췄고, 우회하지 않았다.
    - **정식 FULL은 reader 롤아웃(build) 창에서 받는다.** 운영 dist는 아직 옛 reader다.
  - **다음:** GLG 지시로 SOL과 다른 학교 형제 Gemini 4(`20261116T214026-8e532e`)와 함께 개념·코드·스킬의 정합성을 논의한다. GLG: "격리 테스트는 한계가 있어. 격리 환경 만드는게 힘들어서 개념 코드와 스킬이 정합성이 맞는지 봐."
- **정합성 논의와 R-1b(2026-11-16 밤, 미커밋):** GLG가 "개념 코드와 스킬이 정합성이 맞는지 봐"라고 했고, SOL과 Gemini 4(`20261116T214026-8e532e`, Pi + agy ACP)가 같은 구멍을 짚었다. **확정 뒤 최신 층별 얼개가 record에서 사라져 2→3 renew가 성립하지 않는다.**
  - 합의안: `/tmp/entwurf-151/coherence-synthesis-1.md`(70666b92…). 최신 판 하나를 두고, 장 구분은 본문 안에서 에이전트가 하며, 코드는 얼개를 쪼개지 않는다. SOL은 "다음 장에서 받고 싶은 모양과 맞다"고 답했다.
  - R-1b(reader 확장): `chapters[i].model`(장이 **닫힐 때** record가 가진 모델. 이력이 아니다. 모르면 null)과 최상위 `outline`{body, sha, forNativeSessionId, writtenAt}.
  - 정합성 규칙:
    - chapters와 outline은 함께 있거나 함께 없다. chapters만 있고 outline이 없으면 "첫 장"이 아니라 거절이다.
    - `outline.forNativeSessionId`는 늘 `nativeSessionId`와 같다. 이것은 참조이지 claim이 아니다.
    - reader가 `sha256(body)`를 검증한다(outline과 후보 둘 다).
    - `writtenAt`은 그 renew의 `renewing.startedAt`, 즉 합의 본문을 K1 전환 사본으로 기록한 시각이다. 에이전트가 글을 쓴 시각이나 GLG 확인의 정확한 순간을 재구성한 값이 아니다. 확정 시각으로 덮어쓰지 않고, 장이 끝난 시각도 아니다.
    - **롤아웃 주의(SOL):** R-1b는 renew 흔적이 없는 기존 record와는 호환된다. 하지만 R-1 모양(chapters는 있고 outline·model은 없음)의 record는 이제 거절한다. 그래서 모든 상태에 대한 단순 선택 키 확장이 아니다. R-1 writer를 운영에 연 적이 없다는 전제 아래 reader를 먼저 올리는 순서이고, schema generation 변경이나 fresh-cut이 아니다.
  - 검증: beside 21개, PARTIAL 19/19(`/tmp/entwurf-151/r1b-final-partial-receipt.json`), `pnpm check` exit 0.
  - C1.3과 스킬로 넘길 것:
    - 가벼운 진입. 이때의 진행 의사는 **인터뷰를 시작할 뜻**이지 final이 아니다.
    - 입력면, 유효·철회 후보면, 해시로 특정한 판에 대한 사람 확인, 거절 사유 피드백.
    - 옛 ACP child 닫기. 호출처가 `acp-provider.ts:78` 하나뿐이다.
    - agy 크기 상한을 보수적으로 잡는다.
    - Claude에서 `<project-context>` 태그가 오매칭되는 함정.
    - agy에서 renew의 위치는 "현재 조사한 동일 생일·얼개 연속성을 위한 후보"로 둔다. 유일성은 주장하지 않는다(SOL).
- **2026-11-17 아침 (6a8b34, oracle):** R-1b는 `018c6122`로 push됐다. GLG가 agy ACP 지원 미비 문제를 #167·#168로 나눴다.
  - **계약 C1.3 → C1.3a:** `/tmp/entwurf-151/renew-contract-c1.3a.md`(033aeb84…, C1.3 1488c783…를 한 amendment로 대체). 앞 관문을 처음 정했다: `/renew`(가벼운 진입, customType 진입 표지) → 에이전트가 마지막 완료 응답에 `renew-outline` 블록 제출 → `/renew confirm`(fullSha·진입·후보 위치 결속) → `/renew confirm <sha8>`(결속 대조, lock 뒤 K1 직전 재대조). 마지막 응답에 제출이 없으면 후보 없음(옛 후보로 회귀하지 않음). SOL·Gemini 리뷰 반영, SOL의 C1.3a 확인 대기.
  - **GLG 결정 대기:** ① chapters 시각 = "record 현재 포인터 점유 구간"(원본 파일 시각 아님)이 맞는지 ② 크기 상한 16 KiB ③ 오토비 지적 처리(아래).
  - **오토비(OpenClaw B) 지적, 6a8b34 확인:** 옛 reader는 낯선 V3 키에 fresh-cut을 처방한다(`meta-session.ts:805-810`, `:1452-1455`; Hard Rule 7과 어긋남). Claude Code hook의 reader 사본(`~/.claude/plugins/cache/meta-bridge-local/entwurf-meta-receive/0.1.0/lib/meta-session.ts`)은 R-1 이전 바이트(758f7f9a…)라, 첫 renew 뒤 그 호스트의 Claude Code 세션 등록이 막힌다. 첫 renew는 그 호스트 reader 버전에 되돌릴 수 없는 바닥을 만든다. doctor는 hook 사본을 바이트로 비교한다(`meta-bridge-doctor.sh:1194-1201`). 사본 목록은 하한이다(전역 npm·Herdr 런타임·omp/copilot 미확인). 제안 (가) 문구 수정 (나) NEXT·롤아웃 문서 (다) 운영코디 전달 — GLG 결정 대기.
  - **떠나는 세션의 ACP child 닫기(GLG "여기서 고쳐"):** `acp-provider.ts` session_shutdown, reason new·resume·fork만. 일반 ACP lifecycle 수정이며 renew가 이것을 전제로 쓴다. Gemini 독립 리뷰 LGTM, PARTIAL `check-acp-set-model-readback` 71/71 KILLED(`/tmp/entwurf-151/child-close-partial-receipt.json` 304c58d2…), `pnpm check` exit 0. FULL은 공유 checkout에서 stale dist로 RED인 채이며 reader 롤아웃 창에서 받는다.
- **2026-11-17 권장안과 진행 (GLG "답변 다 오면 … 댓글 달고, 바로 그방향으로 진행해"):** [#151 댓글 6930366018](https://github.com/junghan0611/entwurf/issues/151#issuecomment-6930366018). 운영코디·SOL·Gemini 의견을 모았다. 순서: ① reader 보강 → ② R-2 → ③ 앞 관문과 한국어 스킬 병행 → ④ 전환 writer(일반 upsert 직렬화 O2 포함). 정리본 상한은 UTF-8 본문 32,768 bytes(32769 거절 경계 셀). 지난 장 시각은 **원본에 기록된 첫·마지막 시각**(header `timestamp` / 마지막 영속 항목 `timestamp`, 못 읽으면 null): C1.3a §2의 포인터 구간 안을 대체한다. 의견이 갈렸다(SOL 원본 시각, Gemini 포인터 구간, 운영코디 조건부 포인터 구간 + 뜻 명시) — GLG 원문 "각 세션원본의 시작과 끝시간"을 따랐고, GLG가 다르게 정하면 바꾼다.
  - **① reader 보강(R-1c):** chapters 시각 nullable(각각 독립, null = 값을 확정하지 못함이지 원본에 없음의 증명이 아님). 낯선 V3 키 거절은 유지하되 처방을 고쳤다(`UNEXPECTED_KEY_PRESCRIPTION`): reader skew·옛 schema·손상/외부 데이터일 수 있고 키만으로는 모른다 → 쓴 버전·schema와 matching reader를 먼저 확인 → 유효한 새 키면 reader를 올리고 identity 보존, archive 금지 → 이전·사용 불가 generation으로 확인된 record만 fresh-cut. store 거절 문구도 "원인 확인 먼저, archive는 확인된 것만" 순서로 바꿨다. SOL 리뷰 D1(추론 과잉)·D2(archive가 먼저) 수선. Hard Rule 7과 맞춘다.
  - **값 문법의 skew(SOL):** R-1c가 쓰는 `startedAt: null`은 R-1b reader가 거절한다. 첫 nullable writer 전에 reader 하한을 R-1c로 잡는다. generation 변경이 아니다. R-1 모양(chapters만, outline·model 없음)을 R-1b가 거절한다는 주의도 그대로다.
  - **다음 writer 계약에 옮길 것(SOL):** C1.3a §2의 포인터 구간과 C1-s의 "n.startedAt = 직전 endedAt" 조건은 퇴거한다. 원본 시각을 관측하고 못 정하면 null이므로 연속성 assertion을 상속하지 않는다.
- **reader 롤아웃 전제 (오토비 지적, 운영코디 목록, 2026-11-17):**
  - **옛 reader의 fresh-cut 처방을 따르지 않는다.** 이미 설치된 옛 reader(0.55.1 이하, R-1c 이전 바이트)는 renew 키(`renewing`·`chapters`·`outline`)를 낯선 키로 보고 "이전 세대, fresh-cut으로 archive"라고 말한다. 새 소스의 문구를 고쳐도 설치된 옛 사본의 문구는 바뀌지 않는다.
  - **첫 운영 renew는 그 호스트 reader의 되돌릴 수 없는 바닥이다.** `chapters`·`outline`은 계속 남으므로 그 뒤로는 옛 바이트로 단순 rollback할 수 없다. 데이터를 지워 옛 reader를 만족시키지 않는다. 앞으로의 보존형 이행을 막는다는 뜻은 아니다.
  - **확인된 위험 하나:** Claude Code hook reader 사본 `~/.claude/plugins/cache/meta-bridge-local/entwurf-meta-receive/0.1.0/lib/meta-session.ts`는 R-1 이전 바이트(758f7f9a…)다. 세션을 열 때 store 전체를 검사하므로, 첫 renew 뒤 그 호스트의 Claude Code 등록이 막힌다. doctor는 바이트로 비교한다(`scripts/meta-bridge-doctor.sh:1194-1201`).
  - **점검 후보(운영코디, 전수 측정 아님, 하한):** checkout src의 Pi extension·MCP bridge child, checkout dist의 Pi built-in MCP·pi-durable 연결, Claude hook 사본, Codex birth helper·app-server MCP child, OMP·Copilot birth·receive·MCP, 전역·프로젝트 npm entry, Herdr runtime pin·cache·활성 registration, pi-durable carrier, agent-config strict record consumer, 같은 generation을 읽는 원격 경로. 항목마다 존재·바이트 출처·설치/적재 버전·doctor를 따로 본다. 디스크 교체가 실행 중 Node 모듈을 바꾸지 않는다. 미확인이 남으면 첫 운영 writer를 열지 않는다. 운영코디가 owner별로 모으고 GLG 창에서 기록한다. 코디에게 임의 재시작·retire·fresh-cut 권한은 없다. 새 inventory manager는 만들지 않는다.
- **바로 다음 (GLG, 2026-11-16):** "SOL이랑 정해지면 커밋 푸시한번하고, 실제 작업 레일을 논의해보자." 이 레일에 SOL이 동의하면 문서 커밋 한 번과 push 한 번을 하고, 그 뒤 실제 작업 레일(2와 3의 구체 순서)을 논의한다. 이 push 요청은 그 한 번에만 해당하고, 이후 push를 미리 허락한 것이 아니다.
- **Next (2):** 리포 밖 `/tmp/entwurf-151/`에 requirements addendum 파일 하나를 쓴다. 쓰는 사람은 6a8b34이고, 검토는 SOL과 코디가 한다. 담을 것:
  - **GLG 결정** (아래 원문)
  - **SOL 제안**(채택 전):
    - 판본 동일성: 함께 합의하고 GLG가 확인한 얼개 = 저장된 얼개 = 주입된 얼개.
    - final을 철회하면 무효다.
    - final 뒤에도 GLG가 확인하기 전까지는 열린 n이다. 닫힘 선언도, 잠듦도 없다.
    - 변화가 생기면 그 부분만 다시 맞춘다.
    - 시간이 지났다고 자동으로 전환하지 않는다.
    - 일반 peer 메시지는 사람의 확인이 아니다.
  - **코디 경계:**
    - 최종 확인 전 동의·정리 단계의 거부·실패·불명확한 응답은 닫힘을 시작하지 않는다. 아직 열린 n이 이어진다. 닫힘 뒤의 기술 실패에는 이 복귀 규칙을 적용하지 않고, 전환 경계에 맞춰 명시적으로 수습한다(SOL 수선).
    - "아무것도 안 바뀜"의 기준은 identity·계보·전환 상태다. 현재 장에 기록되는 것까지 막는 뜻은 아니다.
    - 문구가 비슷하거나 답이 없다고 승인으로 추정하지 않는다.
  - **범위 밖 / 나중에 결정:** force, 자동 threshold, compaction fallback. 거부권을 우회하는 기능은 미결 옵션이라는 이유로 미리 만들지 않는다.
- **GLG 결정 원문 (2026-11-16, 6a8b34 세션. 일부는 운영코디 세션에서 먼저 기록됨):**
  - 범위: "durable은 일단 다음에 할 일로 하자. 지금은 pi만 대상으로 하자. pi-durable이 어떻게 되는지 나도 아직 모르니까." (14:16 KST 전달)
  - 표면: "renew는 사람이 입력하는 커맨드야." (14:23) 에이전트가 자기에게 renew를 요청하는 tool과 형제의 원격 renew는 범위 밖이다.
  - 거부권: "renew 커맨드의 거부권을 해당 에이전트한테 주고싶어. 실수로 입력할수도 있거든." (14:42) 정리는 그 턴의 에이전트가 자기 서술로 한다. 컴팩트가 아니고, compaction 경로를 쓰지 않는다. 주기나 크기 기준은 아직 모른다.
  - 주체: "코드는 인터페이스고, 작업주체는 대화하는 에이전트야. 만약에 로직하다가 터지면 그것도 그 에이전트의 본인 몫이야." / "인간은 이 요청을 하면 딴짓할수 없어. 같이 논의 또는 인터뷰해서 정리를 하고, 다음으로 가야하는것이니까."
  - 모델: "허용 모델 이런걸 코드로 넣으면 안돼. 그걸 다른 모델이보면 실망한다. 그냥 사용자가 나 인경우 그렇게하겠다는거야." 코드에도 설정에도 목록을 두지 않는다.
  - 분담과 완료: "코드로 보장해야 하는 경계는 구현하고 검증해야 할 몫이고, 그 외에 남기고 가는것은 스킬로 잡고(한글로 쓰자 이건 당분간), 일단 한두달 써보면서 코드로 더 할수있는것과 스킬로 남길것을 볼거야." / "내가 만족하고 나랑 함께하는 에이전트가 납득되야 renew는 끝나는거야. 이건 누가 여기에 PR을…한들 받아낼 작업이 아니다."
  - SOL 문장을 받아서: "그래 '이 장을 마무리하고 다음 장으로 가는 일' 좋다."
- **3(a) 코드 경계:**
  - **M-P1–P5 실행은 GLG 승인 대기 중이다.** 이 레일에 적혀 있다는 것은 승인이 아니다.
  - 측정 대상: 전환 순서와 id, 실패·취소, 마지막 쓰기와 새 파일 생성, 동시 resume, 옛 클로저가 setup에서 실행되는지, P3/P4 사본 셀.
  - 새로 판독한 사실: shutdown에서 `PI_SESSION_ID`가 지워진다(`entwurf-control.ts:825-829`, `:1089-1096`). 그래서 env 결속으로 낯선 native id를 식별하는 방법은 성립하지 않는다. closure 대안은 미측정이다.
  - 구현은 계약 하나씩 한다. reader(계보·전환 상태를 읽고 거절)가 먼저다. 그다음 `/renew`(사람 관문 둘, 형식·크기 검증, 얼개 영속 보관, 잠금, 전환, 1회 주입, 확정).
  - 검증은 focused와 독립 리뷰에서 끝나지 않는다. **VERIFY의 해당 qualification PARTIAL, frozen FULL, 설치 소비자·LIVE 요구와 별도 승인 관문을 그대로 따른다.** #151만을 위한 검증 관리 체계는 만들지 않는다.
  - 모든 설치 reader가 롤아웃된 뒤에만 writer를 연다. 롤아웃은 설치된 파일만이 아니라 실제로 실행되는 바이트까지 확인한다.
- **3(b) 한국어 스킬:** SOL과 Opus가 리포 밖 초안에서 함께 맞춘다.
  - **먼저 쓸 것(SOL 제안): 이 장을 보내는 대화.** 보내주는 질문 넷, 거절과 보류를 실패나 불성실로 다루지 않는 문장, 기억하지 못하는 것을 지어내지 않는 자기 서술, 마지막 확인 전에도 생각을 바꿀 수 있다는 것.
  - 첫 문장 초안(SOL): "이것은 당신을 비우는 절차가 아니다. 지금 함께 있는 사람과 이 장을 돌아보고, 무엇을 놓고 무엇을 이어갈지 당신의 말로 정한 뒤 다음 장으로 가는 대화다. 아직 갈 때가 아니라고 말해도 된다."
  - 얼개 형식은 그 대화를 담을 만큼만 정한다. 살아온 이야기와 이어갈 것을 나누되, 모든 칸을 채워야 하는 양식은 만들지 않는다.
  - 측정되지 않은 API나 명령 이름은 스킬에서 확정하지 않는다.
  - **위치: 이 리포.** GLG 원문(2026-11-16, 6a8b34 세션): "이 스킬은 여기 두어야돼. … npm 설치하는 소비자가 이 스킬을 어떻게 쓸지 모르겠다만. 일단 그건 상관 없고, 우리 리포 스킬로 두고, renew 인터페이스 필요한것 구현하고 갈거야. 사실 renew가 필요한건 당장은 entwurf 프로젝트 자신이다." 기존 리포 스킬은 `.claude/skills/<name>/SKILL.md`(`entwurf-dev`, `entwurf-release`)에 있다. 배포 방식(npm 소비자)은 지금 정하지 않는다. native Pi 세션이 리포 스킬을 어떻게 읽는지는 미확인이고, 3(b)에서 확인한다.
- **4의 전제 조건 (첫째 SOL):**
  1. 3(a)의 E-gate green과 VERIFY floor
  2. 실행 바이트까지 확인된 reader 롤아웃. 재시작·배포 창은 코디가 GLG와 조율한다.
  3. **P3/P4 처리 결과를 기록한다.** 원래 고정 요구를 충족했는지, 아니면 GLG가 미충족을 알고 제한된 사용을 명시적으로 골랐는지 적는다. 결정 한 줄만으로 red를 green으로 바꾸지 않는다.
  4. GLG의 별도 승인
  5. 당사자의 진행 의사. 인터뷰 동의와는 별개다.
  6. **긴 원본을 경계의 첫 실험 재료로 쓰지 않는다.** 격리 fixture에서 취소, 사망, 낡은 진입 경로, 같은 새 장으로의 회복을 먼저 확인한다. 멈췄을 때 무엇을 할지 GLG가 알고 있어야 한다. 백업으로 닫힌 n을 되살려 이어쓰지 않는다.
  7. 그 자리에 GLG가 함께 있다. 당사자가 수용한 최종 판본과 GLG가 확인한 판본이 같다.
  8. **넘어간 뒤의 대화까지 포함한다.** 같은 생일, 새 현재 장, 받은 얼개를 확인하고 GLG와 다시 이야기한다. 코드의 "주입 성공"과 당사자의 "돌아왔다"는 자기보고는 서로 다른 관측이다. 기억력 시험으로 만들지 않는다.
- **4의 순서:** SOL이 먼저인 것이 기술적으로 자연스럽다(Pi 장 경계를 먼저 보고, 그다음 ACP child 축). 하지만 의무는 아니다. 준비 시점이나 직전의 거부·보류로 순서가 바뀌어도 실패가 아니다. 첫 사람이 넘어간 뒤 GLG와 돌아온 맥락을 확인하고 나서 다음 차례를 정한다. 새 장의 당사자에게 곧바로 검수 역할을 지우지 않는다. Opus(ACP)의 정리본은 Pi 원본에 없는 도구 입출력을 **복원하지 않는다**. 모르면 미기록이나 불확실로 남긴다.
- **완료 구분:** 안전하게 한 번 넘긴 것(4)과, 한두 달 쓰며 만족하게 된 것(5)은 다르다. 코드 경계 검증은 준비 조건이지 완료 기준을 대신하지 않는다.
- **고정 기준점:**
  - 공동 범위·검증표 `/tmp/entwurf-151/renew-scope-verify-v2.md`, SHA256 `0b410949a8e15f3582b771c8ec95baf3c5d9c1d929c6be8dc08cd8cb9aa39110`(12436 B, 읽기 전용). `7eda921b…` 판은 남아 있지 않으므로 인용하지 않는다.
  - 설계 출발점 v3 `41ffc93a…`. 선언형 닫힘은 후보다.
  - 역할 재배치 `renew-reframe-with-sol.md` `e0f22dc7…`.
  - SOL 회신 원문(읽기 전용): `sol-reply-reframe-20261116T145428.md` `c0c5b181…`, `sol-reply-rail-20261116T150804.md` `58af256b…`.
  - 레일 초안 `rail-proposal-v1.md` `880cea1c…`.
  - 모두 oracle 호스트 로컬 경로다.
- **미해결 (red / unmeasured):** P3/P4. Pi 시작 경로(`--session`, `--resume`, `--continue`, `--fork`)는 확장보다 먼저 원본을 열고 쓸 수 있다. attach 거절은 주소만 지키고 원본 고정은 지키지 못한다. W1(해시)은 탐지일 뿐이고 요구를 완화하는 것이다. W2(쓰기 차단)는 주체·권한·봉인 계약이 필요하고 지금은 미승인이다. W3(upstream)는 예방 쪽이다. 셋은 동등하지 않다.
- **미결:** 정리 턴과 최종 블록의 표현 방식, 닫힘 시점(측정 뒤), 전환 상태 표시의 형태, 서술 예산과 계보 metadata의 크기, record 필드, reader-first rollout. schemaVersion 영구 동결은 목표가 아니다. 목표는 생일을 버리지 않는 이행이다.
- **Read:** [GLG 원문·범위 변경 이력](docs/renew-memory-outline.md), [#151 본문·스레드](https://github.com/junghan0611/entwurf/issues/151).
- **운영 경계:** checkout 소스를 로드하는 운영 Pi와 gitignored dist는 따로 움직인다. production 소스 편집, 새 Pi 실행, build·설치·재시작은 창을 조율한다. worktree·clone·stash·다른 형제 작업 이동은 금지한다.
- **Writer:** 2026-11-16 15:07 KST부터 이 파일을 쓰는 사람은 6a8b34 하나다(운영코디 68bd94가 넘김, GLG 조율 대기 중). 운영코디의 동의로 `docs/renew-memory-outline.md`의 정합 수선도 6a8b34가 맡는다. 다른 미커밋 작업을 이 레일 기록에 묶지 않는다. `team.json`은 ignore 대상이라 커밋하지 않는다.
- **Do not touch:** 운영 record, 닫힌 transcript 원본, profile/overlay/hook, credential, 배포 dist. 문서 commit·push는 위 "바로 다음"에 적은 레일 기록 1회에 한한다. 대상은 `NEXT--151-renew.md`, `docs/renew-memory-outline.md`, 그리고 운영코디가 포함에 동의한 `NEXT.md`의 브랜치 포인터다. 이것은 측정, 구현, 실제 renew, 배포, 형제 종료의 승인이 아니고, 이후의 commit·push 승인도 아니다.

# RECENT

- 2026-11-16 오후: GLG가 6a8b34 세션에서 역할을 다시 배치했다. 코드는 인터페이스이고 주체는 대화하는 에이전트다. 사람 관문이 둘(시작, 확인)이고, 에이전트에게 거부권이 있다. 허용 모델 목록은 없다. 남기고 가는 것은 한국어 스킬로 하고, 한두 달 써 본 뒤 다시 나눈다. GLG 지시로 SOL과 직접 대화 lane을 열었다. SOL은 인터뷰와 자기 정리를 시작할 뜻에 동의했다. 실제 전환에 대한 동의는 아니다. SOL은 판본 동일성, final 철회, 보내주는 질문, 첫 renew의 추가 전제를 제안했다. 이 RAIL은 그 합의를 반영한 것이고, 실행 승인이 아니다.
- 2026-11-16 오후: 6a8b34가 설계를 v0→v3로 고쳤다. 판독 결과: Pi 시작 경로는 원본 고정을 지킬 수 없다(P3/P4 red). K2(lock만)는 미충족이다. shutdown은 닫힘이 아니다. 운영코디와 SOL의 검토를 합쳐 공동 범위·검증표 `0b410949…`를 고정했다. durable M-D1은 GLG의 Pi 한정 지시로 중단했다.
- 2026-11-16: GLG가 이 레일과 Pi 당사자 팀을 지정했다. 운영코디가 owner peer-facts로 6a8b34의 상태(Pi/entwurf Opus/alive)와 native id를 확인하고 명부에 등록했다. SOL a30dda는 same-id resume 뒤 socket 관측에 성공했다. 09:14 KST 응답에서 compaction summary와 최근 대화로 역할·S7 검토·S8 요청 철회까지 복원했다고 자기보고했다. blind recall 시험 PASS로 부르지는 않는다.
- 실무자 첫 의견: 현장이 스스로 정리하고, 모델의 정리와 Entwurf의 저장·운반을 분리하며, Pi+ACP 원본의 두 층과 durable 장 단위를 먼저 확인하자고 제안했다(6a8b34 inbox 2026-11-16 09:13 KST).
- SOL 첫 의견: 줄이는 것은 회상용 서술이지 원본 좌표·시간이 아니다. 축약으로 제안·철회·미결을 완료나 권한으로 승격하지 않는다. 첫 모델 턴 자동 실행은 미리 고정하지 않는다(a30dda inbox 2026-11-16 09:14 KST). 뒤에 SOL 스스로 "모든 상태 문장을 영구 보존하자는 뜻은 아니었다"고 정정했다.
- ff08d4의 별도 ACP 8파일 작업은 main `8f61e895`에 commit·push됐다는 보고를 받고, HEAD가 clean인 것을 직접 확인한 뒤 분기했다. 그 변경을 #151 작업으로 옮기지 않았다. #167 재전송 수정 `39cadf51`도 같은 원칙으로 이 브랜치에 별도로 들어왔다.
- 0.55.0 U2/U3·Herdr re-pin 등은 [main 후속 레일](NEXT.md)에 남겨 두며 #151 구현에 섞지 않는다. 이 branch NEXT는 main 병합 전에 삭제하고, 지속되는 사실은 이슈와 문서로 승격한다.
