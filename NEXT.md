# NEXT — 0.14.2 prepared and gate-green · OPEN 5 live contracts

> NEXT는 disposable boot sector다. 완료 이력은 CHANGELOG/closed issues/git이 지고,
> 방향은 ROADMAP, 운영 규율은 AGENTS가 진다.

# RAIL — 현재 좌표

- [x] **1. 0.14.0 release/publish + close audit** — tag `v0.14.0`=`95d1c72`; npm `latest=0.14.0`
- [x] **2. 완료 이슈 종결** — #69/#70 close, #57 supersession ledger 후 close; OPEN 18→15
- [x] **3. durable carrier 정비** — `830226b` push; ROADMAP/AGENTS/NEXT/mux rail 현재화
- [x] **4. manual issue sweep** — #72 생성 + 오래된 12건 redirect/close
- [x] **5. #73 cross-repo fresh cwd** — main `ff46502` / feat `0059fe2`; LIVE scratch OK; issue CLOSED
- [x] **6. 0.14.1 prepare** — `6a1df33`; release-gate MUST 20/0 (`j2eAVu`); Sol SHIP-AFTER-FIX
- [x] **7. make 0.14.1** — tag `v0.14.1`=`6a1df33`; CI run 31677847479 all success; candidate accepted; GH release live
- [x] **8. publish 0.14.1** — npm latest=0.14.1 (2026-08-13)
- [x] **9. #79 dependency baseline** — Pi 0.84.2 + Claude ACP 0.68.0 first certify; issue CLOSED
- [x] **10. #81 ACP support + exact bridge invocation** — Claude ACP 0.70.0; `877f127`/`130b09b` merged at `d0fb8e6`; issue CLOSED
- [x] **11. 0.14.2 prepare** — `347c783`+`5a09f3d`+prep; release-gate MUST 21/0/0, BEHAVIOR 1/0/0, `cut: OK`
- [ ] **12. 0.14.2 make** ← CURRENT: push prepared HEAD → exact-SHA CI → candidate → tag/release

현재 좌표: **0.14.2 prepare 완료** · MUST 21/0/0 `cut: OK` · make 대기 · OPEN 5

# NOW — 0.14.2 make

- **Release scope:** ACP EOF-first child-end evidence, Pi 0.84.2 / Claude ACP 0.70.0 support coordinates, exact MCP `{command,args,env}` + sequential initialize, stdin EPIPE/stderr preservation, Copilot raw-probe evidence without admission.
- **Candidate:** prepared HEAD carries the model-cost defaults (`347c783`), the archived-demo notes (`5a09f3d`), and the release-record commit. `package.json` is already `0.14.2`.
- **Accepted evidence (2026-08-20):** qualification **185/185**, `pnpm run check:full` 207s standalone / 209s in-gate, `LIVE=1 ./run.sh release-gate /tmp/entwurf-release-gate-0.14.2.c5VqTP --cut` → **MUST PASS=21 FAIL=0 SKIP=0**, **BEHAVIOR PASS=1 FAIL=0 SKIP=0**, `cut: OK`. Log SHA-256 `27346d86be4a1a96a8ea8cab97687fcce807e4fa4bd6e3d179b91f85dbbcbe53`.
- **Cost decision (2026-08-20, GLG):** live-spend defaults are `openai-codex/gpt-5.6-luna` and the LIVE gate was re-earned on that default — `smoke-entwurf-chain-live` and `smoke-mux-lifecycle-live` both passed with it, so it is proven rather than assumed. Fixture model strings stay untouched. agy runs free-tier `gemini-3.6-flash`, never Pro. Cortex has no subscription and no free tier on this host, so its LIVE smoke is a permanently ABSENT axis — record the SKIP, never soften it.
- **Next:** `/entwurf-release make 0.14.2` — push prepared HEAD, require exact-SHA CI (`check`, `install-surface`, `artifact-consumer`), create and accept ONE preserved candidate, then tag `v0.14.2`, stamp, and cut the GitHub release. `publish` is a separate authority boundary after that.
- **Open 5:** #72 ACP retained-child cause · #76 subscription-first / refuse `openrouter/*` · #78 macOS/native-Windows portability · #80 public vocabulary · #82 Copilot admission.
- **Do not touch:** re-running the LIVE gate to "refresh" green (it is accepted), Copilot substitute or managed backend before #82 admit, automatic replay/watcher/supervisor, OpenRouter test turn, macOS/Windows support wording without physical evidence.

# RECENT

- **2026-08-19:** live release gate first caught a relocated pnpm shim in `~/.local/bin`; host launcher repair restored exact bridge boot, bundled MCP 14/14, and v2-send 15/15. The same incident added a kill-qualified early `doctor-pi-provider` release preflight (release-gate lane 12; total 185 mutants). Remaining chain/mux failures are provider usage-limit responses, not source defects.
- **2026-08-19:** main `d0fb8e6` combined #81 exact-invocation probing, EPIPE repair, and Copilot raw probe; exact-SHA CI run 32230953648 all success. Combined qualification 184/184 and full floor green before release prep.
- **2026-08-16:** #72 EOF-first diagnostic repair `df7525f` landed; #60/#75 closed; #79 dependency baseline landed.
