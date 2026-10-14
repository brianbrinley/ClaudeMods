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
  **Pass:** `✓ Agentstudio: deployed agent …` and `✓ Agentstudio: started a test conversation with …`. **Fail:** nothing.
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

- [ ] **G11. Data Hub deploy.** Have Claude deploy a universe and check its status until it's done.
  **Pass:** `◐ Data Hub: universe … deploying`, then `✓ Data Hub: deployed universe …`. **Fail:** it stays ◐, or a success reads as failed; send the deploy's and the status check's output, so the status words can be confirmed.
- [ ] **G12. Data Hub quarantine.** Send a record that quarantines (a missing required field), then have Claude list the universe's quarantine.
  **Pass:** a **Data Hub** section with `1 in quarantine (1 REQUIRED_FIELD)`, and the item under **Needs attention** with the reason. After the record is deleted from quarantine and Claude lists it again, `nothing in quarantine`. **Fail:** no section, or a count that doesn't match.
- [ ] **G13. Agentstudio agent stages.** *(0.20.0)* Have Claude create an agent, package and deploy it, then talk to it twice in one conversation.
  **Pass:** an **Agentstudio agents** section with the agent's name and `✓ created  ✓ packaged v1  ✓ deployed  ✓ 1 test conversation, 2 turns, all answered`, and the steps read `Agentstudio: started a test conversation with <name>`, then `continued …`. **Fail:** no section, the agent shown by its ID after it was created, no `v1`, or the conversation on a row of its own (`deployment …`); send the create, package-create and deploy output, so their field names can be confirmed.
- [ ] **G14. Agentstudio edit not live.** *(0.20.0)* After G13, have Claude update the agent without packaging it.
  **Pass:** the row adds `◐ changed since packaged`; after Claude packages and deploys again, it's gone and the version moves. **Fail:** no warning, or one that stays.
- [ ] **G15. Connector release.** *(0.21.0)* Have Claude lint a connector's descriptor, build it, validate the built descriptor, upload the archive and set the new version on the dev classification.
  **Pass:** a **Custom connectors** section with the project folder's name and `✓ descriptor linted  ✓ validated  ✓ uploaded vN`, `◐ vN not active yet` until the version change, then `✓ vN active on dev`. **Fail:** two rows for one connector, no version number, or the warning staying after the change; send the upload's and the version change's output, so their field names can be confirmed.
- [ ] **G16. A failed lint.** *(0.21.0)* Break the descriptor (an element in the wrong place) and have Claude lint it.
  **Pass:** `✗ lint failed` on the row, and under **Needs attention** the line xmllint gave, naming the file, line and element. **Fail:** only `failed`, or a pass.
- [ ] **G17. Why? on a failed BDI run.** *(0.35.0)* Have Claude run a BDI flow that fails, such as one whose target table doesn't exist, and check its status until it ends. Press **Why?** under **Needs attention**, then **Ask Claude to fix**.
  **Pass:** the line names BDI's reason. **Why?** shows `BDI says (n errors, …)` with the reason and the log's ERROR lines, plus the failed step for a logic flow. **Ask Claude to fix** puts a request in the prompt box that names the flow and run, and nothing changes in BDI. **Fail:** no **Why?**, an error about bc-bdi's scripts with bc-bdi installed, or log lines out of order.


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

