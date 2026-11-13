/**
 * openclaw-citizens — the operator's OpenClaw SCOPE declaration (#160 S2 card §1–§2).
 *
 * The file says which OpenClaw sessions MAY become garden citizens. It never says who a citizen
 * is: there is no garden id here, and nothing in this module mints, updates or looks one up. The
 * V3 record alone answers "the citizen of this key is X" (AGENTS.md Hard Rule 2). A key that is
 * declared but has no record is not a citizen; a record whose key has left the declaration is
 * refused by scope on both send and receive, and its record is preserved (Hard Rule 8).
 *
 * Two forms of scope, one rule:
 *  - `allow`: exact (scope, agentId, sessionKey) triples — an existing fixed session;
 *  - `freshKeyPrefix`: one (scope, agentId, prefix) — keys a fresh launcher may create.
 * Entwurf never rewrites this file (a writer would make it a second ledger).
 *
 * `scope` is an operator-chosen label for ONE Gateway state root. OpenClaw session keys are
 * unique only inside one Gateway's state root (S2 card §1: two Gateways may both hold
 * `agent:main:main`), so the scope is the namespace component of the record's native id,
 * `openclaw:<scope>:<sessionKey>`. The label is never an address and never dialled: the Gateway is
 * reached through the declared `url`, enforced with OpenClaw's own `--expect-url`.
 *
 * Authentication is not here and never will be (GLG 2026-11-13, card §7-1): the Gateway's operator
 * owns it in OpenClaw's own config. This reader refuses a `url` that carries userinfo, a query or a
 * fragment, so no credential can ride into an argv through this file.
 *
 * Read once per use, never cached. Absent is the only "off"; a symlink, a non-regular entry, an
 * unreadable file or an invalid declaration throws by name (crash, don't warn).
 */

import * as fs from "node:fs";
import * as path from "node:path";
import { defaultMetaSessionsDir } from "./meta-session.ts";

export const OPENCLAW_CITIZENS_FILE = "openclaw-citizens.json";
export const OPENCLAW_DECLARATION_VERSION = 1;

/** The record-side native id prefix. Composition and parsing both live in this module. */
const NATIVE_ID_PREFIX = "openclaw:";

/** Operator label: lowercase, digits and hyphen. Never contains ':' (it delimits the native id). */
const SCOPE_RE = /^[a-z0-9][a-z0-9-]{0,62}$/;
/** OpenClaw agent id as it appears inside a session key. Never contains ':'. */
const AGENT_ID_RE = /^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/;
/** Session keys are printable, whitespace-free text; ':' is part of the vendor's own grammar. */
const SESSION_KEY_MAX = 256;
const UNSAFE_KEY_CHAR = /[\p{Cc}\s]/u;

export class OpenclawDeclarationError extends Error {}

export interface OpenclawGateway {
	scope: string;
	/** `ws:` / `wss:` URL handed to `--expect-url`, verbatim as declared. */
	url: string;
	/** Optional absolute OpenClaw config path for that one vendor invocation. */
	configPath?: string;
}

export interface OpenclawAllowedKey {
	scope: string;
	agentId: string;
	sessionKey: string;
}

export interface OpenclawFreshKeyPrefix {
	scope: string;
	agentId: string;
	prefix: string;
}

export interface OpenclawCitizensDeclaration {
	gateways: readonly OpenclawGateway[];
	allow: readonly OpenclawAllowedKey[];
	freshKeyPrefix?: OpenclawFreshKeyPrefix;
}

export type OpenclawScopeRejectReason = "openclaw-scope-not-declared";

export type OpenclawScopeSelection =
	| { gateway: OpenclawGateway; via: "allow" | "fresh-prefix" }
	| { reason: OpenclawScopeRejectReason; detail: string };

// ── field grammar ────────────────────────────────────────────────────────────

function fail(what: string, msg: string): never {
	throw new OpenclawDeclarationError(`${what}: ${msg}`);
}

function requireObject(raw: unknown, what: string): Record<string, unknown> {
	if (raw === null || typeof raw !== "object" || Array.isArray(raw)) fail(what, "must be a JSON object");
	return raw as Record<string, unknown>;
}

