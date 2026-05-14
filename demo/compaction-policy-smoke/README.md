# compaction-policy-smoke

0.5.0 compaction-policy verification demo.

## What 0.5.0 declares

> `pi-shell-acp` does not implement compaction. When a backend
> compacts natively, the pi session and mapping survive that. The
> bridge boundary stays explicit. pi-side JSONL compaction stays
> blocked — it would not reduce the backend transcript anyway.

| Layer | Default |
|---|---|
| pi JSONL compaction | blocked |
| backend-native compaction | **always allowed (no bridge knob)** |

| Knob | Meaning | Default |
|---|---|---|
| `PI_SHELL_ACP_ALLOW_PI_COMPACTION=1` | Let pi-side `session_before_compact` proceed | unset (blocked) |
| `PI_SHELL_ACP_ALLOW_COMPACTION=1` (legacy) | — | **fail-fast throw at spawn intent** |

If a specific backend's auto-compaction must be turned off for a debugging
reason, configure that backend through its own native interface — the
bridge intentionally does not surface backend-specific compaction names
or knob shapes.

## Smoke driver — five steps

| # | What it proves | Mode |
|---|---|---|
| 02 | `session_before_compact` message honestly tells the operator: pi-side compact does **not** reduce the backend transcript, and points at the backend-native compaction path. | deterministic |
| 03 | **Live**: Claude ACP session survives a backend `/compact`. Spawns a real ACP child via `runEntwurfSync`, plants a unique sentinel + asserts READY, sends literal `/compact` as a backend prompt, then asserts the sentinel survives a recall prompt. Same `taskId` across all three prompts. | LIVE=1 |
| 04 | **Live**: same 3-prompt driver against the Codex adapter, routed through pi-shell-acp ACP via `PI_ENTWURF_ACP_FOR_CODEX=1`. | LIVE=1 |
| 05 | Legacy `PI_SHELL_ACP_ALLOW_COMPACTION=1` is rejected at spawn intent with a next-action message pointing at `PI_SHELL_ACP_ALLOW_PI_COMPACTION`. | deterministic |
| 06 | **Live (exploratory)**: same 3-prompt driver against Gemini. Gemini ACP does not advertise `/compact`; the probe records the actual observation, not a release claim. | LIVE=1 |

Steps 02, 05 form the **deterministic gate** (no network, no real
spawn). Steps 03, 04, 06 are the **live release-evidence probe** —
they spawn a real backend session and cost a few cents per backend.
The probe is gated behind `LIVE=1`. It is NOT a product-surface
`/acp-compact` command; there is no user-facing operator interface
for triggering backend compaction.

(Step 01 was retired in the 0.5.0 maintainer cleanup — a negative
assertion that names backend-specific compaction strings is itself an
awareness of those internals and violates the bridge thesis.)

## Probe shapes — Pattern A and Pattern B

The automated smoke driver covers Pattern A. Pattern B is release
evidence from manual saturation probes, recorded below so the outcome
is reviewable without turning backend-specific compaction knobs into a
bridge-facing recipe.

- **Pattern A — explicit `/compact`.** The driver sends the literal
  string `/compact` as a backend prompt mid-session, then recalls the
  planted sentinel. Tests the explicit user-invoked compaction path.
- **Pattern B — organic auto-compact.** The session naturally fills
  with content until the backend's own threshold fires compaction at
  turn start. Release evidence used both a cheap stand-in and real
  default-window saturation, but this README intentionally does not
  publish backend-specific threshold recipes. If that evidence must be
  reconstructed, use the historical notes in `CHANGELOG.md` and keep
  the distinction clear: probe setup is not a bridge product surface.

## Classifier — how live probes judge backend-compact

| Signal | Source | Means |
|---|---|---|
| text | `classifyCompactResponse((b).text, sentinel)` | `ack` if the reply talks about compaction/summary/context-reduction; `refusal` if the backend says it does not recognize the command; `ambiguous` otherwise. Sentinel is stripped before matching so the planted token cannot self-trigger an `ack`. |
| wire | `classifyUsageEvidence(...)` reads `[pi-shell-acp:usage] meter=acpUsageUpdate` lines in bridge stderr | `compact_boundary_signal` (an explicit `used=0` synthetic usage_update — claude-agent-acp emits this when the SDK performs compaction), `usage_drop` (final used ≥ 50% lower than pre-`/compact` baseline), or `no_evidence`. |
| sentinel recalled | recall prompt reply | does it contain the planted sentinel verbatim. |

