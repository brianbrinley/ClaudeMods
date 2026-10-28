# Changelog

`/bc-dashboard upgrade` shows the entries between your version and the latest. Versions before 0.22.0 are summarized from their release commits.

## 0.62.0

- **Production read-only for Companion, opt-in.** A new setting, `envCheck` (`/bc-dashboard config`, Budget), is off by default. `check` reads the environment that Companion's `.env` points at, by name and classification, from Boomi when the session starts, and keeps only that. `enforce` also refuses Companion deploys, undeploys and test runs to that environment unless it is classified TEST or DEV, and refuses when the environment isn't in Boomi's list or can't be read. The environment is read again for each command that could change it, since the `.env` can change during a session. Raw Platform API writes (curl and the like) count as changes too, and a command that also names the `.env` (or the configured `envFile`) is refused. A command that runs a script of its own, not Companion's, is refused, since the check can't see into it. Any error in the check refuses the command. Pushes made through Companion are allowed. The refusal says why and tells Claude to stop. The pane's guardrail lines say what the check is doing: the environment and its classification, or why it isn't checking.

## 0.61.1

- **Edit in the prompt box puts the upgrade there.** It refilled your typed prompt, which a held prompt's box already holds, so only the cursor came back. It now puts the upgrade (the one the Prompt tab shows) in the box to edit, and the held prompt is let go, nothing sent.

## 0.61.0

- **The dashboard offers to turn on Companion's activity log.** At the start of a session in a Companion folder, where the `.env` doesn't mention the log, it asks whether to add `BOOMI_COMPANION_LOG_ACTIVITY=1`: **Yes, add it**, **Not now** (asks again next session) or **Never ask again**. While the log is off, the pane says so, with **Turn it on** and **Don't ask** buttons.
- **The dashboard makes the change, not Claude.** It appends that one line and leaves every other byte of the file alone (line endings kept), reads it back to check, and never shows or keeps another line of it, so `.env` stays out of the conversation. If the write is refused, it shows the exact line and the file to put it in, with a one-line `echo` for a terminal. Companion reads `.env` on each script run, so no restart is needed. Only the value `1` turns the log on; `true` doesn't, and `on` sets such a line to `1`.
- **`/bc-dashboard activity-log [on|off|status|never]`.** `off` asks first and removes only that line; `never` stops the offer.
- **`activityLogPrompt` setting.** `ask` (default) or `never`, in `/config` under Data and reports.
- **Closing out is never held.** A prompt that ends the session is never tipped, held or rewritten: `/exit`, `/quit`, `/clear` and `/handoff` let go of a prompt the dashboard was holding, and a wrap-up in words ("write a handoff for the Orders Sync process", "wrap it up") goes straight through even when it names a process. A secret in one still asks.
- **Exosphere screenshots.** The README's pane pictures show the Exosphere light and dark themes, redrawn from the test kit's sample session with `scripts/pane-shots.sh`.

## 0.60.0

