# NEXT — #82 Copilot garden id 시민화 (branch lane)

> **이 주제의 산문은 이 파일 하나다.** 머지 전 삭제하는 disposable이다.
> 서사와 영수증은 이슈 스레드가 정본이다 — 특히
> [#82 comment 5363685118](https://github.com/junghan0611/entwurf/issues/82#issuecomment-5363685118)
> (인수·산출물·사고·남은 일). 여기는 **다음 한 걸음**만 든다.

레인: **Copilot이 garden id를 가진 가든 시민이 된다.** 근거는 GLG가 #82에 직접 쓴
코멘트 `5352330620` (2026-08-20T06:37:33Z) — GitHub 쪽을 맡기고 `auto`를 비용 레버로 쓴다.

2026-08-21 GLG가 레인의 종착점을 다시 세웠다: **"entwurf를 클로드코드에서 가능한 것과
같은 수준으로 끌어올린다."** 출생은 끝났고, 남은 것은 **손(MCP)** 과 **알림**이다.

---

# RAIL — 현재 좌표

- [x] **1. 측정 · 신뢰 규약** — Copilot 1.0.80 번들/훅 실측, 증거 태그 규약 수립
- [x] **2. 출생 구현** — 레지스트리 · 훅 유닛 · 설치/닥터 · 게이트
- [x] **3. §6 인수** — 실제 Copilot 세션이 시민이 됐고 footer에 자기 id를 찍는다
- [x] **4. 설치면 재현·역방향** — `91986c2`. install/uninstall/doctor + 15-check smoke
- [ ] **5. MCP 손 (outbound)** ← CURRENT: Copilot 안에서 `entwurf_*`를 부를 수 있게 한다
- [ ] **6. 알림 (`agentStop`)** — 턴 끝에 "편지 왔다"를 알린다. **측정부터**
- [ ] **7. 등급 정정** — `DELIVERY.md`의 D0과 capability registry가 오늘의 사실과 다르다
- [ ] **8. 유휴 깨우기 (D4)** — **우리 몫이 아니다.** 번들에 메커니즘이 없다(아래 펜스)

현재 좌표: 4 완료 → **5 진행 대기** → 6·7 → 8은 벤더 대기

## 파리티 표 — "클로드코드 수준"이 정확히 무엇인가

`[코드]` 등급의 정본은 `pi/entwurf-capabilities.json`이다. Copilot만 `D0`, 나머지 넷은 `D6`.

| 축 | Claude Code | Copilot 오늘 | 우리가 할 수 있나 |
|---|---|---|---|
| 출생 (garden id) | ✓ | ✓ `20260821T091514-fb50b4` | 끝 |
| statusbar에 garden id | ✓ | ✓ `91986c2` | 끝 |
| `entwurf_*` 도구를 **부를 수 있음** | ✓ `~/.claude/settings.json` mcpServers | ✗ **`~/.copilot/mcp-config.json` 부재** | **가능 — RAIL 5** |
| 턴 끝 "편지 왔다" 알림 | ✓ `FileChanged`(`doorbell.sh`) | ✗ | **미측정 — RAIL 6** |
| 유휴 세션 깨우기 (D4) | ✓ `asyncRewake` | ✗ | **불가 — 번들에 없음** |
| `fresh_call` 대상 | ✓ `FRESH_CALL_BACKENDS` | ✗ | 8 이후 |

핵심: **`D0 → D6`의 거리는 하나가 아니라 셋이고, 셋 중 둘은 오늘 우리 손에 있다.**

# NOW

- **Current — 개인 설정을 진실하게 만든 뒤 설치한다.**
  `[측정]` 지금 `~/.copilot/settings.json`의 `statusLine` 블록은 2026-08-21 09:11에
  **사람이 손으로** 넣은 것이고 install-state는 없다(`doctor-copilot-statusline` →
  *"state: absent (no settings ownership recorded)"* — 닥터는 정직하다).
  `[코드]` `install()`은 preimage를 **현재 디스크**에서 뜬다 →
  **지금 그대로 설치하면 preimage가 거짓말을 한다.**
  `[측정]` 진짜 pre-lane 상태는 GLG가 2026-08-21 06:52:53에 직접 붙여넣은 원문이다:
  **`statusLine` 키 없음, `footer.showCustom: true`는 원래 있었음.**
  → 손으로 넣은 `statusLine` 블록만 제거하고 `./run.sh install-copilot-statusline`을 돌린다.
  그러면 preimage가 "statusLine 없었음 / showCustom 켜져 있었음"으로 참이 되고
  `uninstall`이 GLG의 원래 설정을 정확히 복원한다. **GLG 개인 설정 변경이므로 승인 사안.**

- **Next 1 — RAIL 5, MCP 손.**
  `[번들]` Copilot이 읽는 자리는 `~/.copilot/mcp-config.json`이다. 근거 둘:
  `--mcp-config` 도움말 *"augments config from ~/.copilot/mcp-config.json for this session"*,
  그리고 설정 이름 목록 `WMi = ["config.json","config","mcp-config","lsp-config",
  "permissions-config","copilot-instructions.md","mcp-oauth-config","hooks"]` (`app.js`).
  `[측정]` 이 호스트에 그 파일은 **없고** `~/.copilot/servers/`도 비어 있다.
  `[코드]` **선례가 이미 리포에 있다** — `run.sh:206` `install-agy-bridge`:
  *"agy MCP install adapter — register ONE entwurf-bridge server in the agy mcp_config
  (adopt file / create / REFUSE symlink), stable bin command, install-state under
  `$XDG_DATA_HOME/entwurf/agy-bridge/`"*. 구현은 `scripts/agy-bridge-config.py` +
  `scripts/agy-bridge.sh`. 방금 `agy-statusline-*` → `copilot-statusline-*` 포팅을 한 것과
  **정확히 같은 모양**이다: adopt / create / REFUSE-symlink / preimage / 정직한 닥터.
  - 새 verb 3종 + smoke: `install|uninstall|doctor-copilot-mcp`, `smoke-copilot-mcp-state`
  - 서버 이름은 **하나**, bin은 stable, state는 `$XDG_DATA_HOME/entwurf/copilot-mcp/`
  - 검증 leaf는 이미 있다 — `run.sh probe-bridge-command` (초기화 후 tools/list만, 호출 없음)
  - **이것이 닫히면** GLG가 Copilot 안에서 `entwurf_peers` / `entwurf_v2` /
    `entwurf_inbox_read`를 부를 수 있다. 즉 **Copilot이 형제를 보고 말을 건다.**

- **Next 2 — RAIL 6, 알림. 구현 전에 측정.**
  `[번들]` Copilot `HookType` enum(`schemas/api.schema.json`)에
  **`agentStop`이 있다** — 17종: `preToolUse` `preMcpToolCall` `postToolUse`
  `postToolUseFailure` `userPromptSubmitted` `userPromptTransformed` `sessionStart`
  `sessionEnd` `postResult` `prePRDescription` `errorOccurred` **`agentStop`**
  `subagentStart` `subagentStop` `preCompact` `permissionRequest` `notification`.
  `[측정]` 어제 관측한 발화 순서에 `agentStop`이 실제로 들어 있었다
  (`userPromptSubmitted` → `sessionStart` → `agentStop`).
  `[코드]` 우리 유닛은 지금 둘만 선언한다 —
  `pi/meta-bridge-copilot/entwurf-meta-receive-copilot/hooks/hooks.json`:
  `sessionStart`, `userPromptSubmitted`. 플러그인 hooks.json이 HookType 이름을 그대로 쓰므로
  `agentStop` 추가는 **문법적으로 가능해 보인다** — 그러나 이것은 `[제안]`이지 측정이 아니다.
  - 재야 할 것 셋: ① `agentStop`이 **플러그인 선언 훅으로도** 발화하는가
    ② 그 봉투에 `session_id`가 실리는가 ③ stdout/exit가 오퍼레이터에게 **보이는가**
    (Claude는 Stop-hook feedback으로 보인다. Copilot이 무엇을 보여주는지는 모른다)
  - 셋 다 초록이면 Copilot은 **"편지 왔다"까지 도달한다.** 유휴 깨우기(D4)는 아니다 —
    턴이 끝나야 발화하므로 GLG가 뭐라도 쳐야 한다. **그 차이를 문서에 정직하게 쓴다.**

- **Next 3 — RAIL 7, 등급 정정.** 아래 "지금 거짓인 문장" 절.

- **Blocker.** 없음. 형제 전원 퇴근. 워크트리 clean, 브랜치 `issue-82-copilot-citizen` = `79a77ea`, **푸시 안 함**.
- **Read.** 이 파일 → #82 스레드 **전문**(본문은 2026-08-19 스냅샷이고 스스로 그렇게 말한다;
  본문과 스레드가 어긋나면 **스레드가 이긴다**) → `scripts/agy-bridge-config.py` + `scripts/agy-bridge.sh`.
