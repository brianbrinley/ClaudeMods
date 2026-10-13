# Changelog

`/bc-dashboard upgrade` shows the entries between your version and the latest. Versions before 0.22.0 are summarized from their release commits.

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
