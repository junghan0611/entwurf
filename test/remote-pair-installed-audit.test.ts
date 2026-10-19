/**
 * #107 rail 3: the checkout-invisibility audit of `check-remote-pair-installed`, proven on tiny
 * synthetic logs and files. Only this acceptance primitive is mutation-qualified; the artifact cells
 * of that gate stay actual-runtime evidence.
 */
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { pathToFileURL } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { filesOutsideRoot } from "../scripts/lib/remote-pair-installed-audit.ts";

let tmp: string;
let root: string;
beforeEach(() => {
	tmp = fs.mkdtempSync(path.join(os.tmpdir(), "remote-pair-audit-"));
	root = path.join(tmp, "consumer");
	fs.mkdirSync(path.join(root, "node_modules", "pkg"), { recursive: true });
});
afterEach(() => fs.rmSync(tmp, { recursive: true, force: true }));

function file(p: string): string {
	fs.mkdirSync(path.dirname(p), { recursive: true });
	fs.writeFileSync(p, "");
	return p;
}

function log(lines: string[]): string {
	const p = path.join(tmp, `log-${Math.random().toString(16).slice(2)}.log`);
	fs.writeFileSync(p, `${lines.join("\n")}\n`);
	return p;
}

describe("the installed-closure audit", () => {
	it("[QK:RPI-AUDIT-REAL-PATH] judges each file by its real path: a link inside the root that resolves outside it is flagged, a plain file inside passes, non-file URLs are not counted", () => {
		const inside = file(path.join(root, "node_modules", "pkg", "index.js"));
		const escapeTarget = file(path.join(tmp, "checkout", "src", "index.ts"));
		const link = path.join(root, "node_modules", "pkg", "linked.js");
		fs.symlinkSync(escapeTarget, link);
		const r = filesOutsideRoot([log([pathToFileURL(inside).href, "node:fs", pathToFileURL(link).href])], root);
		expect(r.total).toBe(2);
		expect(r.outside).toEqual([fs.realpathSync(escapeTarget)]);
	});

	it("[QK:RPI-AUDIT-ROOT-BOUNDARY] a sibling directory whose name only starts like the root is outside it", () => {
		const inside = file(path.join(root, "node_modules", "pkg", "index.js"));
		const sibling = file(path.join(`${root}-x`, "index.js"));
		const r = filesOutsideRoot([log([pathToFileURL(inside).href, pathToFileURL(sibling).href, "node:path"])], root);
		expect(r).toEqual({ total: 2, outside: [fs.realpathSync(sibling)] });
	});
});
