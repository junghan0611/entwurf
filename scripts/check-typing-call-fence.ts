/**
 * check-typing-call-fence — the boundary nobody has broken yet, kept by NAME.
 *
 * THE RULE: this product composes ARGUMENTS and LETTERS, never keystrokes. It is written in two
 * places already — `docs/herdr-launch-rail.md` §3 ("키 입력(`agent prompt`): 터미널 입력이다") and
 * `pi-extensions/lib/herdr-fresh-call.ts:28` — and until now nothing but prose held it.
 *
 * WHY A GATE FOR A RULE NOBODY BROKE `[외부 관측 2026-09-17 19:35]`. An outside reader measured the
 * tree and found the law perfectly kept and nothing keeping it: zero typing calls across
 * `pi-extensions/`, and zero checks and zero mutants that would notice one arriving. Gates here grow
 * on top of incidents, and this boundary was named and refused at DESIGN time, so it never produced
 * the failure that would have produced a test. A rule kept since day one is the most defenceless
 * kind: the green that covers it means only "nobody has broken it yet".
 *
 * WHAT A TYPING CALL IS. Anything that reaches a sibling by writing into the place a HUMAN types:
 * tmux `send-keys` / `paste-buffer` / `load-buffer`, and herdr's PTY verbs — `agent.prompt`,
 * `agent.send_keys`, `pane.send_text`, `pane.input.set`. `[측정 2026-09-18, herdr @ 7505c08]` those
 * herdr verbs are not an API delivery with an acknowledgement: `src/app/api/agents.rs:195` hands the
 * text to `encode_api_submission_parts`, `src/app/api_helpers.rs:25-32` wraps it in bracketed paste,
 * and the bytes go to the child pane's PTY followed 300 ms later by an encoded Enter. What is
 * acknowledged is that input was written — herdr's own help says it "does not track turns". That is
 * exactly what Hard Rule 16 keeps out of delivery evidence.
 *
 * SCOPE. The production surfaces `pi-extensions/` and `mcp/`, tracked files only (so the gitignored
 * `mcp/entwurf-bridge/dist/` build output is not scanned twice as its own source). This gate lives
 * in `scripts/`, which is NOT in scope — a gate that scanned itself could only be made green by
 * deleting the names it exists to forbid.
 *
 * COMMENTS ARE EXEMPT, AND THAT IS LOAD-BEARING. The sentence stating the rule contains the very
 * names the rule forbids. A scanner that read prose would be red on the rule itself, and the
 * cheapest way to green would be deleting the sentence — the gate would eat its own law. So every
 * file is reduced to CODE (string literals kept, comments blanked) before the names are looked for.
 *
 *   TYPEFENCE-PRODUCTION-CLEAN  no production module under pi-extensions/ or mcp/ carries a typing
 *                               call in code. A module that acquires one is refused by name.
 *
 * The three assertions before it are this gate's own oracle: the detector is proven to SEE each
 * forbidden name in planted code, proven NOT to see it in prose, and the scanned inventory is
 * measured rather than assumed — without those, "zero hits" and "looked at nothing" read the same.
 */

import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

let passed = 0;
function ok(label: string, cond: boolean, detail = ""): void {
	assert.ok(cond, detail ? `${label}\n${detail}` : label);
	console.log(`  ok    ${label}`);
	passed++;
}

