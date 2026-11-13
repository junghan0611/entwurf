/**
 * openclaw-fresh — the pure leaf of an OpenClaw visible fresh launch (#160 S2 card §2, step 9).
 *
 * This is a BRANCH candidate, not an admission (card §2 판정, GLG 2026-11-13 §7-5): four facts are
 * unmeasured and any one failing keeps OpenClaw out of `FRESH_CALL_BACKENDS` for good —
 *   (a) a garden-id display surface on the TUI footer/header,
 *   (b) what `--width agent-policy` actually grants,
 *   (c) whether `tui --message` lands as the first turn of exactly that key,
 *   (d) how a TUI `/new` or `/session` switch is made visible against the record.
 * The preflight below therefore takes the visible-identity verdict as an explicit fact and refuses
 * while it is `unmeasured`; nothing here claims (a)–(d).
 *
 * The managed verb (card §2-1) is fixed: `entwurf openclaw --scope <s> --model <provider/model>
 * --width agent-policy --entwurf-bootstrap <{v,target,nonce,task}>`. No arbitrary command or env.
 * Its order (card §2-3…5): preflight → `sessions.create {key,label,model}` on a NEW key under the
 * declared fresh prefix → `openclaw-birth` with the create reply's `entry.sessionRoot` as cwd
 * ([측정] S3 `R/s3-sessionroot-read.txt`: no read RPC returns it) → `openclaw tui --session <key>
 * --message <framing>`. The callback is the Codex shape — the model calls the plugin's
 * `entwurf_v2` with target and nonce — because the plugin runs in the Gateway and cannot read the
 * TUI window's `ENTWURF_CALLBACK_*` env (card §2-6).
 *
 * `sessions.create` "creates or adopts" ([태그 v2026.11.3] `packages/gateway-protocol/src/schema/
 * sessions-create.ts:18`), so a fresh launch first requires `sessions.describe` to answer
 * `session:null` for its exact key (preflight fact `keyAbsent`); adoption of an existing key would be
 * an attach, not a fresh sibling. The window between that describe and the create is closed by the
 * key itself: it is derived from this launch's own nonce (24 random hex), so no other launch or
 * operator names it in between. The `model` param is `<provider>/<model>`: [측정] S2
 * `R/s2-steer-live.txt` `{"model":"openai/gpt-6-luna"}` → `providerOverride:"openai"`,
 * `modelOverride:"gpt-6-luna"`, `modelOverrideRouteResolution:"resolved"`.
 *
 * Gateway binding of the TUI (review D1). The record's Gateway is the declared `url`; the TUI has
 * no `--expect-url` ([측정] S3 `R/s3-tui-help.txt`), and an explicit `--url` / URL target does not
 * carry the configured credentials the way `gateway call --expect-url` does ([태그문서]
 * `docs/cli/tui.md:59-63,71-80`, `R/s3-tui-doc-auth.txt`). Without `--url` it follows the configured
 * or active local Gateway. So the launch passes the declared `configPath` as that one invocation's
 * `OPENCLAW_CONFIG_PATH`, and the preflight takes the binding verdict as a fact: until a measurement
 * proves the TUI opened on the declared Gateway, it refuses `openclaw-tui-binding-unproven`.
 */

import { CALLBACK_NONCE_RE } from "./callback-env.ts";
import {
	type OpenclawCitizensDeclaration,
	requireOpenclawScope,
	requireOpenclawSessionKey,
} from "./openclaw-citizens.ts";
import { SESSION_ID_RE } from "./session-id.js";

export const OPENCLAW_FRESH_WIDTHS = ["agent-policy"] as const;
export type OpenclawFreshWidth = (typeof OPENCLAW_FRESH_WIDTHS)[number];
export const OPENCLAW_BOOTSTRAP_VERSION = 1;
export const OPENCLAW_FIRST_INPUT_MAX_CHARS = 16000;

