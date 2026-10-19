# NEXT — #107 remote pair (branch lane; main merge 전에 삭제)

기존 durable 형제 둘(notebook A, server B)이 운영자가 놓은 SSH 다리로 서로에게 한 번 보내고 한 번 답하게 한다. 닿는 길만 만들고 서로를 관리하지 않는다. 주소 권위는 record이고, 원격 요청은 그 record를 가진 호스트가 직접 검증한다. 공개 SSOT는 [#107](https://github.com/junghan0611/entwurf/issues/107) thread다(thread가 body보다 우선).

# RAIL — 현재 좌표

- [x] **1. 수신 leaf** — `a7aaac7`. B의 receive 진입점은 선언된 pair 밖의 `from`/`target`을 mailbox 변경 전에 거절하고, 맞으면 기존 v2 dispatch에 넘긴다.
- [x] **2. 송신/표시** — `3afbfb6`. 선언된 route가 우선하고, 로컬 흔적과 충돌하면 거절한다(ssh 0회). SSH는 1회만 쓰고 결과는 B receipt / B named reject / `remote-indeterminate` 셋뿐이다. 재시도는 없다. 수신 표시는 remote origin, sender-host cwd, `replyable=false`다.
- [x] **3. 설치 증거** — `d0cd075`. receive 진입점과 lib이 compiled JS로 emit되어 tarball 필수 목록에 들어갔다. installed gate와 audit lane을 추가했다.
- [x] **4. branch 인계** — `e632294`(문서만 바뀜) push. exact-SHA CI run 39202248407은 네 job 모두 success다. 양쪽 호스트가 이 branch에 있다.
- [x] **5. 첫 실왕복** — 2026-10-20. B→A→B nonce가 1회 돌아왔다. 기록은 [#107 6278665895](https://github.com/junghan0611/entwurf/issues/107#issuecomment-6278665895)에 있다.
- [ ] **6. owner 문서·최종 review·landing 준비** ← CURRENT: README·DELIVERY·VERIFY·BASELINE·setup 문서를 고친다(미commit). 그다음 Opus2 scoped review, amendment 1회 순서다.
- [ ] **7. main merge·push·release** ← PAUSED: GLG의 landing 결정을 기다린다. merge 전에 이 NEXT를 삭제한다.

현재 좌표: 1–5 완료 → 6 문서·review → 7 landing 결정 대기.

# NOW

- branch `feat/107-remote-pair`, main base `62569f5`. code checkpoint는 `d0cd075`(R3)이고, 첫 실왕복은 `e632294`에서 했다. 그 뒤 commit은 문서뿐이다. 현재 HEAD·CI 상태는 이 문서가 아니라 `git log`, remote branch head, 그 SHA의 CI run, #107 thread에서 읽는다.
- **다음 한 걸음:** R6 문서 diff에 대해 Opus2 scoped review를 받고 amendment를 1회 한다. 그다음 landing 경계를 GLG에게 묻는다. merge 후보 SHA에는 그 SHA의 exact-SHA CI가 새로 필요하다. 이전 SHA의 CI나 LIVE는 이월하지 않는다.
- 이 단계에는 SSH, 모델 메시지, operator 파일 변경, build, install, restart가 없다. 양쪽 pair 파일은 선언된 채 idle 상태로 둔다.

## notebook에서 이 branch 받기 (사람이나 그 호스트의 로컬 agent가 실행; 다른 호스트에서 원격으로 실행하지 않는다)

checkout 위치가 다르면 사람이 `cd` 줄만 고친다.

```bash
(
  set -eu
  cd "$HOME/repos/gh/entwurf"
  if [ -n "$(git status --porcelain)" ]; then
    git status --short --branch
    printf '%s\n' 'dirty worktree: 멈추고 GLG에게 확인' >&2
    exit 1
  fi
  git fetch origin
  if git show-ref --verify --quiet refs/heads/feat/107-remote-pair; then
    git switch feat/107-remote-pair
    git pull --ff-only origin feat/107-remote-pair
  else
    git switch --track origin/feat/107-remote-pair
  fi
  git log -1 --oneline
)
```

- main에 pull하지 않는다. dirty worktree를 덮어쓰지 않는다. reset·clean·stash를 하지 않는다.
- 이것은 소스 전송일 뿐이다. 모델·세션 start, bridge reload, 설치가 아니다. 디스크에 받은 소스는 실행 중인 bridge의 bytes가 되지 않는다. 실행에 반영하는 절차는 `docs/setup-clean-host.md` "Applying new source to a running host"에 있다.
- A에서 맡을 역할은 사람이 정한다. server 쪽 writer와 같은 구현을 중복하지 않는다. 기존 역할(조율자 `20261014T212756-68bd94`, writer Opus1, reviewer Opus2)은 필요할 때 연락하는 주소일 뿐 위계가 아니다.

## 붙여 넣는 재개 프롬프트 (2줄)

```text
entwurf checkout의 NEXT--feat_107-remote-pair.md와 git state(branch, HEAD, status, origin 대비)를 읽고, 지금 RAIL 위치와 다음 한 걸음을 보고해 줘.
다른 형제의 모델 턴을 유발하는 메시지·SSH·probe·operator 파일/설치/재시작은 하지 말고, 이미 측정한 PARTIAL을 중복 실행하지 마. 남은 FULL/정규 pack은 해당 SHA CI 결과로 확인한다. raw transcript·DB는 필요 없다.
```

# 첫 실왕복 경과 (2026-10-20, 역사 기록)

- server B에 최소 bridge build를 했다. 결과는 tarball `023cc6e64ed3`의 dist와 87/87 byte-identical이다. 사용자가 B의 visible 세션을 다시 열었고, 같은 gid가 유지됐다.
- 양쪽에 private pair 파일을 만들었다. 덮어쓰기 없이 새로 만들었고(0600), 각 호스트 코드가 계산한 canonical 경로이며, parser로만 검증했다.
- readiness 확인에서 notebook A가 쓰는 compiled bridge가 승인 bytes가 아니었다(pull과 setup PASS 뒤에도 이전 build). 그래서 **HOLD**했고 원인은 추적하지 않았다. 사용자가 A를 최소 build하고 A·B visible 세션을 다시 열었다. 이후 해시, build 뒤 bridge 시작, record·owner·sender 조인이 양쪽에서 일치했다.
- B의 native `entwurf_v2`를 1회 보냈다: remote 수락과 enqueue. A의 회신도 1회였다: nonce가 일치하고 B가 inbox를 읽었다. A는 B가 읽었는지 모른다. 의도된 경계다(세 번째 ACK와 원격 읽음 추적 없음).
- 측정하지 않은 것: GUI 렌더링, SSH가 known_hosts에 준 부작용, OFF·부정·lifecycle 셀.

# 이전 관측 — source / runtime 분리 (2026-10-19T04:41Z 읽기 전용, 역사 기록)

- **notebook A:** checkout은 `62569f5` main이다. remote 송신 코드가 아직 없다.
- **server B:** source checkout은 `d0cd075`(clone mode, `entwurf` → checkout `run.sh`)다. clone-mode `run_ts` 계약에 따라, 앞으로 receive가 호출되면 source TS(`node --experimental-strip-types`)가 선택된다. 이번 probe는 경로와 해시만 확인했고 receiver나 모델은 실행하지 않았다. compiled bridge dist는 R2 이전 빌드이고 remote-pair dist가 없다. dist와 실행 중인 양쪽 bridge의 bytes는 별개이며 확인하지 않았다.
- **A→B 비대화형 경로:** 성공했다. SSH 연결 2개였다(바깥 server→A, 안쪽 A→B). 안쪽은 BatchMode·ConnectTimeout·선언 alias에 host key 쓰기 방지 옵션 2개를 더했다. 그래서 PATH·source 증거이고 실제 transport argv 그대로의 검증은 아니다. 재시도는 없었다. trust·config 변경과 모델 입력, receiver·mailbox 쓰기도 없었다.
- **관측된 후보 id (fresh liveness 아님):** A `20261007T132839-b22677`, B `20261014T212756-68bd94`.

# 증거 — 이식 가능한 결정적 줄

- **설치 후보 tarball:** sha256 `023cc6e64ed38c89a49e7dc0376ae48d0738808bd4157313d0b1bb2146fda390`. package metadata는 0.39.0이지만 npm에 publish된 것이 아니다. branch 후보다.
- **installed gate 11/11:** 설치된 A·B entry, SSH stand-in, reverse dispatch로 확인했다. 모든 subject 프로세스의 모듈 4544개가 realpath 기준으로 consumer prefix 안에 있었고, checkout 경로를 섞은 negative control은 검출됐다.
- **qualification PARTIAL:** 두 group은 별개의 receipt다. tests-beside 37/37, installed-audit 2/2. 측정 대상은 commit 전 후보 `3afbfb6` + diff `5a11f777f1ab`(= `d0cd075`의 내용)다. `d0cd075` SHA에서 다시 돌린 것도, FULL/BODY도 아니다.
  - R2의 이전 RED 34/37은 보존한다. 원인은 type-invalid mutant 3개였고, 고친 replacement로 37/37이 됐다. kill-power는 이월하지 않았다.
- **증거 축은 섞지 않는다:** source · compiled · installed · 실제 SSH · 모델 턴. T3(실제 두 호스트 왕복)는 `e632294`에서 1회 했다(L4, 한 쌍, 1회). 그 뒤 문서 SHA는 이 결과를 이어받지 않는다.
- **정규 pack:** `check-pack`과 `check-pack-install`은 로컬에서 NOT-RUN이다. evidence export에서 pnpm prepack이 deps link를 통해 operator 모듈 교체를 시도해 중단했다. 통과한 것은 감사된 manual producer(직접 build + `npm pack --ignore-scripts`)뿐이다. producer는 checkout deps에 의존했고, consumer closure는 그와 독립이다.
- 정규 pack과 static FULL은 `e632294`의 exact-SHA CI(run 39202248407, 네 job success)가 측정했다. 로컬 FULL/BODY는 NOT-RUN이다. 문서만 바꾼 경우 qualification group은 다시 돌리지 않는다. gate·mutant·matrix가 바뀔 때만 다시 돌린다.

# 계약 — operator opt-in (구현됨; 공개 SSOT는 DELIVERY "Remote pair (#107)")

- 각 호스트의 agent dir(메타 store 옆)에 `entwurf-remote-pair.json`을 하나 둔다. 현재 두 호스트에 선언되어 idle 상태다. 키는 정확히 4개다: `remoteGardenId`, `ssh`(alias), `localGardenId`, `remotePairFile`(상대 호스트 opt-in의 절대경로). 양방향에 같은 파일을 쓴다.
- 파일이 없으면 off다. symlink·non-regular·읽기 불가·invalid는 거절한다. send/receive마다 읽고 cache하지 않는다. 재시도는 없다.
- 다리는 사람이 놓는다. 사설 연결(Tailscale 권장, 의존성 아님), SSH 인증·권한, 명시된 pair가 그 다리다. Entwurf는 설치·설정·탐색·재시도 없이 그 다리를 건너기만 한다. 신뢰 모델은 같은 운영자 SSH 계정이다. 시민 단위 암호 인증이 아니다.
- A는 bridge `entwurf_v2`에서 선언된 target이고 로컬 흔적이 없을 때만 `ssh -o BatchMode=yes -o ConnectTimeout=10 <alias> entwurf remote-pair-receive --pair <remotePairFile>`를 1회 실행한다. B는 `--pair`가 자기 opt-in 경로와 정확히 같을 때만 받는다. `entwurf_callback`은 로컬 그대로다.

# LIVE 하드 경계 (GLG, 2026-10-19)

- 대화 턴은 사용자에게 보이게 열려 있는 기존 형제에게만 돈다. OFF 형제를 깨우거나 fresh·resume하지 않는다. 숨은 모델 교환을 하지 않는다. 첫 실제 메시지는 받는 쪽 자기 UI에서 관측 가능해야 하고, receipt는 읽음·회신이 아니다.
- 코드가 강제하는 것: receive에서 일반 v2로 가는 경로에 launch·fresh·resume가 없다. OFF durable은 undeliverable이다(record·owner start key·watch armed가 필요하다: `pi-extensions/lib/entwurf-deliverability.ts:64-73`, `:239-252`). citizen 수명은 TUI 프로세스에 묶인다(`pi/pi-durable/bootstrap.mjs:576-594`). active durable에 전달하면 곧바로 turn이 시작될 수 있다(`pi-extensions/meta-bridge-pi-durable.ts:52-62`, `:940-945`).
- 코드가 강제하지 않는 것: 화면 visibility. TTY·PID·armed·gid label 투영(`meta-bridge-pi-durable.ts:82-87`)은 visibility 증거가 아니다. 그렇다고 상시 focus 요구나 메시지마다 사람이 승인하는 장치를 만들지 않는다.
- 디스크 pull은 실행 중인 bridge가 아니다. build를 명시적으로 하고, 사용자가 visible same-id로 다시 연 뒤 id와 code path를 확인한다. manager·watcher·reload 서비스는 만들지 않는다. 다음 운영 행동은 승인되고 관측 가능해야 하며 자동이 아니다.

# READ

- [#107 6278665895](https://github.com/junghan0611/entwurf/issues/107#issuecomment-6278665895) — 첫 실왕복 LIVE checkpoint(최신).
- [#107 6260030079](https://github.com/junghan0611/entwurf/issues/107#issuecomment-6260030079) — branch 인계와 CI 수용.
- [#107 6256528941](https://github.com/junghan0611/entwurf/issues/107#issuecomment-6256528941) — server→A 방향 1회 관측(U1–U4).
- [#107 6256179034](https://github.com/junghan0611/entwurf/issues/107#issuecomment-6256179034) — 준비 완료: source, 결정 D1–D5, 셀 (a)–(e).
- [#107 6245629231](https://github.com/junghan0611/entwurf/issues/107#issuecomment-6245629231) — 원 관측 패킷.
- 코드: `pi-extensions/lib/remote-pair-{receive,send,transport}.ts`, `scripts/remote-pair-receive.ts`, `scripts/check-remote-pair-installed.ts`, `pi-extensions/lib/remote-pair-roundtrip.test.ts`(T2).

# GUARDRAILS

- GO 단위로 진행한다. 다음 각각은 별도 GO다: 원격 접속·관측, 설치·코드 적용, 세션·bridge 재시작, 모델·메시지 턴, operator 파일, commit·push. main merge·tag·npm publish는 이 lane 밖이다.
- 만들지 않는 것: registry, 상주 listener·relay·tunnel, queue, 읽음·완료 추적, 재시도, 원격 launch·resume, 다른 rail로의 일반화, 다중 쌍.
- 원격 mailbox를 직접 쓰지 않는다. 두 번째 dispatch API를 만들지 않는다. local `bad-target` 뒤에 원격으로 넘어가는 fallback을 만들지 않는다. worktree나 개발 clone을 쓰지 않는다. 한 checkout에 writer는 한 명이다.
