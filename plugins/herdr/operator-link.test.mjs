// #153 operator link: the receipt-owned single `entwurf` link, its opt-out, and the order it is
// published in. The SHIPPED module closure is copied to the fixture runtime's own package address and
// imported from there, so the active-package self admission is the real one; no root is overridden.
// Producer order is observed with path-scoped `node:fs` spies that record the disk AT the event.
// Sandbox HOME/XDG only. What a real shell selects (aliases, hash, SSH) is outside these cells.

import { spawnSync } from "node:child_process";
import fs from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const CLOSURE = ["herdr-operator-link.mjs", "herdr-activation.mjs", "herdr-runtime.mjs"];
const PKG = path.join("node_modules", "@junghanacs", "entwurf");
const COMPILED_ENTRY = path.join("mcp", "entwurf-bridge", "dist", "mcp", "entwurf-bridge", "src", "index.js");
const IDENTITY = {
	kind: "npm",
	name: "@junghanacs/entwurf",
	version: "0.21.0",
	expectedIntegrity: "sha512-fixture",
	observedDigest: `sha256-${"c".repeat(64)}`,
};

const roots = [];
afterEach(() => {
	vi.restoreAllMocks();
	for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true });
});

/** Copy the shipped closure into `pkgRoot/scripts` and import the copy. */
async function closureAt(pkgRoot) {
	fs.mkdirSync(path.join(pkgRoot, "scripts"), { recursive: true });
	fs.writeFileSync(
		path.join(pkgRoot, "package.json"),
		`${JSON.stringify({ name: IDENTITY.name, version: IDENTITY.version })}\n`,
	);
	for (const f of CLOSURE) fs.copyFileSync(path.join(REPO, "scripts", f), path.join(pkgRoot, "scripts", f));
	return {
		link: await import(pathToFileURL(path.join(pkgRoot, "scripts", "herdr-operator-link.mjs")).href),
		activation: await import(pathToFileURL(path.join(pkgRoot, "scripts", "herdr-activation.mjs")).href),
		entry: path.join(pkgRoot, "scripts", "herdr-operator-link.mjs"),
	};
}

/**
 * A settled Herdr host: a runtime-ready journal over a verifying runtime whose package carries the
 * copied closure, a pi-activated ledger at `version`, and a physical bin dir B first on PATH.
 */
async function host({ version = 2 } = {}) {
	const dir = fs.realpathSync(fs.mkdtempSync(path.join(tmpdir(), "entwurf-opl-")));
	roots.push(dir);
	const home = path.join(dir, "home");
	const B = path.join(dir, "bin-B");
	fs.mkdirSync(home, { recursive: true });
	fs.mkdirSync(B);
	const env = {
		HOME: home,
		XDG_DATA_HOME: path.join(home, "data"),
		XDG_STATE_HOME: path.join(home, "state"),
		XDG_CACHE_HOME: path.join(home, "cache"),
		XDG_CONFIG_HOME: path.join(home, "config"),
		PI_CODING_AGENT_DIR: path.join(home, "pi-agent"),
		CLAUDE_CONFIG_DIR: path.join(home, "claude"),
		PATH: `${B}${path.delimiter}${process.env.PATH}`,
	};
	const activeDir = path.join(env.XDG_DATA_HOME, "entwurf", "herdr-plugin", "runtime", "active");
	const pkgRoot = path.join(activeDir, PKG);
	const mods = await closureAt(pkgRoot);
	fs.mkdirSync(path.dirname(path.join(pkgRoot, COMPILED_ENTRY)), { recursive: true });
	fs.writeFileSync(path.join(pkgRoot, COMPILED_ENTRY), "// compiled entry fixture\n");
	const bin = path.join(activeDir, "node_modules", ".bin");
	fs.mkdirSync(bin, { recursive: true });
	for (const name of ["entwurf", "entwurf-bridge", "entwurf-statusline"]) {
		fs.writeFileSync(
			path.join(bin, name),
			`#!/bin/sh\ncase "$1" in check-bridge) exit 0 ;; esac\necho "OPL-MARKER ${name} $*"\n`,
			{ mode: 0o755 },
		);
	}
	fs.mkdirSync(path.join(env.XDG_DATA_HOME, "entwurf", "herdr-plugin"), { recursive: true });
	fs.writeFileSync(
		path.join(env.XDG_DATA_HOME, "entwurf", "herdr-plugin", "journal.json"),
		`${JSON.stringify({ schemaVersion: 2, phase: "runtime-ready", runtimeRoot: activeDir, artifactIdentity: IDENTITY, previousRuntime: null })}\n`,
	);
	const layout = mods.activation.resolveActivationLayout(env);
	mods.activation.writeLedger(
		layout,
		version,
		mods.activation.ledgerBody({
			phase: "active",
			runtimeRoot: activeDir,
			artifactIdentity: IDENTITY,
			roots: mods.activation.resolveComponentRoots(env),
			states: { pi: "active" },
		}),
	);
	const receiptPath = path.join(layout.stateRoot, "operator-link.json");
	const target = path.join(activeDir, "node_modules", ".bin", "entwurf");
	return {
		dir,
		home,
		B,
		env,
		activeDir,
		pkgRoot,
		mods,
		ledgerPath: layout.ledgerPath,
		receiptPath,
		target,
		linkPath: path.join(B, "entwurf"),
	};
}

