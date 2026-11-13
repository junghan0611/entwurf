# NEXT — #142 마무리: 운영 dev판 실사용 담금질 → 릴리즈 준비

# RAIL — 현재 좌표

- [x] **1. #142 일반 Pi ACP Claude main 착지.** 드라이버 0.106.0 · wire SDK 2.6.0 · effort 실설정/readback · ESC 경계. main `28f1dd8`, **미출하**(출하된 최신 0.52.0은 0.90.0 / 1.8.0).
- [x] **2. 착지 정합과 #142 종결.** #142 close(종결 댓글 6842246704), 남은 검증 주제는 [#161](https://github.com/junghan0611/entwurf/issues/161).
- [x] **3·4. 개발 checkout 운영 설치.** 2026-11-13 GLG가 사람 종료 창에서 실행했다. 설치 기록은 exit 4로 남는다: 당시 Claude 세션이 모두 닫혀 있어 `doctor-meta-bridge`가 live Claude MCP를 측정하지 못했다(NOT CERTIFIED). Pi 쪽 wiring과 writer parity는 통과했다. 재개 뒤 read-only doctor는 세 개 모두 green이었다: `doctor-meta-bridge` PASS, `doctor-pi-package` owned(checkout), `doctor-pi-provider` ok. 다만 `entwurf-statusline`이 아직 pnpm 0.52.0이라 exclusive는 아니다. 기록: `~/.cache/entwurf-devinstall-20261113/run-20261113T143126/`.
- [ ] **5. GLG baseline과 VERIFY 담금질.** ← CURRENT
  - [x] GLG baseline PASS: Q-B0 / Q-B0-CARRIER, ACP Opus 5.5 `20261113T143713-df71e2`.
  - [x] VERIFY·BASELINE 개정 `820e8e8`: 검수자가 읽을 것을 앞에 두었다. VERIFY Part I §1B self-run walk, BASELINE core interview.
  - [x] §1B 첫 실행: ff08d4가 operator를 대행했다. 측정한 턴은 모두 pass, Blocker 0. 발견은 `7345fbb`에 반영했다. 7(effort)·8(ESC)·11(gates)은 측정하지 않았고, GLG 결정으로 하지 않는다.
  - [ ] **다음 한 행동:** ACP Opus가 검사자가 되어 ACP 소넷 형제를 인터뷰한다(원 프로토콜: botlog 20260427T183210 보이트-캄프프와 베이스라인). 결과를 보고 문서를 다듬는 일을 반복한다.
- [ ] **6. 릴리즈 준비.** 담금질이 끝나면 `entwurf-release`의 land → prepare → make → publish 순서로 간다. GLG가 판단한다.
- **PAUSED:** #160 Oracle 실행(노트북 lane이 검수), durable ACP 통합.

현재 좌표: 1–4 완료 → 5 담금질(소넷 인터뷰) → 6 릴리즈

# NOW

- **증거:** walk 기록은 `.agent-reports/verify-1b-walk-20261113.md`(host-local)에 있고, #161 댓글에 요약했다.
- **열린 후속:**
  - O6: 0.106.0에서 system prompt가 어떻게 조립되는지 재측정하지 않았다. GLG 판단은 "홈 AGENTS를 봤다고 했으니 하지 않는다"이다.
  - 형제 메시지(`custom_message` / tool result)가 임베딩에서 빠진다. agent-config(`6f5c09`)와 GLG가 다루며, entwurf는 바꾸지 않는다.
  - autocompact 500k 문의를 agent-config에 보냈다. pi `compaction.reserveTokens`는 전역 설정이라 모델마다 다른 임계값을 둘 방법이 필요하다.
- **역할:**
  - ff08d4: ACP 담당, 단일 writer, 실무 코디.
  - b3fc7c: 독립 검수.
  - c180ab(Terra): 넓은 readonly 검토.
  - 68bd94: 운영 코디, GLG DM 단독.
- **Do not touch:** 출하된 tag/npm bytes, 운영 profile·overlay·hook, credential, 회사 Cortex 실호출, worktree, `--no-verify`.

# 원자료

- #142 thread, #161, `docs/acp-backend-rail.md`, VERIFY.md Part I, BASELINE.md core interview, `docs/baseline-receipts.md`(#147/#157 n=1 기록).
- 0.52.0 출하 영수증은 `CHANGELOG.md`, Herdr tag `v2026.11.12-herdr.0.52.0`, `docs/setup-clean-host.md`. host-local 원본은 `~/.local/state/entwurf-releases/`.
