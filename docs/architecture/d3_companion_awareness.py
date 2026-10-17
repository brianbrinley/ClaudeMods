"""D3: how the dashboard stays aware of Companion (architecture, `fit` size: 1280 wide, cropped to its content).

Eight nodes in a 3 x 3 grid, ten connectors, one focal node (the index) and one accent path (only what changed).
Every number sits on the 4px grid, and every connector has its own port.
"""

from lib import label, legend, line, node, path

SLUG = "d3-companion-awareness"
EYEBROW = "Architecture · Companion's docs"
TITLE = "How the dashboard stays aware of Companion"
DESC = (
    "Data flow for the dashboard's awareness of Boomi Companion: installed plugin versions decide whether the index of pointers "
    "to Companion's docs is rebuilt, only for what changed; a prompt's words pick a few sections to read for the model; "
    "and the dashboard's own guide, stamped with a version, is compared with what is installed so a person reviews any drift."
)
VIEWBOX = (0, 64, 1280, 652)

NOTES = [
    (
        "Decoupled",
        "The dashboard keeps no copy of Companion's docs. Its index holds pointers: each doc's headings, key words and a fingerprint. "
        "A weekly Companion upgrade is picked up on its own, and nothing goes stale.",
    ),
    (
        "Aware, cheaply",
        "The index is rebuilt only when a plugin's version changes, and then only the docs whose fingerprint changed. "
        "Between upgrades nothing is read until a prompt needs a few sections.",
    ),
    (
        "Drift is a person's call",
        "What Claude must ask before each kind of work is the dashboard's own guide, stamped with the version it was written for. "
        "When Companion moves on, the Prompt tab says so, and a model drafts edits for you to review. It never changes the guide itself.",
    ),
]


def body() -> str:
    p: list[str] = []
    # Connectors first (z-order), then nodes. Grid: columns x = 80, 520, 960; rows y = 104, 288, 472; nodes 240 x 96.
    p.append(line(200, 288, 200, 200))
    p.append(label(236, 244, "VERSIONS"))
    p.append(line(320, 152, 520, 152, "a-accent"))
    p.append(label(420, 138, "CHANGED ONLY"))
    p.append(line(640, 200, 640, 288))
    p.append(label(690, 244, "WHERE TO READ"))
    p.append(line(320, 336, 520, 336))
    p.append(label(420, 322, "READ SECTIONS"))
    p.append(line(760, 336, 960, 336))
    p.append(label(860, 322, "GUIDANCE"))
    p.append(line(1080, 472, 1080, 384))
    p.append(label(1128, 428, "WHAT IT ASKS"))
    p.append(line(200, 384, 200, 472))
    p.append(label(240, 428, "INSTALLED"))
    p.append(line(320, 520, 520, 520))
    p.append(label(420, 506, "DRIFT + LOG"))
    p.append(line(760, 520, 960, 520))
    p.append(label(860, 506, "EDITS + STAMP"))
    # The guide's stamp comes back round, under the reviewer, to the drift check.
    p.append(path("M1080,568 V596 Q1080,604 1072,604 H208 Q200,604 200,596 V568"))
    p.append(label(640, 590, "THE STAMP"))

    p.append(node(80, 104, 240, 96, "backend", "CHECK", "Did a version change?", ["installed versions vs the index", "nothing read if none moved"]))
    p.append(node(520, 104, 240, 96, "focal", "STORE", "Pointer index", ["headings + key words per doc", "a fingerprint each, no text"]))
    p.append(node(80, 288, 240, 96, "external", "ON DISK", "Companion plugins", ["bc-integration and the others", "docs, a CHANGELOG, a version"]))
    p.append(node(520, 288, 240, 96, "backend", "MATCH", "Retrieval", ["your prompt → the best sections", "6 at most, 10,000 characters"]))
    p.append(node(960, 288, 240, 96, "external", "MODEL", "Prompt model", ["writes the upgrade and why", "the tab names plugin + version"]))
    p.append(node(960, 472, 240, 96, "backend", "OURS", "The guide", ["what Claude asks, per plugin", "stamped with a version"]))
    p.append(node(80, 472, 240, 96, "backend", "CHECK", "Drift check", ["stamp vs installed version", "the tab flags it, shows the log"]))
    p.append(node(520, 472, 240, 96, "input", "REVIEW", "You", ["read the model's draft", "edit the guide, set the stamp"]))

    p.append(legend(652, [("focal", "THE INDEX"), ("a", "DATA FLOW"), ("a-accent", "ONLY WHAT CHANGED")], step=216))
    return "\n        ".join(p)
