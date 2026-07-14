# NEXT — v0.12.8 수선 컷

> NEXT는 부트 섹터다. 닫힌 역사는 CHANGELOG/git에, 장기 방향은 ROADMAP/이슈에 둔다.

## NOW — 0.12.8은 수선 컷이다. 범위 SSOT는 **#49**

- **Stem:** 0.12.7 출하 하루 만에 **런타임 축이 우리 밑에서 움직였다.** 전역 pi가 `0.80.6`으로 가 있는데 리포 pin은 `0.80.3`이었다. 그 격차가 CI RED · `pit` 경고 · "게이트가 검증하는 런타임이 게이트가 선언한 런타임이 아님" 세 형태로 동시에 터졌다. 0.12.8은 새 능력을 더하지 않고 **바닥이 선언대로인지**만 맞춘다. `0.13.0`은 계속 cortex(#48).
- **범위·근거·기각된 선택지는 전부 #49에 있다.** 여기엔 다음 한 걸음만 둔다.

### 실행 순서 — ~~A~~ → ~~B~~ → **C** → E

**A·B는 닫혔다** (`33b3810`/`76f14c6`, `52d515b` — 둘 다 main CI green). 아래 RECENT 참조. 한 항목씩 커밋·푸시하고 CI로 확인한 뒤 다음으로 넘어간다.

1. **C — fresh mint와 strict resume 분리. ← 다음 한 걸음.** **착수 전 [§C 최종 범위 코멘트](https://github.com/junghan0611/entwurf/issues/49#issuecomment-4967496388)를 읽는다 — 그것이 C의 SSOT이고, 본문 §C의 `discriminated union` 요구와 builder의 `sessionId` 유지는 그 코멘트가 폐기했다.** main에서 간다(브랜치 없음). pi는 건드리지 않는다. 외부 주소·plan·marker·socket의 권위는 계속 gid이고, v2 rail 내부 handoff만 고친다.
   - **버그.** parent가 이미 찾은 authoritative `sessionFile`을 버리고 child에게 `--session-id <gid>`로 두 번째 lookup을 시킨다. parent의 고정 `SESSIONS_BASE`와 child의 `sessionDir` 해석이 갈리면 같은-gid 빈 세션/socket이 생겨 false-success한다.
   - **처방.** v2 child는 exact `--session <absolute-file>`. **builder는 v2 전용이 된다** — `variant`와 legacy arm을 **삭제**한다(그 arm의 production caller는 애초에 없었다: 헤더가 지목한 `entwurf-async.ts`는 존재하지 않고, `entwurf-core.ts:1908`이 인라인으로 만들며, 그 v1 함수들은 caller 0). `entwurf-core.ts:1908`은 **그대로 둔다** — `entwurf-core.ts`는 MCP strip-types(`.ts` 필수) ↔ root tsc(`.ts` 금지) 이중 경계에 끼여 있어 **resume builder를 import할 수 없다**(Node는 `.js`→`.ts`를 remap하지 않는다. `mcp/tsconfig.json` 주석 참조). dead v1 제거는 **별도 routing-cleanup**.
   - **marker/header pre-socket guard를 넣는다.** 지금 마커 검사는 entwurf-tag 분기 안에만 있고 소켓이 선 뒤에 돈다 — 그래서 loaded header가 **다른 gid의 일반 resident**면 남의 세션에 모델 턴이 들어간다. `startControlServer()` 전에 `marker ≠ loaded id` → hard-exit. 남는 한계는 **같은 gid·다른 내용 교체**뿐이다(inode/digest 영역, C 범위 밖).
   - **marker 수명주기는 reload-safe여야 한다.** 단순 `delete process.env[...]` 3줄은 `/reload`(`agent-session.ts:2544` → shutdown → **팩토리 재실행** → session_start)에서 authorization을 잃는다. capture → 즉시 scrub → closure 보관 → **`session_shutdown(reason="reload")`일 때만** 복원. 자손은 마커를 상속하지 않는다.
   - **완료 판정은 argv에 `--session`이 보이는 것이 아니다.** child의 resolver를 일부러 틀리게 해도(`PI_CODING_AGENT_SESSION_DIR=<빈 temp>`) **원래 JSONL만 재개되는가**다. 평상시 설정의 LIVE resume은 **지금 코드도 green일 수 있다** — 반례를 심는 것이 C의 핵심이다. **main에서 RED 먼저 확인하고, RED는 커밋하지 않는다.**
   - **negative 4-case(missing/corrupt/empty/different-gid)는 LIVE가 아니라 `pnpm check`.** pin(`node_modules/.bin/pi`) + sandbox(HOME·XDG 3종·`PI_CODING_AGENT_DIR`·`PI_SETTINGS_PATH`·`PI_CODING_AGENT_SESSION_DIR`)면 host를 안 건드리고 **토큰도 0**이다(넷 다 모델 턴 전에 죽는다). **exit code만 보면 vacuous pass** — 기대 stderr 문구를 assert한다.
   - **C 이후 거짓이 되는 선언을 같은 커밋에서 고친다:** `entwurf-resume-args.ts`(허구의 shared/legacy 서술) · `check-entwurf-resume-args.ts` · `check-entwurf-v2-spawn-production.ts` · `run.sh:105` · `README.md:539` · `AGENTS.md:177` · `entwurf-control.ts:1169,1190` · `entwurf-core.ts:1354` · `docs/mux-launch-rail.md:23` · marker leaf의 env 수명주기 · **#49 본문 §C와 이 NEXT의 union 요구**. **B의 교훈이다 — 코드가 바뀌는데 선언이 안 바뀌면 게이트가 거짓말을 시작한다.**
   - **중지 조건:** production 순증가 25줄 초과 · 새 파일/registry · `entwurf-core.ts`가 resume builder를 import · 파일 경로가 외부 garden-id surface로 노출 · same-gid content swap까지 C에서 해결하려 함. (예산: production 5~20줄, 전체 30~70줄, 새 파일 0.)
   - fresh launcher는 계속 `--session-id "$(run.sh new-session-id)"`; 경고는 **수용 + README 계약 문장 갱신**. launcher pre-create는 반쪽 세션·불변식 파괴로 기각. `smoke-session-id-name`은 upstream footgun 증거로 **유지**.
2. **E — floor purity.** 설계 SSOT는 **#41의 두 코멘트**(본 설계 + 실기기 보정). GPT 초안은 관측면이 좁아 워킹트리에서 걷어냈고, #41 기준으로 **재작성**한다.
   - 첫 전체 floor 실행은 green이 목표가 아니다. **churn 카탈로그를 뽑는 관측 실행**이고, RED는 데이터다.

### 후속 (0.12.8 밖) — #49 참조

**D** thinking/effort wire (map 단독 반영 금지) · **F** #41에 "게이트가 호스트에서 **읽는** 것" 축 추가 · **G** `modelOverrides` × curated invariant 정책.

## RECENT

- **[2026-07-14] #49 C — 착수 전 3자 교차검토에서 설계가 두 번 바뀌었다. 범위는 [§C 최종 범위 코멘트](https://github.com/junghan0611/entwurf/issues/49#issuecomment-4967496388)에 고정.** 진단(parent/child가 서로 다른 resolver를 쓴다)과 처방(`--session <절대경로>`)은 그대로지만, 그 처방을 **어디에 놓느냐**가 두 번 틀렸다.
  - **첫 오류 — "`entwurf-core.ts`를 builder에 연결해 SSOT를 참으로 만들자".** 불가능했다. `entwurf-core.ts`는 MCP strip-types(`.ts` 명시 필수)와 emit-capable root tsc(`.ts` 금지) **이중 런타임 경계**에 끼여 있다. 근거로 삼은 `entwurf-control.ts → ./lib/entwurf-core.js`는 pi의 **jiti loader** 증거였지 Node 증거가 아니었다 — Node v24.16.0 실측: `.js` 지정자 → `ERR_MODULE_NOT_FOUND`. **리포가 이미 `mcp/tsconfig.json` 주석에 적어둔 제약을 안 읽고 추론했다.** 방향도 틀렸다: 그 legacy 함수들은 caller 0인 v1 시체다 → **연결이 아니라 삭제**.
  - **둘째 오류 — "marker를 캐시하고 env에서 지우면 끝".** `/reload`를 빠뜨렸다. pi는 같은 프로세스에서 **extension 팩토리를 다시 돌린다**(`agent-session.ts:2544`) → scrub된 새 instance는 authorization을 잃는다. reload에서만 복원하는 수명주기가 필요하다.
  - **남긴 규율:** 런타임 경계를 **추론하지 말고 실행해서 확인한다.** 그리고 리포가 자기 제약을 이미 문서화해 뒀는지 먼저 본다.
- **[2026-07-14] #49 B — pi pin `0.80.3 → 0.80.6`. 로컬 게이트 전부 green, main CI는 이 커밋의 푸시로 확정한다.** devDeps·peer range·`check-pack-install` peer pin·baseline 문서 5개 파일이 함께 움직였다. 전체 `pnpm check` green + **고의로 실패하는(exit 97) 가짜 `pi`를 PATH 맨 앞에 둔** `check-pack-install` green — 게이트가 `pinned pi 0.80.6`을 드라이브했다고 스스로 말했고, 가짜는 한 번도 호출되지 않았다.
  - **타입이 답할 수 없었던 것을 게이트가 답했다.** 0.80.4가 갈아엎은 `package-manager`(autoload delta + dedupe 재작성)·`settings-manager`·`resource-loader`가 우리 install surface(hoisted-dep npm install, foreign-cwd user-scope citizen)를 건드리지 않았다.
  - **하마터면 놓칠 뻔한 것:** 0.80.6의 anthropic 카탈로그가 **줄었다** (24 → 14 id, `claude-3-*`/`opus-4-0`/`sonnet-4-0` 레거시 제거). `curatedClaudeModels()`는 앵커(`claude-opus-4-8`)가 없으면 **crash**한다 — 앵커가 잘렸다면 extension load에서 provider 표면이 통째로 죽었다. 두 curated 행 모두 생존, `cost`/`contextWindow`/`maxTokens` 동일. 늘어난 `thinkingLevelMap`(Opus `{xhigh}`→`{xhigh,max}`, Sonnet은 맵 자체가 새로 생김)은 curated 행이 복사하지 않는다(thinking wire는 후속 D).
  - **검수가 잡아 수선 셋으로 늘었다 — 셋 다 "선언 ≠ 검증"의 같은 얼굴이다.**
    1. `check-pi-runtime-version`의 `FLOOR`가 **어느 게이트도 강제하지 않는 두 번째 pin 리터럴**이었다 → `package.json` devDep에서 **파생**한다. **움직일 pin은 하나여야 한다.**
    2. 그 게이트가 **선언한 범위의 절반만 검사**했다. `>=floor` 만 보고 상한을 안 봐서 미래의 pi(0.81+)는 무사통과였다 — "런타임이 범위를 넘어갔는데 게이트는 계속 green"이 바로 이번 컷의 주제다 → 상한도 devDep에서 파생(뮤테이션: floor RED `0.80.9`, ceiling RED `0.79.9`).
    3. `check-dep-versions`는 **문서 coverage보다 오래 살아남아 계속 그것을 광고했다.** 이 게이트는 문서를 읽으며 태어났다(`362becd`: 21de0f9 drift 직후, README의 codex-acp install pin을 assert). 그런데 `bf4a533`이 openclaw/ACP 레인을 걷어내며 **그 assertion을 함께 들어냈고, 사용법·주석의 선언만 남겼다.** 그 뒤로 문서 절반은 산문이었고, pi baseline 문서는 애초에 한 번도 묶인 적이 없다. pin은 그 문서 5곳에 사는데 이번 bump가 5곳을 다 건드렸고, `demo/README.md`를 지켜낸 건 게이트가 아니라 손 grep이었다 → 문서를 게이트 안에 되돌려 넣었다(range 선언 5 + exact install pin 1 + 산문 앵커 4). 산문 앵커가 사라지면 **vacuous pass가 아니라 fail loud**. 뮤테이션: `demo/README.md` 한 곳만 옛 floor로 되돌리면 exit 1.
    - **남은 교훈:** 이 세 번째 항목의 첫 서술("한 번도 읽지 않았다")부터가 git을 안 보고 쓴 문장이었고, 검수가 잡았다. 게이트의 거짓 선언을 지적하는 문장을 검증 없이 쓰면 같은 병이다.
- **[2026-07-14] #49 A 닫힘 — main CI green.** `check-pack-install`이 host PATH 대신 install-smoke 트리의 pinned pi를 드라이브하고, `--version`으로 그게 정말 pin인지 assert한다. **게이트가 자기가 무슨 pi를 증명했는지 말하지 못하면 아무것도 증명하지 못한 것이다.**
  - 검수가 잡은 blocker: `--version` probe도 격리해야 했다. **pi는 버전을 찍기 전에 설정을 먼저 읽는다** — 격리 없는 probe는 운영자의 실제 `settings.json`을 열었다(strace: 격리 전 1회 → 후 0회). read 결합을 없애는 커밋이 새 read 결합을 들여올 뻔했다.
  - 남긴 규율: **게이트는 운영자의 전역 설치를 WRITE하지 못하는 것과 똑같이 READ해서도 안 된다.** rule 11은 지금까지 write 결합만 금지했다. read 결합이 더 음험하다 — **로컬은 항상 green이라 CI가 없으면 영원히 안 보인다.** 전수 조사는 후속 F.
- **[2026-07-14] 0.12.7 released.** #46 agy/Antigravity를 garden citizen으로 출하. 상세는 CHANGELOG `## 0.12.7`. (그 릴리즈 커밋의 CI는 RED로 남아 있다 — 위 A가 그 수선이고, 태그는 재푸시하지 않는다.)
- **[2026-07-14] #41에 floor purity 설계를 고정.** #41의 분류 작업은 계측기가 선 뒤에 결합한다: fence → containment → resolver 통합 → **#41 분류** → 미연결 스크립트 삭제.
- **[2026-07-13] evidence boundary:** 동일 agy pid에서 여러 conversation이 동시에 model invocation을 수행하면 단일 marker가 last-writer로 덮인다. 현재 agy의 process-per-session·직렬 invocation에 기대며, 같은 pid 동시성은 지원하지 않는다.
- **수동 항목:** `smoke-meta-async-drift`는 외부 바이너리 pin에 의존해 CI에 못 넣는다. 컷 체크리스트의 수동 항목 (2026-07-14 green: claude 2.1.208 / codex 0.144.1 / agy 1.1.2).

## AFTER 0.12.8

1. **#47 mux launch rail — 계속 0.12.x.** 착수 전 `docs/mux-launch-rail.md`를 읽는다.
2. **#48 cortex — 0.13.0.** PR #40은 PARK. mux 기반과 backend adapter 검증이 선 뒤에만 연다.
3. **Meta sender 모델 표기 — 비차단.** `agentId=meta-session/<backend>`는 `AGENTS.md` 계약대로 정상이다. 모델 표시는 agentId를 바꾸지 말고 optional display field로 별도 설계한다.
