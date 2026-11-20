// The agy ACP child's PreToolUse hook (#168 ①). agy runs the command the overlay writes at
// `<gemini-dir>/config/hooks.json` — `'<node>' '<this file>'`, through `sh -c` — before every
// tool call, with the call as JSON on stdin, and obeys one `{"decision":"allow"|"deny",...}`
// line on stdout. Plain Node, builtins only: it ships as source and runs as itself.
//
// The policy is this program's first argument, written into the seat's command by the agy adapter's
// `ensureOverlay`. It rides argv, not the child's environment, because the overlay is shared by every
// pi on the host: a policy in env would leave the children of a pi that predates the seat — which set
// no such env — denied every tool the moment a newer pi wrote the seat (agy re-reads it on every
// call). Phase 1 ships one policy, so the seat bytes stay identical across children. `v1:hidden-turns` denies
// the three tools measured (agy 1.5.9, #168) to make model calls with no ACP frame:
// `invoke_subagent` and `schedule` run turns after or beside the prompt; `run_workflow`'s
// `agent()` calls the model inside it. Every other tool is allowed.
//
// What agy does with this program's failure was measured: a missing command, a non-zero exit
// and a timeout all deny, while an exit 0 with nothing on stdout ALLOWS. So every path here
// either prints exactly one decision line or exits non-zero — an absent or unknown policy and
// unreadable input print a deny, and anything that ends without a line exits 1.
//
// A best-effort execution default, NOT a security or isolation guarantee: the seat is a shared
// file agy re-reads on every call, and a child that can run a shell rewrote its own seat and
// opened the denied tools (measured, #168 C2b). See docs/acp-backend-rail.md, Known limits.

const HIDDEN_TURN_TOOLS = Object.freeze(["invoke_subagent", "schedule", "run_workflow"]);

const POLICIES = {
	"v1:hidden-turns": (tool) =>
		HIDDEN_TURN_TOOLS.includes(tool)
			? deny(
					`entwurf ACP policy v1:hidden-turns: ${tool} starts a model turn with no ACP frame and is not allowed on this row`,
				)
			: { decision: "allow" },
	// Summary turns run no tool at all (#168); keep the reason explicit so the model answers from text.
	"v1:deny-all": () =>
		deny("entwurf ACP policy v1:deny-all: this summary turn runs no tool; answer from the conversation text"),
};

function deny(reason) {
	return { decision: "deny", reason };
}

async function readStdin() {
	const chunks = [];
	for await (const chunk of process.stdin) chunks.push(chunk);
	return Buffer.concat(chunks).toString("utf8");
}

/** The decision for one hook input. Every path returns one; none returns allow by default. */
function decide(policy, raw) {
	if (!policy) return deny("entwurf ACP policy: the hook command names no policy; every tool is denied");
	const rule = Object.hasOwn(POLICIES, policy) ? POLICIES[policy] : undefined;
	if (rule === undefined)
		return deny(`entwurf ACP policy: unknown policy ${JSON.stringify(policy)}; every tool is denied`);
	let input;
	try {
		input = JSON.parse(raw);
	} catch {
		return deny("entwurf ACP policy: the hook input is not JSON; every tool is denied");
	}
	const tool = input?.toolCall?.name;
	if (typeof tool !== "string" || tool === "")
		return deny("entwurf ACP policy: the hook input names no tool; every tool is denied");
	return rule(tool);
}

// Two defences, adjacent on purpose: the decision line, and exit 1 whenever no line was written.
// Either alone keeps an empty-stdout exit 0 (= allow) away; the mutant that removes both is the one
// FAILS-CLOSED must kill.
let printed = false;
readStdin()
	.then((raw) => decide(process.argv[2], raw))
	.then(
		(decision) => {
			process.stdout.write(`${JSON.stringify(decision)}\n`);
			printed = true;
		},
		() => {
			process.exitCode = 1;
		},
	)
	.finally(() => {
		if (!printed) process.exitCode = 1;
	});
