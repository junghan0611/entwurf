# NEXT — fix/175-acp-vendor-compaction-lease

**정본:** https://github.com/junghan0611/entwurf/issues/175 (thread가 이 파일보다 우선한다). base는 main `6dcb0c6f`. merge 전에 이 파일을 지운다.

**GLG 관점 (2026-11-25):** Pi에서 compact하면 vendor 세션도 compact되어야 한다. 수동 compact는 비용 때문에 쓴다(캐시가 만료된 뒤 큰 context를 다시 읽지 않으려고). 자동 compaction이 1M 가까이에서 날 때와 수동 compact 둘 다 견뎌야 한다. 1M 근처 자동 compaction은 실측하지 않고 코드로 판단하며, 수동 compact는 실측한다. quit 뒤 남는 holder lease도 이 묶음에서 고친다. overflow 경로(C)도 이 이슈에서 함께 푼다. 0.63.0은 이 lane이 끝날 때까지 보류한다. "모든 형제가 정확한 정보로 다 동의할 수준까지" 간다.

**범위.** A = Pi compaction(수동, threshold) 뒤 같은 vendor 세션에 단독 `/compact` prelude를 보낸다(A1, GLG 결정 issuecomment-7152126006). B = quit 때 holder lease 해제(B1). C = ACP `max_tokens`가 Pi에서 recoverableLength로 판정되어 omit, overflow compaction, `changed` 정지로 세션이 끊기는 경로(issuecomment-7152518303).

**역할.** 실무코디 ff08d4(라우팅, writer 차례 관리). 운영코디 68bd94. A·B 구현 Claude Code Opus `20261125T121018-b4f4e3`. C 구현 Pi Astra `20261125T124619-b8c1c0`. 설계·코드 리뷰 Claude Code Sonnet `20261125T121028-d0ea26`. 대칭·사실 검증 Pi Sol `20261125T123927-0f3787`. checkout이 하나이므로 tree writer는 한 번에 하나다. 차례는 실무코디가 넘긴다.

**증거 위치(oracle).** `~/.local/share/entwurf-lab/175/`: `reviews/`(리뷰 메일 원문, 사실 원장 v2 `07-…`, 설계 v1·v2), `receipts-m1-m4.md`, `b1/`, `overflow-shape/`, `d3/`, `c/`.

# RAIL

- [x] **0. 착수.** 역할은 위와 같다.
- [x] **1. 측정 (M1–M4).** 수동 compact는 vendor를 줄이지 않는다(RED), 단독 `/compact`는 줄인다. lease 잔존 조건은 "quit 정리 동안 loop를 붙잡는 ref handle이 없음"이다. 사실 원장 v2에서 세 형제 모두 이의가 없었다.
- [ ] **2. B1 (lease).** 구현과 리뷰를 마쳤다(Sonnet, Sol). Claude·agy 긴 경로 quit 그룹 2→0을 재측정했다. 영향 PARTIAL(`check-acp-set-model-readback`)은 105/214 KILLED, 그 밖 0에서 중단했다(`175/partial/STOPPED.md`). A1과 C가 같은 group을 바꾸므로 7에서 최종 후보로 다시 돈다. B1 mutant 2개는 그 run에 도달하지 못했고, 지금 근거는 focused 수동 적용뿐이다. → B1 checkpoint 커밋 ← **NOW**
- [x] **3. A1 설계 확정.** v2.1(Sonnet, Sol 합의). D-3 측정(`175/d3/RESULT.md`, n=1 each): Claude 무frame end_turn 0/2, agy는 frame 없이 다음 턴에 0.58×. GLG D-3 결정은 대칭안 (α)다. `done`과 별도로 effect `confirmed | unconfirmed`를 두고, 상충 신호는 fail-closed다(issuecomment-7153167281).
- [ ] **4. A1 구현** (Opus) → 리뷰 → 수정 묶음 하나 → 커밋. 그 뒤 writer 차례를 Astra에게 넘긴다.
- [x] **5. C 설계.** 최종 결정 문서 `reviews/22`(C3: Pi의 length/omit/compaction은 그대로 두고, sealed length anchor의 정확한 null omission만 증명해 다음 실제 입력을 같은 vendor id로 보낸다)이고 경계는 바뀌지 않는다. 합성 feasibility GO(Claude, agy), TUI 실측. genuine: ACP `result.stopReason=max_tokens`는 두 rail 모두 미관측이다. Claude의 실제 소진은 RPC -32603 `max_output_tokens`에서 #171 unknown 경로로 가고, 제품 Pi 1회에서 다음 질문이 같은 id로 resume·회상됐다(`175/c/evidence-summary.md`).
- [ ] **6. C 구현** (Astra) → 리뷰 → 수정 묶음 → 커밋.
- [ ] **7. 인수.** 바뀐 lane의 PARTIAL, 동결 FULL, 제품 LIVE(Fable·sonnet·agy 수동 compact RED→GREEN과 회상, threshold 시뮬레이션은 "소비된 새 boundary마다 1회", 긴 경로 pi-smoke 15/15, C는 합성 대칭과 "genuine 미측정" 명시. B1 mutant 2개를 포함한다).
- [ ] **8. docs** (`docs/acp-backend-rail.md`의 compaction 절과 Claude/agy 열, CHANGELOG Unreleased, 0.63.0 노트의 skew 한 줄). BASELINE·VERIFY·acp-client-baseline은 늘리지 않는다. 그 다음 이 파일을 지우고 main에 merge, push, 그리고 main NEXT 13(prepare 0.63.0)으로 돌아간다. 형제 재시작 시점은 GLG에게 알린다.

# 기존 측정 도구

- `scripts/raw-acp-session-measure/`: `pi-smoke.mjs`(실제 Pi resident), `pi-compact.mjs`, `compact-resume.mjs`, `pi-quit.mjs`(0c0913c3: quit 전 PGID를 모아 lease와 무관하게 조회). 모델은 `ENTWURF_RAW_PI_MODEL`(`pi-host.mjs`)로 정한다.
- 수정 전 영수증: `~/.local/share/entwurf-lab/174/`, `175/m1`, `m2`, `m4`.

# 금지

push(GLG 사전 승인 범위 밖이면 묻는다), `--no-verify`, worktree와 tmp clone, 운영 profile·hook·`~/.gemini` 수정, 후보를 operator에 설치(#165), 형제 retire(GLG가 요청할 때만). PARTIAL은 격리된 snapshot repo에서 돌지만 작업 표면 해시를 전후로 단언하므로, 도는 동안에는 트리를 건드리지 않는다. 공유 checkout에 LIVE용 임시 mutant를 심을 때는 미리 실무코디에게 창을 알린다. 이미 답을 받은 입력을 replay해서 GREEN을 만들지 않는다.
