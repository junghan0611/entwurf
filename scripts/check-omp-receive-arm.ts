/**
 * check-omp-receive-arm — the hermetic gate for the OMP RECEIVER unit (#87 bundle B).
 *
 * WHAT IT DRIVES. The REAL assembler (`omp-receive-install.sh --assemble-only`) into a
 * temp dir, then imports the ASSEMBLED `index.ts` and binds it to a mock omp host. So the
 * subject is the artifact an operator would get, not a second copy of the logic — the same
 * discipline `check-omp-birth-hook` holds.
 *
 * WHY A MOCK HOST IS ENOUGH HERE, AND WHERE IT STOPS. Everything on entwurf's side of the
 * vendor boundary — which sessions arm, which refuse, who owns the marker, what the
 * doorbell says, what happens on `/new`, what happens when the watch dies — is decided by
 * this unit and can be proved without a model turn. What a mock CANNOT prove is that
 * `pi.sendUserMessage` really starts a turn on an idle host; that is
 * `smoke-omp-receive-live`'s job, and the two receipts must never stand in for each other.
 *
 * THE SHARED FOUR-ROOT POLICY IS NOT RE-PROVED HERE. `ompMetaRoots` is one leaf with two
 * consumers and `check-omp-birth-hook` already pins it (poisoned `PI_CODING_AGENT_DIR`,
 * the four overrides, the absolute-or-`~` grammar, the doctor's agreement). This gate
 * injects explicit roots instead, so a failure here is always about receive behaviour and
 * never about root resolution — two gates, two subjects.
 */
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import {
	type MetaRootBundle,
	metaReceiverMarkerPath,
	mintMetaIdentity,
	readMetaReceiverMarker,
	serializeMetaIdentity,
	writeMetaSenderMarker,
} from "../pi-extensions/lib/meta-session.ts";

const REPO = path.resolve(import.meta.dirname, "..");
let passed = 0;
function ok(label: string, cond: boolean, detail = ""): void {
	assert.ok(cond, `${label}${detail ? `\n${detail}` : ""}`);
	console.log(`  ok    ${label}`);
	passed++;
}

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "check-omp-receive-"));
process.on("exit", () => {
	try {
		fs.rmSync(tmp, { recursive: true, force: true });
	} catch {
		/* scratch cleanup is best-effort */
	}
});

// ── the REAL assembler, into a temp dir ──────────────────────────────────────
const asm = path.join(tmp, "asm");
execFileSync("bash", [path.join(REPO, "run.sh"), "install-omp-receive", "--assemble-only"], {
	stdio: "pipe",
	env: { ...process.env, ENTWURF_OMP_RECEIVE_ASM: asm },
});
const entry = path.join(asm, "entwurf-receive-omp", "index.ts");
ok("the real assembler produced an importable unit entry", fs.existsSync(entry), `        ${entry}`);
const mod = await import(pathToFileURL(entry).href);
ok("the assembled unit exports bindOmpReceiver", typeof mod.bindOmpReceiver === "function");

