// The pi-durable carrier's resolver (#130): preloaded as `node --import <this file>` before the
// packaged bootstrap. It registers ONE synchronous resolve hook that answers only the carrier's
// reserved entwurf-pi-dist: specifiers (grammar and refusals: ./carrier-relocation.mjs) and hands
// every other specifier to Node unchanged. It is not a source/TypeScript resolver and it never reads
// a checkout, a runtime directory or an environment variable: the pi-coding-agent it maps into is the
// one the carrier itself resolves from where this package is installed.

import { registerHooks } from "node:module";
import {
	CARRIER_SCHEME,
	CODING_AGENT,
	codingAgentDistFrom,
	readCarrierDeclaration,
	resolveCarrierSpecifier,
} from "./carrier-relocation.mjs";

const { files, targets } = readCarrierDeclaration(new URL("./overlay/upstream-pin.json", import.meta.url));
const carrierDirUrl = new URL("./carrier/", import.meta.url).href;
let dist;

registerHooks({
	resolve(specifier, context, nextResolve) {
		if (!specifier.startsWith(CARRIER_SCHEME)) return nextResolve(specifier, context);
		const url = resolveCarrierSpecifier(specifier, context.parentURL, {
			carrierDirUrl,
			files,
			targets,
			// From a carrier file, as the carrier's own bare imports resolve — never the exports map.
			dist: () => {
				dist ??= codingAgentDistFrom(
					nextResolve(CODING_AGENT, { ...context, parentURL: `${carrierDirUrl}${files[0]}` }).url,
				);
				return dist;
			},
		});
		return { url, shortCircuit: true };
	},
});
