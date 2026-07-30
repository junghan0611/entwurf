# NEXT — 0.13.0 릴리즈컷: acceptance 닫힘, 다음은 landing 체크포인트

> NEXT는 부트 섹터다. 계약과 상세 근거는 `docs/acp-backend-rail.md` §11-8, 검증 계약은
> `VERIFY.md`, 구현 closure는 `c2b6530` 커밋 메시지가 SSOT다. 릴리즈 모드 경계는
> `.claude/skills/entwurf-release/SKILL.md`.

# NOW

- **현재 사실:** `main`은 `origin/main`(`f1ead4b`)보다 앞선 **로컬 상태**이며 push되지 않았다.
  1. `f4b20bb` — hvkiefer PR #40 이식 (저작성 보존)
  2. `f18ecfe` — CP0 계약 수선 (dual-HOME/D9 투영/D3/D4/D5/E/4행 큐레이션)
  3. `996ebad` — overlay scope를 authoritative `resolveSessionKey`로 배선
  4. `c2b6530` — installed provider entry의 Claude 2행 + Cortex 4행 exact-set 증명
  5. 이 커밋 — acceptance 증거 갱신 (문서 전용)
- package version은 아직 `0.12.10`이다. 버전/CHANGELOG 편집은 `prepare 0.13.0`이 소유한다.
- 정적 floor: cortex mutant lane **12 claims**, 전체 **111/111 killed**. `pnpm check`는 이 커밋의
  pre-commit 훅이 재완주했다.

## Acceptance — 2026-07-30 thinkpad, 모두 `c2b6530` 트리 기준

| 축 | 결과 | 증거 |
|---|---|---|
| Linux artifact consumer (Docker) | **PASS** exit 0, 40 ok | `ENTWURF_REQUIRE_DOCKER=1 ./run.sh check-install-container`; artifact `sha256=63342aa8a144011dee86ebea8f0b778c7860e54dc0f1c710438983c679e8af87`, image `node:24-bookworm` `id=sha256:fcd0f74fb415c75280d0d6d26ed68c57b6498f56f6ebcf47aecdfe7970a33861`, `repoDigest=node@sha256:5711a0d445a1af54af9589066c646df387d1831a608226f4cd694fc59e745059`; 로그 `/tmp/agent-tmux-entwurf-container.log` |
| Installed 패키지 모델면 | **PASS** | `./run.sh check-pack-install` — installed loader가 `entwurf` provider의 **exact 6-row (claude 2 + cortex 4)** 를 그대로 열거; tar 296 files; 로그 `/tmp/agent-tmux-entwurf-packinstall.log` |
| Cortex LIVE 왕복 (현재 코드) | **PASS 23/23** | `LIVE=1 ENTWURF_ACP_CORTEX_CONNECTION=XD75151 ./run.sh smoke-acp-cortex-live` — `entwurf/cortex-claude-sonnet-5`, world `/tmp/acp-cortex-mAVx86`; overlay 1개 + `autoUpdate:false` + mcp.json 투영 + 실제 HOME 복원, 모델의 `entwurf_v2`가 peer에 `.msg` 1건 배달(envelope에만 gid, payload는 nonce), process-group teardown leak 없음; 로그 `/tmp/agent-tmux-entwurf-cortex-live.log` |

`sha256=63342aa8…`는 `996ebad` 시점 컨테이너 실행과 **byte-identical** 이다 — `c2b6530`은 게이트/문서
축만 바꿨고 패키지 바이트는 움직이지 않았다.

**Cortex 없는 호스트 비간섭의 핵심 증거는 위 컨테이너 로그다:** `cortex` 문자열이 단 한 번도 나오지
않은 채 40 ok로 PASS했다. cortex는 npm 의존성이 아니고, provider 등록·설치 시 실행 파일을 찾지 않으며,
`cortex-*` 모델을 실제로 고를 때만 `cortex acp serve`를 spawn한다.

## Honest open — 이 컷이 주장하지 않는 것

- **installed 바이트로 돌린 cortex LIVE 왕복은 미실행.** LIVE cortex 증거는 checkout 결박이고,
  installed 축 증거는 결정론적(6-row 열거)이다. 두 축을 한 실행에서 만난 적은 없다 —
  `VERIFY.md` §1.4 axis-1의 남은 절반. 릴리즈 blocker로 선점하지 말고 있는 그대로 보고한다.
- **0.13 aggregate LIVE release-gate는 아직 안 돌았다.** `prepare 0.13.0` P5가 소유한다
  (`LIVE=1 ./run.sh release-gate <scratch>`, MUST FAIL=0 / SKIP=0 필요).