- **Do not touch.** 아래 전용 절.

# 지금 거짓인 문장 — RAIL 7이 고칠 것

문서가 오늘의 측정보다 뒤에 있다. 고치기 전에는 인용하지 마라.

| 위치 | 지금 쓰여 있는 것 | 오늘의 사실 |
|---|---|---|
| `DELIVERY.md:85` | *"**LIVE birth unproven** … No record has yet been minted by a real Copilot session"* | `[측정]` 2026-08-21 09:15 실제 Copilot 세션이 `20260821T091514-fb50b4`를 발행했다. **입증됨** |
| `DELIVERY.md:85` | *"No doorbell exists in the bundle (`FileChanged`, `asyncRewake`, `watchPaths` all absent)"* | 그 셋은 여전히 없다 ✓. 그러나 이 문장이 **`agentStop`의 존재를 가린다.** 없는 것은 **유휴 깨우기**이지 훅 전부가 아니다 |
| `pi/entwurf-capabilities.json` | `copilot: { wakeMode: "direct-inject", deliveryLevel: "D0" }` | `direct-inject`는 **주입할 통로가 없는데** 그렇게 적혀 있다. RAIL 5·6의 결과에 따라 등급과 wakeMode를 같이 정한다 |
| `run.sh:201` · `scripts/copilot-bridge-install.sh:174` | *"NO MCP wiring — this backend has no doorbell and no delivery"* | 배달이 없는 것과 **MCP 손이 없는 것은 다른 사실이다.** RAIL 5가 닫히면 앞 절반만 참이 된다 |

