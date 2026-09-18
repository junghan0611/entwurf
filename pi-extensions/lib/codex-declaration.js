/**
 * codex-declaration — what entwurf owns inside `$CODEX_HOME/hooks.json`, and nothing more.
 *
 * WHY THIS LEAF EXISTS (#117). The birth unit used to own hooks.json as ONE COMPLETE FILE:
 * install refused a file it had not written, the state recorded a WHOLE-FILE sha256, and the
 * doctor/preflight compared that digest to the live bytes. That was true only while entwurf was
 * the only thing declaring a Codex hook. It is not: Herdr's official Codex integration appends
 * its own `SessionStart` group through `ensure_command_hook`, and the vendor keeps running BOTH
 * — `[source]` codex-rs/hooks/src/engine/discovery.rs:664-665 hashes a NORMALIZED
 * event/matcher/group/handler and keys trust by `<path>:<event>:<group_idx>:<handler_idx>`, so
 * trust is declaration-scoped and always was. Only entwurf's certification was file-scoped.
 *
 * WHAT OWNERSHIP MEANS HERE INSTEAD: exactly one `SessionStart` matcher group, holding exactly
 * one handler whose `command` is our quoted absolute launcher path. Everything else in that file
 * is FOREIGN — reported, never certified, never rewritten, never absorbed.
 *
 * WHY A NORMALIZED DIGEST AND NOT BYTES. `[측정 2026-09-17 oracle]` after Herdr appended its
 * group, our own handler came back with its keys in `command,timeout,type` order while the
 * installer writes `type,command,timeout` — Herdr re-serialized the whole document through
 * serde. So neither the file's bytes NOR our group's raw bytes survive a neighbour's install.
 * The digest below is taken over a canonical form (recursively sorted keys, no whitespace), so
 * it is blind to key order, indentation, `description` and every neighbouring group, and
 * sensitive to exactly what the trust identity is made of: the launcher path and the timeout.
 *
 * WHY A SPAN SPLICE AND NOT A RE-SERIALIZE. Adding or removing our group by parsing the file and
 * writing `JSON.stringify` back would rewrite every foreign byte on the way past. This module
 * locates our group's exact text span and edits only that, so a neighbour's declaration comes
 * out of an install or an uninstall byte-for-byte identical. Every splice is verified by
 * re-parsing the result and deep-comparing it to the value the caller expected; a splice that
 * does not land exactly there is a REFUSAL, never a written file.
 *
 * This file is `.js` for the same reason `session-id.js` is: it is imported from the tsc-emit
 * path (`codex-fresh-preflight.ts`), from `node --experimental-strip-types` gates, and from the
 * three installer shells through `node -e 'import(...)'`. One definition, every consumer.
 *
 * Keep dependency-free except `node:crypto`.
 */

import { createHash } from "node:crypto";

/** The vendor event name as it appears in hooks.json. */
export const CODEX_BIRTH_EVENT = "SessionStart";
/** The same event as it appears inside a `[hooks.state]` trust key — the vendor lower-snakes it. */
export const CODEX_BIRTH_TRUST_EVENT = "session_start";
/** Part of the identity the operator approves once; not a tunable. */
export const CODEX_BIRTH_TIMEOUT = 30;
/** A `description` this value prefixes is entwurf prose, and the only top-level member we own. */
export const CODEX_BIRTH_DESCRIPTION_PREFIX = "entwurf codex-birth ";

/**
 * The command string the vendor sees. Codex runs a handler command as a SHELL STRING (there is
 * no argv form), so the absolute launcher path is single-quoted — and THAT string, quotes
 * included, is what the trust receipt is keyed to and what selects our declaration below.
 *
 * @param {string} launcher absolute path to the published launcher
 * @returns {string}
 */
export function entwurfDeclarationCommand(launcher) {
	return `'${launcher}'`;
}

/**
 * The declaration this unit publishes, as a value. Three omissions carry meaning and are
 * asserted as omissions everywhere downstream: no `matcher` (so all four SessionStart sources
 * fire; `""` is NOT the same), no `async` (birth must be synchronous — the MCP child of the same
 * turn resolves its identity from the record this hook writes), and no `state` (that key is the
 * vendor's, in config.toml, and this unit never touches that file).
 *
 * @param {string} launcher
 * @returns {{hooks: Array<{type: string, command: string, timeout: number}>}}
 */