- 두 번째 머신(axis 2), macOS/WSL2는 여전히 비인증.

## Next move — 릴리즈 state machine 순서대로, 모드마다 별도 권한

1. `/entwurf-release land 0.13.0` — 이 pre-version HEAD만 push하고 그 exact SHA의 push-triggered
   `ci.yml`에서 `check` / `install-surface` / `artifact-consumer` 세 job이 success인지 요구한다.
   이 CI가 "cortex 없는 호스트도 안 터진다"를 남의 러너에서 재현하는 축이다.
2. GREEN이면 `/entwurf-release prepare 0.13.0` — CHANGELOG 승격, `npm version`, `pnpm check`,
   LIVE release-gate, release-prep 커밋. push/tag/publish 권한 아님.
3. `/entwurf-release make 0.13.0` — prepared HEAD push + 두 번째 exact-SHA CI + preserved candidate
   1개 생성·수용(재pack 금지) + tag + GitHub release.
4. `npm publish`는 다시 별도 승인(`publish 0.13.0 <절대경로 candidate> latest`).

**RED 시:** artifact/log/process 상태를 보존하고 진단 리뷰를 붙인다. 게이트를 우회해 앞으로 가지 않는다.

# 0.13.0 범위 동결

**포함:** Cortex ACP adapter · 4개 curated model · cortex 선택 시에만 lazy spawn · dual-HOME 및 MCP
projection · pi-hosted routable citizen · Claude Code / pi native / pi ACP Sonnet과의 실제 왕복 ·
cortex 없는 설치·CI 비간섭 · 패키지·Docker·릴리즈 증거.

**0.13.1 이월:** identity/carrier 표현 정교화 · native tool narrowing과 optional profile · Cortex 전용
BASELINE 질문 bank · 명시적 enable/disable UX · unknown-key strict reject.

모델 목록을 PATH 감지로 숨기는 방향은 0.13.0에서 채택하지 않는다. 설치 환경마다 provider surface가
달라지고 현재 exact 6-row 검증이 무너진다. 명시적 enable/disable이 필요하면 0.13.1 UX 축이다.

# DESIGN FOLLOW-UP — release blocker로 선점하지 말 것

## Cortex baseline / tool surface

첫 operator baseline에서 harness/backend, 단일 MCP `entwurf-bridge`, 5개 garden tool, 외부 기억축은
정직하게 식별했다. 동시에 다음이 관측됐다.

- Cortex가 `entwurf`/AGENTS first-user augment를 system prompt로 귀속했다. wire carrier 오류인지 모델의
  surface 분류 오류인지 아직 모른다. transport와 섞지 말고 구조적 증거를 먼저 본다.
- Cortex native schema에 `task_*`, `team_*`, `spawn_teammate` 등 넓은 도구면이 보였다.

한 자루 드라이버 방향은 유지하되 **Claude-shaped allowlist를 Cortex에 강제하거나 기여자의 native-surface
의도를 결함으로 단정하지 않는다.** 먼저 Cortex가 지원하는 설정면을 측정하고 옵션을 제시한다: native
surface 보존 / 명시적 minimal profile / operator opt-in·opt-out. 기본값과 release 포함 여부는 GLG와
논의 후 결정한다. 필요하면 `BASELINE.md`에 Cortex 전용 열/질문 bank를 추가하되 Claude bank를 그대로
복사하지 않는다.

## Record-only

- `config.ts` unknown-key silent-ignore는 기존 parser 성질이며 0.13 회귀가 아니다. README 경고는 있음;
  strict reject는 별도 계약 변경이다.
- project hook firing, authenticated/non-authenticated `configOptions` 차이의 원인, Cortex `_meta` seam은
  §11-8의 honest-open 강도를 유지한다.

# DO NOT

- 로컬 커밋을 이미 push됐다고 쓰지 말 것. push는 GLG의 현재 세션 명시 요청(또는 `land`/`make` 모드
  호출)이 있어야 한다.
- 한 모드 호출을 다음 모드 권한으로 읽지 말 것. `prepare`는 `land`이 아니고 `make`는 `publish`가 아니다.
- 수용된 candidate 바이트를 다시 pack하지 말 것.
- readiness fence 구현 금지 — §11-7/#55 소유.
- `CORTEX_HOME`을 operator shell에 export하지 말 것; cortex version pin 금지.
- tool narrowing을 contributor intent 검토 없이 강제하지 말 것.
- common 파일에 backend 분기문을 만들지 말 것. common seam은 backend-invariant + 독립 gate가 필요하다.
- `check-gate-qualification` 중 tree를 건드리지 말 것. `.ts` 수정 뒤 `pnpm run build-bridge`를 빼먹지 말 것.
