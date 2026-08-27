# NEXT — #86 Linux install honesty → 0.15.1

> NEXT는 disposable boot sector다. 완료 이력은 CHANGELOG/closed issues/git이 지고,
> 방향은 ROADMAP, 운영 규율은 AGENTS가 진다. #86의 durable chronology는 이슈 스레드다.

# RAIL — 현재 좌표

- [x] **1. 0.15.0 발행** — tag `v0.15.0`, npm `latest=0.15.0`, `repair=0.12.8-repair.1` 보존. #82 CLOSED.
- [x] **2. #86 구현 main 착지** — fast-forward `1a07972`, exact-SHA CI 3/3 (run 33039848738)
- [x] **3. ThinkPad source setup** — `./run.sh setup` 11/11 PASS, `~/.local/bin/entwurf` → 이 checkout
- [x] **4. prepare P4** — `pnpm run check:full` 252s exit 0 on the 0.15.1 versioned tree
- [ ] **5. prepare P5 LIVE** ← CURRENT after the docs-align commit: `LIVE=1 ./run.sh release-gate <scratch> --cut`
- [ ] **6. prepare commit** — `CHANGELOG.md` + `package.json` only (`chore(release): prepare v0.15.1`). No push.
- [ ] **7. make 0.15.1** ← needs explicit `/entwurf-release make 0.15.1`
- [ ] **8. publish 0.15.1 latest** ← needs explicit publish grant + candidate path + dist-tag
- [ ] **9. #86 close** ← GLG. This cut is the Linux install floor, not the issue close itself.

현재 좌표: 4 완료 → **5 진행** → 6 prepare commit → 7–9 별도 grant. macOS/native-Windows는 #78.

# NOW

- **Current — prepare 0.15.1.** Version and changelog body are already in the worktree (`package.json` 0.15.1). Terra pass 1 (gid `20260827T144051-dda234`): Blocker 0; NEXT/ROADMAP/ACP support-contract version were stale — those are this docs-align commit, not the prepare commit.
- **Next:** P5 LIVE gate from fresh scratch, write MUST/BEHAVIOR into CHANGELOG Verification, then the prepare commit. Red LIVE is a stop, not a skip.
- **Do not:** make/publish without a named grant · fold NEXT/ROADMAP/docs into the prepare commit · claim macOS/Windows support · close #86 without GLG.

# CARRIED — 이 레인 밖에서 닫을 것

- **#78 portability.** Linux install floor is the evidence #78 waits on. No macOS CI and no Windows front-door rewrite in 0.15.1.
- **cortex 게이트 슬라이스 수리 — 아직 미착지.** salvage patch exists; main에 별 커밋. 이 컷에 넣지 않는다.
- **OPEN:** #72 ACP retained-child, #76 subscription-first, #78 portability, #80 vocabulary, #83/#84/#85, #86 (this floor, close after publish). Cap 5 is currently exceeded; this cut does not sweep. #82 is CLOSED.

# DURABLE LINKS

- #86: https://github.com/junghan0611/entwurf/issues/86
- Landing CI: https://github.com/junghan0611/entwurf/actions/runs/33039848738
- Prepare skill: `.claude/skills/entwurf-release/SKILL.md`