export function entwurfDeclarationGroup(launcher) {
	return { hooks: [{ type: "command", command: entwurfDeclarationCommand(launcher), timeout: CODEX_BIRTH_TIMEOUT }] };
}

/**
 * Canonical JSON: object keys sorted recursively, no insignificant whitespace. The ONLY reason
 * this exists is so a digest of a declaration survives a neighbour re-serializing the document.
 *
 * @param {unknown} value
 * @returns {string}
 */
export function canonicalJson(value) {
	if (value === null || typeof value !== "object") return JSON.stringify(value) ?? "null";
	if (Array.isArray(value)) return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
	const keys = Object.keys(value).sort();
	return `{${keys.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(",")}}`;
}

/**
 * The digest that IS the certification. Taken over the event name together with the group, so a
 * declaration moved to a different event is a different identity even when the group is equal.
 *
 * @param {unknown} group
 * @param {string} [event]
 * @returns {string} sha256 hex
 */
export function declarationDigest(group, event = CODEX_BIRTH_EVENT) {
	return createHash("sha256").update(canonicalJson({ event, group })).digest("hex");
}

/**
 * The vendor's own trust key for a declaration at a given position.
 * `[source]` discovery.rs:664-665 — `<declaration path>:<event>:<group_idx>:<handler_idx>`.
 *
 * @param {string} hooksFile
 * @param {number} groupIndex
 * @param {number} handlerIndex
 * @returns {string}
 */
export function trustReceiptKey(hooksFile, groupIndex, handlerIndex) {
	return `${hooksFile}:${CODEX_BIRTH_TRUST_EVENT}:${groupIndex}:${handlerIndex}`;
}

/** @typedef {{index: number, commands: string[]}} ForeignGroup */

/**
 * Locate entwurf's declaration inside a parsed hooks document, and describe its neighbours.
 *
 * SELECTION IS BY THE LAUNCHER COMMAND, not by index and not by position. That string is the
 * trust identity, so it is the only thing that can name our declaration in a file whose shape
 * somebody else is also allowed to change. Shape is judged AFTER selection on purpose: a handler
 * that carries our command and an extra `async` key is OUR declaration, drifted — a named red —
 * rather than somebody else's group we failed to recognise.
 *
 * `foreign` is filled on EVERY outcome, including the failures, because the doctor reports
 * neighbours whether or not our own bytes are intact.
 *
 * @param {unknown} parsed the parsed hooks.json document
 * @param {string} launcher absolute launcher path
 * @returns {{ok: true, groupIndex: number, handlerIndex: number, group: unknown, digest: string, foreign: ForeignGroup[]}
 *          | {ok: false, code: string, detail: string, groupIndex: number|null, foreign: ForeignGroup[]}}
 */
export function selectEntwurfDeclaration(parsed, launcher) {
	const no = (code, detail, foreign = [], groupIndex = null) => ({ ok: false, code, detail, groupIndex, foreign });
	if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
		return no("hooks-unreadable", "the hooks document is not a JSON object");
	}
	const events = parsed.hooks;
	if (events === null || typeof events !== "object" || Array.isArray(events)) {
		return no("hooks-unreadable", "the document carries no `hooks` object");
	}
	const groups = events[CODEX_BIRTH_EVENT];
	if (groups === undefined) return no("declaration-absent", `the document declares no ${CODEX_BIRTH_EVENT} group`);
	if (!Array.isArray(groups)) return no("hooks-unreadable", `hooks.${CODEX_BIRTH_EVENT} is not an array`);

	const want = entwurfDeclarationCommand(launcher);
	/** @type {Array<{groupIndex: number, handlerIndex: number}>} */
	const mine = [];
	/** @type {ForeignGroup[]} */
	const foreign = [];
	for (let g = 0; g < groups.length; g += 1) {
		const group = groups[g];
		const handlers = group !== null && typeof group === "object" && !Array.isArray(group) ? group.hooks : undefined;
		const list = Array.isArray(handlers) ? handlers : [];
		let claimed = false;
		for (let h = 0; h < list.length; h += 1) {
			const handler = list[h];
			if (handler !== null && typeof handler === "object" && !Array.isArray(handler) && handler.command === want) {
				mine.push({ groupIndex: g, handlerIndex: h });
				claimed = true;
			}
		}
		if (!claimed) {
			foreign.push({
				index: g,
				commands: list.map((handler) =>
					handler !== null &&
					typeof handler === "object" &&
					!Array.isArray(handler) &&
					typeof handler.command === "string"
						? handler.command
						: "(no command string)",
				),
			});
		}
	}

	if (mine.length === 0) {
		return no("declaration-absent", `no ${CODEX_BIRTH_EVENT} handler commands ${want}`, foreign);
	}
	if (mine.length > 1) {
		const where = mine.map((m) => `group ${m.groupIndex} handler ${m.handlerIndex}`).join(", ");
		return no(
			"declaration-duplicated",
			`${mine.length} handlers command ${want} (${where}) — the vendor would run this birth hook more than once per session and only one position can carry the trust receipt`,
			foreign,
		);
	}

	const { groupIndex, handlerIndex } = mine[0];
	const group = groups[groupIndex];
	const shape = declarationShapeProblem(group, want);
	if (shape !== null) return no("declaration-shape-drifted", shape, foreign, groupIndex);
	return { ok: true, groupIndex, handlerIndex, group, digest: declarationDigest(group), foreign };
}

