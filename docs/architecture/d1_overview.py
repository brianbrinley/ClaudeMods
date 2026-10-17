"""D1: how boomi-dashboard plugs into Claude Code (architecture, `fit` size: 1280 wide, cropped to its content).

Nine nodes, eight connectors, three zones, one focal node and one accent path.
Every number sits on the 4px grid. Connectors leave and enter on their own port.
"""

from lib import elbow_h_v_h, label, legend, line, node, path, zone

SLUG = "d1-overview"
EYEBROW = "Architecture · boomi-dashboard"
TITLE = "How boomi-dashboard plugs into Claude Code"
DESC = (
    "Architecture of the boomi-dashboard mod: Claude Code raises events that one hooks module handles, "
    "calling pure tested modules and keeping state, drawing the pane, banner and status line, and reaching "
    "Companion's docs, Boomi's API, a model and git only where needed."
)
VIEWBOX = (0, 48, 1280, 648)

NOTES = [
    (
        "Events in, drawing out",
        "Claude Code raises an event (<code>tool.call</code>, <code>turn.*</code>, <code>prompt.submit</code>, <code>session.start</code>, <code>ui.render</code>). "
        "One module hooks them, and answers <code>ui.render</code> with what to draw: the pane, the Prompt tab, the banner, the status line and toasts.",
    ),
    (
        "Logic stays testable",
        "Anything that needs no engine call is a plain function in its own file, with unit tests that call it directly. "
        "Helpers that take <code>$</code> stay in the hooks module, because the engine follows <code>$</code> only within one file.",
    ),
    (
        "Reads out, installs nothing",
        "It reads Companion's docs, polls Boomi's API, and runs <code>git fetch</code> once a day. A model is called only to rewrite a prompt or draft guide edits. "
        "Nothing installs unless you run <code>/bc-dashboard upgrade</code>.",
    ),
]


def body() -> str:
    parts: list[str] = []
    # Zones first, then connectors, then nodes (z-order: zones, arrows, nodes).
    parts.append(zone(40, 88, 280, 520, "CLAUDE CODE · THE HOST"))
    parts.append(zone(376, 88, 432, 520, "BOOMI-DASHBOARD · THE MOD"))
    parts.append(zone(904, 88, 336, 520, "OUTSIDE THE SESSION"))

    # Left: events in (accent), drawing out (muted). Each has its own port on the hooks module's left edge.
    parts.append(path("M280,176 H380 Q388,176 388,184 V336 Q388,344 396,344 H496", "a-accent"))
    parts.append(label(418, 260, "EVENTS"))
    parts.append(path("M496,376 H428 Q420,376 420,384 V520 Q420,528 412,528 H280", "a"))
    parts.append(label(450, 452, "RENDER"))

    # Inside the mod: up to the pure modules, down to the state.
    parts.append(line(592, 312, 592, 224))
    parts.append(label(618, 268, "CALLS"))
    parts.append(line(592, 408, 592, 480))
    parts.append(label(640, 444, "READ + WRITE"))

    # Right: four ports on the hooks module's right edge, each to its own node through its own trunk.
    parts.append(path(elbow_h_v_h(688, 324, 724, 168, 952), "a"))
    parts.append(label(860, 154, "READS"))
    parts.append(path(elbow_h_v_h(688, 342, 748, 288, 952), "a-link"))
    parts.append(label(860, 274, "API / SCRIPTS"))
    parts.append(path(elbow_h_v_h(688, 360, 796, 408, 952), "a", dashed=True))
    parts.append(label(860, 394, "$.MODEL"))
    parts.append(path(elbow_h_v_h(688, 378, 772, 528, 952), "a", dashed=True))
    parts.append(label(860, 514, "GIT FETCH"))

    # Nodes.
    parts.append(node(80, 128, 200, 96, "backend", "HOST", "Claude Code", ["events in, $ calls out", "one session at a time"]))
    parts.append(node(80, 480, 200, 96, "backend", "UI", "What you see", ["pane · Prompt tab · banner", "status line · toasts"]))
    parts.append(node(496, 128, 192, 96, "backend", "TESTED", "Pure modules", ["activity · prompt-check", "retrieve · themes · reports"]))
    parts.append(node(496, 312, 192, 96, "focal", "MOD", "Hooks module", ["register.tsx", "one hook per event"]))
    parts.append(node(496, 480, 192, 96, "store", "STATE", "State", ["$.state atoms · $.store", "contract lives in types/"]))
    parts.append(node(952, 128, 240, 80, "external", "FILES", "Companion's docs", ["references/ · CHANGELOG", "an index of pointers"]))
    parts.append(node(952, 248, 240, 80, "external", "API", "Boomi platform", ["Platform API, read-only polls", "Companion scripts on request"]))
    parts.append(node(952, 368, 240, 80, "external", "MODEL", "Prompt model", ["$.model.complete (haiku)", "rewrites and guide drafts"]))
    parts.append(node(952, 488, 240, 80, "external", "GIT", "GitHub origin", ["git fetch, once a day", "upgrade check, never installs"]))

    parts.append(
        legend(
            664,
            [("focal", "THE MOD"), ("a", "INTERNAL CALL"), ("a-accent", "EVENTS IN"), ("a-link", "BOOMI API"), ("dash", "OPTIONAL · ASYNC")],
            step=216,
        )
    )
    return "\n        ".join(parts)