/** Each forbidden name, with the surface it belongs to. A pattern matches CODE only. */
const TYPING_CALLS: readonly { readonly name: string; readonly pattern: RegExp; readonly surface: string }[] = [
	{ name: "send-keys", pattern: /send-keys/, surface: "tmux / herdr CLI" },
	{ name: "send_keys", pattern: /send_keys/, surface: "herdr agent.send_keys" },
	{ name: "paste-buffer", pattern: /paste-buffer/, surface: "tmux" },
	{ name: "load-buffer", pattern: /load-buffer/, surface: "tmux (feeds paste-buffer)" },
	{ name: "send-text / send_text", pattern: /send[-_]text/, surface: "herdr pane.send_text" },
	{ name: '"agent.prompt"', pattern: /["'`]agent\.prompt["'`]/, surface: "herdr JSON-RPC method" },
	{ name: '"pane.input.set"', pattern: /["'`]pane\.input\.set["'`]/, surface: "herdr JSON-RPC method" },
	{ name: '"agent","prompt"', pattern: /["'`]agent["'`]\s*,\s*["'`]prompt["'`]/, surface: "herdr CLI argv" },
];

type Flavor = "c" | "shell";

/**
 * Blank every comment, keep every code byte — including string literals, because a typing call
 * spelled as a string IS the call. Offsets are preserved so a hit still reports its own line.
 */
function codeOnly(src: string, flavor: Flavor): string {
	const out = src.split("");
	let state: "code" | "line" | "block" | "sq" | "dq" | "tpl" = "code";
	let i = 0;
	while (i < src.length) {
		const c = src[i];
		const n = src[i + 1];
		if (state === "code") {
			if (flavor === "c" && c === "/" && n === "/") {
				state = "line";
				out[i] = " ";
				out[i + 1] = " ";
				i += 2;
				continue;
			}
			if (flavor === "c" && c === "/" && n === "*") {
				state = "block";
				out[i] = " ";
				out[i + 1] = " ";
				i += 2;
				continue;
			}
			// POSIX: `#` opens a comment only at the start of a word, so `${VAR#prefix}` is code.
			if (flavor === "shell" && c === "#" && (i === 0 || /\s/.test(src[i - 1]))) {
				state = "line";
				out[i] = " ";
				i += 1;
				continue;
			}
			if (c === "'") state = "sq";
			else if (c === '"') state = "dq";
			else if (c === "`" && flavor === "c") state = "tpl";
			i += 1;
			continue;
		}
		if (state === "line") {
			if (c === "\n") state = "code";
			else out[i] = " ";
			i += 1;
			continue;
		}
		if (state === "block") {
			if (c === "*" && n === "/") {
				out[i] = " ";
				out[i + 1] = " ";
				state = "code";
				i += 2;
				continue;
			}
			if (c !== "\n") out[i] = " ";
			i += 1;
			continue;
		}
		// inside a string literal: bytes are kept, escapes consume the next byte
		if (c === "\\") {
			i += 2;
			continue;
		}
		if ((state === "sq" && c === "'") || (state === "dq" && c === '"') || (state === "tpl" && c === "`")) {
			state = "code";
		}
		i += 1;
	}
	return out.join("");
}

type Hit = { readonly file: string; readonly line: number; readonly name: string; readonly text: string };

function scan(rel: string, src: string, flavor: Flavor): Hit[] {
	const code = codeOnly(src, flavor);
	const rawLines = src.split("\n");
	const hits: Hit[] = [];
	code.split("\n").forEach((codeLine, idx) => {
		for (const call of TYPING_CALLS) {
			if (call.pattern.test(codeLine)) {
				hits.push({ file: rel, line: idx + 1, name: call.name, text: rawLines[idx].trim() });
			}
		}
	});
	return hits;
}

const flavorOf = (rel: string): Flavor => (rel.endsWith(".sh") ? "shell" : "c");

// ── 1. the detector sees a planted typing call in code ──────────────────────
{
	const plantedTs = [
		'const argv = ["send-keys", "-t", pane, text];',
		'await run(["paste-buffer", "-t", pane]);',
		'await run(["load-buffer", "-b", buf]);',
		'const m = "agent.send_keys";',
		'const t = "pane.send_text";',
		'const p = "agent.prompt";',
		'const i = "pane.input.set";',
		'const cli = ["agent", "prompt", target, text];',
	].join("\n");
	const found = new Set(scan("fixture.ts", plantedTs, "c").map((h) => h.name));
	ok(
		`the detector names all ${TYPING_CALLS.length} typing calls planted in code (a green scan means it looked, not that it is blind)`,
		found.size === TYPING_CALLS.length,
		`missed: ${TYPING_CALLS.map((c) => c.name)
			.filter((n) => !found.has(n))
			.join(", ")}`,
	);
	ok(
		"the shell flavor sees a typing call too — a launcher script is production surface",
		scan("fixture.sh", 'tmux send-keys -t "$PANE" "$TEXT"\n', "shell").length === 1,
	);
	ok(
		"a `${VAR#prefix}` expansion does not blind the shell scan for the rest of its line",
		scan("fixture.sh", 'name="${PANE#%}"; tmux send-keys -t "$name" x\n', "shell").length === 1,
	);
}

// ── 2. prose is exempt — the rule's own sentence must survive its own gate ──
{
	const prose = [
		"// keystrokes (`agent prompt`) are terminal input, which this product does not use to launch.",
		"/* tmux send-keys and paste-buffer are the shape this fence refuses. */",
		'const real = "fine";',
	].join("\n");
	ok(
		"a typing call NAMED in a comment is not a violation — otherwise the cheapest green would be deleting the sentence that states the rule",
		scan("fixture.ts", prose, "c").length === 0,
	);
	ok(
		"the same exemption in shell comments",
		scan("fixture.sh", "# tmux send-keys is refused here\nexec node x.js\n", "shell").length === 0,
	);
	// The live sentence, read from the rail itself rather than quoted here: if it is ever reworded
	// the exemption must be re-proved against what the file ACTUALLY says. Only the sentence is
	// scanned — whether the module as a whole is clean is the LAW's claim below, not this one's.
	const railLine = fs
		.readFileSync(path.join(REPO, "pi-extensions/lib/herdr-fresh-call.ts"), "utf8")
		.split("\n")
		.find((l) => l.includes("keystrokes (`agent prompt`)"));
	ok(
		"the launch rail's own written rule names `agent prompt` and is exempt as the prose it is",
		railLine !== undefined && scan("rail-rule", railLine, "c").length === 0,
	);
}

// ── 3. the scanned inventory is MEASURED, never assumed ─────────────────────
const SCOPE = ["pi-extensions", "mcp"] as const;
const files = execFileSync("git", ["ls-files", "--cached", "--", ...SCOPE.map((s) => `${s}/*`)], {
	cwd: REPO,
	encoding: "utf8",
})
	.split("\n")
	.filter(Boolean)
	.filter((f) => /\.(ts|js|mjs|cjs|sh)$/.test(f))
	.filter((f) => fs.existsSync(path.join(REPO, f)));

{
	const required = [
		"pi-extensions/lib/herdr-fresh-call.ts",
		"pi-extensions/lib/mux-fresh-call.ts",
		"pi-extensions/lib/fresh-call-composition.ts",
		"pi-extensions/entwurf-control.ts",
		"mcp/entwurf-bridge/src/index.ts",
	];
	const missing = required.filter((r) => !files.includes(r));
	ok(
		`scope is non-vacuous: ${files.length} tracked production sources under ${SCOPE.join(" + ")}, both launch rails and the MCP bridge among them`,
		files.length >= 50 && missing.length === 0,
		missing.length ? `not scanned: ${missing.join(", ")}` : `only ${files.length} files matched`,
	);
}

// ── 4. THE LAW ──────────────────────────────────────────────────────────────
{
	const hits = files.flatMap((rel) => scan(rel, fs.readFileSync(path.join(REPO, rel), "utf8"), flavorOf(rel)));
	ok(
		`[QK:TYPEFENCE-PRODUCTION-CLEAN] none of the ${files.length} production sources composes a typing call — this rail builds arguments and letters, and a module that acquires a typing call is refused by name`,
		hits.length === 0,
		hits.map((h) => `${h.file}:${h.line} carries ${h.name} — ${h.text}`).join("\n"),
	);
}

console.log(`\ncheck-typing-call-fence: ${passed} assertions passed over ${files.length} production sources`);