/** `required` keys must all be present; `optional` keys may be; nothing else may. */
function requireKeys(
	obj: Record<string, unknown>,
	required: readonly string[],
	optional: readonly string[],
	what: string,
): void {
	const allowed = new Set([...required, ...optional]);
	const stray = Object.keys(obj).filter((k) => !allowed.has(k));
	const missing = required.filter((k) => !Object.hasOwn(obj, k));
	if (stray.length > 0 || missing.length > 0) {
		fail(
			what,
			`keys must be ${required.join(", ")}${optional.length ? ` (optional: ${optional.join(", ")})` : ""}` +
				` (got ${Object.keys(obj).sort().join(", ") || "none"})`,
		);
	}
}

export function requireOpenclawScope(value: unknown, what = "scope"): string {
	if (typeof value !== "string" || !SCOPE_RE.test(value)) fail(what, `must match ${SCOPE_RE}`);
	return value;
}

export function requireOpenclawAgentId(value: unknown, what = "agentId"): string {
	if (typeof value !== "string" || !AGENT_ID_RE.test(value)) fail(what, `must match ${AGENT_ID_RE}`);
	return value;
}

/** A session key of `agentId`: `agent:<agentId>:<rest>` with a non-empty rest (card §3 check). */
export function requireOpenclawSessionKey(value: unknown, agentId: string, what = "sessionKey"): string {
	if (typeof value !== "string" || value.length === 0) fail(what, "must be a non-empty string");
	if (value.length > SESSION_KEY_MAX) fail(what, `exceeds ${SESSION_KEY_MAX} chars`);
	if (UNSAFE_KEY_CHAR.test(value)) fail(what, "must not contain whitespace or control characters");
	const head = `agent:${agentId}:`;
	if (!value.startsWith(head) || value.length === head.length) {
		fail(what, `must start with ${JSON.stringify(head)} and name a session after it (got ${JSON.stringify(value)})`);
	}
	return value;
}

function requireGatewayUrl(value: unknown, what: string): string {
	if (typeof value !== "string" || value.length === 0) fail(what, "must be a non-empty string");
	let u: URL;
	try {
		u = new URL(value);
	} catch {
		fail(what, `is not a URL (got ${JSON.stringify(value)})`);
	}
	if (u.protocol !== "ws:" && u.protocol !== "wss:") fail(what, `must be ws: or wss: (got ${u.protocol})`);
	// No credential may ride in through this file: no userinfo, no query, no fragment.
	if (u.username !== "" || u.password !== "") fail(what, "must not carry userinfo");
	if (u.search !== "" || u.hash !== "") fail(what, "must not carry a query or fragment");
	return value;
}

function requireAbsolutePath(value: unknown, what: string): string {
	if (typeof value !== "string" || !path.isAbsolute(value) || path.normalize(value) !== value) {
		fail(what, `must be an absolute, normalized path (got ${JSON.stringify(value)})`);
	}
	if (UNSAFE_KEY_CHAR.test(value)) fail(what, "must not contain whitespace or control characters");
	return value;
}

// ── parse ────────────────────────────────────────────────────────────────────

function parseGateway(raw: unknown, what: string): OpenclawGateway {
	const obj = requireObject(raw, what);
	requireKeys(obj, ["scope", "url"], ["configPath"], what);
	const gw: OpenclawGateway = {
		scope: requireOpenclawScope(obj.scope, `${what}.scope`),
		url: requireGatewayUrl(obj.url, `${what}.url`),
	};
	if (Object.hasOwn(obj, "configPath")) gw.configPath = requireAbsolutePath(obj.configPath, `${what}.configPath`);
	return gw;
}

function parseAllow(raw: unknown, what: string): OpenclawAllowedKey {
	const obj = requireObject(raw, what);
	requireKeys(obj, ["agentId", "scope", "sessionKey"], [], what);
	const agentId = requireOpenclawAgentId(obj.agentId, `${what}.agentId`);
	return {
		scope: requireOpenclawScope(obj.scope, `${what}.scope`),
		agentId,
		sessionKey: requireOpenclawSessionKey(obj.sessionKey, agentId, `${what}.sessionKey`),
	};
}

