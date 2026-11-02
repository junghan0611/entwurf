# NEXT — 0.50.0 개발자 전환 완료 → Oracle의 #155

# RAIL — 현재 좌표

- [x] **1. thinkpad main 동기화·개발자 설치.** `2917917` → `f45a95ad`; 공식 check/apply와 compiled carrier/SDK·CLI 검증 exit0/17초.
- [x] **2. 동일 대화 재시작.** 사용자가 재시작 완료를 알렸고, 2026-11-03 08:32 KST `entwurf_self`로 같은 garden/cwd와 replyable self-fetch를 직접 확인했다.
- [ ] **3. Oracle의 Pi1.5.0 대응.** ← CURRENT: 사용자 직접 지시에 따라 Oracle 코디가 이 인계를 pull하고 [#155](https://github.com/junghan0611/entwurf/issues/155)에서 오늘 작업을 개시한다. thinkpad는 개발·검수에 착수하지 않고 사용자의 업무를 우선한다.

# NOW

- **역할 경계:** Oracle 팀이 #155를 맡는다. thinkpad는 이번 설치 인계만 commit/push·전달하고 대기한다. 새 형제 생성·구현·추가 matrix·SDK 업그레이드·운영 재설치를 시작하지 않는다. Oracle의 후속 변경이 나와도 이 host를 자동 pull/build/restart하지 않는다.
- **현재 운영판:** checkout `f45a95ad`, Entwurf0.50.0, Pi SDK1.4.0. #155의 Pi1.5.0 준비와 별개다. 상류 core/npm·Herdr pin 경위는 `CHANGELOG.md`와 `git show f45a95ad:NEXT.md`에 남아 있다. 이번 노트북 설치를 출하 CI/Windows artifact/public-ref LIVE의 재측정이라고 쓰지 않는다.
- **직접 확인한 신원:** garden `20261007T132839-b22677`, native session `1791347319499-fb202da9-3971-46de-b378-4d8afad4cfde`, cwd `~/repos/gh/entwurf`. 재시작 뒤 self 신원 확인은 모든 participating reader의 byte/PID 검증이나 다른 host의 rollout 증명이 아니다.
- **Do not touch:** 모델/provider 변경, 기록·NativeDB·lock 수선/삭제, 타인 retirement, 광역 cleanup, 새 tag/npm publish. 사용자 업무 중에는 #155 지원을 임의로 재개하지 않는다.

# RECENT / 직접 측정한 설치 근거

- **준비 상태 오류와 복구:** 첫 공식 apply는 `ERR_PNPM_VERIFY_DEPS_BEFORE_RUN: The workspace structure has changed since last install`로 prepare-checkout에서 exit1. build/deactivate/wiring 전 중단했다. 사용자 named recovery 승인 뒤 `pnpm install --frozen-lockfile --ignore-scripts`가 exit0/609ms(Already up to date); lockfile·dependency upgrade 없이 준비 상태를 맞췄다. `pnpm_config_verify_deps_before_run=error`는 유지했다. 첫 실패를 성공으로 덮어쓰지 않았다.
- **공식 전환:** `plugins/herdr/use-dev-checkout.sh --check` → `--apply`와 후속 확인 exit0/17초. 기존 activation ledger 없음(no-op deactivate), checkout command links, Pi user/project ownership, Claude user-scope assembled plugin/MCP 갱신, enabled local Herdr0.50 link를 확인했다.
- **결정적 출력:** `pi-provider doctor: ok`; 실제 invocation과 direct MCP smoke 모두9 tools; `[use-dev-checkout] Herdr local checkout link verified`; explicit/actual Pi Entwurf model rows7개 일치; `[thinkpad-upgrade] durable carrier/SDK PASS; 22 resolved edges`(SDK1.4.0 set); package0.50.0; root/claude/team/remote-pair 정적 help PASS; `[thinkpad-upgrade] HEAD/source/index/status unchanged`; `finished exit=0`.
- **범위:** 설치 과정에서 모델 turn·새 세션·release FULL·SDK upgrade 없음. 설치 전후 source/index가 같음을 확인한 뒤 이 NEXT만 갱신했다. 재시작 완료는 사용자 보고, 동일 garden/cwd는 재시작 뒤 직접 self 응답이다.
- **thinkpad-local 원자료:** `~/.local/share/entwurf/receipts/thinkpad-main-upgrade-20261103T082155/`에 첫 exit1·이전 NEXT/patch/dist, `thinkpad-main-upgrade-20261103T082815-recovery/`에 승인·준비 설치 로그·`upgrade.sh`·`output.log`·`result.exit`(0)·`durable-runtime.json`·전후 snapshots/이전 dist를 보존했다. 이 경로는 다른 host에서 읽힌다고 가정하지 않고 결정적 출력을 위에 함께 실었다. 이 작업의 종료된 전용 tmux 두 개만 정리했고 다른 세션·기록은 건드리지 않았다.