- [ ] **H7. Budget setup as the README says.** Follow [Set up a budget](boomi-dashboard/README.md#set-up-a-budget): set `budgetUsd` to `5` through `/config`, then set `companionMonthlyUsd` to `50` in `~/.claude/settings.json` under `pluginConfigs` and restart.
  **Pass:** `/config` lists the four **boomi-dashboard** budget rows; after each change the **BUDGET** gauge shows `session: … of $5.00`, then `month: … of $50` as well. **Fail:** no rows under `/config`, a change that never shows, or the settings-file block ignored; say which, and whether a restart fixed it.

## I. Cost review

*boomi-dashboard 0.18.0. Needs earlier Companion sessions on this machine.*

- [ ] **I1. Review a session.** Under **Past Companion sessions**, press **Scan**, then **Review** beside your costliest session.
  **Pass:** a line with its cost, prompts, tokens and peak context, then findings that match what you remember of it (each with a tip), or `Nothing stands out`. **Fail:** an error, or a finding that's plainly wrong; say which.
- [ ] **I2. Ask Claude to review.** Press **Ask Claude to review**, then Enter.
  **Pass:** the prompt box holds the request with the transcript's path; Claude reads the transcript in parts and suggests concrete changes. **Fail:** no path, or Claude can't open the file.
- [ ] **I3. Compactions and prompts.** Review a session you know compacted.
  **Pass:** `It compacted N times`, and a prompt count close to how many messages you sent. **Fail:** no compaction found; the transcript's marker may have changed.

## J. Upgrade command

*boomi-dashboard 0.22.0, installed as the README says (a checkout in `CLAUDE_CODE_PLUGIN_DIRS`). Start with the checkout one release behind, for example `git -C ~/ClaudeMods switch --detach HEAD~1`, then restart.*

- [ ] **J1. Dry run.** Run `/bc-dashboard upgrade --check`.
  **Pass:** the version change, the commit list, the changed files and the changelog entries; `git -C ~/ClaudeMods status` shows nothing changed. **Fail:** an error, or the checkout moved.
- [ ] **J2. Upgrade.** Run `/bc-dashboard upgrade` and choose **Install**.
  **Pass:** after about a minute, `✓ Installed X (was Y). Validate and test passed …` and the restart line; after a restart, the pane footer or `/bc-dashboard text` reads the new version. **Fail:** a stop or error; send the text.
- [ ] **J3. Refuses a dirty checkout.** Edit any file in `~/ClaudeMods`, then run `/bc-dashboard upgrade`.
  **Pass:** `✗ The checkout has uncommitted changes`, before any question, and your edit is still there. **Fail:** it asks, or touches the file. Undo the edit afterwards.
- [ ] **J4. Rollback.** After J2, run `/bc-dashboard upgrade --rollback`, then restart.
  **Pass:** `✓ Rolled back to Y`, and the old version loads. Running `/bc-dashboard upgrade` again returns to the new one. **Fail:** an error, or the version doesn't change.
- [ ] **J5. Nudge.** With the checkout behind again, set `updateCheckHours` to `1` and start a new session; wait 20 seconds.
  **Pass:** one toast, `bc-dashboard X is available …`, and none in a second session within the hour. With the network off, nothing at all. **Fail:** no toast, one every session, or an error.
- [ ] **J6. Once per version.** *(0.25.0)* After J5's toast, set `updateCheckHours` to `0.01`, start another new session, wait 20 seconds and open the pane.
  **Pass:** no second toast, and the pane's footer shows `↑ bc-dashboard X.Y.Z is available: /bc-dashboard upgrade`. After `/bc-dashboard upgrade` and a restart, that line is gone. **Fail:** the same version toasts again, or the footer line is missing or stays after upgrading.

## K. Report as a web page

*boomi-dashboard 0.23.0, in a Companion session with some steps, ideally including one failure and one other plugin.*

- [ ] **K1. Save it.** Run `/bc-dashboard report html`.
  **Pass:** `Saved the report as a web page: …/boomi-session-report-<time>.html`, and the file exists. **Fail:** an error.
- [ ] **K2. Open it.** Open the file in Chrome, Safari or Edge.
  **Pass:** a navy Boomi Companion bar, the tiles, **Needs attention**, the charts and the tables, matching what `/bc-dashboard text` says. **Fail:** a blank or unstyled page, or numbers that don't match; send a screenshot.
- [ ] **K3. Use it.** Switch **Dark** and **Light**, hover a chart bar, click a product in **Outcomes by product**, sort **Components** by **Cost**, and search the steps.
  **Pass:** each works: the theme changes, a tooltip appears, the steps list shows only that product, the table re-orders, and the search narrows the list. **Fail:** say which didn't.
- [ ] **K4. Share it.** Send the file to someone (or open it on another computer or a phone).
  **Pass:** it looks the same there, and on a phone nothing runs off the side of the screen; the tables scroll inside their cards. **Fail:** say what's off.
- [ ] **K5. This session or all.** *(0.26.0)* In a folder where you used Companion in an earlier session today, do some Companion work, then run `/bc-dashboard report html`.
  **Pass:** a question with **This session** and **All sessions in this folder**. **All** saves `boomi-sessions-report-<time>.html` with a **Sessions** table listing this session (tagged **this session**) and the earlier one. **This session** saves `boomi-session-report-<time>.html` with only this session's steps. **Fail:** no question, a session missing, or the earlier session's steps in a this-session report.
- [ ] **K6. It opens.** *(0.26.0)* After K5, on your own computer.
  **Pass:** the page opens in your browser by itself, and the command says `Opened it in your browser.` **Fail:** it doesn't open; say which system (macOS, Windows/WSL, Linux).
- [ ] **K7. Boomi's view.** *(0.26.0)* In K5's page, look at **Boomi account** and **Components**, then press **Open in Boomi** on one component.
  **Pass:** the account's name and ID match the platform's account menu. Each component has a type, a folder, its ID and a version. **Open in Boomi** opens that component in Boomi's build page. **Fail:** a blank type or folder for a component that's in Boomi, a wrong account, or the link opening the wrong page; send the link.
- [ ] **K8. No doubled steps.** *(0.26.0)* Have Claude create, deploy and test a process in one command, with its file named through a variable (as in `D=active-development/processes && bash … "$D/X.xml"`), then make the report.
  **Pass:** one step each for create, deploy and test, the component's type is `process`, and the test's result is its own `status …`, not the create's `SUCCESS:` line. **Fail:** a step twice, a blank type, or a test showing another script's line.
- [ ] **K9. Old sessions' costs.** *(0.26.1)* In the folder from your 0.26.0 all-sessions report (the one that showed $0.00), run `/bc-dashboard report html all`.
  **Pass:** the sessions under the summary list each day's session separately, with its own ID and cost, not one "Earlier" row. Each cost is within a few cents of what **Past Companion sessions** shows for that session, and the Cost tile is their sum. The same deploy package or test execution appears once under **Deployments and tests**. **Fail:** $0.00, a single earlier session, or a doubled step; send the Sessions table.
- [ ] **K10. The sessions.** *(0.30.0)* In a folder with two or more Companion sessions, run `/bc-dashboard report html all`.
  **Pass:** under the summary, one row per session, oldest first, each saying when it ran, what it did in words, how its steps went and what it cost. Clicking a row opens that session's steps. The newest session that did real work is the only one open at first. **Fail:** a row out of order, a "what it did" that doesn't match the steps, or a click that goes nowhere.
- [ ] **K11. Report speed.** *(0.27.1)* Time `/bc-dashboard report html all` in your busiest folder, then run it again.
  **Pass:** the first run takes a few seconds at most, and the second is no slower. **Fail:** either takes more than about 10 seconds; say how long.
- [ ] **K12. Budgets.** *(0.29.0)* Under `/config`, set `budgetUsd` a little under what one of your recent sessions cost, and set `companionMonthlyUsd`. Restart, then run `/bc-dashboard report html all`.
  **Pass:** beside the summary, a meter for the session and one for the month, each with a percent and an icon. The summary says how many sessions reached the session budget, and those sessions' timeline bands say "⊗ N% of budget". With both settings back at 0, the report says "No budget set" and how to set one. **Fail:** a meter missing, a percent that doesn't match the pane's BUDGET gauge, or no budget note on a session that went over.
- [ ] **K13. Swimlanes and IDs.** *(0.29.0)* In the same report, look at **Components**, then click a component ID.
  **Pass:** each row's Saved, Deployed and Tested columns show the stage with its icon, its time, and the version, package or execution. The clicked ID is copied: paste it somewhere to check. **Fail:** a stage in the wrong column, or nothing copied.
- [ ] **K14. What's missing.** *(0.31.0)* Run `/bc-dashboard report html all` in a folder where Companion tested a process without waiting, and where no budget is set. Hover over the ⓘ notes and the dashes.
  **Pass:** a stage that didn't happen shows a dash, and hovering says "Not deployed in these sessions" (or saved, or tested). The test without a wait says "execution ID not available", with the reason on hover. The budget panel says "No budget set", with how to set one beneath it. **Fail:** an empty cell, a note with no reason on hover, or a dash where the step did happen.
- [ ] **K15. Less navy, and charts per session.** *(0.33.0)* In a folder with two or more Companion sessions, run `/bc-dashboard report html all`.
  **Pass:** the navy band holds only the title, the summary and the budget. The sessions come next, on a light card. **Charts** has **Cost by session** and **Outcomes by session**, a bar per session, and clicking one opens that session's steps. **Fail:** the sessions still inside the navy band, no charts, or a click that goes nowhere.
- [ ] **K16. Report style.** *(0.36.0)* Run `/bc-dashboard report html all --style expressive`, switch **Light** and **Dark**, then run it again without `--style`.
  **Pass:** the first page is Sand (Midnight Navy in Dark), with the title in Poiret One, a gold double rule under the top, and Flamingo dates on the sessions. Status icons keep their labels, and both theme buttons stay readable. The second page is the usual Exosphere report. **Fail:** a mix of the two styles, unreadable buttons, or `--style` ignored.
- [ ] **K17. Print to PDF.** *(0.37.0)* With the report open in **Dark**, press **Print or save as PDF** and save a PDF. Then try your browser's own Print from the menu.
  **Pass:** the PDF is light, with dark text on white. Every session's steps are there, and the Components table shows all five columns through **Cost**. Each **Open in Boomi** has its address under it. Each page has the report's name and date at the top and `Page n of m` at the bottom, and no buttons or search box are printed. Back on screen, the sessions are folded as before. **Fail:** pale or dark pages, missing columns, sessions printed as headings only, or rows cut across pages.
- [ ] **K18. Components to a spreadsheet.** *(0.38.0)* In the report, press **Copy for a spreadsheet**, then paste into the first cell of a new Excel or Google Sheets sheet. Press **Save as CSV** and open the file in Excel. In Claude Code, run `/bc-dashboard components` and paste again.
  **Pass:** one row per component, with every column in its own cell: name, type, folder, component ID, version, deploy, package ID, test, execution ID, cost and link. The note beside the buttons says what was copied, the CSV opens with its characters intact, and the command's paste matches. **Fail:** everything in one column, IDs cut or reformatted (for example as numbers), or nothing copied.

## L. Installed Companion plugins

*boomi-dashboard 0.24.0. Needs a Companion workspace (an `active-development` folder) and a session restart between steps.*

- [ ] **L1. What's installed.** With bc-integration installed, start a new session in the workspace and wait for the banner's tips (20 seconds each).
  **Pass:** one tip reads `Companion here: Integration <version>`, plus any other bc-* plugin you have on, with the same versions `claude plugin list` shows. **Fail:** no such tip, a plugin missing or extra, or a wrong version; send the tip and `claude plugin list`'s output.
- [ ] **L2. Only the sections that apply.** Install bc-datahub (`claude plugin install bc-datahub@boomi-companion`), restart, and open the pane.
  **Pass:** a **Data Hub** section saying `Quarantined entities show up here once Claude checks a universe's quarantine.`, and no **Agentstudio agents** or **Custom connectors** section unless those plugins are on. **Fail:** no **Data Hub** section, or sections for plugins you don't have.
- [ ] **L3. A disabled plugin.** Run `claude plugin disable bc-integration@boomi-companion`, restart in a folder where Companion hasn't been used today, and open the pane.
  **Pass:** no **Components this session** section, and no Why?, Run again or watch tips. Turn it back on with `claude plugin enable bc-integration@boomi-companion`. **Fail:** the section is there with its empty-state line.

## M. Settings menu

- [ ] **M1. The budget, a question at a time.** *(0.32.0)* In a folder with past Companion sessions, run `/bc-dashboard config`, pick **Budget**, then pick the second option for the session budget, keep the rest, and pick **Done**.
  **Pass:** the session budget question says what your sessions cost typically and at most, and its options include a figure "twice a typical session". After **Done**, the reply lists the change under "Saved to /config:", `/config` shows the new **Spend budget (USD)**, and the pane shows a **BUDGET** gauge without a restart. **Fail:** no figures from past sessions, a change that `/config` doesn't show, or no gauge until a restart.
- [ ] **M2. Back, Other and closing.** *(0.32.0)* Run `/bc-dashboard config pane`, pick **Night** for the colors, then press Esc on the next question.
  **Pass:** the pane turns Night, and the reply says the menu closed before Done and the change is saved. Run `/bc-dashboard config budgetUsd lots`: it says the budget takes a number and stays as it was. **Fail:** the change is lost on Esc, or the typed value is saved.
- [ ] **M3. Where nothing can be asked.** *(0.32.0)* Run `claude -p "/bc-dashboard config"`.
  **Pass:** it prints every setting by group with its value, and how to change one with `/bc-dashboard config <setting> <value>`. **Fail:** it hangs or prints nothing.
- [ ] **M4. Theme and size in /config.** *(0.34.0)* Press **Night** in the pane, run `/bc-dashboard size 24`, then open `/config`.
  **Pass:** the boomi-dashboard rows show **Pane colors** `night` and **Pane height (rows)** `24`. Set **Pane colors** back to `day` in `/config`: the pane turns Day. Restart, and the pane is still Day, 24 rows tall. **Fail:** `/config` still shows the old values, or the pane ignores a change made in `/config`.
