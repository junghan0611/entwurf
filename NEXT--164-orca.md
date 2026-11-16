# NEXT — #164 Orca 플러그인 / 노트북 실무 lane

# RAIL — 현재 좌표

- [x] **1. GLG 범위 지정과 브랜치 분리.** `164-orca`, 시작 HEAD `8f61e895`.
- [x] **2. Opus 실무코디 합류와 최신 API 확인.** 코디 `20261116T105225-f17648`. Host API 1.10 문서 판독(stablyai/orca main 69edf46e).
- [x] **3. 로컬 Orca 설치·실측.** M1~M3f 완료, #164 댓글 6906503079.
- [x] **4. plugins/orca/README.md(영어, 64줄) + 루트 README Orca 절.** `7f7b5359`, Sonnet 작성 · Opus 리뷰 3회(Blocker 0). GLG 요청으로 commit+push.
- [x] **5. 소비자 수용 측정.** README만 받은 새 Sonnet `20261116T140211-64a36b`가 sandbox HOME에 npm 0.55.0 설치→setup green→Orca 터미널 시민 출생(로그인 없음). 막힌 곳을 README에 반영(`4bf643b5`), setup/durable 문서 0.55.0 갱신(`348c78aa`), 영수증 #164 댓글 6907955407.
- [x] **6. 시험 자원 회수 (GLG 요청, 2026-11-16 15:10 KST).** 형제·시험 시민 retire(d5672e·1c8604·64a36b·92f112·94355d shutdown-requested, c69848·6f4745 exited, 6ed129 receiver-dead로 이미 종료), Orca serve 2·GUI·데몬/PTY scope 0, worktree·~/orca 제거, Orca가 쓴 설정 복원(settings.json은 pre-Orca .bak 바이트로, agent-config keybindings checkout, Pi 확장 3·orca-agent-view·~/.orca·~/.config/orca·~/.config/opencode 제거). 운영자 HOME은 pre-Orca 스냅샷과 Claude 자체 churn 외 동일(`m3-operator-home/receipts/M3-after-cleanup.sha256`). lab 바이너리·sandbox 삭제, 영수증 디렉터리만 보존(~/.local/share/entwurf-lab/164/*/receipts). Sonnet의 PARTIAL/check:full 로컬 영수증(/tmp)은 정리 중 지워짐 — 결과는 `6d7adf84` 커밋 메시지에 남음.
- [ ] **7. oracle 수용.** ← CURRENT: 위 NOW의 oracle 항목. merge 전 이 NEXT 삭제·지속 사실 승격.

# NOW

- **oracle 수용 대기 (GLG 2026-11-16: release는 oracle, 이 lane은 할 수 있는 것만 커밋·push). oracle은 Orca를 설치하지 않는다 — Orca 검증 정보는 이 노트북 실측(#164 댓글 6906503079 측정 요약, 6907955407 소비자 설치 영수증, 이 NEXT)을 그대로 받아 release 때 정리한다.**
  1. 이 branch의 커밋을 수용한다: Orca 안내(`plugins/orca/README.md`, 루트 README Orca 절), setup/durable 문서 0.55.0 갱신(+pi-floor mutant), pi 기본 모델 opus-5-5(`6d7adf84`).
  2. 다음 release(예: 0.55.1)를 cut·publish한다. 0.55.0 소비자는 pi 기본 모델로 retired `claude-fable-5-1`을 받는다(소비자 실측, 턴 실패 여부 미측정).
  3. publish 뒤 herdr runtime pin을 그 버전 registry bytes로 다시 잡는다(`plugins/herdr/runtime-lock.json`는 아직 `herdr-checkout` 후보 상태, `faa535a3` 선례). `plugins/herdr/README.md:526`의 "unpublished 0.55.0" 서술도 그때 맞춘다. 이 lane에서는 pin을 잡지 않는다(GLG).
  4. Orca README와 setup 문서의 버전 예시를 새 버전으로 맞춘다.
- **pi 기본 모델 → `claude-opus-5-5` (`6d7adf84`):** pi `findInitialModel`은 --model/--models·settings enabledModels/defaultModel이 없고 auth 있는 다른 provider가 앞서지 않으면 첫 등록 행을 고른다. entwurf 행이 pi-ai 카탈로그 순서를 따라 0.55.0에서 fable-5-1이 첫 행이었다. anchor를 첫 행으로 등록(settings 쓰기 없음). QK ACP-ROWS-ANCHOR-FIRST + mutant(레인 68→69), PARTIAL 69/69, check:full green(c87132a2 고정 트리). 리뷰 1c8604 Blocker/Defect 0. 이미 `entwurf/claude-fable-5-1`을 default로 저장한 사용자는 3·4단계로 내려와 opus가 될 것[추론, 미측정].

- 팀(2026-11-16): 코디 Opus `20261116T105225-f17648` · 구현 Sonnet `20261116T121913-d5672e`(편집 범위 `plugins/orca/**`만, 구성안 승인 전 코드 금지) · 리뷰 Opus `20261116T122714-1c8604`(README 독립 리뷰, 편집 금지) · 소비자 Sonnet `20261116T140211-64a36b`(README만 받고 sandbox에서 npm 0.55.0 소비자 설치 수용 측정). GLG 결정: 코어는 npm pin 설치, 플러그인은 npm 패키징하지 않음, plugins/orca는 안내 문서만(점검 스크립트 없음).

- GLG 직접 요청(이 세션): entwurf Opus를 실무코디로 열고, 코디가 필요한 형제들을 불러 진행한다. 이 노트북은 Orca 설치와 실험 가능. oracle은 코어 이슈 작업 전용이며 이 lane에서 Orca 설치·원격 변경을 하지 않는다.
- 목적(GLG 전달): 이번 주 회사 동료에게 설치해서 쓸 수 있는 Orca용 Entwurf 플러그인을 남긴다. 동료들은 headless Orca 서버에 GUI와 휴대폰으로 접속한다. TUI 데스크톱만 검증해서 끝내지 않는다.
- Next: 코디가 `gh issue view 164 -R junghan0611/entwurf --comments` 및 본문을 직접 읽고, 최신 Orca 플러그인 API/서버 설치 경로를 확인한다. headless + 기존 GUI/모바일 접근 기준으로 범위를 GLG에게 명확히 제시하고 첫 측정부터 진행한다.
- 증거 상태: #164 스레드의 oracle headless v1.4.259 왕복 n=1과 종료 후 PTY 잔존은 이전 담당자의 외부 보고다. 이 노트북에서는 아직 Orca 설치·실행·왕복을 측정하지 않았다. `plugins/`에는 현재 herdr/openclaw/pi-durable만 있음(이 세션 ls 관측).
- 주의: #164의 모바일/원격 초기 범위 제외와 이번 GLG의 headless+GUI/휴대폰 목표를 구분해서 정리한다. 모바일 전용 전달 레일을 새로 만들 권한으로 읽지 않는다.
- 협업: 코디가 교차 계약·겹침·리뷰·체크포인트를 라우팅하고 구현자는 자기 범위와 테스트를 맡는다. 같은 checkout/branch를 공유하므로 겹치는 파일 편집과 실행 중 소스 변경을 통제한다. 모델 rail은 `~/repos/gh/agent-config/MODELS.md`를 따른다. OpenRouter 금지.
- 검증: 실제 garden-id 등록 → 발송 receipt → sender envelope 수신 → 응답 턴. terminal handle/화면/키 입력을 전달 증거로 쓰지 않는다. Orca가 쓰는 확장/설정 파일은 전후 비교하고 cleanup은 시험 소유 자원에 한정한다.
- Do not touch: oracle 호스트, 다른 코어 lane, main NEXT.md, 인증/구독, 기존 시민 임의 종료, push/release. commit은 GLG의 별도 요청과 commit workflow에서만. worktree/개발 clone 금지. 병합 전에 이 branch NEXT를 삭제하고 지속 사실을 승격한다.

# RECENT

- 2026-11-16 lane 밖 관측(미처리, GLG 판단): `plugins/herdr/README.md:526`이 0.55.0을 아직 "unpublished checkout candidate"로 적음 · 0.55.0 소비자 pi 시작 화면 `Extension issues … peerDependencies` 경고(동작 지장 없음) · 0.55.0 소비자 pi 첫 record/상태줄 모델이 main 8f61e895에서 curated 해제된 `claude-fable-5-1`(턴 실패 여부 미측정).

- 2026-11-16 M3 로컬(운영자 HOME, Orca 기본값, orcad v1.4.259 + 페어링된 데스크톱 GUI 클라이언트, 별도 client HOME): 왕복 3건 n=1 성공 — M3a `entwurf claude`(c69848), M3c GUI에서 Orca가 띄운 plain Claude Code(6f4745, 사용자 범위 Entwurf 훅으로 시민), M3b `entwurf pi`(92f112). Claude Code는 메일을 자동으로 읽되 실행은 pane 사람 승인 후(inbox_read 도구 설명의 untrusted 규칙), Pi는 즉시 회신. 영수증 `~/.local/share/entwurf-lab/164/m3-operator-home/receipts/SUMMARY.md`. GLG 방향: `plugins/orca`(herdr처럼), npm 사용자 설치, herdr 플러그인과 세트 출시, 대상 하네스는 pi·claude-code만, opencode 범위 밖(운영자 opencode 설정은 GLG 요청으로 삭제·tar 백업).

- 2026-11-16 로컬 lab(thinkpad, sandbox HOME, `~/.local/share/entwurf-lab/164/orca-1.4.259-x64/receipts/SUMMARY.md`): orca-server x64 v1.4.259 sha256 일치, orcad serve ready. `plugin list` → "Plugin service is not available on this runtime". `terminal create` PTY env에 PI_*/ENTWURF_*/TMUX/HERDR_* 0. serve SIGINT 후 daemon·PTY scope 생존, 재시작 시 같은 handle 재등재. 운영자 `~/.pi/agent/extensions` 전후 동일. lab serve는 tmux `orca164lab`(시험 소유, 정리 대상). 시민 왕복은 아직 로컬 미측정.

- 현재 세션 `20261112T222019-61e7fc`가 GLG 요청을 직접 받았다. 로컬 0.55.0 setup green 및 재시작 후 같은 garden-id 응답은 이 대화에서 확인했다. 이는 Orca 지원 증거가 아니다.
