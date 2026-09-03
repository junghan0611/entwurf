#!/usr/bin/env bash
# lab-statusline.sh — MEASUREMENT ONLY. Not the product statusline.
#
# P2a/P2b instrument (issue #98). The product surface is
# `scripts/meta-bridge-statusline.sh`; this file must never be installed as it.
# It exists to answer ONE question the binary read could not settle:
#
#   Does Claude Code RE-EXECUTE the statusline command
#     (P2a) on the turn an asyncRewake doorbell creates, and
#     (P2b) after a mid-turn tool call drains the mailbox?
#
# Method: every invocation appends one line to $CC_LAB_STATUSLINE_LOG carrying
# the wall clock and the unread count it observed. A new line = the command ran.
# The count on that line = what a real badge WOULD have drawn at that moment.
# So the log alone decides both P2a (a line appears when mail lands) and P2b
# (a line with count 0 appears after the read) — no badge needed on screen.
# That is why the "you must ship the badge before you can measure it"
# chicken-and-egg does not hold.
#
# CONTRACT: never exit non-zero, never block. Claude renders this every update;
# a broken exit would put a broken line in front of the operator. Failures
# degrade to a visible marker, never to a silent zero — the same honesty rule
# the product badge will need (`✉?` != `✉0`).
set -uo pipefail

LOG="${CC_LAB_STATUSLINE_LOG:-/tmp/cc-lab-statusline.log}"
ROOT="${CC_MAILBOX_ROOT:-}"

input=$(cat 2>/dev/null || true)

# session_id lets us find THIS session's lab mailbox. The lab addresses mailboxes
# by Claude's own session_id (cc-enqueue-addressed.sh), not by garden id.
sid=$(printf '%s' "$input" | python3 -c \
	'import json,sys;print(json.load(sys.stdin).get("session_id",""))' 2>/dev/null || true)

# Unread = what `entwurf_inbox_read` would still return: every *.msg (not yet rung)
# plus every *.msg.delivered (rung, but not yet read). A file already archived to
# *.msg.delivered.read is NOT unread. This is the same set the product counts at
# meta-session.ts:2550. `?` means "could not measure" and is kept distinct from
# `0` on purpose: a statusline that fails must not draw a false zero.
#
# ADDRESSING DIFFERS FROM THE PRODUCT. The lab addresses a mailbox by Claude's own
# `session_id` (that is what cc-enqueue-addressed.sh writes); the product
# addresses it by GARDEN ID. Only the directory lookup changes -- the counted set,
# and therefore what P2a/P2b prove about re-execution, is the same.
count="?"
if [ -n "$ROOT" ] && [ -n "$sid" ] && [ -d "$ROOT/$sid" ]; then
	n=0
	for f in "$ROOT/$sid"/*.msg "$ROOT/$sid"/*.msg.delivered; do
		[ -e "$f" ] && n=$((n + 1))
	done
	count="$n"
fi

printf '%s invoked sid=%s unread=%s\n' \
	"$(date '+%H:%M:%S.%3N')" "${sid:-NONE}" "$count" >>"$LOG" 2>/dev/null || true

if [ "$count" = "?" ]; then
	printf 'LAB ✉? (unmeasurable)'
else
	printf 'LAB ✉%s' "$count"
fi
exit 0
