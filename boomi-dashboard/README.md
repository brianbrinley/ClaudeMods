<picture>
  <source media="(prefers-color-scheme: dark)" srcset="assets/banner-night.png">
  <img alt="Companion Dashboard: Valence, Claude Mods" src="assets/banner-day.png">
</picture>

# Boomi Companion Dashboard Mod

<div data-flamingo></div>

**See your whole Boomi build at a glance, right beside the conversation.** While Claude builds with [Boomi Companion](https://github.com/OfficialBoomi/bc-integration), the dashboard follows every edit, save, deploy and test. It tells you what broke and what to do next, and keeps a running total of what the session costs. You don't leave Claude Code, and you don't scroll back through the transcript.

- **Know where every component stands.** Edited, saved with its version, deployed, tested: each component's stage updates as Claude works.
- **Go from failure to fix in two clicks.** **Why?** reads a failed test's process log, or a failed BDI run's log. **Ask Claude to fix** drafts the request with the log's lines in it, and **Run again** checks the fix without a turn of Claude's.
- **Keep spend in sight.** Tokens, cost and how full the context is, per step and per component. On a Claude seat, your 5-hour and weekly usage limits and where your pace leads, read automatically, and an optional Companion budget of your own: a share of your limit per day, week or month, or a monthly amount.
- **Learn from what cost the most.** Review a past session to see what drove its cost (the model, a long conversation, repeated tests) and the Claude Code habit that would have saved it.
- **Pick up where you left off.** A new session opens with what the last one did and left to fix, and **Past Companion sessions** shows what earlier work cost.
- **Every Companion plugin, not only integration.** Data Hub deploys, BDI flow runs, Agentstudio agents, custom connector releases and Marketplace recipes show up as steps too, with their failures under **Needs attention** and each product's share of the spend.
- **Catch what happens outside the chat.** Companion's activity log adds script runs from a terminal, and watched components flag changes someone else makes in Boomi.
- **Better prompts for Boomi work.** Each prompt you type is checked for what Boomi work needs and it leaves out (which component "it" is, the environment, test data, the error), with an upgraded prompt built from what the session already knows. It never blocks, except to ask before a password or token goes into the transcript.
- **Hand it off.** `/bc-dashboard report` writes the session up as Markdown for a pull request, a ticket or the next person. `report html` makes it a web page with charts that you can send to anyone.

## Install

Copy this prompt into a Claude Code session started from your Boomi Companion workspace (the folder with Companion's `.env`). It works for any Claude account. On Windows, run Claude Code in WSL and paste it there.

```prompt
Install the boomi-dashboard Claude Code mod from https://github.com/brianbrinley/ClaudeMods for my user account, so it loads in every Claude Code session on this computer.

1. Clone the repo (main branch) to ~/ClaudeMods. If it's already there, run `git -C ~/ClaudeMods pull` instead.
2. Check that ~/ClaudeMods/boomi-dashboard/.claude-plugin/plugin.json and ~/ClaudeMods/boomi-dashboard/hooks/register.tsx exist, then run `claude plugin validate ~/ClaudeMods/boomi-dashboard` and `claude plugin test ~/ClaudeMods/boomi-dashboard` and show me the results.
3. Add the mod to the "env" block of my user settings file, ~/.claude/settings.json (not the project's settings):
   "CLAUDE_CODE_PLUGIN_DIRS": "<absolute path to ~/ClaudeMods/boomi-dashboard>"
   Use the absolute path, with my home folder spelled out. If CLAUDE_CODE_PLUGIN_DIRS already has a value, append to it with ":" instead of replacing it. Keep everything else in the file as it is, and show me the diff before you save.
4. Check that Boomi Companion (bc-integration) is installed. If it isn't, tell me how to install it, but don't install it yourself.
5. Run `perl -MJSON::PP -e 'print "ok\n"'`. If it doesn't print ok, tell me the command to install Perl for this system (on Debian or Ubuntu, including WSL: `sudo apt install perl`), but don't run it yourself.
6. Tell me to restart Claude Code. After the restart I'll run /bc-dashboard to check it loaded.

Never read, print or copy my .env or any Boomi credentials. The mod reads them itself.
```

**After the restart:** `/bc-dashboard` should open the pane with nothing needing attention. Perl is only for **Past Companion sessions**; macOS and Linux have it.

**Optional:** add `BOOMI_COMPANION_LOG_ACTIVITY=1` to Companion's `.env` so its scripts keep an activity log, which the dashboard reads as a [second source](#companions-activity-log).

### How it's installed, and how to update it

The install above uses no marketplace and copies nothing. Claude Code loads the mod straight from the folder named in `CLAUDE_CODE_PLUGIN_DIRS`, a git checkout of this repository (`~/ClaudeMods`). The checkout *is* the install: whatever it holds when a session starts is what runs. Other mods from the same checkout (boomi-runtime, say) update along with it.

**To update:** run `/bc-dashboard upgrade`. It does what you'd otherwise do by hand (fetch, pull, validate, test), in this order:

1. **Check.** It runs `git fetch origin` against the checkout's own `origin` remote, which is its only network call. It shows the version change, the commits, the changed files, the [changelog](CHANGELOG.md) entries in between, and which mods from the checkout it would update.
2. **Ask.** It asks before installing. `--yes` skips only this question.
3. **Refuse rather than risk your work.** It stops, changing nothing, if the checkout has uncommitted changes or commits that aren't on origin, or if the update isn't a fast-forward. It never resets, stashes, rebases or forces.
4. **Test before it goes live.** It checks out the new code in a temporary git worktree and runs `claude plugin validate` and `claude plugin test` there, for each mod it would update. If any fail, nothing is installed and you see the failing output. From the new code it runs nothing else.
5. **Install.** It records the current commit, then fast-forwards the checkout and reads the version back.
6. **Restart Claude Code.** The running session keeps the code it started with; the dashboard can't safely reload itself.

| Command | What it does |
|---|---|
| `/bc-dashboard upgrade --check` | A dry run: the check alone. Changes nothing |
| `/bc-dashboard upgrade` | Check, ask, test, install |
| `/bc-dashboard upgrade --yes` | The same without the question. The safety steps still run |
| `/bc-dashboard upgrade --rollback` | Back to the commit recorded before the last upgrade, as a detached checkout. `main` keeps the newer commits, and the next upgrade returns to it |

Anything it prints is masked for tokens and keys (`glc_`, `sk-`, `eyJ`, `Bearer …`, `Basic …`), and it never reads `.env`.

**Update nudge:** at the start of a session, at most once every `updateCheckHours` (24), the dashboard fetches its checkout to see whether you're behind. A version you haven't heard about gets one toast, `bc-dashboard X.Y.Z is available`. After that, the pane's footer says `↑ bc-dashboard X.Y.Z is available: /bc-dashboard upgrade` until you install it, and only a newer release toasts again. It never installs, and says nothing when offline. Turn it off with `updateCheck` under `/config`.

By hand, the same thing is `git -C ~/ClaudeMods pull --ff-only`, then `claude plugin validate` and `claude plugin test` on the mod, then a restart.

## What you see

`/bc-dashboard` opens the pane; Esc closes it. Where no pane can be shown, including Claude Code on the web, it prints the same thing as text.

**Its size:** drag the pane's edge, and Claude Code keeps the size you choose. To set it from the start, use `/bc-dashboard size <rows> [columns]` (`size` alone goes back to the default). It saves the `paneRows` and `paneColumns` settings, which you can also set in `/config` or `/bc-dashboard config pane`. Rows are its height above the prompt, and columns its width when docked beside a fullscreen transcript.

<img alt="The dashboard pane in the Day theme: title band, gauges for tokens, spend and context beside an 8-bit flamingo, then Needs attention with a failed test's log lines, Components this session, Claude's latest steps and Past Companion sessions" src="assets/pane-day.png" width="420"> <img alt="The same pane in the Night theme" src="assets/pane-night.png" width="420">

- **Gauges:** tokens, spend and how full the context is, with the last step's share.
- **Needs attention:** what's still broken, each with a next step.
- **Components this session:** each component's stages, tokens and cost.
- **Claude's latest steps:** what Claude just did with Companion. **More** shows older steps.
- **Guardrails:** with [boomi-runtime](../boomi-runtime/README.md) loaded, the runtime's state and smoke test.
- **Past Companion sessions:** what earlier sessions on this machine did and cost. **More** pages through them.
- **Watched components:** components you asked to watch, and who last changed them in Boomi.
- **Themes:** **Auto** (the default: Boomi's [Exosphere](https://exosphere.boomi.com/) in your system's light or dark), **Exosphere light**, **Exosphere dark**, **Whimsical light** and **Whimsical dark** (the Valence Miami Deco look with the flamingo), or **Terminal** (your terminal's colors), from the buttons or `/bc-dashboard theme whimsical-dark`. In Exosphere the mark is the Boomi logo, drawn as a picture where the terminal can (kitty and Ghostty) and left out elsewhere; in Whimsical it's the flamingo. The choice is saved as the `paneTheme` setting, so `/config` shows it too. Earlier versions' `day` and `night` are Whimsical light and dark, and a banner icon of `flamingo` keeps Auto in Whimsical. Auto reads macOS's light or dark setting; where it can't be read (Linux, Windows, a locked-down shell) it is light, and the buttons pick one for good.

A banner above the prompt shows the latest step and what needs attention, and the status line and toasts carry the same news. In a new session, before Companion does anything, the status line says so (`New session · last one 14h ago, nothing left to fix · $0.00 this session`) rather than repeating the last session's step:

```text
◆ BC Dashboard ✓ Saved Orders Sync to Boomi (v4) 2m ago │ ✗ 1 needs attention │ 3 components │ 338k tokens · $0.54   [ Open ]  [ Hide ]
```

**A new session** in a Companion workspace opens with what the last session in that folder did, then turns through tips every 20 seconds until Companion does something:

```text
◆ BC Dashboard ✓ Last session 14h ago: 4 components · 6 saves · 2 deploys · 3 tests (1 failed) · nothing left to fix · $3.10 │ $0.00 this session   [ Open ]  [ Hide ]
◆ BC Dashboard Tip: Why? on a failed test reads its log; Ask Claude to fix drafts the request │ $0.00 this session   [ Open ]  [ Hide ]
```

Where Claude Code can say which Companion plugins are on, the first tip names them, and tips about a plugin you don't have are left out:

```text
◆ BC Dashboard Companion here: Integration 1.0.83 · Data Hub 0.2.12 │ $0.00 this session   [ Open ]  [ Hide ]
```

Anything left to fix from the last session stays under **Needs attention**, and the banner counts it. Outside a Companion workspace (no component folder, activity log or earlier session there), the banner stays hidden.

## Stages and what needs attention

| Stage | Means |
|---|---|
| ◐ edited, not in Boomi yet | Claude changed the XML; Companion hasn't created it in Boomi. |
| ◐ edited since last save | Claude changed the XML after Companion last pushed it. |
| ✓ saved v4 | Companion pushed it; Boomi has version 4. |
| ✓ deployed / ◐ redeploy needed | Deployed, or saved again since, so the environment runs an older version. |
| ✓ test passed / ✗ test ERROR | The latest test execution's result. |
| ⚠ save blocked | Another mod refused the push. |
| ✗ save failed, ✗ deploy failed | Companion's script reported an error. |

Icons always come with a label: ✓ done, ◐ in progress or still to do, ⚠ blocked or unreachable, ✗ failed. A later success clears an earlier failure.

Each item under **Needs attention** has buttons:

- **☐** closes it, for a failure you expected or handled another way. Closed items stay closed across restarts; **Reopen** brings them back.
- **Why?** (failed tests) runs Companion's `boomi-execution-query.sh --logs` and shows the log's `SEVERE` lines. **Ask Claude to fix** then puts a fix request with those lines in the prompt box, after anything you've typed. Nothing is sent until you press Enter.
- **Why?** (failed BDI runs) follows bc-bdi's own troubleshooting guide. It shows the reason BDI gave for the failure. For a logic flow, it also shows the first step that failed (`bdi-flow.sh steps`). Then it shows the run log's `ERROR` lines in the order they happened (`bdi-flow.sh logs`). Both reads leave the flow as it is. **Ask Claude to fix** drafts a request to find the cause and propose a fix, without changing the flow until you approve it.
- **Run again** (failed tests Claude ran) repeats the same `boomi-test-execute.sh` call, without a turn of Claude's. A pass clears the failure.

Without a pane: `/bc-dashboard close <n>`, `why` and `rerun`. With nothing that fits, `why` and `rerun` say so; with one failure, they act on it; with several, they ask which in Claude Code's question dialog (the four newest, and **Other** takes a number). A number from `/bc-dashboard text` skips the question.

When Claude finishes a turn with a process saved but not deployed, or deployed but not tested, the prompt box suggests the next step ("Deploy Orders Sync and test it"). Tab takes it.

## Companion's other plugins

Boomi Companion is [six plugins](https://github.com/OfficialBoomi/boomi-companion). Besides bc-integration's components, the dashboard follows the other five through their scripts, the same way:

| Plugin | Steps it shows |
|---|---|
| bc-marketplace | Recipes installed (`Marketplace: installed recipe Salesforce to NetSuite Orders · 4 components`) and their supporting materials downloaded. The components a recipe copied join **Components this session**, starting `✓ from recipe …`; pull one and its name and later stages fill in the same row |
| bc-datahub | Models created, updated, published and given quality steps; sources and their initial loads; universes deployed; quarantined records approved or rejected; golden records updated, end-dated or restored. A deploy shows `◐ deploying` until its response or Claude's `datahub-deployment.sh status` says how it went, and a failed one needs attention. When Claude lists a universe's quarantine (`datahub-quarantine.sh query --universe <id>`), a **Data Hub** section keeps the count and causes, records in it need attention, and an empty list clears it |
| bc-bdi | Flows run, cancelled, activated, created or restored; CDC turned on or off; connections, environments, variables and dataframes changed. A run shows `◐ run started` until Claude checks it with `bdi-flow.sh status`, then how it ended: ✓ succeeded, cancelled, or ✗ failed with BDI's reason under **Needs attention** |
| bc-agentstudio | Agents, tools and MCP servers created or updated; agents packaged and deployed; test conversations with a deployed agent. An **Agentstudio agents** section shows each agent's stages, as components have: `✓ created  ✓ packaged v2  ✓ deployed  ✓ 2 test conversations, 5 turns, all answered`. An edit after packaging shows `◐ changed since packaged` until a new package is deployed. A conversation joins its agent through the deployment it talked to; a turn that fails (an HTTP error, a stream's `event: error`, or a reply that says `success: false`) needs attention |
| bc-connectordev | Connector projects created and checked; descriptors linted and validated; versions uploaded; groups and version changes. A **Custom connectors** section follows each connector's release, by its project folder and group: `✓ descriptor linted  ✓ validated  ✓ uploaded v2  ✓ v2 active on dev`. An upload shows `◐ v2 not active yet` until a version change makes it active, and a PUBLIC connector's change shows `◐ awaiting approval`. A lint that fails names the line and element; a descriptor validated with warnings, or rejected, needs attention |

**Only the sections that apply.** Just after a session starts, the dashboard asks Claude Code which plugins are on in that folder (`claude plugin list --json`, which knows about user, project and synced installs and disabled plugins). If the CLI can't be run, it reads Claude Code's own `plugins/installed_plugins.json` and settings. Then:

- **Components this session** shows only where bc-integration or bc-marketplace is on.
- **Data Hub**, **Agentstudio agents** and **Custom connectors** show for an installed plugin even before there's anything in them, with a line saying what will appear there.
- A section with something in it always shows, installed or not. If the list can't be read at all, every section shows, as before 0.24.0.

- A step that only reads (`list`, `get`, `query`, `status`, `logs` and the like) isn't shown, as bc-integration's searches aren't.
- A failed step (an `ERROR:` line, or the script exiting with an error) goes under **Needs attention** with its error line, until the same action succeeds. A step that finished with a `WARNING:` line, such as a connector descriptor accepted with warnings, shows as ◐ and needs attention too.
- When a session works with more than one product, the pane, `/bc-dashboard text` and the report split the spend: `By product: Integration $1.20 · Data Hub $0.40`. The report lists the other plugins' steps in a section of their own.
- **Past Companion sessions** count sessions that used any of the plugins, and say what each did with them (`2 Data Hub steps · 1 BDI step`).

The wording comes from the plugins' scripts as of October 2026 (bc-marketplace 0.2.10, bc-datahub 0.2.12, bc-bdi 0.2.5, bc-agentstudio 0.1.42, bc-connectordev 0.0.50). The tests use those scripts' own `SUCCESS:`, `ERROR:` and `WARNING:` lines. Each plugin's live output still needs checking in a real session; see [CHECKLIST](../CHECKLIST.md).

## Tokens and spend

The headline counts **new tokens**: input, output and cache writes. **Cache reads**, the conversation re-read on every call, are shown apart (`+3.3M cached`): they're billed at a fraction of the price, and counted in, they'd dwarf the work done. `/bc-dashboard text` splits the session by kind, and by model when there was more than one:

```text
Tokens: 412k new (18k in · 44k out · 350k cache writes) · 3.30M cache reads
```

Spend is the session's cost as `/cost` reports it. On a Claude seat, that's what the same use would cost on the API, not a bill. A step's share is what Claude spent since the previous step; a component's is all its steps.

**Budget:** set `budgetUsd` and the status line, summary and SPEND gauge warn from 80% (`◐ 84% of the $5.00 budget`) and once it's spent, with one toast at each mark. By default that's all: nothing is stopped. To have a spent budget actually pause or stop Companion's changes, see [Budget enforcement](#budget-enforcement).

### Your Claude usage limits

On a Claude seat (Pro, Max, Team or Enterprise), the dashboard reads your usage limits as Claude Code reports them, with no setup. Those are the 5-hour and weekly windows, and an admin's spend limit when one is set.

- **LIMITS** in the pane shows the busiest window, when it resets, and where your pace leads: `◐ used up in 1d 6h` when you'd run out before it resets, else `on pace for 64% by reset`.
- The banner shows them in a few characters (`week 42% · 5h 12%`). The status line, `/bc-dashboard text` and the report say more.
- A toast at 80% of a window, and one when it's used up, once per window.

On an API key there are no limits to read, so none of this shows.

**Your monthly Claude budget, in dollars.** The same headless `/usage` run reports the account's monthly budget and what's used (the figure the interactive `/usage` shows), so BUDGET shows `Claude budget: $380 of $1100 this month` with no setting. It's the account's own figure, other devices and claude.ai included, and it warns at 80% and when it's used up, counts for `budgetEnforce`, and needs extra usage turned on for the account. Claude Code doesn't document this field, so if it changes the line goes quiet rather than guessing. For a login that reports only a spend limit in percent, `seatBudgetUsd` (or **Your Claude budget** in `/bc-dashboard config budget`) turns that percent into dollars.

**When it resets, and where the month leads.** The budget resets at 00:00 UTC on the 1st (Oct 31, 8:00 PM EDT for a login on Eastern time; Claude Code and Claude Desktop say the same). Claude Code gives no history, so the dashboard keeps the last figure of each day with the reading and shows, under the budget, `Claude pace: on pace for $811 (74%) by the reset in 15d 4h` (the month's average so far carried to the reset; at a pace that would pass the limit it says `at $61/day it's used up in 3d 0h, before the reset in 16d 4h`) and `Claude spend: $30 today · $26/day this month`. The pace waits for a tenth of the month so the first days don't project wildly. These are readings and estimates, never counted as a spent budget, and they appear in the pane, `/bc-dashboard text`, and both reports. A billing cycle that doesn't start on the 1st (UTC) would make them wrong, and the budget itself would still show correctly.

**Companion's share of all your usage.** Every 15 minutes the dashboard runs `claude -p "/usage" --output-format stream-json --verbose --no-session-persistence --safe-mode`: no model call, no session kept, none of your hooks or plugins loaded, nothing to pay. Sessions on this machine share one reading. From Claude Code's own breakdown it shows `Companion: ≥20% of your usage today · ≥18% this week` (the `bc-*` plugins added up; a lower bound, since only the top plugins are listed) and the habit behind most of the week's usage, such as `44% of your usage was at >150k context`. It's Claude Code's estimate from this machine's sessions, not claude.ai or other devices. Off a subscription the command has no breakdown, and nothing shows. `usageBreakdown` turns it off.

### Your own Companion budget

Two optional settings under `/config` give Companion work a budget of its own. Both warn in the status line from 80% and toast at 80% and 100%. Under the default `budgetEnforce` (`warn`) they stop nothing. With `confirm` or `block`, a spent budget really does stop Companion's changes: see [Budget enforcement](#budget-enforcement).

**BUDGET** in the pane shows every budget you set, `budgetUsd` included: the fullest one's meter, then a line each, such as `✓ month: $32.10 of $50`, `◐ share, today: 84% of 30%` or `✓ session: $1.25 of $5.00`. Without a budget set, it doesn't show.

- **Relative, `companionShare`:** a percent of your weekly limit that Companion may use, over `companionSharePeriod`: `week` (the last 7 days), `day` (today, a seventh of the share) or `month` (this month, the month's days in sevenths). With 30% per day, Companion gets 4.3% of your weekly limit each day: `Companion today: 2.1% of your weekly limit, 49% of its 4.3%`. From a session's first Companion step, the dashboard counts how far the weekly limit rises, by day, and adds up Companion sessions on this machine.
- **Explicit, `companionMonthlyUsd`:** an amount for this calendar month's Companion sessions, counted in Claude Code's own cost figures: the earlier sessions from **Past Companion sessions** (scanned for you, about once an hour), plus this one live.

The limit is shared, so in a Companion session anything else that uses Claude at the same time, on this machine or another, counts too. Sessions on other machines, and Claude Code on the web, aren't added up.

### Set up a budget

There are three budgets. Set any of them, or none. By default they only warn. With `budgetEnforce` set to `confirm` or `block`, any one of them that's spent pauses or stops Companion's changes, as the next section explains.

| You want to cap | Setting | Works on | Example |
|---|---|---|---|
| This one session's cost | `budgetUsd` | a seat or an API key | `5` warns at $4.00 and $5.00 |
| Companion's share of your weekly Claude limit | `companionShare` and `companionSharePeriod` | a Claude login that reports a weekly limit; otherwise the share shows as not measured | `30` and `day`: about 4.3% of the weekly limit each day |
| Companion's cost this calendar month, all sessions on this computer | `companionMonthlyUsd` | a seat or an API key | `50` warns at $40 and $50 |

Not sure? On a Pro or Max seat, start with `companionShare` (your limit is what runs out). On an API key, start with `companionMonthlyUsd` (your bill is what grows).

**With the dashboard (easiest):** run `/bc-dashboard config budget`. It asks about each budget in turn, starting with your current value. It offers figures from what your past Companion sessions cost, such as "twice a typical session" or "a quarter above the last 30 days". Pick one, keep what you have, or type your own under **Other**. The changes are saved to `/config` and take effect at once.

**In `/config`:**

1. Run `/config`.
2. Find the **boomi-dashboard** rows: **Spend budget (USD)**, **Companion's share of your usage limit (%)**, **Companion share period** and **Companion's monthly amount (USD)**.
3. Type a number (no `$` or `%`), or pick the period. `0` turns a budget off.
4. The dashboard reloads with the new values. If the pane doesn't show **BUDGET** within a minute, restart Claude Code.

**In the settings file:** the same values live in your user settings, `~/.claude/settings.json`, under `pluginConfigs`. Add or edit only this block, and keep the rest of the file as it is:

```json
{
  "pluginConfigs": {
    "boomi-dashboard": {
      "options": {
        "budgetUsd": 5,
        "companionShare": 30,
        "companionSharePeriod": "day",
        "companionMonthlyUsd": 50
      }
    }
  }
}
```

Numbers go in without quotes. The period is `"day"`, `"week"` or `"month"`. Leave out a budget you don't want, or set it to `0`. Then restart Claude Code.

**Check that it took:**

- The pane shows a **BUDGET** gauge with a line for each budget you set, such as `✓ session: $1.25 of $5.00` or `◐ share, today: 84% of 30%`.
- `/bc-dashboard text` prints the same lines.
- No **BUDGET** gauge means no budget is set, or the value isn't a number. Open `/config` again and check.

**When it warns:** at 80%, the status line shows `◐` and the percent, and one toast appears. At 100% you get `✗` and a second toast. Each toast shows once, not on every refresh. To keep working past a budget, raise it or set it to `0`.

### Budget enforcement

> **This is a real blocker when you turn it on.** With `budgetEnforce` set to `confirm` or `block`, the dashboard stops Claude's Boomi Companion changes once a budget is spent. The command never runs: Companion and Boomi never see it. It's off by default (`warn`).

`budgetEnforce` decides what a spent budget does:

| `budgetEnforce` | Once any budget you set reaches 100% (plus `budgetGrace`) |
|---|---|
| `warn` (default) | Warns as above. Nothing is stopped. |
| `confirm` | Before each Companion change, asks you: **Allow this one**, **Allow for the rest of this session**, **Raise the budget** (opens `/bc-dashboard config budget`, then lets the change through if the budget is no longer spent) or **Stop**. Closing the question stops the change. |
| `block` | Refuses each Companion change outright. |

**What counts as a Companion change:** creating, saving (push), deploying, undeploying and test-executing a component; bc-integration's other changing scripts (creating a folder, creating or deleting a branch, setting extensions, calling a deployed web service, and creating Event Streams topics, subscriptions, tokens or connections, or sending a message to a topic); and the other plugins' subcommands that change something, the same ones the dashboard counts as steps. Also gated:
- a call straight to the Platform API that changes something: PUT, PATCH, DELETE, or a POST that isn't a query, sent with curl, wget or HTTPie to `api.boomi.com`;
- a local script that Claude runs (`bash run-all.sh`) and that contains any of the above. The dashboard reads the script first.

**Never stopped:** reads (list, get, query, status, logs, pull, search; the Platform API's GETs and `…/query` POSTs); checks and scaffolding on your machine (a connector's descriptor lint, doctor, init and validate); downloads (a Marketplace bundle's supporting materials); cancelling a BDI run, which only stops spending; the dashboard's own tools, and **Why?** and **Run again** when you press them in the pane. A change that's already running when the budget runs out always finishes.

**`budgetGrace`** (percent, default `0`) lets work run a little past a budget before enforcement starts: `10` means at 110%.

**What you see:**
- A refused change shows as `⚠ Blocked by budget` in Claude's latest steps and under **Needs attention**, naming the budget and how far over it is.
- The status line and the banner say `⛔ budget reached, Companion changes paused`, and one toast says so when it starts.
- Every override you grant in `confirm` mode is recorded as a step and listed under **Budget overrides** in `/bc-dashboard report` and the HTML report, and shown on the change it let through under **Platform changes**, as an audit trail.

**What Claude is told:** with your next prompt after enforcement starts (and again when it changes), Claude gets a short note that the budget is spent and changes are paused, so it plans without them. This costs about 80 tokens each time. A refused call tells Claude which budget is spent and by how much, to stop and report to you, and not to work around the block (no curl to the API, no running the script another way).

**Limits:** the gate reads the commands Claude runs through the Bash tool. A change made some other way, such as a script that builds its command at run time, a program in another language, or work you do yourself in a terminal, isn't seen. The deny message tells Claude not to try.

**Set it up:** run `/bc-dashboard config budget` and answer the **When a budget is spent** and **Grace past a budget** questions, or set `budgetEnforce` and `budgetGrace` in `/config`.

## Prompt tips

The dashboard checks each prompt you type in a Companion folder for what Boomi work needs and the prompt leaves out, and suggests a better one. The checks are plain rules, with no model call, so they cost nothing.

| Check | Fires on | The tip names |
|---|---|---|
| `subject` | "it", "this" or "the process" with no component named | The component Claude worked on last |
| `environment` | A deploy with no environment | The environment Companion's `.env` points at |
| `error` | "Fix it", "still failing" with no error, log or execution ID | The last failure and its execution ID |
| `test` | A test with no test data or expected result | What to add |
| `production` | "prod", "production", "live orders", "customer data" | That Claude should ask first (⚠) |
| `build` | A new process with no source and target, trigger or data format | What's missing |
| `map` | A map with no profiles or fields | What to add |
| `steps` | Three or more big steps at once (build, deploy, test, fix) | To stop between them |
| `aim` | A look around the account with nothing named to find ("check out my account") | What to ask for. It only nudges: `confirm` doesn't hold a prompt for it alone |
| `secret` | A password, token, API key, auth header or private key | That it will be masked (⚠) |

For example, `deploy it and test it, still failing` after a failed test of Orders Sync gets:

```
◐ "it": the process Orders Sync, the last one this session?
◐ deploy: no environment named; the session points at 9f8e7d6c…
◐ fix: no error given; the last failure was the test of Orders Sync (execution-aaaa1111)
◐ test: say what to test with, and what a pass looks like

Upgraded:
  deploy it and test it, still failing. By "it" I mean the process Orders Sync (1a2b3c4d-…).
  Deploy to environment 9f8e7d6c-…. The last failure was the test of Orders Sync
  (execution execution-aaaa1111): …. Read its process log and tell me the cause before
  you change anything.

  Details:
  - Test data: [what to test with]; a pass means [the expected result]
```

The upgrade adds only what the session knows, as sentences. What it doesn't know is a **Details** list of `[placeholders]` for you to fill in; it never makes up a name or an ID.

**What you see:** a gentle nudge in the banner just above the prompt box, `◆ BC Dashboard ◐ Boomi Dashboard suggests a clearer prompt · 4 tips`, with **Use it** (the upgrade goes in the prompt box), **See it** (the Prompt tab) and **✕**. It goes away with your next prompt. The status line says `◐ 4 prompt tips: /bc-dashboard prompt`, and `/bc-dashboard prompt` shows the tips and the upgrade, on the web too.

**The Prompt tab.** **See it**, or a prompt with tips, opens **Boomi Dashboard Prompt tips** in the dashboard pane's place. Claude Code can't bring a tab to the front, so the dashboard pane steps aside and comes back with **◀ Dashboard**, **Dismiss**, or a prompt with nothing to add. The tab shows the tips, your prompt beside the upgrade (one above the other in a narrow pane), then the buttons right under them:

- **Use the upgrade** puts it in the prompt box. **Copy** copies it. **Dismiss** closes the tab.
- A long prompt or upgrade is fitted to the pane so the buttons stay in view: `▼ 14 more lines` and **Show all**, then **Jump to the buttons** and **Fit to the pane**.
- **Upgrade with a model**, then **Regenerate**, has `promptModel` rewrite it. Type a note under them (`shorter`, `ask for a listener`, `split into steps`) and press Enter to regenerate following it; a long note wraps in the field. Every try is kept: **◀** and **▶** step through them, each with the note it followed.

**What a rewrite reads,** besides your masked prompt and the session's facts:
- **This folder's components** whose names share words with the prompt (up to 8, from the component XML under `componentsDir`), so "the Salesforce connection" can name the one you have. It uses a name only where the prompt clearly means it.
- **Companion's own guidance:** the sections of bc-integration's reference docs (such as `BOOMI_THINKING.md`) that best match the prompt's words, up to 3, so the rewrite asks for what Companion needs for a listener, a map or a connection.
- **Your note** and **the try before**, so each regenerate is different.

The rewrite never adds features, steps or logic you didn't ask for: the components and guidance only decide which existing names fit and what to ask you, and a gap becomes a question or a `[placeholder]`. It reads only the facts a tip needs, such as the last failure only for a fix.

The tab says how much of each it read. It's a plain word match, with no index or embeddings to set up. A rewrite reads a few thousand tokens, and only when you press the button.

The dashboard pane shows `◐ 4 prompt tips for your last prompt` with a **Prompt tips** button. `promptView` decides when the tab opens by itself: `auto` (default) when a prompt gets tips, `manual` only when you ask, `off` never.

- `/bc-dashboard prompt use` puts the upgrade in the prompt box.
- `/bc-dashboard prompt upgrade [a note]` has the model rewrite it, following the note, and puts that in the prompt box.

**`promptCheck`** decides what a tip does:

| `promptCheck` | A prompt with tips |
|---|---|
| `confirm` (default) | **Holds it:** Claude doesn't see it yet. The Prompt tab and the banner say `⏸ Held`, with **Send the upgrade**, **Send as typed**, **Edit in the prompt box** and **Discard**; the status line says `⏸ prompt held`. A new prompt takes the place of a held one. Where the tab can't show (the web, a narrow window), a question asks instead, and closing it sends the prompt as typed. |
| `suggest` | Goes to Claude as typed; the tips show afterwards, with the nudge above the prompt box. |
| `off` | Nothing is checked. |

**A secret always asks, even in `suggest`,** because once it's sent it stays in the transcript: **Send it with the secret masked**, **Edit it first** or **Send it as typed**. Closing the question sends it masked.

**What's left alone:** slash commands, prompts typed while Claude works, messages from other sessions and background tasks, short replies ("yes", "keep going"), prompts with no Boomi words in them, and anything outside a Companion folder. Start a prompt with `>` to send it unchecked (the `>` is taken off).

**Privacy:** the prompt is masked before it's kept, kept only in this session's state, and never logged or saved across sessions. A held prompt is kept as typed, in this session only, until you send or discard it. The model rewrite reads the masked prompt, the session's facts, matching component names and Companion's docs, never Companion's `.env` or its token; the dashboard reads only `BOOMI_ENVIRONMENT_ID` from it for the tips.

**Counted:** `/bc-dashboard prompt` and the session report say how many prompts were checked and had tips, how many tips your next prompt followed, and which tip came up most.

**Skip a check:** list it in `promptSkip`, such as `promptSkip test,steps`.

## Watched components

`/bc-dashboard watch <component ID or XML file>` watches a component across sessions. Every 60 seconds the dashboard reads (never writes) its version in Boomi; when someone other than Companion's API user changes it, it shows under **Needs attention**: pull before you push. `/bc-dashboard seen` clears the changes you expected. With nothing watched, the dashboard makes no Platform API calls.

Credentials come from Companion's `.env`, falling back to environment variables: `BOOMI_API_URL`, `BOOMI_USERNAME`, `BOOMI_API_TOKEN`, `BOOMI_ACCOUNT_ID`. The token goes only into requests' `Authorization` header; the dashboard never stores, shows or logs it, and its errors carry only the HTTP status. Without credentials, everything else still works.

Up to 0.10.0 the dashboard also polled the environment's process runs. That's set aside for now and will come back; see [IDEAS](../IDEAS.md#dashboard-follow-ups).

## Companion's activity log

With `BOOMI_COMPANION_LOG_ACTIVITY=1` in its `.env`, Companion's scripts append each operation to `.activity-log/activity.jsonl` in the workspace, on this machine only. The dashboard reads it every 10 seconds while it changes, and adds what Claude's tool calls didn't show: a script run in a terminal, by another tool, or before the mod loaded. Those steps say **log** in the pane and "from Companion's log" in `/bc-dashboard text`.

- Creates, pushes, pulls, deploys, undeploys and tests become steps, with the same stages and **Needs attention** items as Claude's own. Searches, folder lists and the like are left out.
- A script Claude ran is in both places; its log entry matches the step Claude's tool call made, so it shows once.
- Only the last 24 hours (`recentHours`) count. A log over 3.5 MB is read from its end.
- `activityLog` under `/config` turns it off.

## Past Companion sessions

In the pane the section starts folded to its totals and a count, so this session keeps the room: **▸ Show** lists the sessions, **▾ Hide** folds them again, and the choice is kept for later sessions.

**Scan** in the pane, `/bc-dashboard history`, or the `history` tool lists the sessions on this machine from the last `historyDays` days that ran a Companion script. Each one says when it started and how long it ran, what it cost, what it was about (its title if you named it with `/rename`, else your first request), and what it did:

```text
Boomi Companion sessions on this machine, last 90 days:
  This week: 3 sessions · $18.40 · 1.2M tokens
  Last 30 days: 9 sessions · $61.75 (+1 without a recorded cost) · 4.1M tokens

  Oct 10, 14:05 · 47m · $6.10 · "Build the orders sync process and test it"
      2 pushes · 1 deploy · 2 tests · Orders Sync, Order Profile · 410k tokens
```

- The cost is Claude Code's own, as `/cost` showed it, read from the transcript. Older Claude Code versions didn't record it; those sessions show tokens only.
- A session counts only if it ran a Companion script, not if it only looked at one. The folder shows on each line only when sessions come from different folders.
- **Review one:** **Review** beside a session shows what drove its cost, read from the transcript's figures, each with a change for next time. It flags the largest model doing most of the work (`/model`), a long conversation re-read on every call (`/clear`), a context that grew large (`/compact`), a session that kept compacting, the same test or push run again and again, and subagents doing much of it. **Ask Claude to review** drafts a request for a closer look in the prompt box, naming the transcript; nothing is sent until you press Enter, and that look costs a turn. `/bc-dashboard review [n]` gives the same in text; without a number it asks which of the four costliest sessions of the last 30 days.
- **Reopen one:** **Copy** beside a session puts the command that reopens it on the clipboard, `cd <its folder> && claude --resume <session ID>`, to paste into a new terminal. `/bc-dashboard resume` does the same from the prompt: with several sessions it asks which, and `resume <n>` takes the nth newest. Where the clipboard can't be reached, the command is shown to type instead.
- Transcripts are often tens of MB, past the 4 MiB a mod can read at once, so `scripts/scan-sessions.pl` reads them a line at a time and returns only each session's totals and the commands that name a Companion script. It needs Perl, which macOS and Linux have. **On Windows, run Claude Code in WSL.**

## Session report

`/bc-dashboard report` prints the session as Markdown for a pull request, ticket or hand-off: components, deployments and tests, what needs attention, the platform changes, runs and spend. `report save` also writes it to `boomi-session-report-<date>.md`. Claude can ask for it with the `report` tool.

### As a web page to share

`/bc-dashboard report html` saves the report as one file in the workspace and opens it in your browser. The pane's footer has a quiet **Report ↗** button, right of the session ID, that does the same. Send it to anyone, including people who don't use Claude Code. Nothing in it is live: it's a snapshot with no credentials, and anything shaped like a token is masked.

- **This session or all of them.** When the dashboard kept steps from earlier sessions in this folder, it asks which to cover. **This session** saves `boomi-session-report-<time>.html`. **All sessions in this folder** saves `boomi-sessions-report-<time>.html`, with a **Sessions** table giving each session's ID, when it ran, its steps, failures, components and cost. Costs are Claude Code's own, from each session's transcript (it scans them first if the last scan is over an hour old). Where no transcript covers a step, the cost is "at least" what the session had cost by its last Companion step, and one that wasn't recorded shows as **—**, never $0. `report html session` or `report html all` skips the question.
- **Opening it:** it uses your system's opener (`open` on macOS, `wslview` or Explorer under WSL, `xdg-open` on a Linux desktop). Where there's no browser (a container, a server), it just says where the file is. `--no-open`, or `reportOpen` set to off, saves without opening.
- **The top of the page** is a navy band holding the title, the summary in sentences and your budgets. The sessions follow, on a card of their own. The Boomi account (name, account ID, environment ID, API host) follows on one line. The account details come from Companion's `.env`, but the API token and user name never go in the page.
- **Budgets:** each budget you set under `/config` gets a meter showing how far along it is: `budgetUsd` for the session, `companionMonthlyUsd` for the month's Companion spend, and `companionShare` for Companion's share of your Claude limit. Past 80% a budget says so with its icon, and past 100% it shows as spent. In an all-sessions report, each session is also held against the session budget, on its row and in the summary ("1 session reached the $5.00 session budget"). With no budget set, the report says how to set one.
- **The sessions,** oldest first, one row each: when it ran and for how long, how long after the one before, what it did in words ("Orders Sync: created, deployed, tested (1 failed) · and 3 housekeeping steps"), how its steps went (each status with its icon and count), and what it cost. With a session budget set, the cost also shows that session's share of the budget. Click a row for that session's steps.
- **Components** are swimlanes: one row per component, with columns for **Saved**, **Deployed** and **Tested**. Each stage is in the dashboard's own words with its icon, when it happened, and the ID to find it by: Boomi's current version, the deploy package, the test execution. Boomi's view of the component (type, folder, current name) and **Open in Boomi** sit under its name. Click any ID to copy it.
- **Claude's steps,** grouped by session. Only the newest session that did real work starts open; the others fold to their heading. Search them, filter to what failed, to deploys and tests, or to one product, and open one (or **Expand all**). A failed step shows what went wrong without being opened, and housekeeping steps (connection checks, listings) read quieter than the work.
- **What's missing says so.** A dash means it didn't happen. An ⓘ note means it should be there but couldn't be found, such as a name, a package or execution ID, a cost, or Boomi's own details. "Not set up" says how to turn something on, such as a budget or the Boomi account. Hover over any of them for the reason.

It follows Boomi's [Exosphere](https://exosphere.boomi.com/) design system: its Exo III color tokens, light and dark (the moon or sun button at the top, or your system's setting), Poppins headings and Noto Sans text, its cards, badges and alerts. Every status shows its icon and its label, never color alone.

**Another style:** set `reportStyle` to `expressive` (in `/config` or `/bc-dashboard config data`), or add `--style expressive` to one report. That report uses this repository's own Valence theme, Miami Deco: Sand by day and Midnight Navy by night, Poiret One for the title, Josefin Sans headings, Deco Gold rules, and Flamingo marking the sessions. Status keeps Valence's fixed colors, with its icon and label. Keep `exosphere`, the default, for anything Boomi people will read.

- **Charts** appear only when they add something: outcomes and spend by product when the work spans two products or more, cost over the session in a one-session report, and in an all-sessions report with two sessions or more, each session's cost and how its steps went (click a session to open its steps). Each has hover details and a **Show the data** table, and products keep the same color in every chart.
- **Tables** of custom connectors and Agentstudio agents, sorted by clicking a column.

**To take the components elsewhere,** use the buttons above the Components table:
- **Copy for a spreadsheet** copies tab-separated text. Paste it into the first cell in Excel, Google Sheets or Numbers.
- **Copy as CSV** copies the same table as CSV.
- **Save as CSV** downloads it as a file.

Each row has the component's name, type, folder, ID and version in Boomi; its last deploy (how it went, when, and the package ID); its last test (how it went, when, and the execution ID); its cost; and its link in Boomi. In Claude Code, `/bc-dashboard components` copies the same table, `components csv` copies it as CSV, and `components save` also writes a `.csv` file into the workspace. A name that a spreadsheet would read as a formula is pasted as text.

**Platform changes** lists every change the session made in Boomi, oldest first, as an audit trail for a change ticket. That covers creates, saves, deploys, undeploys and tests; folders, branches and extensions created, deleted or set; Event Streams topics, subscriptions, tokens and messages; web service calls; and the other plugins' changes. Edits, pulls, reads (`branch list`, `extensions get`) and local checks are left out. Each row has when the change ran, what it did, how it went, the ID it left (version, package, execution or run) and, when a budget override let it through, which one: allowed once or for the session, with the budget that was spent. A change the budget gate refused shows as `⚠ blocked by budget, not run`. The same buttons copy or save it, as `boomi-changes-<date>.csv`, and the Markdown report has it as a table.

**To print it or keep it as a PDF,** press **Print or save as PDF** at the top of the page, or use your browser's Print, and pick **Save as PDF** to keep a copy. The printout:
- is always in the light theme, whatever the screen shows;
- has every session's steps unfolded, though each step's details stay closed (a failure's reason shows anyway);
- fits the tables to the page;
- prints each Boomi link's address under it;
- keeps rows and charts from splitting across pages;
- has the report's name and date at the top of each page, and its page number at the bottom.

The buttons, search and filters are left off.

With a connection it loads its fonts from Google Fonts; offline it falls back to your system's fonts.

## Commands and tools

| Command | Tool | Does |
|---|---|---|
| `/bc-dashboard` | | Opens the pane (Esc closes it), or prints the dashboard where no pane fits. |
| `/bc-dashboard text` | `summary` | The dashboard as text. |
| `/bc-dashboard poll` | | Checks the watched components in Boomi now. |
| `/bc-dashboard why [n]` | | The `SEVERE` lines of a failed test's log; without a number, asks which. |
| `/bc-dashboard rerun [n]` | | Runs a failed test again; without a number, asks which. |
| `/bc-dashboard close <n\|all>` / `reopen` | | Closes items, or brings them back. |
| `/bc-dashboard earlier` | | Shows this folder's steps from before the last 24 hours too. |
| `/bc-dashboard size <rows> [columns]` | | The pane's size, saved as `paneRows` and `paneColumns`; `size` alone goes back to the default. |
| `/bc-dashboard seen` | | Moves watched changes out of **Needs attention**. |
| `/bc-dashboard watch <id\|file>` / `unwatch <id>` | `watch` | Watches a component, or stops. |
| `/bc-dashboard report [save\|html [session\|all] [--no-open]]` | `report` | The session report; `html` saves it as a web page to share and opens it, for this session or all of this folder's. |
| `/bc-dashboard history` | `history` | Past Companion sessions and their cost. |
| `/bc-dashboard resume [n]` | | Copies the command that reopens a past session in a new terminal; without a number, asks which. |
| `/bc-dashboard review [n]` | | What drove a past session's cost, and what to change next time; without a number, asks which of the costliest. |
| `/bc-dashboard theme [name]` | | Picks the pane's theme, or lists them. |
| `/bc-dashboard components [csv] [save]` | | Copies every component with its IDs, tab-separated for a spreadsheet (`csv`: as CSV; `save`: also writes a `.csv` file). |
| `/bc-dashboard config [budget\|pane\|data]` | | Walks through the dashboard's settings a question at a time, or one group of them. `config <setting> <value>` sets one, such as `config budgetUsd 5`. `config list` shows them all. |
| `/bc-dashboard prompt [use\|upgrade]` | | Your last Boomi prompt's [tips](#prompt-tips) and an upgraded prompt; `use` puts it in the prompt box, `upgrade` has a model rewrite it. |
| `/bc-dashboard banner` | | Shows the banner again after **Hide**. |

Claude sees the tools as `mcp__boomi-dashboard__<tool>`. Ask "what's left to fix?" and it answers from the summary.

## Setup and settings

- **Your own computer:** see [Install](#install).
- **Claude Code on the web:** add the folder to `CLAUDE_CODE_PLUGIN_DIRS`, separating mods with `:`.
- **One terminal session:** `claude --plugin-dir boomi-dashboard`.

**Watched components** need network access to `api.boomi.com`. Settings are under `/config`, or a question at a time with `/bc-dashboard config`:

| Setting | Default | |
|---|---|---|
| `paneTheme` | `auto` | The theme: `auto`, `exosphere-light`, `exosphere-dark`, `whimsical-light`, `whimsical-dark` or `terminal`. The theme buttons and `/bc-dashboard theme` set it too. `day` and `night` still work as `whimsical-light` and `whimsical-dark`. |
| `paneRows` | `0` | The pane's height above the prompt, in rows; `0` leaves it to Claude Code. A size you drag it to wins. |
| `paneColumns` | `0` | The pane's width when docked, in columns; `0` leaves it to Claude Code. |
| `logo` | `true` | The mark in the pane and the banner. In the Exosphere themes it is the Boomi logo, a picture where the terminal draws pictures (kitty, Ghostty); in the Whimsical themes it is the 8-bit flamingo, standing on one leg in a thin line of seafoam water. Every 15 seconds or so it glances back over its shoulder or blinks; now and then it shifts to the other leg or turns around; and once in a while a neighbour peeks in to say hello. Off hides the mark in either. It replaces `flamingo`, `bandIcon` and the banner's diamond. |
| `bandAnimation` | `true` | The banner's flamingo swaps for a sparkle for a second in every five. Only in the Whimsical themes. |
| `recentHours` | `24` | How far back earlier sessions' steps and Companion's activity log count. |
| `envFile` | `.env` | Companion's `.env`, relative to the working directory. |
| `componentsDir` | `active-development` | Where Companion keeps component XML. |
| `pollSeconds` | `60` | How often to check the watched components; `0` turns it off. |
| `activityLog` | `true` | Read [Companion's activity log](#companions-activity-log) as a second source. |
| `toasts` | `true` | Toasts for failures, finished deploys and tests, and watched changes. |
| `banner` | `true` | The banner above the prompt, and a new session's recap and tips. |
| `budgetUsd` | `0` | The session's spend budget in US dollars; `0` turns it off. |
| `companionShare` | `0` | Companion's share of your weekly usage limit, in percent; `0` turns it off. |
| `companionSharePeriod` | `week` | What the share runs over: `day`, `week` or `month`. |
| `companionMonthlyUsd` | `0` | A monthly amount for Companion sessions, in US dollars; `0` turns it off. |
| `seatBudgetUsd` | `0` | The Claude budget your admin assigned you, in US dollars, shown against the spend limit Claude Code reports; `0` leaves it out. |
| `usageBreakdown` | `true` | Read Claude Code's `/usage` breakdown every 15 minutes for Companion's share of all your usage. |
| `budgetEnforce` | `warn` | What a spent budget does: `warn` only warns; `confirm` asks before each Companion change; `block` refuses them. `confirm` and `block` really stop changes. See [Budget enforcement](#budget-enforcement). |
| `budgetGrace` | `0` | How far past a budget, in percent, before `confirm` or `block` starts. |
| `updateCheck` | `true` | At the start of a session, say when a newer dashboard is on GitHub (never installs). |
| `updateCheckHours` | `24` | Hours between update checks; `0` turns them off. |
| `reportOpen` | `true` | Open `/bc-dashboard report html`'s page in your browser once it's saved. |
| `reportStyle` | `exosphere` | How the HTML report looks: `exosphere` (Boomi's design system) or `expressive` (Valence, Miami Deco). `--style` picks one for a single report. |
| `suggestions` | `true` | Suggest the next step after a turn. |
| `historyDays` | `90` | How far back **Past Companion sessions** reads. |
| `promptCheck` | `confirm` | [Prompt tips](#prompt-tips): `confirm` holds a flagged prompt until you send it or the upgrade; `suggest` shows tips and sends the prompt; `off` never checks. A secret in a prompt asks unless this is `off`. |
| `promptView` | `auto` | When the [Prompt tab](#prompt-tips) opens: `auto` when a prompt gets tips, `manual` only when you ask, `off` never. |
| `promptModel` | `haiku` | The model `/bc-dashboard prompt upgrade` asks, only when you run it. |
| `promptSkip` | (none) | Prompt checks to leave out, separated by commas. |

## Limits

- **The web app doesn't show banners, panes, status lines or toasts yet.** Use `/bc-dashboard` or ask Claude; `/bc-dashboard prompt` stands in for the Prompt tab.
- Companion's work is seen through its plugins' scripts, run from Bash, and their `SUCCESS:`/`ERROR:`/`WARNING:` lines and exit codes. A component sent another way (`curl`, another MCP server) doesn't show up, and a change to the scripts' output could need a change here.
- Steps are saved per working folder, the last 200 whatever their age. After a restart, the last 24 hours (`recentHours`) come back; **Show N earlier** under **Components this session**, or `/bc-dashboard earlier`, shows the rest, as history: their failures don't go under **Needs attention**. Tokens and spend start over each session, counted from when the mod loads.
- Cost is the whole session's, not just Companion's share.
- Past sessions are this machine's only (not the web's), and Claude Code deletes transcripts after 30 days unless `cleanupPeriodDays` says otherwise.
- **Why?** and **Run again** need Companion's scripts, found where the last one ran or in Claude Code's plugin cache, and work where the CLI runs. **Why?** on a BDI run uses bc-bdi's scripts from the plugin cache, which read bc-bdi's own settings in the workspace.
- A refusal by another mod shows as blocked only if it reaches the dashboard, which depends on hook order.
- Prompt tips are rules about wording, so they can miss a vague prompt or flag a clear one. `promptSkip` turns off a check that gets in your way.

## How it works

```mermaid
%%{init: {"theme": "base", "fontFamily": "Josefin Sans, trebuchet ms, verdana, arial, sans-serif", "themeVariables": {"fontSize": "15px", "background": "#FBF6EE", "primaryColor": "#FBF6EE", "primaryTextColor": "#0B0B0B", "primaryBorderColor": "#9A7B3F", "lineColor": "#9A7B3F", "textColor": "#0B0B0B", "secondaryColor": "#9FDED6", "tertiaryColor": "#FBE7A1", "edgeLabelBackground": "#FBF6EE", "clusterBkg": "#FBF6EE", "clusterBorder": "#9A7B3F", "actorBkg": "#F7A8C4", "actorBorder": "#C2185B", "actorTextColor": "#0B0B0B", "actorLineColor": "#9A7B3F", "signalColor": "#0B0B0B", "signalTextColor": "#0B0B0B", "labelBoxBkgColor": "#FBE7A1", "labelBoxBorderColor": "#9A7B3F", "labelTextColor": "#0B0B0B", "loopTextColor": "#0B0B0B", "noteBkgColor": "#FBE7A1", "noteBorderColor": "#9A7B3F", "noteTextColor": "#0B0B0B", "activationBkgColor": "#9FDED6", "activationBorderColor": "#0F766E", "sequenceNumberColor": "#FBF6EE"}}}%%
flowchart LR
    W["Claude edits<br/>component XML"] --> R["Component's stages"]
    A["Claude runs a Companion script<br/>create, push, deploy, test, ..."] --> D{"SUCCESS or ERROR?<br/>test status?"}
    D -- ok --> R
    D -- failed --> X["error: needs attention,<br/>with a next step"]
    R --> S["Banner, pane,<br/>status line, /bc-dashboard"]
    X --> S
    L[("Companion's activity log")] -. "every 10 s:<br/>runs Claude didn't make" .-> R
    P[("Boomi Platform API")] -. "every 60 s:<br/>watched components" .-> S
    U["Session cost<br/>and context"] -.-> S
    class R focus
    class D decision
    class W,A,S highlight
    class P,L external
    class X error
    classDef focus fill:#F7A8C4,stroke:#C2185B,stroke-width:2px,color:#0B0B0B
    classDef decision fill:#9FDED6,stroke:#0F766E,stroke-width:2px,color:#0B0B0B
    classDef highlight fill:#FBE7A1,stroke:#9A7B3F,stroke-width:1.5px,color:#0B0B0B
    classDef external fill:#FFFFFF,stroke:#0F766E,stroke-width:1.5px,stroke-dasharray:5 3,color:#0B0B0B
    classDef error fill:#FFFFFF,stroke:#D03B3B,stroke-width:2px,color:#0B0B0B
```

The dashboard follows Claude's tool calls, so tracking the session costs no Platform API calls. It never stops a script. The output it reads was last checked against Companion **v1.0.83**, whose own output lines are in the tests.

| Companion script | What the dashboard records |
|---|---|
| `datahub-*.sh`, `bdi-*.sh`, `agentstudio-*.sh`, `connectordev-*.sh`, `boomi-marketplace-*.sh` | A step of that product when the subcommand changes something; failed on `ERROR:` or an error exit, ◐ on `WARNING:` |
| `boomi-component-create.sh <file>` | Created, with the new ID |
| `boomi-component-push.sh <file>` | Saved, with the new version |
| `boomi-component-pull.sh` | Pulled |
| `boomi-deploy.sh` / `boomi-undeploy.sh` | Deployed or undeployed, or the error |
| `boomi-test-execute.sh --process-id <id>` | The execution's status; `ERROR`, `ABORTED` or `DISCARDED` is a failure. With `--no-wait`, ◐ submitted |
| Any other Companion script | A line under **Claude's latest steps** |

| Engine call | Used for |
|---|---|
| `tool.call` on `Bash`, `Write`, `Edit` | Companion's script runs and component edits |
| `turn.step`, `turn.start`, `turn.complete` | Each model call's tokens, and whether Claude is working |
| `$.session.usage` | Cost, context, session length and the seat's usage limits |
| `$.http.fetch` | Read-only Platform API queries for watched components |
| `$.fs` | Component XML, Companion's `.env` and its activity log |
| `$.process.run` | **Why?**, **Run again**, the session scan, and `claude -p "/usage"` for the usage breakdown |
| `prompt.submit` | Prompt tips, the secret question and the budget note |
| `$.model.complete` | `/bc-dashboard prompt upgrade`, only when you run it |
| `$.prompt.fill`, `$.prompt.suggest` | **Ask Claude to fix**, the next-step suggestion and an upgraded prompt |
| `$.ui.ask` | Which failure `why` and `rerun` act on, and which session `resume` reopens |
| `$.ui.copy` | **Copy** and `resume`: the command that reopens a past session |
| `$.state`, `$.store` | What the views draw, what's kept across sessions, and the other Boomi mods' state for **Guardrails** |
| `ui.render`, `$.ui.status`, `$.ui.toast` | The banner, pane, status line and toasts |

## What's coming next

- **Process runs in Boomi, back again:** the environment's runs of this session's components, set aside in 0.11.0.
- **A failed run's documents**, not only its log, once the [execution debugger](../IDEAS.md#execution-debugger) can read them from a local runtime.
- **[Mock endpoints](../IDEAS.md#mock-endpoints) traffic**, once that mod exists.

## Development

Built against Claude Code 2.1.296.

```bash
cd boomi-dashboard
claude plugin validate .
claude plugin test .
prove tests          # scripts/scan-sessions.pl against made-up transcripts, and scripts/upgrade.sh against a throwaway repo
```

`hooks/activity.ts` holds the plain functions (stages, attention, wording, tokens), with unit tests; `hooks/platform.ts` is the Platform API client. Everything that touches the engine is in `hooks/register.tsx`, because the engine follows `$` only within one file. `assets/pane-*.png` are the pane as the test kit draws it for a sample session.
