# NEXT — 0.13.0 published; 0.13.1 runtime-rail work is COMMITTED + PUSHED, LIVE 축 닫힘

> NEXT는 부트 섹터다. ACP 계약과 readiness 경계는 `docs/acp-backend-rail.md`, 검증 계약은 `VERIFY.md`,
> 기록된 증거는 `BASELINE.md` HISTORY 포인터, dep-bump 트랙 절차는 `ROADMAP.md`의 **Dep bump(별도 트랙)**가
> SSOT다. 릴리즈 모드 경계는 `.claude/skills/entwurf-release/SKILL.md`.

# NOW

- **0.13.0은 완전히 나갔다.** `27e5f09` = `origin/main` = tag `v0.13.0`, GitHub release published
  (2026-07-30T03:19:53Z), npm `@junghanacs/entwurf@0.13.0`이 **`latest`**, exact-SHA CI 2회 success
  (30510354126 · 30510859840). `make`/`publish`는 끝났다 — 다시 실행하지 말 것.
- **0.13.1 런타임 레일 작업은 커밋·푸시됐다.** `fea773f` (2026-07-30 17:48 KST, oracle) =
  `origin/main`. 성격은 dep bump + 계약 수선이고, 하위호환은 지지 않는다(세션 수명 도구).
  package version은 아직 `0.13.0`이고 그게 맞다 — 버전과 CHANGELOG는 `prepare` 모드가 소유한다.
- **LIVE 둘 다 닫혔다 (2026-07-30 18:2x KST, thinkpad).** oracle의 cortex 미설치 blocker는
  thinkpad에 cortex v1.1.52 + Snowflake connection이 있어서 해소됐다. 아래 "검증 실측 — axis 2" 참조.
- **남은 것은 릴리즈 판단뿐이다.** `/entwurf-release prepare 0.13.1`. 실행 전 아래 "남은 것" 순서를 볼 것.

## 0.13.1에 들어간 것

**⑴ 하드 미니멈 런타임 핀.** pi `0.82.1 → 0.83.0`, peer `>=0.83.0 <0.84`. 설치하면 0.82.x 호스트는
그대로 두는 게 아니라 **올라간다** — 이게 의도다. `run.sh`가 devDep에서 peer를 기계 유도하므로 손으로
틀릴 여지가 없고, `./run.sh check-dep-versions`가 오라클이다(5 baseline docs + package + run.sh 동시 검증).
천장은 실측으로 올렸다: `loader.ts`와 `packages/ai/src/compat.ts`가 v0.82.1..v0.83.0 sha256 동일.

**⑵ claude-agent-acp `0.62.0 → 0.63.0`.** 직전 bump와 성격이 다르다 — **adapter-code 릴리즈**다
(tarball 137,294 → 142,084 B, `acp-agent.js`·`tools.js`·`acp-agent.d.ts` 이동). 0.61→0.62의
byte-identical 논거를 재사용하면 안 된다. 우리 표면 도달은 좁고 그것도 실측이다: `clientCapabilities: {}`라
terminal meta와 subagent transcript는 off, 다만 opt-in 아닌 `_meta.claudeCode.title`/`.subagent`와
#916 heartbeat는 wire에 올 수 있고 mapper가 무시할 뿐이다. **"전부 미도달"로 쓰지 말 것.**