function parsePrefix(raw: unknown, what: string): OpenclawFreshKeyPrefix {
	const obj = requireObject(raw, what);
	requireKeys(obj, ["agentId", "prefix", "scope"], [], what);
	const agentId = requireOpenclawAgentId(obj.agentId, `${what}.agentId`);
	// A prefix is a key head: the same grammar as a key, so `agent:<id>:` alone (every key of the
	// agent) is refused — the fresh scope must be narrower than the agent.
	return {
		scope: requireOpenclawScope(obj.scope, `${what}.scope`),
		agentId,
		prefix: requireOpenclawSessionKey(obj.prefix, agentId, `${what}.prefix`),
	};
}

/**
 * Set rules over the whole file, independent of order: scopes and urls are unique among gateways
 * (two labels for one Gateway would mint two citizens for one session — compared as parsed URL
 * text, so `localhost` vs `127.0.0.1`, or two routes to one Gateway, are NOT caught: a named
 * boundary, review O4); every allow/prefix scope
 * names a declared gateway; no exact triple twice; and the two forms stay disjoint — an allowed
 * fixed key may not also fall under the fresh prefix, so each key's admission has one reason.
 */
function checkSets(decl: OpenclawCitizensDeclaration, what: string): void {
	const scopes = new Set<string>();
	const urls = new Set<string>();
	decl.gateways.forEach((g, i) => {
		if (scopes.has(g.scope)) fail(`${what}.gateways[${i}]`, `duplicate scope ${g.scope}`);
		scopes.add(g.scope);
		const href = new URL(g.url).href;
		if (urls.has(href)) fail(`${what}.gateways[${i}]`, `url ${g.url} is declared under another scope`);
		urls.add(href);
	});
	const triples = new Set<string>();
	decl.allow.forEach((a, i) => {
		const at = `${what}.allow[${i}]`;
		if (!scopes.has(a.scope)) fail(at, `scope ${a.scope} names no declared gateway`);
		const t = `${a.scope}\u0000${a.sessionKey}`;
		if (triples.has(t)) fail(at, `duplicate key ${a.sessionKey} in scope ${a.scope}`);
		triples.add(t);
		const p = decl.freshKeyPrefix;
		if (p && p.scope === a.scope && a.sessionKey.startsWith(p.prefix)) {
			fail(at, `key ${a.sessionKey} also falls under freshKeyPrefix ${p.prefix}; the two forms must be disjoint`);
		}
	});
	if (decl.freshKeyPrefix && !scopes.has(decl.freshKeyPrefix.scope)) {
		fail(`${what}.freshKeyPrefix`, `scope ${decl.freshKeyPrefix.scope} names no declared gateway`);
	}
}

export function parseOpenclawCitizensDeclaration(text: string): OpenclawCitizensDeclaration {
	const what = "openclaw citizens declaration";
	let raw: unknown;
	try {
		raw = JSON.parse(text);
	} catch (err) {
		fail(what, `not JSON (${err instanceof Error ? err.message : String(err)})`);
	}
	const obj = requireObject(raw, what);
	requireKeys(obj, ["allow", "gateways", "version"], ["freshKeyPrefix"], what);
	if (obj.version !== OPENCLAW_DECLARATION_VERSION) {
		fail(what, `"version" must be ${OPENCLAW_DECLARATION_VERSION} (got ${JSON.stringify(obj.version)})`);
	}
	if (!Array.isArray(obj.gateways) || obj.gateways.length === 0) {
		fail(what, `"gateways" must be a non-empty array; remove the file to switch off`);
	}
	if (!Array.isArray(obj.allow)) fail(what, `"allow" must be an array`);
	const decl: OpenclawCitizensDeclaration = {
		gateways: obj.gateways.map((g, i) => parseGateway(g, `${what}.gateways[${i}]`)),
		allow: obj.allow.map((a, i) => parseAllow(a, `${what}.allow[${i}]`)),
	};
	if (Object.hasOwn(obj, "freshKeyPrefix")) {
		decl.freshKeyPrefix = parsePrefix(obj.freshKeyPrefix, `${what}.freshKeyPrefix`);
	}
	if (decl.allow.length === 0 && !decl.freshKeyPrefix) {
		fail(what, `declares no key: "allow" is empty and there is no "freshKeyPrefix"`);
	}
	checkSets(decl, what);
	return decl;
}

// ── file ─────────────────────────────────────────────────────────────────────

/** THIS host's declaration: beside the record store, like the remote-pair opt-in. */
export function openclawCitizensPath(): string {
	return path.join(path.dirname(defaultMetaSessionsDir()), OPENCLAW_CITIZENS_FILE);
}

