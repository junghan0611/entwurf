/**
 * check-codex-app-server-launch — deterministic gate for the managed Codex app-server
 * launch (`entwurf codex-app-server`, #95). Hermetic: no Codex CLI, no app-server, no
 * network, no model turn, no write outside its own temp root.
 *
 * WHAT IS UNDER TEST is a process replacement, so the oracle is a FAKE VENDOR: a real
 * executable placed on a sandbox PATH under the real name `codex`, which reports the argv,
 * pid and cwd it was handed and then exits. Everything is asserted from that report, never
 * from reading the launcher's source. The launcher is driven through its PUBLIC address
 * (`run.sh codex-app-server`), because the dispatcher's own argv handling is part of the
 * contract: the verb must not reach the vendor.
 *
 * THE ADDRESS ORACLE, AND WHY IT IS SHAPED LIKE THIS NOW. The first version of this launcher
 * re-derived the socket path in bash, and this gate compared the two spellings over four
 * ASCII-normal inputs. They agreed on those four and diverged elsewhere: `[측정 2026-09-16,
 * independent review]` `CODEX_HOME=$'\ufeff'` trims to nothing in JS and keeps its byte in a
 * POSIX `[:space:]` trim, so the launcher would have started a server at
 * `<BOM>/app-server-control/app-server-control.sock` while delivery looked at `$HOME/.codex`.
 * A matrix can only ever hold the inputs somebody thought of, so the second spelling was
 * removed rather than widened — the launcher now ASKS `run.sh codex-socket-path`, which prints
 * what `resolveCodexDefaultSocketPath` computes.
 *
 * That makes the cells below a WIRING oracle rather than a transcription oracle, and they are
 * written to fail if the wiring is ever replaced by arithmetic again: the matrix keeps the
 * ASCII cases AND carries the hostile inputs that caught the divergence, with the expectation
 * computed by the real TS function on the same environment. The mutant that matters is not
 * "drop CODEX_HOME" any more; it is "derive the path here instead of asking".
 */

import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import * as net from "node:net";
import { tmpdir } from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";

import { resolveCodexDefaultSocketPath } from "../pi-extensions/lib/native-push/codex-ws-client.ts";

const REPO = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

let passed = 0;
function ok(label: string, cond: boolean): void {
	assert.ok(cond, label);
	console.log(`  ok    ${label}`);
	passed++;
}

