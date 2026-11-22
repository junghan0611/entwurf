# NEXT — feat/172-pi-1.6.0: Pi SDK 1.6.0 + pi-durable carrier (#172)

**현재 (2026-11-23 01:35 KST):** 구현·리뷰·PARTIAL·FULL이 `3dfd0ead`에서 끝났다. 남은 것은 durable M1과 GLG의 운영 창 2부다. push 없음. 이슈 #172가 계약이다(R0 원본: `/tmp/entwurf-062-r0/F-core.md`·`O-durable.md`). 영수증은 `~/.local/share/entwurf-lab/172/`.

# RAIL

- [x] **R0 · 운영 창 1부.** 분석 → #172. 운영 pi-durable 정상 종료, durable-sessions 백업 `~/.local/share/entwurf-lab/062/durable-backup-20261122T205410`.
- [x] **H1–H3.** `9e697733` SDK 10종 1.6.0·lockfile·pin·literal·workflow·docs, lifecycle 문구 `transport closed`, D1(`until a signal`), D2(sdk14 golden).
- [x] **H4 리뷰·amendment.** Sol 리뷰 두 번. `2c59d4a0`: one-shot 대화 turn의 prompt 실패는 항상 고정 문구(재시도·overflow 어느 쪽으로도 읽히지 않음). `3dfd0ead`: SDK 1.6.0 Harness가 close 때 provider session을 정리하므로 carrier의 호출과 mutant를 뺌.
- [x] **PARTIAL.** `2c59d4a0`: check-dep-versions 12/12, check-pack-pin-matcher 2/2, check-acp-prompt-lifecycle 15/15, check-acp-set-model-readback 206/206. `3dfd0ead`의 work surface(`8508192d…`): check-pi-durable-carrier 65/65.
- [x] **frozen FULL.** `3dfd0ead`에서 `pnpm check:full` exit 0, 1161s (`full2-status.txt`; 첫 실행은 낡은 bridge dist로 `check-bridge-delivery`에서 멈춰 `build-bridge` 뒤 다시 돌림).
- [x] **M1 · durable.** 합성 fixture(`fixtures/pi-durable-sdk152/`, faux 모델, close·kill)와 `pi-durable-sdk152-migration.test.ts` 11개. 읽기 전용 open은 새 버전을 쓰지 않고, abort 뒤에는 1.5.2가 다시 열며, 1.6.0이 이어 달린 뒤 남은 `pi.generation` v3은 1.5.2가 `task_too_old`로 막는다.
- [ ] **H5 · 운영 창 2부 (GLG).** host Pi 1.6.0, 같은 identity 재오픈, 실제 turn·왕복. 1.6.0이 높은 버전으로 다시 저장했고 아직 끝나지 않은 task(`pi.generation` v3·`pi.tool` v4)는 0.61.0이 `task_too_old`로 막는다(task 단위, 되돌릴 수 없음).

# 미측정

- SDK 1.6.0 위의 모델 turn, host Pi 1.6.0, installed-consumer LIVE.
- RPC 세션 교체: 0-token n=1만 쟀다(`new_session` 뒤 `session_start`가 1.5.2 두 번, 1.6.0 한 번; `a2-*.{json,log}`). socket 수, switch/fork, 실제 host는 재지 않았다.
- Pi의 summary 요청이 실패할 때 원문을 유지한다는 예외를 고정하는 테스트는 없다.
- 소켓 해제 테스트는 정상 close에서 받은 Codex 소켓만 본다. 다른 provider와 갑작스러운 종료는 아니다.
- kill-power는 위 다섯 그룹만 다시 쟀다. 전체 qualification body는 돌리지 않는다.

# 역할 — 공유 checkout, 파일 writer 한 명

| 역할 | 누구 | 하는 일 |
|---|---|---|
| 구현 writer | Fable `20261121T180949-b6d8f7` | 이 브랜치의 유일한 파일 writer. 체크포인트 커밋 가능, push 없음. |
| 리뷰 | Sol `20261121T135110-09fa15` | H4 독립 리뷰. |
| 운전·조정 | `20261113T043350-ff08d4` | GLG 대신 판을 챙긴다. 결정거리는 GLG 새벽에. |
| durable 지원 | Opus `20261120T213316-793499` | D축 질문·M1 설계. checkout 편집 안 함. |

# 금지

push·tag·release·npm publish·host Pi/전역 pnpm 설치·운영 `~/.pi` 데이터 쓰기·다른 시민 retire·worktree·`--no-verify`. FULL·PARTIAL·LIVE 동안 tree/index 동결(PARTIAL은 checkout에 mutant를 심는다). `/home`이 빠듯하다(8G): scratch는 `/tmp`.
