/**
 * visible-resume-launch — the launch half every visible-resume ENTRY hands to the v2 composition.
 *
 * A visible resume has one leaf (`visibleResume` in `entwurf-v2-visible-resume.ts`) and, since #173,
 * two entries: the MCP verb `entwurf_resume_call` and the operator CLI `entwurf resume`. Both must
 * reopen a citizen through the SAME launcher, so the launcher lives here rather than as a closure
 * inside one of them. A second copy in the CLI would be a second place the rail could be chosen or
 * the tmux mapping could drift, and a defect planted in one copy would survive on the other.
 *
 * WHY THIS IS NOT IN THE V2 COMPOSITION. `entwurf-v2-visible-resume` cannot open a window on its own
 * and `mux-resume-call` cannot read a record — that is the import fence in docs/mux-launch-rail.md
 * §11, expressed as a function argument. This module is the layer that may know BOTH halves; the v2
 * composition still receives the launcher through `makeVisibleResumeDeps(launch)` and never imports it.
 *
 * #157 G1a: this module does NOT choose the rail. It hands the fixed tmux mapping below to the
 * shared rail root (`fresh-call-dispatch`), which reads the same capability fact fresh_call reads
 * and, inside herdr, launches the herdr resume instead — never calling this mapping there.
 *
 * #157 B3: a pi-durable resume is the same leaf's second entry, which also carries the fixed adopt
 * projection the v2 side built from its reservation; no other backend can hand it one.
 *
 * WHAT THIS MODULE DOES NOT DO: it resolves no garden id, reads no record, takes no lock and renders
 * nothing. An entry supplies the target and the attribution; everything about the citizen stays on
 * the v2 side of the seam.
 */

import type { VisibleResumeDeps } from "./entwurf-v2-visible-resume.ts";
import { dispatchResumeLaunch } from "./fresh-call-dispatch.ts";
import { RESUME_CALL_REJECT_HINT, resumeCall, resumePiDurableCall } from "./mux-resume-call.ts";

/** The fixed tmux mapping: record-derived launch input → the tmux resume leaf, by backend. */
export const tmuxResumeLaunch: VisibleResumeDeps["launch"] = (input) => {
	const launched =
		input.backend === "pi-durable"
			? resumePiDurableCall({ cwd: input.cwd, runtimeArgs: input.runtimeArgs, adoptEnv: input.piDurableAdoptEnv })
			: resumeCall({ backend: input.backend, cwd: input.cwd, runtimeArgs: input.runtimeArgs });
	return launched.ok
		? { ok: true, handle: { rail: "tmux", ...launched.receipt } }
		: { ok: false, reason: launched.reason, hint: RESUME_CALL_REJECT_HINT[launched.reason] };
};

/** The one launcher both entries pass to `makeVisibleResumeDeps`: the shared rail root picks the rail. */
export const visibleResumeLaunch: VisibleResumeDeps["launch"] = (input) =>
	dispatchResumeLaunch(input, tmuxResumeLaunch);
