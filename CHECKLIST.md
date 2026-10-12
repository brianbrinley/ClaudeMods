# Manual checks

What the automated tests can't prove: each item needs a real Claude Code session, a real Boomi account, or both. Run them in order within a section. Each step has a **Pass** and a **Fail** you can see; nothing is "probably fine".

**Reporting back:** give the item's ID and **PASS** or **FAIL**, and for a fail, the exact text you saw (a screenshot works too). For example: `B2 FAIL: ERROR: Polling timed out after 60 attempts`. Never paste the token itself.

When an item passes, tick it here. When every item in a section passes, the section's open question in the mod's README can be closed.

## B. Dashboard features

*boomi-dashboard 0.7.0 and up. Needs a Companion session with credentials.*

- [ ] **B1. A failed test shows once.** Have Claude run a test that fails.
  **Pass:** one item under **Needs attention**, not a second one for the same execution's run. **Fail:** two items with the same execution ID.
- [ ] **B2. Why?** Press **Why?** on that item.
  **Pass:** within 4 minutes it shows `The log (N severe, M warnings):` and the log's lines. **Fail:** an error line under the item; send its text.
- [ ] **B3. Ask Claude to fix.** Press it.
  **Pass:** the prompt box holds a fix request naming the execution and quoting the log, after anything you'd typed, and nothing is sent until you press Enter. **Fail:** nothing appears, or it sends by itself.
- [ ] **B4. Run again.** After Claude's fix, press **Run again**.
  **Pass:** a new test step appears under **Claude's latest steps**, and if it passes, the item leaves **Needs attention**. **Fail:** no new step, or `Couldn't find Boomi Companion's scripts`.
- [ ] **B5. Next step.** Have Claude push a process and finish its turn without deploying it.
  **Pass:** the empty prompt box shows a dim `Deploy <name> and test it`. **Fail:** nothing. (It shows once per step, and only while the box is empty.)
- [ ] **B6. Budget.** Set `budgetUsd` to a little over the session's current cost under `/config`, and keep working.
  **Pass:** past 80%, the status line shows `◐ NN% of the $X budget` and one toast appears; past 100%, `✗ budget spent`. **Fail:** no warning, or a toast on every refresh.
- [ ] **B7. Session report.** Run `/bc-dashboard report save`.
  **Pass:** it prints the report and `Saved to …/boomi-session-report-<date>.md`, and the file exists. **Fail:** an error.
- [ ] **B8. Past sessions.** Press **Scan** under **Past Companion sessions**.
  **Pass:** it lists earlier Companion sessions on this machine, and one session's cost is within a few cents of what `/cost` showed in it. **Fail:** `History needs Perl`, an empty list when you know there were sessions, or a cost far off; send the line.
- [ ] **B9. Pane basics.** Theme buttons switch Day, Night and Terminal; **☐** closes an item and **Reopen** brings it back; **Hide** folds **Process runs in Boomi**.
  **Pass:** all three. **Fail:** say which.

- [ ] **B10. Guardrails.** With boomi-standards loaded, have Claude push a component with a password typed into a password field.
  **Pass:** the push is refused, and the dashboard's **Guardrails** section shows `⚠ Standards blocked the last push:` with the reason. After `/boomi up`, it shows `◐ Runtime … installing`, then `✓ Runtime … online`. **Fail:** no **Guardrails** section, or it doesn't change.

## C. Windows (WSL)

- [ ] **C1.** In Claude Code inside WSL, install the dashboard with the prompt under [Install](boomi-dashboard/README.md#install), then press **Scan**.
  **Pass:** past sessions list, or `No Companion sessions`. **Fail:** `Perl's JSON module is missing` (run `sudo apt install perl`, then scan again) or anything else.

## D. Docs site

*After [#21](https://github.com/brianbrinley/ClaudeMods/pull/21) is merged.*

- [x] **D1.** *(Passed: [run 8](https://github.com/brianbrinley/ClaudeMods/actions/runs/38290300634), green.)* The **Docs Site** workflow runs for the merge, under the repository's **Actions** tab.
  **Pass:** a green run. **Fail:** no run, or a red one.
- [x] **D2.** *(Passed: both sections are live.)* On [the site](https://brianbrinley.github.io/ClaudeMods/), the Companion Dashboard page has a **Commands and tools** section, and the Boomi Runtime page has **Secure the API token**.
  **Pass:** both. **Fail:** the old pages.

## E. Runtime regression

*Already verified live before the token work; recheck once on boomi-runtime 0.3.0, which removed it.*

- [ ] **E1.** `/boomi up`, then `/boomi smoke`, then `/boomi down`.
  **Pass:** online, `smoke test: passed`, then everything deleted. **Fail:** the phase or message where it stopped.
