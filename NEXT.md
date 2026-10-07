# NEXT — #130 / 0.32.0 candidate → pre-version main landing

# RAIL — 현재 좌표

- [x] **1. 구현·리뷰** — Pi1.0.4 exact SDK9종/one npm carrier/explicit native module, reviewed checkpoints through b220b20.
- [x] **2. Frozen 후보바닥** — b220 source/FULL716s/body898/898/explicit packed install/required aggregate LIVE 수용. Versioned release acceptance 아님.
- [ ] **3. Main landing** ← CURRENT: GLG가 main 정리·정상 push·해당 SHA required CI/container 증거 확인 승인. `.tmp-verify/032-final/main-landing/`의 실제 영수증으로 판단.
- [ ] **4. Prepare → make → publish** ← PAUSED: 각 mode의 새 GLG 승인 필요. Package0.31.0 유지.

# NOW

- **Next:** main landing의 push/stamp와 exact-SHA oracle 결과를 확인한다. Four jobs(`check`, `install-surface`, `artifact-consumer`, `macos-install-surface`) 및 qualification BODY step success, Linux tarball digest/image identity를 원 CI log와 대조한다. 통과하면 prepare0.32.0 승인 대기; 버전·태그·출하를 자동 진행하지 않는다.
- **Scope:** branch NEXT는 원문·closure patch를 `main-landing/`에 보존한 뒤 merge 전 retire. Landing diff는 인계/상태 prose뿐이며 reviewed b220의 source/runtime/pins는 불변. r4 FULL/body/LIVE/pack-install은 반복하지 않는다. Push CI는 새 landing SHA의 독립 증거이며 r4 green을 승격하지 않는다.
- **Read:** [#130 live thread](https://github.com/junghan0611/entwurf/issues/130), `docs/durable-native-support.md`의 accepted-candidate 절, `AGENTS.md`, `VERIFY.md`, `.claude/skills/entwurf-release/SKILL.md` LAND. 완료 후 `main-landing/accepted.json`이 next authority가 아닌 결과 영수증이다.
- **Protect:** source/runtime/TUI/models/auth/queues/SQLite/transcripts/native recovery와 operator Emacs/foreign roots/0.31 archive/원RED는 건드리지 않는다. P9 census는 cleanup 권한 아님. 새 RED는 raw 보존·owning leaf 확인 후 STOP, blind replay/model fallback 없음. Opus/Grok 실행 grant는 소진, 임의 peer 재개 없음.
- **Downstream:** 실제 durable env-loader는 release 후 agent-config 소유; 이번 landing에서 구현하지 않는다. Host manifest 경고 D-A는 수용된 알려진 제약이며 전체 무해함 인증이 아니다.

# RECENT / EVIDENCE

- **R4 candidate:** [수용 원천](https://github.com/junghan0611/entwurf/issues/130#issuecomment-6043744944), frozen `b220b20c1b95f0ecafe8e679668bda3c5678be81`, acceptance `.tmp-verify/032-final/aggregate-r4-accepted.json` SHA256 `f16dcfa360f9e8b2cd34daa92152bb7ab064892d80e840ffe164bc435f23cf58`. FULL716s0/all898 IDs exactly once KILLED/controls178green/originpure/MUST25/0/0/BEHAVIOR1/0/0/cutOK. Separate installed raw6/6 +aggregate raw11/11 independently checked; official saved Codex65/PD36 snapshots rejudged read-only through owning oracles. Freeze closed after verdict. **FULL/aggregate ≠ pack-install/container.** Later prepared SHA/artifact/registry remains separate.
- **R3 integrity:** aggregate RED, FULL714s0. Protected36MB `/tmp/entwurf-qualify-DLx7qj` irreversibly deleted by retired ambient sweep; wider deletion extent and vendor-32603 cause unknown. Original raw/confirmation/review+erratum preserved. New prior-evidence regression is private-fixture proof; r4 actualtmp had no prior root, so no invented in-situ preservation claim.
- **0.31 immutable:** tag `a2c1aad0d89a33880d7b2f1ac43102d47a1ff207`, tarSHA256 `7a03bbe091a0ad9d2167fd6f1eb1fe2e7ff15402331c9f7f5d4042f429cf5c9f`, archive `/home/junghan/archives/entwurf/20261007T102356-v0.31.0/`. Postrelease docs pushed0450bd6 (`031-release/post-release/accepted.json`); registry download hashed equal and extracted-vs-installed580-file tree diff exit0 (`registry-byte-install-observed.json`). Those receipts retire main's earlier propagation404 lead, not certify1.0.4/native/current release. No re-publication or moved tag.
