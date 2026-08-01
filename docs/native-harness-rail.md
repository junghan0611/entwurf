# Native harness rail

This document is the admission contract for attaching an already-running native harness
session to the garden. It is an architecture boundary, not an implementation plan for a
particular backend.

The reference native harness is **Claude Code**. Pi has its own control-socket adapter and
ACP backends have their own adapter rail in
[`acp-backend-rail.md`](./acp-backend-rail.md). Do not mix those three boundaries.

## Why this rail exists

A native harness integration must remain an adapter. Adding a backend must not create a
new package manager, configuration transaction engine, doctor framework, or test harness.
The previous Codex experiment demonstrated the failure mode: the transport adapter was
small, while managed installation, exact uninstall inversion, trust inspection, and
backend-specific gates grew into a second product.

Native Codex is therefore not implemented on this branch. The old raw probe remains
observation evidence only. Codex models remain usable through pi's existing
control-socket citizen path.

## Support levels

| Level | Meaning | Product wording |
|---|---|---|
| **N0 — observed** | A raw probe reached a native surface. No lifecycle or citizen contract. | probe evidence |
| **N1 — adapter** | The five seams below fit the common rail and deterministic conformance passes. | adapter available |
| **N2 — certified** | A real native session proves birth, inbound delivery, outbound sender identity, and same-id reply on a named host/version axis. | supported native citizen |

Installation automation is not a support level. A manually wired N2 adapter is more
credible than an automatically installed N0 probe.

Current reference coordinates:

- **Claude Code:** N2 reference native harness on the certified Linux axis.
- **Antigravity / agy:** already shipped compatibility; retain it while measuring it
  against this rail, but do not use its historical installer surface as the template for
  another backend.
- **Codex:** N0 probe evidence only. No native citizen implementation is planned until a
  stable surface fits this rail within the size budget.

## The five seams

A backend must explain exactly five things. Anything else belongs either to core, to the
operator, or to the native harness.

| Seam | Backend supplies | Core supplies |
|---|---|---|
| **birth** | Parse one authoritative native lifecycle event into `nativeSessionId`, `cwd`, and optional model facts. | Store certification, unique identity lookup, record upsert, stable garden id. |
| **sender** | Resolve an explicit carrier owned by the current native call/session. | Record-backed sender certification, ambiguity refusal, envelope rendering. |
| **liveness** | Measure the backend's current receive predicate without storing it. | Shared alive/dead/indeterminate vocabulary and replyability derivation. |
| **delivery** | Perform one native send over the freshly measured route and return native acceptance evidence. | Dispatch decision, target intent, receipt taxonomy, lock policy, retry policy where valid. |
| **operator wiring** | Document the official hook/MCP/launch steps and a read-only inspection command where useful. | Nothing that mutates arbitrary third-party configuration. |

The rail preserves real capability asymmetry:

- **self-fetch** adapters arm a durable inbox and fetch after a wake signal;
- **native-push** adapters probe and inject directly;
- neither is disguised as a pi control socket or as the other rail.

The common contract is identity and evidence, not identical transport.

## Ownership boundary

### Entwurf owns

- the V3 meta-record and garden-id address;
- backend-neutral birth/upsert and sender certification;
- liveness and delivery result types;
- `entwurf_v2` dispatch and honest rejects;
- a parameterized conformance suite for the common rail;
- one compact LIVE acceptance shape.

### A backend adapter owns

- native event parsing;
- native identifier and endpoint parsing;
- one liveness probe;
- one delivery call;
- backend-specific acceptance/error mapping;
- a short operator wiring guide.

### Entwurf does not own

- native transcripts, auth, credentials, or runtime lifecycle;
- arbitrary TOML/JSON lossless editing;
- preimage journals, exact uninstall inverses, or third-party config drift engines;
- hook trust or permission consent that belongs to the operator;
- a backend-specific copy of core conformance tests;
- private runtime archaeology presented as a supported contract.

## Operator wiring policy

New native adapters default to documentation:

1. Prefer an official native CLI command when one exists.
2. Otherwise provide a minimal configuration snippet and name the exact file/section.
3. Provide a read-only inspector only when it can report runtime facts without claiming
   ownership of the external configuration.
4. Never grant trust or permissions on the operator's behalf.
5. Do not promise uninstall. The guide names which lines the operator added.

Existing Claude and agy managed surfaces may remain for compatibility. They are not the
admission template and must not force a new backend to reproduce their ownership machinery.

## Conformance shape

Common invariants are tested once with adapter fixtures:

1. authoritative birth creates or reattaches one record;
2. sender identity resolves to exactly one existing record and never mints at call time;
3. liveness preserves alive/dead/indeterminate;
4. ambiguous or unobservable routing refuses without mutation;
5. delivery returns native acceptance evidence and does not invent completion;
6. wrong intent rejects through the shared dispatch table;
7. reply targets the same garden id;
8. the adapter imports no mailbox, socket, transcript, or auth mechanism outside its rail.

Backend-specific tests cover only event parsing, protocol framing, and error mapping. A
single LIVE smoke proves the N2 path. Common defects belong to the common conformance gate
and mutation lane, not to a growing per-backend mutant catalog.

## Size and stop rules

For a new native backend, count backend-specific production, tests, fixtures, scripts, and
documentation together.

- **Target:** at most 1,500 lines.
- **Mandatory scope review:** before 2,000 lines.
- Managed installation machinery does not justify exceeding the limit; remove that scope.
- If a stable adapter still cannot fit after removing installation automation, keep the
  backend at N0 or decline native support.

Line count is not a quality metric. It is a stop signal that the adapter has begun to own
the harness.

## Admission sequence

1. Record the official lifecycle, address, liveness, and delivery surfaces in `DELIVERY.md`.
2. Map the five seams without writing production code.
3. Demonstrate that no seam requires transcript/auth/config ownership.
4. Set the line budget and identify the shared conformance fixtures.
5. Implement the smallest adapter.
6. Pass deterministic conformance.
7. Run one real same-id round trip and promote N1 to N2 only with that evidence.

If step 2 or 3 fails, stop. The correct outcome may be “use the model through pi/ACP” or
“native support is not offered.” Unsupported is better than an unmaintainable bridge.
