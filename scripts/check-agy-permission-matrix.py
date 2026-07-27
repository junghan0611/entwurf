#!/usr/bin/env python3
"""check-agy-permission-matrix — the CONTRACT SPACE of the agy permission engine,
enumerated as a literal table instead of an appended case list.

Why this exists (2026-07-27, the qualification design): every permission defect this
cut closed — the shallow install parser, uninstall's validate-after-mutate, the
path-only state doctor, within-list broad-first — was a cell in a matrix nobody had
enumerated. smoke-agy-install-state grew by appending the cell that had just failed;
this gate states the axes up front and exhausts the meaningful product, so an empty
cell is a visible decision, never silence.

Axes (operation-scoped, per reduction rules R1-R4 below):
  parser-state  none | v1 | v2(ours/theirs/mixed) | malformed{unknown-version,
                empty-provenance, not-json, shape}
  operation     permission-install | permission-uninstall | permission-doctor |
                permission-state-doctor
  settings      present | absent | malformed (+ wrong-typed containers)
  ownership     install: provenance capture {none, all, mixed pre-existed}
                uninstall: removal split {ours, theirs, mixed} + container ownership
                doctor: (composed in the shell layer — see R6)
  precedence    doctor only: {allow, ask, deny} x {exact, broad} x {same-list,
                cross-list}

Reduction rules — an EXCLUDED cell is a stated decision, printed at the end:
  R1  Both malformed representatives (unknown-version, empty-provenance) ride EVERY
      mutating operation separately — the shallow-parser defect was exactly a second
      parser diverging on them. Expectations agree (REFUSE + byte-identical); cells
      stay separate.
  R2  Under settings in {absent, malformed}, ownership x precedence is undefined and
      NOT expanded; those cells instead assert validate-before-mutate (a refusal
      leaves settings AND state byte-identical).
  R3  Ownership is enumerated per operation meaning, never as a blind product.
  R4  Precedence applies to permission-doctor only — install/uninstall never read it.
  R5  EXCLUDED: symlink targets (settings/state/config) — lifecycle + filesystem
      refusal is owned by smoke-agy-install-state.
  R6  EXCLUDED: shell verdict composition (DRIFT/NOTE/ORPHANED rendering, doctor exit
      codes, agy-bridge.sh wiring) — owned by smoke-agy-install-state.
  R7  EXCLUDED: the MCP-config install lane (mcpServers key) — same owner.

Oracle independence: every expectation below is a hand-written literal. Nothing is
read back from the SUT (`permission-rules` output is deliberately NOT consulted).

Offline, deterministic, stdlib only. All writes stay inside one mkdtemp sandbox.
"""

import hashlib
import json
import os
import re
import shutil
import subprocess
import sys
import tempfile

REPO = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
CONFIG = os.path.join(REPO, "scripts", "agy-bridge-config.py")

# The three rules, LITERALLY. Copied by hand on purpose: if ALLOW_RULES drifts, this
# gate must go red, not follow it.
R_V2 = "mcp(entwurf-bridge/entwurf_v2)"
R_PEERS = "mcp(entwurf-bridge/entwurf_peers)"
R_SELF = "mcp(entwurf-bridge/entwurf_self)"
OURS = [R_V2, R_PEERS, R_SELF]
BROAD_SERVER = "mcp(entwurf-bridge)"
BROAD_STAR = "mcp(*)"
OPERATOR = "command(*)"

passed = 0


def ok(label):
    global passed
    sys.stdout.write("  ok    %s\n" % label)
    passed += 1


def die(label, detail):
    sys.stderr.write("FAIL: %s\n      %s\n" % (label, detail))
    sys.exit(1)


def sha(path):
    if not os.path.exists(path):
        return "ABSENT"
    with open(path, "rb") as fh:
        return hashlib.sha256(fh.read()).hexdigest()


# ── fixture builders (parser-state axis) ────────────────────────────────────


def state_v1(settings_path, existed=False):
    return {
        "schemaVersion": 1,
        "managedSettingsPath": settings_path,
        "rule": R_V2,
        "detectMode": "adopt-regular-file",
        "settingsExistedBefore": True,
        "permissionsExistedBefore": True,
        "allowExistedBefore": True,
        "ruleExistedBefore": existed,
        "installedAt": "2026-07-26T00:00:18Z",
    }


