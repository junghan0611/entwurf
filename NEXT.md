# NEXT — v0.12.8 수선 컷

> NEXT는 부트 섹터다. 닫힌 역사는 CHANGELOG/git에, 장기 방향은 ROADMAP/이슈에 둔다.

## NOW — 0.12.8은 수선 컷이다. 범위 SSOT는 **#49**

- **Stem:** 0.12.7 출하 하루 만에 **런타임 축이 우리 밑에서 움직였다.** 전역 pi는 이미 `0.80.6`, 리포 pin은 `0.80.3`. 그 격차가 CI RED · `pit` 경고 · "게이트가 검증하는 런타임이 게이트가 선언한 런타임이 아님" 세 형태로 동시에 터졌다. 0.12.8은 새 능력을 더하지 않고 **바닥이 선언대로인지**만 맞춘다. `0.13.0`은 계속 cortex(#48).
- **범위·근거·기각된 선택지는 전부 #49에 있다.** 여기엔 다음 한 걸음만 둔다.

### 실행 순서 — A → B → C → E

워킹트리에 **미커밋 두 덩어리**가 있다 (floor-purity 초안 / CI fix). 같은 파일을 만지므로 순서를 지킨다.

1. **A — CI fix.** `check-pack-install`이 host PATH 대신 install-smoke 트리의 pinned pi를 쓴다.
   - 코드 완료. **전역 pi 없는 PATH로 CI 조건 재현 → EXIT=0, 전 항목 green.**
   - 남은 것: `"$pi_bin" --version`이 기대 pin과 같은지 **assert** (이번 수선의 핵심이 "무슨 pi를 검증했는가"다) → 커밋 → GitHub CI green 확인.
2. **B — pi `0.80.3 → 0.80.6`.** entwurf가 소비하는 모델 타입에 breaking change 없음(확인됨). 파일 목록은 #49. `check-dep-versions`가 pin 정합성을 강제하므로 한 곳만 올리면 RED.
   - **게이트만이 답할 것:** 0.80.4가 `package-manager`/`settings-manager`/`resource-loader`를 전부 고쳤다. install surface 영향은 타입으로 알 수 없고 `check-pack-install`이 유일한 장치다.
3. **C — fresh mint와 strict resume 분리.** pi는 건드리지 않는다. 외부 주소·plan·marker·socket의 권위는 계속 gid이고, v2 rail 내부 handoff만 고친다.
   - parent가 이미 찾은 authoritative `sessionFile`을 버리고 child에게 `--session-id <gid>`로 두 번째 lookup을 시키는 것이 버그다. parent의 고정 `SESSIONS_BASE`와 child의 `sessionDir` 해석이 달라지는 실제 반례에서 같은-gid 빈 세션/socket이 생겨 false-success할 수 있었다.
   - v2-control child는 exact `--session <absolute-file>`을 사용한다. 실제 pi v0.80.6 + entwurf-control 무토큰 RPC에서 header gid 기반 socket·`get_info`가 유지됨을 확인했다. 상세 액션/게이트는 **#49 §C**.
   - fresh launcher는 계속 `--session-id "$(run.sh new-session-id)"`; 경고는 **수용 + README 계약 문장 갱신**. launcher pre-create는 반쪽 세션·불변식 파괴로 기각.
4. **E — floor purity.** 설계 SSOT는 **#41의 두 코멘트**(본 설계 + 실기기 보정). 현재 미커밋 초안은 관측면이 좁아 **재작성**한다.
   - 첫 전체 floor 실행은 green이 목표가 아니다. **churn 카탈로그를 뽑는 관측 실행**이고, RED는 데이터다.

### 후속 (0.12.8 밖) — #49 참조

**D** thinking/effort wire (map 단독 반영 금지) · **F** #41에 "게이트가 호스트에서 **읽는** 것" 축 추가 · **G** `modelOverrides` × curated invariant 정책.

## RECENT

- **[2026-07-14] 0.12.7 released.** #46 agy/Antigravity를 garden citizen으로 출하. 상세는 CHANGELOG `## 0.12.7`. **단, 릴리즈 커밋의 CI가 RED다** — #49 A가 그 수선이다.
- **[2026-07-14] #41에 floor purity 설계를 고정.** #41의 분류 작업은 계측기가 선 뒤에 결합한다: fence → containment → resolver 통합 → **#41 분류** → 미연결 스크립트 삭제.
- **[2026-07-13] evidence boundary:** 동일 agy pid에서 여러 conversation이 동시에 model invocation을 수행하면 단일 marker가 last-writer로 덮인다. 현재 agy의 process-per-session·직렬 invocation에 기대며, 같은 pid 동시성은 지원하지 않는다.
- **수동 항목:** `smoke-meta-async-drift`는 외부 바이너리 pin에 의존해 CI에 못 넣는다. 컷 체크리스트의 수동 항목 (2026-07-14 green: claude 2.1.208 / codex 0.144.1 / agy 1.1.2).

## AFTER 0.12.8

1. **#47 mux launch rail — 계속 0.12.x.** 착수 전 `docs/mux-launch-rail.md`를 읽는다.
2. **#48 cortex — 0.13.0.** PR #40은 PARK. mux 기반과 backend adapter 검증이 선 뒤에만 연다.
3. **Meta sender 모델 표기 — 비차단.** `agentId=meta-session/<backend>`는 `AGENTS.md` 계약대로 정상이다. 모델 표시는 agentId를 바꾸지 말고 optional display field로 별도 설계한다.
