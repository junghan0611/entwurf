# NOW — native-harness rail 재설계 (Codex 구현 제외)

- **Branch:** `refactor/native-harness-rail`
- **Stem:** Claude Code에서 이미 증명된 시민 능력을 기준으로, 다른 native harness가 작고 예측 가능한 adapter로 들어오는 표준 레일을 다시 세운다.
- **Current:** 구조 checkpoint만 세웠다. `docs/native-harness-rail.md`가 support level, 다섯 seam, ownership, manual wiring, conformance, 1,500/2,000줄 stop을 고정한다. 미출하 Codex 구현·installer·doctor·게이트는 들어오지 않는다. 이전 시도는 repo 밖 bundle+patch로만 보존했다.
- **Next when resumed:** Claude Code·agy를 다섯 seam에 실제로 대입해 공통화 가능한 부분과 legacy install 부채를 수치로 판정한다. 그 전에는 production refactor를 열지 않는다.
- **Active priority elsewhere:** ACP Grok 지원이 더 급하다. 이 브랜치는 구조 checkpoint에서 멈추고, Grok은 `docs/acp-backend-rail.md`의 기존 adapter seam으로 별도 브랜치에서 진행한다.
- **Return condition:** Grok 축 뒤 GLG가 이 브랜치 재개를 지시하고, Claude/agy mapping review를 시작한다.
- **Blocker:** 없음. 의도적으로 pause한다.
- **Read:** `AGENTS.md`, `DELIVERY.md`, `pi-extensions/lib/meta-session.ts`, `pi-extensions/lib/native-push/{adapter,register}.ts`, `pi-extensions/meta-bridge-hook.ts`, `scripts/agy-imprint.ts`.
- **Do not touch:** release/version/CHANGELOG, main `NEXT.md`, commit/push, Codex 구현 복원, 새 managed installer, 외부 config의 exact inverse/preimage/drift 엔진.

# DESIGN DECISIONS — 이번 브랜치의 출발점

1. **확실한 native harness 기준은 Claude Code까지다.** pi는 host/control-socket adapter이고 Claude Code는 native reference citizen이다. agy는 이미 출하된 구현이지만 새 rail의 기준은 아니며, 이 설계에 대입해 유지·축소·격리 여부를 다시 판정한다.
2. **지원과 설치 자동화를 분리한다.** 시민 지원은 identity + liveness + delivery + sender evidence다. 외부 harness 설정을 entwurf가 쓰고 완전 복원하는 것은 지원의 필수조건이 아니다.
3. **Adapter, not installer.** 신규 harness는 공식 CLI가 제공하는 안정된 작은 연산이 없는 한 수동 wiring guide를 제공한다. arbitrary TOML/JSON 보존 편집기, uninstall transaction, exact inverse는 만들지 않는다.
4. **공통 계약은 backend 이름이 아니라 capability seam으로 나눈다.** self-fetch와 native-push의 차이는 보존하되 record/upsert, sender certification, ambiguity, dispatch receipt는 core가 한 번만 소유한다.
5. **검증은 rail에 집중한다.** 공통 invariant는 parameterized conformance suite 한 벌이 소유한다. backend gate는 native event/parser/protocol 차이만 검증한다. 같은 invariant를 backend별 대형 gate·mutant tree로 복제하지 않는다.
6. **크기 자체가 설계 신호다.** 신규 backend 전용 production+test가 2,000줄을 넘기기 전에 scope review를 멈춰 세운다. 초과분을 더 많은 gate로 정당화하지 않는다.
7. **불안정한 비공식 surface는 probe evidence로 남긴다.** lifecycle·address·delivery 중 하나라도 안정된 native 계약이 아니거나 예산 안에 adapter화되지 않으면 shipped citizen으로 승격하지 않는다. pi 안에서 같은 모델이 동작하는 것은 별개의 충분한 사용 경로다.

# ACCEPTANCE — 설계가 섰다고 말할 조건

- [ ] `docs/native-harness-rail.md`가 core ownership과 backend ownership을 표로 고정한다.
- [ ] Claude Code의 현재 구현이 새 계약의 reference mapping으로 설명된다.
- [ ] agy의 구현을 같은 mapping에 넣어 공통화 가능한 부분과 legacy install 부채를 수치로 드러낸다.
- [ ] 신규 backend 최소 conformance cells와 LIVE acceptance 한 축을 정의한다.
- [ ] manual wiring guide의 필수 항목과 read-only doctor 경계를 정의한다.
- [ ] Codex 없이 기존 `pnpm check` 기준이 유지됨을 확인한다.
- [ ] GLG가 설계를 승인한 뒤에만 production refactor 범위를 연다.

# RECENT

- **2026-08-01:** 미출하 Codex lane이 `origin/main..HEAD` 3 commits + staged 3,789줄까지 커진 뒤 중단됐다. 작업은 `/tmp/entwurf-codex-native-before-rail-reset-20260801T142350.{commits.bundle,staged.patch}`에 보존하고 branch를 `origin/main` 기준으로 다시 열었다. 삭제가 아니라 architecture reset의 증거 보존이다.
