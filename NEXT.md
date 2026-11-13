# NEXT — #142 마무리: 운영 dev판 실사용 담금질 → 릴리즈 준비

# RAIL — 현재 좌표

- [x] **1. #142 일반 Pi ACP Claude main 착지.** 드라이버 0.106.0 · wire SDK 2.6.0 · effort 실설정/readback · ESC 경계. main `28f1dd8`, **미출하**(출하된 최신 0.52.0은 0.90.0 / 1.8.0).
- [x] **2. 착지 정합과 #142 종결.** #142 close(종결 댓글 6842246704), 남은 검증 주제는 [#161](https://github.com/junghan0611/entwurf/issues/161).
- [x] **3·4. 개발 checkout 운영 설치.** 2026-11-13 GLG가 사람 종료 창에서 실행했다. 설치 기록은 exit 4로 남는다: 당시 Claude 세션이 모두 닫혀 있어 `doctor-meta-bridge`가 live Claude MCP를 측정하지 못했다(NOT CERTIFIED). Pi 쪽 wiring과 writer parity는 통과했다. 재개 뒤 read-only doctor는 세 개 모두 green이었다: `doctor-meta-bridge` PASS, `doctor-pi-package` owned(checkout), `doctor-pi-provider` ok. 다만 `entwurf-statusline`이 아직 pnpm 0.52.0이라 exclusive는 아니다. 기록: `~/.cache/entwurf-devinstall-20261113/run-20261113T143126/`.
- [x] **5. GLG baseline과 VERIFY 담금질.** baseline PASS, VERIFY·BASELINE 개정, §1B walk(n=1, Blocker 0), 소넷 인터뷰 PASS. 인터뷰에서 나온 D1을 `4ca9bb0`에서 고쳤고, LIVE n=1로 확인했다.
- [ ] **6. 릴리즈 0.53.0.** ← CURRENT
  - [x] land: `234a92a`, CI run 43390591770 4/4.
  - [x] prepare: `chore(release): prepare v0.53.0`. P4 green. P5 r2는 MUST 22/1/1이다. FAIL 1건은 vendor 403이고 단독 재측정 86 pass다. Codex SKIP은 GLG 결정으로 남겼다. 근거는 CHANGELOG 0.53.0 Release evidence에 있다.
  - [ ] **다음 한 행동:** `/entwurf-release make 0.53.0`. prepared SHA를 push하고, exact-SHA CI 뒤 Windows carrier 후보(M3w)를 받는다. 다음은 tag, GitHub release 순이다. publish는 GLG가 직접 한다.
  - [ ] publish 후: Herdr에 npm 0.53.0을 re-pin하고 스냅샷 태그를 만든다. #161에 종결 댓글을 달고 닫는다.
- 관찰(이번 cut 밖): `check-acp-backend-preflight`는 thinking level 없이 backend를 부른다. 지금은 검사 순서 덕에 green이다(b3 O1). `*resume-call.test.ts`가 `/tmp` 디렉터리를 남긴다(P9).
- **PAUSED:** #160 Oracle 실행(노트북 lane이 검수), durable ACP 통합.

현재 좌표: 1–5 완료 → 6 릴리즈 0.53.0 (land·prepare 완료 → make)

# NOW

- **증거:** walk 기록은 `.agent-reports/verify-1b-walk-20261113.md`(host-local)에 있고, #161 댓글에 요약했다.
- **열린 후속:**
  - O6: 0.106.0에서 system prompt가 어떻게 조립되는지 재측정하지 않았다. GLG 판단은 "홈 AGENTS를 봤다고 했으니 하지 않는다"이다.
  - 형제 메시지(`custom_message` / tool result)는 임베딩에서 빠진다. GLG 판단은 "제외가 맞다"이고, agent-config가 `docs/memory-and-sessions.md`에 기록했다. entwurf는 바꾸지 않는다.
  - **D1 수정 `4ca9bb0`(미push):** ACP Claude 모델(`entwurf/claude-*`)로 열린 pi 형제는 framing에서 Claude 표기 `mcp__entwurf-bridge__…`를 받는다. Cortex 표기는 미측정이라 그대로 두었다. PARTIAL 162/162, `check:full` green. ACP 모델로 여는 LIVE fresh-call 확인은 모델 호출이라 GLG go가 필요하다.
  - autocompact: agent-config `9389087`에 반영됐다. Opus·Sonnet ACP에 `reserveTokens` 500000을 두었다. 운영 pi에는 `/reload` 또는 재기동해야 적용된다. entwurf 쪽 할 일은 없다.
- **역할:**
  - ff08d4: ACP 담당, 단일 writer, 실무 코디.
  - b3fc7c: 독립 검수.
  - c180ab(Terra): 넓은 readonly 검토.
  - 68bd94: 운영 코디, GLG DM 단독.
- **Do not touch:** 출하된 tag/npm bytes, 운영 profile·overlay·hook, credential, 회사 Cortex 실호출, worktree, `--no-verify`.

# 원자료

- #142 thread, #161, `docs/acp-backend-rail.md`, VERIFY.md Part I, BASELINE.md core interview, `docs/baseline-receipts.md`(#147/#157 n=1 기록).
- 0.52.0 출하 영수증은 `CHANGELOG.md`, Herdr tag `v2026.11.12-herdr.0.52.0`, `docs/setup-clean-host.md`. host-local 원본은 `~/.local/state/entwurf-releases/`.
