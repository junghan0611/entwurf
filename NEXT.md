# NEXT — 0.31.0 main landing → prepare/make → prepublish

# RAIL — 현재 좌표

- [x] **1. Native contact 제품** — 첫 제품 `165338e`, scoped35·정상 hooks·push·exact-SHA CI 완료.
- [x] **2. Native admission** — 실제 Pi↔pi-durable LIVE36, 수정 oracle 독립검수, portable test8·단일 mutant 수동 실킬. 기존 release MUST에 연결.
- [ ] **3. Main landing** ← CURRENT: 이 reviewed candidate를 정상 commit·main ff·push하고 해당 최종 SHA의 exact-SHA CI 네 축/BODY를 수용한다. 이후 #129 종료.
- [ ] **4. 0.31.0 prepare/make** — 기존 FULL/LIVE/exact-SHA CI/보존 tarball/Docker/tag/GitHub release. **npm publish 직전에서 멈춘다.**

# NOW

- **다음 한 수:** 현재 native-admission 변경의 stage된 manifest HEAD(872mutants/69lanes)를 확인하고 정상 hooks로 commit → clean main fast-forward → 공용 range scan·ordinary push·도장 → exact-SHA CI. 이전 `165338e`의 GREEN을 새 SHA에 전용하지 않는다.
- **승인/범위:** branch push·검수/CI·main 통합/push·#129 종료·0.31.0 prepare/make는 승인됨. npm publish는 승인되지 않았다. 현 operator-provided pinned runtime 계약으로 cut하고, npm-only 설치 개선·Pi update/ACP/UI는 #130에 둔다. 새 installer/manager/queue/retry/credential proxy는 만들지 않는다.
- **팀:** a30dda 조율 / Opus b9ffcb 구현·검증 / Fable282bd0 독립검수. 개발은 이 Original checkout의 해당 branch만; fixture·보존 증거는 개발 authority가 아니다.
- **현재 version:** 0.30.1, 목표 0.31.0. pre-version main exact-SHA 수용 뒤에만 release skill prepare의 CHANGELOG/version/lock 변경을 시작한다. `.claude/skills/entwurf-release/SKILL.md`의 land → prepare → make 순서를 따른다.
- **보존:** 다른 운영 hosts/auth/settings/records/transcripts/live SQLite/Emacs/foreign processes. local build/pack 병렬 금지; 설치 runtime는 Pi1.0.2 source `cd32f77` + 고정 overlay. 기억 소스는 agent-config/andenken 소유.

# RECENT / RECEIPTS

- **첫 제품 CI:** [run37465871847](https://github.com/junghan0611/entwurf/actions/runs/37465871847), SHA `165338e74201d68b7e038b00ee05e3497b2d08a6`, event push; check/install-surface/artifact-consumer/macos-install-surface 및 qualification BODY 모두 success. `.tmp-verify/031-release/source-exact-ci-accepted.json`/raw log. source checkpoint 한정이다.
- **Native LIVE:** raw `.tmp-verify/b9ffcb-pack-cause/live-pd-20261006T223708/`; Opus ONE41s/36assertions/rc0. 조율자 readonly 재판정 `coordinator-live-raw-2.log` rc0: 실제 root model `openai-codex/gpt-6.1-sol`, contact6+native5/task-wide, 첫 callback, exact Pi row19 sender pd `ba0c08`, native v2 joined `control-socket → sent`, 해당 `b57c69.msg` root doorbell done. Fable 같은 raw/source에서 독립 확인.
- **검수·보완:** e029 patch에서 D1–D6 닫힘. D7 portable inline test8·run_vitest 좌표·foreign-sender guard mutant1은 대체 patch `829eee3797567ea51dc4e9fc0d20acea21545ac9c5f60453d5009f7faca45f70`로 닫았다. 조율자 9파일 SHA 및 delta MATCH; alias control=production bytes, mutant=manifest find/replace 정확히1개를 확인했다. focused mux gate316tests/type/Biome GREEN(구현자 receipt); control8/0, mutant7/1이고 유일 실패가 QK `PD-FRESH-LIVE-FOREIGN-SENDER-REFUSED`. **공식 runner qualification receipt는 아니며 final CI BODY가 소유한다.** Native LIVE 추가 재실행 없음.
- **이력 보존:** 첫 수신 predicate가 fixture 지시문을 고른 gap과 실제 pd 수신 row가 별도로 있음을 보존 raw에서 재현·재판정했다(`coordinator-reeval-raw.log`, NC1–7 GREEN). 최초35-GREEN을 수정된 gate의 acceptance로 소급 승격하지 않는다. parent RED857/870 및 retirement도 보존; 새 affected35와 합산하지 않는다.
- **범위 밖:** Fable O1–O4, timestamp·doorbell entry 강화, broad busy/nonroot/backlog/crash/continue/global exactly-once. 설치 개선은 #130. 이전 branch NEXT 원본은 `.tmp-verify/031-release/branch-next-before-admission.md`에 보존했다.

# READ / SAFETY

- `AGENTS.md`, `VERIFY.md`, `DELIVERY.md`, `docs/adding-a-harness.md`, `docs/durable-native-support.md`, release skill, #129/#130 live thread.
- local `.husky/_`는 global scan을 연결하지 않는다. 공용 `_scan.sh`를 명시 실행하고 정상 hooks 유지; unsafe override/no-verify/hooks 설정 변경 없음.
- main exact-SHA 수용 뒤 #129를 durable landing SHA와 decisive receipt로 닫는다. prepare/make의 필수 floors는 기존 SSOT대로 한 순서에서 실행하고, 별도 수동 BODY를 중복하지 않는다. version/tag/npm 공개 상태를 혼동하지 않는다.