| text | wire | sentinel recalled | outcome |
|---|---|---|---|
| `ack` | any | yes | **pass** |
| any | `compact_boundary_signal` | yes | **pass** — wire is authoritative when text is ambiguous |
| any | `usage_drop` | yes | **pass** |
| `ack` | any | no | **observed** — backend acked but lost the sentinel (backend-internal property, not a bridge regression) |
| `refusal` | `no_evidence` | any | **observed** — no native `/compact` surface reachable through this prompt path |
| `ambiguous` | `no_evidence` | any | **observed** |

**fail** is reserved for "no assistant text" / entwurf path error — the
bridge or the backend is dead. The dual-classifier shape exists because
the two release-grade backends signal compaction on different ACP wire
surfaces (Claude wire-boundary, Codex text + late wire-drop).

## Run

```bash
# Deterministic gate (no network)
./run.sh smoke-compaction-policy

# Single step
node --experimental-strip-types scripts/compaction-policy-smoke.ts --step=02

# Live release-evidence probes (real ACP spawn, costs a few cents per backend)
LIVE=1 ./run.sh smoke-compaction-policy
LIVE=1 ./run.sh smoke-compaction-policy --step=03   # Claude
LIVE=1 ./run.sh smoke-compaction-policy --step=04   # Codex (routed via ACP bridge)
LIVE=1 ./run.sh smoke-compaction-policy --step=06   # Gemini (exploratory)
```

Each step prints a human-readable block and a single line
`RESULT NN: pass | fail — reason | observed — note`. The runner ends
with `SUMMARY: P pass, F fail, O observed`. Exit code is non-zero iff
any deterministic step fails. `observed` rows are records, not gate
failures.

## Release-evidence probe outcomes (0.5.0)

| Date | Backend | Pattern | Result |
|---|---|---|---|
| 2026-05-13 | Claude Sonnet 4.6 | B real saturation | **pass** after `hooks: {}` overlay fix — organic compact turn answers the triggering prompt. Pre-fix baseline showed prompt-sacrifice failure (compact turn ended in meta-summary instead of the user's next answer); the one-line overlay shape repair closes the axis. |
| 2026-05-14 | Codex GPT-5.4 | A explicit `/compact` | **pass** — text=`Context compacted`, sentinel preserved. Wire `used` drop 34% (below classifier threshold), so text + sentinel is the load-bearing signal pair on Codex. |
| 2026-05-14 | Codex GPT-5.4 | B cheap stand-in | **pass** — lowered native threshold fired pre-turn organic compact; both compact turn and recall preserved sentinel. |
| 2026-05-14 | Codex GPT-5.4 | B real saturation | **pass** — 13-turn file-reading drove `used` to ~244k (~94% of 258k), organic compact fired at turn 12, wire `used` dropped 65%, substantive 982-word answer in the compact turn, sentinel recalled. Codex GPT-5.4 native threshold ≈ 245k. |
| 2026-05-14 | Gemini 3.1 Pro | explicit `/compact` | **observed (negative)** — Gemini ACP does not advertise `/compact` as a command; literal `/compact` lands as a regular prompt. Native `/compress` exists outside ACP. Recorded as honest ACP asymmetry, not a release pass. |

### Cross-backend symmetry note

Claude and Codex remain inside the same bridge thesis: pi-shell-acp
does not implement compaction; the backend does its own thing; the
pi session lives. They differ in default thresholds — Claude SDK
compacts much earlier (~60% fill on Sonnet 4.6, ~120k of 200k);
codex-rs compacts much later (~94% fill on GPT-5.4, ~245k of 258k).
The classifier fires on each backend's native signal (Claude
wire-boundary, Codex text + late wire-drop) without forcing a fake
symmetry.

Raw turn captures, sentinel files, and bridge stderr from each probe
are local-only operator evidence (gitignored). Each probe is fully
reproducible from this driver + the recipe below; nothing in the
release claim depends on a preserved fixture.

## Reproducing a probe shape

### Pattern A (explicit `/compact`)

Use the smoke driver directly — `LIVE=1 ./run.sh smoke-compaction-policy --step=03|04|06` covers Claude / Codex / Gemini respectively.

### Pattern B (organic auto-compact)

Pattern B is intentionally manual and backend-native. Drive a sandboxed
session toward the backend's own default context threshold with ordinary
file reads and analytic prompts, then verify `[pi-shell-acp:usage]`
shows the backend's compact signal and the next turn answers the user
prompt rather than a bridge-injected summary. Backend-specific threshold
knob names are not documented here; the bridge does not surface them.

## Why this demo exists

0.4.x reached its long-session ceiling by **disabling** both Claude and
Codex native compaction at the bridge surface. That was a deliberate,
temporary expedient — the bridge needed to be a small, knowable surface
first; reasoning about backend-native compaction came later. 0.5.0 pays
that debt back. The bridge no longer pretends to own compaction. The
backend does its own thing. The pi session lives.
