# NEXT — feat/172-pi-1.6.0: Pi SDK 1.6.0 + pi-durable carrier (#172)

**현재 (2026-11-22 21:05 KST):** R0 끝, 구현 시작 전. 이슈 #172가 계약이다(R0 보고서 원본: `/tmp/entwurf-062-r0/F-core.md`·`O-durable.md`, 결정적 줄은 이슈 본문에 옮김). GLG는 0.61.0 publish 24시간 뒤 0.62.0을 낸다. GLG는 자는 중이고 새벽 1–2시에 깬다.

# RAIL

- [x] **R0.** 코어(b6d8f7)·durable(793499) 읽기 전용 분석 → #172.
- [x] **운영 창 1부.** 운영 pi-durable(pid 2743504, 68bd94) 정상 종료(owner fence closed 11:52:02Z), durable-sessions 전체 백업 `~/.local/share/entwurf-lab/062/durable-backup-20261122T205410`(243 files, WAL/SHM 136, manifest 3개 동일 `3bff6531ece1260b`). GLG가 checkout 설치 승인.
- [ ] **H1 · coherent bump.** ← CURRENT. 10종 1.6.0·lockfile·`minimumReleaseAgeExclude` +1.6.0·`upstream-pin.json` sdk members를 한 커밋. checkout에 설치(`TMPDIR=/tmp`, `pnpm_config_verify_deps_before_run=error`·`npm_config_verify_deps_before_run=error` 유지).
- [ ] **H2 · 첫 측정.** `pnpm check`, 분류기 oracle 다섯(`stop-texts.test`, `backend.vendor-rejection.test`, `agy-adapter.test`, `backend.summary-turn.test`, `check-acp-prompt-lifecycle`), durable fence typecheck, `check-pi-durable-carrier`.
- [ ] **H3 · 고침.** A1(기존 불변식: 우리가 쓴 실패가 맹목 재시도를 부르지 않는다 — 문구와 stderr tail 경로), D1(`tui.ts:661` + carrier 재방출 + mutant find), D2(sdk14 golden), A2(`resident-rpc-drive` 재측정), B(literal·workflow·docs).
- [ ] **H4 · 검수.** Sol(09fa15) 독립 리뷰 → amendment 한 묶음 → 영향 PARTIAL → frozen FULL. durable M1(1.5.2가 남긴 fixture를 1.6.0으로 열기).
- [ ] **H5 · 운영 창 2부 (GLG).** host Pi 1.6.0, 같은 identity 재오픈, 실제 turn·왕복. 첫 1.6.0 run 뒤 0.61.0은 non-terminal task를 `task_too_old`로 막는다(되돌릴 수 없음).

# 역할 — 공유 checkout, 파일 writer 한 명

| 역할 | 누구 | 하는 일 |
|---|---|---|
| 구현 writer | Fable `20261121T180949-b6d8f7` | 이 브랜치의 유일한 파일 writer. 체크포인트 커밋 가능, push 없음. |
| 리뷰 | Sol `20261121T135110-09fa15` | H4 독립 리뷰. |
| 운전·조정 | `20261113T043350-ff08d4` | GLG 대신 판을 챙긴다. 결정거리는 GLG 새벽에. |
| durable 지원 | Opus `20261120T213316-793499` | D축 질문·M1 설계. checkout 편집 안 함. |

# 금지

push·tag·release·npm publish·host Pi/전역 pnpm 설치·운영 `~/.pi` 데이터 쓰기·다른 시민 retire·worktree·`--no-verify`. FULL·PARTIAL·LIVE 동안 tree/index 동결(PARTIAL은 checkout에 mutant를 심는다). `/home`이 빠듯하다(8G): scratch는 `/tmp`.