def state_v2(settings_path, existed_map, allow_existed=True, perms_existed=True, settings_existed=True, detect="adopt-regular-file"):
    return {
        "schemaVersion": 2,
        "managedSettingsPath": settings_path,
        "rules": OURS,
        "detectMode": detect,
        "settingsExistedBefore": settings_existed,
        "permissionsExistedBefore": perms_existed,
        "allowExistedBefore": allow_existed,
        "rulesExistedBefore": existed_map,
        "installedAt": "2026-07-27T00:00:00Z",
    }


ALL_OURS = {R_V2: False, R_PEERS: False, R_SELF: False}
ALL_THEIRS = {R_V2: True, R_PEERS: True, R_SELF: True}
MIXED = {R_V2: True, R_PEERS: False, R_SELF: False}


def run_cell(cell):
    sandbox = tempfile.mkdtemp(prefix="agy-perm-matrix-")
    try:
        settings = os.path.join(sandbox, "settings.json")
        state = os.path.join(sandbox, "permission-state.json")

        st_fixture = cell.get("state")
        if callable(st_fixture):
            st_fixture = st_fixture(settings)
        if st_fixture is not None:
            with open(state, "w") as fh:
                fh.write(st_fixture if isinstance(st_fixture, str) else json.dumps(st_fixture, indent=2))

        se_fixture = cell.get("settings")
        if se_fixture is not None:
            with open(settings, "w") as fh:
                fh.write(se_fixture if isinstance(se_fixture, str) else json.dumps(se_fixture, indent=2))

        pre_settings, pre_state = sha(settings), sha(state)

        op = cell["op"]
        if op == "permission-install":
            argv = [sys.executable, CONFIG, op, settings, state]
        elif op == "permission-uninstall":
            argv = [sys.executable, CONFIG, op, state]
        elif op == "permission-doctor":
            argv = [sys.executable, CONFIG, op, settings]
        elif op == "permission-state-doctor":
            argv = [sys.executable, CONFIG, op, state]
        else:
            die(cell["id"], "unknown op %s" % op)
        proc = subprocess.run(argv, capture_output=True, text=True, timeout=30)

        exp = cell["expect"]
        # P0-4: a nonzero cell without a hand-written stderr expectation is a hole in
        # the oracle — the refusal REASON is part of the contract, not just the rc.
        if exp["rc"] != 0 and "stderr_token" not in exp:
            die("table integrity", "%s is a nonzero cell without a stderr_token" % cell["id"])
        if proc.returncode != exp["rc"]:
            die(cell["id"], "rc=%d want %d\nstdout=%s\nstderr=%s" % (proc.returncode, exp["rc"], proc.stdout, proc.stderr))
        if "stdout" in exp and proc.stdout.strip() != exp["stdout"]:
            die(cell["id"], "stdout=%r want %r" % (proc.stdout.strip(), exp["stdout"]))
        if "stdout_prefix" in exp and not proc.stdout.strip().startswith(exp["stdout_prefix"]):
            die(cell["id"], "stdout=%r want prefix %r" % (proc.stdout.strip(), exp["stdout_prefix"]))
        if "stderr_token" in exp and exp["stderr_token"] not in proc.stderr:
            die(cell["id"], "stderr=%r missing hand-written token %r" % (proc.stderr, exp["stderr_token"]))

        if exp.get("byte_identical"):
            if sha(settings) != pre_settings:
                die(cell["id"], "REFUSAL MUTATED settings (validate-before-mutate broken)")
            if sha(state) != pre_state:
                die(cell["id"], "REFUSAL MUTATED the state record (validate-before-mutate broken)")

        if "settings_allow_after" in exp:
            want = exp["settings_allow_after"]
            if want is None:
                if os.path.exists(settings):
                    die(cell["id"], "settings file should be removed, still present")
            else:
                data = json.load(open(settings))
                got = (data.get("permissions") or {}).get("allow")
                if got != want:
                    die(cell["id"], "allow=%r want %r" % (got, want))
        if "settings_content" in exp:
            data = json.load(open(settings))
            if data != exp["settings_content"]:
                die(cell["id"], "settings=%r want %r" % (data, exp["settings_content"]))

        if "state_exact" in exp:
            # P0-4: successful state writes are pinned by EXACT keyset + every stable
            # field + installedAt format — a subset comparison would let an unexpected
            # key or field drift ride green.
            data = json.load(open(state))
            want = dict(exp["state_exact"])
            if want.get("managedSettingsPath") == "__SETTINGS__":
                want["managedSettingsPath"] = settings
            if set(data.keys()) != set(want.keys()) | {"installedAt"}:
                die(cell["id"], "state keyset %r != %r + installedAt" % (sorted(data), sorted(want)))
            for key, val in want.items():
                if data[key] != val:
                    die(cell["id"], "state[%s]=%r want %r" % (key, data[key], val))
            if not re.match(r"^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$", data["installedAt"]):
                die(cell["id"], "installedAt %r is not the recorded UTC format" % data["installedAt"])
        if "state_after" in exp:
            want = exp["state_after"]
            if want == "removed":
                if os.path.exists(state):
                    die(cell["id"], "state record should be removed, still present")
            elif want == "survives":
                if not os.path.exists(state):
                    die(cell["id"], "state record should SURVIVE the refusal, was deleted")
            else:
                data = json.load(open(state))
                for key, val in want.items():
                    if data.get(key) != val:
                        die(cell["id"], "state[%s]=%r want %r" % (key, data.get(key), val))
        ok(cell["id"])
    finally:
        shutil.rmtree(sandbox, ignore_errors=True)