// ── the mock omp host ────────────────────────────────────────────────────────
// Narrow on purpose: exactly the surface the unit touches, with the two vendor facts this
// lane MEASURED baked in — `sendUserMessage` on the FACTORY object, timers on the event
// ctx with `clearTimer` (never `clearInterval`) as the canceller.
interface Timer {
	fn: () => void;
	cancelled: boolean;
}
class MockCtx {
	timers: Timer[] = [];
	mode: string;
	nativeSessionId: string;
	opts: { withTimers?: boolean; withClear?: boolean };
	constructor(mode: string, nativeSessionId: string, opts: { withTimers?: boolean; withClear?: boolean } = {}) {
		this.mode = mode;
		this.nativeSessionId = nativeSessionId;
		this.opts = opts;
	}
	sessionManager = {
		getSessionId: () => this.nativeSessionId,
	};
	setInterval = (fn: () => void, _ms: number): unknown => {
		if (this.opts.withTimers === false) throw new Error("no timers on this build");
		const t: Timer = { fn, cancelled: false };
		this.timers.push(t);
		return t;
	};
	/**
	 * PER-CONTEXT OWNERSHIP, and it is the whole point of this mock.
	 *
	 * A `clearTimer` that cancels any handle it is handed cannot tell a unit which cancels
	 * through the CREATING context from one which reaches for whichever context the current
	 * edge happens to carry. Nothing measured says a second event context can cancel a timer
	 * the first one created, so the oracle assumes it cannot: a foreign handle is a SILENT
	 * no-op, exactly as an unowned timer id would be. The overlapping-edge cell below is
	 * only a real test under this rule — under the permissive version it passed while the
	 * unit was still guessing.
	 */
	clearTimer = (handle: unknown): void => {
		if (!this.timers.includes(handle as Timer)) return;
		(handle as Timer).cancelled = true;
	};
	/** Fire every live timer once — the deterministic stand-in for the vendor's clock. */
	tick(): void {
		for (const t of [...this.timers]) if (!t.cancelled) t.fn();
	}
	liveTimers(): number {
		return this.timers.filter((t) => !t.cancelled).length;
	}
}
function makeCtx(mode: string, native: string, opts: { withTimers?: boolean; withClear?: boolean } = {}): any {
	const ctx: any = new MockCtx(mode, native, opts);
	if (opts.withClear === false) ctx.clearTimer = undefined;
	if (opts.withTimers === false) ctx.setInterval = undefined;
	return ctx;
}
class MockPi {
	handlers = new Map<string, Array<(e: unknown, c: unknown) => void>>();
	sent: string[] = [];
	canSend: boolean;
	constructor(canSend = true) {
		this.canSend = canSend;
		if (!canSend) (this as any).sendUserMessage = undefined;
	}
	on = (evt: string, h: (e: unknown, c: unknown) => void): void => {
		const list = this.handlers.get(evt) ?? [];
		list.push(h);
		this.handlers.set(evt, list);
	};
	sendUserMessage = (text: string): void => {
		this.sent.push(text);
	};
	fire(evt: string, ctx: unknown, event: unknown = {}): void {
		for (const h of this.handlers.get(evt) ?? []) h(event, ctx);
	}
}

let cellSeq = 0;
interface Cell {
	roots: MetaRootBundle;
	pid: number;
	logs: string[];
	pi: MockPi;
	receiver: any;
}
/** One isolated garden per cell: no cell can pass because another cell left state behind. */
function newCell(opts: { canSend?: boolean } = {}): Cell {
	const base = path.join(tmp, `cell-${++cellSeq}`);
	const roots: MetaRootBundle = {
		sessionsDir: path.join(base, "meta-sessions"),
		mailboxDir: path.join(base, "meta-mailbox"),
		sendersDir: path.join(base, "meta-senders"),
		receiversDir: path.join(base, "meta-receivers"),
	};
	for (const d of Object.values(roots)) fs.mkdirSync(d, { recursive: true });
	const logs: string[] = [];
	const pi = new MockPi(opts.canSend ?? true);
	const receiver = mod.bindOmpReceiver(pi, {
		pid: process.pid,
		rootsFor: () => roots,
		log: (level: string, message: string) => logs.push(`${level} ${message}`),
	});
	return { roots, pid: process.pid, logs, pi, receiver };
}

/** Seed a born citizen: the V3 record plus the sender marker birth would have written. */
function seedBirth(cell: Cell, nativeSessionId: string): string {
	const identity = mintMetaIdentity({ backend: "omp", nativeSessionId, cwd: "/tmp", transcriptPath: null });
	fs.writeFileSync(
		path.join(cell.roots.sessionsDir, `${identity.gardenId}.meta.json`),
		serializeMetaIdentity(identity),
	);
	writeMetaSenderMarker({
		backend: "omp",
		gardenId: identity.gardenId,
		nativeSessionId,
		cwd: "/tmp",
		ownerPid: cell.pid,
		sendersDir: cell.roots.sendersDir,
	});
	return identity.gardenId;
}
function markerFor(cell: Cell, gardenId: string) {
	return readMetaReceiverMarker({ gardenId, receiversDir: cell.roots.receiversDir, verifyOwner: false });
}
function logHas(cell: Cell, needle: string): boolean {
	return cell.logs.some((l) => l.includes(needle));
}