const root = mkdtempSync(path.join(tmpdir(), "entwurf-codex-app-server-launch."));
const servers: net.Server[] = [];
try {
	const home = path.join(root, "home");
	const bin = path.join(root, "bin");
	for (const d of [home, bin]) mkdirSync(d, { recursive: true });

	// The fake vendor. `printf '%s\n'` per element keeps empty strings and embedded spaces
	// visible as themselves, which is the only way to assert byte preservation.
	const vendor = path.join(bin, "codex");
	writeFileSync(
		vendor,
		`#!/usr/bin/env bash
echo "CWD=$PWD"
echo "PID=$$"
echo "PPID=$PPID"
echo "PISESSION=[\${PI_SESSION_ID-<unset>}]"
echo "PIAGENT=[\${PI_AGENT_ID-<unset>}]"
echo "KEEP=\${ENTWURF_FIXTURE_KEEP-0}"
for a in "$@"; do printf 'ARG<%s>\\n' "$a"; done
exit "\${FAKE_CODEX_EXIT:-0}"
`,
	);
	chmodSync(vendor, 0o755);

	interface Run {
		status: number | null;
		out: string;
		args: string[];
		cwd: string;
		pid: string;
		ppid: string;
		piSession: string;
		piAgent: string;
	}

	// A PATH with no `codex` anywhere on it — built by dropping every real PATH entry that
	// actually holds one, rather than by emptying PATH (the launcher still needs python3,
	// readlink and friends).
	const pathWithoutVendor = (process.env.PATH ?? "")
		.split(":")
		.filter((d) => d !== "" && !existsSync(path.join(d, "codex")))
		.join(":");

	function launch(args: string[], extraEnv: Record<string, string | undefined> = {}, cwd = root): Run {
		const r = spawnSync("bash", [path.join(REPO, "run.sh"), "codex-app-server", ...args], {
			cwd,
			encoding: "utf8",
			env: {
				...process.env,
				HOME: home,
				CODEX_HOME: undefined as unknown as string,
				TMUX: undefined as unknown as string,
				PATH: `${bin}:${process.env.PATH ?? ""}`,
				ENTWURF_CODEX_APP_SERVER_ACTIVE: undefined as unknown as string,
				...extraEnv,
			} as NodeJS.ProcessEnv,
		});
		const out = `${r.stdout ?? ""}${r.stderr ?? ""}`;
		const argv: string[] = [];
		for (const line of out.split("\n")) {
			const m = /^ARG<([\s\S]*)>$/.exec(line);
			if (m) argv.push(m[1]);
		}
		return {
			status: r.status,
			out,
			args: argv,
			// Line-anchored, NOT `[\s\S]*`: a greedy any-character match would run past this
			// line's delimiter and capture everything down to the last matching line.
			cwd: /^CWD=(.*)$/m.exec(out)?.[1] ?? "",
			pid: /^PID=(.*)$/m.exec(out)?.[1] ?? "",
			ppid: /^PPID=(.*)$/m.exec(out)?.[1] ?? "",
			piSession: /^PISESSION=\[(.*)\]$/m.exec(out)?.[1] ?? "<no-launch>",
			piAgent: /^PIAGENT=\[(.*)\]$/m.exec(out)?.[1] ?? "<no-launch>",
		};
	}

	// ── 1. the address, taken from the leaf the product reads ───────────────────
	// Two groups, and the second is the load-bearing one. The ASCII cells are the environment
	// shapes `resolveCodexHome` distinguishes at all. The HOSTILE cells are the inputs on which
	// a bash transcription was MEASURED to diverge from it — a BOM-only CODEX_HOME (JS `trim`
	// strips U+FEFF, a POSIX `[:space:]` trim does not) and the two `path.join` normalizations.
	// They are here so that replacing the `codex-socket-path` call with arithmetic goes red
	// instead of passing on well-behaved paths, which is exactly how the first version passed.
	{
		const explicit = path.join(root, "explicit-codex-home");
		const matrix: Array<{ label: string; env: Record<string, string | undefined> }> = [
			{ label: "HOME only", env: {} },
			{ label: "explicit CODEX_HOME", env: { CODEX_HOME: explicit } },
			{ label: "whitespace CODEX_HOME falls back to HOME", env: { CODEX_HOME: "   " } },
			{ label: "CODEX_HOME with surrounding whitespace is trimmed", env: { CODEX_HOME: `  ${explicit}  ` } },
			{ label: "BOM-only CODEX_HOME is not a value and falls back to HOME", env: { CODEX_HOME: "\ufeff" } },
			{ label: "a trailing slash is normalized away", env: { CODEX_HOME: `${explicit}/` } },
			{ label: "a .. segment is normalized", env: { CODEX_HOME: `${explicit}/sub/..` } },
		];
		for (const cell of matrix) {
			const r = launch([], cell.env);
			const want = `unix://${resolveCodexDefaultSocketPath({
				HOME: home,
				CODEX_HOME: cell.env.CODEX_HOME,
			})}`;
			ok(
				`[QK:CODEX-APP-SERVER-ADDRESS-MATCHES-PRODUCT-LEAF] ${cell.label}: the vendor is handed exactly the address resolveCodexDefaultSocketPath computes (want ${want}, got ${JSON.stringify(r.args)})`,
				r.status === 0 && JSON.stringify(r.args) === JSON.stringify(["app-server", "--listen", want]),
			);
		}
	}

	// ── 2. the subcommand, and the operator's argv after it ─────────────────────
	{
		const r = launch(["--config", "a=b", "", "two words"]);
		const want = `unix://${resolveCodexDefaultSocketPath({ HOME: home })}`;
		ok(
			`[QK:CODEX-APP-SERVER-FORWARDS-OPERATOR-ARGV] operator arguments follow the injected address byte-identical, empty strings and spaces intact (got ${JSON.stringify(r.args)})`,
			r.status === 0 &&
				JSON.stringify(r.args) === JSON.stringify(["app-server", "--listen", want, "--config", "a=b", "", "two words"]),
		);
	}
	{
		const r = launch([]);
		ok(
			"the dispatcher verb never reaches the vendor — a stray `codex-app-server` argument would arrive as a vendor subcommand",
			!r.args.includes("codex-app-server"),
		);
	}
	{
		// A second `--listen` is refused rather than appended. Two listen addresses let one
		// win silently, and the silent winner is an endpoint no record points at.
		const equals = launch(["--listen=unix:///tmp/mine.sock"]);
		const spaced = launch(["--listen", "unix:///tmp/mine.sock"]);
		ok(
			"[QK:CODEX-APP-SERVER-REFUSES-SECOND-LISTEN] an operator --listen is a named refusal, in both spellings, and never reaches the vendor",
			equals.status !== 0 &&
				spaced.status !== 0 &&
				equals.out.includes("codex-app-server-listen-override") &&
				spaced.out.includes("codex-app-server-listen-override") &&
				equals.args.length === 0 &&
				spaced.args.length === 0,
		);
	}

	// ── 3. exec, not fork ───────────────────────────────────────────────────────
	{
		// `exec` is what makes Ctrl-C, the exit status and the process identity the vendor's.
		// A forking launcher would leave run.sh sitting between the operator and the server:
		// signals would hit the wrapper, and the thing the operator thinks they killed would
		// not be the thing that dies.
		//
		// The oracle is the vendor's PARENT, which is the only side of this that a single run
		// can measure honestly. This gate spawns bash directly, so an unbroken exec chain
		// (run.sh -> launcher -> vendor) leaves the vendor as THIS process's own child. Any
		// fork anywhere along the way inserts a bash between them, and the reported parent
		// stops being this gate. Comparing a pid across two separate runs would prove nothing.
		const r = launch([]);
		ok(
			`[QK:CODEX-APP-SERVER-EXECS-NOT-FORKS] the vendor runs AS the launcher process, not as a child of it — its parent is this gate itself (ppid ${r.ppid}, gate ${process.pid})`,
			r.status === 0 && r.pid !== "" && r.ppid === String(process.pid),
		);
	}
	{
		const r = launch([], { FAKE_CODEX_EXIT: "37" });
		ok(
			"the vendor's exit status is the caller's exit status — an app-server that dies on a bad config must not read as a successful launch",
			r.status === 37,
		);
	}
	{
		const r = launch([], {}, home);
		ok("the vendor inherits the caller's cwd — no subshell, no cd", r.status === 0 && r.cwd === home);
	}

	// ── 4. the socket is somebody else's until proven otherwise ─────────────────
	{
		// A LIVE socket is the case that matters: a second server would either lose the bind
		// race or replace the endpoint every existing record points at. The fixture is a real
		// listening AF_UNIX socket, so the launcher's own connect probe is what decides.
		const liveHome = path.join(root, "live-home");
		const liveSock = resolveCodexDefaultSocketPath({ CODEX_HOME: liveHome });
		mkdirSync(path.dirname(liveSock), { recursive: true });
		const server = net.createServer();
		servers.push(server);
		server.listen(liveSock);
		const r = launch([], { CODEX_HOME: liveHome });
		ok(
			"[QK:CODEX-APP-SERVER-REFUSES-LIVE-SOCKET] a live control socket is a named refusal and the vendor is never reached",
			r.status !== 0 && r.out.includes("codex-app-server-already-listening") && r.args.length === 0,
		);
		ok(
			"with nothing on this host spelling that socket, the refusal SAYS so rather than naming a holder it cannot see",
			r.out.includes("What /proc reports about it:") && r.out.includes("read, not inferred") && !/pid \d+:/.test(r.out),
		);
		server.close();
		servers.pop();
	}
	{
		// The other half, and the pair is what makes either one discriminating. The first
		// version asserted "fallback text OR a pid line", which every run satisfied through the
		// fallback branch — deleting the scan entirely would have passed it. So this cell puts a
		// process on the host whose cmdline really does carry the socket path and requires the
		// refusal to name THAT pid. A launcher that stopped reading /proc now goes red here, and
		// a launcher that invented an owner goes red in the cell above.
		const ownedHome = path.join(root, "owned-home");
		const ownedSock = resolveCodexDefaultSocketPath({ CODEX_HOME: ownedHome });
		mkdirSync(path.dirname(ownedSock), { recursive: true });
		const server = net.createServer();
		servers.push(server);
		server.listen(ownedSock);
		// A decoy whose ARGV carries the path. It does not hold the socket, and it must not: the
		// launcher reports what `/proc/*/cmdline` says, which is a READING, and this cell pins
		// exactly that reading rather than a claim about socket ownership the kernel never made.
		const holder = spawn("python3", ["-c", "import time; time.sleep(120)", ownedSock], {
			stdio: "ignore",
			detached: false,
		});
		try {
			const r = launch([], { CODEX_HOME: ownedHome });
			ok(
				`[QK:CODEX-APP-SERVER-READS-PROC-HOLDER] the refusal names the pid whose cmdline actually carries that socket (want pid ${holder.pid})`,
				r.status !== 0 &&
					r.out.includes("codex-app-server-already-listening") &&
					r.out.includes(`pid ${holder.pid}:`) &&
					!r.out.includes("read, not inferred"),
			);
		} finally {
			holder.kill("SIGKILL");
		}
		server.close();
		servers.pop();
	}
	{
		// A DEAD socket file is the ordinary leftover of a hard kill: the file survives, the
		// listener does not. The vendor replaces it, so this is a FACT LINE and not a refusal —
		// and the separation matters, because folding it into the live case would make every
		// crashed server a permanent block on restarting one. The fixture binds an AF_UNIX
		// socket in a process that then exits without unlinking, which is exactly the on-disk
		// state a killed app-server leaves.
		const staleHome = path.join(root, "stale-home");
		const staleSock = resolveCodexDefaultSocketPath({ CODEX_HOME: staleHome });
		mkdirSync(path.dirname(staleSock), { recursive: true });
		spawnSync("python3", ["-c", "import socket,sys;s=socket.socket(socket.AF_UNIX);s.bind(sys.argv[1])", staleSock]);
		const r = launch([], { CODEX_HOME: staleHome });
		ok(
			`[QK:CODEX-APP-SERVER-LAUNCHES-OVER-DEAD-SOCKET] a socket file with no listener is reported and LAUNCHED over, not refused (status ${r.status})`,
			r.status === 0 && r.out.includes("a dead control socket is already at") && r.args.length === 3,
		);
	}
	{
		const fileHome = path.join(root, "file-home");
		const fileSock = resolveCodexDefaultSocketPath({ CODEX_HOME: fileHome });
		mkdirSync(path.dirname(fileSock), { recursive: true });
		writeFileSync(fileSock, "");
		const r = launch([], { CODEX_HOME: fileHome });
		ok(
			"a path that exists and is not a socket is indeterminate, not stale — the launcher refuses instead of clobbering something it cannot identify",
			r.status !== 0 && r.out.includes("codex-app-server-socket-indeterminate") && r.args.length === 0,
		);
	}
	{
		const linkHome = path.join(root, "link-home");
		const linkSock = resolveCodexDefaultSocketPath({ CODEX_HOME: linkHome });
		mkdirSync(path.dirname(linkSock), { recursive: true });
		symlinkSync(path.join(root, "nowhere.sock"), linkSock);
		const r = launch([], { CODEX_HOME: linkHome });
		ok(
			"[QK:CODEX-APP-SERVER-REFUSES-INDETERMINATE-SOCKET] a symlinked control socket is refused by name — the same classification the delivery rail's socket check uses",
			r.status !== 0 && r.out.includes("codex-app-server-socket-indeterminate") && r.args.length === 0,
		);
	}
	{
		// An absent socket is the normal first launch, and the control directory is created
		// for it — that mkdir is what makes this ONE command instead of two.
		const freshHome = path.join(root, "fresh-home");
		const r = launch([], { CODEX_HOME: freshHome });
		ok(
			"a first launch on a host with no control directory creates it and reaches the vendor",
			r.status === 0 && existsSync(path.dirname(resolveCodexDefaultSocketPath({ CODEX_HOME: freshHome }))),
		);
	}

	{
		// Hard Rule 15: an unrecognised reading is the one case where proceeding is unsafe,
		// because every branch above is a decision about whether this launch would clobber a
		// running server. The stimulus is a sandbox `python3` that exits 0 while printing
		// something nobody wrote — the exact shape a silent fall-through needs.
		const oddBin = path.join(root, "odd-probe-bin");
		mkdirSync(oddBin, { recursive: true });
		const oddPython = path.join(oddBin, "python3");
		writeFileSync(oddPython, "#!/usr/bin/env bash\ncat >/dev/null\necho 'unexpected-probe-status'\nexit 0\n");
		chmodSync(oddPython, 0o755);
		const r = launch([], { PATH: `${oddBin}:${bin}:${process.env.PATH ?? ""}` });
		ok(
			"[QK:CODEX-APP-SERVER-REFUSES-UNRECOGNISED-PROBE] a socket classifier that exits 0 with a reading nobody wrote REFUSES instead of falling through to the exec",
			r.status !== 0 && r.out.includes("codex-app-server-socket-probe-unrecognised") && r.args.length === 0,
		);
	}

	// ── 5. refusals that keep this from becoming something it is not ────────────
	{
		const r = launch([], { PATH: pathWithoutVendor });
		ok(
			"no codex on PATH is a named refusal that names the repair, not a silent no-op",
			r.status !== 0 && r.out.includes("no 'codex' executable found on PATH"),
		);
	}
	{
		const r = launch([], { ENTWURF_CODEX_APP_SERVER_ACTIVE: "1" });
		ok(
			"[QK:CODEX-APP-SERVER-REFUSES-RECURSION] an already-set launch sentinel refuses instead of spinning a launch loop",
			r.status !== 0 && r.out.includes("recursive managed launch detected"),
		);
	}
	{
		// The self-exec fence, with the sentinel deliberately absent: a `codex` on PATH that
		// resolves back to our own entrypoint is a loop the sentinel alone would not catch if
		// it were ever stripped between hops.
		const loopBin = path.join(root, "loop-bin");
		mkdirSync(loopBin, { recursive: true });
		symlinkSync(path.join(REPO, "scripts", "codex-app-server-launch.sh"), path.join(loopBin, "codex"));
		const r = launch([], { PATH: `${loopBin}:${pathWithoutVendor}` });
		ok(
			"a PATH `codex` that resolves to entwurf's own launcher is refused as a launch loop",
			r.status !== 0 && r.out.includes("launch loop"),
		);
	}

	// ── 6. the tmux line is a fact, and the identity carriers are not ───────────
	{
		const inside = launch([], { TMUX: "/tmp/tmux-1000/default,1234,0" });
		const outside = launch([]);
		ok(
			"[QK:CODEX-APP-SERVER-REPORTS-TMUX-SEAT] the tmux seat is REPORTED in both directions and refuses neither — running outside tmux is an operator choice with a consequence, not an error",
			inside.status === 0 &&
				outside.status === 0 &&
				inside.out.includes("/tmp/tmux-1000/default,1234,0") &&
				outside.out.includes("(none — not inside tmux)") &&
				outside.out.includes("caller-seat lookups"),
		);
	}
	{
		// The app-server is the parent of every bridge child, so a pi identity inherited here
		// would be inherited by all of them. Both carriers go together: clearing one only
		// changes the wording of a later failure while leaving a carrier for a partial reader.
		const both = launch([], { PI_SESSION_ID: "pi-session-fixture", PI_AGENT_ID: "pi-agent-fixture" });
		const onlySession = launch([], { PI_SESSION_ID: "pi-session-fixture" });
		const onlyAgent = launch([], { PI_AGENT_ID: "pi-agent-fixture" });
		ok(
			`[QK:CODEX-APP-SERVER-STRIPS-IDENTITY-CARRIERS] neither PI_SESSION_ID nor PI_AGENT_ID survives into the server every bridge child inherits from (got "${both.piSession}"/"${both.piAgent}", "${onlySession.piSession}", "${onlyAgent.piAgent}")`,
			both.piSession === "<unset>" &&
				both.piAgent === "<unset>" &&
				onlySession.piSession === "<unset>" &&
				onlyAgent.piAgent === "<unset>",
		);
	}
	{
		// The strip is identity-only. A launch that also swallowed the operator's own
		// environment would be a different, quieter defect.
		const r = launch(["--config", "x=1"], { PI_SESSION_ID: "x", ENTWURF_FIXTURE_KEEP: "1" });
		ok(
			"the strip touches ONLY the two identity carriers — the operator's argv and unrelated environment survive it",
			r.status === 0 && r.args.includes("--config") && r.args.includes("x=1") && r.out.includes("KEEP=1"),
		);
	}

	console.log(`\n[check-codex-app-server-launch] PASS (${passed} assertions)`);
} finally {
	for (const s of servers) s.close();
	rmSync(root, { recursive: true, force: true });
}
