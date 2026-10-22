# NEXT — 0.41.0 prepare → #148 pi 1.4.0

[#147](https://github.com/junghan0611/entwurf/issues/147)의 thread가 최종 SHA/CI/main 착륙 상태의 원장이다. #147은 `5db7423`으로 main에 착륙했다([landing](https://github.com/junghan0611/entwurf/issues/147#issuecomment-6330093797)). 소스·bounded Native 관측·운영 reader 반영을 출하와 혼동하지 않는다. 0.41.0 tag/release/npm publication은 아직 없다.

# RAIL — 현재 좌표

- [x] **1. core/Herdr 0.40.0 출하 기준.** core `v0.40.0=1f7020a`, accepted tarball sha256 `4a6906ac…fa55`; Herdr snapshot `v2026.10.20-herdr.0.40.0=036e268`, non-Latest. #107의 출하·registry byte 일치 기록을 보존한다.
- [x] **2. #107 첫 원격 한 쌍 마감.** [종료 결정](https://github.com/junghan0611/entwurf/issues/107#issuecomment-6305817042). 기억 색인 증분은 별도 운영 유보다.
- [x] **3. #147 요청 기반 출퇴근 구현·bounded 검증.** 공개 target-only retire/production binding/paired attribution, Pi·CC same-id return, source9/Pi7+hidden2/durable8. [Native n=1와 G4 범위](./BASELINE.md#147-native-round-trip-2026-10-22-n1), [공개 checkpoint](https://github.com/junghan0611/entwurf/issues/147#issuecomment-6329217980).
- [x] **4. #147 main 착륙.** `5db7423`, main push CI39702141189 필수 4 job green.
- [ ] **5. 0.41.0 출하.** ← CURRENT: prepare 완료(release-prep commit, CHANGELOG `0.41.0 - 2026-10-22`). local `check:full` PASS와 `release-gate --cut` MUST 24/0/0·BEHAVIOR 1/0은 c318f30+release-prep 후보의 증거다. 남은 것: GLG의 make 권한(`/entwurf-release make 0.41.0`) → ordinary push와 그 SHA의 필수 CI 4 job → carrier-bearing이라 native-Windows preview workflow의 보존 candidate → VERIFY 4(installed `doctor-meta-bridge` 새 Claude 세션)·7(agy)·8(Codex caller-seat) → tag·GitHub Release. publish와 Herdr 재pin은 각각 별도 권한이다. 출하 완료 전 agent-config 알림0.
- [ ] **6. #148 pi 1.4.0 반영·안정화.** Opus2의 선행 검토가 별도 이슈에 있다. #147 diff에 SDK/catalog/DB 업그레이드를 섞지 않는다.

# NOW

- **Next:** GLG에게 make 권한을 묻는다. 그 뒤 [#148](https://github.com/junghan0611/entwurf/issues/148)로 복귀한다.
- **prepare 관측(보존):** `smoke-entwurf-chain-live` world `/tmp/entwurf-chain-vx90gR`(92K, records/mailbox/hook 증거)가 PASS 뒤에도 남았다 — `finally`가 children만 끝내고 world를 지우지 않는다(`smoke-entwurf-chain-live.ts:474–483`). gate 소유 증거/잔여로 보존하며 의도는 미확정, cleanup 추가0. 같은 gate의 hop2 기본값 `openai-codex/gpt-5.6-luna`는 MODELS curated 목록과 어긋난다(Observation, 동결 후 gate 수정0).
- **팀 책갈피:** 실제 명부는 루트 `team.json`(gitignored), 공개 예시는 `team.json.example`(가짜 ID). 모두 형제이고 `role`은 `coordinating sibling`/`sibling` 호칭일 뿐 임무·권한이 아니다. record가 이기며 생존은 `entwurf peer-facts`로 재관측한다. 런타임 reader나 실행 명령은 없다.
- **#147 범위:** 실제 새 pi-durable caller가 Pi·native CC를 각1회 퇴근/같은-ID 복귀시켰고 독립 관측과 blind recall을 확인했다. source `a9c9459`의 n=1이지 후속 SHA의 전체 Native/release 수용이나 ACP/Herdr/Windows/flush/descendant 증거가 아니다. 기본 Pi/pi-durable1.3.0에는 내장 per-call 승인 프롬프트가 없으며, 명시적 operator target/action 요청과 agent policy가 필요하다. host 승인 단계는 제공/설정된 곳에서 추가로 적용된다.
- **Copilot 명시 유보(2026-10-22 GLG):** 구독이 아닌 무료 `auto`, 인사 응답도 1분 이상이라는 GLG 관측상 실검증 불가. 이번 착륙의 Copilot Native 검증은 명시 보류한다. doctor의 10/14 historical runtime RED는 남기고 PASS로 바꾸지 않는다. 5개 on-disk reader의 현재 byte/소유권 반영과 이 runtime 유보를 분리한다. resident 재적재는 미측정, 일반 release floor 면제 아님.
- **외부 mirror:** agent-config local parser `a5a075be`와 안내 수선 `e007e01`, source/test 및 bounded precheck 문서 독립 검수·163/0, installed owning certification1847accepted/0defect/새3target수용. push는 하지 않았다. 신규 필드 delta 수용이지 전체 Python/TS parser 동등성 주장은 아니다.
- **문서·proof:** source8 독립 B0/D0, 문서13 두 관점2차 B0/D0. 마지막 coor 보정은 README의 종료 보장처럼 읽히는 표현을 guarded attempt로 바꾸고 load 표에 agy를 추가했다. source 집중99checks/네 type fence green. 최신 두 영향 PARTIAL17+44=61KILLED는 자기 후보 `80a4f8a7…`의 영수증이며 이전109와 누적해 새 SHA kill-power라 하지 않는다.
- **운영 유보:** 기억 replica 최신화는 index authority가 돌아온 뒤 별도 합의로 진행한다. 노트북A OFF: SSH/메시지/프로브/동기화0. 이번에 memory/model DB를 갱신하지 않았다.

# GUARDRAILS

- npm publish/dist-tag 변경 금지. main 착륙·tag·GitHub Release는 각각 필요한 gate와 GLG 지시를 따른다. 이번 main 목표를 release 허가·pi1.4 구현 허가로 확대하지 않는다.
- 0.41.0 prepare에 한해 로컬 FULL과 필수 LIVE `release-gate --cut`이 허가됐다. whole qualification BODY/별도 Herdr build·sandbox/노트북 전환은 여전히0이며 BODY는 필수 release 축이 아니다(#144).
- 모든 pnpm/commit/push hook에 `pnpm_config_verify_deps_before_run=error`. deps 오류면 install/repair/direct-binary 우회 없이 중단. 정상 scanner/hooks/exact staging, unsafe override/force push0.
- 작업 형제의 자율 종료/자동 retry/hidden fallback0. 승인된 test-owned 왕복과 GLG가 지명한 10:13·10:34 퇴근은 끝났고 추가 cleanup 권한으로 남지 않는다. ACK/exit/flush/recall은 별개다.
- record/native identity/createdAt/전사/모델 DB/색인/원본 증거·후보·사본 보존. attachIncarnation은 witness이지 identity/liveness/grant가 아니다. 알려진 reader drift는 rollforward, healthy identity freshcut/삭제/수동rewrite0.
- `.agent-reports/.envrc` 보존(루트 `.envrc`는 GLG가 옮겨 없으며 재생성하지 않는다). 넓은 /tmp 청소/프로세스 sweeper/자동 whole-floor rerun0. host scratch 정리가 필요하면 해당 gate의 재생성 산출물만 소유권을 증명해 수동으로 처리한다.
