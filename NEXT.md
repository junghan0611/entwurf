# NEXT — OMP as one garden sibling (실무 잠수함)

> NEXT는 disposable boot sector다. 완료 이력은 issue/git이 지고, 방향은 ROADMAP,
> 운영 규율은 AGENTS가 진다. 새 하네스 입학 경로는
> [docs/adding-a-harness.md](./docs/adding-a-harness.md)다.

# RAIL — 현재 좌표

- [x] **1. OMP measurement·audit·LIVE + Bundle A admission hardening** — backend registration, TUI-only birth, visible status, native MCP hand, sender identity, four-root/package/doctor hardening 완료.
- [ ] **2. GLG operator deploy + real outbound acceptance** ← CURRENT: Bundle A는 branch에 commit됨; push/merge/deploy는 GLG 결정 대기.
- [ ] **3. Bundle B: addressed receive / roundtrip** ← PAUSED: 다른 harness → 이미 열린 OMP wake·receive는 Bundle A 범위 밖.
- [ ] **4. Bundle C: visible fresh + grade** ← PAUSED: `entwurf_fresh_call`로 OMP를 열고 LIVE 영수증 뒤에만 DELIVERY/registry grade 이동.

현재 좌표: 1 완료 → **2 GLG deploy·outbound LIVE 대기** → 3–4 보류.

# NOW

- **Stem:** OMP TUI 하나를 독립 형제로 세우되, 그 안의 서브에이전트에는 garden id를 주지 않는다.
- **Current:** Bundle A가 branch에 commit되었다. push/merge/deploy는 이 commit에서 실행하지 않으며 #87은 Bundle B/C 때문에 열린 채다.
- **Next — GLG 결정 뒤 3단 사다리:**
  1. shared reader를 rebuild/redeploy하고 `install-omp-bridge` 및 native MCP install을 검증한 뒤, 열린 OMP를 restart한다.
  2. 실제 OMP TUI 하나가 citizen 하나를 mint하고 실제 task subagent는 zero citizen임을 LIVE로 증명한다.
  3. 그 OMP citizen이 `entwurf_v2`로 이미 존재하는 다른-harness citizen에게 outbound message를 보내는 LIVE receipt를 남긴다.
- **Boundary:** Bundle A가 사는 것은 **OMP → others outbound**뿐이다. others → OMP addressed receive/reply와 fresh OMP는 아직 없다; supported-harness/grade 선언으로 앞당기지 않는다.
- **Read:** #87 thread · `docs/setup-clean-host.md` §4b · `docs/external-mcp-host.md` OMP row · `docs/adding-a-harness.md` steps 3, 3.5, 5, 6.
- **Do not touch:** Bundle B receive · Bundle C fresh/grade · README/setup support admission · DELIVERY/registry grade · push/deploy/install/restart without GLG.

# RECENT

- **2026-08-28:** #87 Bundle A source, package and doctor hardening reviewed independently; qualification and final deterministic floor were green on the final candidate. Branch commit is local-only; external #87 receipt holds durable review evidence.
- **2026-08-27:** OMP vendor measurement and real TUI/subagent observations closed the Bundle A admission basis. The per-harness docs retain installer/doctor boundaries; OMP is not yet a supported fresh/receive harness.

# CARRIED

- **#78** macOS/native-Windows portability — separate grant; do not mix into #87.
- **#72 #76** bugs and cortex gate slice — separate lanes.

# DURABLE LINKS

- #87: https://github.com/junghan0611/entwurf/issues/87
- Admission path: `docs/adding-a-harness.md`
- OMP operator boundary: `docs/setup-clean-host.md` §4b
