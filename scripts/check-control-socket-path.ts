// check-control-socket-path — the control-socket path grammar has ONE definition.
//
// WHY THIS GATE EXISTS
//
// `<dir>/<gardenId>.sock` used to be re-implemented by THREE independent
// producers, each with its own `".sock"` literal and its own `path.join`:
//
//   pi-extensions/lib/socket-discovery.ts   CONTROL_SOCKET_DIR + SOCKET_SUFFIX + controlSocketPath
//   pi-extensions/entwurf-control.ts        own ENTWURF_DIR + own SOCKET_SUFFIX + own getSocketPath
//   mcp/entwurf-bridge/src/index.ts         own DEFAULT_ENTWURF_DIR + own SOCKET_SUFFIX + 2 inline joins
//
// Nothing asserted that the three agreed. Rebinding one left the others silently
// addressing the old path — no compile error, no gate RED. The bridge even carried
// a comment claiming `controlSocketPath` was the SSOT while two lines in the same
// file bypassed it.
//
// The grammar now lives in `pi-extensions/lib/control-socket-path.js`, authored as
// `.js` because it must be importable from BOTH runtime lanes: the emit-capable
// root tsconfig (which `entwurf-control.ts` belongs to and which cannot enable
// `allowImportingTsExtensions`) and the `--experimental-strip-types` lane (bridge +
// scripts). That fence is exactly why `entwurf-control.ts` could never import
// `controlSocketPath` from `socket-discovery.ts` — a lib→lib value importer — and
// grew its own copy instead.
//
// Directory SOURCE is deliberately NOT unified: the pi side derives from HOME, the
// bridge honours `ENTWURF_DIR`. This gate pins the GRAMMAR, not the policy.
//
// Two duties below: (1) the leaf's own behaviour, incl. the round trip and the
// null case; (2) a re-implementation fence over all three adapters.

import * as assert from "node:assert";
import { readFileSync } from "node:fs";
import * as path from "node:path";
import {
	CONTROL_SOCKET_SUFFIX,
	controlSocketPathIn,
	defaultControlSocketDir,
	gardenIdFromSocketFilename,
} from "../pi-extensions/lib/control-socket-path.js";

const REPO = path.resolve(import.meta.dirname, "..");

let passed = 0;
function ok(label: string, cond: boolean): void {
	assert.ok(cond, label);
	console.log(`  ok    ${label}`);
	passed++;
}

// ---------------------------------------------------------------------------
// (1) grammar
// ---------------------------------------------------------------------------

const DIR = "/iso/sandbox/.pi/entwurf-control";
const GID = "20260722T155812-7a9f44";

ok("suffix is .sock", CONTROL_SOCKET_SUFFIX === ".sock");
ok("controlSocketPathIn = <dir>/<gid>.sock", controlSocketPathIn(DIR, GID) === `${DIR}/${GID}.sock`);
ok(
	"defaultControlSocketDir = <home>/.pi/entwurf-control",
	defaultControlSocketDir("/h") === path.join("/h", ".pi", "entwurf-control"),
);
// The leaf must never read the environment: dir source stays adapter policy.
ok(
	"defaultControlSocketDir is a pure function of its argument",
	defaultControlSocketDir("/a") !== defaultControlSocketDir("/b"),
);

ok("inverse recovers the gid", gardenIdFromSocketFilename(`${GID}.sock`) === GID);
// The nullable return is load-bearing: it is what forces both dir-scanners to keep
// the guard the leaf absorbed. Typed/behaving as a bare string, a suffix-less name
// would slice into garbage instead of being skipped.
ok("inverse returns null without the suffix", gardenIdFromSocketFilename(GID) === null);
ok("inverse returns null for a bare suffix", gardenIdFromSocketFilename(".sock") === null);
ok("inverse returns null for an empty name", gardenIdFromSocketFilename("") === null);
ok(
	"round trip: basename(forward) → inverse === gid",
	gardenIdFromSocketFilename(path.basename(controlSocketPathIn(DIR, GID))) === GID,
);

// ---------------------------------------------------------------------------
// (2) re-implementation fence
// ---------------------------------------------------------------------------

const ADAPTERS = [
	"pi-extensions/lib/socket-discovery.ts",
	"pi-extensions/entwurf-control.ts",
	"mcp/entwurf-bridge/src/index.ts",
] as const;

/** Strip comments so a documented history of the old grammar never trips the fence. */
function stripComments(src: string): string {
	return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/(^|[^:])\/\/[^\n]*/g, "$1");
}

for (const rel of ADAPTERS) {
	const code = stripComments(readFileSync(path.join(REPO, rel), "utf8"));

	// A DECLARATION of the literal — not a re-export of the shared constant, which
	// socket-discovery.ts legitimately does to keep `SOCKET_SUFFIX` importable by
	// its existing consumers and gates.
	ok(
		`${rel}: declares no local ".sock" literal`,
		!/(?:const|let|var)\s+[A-Za-z_$][\w$]*\s*(?::[^=]+)?=\s*["'`]\.sock["'`]/.test(code),
	);

	// The join, in either the template or the concatenation form.
	ok(
		`${rel}: assembles no socket path inline`,
		!/path\.join\([^)]*\$\{[^}]*\}\s*\$\{[^}]*SUFFIX[^}]*\}/.test(code) &&
			!/path\.join\([^)]*\+\s*[A-Za-z_$][\w$]*SUFFIX/.test(code) &&
			!/path\.join\([^)]*["'`]\.sock["'`]/.test(code),
	);

	// The inverse, which is half the grammar and was duplicated in both scanners.
	ok(
		`${rel}: parses no socket filename inline`,
		!/\.slice\(\s*0\s*,\s*-\s*[A-Za-z_$][\w$]*SUFFIX\.length\s*\)/.test(code),
	);

	ok(`${rel}: imports the shared grammar`, /from\s+["'][^"']*control-socket-path\.js["']/.test(code));
}

console.log(`\ncheck-control-socket-path: ${passed} assertions ok`);