/**
 * The GRAMMAR half of the certification, kept apart from the digest half because they fail for
 * different reasons: this one says which keys may exist at all (an `async` or a `matcher` the
 * installer never writes), while the digest says whether the VALUES are the ones recorded.
 *
 * @param {unknown} group
 * @param {string} wantCommand
 * @returns {string|null} a named problem, or null when the shape is exactly ours
 */
function declarationShapeProblem(group, wantCommand) {
	if (group === null || typeof group !== "object" || Array.isArray(group)) return "the matcher group is not an object";
	const keys = Object.keys(group).sort();
	if (keys.join(",") !== "hooks") {
		return `the matcher group must carry no key other than \`hooks\` (found ${keys.join(", ") || "none"}) — a \`matcher\` narrows which SessionStart sources fire and changes the identity the operator trusted`;
	}
	const handlers = group.hooks;
	if (!Array.isArray(handlers) || handlers.length !== 1) {
		return `the matcher group must hold exactly one handler (found ${Array.isArray(handlers) ? handlers.length : "a non-array"}) — a second handler in our own group is not a neighbour, it is our declaration edited`;
	}
	const handler = handlers[0];
	if (handler === null || typeof handler !== "object" || Array.isArray(handler)) return "the handler is not an object";
	const handlerKeys = Object.keys(handler).sort();
	if (handlerKeys.join(",") !== "command,timeout,type") {
		return `the handler must carry exactly type+command+timeout (found ${handlerKeys.join(", ") || "none"}) — every extra key, \`async\` above all, changes the trust identity`;
	}
	if (handler.type !== "command") return `the handler type must be \`command\`, not ${JSON.stringify(handler.type)}`;
	if (handler.command !== wantCommand) return `the handler command is ${JSON.stringify(handler.command)}`;
	if (handler.timeout !== CODEX_BIRTH_TIMEOUT) {
		return `the handler timeout must be ${CODEX_BIRTH_TIMEOUT}, not ${JSON.stringify(handler.timeout)} — it is part of the identity the operator approved`;
	}
	return null;
}

/* ─────────────────────── span-aware reading, for byte-preserving edits ─────────────────────── */

/**
 * A JSON reader that keeps every node's text span. Deliberately NOT a tolerant parser: it is the
 * same grammar `JSON.parse` accepts, and every caller below cross-checks its value against
 * `JSON.parse` before any file is written, so a disagreement is a refusal rather than an edit.
 *
 * @typedef {{value: unknown, start: number, end: number, elements?: SpanNode[], members?: Array<{key: string, start: number, end: number, value: SpanNode}>}} SpanNode
 */

/**
 * @param {string} text
 * @returns {SpanNode}
 */