- **A test that runs long is no longer shown as "result not waited for".** Claude Code moves a Bash command to the background when it outlasts its timeout (120 seconds by default), and a test that polls for a slow process does. What comes back to the dashboard is then only that notice, with none of the script's output, so a test that was still polling looked like one submitted with `--no-wait`, and stayed that way. Such a step now shows `◐ testing…` and `Testing X… (running in the background)`.
- **The result is read from the output file.** Claude Code writes the background command's output to a file and names it in the notice. The dashboard checks that file every five seconds, and when the script's final line is there (a test's status, or an `ERROR:`), the step settles as if the command had returned it: `✗ test ERROR` and **Needs attention** for a failure, `test passed` for a pass, with a toast as usual. Other Companion scripts that run long (a deploy, a push) settle the same way.
- **Only Claude Code's own notice is followed.** A command's output is not trusted text, so the dashboard reads an output file only when the notice's task ID matches the `backgroundTaskId` in the result's own field (which a script's printed text can't set), and the file is an absolute path with no `..` that ends in `/tasks/<that ID>.output`. A script that merely prints the same words gets no file read.
- **Giving up is said plainly.** If no result appears within 30 minutes (a test polls for ten at most), the step says `test result not seen` instead of claiming a submission.

## 0.59.0

- **You can see the upgrade being written.** While the model rewrites a prompt, the Prompt tab's upgrade card says `UPGRADED ◐ HAIKU IS WRITING A BETTER ONE…` with a spinner that turns, a line under the cards says the quick version above stays until the new one arrives, and the **Upgrade with a model** button turns into `◐ Rewriting…`. The dashboard pane's prompt-tips row adds `· ◐ upgrading it…`. All of it clears when the upgrade lands, or when the model fails (the checks' upgrade stays). The spinner ticks only while a rewrite runs, so nothing is redrawn the rest of the time.

## 0.58.0

- **Suggestions you take aren't checked.** When the prompt box shows a dim suggestion (Claude's own guess after a turn, or the dashboard's next step) and you take it with Tab and send it as it was, it isn't your wording: no tips, no hold, no rewrite, no model call. Edited suggestions are checked as usual, a secret in one is still asked about, and each suggestion is taken once. Claude Code doesn't say where a prompt came from, so the dashboard matches the words.
- **`promptSuggested` setting.** `skip` (default) or `check`, which treats a taken suggestion like any other prompt.
- **Counted.** `/bc-dashboard prompt` and the session report say how many of Claude's suggestions were taken as they were.

## 0.57.0

- **The rewrite reads all of Companion's docs.** It was reading one file, `BOOMI_THINKING.md`: the `guides/`, `steps/`, `components/` and `platform_entities/` folders (about 110 docs in bc-integration 1.0.83) were never opened, and the other Companion plugins' docs were not read at all. It now reads every installed Companion plugin's reference docs.
- **A bigger, smarter budget.** Up to 6 sections, each cut to the paragraphs that best match your prompt (not the first 1,200 characters), 10,000 characters in all, with a doc's file name counting toward a match.
- **An index of pointers, kept between sessions.** Each doc's fingerprint, section headings and key words, never Companion's text, so the text can't go stale. It's rebuilt when a Companion plugin's version changes, and only changed docs are parsed again.
- **Guided by Companion's version.** The Prompt tab says which plugins and versions the rewrite read.
- **A guide that notices Companion upgrades.** The dashboard's list of what Claude asks is now tagged by plugin and stamped with the version it was written for. The tab flags drift; `/bc-dashboard prompt guide` shows what changed in Companion's changelog since; `/bc-dashboard prompt guide refresh` has the model draft the edits, each tied to a changelog line or doc heading, for you to review. It never changes anything itself.

## 0.56.0

- **A better prompt upgrade, written by a model.** When a prompt gets tips, the checks' upgrade shows at once and, a moment later, the prompt model (`promptModel`, haiku by default) writes a better one in the background as the next try. It polishes your request, fills in what's vague from the session, and turns what Claude would have stopped to ask into `[decide: which environment - Dev?]` placeholders, with a suggested default only where the session or Companion's guidance supports one. It still never invents names or adds work you didn't ask for.
- **Why it changed.** The Prompt tab and `/bc-dashboard prompt` list up to three notes under the upgrade (`Named the environment: Claude can't deploy without one`), so each upgrade teaches what a good prompt holds.
- **`promptRewrite` setting.** `auto` (the default) rewrites by itself, a few cents at most per prompt; `manual` rewrites only when you press **Upgrade with a model** or run `/bc-dashboard prompt upgrade`. It never fills the prompt box on its own, and a prompt whose only tip is a secret is never sent to a model.
- **Ready for your own rules.** What Claude asks before each kind of work is one table (`TASK_QUESTIONS`), and the model's instructions take a list of extra guidance (`rewriteSystem`), so a team's own niche can be added later without touching the rest. Nothing reads such a list yet.

## 0.55.0

- **One theme picker, at the bottom of the pane.** The six theme buttons that overflowed the header are gone. Under the `session` line is a single **🎨 Theme** button showing the current theme; it opens a list of all six, each with an emoji and a word (`🏢 Exosphere · 🌙 Dark`, `🦩 Whimsical · ☀️ Light`, `🌓 Auto`, `⌨️ Terminal`), with ◆ on the current one. The list closes on a pick. `/config` and `/bc-dashboard theme` are unchanged.
- **Buttons and the theme list read in dark mode.** A pane button's label took the terminal's own colors, so it was black on a dark pane. Labels, the theme button and its list now use the pane's accent color on its background, in every theme.

## 0.54.0

- **Exosphere is the default theme.** The pane and banner now take Boomi's Exosphere colors, and **Auto** follows your system's light or dark (macOS; where it can't be read, light). The theme list is now `auto`, `exosphere-light`, `exosphere-dark`, `whimsical-light`, `whimsical-dark` and `terminal`: the buttons, `/bc-dashboard theme` and `/config` all take them. The Art Deco look is **Whimsical** now, light and dark, with its colors and the flamingo unchanged.
- **A `logo` setting instead of the flamingo ones.** In Exosphere the mark is the Boomi logo (a picture in kitty and Ghostty, nothing elsewhere); in Whimsical it is the flamingo. `logo` turns it off in either. It replaces `flamingo`, `bandIcon` and the diamond: a banner icon of `flamingo` keeps you in Whimsical, `flamingo` off keeps the mark off, and anyone who chose the diamond now gets the logo. `bandAnimation` stays, for the Whimsical flamingo.
- **Your saved theme carries over.** `day` and `night` are `whimsical-light` and `whimsical-dark`, in `/config`, in the dashboard's own store and in `/bc-dashboard theme day`. The old setting names stay listed in `/config` for now so a saved value isn't dropped; they are read once and no longer shown in `/bc-dashboard config`.
- **The web report wears the logo.** `report html` puts the Boomi logo, drawn from its own vector, in the masthead and footer; `--style expressive` keeps the flamingo. The report was already Exosphere by default and follows the system's light and dark.
- **Status colors follow the theme.** The pane's status icons use Exosphere's success, warning and danger colors in the Exosphere themes and Valence's fixed ones in Whimsical, always with an icon and a label.

## 0.53.1

- **No pixel-art logo where a terminal can't draw pictures.** The navy-and-coral block that stood in for Boomi's logo in Apple Terminal, iTerm2 and the VS Code terminal is gone: there the banner is just the coral `BC Dashboard` label. In kitty and Ghostty it's still the Boomi logo itself. Takes effect in the next session.

## 0.53.0

- **Boomi's logo in the banner.** The default banner icon is now two rows tall at the left of the banner. In kitty and Ghostty it's the Boomi logo itself, a picture. Elsewhere (Apple Terminal, iTerm2, the VS Code terminal), where a terminal can't draw one, it's a small badge in Boomi's colors: a navy disc with a coral ring, in half-block characters. It replaces 0.52.0's `b•`, and doesn't animate. The flamingo stays in the pane, and `/bc-dashboard config bandIcon flamingo` brings it back to the banner. Takes effect in the next session.

## 0.52.0

- **Boomi's b in the banner.** The mark before "BC Dashboard" is now Boomi's b, white on Boomi navy, with its coral dot, which twinkles for a second in every five as the flamingo's sparkle did. It's the new default; the flamingo stays in the pane, and `/bc-dashboard config bandIcon flamingo` brings it back to the banner. The `bandAnimation` setting now covers both icons. Takes effect in the next session.

## 0.51.1

- **Sending a held prompt clears the prompt box.** When the dashboard held a flagged prompt, **Send as typed** and **Send the upgrade** left the original text sitting in the prompt box, in the way of your next prompt. Sending now clears it, unless you've already started typing something else.

## 0.51.0

- **A nudge toward /handoff on the way out.** The first `/exit`, `/quit` or `/clear` of a session that did work says what `/handoff` saves (a summary for the next session, in `~/handoffs/`) and waits; typing the command again goes through. Running `/handoff` first skips the nudge. The `handoffNudge` setting (also in `/bc-dashboard config`) turns it off. Ctrl+C and Ctrl+D leave without it.

## 0.50.0

- **A flamingo in the banner.** The mark before "BC Dashboard" is now the flamingo, and it flashes a sparkle for a second in every five. The `bandAnimation` setting turns the animation off.
- **Choose the banner icon.** The `bandIcon` setting (also in `/bc-dashboard config`) picks `flamingo`, `boomi` (a round dot in Boomi's coral) or `diamond`, the old mark. Both settings take effect in the next session.

## 0.49.2

- **No GitHub link in the pane.** The footer shows the session ID and the Report button only. The HTML report no longer names the repository either, so its title is the Boomi account, else the folder. The Markdown report still has its `Repository:` line.

## 0.49.1

- **A Report button in the pane.** A quiet **Report ↗** button sits at the right of the footer, beside the session ID. It makes the same web page as `/bc-dashboard report html` (asking which steps to cover when earlier sessions are kept) and says where it saved it.

## 0.49.0

- **When your Claude budget resets, and where the month leads.** The dashboard keeps the last dollar figure of each day with the `/usage` reading and shows, under the monthly Claude budget: `Claude pace: on pace for $811 (74%) by the reset in 15d 4h` (or, at a pace that would pass the limit, when it's used up, before the reset) and `Claude spend: $30 today · $26/day this month`. The reset is 00:00 UTC on the 1st, which Claude Code's rate-limit event and Claude Desktop confirmed for this account (Oct 31, 8:00 PM EDT). The pace is the month's average so far carried to the reset, and waits for a tenth of the month. They're readings and estimates, never a spent budget: they don't count for `budgetEnforce`. In the pane, `/bc-dashboard text`, and the Markdown and HTML reports.

## 0.48.1

- **The budgets in the reports and the text.** The HTML report labelled the monthly Claude budget "Companion's share (Claude budget)" and Companion's share of all usage "Companion's share (Companion)". They now read **Your Claude budget**, **Companion, all your usage** and **What drove this week**. A spent monthly Claude budget under `budgetEnforce` is named as that, not as a Companion share. `/bc-dashboard text` and the Markdown report, which showed none of these, now list the monthly Claude budget in dollars, Companion's share and the week's habit.

## 0.48.0

- **Your monthly Claude budget, in dollars, automatically.** The `/usage` run now uses `--output-format stream-json --verbose`, whose `usage_report` carries the account's monthly budget and what's used, the figures the interactive `/usage` shows. BUDGET reads `Claude budget: $380 of $1100 this month`, measured, with a toast at 80% and when it's used up, and it counts for `budgetEnforce`. It's the account's figure (other devices and claude.ai included) and needs extra usage on for the account. Amounts arrive in cents and anything not in dollars, off or malformed is left out. `seatBudgetUsd` is now only for logins that report a spend limit in percent. This corrects 0.47.0, which said the credits weren't available to mods.

## 0.47.1

- **A lighter /usage read.** The run now adds `--safe-mode`, so it skips your hooks, plugins and MCP servers: the same breakdown in about half the time (5 s against 9 s here), and none of your SessionStart hooks firing every 15 minutes. A Claude Code that doesn't know the flag gets the plain run. Companion's share now reads `≥20%`, since Claude Code lists only its top plugins. And if `/usage` is reworded so none of it can be read, BUDGET says so instead of going quiet. The reading is also kept in the store, so several sessions on this machine share one run per 15 minutes instead of one each.

## 0.47.0

- **Companion's share of all your usage.** Every 15 minutes the dashboard runs `claude -p "/usage" --output-format json --no-session-persistence` (no model call, no session kept) and reads Claude Code's own breakdown. BUDGET then shows `Companion: 20% of your usage today · 18% this week` (the `bc-*` plugins added up) and the habit behind most of the week's usage, such as `44% of your usage was at >150k context`. It's Claude Code's estimate from this machine's sessions. Off a subscription there's no breakdown and nothing shows; `usageBreakdown` turns it off. It's information only: the `companionShare` budget still measures a share of your weekly limit.
- **Your assigned Claude budget.** A new setting, `seatBudgetUsd`, takes the budget your admin gave you. With a spend limit Claude Code reports, BUDGET shows it in dollars (`Claude budget: $84 of $200`), warns at 80% and counts for `budgetEnforce`; without one, it says this login doesn't report how much is used. The usage credits the interactive `/usage` shows aren't available to mods, so this is the way to see dollars.

## 0.46.0

- **A nudge for a look around.** A prompt like "use boomi companion to check out my account" names nothing to find, so Claude guesses what to list. It now gets a tip, "look-around: say what you want to find out (deployed processes, failed runs, a folder's components, runtimes)", and the upgrade a **What to find out** line. It only nudges: reading changes nothing in Boomi, so `confirm` doesn't hold a prompt for this tip alone. `promptSkip aim` turns it off.
- **Fewer false tips.** "Check out the failed executions" no longer reads as a request to fix something, and "the deployed processes" no longer as a deploy with no environment: the fix tip needs a fix word or something still failing, and the deploy tip needs deploying as the thing to do.
- **Past Companion sessions fold up.** The section starts folded to its totals and a count, to leave the pane's room to this session. **▸ Show** lists the sessions with **Review** and **Copy**, **▾ Hide** folds them again, and the choice is kept for later sessions.

## 0.45.1

- **A note for the rewrite shows once.** The field wraps a long note itself now that its label has a line of its own, so the copy drawn under it (added in 0.44.0, when the field cut long notes off) showed the note twice. The copy is gone; each try still says the note it followed.

## 0.45.0

- **The Prompt tab fits the pane.** A long prompt or upgrade pushed the buttons off the bottom. The cards now take only the rows the pane has, ending with `▼ 14 more lines` and **Show all**, so the buttons stay in view. **Show all** draws them whole and says `▼ Shown in full: scroll with ↓ or the wheel`, with **Jump to the buttons** and **Fit to the pane**.
- **A rewrite no longer adds work you didn't ask for.** It had read Companion's guidance as requirements (an upsert, a write-back, a subprocess). It's now told never to add features, steps or logic, and that the guidance and components only decide what to ask you and which names fit. It also gets only the facts a tip needs: the last failure only for a fix, the environment only for a deploy, the component only for "it". An unrelated failure from an earlier session no longer creeps in.

## 0.44.0

- **Confirm is now the default for prompt tips.** A Boomi prompt that leaves something out is held, and Claude doesn't see it until you choose **Send the upgrade**, **Send as typed**, **Edit in the prompt box** or **Discard** in the Prompt tab or the banner. This changes what happens if you never set `promptCheck`: run `/bc-dashboard config promptCheck suggest` to let prompts through with tips, as before.
- **A long note for the rewrite shows in full.** The note field shows one line, so a longer note was cut off with `…`. It's now drawn whole, wrapped, under the field, and each try says the note it followed. The label lost its doubled colon.

## 0.43.0

- **Confirm holds the prompt.** With `promptCheck` at `confirm`, a flagged prompt is held: Claude doesn't see it until you choose **Send the upgrade**, **Send as typed**, **Edit in the prompt box** or **Discard**, in the Prompt tab or the banner. The status line says `⏸ prompt held`. A sent prompt is never checked again. Where the tab can't show, the question asks as before.
- **A gentle nudge above the prompt box.** The banner says `◐ Boomi Dashboard suggests a clearer prompt · 4 tips`, with **Use it**, **See it** and **✕**, until your next prompt.
- **The Prompt tab comes to the front.** Claude Code can't bring a tab forward, so after **Dismiss** the **Prompt tips** button opened the tab behind the dashboard. The dashboard pane now steps aside for the tab and comes back with **◀ Dashboard**, **Dismiss**, or a prompt with nothing to add.
- **The buttons sit under the upgrade,** where your eye ends up, and what the upgrade doesn't know is a **Details** list of `[placeholders]` instead of sentences tacked on the end.
- **Regenerate, with a note.** A rewrite now reads this folder's components whose names match the prompt and the sections of Companion's reference docs that match it, besides the prompt and the session's facts. Type a note (`shorter`, `ask for a listener`) to steer the next try; every try is kept, and **◀** **▶** step through them. `/bc-dashboard prompt upgrade <note>` does the same.

## 0.42.1

- **After `/clear`, the dashboard sets the new session up.** A `/clear` goes on under a new session ID without the start the dashboard set itself up in, so the new session didn't bring back the folder's earlier steps or know it was a Companion folder. Three things went wrong: prompt tips skipped every prompt, `report html` stopped offering every session, and the first save wrote over the folder's saved steps. The dashboard now sets up again the first time it sees a new session ID, before anything is saved. Steps written over before this fix aren't recoverable; past sessions in Claude Code's transcripts still are.
- **The Prompt tab says whose it is:** **Boomi Dashboard Prompt tips**, in its tab and its title.
- **Clearer wording** for a new process's tip: "doesn't say the source and target, what starts it or the data format".

## 0.42.0

- **The Prompt tab.** A prompt with tips opens a second pane beside the dashboard, so Claude Code's tab row shows **Prompt · 3 tips** next to it, like a browser's tabs. The tab has **Use the upgrade**, **Upgrade with a model**, **Copy** and **Dismiss** at the top, the tips under them, and your prompt beside the upgrade. It closes when your next prompt has nothing to add, and the dashboard pane's **Prompt tab** button brings it back. `promptView` is `auto` (default), `manual` (only when you ask) or `off`. See [Prompt tips](README.md#prompt-tips).

## 0.41.0

- **Prompt tips.** Each prompt you type in a Companion folder is checked for what Boomi work needs and it leaves out: which component "it" is, the environment for a deploy, the error for a fix, test data, a new process's source, trigger and format, a map's profiles, production named, or several big steps at once. Each tip names the session's likely answer, such as the component you worked on last or the last failed test's execution ID, and an upgraded prompt fills those in, leaving a `[placeholder]` for anything it doesn't know. The checks make no model call. See [Prompt tips](README.md#prompt-tips).
  - The status line says `◐ 3 prompt tips: /bc-dashboard prompt`. `/bc-dashboard prompt` shows them and the upgrade, `prompt use` puts the upgrade in the prompt box, and `prompt upgrade` has a model (`promptModel`, `haiku` by default) rewrite it.
  - `promptCheck` is `suggest` by default: the prompt goes to Claude as typed. `confirm` asks first; `off` turns it all off. `promptSkip` leaves out checks you don't want.
  - **New: a prompt with a password or token in it asks before it's sent,** even in `suggest`, and closing the question sends it masked. Set `promptCheck` to `off` to stop that.
  - The session report counts prompts checked, those with tips, and tips followed.

## 0.40.0

- **Platform changes in the report.** `/bc-dashboard report` and `report html` have a **Platform changes** section: every change the session made in Boomi, oldest first. That covers creates, saves, deploys, undeploys and tests; folders, branches and extensions created, deleted or set; Event Streams setup; web service calls; and the other plugins' changes (Data Hub, BDI, Agentstudio, connectors, Marketplace installs). Steps now keep the subcommand of bc-integration's branch, extensions and Event Streams scripts, so a `branch create` is listed and a `branch list` isn't. Each shows when it ran, what it did, how it went (with its icon and label) and the ID it left: the version, package, execution or run. A change the budget gate refused shows as blocked and not run.
- **Overrides on the change they let through.** A change allowed past a spent budget says so in its row: allowed once, or allowed for the session, and which budget was spent. **Budget overrides** still lists each choice.
- **Copy or save the changes.** The HTML report has **Copy for a spreadsheet**, **Copy as CSV** and **Save as CSV** above the changes, as it has for Components. The file is `boomi-changes-<date>.csv`.

## 0.39.6

- **`/bc-dashboard config budget warn` no longer starts the Budget questions.** A group's name with a value after it (`budget warn`) went through the whole group a question at a time and dropped the value, so answers there could change settings you didn't mean to. It now saves nothing and says which setting takes the value: `Did you mean /bc-dashboard config budgetEnforce warn?`. `/bc-dashboard config budget` on its own still goes through the group.

## 0.39.5

- **Companion's share says why it can't be measured.** With `companionShare` set on a Claude login that reports no weekly limit, the BUDGET gauge and the HTML report showed the share as ✓ healthy at 0%, "needs a Claude seat", even on a seat. It now shows as **not measured**, with no status or percent, and says this login reports no weekly limit. `companionMonthlyUsd` budgets Companion on any login.

## 0.39.4

- **A refused test keeps its process's name.** When a test's process ID came from the shell and the atom refused to run it (HTTP 400, "cannot be executed on atom"), the step read "Test of a component failed". It now takes the name the process already has in this session, from the ID the script printed, and **Run again** is offered for it.

## 0.39.3

- **No more components named `$`.** When Claude passed a process ID through the shell (`PID=$(…) && boomi-test-execute.sh --process-id "$PID"`, or `--process-id $(…)`), the dashboard took a bare `$` as the ID and showed the process as `$` under **Components this session** and in the steps. An ID the shell fills in is no longer read from the command: the script's output names the component.
- **Run again works for those tests too.** It repeated the command as written, passing `$` or `"$PID"` as the process ID. It now uses the ID the test's output gave, and isn't offered when the test can't be repeated as it ran.

## 0.39.2

- **Budget enforcement checked against every Companion plugin.** I went through every script and subcommand in the current releases of all six plugins (bc-integration 1.0.83, bc-marketplace 0.2.10, bc-datahub 0.2.12, bc-bdi 0.2.5, bc-agentstudio 0.1.42 and bc-connectordev 0.0.50): 185 in all.
  - **Now stopped:** Event Streams' `provision-connection` (it creates a connection component) and `rest-produce` (it sends a message to a topic).
  - **No longer stopped,** since they change nothing in Boomi: a connector's descriptor lint, doctor, init and `version validate`; a Marketplace bundle's supporting materials; Data Hub's `model pull` and `source pull` into a working file; and `bdi-flow cancel`, which only stops a run.
  - A new test pins all 185 (whether each is a step, and whether a spent budget stops it), so a Companion release that changes them fails a test instead of slipping through.

## 0.39.1

- **A quieter theme switch in the HTML report.** The bold **Light** and **Dark** buttons are replaced by one round icon button, as on the docs site. It shows a moon to switch to dark and a sun to switch back, and its label says which way it switches. Your choice is still kept. **Print or save as PDF** is lighter to match.

## 0.39.0

- **Budget enforcement, opt in: a spent budget can now really stop Companion.** A new setting, `budgetEnforce`, takes one of three values:
  - `warn` (the default, no change for anyone today) only warns;
  - `confirm` asks you before each Companion change once any budget you set is spent: **Allow this one**, **Allow for the rest of this session**, **Raise the budget** or **Stop**;
  - `block` refuses those changes outright.

  The dashboard stops the command before it runs, so Companion and Boomi never see it. Companion's own files aren't changed.
- **What's gated:** creates, pushes, deploys, undeploys and test executions; bc-integration's other changing scripts; the other plugins' changing subcommands; changing calls straight to the Platform API (PUT, PATCH, DELETE, or a POST that isn't a query); and local scripts that wrap any of these. Reads, the dashboard's own tools, and **Why?** and **Run again** are never stopped. A change already running finishes.
- **`budgetGrace`** (percent, default 0) starts enforcement past 100%.
- **You see it:**
  - refused steps read `⚠ Blocked by budget`;
  - the status line and the banner say `⛔ budget reached, Companion changes paused`, with one toast as it starts;
  - overrides you grant are recorded as steps and listed under **Budget overrides** in both reports.
- **Claude is told:** once with your next prompt (and again when the state changes), and in every refusal, with which budget is spent and by how much, to stop and report, and not to work around it.
- `/bc-dashboard config budget` asks about both new settings.

## 0.38.0

- **Take the components elsewhere, with every ID.** Above the HTML report's Components table:
  - **Copy for a spreadsheet** copies tab-separated text that pastes straight into cells;
  - **Copy as CSV** copies the same table as CSV;
  - **Save as CSV** downloads it as a file, which Excel opens with its characters intact.

  Each row has the component's name, type, folder, ID and version in Boomi; its last deploy (how it went, when, and the package ID); its last test (how it went, when, and the execution ID); its cost; and its link in Boomi.
- **`/bc-dashboard components`** copies the same table from Claude Code. `components csv` copies it as CSV, and `components save` also writes a `.csv` file into the workspace.
- A name that a spreadsheet would read as a formula (one starting with `=`, `+`, `-` or `@`) is pasted as text.

## 0.37.0

- **The HTML report prints, and saves as a PDF.** A **Print or save as PDF** button sits at the top of the page, and your browser's own Print works the same. The printout:
  - is always in the light theme (Valence's Day for the expressive style), even when the screen is dark;
  - unfolds every session's steps;
  - fits the Components table to the page, with long IDs wrapping;
  - prints each Boomi link's address under it;
  - keeps session rows, table rows, charts and steps whole across page breaks;
  - puts the report's name and date at the top of each page, and the page number at the bottom.

  The buttons, search, filters and "click to…" hints are left off. Before this, a dark screen printed pale gray text, the Components table lost its last columns, and folded sessions printed as headings only.

## 0.36.0

- **A second style for the HTML report.** Set `reportStyle` to `expressive`, or add `--style expressive` to one `/bc-dashboard report html`. That report uses the repository's own Valence theme, Miami Deco:
  - Sand by day and Midnight Navy by night, with your Light and Dark choice kept;
  - Poiret One for the title and the wordmark, Josefin Sans for headings and labels;
  - a Deco Gold double rule closing the top of the page, and Flamingo marking the sessions;
  - Valence's fixed status colors, always with the icon and label.

  `exosphere` stays the default, for anything Boomi people will read. The setting is in `/bc-dashboard config data` too.

## 0.35.0

- **Why? on a failed BDI run.** A BDI run that failed gets a **Why?** under **Needs attention**, in the pane and with `/bc-dashboard why`. It follows bc-bdi's own troubleshooting guide, and both reads leave the flow as it is. It shows:
  - the reason BDI gave for the failure;
  - for a logic flow, the first step that failed and its error;
  - the run log's `ERROR` lines, oldest first.

  An empty log says so, and points to the BDI console. **Ask Claude to fix** drafts a request to find the cause and propose a fix, without changing the flow until you approve it.
- A failed BDI run's line under **Needs attention** now leads with BDI's reason, not `ERROR: … (run …)`.

## 0.34.0

- **The pane's theme and size are saved in `/config`.** The theme buttons, `/bc-dashboard theme` and `/bc-dashboard size` now set `paneTheme`, `paneRows` and `paneColumns`, the same settings `/config` and `/bc-dashboard config` show. Before, they were kept apart and quietly won over `/config`. A theme or size an earlier version kept moves to `/config` when your next session starts. Where `/config` won't take a change, such as a setting your organization locks, the dashboard keeps it as before.

## 0.33.0

- **Less navy at the top of the report.** The band keeps the title, the summary and the budget. The sessions now open the page below it, on a card of their own.
- **Charts in the all-sessions report.** Before, an all-sessions report whose work was all Integration had none. Now it has two charts:
  - **Cost by session:** each session's cost, with a paler bar for a cost counted only up to its last Companion step;
  - **Outcomes by session:** each session's steps, stacked by how they went.

  Click a session in either chart to open its steps. A one-session report keeps **Cost over the session**, and work across two products or more still gets the product charts.

## 0.32.0

- **`/bc-dashboard config`: the settings a question at a time.** Pick **Budget**, **Pane and banner** or **Data and reports**, and the dashboard asks about each setting in that group. Each question starts with **Keep** and the current value, offers two likely changes, and has **Back to the menu**. Type any other value under **Other**.
  - The budget questions offer figures from what your past Companion sessions on this machine really cost, such as "twice a typical session", "your costliest session" or "a quarter above the last 30 days".
  - The changes are saved to `/config` when you pick **Done**, and take effect at once. Settings the dashboard reads only at the start of a session (the flamingo, polling, the activity log, update checks) say so.
  - Shortcuts: `/bc-dashboard config budget` goes straight to the budget, `config budgetUsd 5` sets one setting, and `config list` shows them all. Where nothing can be asked, as in a `-p` run, it lists them.
- The report's "No budget set" and the new-session budget tip point to `/bc-dashboard config budget`.

## 0.31.0

- **The report says what's missing, and why.** Where something isn't there, the report says which of three cases it is. Hover over it, or use a screen reader, for the reason:
  - **didn't happen:** a dash, for a stage a component didn't reach in these sessions;
  - **not available:** a note with an ⓘ, for something we tried to find but couldn't, such as a component name the output didn't give, a deploy's package ID, a test's execution ID, a cost no transcript records, or a component Boomi doesn't know;
  - **not set up:** for something you can turn on, with how to do it, such as a budget, the Boomi environment, or the Platform API credentials.
- **A step that named a component but not its ID** now lands on that component's row, when no other component has that name. Before, a deploy recorded this way left the row's Deployed column empty. This applies in the pane too.

## 0.30.0

- **The sessions as a ledger, in place of the timeline's bands.** Each session gets a row:
  - when it ran and for how long, and how long after the one before;
  - what it did in words ("Orders Sync: created, deployed, tested (1 failed) · and 3 housekeeping steps");
  - how its steps went, each status with its icon and count;
  - what it cost, and its share of the session budget.

  Click a row for that session's steps.
- **Steps fold by session:** only the newest session that did real work starts open. A search or filter opens the sessions that hold what it found. Housekeeping steps read quieter than the work.
- **Steps recorded by older versions read properly.** A test that took another script's `SUCCESS:` line says it had no result of its own, and "a component" takes the component's name when its ID is known. This applies in the pane too.
- **Unnamed earlier sessions are split after two quiet hours,** not only where the running cost drops, so a morning check and an evening one are no longer counted as one session.
- **The summary says when failures were dealt with** ("5 of which failed or were blocked … None of them still needs attention").
- Fixed: "Open in Boomi" no longer breaks across two lines.

## 0.29.0

- **Budgets in the report.** Each budget you set gets a meter beside the summary: the session's spend (`budgetUsd`), the month's Companion spend (`companionMonthlyUsd`), and Companion's share of your limit (`companionShare`). Each is marked past 80% and when it's spent. An all-sessions report holds every session against the session budget, on its timeline band and in the summary. With no budget set, the report says how to set one.
- **A header band.** The top of the report is a navy band with the title, the summary, the budgets and the timeline. The Boomi account follows on one line.
- **The timeline is the session index,** replacing the Sessions table. Each band shows its session's full ID on hover. Its ticks are buttons: the arrow keys move between them, and Enter or a click opens that step in the list. A key under it explains the ticks and "not healthy", and the summary explains "at least" when it appears.
- **Components are swimlanes:** columns for Saved, Deployed and Tested, each stage with its icon, its time and the ID to find it by. The heading counts how many were saved, deployed and passing. This replaces the Components table and the pipeline chart.
- **Deploys and tests are a filter on Claude's steps** instead of a separate table. A failed step shows what went wrong without being opened, and **Expand all** opens every step.
- **Product charts appear only for two products or more.**
- **IDs copy with a click.**
- Fixed: the flamingo in the footer sat on a line of its own.

## 0.28.0

- The HTML report opens with a timeline of the sessions under its summary:
  - each session is a band, wider for longer sessions;
  - the idle time between sessions is a short gap that says how long it was ("24h 26m");
  - each step is a tick at its moment, and a failed, blocked or warned step carries its icon;
  - hovering a tick names the step, and clicking a session goes to its steps.
- The timeline replaces the "Steps over time" chart, and it has its data as a table too. On a phone the sessions stack.
- A component's stages read as one row of icons and labels instead of a stack of boxes.
- The footer carries the dashboard's flamingo as a small maker's mark.

## 0.27.1

- Faster all-sessions reports. To match older steps to their sessions, the report no longer scans every Claude Code transcript on the machine. It uses the last scan when that already covers them, and otherwise reads only this folder's transcripts, from the earliest unmatched step on. It remembers what it found, so the next report doesn't read them again.
- Claude's steps are grouped by session, newest first, each under its session's ID, times, step count and cost. **Newest first** and **Oldest first** flip the order, and the page remembers your choice. Filtering hides a session with no matching steps.
- Better use of a computer screen. The page is up to 1440px wide, and the summary and Boomi account sit side by side. Three charts fit in a row. The bar with section links stays at the top while you scroll. The Components table fits without scrolling sideways at 1280px: type with folder, and version with the last change, now share a column, and both still sort.
- "Needs attention" appears only when something does; otherwise the summary says so.

## 0.27.0

- The HTML report reads as a document, after a design pass with the [Impeccable](https://github.com/pbakaus/impeccable) skill's quality floor. A plain navy bar with links to each section replaces the header and chips. The title is followed by a paragraph saying what happened, in place of four number tiles. Sections are separated by rules instead of each sitting in a box.
- Statuses use drawn icons (a check, a half circle, a warning triangle, a cross) beside their labels, in place of text symbols. Alerts are tinted, without a thick colored edge, and product tags carry a small swatch.
- Text selection, scrollbars, links and figures in tables follow the report's colors.

## 0.26.1

- Fixed: an all-sessions report showed **$0.00** and "1 session" for steps recorded before 0.26.0, which don't name their session. Each such step now goes to the Claude Code session whose transcript covers its time in this folder, with that session's exact cost. The report scans the transcripts if they haven't been scanned in the last hour. Steps no transcript covers are split where the running cost drops (a new session starts at $0) and counted "at least" to their last step. A cost that wasn't recorded shows as **—** and "not recorded", never $0.
- Fixed: steps that 0.25.0 and earlier recorded twice (the same deploy package, test execution or save line, minutes apart) now count once, in the report and in the pane's history.
- The report's top is one hero band: what it's about (the repository, else the Boomi account, else the folder) and its facts as chips, instead of a title bar, a heading and a line that repeated each other.

## 0.26.0

- `/bc-dashboard report html` asks whether to cover **this session** or **all sessions in this folder** when there's a choice. `report html session` or `report html all` skips the question. The all-sessions report has a **Sessions** table (each session's ID, time, steps, failures, components and cost) and keeps each session's cost apart.
- The report opens in your browser once it's saved (`reportOpen`, or `--no-open`).
- New in the report: the Boomi account (name, account ID, environment ID). Each component's type, folder, component ID, current version and last change as Boomi has them now, with **Open in Boomi**. A **Deployments and tests** table with each package and execution ID. Each step also shows how long it took, its version and package, and where it was seen.
- Fixed: a component's type was blank when Claude named its file through a shell variable (`D=…; bash … "$D/X.xml"`). Variables set earlier in the command are now expanded, and a tested component is known to be a process.
- Fixed: a script result printed twice in one output (echoed by `tee`, say) became two steps.
- Fixed: in a command that ran several scripts, a script with no result of its own took another script's line, such as a test showing a create's `SUCCESS:`.
- Fixed: steps now record their Claude Code session, so costs from earlier sessions don't run into each other.
- Fixed: on a phone, the report's tables made the whole page scroll sideways.

## 0.25.0

- The update check toasts each new version once. After that, the pane's footer says `↑ bc-dashboard X.Y.Z is available: /bc-dashboard upgrade` until you install it, and only a newer release toasts again. The check itself still runs at most once a day, at the start of a session.

## 0.24.0

- The dashboard knows which Boomi Companion plugins are on in the session, from `claude plugin list --json` (or Claude Code's own plugin files when the CLI can't be run).
- The pane shows only the sections that apply: **Components this session** only with bc-integration or bc-marketplace, and the **Data Hub**, **Agentstudio agents** and **Custom connectors** sections for an installed plugin even before there's anything in them. A section with something in it always shows.
- A new session's first tip names what's installed (`Companion here: Integration 1.0.83 · Data Hub 0.2.12`), and tips about plugins you don't have are left out.
- Fixed: the new-version notice no longer throws after showing its toast.

## 0.23.1

- Past sessions' dates read `Oct 10, 09:00` on every machine. They came from the runtime's locale data, which on some versions joins date and time with " at " instead of a comma.

## 0.23.0

- `/bc-dashboard report html` saves the session report as one web page, `boomi-session-report-<time>.html`, to open in a browser or send to someone. It's styled to Boomi's Exosphere design system, light and dark.
- It has five charts: steps over the session by outcome, outcomes by product (click one to list its steps), cost over the session, spend by product, and how far the components got. Each chart has hover details and its data as a table.
- Below the charts: sortable tables of components, connectors and agents, and a searchable list of steps you can filter. Text is escaped, anything credential-shaped is masked, and nothing in the file is live.

## 0.22.0

- `/bc-dashboard upgrade` updates the dashboard from the GitHub checkout it's installed from. `--check` only looks, `--yes` skips the question, and `--rollback` goes back to the version before the last upgrade.
- Before installing, it refuses to touch a checkout with uncommitted changes or local commits, and it only fast-forwards. It runs `claude plugin validate` and `claude plugin test` on the new code in a temporary worktree first.
- A check at most once a day, at the start of a session, says when a newer version is on GitHub. It never installs. Settings: `updateCheck` and `updateCheckHours`.

## 0.21.0

- Custom connector releases: descriptor linted, validated, uploaded, and the version made active.

## 0.20.0

- Agentstudio agents' stages and test conversations.

## 0.19.1

- A livelier flamingo, still calm.

## 0.19.0

- Data Hub deploys and quarantine.

## 0.18.0

- Review a past session's cost.
