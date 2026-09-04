# NEXT — #101: 한 pid 안의 세션 전환이 만든 유령 시민과 거짓 배달

> 브랜치 레인의 disposable 핸드오프. **머지 전에 이 파일을 지운다** — 남길 것은 이미 커밋과
> 이슈 #101 댓글, `scripts/raw-claude-session-switch/README.md`에 승격돼 있다. 본 레인
> `NEXT.md`는 GLG의 stem 선택 대기라 건드리지 않는다(워킹트리의 `NEXT.md` 수정은 이 레인이 만든
> 것이 아니라 이전 세션이 남긴 미커밋 변경이며, 이 브랜치의 어떤 커밋에도 싣지 않았다).

# RAIL — 현재 좌표

- [x] **1. 수리 (A·B·C·D)** — 유령 등록 은퇴 / 거짓 deliverable을 reader-side fail-closed로 /
      reject 이유 진단 / `entwurf_peers` 관측 컬럼. `3ca8220`
- [x] **2. 게이트 + 뮤턴트 lane** — `check-meta-hook-session-switch` **28 assertions**
      (`check:hermetic` 등록) + `scripts/mutants/meta-hook-session-switch.json` **17 claim**,
      QK 라벨과 1:1.
- [x] **3. 배포 + raw lab (F)** — `entwurf setup` green · `doctor-meta-bridge` PASS · S1–S6 실행,
      영수증은 raw README에 verbatim. `7ae69ae`
- [x] **4. 크로스 리뷰 2라운드** — 지적 4 + final 3 전부 닫힘, 리뷰어 코드 PASS.
      `f381228` · `eec8de1` · `f4dbe32` · `69bee12`
- [ ] **5. push / 릴리즈** ← CURRENT: **GLG 승인 대기.** 이 레인은 push하지 않는다.

현재 좌표: 1–4 완료 → 5는 GLG 결정 대기. 브랜치는 정지 상태다.

# NOW

- **Current:** 커밋 6개가 로컬에만 있다(`3ca8220 → 7ae69ae → f381228 → eec8de1 → f4dbe32 → 69bee12`).
  설치본 훅은 이미 브랜치 코드다(`entwurf setup`, 2026-09-04). 리뷰 종료, 코드 PASS.
- **Next:** GLG가 push를 결정한다 → 그 뒤에 #101 종결 댓글을 올린다(원격에 없는 SHA를 링크하지
  않는다). 초안은 준비돼 있다.
- **Blocker:** 없음. 승인 대기다.
- **Read:** 이슈 #101 스레드 · `scripts/raw-claude-session-switch/README.md` · 아래 "이월 관측".
- **Do not touch:**
  - 이 호스트의 `~/.pi/agent/meta-mailbox/20260904T093135-ac7a1a/` 편지·marker·record — #101의 재현 증거다.
  - 본 레인 `NEXT.md` — 이 브랜치에서 커밋하지 않는다.
  - `source` 값에 분기하는 로직 — 로그로만 남긴다(호스트 독립성이 이유다).

# 검증

```bash
./run.sh check-meta-hook-session-switch     # 이 레인의 게이트 (28 assertions)
./run.sh check-entwurf-facts                # PeerFact keyset + 관측 축
./run.sh check-entwurf-fact-provider        # observe seam 주입
./run.sh check-entwurf-peers-surface        # 컬럼 렌더 + verb 금지 스캔 유지
./run.sh check-entwurf-deliverability       # 순수 predicate
./run.sh check-gate-qualification           # 17 뮤턴트 포함 전수 (frozen candidate에서 1회)
pnpm run check:full                         # 전체 바닥 (frozen candidate에서 1회)
LIVE=1 ./run.sh smoke-entwurf-v2-matrix-live      # release MUST, fixture를 건드렸으므로
LIVE=1 ./run.sh smoke-acp-v2-send-live            # release MUST
LIVE=1 ./run.sh smoke-entwurf-chain-live          # release MUST
```

마지막 실측(`f4dbe32` 기준): `check:full` exit 0 / `check-gate-qualification` 364/364 KILLED /
LIVE 3종 초록(chain-live 24 assertions).

# 스코프 결정 — 다음 레인의 출발점

