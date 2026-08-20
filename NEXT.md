# NEXT — #82는 Copilot **garden id 시민화**다. ACP가 아니다.

> NEXT는 disposable boot sector다. 완료 이력은 CHANGELOG/closed issues/git이 지고,
> 방향은 ROADMAP, 운영 규율은 AGENTS가 진다.

## 이 문서를 여는 사람이 먼저 읽을 것

2026-08-20에 이 레인을 한 번 잘못 겨눴다. Copilot을 세 번째 **ACP 백엔드**로 입학시키는
브랜치를 5커밋까지 만들었고, GLG 판단으로 전부 삭제했다. 되풀이하지 않도록 이유를 남긴다.

- **목표는 garden id다.** GLG가 #82에 직접 적었다(2026-08-20 15:37 KST):
  *"코파일럿 가든ID 지원되야 한다. 그러면 깃허브 쪽 담당하고 auto-mode를 잘쓰면 비용 절감하면서 협력 가능하다."*
- **ACP 백엔드는 그걸 주지 못한다.** `copilot --acp`는 호스트 **pi 시민**이 자식을 스폰해 한 턴을 도는 것이다.
  garden id는 pi의 것이고 **Copilot 형제는 생기지 않는다.** 다른 제품이다.
- **pi는 이미 Copilot을 지원한다.** provider `github-copilot`, 모델 28개. ROADMAP이 2026-08-01에 못박았다 —
  *pi가 공식 provider로 지원하는 것을 native/ACP로 중복 구현하지 않는다.* #56 Codex 레인을 그 이유로 닫았다.
  ACP 어댑터는 그 규칙을 정면으로 어긴 중복이었다.
- 이 작업은 **Copilot CLI의 능력을 품는 것**이다. 모델 레일이 아니라, 자기 세션·GitHub 연계·auto-mode를 가진
  하네스를 시민으로 들이는 것.

# RAIL — 현재 좌표

- [x] **1. 0.14.2 발행** — tag `v0.14.2`=`f7ac2d7`, npm `latest=0.14.2`, `repair=0.12.8-repair.1` 보존
- [x] **2. #82 축 오조준 → 폐기** — ACP 브랜치 5커밋 삭제. 패치는 `~/.local/share/entwurf-salvage/`에 보존
- [ ] **3. Copilot 시민화 첫 측정** ← CURRENT: 설치된 플러그인이 왜 시민을 못 만드는가
- [ ] **4. 0.14.3 스코프 확정** — 3의 결과가 정해준다. 지금 잡으면 또 틀린 축으로 잡는다
- [ ] **5. 별건으로 닫을 것** — cortex 게이트 슬라이스 수리 · 카디널리티 감사

현재 좌표: **main clean(`f7ac2d7`) · #82 재조준 완료 · 3 시작 대기** · OPEN 7

# NOW — 왜 copilot meta-record가 0인가

- **측정된 출발점:** meta-record 406건 = claude-code 311 · pi 90 · antigravity 5 · **copilot 0**.
  `~/.copilot/config.json`에 `entwurf-meta-receive`가 `enabled:true`로 **2026-08-19부터** 등록돼 있는데
  시민을 한 번도 못 만들었다. 설치는 됐고 작동은 안 한다.
- **Next (측정만, 어댑터 금지):**
  (1) Copilot의 훅 이벤트 어휘가 Claude Code의 것과 같은가. 플러그인은 `SessionStart` / `CwdChanged` /
  `UserPromptSubmit` / `FileChanged(asyncRewake)`를 선언한다 — Copilot이 이 이름들을 발화하는가.
  근거는 번들에 있다: `~/.cache/copilot/pkg/linux-arm64/1.0.80/schemas/api.schema.json`(341 메서드,
  `hooks.invoke`·`plugins.*`·`sessions.*` 포함), `copilot-sdk/docs/extensions.md`.
  (2) 훅이 돈다면 왜 레코드가 안 써지는가. 안 돈다면 Copilot의 등가 표면은 무엇인가.
  (3) `pi/entwurf-capabilities.json`에 copilot 백엔드 자체가 없다(claude-code/agy/codex/pi만). 이게 원인인지 결과인지.
