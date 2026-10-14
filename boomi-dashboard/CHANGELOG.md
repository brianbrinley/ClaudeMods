# Changelog

`/bc-dashboard upgrade` shows the entries between your version and the latest. Versions before 0.22.0 are summarized from their release commits.

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
