# NEXT — main: #50 hard-cut 랜딩 이후

> NEXT는 부트 섹터다. 닫힌 역사는 CHANGELOG/git/이슈에, 장기 방향은 ROADMAP/이슈에 둔다.
> (0.12.8-repair.1 릴리즈 레인의 옛 원장과 #51 doctor/harness 진단 변천은 이 파일의 git history와 #50·#51에 보존되어 있다.)

## NOW

- **[2026-07-24] `repair/v2-core-debt`(93+ 커밋) merge in — #50 hard-cut 완료.** meta-record가 유일한 주소 권위(V3-only), entwurf는 socket을 모른다(내부 transport일 뿐), pi 네이티브(GPT 구독)와 ACP 클로드 모두 record 시민으로 발신·수신한다. M1 migrate CLI(85단언 게이트) + H7 라이브 전환(194 v3, 양방향 왕복 실증) + pi 0.82.0 / claude-agent-acp 0.61.0 / ACP SDK 1.3.0 uplift + 업그레이드 하네스 3셀 확장까지 이 merge에 들어 있다. **작업기 전체는 [#50 작업기 코멘트](https://github.com/junghan0611/entwurf/issues/50)**, 증거 원장은 BASELINE HISTORY(`cbda097` 항목)와 CHANGELOG/git. 브랜치는 참고용으로 보존(삭제 금지 — GLG).
- **⚠️ 이 main을 pull하는 pre-cut 개발 PC는 호스트당 1회 V3 마이그레이션이 필요하다.** 순서: 그 호스트 세션 quiesce → pull → `entwurf meta-bridge-migrate-v3 verify`(읽기 전용) → `… migrate`(백업 자동) → `setup` → 재개. `setup`/`install`/`install-meta-bridge` 세 진입점이 pre-cut store를 **쓰기 전에 REFUSE**하고 처방을 인쇄한다 — 3축: pre-cut만이면 migrate, problem이 섞였으면 **복구 먼저**, problem만이면 migration 아님(README migration 절 + `check-upgrade-gate` 3셀이 증명). `--drop-parentage`는 언제나 운영자의 명시 결정이다.
- **🔴 release 차단 관측 — 번들 MCP readiness race.** `LIVE=1 release-gate`가 MUST red를 낼 수 있다(`cbda097`에서 16/1/0 — 유일 FAIL이 이 race). 인과가 서기 전에는 고치지 않는다(GLG 결정). 구조 판독·처방 3안·표본 원장은 **ROADMAP 「🔴 OPEN — 번들 MCP readiness race」**가 SSOT — 재발 시 그곳에 시각·부하·스모크·모델 발화를 누적한다.
- **release lane (0.12.8-repair.1, 방아쇠는 GLG):** `land`(pre-version HEAD push + exact-SHA CI) → `prepare`(CHANGELOG 재승격 — repair.0 이후 전체, hard-cut 포함) → `make`(LIVE 재획득 필수 — 위 race red의 해소 또는 GLG 명시 판정 필요) → `publish`(`repair` dist-tag만; **`latest=0.12.7` 유지 확정**). 현재 npm의 `repair=0.12.8-repair.0`은 배달 불능 바이트로 불변 존재 — 새 publish까지 신규 설치자는 그걸 받는다. maintainer 호스트 installed doctor rc=1은 구판 설치의 기대 상태(클린 재설치 후에만 GREEN).
- **컷 불변(재론 금지):** Claude floor `>=2.1.217`(SSOT는 `package.json` `entwurf.claudeCodeFloor` 파생) · Linux 유일 certified axis(Darwin은 installer 거부 + doctor NOT CERTIFIED) · Node 24+ 단일 지원축.

## BLOCKED RETURN — #49

1. ~~**C — fresh mint와 strict resume 분리.**~~ **폐기 (2026-07-24, #50 hard-cut이 주제 자체를 삭제).** C가 겨눈 rail이 더는 없다: `--session-id` 주입·marker 사슬·header-scan·`smoke-session-id-name`은 C2/C3가 삭제했고, resume 권위는 meta-record다(`record.transcriptPath` → `--session <절대경로>`, 헤더↔`nativeSessionId` 검증 게이트 포함). #49 본문 §C와 §C 최종 범위 코멘트는 역사 기록으로만 남는다.
2. **E — floor purity.** 설계 SSOT는 **#41의 두 코멘트**(본 설계 + 실기기 보정). 첫 전체 floor 실행은 green이 목표가 아니라 **churn 카탈로그를 뽑는 관측 실행**이고, RED는 데이터다.

## RECENT

- **[2026-07-24] #50 hard-cut 브랜치 merge** — 위 NOW 첫 항목. 검수 세션(오푸스→GPT 교차검수 4라운드→페블 최종)의 상세와 F8 legibility 수선(`cbda097`)까지 #50 작업기에 있다.
- **[2026-07-13] evidence boundary:** 동일 agy pid에서 여러 conversation이 동시에 model invocation을 수행하면 단일 marker가 last-writer로 덮인다. 현재 agy의 process-per-session·직렬 invocation에 기대며, 같은 pid 동시성은 지원하지 않는다.
- **수동 항목:** `smoke-meta-async-drift`는 외부 바이너리 pin에 의존해 CI에 못 넣는다. 컷 체크리스트의 수동 항목 (2026-07-14 green: claude 2.1.208 / codex 0.144.1 / agy 1.1.2).

## AFTER

1. **#47 mux launch rail — 0.12.x.** 착수 전 `docs/mux-launch-rail.md`를 읽는다.
2. **#48 cortex — 0.13.0.** PR #40은 PARK. mux 기반과 backend adapter 검증이 선 뒤에만 연다.
3. **Meta sender 모델 표기 — 비차단.** `agentId=meta-session/<backend>`는 `AGENTS.md` 계약대로 정상이다. 모델 표시는 agentId를 바꾸지 말고 optional display field로 별도 설계한다.
4. **장기 항목 원장은 ROADMAP** — 「repair/v2-core-debt 승격분」(loader alias, identity 계약 cut, 기계가 말하는 장치, agy live smoke, C4 tail, hooksPath 결정, sentinel 봉인 한계)과 「🔴 OPEN — 번들 MCP readiness race」.
