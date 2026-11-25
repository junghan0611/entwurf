# NEXT — fix/175-acp-vendor-compaction-lease

**정본:** https://github.com/junghan0611/entwurf/issues/175 (thread가 이 파일보다 우선한다). base는 main `6dcb0c6f`. merge 전에 이 파일을 지운다.

**GLG 관점 (2026-11-25):** Pi에서 compact하면 vendor 세션도 compact되어야 한다. 수동 compact는 비용 때문에 쓴다(캐시가 만료된 뒤 큰 context를 다시 읽지 않으려고). 자동 compaction이 1M 가까이에서 날 때와 수동 compact 둘 다 견뎌야 한다. quit 뒤 남는 holder lease도 이 묶음에서 고친다. 0.63.0은 이 lane이 끝날 때까지 보류한다.

# RAIL

- [ ] **0. 착수.** Claude Code Opus 구현(단독 writer)과 Claude Code Sonnet 리뷰를 부른다. 실무코디는 ff08d4, 운영코디는 68bd94.
- [ ] **1. 측정 (#175 M1–M4).** 설계 전에 한다: Claude resume 세션의 `/compact`, Pi 자동 compaction 발동점, agy `/compact`, lease가 `0d8c22d9`에서 풀린 이유. 측정은 sandbox HOME에서 하고, 영수증은 `~/.local/share/entwurf-lab/175/`에 둔다.
- [ ] **2. 설계 결정.** 측정을 근거로 경계(Rule 9, #171 연속성) 안의 안을 고른다. 경계를 바꿔야 하면 GLG가 정한다.
- [ ] **3. 구현.** B(lease) 먼저, 그다음 A(compaction). 바뀐 계약마다 QK와 exact-once mutant를 둔다.
- [ ] **4. 리뷰** (Sonnet, 실무코디 경유) → 수정 묶음 하나.
- [ ] **5. 인수.** 영향 PARTIAL, 동결 FULL, 제품 LIVE(pi-smoke 15/15, 수동·자동 compaction 뒤 vendor `used` 감소, 수정 전 RED와 비교).
- [ ] **6. main merge, push,** 그리고 main NEXT 13(prepare 0.63.0)으로 돌아간다.

# 기존 측정 도구

- `scripts/raw-acp-session-measure/pi-smoke.mjs`: 실제 Pi resident. compaction은 `:54`, 모델은 `ENTWURF_RAW_PI_MODEL`(`pi-host.mjs:15-16`)로 정한다.
- 수정 전 RED/GREEN 영수증: `~/.local/share/entwurf-lab/174/{red-baseline,green,control-agy,control-sonnet}/`.

# 금지

push(GLG 사전 승인 범위 밖이면 묻는다), `--no-verify`, worktree와 tmp clone, 운영 profile·hook·`~/.gemini` 수정, 후보를 operator에 설치(#165), 형제 retire(GLG가 요청할 때만). PARTIAL이 도는 동안에는 이 checkout에서 Pi를 띄우지 않는다.