**sender↔receiver 교차검증은 `ownerKind`로 스코프된다 — 지금은 `claude-code-cli`만.** backend
축으로 걸면 Copilot이 전부 영구 `mailbox-undeliverable`이 된다: copilot의 receiver marker owner는
포크된 확장 자식의 `process.pid`(`pi/copilot-receive/entwurf-receive/extension.mjs`)이고 sender
marker는 CLI의 `process.ppid`(`pi-extensions/meta-bridge-hook-copilot.ts`)라 구조적으로 다른 pid다.

`omp-host`는 **후보이지 결론이 아니다.** lane을 넓히려면 (a) omp host pid가 sender/receiver 양쪽
marker를 같은 값으로 쓰는지 실측하고, (b) 두 은퇴(OMP의 `/new` in-process unarm과 이번 claude
은퇴)가 겹칠 때 어느 쪽이 이기는지 게이트 셀로 고정한 뒤에 한다.

# 이월 관측 (수정 아님, 다음 레인 재료)

1. **omp-host 후보 조건 하나 더:** OMP `unarm`의 marker 삭제 실패는 catch 후 진행하고
   (`meta-bridge-receive-omp.ts:610-636`) omp에는 reader-side join이 없으므로 방어막이 writer
   하나뿐이다. lane을 넓힐 때 이 비대칭부터 측정한다.
2. **observe seam footgun:** custom `metaEntries`를 주면서 observer를 주입하지 않으면 기본
   관측자가 다른 루트를 stat한다. 새 caller/gate는 `observe` 주입이 규율이고, 이유는 provider
   헤더에 있다.
3. **원인 미상 1건 — 열린 채로 남긴다.** 아래.

## 원인 미상 — chain-live 1회 (2026-09-04 16:58 KST)

앞뒤 두 번은 통과했고 재현되지 않았다. 로그는 이 호스트 스크래치에만 있으므로 결정적 줄을
verbatim으로 남긴다:

```
[smoke-entwurf-chain-live] nonce:  ENTWURF-CHAIN-64A93C03B3
[smoke-entwurf-chain-live] D:      20260904T165055-883abc (mailbox terminus)
[smoke-entwurf-chain-live] A:      20260904T165100-f32e09 (native Claude Code)
hop1 (A, native claude): entwurf_v2 control-socket → sent
hop2 (B, pi gpt-5.6-luna): entwurf_v2 control-socket → sent
hop3 (C, pi ACP claude-sonnet-5): entwurf_v2 rejected: mailbox-undeliverable
      (observed liveness: unsupported) — self-fetch receiver inactive, idle-watch not armed.
그 뒤 C는 "type":"agent_end" 로 정상 종료, 단언 실패: the chain reached the mailbox terminus (0 .msg)
```

hop 1·2는 도달했고 C의 턴도 정상 종료했다. 거부 문구는 **그 순간 join이 거짓**이었다고 말하므로
이 스모크가 소유한 fixture가 실행 중에 상했다는 뜻이다.

- **측정으로 배제:** spawn→marker write 사이의 start-key 레이스(spawn 직후 start key가 즉시 읽히고
  write/read 왕복), idle owner의 조기 종료(같은 커맨드로 20초 생존).
- **뒷받침되지 않음:** "idle owner가 메모리 압박에 죽었다"는 가설은 확인도 반증도 되지 않았다 —
  `journalctl --since 16:50 --until 17:02`(system+user)에 OOM/kill 줄 없음, `systemd-oomd` active지만
  kill 기록 없음, earlyoom 비활성 (Fable 측정).
- **다음에 갈라줄 자리:** 체인 시작 직전 `fixture: the terminus is a deliverable citizen…` 단언이
  빨가면 fixture가 처음부터 상한 것이고, 초록인데 타임아웃이면 `terminus fixture at timeout:
  ownerPid=… alive=… ownerAlive=… watchArmed=…` 줄이 owner 사망·join 붕괴·체인 미도달을 가른다.

# 이 레인이 남긴 것 (승격 완료, 이 파일이 사라져도 남는다)

- 커밋 6개와 그 메시지 — 무엇을 왜 바꿨는지의 정본.
- 이슈 #101 댓글 — 은퇴한 문장(picker placeholder)과 그 영수증 포함.
- `scripts/raw-claude-session-switch/README.md` — S1–S6 훅 로그 verbatim, 세 반증 조건 판정,
  UPS native id 8/8 측정.
- `AGENTS.md` self-fetch 절 + `docs/adding-a-harness.md` claude 행 — ownerKind 스코프 규칙.
- #99로 넘길 재료: claude 훅에 처음 생긴 뮤턴트 lane(17 claim).
