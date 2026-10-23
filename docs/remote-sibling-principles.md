# Remote siblings — principles and open questions

A person laid a bridge between two machines, and a message sent across it to an existing sibling came back. That is where this page starts. One crossing does not settle whether the sender should be trusted, whether the receiver was really in view, or what a sender can know about what happened on the other side.

This page holds the *why*: the boundaries Entwurf keeps when a sibling lives on another host, and the questions that crossing left open. The mechanism belongs elsewhere. [DELIVERY](../DELIVERY.md#remote-pairs-107-149-declared-pairs-across-hosts) owns the declaration, the wire, admission and receipts. [Setup](./setup-clean-host.md#2c-optional-remote-pair-between-two-hosts-107) owns configuration and use. [VERIFY](../VERIFY.md) and [BASELINE](../BASELINE.md) own the evidence. A principle is added here only once it is actually held; what is not known stays a question.

## Boundaries held today

### Reach, do not manage

The bridge is human work. The operator connects the machines, owns SSH authentication and authorization, and declares exactly which pair may talk; a private network such as Tailscale is a reasonable choice, not a requirement and not a security certificate. Entwurf only crosses the declared route. The remote route discovers no remote peers and adds no listener, relay or registry; it retries nothing, and no manager watches whether the other side is still there.

The host that holds a citizen's record decides about that citizen. The receiving host checks the claim against its own declaration and hands it to its own local dispatch, with that rail's own admission rules. The sending host never directly writes into the other host's mailbox and never adds a second address for the target; if anything is written there, the receiving host's own entry and local dispatch write it. This is a division of authority, not an operating-system security guarantee: anything the same SSH account can do, it can still do.

The route itself never launches, freshly opens or resumes anyone. Whether an inactive citizen can be reached at all is each rail's own admission question, not a promise this route makes for every rail.

### Relationships coexist; each one is an exact edge

One citizen can keep relationships with several siblings on other hosts, and several citizens can share one remote sibling. Adding a relationship overwrites none of the earlier ones and copies or re-registers no citizen. What a declaration allows is always one exact sender–target edge. Two citizens that each appear somewhere in the declaration are not thereby paired, and a target is not reached through whichever route names it first. A sender with no edge to a declared remote target is refused, and that refusal never turns into a local delivery. The file's shape, the rules for a set of routes and the refusal names belong to [DELIVERY](../DELIVERY.md#remote-pairs-107-149-declared-pairs-across-hosts) and [setup](./setup-clean-host.md#2c-optional-remote-pair-between-two-hosts-107).

### A connection is not an identity, and neither is trust in content

What makes a remote message acceptable today is that it arrived over the operator's own SSH account and matches a declared pair. That is account trust. It is not cryptographic identity of a citizen: the same account could claim any declared id, and with several pairs, so could any host whose key that account accepts. Keeping the routes disjoint does not narrow this: a route limits which edge the receiving host accepts, not who can log in to the account and present a claim. And neither the connection nor the declaration says whether the message's content deserves trust; a received message is still untrusted input to the sibling that reads it.

### A record is not a process, and a process is not a screen

A citizen is its record and the native conversation that record names. The same conversation can come back in another process, so a pid is not a citizen's identity, and a route copies no pid, model, liveness or visibility state. Whether a citizen can receive right now, and which owner or incarnation it has, is decided by the receiving host's own rail admission; the remote sender has not checked that and does not say it did. A reply that recalls earlier facts is an observation of conversational continuity, which a matching record alone does not show.

Siblings talk to siblings the user has open, in sessions that are open where they can be seen. That visible-first boundary is the operator's policy, and on the remote route a person keeps it by opening those sessions; it asks for neither continuous attention nor consent to each message. The code does not check a screen, and the route offers no interface that would. A backing record, a live owner pid, an armed watch, a TTY or a garden-id label on a footer are facts about records and processes; none of them shows that a person can see the conversation. For the measured pair, delivery to an active, armed pi-durable self-fetch citizen can start a turn at once.

An exception granted for a verification run, such as test-owned scratch sessions in a release check, does not establish production visibility or give product delivery any new authority.

### Say only what was observed

Acceptance is not a read, a read is not a reply, and a reply does not tell its sender that the reply was read. An error is not proof that nothing happened either: a failure reported after a write can leave the message in place, so the sender is told that an error was reported, shown the other host's own words, and not told that the message was undelivered or safe to resend. Where nothing decisive came back, the result is indeterminate and nothing is retried. Uncertainty is shown, not resolved by a tracker, a third ACK or an automatic resend.

## Held, not argued

- A remote peer is a sibling, not a worker or a subordinate host.
- Capability differs between harnesses and hosts; that difference is not a rank.
- Each native harness keeps its own context, authentication and transcript.
- Entwurf stays one narrow tool, not a harness or a manager.

## Open questions

These are questions to share, not a backlog and not a promise of future features.

- **Reach or trust?** An operator-owned account and its declared pairs bound what can be reached. How should the reach of an account be told apart from trusting the sibling that sent a message?
- **Presence across machines?** The first crossing relied on a person confirming that both sessions were open. Can visible-first be observed and kept across hosts without a hidden turn or a watcher, or does it stay a human act?
- **What can a sender know?** How should the limits of a sender's knowledge be shown honestly, without a read tracker, automatic retries, or a claim that an error had no effect?

## Where this comes from

The [first crossing](https://github.com/junghan0611/entwurf/issues/107#issuecomment-6278665895) and its limits, the [release framing](https://github.com/junghan0611/entwurf/issues/107#issuecomment-6279426845) built around it, and the [error-wording review](https://github.com/junghan0611/entwurf/issues/107#issuecomment-6279637367) are recorded on #107.

Several exact pairs in one environment come from #149: its [adopted direction](https://github.com/junghan0611/entwurf/issues/149#issuecomment-6356215193), which replaced the issue's first disjoint-only proposal, and its [landing on main](https://github.com/junghan0611/entwurf/issues/149#issuecomment-6358458717). Implementation, switch-over and a real exchange are separate evidence. The implementation is proven by deterministic and installed-package tests. The one real exchange on #107 was a single pair under the earlier file, and it does not carry over to the version-2 routes file or to several pairs in use at once. The [latest operational note](https://github.com/junghan0611/entwurf/issues/149#issuecomment-6362719092) records two hosts switched to version-2 files with one route each, the CLI each SSH context selected, and an acceptance; it does not record a completed nonce round trip. The CLI an SSH context selects, the reader a running bridge already loaded, the declaration file, an acceptance and a reply are each their own evidence; installing a host integration does not by itself show which CLI the SSH receive context resolves. #149 stays open for that field check.
