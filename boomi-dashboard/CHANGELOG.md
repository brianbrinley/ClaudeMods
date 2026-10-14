# Changelog

`/bc-dashboard upgrade` shows the entries between your version and the latest. Versions before 0.22.0 are summarized from their release commits.

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