/**
 * Read the declaration at the moment of use (no cache). Absent → `null` (off). A symlink, a
 * non-regular entry, an unreadable file or an invalid declaration throws by name.
 */
export function readOpenclawCitizens(file: string): OpenclawCitizensDeclaration | null {
	let st: fs.Stats;
	try {
		st = fs.lstatSync(file);
	} catch (err) {
		if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
		throw err;
	}
	if (!st.isFile()) {
		throw new OpenclawDeclarationError(`openclaw citizens declaration ${file} must be a regular non-symlink file`);
	}
	try {
		return parseOpenclawCitizensDeclaration(fs.readFileSync(file, "utf8"));
	} catch (err) {
		throw new OpenclawDeclarationError(`${file}: ${err instanceof Error ? err.message : String(err)}`);
	}
}

// ── scope selection ──────────────────────────────────────────────────────────

/**
 * The scope check: the declared gateway this (scope, agentId, sessionKey) is admitted under, or a
 * refusal. It answers "may be a citizen", never "is a citizen" — that is the record's question.
 */
export function selectOpenclawScope(
	decl: OpenclawCitizensDeclaration,
	scope: string,
	agentId: string,
	sessionKey: string,
): OpenclawScopeSelection {
	const gateway = decl.gateways.find((g) => g.scope === scope);
	if (!gateway) {
		return {
			reason: "openclaw-scope-not-declared",
			detail: `scope ${scope} is not a declared gateway (${decl.gateways.map((g) => g.scope).join(", ")})`,
		};
	}
	if (decl.allow.some((a) => a.scope === scope && a.agentId === agentId && a.sessionKey === sessionKey)) {
		return { gateway, via: "allow" };
	}
	const p = decl.freshKeyPrefix;
	if (p && p.scope === scope && p.agentId === agentId && sessionKey.startsWith(p.prefix)) {
		return { gateway, via: "fresh-prefix" };
	}
	return {
		reason: "openclaw-scope-not-declared",
		detail: `key ${sessionKey} (agent ${agentId}) is not declared in scope ${scope}`,
	};
}

// ── native id ────────────────────────────────────────────────────────────────

export interface OpenclawNativeId {
	scope: string;
	agentId: string;
	sessionKey: string;
}

/**
 * `openclaw:<scope>:<sessionKey>` — the record's `nativeSessionId`. The ONE record writer is the birth
 * (card §1); the send entry also composes it, read-only, to LOOK UP the claim's record. Consumers
 * holding a record read it back with {@link parseOpenclawNativeSessionId}.
 */
export function composeOpenclawNativeSessionId(scope: string, agentId: string, sessionKey: string): string {
	requireOpenclawScope(scope);
	requireOpenclawSessionKey(sessionKey, requireOpenclawAgentId(agentId));
	return `${NATIVE_ID_PREFIX}${scope}:${sessionKey}`;
}

/** Inverse of {@link composeOpenclawNativeSessionId}; throws on anything it would not compose. */
export function parseOpenclawNativeSessionId(nativeSessionId: string): OpenclawNativeId {
	const what = "openclaw nativeSessionId";
	if (typeof nativeSessionId !== "string" || !nativeSessionId.startsWith(NATIVE_ID_PREFIX)) {
		fail(what, `must start with ${JSON.stringify(NATIVE_ID_PREFIX)} (got ${JSON.stringify(nativeSessionId)})`);
	}
	const rest = nativeSessionId.slice(NATIVE_ID_PREFIX.length);
	const colon = rest.indexOf(":");
	if (colon < 0) fail(what, `has no scope delimiter (got ${JSON.stringify(nativeSessionId)})`);
	const scope = requireOpenclawScope(rest.slice(0, colon), `${what} scope`);
	const sessionKey = rest.slice(colon + 1);
	const m = /^agent:([^:]*):/.exec(sessionKey);
	if (!m) fail(what, `session key must start with "agent:<agentId>:" (got ${JSON.stringify(sessionKey)})`);
	const agentId = requireOpenclawAgentId(m[1], `${what} agentId`);
	requireOpenclawSessionKey(sessionKey, agentId, `${what} sessionKey`);
	return { scope, agentId, sessionKey };
}