export class OpenclawFreshArgvError extends Error {}

export interface OpenclawBootstrap {
	target: string;
	nonce: string;
	task: string;
}

export interface OpenclawManagedArgv {
	scope: string;
	provider: string;
	model: string;
	width: OpenclawFreshWidth;
	bootstrap: OpenclawBootstrap;
}

const FLAGS = ["--scope", "--model", "--width", "--entwurf-bootstrap"] as const;

function decodeBootstrap(text: string): OpenclawBootstrap {
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch {
		throw new OpenclawFreshArgvError("--entwurf-bootstrap is not JSON");
	}
	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
		throw new OpenclawFreshArgvError("--entwurf-bootstrap must be a JSON object");
	}
	const o = raw as Record<string, unknown>;
	const keys = Object.keys(o).sort().join(",");
	if (keys !== "nonce,target,task,v") {
		throw new OpenclawFreshArgvError(`--entwurf-bootstrap keys must be exactly v, target, nonce, task (got ${keys})`);
	}
	if (o.v !== OPENCLAW_BOOTSTRAP_VERSION) throw new OpenclawFreshArgvError(`--entwurf-bootstrap "v" must be 1`);
	if (typeof o.target !== "string" || !SESSION_ID_RE.test(o.target)) {
		throw new OpenclawFreshArgvError("--entwurf-bootstrap target must be a garden id");
	}
	if (typeof o.nonce !== "string" || !CALLBACK_NONCE_RE.test(o.nonce)) {
		throw new OpenclawFreshArgvError(`--entwurf-bootstrap nonce must match ${CALLBACK_NONCE_RE}`);
	}
	if (typeof o.task !== "string" || o.task.length === 0 || o.task.length > OPENCLAW_FIRST_INPUT_MAX_CHARS) {
		throw new OpenclawFreshArgvError(`--entwurf-bootstrap task must be 1..${OPENCLAW_FIRST_INPUT_MAX_CHARS} chars`);
	}
	return { target: o.target, nonce: o.nonce, task: o.task };
}

/** Strict: each flag exactly once with a value, no other token. The width token is mandatory. */
export function parseOpenclawManagedArgv(argv: readonly string[]): OpenclawManagedArgv {
	if (argv.length !== FLAGS.length * 2) {
		throw new OpenclawFreshArgvError(`expected exactly ${FLAGS.join(" <v> ")} <v> (got ${argv.length} tokens)`);
	}
	const seen = new Map<string, string>();
	for (let i = 0; i < argv.length; i += 2) {
		const flag = argv[i];
		if (!(FLAGS as readonly string[]).includes(flag)) throw new OpenclawFreshArgvError(`unknown token ${flag}`);
		if (seen.has(flag)) throw new OpenclawFreshArgvError(`${flag} given twice`);
		seen.set(flag, argv[i + 1]);
	}
	const model = seen.get("--model") as string;
	const at = model.indexOf("/");
	if (at <= 0 || at === model.length - 1) {
		throw new OpenclawFreshArgvError(`--model must be <provider>/<model> (got ${model})`);
	}
	const width = seen.get("--width") as string;
	if (!(OPENCLAW_FRESH_WIDTHS as readonly string[]).includes(width)) {
		throw new OpenclawFreshArgvError(`--width must be one of ${OPENCLAW_FRESH_WIDTHS.join(", ")} (got ${width})`);
	}
	return {
		scope: requireOpenclawScope(seen.get("--scope")),
		provider: model.slice(0, at),
		model: model.slice(at + 1),
		width: width as OpenclawFreshWidth,
		bootstrap: decodeBootstrap(seen.get("--entwurf-bootstrap") as string),
	};
}