# 증거 규약

`AGENTS.md:131`이 정본이다(*"Carry evidence state on every factual sentence that crosses to someone else"*).
이 레인이 2026-08-19~20에 세 번 엎어진 원인이 **판단이 아니라 전달**이었고, 그래서 생겼다.
운영용 태그표만 여기 둔다:

| 태그 | 뜻 | 받은 쪽이 할 일 |
|---|---|---|
| `[측정]` | 직접 실행/관측. **영수증 이름이 같이 적힌다** | 영수증을 연다 |
| `[코드]` | 이 리포에서 `file:line`으로 읽음 | 그 줄을 연다 |
| `[번들]` | 외부 산출물(Copilot 번들 등)에서 읽음. 경로가 적힌다 | 경로를 연다 |
| `[미검증]` | 물려받은 **사실 주장**, 미확인. 출처를 밝힌다 | **인용 전에 직접 잰다** |
| `[제안]` | 사실이 아니라 **설계 판단**. 낸 사람을 밝힌다 | 재는 게 아니라 **채택하거나 다르게 결정한다** |

`[미검증]`과 `[제안]`을 섞지 마라. 미검증 사실은 재면 올라가지만, 설계 제안은 재서 올라가는 게 아니다.

# 살아남은 측정 — 펜스의 근거

게이트가 덮는 사실은 게이트가 정본이므로 여기서 뺐다. 아래는 **게이트가 없고 펜스를 지탱하는** 것들이다.

**`[번들]` 유휴 깨우기가 없다.** claude-code의 D4를 성립시키는 셋
(`FileChanged` + `asyncRewake` + `watchPaths`)이 Copilot 1.0.80 번들에 **없다**.
그 문자열들은 `TerminalCwdChangedAction`/`WorkspaceFileChangedData`이지 훅 이름이 아니다.
→ **Copilot은 잠든 채로 깨어날 수 없다.** RAIL 8이 벤더 대기인 이유이자 배달 어댑터 금지의 근거.
**이 펜스의 범위는 D4까지다** — `agentStop`(턴 끝 알림)은 이 문장이 부정하는 대상이 아니다(RAIL 6).

**`[측정]` `sessionStart`는 첫 프롬프트에 지연 발화한다.** TUI를 열면 세션은 등록되지만 훅은 0발이다
(등록 11:17:19.920Z, 3분 유휴, 훅 줄 0, `Session: 0 AIC used`). 첫 프롬프트에서
`userPromptSubmitted`(11:20:29.476Z) → `sessionStart`(11:20:32.102Z) → `agentStop`.
벤더 스키마 설명(*"when a session starts or resumes"*)과 **관측이 다르다.**
→ **Copilot 시민은 창을 열 때가 아니라 첫 프롬프트에 태어난다.** 상태바가 출생 전에 `?`를 찍는 근거.

