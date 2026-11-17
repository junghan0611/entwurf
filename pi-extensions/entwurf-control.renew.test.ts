/**
 * #151 /renew ④-a — the REAL registered handler in `entwurf-control.ts`, loaded by Pi's REAL public
 * loader and run after the extension's own session_start births the session into a throwaway store.
 * The oracle is what the handler handed to Pi (custom messages and their options, captured at Pi's
 * runtime.sendMessage) and the notices — not the decision module re-called directly.
 *
 * What this does NOT prove: that Pi appends those messages, starts or does not start a turn, or what
 * a model sees. Those are LIVE observations.
 *
 * Process isolation as in entwurf-control.test.ts: the extension derives its socket dir from HOME and
 * births into PI_CODING_AGENT_DIR, so the harness runs in a child with a throwaway HOME / agent dir.
 * Unlike that test it does not need the compiled bridge: the harness sets apart only the
 * "compiled entwurf-bridge missing" refusal session_start throws after birth (see the harness).
 */
import { spawnSync } from "node:child_process";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const REPO = path.resolve(HERE, "..");
const HARNESS = path.join(REPO, "test", "helpers", "entwurf-control-renew-harness.mjs");
const EXTENSION = path.join(HERE, "entwurf-control.ts");

interface Delivery {
	message: { customType: string; content: string; details: Record<string, unknown> };
	options: { triggerTurn?: boolean };
}
interface HarnessOut {
	errors: string[];
	bridgeMissing: number;
	gardenIds: string[];
	entry: Delivery | null;
	show: { delivered: number; notice: { text: string; level: string } | null };
	sha8: string | null;
	confirm: { note: Delivery | null; notice: { text: string; level: string } | null };
	resets: Record<string, string | null>;
	failedShowThrew: string | false;
	afterFailedShow: string | null;
	outline: { delivered: number; delivery: Delivery | null };
}

let root = "";
let out: HarnessOut;
beforeAll(() => {
	// Short root: the control socket path has a ~107-byte ceiling.
	root = fs.mkdtempSync(path.join(os.tmpdir(), "er-"));
	const home = path.join(root, "h");
	const cwd = path.join(root, "c");
	fs.mkdirSync(cwd, { recursive: true });
	const result = spawnSync(process.execPath, [HARNESS, EXTENSION, cwd], {
		cwd: REPO,
		encoding: "utf8",
		timeout: 30_000,
		env: { PATH: process.env.PATH, HOME: home, PI_CODING_AGENT_DIR: path.join(home, ".pi", "agent") },
	});
	if (result.status !== 0) throw new Error(`harness exited ${result.status}: ${result.stdout}\n${result.stderr}`);
	out = JSON.parse(result.stdout.trim().split("\n").at(-1) as string) as HarnessOut;
});
afterAll(() => {
	if (root) fs.rmSync(root, { recursive: true, force: true });
});

describe("#151 ④-a: the registered /renew handler", () => {
	it("[QK:RENEW-HANDLER-ENTRY-TRIGGERS-TURN] /renew hands Pi one entry message marked with this garden and native chapter, asking for a turn", () => {
		expect(out.errors).toEqual([]);
		expect(out.gardenIds).toHaveLength(1);
		expect(out.entry?.message.customType).toBe("entwurf-renew-entry");
		expect(out.entry?.message.details).toEqual({
			gardenId: out.gardenIds[0],
			nativeSessionId: "01900000-0000-7000-8000-000000151a4a",
		});
		expect(out.entry?.options).toEqual({ triggerTurn: true });
	});

	it("[QK:RENEW-HANDLER-SHOW-OPENS-NO-TURN] /renew confirm only notifies the human with the sha8 — it hands Pi no message", () => {
		expect(out.show.delivered).toBe(0);
		expect(out.show.notice?.level).toBe("info");
		expect(out.sha8).toMatch(/^[0-9a-f]{8}$/);
	});

	it("[QK:RENEW-HANDLER-REFUSAL-NOTE-NO-TURN] a confirm naming other eight characters is refused inside the interview, and its note for the agent asks for no turn", () => {
		expect(out.confirm.notice?.level).toBe("warning");
		expect(out.confirm.note?.message.customType).toBe("entwurf-renew-refusal");
		expect(out.confirm.note?.message.details).toMatchObject({ reason: "sha-prefix-mismatch" });
		expect(out.confirm.note?.options).toEqual({ triggerTurn: false });
	});

	it("[QK:RENEW-HANDLER-SHUTDOWN-RESETS] every session_shutdown reason drops an unused show binding", () => {
		expect(out.resets).toEqual({
			new: "no-binding",
			resume: "no-binding",
			fork: "no-binding",
			reload: "no-binding",
			quit: "no-binding",
		});
	});

	it("[QK:RENEW-HANDLER-FAILED-SHOW-DROPS-BINDING] a show whose notice throws fails loud and leaves no binding a later confirm could use", () => {
		expect(out.failedShowThrew).toBe("harness: notify failed");
		expect(out.afterFailedShow).toBe("no-binding");
	});

	it("[QK:RENEW-HANDLER-OUTLINE-NO-TURN] /renew outline hands Pi one outline-type message for this chapter and asks for no turn", () => {
		expect(out.outline.delivered).toBe(1);
		expect(out.outline.delivery?.message.customType).toBe("entwurf-renew-outline");
		expect(out.outline.delivery?.message.details).toMatchObject({ gardenId: out.gardenIds[0], outline: null });
		expect(out.outline.delivery?.options).toEqual({ triggerTurn: false });
	});
});
