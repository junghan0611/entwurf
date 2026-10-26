# Independent pre-extraction expectations — #154 C1-A

These two JSON files are immutable evidence fixtures, not editable product guidance.

- Source SHA: `94d0594182cbd9cf0a5c90f4d299cda40d870b8f`.
- `metadata-before-94d0594.json` was copied byte-for-byte from C0 `metadata-source-baseline.json`, which decoded that SHA's original TS literals and retained the complete durable schema copies.
- `mcp-tools-before-94d0594.json` was copied byte-for-byte from C0 `rendered-mcp-tools.json`, observed via initialize/tools/list only on the existing accepted compiled entry, SHA256 `8ca6d4cb4b9065f1fe8a1444f4a84aac66eca888cf4485c28742279a9f6f11c6`, under fresh fixture HOME/agent/XDG/meta roots. That observation is not a new build-provenance claim for the whole compiled tree.

The root ENTWURF.json did not exist when these expectations were captured. Never regenerate them from the new JSON, reader or compiled carrier alongside actual output. Preserve decoded strings and actual runtime fields without trim/reflow/normalization. A later explicit semantic amendment must distinguish its intended expectation changes from preservation.

`amendments-revision-2.json` is the immutable, independently reviewed C2 layer: thirteen literal leaf amendments against those C0 objects. `amendments-revision-3.json` is the separately reviewed one-leaf correction against revision 2, whose exact full old/new intent literal was compared with the independent review note before the product JSON was edited. Never replace either layer with values generated from the current product or carrier.

Current expectations apply C0 → revision 2 → revision 3 in order, checking each exact old value and each layer's unique keys. The revision 3 intent key was already changed by revision 2: the union is still thirteen changed leaves and twenty-one preserved leaves, not fourteen changed leaves. The loaded payload revision is bound to the reviewed current revision by a separate test; history-only independence remains a different contract.

`reject-hints-before-94d0594.json` is the C1-B preservation oracle for revision 4's new `rejectHints` family: the five static entwurf_v2 reject hints' decoded text, copied from the C0 pre-extraction inventory of the same source SHA (its `sourceBlobSha256` is that SHA's `entwurf-v2-surface.ts`) and compared with two independently derived expected files before the product JSON was edited. It is not an amendment layer; the slot-bearing record-less-socket hint is deliberately absent because it stays code-owned.

`amendments-revision-6.json` is the separately reviewed one-leaf semantic amendment against revision 5: the `native-push-paused` reject hint now says the dispatch probed nothing and sent nothing, matching the pre-probe refusal. Its exact full old/new literal was compared with an independently written expected literal before the product JSON was edited. The current reject-hint expectation is the C0 reject-hint oracle with that one layer applied (exact old value checked): one changed leaf, four preserved. The C0 reject-hint oracle itself stays unchanged.

`resume-reject-hints-before-94d0594.json` is the C1-C preservation oracle for revision 5's new `resumeRejectHints` family: the eleven static visible-resume (record/liveness) reject hints of entwurf_resume_call, decoded text copied from the C0 pre-extraction inventory of the same source SHA (its `sourceBlobSha256` is that SHA's `entwurf-v2-visible-resume.ts`) and compared with two independently derived expected files before the product JSON was edited. It is not an amendment layer; the shared ACP model hint and the launch-stage mux resume hints are deliberately absent because they stay code-owned.

The canonical payload authority and independent revision/history are in root ENTWURF.json. These fixtures have no runtime consumer and are excluded from the npm package by the existing `!pi-extensions/**/fixtures/**` rule.
