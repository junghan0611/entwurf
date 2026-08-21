# NEXT — #82 Copilot garden id 시민화 (branch lane)

> **이 주제의 산문은 이 파일 하나다.** 머지 전 삭제하는 disposable이다.
> 서사와 영수증은 이슈 스레드가 정본이다 — 특히
> [#82 comment 5363685118](https://github.com/junghan0611/entwurf/issues/82#issuecomment-5363685118)
> (인수·산출물·사고·남은 일). 여기는 **다음 한 걸음**만 든다.

레인: **Copilot이 garden id를 가진 가든 시민이 된다.** 근거는 GLG가 #82에 직접 쓴
코멘트 `5352330620` (2026-08-20T06:37:33Z) — GitHub 쪽을 맡기고 `auto`를 비용 레버로 쓴다.

---

# RAIL — 현재 좌표

- [x] **1. 측정 · 신뢰 규약** — Copilot 1.0.80 번들/훅 실측, 증거 태그 규약 수립
- [x] **2. 출생 구현** — 레지스트리 · 훅 유닛 · 설치/닥터 · 게이트. 코드로 들어갔다
- [x] **3. §6 인수** — 실제 Copilot 세션이 시민이 됐고 footer에 자기 id를 찍는다
- [ ] **4. 설치면 재현·역방향** ← CURRENT: statusLine 설정이 손으로 쓰여 있고 state가 없다
- [ ] **5. 배달(delivery)** ← PAUSED: 번들에 도어벨이 없다. 출생과 별개 입학이다

현재 좌표: 3 완료 → 4 진행 중(형제 둘) → 5 보류

# NOW

- **Current.** 출생은 끝났다. 남은 건 **설치면**이다. `~/.copilot/settings.json`의
  `statusLine` 항목을 2026-08-21에 **사람이 손으로** 넣었고 state 파일이 없다 →
  **재현 불가, 역방향 불가.** agy가 같은 모양을 이미 풀어놨다.
- **Next.**
  1. Copilot `statusLine` config adapter + 최초 1회 preimage.
     regular 파일은 **adopt**(지금 손으로 쓴 값이 첫 시험이다), symlink/corrupt는 REFUSE,
     무관한 footer 토글은 보존. 선례 `scripts/agy-statusline-config.py:89-127`, `:137-163`.
  2. `install` / `uninstall` / `doctor-copilot-statusline` **독립 verb**.
     plugin lifecycle과 개인 settings preimage는 생애가 다르므로 bridge 인스톨러에 섞지 않는다.
     **Copilot엔 지금 uninstaller가 아예 없다**(`run.sh:5167-5183`).
  3. hermetic install→doctor→inverse smoke. Copilot 실행 0회, 모델 턴 0회.
     선례 `scripts/smoke-agy-statusline-state.sh` (adoption `:87-100`, drift `:121-143`,
     inverse `:147-155`, symlink `:157-178`).
  4. statusline 닥터 빨강 정책 — **우리 state가 있을 때만** drift/symlink/`showCustom:false`/
     bin 미해결이 RED. state가 없으면 "not ours" note. 남의 개인 설정을 실패라 부르지 않는다.
     선례 `scripts/agy-statusline-bridge.sh:87-145`.
  5. **배포 의무를 절차에 박기** — 아래 RECENT의 사고가 그 이유다.
     거절문 오진(`pi-extensions/lib/meta-session.ts:959-961`)도 같이 고친다.
- **Blocker.** 없음. 4-1~4-4는 terra(`20260821T082232-68d7bb`), 4-5는 grok(`20260821T075408-01031a`)
  가 진행 중이며 **파일이 겹치지 않게** 나눠져 있다(아래 Do not touch).
- **Read.** 이 파일 → #82 스레드 **전문**(본문은 2026-08-19 스냅샷이고 스스로 그렇게 말한다;
  본문과 스레드가 어긋나면 **스레드가 이긴다**) → agy statusline 3종 원본.
- **Do not touch.** 아래 전용 절.

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

**`[번들]` 도어벨이 없다.** claude-code의 `self-fetch`를 성립시키는 셋
(`FileChanged` + `asyncRewake` + `watchPaths`)이 Copilot 1.0.80 번들에 **없다**.
그 문자열들은 `TerminalCwdChangedAction`/`WorkspaceFileChangedData`이지 훅 이름이 아니다.
→ **Copilot은 `self-fetch`가 될 수 없다.** RAIL 5가 보류인 이유이자 배달 어댑터 금지의 근거.

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

