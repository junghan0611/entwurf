# NEXT — feat/147-sibling-lifecycle

[#147](https://github.com/junghan0611/entwurf/issues/147), base/main `5e1b9f8`. This branch NEXT must be deleted before merge after evidence promotion; remove its link in main `NEXT.md` too.

# RAIL — 현재 좌표

- [x] **1. Birthday/visible return 기반.** L1 caller 노출·L2 Pi/CC 같은-id resume와 arm binding을 checkpoint했다.
- [x] **2. 내부 종료 기반.** Pi SDK 요청·CC pidfd helper·adapter·dispatcher와 문서를 checkpoint했고 `e9bf9f6` 정확-SHA CI 네 job이 green이다.
- [ ] **3. 요청 기반 공개 레일.** ← CURRENT: 미커밋 factory/core/append-only 기록/공개 contact 구현·교차 리뷰 뒤, 격리 compiled 소비자와 영향 PARTIAL을 마감한다.
- [ ] **4. Native 수용 → main → 출하.** ← PAUSED: 실제 test-owned Native 실행 범위와 G4 소비측 수선 승인, 기존 착륙/릴리즈 floor가 남았다. npm publication 금지.

현재 좌표: checkpoint2 완료 → 미커밋 구현3 검증 중 → 실제 형제 종료/Native 수용4는 아직 승인·측정하지 않았다.

# NOW

- **운영 정책(2026-10-22 GLG 직접, 뒤 논의에서도 현재 경계 유지 확인):** 실제 형제 퇴근은 GLG가 대상/작업을 명시해 요청했을 때만, 푸시 승인과 같은 별도 경계다. 개발·coordinator 역할·도구 노출·record-backed actor·앞선 릴리즈 판단 위임은 포괄 종료 승인이 아니다. 현재 실제 형제 종료 요청은 없다. 코드의 actor/self/freshness 검사는 grant가 아니다. shipped 설명은 일반 패키지이므로 `the human operator`로 쓴다. [명확화 기록6326464510](https://github.com/junghan0611/entwurf/issues/147#issuecomment-6326464510).
- **Next:** 정상 hooks로 검증된 composition 체크포인트를 만들고, 위임된 feature push→그 SHA의 네 필수 CI job을 확인한다. MF/compiled-contact oracle 독립 리뷰는 B0/D0로 마감됐고 head17352·영향 PARTIAL17452·최종 품질17509가 통과했다. Native/G4/main/release 수용으로 확대하지 않는다.
- **형제 역할 마감:** Opus1 driver를 코디가 검토·private TMPDIR만 보정해17300으로 실행했다. Astra의 core/factory32 MF·FD oracle·공유목록 리뷰와 Opus2의 public/compiled-contact/MF3 리뷰가 닫혔다. 문서의 현재 좌표·미구현 시제 D2는 수선했다. 추가 구현 없이 대기 중이며 이는 퇴근 요청이 아니다.
- **마지막 push/CI:** `e9bf9f6aaed573542fe8037061981b871b67b156`, push run [39633755175](https://github.com/junghan0611/entwurf/actions/runs/39633755175), 네 필수 job success(task16654). docs `575c897` 포함. 현재 미커밋 구현은 이 CI에 들어 있지 않다.
- **현재 코드:** core `fb89ad67…`/test `1dbbc466…`; factory r4 `550936b0…`/test `e9f63749…`; writer `bbaabb58…`/test r3 `4e1de877…`; public index `dd48b1b1…`, durable `9adc37ae…`/test `ecb9f7da…`. full hashes/raw receipts는 아래 읽을 곳. source MCP9/Pi7+hidden2/durable8이며 현재 운영 코디의 실제 callable 갱신 증거는 아니다.
- **측정 수준:** task17040은128PASS/1skip·네 type fence PASS였고, 후속 호칭/privacy/공유목록/FD oracle 변경은 아래17509에서 최종 재검증했다. **producer17177**은 private node_modules 경로로 emit rc0, operator dist 전후 전체 hash 불변. **consumer17300**은 실제 compiled MCP/contact→factory/core→inert Node RPC1회→requested/outcome2줄 등 **29/29 단언 PASS**, 자체 handle cleanup와 private compiled/operator dist hash 불변을 확인했다. 증거 root `/tmp/entwurf-147-consumer-proof-4IFdtG`, 원본 `compiled-r0/consumer.log`. 익명/self/unsupported Codex 거절과 CC unbound 거절도 포함한다. 실제 Pi/CC/모델/형제 종료는0이며 Native lifecycle/출하 증거가 아니다. **17452 영향 PARTIAL은 동일 후보 workSurface204d4b4a…에서32+16+44=92KILLED**, controls pre/post green·seal stable. 코디가 receipt/core digest와 현재 선언/Core78파일 hash를 직접 대조했다. **17509**는 최종 scoped format·네 type fence·source bridge boot21checks를 통과했다. 그 전17483의 JSON formatter RED는 값 불변을 대조한 포맷만 수선했고, Native/FULL 미측정은 그대로다.
- **로컬 RED 보존:** task16981은120PASS/2RED였다. source boot는 Pi adapter가 실재하지 않는 `entwurf-control-rpc.js`를 VALUE import한 것이 원인(private stderr 재현). 코디가 `.ts`와 root exclude/수신 scripts+mcp lib fence로 수선했고 Opus2 정적 확인+17040 source tools/list로 닫았다. 다른1개는 **옛 ambient compiled bridge에 새 tool이 없어 schema가 거절한 compiled resume case**다. 17040에서 명시 skip했으며 통과로 처리하지 않는다. 새 private compiled 소비자 증거와 최종 exact-SHA CI가 필요하다. 운영 dist를 빌드해 숨기지 않는다.
- **기록 계약:** #106 B는 유지한다. `meta-sessions`의 sibling `meta-retirements/<targetGid>.jsonl`, actor/target 명시·requested/outcome paired ID, absence=unknown. identity/liveness/permission reader가 아니다. 새 env knob·host 추측·message·PID/nativeSID·approval token 없음. 요청 append 실패는 adapter0, 결과 append 실패는 action을 덮지 않으며 release도 별도다. 현재 source/fake 구현이지 운영/출하 수용이 아니다.
- **G4 권한 blocker:** agent-config owner `20261008T084123-6f5c09`는 최소 source+synthetic 수선 승인 대기라고06:23 답신했다. 코디도06:24 `skills/entwurf-peek/scripts/entwurf-peek.py:1106–1144`에서 attachIncarnation 없는 strict9key/stray 거절을 직접 재확인했다(실제 mirror 실행은 아님). GLG에게 이 외부 최소 수선만 별도 승인 질문을 남겼고 답은 아직 없다(동일 승인 질문을 DM645로1회 전달). 이전119checks는 다른 기능이라 상속하지 않는다. 외부 edit/install/restart/commit/push0. Entwurf의 잔여 Codex/Copilot/OMP reader rollout도 미완이다.

## Read / receipts

- 이슈 본문보다 최신 thread 우선: [6320579633](https://github.com/junghan0611/entwurf/issues/147#issuecomment-6320579633), [6321075009](https://github.com/junghan0611/entwurf/issues/147#issuecomment-6321075009), B review6326288114, operator rule6326464510. 아직 이 미커밋 batch 완료 보고를 게시하지 않았다.
- `.tmp-verify/147-public/{operator-request-contract,retirement-event-contract,core-record-join-proposal}.md`: 결정/원계약/제안을 분리한 원문.
- `.tmp-verify/147-factory-preserved/{factory-r1-report.md,r2-*,r3/report.md,r4/report.md}`. 원본ce74는 `production-ce74a546.ts`에 byte-copy 보존.
- `.tmp-verify/147-public/{astra-public-registration-r1,opus2-public-registration-review-r0}.md`, `leaf-r{1,2,3}/`, `coor-r{0,1}/` 원로그/해시. private producer는 `compiled-r0/{root,package}.txt`, input/operator-dist before/after와emit.log.
- formal MF: core10+22=32, writer15+FD1=16, pi-durable86+새contact3=89. inventory32/16/89 갱신 완료. core deferred 변이는 mutant-only containment 후 독립 B0/D0로 닫혔다. 새 PDC compiled-contact named test와 기존 compiled-resume test는17452의 새 compiled owned-fixture control에서 green이었다. ambient old dist 자체를 수선/재실행해 통과시킨 것은 아니다. qualifier BODY를 실행하지 않는다. 각 exact argv 영향 PARTIAL은 독립 리뷰·수선 뒤 한 번만.
- checkpoint 순서: `11869b8` → `0771eac` → `9d47f1b` → `ba137119` → `1bc1c6d` → `575c897` → `e9bf9f6`. 이전 상세 NEXT는 git575c897와 `.tmp-verify/147-public/NEXT-before-0651.md`, source/proof completion은 `.tmp-verify/147-g3/`에 보존. 과거 후보 PARTIAL들을 합쳐 새 후보/출하 kill-power라고 하지 않는다.

# GUARDRAILS

- 모든 pnpm·hook에 `pnpm_config_verify_deps_before_run=error`. 실패하면 중단; install/repair/direct-binary 우회0. B의 container direct-vitest55는 정식 floor에 상속하지 않는다.
- local FULL/qualification BODY/Herdr build·sandbox/운영 dist build·설치/SSH A/새 provider 모델 호출 금지. 테스트용이라도 실제 Native 새 launch·퇴근·resume는 현재 범위 밖이다. owned Node/metadata/compiled proof fixture만 허용 범위 안에서 사용한다. main·prepare/make의 기존 floor는 면제되지 않는다.
- 실제 작업 형제를 종료하지 않는다. request ACK≠process exit/flush/model silence; CC fd exit≠conversation/children/flush. unknown/취소/기록 오류는 자동 retry 권한이 아니다.
- V3 attachIncarnation: 부재=null, 존재하면null 또는정확32 lowercasehex, emit항상. garden/native identity/createdAt 보존. arm witness는 identity/grant/liveness가 아니다. 알려진 key drift는 reader roll-forward이며 healthy identity의 fresh-cut/삭제/수동 rewrite/옛 shape rollback 금지.
- 원 factory 작성 중단은 Opus1 classifier 자기보고(별도 이벤트 로그 없음)로 보존한다. 이후 **같은 하네스의 새 metadata fake-only 범위**에서 정상 guard7PASS→현재 core/factory fake 검증으로 진행했다. 차단된 미제공 본문을 재구성·다른 하네스로 이관하지 않았다. 향후 새 거절도 우회하지 않는다.
- 이전 pack/prepack이 운영 dist를3회 쓴 사건은 `.tmp-verify/147-g3/coor-pack-boundary.md`에 남겼다. 이후 private proof로 과거를 지우거나 운영/build0 전체 주장하지 않는다.
- `.agent-reports/.envrc`/새 루트 `.envrc`, 모델 DB·record·transcript·memory 색인은 손대지 않는다. ignored evidence/원본 로그/형제 프로세스 보존; 넓은 cleanup0.
- 정상 scanner/hooks, exact staging만. push/CI/tag/GitHub Release 판단은 #147 범위에서 위임됐으나 각 gate를 만족해야 한다. npm publish는 금지다. branch NEXT의 삭제/주요 미완 조건 승격 없이 main에 합치지 않는다.
