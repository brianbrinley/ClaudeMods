# Install the Boomi Companion Dashboard on your own computer

To install the dashboard in Claude Code on your computer, paste the prompt below into a Claude Code session. Start that session from your Boomi Companion workspace, the folder with Companion's `.env`. It works for any Claude account: nothing in the mod is tied to one.

**On Windows, use WSL.** Run Claude Code inside WSL (Ubuntu, say) and paste the prompt there, in the WSL copy of your Companion workspace. The dashboard then works as it does on Linux.

**Perl** is the one thing the dashboard needs besides Claude Code: its **Past Companion sessions** section uses it to read Claude Code's transcripts. macOS and most Linux have it; a minimal Ubuntu (some WSL images) may need `sudo apt install perl`. The prompt checks for it.

```text
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

## After the restart

- Run `/bc-dashboard`. It should say nothing needs attention and that no components have shown up yet.
- Have Claude build something with Companion. Each component appears in the pane as Claude edits it, saves it to Boomi, deploys it and tests it, and the banner above the prompt shows the latest step.
- Run `/bc-dashboard poll` to check the connection to Boomi. If credentials or `BOOMI_ENVIRONMENT_ID` are missing, the **Process runs in Boomi** section says which.
- Press **Scan** under **Past Companion sessions** to see what earlier Companion sessions on this computer cost. If it says Perl is needed, install it as step 5 said.
- When a test fails, press **Why?** under **Needs attention** to read its log, then **Ask Claude to fix** or **Run again**.
- To be warned about spend, set a budget under `/config`, in the mod's **Spend budget (USD)** setting.
- The pane starts in the Day theme. Press **Night** or **Terminal** at the top of the pane, or run `/bc-dashboard theme night`, to switch.

## Updating

Run `git -C ~/ClaudeMods pull`, then restart Claude Code.

**If you installed it as boomi-cockpit:** the mod's folder is now `boomi-dashboard` and its command is `/bc-dashboard`. After the pull, change `boomi-cockpit` to `boomi-dashboard` in `CLAUDE_CODE_PLUGIN_DIRS` in `~/.claude/settings.json`, then restart. Settings you changed under `/config` and the watch list start over under the new name.
