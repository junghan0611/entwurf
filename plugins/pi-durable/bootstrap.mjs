#!/usr/bin/env node
// Checkout path of the durable host bootstrap (#129). The bootstrap is ONE file: the packaged
// `pi/pi-durable/bootstrap.mjs`, which imports only the compiled closure. This path re-exports it so
// the checkout-only gates and the beside test keep their import site; like every consumer of the
// compiled closure, a checkout needs a built bridge (`pnpm run build-bridge`) first.
import { realpathSync } from "node:fs";
import { main } from "../../pi/pi-durable/bootstrap.mjs";

export { main, openDurableCitizen, PACKAGED_BRIDGE_ENTRY } from "../../pi/pi-durable/bootstrap.mjs";

// Same entry rule as the packaged file (argv realpath, floor-safe); the packaged file's own guard is
// false here, so main runs once.
const invokedDirectly = (() => {
	const entry = process.argv[1];
	if (typeof entry !== "string" || entry.length === 0) return false;
	try {
		return realpathSync(entry) === realpathSync(import.meta.filename);
	} catch {
		// Bounded environment probe: an entry that cannot be resolved is not this file.
		return false;
	}
})();
if (invokedDirectly) await main(process.argv.slice(2));
