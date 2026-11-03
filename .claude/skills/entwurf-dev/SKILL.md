---
name: entwurf-dev
description: "Drive Entwurf's visible citizen lifecycle: status, fresh, callback, send, resume, retire and guided tours. Use when GLG asks to open or address a sibling, recall a dormant citizen, form a team, or try entwurf."
user_invocable: true
---

# entwurf-dev — 보이는 형제를 만나는 입구

GLG의 자연어 요청을 현재 세션의 `entwurf_*` 도구로 수행한다. 형제는 독립 runtime과 transcript를 가진 시민이다. 요청되지 않은 형제를 열거나 다른 형제에게 위임하지 않는다.

## 시작 전

- 활성 callable schema가 문서보다 우선한다. 오래된 `owned-outcome`이 보이거나 필요한 fresh/resume schema가 없으면 호출하지 말고 loaded runtime의 교체 필요를 보고한다. 디스크의 source가 실행 중인 bytes라는 뜻은 아니다: [loaded surface](../../../docs/setup-clean-host.md#applying-new-source-to-a-running-host).
- `entwurf_fresh_call` backend는 정확히 `pi | claude-code | copilot | omp | codex | pi-durable`이고 model은 필수다. 최신 `~/repos/gh/agent-config/MODELS.md`와 활성 schema에서 승인된 모델·실제 billing rail을 확인한다. 확인되지 않은 기본값은 추측하지 않는다. sibling에 OpenRouter를 쓰지 않으며, 이미 승인된 rail에 credential/login probe를 덧붙이지 않는다.
- `placement`는 tmux 전용 `{ tmuxSession: "<existing-name>" }`이다. 세션은 만들지 않는다: `tmux-session-missing`, `tmux-session-name-invalid`는 그대로 거절한다. 생략하면 caller의 자리이며 Codex caller는 thread-id가 실린 자기 pane 옆이다. 옛 `codex` 고정 home으로 추측하거나 fallback하지 않는다. Herdr 안에서는 placement를 거절한다. 자세한 경계: [tmux](../../../docs/mux-launch-rail.md), [Herdr](../../../docs/herdr-launch-rail.md).
- `cwd`는 선택적인 기존 디렉터리의 literal 절대경로다. cross-repo fresh에는 정확한 경로를 주고, 모르면 묻는다. tmux는 `#`를 거절하지만 Herdr는 그렇지 않다. cwd와 placement는 독립이다. launch의 cwd는 요청/선택의 receipt이지 실제 위치 관측이 아니다.

## 한 번에 한 동작

- **status:** `entwurf_peers`는 record와 liveness 사실만 보고한다. `unsupported`는 죽음도 mailbox도 아니다. delivery 가능 여부는 발송 시 별도 rail 판정이다.
- **fresh:** backend·model·task를 정하고 `{backend, model, task, cwd?, placement?}`로 `entwurf_fresh_call`을 한 번 호출한다. argv에 비밀을 넣지 않는다. launch receipt의 nonce를 보존한다. callback body가 nonce와 정확히 같을 때만 sender envelope의 `sessionId`를 주소로 삼는다. 화면, 최신 peer, 본문에 주장된 id로 대신하지 않는다. callback이 없으면 추측·polling·자동 재시도하지 않는다.
- **send/reply:** 명시한 garden id에 `entwurf_v2`의 `fire-and-forget`을 한 번 보낸다. `wants_reply`는 요청이지 기다림이나 완료가 아니다. `mode`는 명시할 때만 쓰며 steer/follow-up은 서로 다른 휘발성 큐다. returned acceptance boundary, mailbox enqueue, native-push 수락 또는 reject를 그대로 보고한다.
- **resume:** GLG가 지정한 dormant pi·pi-durable·Claude Code의 `{target}`만 `entwurf_resume_call`에 한 번 보낸다. 새 형제가 아니며 model/task/prompt는 주입하지 않는다. live/불확실·unbound·예약된 대상의 거절과 unobserved를 재시도하지 않는다. pi socket, Claude receiver join, pi-durable reservation adoption은 서로 다른 observation이고 adoption은 readiness가 아니다. 실제 대화의 연속성은 별도 recall로 확인한다.
- **retire:** GLG가 정확한 대상과 퇴근을 명시적으로 요청한 경우에만 `entwurf_retire_call`을 그 대상에 한 번 호출한다. 역할·형성·도구 노출은 권한이 아니다. unknown/취소는 재시도 사유가 아니며 자기 자신과 지명되지 않은 시민은 건드리지 않는다.

## 투어와 팀

Pi 투어는 fresh → exact callback → send → 사람이 창을 닫은 뒤 dormant 확인 → 명시적으로 요청된 같은-id resume → 별도 recall 순서다. Claude Code 투어는 mailbox enqueue와 실제 read를 분리한다. raw tmux keystroke나 화면 텍스트는 delivery/identity 증거가 아니다.

팀 형성 요청의 첫 task에는 callback, 지명된 원문 읽기, 명시된 topology의 형성과 callback 상관, formation-complete 보고와 대기만 둔다. 구현 체크리스트나 추가 위임 권한을 섞지 않는다. 형성 보고는 자기보고일 뿐 역할 권한이 아니며, GLG의 직접 grant 뒤에만 코디네이터가 세부 작업을 라우팅한다.

## receipt와 정지

Launch는 창/탭과 시작 요청, callback은 주소, observation은 rail별 관측, delivery는 수락 경계, reply는 별도 응답, recall은 과거 대화 회수다. 어느 하나도 다음 것을 보증하지 않는다. `entwurf_v2`는 프로세스를 시작하지 않는다. 잘못된 intent, 죽은 대상, 미관측, 실패 및 unknown을 성공으로 포장하거나 재시도하지 않는다. 범위 밖의 commit/push/release 권한을 추론하지 않는다.

제품 계약과 증거는 [AGENTS](../../../AGENTS.md), [DELIVERY](../../../DELIVERY.md), [BASELINE](../../../BASELINE.md), [VERIFY](../../../VERIFY.md)가 소유한다. 주간 Pi SDK upgrade의 격리·운영 경계는 [setup의 기본 반경](../../../docs/setup-clean-host.md#default-radius-for-a-requested-pi-sdk-upgrade), release의 네 모드와 단일 수용 artifact는 [entwurf-release](../entwurf-release/SKILL.md)가 소유한다. 이 스킬은 그 권한을 대신 부여하지 않는다.
