# NEXT — OMP as one garden sibling (실무 잠수함)

> NEXT는 disposable boot sector다. 완료 이력은 CHANGELOG/closed issues/git이 지고,
> 방향은 ROADMAP, 운영 규율은 AGENTS가 진다. 새 하네스 입학 경로는
> [docs/adding-a-harness.md](./docs/adding-a-harness.md)다.

# RAIL — 현재 좌표

- [x] **1. 0.15.1 Linux setup honesty** — tag `v0.15.1`=`0335eac`, npm `latest=0.15.1`, `repair=0.12.8-repair.1` 보존. #86 close.
- [ ] **2. OMP vendor measurement** ← CURRENT: issue **#87**, branch `issue-87-*` on **oracle**. `docs/adding-a-harness.md` step 1. 구현 없음.
- [ ] **3. Host-only birth fence** ← PAUSED: step 2 영수증 뒤. 보이는 OMP 세션 하나만 citizen. 서브에이전트는 garden id를 받으면 안 된다.
- [ ] **4. MCP hand → sender → receive → visible fresh** ← PAUSED: 입학 문서 5–9. 반쪽 지원으로 열지 않는다.
- [ ] **5. #78 portability** ← PAUSED: 0.15.1 Linux 설치 바닥은 깔렸다. macOS/native-Windows는 이 레인이 아니다.

현재 좌표: 1 완료 → **2 진행 (oracle, #87 브랜치)** → 3–4는 측정 영수증 + GLG 레인 grant 뒤. 5는 별도.

# NOW

- **Stem:** OMP 세션 하나를 형제로 불러, 코딩 실무를 그 안에서 잠수함처럼 돌리고 돌아오게 한다. 재는 것은 토큰이 아니라 **GLG 검수 홉 수**.
- **Next:** (1) oracle에서 `#87` 브랜치를 판다. (2) 실물 omp에서 step 1 다섯 측정 — hook 어휘·발화 시점, launch form/envelope, config writer, statusline/receive, parent topology. 각 측정에 artifact path 또는 영수증. (3) step 3.5 후보 discriminator(`mode === "tui"` vs `"print"`+`hasUI:false`)를 LIVE로 재측정. (4) 구현은 GLG가 레인을 열기 전까지 금지.
- **Blocker:** none (환경) — ThinkPad에 omp/18.0.0이 이미 있다. oracle에서 바이너리 존재부터 확인할 것. 없는 것은 측정 영수증과 레인 grant.
- **Read:** https://github.com/junghan0611/entwurf/issues/87 · `docs/adding-a-harness.md` §0 레인 선택, §1 측정, §3.5 citizen scope, §5 MCP dialect (OMP는 `mcp__entwurf_bridge_entwurf_v`로 계산됨 — live tool list가 수용 오라클), §6 inherited `PI_SESSION_ID`/`PI_AGENT_ID` 소독. `docs/external-mcp-host.md`.
- **Do not touch:** 서브에이전트를 citizen으로 민팅 · Claude MCP를 그대로 복제하는 두 번째 writer · 어설픈 부분 지원으로 입학 · 구현을 이 NEXT만으로 시작 · #78을 이 레인에 섞기 · main에서 OMP 구현.

# RECENT

- **2026-08-27 ThinkPad:** queue cut to cap. Closed #83 #80 #84. Opened #87. Fixed #85 (`mcp/tsconfig.json` re-declares exclude; orphan census 0). README install now leads with `entwurf setup`; per-unit installers are repair. keywords += copilot. HEAD after this handoff includes those commits. Next machine: oracle.
- **2026-08-27:** 0.15.1 published. `latest=0.15.1`, candidate sha256 `035f252a50caf7865c714b66cb30ed9c437b003c5f0002cec6175ee11a5d6efa` = registry shasum `18dbff7870a89191d21d362215049bdfc9bee98e`. CI run 33046461030 3/3.
- **2026-08-24 journal:** OMP는 Claude MCP를 가져온다. 그게 편해서가 아니라 위험해서 경계를 세운다. 형제 = omp 세션 하나. 그 안의 에이전트는 형제가 아니다.

# CARRIED

- **#78** macOS/native-Windows — 0.15.1이 Linux 설치 바닥. 구현은 #78 grant. OMP 다음.
- **#72 #76** — bugs. Fable later. Do not mix into #87.
- **cortex 게이트 슬라이스** — salvage patch, 별 커밋. OMP 레인에 넣지 않는다.
- **OPEN after #85 close:** #87 #78 #76 #72. Spare 1.

# DURABLE LINKS

- #87: https://github.com/junghan0611/entwurf/issues/87
- 입학 경로: `docs/adding-a-harness.md`
- 0.15.1: https://github.com/junghan0611/entwurf/releases/tag/v0.15.1
- #86: https://github.com/junghan0611/entwurf/issues/86
- #85: https://github.com/junghan0611/entwurf/issues/85
