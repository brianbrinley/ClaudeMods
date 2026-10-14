# Changelog

`/bc-dashboard upgrade` shows the entries between your version and the latest. Versions before 0.22.0 are summarized from their release commits.

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
