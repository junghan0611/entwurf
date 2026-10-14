# NEXT — #143 최소 튜닝 착륙과 실사용

# RAIL — 현재 좌표

- [x] **1. 0.36.1 출하 기준점** — `cab1b9f` / `v0.36.1`. 이전 cut의 수용 근거는 CHANGELOG와 #128에 둔다.
- [x] **2. #143 최소 구현** — transport 설정 전달, reference background compaction 0, 기존 대화 선택 `--resume`. SDK 엔진·모델·인증·저장은 그대로 둔다.
- [x] **3. 실제 재개·왕복 관찰** — GLG가 기존 코디를 picker로 열어 대화했고, 같은 garden id의 메시지 왕복을 확인했다. 의미 기억 품질이나 overload 개선의 증거는 아니다.
- [ ] **4. Main CI 수용** ← CURRENT: C 독립 리뷰/보정과 affected PARTIAL 81/81 완료. GLG 승인으로 main 착륙하며, FULL과 qualification BODY는 정확한 pushed SHA의 CI에서 확인한다.
- [ ] **5. 사용하며 판단** — 기억 품질은 실제 대화에서 관찰한다. 추가 튜닝·버전·릴리즈는 별도 지시 전 진행하지 않는다.

# NOW

- **다음 한 걸음:** #143의 최신 정리 댓글과 main 정확한 SHA의 CI를 확인한다. focused/PARTIAL을 FULL 또는 릴리즈 수용으로 승격하지 않는다. CI RED는 원인을 조사·수선하고, 미측정을 PASS라 쓰지 않는다.
- **정본:** [#143](https://github.com/junghan0611/entwurf/issues/143)의 본문은 목적, 뒤 댓글은 현재 범위와 근거다. A/B·C 영수증과 독립 리뷰는 `.tmp-verify/143-kickoff/`에 보존하며 결정적 결과는 이슈 댓글로 옮긴다.
- **실사용:** `entwurf pi-durable --resume [--native-module F | --native-module-dir D]`. 목록은 현재 cwd의 metadata만 읽으며 선택한 원대화를 SDK로 연다. 취소는 아무것도 열지 않고 끝난다. npm 0.36.1에는 이번 변경이 없으며 실행 중 프로세스는 재시작 전 carrier가 바뀌지 않는다.
- **기억 정책:** 에이전트가 의미 있는 결정·권한·인계 경계에서 필요에 따라 짧은 assistant 체크포인트를 남긴다. 결정/미결, 담당, 승인 경계, 근거 상태/출처, 다음 질문을 구분한다. 자동 기록기·후크·루프·기본 compact focus는 만들지 않는다. 요약 자체의 기억과 NEXT/이슈 재조회는 별개다.
- **범위 밖:** progress/thinking/subagent 튜닝, SDK 업그레이드, picker 고도화, 새 기억 엔진, vendor 비교. GLG는 추가 실험보다 사용하며 판단하기로 했다.

# RECENT

- 2026-10-14: GLG가 `--resume`으로 기존 코디 `20261008T113104-801621`을 직접 선택·재개하고 대화 응답을 관찰했다고 보고했다. 이어 sol의 v2 메시지 `2026-10-14T13-37-25-778Z-67f8aa.msg`가 enqueue됐고, 그 코디의 답장이 이 대화에 도착했다. 답장은 `entwurf_self` 13:37:32Z의 같은 id, `meta-session/pi-durable`, self-fetch/replyable을 보고했고 기존 #143 방향을 구분해 응답했다. picker 화면은 GLG 관찰, self/inbox는 코디 측 측정, 최종 답장 수신은 sol 측 관찰이다.
- C 독립 리뷰에서 새 stat 경로가 I/O 오류를 absence로 숨기는 Defect를 보정했다(ENOENT만 absence, 나머지는 전파). ELOOP fixture는 결함 아래 예기치 않게 열리는 citizen도 닫는다. 첫 PARTIAL은 80/81 WRONG-REASON으로 RED; cleanup 보정 뒤 같은 group 재실행은 81/81 KILLED, pre/post controls green, seal stable, exit0, 2293.9s. 원 RED도 보존했다.
- 최종 PARTIAL receipt 파일 SHA256 `654a95035c57680d2a75ccb6682ce7e99bfa3a2c29b805d7a699960b58dc2026`, 내부 digest `3f309466216cfdbbd41f2057a25a4b99fb3cfa90b438e750342ff130dfe005d5`. sol의 기존 checker 독립 실행으로 canonical digest/pass와 당시 HEAD·surface·core·spec set·81 claims·declared inputs·전체 manifest 일치를 확인했다. `/tmp/entwurf-143-partial-pi-durable-c2a-Qs8FxtHd/`에 보존. 이 기록 편집 전 sealed 후보의 한 group 측정이며 900 committed mutants는 미실행, composed FULL/전체 qualification 수용이 아니다. 착륙 SHA와 CI 결과는 #143 후속 댓글을 정본으로 삼는다.
- 0.36.1 npm 게시·registry 격리 설치 PASS와 #128 종료는 재개한 기존 코디의 이전 대화 기억에서 인계받은 상태이며 이 세션의 registry 재측정은 아니다. #128 CLOSED는 GitHub API로 확인했다. Herdr runtime-lock re-pin은 이 변경에 포함하지 않는다.

# GUARDRAILS / PARKED

- 로컬 `check-herdr-sandbox` 금지. GLG가 FULL은 CI/CD로 정했다. 로컬 whole qualification BODY 금지; 변경된 exact-argv PARTIAL만 실행한다. 최종 CI·installed/native LIVE·release는 별개 축이다.
- records/transcripts/DB/WAL/native modules/운영 설정 보존. 기존 프로세스를 자동 재시작하거나 저장소를 조작해 세션을 고르지 않는다. 실사용 승인과 vendor benchmark 승인을 혼동하지 않는다.
- #142는 대기. 전환 시 기존 담당 `20261014T115640-17d999`, `.tmp-verify/128-kickoff-037/COORDINATOR-142-REENTRY.md`를 읽는다.
- #128 뒤 native cells, #78, agent-config useful-extension 조사와 Herdr runtime-lock re-pin은 이번 #143와 별도다. 과거 cut의 경계는 CHANGELOG/#128에 남긴다.
- 커밋·main 푸시만 이번 승인이다. tag/GitHub release/npm publish/운영 설치/SDK 변경은 하지 않는다.