// ── 1. the §3.5 scope fence ──────────────────────────────────────────────────
// Every task subagent re-executes this factory by default, so a unit that armed on any
// mode would publish a doorbell for the HOST's citizen from inside a subagent — a second
// watcher on one mailbox, and a marker whose owner is not the session it names.
for (const mode of ["print", "rpc", "json"]) {
	const cell = newCell();
	const gid = seedBirth(cell, `native-${mode}`);
	cell.pi.fire("session_start", makeCtx(mode, `native-${mode}`));
	ok(`[QK:OMP-RECEIVE-SCOPE-FENCE] mode=${mode} arms NOTHING`, markerFor(cell, gid) === null);
	ok(`mode=${mode} leaves a scope-refused receipt in the log`, logHas(cell, `scope-refused`));
}

// ── 2. the happy path, and what the marker says ──────────────────────────────
{
	const cell = newCell();
	const gid = seedBirth(cell, "native-happy");
	cell.pi.fire("session_start", makeCtx("tui", "native-happy"));
	const m = markerFor(cell, gid);
	ok("[QK:OMP-RECEIVE-ARMS-TUI-HOST] a tui host with a born citizen arms a receiver marker", m !== null);
	ok("the marker names the HOST process as the watch owner", m?.ownerKind === "omp-host" && m?.ownerPid === cell.pid);
	ok(
		"the marker carries backend omp and the vendor's native session id",
		m?.backend === "omp" && m?.nativeSessionId === "native-happy",
	);
	ok("armProvenance is session-start (the edge that armed it)", m?.armProvenance === "session-start");
	cell.receiver.unarm("gate-teardown");
}

// ── 3. ORDER: no sender marker yet is a DEFER, not an arm ────────────────────
// The measured failure mode: a discovered extension sorting before the birth unit runs
// first and finds nothing to join. Arming anyway would publish a doorbell for a citizen
// that does not exist; refusing forever would leave it permanently unaddressable.
{
	const cell = newCell();
	const ctx = makeCtx("tui", "native-late");
	cell.pi.fire("session_start", ctx);
	ok(
		"[QK:OMP-RECEIVE-DEFERS-BEFORE-BIRTH] nothing is armed while birth has not run",
		fs.readdirSync(cell.roots.receiversDir).length === 0,
	);
	ok("[QK:OMP-RECEIVE-RETRY-ARMS] a bounded retry timer is running after a deferred arm", ctx.liveTimers() === 1);
	ok("the log says arm-deferred, not arm-refused", logHas(cell, "arm-deferred") && !logHas(cell, "arm-refused"));
	const gid = seedBirth(cell, "native-late");
	ctx.tick();
	ok("the retry arms once birth's marker appears", markerFor(cell, gid) !== null);
	ok("the retry timer is cancelled once armed (ctx.clearTimer, the vendor's only canceller)", ctx.liveTimers() === 0);
	cell.receiver.unarm("gate-teardown");
}

// ── 3b. TWO OVERLAPPING EDGES: the first context's timer must really stop ────
// The gap a review found, and it is the uncancellable-timer failure wearing a different
// hat. `onEdge` used to call `cancelRetry()` with no argument, so the optional
// `ctx?.clearTimer?.()` did nothing while `retryHandle` was set to null: the handle was
// DROPPED rather than cancelled. A second birth edge during a deferred arm then left the
// first context's 500ms poll running in the operator's TUI with no reference left to stop
// it, and started a second beside it — one orphan per `/new` while birth was slow.
//
// The signed assertion is deliberately the FIRST one the defect breaks. A signature placed
// after an unsigned assertion the same mutant also breaks reads back as KILLED-WRONG-REASON,
// which is how this gate learned to place them (see the retry cell above).
{
	const cell = newCell();
	const ctx1 = makeCtx("tui", "native-one");
	cell.pi.fire("session_start", ctx1);
	ok("a deferred arm leaves a live retry timer on the FIRST context", ctx1.liveTimers() === 1);

	const gid2 = seedBirth(cell, "native-two");
	const ctx2 = makeCtx("tui", "native-two");
	cell.pi.fire("session_switch", ctx2, { reason: "new" });
	ok(
		"[QK:OMP-RECEIVE-EDGE-CANCELS-OLD-RETRY] a second birth edge CANCELS the first context's timer instead of orphaning it",
		ctx1.liveTimers() === 0,
		`        ctx1 live=${ctx1.liveTimers()} ctx2 live=${ctx2.liveTimers()}`,
	);
	ok("the second edge armed for its own citizen", markerFor(cell, gid2) !== null);
	ok("and it started no retry of its own, having armed immediately", ctx2.liveTimers() === 0);
	// An orphaned timer is not merely untidy: it keeps calling back into a receiver that has
	// moved on. Ticking the abandoned context must therefore be inert.
	const before = fs.readdirSync(cell.roots.receiversDir).length;
	ctx1.tick();
	ok("ticking the abandoned context changes nothing", fs.readdirSync(cell.roots.receiversDir).length === before);
	cell.receiver.unarm("gate-teardown");
}