const read = (p) => (fs.existsSync(p) ? fs.readFileSync(p, "utf8") : "<absent>");
const linkText = (p) => {
	const kind = fs.lstatSync(p, { throwIfNoEntry: false });
	if (kind === undefined) return "<absent>";
	return kind.isSymbolicLink() ? `-> ${fs.readlinkSync(p)}` : "<not a symlink>";
};
const ledgerVersion = (h) =>
	fs.existsSync(h.ledgerPath) ? JSON.parse(fs.readFileSync(h.ledgerPath, "utf8")).schemaVersion : null;
const refusal = (fn) => {
	try {
		fn();
		return null;
	} catch (err) {
		return err.code ?? `uncoded:${err.message}`;
	}
};
/** Everything a refusal must leave as it was. */
const snapshot = (h) => ({
	ledger: read(h.ledgerPath),
	receipt: read(h.receiptPath),
	link: linkText(h.linkPath),
	bin: fs.existsSync(h.B) ? fs.readdirSync(h.B).sort().join(",") : "<absent>",
});
const receiptOf = (h, phase, over = {}) => ({
	schemaVersion: 1,
	phase,
	binDir: h.B,
	linkPath: h.linkPath,
	target: h.target,
	runtimeRoot: h.activeDir,
	...over,
});
const seedReceipt = (h, body) => fs.writeFileSync(h.receiptPath, `${JSON.stringify(body, null, 2)}\n`);
const expose = (h, binDir = h.B) => h.mods.link.expose(h.env, ["--bin-dir", binDir], { cwd: h.home });
const withdraw = (h, mods = h.mods) => mods.link.withdraw(h.env, []);