- **Verify:** 시민 1건이 `meta-sessions/`에 생기고 `entwurf_peers`에 뜨는 것. 그 전까지는 전부 가설이다.
- **Blocker (permission):** LIVE Copilot 모델 턴 금지. 안 돌아오는 AI credit이다. 승인 사안.
- **Do not touch:**
  - **ACP 방향 재개** — `copilot --acp`, `copilotAdapter`, `AcpBackendAdapter`. 폐기됐다.
  - **`--ui-server` / loopback / `~/.copilot/run/ws.*`** — 거절 유지. 341 메서드 전부 `experimental`,
    `connect`의 토큰이 **optional**, `session.permissions.setAllowAll`이 문서상 attach-mode 클라이언트가
    **운영자 세션의 권한을 뒤집는** 용도다. 이 거절은 옳다. 다시 열지 마라.
  - **qualification 레인 필터 신설** — `check-gate-qualification.ts` 헤더가 이미 닫았다:
    *"No tiers … if the set ever outgrows its budget, re-open the fast/full split from the design record
    instead of silently skipping mutants."* 22분은 그 층의 가격이고, 개발 루프에서 그 층을 돌린 게 잘못이다.
    30–60초 루프는 이미 있다 — `pnpm run check`(39s) + 건드린 주제의 focused gate(0.3–5s).

# CARRIED — 이 레인 밖에서 닫을 것

- **cortex 게이트 슬라이스 수리.** `check-acp-carrier-augment.ts`가 cortex 선언부터 **EOF까지** 잘라 정규식을
  걸어서, 뒤에 오는 동일 본문이 cortex의 pin을 대신 만족시켰다 — 결함을 심어도 **게이트가 초록(SURVIVED)**.
  수리는 측정으로 확인됐다(심음 → exit 1 + QK 서명 → KILLED, 복원 → control 초록).
  패치: `~/.local/share/entwurf-salvage/0005-fix-gate-close-the-cortex-carrier-pin-at-the-next-ad.patch`.
  **main에 별 커밋으로 먼저 닫는다.** Copilot이 기각돼도 구멍은 닫혀 있어야 한다.
  단 `acp-cortex.json`의 `CORTEX-PROVIDER-SIX-ROW-SURFACE` → `ACP-PROVIDER-EXACT-ADAPTER-UNION` 개명은
  **같이 가져오지 않는다.** Copilot이 ACP가 아니면 여섯 행은 cortex 레인에서 여전히 참이다.
- **카디널리티 감사.** 백엔드 개수를 인코딩한 서술 **12개 문장 / 6개 파일 + claim id 1개**
  (`CORTEX-CURATED-FOUR-ROWS`가 SIX-ROW 개명의 생존자). 그중 **게이트가 지키는 것은 0개**.
  런타임 결합은 3점인데 서술은 12개 — *코드는 확장 가능한데 코드에 대한 이야기가 확장 불가능하다.*
  이게 "계속 고쳤는데 아직도"의 정체다. 별 이슈로 세운다.
- **`copilot --acp` 핸드셰이크는 측정으로 남긴다.** `protocolVersion 1`, `agentInfo{Copilot, 1.0.80}`,
  `loadSession:true`, `sessionCapabilities{close,list}`, `authMethods[copilot-login]`. 모델 턴 0회로 얻었다.
  레인이 아니라 사실이다. 언젠가 "pi 턴의 모델로 Copilot"이 필요해지면 그때 꺼낸다.
- **OPEN 7:** #72 ACP retained-child(사인 기록됨, 원인 미상) · #76 subscription-first kill-switch ·
  #78 portability · #80 vocabulary · #82 Copilot garden id · #83 close 대기 · #84 model-lock ledger.

# RECENT

- **2026-08-20:** #82 축을 잘못 겨눴다가 되돌렸다. 원인은 이슈 **본문만 읽고 스레드를 안 읽은 것** —
  GLG의 목표 진술이 코멘트에 두 시간 먼저 있었다. 그 위에 쓴 admission 문서가 `META_BACKENDS` 진입을
  하드 펜스로 금지해 **산출물 자체를 막았고**, 그 펜스가 형제 셋의 task spec으로 복사됐다.
- **2026-08-20:** 0.14.2 발행. 수락본=발행본 sha256 `09492ea6…3464`, CI run 32342695972 전부 success.
- **2026-08-20:** #83 판정 — model lock은 정상, 전환은 재시작으로 착지, 연속성은
  `buildAcpPrompt(ctx,"new")`가 pi Context 전체를 새 ACP 자식에 넘겨서 성립. 잔여는 #84.
