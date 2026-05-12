# NEXT.md — pi-shell-acp

> 다음에 할 일만 남긴다. 로그가 아니다.
> 완료된 릴리즈/조사 기록은 `CHANGELOG.md`, GitHub issue, commit history로 보낸다.

---

## Current Priority — #10 호명 ontology 방향 정리 (no implementation)

#12 resume poison mapping invalidation은 구현/검증 완료. 이제 #10은 **코드 구현이 아니라 설계 경계선 정리**만 한다.

목표:

- GitHub issue #10에 현재 합의 방향을 남긴다.
- `contact_peer` / peer handle / state machine을 지금 구현하지 않는다는 결정을 명확히 한다.
- #10을 0.5.0 blocker로 키우지 않는다.

### Direction

- identity carrier는 `sessionId` 하나다.
- `taskId`는 UI/job label 및 기존 saved-session lookup compat marker다.
- caller의 현재 cwd는 peer identity가 아니다.
- saved session/header/미래 handle이 가진 cwd가 peer의 실행 터전이다.
- live discovery는 candidates일 뿐 authority가 아니다.
- poisoned인 것은 peer가 아니라 backend persisted mapping / transcript resume path다. #12를 peer state로 승격하지 않는다.

### 하지 않을 것

- `PeerHandle` / `PeerState` 타입 추가.
- `contact_peer(handle, message)` 단일 verb 도입.
- `entwurf_peers` semantics 변경.
- ambient peer registry 도입.
- taskId filename marker 제거.
- operator-visible `Task ID: <8-char>` 변경.
- 0.5.0 compaction guard split 작업을 #10 안에 섞기.

### Acceptance

- #10 issue comment에 위 방향과 non-goals가 정리됨.
- 필요하면 README/AGENTS/NEXT 중 문서 한 군데만 최소 보정.
- 코드 변경 없음.
- #10 정리 후 current priority를 0.5.0 guard split로 되돌림.

---

## After #10 — 0.5.0 backend-native compaction guard split

| Knob | Meaning | Default |
|---|---|---|
| `PI_SHELL_ACP_ALLOW_PI_COMPACTION=1` | pi JSONL compaction 허용 | blocked |
| `PI_SHELL_ACP_ALLOW_BACKEND_COMPACTION=1` | Claude/Codex backend-native compaction guard 제거 | opt-in |

원칙:

- pi-side compaction은 ACP backend transcript에 summary가 전달되지 않으므로 기본 차단 유지.
- OpenClaw long-chat 생존은 backend-native compaction 경로에 의존.
- 0.5.0은 **guard split only**.
- recap engine, compact→new-session handoff, hidden transcript hydration, provider handoff UX, Gemini residue cleanup, OpenClaw 튜닝 전부 금지.

---

## Parked, not current

- **#11** remote SSH resume cwd alignment — 나중에. 0.4.x 영역 아님.
- **#8** ACP `entwurf_send` 메시지 UX visibility — #10 재논의 이후.
- **#2** pi-first context meter — 0.5.0 이후 영역.

---

## Completion rule

#10 방향 정리 → 0.5.0 guard split 순서. 각 단계 완료 시 해당 섹션 삭제하고 다음 priority를 current로 승격한다.