// ── 4. the retry is BOUNDED ──────────────────────────────────────────────────
// An unbounded poll inside the operator's TUI is a leak, and "birth never happened" is a
// real outcome that deserves a logged giving-up rather than a silent forever-loop.
{
	const cell = newCell();
	const ctx = makeCtx("tui", "native-never");
	cell.pi.fire("session_start", ctx);
	for (let i = 0; i < 60 && ctx.liveTimers() > 0; i++) ctx.tick();
	ok("[QK:OMP-RECEIVE-RETRY-BOUNDED] the retry gives up instead of polling forever", ctx.liveTimers() === 0);
	ok("giving up is LOGGED as not-addressable", logHas(cell, "arm-gave-up"));
}

// ── 5. a timer this build cannot cancel is never started ─────────────────────
// `ctx.clearInterval` does not exist on omp v18; calling it through `?.` was measured to
// be a SILENT no-op that left a 500ms poll running for the life of the session. An
// unarmed citizen is an honest refusal; an uncancellable timer is a defect we installed.
{
	const cell = newCell();
	const ctx = makeCtx("tui", "native-noclear", { withClear: false });
	cell.pi.fire("session_start", ctx);
	ok("[QK:OMP-RECEIVE-NO-UNCANCELLABLE-TIMER] no retry is started without ctx.clearTimer", ctx.timers.length === 0);
	ok("the refusal names both probed methods", logHas(cell, "arm-retry-unavailable"));
}

// ── 6. a doorbell that cannot ring is never advertised ───────────────────────
{
	const cell = newCell({ canSend: false });
	const gid = seedBirth(cell, "native-nosend");
	cell.pi.fire("session_start", makeCtx("tui", "native-nosend"));
	ok(
		"[QK:OMP-RECEIVE-REFUSES-WITHOUT-WAKE] no marker when pi.sendUserMessage is absent",
		markerFor(cell, gid) === null,
	);
	ok("the refusal is an ERROR, not a silent skip", logHas(cell, "ERROR") && logHas(cell, "cannot ring"));
}

// ── 7. drift refusals, on BOTH axes, isolated from each other ────────────────
// A marker written against a drifted id tells a sender that a reply lands in a session
// which will never see it.
{
	const cell = newCell();
	const gid = seedBirth(cell, "native-A");
	cell.pi.fire("session_start", makeCtx("tui", "native-B"));
	ok("a vendor id that disagrees with BOTH the marker and the record arms nothing", markerFor(cell, gid) === null);
	ok("no marker file exists at all for the drifted cell", fs.readdirSync(cell.roots.receiversDir).length === 0);
}
{
	// THE ISOLATING CELL, and it exists because a mutant SURVIVED without it. Removing the
	// marker-level id check left this gate green: in the cell above the RECORD check caught
	// the drift too, so the two guards were indistinguishable and only one was really pinned.
	// Here the record AGREES with the vendor while the sender marker is stale — the shape a
	// `/new` produces in the window before birth rewrites the marker. Only the marker-level
	// check can refuse it, and arming here would publish a doorbell off an id the vendor has
	// already moved past.
	const cell = newCell();
	const identity = mintMetaIdentity({
		backend: "omp",
		nativeSessionId: "native-current",
		cwd: "/tmp",
		transcriptPath: null,
	});
	fs.writeFileSync(
		path.join(cell.roots.sessionsDir, `${identity.gardenId}.meta.json`),
		serializeMetaIdentity(identity),
	);
	writeMetaSenderMarker({
		backend: "omp",
		gardenId: identity.gardenId,
		nativeSessionId: "native-stale",
		cwd: "/tmp",
		ownerPid: cell.pid,
		sendersDir: cell.roots.sendersDir,
	});
	cell.pi.fire("session_start", makeCtx("tui", "native-current"));
	ok(
		"[QK:OMP-RECEIVE-ID-DRIFT-REFUSED] a STALE sender marker is refused even when the record agrees with the vendor",
		markerFor(cell, identity.gardenId) === null && fs.readdirSync(cell.roots.receiversDir).length === 0,
	);
}

