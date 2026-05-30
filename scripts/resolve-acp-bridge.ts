/**
 * resolve-acp-bridge — print the bridge extension path entwurf-core's
 * getRegistryRouting() would inject for a provider=pi-shell-acp spawn under the
 * CURRENT environment (PI_CODING_AGENT_DIR + settings.json package sources).
 *
 * Used by smoke-installed-entwurf-acp so the live smoke drives a real pi child
 * with the resolver's OWN output: if package-source routing regresses (wrong
 * path, or unresolved), this either prints the wrong -e or throws
 * EntwurfRoutingError (non-zero exit), and the smoke fails instead of silently
 * passing. Prints the `-e` value to stdout on success; throws on unresolved.
 *
 * argv[2]: "remote" selects the SSH remote path; anything else is local.
 */

import type { ResolvedTarget } from "../pi-extensions/lib/entwurf-core.ts";
import { getRegistryRouting } from "../pi-extensions/lib/entwurf-core.ts";

const isRemote = process.argv[2] === "remote";
const target: ResolvedTarget = { provider: "pi-shell-acp", model: "claude-sonnet-4-6", explicitOnly: false };

// Throws EntwurfRoutingError (non-zero exit) when the bridge cannot be resolved —
// exactly the fail-fast the smoke wants to observe as a failure, not a pass.
const routing = getRegistryRouting(target, isRemote);
const i = routing.args.indexOf("-e");
process.stdout.write(i >= 0 ? routing.args[i + 1] : "");
