# Independent pre-extraction expectations — #154 C1-A

These two JSON files are immutable evidence fixtures, not editable product guidance.

- Source SHA: `94d0594182cbd9cf0a5c90f4d299cda40d870b8f`.
- `metadata-before-94d0594.json` was copied byte-for-byte from C0 `metadata-source-baseline.json`, which decoded that SHA's original TS literals and retained the complete durable schema copies.
- `mcp-tools-before-94d0594.json` was copied byte-for-byte from C0 `rendered-mcp-tools.json`, observed via initialize/tools/list only on the existing accepted compiled entry, SHA256 `8ca6d4cb4b9065f1fe8a1444f4a84aac66eca888cf4485c28742279a9f6f11c6`, under fresh fixture HOME/agent/XDG/meta roots. That observation is not a new build-provenance claim for the whole compiled tree.

The root ENTWURF.json did not exist when these expectations were captured. Never regenerate them from the new JSON, reader or compiled carrier alongside actual output. Preserve decoded strings and actual runtime fields without trim/reflow/normalization. A later explicit semantic amendment must distinguish its intended expectation changes from preservation.

The canonical payload authority and independent revision/history are in root ENTWURF.json. These fixtures have no runtime consumer and are excluded from the npm package by the existing `!pi-extensions/**/fixtures/**` rule.