// ── 8. `/new`: the cell the start-key guard can NEVER catch ──────────────────
// Same pid, same start key, different citizen. Without an explicit unarm the previous
// garden id keeps reading as an ACTIVE receiver and dispatch enqueues into a mailbox this
// process has stopped watching — a false deliverability nothing upstream can detect,
// because from outside the process really is alive.
{
	const cell = newCell();
	const oldGid = seedBirth(cell, "native-first");
	cell.pi.fire("session_start", makeCtx("tui", "native-first"));
	ok("armed for the first citizen", markerFor(cell, oldGid) !== null);
	const newGid = seedBirth(cell, "native-second");
	cell.pi.fire("session_switch", makeCtx("tui", "native-second"), { reason: "new" });
	ok(
		"[QK:OMP-RECEIVE-NEW-RETIRES-OLD] the previous citizen's marker is GONE after /new",
		markerFor(cell, oldGid) === null,
	);
	ok("the replacement citizen is armed", markerFor(cell, newGid) !== null);
	ok("exactly one receiver marker remains", fs.readdirSync(cell.roots.receiversDir).length === 1);
	cell.receiver.unarm("gate-teardown");
}

// ── 9. ORDER CONTRACT: no watch, no marker ───────────────────────────────────
// `fs.watch` is a real failure surface. A marker written before it would advertise a
// doorbell nobody is listening at — the fail-closed rule inverted.
{
	const cell = newCell();
	const gid = seedBirth(cell, "native-nowatch");
	// Make the mailbox path un-mkdir-able: a FILE where the directory must go.
	fs.writeFileSync(path.join(cell.roots.mailboxDir, gid), "not a directory");
	cell.pi.fire("session_start", makeCtx("tui", "native-nowatch"));
	ok("a pre-watch setup failure leaves NO marker", markerFor(cell, gid) === null);
	ok("the failure is logged as arm-failed", logHas(cell, "arm-failed"));
}

{
	// THE ORDERING CELL, and it exists because a mutant SURVIVED without it. The cell above
	// fails at `mkdirSync`, BEFORE either the marker or the watch, so it cannot tell a unit
	// that writes the marker after the watch from one that writes it before. Here the
	// mailbox and the signal both exist and only `fs.watch` fails (EACCES on an unreadable
	// signal — the same class as an exhausted inotify budget), so the two orderings give
	// different answers and only the correct one leaves no marker.
	const cell = newCell();
	const gid = seedBirth(cell, "native-eacces");
	const mailbox = path.join(cell.roots.mailboxDir, gid);
	fs.mkdirSync(mailbox, { recursive: true });
	const signal = path.join(mailbox, "inbox.signal");
	fs.writeFileSync(signal, "");
	fs.chmodSync(signal, 0o000);
	cell.pi.fire("session_start", makeCtx("tui", "native-eacces"));
	fs.chmodSync(signal, 0o600);
	ok(
		"[QK:OMP-RECEIVE-NO-WATCH-NO-MARKER] a watch that FAILED while the mailbox already existed leaves NO marker",
		markerFor(cell, gid) === null,
	);
	ok("the watch failure is logged as arm-failed", logHas(cell, "arm-failed"));
}

// ── 10. the doorbell: announce-only, and what it must not contain ────────────
{
	const cell = newCell();
	const gid = seedBirth(cell, "native-ring");
	cell.pi.fire("session_start", makeCtx("tui", "native-ring"));
	const mailbox = path.join(cell.roots.mailboxDir, gid);
	const secret = "SECRET-BODY-THAT-MUST-NOT-BE-INJECTED";
	fs.writeFileSync(path.join(mailbox, "2026-01-01T00-00-00-000Z-aaaaaa.msg"), secret);
	fs.writeFileSync(path.join(mailbox, "inbox.signal"), new Date().toISOString());
	// fs.watch is asynchronous even in a hermetic gate; wait on the effect, not a sleep.
	const deadline = Date.now() + 5000;
	while (cell.pi.sent.length === 0 && Date.now() < deadline) {
		await new Promise((r) => setTimeout(r, 25));
	}
	ok(
		"[QK:OMP-RECEIVE-DOORBELL-RINGS] a fresh .msg rings the doorbell",
		cell.pi.sent.length === 1,
		`        sent=${JSON.stringify(cell.pi.sent)}`,
	);
	const notice = cell.pi.sent[0] ?? "";
	ok(
		"the notice names the garden id and the drain tool",
		notice.includes(gid) && notice.includes("entwurf_inbox_read"),
	);
	ok("[QK:OMP-RECEIVE-ANNOUNCE-NEVER-PUSHES] the notice does NOT carry the message body", !notice.includes(secret));
	ok("the notice marks the bodies untrusted", notice.includes("untrusted"));
	ok(
		"the body was stamped .delivered BEFORE announcing (rename means rang, not read)",
		fs.readdirSync(mailbox).some((f) => f.endsWith(".msg.delivered")),
	);
	cell.receiver.unarm("gate-teardown");
}

