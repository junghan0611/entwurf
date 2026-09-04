# NEXT — #101: 한 pid 안의 세션 전환이 만든 유령 시민과 거짓 배달

> 브랜치 레인의 disposable 핸드오프. 본 레인 `NEXT.md`는 GLG의 stem 선택 대기 상태이므로
> 건드리지 않는다(이 브랜치의 워킹트리에 있는 `NEXT.md` 수정은 이 레인이 만든 것이 아니라
> 이전 세션이 남긴 미커밋 변경이며, 이 브랜치의 커밋에 싣지 않는다).

# RAIL

- [x] **A. 유령 등록** — 훅이 envelope의 `source`를 읽어 모든 로그 줄에 싣고, sender marker를
      덮기 **전에** 읽어 같은 ownerPid가 다른 가든을 가리키면 그 가든의 receiver marker를
      은퇴시킨다. marker만, 그리고 **이 pid가 소유한 marker만**. record는 손대지 않는다.
      은퇴 판단은 `source` 값에 의존하지 않는다 — 디스크 사실로만 결정하므로 호스트·벤더
      버전에 무관하다.
- [x] **B. 거짓 deliverable (핵심)** — receiver marker는 "살아있는 pid가 언젠가 이 가든의
      watch를 armed했다"까지만 증명한다. `watchArmed`를 marker match의 복사가 아니라
      **owner의 sender marker가 지금도 같은 가든을 가리키는가**의 측정으로 바꿨다.
      단일 합성 `resolveMailboxReceiverFacts`(주입된 리더 위에서 순수)를 production seam과
      `entwurf_self` 둘 다가 부른다.
- [x] **C. reject 이유** — `RejectDiagnostic`에 `mailbox-undeliverable` 추가, decider가
      predicate의 reason을 싣고 surface가 렌더한다.
- [x] **D. 관측면** — `PeerFact`에 `receiver`(active|inactive|none|n/a|unobserved) +
      `transcript`(exists|absent|unobserved). 사실이지 verb가 아니다.
- [x] **E. 게이트 + 뮤턴트** — `check-meta-hook-session-switch` (24 assertions, `check:hermetic`
      등록) + `scripts/mutants/meta-hook-session-switch.json` (11 claim).
- [x] **F. raw lab 실행** — GLG 승인 후 oracle에서 S1–S6 전부 돌렸다(Claude Code 2.1.260, haiku).
      영수증은 `scripts/raw-claude-session-switch/README.md`에 훅 로그 **verbatim**으로 있다.
      **상속된 문장 하나가 반증됐다:** resume picker는 SessionStart를 **한 번만** 쏜다(S2/S3).
      두 번 쏘는 모양은 맨 `claude` 기동(진짜 새 세션) + 세션 안 `/resume`·`/clear`다(S4/S5).
      수리는 그대로 유효하다(어느 쪽이든 한 pid가 가든을 갈아탄다) — 산문만 4곳 고쳤다.
      compaction(S6a 수동·S6b 자동)은 **같은 native id**로 SessionStart를 다시 쏴 같은 가든에
      attach하므로 은퇴가 일어나지 않는다. 세 반증 조건 모두 판정 완료(README 상단).

# 스코프 결정 하나 (다음 레인의 출발점)

**sender↔receiver 교차검증은 `ownerKind`로 스코프된다 — 지금은 `claude-code-cli`만.**
backend 축으로 걸면 Copilot이 전부 영구 `mailbox-undeliverable`이 된다: copilot의 receiver
marker owner는 포크된 확장 자식의 `process.pid`(`pi/copilot-receive/entwurf-receive/extension.mjs`)
이고 sender marker는 CLI의 `process.ppid`(`pi-extensions/meta-bridge-hook-copilot.ts`)라
구조적으로 다른 pid다.

`omp-host`는 **후보이지 결론이 아니다.** OMP는 `/new` 엣지에서 이미 in-process unarm을 하고
(그 계약의 뮤턴트가 `scripts/mutants/omp-receive.json`의 `OMP-RECEIVE-NEW-RETIRES-OLD`),
claude가 없던 그 은퇴를 갖고 있다 — 이번 claude 은퇴와 **같은 모양의 문제를 다른 층에서** 닫은
것이다. lane을 넓히려면 (a) omp host pid가 sender/receiver 양쪽 marker를 같은 값으로 쓰는지
실측하고, (b) 두 은퇴가 겹칠 때 어느 쪽이 이기는지 게이트 셀로 고정한 뒤에 한다.

# 이 호스트(oracle)의 LIVE 영수증 — 2026-09-04, 워킹트리에서 읽기 전용

수리된 관측면을 실제 가든 스토어에 대고 읽은 결과(설치본이 아니라 워킹트리 코드로,
읽기만 — 이 호스트의 marker/record/편지는 하나도 건드리지 않았다):

```
- 20260904T072015-e09b66  backend=claude-code  liveness=unsupported  receiver=active    transcript=exists  cwd=/home/junghan/nixos-config
- 20260904T093135-ac7a1a  backend=claude-code  liveness=unsupported  receiver=inactive  transcript=absent  cwd=/home/junghan/nixos-config
```

`liveness`만 보던 면에서는 두 줄이 구별되지 않았다. 이제 유령은 두 컬럼 모두에서 다르게 보인다.

# 다음 한 걸음

1. **크로스 리뷰 대기 (GLG가 pi copilot sol에게 맡긴다).** 리뷰 중에는 브랜치를 움직이지
   않는다 — 리뷰어가 읽는 SHA가 고정돼야 한다. 지적은 이 레인이 닫는다.
2. **push 없음.** 배포는 끝났다(`entwurf setup` green, `doctor-meta-bridge: PASS`, 2026-09-04).
   설치본 훅은 이제 브랜치 코드다. 그 이전에 열린 세션들은 다음 SessionStart까지 옛 거동이다.
3. **#99로 넘길 재료 하나:** 이 레인은 "주장된 셀만 재증명하던" qualification에 claude 훅
   lane을 처음으로 만들었다(11 claim). #99의 결정(전수 qualification을 언제 돌릴지)은 이제
   사례 하나를 손에 들고 있다.

# 검증

```bash
./run.sh check-meta-hook-session-switch     # 이 레인의 게이트
./run.sh check-entwurf-facts                # PeerFact keyset + 관측 축
./run.sh check-entwurf-fact-provider        # observe seam 주입
./run.sh check-entwurf-peers-surface        # 컬럼 렌더 + verb 금지 스캔 유지
./run.sh check-entwurf-deliverability       # 순수 predicate
./run.sh check-gate-qualification           # 11 뮤턴트 전수 (frozen candidate에서 1회)
pnpm run check:full                         # 전체 바닥 (frozen candidate에서 1회)
```

# 금지

- 이 호스트의 `~/.pi/agent/meta-mailbox/20260904T093135-ac7a1a/` 편지와 marker·record를
  지우지 않는다. 그것이 #101의 재현 증거다.
- 본 레인 `NEXT.md`를 이 브랜치에서 커밋하지 않는다.
- `source` 값에 분기하는 로직을 넣지 않는다. 로그로만 남긴다(호스트 독립성이 그 이유다).
