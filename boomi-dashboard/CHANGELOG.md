# Changelog

`/bc-dashboard upgrade` shows the entries between your version and the latest. Versions before 0.22.0 are summarized from their release commits.

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
