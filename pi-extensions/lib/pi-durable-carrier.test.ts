/**
 * pi-durable carrier (#130) — the relocation grammar the maintainer emitter applies and the resolver
 * accepts (pi/pi-durable/carrier-relocation.mjs), and the committed carrier against its pin.
 *
 * Pure: no install, no runtime, no upstream source. The installed-consumer load and the physical SDK
 * edges are a package proof (check-pack-install), not this file's subject.
 */

import { spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
	CARRIER_SCHEME,
	codingAgentDistFrom,
	readCarrierDeclaration,
	relocateCarrierSource,
	resolveCarrierSpecifier,
} from "../../pi/pi-durable/carrier-relocation.mjs";
import { readSourceObject } from "../../scripts/emit-pi-durable-carrier.ts";

const ROOT = path.resolve(import.meta.dirname, "..", "..");
const DURABLE = path.join(ROOT, "pi", "pi-durable");
const PIN = path.join(DURABLE, "overlay", "upstream-pin.json");

const declared = { siblings: ["runtime.js", "tui.js"], targets: ["core/model-runtime.js", "config.js"] };
const reasonOf = (fn: () => unknown): string | undefined => {
	try {
		fn();
	} catch (error) {
		return (error as { reason?: string }).reason;
	}
	return undefined;
};

describe("relocateCarrierSource", () => {
	it("[QK:PI-DURABLE-CARRIER-RELOCATION-TWO-RULES] siblings become .js, ../../ internals take the reserved scheme, bare stays", () => {
		const code = [
			'import { ModelRuntime } from "../../core/model-runtime.ts";',
			"import {",
			"\tagentOf,",
			'} from "./runtime.ts";',
			'import { Harness } from "@earendil-works/pi-durable";',
			'import "node:path";',
			"",
		].join("\n");
		const out = relocateCarrierSource("tui.js", code, declared);
		expect(out.code).toBe(
			[
				`import { ModelRuntime } from "${CARRIER_SCHEME}core/model-runtime.js";`,
				"import {",
				"\tagentOf,",
				'} from "./runtime.js";',
				'import { Harness } from "@earendil-works/pi-durable";',
				'import "node:path";',
				"",
			].join("\n"),
		);
		expect(out.used).toEqual(["core/model-runtime.js"]);
	});

	it("[QK:PI-DURABLE-CARRIER-RELOCATION-REFUSES] an undeclared sibling or target, another relative path, a dynamic or unrecognized import", () => {
		const one = (code: string) => reasonOf(() => relocateCarrierSource("tui.js", code, declared));
		expect(one('import { x } from "./main.ts";\n')).toBe("carrier-relocation-unknown-sibling");
		expect(one('import { x } from "../../core/skills.ts";\n')).toBe("carrier-relocation-unknown-target");
		expect(one('import { x } from "../core/model-runtime.ts";\n')).toBe("carrier-relocation-unknown-relative");
		expect(one('import { x } from "/abs/model-runtime.ts";\n')).toBe("carrier-relocation-unknown-relative");
		expect(one(`import { x } from "${CARRIER_SCHEME}config.js";\n`)).toBe("carrier-relocation-unknown-relative");
		expect(one('const m = await import("../../config.ts");\n')).toBe("carrier-relocation-unrecognized-import");
		expect(one("import { x } from '../../config.ts';\n")).toBe("carrier-relocation-unrecognized-import");
	});
});

describe("resolveCarrierSpecifier", () => {
	let dist: string;
	let carrierDirUrl: string;
	beforeEach(() => {
		const root = fs.mkdtempSync(path.join(os.tmpdir(), "pi-durable-carrier-test-"));
		dist = path.join(root, "pi-coding-agent", "dist");
		fs.mkdirSync(path.join(dist, "core"), { recursive: true });
		fs.writeFileSync(path.join(dist, "core", "model-runtime.js"), "");
		carrierDirUrl = pathToFileURL(path.join(root, "entwurf", "pi", "pi-durable", "carrier")).href + "/";
	});
	afterEach(() => {
		fs.rmSync(path.dirname(path.dirname(dist)), { recursive: true, force: true });
	});
	const ask = (specifier: string, parent: string | undefined) =>
		resolveCarrierSpecifier(specifier, parent, {
			carrierDirUrl,
			files: declared.siblings,
			targets: declared.targets,
			dist: () => dist,
		});

	it("[QK:PI-DURABLE-CARRIER-RESOLVE-DECLARED] a declared carrier file asking for a declared target gets that file under the physical dist", () => {
		expect(ask(`${CARRIER_SCHEME}core/model-runtime.js`, `${carrierDirUrl}runtime.js`)).toBe(
			pathToFileURL(path.join(dist, "core", "model-runtime.js")).href,
		);
	});

	it("[QK:PI-DURABLE-CARRIER-RESOLVE-REFUSES] another origin, an undeclared or escaping target, a missing file", () => {
		const reason = (specifier: string, parent: string | undefined) => reasonOf(() => ask(specifier, parent));
		const target = `${CARRIER_SCHEME}core/model-runtime.js`;
		expect(reason(target, undefined)).toBe("pi-durable-carrier-specifier-origin");
		expect(reason(target, `${carrierDirUrl}main.js`)).toBe("pi-durable-carrier-specifier-origin");
		expect(reason(target, `${carrierDirUrl}nested/runtime.js`)).toBe("pi-durable-carrier-specifier-origin");
		expect(reason(target, pathToFileURL(path.join(ROOT, "pi", "pi-durable", "bootstrap.mjs")).href)).toBe(
			"pi-durable-carrier-specifier-origin",
		);
		expect(reason(`${CARRIER_SCHEME}core/skills.js`, `${carrierDirUrl}runtime.js`)).toBe(
			"pi-durable-carrier-specifier-unknown",
		);
		expect(reason(`${CARRIER_SCHEME}../../package.json`, `${carrierDirUrl}runtime.js`)).toBe(
			"pi-durable-carrier-specifier-unknown",
		);
		expect(reason(`${CARRIER_SCHEME}config.js`, `${carrierDirUrl}runtime.js`)).toBe(
			"pi-durable-carrier-target-missing",
		);
	});

	it("[QK:PI-DURABLE-CARRIER-HOST-ROOT] the dist is the parent of the root export only when that root is pi-coding-agent", () => {
		const root = path.dirname(dist);
		const entry = pathToFileURL(path.join(dist, "index.js")).href;
		expect(reasonOf(() => codingAgentDistFrom(entry))).toBe("pi-durable-carrier-host-root");
		fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "@earendil-works/pi-ai" }));
		expect(reasonOf(() => codingAgentDistFrom(entry))).toBe("pi-durable-carrier-host-root");
		fs.writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "@earendil-works/pi-coding-agent" }));
		expect(codingAgentDistFrom(entry)).toBe(dist);
		expect(reasonOf(() => codingAgentDistFrom(pathToFileURL(path.join(dist, "core", "model-runtime.js")).href))).toBe(
			"pi-durable-carrier-host-root",
		);
	});
});