**`[번들]` statusline 계약면은 두 줄이 전부다.** stdin JSON에 `session_id`가 있고,
stdout 한 줄이 슬롯에 들어가며 **exit 0이어야 한다**. nonzero면 Copilot이 슬롯을
**조용히 빈 문자열로** 만들고 오퍼레이터에게 아무것도 안 보여준다(`app.js` `Hxi`/`Gxi`/`YPn`).
→ 렌더러가 봉투의 다른 키를 읽지 않는 이유(버전 방어), 그리고 fail-quiet 가드 두 개가 있는 이유.

**`[번들]` `exec`는 string이어야 하고 `args` 키가 없다.** 배열 `exec`는 프롬프트 전 플러그인
로드 시점에 거절된다. 그래서 Copilot 훅은 **항상 argc=0**이고, 전용 런처는 argv를 요구하지 않는다.

**`[번들]` MCP 설정 자리는 `~/.copilot/mcp-config.json`이다.** `--mcp-config` 도움말이
*"augments config from ~/.copilot/mcp-config.json for this session"*이라 말하고,
설정 이름 목록 `WMi`에 `mcp-config`가 `config.json`·`permissions-config`·`hooks`와 나란히 있다.
`preMcpToolCall` 훅 타입이 따로 있는 것도 MCP가 1급 표면이라는 방증이다.
→ RAIL 5의 좌표.

# 은퇴한 주장 — 되살리지 마라

사람이 아니라 주장을 적는다. 오른쪽이 은퇴시킨 영수증이다.

| 은퇴한 문장 | 은퇴 근거 |
|---|---|
| ~~"훅이 한 번도 안 돌았다 / 어휘 불일치가 원인"~~ | `[측정]` Copilot 로그가 우리 플러그인을 호명하고 `Hook command failed with code 1` |
| ~~"`args` 하나가 문제"~~ | `[측정]` argv만 떨어짐. **stdin 봉투는 도착** |
| ~~"codex가 시민화 선례"~~ | `[측정]` codex도 레코드 0건 |
| ~~"`api.schema.json` 17개가 선언형 훅 어휘"~~ | `[번들]` 계층이 다르다. 선언형 settings 스키마는 15개 |
| ~~"레코드의 `model`을 statusline 봉투로 채울 수 있다"~~ | `[코드]` 훅 봉투에 model이 없다(`meta-bridge-hook-copilot.ts:100-169`). statusline 봉투는 **다른 봉투**다. `null`이 정직하다 |
| ~~"오늘 사고는 게이트 구멍이다"~~ | `[측정]` `doctor-meta-bridge`가 원인과 처방을 정확히 말하고 있었다. 빈 곳은 **절차**였다 |
| ~~"Copilot에는 도어벨이 아예 없다"~~ | `[번들]` 없는 것은 **유휴 깨우기**(`FileChanged`/`asyncRewake`/`watchPaths`)다. `HookType`에 `agentStop`·`postResult`·`notification`이 있고 `agentStop`은 발화가 관측됐다. 범위를 D4로 좁혀 다시 쓴다 |

# Do not touch

- **ACP 재개** — `copilot --acp`, `copilotAdapter`, `AcpBackendAdapter`. 폐기됨.
  `[코드]` `ROADMAP.md:21`이 중복 구현 금지를 명문화했고 `#56`이 그 이유로 CLOSED.
- **`--ui-server` / loopback / `~/.copilot/run/ws.*`** — 거절 유지.
- **배달 어댑터 · watcher · `FRESH_CALL_BACKENDS` 항목** — 유휴 깨우기가 없다.
  출생과 배달을 한 입학으로 묶지 마라. **RAIL 5(MCP 손)는 여기 해당하지 않는다** —
  그건 Copilot이 *나가서* 부르는 손이지, 우리가 *들어가서* 깨우는 통로가 아니다.
- **형제 레일 파일 편집** — `scripts/meta-bridge-statusline.sh`(Claude 닥터가 그 출력을 판정한다,
  `scripts/meta-bridge-doctor.sh:566`) · `scripts/agy-statusline*.sh` · `scripts/agy-statusline-config.py` ·
  `scripts/agy-bridge-config.py` · `scripts/agy-bridge.sh`.
  **읽고 베끼되 고치지 마라.** 2026-08-21에 형제 레일이 실제로 한 번 멈췄다.
- **`META_BACKENDS`를 건드린 뒤 형제 재배포를 건너뛰기** — 그것이 그 사고였다.
  `AGENTS.md` Hard Rule 7과 `VERIFY.md` setup 절이 이제 그렇게 말한다(`79a77ea`).
