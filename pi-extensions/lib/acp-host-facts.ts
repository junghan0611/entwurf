/**
 * acp-host-facts — what this Pi process is, as the two extensions that know it report it
 * (#171 decision 18).
 *
 * The ACP backend has to tell a resident from an explicit one-shot from neither, and it must not
 * derive that from raw argv: `pi -- --entwurf-control` passes the token as a prompt, and Pi's own
 * parser, not a token scan, decides whether the control flag is set. So each fact comes from its
 * owner:
 *
 *  - `controlEnabled`: the control extension's parsed flag (`pi.getFlag`, which Pi scopes to the
 *    extension that registered the flag — the ACP provider cannot read it itself);
 *  - `mode`: Pi's run mode as the ACP provider entry sees it (`ctx.mode`).
 *
 * Both are reported at `session_start`, which Pi awaits before a prompt runs, and each owner takes
 * its report back at its own `session_shutdown`, so a fact never outlives the extension that vouched for it. The facts live on
 * `globalThis` under one `Symbol.for` key because the two extensions are separate module
 * instances in one Pi process (as acp-steer-seam). A fact nobody reported stays `undefined`, and
 * the reader treats it as "not a resident" and "not a one-shot": absence never grants anything.
 */

/** Pi's run mode as an extension sees it (`ctx.mode`, pi-coding-agent `ExtensionMode`). */
export type AcpHostMode = "tui" | "rpc" | "json" | "print";

export interface AcpHostFacts {
	readonly controlEnabled: boolean | undefined;
	readonly mode: AcpHostMode | undefined;
}

export const ACP_HOST_FACTS_KEY: unique symbol = Symbol.for("entwurf.acp.host-facts.v1") as never;

type FactsHost = { [ACP_HOST_FACTS_KEY]?: { controlEnabled?: unknown; mode?: unknown } };

const MODES: readonly string[] = ["tui", "rpc", "json", "print"];

function slot(host: object): { controlEnabled?: unknown; mode?: unknown } {
	const h = host as FactsHost;
	const existing = h[ACP_HOST_FACTS_KEY];
	if (typeof existing === "object" && existing !== null) return existing;
	const created = {};
	h[ACP_HOST_FACTS_KEY] = created;
	return created;
}

/**
 * The control extension reports its parsed `--entwurf-control` flag — and takes the report back
 * (`undefined`) at its `session_shutdown`. A `/reload` that no longer loads the control extension
 * must not inherit the old `true`: Pi shuts the old runner down, then starts only the new set.
 */
export function reportEntwurfControlFlag(enabled: boolean | undefined, host: object = globalThis): void {
	slot(host).controlEnabled = enabled;
}

/** The ACP provider entry reports Pi's run mode, and takes it back (`undefined`) at its `session_shutdown`. */
export function reportAcpHostMode(mode: AcpHostMode | undefined, host: object = globalThis): void {
	slot(host).mode = mode;
}

/** Read both facts. A value of the wrong shape reads as not reported. */
export function readAcpHostFacts(host: object = globalThis): AcpHostFacts {
	const raw = (host as FactsHost)[ACP_HOST_FACTS_KEY];
	if (typeof raw !== "object" || raw === null) return { controlEnabled: undefined, mode: undefined };
	return {
		controlEnabled: typeof raw.controlEnabled === "boolean" ? raw.controlEnabled : undefined,
		mode: typeof raw.mode === "string" && MODES.includes(raw.mode) ? (raw.mode as AcpHostMode) : undefined,
	};
}