export function parseWithSpans(text) {
	let at = 0;
	const fail = (why) => {
		throw new Error(`hooks.json is not readable at offset ${at}: ${why}`);
	};
	const ws = () => {
		while (at < text.length && (text[at] === " " || text[at] === "\t" || text[at] === "\n" || text[at] === "\r"))
			at += 1;
	};
	const lit = (word, value) => {
		if (text.slice(at, at + word.length) !== word) fail(`expected ${word}`);
		const start = at;
		at += word.length;
		return { value, start, end: at };
	};
	const str = () => {
		const start = at;
		if (text[at] !== '"') fail("expected a string");
		at += 1;
		while (at < text.length) {
			const ch = text[at];
			if (ch === "\\") {
				at += 2;
				continue;
			}
			if (ch === '"') {
				at += 1;
				return { value: JSON.parse(text.slice(start, at)), start, end: at };
			}
			at += 1;
		}
		return fail("unterminated string");
	};
	const num = () => {
		const start = at;
		if (text[at] === "-") at += 1;
		while (at < text.length && /[0-9eE+.-]/.test(text[at])) at += 1;
		const raw = text.slice(start, at);
		const value = Number(raw);
		if (raw.length === 0 || !Number.isFinite(value)) fail("expected a number");
		return { value, start, end: at };
	};
	/** @returns {SpanNode} */
	const node = () => {
		ws();
		const ch = text[at];
		if (ch === "{") {
			const start = at;
			at += 1;
			/** @type {Array<{key: string, start: number, end: number, value: SpanNode}>} */
			const members = [];
			/** @type {Record<string, unknown>} */
			const value = {};
			ws();
			if (text[at] === "}") {
				at += 1;
				return { value, start, end: at, members };
			}
			for (;;) {
				ws();
				const memberStart = at;
				const key = str();
				ws();
				if (text[at] !== ":") fail("expected ':'");
				at += 1;
				const child = node();
				members.push({ key: String(key.value), start: memberStart, end: child.end, value: child });
				value[String(key.value)] = child.value;
				ws();
				if (text[at] === ",") {
					at += 1;
					continue;
				}
				if (text[at] === "}") {
					at += 1;
					return { value, start, end: at, members };
				}
				return fail("expected ',' or '}'");
			}
		}
		if (ch === "[") {
			const start = at;
			at += 1;
			/** @type {SpanNode[]} */
			const elements = [];
			ws();
			if (text[at] === "]") {
				at += 1;
				return { value: [], start, end: at, elements };
			}
			for (;;) {
				const child = node();
				elements.push(child);
				ws();
				if (text[at] === ",") {
					at += 1;
					continue;
				}
				if (text[at] === "]") {
					at += 1;
					return { value: elements.map((e) => e.value), start, end: at, elements };
				}
				return fail("expected ',' or ']'");
			}
		}
		if (ch === '"') return str();
		if (ch === "t") return lit("true", true);
		if (ch === "f") return lit("false", false);
		if (ch === "n") return lit("null", null);
		return num();
	};
	const root = node();
	ws();
	if (at !== text.length) fail("trailing content after the document");
	return root;
}

/**
 * The span of `hooks.SessionStart` and of each group inside it.
 *
 * @param {string} text
 * @returns {{root: SpanNode, array: SpanNode}}
 */
export function sessionStartSpans(text) {
	const root = parseWithSpans(text);
	const hooks = root.members?.find((m) => m.key === "hooks");
	if (!hooks) throw new Error("the document carries no `hooks` object");
	const event = hooks.value.members?.find((m) => m.key === CODEX_BIRTH_EVENT);
	if (!event) throw new Error(`the document carries no hooks.${CODEX_BIRTH_EVENT} array`);
	if (!Array.isArray(event.value.value)) throw new Error(`hooks.${CODEX_BIRTH_EVENT} is not an array`);
	return { root, array: event.value };
}

/** The whitespace a given offset is indented BY — non-empty only when the offset opens its own
 * line, which is what makes it the right indent to repeat for a sibling element. */
function indentAt(text, offset) {
	const lineStart = text.lastIndexOf("\n", offset - 1) + 1;
	const line = text.slice(lineStart, offset);
	return /^[ \t]*$/.test(line) ? line : "";
}

/** The whitespace opening the LINE a given offset sits on, whatever else is on it — used when an
 * insertion has no sibling to line up with and must derive its indent from its container. */
function lineIndentAt(text, offset) {
	const lineStart = text.lastIndexOf("\n", offset - 1) + 1;
	return /^[ \t]*/.exec(text.slice(lineStart, offset))?.[0] ?? "";
}

/**
 * Remove ONE element of the SessionStart array, editing nothing else in the file.
 *
 * The separator is removed with the element it belongs to: a middle or last element takes the
 * comma BEFORE it (and the whitespace back to its predecessor), the first takes the comma after
 * it, and a sole element leaves an empty array. Every neighbour's bytes are copied through
 * untouched — that is the whole point of this function existing instead of a re-serialize.
 *
 * @param {string} text
 * @param {number} index
 * @returns {string}
 */