- **`[QK:]` 뮤턴트를 statusline에 붙이기** — `[측정]` `smoke-agy-statusline-state.sh`에 QK 0개.
  형제에 없는 걸 Copilot에만 붙이면 특별 취급이다.
- **`check-gate-qualification`을 개발 루프에서 돌리기** — 22분. CI가 push마다 돈다.
  루프는 `pnpm run check`(40s) + 건드린 주제의 focused 게이트.
- **Copilot LIVE 모델 턴 추가** — GLG 승인 사안.
- **`scripts/raw-async-delivery/copilot-ui-server-probe.mjs` 삭제·실행** — 보존만.
- **CHANGELOG 수정** — 발행 기록이다.

# RECENT — 2026-08-21

**`[측정]` §6 인수 통과.** 레코드 `20260821T091514-fb50b4` · `backend:"copilot"` · v3 ·
`nativeSessionId c35a92d0-…`. `entwurf_peers`에 시민(`liveness=unsupported`).
footer에 `🪛 20260821T091514-fb50b4 cop` 렌더. **0.26 AIC**(auto → MAI-Code-1.1-Flash) —
측정 턴이 8.9354 AIC였으니 GLG가 노린 비용 레버가 실제로 걸렸다.

**`[측정]` 사고 1건 — 백엔드 등록이 형제 레일에 배포 의무를 만들었다.**
Copilot 시민이 태어난 직후 **Claude Code 레일이 meta-record를 못 쓰게 됐다.**
배포된 Claude 플러그인의 `META_BACKENDS`가 `claude-code|antigravity|codex`로 낡아
copilot 레코드를 인증 못 했고, Claude 훅은 쓰기 전에 store **전체**를 인증하므로
자기 레코드까지 거절했다. 파괴는 없다(쓰기 거절만). 파급은 **한 레일** —
pi(`00:21:09`)·copilot(`00:19:46`)은 계속 썼고 claude-code만 `00:10:31`에서 멈췄다.
`./run.sh install-meta-bridge` 재배포로 수리, `00:27:22` 정상 복귀 확인, 양쪽 닥터 PASS.
거절문이 주던 틀린 처방(*"fresh-cut 하라"* → 멀쩡한 418건을 아카이브할 뻔했다)은
`79a77ea`가 고쳤고, `check-meta-session`이 unknown-backend 이웃으로 그것을 박았다.

**`[측정]` 착지한 커밋** — `4651d99`(게이트 `[QK:]` 시그니처 수리) · `0aed67d`(footer 드라이버) ·
`91986c2`(statusline 설치면 · 15-check smoke) · `79a77ea`(stale reader 거절문 · 게이트 · 문서).
앞 둘은 푸시됨. **뒤 둘은 로컬**.

**`[측정]` 게이트** — `pnpm run check` 44s exit 0 · `smoke-copilot-statusline-state` 15 checks ·
`check-meta-session` 25 assertions · `check-copilot-statusline` 22 assertions. 전부 초록.

# LEDGER

- 서사·영수증 정본: [#82 스레드](https://github.com/junghan0611/entwurf/issues/82) —
  특히 comment `5363685118`.
- 출생 구현의 결정 근거(유닛 분리 · hooks 형식 · 런처 · 봉투 · `wakeMode` · `deliveryLevel` ·
  설치/닥터 분리)는 **코드와 게이트가 정본**이다:
  `pi/meta-bridge-copilot/` · `pi-extensions/meta-bridge-hook-copilot.ts` ·
  `scripts/copilot-bridge-install.sh` · `scripts/copilot-bridge-doctor.sh` ·
  `scripts/check-copilot-birth-hook.ts` · `scripts/check-copilot-statusline.ts` ·
  `scripts/mutants/copilot-birth.json`.
- 설치면(RAIL 4)의 정본: `scripts/copilot-statusline-bridge.sh` ·
  `scripts/copilot-statusline-config.py` · `scripts/smoke-copilot-statusline-state.sh`.
- RAIL 5가 베낄 선례: `scripts/agy-bridge-config.py` · `scripts/agy-bridge.sh` · `run.sh:206`.
- 백엔드 등급의 정본: `pi/entwurf-capabilities.json` (게이트 `check-entwurf-capabilities`).
- 이 레인의 전체 로그는 `~/.local/share/entwurf-salvage/`에 있고 **호스트 로컬**이다. git에 없다.
  다른 기기에서는 그 인용을 `[미검증]`으로 강등하고, 이 파일에 박힌 원문만 `[측정]`으로 취급하라.
