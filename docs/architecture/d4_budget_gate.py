"""D4: from a shell command to a pane row and a budget decision (flowchart, `fit` size: 1280 wide, cropped to its content).

Nine nodes, ten connectors: an oval, two diamonds, six steps. Flow runs left to right along the top, where Yes
goes right and No goes down, then snakes through the lower rows. One accent element: the budget gate.
"""

from lib import diamond, label, legend, line, node, oval, path

SLUG = "d4-budget-gate"
EYEBROW = "Flowchart · the budget gate"
TITLE = "From a shell command to a pane row and a budget decision"
DESC = (
    "Flowchart of what the dashboard does with each shell command Claude runs: a Companion change while a budget is spent is "
    "refused, or asked about in confirm mode; every other command is noted as running, run, read into a step, recorded, "
    "and shown in the pane, the status line and a toast."
)
VIEWBOX = (0, 64, 1280, 540)

NOTES = [
    (
        "A gate before a change",
        "Only Companion changes are held against a spent budget: creates, pushes, deploys, undeploys, test runs, and changing calls to the Platform API. "
        "Reads, pulls and status checks always run.",
    ),
    (
        "Warn, ask or refuse",
        "<code>budgetEnforce</code> chooses. <code>warn</code> (the default) only warns; <code>confirm</code> asks you each time (allow once, allow for the session, raise the budget, or stop); "
        "<code>block</code> refuses. A refusal tells Claude which budget is spent and not to work around it.",
    ),
    (
        "Every command becomes a step",
        "Whatever runs, the dashboard reads the script's output into a step. A command Claude Code moved to the background stays running until its result is in. "
        "A refused step shows as blocked under Needs attention.",
    ),
]


def body() -> str:
    p: list[str] = []
    # Connectors first (z-order), then nodes. Row centres y = 160, 316, 452; columns x = 465, 775, 1055.
    p.append(line(265, 160, 345, 160))
    p.append(line(585, 160, 655, 160))
    p.append(label(620, 146, "YES"))
    p.append(line(895, 160, 945, 160))
    p.append(label(920, 146, "YES"))
    p.append(line(465, 220, 465, 276))
    p.append(label(447, 248, "NO"))
    # The second No rejoins the main flow: its own port on the top of the next step, 24 right of the first.
    p.append(path("M775,220 V240 Q775,248 767,248 H497 Q489,248 489,256 V276"))
    p.append(label(632, 234, "NO"))
    p.append(line(575, 316, 665, 316))
    p.append(line(885, 316, 945, 316))
    p.append(line(1055, 356, 1055, 412))
    # A refusal is recorded too: round the right of the run, into the record's right side.
    p.append(path("M1165,160 H1217 Q1225,160 1225,168 V444 Q1225,452 1217,452 H1165"))
    p.append(label(1193, 306, "BLOCKED"))
    p.append(line(945, 452, 885, 452))

    p.append(oval(45, 140, 220, 40, "Claude runs a shell command"))
    p.append(diamond(465, 160, 240, 120, "focal", "Spent budget?", ["and a change in Boomi", "reads never count"]))
    p.append(diamond(775, 160, 240, 120, "backend", "Refused?", ["block mode, or you", "choose Stop"]))
    p.append(node(945, 120, 220, 80, "security", "GATE", "Refuse, tell Claude", ["step recorded as blocked", "told to stop and report"]))
    p.append(node(355, 276, 220, 80, "backend", "STEP", "Note it as running", ["any Companion script;", "other commands pass"]))
    p.append(node(665, 276, 220, 80, "external", "SHELL", "The command runs", ["Claude Code runs it", "may move it to the background"]))
    p.append(node(945, 276, 220, 80, "backend", "READ", "Read its output", ["the script's own result", "ok · failed · still running"]))
    p.append(node(945, 412, 220, 80, "store", "STATE", "Record the step", ["kept in the dashboard's state", "saved for the next session"]))
    p.append(node(665, 412, 220, 80, "backend", "UI", "What you see", ["pane rows · Needs attention", "status line · a toast"]))

    p.append(legend(548, [("focal", "THE BUDGET GATE"), ("a", "FLOW")], step=216))
    return "\n        ".join(p)