**⑶ ACP stop-reason 계약 (이번 컷이 미니점을 버는 지점).** `mapPromptStopReason`의
`default: return "stop"`이 `refusal`·`max_turn_requests`·미지의 reason·**reason 부재** 넷을 전부
깨끗한 성공으로 접고 있었다. pi 0.83이 자기 프로바이더에서 같은 구멍을 닫았고(#7272) `rawStopReason`을
줬다. 이제 `{stopReason, rawStopReason?, errorMessage?}` 판정으로 넷 다 **error 이벤트**로 닫고,
스트림 시드를 `"stop"` → `"pending"`으로 바꿔 진행 중 턴이 성공을 선취하지 않게 했다.

**⑷ 죽은 `[tool:running]` 제거.** `_meta.terminal_output`은 `clientCapabilities._meta.terminal_output
=== true`에 게이팅되는데 우리는 `{}`를 보낸다 — 처음부터 발화 불가능한 분기였다. terminal capability를
켜는 것은 **별도 축**이지 한 줄 재활성화가 아니다(켜면 어댑터가 mapper가 정직하게 렌더 못 하는
terminal widget/meta를 보낸다).

**⑸ 게이트.** 신규 `check-acp-stop-reason` — 7셀(closed ACP terminal set 5 + 미지 + 부재)을
`streamAcpTurn`으로 **behavioral하게** 몰고 event kind / event reason / 최종 메시지의
stopReason·rawStopReason·errorMessage를 함께 판정한다. `acp-stop-reason` mutant lane 6종 추가 →
**111/7 lanes → 117/8 lanes**.

**⑹ 문서 정비.** README의 fresh-cut/external-host 상세를 패키지에 포함되는 전용 문서로 분리하고,
현재 계약이 아닌 릴리즈 고고학을 덜어냈다. `README` 843→500줄, `VERIFY` 333→299줄,
`DELIVERY` 285→141줄, `BASELINE` 444→282줄, ACP rail 1317→198줄, clean-host guide
406→200줄, fresh-cut policy 204→99줄. Codex를 이미 shipped native citizen으로 부르던 잘못된 문장과
아직 구현되지 않은 ACP persisted resume/load 주장도 교정했다. Claude floor 앵커는 README에 남고
`check-claude-floor-coherence`가 계속 결박한다. ROADMAP dep-bump 트랙에는 이번 bump 기록을 추가했다.

## 검증 실측 (2026-07-30, oracle)

- 최종 구현 + 문서 정비 + § 참조 sweep 트리에서 `pnpm check` **EXIT=0**,
  qualification **117/117 KILLED, 8 lanes**, `check-pack` **301 files**.
- **`check-pack-install` EXIT=0 — 하드 미니멈의 실증.** 실제 tarball을 임시 트리에 설치해
  `every @earendil-works pi package is 0.83.0` / `loader runtime: pinned pi 0.83.0 (not the host's
  global pi)` / `exact 6-row curated set: claude 2 + cortex 4`를 확인했다. **이 게이트는 `pnpm check`에
  없다** — 핀을 움직인 컷은 반드시 따로 돌려야 한다.
- `check-claude-floor-coherence`, `check-dep-versions`, `check-acp-sdk-surface`,
  `check-acp-stop-reason`, `check-acp-cortex`, `check-acp-event-mapper` focused 재통과.
  상대 Markdown 파일 링크 0 broken.
- **정체성 축 확인.** 문서 압축 후에도 `garden id`(8파일)·`citizen`(11)·`thin bridge`(3)·`sibling`(7)·
  `기투` 생존, ROADMAP `Vocabulary guard` 절 유지, README 첫 문장 원문 유지. 정체성 게이트
  (`check-entwurf-session-identity`·`check-meta-identity-consumers`·`check-agy-sender-identity`·
  `meta-identity` lane) 전부 green.

## 검증 실측 — axis 2 (2026-07-30 18:0x–18:2x KST, thinkpad)

**두 번째 머신이 처음으로 섰다.** oracle이 `fea773f`를 푸시한 뒤 thinkpad에서 pi를 `0.82.1 → 0.83.0`으로
올리고(`pi update --self` — SSOT는 `nixos-config/scripts/external-packages.sh`, pnpm 재설치가 아니라
self-update다) `pnpm install` → `prepare` 훅이 `build-bridge`를 자동 실행해 dist를 재emit했다.

- **정적 축 재현.** `pnpm check` **EXIT=0**, qualification **117/117 KILLED, 8 lanes**,
  `check-pack` **301 files** — oracle과 같은 숫자.
- **`check-pack-install` EXIT=0 — axis 2 설치축.** `every @earendil-works pi package is 0.83.0` /
  `loader runtime: pinned pi 0.83.0 (not the host's global pi)` / `exact 6-row curated set` /
  dev-only gate refusal / installed store-doctor scan / self-fence(real DATA tree byte-identical).
- **`smoke-acp-raw-turn-live` PASS** — launch source `package:@agentclientprotocol/claude-agent-acp`
  (0.63.0), `initialize protocolVersion=1`, model set → `claude-sonnet-5`,
  **`prompt returned (stopReason=end_turn)`**, reply `"OK"`, 33103 rawBytes NDJSON.
  0.63.0 어댑터의 wire stop reason을 **실측**했다 — 0.62.0 표본 재사용이 아니다.
- **`smoke-acp-cortex-live` PASS (23 assertions)** — cortex **v1.1.52**(CP0-M이 실측한 그 버전),
  connection은 환경에서 주입. `agent_start` → **`agent_end` (no hang)** → **`no extension_error`**.
  이 세 줄이 stop-reason 하드닝의 cortex 리스크를 닫는다: cortex가 reason을 빠뜨리거나 닫힌 집합 밖
  값을 실었다면 새 `mapPromptStopReason`이 ERROR로 봉인해 `agent_end`가 아니라 `extension_error`가
  떴을 것이다. 함께 선 것 — D4 `autoUpdate:false`, D9 mcp.json projection, D10 dual-HOME 복원,
  CP0에서 빚으로 남긴 **아웃바운드 `entwurf_v2`**(cortex 모델이 자기 자신으로 배달, payload는 nonce
  정확히 그것뿐), process-group teardown `leaked: none`.

**어댑터 축은 cortex에 도달하지 않는다** — `backend-adapter.ts`의 cortexAdapter는 PATH의
`cortex acp serve`를 띄우고 `claude-agent-acp`를 `require.resolve`하는 것은 claudeAdapter뿐이다.
그래서 0.62→0.63 bump의 cortex 리스크는 0이고, 공유되는 것은 pi와 common layer
(`mapPromptStopReason`은 `backend.ts`에 있고 adapter 분기가 없다)다.

## 남은 것 — 이 순서로

1. ~~`LIVE=1 ./run.sh smoke-acp-raw-turn-live`~~ — **완료 (thinkpad, PASS).**
2. ~~`LIVE=1 ENTWURF_ACP_CORTEX_CONNECTION=<conn> ./run.sh smoke-acp-cortex-live`~~ —
   **완료 (thinkpad, PASS 23 assertions).** oracle의 cortex 미설치 blocker는 axis 2가 흡수했다.
3. ~~커밋~~ — `fea773f`로 완료·푸시됨.
4. `/entwurf-release prepare 0.13.1` — package version과 CHANGELOG는 **prepare 모드가
   소유한다.** 지금 트리의 `package.json` version은 아직 `0.13.0`이고 그게 맞다.
   **CHANGELOG 첫 항목은 pi floor가 0.82.x 설치를 깬다는 사실이어야 한다** — patch 번호가 실어주지
   않는 신호를 산문이 대신 싣는다. `0.14.0`은 CODEX 지원에 예약돼 있다(GLG).

## 미결 — 이 컷이 주장하지 않는 것

- ACP rail의 §11-7 probe/ordering lane은 여전히 **instrument admissible, measurement owed**다. 첫 paired run은
  inconclusive이고 inconclusive는 "문제 없음"이 아니다. 게다가 그 표본은 0.62.0 어댑터 기준이다.
- 0.63.0의 세 upstream fix 중 어느 것도 readiness fence가 아니다. `mcpServerStatus()`는 여전히
  호출되지 않는다. bump를 readiness 수정으로 쓰지 말 것.
- **axis 2(두 번째 머신)는 이제 인증됐다** — thinkpad에서 정적·설치·LIVE 셋 다 GREEN(위 "검증 실측 —
  axis 2"). 다만 **linux 두 대**일 뿐이다: macOS/WSL2는 계속 비인증이고, axis 2가 섰다고 OS 축이
  섰다고 쓰지 말 것.
- cortex LIVE는 **v1.1.52 한 버전, connection 하나**의 표본이다. cortex가 올라가면 stop-reason 표면은
  다시 측정 대상이다 — 이번 PASS를 cortex 일반에 대한 보증으로 쓰지 말 것.

# DO NOT

- 로컬 커밋을 이미 push됐다고 쓰지 말 것. push는 GLG의 현재 세션 명시 요청이 있어야 한다.
- 한 모드 호출을 다음 모드 권한으로 읽지 말 것. `prepare`는 `land`이 아니고 `make`는 `publish`가 아니다.
- 0.63.0 도달성을 "전부 미도달"로 요약하지 말 것. 축별로 측정된 것만 쓴다.
- 0.61→0.62의 byte-identical 논거를 0.62→0.63에 재사용하지 말 것.
- terminal capability를 mapper 수선 없이 켜지 말 것.
- readiness fence 구현 금지 — ACP rail §11-7/#55 소유.
- `check-gate-qualification` 중 tree를 건드리지 말 것. `.ts` 수정 뒤 `pnpm run build-bridge`를 빼먹지 말 것.
- 새 게이트가 `.tmp-verify`를 비운 채 남기지 말 것 — 빈 부모 디렉터리가 IMPURE tree drift로 읽힌다.
- **문서를 크게 줄인 뒤 § 참조 sweep을 빼먹지 말 것.** 2026-07-30 rail 1317→198줄 압축에서 죽은
  §번호 13건이 소스·게이트·ROADMAP에 남았다(`§4`·`§6`·`§9-x`·`§10`·`§11-3`). 살아있는 섹션 이름으로
  가리켜라. 확인: rail 앵커는 `11-7`/`11-7-a/b`/`11-7-c`뿐이다.
- **주석을 고치기 전에 그 줄이 mutant `find` 앵커인지 확인할 것.** `backend-adapter.ts`의
  `(rail: Adapter contract)` 주석은 `acp-cortex.json`의 `CORTEX-ENFORCE-SET-MODEL`이 유일성 확보용
  context로 쓴다. 소스만 고치면 MUTANT-STALE로 죽는다 — 소스와 매니페스트 `find`/`replace`를 함께 옮겨라.
- **핀을 움직인 컷은 `check-pack-install`을 따로 돌릴 것.** `pnpm check`에 들어있지 않아서 아무도
  안 돌린 채 green으로 착각하기 쉽다.
