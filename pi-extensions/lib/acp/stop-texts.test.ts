/**
 * #171 step 8 — every ACP stop text against Pi's own two classifiers.
 *
 * Oracle: pi-ai's `isRetryableAssistantError` and `isContextOverflow`, the functions
 * Pi itself runs over `errorMessage` before it retries or compacts and continues.
 * The controls prove both can say yes here, so a `false` below is a verdict and not
 * a probe that never fires.
 */

import { type AssistantMessage, isContextOverflow, isRetryableAssistantError } from "@earendil-works/pi-ai";
import { expect, it } from "vitest";
import {
	ACP_STOP_NOTICE_MAX,
	ACP_STOPS,
	ACP_STOPS_WITHOUT_EXIT,
	type AcpStopId,
	acpStopExitNotice,
} from "./stop-texts.ts";

const CONTEXT_WINDOW = 200_000;

function probe(errorMessage: string): AssistantMessage {
	return {
		role: "assistant",
		content: [],
		api: "entwurf",
		provider: "entwurf",
		model: "claude-sonnet-5-5",
		usage: {
			input: 0,
			output: 0,
			cacheRead: 0,
			cacheWrite: 0,
			totalTokens: 0,
			cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		},
		stopReason: "error",
		errorMessage,
		timestamp: 0,
	};
}

const ids = Object.keys(ACP_STOPS) as AcpStopId[];

it("[QK:ACP-STOP-TEXT-NO-REPLAY] no stop text reads as transient or as an overflow to Pi", () => {
	// Controls: the first draft of `unknown`, and a vendor overflow line.
	expect(isRetryableAssistantError(probe(ACP_STOPS.unknown.text.replace("stopped without", "ended without")))).toBe(
		true,
	);
	expect(isContextOverflow(probe("prompt is too long: 250000 tokens > 200000 maximum"), CONTEXT_WINDOW)).toBe(true);

	expect(ids.length).toBe(31);
	for (const id of ids) {
		const { text } = ACP_STOPS[id];
		expect(isRetryableAssistantError(probe(text)), id).toBe(false);
		expect(isContextOverflow(probe(text), CONTEXT_WINDOW), id).toBe(false);
		expect(text.startsWith("entwurf: "), id).toBe(true);
		// A constant: nothing a code or an id could have been formatted into.
		expect(text, id).not.toMatch(/[\d{}$]/);
	}
	expect(new Set(ids.map((id) => ACP_STOPS[id].text)).size).toBe(ids.length);
});

it("[QK:ACP-STOP-TEXT-EXIT] every stop names a way out, except the ones listed as having none", () => {
	const withoutExit = ids.filter((id) => ACP_STOPS[id].exit === null);
	expect(withoutExit.sort()).toEqual([...ACP_STOPS_WITHOUT_EXIT].sort());
	for (const id of ids) {
		const exit: string | null = ACP_STOPS[id].exit;
		if (exit !== null) expect(exit.trim().length, id).toBeGreaterThan(0);
		// A stop never asks the operator to delete the record (decision 17).
		expect(`${ACP_STOPS[id].text} ${exit ?? ""}`, id).not.toMatch(/\b(remove|delete)\b/i);
	}
	// A notice is clipped at 80 characters; a clipped exit is not an exit.
	for (const id of ids) {
		const notice = acpStopExitNotice(id);
		if (notice !== null) expect(notice.length, id).toBeLessThanOrEqual(ACP_STOP_NOTICE_MAX);
	}
	expect(acpStopExitNotice("cwd")).toBe("next: reopen this session in its own directory");
	expect(acpStopExitNotice("load")).toBeNull();
});
