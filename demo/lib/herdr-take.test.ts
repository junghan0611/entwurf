// Offline fixtures for demo/lib/herdr-take.ts (#138). Run: node --test 'demo/**/*.test.ts'
import assert from "node:assert/strict";
import { test } from "node:test";
import {
	applyHerdrFence,
	fenceProblems,
	hasHangul,
	herdrFence,
	herdrLaunchTab,
	isTabFocused,
	lastCompletedText,
	parseWorkspaceCreated,
} from "./herdr-take.ts";
import { workQuestion } from "./pi-durable-work.ts";

const ROOT = "/tmp/entwurf-herdr-demo-AbC123";

test("the fence puts herdr's XDG roots and entwurf's meta roots under one take root", () => {
	const fence = herdrFence(ROOT);
	for (const name of [
		"XDG_CONFIG_HOME",
		"XDG_DATA_HOME",
		"XDG_STATE_HOME",
		"XDG_CACHE_HOME",
		"XDG_RUNTIME_DIR",
		"ENTWURF_META_SESSIONS_DIR",
		"ENTWURF_META_RECEIVERS_DIR",
		"ENTWURF_META_SENDERS_DIR",
		"ENTWURF_META_MAILBOX_DIR",
	])
		assert.ok(fence[name]?.startsWith(`${ROOT}/`), name);
	assert.equal(fence.HOME, undefined);
	assert.equal(fence.ENTWURF_V2_LOCK_DIR, undefined); // a homedir constant, not an override (entwurf-v2-lock.ts:80)
});

test("applying the fence drops every ambient herdr carrier and holds; a drifted or missing value is named", () => {
	const fence = herdrFence(ROOT);
	const env: NodeJS.ProcessEnv = {
		HOME: "/home/op",
		HERDR_ENV: "1",
		HERDR_PANE_ID: "w1:p1",
		HERDR_BIN_PATH: "/x/herdr",
		XDG_CONFIG_HOME: "/home/op/.config",
		ENTWURF_META_SESSIONS_DIR: "/home/op/elsewhere",
	};
	applyHerdrFence(env, fence);
	assert.deepEqual(fenceProblems(env, fence, ROOT), []);
	assert.equal(env.HOME, "/home/op");
	assert.equal(env.HERDR_ENV, undefined);

	const drifted: NodeJS.ProcessEnv = { ...env, XDG_CONFIG_HOME: "/home/op/.config", HERDR_PANE_ID: "w2:p1" };
	delete drifted.ENTWURF_META_MAILBOX_DIR;
	const problems = fenceProblems(drifted, fence, ROOT);
	assert.equal(problems.length, 3);
	assert.ok(problems.some((p) => p.startsWith("XDG_CONFIG_HOME=")));
	assert.ok(problems.some((p) => p.startsWith("ENTWURF_META_MAILBOX_DIR=")));
	assert.ok(problems.includes("HERDR_PANE_ID is still set"));
	assert.ok(fenceProblems(env, { XDG_CONFIG_HOME: "/elsewhere/x" }, ROOT).some((p) => p.includes("outside")));
});

const WS = {
	id: "cli:workspace:create",
	result: {
		type: "workspace_created",
		workspace: { workspace_id: "w3", label: "demo", focused: true },
		tab: { tab_id: "w3:t1", workspace_id: "w3", focused: true },
		root_pane: { pane_id: "w3:p1", tab_id: "w3:t1", workspace_id: "w3", terminal_id: "term_1" },
	},
};

test("workspace create: the coordinates come from herdr's answer, only when both halves agree", () => {
	assert.deepEqual(parseWorkspaceCreated(JSON.stringify(WS)), { workspaceId: "w3", tabId: "w3:t1", paneId: "w3:p1" });
	const variant = (patch: (j: typeof WS) => void) => {
		const j = structuredClone(WS);
		patch(j);
		return parseWorkspaceCreated(JSON.stringify(j));
	};
	assert.equal(
		variant((j) => {
			j.result.type = "tab_created";
		}),
		null,
	);
	assert.equal(
		variant((j) => {
			j.result.root_pane.workspace_id = "w1";
		}),
		null,
	);
	assert.equal(
		variant((j) => {
			j.result.root_pane.tab_id = "w3:t2";
		}),
		null,
	);
	assert.equal(
		variant((j) => {
			j.result.tab.workspace_id = "w9";
		}),
		null,
	);
	assert.equal(parseWorkspaceCreated('{"error":{"code":"workspace_not_found"}}'), null);
	assert.equal(parseWorkspaceCreated("not json"), null);
});

test("tab focus: exactly that tab, focused (S0 focus2.json shape)", () => {
	const s0 =
		'{"id":"cli:tab:focus","result":{"tab":{"agent_status":"unknown","focused":true,"label":"2","number":2,"pane_count":1,"tab_id":"w1:t2","workspace_id":"w1"},"type":"tab_info"}}';
	assert.equal(isTabFocused(s0, "w1:t2"), true);
	assert.equal(isTabFocused(s0, "w1:t1"), false);
	assert.equal(isTabFocused(s0.replace('"focused":true', '"focused":false'), "w1:t2"), false);
	assert.equal(isTabFocused('{"error":{"code":"tab_not_found"}}', "w1:t2"), false);
});

const RECEIPT =
	"[entwurf fresh call → herdr]\n" +
	"  backend:  claude-code (requested kind claude — herdr resolves the executable, we did not)\n" +
	"  model:    sonnet (requested on the runtime CLI)\n" +
	"  agent:    entwurf-0123456789abcdef0123 (herdr's name for it, derived from the nonce)\n" +
	"  tab:      w3:t2 in workspace w3 — a NEW tab beside the caller's, opened without taking focus\n" +
	"  pane:     w3:p2 terminal term_2 — the tab's initial pane; herdr VIEW coordinates, not an address\n" +
	"  nonce:    mux-fresh-call-deadbeefdeadbeefdeadbeef\n";

test("the herdr launch receipt names its tab and workspace; a tmux receipt is not a herdr one", () => {
	assert.deepEqual(herdrLaunchTab(RECEIPT), { tabId: "w3:t2", workspaceId: "w3" });
	assert.equal(herdrLaunchTab(RECEIPT.replace("[entwurf fresh call → herdr]", "[entwurf fresh call → tmux]")), null);
	assert.equal(herdrLaunchTab(RECEIPT.replace(/ {2}tab:.*\n/, "")), null);
});

const stop = (text: string) => ({
	type: "message",
	message: { role: "assistant", stopReason: "stop", content: [{ type: "text", text }] },
});

test("closing answer: the last completed assistant row after the reply, never an earlier or interim one", () => {
	const entries = [
		stop("before the reply"),
		{ type: "custom_message", customType: "entwurf-message" },
		{
			type: "message",
			message: { role: "assistant", stopReason: "toolUse", content: [{ type: "text", text: "interim" }] },
		},
		stop("DEMO-AB3DEF: 3 lines"),
		stop("  "),
	];
	assert.equal(lastCompletedText(entries, 1), "DEMO-AB3DEF: 3 lines");
	assert.equal(lastCompletedText(entries, 4), null);
});

test("English-only: Hangul anywhere is caught; the take's question has none", () => {
	assert.equal(hasHangul("DEMO-AB3DEF: 3 lines. First line: the record is the address"), false);
	assert.equal(hasHangul("DEMO-AB3DEF: 3줄"), true);
	assert.equal(hasHangul("ㅎ"), true);
	assert.equal(hasHangul(`${workQuestion("DEMO-AB3DEF")} Reply in English.`), false);
});
