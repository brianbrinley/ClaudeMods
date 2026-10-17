"""D5: how the repository's mods and Boomi Companion fit together (architecture, `fit` size: 1280 wide, cropped to its content).

Six nodes, eight connectors. The dashboard (focal) sits on top and reads; the runtime mod, Companion and the set-aside
standards mod sit under it; the platform sits under them. Every number sits on the 4px grid.
"""

from lib import label, legend, line, node

SLUG = "d5-mods"
EYEBROW = "Architecture · the repository's mods"
TITLE = "How the mods and Companion fit together"
DESC = (
    "Architecture of the repository's mods with Boomi Companion: boomi-runtime provisions a temporary Boomi runtime and writes "
    "Companion's environment file, Companion builds and tests on it through the Boomi platform, and boomi-dashboard reads the runtime mod's state "
    "and watches Companion's steps; boomi-standards is set aside, and the dashboard already reads its state for when it returns."
)
VIEWBOX = (0, 64, 1280, 592)

NOTES = [
    (
        "Two mods, one hand-off",
        "boomi-runtime gives a session its own temporary runtime and writes Companion's <code>.env</code>, so Boomi Companion builds and tests on it. "
        "The dashboard doesn't need the runtime mod, but shows its state when it's there.",
    ),
    (
        "The dashboard only reads",
        "It reads the other mods' state and never writes it: only a value's owner writes it. "
        "It watches Companion through the shell commands Claude runs, not through any API of Companion's.",
    ),
    (
        "A mod set aside",
        "boomi-standards held Companion's components to a team's standards before they reached Boomi. It's set aside and tracked in <code>IDEAS.md</code>. "
        "The dashboard already reads its state, so it will show what was blocked once the mod is back.",
    ),
]


def body() -> str:
    p: list[str] = []
    # Connectors first (z-order), then nodes. Columns x = 60, 370, 680, 990 (cx 170, 480, 790, 1100), rows y = 104, 288, 472.
    p.append(line(280, 336, 370, 336))
    p.append(label(325, 322, "WRITES"))
    p.append(line(590, 336, 680, 336))
    p.append(label(635, 322, "READ BY"))
    p.append(line(990, 336, 900, 336, dashed=True))
    p.append(label(945, 322, "GUARDS"))
    # State and steps flow up into the dashboard, each on its own port along its bottom edge.
    p.append(line(170, 288, 170, 192))
    p.append(label(218, 240, "RUNTIME STATE"))
    p.append(line(790, 288, 790, 192))
    p.append(label(830, 240, "ITS STEPS"))
    p.append(line(1100, 288, 1100, 192, dashed=True))
    p.append(label(1134, 240, "ACTIVITY"))
    # Down to the platform.
    p.append(line(170, 384, 170, 472, "a-link"))
    p.append(label(210, 428, "PROVISIONS"))
    p.append(line(790, 384, 790, 472, "a-link"))
    p.append(label(842, 428, "BUILDS + TESTS"))

    p.append(node(100, 104, 1040, 88, "focal", "MOD", "boomi-dashboard", ["watches Companion's steps, cost and budget", "polls the platform, read-only"]))
    p.append(node(60, 288, 220, 96, "backend", "MOD", "boomi-runtime", ["a temporary runtime", "/boomi up · smoke · down"]))
    p.append(node(370, 288, 220, 96, "store", "FILE", "Companion's .env", ["the environment to build on", "runtime writes, Companion reads"]))
    p.append(node(680, 288, 220, 96, "external", "PLUGIN", "Boomi Companion", ["bc-integration and the others", "scripts build, deploy, test"]))
    p.append(node(990, 288, 220, 96, "optional", "SET ASIDE", "boomi-standards", ["holds components to standards", "back soon (IDEAS.md)"]))
    p.append(node(60, 472, 880, 80, "external", "API", "Boomi platform", ["the runtime's TEST environment, and your account"]))

    p.append(legend(608, [("focal", "THE DASHBOARD"), ("a", "HANDS OVER · READS"), ("a-link", "BOOMI API"), ("dash", "SET ASIDE · OPTIONAL")], step=216))
    return "\n        ".join(p)
