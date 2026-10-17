"""D2: what happens to a prompt you type (sequence, `fit` size: 1280 wide, cropped to its content).

Five lifelines, ten messages and a self-message, one `alt` fragment, one accent message.
Time runs down. Returns are dashed with a filled head. Every number sits on the 4px grid.
"""

from lib import bar, divider, frame, guard, label, lifeline, line, node, self_loop

SLUG = "d2-prompt-lifecycle"
EYEBROW = "Sequence · the prompt upgrade"
TITLE = "What happens to a prompt you type"
DESC = (
    "Sequence of a prompt in a Companion session: a suggestion taken with Tab passes straight through; any other Boomi prompt "
    "is checked by rules, shown with tips and a quick upgrade in the Prompt tab and held, while a model writes a better upgrade "
    "in the background and swaps it in, and the upgrade you send goes in unchecked."
)
VIEWBOX = (0, 48, 1280, 732)

NOTES = [
    (
        "Quick first, better second",
        "The rules check every Boomi prompt, with no model call, so a quick upgrade is ready at once. "
        "A model then writes a better one in the background and swaps it in, with a few notes on why it changed.",
    ),
    (
        "Held, not blocked",
        "In <code>confirm</code> mode (the default) the prompt waits in the Prompt tab: send it as typed, send the upgrade, or edit it. "
        "Claude sees nothing until you choose. A suggestion taken with Tab skips all of this.",
    ),
    (
        "Never checked twice",
        "What the dashboard sends from the Prompt tab goes in as your own words, unchecked, so it can't loop back. "
        "A secret in a prompt is asked about first, unless the checks are off.",
    ),
]

YOU, CC, HOOKS, TAB, MODEL = 160, 400, 640, 880, 1120


def body() -> str:
    p: list[str] = []
    # The fragment's frame first, then lifelines, bars, messages, and the actors on top of the lifelines' tops.
    p.append(frame(332, 252, 828, 344, "ALT"))
    p.append(guard(412, 280, "[taken with Tab, sent as it was]"))
    p.append(divider(340, 1152, 340))
    p.append(guard(412, 356, "[any other Boomi prompt]"))

    for cx in (YOU, CC, HOOKS, TAB, MODEL):
        p.append(lifeline(cx, 152, 704))
    p.append(bar(CC, 192, 472))
    p.append(bar(HOOKS, 228, 472))
    p.append(bar(HOOKS, 492, 580))
    p.append(bar(MODEL, 500, 540))

    # Messages, top to bottom. Calls solid, returns dashed, the one headline message in accent.
    p.append(line(YOU, 192, CC - 4, 192))
    p.append(label(278, 178, "SUBMIT"))
    p.append(line(CC + 4, 228, HOOKS - 4, 228))
    p.append(label(520, 214, "PROMPT.SUBMIT"))

    p.append(line(HOOKS - 4, 316, CC + 4, 316, dashed=True))
    p.append(label(520, 302, "PASS THROUGH"))

    p.append(self_loop(HOOKS, 380, "RULE CHECKS"))
    p.append(line(HOOKS + 4, 428, TAB, 428))
    p.append(label(760, 414, "TIPS + UPGRADE"))
    p.append(line(HOOKS - 4, 464, CC + 4, 464, dashed=True))
    p.append(label(520, 450, "DROP · HELD"))

    p.append(guard(652, 486, "a timer starts it, with Companion's guidance"))
    p.append(line(HOOKS + 4, 500, MODEL - 4, 500))
    p.append(label(1000, 486, "REWRITE"))
    p.append(line(MODEL - 4, 536, HOOKS + 4, 536, dashed=True))
    p.append(label(1000, 522, "UPGRADE + WHY"))
    p.append(line(HOOKS + 4, 572, TAB, 572))
    p.append(label(760, 558, "SWAP IN"))

    p.append(line(YOU, 644, TAB, 644))
    p.append(label(520, 630, "SEND UPGRADE"))
    p.append(line(TAB, 680, CC, 680, "a-accent"))
    p.append(label(760, 666, "SENT AS YOU"))

    # Actors.
    p.append(node(YOU - 88, 88, 176, 64, "input", "INPUT", "You", ["the prompt box"]))
    p.append(node(CC - 88, 88, 176, 64, "backend", "HOST", "Claude Code", ["raises prompt.submit"]))
    p.append(node(HOOKS - 88, 88, 176, 64, "focal", "MOD", "Hooks module", ["register.tsx"]))
    p.append(node(TAB - 88, 88, 176, 64, "backend", "UI", "Prompt tab", ["in the pane's place"]))
    p.append(node(MODEL - 88, 88, 176, 64, "external", "MODEL", "Prompt model", ["haiku, in the background"]))

    # Legend: a strip at the bottom, never inside the figure.
    from lib import legend

    p.append(legend(740, [("focal", "THE MOD"), ("a", "CALL"), ("dash", "RETURN"), ("a-accent", "THE UPGRADE IS SENT")], step=216))
    return "\n        ".join(p)