# Do not touch

- **ACP 재개** — `copilot --acp`, `copilotAdapter`, `AcpBackendAdapter`. 폐기됨.
  `[코드]` `ROADMAP.md:21`이 중복 구현 금지를 명문화했고 `#56`이 그 이유로 CLOSED.
- **`--ui-server` / loopback / `~/.copilot/run/ws.*`** — 거절 유지.
- **배달 어댑터 · watcher · `FRESH_CALL_BACKENDS` 항목** — 도어벨이 없다. 출생과 배달을 한 입학으로 묶지 마라.
- **형제 레일 파일 편집** — `scripts/meta-bridge-statusline.sh`(Claude 닥터가 그 출력을 판정한다,
  `scripts/meta-bridge-doctor.sh:566`) · `scripts/agy-statusline*.sh` · `scripts/agy-statusline-config.py`.
  읽고 베끼되 고치지 마라. **2026-08-21에 형제 레일이 실제로 한 번 멈췄다.**
- **`[QK:]` 뮤턴트를 statusline에 붙이기** — `[측정]` `smoke-agy-statusline-state.sh`에 QK 0개.
  형제에 없는 걸 Copilot에만 붙이면 특별 취급이다.
- **`check-gate-qualification`을 개발 루프에서 돌리기** — 22분. CI가 push마다 돈다.
  루프는 `pnpm run check`(40s) + 건드린 주제의 focused 게이트.
- **Copilot LIVE 모델 턴 추가** — GLG 승인 사안.
- **`scripts/raw-async-delivery/copilot-ui-server-probe.mjs` 삭제·실행** — 보존만.
- **CHANGELOG 수정** — 발행 기록이다.

## 지금 나뉜 파일 경계 (형제 둘 동시 작업 중)

- **terra** — 신규 `scripts/copilot-statusline-*` · `run.sh` · `package.json`
- **grok** — `pi-extensions/lib/meta-session.ts`(메시지 문자열) · `AGENTS.md`/`VERIFY.md`/`DELIVERY.md`
- 상대 파일을 건드려야 하면 **코디네이터에게 먼저 묻는다.**

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

두 가지를 남긴다:
1. **거절문이 틀린 처방을 준다.** *"fresh-cut 하라"* 는 레코드가 썩었을 때의 처방인데,
   여기서는 레코드가 멀쩡하고 **읽는 쪽이 낡았다.** 따랐으면 멀쩡한 418건을 아카이브했다.
2. **오라클은 이미 답을 갖고 있었고 아무도 안 물었다.** `doctor-meta-bridge`가
   `deployed writer STALE … Run ./run.sh install-meta-bridge`라고 정확히 말한다.
   → 빈 곳은 게이트가 아니라 **절차**다. RAIL 4-5가 그것이다.

**`[측정]` 착지한 커밋** — `4651d99`(게이트 `[QK:]` 시그니처 수리, CI run 32421631735을 죽였던 것) ·
`0aed67d`(footer 드라이버). 푸시됨.

# LEDGER

- 서사·영수증 정본: [#82 스레드](https://github.com/junghan0611/entwurf/issues/82) —
  특히 comment `5363685118`.
- 출생 구현의 결정 근거(유닛 분리 · hooks 형식 · 런처 · 봉투 · `wakeMode` · `deliveryLevel` ·
  설치/닥터 분리)는 **코드와 게이트가 정본**이다:
  `pi/meta-bridge-copilot/` · `pi-extensions/meta-bridge-hook-copilot.ts` ·
  `scripts/copilot-bridge-install.sh` · `scripts/copilot-bridge-doctor.sh` ·
  `scripts/check-copilot-birth-hook.ts` · `scripts/check-copilot-statusline.ts` ·
  `scripts/mutants/copilot-birth.json`.
- 이 레인의 전체 로그는 `~/.local/share/entwurf-salvage/`에 있고 **호스트 로컬**이다. git에 없다.
  다른 기기에서는 그 인용을 `[미검증]`으로 강등하고, 이 파일에 박힌 원문만 `[측정]`으로 취급하라.
