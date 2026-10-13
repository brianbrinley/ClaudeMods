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
- [ ] **B9. Pane basics.** Theme buttons switch Day, Night and Terminal; **☐** closes an item and **Reopen** brings it back.
  **Pass:** both. **Fail:** say which.

- [ ] **B10. Guardrails.** With boomi-runtime loaded, run `/boomi up`.
  **Pass:** the dashboard's **Guardrails** section shows `◐ Runtime … installing`, then `✓ Runtime … online`. **Fail:** no **Guardrails** section, or it doesn't change. (The standards half of this check comes back with boomi-standards; see IDEAS.md.)

## C. Windows (WSL)

- [ ] **C1.** In Claude Code inside WSL, install the dashboard with the prompt under [Install](boomi-dashboard/README.md#install), then press **Scan**.
  **Pass:** past sessions list, or `No Companion sessions`. **Fail:** `Perl's JSON module is missing` (run `sudo apt install perl`, then scan again) or anything else.

## D. Docs site

*After [#21](https://github.com/brianbrinley/ClaudeMods/pull/21) is merged.*

- [x] **D1.** *(Passed: [run 8](https://github.com/brianbrinley/ClaudeMods/actions/runs/38290300634), green.)* The **Docs Site** workflow runs for the merge, under the repository's **Actions** tab.
  **Pass:** a green run. **Fail:** no run, or a red one.
- [x] **D2.** *(Passed: both sections are live.)* On [the site](https://brianbrinley.github.io/ClaudeMods/), the Companion Dashboard page has a **Commands and tools** section, and the Boomi Runtime page has **Secure the API token**.
  **Pass:** both. **Fail:** the old pages.
- [ ] **D3.** After the flamingo PR is merged, open [the Companion Dashboard page](https://brianbrinley.github.io/ClaudeMods/boomi-dashboard/) on a laptop-sized window, in Day and in Night.
  **Pass:** the 8-bit flamingo stands to the right of the opening paragraph and its list, and every few seconds flaps and steps in place; in a narrow window it's gone. **Fail:** no flamingo, one overlapping the text, or a gap where it should be.

## E. Runtime regression

*Already verified live before the token work; recheck once on boomi-runtime 0.3.0, which removed it.*

- [ ] **E1.** `/boomi up`, then `/boomi smoke`, then `/boomi down`.
  **Pass:** online, `smoke test: passed`, then everything deleted. **Fail:** the phase or message where it stopped.

## F. Dashboard 0.11.0

*boomi-dashboard 0.11.0. Needs a Companion workspace that has had at least one earlier session with the dashboard loaded.*

- [ ] **F1. New-session banner.** Start a new Claude Code session in the Companion workspace and don't ask for anything yet.
  **Pass:** the banner reads `◆ BC Dashboard`, then `Last session <time> ago:` with what that session did and what it cost, then `│ $0.00 this session`; about 20 seconds later it shows a line starting `Tip:`. **Fail:** the old banner (a step and `N components`), no banner, or no change after a minute.
- [ ] **F2. Banner switches to work.** In the same session, have Claude push a component.
  **Pass:** the banner shows `✓ Saved <name> to Boomi (vN)` and the tips stop. **Fail:** a tip or `Last session` still shows.
- [ ] **F3. Banner stays out of the way.** Start a session in a folder that isn't a Companion workspace.
  **Pass:** no `BC Dashboard` banner. **Fail:** a banner with a tip.
- [ ] **F4. Activity log.** Add `BOOMI_COMPANION_LOG_ACTIVITY=1` to Companion's `.env`. In a terminal outside Claude Code, run `boomi-component-push.sh` on a component, then wait 15 seconds.
  **Pass:** **Claude's latest steps** shows `✓ Saved <name> to Boomi (vN)` with `log` beside its time. **Fail:** nothing after a minute; send `wc -l .activity-log/activity.jsonl`.
- [ ] **F5. No double steps.** With the log on, have Claude push a component.
  **Pass:** one `Saved` step for it, without `log`. **Fail:** two steps for the one push.
- [ ] **F6. Why? picks.** With two failed tests under **Needs attention**, run `/bc-dashboard why`.
  **Pass:** a question dialog lists both, newest first, and picking one prints its log lines. With none, `Nothing to look into`. **Fail:** `Usage:` or an error.
- [ ] **F7. No run polling.** Open the pane.
  **Pass:** no **Process runs in Boomi** section, and watching a component (`/bc-dashboard watch <id>`) still shows it under **Watched components**. **Fail:** the section is there, or the watch errors.
- [ ] **F8. Status line in a new session.** Start a new session in the Companion workspace, as in F1.
  **Pass:** the status line under the prompt reads `New session · last one <time> ago, …` and the session's cost, not a step from the last session. After Claude's first Companion step, it shows that step. **Fail:** it shows the last session's step, such as `✓ Test of a component passed`.
- [ ] **F9. Reopen a past session.** Under **Past Companion sessions**, press **Scan**, then **Copy** beside an earlier session. Paste into a new terminal and press Enter.
  **Pass:** `Copied. Paste it into a new terminal…` under the session, and the new terminal opens Claude Code in that session's folder with its conversation. Then `/bc-dashboard resume` asks which session and prints the command. **Fail:** nothing copied (say which terminal app), the command fails, or a different session opens.

## G. Companion's other plugins

*boomi-dashboard 0.13.0. Each step needs that plugin installed and set up in the workspace. Skip a plugin you don't use, and say which.*

- [ ] **G1. Data Hub.** Have Claude publish a model and deploy its universe.
  **Pass:** **Claude's latest steps** shows `✓ Data Hub: published model …` and `✓ Data Hub: deployed universe …`. **Fail:** nothing, or the wrong words; send the step and the script's last output line.
- [ ] **G2. BDI.** Have Claude run a flow.
  **Pass:** `✓ BDI: ran flow …`. If it fails, `✗ BDI: couldn't run flow …` under **Needs attention** with the `ERROR:` line. **Fail:** nothing, or a pass for a failed run.
- [ ] **G3. Agentstudio.** Have Claude deploy an agent and talk to it.
  **Pass:** `✓ Agentstudio: deployed agent …` and `✓ Agentstudio: talked to deployment …`. **Fail:** nothing.
- [ ] **G4. Connectors.** Have Claude validate a connector descriptor and upload a version.
  **Pass:** `Connectors: validated connector descriptor …` (◐ if it was accepted with warnings) and `✓ Connectors: uploaded a version to connector group …`. **Fail:** nothing, or ✓ when the script warned.
- [ ] **G5. Marketplace.** Have Claude install a recipe.
  **Pass:** `✓ Marketplace: installed recipe <its name>`. **Fail:** a generic line, or nothing.
- [ ] **G6. Read-only stays quiet.** Have Claude list Data Hub models or BDI flows.
  **Pass:** no step for it. **Fail:** a `list` step shows up.
- [ ] **G7. Spend by product.** In a session that used two products, run `/bc-dashboard text`.
  **Pass:** a `By product:` line with each product's cost. **Fail:** no such line.
- [ ] **G8. Older steps.** In a folder where Companion was used more than a day ago, start a new session and open the pane.
  **Pass:** under **Components this session**, a **Show N earlier** button; pressing it lists those older steps, and **Needs attention** doesn't grow. After a restart, the button is still there. **Fail:** no button when you know there was older work, or old failures under **Needs attention**.
- [ ] **G9. Recipe components.** Have Claude install a Marketplace recipe, then pull one of its components.
  **Pass:** each copied component under **Components this session** with `✓ from recipe <name>`; after the pull, that row shows the component's name and `✓ pulled from Boomi`. **Fail:** no rows, or the pull makes a second row.
- [ ] **G10. BDI run result.** Have Claude run a BDI flow and check its status until it finishes.
  **Pass:** `◐ BDI: flow … run started`, then `✓ BDI: flow … ran and succeeded`; or, if it fails, `✗ … run failed` under **Needs attention** with BDI's reason. **Fail:** it stays ◐ after Claude saw it finish; send the status output.


## H. Usage limits and a Companion budget

*boomi-dashboard 0.14.0, on a Claude seat (not an API key).*

- [ ] **H1. Limits read themselves.** Open the pane in any session.
  **Pass:** a **LIMITS** gauge with your weekly or 5-hour percent, close to what `/usage` shows, and when it resets; the banner ends with `week NN% · 5h NN%`. **Fail:** no gauge, or a percent far from `/usage`; send both.
- [ ] **H2. Relative budget.** Under `/config`, set `companionShare` to `10` and `companionSharePeriod` to `day`, restart, and do some Companion work.
  **Pass:** `/bc-dashboard text` shows `Companion today: N% of your weekly limit, M% of its 1.4%`, and N rises as you work. **Fail:** no line, or N stays at 0 after real work.
- [ ] **H3. Monthly amount.** Set `companionMonthlyUsd` to a little over this month's Companion cost, restart, and wait a minute.
  **Pass:** `Companion this month: $X of $Y`, where X matches **Past Companion sessions**' this month plus this session. **Fail:** no line, or X far off.
- [ ] **H4. Full session ID.** Look at the pane's footer.
  **Pass:** `session` followed by the whole ID, and `claude --resume <that ID>` in a new terminal opens this session. **Fail:** a short ID, or the resume fails.
- [ ] **H5. BUDGET gauge.** Set `budgetUsd` and `companionMonthlyUsd` under `/config` and restart.
  **Pass:** a **BUDGET** gauge listing `session:` and `month:` with their amounts. **Fail:** no gauge, or a budget missing.
- [ ] **H6. Pane size.** Run `/bc-dashboard size 30`, then restart and open the pane.
  **Pass:** the pane opens about 30 rows tall both times; dragging its edge still resizes it. **Fail:** the size doesn't change, or isn't kept.

## I. Cost review

*boomi-dashboard 0.18.0. Needs earlier Companion sessions on this machine.*

- [ ] **I1. Review a session.** Under **Past Companion sessions**, press **Scan**, then **Review** beside your costliest session.
  **Pass:** a line with its cost, prompts, tokens and peak context, then findings that match what you remember of it (each with a tip), or `Nothing stands out`. **Fail:** an error, or a finding that's plainly wrong; say which.
- [ ] **I2. Ask Claude to review.** Press **Ask Claude to review**, then Enter.
  **Pass:** the prompt box holds the request with the transcript's path; Claude reads the transcript in parts and suggests concrete changes. **Fail:** no path, or Claude can't open the file.
- [ ] **I3. Compactions and prompts.** Review a session you know compacted.
  **Pass:** `It compacted N times`, and a prompt count close to how many messages you sent. **Fail:** no compaction found; the transcript's marker may have changed.