# ── the table ───────────────────────────────────────────────────────────────

CELLS = [
    # ═ permission-install: settings axis x parser-state axis x provenance capture ═
    {
        "id": "I01 install: settings absent + no prior state -> created-new, 3 rules, provenance all-ours",
        "op": "permission-install", "state": None, "settings": None,
        "expect": {"rc": 0, "stdout_prefix": "added " + R_V2,
                   "settings_allow_after": OURS,
                   "state_exact": {"schemaVersion": 2, "managedSettingsPath": "__SETTINGS__",
                                   "rules": OURS, "detectMode": "created-new",
                                   "settingsExistedBefore": False, "permissionsExistedBefore": False,
                                   "allowExistedBefore": False, "rulesExistedBefore": ALL_OURS}},
    },
    {
        "id": "I02 install: empty settings object -> containers created, provenance all-ours",
        "op": "permission-install", "state": None, "settings": {},
        "expect": {"rc": 0, "settings_allow_after": OURS,
                   "state_exact": {"schemaVersion": 2, "managedSettingsPath": "__SETTINGS__",
                                   "rules": OURS, "detectMode": "adopt-regular-file",
                                   "settingsExistedBefore": True, "permissionsExistedBefore": False,
                                   "allowExistedBefore": False, "rulesExistedBefore": ALL_OURS}},
    },
    {
        "id": "I03 install: all three pre-existed -> already-present, provenance all-theirs",
        "op": "permission-install", "state": None,
        "settings": {"permissions": {"allow": [R_V2, R_PEERS, R_SELF]}},
        "expect": {"rc": 0, "stdout": "already-present %s %s %s" % (R_V2, R_PEERS, R_SELF),
                   "settings_allow_after": OURS,
                   "state_exact": {"schemaVersion": 2, "managedSettingsPath": "__SETTINGS__",
                                   "rules": OURS, "detectMode": "adopt-regular-file",
                                   "settingsExistedBefore": True, "permissionsExistedBefore": True,
                                   "allowExistedBefore": True, "rulesExistedBefore": ALL_THEIRS}},
    },
    {
        "id": "I04 install: mixed pre-existence -> per-rule provenance, appended after operator rules",
        "op": "permission-install", "state": None,
        "settings": {"permissions": {"allow": [R_V2, OPERATOR]}},
        "expect": {"rc": 0,
                   "settings_allow_after": [R_V2, OPERATOR, R_PEERS, R_SELF],
                   "state_exact": {"schemaVersion": 2, "managedSettingsPath": "__SETTINGS__",
                                   "rules": OURS, "detectMode": "adopt-regular-file",
                                   "settingsExistedBefore": True, "permissionsExistedBefore": True,
                                   "allowExistedBefore": True, "rulesExistedBefore": MIXED}},
    },
    {
        "id": "I05 install: idempotent re-run over our own write does NOT re-attribute (provenance carried)",
        "op": "permission-install",
        "state": lambda s: state_v2(s, ALL_OURS),
        "settings": {"permissions": {"allow": [R_V2, R_PEERS, R_SELF]}},
        "expect": {"rc": 0, "settings_allow_after": OURS,
                   "state_exact": {"schemaVersion": 2, "managedSettingsPath": "__SETTINGS__",
                                   "rules": OURS, "detectMode": "adopt-regular-file",
                                   "settingsExistedBefore": True, "permissionsExistedBefore": True,
                                   "allowExistedBefore": True, "rulesExistedBefore": ALL_OURS}},
    },
    {
        "id": "I06 install: v1 prior migrates in place (v1 rule stays ours, new rules read from disk)",
        "op": "permission-install",
        "state": lambda s: state_v1(s, existed=False),
        "settings": {"permissions": {"allow": [R_V2, OPERATOR]}},
        "expect": {"rc": 0,
                   "settings_allow_after": [R_V2, OPERATOR, R_PEERS, R_SELF],
                   "state_exact": {"schemaVersion": 2, "managedSettingsPath": "__SETTINGS__",
                                   "rules": OURS, "detectMode": "adopt-regular-file",
                                   "settingsExistedBefore": True, "permissionsExistedBefore": True,
                                   "allowExistedBefore": True,
                                   "rulesExistedBefore": {R_V2: False, R_PEERS: False, R_SELF: False}}},
    },
    {
        "id": "I07 install: re-targeted prior (different managedSettingsPath) is a fresh install for this path",
        "op": "permission-install",
        "state": lambda s: state_v2("/somewhere/else/settings.json", ALL_THEIRS),
        "settings": {"permissions": {"allow": []}},
        "expect": {"rc": 0, "settings_allow_after": OURS,
                   "state_exact": {"schemaVersion": 2, "managedSettingsPath": "__SETTINGS__",
                                   "rules": OURS, "detectMode": "adopt-regular-file",
                                   "settingsExistedBefore": True, "permissionsExistedBefore": True,
                                   "allowExistedBefore": True, "rulesExistedBefore": ALL_OURS}},
    },
    {
        "id": "I08 install: R1a unknown-version prior -> REFUSE rc4, settings AND state byte-identical",
        "op": "permission-install",
        "state": lambda s: {"schemaVersion": 99, "managedSettingsPath": s},
        "settings": {"permissions": {"allow": [OPERATOR]}},
        "expect": {"rc": 4, "byte_identical": True, "state_after": "survives",
                   "stderr_token": "prior permission install-state is unusable — unknown schemaVersion 99"},
    },
    {
        "id": "I09 install: R1b empty-provenance prior -> REFUSE rc4, settings AND state byte-identical",
        "op": "permission-install",
        "state": lambda s: {"schemaVersion": 2, "managedSettingsPath": s, "rules": OURS, "rulesExistedBefore": {}},
        "settings": {"permissions": {"allow": [OPERATOR]}},
        "expect": {"rc": 4, "byte_identical": True, "state_after": "survives",
                   "stderr_token": "no boolean provenance for"},
    },
    {
        "id": "I10 install: not-json prior state -> REFUSE rc4, nothing written",
        "op": "permission-install", "state": "not-json{{{",
        "settings": {"permissions": {"allow": [OPERATOR]}},
        "expect": {"rc": 4, "byte_identical": True, "state_after": "survives",
                   "stderr_token": "is not valid JSON"},
    },
    {
        "id": "I11 install: malformed settings JSON -> REFUSE rc4 before any write (R2)",
        "op": "permission-install", "state": None, "settings": "this is not json{{{",
        "expect": {"rc": 4, "byte_identical": True, "stderr_token": "is not valid JSON"},
    },
    {
        "id": "I12 install: wrong-typed permissions container -> REFUSE rc4, byte-identical",
        "op": "permission-install", "state": None, "settings": {"permissions": []},
        "expect": {"rc": 4, "byte_identical": True, "stderr_token": "permissions must be a JSON object"},
    },
    {
        "id": "I13 install: wrong-typed allow container -> REFUSE rc4, byte-identical",
        "op": "permission-install", "state": None, "settings": {"permissions": {"allow": "everything"}},
        "expect": {"rc": 4, "byte_identical": True, "stderr_token": "permissions.allow must be a JSON array"},
    },

    # ═ permission-uninstall: parser-state x settings x removal split x containers ═
    {
        "id": "U01 uninstall: no state -> rc2, nothing to undo",
        "op": "permission-uninstall", "state": None, "settings": {"permissions": {"allow": OURS}},
        "expect": {"rc": 2, "byte_identical": True, "stderr_token": "no permission install-state at"},
    },
    {
        "id": "U02 uninstall: not-json state -> rc4 refusal",
        "op": "permission-uninstall", "state": "not-json{{{", "settings": {"permissions": {"allow": OURS}},
        "expect": {"rc": 4, "byte_identical": True, "state_after": "survives",
                   "stderr_token": "is not valid JSON"},
    },
    {
        "id": "U03 uninstall: state without managedSettingsPath -> rc4 refusal, state survives",
        "op": "permission-uninstall", "state": {"schemaVersion": 2, "rules": OURS, "rulesExistedBefore": ALL_OURS},
        "settings": {"permissions": {"allow": OURS}},
        "expect": {"rc": 4, "byte_identical": True, "state_after": "survives",
                   "stderr_token": "has no managedSettingsPath"},
    },
    {
        "id": "U04 uninstall: all-ours -> removes exactly ours, operator rule survives, state removed",
        "op": "permission-uninstall",
        "state": lambda s: state_v2(s, ALL_OURS),
        "settings": {"permissions": {"allow": [R_V2, OPERATOR, R_PEERS, R_SELF]}},
        "expect": {"rc": 0, "stdout_prefix": "uninstalled " + R_V2,
                   "settings_allow_after": [OPERATOR], "state_after": "removed"},
    },
    {
        "id": "U05 uninstall: all-theirs -> removes nothing, says so, state removed",
        "op": "permission-uninstall",
        "state": lambda s: state_v2(s, ALL_THEIRS),
        "settings": {"permissions": {"allow": OURS}},
        "expect": {"rc": 0, "stdout_prefix": "uninstalled (nothing",
                   "settings_allow_after": OURS, "state_after": "removed"},
    },
    {
        "id": "U06 uninstall: mixed split is exact — theirs stays, ours goes",
        "op": "permission-uninstall",
        "state": lambda s: state_v2(s, MIXED),
        "settings": {"permissions": {"allow": OURS}},
        "expect": {"rc": 0, "settings_allow_after": [R_V2], "state_after": "removed"},
    },
    {
        "id": "U07 uninstall: a v1 state uninstalls on its own shape (removes the one rule it granted)",
        "op": "permission-uninstall",
        "state": lambda s: state_v1(s, existed=False),
        "settings": {"permissions": {"allow": [R_V2, OPERATOR]}},
        "expect": {"rc": 0, "settings_allow_after": [OPERATOR], "state_after": "removed"},
    },
    {
        "id": "U08 uninstall: R1a unknown-version -> REFUSE rc4, state SURVIVES, settings untouched",
        "op": "permission-uninstall",
        "state": lambda s: {"schemaVersion": 99, "managedSettingsPath": s},
        "settings": {"permissions": {"allow": OURS}},
        "expect": {"rc": 4, "byte_identical": True, "state_after": "survives",
                   "stderr_token": "unknown schemaVersion 99"},
    },
    {
        "id": "U09 uninstall: R1b empty-provenance -> REFUSE rc4, no blind revoke, state SURVIVES",
        "op": "permission-uninstall",
        "state": lambda s: {"schemaVersion": 2, "managedSettingsPath": s, "rules": OURS, "rulesExistedBefore": {}},
        "settings": {"permissions": {"allow": OURS}},
        "expect": {"rc": 4, "byte_identical": True, "state_after": "survives",
                   "stderr_token": "no boolean provenance for"},
    },
    {
        "id": "U10 uninstall: R2 malformed prior + settings ABSENT -> refusal BEFORE state deletion",
        "op": "permission-uninstall",
        "state": lambda s: {"schemaVersion": 2, "managedSettingsPath": s, "rules": OURS, "rulesExistedBefore": {}},
        "settings": None,
        "expect": {"rc": 4, "state_after": "survives",
                   "stderr_token": "no boolean provenance for"},
    },
    {
        "id": "U11 uninstall: valid state + settings absent -> rc0, state removed (nothing to edit)",
        "op": "permission-uninstall",
        "state": lambda s: state_v2(s, ALL_OURS),
        "settings": None,
        "expect": {"rc": 0, "state_after": "removed"},
    },
    {
        "id": "U12 uninstall: valid state + malformed settings -> rc4, state SURVIVES for the retry",
        "op": "permission-uninstall",
        "state": lambda s: state_v2(s, ALL_OURS),
        "settings": "not json at all",
        "expect": {"rc": 4, "byte_identical": True, "state_after": "survives",
                   "stderr_token": "is not valid JSON"},
    },
    {
        "id": "U13 uninstall: containers WE created are dropped when emptied (allow+permissions gone, file kept)",
        "op": "permission-uninstall",
        "state": lambda s: state_v2(s, ALL_OURS, allow_existed=False, perms_existed=False, settings_existed=True),
        "settings": {"permissions": {"allow": OURS}},
        "expect": {"rc": 0, "settings_content": {}, "state_after": "removed"},
    },
    {
        "id": "U14 uninstall: an operator-owned allow container is KEPT even when emptied",
        "op": "permission-uninstall",
        "state": lambda s: state_v2(s, ALL_OURS, allow_existed=True, perms_existed=True),
        "settings": {"permissions": {"allow": OURS}},
        "expect": {"rc": 0, "settings_allow_after": [], "state_after": "removed"},
    },
    {
        "id": "U15 uninstall: created-new settings holding only our structure is removed entirely",
        "op": "permission-uninstall",
        "state": lambda s: state_v2(s, ALL_OURS, allow_existed=False, perms_existed=False,
                                    settings_existed=False, detect="created-new"),
        "settings": {"permissions": {"allow": OURS}},
        "expect": {"rc": 0, "settings_allow_after": None, "state_after": "removed"},
    },

    # ═ permission-doctor: presence x precedence (R4) — token line oracle ═
    {
        "id": "D01 doctor: settings absent -> absent",
        "op": "permission-doctor", "state": None, "settings": None,
        "expect": {"rc": 0, "stdout": "absent"},
    },
    {
        "id": "D02 doctor: malformed settings -> invalid-json",
        "op": "permission-doctor", "state": None, "settings": "nope{{{",
        "expect": {"rc": 0, "stdout": "invalid-json"},
    },
    {
        "id": "D03 doctor: empty object -> not-configured",
        "op": "permission-doctor", "state": None, "settings": {},
        "expect": {"rc": 0, "stdout": "not-configured"},
    },
    {
        "id": "D04 doctor: wrong-typed permissions container reads as none -> not-configured",
        "op": "permission-doctor", "state": None, "settings": {"permissions": []},
        "expect": {"rc": 0, "stdout": "not-configured"},
    },
    {
        "id": "D05 doctor: all three granted -> configured",
        "op": "permission-doctor", "state": None, "settings": {"permissions": {"allow": OURS}},
        "expect": {"rc": 0, "stdout": "configured"},
    },
    {
        "id": "D06 doctor: empty ask/deny lists do not shadow -> configured",
        "op": "permission-doctor", "state": None,
        "settings": {"permissions": {"allow": OURS, "ask": [], "deny": []}},
        "expect": {"rc": 0, "stdout": "configured"},
    },
    {
        "id": "D07 doctor: one missing -> partially-configured names exactly the gap",
        "op": "permission-doctor", "state": None,
        "settings": {"permissions": {"allow": [R_V2, R_PEERS]}},
        "expect": {"rc": 0, "stdout": "partially-configured " + R_SELF},
    },
    {
        "id": "D08 doctor: two missing -> partially-configured names both, in rule-set order",
        "op": "permission-doctor", "state": None,
        "settings": {"permissions": {"allow": [R_PEERS]}},
        "expect": {"rc": 0, "stdout": "partially-configured %s %s" % (R_V2, R_SELF)},
    },
    {
        "id": "D09 doctor: nothing of ours, no broad -> not-configured",
        "op": "permission-doctor", "state": None,
        "settings": {"permissions": {"allow": [OPERATOR]}},
        "expect": {"rc": 0, "stdout": "not-configured"},
    },
    {
        "id": "D10 doctor: operator's mcp(*) covers a bare host -> covered-by-allow, named",
        "op": "permission-doctor", "state": None,
        "settings": {"permissions": {"allow": [BROAD_STAR]}},
        "expect": {"rc": 0, "stdout": "covered-by-allow " + BROAD_STAR},
    },
    {
        "id": "D11 doctor: server-wide rule covers a partial host -> covered-by-allow, named",
        "op": "permission-doctor", "state": None,
        "settings": {"permissions": {"allow": [R_V2, BROAD_SERVER]}},
        "expect": {"rc": 0, "stdout": "covered-by-allow " + BROAD_SERVER},
    },
    {
        "id": "D12 doctor: exact deny shadows ONE tool -> shadowed-by-deny exact, that rule named",
        "op": "permission-doctor", "state": None,
        "settings": {"permissions": {"allow": OURS, "deny": [R_SELF]}},
        "expect": {"rc": 0, "stdout": "shadowed-by-deny exact " + R_SELF},
    },
    {
        "id": "D13 doctor: exact ask shadows ONE tool -> shadowed-by-ask exact",
        "op": "permission-doctor", "state": None,
        "settings": {"permissions": {"allow": OURS, "ask": [R_SELF]}},
        "expect": {"rc": 0, "stdout": "shadowed-by-ask exact " + R_SELF},
    },
    {
        "id": "D14 doctor: broad mcp(*) in deny -> shadowed-by-deny broad",
        "op": "permission-doctor", "state": None,
        "settings": {"permissions": {"allow": OURS, "deny": [BROAD_STAR]}},
        "expect": {"rc": 0, "stdout": "shadowed-by-deny broad " + BROAD_STAR},
    },
    {
        "id": "D15 doctor: broad server rule in ask -> shadowed-by-ask broad",
        "op": "permission-doctor", "state": None,
        "settings": {"permissions": {"allow": OURS, "ask": [BROAD_SERVER]}},
        "expect": {"rc": 0, "stdout": "shadowed-by-ask broad " + BROAD_SERVER},
    },
    {
        "id": "D16 doctor: CROSS-LIST — deny-exact + ask-broad reports the BROAD ask (the shipped defect) [QK:AGY-CROSS-LIST-BROAD-FIRST]",
        "op": "permission-doctor", "state": None,
        "settings": {"permissions": {"allow": OURS, "deny": [R_SELF], "ask": [BROAD_SERVER]}},
        "expect": {"rc": 0, "stdout": "shadowed-by-ask broad " + BROAD_SERVER},
    },
    {
        "id": "D17 doctor: CROSS-LIST mirror — deny-broad + ask-exact reports the BROAD deny",
        "op": "permission-doctor", "state": None,
        "settings": {"permissions": {"allow": OURS, "deny": [BROAD_STAR], "ask": [R_SELF]}},
        "expect": {"rc": 0, "stdout": "shadowed-by-deny broad " + BROAD_STAR},
    },
    {
        "id": "D18 doctor: a broad rule in deny shadows even its own twin in allow (Deny > Allow)",
        "op": "permission-doctor", "state": None,
        "settings": {"permissions": {"allow": [BROAD_STAR], "deny": [BROAD_STAR]}},
        "expect": {"rc": 0, "stdout": "shadowed-by-deny broad " + BROAD_STAR},
    },
    {
        "id": "D19 doctor: two broad rules in one deny list -> first in FILE order is named",
        "op": "permission-doctor", "state": None,
        "settings": {"permissions": {"allow": OURS, "deny": [BROAD_STAR, BROAD_SERVER]}},
        "expect": {"rc": 0, "stdout": "shadowed-by-deny broad " + BROAD_STAR},
    },

    # ═ permission-state-doctor: the parser-state axis, read-only (hard rule 13) ═
    {
        "id": "S01 state-doctor: absent -> absent",
        "op": "permission-state-doctor", "state": None, "settings": None,
        "expect": {"rc": 0, "stdout": "absent"},
    },
    {
        "id": "S02 state-doctor: not-json -> corrupt, named",
        "op": "permission-state-doctor", "state": "junk{{{", "settings": None,
        "expect": {"rc": 0, "stdout": "corrupt not valid JSON"},
    },
    {
        "id": "S03 state-doctor: valid v1 -> ok 1",
        "op": "permission-state-doctor", "state": lambda s: state_v1(s), "settings": None,
        "expect": {"rc": 0, "stdout": "ok 1"},
    },
    {
        "id": "S04 state-doctor: valid v2 -> ok 3",
        "op": "permission-state-doctor", "state": lambda s: state_v2(s, ALL_OURS), "settings": None,
        "expect": {"rc": 0, "stdout": "ok 3"},
    },
    {
        "id": "S05 state-doctor: R1a unknown version -> corrupt, refuses to guess",
        "op": "permission-state-doctor",
        "state": {"schemaVersion": 99, "managedSettingsPath": "/x"}, "settings": None,
        "expect": {"rc": 0, "stdout_prefix": "corrupt unknown schemaVersion 99"},
    },
    {
        "id": "S06 state-doctor: R1b empty provenance map -> corrupt (no boolean provenance)",
        "op": "permission-state-doctor",
        "state": {"schemaVersion": 2, "managedSettingsPath": "/x", "rules": OURS, "rulesExistedBefore": {}},
        "settings": None,
        "expect": {"rc": 0, "stdout_prefix": "corrupt no boolean provenance for"},
    },
    {
        "id": "S07 state-doctor: v2 with a non-list rules field -> corrupt",
        "op": "permission-state-doctor",
        "state": {"schemaVersion": 2, "managedSettingsPath": "/x", "rules": "all", "rulesExistedBefore": {}},
        "settings": None,
        "expect": {"rc": 0, "stdout_prefix": "corrupt `rules` must be a non-empty list"},
    },
    {
        "id": "S08 state-doctor: v1 missing its boolean -> corrupt",
        "op": "permission-state-doctor",
        "state": {"schemaVersion": 1, "managedSettingsPath": "/x", "rule": R_V2},
        "settings": None,
        "expect": {"rc": 0, "stdout_prefix": "corrupt schemaVersion 1 needs"},
    },
]