describe("herdr operator link (#153)", () => {
	it("[QK:OPL-FORWARD-ONE-LINK] creates exactly B/entwurf -> the runtime's own bin, records it linked, raises the floor, and is idempotent", async () => {
		const h = await host();
		const ledgerBefore = JSON.parse(read(h.ledgerPath));
		const first = expose(h);
		const ledgerAfter = JSON.parse(read(h.ledgerPath));
		const after = snapshot(h);
		const again = expose(h);
		// Bare `entwurf` through the fixture PATH and cwd: which file this caller's PATH selects. The marker is a
		// source-shaped observation of that selection only — not packaged-CLI evidence.
		const selected = spawnSync("entwurf", ["help"], { encoding: "utf8", env: h.env, cwd: h.home });
		expect(first).toMatch(/^linked /);
		expect(fs.readlinkSync(h.linkPath)).toBe(path.join(h.activeDir, "node_modules", ".bin", "entwurf"));
		expect(after.bin).toBe("entwurf");
		expect(JSON.parse(read(h.receiptPath))).toEqual(receiptOf(h, "linked"));
		const { schemaVersion: before, ...bodyBefore } = ledgerBefore;
		const { schemaVersion: raised, ...bodyAfter } = ledgerAfter;
		expect([before, raised]).toEqual([2, 3]);
		expect(bodyAfter).toEqual(bodyBefore);
		expect(again).toMatch(/^already linked /);
		expect(snapshot(h)).toEqual(after);
		expect([selected.status, selected.stderr, selected.stdout]).toEqual([0, "", "OPL-MARKER entwurf help\n"]);
	});

	it("[QK:OPL-FLOOR-BEFORE-RECEIPT] the floor is 3 when the receipt first says linking, and a refused floor write publishes nothing after it", async () => {
		const h = await host();
		const events = [];
		const real = fs.renameSync;
		vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
			if (to === h.receiptPath)
				events.push({ phase: JSON.parse(fs.readFileSync(from, "utf8")).phase, ledger: ledgerVersion(h) });
			return real.call(fs, from, to);
		});
		expose(h);
		vi.restoreAllMocks();
		expect(events[0]).toEqual({ phase: "linking", ledger: 3 });

		const r = await host();
		const before = snapshot(r);
		vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
			if (to === r.ledgerPath)
				throw Object.assign(new Error("fixture: ledger publication refused"), { code: "EFIXTURE" });
			return real.call(fs, from, to);
		});
		const code = refusal(() => expose(r));
		vi.restoreAllMocks();
		expect(code).toBe("EFIXTURE");
		expect(snapshot(r)).toEqual(before);
	});

	it("[QK:OPL-RECEIPT-BEFORE-LINK] the receipt says linking before the symlink is made, and a refused receipt write makes no link", async () => {
		const h = await host();
		const events = [];
		const real = fs.symlinkSync;
		vi.spyOn(fs, "symlinkSync").mockImplementation((target, at) => {
			if (at === h.linkPath)
				events.push({
					receipt: fs.existsSync(h.receiptPath) ? JSON.parse(fs.readFileSync(h.receiptPath, "utf8")).phase : null,
					ledger: ledgerVersion(h),
				});
			return real.call(fs, target, at);
		});
		expose(h);
		vi.restoreAllMocks();
		expect(events).toEqual([{ receipt: "linking", ledger: 3 }]);

		const r = await host();
		const renameReal = fs.renameSync;
		vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
			if (to === r.receiptPath)
				throw Object.assign(new Error("fixture: receipt publication refused"), { code: "EFIXTURE" });
			return renameReal.call(fs, from, to);
		});
		const code = refusal(() => expose(r));
		vi.restoreAllMocks();
		// What the refused publication left, fixed as values at once — before the retry touches anything.
		const left = { code, link: linkText(r.linkPath), receipt: read(r.receiptPath), ledger: ledgerVersion(r) };
		const retried = expose(r);
		expect(left).toEqual({ code: "EFIXTURE", link: "<absent>", receipt: "<absent>", ledger: 3 });
		expect(retried).toMatch(/^linked /);
		expect([linkText(r.linkPath), JSON.parse(read(r.receiptPath)).phase]).toEqual([`-> ${r.target}`, "linked"]);
	});

	it("[QK:OPL-LINKED-AFTER-LINK] the receipt says linked only once the exact link stands", async () => {
		const h = await host();
		const events = [];
		const real = fs.renameSync;
		vi.spyOn(fs, "renameSync").mockImplementation((from, to) => {
			if (to === h.receiptPath)
				events.push({ phase: JSON.parse(fs.readFileSync(from, "utf8")).phase, link: linkText(h.linkPath) });
			return real.call(fs, from, to);
		});
		expose(h);
		vi.restoreAllMocks();
		expect(events).toEqual([
			{ phase: "linking", link: "<absent>" },
			{ phase: "linked", link: `-> ${h.target}` },
		]);
	});

	it("[QK:OPL-SELF-IS-ACTIVE] expose runs only as the active runtime's own package; a copy elsewhere is refused before any write", async () => {
		const h = await host();
		const elsewhere = await closureAt(path.join(h.dir, "elsewhere", PKG));
		const before = snapshot(h);
		const code = refusal(() => elsewhere.link.expose(h.env, ["--bin-dir", h.B], { cwd: h.home }));
		expect(code).toBe("operator-link-not-active-package");
		expect(snapshot(h)).toEqual(before);
	});

	it("[QK:OPL-WITHDRAW-SELF] withdraw runs only as the active runtime's own package; a copy elsewhere removes nothing", async () => {
		const h = await host();
		expose(h);
		const elsewhere = await closureAt(path.join(h.dir, "elsewhere", PKG));
		const before = snapshot(h);
		const code = refusal(() => withdraw(h, elsewhere));
		expect(code).toBe("operator-link-not-active-package");
		expect(snapshot(h)).toEqual(before);
	});

	it("[QK:OPL-SETTLED-ONLY] a staged or backed-up runtime beside the active one refuses expose before any write", async () => {
		const h = await host();
		fs.mkdirSync(path.join(path.dirname(h.activeDir), "previous"));
		const before = snapshot(h);
		expect(refusal(() => expose(h))).toBe("operator-link-runtime-not-settled");
		expect(snapshot(h)).toEqual(before);
	});

	it("[QK:OPL-BIN-DIR-CANONICAL] a bin dir reached through an aliased PARENT is not its own realpath and is refused", async () => {
		const h = await host();
		const realParent = path.join(h.dir, "real-parent");
		fs.mkdirSync(path.join(realParent, "B2"), { recursive: true });
		fs.symlinkSync(realParent, path.join(h.dir, "alias-parent"));
		const aliased = path.join(h.dir, "alias-parent", "B2");
		h.env.PATH = `${aliased}${path.delimiter}${h.env.PATH}`;
		const before = { ...snapshot(h), aliased: fs.readdirSync(aliased).join(",") };
		expect(fs.lstatSync(aliased).isDirectory()).toBe(true);
		expect(refusal(() => expose(h, aliased))).toBe("operator-link-bin-dir-refused");
		expect({ ...snapshot(h), aliased: fs.readdirSync(aliased).join(",") }).toEqual(before);
	});

	it("[QK:OPL-PATH-NOT-SHADOWED] an executable entwurf in an earlier PATH entry refuses by path alone, without running it", async () => {
		const h = await host();
		const shadow = path.join(h.dir, "shadow");
		const ran = path.join(h.dir, "shadow-ran");
		fs.mkdirSync(shadow);
		fs.writeFileSync(path.join(shadow, "entwurf"), `#!/bin/sh\ntouch "${ran}"\n`, { mode: 0o755 });
		h.env.PATH = `${shadow}${path.delimiter}${h.env.PATH}`;
		const before = snapshot(h);
		let detail = "";
		try {
			expose(h);
		} catch (err) {
			detail = `${err.code}: ${err.detail}`;
		}
		expect(detail).toMatch(/^operator-link-path-shadowed: /);
		expect(detail).toContain(path.join(shadow, "entwurf"));
		expect(fs.existsSync(ran)).toBe(false);
		expect(snapshot(h)).toEqual(before);

		// An empty entry is the caller's cwd and a relative one is relative to it — the cwd the caller passed,
		// not this process's. Neither shadow is run.
		for (const entry of ["", "rel-bin"]) {
			const c = await host();
			const dir = path.join(c.home, entry);
			const cwdRan = path.join(c.dir, "cwd-shadow-ran");
			fs.mkdirSync(dir, { recursive: true });
			fs.writeFileSync(path.join(dir, "entwurf"), `#!/bin/sh\ntouch "${cwdRan}"\n`, { mode: 0o755 });
			c.env.PATH = `${entry}${path.delimiter}${c.env.PATH}`;
			const cBefore = snapshot(c);
			let cDetail = "";
			try {
				expose(c);
			} catch (err) {
				cDetail = `${err.code}: ${err.detail}`;
			}
			expect(cDetail).toMatch(/^operator-link-path-shadowed: /);
			expect(cDetail).toContain(path.join(dir, "entwurf"));
			expect(fs.existsSync(cwdRan)).toBe(false);
			expect(snapshot(c)).toEqual(cBefore);
		}
	});

	it("[QK:OPL-FOREIGN-REFUSED] a link with no receipt is someone else's — even one aimed at the same target", async () => {
		const h = await host();
		fs.symlinkSync(h.target, h.linkPath);
		const before = snapshot(h);
		expect(refusal(() => expose(h))).toBe("operator-link-foreign");
		expect(snapshot(h)).toEqual(before);
		expect(ledgerVersion(h)).toBe(2);
	});

	it("[QK:OPL-RECEIPT-NEEDS-FLOOR] a receipt beside a schema-2 ledger is refused, never adopted or raised to fit", async () => {
		const h = await host({ version: 2 });
		fs.symlinkSync(h.target, h.linkPath);
		seedReceipt(h, receiptOf(h, "linked"));
		const before = snapshot(h);
		expect(refusal(() => expose(h))).toBe("operator-link-floor-mismatch");
		expect(snapshot(h)).toEqual(before);
	});

	it("[QK:OPL-LINKED-MISSING-DRIFT] a linked receipt whose link is gone is named drift, not silently re-created", async () => {
		const h = await host();
		expose(h);
		fs.unlinkSync(h.linkPath);
		const before = snapshot(h);
		expect(refusal(() => expose(h))).toBe("operator-link-drift");
		expect(snapshot(h)).toEqual(before);
	});

	it("[QK:OPL-LINKING-PUBLISH-ONLY] a run stopped after the symlink resumes by publishing linked, never by making the link again", async () => {
		const h = await host({ version: 3 });
		fs.symlinkSync(h.target, h.linkPath);
		seedReceipt(h, receiptOf(h, "linking"));
		const made = [];
		const real = fs.symlinkSync;
		vi.spyOn(fs, "symlinkSync").mockImplementation((target, at) => {
			made.push(at);
			return real.call(fs, target, at);
		});
		const resumed = expose(h);
		vi.restoreAllMocks();
		expect(resumed).toMatch(/\(resumed\)$/);
		expect(made).toEqual([]);
		expect(JSON.parse(read(h.receiptPath)).phase).toBe("linked");
		expect(linkText(h.linkPath)).toBe(`-> ${h.target}`);

		const a = await host({ version: 3 });
		seedReceipt(a, receiptOf(a, "linking"));
		expose(a);
		expect(linkText(a.linkPath)).toBe(`-> ${a.target}`);
		expect(JSON.parse(read(a.receiptPath)).phase).toBe("linked");
	});

	it("[QK:OPL-WITHDRAW-ONLY-OURS] withdraw removes exactly our link and receipt and keeps the floor; a foreign link or an aliased B removes nothing", async () => {
		const h = await host();
		expose(h);
		expect(withdraw(h)).toMatch(/^withdrew /);
		expect([linkText(h.linkPath), read(h.receiptPath), ledgerVersion(h)]).toEqual(["<absent>", "<absent>", 3]);

		const f = await host();
		expose(f);
		fs.unlinkSync(f.linkPath);
		fs.symlinkSync(path.join(f.dir, "someone-else"), f.linkPath);
		const fBefore = snapshot(f);
		expect(refusal(() => withdraw(f))).toBe("operator-link-foreign");
		expect(snapshot(f)).toEqual(fBefore);

		const a = await host();
		expose(a);
		fs.renameSync(a.B, `${a.B}.moved`);
		fs.symlinkSync(`${a.B}.moved`, a.B);
		const aBefore = { receipt: read(a.receiptPath), moved: linkText(path.join(`${a.B}.moved`, "entwurf")) };
		expect(refusal(() => withdraw(a))).toBe("operator-link-bin-dir-drifted");
		expect({ receipt: read(a.receiptPath), moved: linkText(path.join(`${a.B}.moved`, "entwurf")) }).toEqual(aBefore);

		const g = await host();
		expose(g);
		fs.rmSync(g.B, { recursive: true });
		expect(withdraw(g)).toMatch(/^withdrew /);
		expect(read(g.receiptPath)).toBe("<absent>");

		// Seeded `unlinking` states, retried: with our link still there, and with it already gone.
		const u = await host({ version: 3 });
		fs.symlinkSync(u.target, u.linkPath);
		seedReceipt(u, receiptOf(u, "unlinking"));
		expect(withdraw(u)).toMatch(/^withdrew /);
		expect([linkText(u.linkPath), read(u.receiptPath), ledgerVersion(u)]).toEqual(["<absent>", "<absent>", 3]);

		const v = await host({ version: 3 });
		seedReceipt(v, receiptOf(v, "unlinking"));
		expect(withdraw(v)).toMatch(/^withdrew /);
		expect([linkText(v.linkPath), read(v.receiptPath), ledgerVersion(v)]).toEqual(["<absent>", "<absent>", 3]);
	});

	it("[QK:OPL-WITHDRAW-ORPHAN-REFUSED] a receipt with no ledger is an orphan: withdraw refuses it instead of calling it done", async () => {
		const h = await host();
		expose(h);
		fs.rmSync(h.ledgerPath);
		const before = snapshot(h);
		expect(refusal(() => withdraw(h))).toBe("operator-link-orphan");
		expect(snapshot(h)).toEqual(before);
	});

	it("[QK:OPL-RECEIPT-TARGET-EXACT] a receipt whose target is not this runtime's own bin is uncertified: withdraw removes neither it nor the link it names", async () => {
		const h = await host({ version: 3 });
		const outside = path.join(h.dir, "outside", "entwurf");
		fs.mkdirSync(path.dirname(outside), { recursive: true });
		fs.writeFileSync(outside, "#!/bin/sh\nexit 0\n", { mode: 0o755 });
		fs.symlinkSync(outside, h.linkPath);
		seedReceipt(h, receiptOf(h, "linked", { target: outside }));
		const before = snapshot(h);
		expect(refusal(() => withdraw(h))).toBe("operator-link-receipt-uncertified");
		expect(snapshot(h)).toEqual(before);
	});

	it("[QK:OPL-STRICT-ARGV] the copied entry accepts exactly `expose --bin-dir <abs>` and a bare `withdraw`; anything else exits 2 on stderr with nothing written", async () => {
		const h = await host();
		const run = (argv) =>
			spawnSync(process.execPath, [h.mods.entry, ...argv], { encoding: "utf8", env: h.env, cwd: h.home });
		const before = snapshot(h);
		const bad = [
			["expose"],
			["expose", "--bin-dir"],
			["expose", "--bin-dir", h.B, "extra"],
			["expose", "--dir", h.B],
			["expose", "--bin-dir", "relative/bin"],
			["withdraw", "now"],
			["bogus"],
		].map((argv) => {
			const r = run(argv);
			return {
				argv: argv.join(" "),
				status: r.status,
				stdout: r.stdout,
				named: r.stderr.includes("operator-link-usage"),
			};
		});
		const unchanged = JSON.stringify(snapshot(h)) === JSON.stringify(before);
		const good = run(["expose", "--bin-dir", h.B]);
		for (const b of bad) expect(b).toEqual({ argv: b.argv, status: 2, stdout: "", named: true });
		expect(unchanged).toBe(true);
		expect([good.status, good.stderr]).toEqual([0, ""]);
		expect(linkText(h.linkPath)).toBe(`-> ${h.target}`);
	});
});
