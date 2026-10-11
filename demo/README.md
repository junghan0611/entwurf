# Recorded demos — source checkout recipes

## Whole Herdr: Pi ↔ native Claude Code (#138)

This is the scene shown by the [README GIF](../README.md). The recording is the **whole
Herdr client**, with sidebar and tabs, without captions. It observes a real Pi citizen
opening native Claude Code, receiving its callback, sending one task, and receiving the
sibling's native Bash result. Camera focus is a view, never an address or delivery receipt.

### Original publication versus a new take

[Original provenance](./herdr-pi-cc-20261011.provenance.json) records the approved GIF hash,
original cast hash, measured runtime/models, audited source hashes and render arguments.
The original raw cast, transcripts, native records and full manifests remain private.
**A fresh checkout cannot replay that original capture.** The command below creates a
**new LIVE take of the same scene**, not byte-identical GIF reproduction or renewed
acceptance of the original. Model text, timing, ids and terminal banners vary. The original
agg/ffprobe versions were not recorded; current tool versions cannot retroactively fill them.

### Prerequisites — no automatic install or repair

Run from an installed development **source checkout**, not an npm consumer. The `.ts`
takes/helpers/tests are maintainer tooling and are deliberately excluded from the tarball.

- Node at the `package.json#engines.node` floor; the checkout's pinned dependencies and
  current compiled bridge. After a source/bootstrap change, build with `pnpm run build-bridge`.
- Pi at the checkout's supported floor (**current floor 1.1.0**); `entwurf` on PATH must be
  the intended source stable-bin. Source evidence is not registry-package acceptance.
- `herdr` on PATH at exactly `scripts/fixtures/herdr-supply.json#version`; `asciinema` v3.
- Herdr's existing Pi integration at
  `${PI_CODING_AGENT_DIR:-$HOME/.pi/agent}/extensions/herdr-agent-state.ts`.
- The operator's existing Claude launcher/auth and vendor data at
  `${XDG_DATA_HOME:-$HOME/.local/share}/claude`. Missing or drifted ownership is a refusal,
  not permission to install, copy credentials or fix global hooks/settings.
- For offline rendering only: `agg` and `ffprobe` on PATH. Rendering is optional and
  requires the original private `take.cast` **and its same-run manifest**.

Selectors for this scene are fixed: Pi `openai-codex/gpt-6.1-sol`, thinking `low`, native
Claude Code alias `sonnet`. Overrides may only restate these. An OpenRouter base-URL
redirect is refused before inference; no fallback model or automatic retry is used.
A requested alias and the native model id observed in its transcript are recorded separately.

### Offline verification first

```bash
./run.sh check-demo-reproducibility
pnpm exec tsc --noEmit -p scripts/tsconfig.json
```

The named source-only floor verb discovers `demo/**/*.test.ts` and runs Node's own test
runner, including fake-tool/child-process fixtures. It is reached by `pnpm check` and
`pnpm run check:full`; these are not Vitest tests and are not reached by the adapter beside
Vitest globs. HOME, writable XDG roots and identity carriers are sandboxed by the verb.
`agg` and `ffmpeg` are faked, but the renderer/caption fixtures decode real GIF bytes, so
this floor needs a real `ffprobe` on PATH; without it they fail (`ffprobe ENOENT`) rather
than skip. CI installs Ubuntu's `ffmpeg` package (which carries `ffprobe`) in the check job.
The receiving type fence is `scripts/tsconfig.json`, paired with the root `demo` exclusion.

### Explicit new LIVE take

Only run after deciding to spend real subscription turns:

```bash
LIVE=1 node demo/take-herdr-pi-cc.ts
```

With approved selectors/policy and without `LIVE=1`, it exits 97 **before tool preflight
or resource creation**. Invalid selectors or an OpenRouter redirect can refuse earlier
with exit 2, still without tools or writes. Once authorized, it creates a private Herdr
server/fence, starts the scene, and stops only resources whose
ownership it can prove. Failure ends observation; it cannot undo a citizen's completed work.
No automatic retry, rerender or promotion follows a failure. Failed evidence is retained.

The fence isolates Herdr XDG state and Entwurf record/mailbox roots, **not the whole host**:
HOME/auth/vendor stores remain real; the existing Claude data directory is linked into the
private fence. Pi's control socket and the addressed v2 lock use real `~/.pi/` directories.
The native transcripts, records and fence are kept, not erased by teardown. Do not run this
against an operator server or broaden cleanup to unrelated sessions.

The default output is `.tmp-verify/138-demo-gifs/takes/<take-id>/` (ignored); an explicit
`ENTWURF_DEMO_OUT` changes its parent. `manifest.json` contains assertions, camera views,
raw receipts, measured models and the cast digest. The stage describes source **tooling**;
`entwurfOnPath` is observed, not checked against this checkout's stable-bin. Confirm that
binding separately before calling a take source-runtime evidence. Git HEAD and dirty state
are observed; a dirty HEAD is **not** an immutable source fingerprint.
Keep the exact source and manifest with any subsequent take you intend to audit.

### Offline rendering and publication boundary

Given an existing same-run private take, no model turn is needed:

```bash
node demo/render-take.ts <private-take-dir> <private-output.gif>
```

The renderer verifies cast digest, trims only recorder-only teardown, and promotes the
private GIF only after agg exits successfully and ffprobe decodes it. Each render keeps a
uniquely named `.render.cast` beside its output (also on failure), with name/digest in a
successful sidecar; the original take's `take.render.cast` is never overwritten. Non-live-pass takes
can render only to a private FAILED name. A mixed subject/teardown event is retained whole.
The renderer refuses repository `docs/assets/` destinations, including parent-directory
aliases: **publication is a separate reviewed copy**, never a rendering side effect.

Its email/company-path scan is deliberately narrow, **not a privacy/public-readability
certificate**: personal paths, hostnames, footers and native progress language can remain.
The operator approved the original rough pixels with their disclosed limitations. A new
render requires its own review; it must not overwrite the approved original implicitly.
The GIF and sidecar rename separately; a crash between them leaves a mismatched pair, not
atomic two-file publication. Optional `caption-take.ts` produces a separate derivative;
it is not this uncaptioned publication recipe.

## Other source scenes

`take-pi-durable.ts`, `take-pi-acp.ts` and `take-pi-cc.ts` record **different**, private tmux
scenes. Each requires its own explicit `LIVE=1` and, like the Herdr scene, refuses a
non-approved selector or an OpenRouter base-URL redirect first (exit 2, no tools or writes).
They are not the Herdr GIF's recipe.
Their helper tests remain in the same offline discovery verb. Original FAILED takes and
offline rejudgements are distinct evidence, never replacement LIVE acceptance.

## Archived pre-0.12 scripts

`demo-baseline.sh` and `demo.sh` retain their historical bodies for comparison, but now
**refuse immediately with exit 2**, even with `LIVE=1`. They cannot launch retired v1 flows
or overwrite today's published assets. Historical commands, selectors and old output paths
inside those bodies are tombstones, not runnable advice. Scene 3's current deterministic
delivery proof is `./run.sh check-bridge-delivery`; do not revive the v1 route.