export function removeSessionStartGroup(text, index) {
	const { array } = sessionStartSpans(text);
	const elements = array.elements ?? [];
	if (index < 0 || index >= elements.length) throw new Error(`no SessionStart group at index ${index}`);
	let cutStart;
	let cutEnd;
	if (elements.length === 1) {
		cutStart = array.start + 1;
		cutEnd = array.end - 1;
	} else if (index === 0) {
		cutStart = elements[0].start;
		cutEnd = elements[1].start;
	} else {
		cutStart = elements[index - 1].end;
		cutEnd = elements[index].end;
	}
	return text.slice(0, cutStart) + text.slice(cutEnd);
}

/**
 * Give a document that has a `hooks` object but no `SessionStart` array an EMPTY one, editing
 * nothing else. Without this, appending our group into a file whose owner declared only other
 * events would have to re-serialize the document — the exact foreign-byte rewrite this module
 * exists to avoid. A document with no `hooks` object at all is somebody else's grammar and is
 * refused by the caller, not repaired here.
 *
 * @param {string} text
 * @returns {string}
 */
export function ensureSessionStartArray(text) {
	const root = parseWithSpans(text);
	const hooks = root.members?.find((m) => m.key === "hooks");
	if (!hooks) throw new Error("the document carries no `hooks` object");
	if (hooks.value.members?.some((m) => m.key === CODEX_BIRTH_EVENT)) return text;
	const members = hooks.value.members ?? [];
	const fresh = `${JSON.stringify(CODEX_BIRTH_EVENT)}: []`;
	if (members.length === 0) {
		const base = lineIndentAt(text, hooks.value.start);
		return `${text.slice(0, hooks.value.start + 1)}\n${base}  ${fresh}\n${base}${text.slice(hooks.value.end - 1)}`;
	}
	const last = members[members.length - 1];
	const indent = indentAt(text, last.start);
	return `${text.slice(0, last.end)},\n${indent}${fresh}${text.slice(last.end)}`;
}

/**
 * Append our group to the SessionStart array, editing nothing else in the file.
 *
 * APPEND, never insert: the vendor keys trust by index, so taking a position a neighbour already
 * holds would renumber THEIR receipt and cost the operator an approval they already gave.
 *
 * @param {string} text
 * @param {unknown} group
 * @returns {string}
 */
export function appendSessionStartGroup(text, group) {
	const { array } = sessionStartSpans(text);
	const elements = array.elements ?? [];
	const body = JSON.stringify(group, null, 2);
	if (elements.length === 0) {
		const base = lineIndentAt(text, array.start);
		const laid = body
			.split("\n")
			.map((line) => `${base}  ${line}`)
			.join("\n");
		return `${text.slice(0, array.start + 1)}\n${laid}\n${base}${text.slice(array.end - 1)}`;
	}
	const last = elements[elements.length - 1];
	const indent = indentAt(text, last.start);
	const laid = body
		.split("\n")
		.map((line, i) => (i === 0 ? line : indent + line))
		.join("\n");
	return `${text.slice(0, last.end)},\n${indent}${laid}${text.slice(last.end)}`;
}

/**
 * Remove a top-level `description` whose value is entwurf's own prose. Ours to remove, and only
 * ours: a description we did not author is a foreign byte and is left exactly where it is.
 *
 * @param {string} text
 * @returns {string}
 */
export function removeEntwurfDescription(text) {
	const root = parseWithSpans(text);
	const members = root.members ?? [];
	const index = members.findIndex(
		(m) =>
			m.key === "description" &&
			typeof m.value.value === "string" &&
			m.value.value.startsWith(CODEX_BIRTH_DESCRIPTION_PREFIX),
	);
	if (index === -1) return text;
	let cutStart;
	let cutEnd;
	if (members.length === 1) {
		cutStart = root.start + 1;
		cutEnd = root.end - 1;
	} else if (index === 0) {
		cutStart = members[0].start;
		cutEnd = members[1].start;
	} else {
		cutStart = members[index - 1].end;
		cutEnd = members[index].end;
	}
	return text.slice(0, cutStart) + text.slice(cutEnd);
}

/**
 * THE POST-CONDITION EVERY SPLICE IS GATED ON. The span reader above is the only new way this
 * unit can damage a file it does not own, so no splice is ever returned to a writer on the
 * strength of the reader alone: the result is re-parsed with `JSON.parse` and deep-compared to
 * the value the caller says it intended. A splice that lands anywhere else throws, and every
 * caller turns that into a zero-write refusal.
 *
 * @param {string} spliced
 * @param {unknown} expected
 * @returns {string} the same text, once it is proven to mean exactly `expected`
 */