/** `<declared prefix><nonce hex>` — one launch, one new key, inside the fresh scope. */
export function openclawFreshKey(decl: OpenclawCitizensDeclaration, scope: string, nonce: string): string {
	const p = decl.freshKeyPrefix;
	if (!p || p.scope !== scope) {
		throw new OpenclawFreshArgvError(`openclaw-fresh-prefix-not-declared: scope ${scope} declares no freshKeyPrefix`);
	}
	if (!CALLBACK_NONCE_RE.test(nonce)) throw new OpenclawFreshArgvError(`nonce must match ${CALLBACK_NONCE_RE}`);
	return requireOpenclawSessionKey(`${p.prefix}${nonce.slice(nonce.lastIndexOf("-") + 1)}`, p.agentId);
}

/** Card §2-3. `label` carries the nonce (it is claimed unique per store); the garden-id label is (a). */
export function openclawSessionsCreateParams(key: string, nonce: string, provider: string, model: string) {
	return { key, label: `entwurf-${nonce.slice(nonce.lastIndexOf("-") + 1)}`, model: `${provider}/${model}` };
}

/**
 * Card §2-5. The TUI opens exactly the created key; the framing is its first message ((c) unmeasured).
 * `env` is the one fixed variable the launch may carry: the declared gateway's `configPath`.
 */
export function openclawTuiLaunch(
	binary: string,
	key: string,
	framing: string,
	gateway: { configPath?: string },
): { argv: string[]; env: Record<string, string> } {
	return {
		argv: [binary, "tui", "--session", key, "--message", framing],
		env: gateway.configPath ? { OPENCLAW_CONFIG_PATH: gateway.configPath } : {},
	};
}

export type OpenclawFreshPreflightReject =
	| "openclaw-first-input-too-long"
	| "openclaw-scope-not-declared"
	| "openclaw-fresh-prefix-not-declared"
	| "openclaw-gateway-unreachable"
	| "openclaw-fresh-key-exists"
	| "openclaw-plugin-not-loaded"
	| "openclaw-tui-binding-unproven"
	| "openclaw-visible-identity-unmeasured";

/**
 * Card §2-2, pre-mutation, first missing thing in repair order. Birth and receive are this
 * package's own modules (no separate unit to find); the MCP hand is the plugin tool instead.
 * Every fact is supplied by the caller; this function probes nothing.
 */
export function openclawFreshPreflight(facts: {
	readonly firstInput: string;
	readonly decl: OpenclawCitizensDeclaration | null;
	readonly scope: string;
	/** `sessions.describe` through `--expect-url` exited 0 with a `{"session":…}` answer. */
	readonly gatewayReachable: boolean;
	/** That describe, for the exact fresh key, answered `session:null` (create would otherwise adopt). */
	readonly keyAbsent: boolean;
	/** The `entwurf` plugin is installed, enabled and loaded in that Gateway. [미측정 how to read] */
	readonly pluginLoaded: boolean;
	/** D1: the TUI is proven to open on the declared Gateway. `unproven` until measured. */
	readonly tuiBinding: "unproven" | "proven";
	/** (a): `unmeasured` until a garden-id display surface is measured on the TUI. */
	readonly visibleIdentity: "unmeasured" | "present";
}): OpenclawFreshPreflightReject | null {
	if (facts.firstInput.length > OPENCLAW_FIRST_INPUT_MAX_CHARS) return "openclaw-first-input-too-long";
	if (!facts.decl || !facts.decl.gateways.some((g) => g.scope === facts.scope)) return "openclaw-scope-not-declared";
	if (facts.decl.freshKeyPrefix?.scope !== facts.scope) return "openclaw-fresh-prefix-not-declared";
	if (!facts.gatewayReachable) return "openclaw-gateway-unreachable";
	if (!facts.keyAbsent) return "openclaw-fresh-key-exists";
	if (!facts.pluginLoaded) return "openclaw-plugin-not-loaded";
	if (facts.tuiBinding !== "proven") return "openclaw-tui-binding-unproven";
	if (facts.visibleIdentity !== "present") return "openclaw-visible-identity-unmeasured";
	return null;
}