// ── 11. a vanished mailbox gives the marker back ─────────────────────────────
// `meta-bridge-fresh-cut` archives the mailbox tree; inotify follows the inode, so the
// watch survives pointing at a file nobody will ever poke again.
{
	const cell = newCell();
	const gid = seedBirth(cell, "native-vanish");
	cell.pi.fire("session_start", makeCtx("tui", "native-vanish"));
	ok("armed before the mailbox vanishes", markerFor(cell, gid) !== null);
	const mailbox = path.join(cell.roots.mailboxDir, gid);
	fs.writeFileSync(path.join(mailbox, "2026-01-01T00-00-00-000Z-bbbbbb.msg"), "body");
	fs.rmSync(path.join(mailbox, "inbox.signal"), { force: true });
	// Removing the watched file is itself a watch event, so the unit's own doorbell path
	// runs and finds the signal gone — no test-only entry point is needed or offered.
	const deadline2 = Date.now() + 5000;
	while (markerFor(cell, gid) !== null && Date.now() < deadline2) {
		await new Promise((r) => setTimeout(r, 25));
	}
	ok(
		"[QK:OMP-RECEIVE-VANISHED-SIGNAL-UNARMS] a signal that no longer exists retires the marker rather than advertising a dead doorbell",
		markerFor(cell, gid) === null,
	);
}

// ── 12. teardown removes OUR marker only ─────────────────────────────────────
// A replacement receiver for the same citizen must never have ITS marker deleted by our
// teardown — the same identity guard the Copilot receiver holds.
{
	const cell = newCell();
	const gid = seedBirth(cell, "native-foreign");
	cell.pi.fire("session_start", makeCtx("tui", "native-foreign"));
	const file = metaReceiverMarkerPath(gid, cell.roots.receiversDir);
	const mine = JSON.parse(fs.readFileSync(file, "utf8"));
	fs.writeFileSync(file, JSON.stringify({ ...mine, ownerPid: mine.ownerPid + 1 }, null, 2));
	cell.receiver.unarm("gate-foreign-check");
	ok(
		"[QK:OMP-RECEIVE-UNARM-IS-IDENTITY-GUARDED] a marker owned by another pid survives our teardown",
		fs.existsSync(file),
	);
}

// ── 13. binding must not leak listeners into the operator's host ─────────────
// omp re-executes the extension factory PER SESSION, subagents included, and they all
// share one process. An unconditional `process.on("exit")` at bind time therefore grew one
// listener per subagent — this gate hit `MaxListenersExceededWarning` at 11 bindings, which
// in a real session would print that warning into the operator's TUI. Binding is not when a
// teardown becomes owed; ARMING is, and a subagent never arms.
{
	const before = process.listenerCount("exit");
	for (let i = 0; i < 20; i++) {
		const cell = newCell();
		cell.pi.fire("session_start", makeCtx("print", `native-sub-${i}`));
	}
	ok(
		"[QK:OMP-RECEIVE-BIND-LEAKS-NO-LISTENERS] 20 subagent bindings add ZERO process exit listeners",
		process.listenerCount("exit") === before,
		`        before=${before} after=${process.listenerCount("exit")}`,
	);
	const cell = newCell();
	seedBirth(cell, "native-guard");
	cell.pi.fire("session_start", makeCtx("tui", "native-guard"));
	ok("an ARMED receiver does register exactly one exit guard", process.listenerCount("exit") === before + 1);
	cell.receiver.unarm("gate-teardown");
	ok(
		"unarming gives that listener back (a host cycling /new accumulates none)",
		process.listenerCount("exit") === before,
	);
}

console.log(`[check-omp-receive-arm] ${passed} assertions ok`);