export function certifySplice(spliced, expected) {
	let reparsed;
	try {
		reparsed = JSON.parse(spliced);
	} catch (err) {
		throw new Error(
			`the edited hooks document does not parse (${err instanceof Error ? err.message : String(err)}); nothing written`,
		);
	}
	if (canonicalJson(reparsed) !== canonicalJson(expected)) {
		throw new Error(
			"the edited hooks document is not the value this edit intended — the span edit landed somewhere else; nothing written",
		);
	}
	return spliced;
}

/**
 * Is this shared file one we may write through, and is it provably ours to certify?
 *
 * WHY IT LIVES HERE (sol B3, 2026-09-18). Four surfaces decide about the SAME file — the
 * installer, the inverse, the doctor and the fresh-call preflight — and they were deciding
 * differently. Preflight required a plausible owner and refused group/world-writable
 * (`codex-fresh-preflight.ts`); the two shells checked only symlink-and-regular, and the doctor
 * checked the file's CONTENT without ever asking who owned it. So a hooks.json owned by another
 * uid, or writable by a group, could be installed into and reported GREEN while every Codex fresh
 * call refused it as `codex-birth-unit-missing` — install and doctor saying yes about the same
 * bytes launch said no about, which is the split this closes.
 *
 * TWO DIFFERENT THINGS, and only one of them is ours. We do NOT chmod a file we share — a
 * neighbour's mode is a neighbour's business, and the installer carries it over untouched. But
 * WRITING INTO a file anyone else can rewrite is a different question: whatever we certify there,
 * someone else can change afterwards, so our receipt would describe bytes we cannot bind. That is
 * why an unsafe file is a zero-write refusal rather than a mode we normalize.
 *
 * The classifier is PURE — it judges a stat record, not a path — so the same rules can be proven
 * against fixture records with no filesystem, and so this leaf keeps its "dependency-free except
 * node:crypto" promise. `statOwnedPath` takes the `fs` module from its caller for the same reason.
 *
 * @param {{ exists: boolean, isSymbolicLink: boolean, isFile: boolean, isDirectory: boolean, uid: number, mode: number }} stat
 * @param {number} expectedUid
 * @param {{ kind?: "file" | "directory" }} [options]
 * @returns {"ok"|"missing"|"symlink"|"not-regular"|"foreign-uid"|"writable-by-others"}
 */
export function classifyOwnedPath(stat, expectedUid, options = {}) {
	const kind = options.kind ?? "file";
	if (!stat.exists) return "missing";
	// SYMLINK FIRST, and it is not folded into `not-regular`: the two repairs differ. A link's
	// target could be any file on the host, so the answer is never "fix the mode" — it is "this
	// path is not the file we think we are looking at".
	if (stat.isSymbolicLink) return "symlink";
	if (kind === "directory" ? !stat.isDirectory : !stat.isFile) return "not-regular";
	if (stat.uid !== expectedUid) return "foreign-uid";
	if ((stat.mode & 0o022) !== 0) return "writable-by-others";
	return "ok";
}

/**
 * Read one path into the record `classifyOwnedPath` judges. `lstat`, never `stat`: following the
 * link would answer about its target and hide the one verdict whose repair is different.
 *
 * @param {{ lstatSync: (p: string) => { isFile: () => boolean, isDirectory: () => boolean, isSymbolicLink: () => boolean, uid: number, mode: number } }} fs
 * @param {string} file
 */
export function statOwnedPath(fs, file) {
	try {
		const st = fs.lstatSync(file);
		return {
			exists: true,
			isSymbolicLink: st.isSymbolicLink(),
			isFile: st.isFile(),
			isDirectory: st.isDirectory(),
			uid: st.uid,
			mode: st.mode,
		};
	} catch {
		return { exists: false, isSymbolicLink: false, isFile: false, isDirectory: false, uid: -1, mode: 0 };
	}
}

/** What each verdict means to whoever has to repair it. One wording, so the installer, the
 * inverse and the doctor cannot describe the same file in three different ways. */
export const OWNED_PATH_REFUSAL = {
	symlink: "is a SYMLINK — this unit publishes through no link, and a link's target could be any file on the host",
	"not-regular": "is not a regular file",
	"foreign-uid": "is owned by another user, so nothing here can bind what it will say next",
	"writable-by-others":
		"is group/world-writable, so anything certified in it can be rewritten by someone else afterwards",
};
