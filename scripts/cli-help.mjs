/**
 * Renders `entwurf --help` and one command's help from root ENTWURF-CLI.json, the one editable
 * source of the CLI's own description. Plain `node` in both modes (no strip-types, no compiled
 * twin): it imports node builtins only and reads one module-relative file, never cwd/HOME/env, so
 * a checkout and an installed package answer from the bytes they carry. Every check runs before
 * the first write; a missing or malformed source is a named failure (exit 1) on stderr with
 * nothing on stdout — there is no older text to fall back to.
 *
 * argv is exactly one of: nothing (the root usage), or `--command <name>` (that command's help;
 * a name the data does not describe is exit 2 with one stderr line). Anything else is exit 2.
 *
 * A command name in the data owns a description, not a dispatch: run.sh's case and its
 * source-defined gate functions stay the only things that run anything, and
 * check-install-surface compares the two independently.
 */
import { readFileSync } from "node:fs";

const SOURCE = new URL("../ENTWURF-CLI.json", import.meta.url);
const PREFIX = "  entwurf ";

function fail(detail) {
	process.stderr.write(`entwurf: ENTWURF-CLI.json ${detail}\n`);
	process.exit(1);
}

function refuse(detail) {
	process.stderr.write(`entwurf: ${detail}\n`);
	process.exit(2);
}

function object(value, at, wanted, optional = []) {
	if (typeof value !== "object" || value === null || Array.isArray(value)) fail(`${at}: expected an object`);
	const got = Object.keys(value)
		.filter((k) => !optional.includes(k))
		.sort();
	const want = [...wanted].sort();
	if (got.length !== want.length || got.some((k, i) => k !== want[i])) {
		fail(
			`${at}: keys must be exactly ${wanted.join(", ")}${optional.length ? ` (optionally ${optional.join(", ")})` : ""}`,
		);
	}
	return value;
}

function text(value, at, { empty = false } = {}) {
	if (typeof value !== "string" || (!empty && value.length === 0) || value.includes("\n")) {
		fail(`${at}: expected a ${empty ? "" : "non-empty "}single-line string`);
	}
	return value;
}
const line = (value, at) => text(value, at);

function array(value, at) {
	if (!Array.isArray(value) || value.length === 0) fail(`${at}: expected a non-empty array`);
	return value;
}

const argv = process.argv.slice(2);
const wanted = argv.length === 2 && argv[0] === "--command" ? argv[1] : undefined;
if (argv.length !== 0 && wanted === undefined) refuse("cli-help.mjs takes nothing, or --command <name>");

let raw;
try {
	raw = readFileSync(SOURCE, "utf8");
} catch (err) {
	fail(`unreadable: ${err.code ?? err.message}`);
}
let data;
try {
	data = JSON.parse(raw);
} catch (err) {
	fail(`is not JSON: ${err.message}`);
}

object(data, "root", ["_about", "schemaVersion", "usage"]);
object(data._about, "_about", ["purpose", "ownership"]);
line(data._about.purpose, "_about.purpose");
line(data._about.ownership, "_about.ownership");
if (data.schemaVersion !== 2) fail("schemaVersion: unsupported");
const usage = object(data.usage, "usage", ["title", "commandGroups", "notes"]);
const notes = object(usage.notes, "usage.notes", ["title", "lines"]);

const out = [line(usage.title, "usage.title")];
const entries = new Map();
array(usage.commandGroups, "usage.commandGroups").forEach((group, g) => {
	if (g > 0) out.push("");
	array(group, `usage.commandGroups[${g}]`).forEach((entry, e) => {
		const at = `usage.commandGroups[${g}][${e}]`;
		object(entry, at, ["synopsis", "column", "summary"], ["details"]);
		const synopsis = line(entry.synopsis, `${at}.synopsis`);
		const name = synopsis.split(" ", 1)[0];
		if (!/^[a-z][a-z0-9-]*$/.test(name)) fail(`${at}.synopsis: ${JSON.stringify(name)} is not a command name`);
		if (entries.has(name)) fail(`${at}.synopsis: ${name} is described twice`);
		const head = PREFIX + synopsis;
		if (!Number.isSafeInteger(entry.column) || entry.column <= head.length) {
			fail(`${at}.column: must be an integer past the synopsis (> ${head.length})`);
		}
		const summary = line(entry.summary, `${at}.summary`);
		// Details are a command's own longer text, printed only by its help: blank lines separate
		// its parts, so they may be empty, but the block neither starts nor ends on one.
		const details =
			entry.details === undefined
				? []
				: array(entry.details, `${at}.details`).map((d, i) => text(d, `${at}.details[${i}]`, { empty: true }));
		if (details.length > 0 && (details[0] === "" || details.at(-1) === "")) {
			fail(`${at}.details: must not start or end with an empty line`);
		}
		entries.set(name, { synopsis, summary, details });
		out.push(`${head.padEnd(entry.column)}# ${summary}`);
	});
});
out.push("", line(notes.title, "usage.notes.title"));
for (const [n, note] of array(notes.lines, "usage.notes.lines").entries()) {
	out.push(`  - ${line(note, `usage.notes.lines[${n}]`)}`);
}

// A reader that stops early (`entwurf --help | head`) closes the pipe: that ends the page, it is
// not a failure to report.
process.stdout.on("error", (err) => {
	if (err.code === "EPIPE") process.exit(0);
	throw err;
});
if (wanted === undefined) {
	process.stdout.write(`${out.join("\n")}\n`);
} else {
	const entry = entries.get(wanted);
	// JSON quoting keeps any control character in the name on this one line.
	if (!entry) refuse(`no help for ${JSON.stringify(wanted)} — \`entwurf help\` lists the described commands`);
	const page = [`Usage: entwurf ${entry.synopsis}`, "", entry.summary];
	if (entry.details.length > 0) page.push("", ...entry.details);
	process.stdout.write(`${page.join("\n")}\n`);
}
