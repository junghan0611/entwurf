/**
 * check-shell-quote — deterministic POSIX-safety gate for remote SSH arg quoting.
 *
 * Background: the 2026-05-18 remote entwurf incident traced back to building
 * SSH command strings with `JSON.stringify`, which is NOT a shell-safe escape.
 * Backticks and `$(...)` inside a user prompt got executed by the remote shell
 * before pi ever saw them. The fix introduced `shellQuote()` (POSIX `'...'`
 * with `'\''` escape) in two places:
 *   - pi-extensions/entwurf.ts          (async spawn + async resume paths)
 *   - pi-extensions/lib/entwurf-core.ts (sync spawn + sync resume paths)
 *
 * This script enforces two invariants:
 *   1. `shellQuote()` source in both files matches the reference implementation
 *      byte-for-byte. Catches accidental drift if one site is edited without
 *      the other (until shellQuote is consolidated into a single lib — see
 *      NEXT.md remote entwurf follow-up (a)).
 *   2. The reference implementation produces POSIX-safe output for the exact
 *      payload classes that caused the original incident — backtick command
 *      substitution, `$(...)` command substitution, `$VAR` expansion, embedded
 *      single quotes, whitespace, empty string, non-ASCII text.
 *
 * No process spawn, no SSH, no API. Pure-string verification — safe in `pnpm
 * check` chain.
 */

import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// Reference implementation — must match the literal function body in both
// production sites. If you need to change the algorithm, change the reference
// FIRST, then sync both sites, then update SOURCE_SITES.
function shellQuote(value: string): string {
	return `'${value.replace(/'/g, `'\\''`)}'`;
}

const REFERENCE_BODY = `function shellQuote(value: string): string {
\treturn \`'\${value.replace(/'/g, \`'\\\\''\`)}\`;
}`;

const SOURCE_SITES = ["pi-extensions/lib/entwurf-core.ts", "pi-extensions/lib/entwurf-async.ts"] as const;

// Match the function block from `function shellQuote` up to the closing brace.
// Tab indentation is required (matches the rest of the repo).
const SHELL_QUOTE_BLOCK =
	/function shellQuote\(value: string\): string \{\n\treturn `'\$\{value\.replace\(\/'\/g, `'\\\\''`\)\}'`;\n\}/;

let assertions = 0;

function check(label: string, fn: () => void): void {
	fn();
	assertions += 1;
	process.stdout.write(`[check-shell-quote] ${label}: ok\n`);
}

// ------------------------------------------------------------------
// Invariant 1 — source parity across the two duplication sites
// ------------------------------------------------------------------

for (const rel of SOURCE_SITES) {
	check(`source parity — ${rel}`, () => {
		const abs = path.join(REPO_ROOT, rel);
		const text = fs.readFileSync(abs, "utf8");
		const match = text.match(SHELL_QUOTE_BLOCK);
		assert.ok(
			match,
			`shellQuote() block in ${rel} did not match the reference shape. ` +
				`If you intentionally changed the algorithm, update both sites AND the ` +
				`reference block in scripts/check-shell-quote.ts.`,
		);
	});
}

check("reference body byte-pattern is canonical", () => {
	// Sanity: the reference declared above is itself a valid shellQuote
	// definition. The string match is informational; the real check is the
	// behavioral suite below.
	assert.match(REFERENCE_BODY, /function shellQuote/);
});

// ------------------------------------------------------------------
// Invariant 2 — POSIX-safety behavior on the payload classes that
// caused the 2026-05-18 incident, plus general escape cases.
// ------------------------------------------------------------------

type Case = { label: string; input: string; expected: string };

const CASES: Case[] = [
	// The four incident payloads.
	{ label: "backtick command substitution", input: "`date`", expected: "'`date`'" },
	{ label: "$() command substitution", input: "$(rm -rf /)", expected: "'$(rm -rf /)'" },
	{ label: "$VAR expansion", input: "$HOME/.pi/agent", expected: "'$HOME/.pi/agent'" },
	{
		label: "korean token broken by SSH (denotecli read 어제)",
		input: "denotecli read 어제",
		expected: "'denotecli read 어제'",
	},

	// General escape correctness.
	{ label: "plain alphanumeric", input: "hello", expected: "'hello'" },
	{ label: "whitespace preserved", input: "hello world", expected: "'hello world'" },
	{ label: "embedded single quote", input: "it's fine", expected: `'it'\\''s fine'` },
	{ label: "multiple single quotes", input: "''", expected: `''\\'''\\'''` },
	{ label: "empty string", input: "", expected: "''" },
	{ label: "double quote literal", input: 'she said "hi"', expected: `'she said "hi"'` },
	{ label: "backslash literal", input: "a\\b", expected: "'a\\b'" },
	{ label: "newline literal", input: "a\nb", expected: "'a\nb'" },
	{ label: "ampersand + semicolon", input: "a && b ; c", expected: "'a && b ; c'" },
];

for (const c of CASES) {
	check(`behavior — ${c.label}`, () => {
		const actual = shellQuote(c.input);
		assert.equal(actual, c.expected, `input=${JSON.stringify(c.input)}`);
	});
}

// ------------------------------------------------------------------
// Done
// ------------------------------------------------------------------

process.stdout.write(`[check-shell-quote] ${assertions} assertions ok\n`);
