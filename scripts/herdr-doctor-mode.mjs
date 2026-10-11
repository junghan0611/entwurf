#!/usr/bin/env node
/**
 * herdr-doctor-mode — the one call `meta-bridge-doctor.sh` makes to learn its expectation mode (#136).
 *
 *   node herdr-doctor-mode.mjs <repo> [<plugin-runtime override>]
 *
 * Prints the stable active root (plugin-runtime mode) or nothing (clone / installed), exit 0.
 * A refusal prints `code: detail` to stderr and exits 3. Any other exit is a crash the doctor
 * reports as UNKNOWN. All judgement lives in `resolveDoctorPluginRuntime`; nothing is decided here.
 */
import { resolveDoctorPluginRuntime } from "./herdr-activation.mjs";

const [repo, override] = process.argv.slice(2);
if (!repo) {
	process.stderr.write("usage: herdr-doctor-mode.mjs <repo> [<plugin-runtime>]\n");
	process.exit(2);
}
let root;
try {
	root = resolveDoctorPluginRuntime(process.env, { repo, override });
} catch (err) {
	if (err?.name !== "ActivationError") throw err;
	process.stderr.write(`${err.message}\n`);
	process.exit(3);
}
if (root !== null) process.stdout.write(`${root}\n`);