EXCLUSIONS = [
    ("R2", "ownership x precedence under settings in {absent, malformed} — undefined; replaced by byte-identical refusal cells"),
    ("R4", "precedence on install/uninstall — the engine never reads it there"),
    ("R5", "symlink settings/state/config refusals — owned by smoke-agy-install-state"),
    ("R6", "shell doctor verdict composition (DRIFT/NOTE/ORPHANED, exit codes) — owned by smoke-agy-install-state"),
    ("R7", "the MCP-config install lane (mcpServers) — owned by smoke-agy-install-state"),
]

EXPECTED_CELLS = 55


def main():
    if not os.path.exists(CONFIG):
        die("preflight", "missing SUT %s" % CONFIG)
    before = subprocess.run(["git", "-C", REPO, "status", "--porcelain"], capture_output=True, text=True).stdout
    if len(CELLS) != EXPECTED_CELLS:
        die("table integrity", "CELLS holds %d cells, the stated contract is %d — extend the TABLE "
            "and this count together, never silently" % (len(CELLS), EXPECTED_CELLS))
    ids = [c["id"].split()[0] for c in CELLS]
    if len(set(ids)) != len(ids):
        die("table integrity", "duplicate cell ids")
    # P0-4: the total alone can hide a swapped operation mix — assert the per-operation
    # counts AND the exact ID sequence, so a dropped/duplicated cell names itself.
    per_op = {"I": 13, "U": 15, "D": 19, "S": 8}
    want_ids = ["%s%02d" % (prefix, n) for prefix in ("I", "U", "D", "S") for n in range(1, per_op[prefix] + 1)]
    if ids != want_ids:
        die("table integrity", "cell ID sequence drifted: %r" % [a for a, b in zip(ids, want_ids) if a != b])
    for cell in CELLS:
        run_cell(cell)
    after = subprocess.run(["git", "-C", REPO, "status", "--porcelain"], capture_output=True, text=True).stdout
    if before != after:
        die("checkout purity", "the matrix run changed the working tree")
    sys.stdout.write("\ncheck-agy-permission-matrix: %d cells executed (contract table, not an append log)\n" % passed)
    for rule, why in EXCLUSIONS:
        sys.stdout.write("  excluded by %s: %s\n" % (rule, why))


if __name__ == "__main__":
    main()