describe("the committed carrier", () => {
	const pin = JSON.parse(fs.readFileSync(PIN, "utf8"));

	it("[QK:PI-DURABLE-CARRIER-PIN-MATCHES] the carrier directory holds exactly the pinned files with the pinned bytes", () => {
		const { files, targets } = readCarrierDeclaration(PIN);
		expect(fs.readdirSync(path.join(DURABLE, "carrier")).sort()).toEqual([...files, "LICENSE"].sort());
		const digest = (name: string) =>
			createHash("sha256")
				.update(fs.readFileSync(path.join(DURABLE, "carrier", name)))
				.digest("hex");
		for (const file of pin.carrier.files) expect(digest(file.name), file.name).toBe(file.sha256);
		expect(digest("LICENSE")).toBe(pin.carrier.license.sha256);
		const used = new Set<string>();
		for (const name of files) {
			const code = fs.readFileSync(path.join(DURABLE, "carrier", name), "utf8");
			for (const m of code.matchAll(new RegExp(`"${CARRIER_SCHEME}([^"]+)"`, "g"))) used.add(m[1]);
			expect(code, name).not.toMatch(/from\s*"\.{1,2}\/[^"]*\.ts"/);
		}
		expect([...used].sort()).toEqual([...targets].sort());
	});

	it("[QK:PI-DURABLE-CARRIER-PIN-MALFORMED] a pin without a plain carrier declaration is refused by name", () => {
		const dir = fs.mkdtempSync(path.join(os.tmpdir(), "pi-durable-carrier-pin-"));
		try {
			const bad = path.join(dir, "upstream-pin.json");
			const write = (carrier: unknown) => fs.writeFileSync(bad, JSON.stringify({ ...pin, carrier }));
			write({ ...pin.carrier, files: [{ name: "../escape.js" }] });
			expect(reasonOf(() => readCarrierDeclaration(bad))).toBe("pi-durable-carrier-pin-malformed");
			write({ ...pin.carrier, distTargets: ["core/../../x.js"] });
			expect(reasonOf(() => readCarrierDeclaration(bad))).toBe("pi-durable-carrier-pin-malformed");
			write(undefined);
			expect(reasonOf(() => readCarrierDeclaration(bad))).toBe("pi-durable-carrier-pin-malformed");
		} finally {
			fs.rmSync(dir, { recursive: true, force: true });
		}
	});
});

describe("the maintainer emitter's source reads", () => {
	it("[QK:PI-DURABLE-CARRIER-EMIT-NO-REPLACE] a refs/replace entry never stands in for a pinned object", () => {
		const repo = fs.mkdtempSync(path.join(os.tmpdir(), "pi-durable-carrier-replace-"));
		try {
			const env = Object.fromEntries(Object.entries(process.env).filter(([k]) => !k.startsWith("GIT_")));
			const git = (args: string[], input?: string) => {
				const run = spawnSync("git", ["-C", repo, ...args], { env, input });
				expect(run.status, `git ${args.join(" ")}: ${run.stderr}`).toBe(0);
				return run.stdout.toString().trim();
			};
			git(["init", "-q", "--bare"]);
			// Plumbing only: no commit hook runs and no identity config is read.
			const pinned = git(["hash-object", "-w", "--stdin"], "pinned\n");
			const tree = git(["mktree"], `100644 blob ${pinned}\tLICENSE\n`);
			const commit = spawnSync("git", ["-C", repo, "commit-tree", tree, "-m", "pin"], {
				env: {
					...env,
					GIT_AUTHOR_NAME: "t",
					GIT_AUTHOR_EMAIL: "t@t",
					GIT_COMMITTER_NAME: "t",
					GIT_COMMITTER_EMAIL: "t@t",
				},
			})
				.stdout.toString()
				.trim();
			git(["replace", pinned, git(["hash-object", "-w", "--stdin"], "replaced\n")]);
			// Control: the fixture really does replace the object for a plain read.
			expect(git(["cat-file", "blob", `${commit}:LICENSE`])).toBe("replaced");
			expect(readSourceObject(repo, `${commit}:LICENSE`).toString()).toBe("pinned\n");
		} finally {
			fs.rmSync(repo, { recursive: true, force: true });
		}
	});
});
